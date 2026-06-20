use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use futures_util::StreamExt;
use openssh_sftp_client::file::{OpenOptions, TokioCompatFile};
use openssh_sftp_client::metadata::{MetaData, MetaDataBuilder, Permissions};
use openssh_sftp_client::{Sftp, SftpOptions};
use russh::client::{self, Handle};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::Disconnect;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::cmp::min;
use std::env;
use std::fs;
use std::panic;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::fs::OpenOptions as TokioOpenOptions;
use tokio::io::{self, AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

type SshHandle = Handle<AcceptAnyServerKey>;
const SIDECAR_SCHEMA_VERSION: u32 = 1;
const SIDECAR_PROCESS_TYPE: &str = "native-sidecar";
const MODE_TYPE_MASK: u32 = 0o170000;
const MODE_TYPE_DIRECTORY: u32 = 0o040000;
const MODE_TYPE_FILE: u32 = 0o100000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalFileEntry {
    local_path: String,
    relative_path: String,
    name: String,
    size: u64,
    is_directory: bool,
    mtime: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanError {
    path: String,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    schema_version: u32,
    scan_id: String,
    root_path: String,
    relative_base: String,
    generated_at: u64,
    truncated: bool,
    truncated_reason: Option<String>,
    max_entries_hit: bool,
    max_depth_hit: bool,
    max_bytes_hit: bool,
    total_size: u64,
    file_count: usize,
    directory_count: usize,
    files: Vec<LocalFileEntry>,
    directories: Vec<String>,
    errors: Vec<ScanError>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SshConnectionConfig {
    host: String,
    port: Option<u16>,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    passphrase: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpEnvelope {
    schema_version: Option<u32>,
    config: SshConnectionConfig,
    request: SftpRequest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SftpRequest {
    schema_version: Option<u32>,
    request_id: Option<String>,
    operation: String,
    path: Option<String>,
    local_path: Option<String>,
    source_path: Option<String>,
    target_path: Option<String>,
    content_base64: Option<String>,
    permissions: Option<String>,
    owner: Option<String>,
    group: Option<String>,
    is_directory: Option<bool>,
    segment_offset: Option<u64>,
    segment_length: Option<u64>,
    remote_write_flags: Option<String>,
    local_write_flags: Option<String>,
    watch_interval_ms: Option<u64>,
    max_entries: Option<usize>,
    max_depth: Option<usize>,
    max_bytes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteFileEntry {
    name: String,
    is_directory: bool,
    r#type: String,
    size: u64,
    modify_time: u64,
    access_time: u64,
    mode: u32,
    uid: u32,
    gid: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteFileStat {
    size: u64,
    mode: u32,
    uid: u32,
    gid: u32,
    permissions: String,
    modify_time: u64,
    access_time: u64,
    is_directory: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteFolderFileEntry {
    remote_path: String,
    relative_path: String,
    file_name: String,
    size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteFolderScanResult {
    schema_version: u32,
    scan_id: String,
    root_path: String,
    generated_at: u64,
    truncated: bool,
    truncated_reason: Option<String>,
    max_entries_hit: bool,
    max_depth_hit: bool,
    max_bytes_hit: bool,
    total_bytes: u64,
    file_count: usize,
    directory_count: usize,
    files: Vec<RemoteFolderFileEntry>,
    directories: Vec<String>,
    errors: Vec<ScanError>,
}

#[derive(Debug, Clone, Copy, Default)]
struct ScanLimits {
    max_entries: Option<usize>,
    max_depth: Option<usize>,
    max_bytes: Option<u64>,
}

#[derive(Debug, Default)]
struct ScanControl {
    truncated: bool,
    truncated_reason: Option<String>,
    max_entries_hit: bool,
    max_depth_hit: bool,
    max_bytes_hit: bool,
}

#[derive(Debug)]
struct AcceptAnyServerKey;

impl client::Handler for AcceptAnyServerKey {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

#[tokio::main]
async fn main() {
    install_panic_hook();
    if let Err(error) = run().await {
        eprintln!("{}", structured_stderr_error(&error, None));
        process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or_else(|| {
        "missing command, expected scan-folder, sftp-request, or sftp-watch".to_string()
    })?;

    match command.as_str() {
        "scan-folder" => run_scan_folder(args),
        "sftp-request" => run_sftp_request().await,
        "sftp-watch" => run_sftp_watch().await,
        "--version" => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        other => Err(format!("unsupported command: {other}")),
    }
}

fn run_scan_folder(mut args: impl Iterator<Item = String>) -> Result<(), String> {
    let mut folder_path: Option<PathBuf> = None;
    let mut relative_base = String::new();
    let mut max_entries: Option<usize> = None;
    let mut max_depth: Option<usize> = None;
    let mut max_bytes: Option<u64> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--path" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--path requires a value".to_string())?;
                folder_path = Some(PathBuf::from(value));
            }
            "--relative-base" => {
                relative_base = args
                    .next()
                    .ok_or_else(|| "--relative-base requires a value".to_string())?;
            }
            "--max-entries" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--max-entries requires a value".to_string())?;
                max_entries = Some(
                    value
                        .parse::<usize>()
                        .map_err(|error| format!("invalid --max-entries: {error}"))?,
                );
            }
            "--max-depth" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--max-depth requires a value".to_string())?;
                max_depth = Some(
                    value
                        .parse::<usize>()
                        .map_err(|error| format!("invalid --max-depth: {error}"))?,
                );
            }
            "--max-bytes" => {
                let value = args
                    .next()
                    .ok_or_else(|| "--max-bytes requires a value".to_string())?;
                max_bytes = Some(
                    value
                        .parse::<u64>()
                        .map_err(|error| format!("invalid --max-bytes: {error}"))?,
                );
            }
            "--version" => {
                println!("{}", env!("CARGO_PKG_VERSION"));
                return Ok(());
            }
            other => return Err(format!("unsupported argument: {other}")),
        }
    }

    let folder = folder_path.ok_or_else(|| "--path is required".to_string())?;
    let result = scan_folder(
        &folder,
        &relative_base,
        ScanLimits {
            max_entries,
            max_depth,
            max_bytes,
        },
    )?;
    let json =
        serde_json::to_string(&result).map_err(|error| format!("failed to serialize: {error}"))?;
    println!("{json}");
    Ok(())
}

async fn run_sftp_request() -> Result<(), String> {
    let mut stdin = io::stdin();
    let mut payload = String::new();
    stdin
        .read_to_string(&mut payload)
        .await
        .map_err(|error| format!("failed to read stdin: {error}"))?;

    let envelope: SftpEnvelope = match serde_json::from_str(payload.trim()) {
        Ok(value) => value,
        Err(error) => {
            emit_error_result(
                None,
                None,
                SIDECAR_PROCESS_TYPE,
                &format!("failed to parse request: {error}"),
            )?;
            return Ok(());
        }
    };
    let operation = envelope.request.operation.clone();
    let request_id = envelope.request.request_id.as_deref();
    let _schema_version = envelope
        .request
        .schema_version
        .or(envelope.schema_version)
        .unwrap_or(SIDECAR_SCHEMA_VERSION);

    let (sftp, handle) = match connect_sftp(&envelope.config).await {
        Ok(value) => value,
        Err(error) => {
            emit_error_result(Some(&operation), request_id, SIDECAR_PROCESS_TYPE, &error)?;
            return Ok(());
        }
    };
    let result = execute_request(&sftp, &envelope.request).await;

    let close_result = sftp.close().await.map_err(|error| error.to_string());
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "English")
        .await;

    if let Err(error) = close_result {
        if result.is_ok() {
            emit_error_result(Some(&operation), request_id, SIDECAR_PROCESS_TYPE, &error)?;
            return Ok(());
        }
    }

    match result {
        Ok(value) => emit_result(Some(&operation), request_id, value)?,
        Err(error) => {
            emit_error_result(Some(&operation), request_id, SIDECAR_PROCESS_TYPE, &error)?
        }
    }
    Ok(())
}

async fn run_sftp_watch() -> Result<(), String> {
    let mut stdin = io::stdin();
    let mut payload = String::new();
    stdin
        .read_to_string(&mut payload)
        .await
        .map_err(|error| format!("failed to read stdin: {error}"))?;

    let envelope: SftpEnvelope = match serde_json::from_str(payload.trim()) {
        Ok(value) => value,
        Err(error) => {
            emit_watch_error(
                None,
                None,
                SIDECAR_PROCESS_TYPE,
                &format!("failed to parse request: {error}"),
            )?;
            return Ok(());
        }
    };
    let operation = envelope.request.operation.clone();
    let request_id = envelope.request.request_id.as_deref();

    if envelope.request.operation != "watchDirectory" {
        emit_watch_error(
            Some(&operation),
            request_id,
            SIDECAR_PROCESS_TYPE,
            &format!(
                "unsupported watch operation: {}",
                envelope.request.operation
            ),
        )?;
        return Ok(());
    }

    let (sftp, handle) = match connect_sftp(&envelope.config).await {
        Ok(value) => value,
        Err(error) => {
            emit_watch_error(Some(&operation), request_id, SIDECAR_PROCESS_TYPE, &error)?;
            return Ok(());
        }
    };
    let watch_result = watch_directory(&sftp, &envelope.request).await;

    let close_result = sftp.close().await.map_err(|error| error.to_string());
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "English")
        .await;

    if let Err(error) = watch_result {
        emit_watch_error(Some(&operation), request_id, SIDECAR_PROCESS_TYPE, &error)?;
        return Ok(());
    }
    if let Err(error) = close_result {
        emit_watch_error(Some(&operation), request_id, SIDECAR_PROCESS_TYPE, &error)?;
    }
    Ok(())
}

async fn connect_sftp(config: &SshConnectionConfig) -> Result<(Sftp, SshHandle), String> {
    let client_config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(30)),
        ..Default::default()
    });

    let mut handle = client::connect(
        client_config,
        (config.host.as_str(), config.port.unwrap_or(22)),
        AcceptAnyServerKey,
    )
    .await
    .map_err(|error| format!("failed to connect SSH session: {error}"))?;

    if let Some(private_key) = config.private_key.as_deref() {
        let key = decode_secret_key(private_key, config.passphrase.as_deref())
            .map_err(|error| format!("failed to decode private key: {error}"))?;
        let auth_result = handle
            .authenticate_publickey(
                config.username.clone(),
                PrivateKeyWithHashAlg::new(
                    Arc::new(key),
                    handle
                        .best_supported_rsa_hash()
                        .await
                        .map_err(|error| format!("failed to resolve RSA hash: {error}"))?
                        .flatten(),
                ),
            )
            .await
            .map_err(|error| format!("public key authentication failed: {error}"))?;

        if !auth_result.success() {
            return Err("public key authentication failed".to_string());
        }
    } else if let Some(password) = config.password.as_deref() {
        let auth_result = handle
            .authenticate_password(config.username.clone(), password.to_string())
            .await
            .map_err(|error| format!("password authentication failed: {error}"))?;

        if !auth_result.success() {
            return Err("password authentication failed".to_string());
        }
    } else {
        return Err("missing SSH credentials for native SFTP request".to_string());
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("failed to open SSH channel: {error}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|error| format!("failed to start sftp subsystem: {error}"))?;

    let channel_stream = channel.into_stream();
    let (reader, writer) = tokio::io::split(channel_stream);
    let sftp = Sftp::new(writer, reader, SftpOptions::default())
        .await
        .map_err(|error| format!("failed to initialize openssh-sftp-client: {error}"))?;

    Ok((sftp, handle))
}

async fn execute_request(sftp: &Sftp, request: &SftpRequest) -> Result<serde_json::Value, String> {
    match request.operation.as_str() {
        "listFiles" => {
            let path = resolve_directory_path(request.path.as_deref());
            let entries = list_files(sftp, &path).await?;
            Ok(json!({
                "success": true,
                "data": entries,
            }))
        }
        "scanRemoteFolderTree" => {
            let path = resolve_directory_path(request.path.as_deref());
            let result = scan_remote_folder_tree(
                sftp,
                &path,
                ScanLimits {
                    max_entries: request.max_entries,
                    max_depth: request.max_depth,
                    max_bytes: request.max_bytes,
                },
            )
            .await?;
            Ok(json!({
                "success": true,
                "schemaVersion": result.schema_version,
                "scanId": result.scan_id,
                "rootPath": result.root_path,
                "generatedAt": result.generated_at,
                "truncated": result.truncated,
                "truncatedReason": result.truncated_reason,
                "maxFilesHit": result.max_entries_hit,
                "maxEntriesHit": result.max_entries_hit,
                "maxDepthHit": result.max_depth_hit,
                "maxBytesHit": result.max_bytes_hit,
                "totalBytes": result.total_bytes,
                "fileCount": result.file_count,
                "directoryCount": result.directory_count,
                "files": result.files,
                "directories": result.directories,
                "errors": result.errors,
            }))
        }
        "copyFile" => {
            let source = required_path(request.source_path.as_deref(), "sourcePath")?;
            let target = required_path(request.target_path.as_deref(), "targetPath")?;
            copy_file(sftp, source, target).await?;
            Ok(json!({ "success": true }))
        }
        "moveFile" | "renameFile" => {
            let source = required_path(request.source_path.as_deref(), "sourcePath")?;
            let target = required_path(request.target_path.as_deref(), "targetPath")?;
            let mut fs = sftp.fs();
            fs.rename(source, target)
                .await
                .map_err(|error| format!("rename failed: {error}"))?;
            Ok(json!({ "success": true }))
        }
        "deleteFile" => {
            let path = required_path(request.path.as_deref(), "path")?;
            delete_path_recursive(sftp, path, request.is_directory.unwrap_or(false)).await?;
            Ok(json!({ "success": true }))
        }
        "createFolder" | "createRemoteFolders" => {
            let path = required_path(request.path.as_deref(), "path")?;
            create_remote_folders(sftp, path).await?;
            Ok(json!({ "success": true }))
        }
        "createFile" => {
            let path = required_path(request.path.as_deref(), "path")?;
            create_file(sftp, path).await?;
            Ok(json!({ "success": true }))
        }
        "getFilePermissions" => {
            let path = required_path(request.path.as_deref(), "path")?;
            let stat = stat_path(sftp, path).await?;
            Ok(json!({
                "success": true,
                "permissions": stat.permissions,
                "mode": stat.mode,
                "uid": stat.uid,
                "gid": stat.gid,
                "stats": stat,
            }))
        }
        "getAbsolutePath" => {
            let path = required_path(request.path.as_deref(), "path")?;
            let mut fs = sftp.fs();
            let absolute = fs
                .canonicalize(path)
                .await
                .map_err(|error| format!("canonicalize failed: {error}"))?;
            Ok(json!({
                "success": true,
                "path": absolute.to_string_lossy(),
            }))
        }
        "readFileContent" => {
            let path = required_path(request.path.as_deref(), "path")?;
            let mut fs = sftp.fs();
            let content = fs
                .read(path)
                .await
                .map_err(|error| format!("read failed: {error}"))?;
            let text = String::from_utf8(content.to_vec())
                .map_err(|error| format!("file is not valid UTF-8: {error}"))?;
            Ok(json!({
                "success": true,
                "content": text,
            }))
        }
        "readFileAsBase64" => {
            let path = required_path(request.path.as_deref(), "path")?;
            let mut fs = sftp.fs();
            let content = fs
                .read(path)
                .await
                .map_err(|error| format!("read failed: {error}"))?;
            Ok(json!({
                "success": true,
                "content": BASE64_STANDARD.encode(content),
            }))
        }
        "saveFileContent" => {
            let path = required_path(request.path.as_deref(), "path")?;
            let content = request
                .content_base64
                .as_deref()
                .ok_or_else(|| "contentBase64 is required".to_string())?;
            let bytes = BASE64_STANDARD
                .decode(content)
                .map_err(|error| format!("invalid base64 content: {error}"))?;
            let mut fs = sftp.fs();
            fs.write(path, bytes)
                .await
                .map_err(|error| format!("write failed: {error}"))?;
            Ok(json!({ "success": true }))
        }
        "uploadFileToRemote" => {
            let remote_path = required_path(request.path.as_deref(), "path")?;
            let local_path = required_path(request.local_path.as_deref(), "localPath")?;
            let result = upload_local_file(
                sftp,
                request.request_id.as_deref(),
                local_path,
                remote_path,
                request.segment_offset,
                request.segment_length,
                request.remote_write_flags.as_deref(),
            )
            .await?;
            Ok(json!({
                "success": true,
                "transferredBytes": result,
                "totalBytes": result,
            }))
        }
        "downloadFileToLocal" => {
            let remote_path = required_path(request.path.as_deref(), "path")?;
            let local_path = required_path(request.local_path.as_deref(), "localPath")?;
            let result = download_remote_file(
                sftp,
                request.request_id.as_deref(),
                remote_path,
                local_path,
                request.segment_offset,
                request.segment_length,
                request.local_write_flags.as_deref(),
            )
            .await?;
            Ok(json!({
                "success": true,
                "transferredBytes": result,
                "totalBytes": result,
            }))
        }
        "setFilePermissions" => {
            let path = required_path(request.path.as_deref(), "path")?;
            let permissions = request
                .permissions
                .as_deref()
                .ok_or_else(|| "permissions is required".to_string())?;
            let mode = u16::from_str_radix(permissions.trim(), 8)
                .map_err(|error| format!("invalid permissions: {error}"))?;
            let mut fs = sftp.fs();
            fs.set_permissions(path, Permissions::from(mode))
                .await
                .map_err(|error| format!("chmod failed: {error}"))?;
            Ok(json!({ "success": true }))
        }
        "setFileOwnership" => {
            let path = required_path(request.path.as_deref(), "path")?;
            let owner = request.owner.as_deref().map(parse_numeric_id).transpose()?;
            let group = request.group.as_deref().map(parse_numeric_id).transpose()?;

            if owner.is_none() && group.is_none() {
                return Ok(json!({ "success": true }));
            }

            let current = stat_metadata(sftp, path).await?;
            let uid = owner.or_else(|| current.uid()).unwrap_or(0);
            let gid = group.or_else(|| current.gid()).unwrap_or(0);

            let mut builder = MetaDataBuilder::new();
            builder.id((uid, gid));
            let mut fs = sftp.fs();
            fs.set_metadata(path, builder.create())
                .await
                .map_err(|error| format!("chown failed: {error}"))?;
            Ok(json!({ "success": true }))
        }
        other => Ok(json!({
            "success": false,
            "error": format!("unsupported native SFTP operation: {other}"),
        })),
    }
}

fn required_path<'a>(value: Option<&'a str>, field_name: &str) -> Result<&'a str, String> {
    value
        .filter(|item| !item.trim().is_empty())
        .ok_or_else(|| format!("{field_name} is required"))
}

