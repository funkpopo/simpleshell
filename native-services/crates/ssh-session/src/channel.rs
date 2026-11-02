//! `ssh-channel`: one stream per shell or exec channel.
//!
//! The first event opens the channel:
//! `open {connection, kind: "shell"|"exec", command?, pty?, env?, agentForward?}`.
//! Later events: `resize {cols, rows, width?, height?}`, `signal {name}`,
//! `pause`, `resume`, `close`. Input bytes go to the channel; input EOF sends
//! EOF. Output: channel data as stream data, extended data as stderr, and
//! events `opened`, `exit {code?, signal?}`, `eof`, `closed`, `error`.
//!
//! Flow control: `open` may carry `credit` (bytes); every byte of data or
//! stderr sent consumes credit and `credit {bytes}` events add more. Without
//! credit, or after `pause`, the channel is not read, so with per-channel
//! flow control the peer stops once its window is spent, without affecting
//! other channels on the connection.

use crate::registry;
use bytes::Bytes;
use core_protocol::service::{self, Output};
use core_protocol::StreamIo;
use russh::client::Msg;
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Pty, Sig};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const INPUT_CHUNK: usize = 32 * 1024;
/// How long a closed channel waits for the peer's CHANNEL_CLOSE reply.
const CLOSE_GRACE: Duration = Duration::from_secs(2);

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PtyRequest {
    term: Option<String>,
    cols: Option<u32>,
    rows: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Command {
    Open {
        connection: String,
        kind: String,
        command: Option<String>,
        pty: Option<PtyRequest>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default)]
        agent_forward: bool,
        /// Initial output credit in bytes; unlimited when absent.
        credit: Option<u64>,
    },
    Resize {
        cols: u32,
        rows: u32,
        width: Option<u32>,
        height: Option<u32>,
    },
    Signal {
        name: String,
    },
    Credit {
        bytes: u64,
    },
    Pause,
    Resume,
    Close,
}

fn signal(name: &str) -> Sig {
    match name.trim_start_matches("SIG") {
        "ABRT" => Sig::ABRT,
        "ALRM" => Sig::ALRM,
        "FPE" => Sig::FPE,
        "HUP" => Sig::HUP,
        "ILL" => Sig::ILL,
        "INT" => Sig::INT,
        "KILL" => Sig::KILL,
        "PIPE" => Sig::PIPE,
        "QUIT" => Sig::QUIT,
        "SEGV" => Sig::SEGV,
        "TERM" => Sig::TERM,
        "USR1" => Sig::USR1,
        other => Sig::Custom(other.to_string()),
    }
}

fn signal_name(signal: &Sig) -> String {
    match signal {
        Sig::Custom(name) => name.clone(),
        other => format!("{other:?}"),
    }
}

/// Waits for the reply to a `want_reply` request; data may not precede it.
async fn expect_success(read: &mut ChannelReadHalf, what: &str) -> Result<(), String> {
    loop {
        match read.wait().await {
            Some(ChannelMsg::Success) => return Ok(()),
            Some(ChannelMsg::Failure) => return Err(format!("{what} request was rejected")),
            Some(ChannelMsg::WindowAdjusted { .. }) => continue,
            Some(ChannelMsg::Close) | None => {
                return Err(format!("channel closed during {what} request"))
            }
            Some(_) => continue,
        }
    }
}

async fn start(
    write: &ChannelWriteHalf<Msg>,
    read: &mut ChannelReadHalf,
    kind: &str,
    command: Option<String>,
    pty: Option<PtyRequest>,
    env: BTreeMap<String, String>,
    agent_forward: bool,
) -> Result<(), String> {
    let map = |error: russh::Error| error.to_string();
    if agent_forward {
        write.agent_forward(false).await.map_err(map)?;
    }
    for (name, value) in env {
        // Servers commonly refuse `env`; that is not fatal.
        write.set_env(false, name, value).await.map_err(map)?;
    }
    if let Some(pty) = pty {
        write
            .request_pty(
                true,
                pty.term.as_deref().unwrap_or("xterm-256color"),
                pty.cols.unwrap_or(80),
                pty.rows.unwrap_or(24),
                pty.width.unwrap_or(0),
                pty.height.unwrap_or(0),
                &[(Pty::TTY_OP_ISPEED, 38400), (Pty::TTY_OP_OSPEED, 38400)],
            )
            .await
            .map_err(map)?;
        expect_success(read, "pty").await?;
    }
    match kind {
        "shell" => {
            write.request_shell(true).await.map_err(map)?;
            expect_success(read, "shell").await
        }
        "exec" => {
            let command = command.ok_or("exec requires a command")?;
            write.exec(true, command).await.map_err(map)?;
            expect_success(read, "exec").await
        }
        other => Err(format!("unsupported channel kind: {other}")),
    }
}

