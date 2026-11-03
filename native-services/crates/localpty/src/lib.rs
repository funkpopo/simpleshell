//! `pty`: a local program on a pseudo terminal (ConPTY on Windows), for
//! local terminal tabs and the Mosh client.
//!
//! The first event spawns the program:
//! `open {file, args?, cwd?, env?, cols?, rows?, name?}` (`env` replaces the
//! environment; `name` becomes `TERM`). Answers `spawned {pid}` or
//! `error {message, code}`. Input bytes go to the terminal. Later events:
//! `resize {cols, rows}`, `kill`, `pause`, `resume`. Output is terminal data;
//! when the program ends the stream sends `exit {exitCode, signal}` and
//! closes.

use bytes::Bytes;
use core_protocol::service;
use core_protocol::StreamIo;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{Read, Write};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::sync::{mpsc, oneshot};

const READ_CHUNK: usize = 32 * 1024;
/// Output chunks buffered between the reader thread and the stream.
const READ_QUEUE: usize = 8;
/// After the program exits, output still in the terminal is drained for at
/// most this long (ConPTY only ends its output when the terminal closes).
const EXIT_DRAIN: Duration = Duration::from_millis(250);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Open {
    file: String,
    #[serde(default)]
    args: Vec<String>,
    cwd: Option<String>,
    env: Option<BTreeMap<String, String>>,
    cols: Option<u16>,
    rows: Option<u16>,
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Command {
    Open(Box<Open>),
    Resize { cols: u16, rows: u16 },
    Kill,
    Pause,
    Resume,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        rows: rows.max(1),
        cols: cols.max(1),
        pixel_width: 0,
        pixel_height: 0,
    }
}

/// node-style error code for a spawn failure.
fn error_code(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if lower.contains("os error 2)")
        || lower.contains("not found")
        || lower.contains("no such file")
    {
        "ENOENT"
    } else if lower.contains("os error 5)")
        || lower.contains("os error 13)")
        || lower.contains("permission denied")
    {
        "EACCES"
    } else {
        "ESPAWN"
    }
}

struct Spawned {
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

fn spawn(open: Open) -> Result<Spawned, String> {
    let pair = native_pty_system()
        .openpty(size(open.cols.unwrap_or(80), open.rows.unwrap_or(24)))
        .map_err(|error| format!("failed to open a terminal: {error}"))?;
    let mut command = CommandBuilder::new(&open.file);
    command.args(&open.args);
    if let Some(cwd) = open.cwd.filter(|cwd| !cwd.is_empty()) {
        command.cwd(cwd);
    }
    if let Some(env) = open.env {
        command.env_clear();
        for (name, value) in env {
            command.env(name, value);
        }
    }
    if let Some(name) = open.name {
        command.env("TERM", name);
    }
    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to start {}: {error}", open.file))?;
    Ok(Spawned {
        master: pair.master,
        child,
    })
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
    let open = loop {
        match events.recv().await.map(parse) {
            Some(Some(Command::Open(open))) => break *open,
            Some(_) => continue,
            None => return Ok(()),
        }
    };
    let Spawned { master, mut child } = match spawn(open) {
        Ok(spawned) => spawned,
        Err(message) => {
            let code = error_code(&message);
            output.write_event(&json!({"type": "error", "message": message, "code": code}))?;
            return Ok(());
        }
    };
    let mut killer = child.clone_killer();
    output.write_event(&json!({"type": "spawned", "pid": child.process_id()}))?;

    let mut reader = master
        .try_clone_reader()
        .map_err(|error| format!("terminal reader: {error}"))?;
    let mut writer = master
        .take_writer()
        .map_err(|error| format!("terminal writer: {error}"))?;

    // Blocking terminal I/O runs on threads; a full queue blocks the reader,
    // which is how a paused terminal stops the program.
    let (chunks_tx, mut chunks) = mpsc::channel::<Vec<u8>>(READ_QUEUE);
    std::thread::spawn(move || {
        let mut buffer = vec![0u8; READ_CHUNK];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    if chunks_tx.blocking_send(buffer[..count].to_vec()).is_err() {
                        break;
                    }
                }
            }
        }
    });
    let (exit_tx, mut exit_rx) = oneshot::channel();
    std::thread::spawn(move || {
        let _ = exit_tx.send(child.wait());
    });
    let (input_tx, input_rx) = std::sync::mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        while let Ok(bytes) = input_rx.recv() {
            if writer
                .write_all(&bytes)
                .and_then(|_| writer.flush())
                .is_err()
            {
                break;
            }
        }
    });
    let stdin = service::spawn(async move {
        let mut buffer = vec![0u8; READ_CHUNK];
        while let Ok(count) = input.read(&mut buffer).await {
            if count == 0 || input_tx.send(buffer[..count].to_vec()).is_err() {
                break;
            }
        }
    });

    let mut paused = false;
    let mut events_open = true;
    let mut output_open = true;
    let mut status = None;
    let drain = tokio::time::sleep(Duration::MAX);
    tokio::pin!(drain);
    loop {
        tokio::select! {
            chunk = chunks.recv(), if output_open && (!paused || status.is_some()) => match chunk {
                Some(chunk) => output.write_bytes(Bytes::from(chunk))?,
                None => {
                    output_open = false;
                    if status.is_some() {
                        break;
                    }
                }
            },
            result = &mut exit_rx, if status.is_none() => {
                status = Some(result.ok().and_then(Result::ok));
                if !output_open {
                    break;
                }
                drain.as_mut().reset(tokio::time::Instant::now() + EXIT_DRAIN);
            }
            _ = &mut drain, if status.is_some() => break,
            event = events.recv(), if events_open => match event.map(parse) {
                None => {
                    // The main process went away: end the program.
                    events_open = false;
                    let _ = killer.kill();
                }
                Some(Some(Command::Resize { cols, rows })) => {
                    let _ = master.resize(size(cols, rows));
                }
                Some(Some(Command::Kill)) => {
                    let _ = killer.kill();
                }
                Some(Some(Command::Pause)) => paused = true,
                Some(Some(Command::Resume)) => paused = false,
                Some(_) => {}
            },
        }
    }
    stdin.abort();
    drop(master);
    let (exit_code, signal) = match status.flatten() {
        Some(status) => (status.exit_code(), status.signal().map(str::to_string)),
        None => (1, None),
    };
    output.write_event(&json!({"type": "exit", "exitCode": exit_code, "signal": signal}))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_spawn_failures_to_node_codes() {
        assert_eq!(
            error_code(
                "failed to start x: The system cannot find the file specified. (os error 2)"
            ),
            "ENOENT"
        );
        assert_eq!(error_code("No such file or directory"), "ENOENT");
        assert_eq!(error_code("Access is denied. (os error 5)"), "EACCES");
        assert_eq!(error_code("something else"), "ESPAWN");
    }
}
