use crate::errors::*;
use core_protocol::service;
use netutil::{NetworkPath, ProxyConfig};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) const SIDECAR_SCHEMA_VERSION: u32 = 1;

pub(crate) const SIDECAR_PROCESS_TYPE: &str = "native-sidecar";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SshConnectionConfig {
    pub(crate) host: String,
    pub(crate) port: Option<u16>,
    pub(crate) username: String,
    pub(crate) password: Option<String>,
    pub(crate) private_key: Option<String>,
    pub(crate) passphrase: Option<String>,
    pub(crate) expected_host_fingerprint: Option<String>,
    pub(crate) proxy: Option<ProxyConfig>,
    pub(crate) proxy_required: Option<bool>,
    pub(crate) network_path: Option<NetworkPath>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SftpEnvelope {
    pub(crate) schema_version: Option<u32>,
    pub(crate) config: SshConnectionConfig,
    pub(crate) request: SftpRequest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SftpRequest {
    pub(crate) schema_version: Option<u32>,
    pub(crate) request_id: Option<String>,
    pub(crate) operation: String,
    pub(crate) algorithm: Option<String>,
    pub(crate) path: Option<String>,
    pub(crate) paths: Option<Vec<String>>,
    pub(crate) local_path: Option<String>,
    pub(crate) source_path: Option<String>,
    pub(crate) target_path: Option<String>,
    pub(crate) content_base64: Option<String>,
    pub(crate) permissions: Option<String>,
    pub(crate) owner: Option<String>,
    pub(crate) group: Option<String>,
    pub(crate) is_directory: Option<bool>,
    pub(crate) segment_offset: Option<u64>,
    pub(crate) segment_length: Option<u64>,
    pub(crate) remote_write_flags: Option<String>,
    pub(crate) local_write_flags: Option<String>,
    pub(crate) ensure_parent_directories: Option<bool>,
    pub(crate) watch_interval_ms: Option<u64>,
    pub(crate) stream_list: Option<bool>,
    pub(crate) max_entries: Option<usize>,
    pub(crate) max_depth: Option<usize>,
    pub(crate) max_bytes: Option<u64>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub(crate) enum SftpOperation {
    #[serde(rename = "statFile")]
    StatFile,
    #[serde(rename = "checksumFile")]
    ChecksumFile,
    #[serde(rename = "listFiles")]
    ListFiles,
    #[serde(rename = "scanRemoteFolderTree")]
    ScanRemoteFolderTree,
    #[serde(rename = "copyFile")]
    CopyFile,
    #[serde(rename = "moveFile")]
    MoveFile,
    #[serde(rename = "renameFile")]
    RenameFile,
    #[serde(rename = "deleteFile")]
    DeleteFile,
    #[serde(rename = "createFolder")]
    CreateFolder,
    #[serde(rename = "createRemoteFolders")]
    CreateRemoteFolders,
    #[serde(rename = "createFile")]
    CreateFile,
    #[serde(rename = "getFilePermissions")]
    GetFilePermissions,
    #[serde(rename = "getFilePermissionsBatch")]
    GetFilePermissionsBatch,
    #[serde(rename = "getAbsolutePath")]
    GetAbsolutePath,
    #[serde(rename = "readFileContent")]
    ReadFileContent,
    #[serde(rename = "readFileAsBase64")]
    ReadFileAsBase64,
    #[serde(rename = "saveFileContent")]
    SaveFileContent,
    #[serde(rename = "uploadFileToRemote")]
    UploadFileToRemote,
    #[serde(rename = "downloadFileToLocal")]
    DownloadFileToLocal,
    #[serde(rename = "setFilePermissions")]
    SetFilePermissions,
    #[serde(rename = "setFileOwnership")]
    SetFileOwnership,
    #[serde(rename = "watchDirectory")]
    WatchDirectory,
}

impl SftpOperation {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        serde_json::from_value(json!(value))
            .map_err(|_| format!("unsupported native SFTP operation: {value}"))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteFileEntry {
    pub(crate) name: String,
    pub(crate) is_directory: bool,
    pub(crate) r#type: String,
    pub(crate) size: u64,
    pub(crate) modify_time: u64,
    pub(crate) access_time: u64,
    pub(crate) mode: u32,
    pub(crate) uid: u32,
    pub(crate) gid: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteFileStat {
    pub(crate) size: u64,
    pub(crate) mode: u32,
    pub(crate) uid: u32,
    pub(crate) gid: u32,
    pub(crate) permissions: String,
    pub(crate) modify_time: u64,
    pub(crate) access_time: u64,
    pub(crate) is_directory: bool,
}

/// One protocol line on the current stream (stdout when run standalone).
pub(crate) fn emit_stdout_line(line: String) -> Result<(), String> {
    service::emit_line(line)
}

pub(crate) fn emit_stage(
    request_id: Option<&str>,
    stage: &str,
    elapsed_ms: u64,
) -> Result<(), String> {
    emit_stdout_line(
        serde_json::to_string(&json!({
            "type": "stage",
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "processType": SIDECAR_PROCESS_TYPE,
            "requestId": request_id,
            "stage": stage,
            "elapsedMs": elapsed_ms,
        }))
        .map_err(|error| format!("failed to serialize stage: {error}"))?,
    )
}

pub(crate) fn emit_progress(
    request_id: Option<&str>,
    delta_bytes: u64,
    transferred_bytes: u64,
    total_bytes: u64,
) -> Result<(), String> {
    emit_stdout_line(
        serde_json::to_string(&json!({
            "type": "progress",
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "processType": SIDECAR_PROCESS_TYPE,
            "requestId": request_id,
            "deltaBytes": delta_bytes,
            "transferredBytes": transferred_bytes,
            "totalBytes": total_bytes,
        }))
        .map_err(|error| format!("failed to serialize progress: {error}"))?,
    )
}

pub(crate) fn emit_list_chunk(
    request_id: Option<&str>,
    items: Vec<RemoteFileEntry>,
    done: bool,
) -> Result<(), String> {
    emit_stdout_line(
        serde_json::to_string(&json!({
            "type": "listChunk",
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "processType": SIDECAR_PROCESS_TYPE,
            "requestId": request_id,
            "items": items,
            "done": done,
        }))
        .map_err(|error| format!("failed to serialize list chunk: {error}"))?,
    )
}

pub(crate) fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub(crate) fn enrich_result_metadata(
    operation: Option<&str>,
    request_id: Option<&str>,
    result: Value,
    network_path: Option<&NetworkPath>,
) -> Value {
    match result {
        Value::Object(mut map) => {
            map.entry("schemaVersion".to_string())
                .or_insert_with(|| json!(SIDECAR_SCHEMA_VERSION));
            map.entry("operation".to_string())
                .or_insert_with(|| json!(operation.unwrap_or("unknown")));
            if let Some(id) = request_id {
                map.entry("requestId".to_string())
                    .or_insert_with(|| json!(id));
            }
            if let Some(path) = network_path {
                map.entry("networkPath".to_string())
                    .or_insert_with(|| json!(path));
            }
            Value::Object(map)
        }
        other => {
            let mut wrapped = json!({
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "operation": operation.unwrap_or("unknown"),
            "requestId": request_id,
            "value": other,
            });
            if let Some(path) = network_path {
                if let Value::Object(ref mut map) = wrapped {
                    map.insert("networkPath".to_string(), json!(path));
                }
            }
            wrapped
        }
    }
}

pub(crate) fn emit_result(
    operation: Option<&str>,
    request_id: Option<&str>,
    result: serde_json::Value,
    network_path: Option<&NetworkPath>,
) -> Result<(), String> {
    let enriched = enrich_result_metadata(operation, request_id, result, network_path);
    emit_stdout_line(
        serde_json::to_string(&json!({
            "type": "result",
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "processType": SIDECAR_PROCESS_TYPE,
            "operation": operation.unwrap_or("unknown"),
            "requestId": request_id,
            "result": enriched,
        }))
        .map_err(|error| format!("failed to serialize result: {error}"))?,
    )
}

pub(crate) fn emit_error_result(
    operation: Option<&str>,
    request_id: Option<&str>,
    module: &str,
    message: &str,
    network_path: Option<&NetworkPath>,
) -> Result<(), String> {
    emit_result(
        operation,
        request_id,
        structured_error_value(operation, request_id, module, message, network_path),
        network_path,
    )
}

pub(crate) fn emit_watch_event(
    request_id: Option<&str>,
    event: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    emit_stdout_line(
        serde_json::to_string(&json!({
            "type": "watch",
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "processType": SIDECAR_PROCESS_TYPE,
            "requestId": request_id,
            "event": event,
            "payload": payload,
        }))
        .map_err(|error| format!("failed to serialize watch event: {error}"))?,
    )
}

pub(crate) fn emit_watch_error(
    operation: Option<&str>,
    request_id: Option<&str>,
    module: &str,
    message: &str,
    network_path: Option<&NetworkPath>,
) -> Result<(), String> {
    emit_watch_event(
        request_id,
        "error",
        structured_error_value(operation, request_id, module, message, network_path),
    )
}

pub(crate) fn structured_error_value(
    operation: Option<&str>,
    request_id: Option<&str>,
    module: &str,
    message: &str,
    network_path: Option<&NetworkPath>,
) -> serde_json::Value {
    let classification = classify_error(message);
    let mut value = json!({
        "schemaVersion": SIDECAR_SCHEMA_VERSION,
        "success": false,
        "error": message,
        "message": message,
        "errorCode": classification.error_code,
        "errorKind": classification.error_kind,
        "retryable": classification.retryable,
        "module": module,
        "processType": SIDECAR_PROCESS_TYPE,
        "operation": operation.unwrap_or("unknown"),
        "requestId": request_id,
        "sidecarVersion": env!("CARGO_PKG_VERSION"),
        "platform": env::consts::OS,
        "arch": env::consts::ARCH,
        "timestamp": current_timestamp_ms(),
    });
    if let Some(path) = network_path {
        if let Value::Object(ref mut map) = value {
            map.insert("networkPath".to_string(), json!(path));
        }
    }
    value
}
