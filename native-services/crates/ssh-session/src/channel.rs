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
//! credit, or while any `pause {reason?}` is not matched by a `resume` with
//! the same reason, the channel is not read, so with per-channel flow
//! control the peer stops once its window is spent, without affecting other
//! channels on the connection.
//!
//! Pipe mode (`open.pipe: {rules?}`, see [`crate::pipe`]): output is
//! terminal text, already decoded, filtered and highlighted, with stderr
//! merged in order; credit counts that text, so the renderer's ACKs can be
//! passed on as credit unchanged. Extra events: `editorMode {active}` and
//! `zmodem {kind, event}`; extra commands: `zmodemAccept {path}`,
//! `zmodemSend {files}`, `zmodemCancel`.

use crate::pipe::{Effect, Pipe, PipeOptions, ZmodemCommand, TICK_INTERVAL};
use crate::registry;
use bytes::Bytes;
use core_protocol::service::{self, Output};
use core_protocol::StreamIo;
use russh::client::Msg;
use russh::{ChannelMsg, ChannelReadHalf, ChannelWriteHalf, Pty, Sig};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::mpsc;

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
#[serde(rename_all = "camelCase")]
struct OpenRequest {
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
    pipe: Option<PipeOptions>,
}

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Command {
    Open(Box<OpenRequest>),
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
    Pause {
        reason: Option<String>,
    },
    Resume {
        reason: Option<String>,
    },
    Close,
}

enum Event {
    Channel(Command),
    Zmodem(ZmodemCommand),
}

const DEFAULT_PAUSE_REASON: &str = "flow";

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

fn parse(event: Value) -> Option<Event> {
    match event.get("type").and_then(Value::as_str) {
        Some(kind) if kind.starts_with("zmodem") => {
            serde_json::from_value(event).ok().map(Event::Zmodem)
        }
        _ => serde_json::from_value(event).ok().map(Event::Channel),
    }
}

