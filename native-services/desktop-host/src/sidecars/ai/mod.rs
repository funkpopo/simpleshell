use futures_util::StreamExt;
use reqwest::{Client, Proxy};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, RwLock};
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;

const SCHEMA_VERSION: u32 = 1;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
const STREAM_CONNECT_TIMEOUT: Duration = Duration::from_secs(60);
const STREAM_IDLE_TIMEOUT: Duration = Duration::from_secs(180);
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_ACTIVE_REQUESTS: usize = 16;
const MAX_ACTIVE_STREAMS: usize = 10;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Command {
    schema_version: Option<u32>,
    kind: String,
    request_id: Option<String>,
    session_id: Option<String>,
    payload: Option<RequestPayload>,
    proxy: Option<ProxyConfig>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestPayload {
    url: String,
    api_key: String,
    model: Option<String>,
    messages: Option<Vec<Message>>,
    provider: Option<String>,
    is_stream: Option<bool>,
    #[serde(rename = "type")]
    request_type: Option<String>,
    session_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct Message {
    role: String,
    content: String,
}

#[derive(Debug, Clone, Deserialize)]
struct ProxyConfig {
    #[serde(rename = "type")]
    proxy_type: Option<String>,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Event<'a> {
    schema_version: u32,
    kind: &'a str,
    request_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<AiError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiError {
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status_code: Option<u16>,
}

type Writer = Arc<Mutex<tokio::io::Stdout>>;
#[derive(Clone)]
struct ActiveRequest {
    cancel: CancellationToken,
    session_id: Option<String>,
    is_stream: bool,
}

type Requests = Arc<Mutex<HashMap<String, ActiveRequest>>>;

pub async fn serve() -> Result<(), String> {
    let stdout = Arc::new(Mutex::new(tokio::io::stdout()));
    let proxy = Arc::new(RwLock::new(None));
    let requests: Requests = Arc::new(Mutex::new(HashMap::new()));
    emit(
        &stdout,
        Event {
            schema_version: SCHEMA_VERSION,
            kind: "ready",
            request_id: None,
            session_id: None,
            result: Some(json!({"status":"ready"})),
            chunk: None,
            error: None,
        },
    )
    .await?;
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
        if line.len() > MAX_LINE_BYTES {
            emit_error(
                &stdout,
                None,
                None,
                "AI sidecar command exceeds maximum message size",
                None,
            )
            .await?;
            continue;
        }
        let command: Command = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                emit_error(&stdout, None, None, "Invalid AI sidecar command", None).await?;
                continue;
            }
        };
        if command.schema_version.unwrap_or(SCHEMA_VERSION) != SCHEMA_VERSION {
            emit_error(
                &stdout,
                command.request_id.as_deref(),
                command.session_id.as_deref(),
                "Unsupported AI sidecar schema version",
                None,
            )
            .await?;
            continue;
        }
        match command.kind.as_str() {
            "health" => {
                emit(
                    &stdout,
                    Event {
                        schema_version: SCHEMA_VERSION,
                        kind: "result",
                        request_id: command.request_id.as_deref(),
                        session_id: None,
                        result: Some(json!({"status":"healthy"})),
                        chunk: None,
                        error: None,
                    },
                )
                .await?
            }
            "proxyUpdate" => {
                *proxy.write().await = command.proxy;
                emit(
                    &stdout,
                    Event {
                        schema_version: SCHEMA_VERSION,
                        kind: "result",
                        request_id: command.request_id.as_deref(),
                        session_id: None,
                        result: Some(json!({"success":true})),
                        chunk: None,
                        error: None,
                    },
                )
                .await?;
            }
            "cancel" => {
                let session = command.session_id.as_deref();
                let mut matched = false;
                for (id, request) in requests.lock().await.iter() {
                    if command.request_id.as_deref() == Some(id)
                        || session == request.session_id.as_deref()
                    {
                        request.cancel.cancel();
                        matched = true;
                    }
                }
                emit(
                    &stdout,
                    Event {
                        schema_version: SCHEMA_VERSION,
                        kind: "result",
                        request_id: command.request_id.as_deref(),
                        session_id: session,
                        result: Some(json!({"cancelled":matched})),
                        chunk: None,
                        error: None,
                    },
                )
                .await?;
            }
            "request" => {
                let request_id = match command.request_id {
                    Some(value) if !value.is_empty() => value,
                    _ => {
                        emit_error(
                            &stdout,
                            None,
                            command.session_id.as_deref(),
                            "AI requestId is required",
                            None,
                        )
                        .await?;
                        continue;
                    }
                };
                let payload = match command.payload {
                    Some(value) => value,
                    None => {
                        emit_error(
                            &stdout,
                            Some(&request_id),
                            command.session_id.as_deref(),
                            "AI request payload is required",
                            None,
                        )
                        .await?;
                        continue;
                    }
                };
                let is_stream = payload.is_stream.unwrap_or(false);
                let session_id = payload.session_id.clone();
                let mut active = requests.lock().await;
                if active.contains_key(&request_id) {
                    emit_error(
                        &stdout,
                        Some(&request_id),
                        session_id.as_deref(),
                        "AI requestId is already active",
                        None,
                    )
                    .await?;
                    continue;
                }
                if active.len() >= MAX_ACTIVE_REQUESTS {
                    emit_error(
                        &stdout,
                        Some(&request_id),
                        session_id.as_deref(),
                        "AI sidecar is overloaded: too many active requests",
                        None,
                    )
                    .await?;
                    continue;
                }
                if is_stream {
                    let active_streams = active.values().filter(|item| item.is_stream).count();
                    if active_streams >= MAX_ACTIVE_STREAMS {
                        emit_error(
                            &stdout,
                            Some(&request_id),
                            session_id.as_deref(),
                            "AI sidecar is overloaded: too many active streams",
                            None,
                        )
                        .await?;
                        continue;
                    }
                    if session_id.is_some()
                        && active.values().any(|item| item.session_id == session_id)
                    {
                        emit_error(
                            &stdout,
                            Some(&request_id),
                            session_id.as_deref(),
                            "AI session already has an active request",
                            None,
                        )
                        .await?;
                        continue;
                    }
                }
                let token = CancellationToken::new();
                active.insert(
                    request_id.clone(),
                    ActiveRequest {
                        cancel: token.clone(),
                        session_id,
                        is_stream,
                    },
                );
                drop(active);
                let state = (stdout.clone(), proxy.clone(), requests.clone());
                tokio::spawn(async move {
                    execute(request_id, payload, token, state).await;
                });
            }
            _ => {
                emit_error(
                    &stdout,
                    command.request_id.as_deref(),
                    command.session_id.as_deref(),
                    "Unsupported AI sidecar command",
                    None,
                )
                .await?
            }
        }
    }
    Ok(())
}