fn resolve_directory_path(value: Option<&str>) -> String {
    let normalized = value.unwrap_or("").trim();
    if normalized.is_empty() {
        ".".to_string()
    } else {
        normalized.to_string()
    }
}

fn parse_numeric_id(value: &str) -> Result<u32, String> {
    value
        .trim()
        .parse::<u32>()
        .map_err(|error| format!("invalid numeric id: {error}"))
}

fn resolve_transfer_window(
    total_size: u64,
    segment_offset: Option<u64>,
    segment_length: Option<u64>,
) -> Result<(u64, u64), String> {
    let offset = segment_offset.unwrap_or(0);
    if offset > total_size {
        return Err(format!(
            "segment offset {offset} exceeds total size {total_size}"
        ));
    }

    let available = total_size.saturating_sub(offset);
    let total_bytes = match segment_length {
        Some(length) => {
            if offset.saturating_add(length) > total_size {
                return Err(format!(
                    "segment length {length} exceeds available bytes {available}"
                ));
            }
            length
        }
        None => available,
    };

    Ok((offset, total_bytes))
}

fn remote_upload_open_options(sftp: &Sftp, flags: Option<&str>) -> OpenOptions {
    let mut options: OpenOptions = sftp.options();
    let normalized = flags.unwrap_or("").trim().to_ascii_lowercase();

    if normalized.contains('a') {
        options.write(true).append(true).create(true);
        return options;
    }

    if normalized.starts_with('r') {
        options.read(true);
        if normalized.contains('+') {
            options.write(true).create(true);
        }
        return options;
    }

    if normalized.contains('+') {
        options.read(true).write(true).create(true);
        return options;
    }

    options.write(true).create(true).truncate(true);
    options
}