fn parse(event: Value) -> Option<Command> {
    serde_json::from_value(event).ok()
}

pub async fn serve(io: StreamIo) -> Result<(), String> {
    let StreamIo {
        mut input,
        mut events,
    } = io;
    let output = service::output();
    let fail = |output: &Output, message: String| {
        let _ = output.write_event(&json!({"type": "error", "message": message}));
        Ok(())
    };

    let (connection, kind, command, pty, env, agent_forward, credit) = loop {
        match events.recv().await.map(parse) {
            Some(Some(Command::Open {
                connection,
                kind,
                command,
                pty,
                env,
                agent_forward,
                credit,
            })) => break (connection, kind, command, pty, env, agent_forward, credit),
            Some(_) => continue,
            None => return Ok(()),
        }
    };
    let Some(lease) = registry::get(&connection) else {
        return fail(&output, "SSH connection is not available".to_string());
    };
    let channel = match lease.open_session().await {
        Ok(channel) => channel,
        Err(message) => return fail(&output, message),
    };
    let (mut read, write) = channel.split();
    let write = Arc::new(write);
    if let Err(message) = start(&write, &mut read, &kind, command, pty, env, agent_forward).await {
        let _ = write.close().await;
        return fail(&output, message);
    }
    output.write_event(&json!({"type": "opened"}))?;

    // Stdin runs on its own task: a full send window must never stop us
    // from reading output (the peer may wait for that before reading input).
    let stdin = {
        let write = Arc::clone(&write);
        service::spawn(async move {
            let mut writer = write.make_writer();
            let mut buffer = vec![0u8; INPUT_CHUNK];
            loop {
                match input.read(&mut buffer).await {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        if writer.write_all(&buffer[..count]).await.is_err() {
                            return;
                        }
                    }
                }
            }
            let _ = writer.flush().await;
            let _ = write.eof().await;
        })
    };

    let mut paused = false;
    // Saturating: unlimited credit never runs out.
    let mut credit = credit.unwrap_or(u64::MAX);
    let mut events_open = true;
    let close_deadline = tokio::time::sleep(Duration::MAX);
    tokio::pin!(close_deadline);
    let mut closing = false;
    loop {
        tokio::select! {
            message = read.wait(), if !paused && credit > 0 => match message {
                Some(ChannelMsg::Data { data }) => {
                    lease.mark_received();
                    credit = credit.saturating_sub(data.len() as u64);
                    output.write_bytes(data)?;
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    lease.mark_received();
                    credit = credit.saturating_sub(data.len() as u64);
                    output.write_stderr(Bytes::copy_from_slice(&data))?;
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    output.write_event(&json!({"type": "exit", "code": exit_status}))?;
                }
                Some(ChannelMsg::ExitSignal { signal_name: sig, core_dumped, error_message, .. }) => {
                    output.write_event(&json!({
                        "type": "exit",
                        "signal": signal_name(&sig),
                        "coreDumped": core_dumped,
                        "message": error_message,
                    }))?;
                }
                Some(ChannelMsg::Eof) => output.write_event(&json!({"type": "eof"}))?,
                Some(ChannelMsg::Close) | None => break,
                Some(_) => {}
            },
            // Some peers never confirm the close; do not wait forever.
            _ = &mut close_deadline, if closing => break,
            event = events.recv(), if events_open => match event.map(parse) {
                None => events_open = false,
                Some(Some(Command::Resize { cols, rows, width, height })) => {
                    let _ = write
                        .window_change(cols, rows, width.unwrap_or(0), height.unwrap_or(0))
                        .await;
                }
                Some(Some(Command::Signal { name })) => {
                    let _ = write.signal(signal(&name)).await;
                }
                Some(Some(Command::Credit { bytes })) => {
                    credit = credit.saturating_add(bytes);
                }
                Some(Some(Command::Pause)) => paused = true,
                Some(Some(Command::Resume)) => paused = false,
                Some(Some(Command::Close)) if !closing => {
                    closing = true;
                    let _ = write.close().await;
                    close_deadline
                        .as_mut()
                        .reset(tokio::time::Instant::now() + CLOSE_GRACE);
                }
                Some(_) => {}
            },
        }
    }
    stdin.abort();
    output.write_event(&json!({"type": "closed"}))?;
    Ok(())
}