async fn execute(
    request_id: String,
    payload: RequestPayload,
    token: CancellationToken,
    state: (Writer, Arc<RwLock<Option<ProxyConfig>>>, Requests),
) {
    let (writer, proxy, requests) = state;
    let session_id = payload.session_id.clone();
    let response = run_request(
        &request_id,
        &payload,
        token.clone(),
        proxy.read().await.clone(),
        &writer,
    )
    .await;
    if let Err((message, status)) = response {
        let _ = emit_error(
            &writer,
            Some(&request_id),
            session_id.as_deref(),
            &message,
            status,
        )
        .await;
    }
    requests.lock().await.remove(&request_id);
}

async fn run_request(
    request_id: &str,
    payload: &RequestPayload,
    cancel: CancellationToken,
    proxy: Option<ProxyConfig>,
    writer: &Writer,
) -> Result<(), (String, Option<u16>)> {
    let client = client_for(proxy)?;
    let provider = payload
        .provider
        .as_deref()
        .unwrap_or("openai")
        .to_ascii_lowercase();
    if payload.request_type.as_deref() == Some("models") {
        let result = models(&client, payload, &provider).await?;
        return emit(
            writer,
            Event {
                schema_version: SCHEMA_VERSION,
                kind: "result",
                request_id: Some(request_id),
                session_id: None,
                result: Some(result),
                chunk: None,
                error: None,
            },
        )
        .await
        .map_err(|e| (e, None));
    }
    let stream = payload.is_stream.unwrap_or(false);
    let (url, body, headers) = chat_request(payload, &provider, stream)?;
    let request = client.post(url).headers(headers).json(&body);
    let response = tokio::select! { _ = cancel.cancelled() => return stream_end(writer, request_id, payload.session_id.as_deref(), true).await, value = timeout(if stream { STREAM_CONNECT_TIMEOUT } else { REQUEST_TIMEOUT }, request.send()) => value.map_err(|_| ("AI request timed out".to_string(), None))?.map_err(network_error)? };
    if !response.status().is_success() {
        return Err(api_error(response).await);
    }
    if !stream {
        let data: Value = response.json().await.map_err(network_error)?;
        let result = parse_standard(&provider, data)?;
        return emit(
            writer,
            Event {
                schema_version: SCHEMA_VERSION,
                kind: "result",
                request_id: Some(request_id),
                session_id: None,
                result: Some(result),
                chunk: None,
                error: None,
            },
        )
        .await
        .map_err(|e| (e, None));
    }
    parse_stream(
        response,
        &provider,
        request_id,
        payload.session_id.as_deref(),
        cancel,
        writer,
    )
    .await
}