fn local_download_open_options(flags: Option<&str>) -> TokioOpenOptions {
    let normalized = flags.unwrap_or("").trim().to_ascii_lowercase();
    let mut options = TokioOpenOptions::new();

    options.create(true);

    if normalized.contains('a') {
        options.append(true);
        return options;
    }

    if normalized.starts_with('r') {
        options.read(true);
        if normalized.contains('+') {
            options.write(true);
        }
        return options;
    }

    if normalized.contains('+') {
        options.read(true).write(true);
        return options;
    }

    options.write(true).truncate(true);
    options
}

fn emit_progress(
    request_id: Option<&str>,
    delta_bytes: u64,
    transferred_bytes: u64,
    total_bytes: u64,
) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(&json!({
            "type": "progress",
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "processType": SIDECAR_PROCESS_TYPE,
            "requestId": request_id,
            "deltaBytes": delta_bytes,
            "transferredBytes": transferred_bytes,
            "totalBytes": total_bytes,
        }))
        .map_err(|error| format!("failed to serialize progress: {error}"))?
    );
    Ok(())
}

async fn list_files(sftp: &Sftp, remote_path: &str) -> Result<Vec<RemoteFileEntry>, String> {
    let mut fs = sftp.fs();
    let dir = fs
        .open_dir(remote_path)
        .await
        .map_err(|error| format!("open_dir failed: {error}"))?;
    let read_dir = dir.read_dir();
    futures_util::pin_mut!(read_dir);
    let mut entries = Vec::new();

    while let Some(entry_result) = read_dir.next().await {
        let entry = entry_result.map_err(|error| format!("readdir failed: {error}"))?;
        let name = entry.filename().to_string_lossy().to_string();
        if name == "." || name == ".." {
            continue;
        }

        let full_path = join_remote_path(remote_path, &name);
        let metadata = resolve_entry_metadata(sftp, &full_path, entry.metadata()).await?;
        let is_directory = metadata_is_directory(&metadata)
            .ok_or_else(|| format!("remote entry type is unknown: {full_path}"))?;
        let mode = metadata_mode(&metadata);

        entries.push(RemoteFileEntry {
            name,
            is_directory,
            r#type: if is_directory {
                "directory".to_string()
            } else {
                "file".to_string()
            },
            size: metadata.len().unwrap_or(0),
            modify_time: metadata
                .modified()
                .map(|value| value.into_raw() as u64 * 1000)
                .unwrap_or(0),
            access_time: metadata
                .accessed()
                .map(|value| value.into_raw() as u64 * 1000)
                .unwrap_or(0),
            mode,
            uid: metadata.uid().unwrap_or(0),
            gid: metadata.gid().unwrap_or(0),
        });
    }

    Ok(entries)
}

