//! 网络延迟探测长驻 sidecar（Phase 2）。
//!
//! 命令：`latency-serve`。仅执行 TCP 直连或代理隧道探测；
//! 调度、质量计算、SSH exec 回退继续由 JS 持有。
//!
//! 协议（NDJSON，schemaVersion: 1）：
//! - 输入 `probe`：`requestId`、`sessionId`、`generation`、`host`、`port`、
//!   `timeoutMs`、`proxyRevision`；
//! - 输入 `proxyUpdate`：`requestId`、`sessionId`、`proxyRevision`、
//!   `proxy`、`proxyRequired`；按会话更新，禁止一个全局代理覆盖所有连接；
//! - 输入 `cancel`：`requestId`、`targetRequestId`；幂等取消对应探测；
//! - 输出 `ready`：`schemaVersion`、能力列表、并发上限；
//! - 输出 `result`：原请求 ID；探测返回 `latencyMs`、`method`（tcp /
//!   proxy-tunnel）、`generation`、`proxyRevision`，控制请求返回确认；
//! - 输出 `error`：原请求 ID，`errorCode`、`errorKind`、`retryable`；
//!   取消以 `cancelled` 分类结束目标请求。
//!
//! 计时：单调时钟（`tokio::time::Instant`）从实际网络操作开始计时，
//! 覆盖 DNS、建连及代理握手；代理配置解析与 JS 排队耗时不算入 `latencyMs`。
//! 同时运行最多 4 次探测，超额返回 `busy`。

use crate::shared::network::{connect_tcp, connect_via_proxy, ProxyConfig};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::{timeout, Instant};
use tokio_util::sync::CancellationToken;

const LATENCY_SCHEMA_VERSION: u32 = 1;
const MAX_CONCURRENT_PROBES: usize = 4;
const DEFAULT_PROBE_TIMEOUT_MS: u64 = 5000;

#[derive(Debug, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
enum LatencyInput {
    Probe {
        request_id: String,
        session_id: String,
        #[serde(default)]
        generation: Option<u32>,
        host: String,
        port: u16,
        #[serde(default)]
        timeout_ms: Option<u64>,
        #[serde(default)]
        proxy_revision: Option<u64>,
    },
    ProxyUpdate {
        request_id: String,
        session_id: String,
        proxy_revision: u64,
        #[serde(default)]
        proxy: Option<ProxyConfig>,
        #[serde(default)]
        proxy_required: Option<bool>,
    },
    Cancel {
        request_id: String,
        #[serde(default)]
        target_request_id: Option<String>,
    },
}

#[derive(Clone)]
struct SessionProxyState {
    proxy_revision: u64,
    proxy: Option<ProxyConfig>,
    #[allow(dead_code)]
    proxy_required: bool,
}

struct LatencyState {
    sessions: HashMap<String, SessionProxyState>,
    probes: HashMap<String, (CancellationToken, String)>,
}