fn client_for(proxy: Option<ProxyConfig>) -> Result<Client, (String, Option<u16>)> {
    let mut builder = Client::builder()
        .connect_timeout(STREAM_CONNECT_TIMEOUT)
        .pool_max_idle_per_host(16)
        .tcp_keepalive(Duration::from_secs(60));
    if let Some(config) = proxy {
        let scheme = match config
            .proxy_type
            .as_deref()
            .unwrap_or("http")
            .to_ascii_lowercase()
            .as_str()
        {
            "socks4" => "socks4",
            "socks5" => "socks5",
            _ => "http",
        };
        let auth = match (config.username, config.password) {
            (Some(user), Some(pass)) => format!("{}:{}@", url_escape(&user), url_escape(&pass)),
            _ => String::new(),
        };
        builder = builder.proxy(
            Proxy::all(format!("{scheme}://{auth}{}:{}", config.host, config.port))
                .map_err(|e| (format!("Invalid proxy configuration: {e}"), None))?,
        );
    }
    builder
        .build()
        .map_err(|e| (format!("Failed to create AI HTTP client: {e}"), None))
}
fn url_escape(value: &str) -> String {
    value
        .replace('%', "%25")
        .replace(':', "%3A")
        .replace('@', "%40")
}

fn chat_request(
    payload: &RequestPayload,
    provider: &str,
    stream: bool,
) -> Result<(String, Value, reqwest::header::HeaderMap), (String, Option<u16>)> {
    let model = payload
        .model
        .as_deref()
        .ok_or_else(|| ("AI model is required".to_string(), None))?;
    let messages = payload
        .messages
        .as_ref()
        .ok_or_else(|| ("AI messages are required".to_string(), None))?;
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    match provider {
        "anthropic" => {
            headers.insert(
                "x-api-key",
                payload
                    .api_key
                    .parse()
                    .map_err(|_| ("Invalid API key".to_string(), None))?,
            );
            headers.insert("anthropic-version", "2023-06-01".parse().unwrap());
            let system = messages
                .iter()
                .find(|item| item.role == "system")
                .map(|item| item.content.clone());
            let converted: Vec<Value> = messages.iter().filter(|item| item.role != "system").map(|item| json!({"role":if item.role == "assistant" {"assistant"} else {"user"},"content":item.content})).collect();
            let mut body = json!({"model":model,"messages":converted,"max_tokens":4096});
            if let Some(system) = system {
                body["system"] = json!(system);
            }
            if stream {
                body["stream"] = json!(true);
            }
            Ok((
                if payload.url.contains("/messages") {
                    payload.url.clone()
                } else {
                    format!("{}/v1/messages", payload.url.trim_end_matches('/'))
                },
                body,
                headers,
            ))
        }
        "gemini" => {
            let base = payload.url.trim_end_matches('/');
            let operation = if stream {
                "streamGenerateContent"
            } else {
                "generateContent"
            };
            let url = if base.contains("/models/") {
                format!(
                    "{}:{}?key={}",
                    base.split(':').next().unwrap_or(base),
                    operation,
                    payload.api_key
                )
            } else {
                format!(
                    "{base}/v1beta/models/{model}:{operation}?key={}",
                    payload.api_key
                )
            };
            let system = messages
                .iter()
                .find(|item| item.role == "system")
                .map(|item| json!({"parts":[{"text":item.content}]}));
            let contents: Vec<Value> = messages.iter().filter(|item| item.role != "system").map(|item| json!({"role":if item.role == "assistant" {"model"} else {"user"},"parts":[{"text":item.content}]})).collect();
            let mut body = json!({"contents":contents});
            if let Some(system) = system {
                body["systemInstruction"] = system;
            }
            Ok((url, body, headers))
        }
        _ => {
            headers.insert(
                "authorization",
                format!("Bearer {}", payload.api_key)
                    .parse()
                    .map_err(|_| ("Invalid API key".to_string(), None))?,
            );
            let mut body = json!({"model":model,"messages":messages});
            if stream {
                body["stream"] = json!(true);
            }
            let url = if payload.url.contains("/chat/completions") {
                payload.url.clone()
            } else {
                format!("{}/chat/completions", payload.url.trim_end_matches('/'))
            };
            Ok((url, body, headers))
        }
    }
}