fn update_signature_bytes(hash: &mut u64, bytes: &[u8]) {
    const FNV_PRIME: u64 = 1099511628211;
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(FNV_PRIME);
    }
    *hash ^= 0xff;
    *hash = hash.wrapping_mul(FNV_PRIME);
}

fn update_signature_u64(hash: &mut u64, value: u64) {
    update_signature_bytes(hash, &value.to_le_bytes());
}

fn compute_directory_signature(entries: &[RemoteFileEntry]) -> String {
    let mut normalized_entries: Vec<&RemoteFileEntry> = entries.iter().collect();
    normalized_entries.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then(left.is_directory.cmp(&right.is_directory))
            .then(left.size.cmp(&right.size))
            .then(left.modify_time.cmp(&right.modify_time))
            .then(left.mode.cmp(&right.mode))
            .then(left.uid.cmp(&right.uid))
            .then(left.gid.cmp(&right.gid))
    });

    let mut hash = 14695981039346656037u64;
    update_signature_u64(&mut hash, normalized_entries.len() as u64);

    for entry in normalized_entries {
        update_signature_bytes(&mut hash, entry.name.as_bytes());
        update_signature_u64(&mut hash, u64::from(entry.is_directory));
        update_signature_u64(&mut hash, entry.size);
        update_signature_u64(&mut hash, entry.modify_time);
        update_signature_u64(&mut hash, u64::from(entry.mode));
        update_signature_u64(&mut hash, u64::from(entry.uid));
        update_signature_u64(&mut hash, u64::from(entry.gid));
    }

    format!("{hash:016x}:{}", entries.len())
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn create_scan_id(prefix: &str) -> String {
    format!("{prefix}-{}-{}", current_timestamp_ms(), process::id())
}

fn should_stop_scan(
    file_count: usize,
    directory_count: usize,
    total_bytes: u64,
    limits: ScanLimits,
    control: &mut ScanControl,
) -> bool {
    if let Some(max_entries) = limits.max_entries {
        if file_count.saturating_add(directory_count) >= max_entries {
            control.truncated = true;
            control.max_entries_hit = true;
            control.truncated_reason = Some(format!("maxEntries {max_entries} reached"));
            return true;
        }
    }

    if let Some(max_bytes) = limits.max_bytes {
        if total_bytes >= max_bytes {
            control.truncated = true;
            control.max_bytes_hit = true;
            control.truncated_reason = Some(format!("maxBytes {max_bytes} reached"));
            return true;
        }
    }

    false
}

