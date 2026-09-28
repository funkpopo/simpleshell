//! Native SSH forwarding ownership and bounded control protocol.
mod auth;
mod session;
mod socks;

use crate::shared::network::ProxyConfig;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

const MAX_LINE: usize = 256 * 1024;
const MAX_SESSIONS: usize = 4;
const MAX_IDENTITIES: usize = 4096;
pub(super) const MAX_STREAMS: usize = 32;
pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub(super) type Output = mpsc::Sender<Value>;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Rule {
    id: String,
    #[serde(rename = "type")]
    mode: String,
    listen_host: String,
    listen_port: u16,
    target_host: Option<String>,
    target_port: Option<u16>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SshConfig {
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    passphrase: Option<String>,
    expected_host_fingerprint: String,
    proxy: Option<ProxyConfig>,
    #[serde(default)]
    proxy_required: bool,
    agent_path: Option<String>,
    #[serde(default)]
    keyboard_interactive: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Request {
    schema_version: u32,
    kind: String,
    request_id: String,
    session_id: String,
    generation: u64,
    ssh: Option<SshConfig>,
    #[serde(default)]
    rules: Vec<Rule>,
    rule_id: Option<String>,
    challenge_id: Option<u32>,
    answers: Option<Vec<String>>,
}

impl Request {
    fn message(&self, kind: &str) -> Value {
        json!({"schemaVersion":1, "kind":kind, "requestId":self.request_id,
            "sessionId":self.session_id, "generation":self.generation})
    }

    async fn error(&self, out: &Output, code: &str) {
        let mut msg = self.message("error");
        msg["errorCode"] = json!(code);
        msg["retryable"] = json!(matches!(code, "CONNECT_FAILED" | "DISCONNECTED"));
        let _ = out.send(msg).await;
    }

    fn valid(&self) -> bool {
        self.schema_version == 1
            && valid_id(&self.request_id)
            && valid_id(&self.session_id)
            && self.generation > 0
            && self.generation <= 9_007_199_254_740_991
    }

    fn valid_rules(&self, prototype: bool) -> bool {
        let mut ids = HashSet::new();
        !self.rules.is_empty()
            && self.rules.len() <= 100
            && self.rules.iter().all(|r| {
                valid_id(&r.id)
                    && ids.insert(&r.id)
                    && !r.listen_host.is_empty()
                    && r.listen_host.len() <= 253
                    && !r.listen_host.chars().any(char::is_control)
                    && (!prototype || matches!(r.listen_host.as_str(), "127.0.0.1" | "::1"))
                    && matches!(r.mode.as_str(), "local" | "remote" | "dynamic")
                    && (r.mode == "dynamic"
                        || (r.target_port.is_some_and(|p| p > 0)
                            && r.target_host
                                .as_ref()
                                .is_some_and(|s| !s.is_empty() && s.len() <= 253)))
            })
    }

    fn valid_start(&self, prototype: bool) -> bool {
        let Some(ssh) = &self.ssh else { return false };
        let fingerprint = ssh.expected_host_fingerprint.strip_prefix("SHA256:");
        !ssh.host.is_empty()
            && ssh.host.len() <= 253
            && ssh.port > 0
            && !ssh.username.is_empty()
            && (ssh.password.is_some()
                || ssh.private_key.is_some()
                || ssh.agent_path.is_some()
                || ssh.keyboard_interactive)
            && fingerprint
                .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
            && (!ssh.proxy_required || ssh.proxy.is_some())
            && self.valid_rules(prototype)
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}

struct Running {
    generation: u64,
    cancel: CancellationToken,
    task: JoinHandle<()>,
    commands: mpsc::Sender<Request>,
    auth: mpsc::Sender<(u32, Vec<String>)>,
}

impl Running {
    async fn stop(self) {
        self.cancel.cancel();
        // Session cleanup is itself bounded, including remote unbind and SSH disconnect.
        let _ = self.task.await;
    }
}

async fn read_line(reader: &mut BufReader<tokio::io::Stdin>) -> Result<Option<Vec<u8>>, String> {
    let mut line = Vec::new();
    loop {
        let buf = reader.fill_buf().await.map_err(|_| "STDIN_FAILED")?;
        if buf.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err("TRUNCATED_INPUT".into())
            };
        }
        let count = buf
            .iter()
            .position(|b| *b == b'\n')
            .map_or(buf.len(), |n| n + 1);
        if line.len() + count > MAX_LINE {
            return Err("INPUT_LIMIT".into());
        }
        line.extend_from_slice(&buf[..count]);
        reader.consume(count);
        if line.last() == Some(&b'\n') {
            return Ok(Some(line));
        }
    }
}

pub async fn serve(prototype: bool) -> Result<(), String> {
    let max_sessions = if prototype { MAX_SESSIONS } else { 32 };
    let (out, mut messages) = mpsc::channel::<Value>(64);
    let mut writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(message) = messages.recv().await {
            let mut bytes = serde_json::to_vec(&message).map_err(|_| "OUTPUT_FAILED")?;
            bytes.push(b'\n');
            // A parent that stops reading must not keep forwarding resources alive forever.
            tokio::time::timeout(Duration::from_secs(2), async {
                stdout.write_all(&bytes).await?;
                stdout.flush().await
            })
            .await
            .map_err(|_| "OUTPUT_TIMEOUT")?
            .map_err(|_| "OUTPUT_FAILED")?;
        }
        Ok::<(), &str>(())
    });
    let _ = out
        .send(json!({"schemaVersion":1,"kind":"ready","prototype":prototype,
        "capabilities":["local","remote","socks5","closeSession","generation","addRules","removeRule","keyboardInteractive","agent","connections"],
        "maxSessions":max_sessions,"maxStreamsPerSession":MAX_STREAMS,"maxInputBytes":MAX_LINE}))
        .await;
    let mut reader = BufReader::new(tokio::io::stdin());
    let mut running: HashMap<String, Running> = HashMap::new();
    // Tombstones survive close: a late start cannot resurrect a closed tab generation.
    let mut generations: HashMap<String, u64> = HashMap::new();
    let mut writer_joined = false;
    let result = loop {
        let line = tokio::select! {
            _ = &mut writer => {
                writer_joined = true;
                break Err("OUTPUT_CLOSED".into());
            },
            line = read_line(&mut reader) => line,
        };
        let bytes = match line {
            Ok(Some(bytes)) => bytes,
            Ok(None) => break Ok(()),
            Err(e) => break Err(e),
        };
        let request: Request = match serde_json::from_slice(&bytes) {
            Ok(r) => r,
            Err(_) => break Err("INVALID_PROTOCOL".into()),
        };
        if !request.valid() {
            request.error(&out, "INVALID_REQUEST").await;
            continue;
        }
        let latest = generations.get(&request.session_id).copied().unwrap_or(0);
        if request.kind == "closeSession" {
            if request.generation < latest {
                request.error(&out, "STALE_GENERATION").await;
                continue;
            }
            if latest == 0 && generations.len() >= MAX_IDENTITIES {
                request.error(&out, "IDENTITY_LIMIT").await;
                continue;
            }
            generations.insert(request.session_id.clone(), request.generation);
            if let Some(session) = running.remove(&request.session_id) {
                session.stop().await;
            }
            let _ = out.send(request.message("result")).await;
        } else if request.kind == "start" {
            if request.generation <= latest {
                request.error(&out, "STALE_GENERATION").await;
                continue;
            }
            if !request.valid_start(prototype) {
                request.error(&out, "INVALID_CONFIG").await;
                continue;
            }
            running.retain(|_, value| !value.task.is_finished());
            if (latest == 0 && generations.len() >= MAX_IDENTITIES)
                || (!running.contains_key(&request.session_id) && running.len() >= max_sessions)
            {
                request.error(&out, "BUSY").await;
                continue;
            }
            if let Some(session) = running.remove(&request.session_id) {
                session.stop().await;
            }
            generations.insert(request.session_id.clone(), request.generation);
            let cancel = CancellationToken::new();
            let session_id = request.session_id.clone();
            let generation = request.generation;
            let (commands, receiver) = mpsc::channel(16);
            let (auth, auth_receiver) = mpsc::channel(1);
            let task = tokio::spawn(session::run(
                request,
                out.clone(),
                cancel.clone(),
                receiver,
                auth_receiver,
            ));
            running.insert(
                session_id,
                Running {
                    generation,
                    cancel,
                    task,
                    commands,
                    auth,
                },
            );
        } else if matches!(
            request.kind.as_str(),
            "addRules" | "removeRule" | "authResponse"
        ) {
            let Some(session) = running
                .get(&request.session_id)
                .filter(|s| s.generation == request.generation && !s.task.is_finished())
            else {
                request.error(&out, "STALE_GENERATION").await;
                continue;
            };
            if request.kind == "authResponse" {
                if let (Some(id), Some(answers)) = (request.challenge_id, request.answers.as_ref())
                {
                    if answers.len() <= 32
                        && answers.iter().all(|s| s.len() <= 8192)
                        && session.auth.try_send((id, answers.clone())).is_ok()
                    {
                        let _ = out.send(request.message("result")).await;
                        continue;
                    }
                }
                request.error(&out, "INVALID_REQUEST").await;
            } else if (request.kind == "addRules" && !request.valid_rules(prototype))
                || (request.kind == "removeRule"
                    && !request.rule_id.as_deref().is_some_and(valid_id))
            {
                request.error(&out, "INVALID_REQUEST").await;
            } else if let Err(error) = session.commands.try_send(request) {
                error.into_inner().error(&out, "BUSY").await;
            }
        } else {
            request.error(&out, "UNSUPPORTED_REQUEST").await;
        }
    };
    for session in running.values() {
        session.cancel.cancel();
    }
    for (_, session) in running {
        session.stop().await;
    }
    drop(out);
    if !writer_joined && !matches!(writer.await, Ok(Ok(()))) && result.is_ok() {
        return Err("OUTPUT_CLOSED".into());
    }
    result
}