/// Sends pipe effects; returns the text bytes written (credit used).
fn deliver(
    output: &Output,
    remote: &mpsc::UnboundedSender<Vec<u8>>,
    effects: Vec<Effect>,
) -> Result<i64, String> {
    let mut written = 0;
    for effect in effects {
        match effect {
            Effect::Text(text) => {
                written += text.len() as i64;
                output.write_bytes(Bytes::from(text.into_bytes()))?;
            }
            Effect::Remote(bytes) => {
                let _ = remote.send(bytes);
            }
            Effect::Event(event) => output.write_event(&event)?,
        }
    }
    Ok(written)
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

    let open = loop {
        match events.recv().await.map(parse) {
            Some(Some(Event::Channel(Command::Open(open)))) => break *open,
            Some(_) => continue,
            None => return Ok(()),
        }
    };
    let OpenRequest {
        connection,
        kind,
        command,
        pty,
        env,
        agent_forward,
        credit,
        pipe,
    } = open;
    let mut pipe = match pipe.map(Pipe::new).transpose() {
        Ok(pipe) => pipe,
        Err(message) => return fail(&output, message),
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

    // Writes run on their own task: a full send window must never stop us
    // from reading output (the peer may wait for that before reading input).
    // ZMODEM protocol bytes from pipe mode share the task with stdin.
    let (remote, mut remote_rx) = mpsc::unbounded_channel::<Vec<u8>>();
    let stdin = {
        let write = Arc::clone(&write);
        service::spawn(async move {
            let mut writer = write.make_writer();
            let mut buffer = vec![0u8; INPUT_CHUNK];
            loop {
                let written = tokio::select! {
                    read = input.read(&mut buffer) => match read {
                        Ok(0) | Err(_) => break,
                        Ok(count) => writer.write_all(&buffer[..count]).await,
                    },
                    Some(bytes) = remote_rx.recv() => writer.write_all(&bytes).await,
                };
                if written.is_err() {
                    return;
                }
            }
            let _ = writer.flush().await;
            let _ = write.eof().await;
        })
    };

    let mut paused: HashSet<String> = HashSet::new();
    // Signed: one message may overspend, and that debt must be repaid by
    // later grants (forgiving it would let output in flight creep upward).
    // Unlimited credit never runs out.
    let mut credit: i64 = credit.map_or(i64::MAX, |bytes| bytes.min(i64::MAX as u64) as i64);
    let mut events_open = true;
    let close_deadline = tokio::time::sleep(Duration::MAX);
    tokio::pin!(close_deadline);
    let mut closing = false;
    let flush_deadline = tokio::time::sleep(Duration::MAX);
    tokio::pin!(flush_deadline);
    let mut ticker = tokio::time::interval(TICK_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        let readable = paused.is_empty()
            && credit > 0
            && pipe.as_ref().is_none_or(|pipe| pipe.accepts_input(credit));
        if let Some(deadline) = pipe.as_ref().and_then(Pipe::flush_deadline) {
            if flush_deadline.deadline() != deadline {
                flush_deadline.as_mut().reset(deadline);
            }
        }
        tokio::select! {
            message = read.wait(), if readable => match message {
                Some(ChannelMsg::Data { data }) => {
                    lease.mark_received();
                    if let Some(pipe) = pipe.as_mut() {
                        let effects = pipe.stdout(&data).await;
                        credit = credit.saturating_sub(deliver(&output, &remote, effects)?);
                    } else {
                        credit = credit.saturating_sub(data.len() as i64);
                        output.write_bytes(Bytes::copy_from_slice(&data))?;
                    }
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    lease.mark_received();
                    if let Some(pipe) = pipe.as_mut() {
                        let effects = pipe.stderr(&data);
                        credit = credit.saturating_sub(deliver(&output, &remote, effects)?);
                    } else {
                        credit = credit.saturating_sub(data.len() as i64);
                        output.write_stderr(Bytes::copy_from_slice(&data))?;
                    }
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
            _ = &mut flush_deadline, if pipe.as_ref().is_some_and(|pipe| pipe.flush_deadline().is_some()) => {
                if let Some(pipe) = pipe.as_mut() {
                    let effects = pipe.flush();
                    credit = credit.saturating_sub(deliver(&output, &remote, effects)?);
                }
            }
            _ = ticker.tick(), if pipe.is_some() => {
                if let Some(pipe) = pipe.as_mut() {
                    let effects = pipe.tick().await;
                    credit = credit.saturating_sub(deliver(&output, &remote, effects)?);
                }
            }
            event = events.recv(), if events_open => match event.map(parse) {
                None => events_open = false,
                Some(Some(Event::Zmodem(command))) => {
                    if let Some(pipe) = pipe.as_mut() {
                        let effects = pipe.command(command).await;
                        credit = credit.saturating_sub(deliver(&output, &remote, effects)?);
                    }
                }
                Some(Some(Event::Channel(Command::Resize { cols, rows, width, height }))) => {
                    let _ = write
                        .window_change(cols, rows, width.unwrap_or(0), height.unwrap_or(0))
                        .await;
                }
                Some(Some(Event::Channel(Command::Signal { name }))) => {
                    let _ = write.signal(signal(&name)).await;
                }
                Some(Some(Event::Channel(Command::Credit { bytes }))) => {
                    credit = credit.saturating_add(bytes.min(i64::MAX as u64) as i64);
                }
                Some(Some(Event::Channel(Command::Pause { reason }))) => {
                    paused.insert(reason.unwrap_or_else(|| DEFAULT_PAUSE_REASON.into()));
                }
                Some(Some(Event::Channel(Command::Resume { reason }))) => {
                    paused.remove(reason.as_deref().unwrap_or(DEFAULT_PAUSE_REASON));
                }
                Some(Some(Event::Channel(Command::Close))) if !closing => {
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
    if let Some(pipe) = pipe.as_mut() {
        let effects = pipe.finish();
        deliver(&output, &remote, effects)?;
    }
    stdin.abort();
    output.write_event(&json!({"type": "closed"}))?;
    Ok(())
}