async fn watch_directory(sftp: &Sftp, request: &SftpRequest) -> Result<(), String> {
    let remote_path = resolve_directory_path(request.path.as_deref());
    let interval_ms = request.watch_interval_ms.unwrap_or(1500).clamp(500, 10_000);
    let request_id = request.request_id.as_deref();

    let initial_entries = list_files(sftp, &remote_path).await?;
    let mut previous_signature = compute_directory_signature(&initial_entries);

    emit_watch_event(
        request_id,
        "ready",
        json!({
            "path": &remote_path,
            "signature": &previous_signature,
            "entryCount": initial_entries.len(),
            "timestamp": current_timestamp_ms(),
            "intervalMs": interval_ms,
        }),
    )?;

    loop {
        tokio::time::sleep(Duration::from_millis(interval_ms)).await;

        let entries = list_files(sftp, &remote_path).await?;
        let next_signature = compute_directory_signature(&entries);
        if next_signature == previous_signature {
            continue;
        }

        previous_signature = next_signature.clone();
        emit_watch_event(
            request_id,
            "changed",
            json!({
                "path": &remote_path,
                "signature": &next_signature,
                "entryCount": entries.len(),
                "timestamp": current_timestamp_ms(),
            }),
        )?;
    }
}

async fn scan_remote_folder_tree(
    sftp: &Sftp,
    remote_root_path: &str,
    limits: ScanLimits,
) -> Result<RemoteFolderScanResult, String> {
    let scan_id = create_scan_id("remote");
    let mut stack = vec![(remote_root_path.to_string(), String::new(), 0usize)];
    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut total_bytes = 0u64;
    let errors = Vec::new();
    let mut control = ScanControl::default();

    while let Some((current_path, relative_base, depth)) = stack.pop() {
        if control.truncated {
            break;
        }

        let mut fs = sftp.fs();
        let dir = fs
            .open_dir(&current_path)
            .await
            .map_err(|error| format!("open_dir failed for {current_path}: {error}"))?;
        let read_dir = dir.read_dir();
        futures_util::pin_mut!(read_dir);

        while let Some(entry_result) = read_dir.next().await {
            let entry = entry_result.map_err(|error| format!("readdir failed: {error}"))?;
            let name = entry.filename().to_string_lossy().to_string();
            if name == "." || name == ".." {
                continue;
            }

            let child_path = join_remote_path(&current_path, &name);
            let child_relative = join_remote_relative_path(&relative_base, &name);
            let metadata = resolve_entry_metadata(sftp, &child_path, entry.metadata()).await?;
            let is_directory = metadata_is_directory(&metadata)
                .ok_or_else(|| format!("remote entry type is unknown: {child_path}"))?;

            if is_directory {
                directories.push(child_relative.clone());
                if should_stop_scan(
                    files.len(),
                    directories.len(),
                    total_bytes,
                    limits,
                    &mut control,
                ) {
                    break;
                }
                if let Some(max_depth) = limits.max_depth {
                    if depth >= max_depth {
                        control.truncated = true;
                        control.max_depth_hit = true;
                        control.truncated_reason = Some(format!("maxDepth {max_depth} reached"));
                        break;
                    }
                }
                stack.push((child_path, child_relative, depth + 1));
                continue;
            }

            let size = metadata.len().unwrap_or(0);
            total_bytes += size;
            files.push(RemoteFolderFileEntry {
                remote_path: child_path,
                relative_path: child_relative,
                file_name: name,
                size,
            });

            if should_stop_scan(
                files.len(),
                directories.len(),
                total_bytes,
                limits,
                &mut control,
            ) {
                break;
            }
        }
    }

    directories.sort();
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    Ok(RemoteFolderScanResult {
        schema_version: SIDECAR_SCHEMA_VERSION,
        scan_id,
        root_path: remote_root_path.to_string(),
        generated_at: current_timestamp_ms(),
        truncated: control.truncated,
        truncated_reason: control.truncated_reason,
        max_entries_hit: control.max_entries_hit,
        max_depth_hit: control.max_depth_hit,
        max_bytes_hit: control.max_bytes_hit,
        total_bytes,
        file_count: files.len(),
        directory_count: directories.len(),
        files,
        directories,
        errors,
    })
}

async fn copy_file(sftp: &Sftp, source_path: &str, target_path: &str) -> Result<(), String> {
    let mut fs = sftp.fs();
    let content = fs
        .read(source_path)
        .await
        .map_err(|error| format!("copy read failed: {error}"))?;
    fs.write(target_path, content)
        .await
        .map_err(|error| format!("copy write failed: {error}"))?;
    Ok(())
}

async fn upload_local_file(
    sftp: &Sftp,
    request_id: Option<&str>,
    local_path: &str,
    remote_path: &str,
    segment_offset: Option<u64>,
    segment_length: Option<u64>,
    remote_write_flags: Option<&str>,
) -> Result<u64, String> {
    let mut local_file = tokio::fs::File::open(local_path)
        .await
        .map_err(|error| format!("open local file failed: {error}"))?;
    let local_size = local_file
        .metadata()
        .await
        .map_err(|error| format!("stat local file failed: {error}"))?
        .len();
    let (offset, total_bytes) =
        resolve_transfer_window(local_size, segment_offset, segment_length)?;

    if offset > 0 {
        local_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|error| format!("seek local file failed: {error}"))?;
    }

    let remote_file = remote_upload_open_options(sftp, remote_write_flags)
        .open(remote_path)
        .await
        .map_err(|error| format!("open remote file failed: {error}"))?;
    let remote_file = TokioCompatFile::new(remote_file);
    futures_util::pin_mut!(remote_file);
    if offset > 0 {
        remote_file
            .as_mut()
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|error| format!("seek remote file failed: {error}"))?;
    }

    let mut transferred = 0u64;
    let mut buffer = vec![0u8; 256 * 1024];
    while transferred < total_bytes {
        let remaining = (total_bytes - transferred) as usize;
        let read_len = min(buffer.len(), remaining);
        let bytes_read = local_file
            .read(&mut buffer[..read_len])
            .await
            .map_err(|error| format!("read local file failed: {error}"))?;
        if bytes_read == 0 {
            return Err("unexpected EOF while uploading local file".to_string());
        }

        remote_file
            .as_mut()
            .write_all(&buffer[..bytes_read])
            .await
            .map_err(|error| format!("write remote file failed: {error}"))?;
        transferred += bytes_read as u64;
        emit_progress(request_id, bytes_read as u64, transferred, total_bytes)?;
    }

    remote_file
        .as_mut()
        .flush()
        .await
        .map_err(|error| format!("flush remote file failed: {error}"))?;
    remote_file
        .as_mut()
        .shutdown()
        .await
        .map_err(|error| format!("shutdown remote file failed: {error}"))?;

    Ok(transferred)
}