impl LatencyState {
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            probes: HashMap::new(),
        }
    }

    fn cancel_probe(&mut self, target_request_id: &str) -> bool {
        if let Some((token, _session_id)) = self.probes.remove(target_request_id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    /// 仅取消属于该会话的待执行/活动探测；禁止一个会话的代理变更影响其他会话。
    fn cancel_session_probes(&mut self, session_id: &str, _exclude_revision: Option<u64>) {
        let targets: Vec<String> = self
            .probes
            .iter()
            .filter(|(_, (_token, probe_session))| probe_session == session_id)
            .map(|(request_id, _)| request_id.clone())
            .collect();
        for request_id in targets {
            if let Some((token, _)) = self.probes.remove(&request_id) {
                token.cancel();
            }
        }
    }
}

fn emit(value: &Value) -> Result<(), String> {
    let line = serde_json::to_string(value)
        .map_err(|error| format!("failed to serialize latency output: {error}"))?;
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(line.as_bytes())
        .map_err(|error| format!("failed to write stdout: {error}"))?;
    stdout
        .write_all(b"\n")
        .map_err(|error| format!("failed to write stdout newline: {error}"))?;
    stdout
        .flush()
        .map_err(|error| format!("failed to flush stdout: {error}"))
}

fn emit_error(request_id: &str, error_code: &str, error_kind: &str, message: &str) {
    let _ = emit(&json!({
        "type": "error",
        "schemaVersion": LATENCY_SCHEMA_VERSION,
        "requestId": request_id,
        "errorCode": error_code,
        "errorKind": error_kind,
        "retryable": true,
        "error": message,
    }));
}

fn emit_result(value: Value) {
    let _ = emit(&value);
}

/// 单次探测：从实际网络操作开始计时，覆盖 DNS、建连及代理握手。
async fn run_probe(
    request_id: String,
    session_id: String,
    generation: Option<u32>,
    host: String,
    port: u16,
    timeout_ms: u64,
    proxy_revision: Option<u64>,
    proxy_state: Option<SessionProxyState>,
    token: CancellationToken,
) {
    let method = if proxy_state
        .as_ref()
        .and_then(|state| state.proxy.as_ref())
        .is_some()
    {
        "proxy-tunnel"
    } else {
        "tcp"
    };

    let start = Instant::now();
    let connect = async {
        match proxy_state.as_ref().and_then(|state| state.proxy.as_ref()) {
            Some(proxy) => connect_via_proxy(proxy, &host, port).await,
            None => connect_tcp(&host, port, "latency target").await,
        }
    };

    let result = tokio::select! {
        biased;
        _ = token.cancelled() => Err("cancelled".to_string()),
        outcome = timeout(std::time::Duration::from_millis(timeout_ms), connect) => match outcome {
            Ok(Ok(stream)) => Ok(stream),
            Ok(Err(message)) => Err(message),
            Err(_) => Err("latency probe timed out".to_string()),
        },
    };

    drop::<Option<TcpStream>>(None);
    let elapsed = start.elapsed().as_millis() as u64;

    match result {
        Ok(_socket) => {
            emit_result(json!({
                "type": "result",
                "schemaVersion": LATENCY_SCHEMA_VERSION,
                "requestId": request_id,
                "latencyMs": elapsed,
                "method": method,
                "sessionId": session_id,
                "generation": generation,
                "proxyRevision": proxy_state.as_ref().map(|state| state.proxy_revision).or(proxy_revision),
            }));
        }
        Err(message) if message == "cancelled" => {
            emit_result(json!({
                "type": "error",
                "schemaVersion": LATENCY_SCHEMA_VERSION,
                "requestId": request_id,
                "errorCode": "LATENCY_CANCELLED",
                "errorKind": "cancelled",
                "retryable": false,
                "error": "latency probe was cancelled",
                "sessionId": session_id,
            }));
        }
        Err(message) => {
            let (error_code, error_kind) = if message.contains("timed out") {
                ("LATENCY_TIMEOUT", "timeout")
            } else if message.contains("DNS") {
                ("LATENCY_DNS_FAILED", "network")
            } else if message.contains("authentication") {
                ("LATENCY_AUTH_FAILED", "proxy")
            } else if message.contains("unsupported proxy type") {
                ("LATENCY_UNSUPPORTED_PROXY", "unsupported")
            } else {
                ("LATENCY_CONNECT_FAILED", "network")
            };
            emit_result(json!({
                "type": "error",
                "schemaVersion": LATENCY_SCHEMA_VERSION,
                "requestId": request_id,
                "errorCode": error_code,
                "errorKind": error_kind,
                "retryable": true,
                "error": message,
                "sessionId": session_id,
            }));
        }
    }
}

pub async fn serve() -> Result<(), String> {
    emit(&json!({
        "type": "ready",
        "schemaVersion": LATENCY_SCHEMA_VERSION,
        "capabilities": ["tcp", "proxy-tunnel"],
        "maxConcurrentProbes": MAX_CONCURRENT_PROBES,
    }))?;

    let state = Arc::new(Mutex::new(LatencyState::new()));
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("failed to read stdin: {error}"))?
    {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let input: LatencyInput = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                emit_error(
                    "unknown",
                    "LATENCY_INVALID_REQUEST",
                    "validation",
                    &format!("failed to parse request: {error}"),
                );
                continue;
            }
        };

        match input {
            LatencyInput::Probe {
                request_id,
                session_id,
                generation,
                host,
                port,
                timeout_ms,
                proxy_revision,
            } => {
                let mut state_guard = state.lock().await;
                if state_guard.probes.len() >= MAX_CONCURRENT_PROBES {
                    drop(state_guard);
                    emit_error(
                        &request_id,
                        "LATENCY_BUSY",
                        "busy",
                        "too many concurrent latency probes",
                    );
                    continue;
                }
                let proxy_state = state_guard.sessions.get(&session_id).cloned();
                let token = CancellationToken::new();
                state_guard
                    .probes
                    .insert(request_id.clone(), (token.clone(), session_id.clone()));
                drop(state_guard);

                let state_for_task = Arc::clone(&state);
                tokio::spawn(async move {
                    run_probe(
                        request_id.clone(),
                        session_id,
                        generation,
                        host,
                        port,
                        timeout_ms.unwrap_or(DEFAULT_PROBE_TIMEOUT_MS),
                        proxy_revision,
                        proxy_state,
                        token,
                    )
                    .await;
                    // 探测结束（完成、失败或取消）即从请求表移除，避免占用并发额度
                    state_for_task.lock().await.probes.remove(&request_id);
                });
            }
            LatencyInput::ProxyUpdate {
                request_id,
                session_id,
                proxy_revision,
                proxy,
                proxy_required,
            } => {
                let mut state_guard = state.lock().await;
                let previous_revision = state_guard
                    .sessions
                    .get(&session_id)
                    .map(|current| current.proxy_revision);
                state_guard.sessions.insert(
                    session_id.clone(),
                    SessionProxyState {
                        proxy_revision,
                        proxy,
                        proxy_required: proxy_required.unwrap_or(false),
                    },
                );
                // 确认后新请求使用新 revision；取消旧 revision 的待执行/活动探测
                if previous_revision
                    .map(|value| value != proxy_revision)
                    .unwrap_or(true)
                {
                    state_guard.cancel_session_probes(&session_id, Some(proxy_revision));
                }
                drop(state_guard);
                emit_result(json!({
                    "type": "result",
                    "schemaVersion": LATENCY_SCHEMA_VERSION,
                    "requestId": request_id,
                    "sessionId": session_id,
                    "proxyRevision": proxy_revision,
                    "acknowledged": true,
                }));
            }
            LatencyInput::Cancel {
                request_id,
                target_request_id,
            } => {
                let mut state_guard = state.lock().await;
                // 重复、未知取消返回幂等确认，目标请求不重复完成
                let target_existed = target_request_id
                    .as_deref()
                    .map(|target| state_guard.cancel_probe(target))
                    .unwrap_or(false);
                drop(state_guard);
                emit_result(json!({
                    "type": "result",
                    "schemaVersion": LATENCY_SCHEMA_VERSION,
                    "requestId": request_id,
                    "targetRequestId": target_request_id,
                    "acknowledged": true,
                    "cancelledExisting": target_existed,
                }));
            }
        }
    }

    // stdin EOF：取消任务、关闭资源
    let mut state_guard = state.lock().await;
    let request_ids: Vec<String> = state_guard.probes.keys().cloned().collect();
    for request_id in request_ids {
        state_guard.cancel_probe(&request_id);
    }
    Ok(())
}