async fn models(
    client: &Client,
    payload: &RequestPayload,
    provider: &str,
) -> Result<Value, (String, Option<u16>)> {
    if provider == "anthropic" {
        return Ok(
            json!({"success":true,"models":["claude-3-5-sonnet-20241022","claude-3-5-haiku-20241022","claude-3-opus-20240229","claude-3-sonnet-20240229","claude-3-haiku-20240307"]}),
        );
    }
    let (url, _, headers) = if provider == "gemini" {
        let base = payload.url.trim_end_matches('/');
        (
            format!("{base}/v1beta/models?key={}", payload.api_key),
            Value::Null,
            reqwest::header::HeaderMap::new(),
        )
    } else {
        let mut h = reqwest::header::HeaderMap::new();
        h.insert(
            "authorization",
            format!("Bearer {}", payload.api_key)
                .parse()
                .map_err(|_| ("Invalid API key".to_string(), None))?,
        );
        let base = payload
            .url
            .split("/chat/completions")
            .next()
            .unwrap_or(&payload.url)
            .trim_end_matches('/');
        (format!("{base}/models"), Value::Null, h)
    };
    let response = timeout(REQUEST_TIMEOUT, client.get(url).headers(headers).send())
        .await
        .map_err(|_| ("Models request timed out".to_string(), None))?
        .map_err(network_error)?;
    if !response.status().is_success() {
        return Err(api_error(response).await);
    }
    let value: Value = response.json().await.map_err(network_error)?;
    let models = if provider == "gemini" {
        value["models"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter(|m| {
                        m["supportedGenerationMethods"]
                            .as_array()
                            .is_some_and(|v| v.iter().any(|x| x == "generateContent"))
                    })
                    .filter_map(|m| {
                        m["name"]
                            .as_str()
                            .map(|v| v.trim_start_matches("models/").to_string())
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    } else {
        value["data"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|m| m["id"].as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    Ok(json!({"success":true,"models":models}))
}

fn parse_standard(provider: &str, data: Value) -> Result<Value, (String, Option<u16>)> {
    match provider {
        "anthropic" => {
            let text = data["content"]
                .as_array()
                .and_then(|v| v.iter().find(|x| x["type"] == "text"))
                .and_then(|v| v["text"].as_str())
                .ok_or_else(|| ("Failed to parse Anthropic response".to_string(), None))?;
            Ok(
                json!({"success":true,"choices":[{"message":{"role":"assistant","content":text}}],"usage":{"prompt_tokens":data["usage"]["input_tokens"],"completion_tokens":data["usage"]["output_tokens"]}}),
            )
        }
        "gemini" => {
            let text = data["candidates"][0]["content"]["parts"]
                .as_array()
                .and_then(|v| v.iter().find_map(|p| p["text"].as_str()))
                .ok_or_else(|| ("Failed to parse Gemini response".to_string(), None))?;
            Ok(
                json!({"success":true,"choices":[{"message":{"role":"assistant","content":text}}],"usage":{"prompt_tokens":data["usageMetadata"]["promptTokenCount"],"completion_tokens":data["usageMetadata"]["candidatesTokenCount"],"total_tokens":data["usageMetadata"]["totalTokenCount"]}}),
            )
        }
        _ => {
            if data["choices"][0]["message"].is_object() {
                Ok(json!({"success":true,"choices":data["choices"],"usage":data["usage"]}))
            } else {
                Err((
                    "Failed to parse OpenAI-compatible response".to_string(),
                    None,
                ))
            }
        }
    }
}

async fn parse_stream(
    response: reqwest::Response,
    provider: &str,
    request_id: &str,
    session: Option<&str>,
    cancel: CancellationToken,
    writer: &Writer,
) -> Result<(), (String, Option<u16>)> {
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    loop {
        let chunk = tokio::select! { _ = cancel.cancelled() => return stream_end(writer, request_id, session, true).await, value = timeout(STREAM_IDLE_TIMEOUT, stream.next()) => value.map_err(|_| ("AI stream idle timeout".to_string(), None))? };
        match chunk {
            Some(Ok(bytes)) => {
                buffer.push_str(&String::from_utf8_lossy(&bytes));
                while let Some(index) = buffer.find('\n') {
                    let line = buffer[..index].trim().to_string();
                    buffer.drain(..=index);
                    if let Some(text) = parse_stream_line(provider, &line)? {
                        emit(
                            writer,
                            Event {
                                schema_version: SCHEMA_VERSION,
                                kind: "streamChunk",
                                request_id: Some(request_id),
                                session_id: session,
                                result: None,
                                chunk: Some(&text),
                                error: None,
                            },
                        )
                        .await
                        .map_err(|e| (e, None))?;
                    }
                }
            }
            Some(Err(error)) => return Err(network_error(error)),
            None => return stream_end(writer, request_id, session, false).await,
        }
    }
}
fn parse_stream_line(provider: &str, line: &str) -> Result<Option<String>, (String, Option<u16>)> {
    if line.is_empty() || line.starts_with("event:") {
        return Ok(None);
    }
    let raw = line.strip_prefix("data:").unwrap_or(line).trim();
    if raw == "[DONE]" {
        return Ok(None);
    }
    let value: Value =
        match serde_json::from_str(raw.trim_matches(|c| c == ',' || c == '[' || c == ']')) {
            Ok(value) => value,
            Err(_) => return Ok(None),
        };
    let text = match provider {
        "anthropic" => value["delta"]["text"].as_str(),
        "gemini" => value["candidates"][0]["content"]["parts"]
            .as_array()
            .and_then(|v| v.iter().find_map(|p| p["text"].as_str())),
        _ => value["choices"][0]["delta"]["content"].as_str(),
    };
    Ok(text.map(str::to_string))
}
async fn stream_end(
    writer: &Writer,
    request_id: &str,
    session: Option<&str>,
    aborted: bool,
) -> Result<(), (String, Option<u16>)> {
    emit(
        writer,
        Event {
            schema_version: SCHEMA_VERSION,
            kind: "streamEnd",
            request_id: Some(request_id),
            session_id: session,
            result: Some(json!({"aborted":aborted})),
            chunk: None,
            error: None,
        },
    )
    .await
    .map_err(|e| (e, None))
}
async fn api_error(response: reqwest::Response) -> (String, Option<u16>) {
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    (
        body["error"]["message"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| format!("AI API request failed: {status}")),
        Some(status.as_u16()),
    )
}
fn network_error(error: reqwest::Error) -> (String, Option<u16>) {
    (
        format!("AI network request failed: {error}"),
        error.status().map(|status| status.as_u16()),
    )
}
async fn emit(writer: &Writer, event: Event<'_>) -> Result<(), String> {
    let encoded = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    let mut output = writer.lock().await;
    output
        .write_all(encoded.as_bytes())
        .await
        .map_err(|e| e.to_string())?;
    output.write_all(b"\n").await.map_err(|e| e.to_string())?;
    output.flush().await.map_err(|e| e.to_string())
}
async fn emit_error(
    writer: &Writer,
    request_id: Option<&str>,
    session: Option<&str>,
    message: &str,
    status: Option<u16>,
) -> Result<(), String> {
    emit(
        writer,
        Event {
            schema_version: SCHEMA_VERSION,
            kind: "error",
            request_id,
            session_id: session,
            result: None,
            chunk: None,
            error: Some(AiError {
                message: message.to_string(),
                status_code: status,
            }),
        },
    )
    .await
}