async fn download_remote_file(
    sftp: &Sftp,
    request_id: Option<&str>,
    remote_path: &str,
    local_path: &str,
    segment_offset: Option<u64>,
    segment_length: Option<u64>,
    local_write_flags: Option<&str>,
) -> Result<u64, String> {
    if let Some(parent) = Path::new(local_path).parent() {
        if !parent.as_os_str().is_empty() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|error| format!("create local directory failed: {error}"))?;
        }
    }

    let metadata = stat_metadata(sftp, remote_path).await?;
    let remote_size = metadata.len().unwrap_or(0);
    let (offset, total_bytes) =
        resolve_transfer_window(remote_size, segment_offset, segment_length)?;

    let remote_file = sftp
        .open(remote_path)
        .await
        .map_err(|error| format!("open remote file failed: {error}"))?;
    let remote_file = TokioCompatFile::new(remote_file);
    futures_util::pin_mut!(remote_file);
    if offset > 0 {
        remote_file
            .as_mut()
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|error| format!("seek remote file failed: {error}"))?;
    }

    let mut local_file = local_download_open_options(local_write_flags)
        .open(local_path)
        .await
        .map_err(|error| format!("open local file failed: {error}"))?;
    if offset > 0 {
        local_file
            .seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|error| format!("seek local file failed: {error}"))?;
    }

    let mut transferred = 0u64;
    let mut buffer = vec![0u8; 256 * 1024];
    while transferred < total_bytes {
        let remaining = (total_bytes - transferred) as usize;
        let read_len = min(buffer.len(), remaining);
        let bytes_read = remote_file
            .as_mut()
            .read(&mut buffer[..read_len])
            .await
            .map_err(|error| format!("read remote file failed: {error}"))?;
        if bytes_read == 0 {
            return Err("unexpected EOF while downloading remote file".to_string());
        }

        local_file
            .write_all(&buffer[..bytes_read])
            .await
            .map_err(|error| format!("write local file failed: {error}"))?;
        transferred += bytes_read as u64;
        emit_progress(request_id, bytes_read as u64, transferred, total_bytes)?;
    }

    local_file
        .flush()
        .await
        .map_err(|error| format!("flush local file failed: {error}"))?;

    Ok(transferred)
}

async fn create_file(sftp: &Sftp, remote_path: &str) -> Result<(), String> {
    let mut options: OpenOptions = sftp.options();
    let file = options
        .write(true)
        .create(true)
        .truncate(true)
        .open(remote_path)
        .await
        .map_err(|error| format!("create file failed: {error}"))?;
    file.close()
        .await
        .map_err(|error| format!("close created file failed: {error}"))?;
    Ok(())
}

async fn stat_metadata(sftp: &Sftp, remote_path: &str) -> Result<MetaData, String> {
    let mut fs = sftp.fs();
    fs.metadata(remote_path)
        .await
        .map_err(|error| format!("stat failed: {error}"))
}

async fn stat_path(sftp: &Sftp, remote_path: &str) -> Result<RemoteFileStat, String> {
    let metadata = stat_metadata(sftp, remote_path).await?;
    let mode = metadata_mode(&metadata);
    let is_directory = metadata_is_directory(&metadata).unwrap_or(false);

    Ok(RemoteFileStat {
        size: metadata.len().unwrap_or(0),
        mode,
        uid: metadata.uid().unwrap_or(0),
        gid: metadata.gid().unwrap_or(0),
        permissions: format!("{:03o}", mode & 0o777),
        modify_time: metadata
            .modified()
            .map(|value| value.into_raw() as u64 * 1000)
            .unwrap_or(0),
        access_time: metadata
            .accessed()
            .map(|value| value.into_raw() as u64 * 1000)
            .unwrap_or(0),
        is_directory,
    })
}

async fn create_remote_folders(sftp: &Sftp, remote_path: &str) -> Result<(), String> {
    let is_absolute = remote_path.starts_with('/');
    let mut current_path = if is_absolute {
        "/".to_string()
    } else {
        String::new()
    };

    for part in remote_path.split('/').filter(|part| !part.is_empty()) {
        if current_path.is_empty() {
            current_path.push_str(part);
        } else if current_path == "/" {
            current_path.push_str(part);
        } else {
            current_path.push('/');
            current_path.push_str(part);
        }
        let probe_path = if is_absolute && !current_path.starts_with('/') {
            format!("/{current_path}")
        } else {
            current_path.clone()
        };

        let mut fs = sftp.fs();
        match fs.metadata(&probe_path).await {
            Ok(metadata) => {
                let is_dir = metadata
                    .file_type()
                    .map(|kind| kind.is_dir())
                    .unwrap_or(false);
                if !is_dir {
                    return Err(format!("path exists and is not a directory: {probe_path}"));
                }
            }
            Err(_) => {
                fs.create_dir(&probe_path)
                    .await
                    .map_err(|error| format!("mkdir failed for {probe_path}: {error}"))?;
            }
        }
    }

    Ok(())
}

