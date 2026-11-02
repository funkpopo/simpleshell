//! `ssh-connection`: one stream per terminal-side SSH client.
//!
//! Events from the main process:
//! `connect {config}`, `hostKeyDecision {id, trusted}`,
//! `keyboardAnswers {id, answers|null}`, `ping {id, timeoutMs}`, `end`.
//! Events to the main process:
//! `stage {stage}`, `hostKey {id, fingerprint, algorithm, keyBase64}`,
//! `keyboard {id, name, instructions, prompts}`, `ready {token, reused}`,
//! `pong {id, healthy}`, `error {message}`, `closed {reason}`.
//!
//! The stream holds a hub lease for its lifetime and registers it under
//! `token`, which `ssh-channel` streams use to open shells and exec channels.

use crate::registry;
use core_protocol::service::{self, Output};
use core_protocol::StreamIo;
use serde::Deserialize;
use serde_json::{json, Value};
use ssh_hub::{ConnectConfig, Interaction};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::sync::oneshot;

const CLOSE_CHECK_INTERVAL: Duration = Duration::from_millis(250);
const DEFAULT_PING_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Command {
    Connect {
        config: Box<ConnectConfig>,
    },
    HostKeyDecision {
        id: u64,
        trusted: bool,
    },
    KeyboardAnswers {
        id: u64,
        answers: Option<Vec<String>>,
    },
    Ping {
        id: u64,
        timeout_ms: Option<u64>,
    },
    End,
}

/// Questions waiting for an answer from the main process.
#[derive(Default)]
struct Pending {
    host_keys: HashMap<u64, oneshot::Sender<bool>>,
    prompts: HashMap<u64, oneshot::Sender<Option<Vec<String>>>>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

fn interaction(output: Output, pending: Arc<Mutex<Pending>>) -> Interaction {
    let ids = Arc::new(AtomicU64::new(1));
    let host_key = {
        let (output, pending, ids) = (output.clone(), Arc::clone(&pending), Arc::clone(&ids));
        Arc::new(move |info: ssh_hub::HostKeyInfo| {
            let id = ids.fetch_add(1, Ordering::Relaxed);
            let (tx, rx) = oneshot::channel();
            lock(&pending).host_keys.insert(id, tx);
            let sent = output.write_event(&json!({
                "type": "hostKey",
                "id": id,
                "fingerprint": info.fingerprint,
                "algorithm": info.algorithm,
                "keyBase64": info.key_base64,
            }));
            Box::pin(async move { sent.is_ok() && rx.await.unwrap_or(false) })
                as ssh_hub::BoxFuture<bool>
        })
    };
    let keyboard = Arc::new(move |prompt: ssh_hub::KeyboardPrompt| {
        let id = ids.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        lock(&pending).prompts.insert(id, tx);
        let sent = output.write_event(&json!({
            "type": "keyboard",
            "id": id,
            "name": prompt.name,
            "instructions": prompt.instructions,
            "prompts": prompt.prompts.iter()
                .map(|(text, echo)| json!({"prompt": text, "echo": echo}))
                .collect::<Vec<_>>(),
        }));
        Box::pin(async move {
            if sent.is_err() {
                return None;
            }
            rx.await.ok().flatten()
        }) as ssh_hub::BoxFuture<Option<Vec<String>>>
    });
    Interaction {
        host_key: Some(host_key),
        keyboard: Some(keyboard),
    }
}

fn answer(pending: &Mutex<Pending>, command: Command) {
    let mut pending = lock(pending);
    match command {
        Command::HostKeyDecision { id, trusted } => {
            if let Some(tx) = pending.host_keys.remove(&id) {
                let _ = tx.send(trusted);
            }
        }
        Command::KeyboardAnswers { id, answers } => {
            if let Some(tx) = pending.prompts.remove(&id) {
                let _ = tx.send(answers);
            }
        }
        _ => {}
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
    let config = loop {
        match events.recv().await.map(parse) {
            Some(Some(Command::Connect { config })) => break *config,
            Some(_) => continue,
            None => return Ok(()),
        }
    };

    // Answers arrive as events while the handshake waits on them.
    let pending = Arc::new(Mutex::new(Pending::default()));
    let interaction = interaction(output.clone(), Arc::clone(&pending));
    let stage = |name: &str| {
        let _ = output.write_event(&json!({"type": "stage", "stage": name}));
    };
    let acquire = ssh_hub::global().acquire(&config, &interaction, &stage);
    tokio::pin!(acquire);
    let lease = loop {
        tokio::select! {
            result = &mut acquire => break result,
            event = events.recv() => match event.map(parse) {
                Some(Some(Command::End)) | None => return Ok(()),
                Some(Some(command)) => answer(&pending, command),
                Some(None) => {}
            },
        }
    };
    let lease = match lease {
        Ok(lease) => Arc::new(lease),
        Err(message) => {
            let _ = output.write_event(&json!({"type": "error", "message": message}));
            return Ok(());
        }
    };

    let token = registry::insert(Arc::clone(&lease));
    output.write_event(&json!({
        "type": "ready",
        "token": token,
        "reused": lease.reused(),
    }))?;

    let mut closed_check = tokio::time::interval(CLOSE_CHECK_INTERVAL);
    let mut eof_probe = [0u8; 1];
    let reason = loop {
        tokio::select! {
            _ = closed_check.tick() => {
                if lease.handle().is_closed() {
                    break "connection closed";
                }
            }
            // Stdin EOF is the client's `end()`.
            read = input.read(&mut eof_probe) => {
                if matches!(read, Ok(0) | Err(_)) {
                    break "ended";
                }
            }
            event = events.recv() => match event.map(parse) {
                None | Some(Some(Command::End)) => break "ended",
                Some(Some(Command::Ping { id, timeout_ms })) => {
                    let lease = Arc::clone(&lease);
                    let output = output.clone();
                    let timeout = timeout_ms.map(Duration::from_millis).unwrap_or(DEFAULT_PING_TIMEOUT);
                    service::spawn(async move {
                        let healthy = lease.check_alive(timeout).await;
                        let _ = output.write_event(&json!({"type": "pong", "id": id, "healthy": healthy}));
                    });
                }
                Some(Some(command)) => answer(&pending, command),
                Some(None) => {}
            },
        }
    };
    registry::remove(&token);
    let _ = output.write_event(&json!({"type": "closed", "reason": reason}));
    Ok(())
}