async fn delete_path_recursive(
    sftp: &Sftp,
    remote_path: &str,
    is_directory_hint: bool,
) -> Result<(), String> {
    let metadata = stat_metadata(sftp, remote_path).await?;
    let is_directory = metadata
        .file_type()
        .map(|kind| kind.is_dir())
        .unwrap_or(is_directory_hint);

    if !is_directory {
        let mut fs = sftp.fs();
        fs.remove_file(remote_path)
            .await
            .map_err(|error| format!("remove_file failed: {error}"))?;
        return Ok(());
    }

    let mut stack = vec![(remote_path.to_string(), false)];
    while let Some((current_path, visited)) = stack.pop() {
        if visited {
            let mut fs = sftp.fs();
            fs.remove_dir(&current_path)
                .await
                .map_err(|error| format!("remove_dir failed for {current_path}: {error}"))?;
            continue;
        }

        stack.push((current_path.clone(), true));

        let mut fs = sftp.fs();
        let dir = fs
            .open_dir(&current_path)
            .await
            .map_err(|error| format!("open_dir failed for {current_path}: {error}"))?;
        let read_dir = dir.read_dir();
        futures_util::pin_mut!(read_dir);

        while let Some(entry_result) = read_dir.next().await {
            let entry = entry_result.map_err(|error| format!("readdir failed: {error}"))?;
            let name = entry.filename().to_string_lossy().to_string();
            if name == "." || name == ".." {
                continue;
            }

            let child_path = if current_path == "/" {
                format!("/{name}")
            } else {
                format!("{}/{}", current_path.trim_end_matches('/'), name)
            };
            let child_is_dir = entry
                .metadata()
                .file_type()
                .map(|kind| kind.is_dir())
                .unwrap_or(false);

            if child_is_dir {
                stack.push((child_path, false));
            } else {
                let mut fs = sftp.fs();
                fs.remove_file(&child_path)
                    .await
                    .map_err(|error| format!("remove_file failed for {child_path}: {error}"))?;
            }
        }
    }

    Ok(())
}

fn permissions_to_mode(permissions: Permissions) -> u32 {
    let mut mode = 0u32;

    if permissions.suid() {
        mode |= 0o4000;
    }
    if permissions.sgid() {
        mode |= 0o2000;
    }
    if permissions.svtx() {
        mode |= 0o1000;
    }
    if permissions.read_by_owner() {
        mode |= 0o0400;
    }
    if permissions.write_by_owner() {
        mode |= 0o0200;
    }
    if permissions.execute_by_owner() {
        mode |= 0o0100;
    }
    if permissions.read_by_group() {
        mode |= 0o0040;
    }
    if permissions.write_by_group() {
        mode |= 0o0020;
    }
    if permissions.execute_by_group() {
        mode |= 0o0010;
    }
    if permissions.read_by_other() {
        mode |= 0o0004;
    }
    if permissions.write_by_other() {
        mode |= 0o0002;
    }
    if permissions.execute_by_other() {
        mode |= 0o0001;
    }

    mode
}

fn metadata_is_directory(metadata: &MetaData) -> Option<bool> {
    metadata.file_type().map(|kind| kind.is_dir())
}

fn metadata_mode(metadata: &MetaData) -> u32 {
    let permission_bits =
        metadata.permissions().map(permissions_to_mode).unwrap_or(0) & !MODE_TYPE_MASK;

    match metadata_is_directory(metadata) {
        Some(true) => MODE_TYPE_DIRECTORY | permission_bits,
        Some(false) => MODE_TYPE_FILE | permission_bits,
        None => permission_bits,
    }
}

async fn resolve_entry_metadata(
    sftp: &Sftp,
    remote_path: &str,
    metadata: MetaData,
) -> Result<MetaData, String> {
    if metadata.file_type().is_some() {
        return Ok(metadata);
    }

    stat_metadata(sftp, remote_path)
        .await
        .map_err(|error| format!("stat failed for {remote_path}: {error}"))
}

fn join_remote_path(parent: &str, child: &str) -> String {
    let normalized_parent = parent.trim_end_matches('/');
    if normalized_parent.is_empty() || normalized_parent == "." {
        return child.to_string();
    }
    if normalized_parent == "/" {
        return format!("/{child}");
    }
    format!("{normalized_parent}/{child}")
}

fn join_remote_relative_path(parent: &str, child: &str) -> String {
    if parent.is_empty() {
        return child.to_string();
    }
    format!("{parent}/{child}")
}

fn enrich_result_metadata(
    operation: Option<&str>,
    request_id: Option<&str>,
    result: Value,
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
            Value::Object(map)
        }
        other => json!({
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "operation": operation.unwrap_or("unknown"),
            "requestId": request_id,
            "value": other,
        }),
    }
}

fn emit_result(
    operation: Option<&str>,
    request_id: Option<&str>,
    result: serde_json::Value,
) -> Result<(), String> {
    let enriched = enrich_result_metadata(operation, request_id, result);
    println!(
        "{}",
        serde_json::to_string(&json!({
            "type": "result",
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "processType": SIDECAR_PROCESS_TYPE,
            "operation": operation.unwrap_or("unknown"),
            "requestId": request_id,
            "result": enriched,
        }))
        .map_err(|error| format!("failed to serialize result: {error}"))?
    );
    Ok(())
}

fn emit_error_result(
    operation: Option<&str>,
    request_id: Option<&str>,
    module: &str,
    message: &str,
) -> Result<(), String> {
    emit_result(
        operation,
        request_id,
        structured_error_value(operation, request_id, module, message),
    )
}

fn emit_watch_event(
    request_id: Option<&str>,
    event: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(&json!({
            "type": "watch",
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "processType": SIDECAR_PROCESS_TYPE,
            "requestId": request_id,
            "event": event,
            "payload": payload,
        }))
        .map_err(|error| format!("failed to serialize watch event: {error}"))?
    );
    Ok(())
}

fn emit_watch_error(
    operation: Option<&str>,
    request_id: Option<&str>,
    module: &str,
    message: &str,
) -> Result<(), String> {
    emit_watch_event(
        request_id,
        "error",
        structured_error_value(operation, request_id, module, message),
    )
}

fn structured_error_value(
    operation: Option<&str>,
    request_id: Option<&str>,
    module: &str,
    message: &str,
) -> serde_json::Value {
    let classification = classify_error(message);
    json!({
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
    })
}

fn structured_stderr_error(message: &str, operation: Option<&str>) -> String {
    serde_json::to_string(&structured_error_value(
        operation,
        None,
        SIDECAR_PROCESS_TYPE,
        message,
    ))
    .unwrap_or_else(|_| message.to_string())
}

struct ErrorClassification {
    error_code: &'static str,
    error_kind: &'static str,
    retryable: bool,
}

fn classify_error(message: &str) -> ErrorClassification {
    let lower = message.to_ascii_lowercase();

    if lower.contains("failed to parse request")
        || lower.contains("is required")
        || lower.contains("invalid base64")
        || lower.contains("invalid permissions")
        || lower.contains("invalid numeric id")
        || lower.contains("segment offset")
        || lower.contains("segment length")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_INVALID_REQUEST",
            error_kind: "validation",
            retryable: false,
        };
    }

    if lower.contains("unsupported") {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_UNSUPPORTED_OPERATION",
            error_kind: "unsupported",
            retryable: false,
        };
    }

    if lower.contains("authentication failed")
        || lower.contains("public key authentication")
        || lower.contains("password authentication")
        || lower.contains("missing ssh credentials")
        || lower.contains("decode private key")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_AUTH_FAILED",
            error_kind: "authentication",
            retryable: false,
        };
    }

    if lower.contains("permission denied") || lower.contains("access denied") {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_PERMISSION_DENIED",
            error_kind: "permission",
            retryable: false,
        };
    }

    if lower.contains("no such file")
        || lower.contains("not found")
        || lower.contains("path exists and is not a directory")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_NOT_FOUND",
            error_kind: "notFound",
            retryable: false,
        };
    }

    if lower.contains("timed out") || lower.contains("timeout") {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_TIMEOUT",
            error_kind: "timeout",
            retryable: true,
        };
    }

    if lower.contains("failed to connect")
        || lower.contains("connection reset")
        || lower.contains("connection refused")
        || lower.contains("connection closed")
        || lower.contains("network")
        || lower.contains("channel")
        || lower.contains("subsystem")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_NETWORK",
            error_kind: "network",
            retryable: true,
        };
    }

    if lower.contains("upload")
        || lower.contains("download")
        || lower.contains("read")
        || lower.contains("write")
        || lower.contains("flush")
        || lower.contains("shutdown")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_TRANSFER_FAILED",
            error_kind: "transfer",
            retryable: true,
        };
    }

    ErrorClassification {
        error_code: "NATIVE_SFTP_INTERNAL",
        error_kind: "internal",
        retryable: false,
    }
}

fn install_panic_hook() {
    panic::set_hook(Box::new(|info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|value| value.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "native sidecar panic".to_string());
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let payload = json!({
            "schemaVersion": 1,
            "generatedAt": current_timestamp_ms(),
            "module": "native-sidecar",
            "processType": "native-sidecar",
            "type": "panic",
            "reason": message,
            "location": location,
            "sidecarVersion": env!("CARGO_PKG_VERSION"),
            "platform": env::consts::OS,
            "arch": env::consts::ARCH,
            "pid": process::id(),
        });

        if let Ok(dir) = env::var("SIMPLESHELL_SIDECAR_CRASH_DIR") {
            let path = PathBuf::from(dir).join(format!(
                "native-sidecar-panic.{}.{}.json",
                current_timestamp_ms(),
                process::id()
            ));
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(content) = serde_json::to_string_pretty(&payload) {
                let _ = fs::write(path, content);
            }
        }

        eprintln!("{}", payload);
    }));
}

fn scan_folder(root: &Path, relative_base: &str, limits: ScanLimits) -> Result<ScanResult, String> {
    let normalized_root = root
        .canonicalize()
        .map_err(|error| format!("failed to resolve folder: {error}"))?;

    if !normalized_root.is_dir() {
        return Err(format!(
            "path is not a directory: {}",
            normalized_root.to_string_lossy()
        ));
    }

    let mut files = Vec::new();
    let mut directories = Vec::new();
    let mut errors = Vec::new();
    let mut total_size = 0u64;
    let mut stack = vec![(normalized_root.clone(), 0usize)];
    let normalized_base = normalize_relative_prefix(relative_base);
    let mut control = ScanControl::default();

    while let Some((current_dir, depth)) = stack.pop() {
        if control.truncated {
            break;
        }

        let read_dir = match fs::read_dir(&current_dir) {
            Ok(entries) => entries,
            Err(error) => {
                errors.push(ScanError {
                    path: current_dir.to_string_lossy().to_string(),
                    error: error.to_string(),
                });
                continue;
            }
        };

        for entry_result in read_dir {
            let entry = match entry_result {
                Ok(entry) => entry,
                Err(error) => {
                    errors.push(ScanError {
                        path: current_dir.to_string_lossy().to_string(),
                        error: error.to_string(),
                    });
                    continue;
                }
            };

            let entry_path = entry.path();
            let relative_path = match entry_path.strip_prefix(&normalized_root) {
                Ok(relative) => join_relative_path(&normalized_base, relative),
                Err(_) => join_relative_path(&normalized_base, Path::new(&entry.file_name())),
            };
            let metadata = match entry.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    errors.push(ScanError {
                        path: entry_path.to_string_lossy().to_string(),
                        error: error.to_string(),
                    });
                    continue;
                }
            };

            if metadata.is_dir() {
                directories.push(relative_path.clone());
                if should_stop_scan(
                    files.len(),
                    directories.len(),
                    total_size,
                    limits,
                    &mut control,
                ) {
                    break;
                }
                if let Some(max_depth) = limits.max_depth {
                    if depth >= max_depth {
                        control.truncated = true;
                        control.max_depth_hit = true;
                        control.truncated_reason = Some(format!("maxDepth {max_depth} reached"));
                        break;
                    }
                }
                stack.push((entry_path, depth + 1));
                continue;
            }

            if !metadata.is_file() {
                continue;
            }

            let file_size = metadata.len();
            total_size += file_size;

            let mtime = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);

            files.push(LocalFileEntry {
                local_path: entry_path.to_string_lossy().to_string(),
                relative_path,
                name: entry.file_name().to_string_lossy().to_string(),
                size: file_size,
                is_directory: false,
                mtime,
            });

            if should_stop_scan(
                files.len(),
                directories.len(),
                total_size,
                limits,
                &mut control,
            ) {
                break;
            }
        }
    }

    directories.sort();
    files.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    Ok(ScanResult {
        schema_version: SIDECAR_SCHEMA_VERSION,
        scan_id: create_scan_id("local"),
        root_path: normalized_root.to_string_lossy().to_string(),
        relative_base: normalized_base,
        generated_at: current_timestamp_ms(),
        truncated: control.truncated,
        truncated_reason: control.truncated_reason,
        max_entries_hit: control.max_entries_hit,
        max_depth_hit: control.max_depth_hit,
        max_bytes_hit: control.max_bytes_hit,
        total_size,
        file_count: files.len(),
        directory_count: directories.len(),
        files,
        directories,
        errors,
    })
}

fn normalize_relative_prefix(prefix: &str) -> String {
    prefix
        .trim_matches(|ch| ch == '/' || ch == '\\')
        .replace('\\', "/")
}

fn join_relative_path(base: &str, relative: &Path) -> String {
    let mut normalized = relative.to_string_lossy().replace('\\', "/");
    if !base.is_empty() {
        normalized = format!("{base}/{normalized}");
    }
    normalized
}
