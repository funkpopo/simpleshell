use crate::checksum::*;
use crate::errors::*;
use crate::protocol::*;
use crate::scan::*;
use crate::transfer::*;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use futures_util::StreamExt;
use openssh_sftp_client::file::OpenOptions;
use openssh_sftp_client::metadata::{MetaData, MetaDataBuilder, Permissions};
use openssh_sftp_client::Sftp;
use serde_json::{json, Value};
use std::time::Instant;

pub(crate) const MODE_TYPE_MASK: u32 = 0o170000;

pub(crate) const MODE_TYPE_DIRECTORY: u32 = 0o040000;

pub(crate) const MODE_TYPE_FILE: u32 = 0o100000;

pub(crate) const PERMISSION_BATCH_CONCURRENCY: usize = 8;

pub(crate) async fn execute_request(
    sftp: &Sftp,
    request: &SftpRequest,
    operation: SftpOperation,
) -> Result<serde_json::Value, String> {
    match operation {
        SftpOperation::StatFile => {
            let path = required_path(request.path.as_deref(), "path")?;
            Ok(json!({ "success": true, "stats": stat_path(sftp, path).await? }))
        }
        SftpOperation::ChecksumFile => {
            let path = required_path(request.path.as_deref(), "path")?;
            let algorithm = required_path(request.algorithm.as_deref(), "algorithm")?;
            let digest = checksum_remote_file(
                sftp,
                path,
                algorithm,
                request.segment_offset,
                request.segment_length,
            )
            .await?;
            Ok(json!({ "success": true, "algorithm": algorithm, "digest": digest }))
        }
        SftpOperation::ListFiles => {
            let path = resolve_directory_path(request.path.as_deref());
            let entries = list_files_internal(
                sftp,
                &path,
                request.request_id.as_deref(),
                request.stream_list.unwrap_or(false),
            )
            .await?;
            Ok(json!({
                "success": true,
                "data": entries,
            }))
        }
        SftpOperation::ScanRemoteFolderTree => {
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
        SftpOperation::CopyFile => {
            let source = required_path(request.source_path.as_deref(), "sourcePath")?;
            let target = required_path(request.target_path.as_deref(), "targetPath")?;
            copy_file(sftp, source, target).await?;
            Ok(json!({ "success": true }))
        }
        SftpOperation::MoveFile | SftpOperation::RenameFile => {
            let source = required_path(request.source_path.as_deref(), "sourcePath")?;
            let target = required_path(request.target_path.as_deref(), "targetPath")?;
            let mut fs = sftp.fs();
            fs.rename(source, target)
                .await
                .map_err(|error| format!("rename failed: {error}"))?;
            Ok(json!({ "success": true }))
        }
        SftpOperation::DeleteFile => {
            let path = required_path(request.path.as_deref(), "path")?;
            delete_path_recursive(sftp, path, request.is_directory.unwrap_or(false)).await?;
            Ok(json!({ "success": true }))
        }
        SftpOperation::CreateFolder | SftpOperation::CreateRemoteFolders => {
            let path = required_path(request.path.as_deref(), "path")?;
            create_remote_folders(sftp, path).await?;
            Ok(json!({ "success": true }))
        }
        SftpOperation::CreateFile => {
            let path = required_path(request.path.as_deref(), "path")?;
            create_file(sftp, path).await?;
            Ok(json!({ "success": true }))
        }
        SftpOperation::GetFilePermissions => {
            let path = required_path(request.path.as_deref(), "path")?;
            get_file_permissions(sftp, path).await
        }
        SftpOperation::GetFilePermissionsBatch => {
            let paths = request.paths.as_deref().ok_or("paths is required")?;
            // 同一 SFTP 通道内有界并发，buffered 保留输入顺序和逐项错误。
            let pending: Vec<_> = paths
                .iter()
                .map(|path| permission_batch_entry(sftp, path))
                .collect();
            let results: Vec<Value> = futures_util::stream::iter(pending)
                .buffered(PERMISSION_BATCH_CONCURRENCY)
                .collect()
                .await;
            Ok(json!({ "success": true, "results": results }))
        }
        SftpOperation::GetAbsolutePath => {
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
        SftpOperation::ReadFileContent => {
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
        SftpOperation::ReadFileAsBase64 => {
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
        SftpOperation::SaveFileContent => {
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
        SftpOperation::UploadFileToRemote => {
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
                request.ensure_parent_directories.unwrap_or(false),
            )
            .await?;
            Ok(json!({
                "success": true,
                "transferredBytes": result,
                "totalBytes": result,
            }))
        }
        SftpOperation::DownloadFileToLocal => {
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
        SftpOperation::SetFilePermissions => {
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
        SftpOperation::SetFileOwnership => {
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
        SftpOperation::WatchDirectory => {
            Err("unsupported native SFTP operation for request mode: watchDirectory".to_string())
        }
    }
}

/// One `getFilePermissionsBatch` result; failures stay per item.
async fn permission_batch_entry(sftp: &Sftp, path: &str) -> Value {
    let result = match required_path(Some(path), "path") {
        Ok(path) => get_file_permissions(sftp, path).await,
        Err(error) => Err(error),
    };
    let mut value = match result {
        Ok(value) => value,
        Err(error) => {
            let classification = classify_error(&error);
            json!({
                "success": false,
                "error": error,
                "errorCode": classification.error_code,
                "errorKind": classification.error_kind,
                "retryable": classification.retryable,
            })
        }
    };
    value["path"] = json!(path);
    value
}

pub(crate) fn required_path<'a>(
    value: Option<&'a str>,
    field_name: &str,
) -> Result<&'a str, String> {
    value
        .filter(|item| !item.trim().is_empty())
        .ok_or_else(|| format!("{field_name} is required"))
}

pub(crate) fn resolve_directory_path(value: Option<&str>) -> String {
    // Directory names may start or end with spaces. Only an absent/empty path
    // means the SFTP session's initial directory.
    let normalized = value.unwrap_or("");
    if normalized.is_empty() {
        ".".to_string()
    } else {
        normalized.to_string()
    }
}

pub(crate) fn parse_numeric_id(value: &str) -> Result<u32, String> {
    value
        .trim()
        .parse::<u32>()
        .map_err(|error| format!("invalid numeric id: {error}"))
}

pub(crate) async fn list_files(
    sftp: &Sftp,
    remote_path: &str,
) -> Result<Vec<RemoteFileEntry>, String> {
    list_files_internal(sftp, remote_path, None, false).await
}

pub(crate) async fn list_files_internal(
    sftp: &Sftp,
    remote_path: &str,
    request_id: Option<&str>,
    stream_chunks: bool,
) -> Result<Vec<RemoteFileEntry>, String> {
    let mut fs = sftp.fs();
    let dir = fs
        .open_dir(remote_path)
        .await
        .map_err(|error| format!("open_dir failed: {error}"))?;
    let read_dir = dir.read_dir();
    futures_util::pin_mut!(read_dir);
    let mut entries = Vec::new();
    let mut emitted_first_chunk = false;
    let list_started_at = Instant::now();

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

        if stream_chunks && entries.len() >= 100 {
            let chunk = std::mem::take(&mut entries);
            if !emitted_first_chunk {
                emit_stage(
                    request_id,
                    "firstProgress",
                    list_started_at.elapsed().as_millis() as u64,
                )?;
                emitted_first_chunk = true;
            }
            emit_list_chunk(request_id, chunk, false)?;
        }
    }

    if stream_chunks {
        if !emitted_first_chunk {
            emit_stage(
                request_id,
                "firstProgress",
                list_started_at.elapsed().as_millis() as u64,
            )?;
        }
        emit_list_chunk(request_id, entries, true)?;
        return Ok(Vec::new());
    }

    Ok(entries)
}

pub(crate) async fn copy_file(
    sftp: &Sftp,
    source_path: &str,
    target_path: &str,
) -> Result<(), String> {
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

pub(crate) async fn create_file(sftp: &Sftp, remote_path: &str) -> Result<(), String> {
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

pub(crate) async fn get_file_permissions(sftp: &Sftp, remote_path: &str) -> Result<Value, String> {
    let stat = stat_path(sftp, remote_path).await?;
    Ok(json!({
        "success": true,
        "permissions": stat.permissions,
        "mode": stat.mode,
        "uid": stat.uid,
        "gid": stat.gid,
        "stats": stat,
    }))
}

pub(crate) async fn stat_metadata(sftp: &Sftp, remote_path: &str) -> Result<MetaData, String> {
    let mut fs = sftp.fs();
    fs.metadata(remote_path)
        .await
        .map_err(|error| format!("stat failed: {error}"))
}

pub(crate) async fn stat_path(sftp: &Sftp, remote_path: &str) -> Result<RemoteFileStat, String> {
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

pub(crate) async fn create_remote_folders(sftp: &Sftp, remote_path: &str) -> Result<(), String> {
    let is_absolute = remote_path.starts_with('/');
    let mut current_path = if is_absolute {
        "/".to_string()
    } else {
        String::new()
    };

    for part in remote_path.split('/').filter(|part| !part.is_empty()) {
        if current_path.is_empty() || current_path == "/" {
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
                if let Err(error) = fs.create_dir(&probe_path).await {
                    let mut verify_fs = sftp.fs();
                    let verify_metadata = verify_fs
                        .metadata(&probe_path)
                        .await
                        .map_err(|_| format!("mkdir failed for {probe_path}: {error}"))?;
                    let is_dir = verify_metadata
                        .file_type()
                        .map(|kind| kind.is_dir())
                        .unwrap_or(false);
                    if !is_dir {
                        return Err(format!("path exists and is not a directory: {probe_path}"));
                    }
                }
            }
        }
    }

    Ok(())
}

pub(crate) async fn delete_path_recursive(
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

pub(crate) fn permissions_to_mode(permissions: Permissions) -> u32 {
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

pub(crate) fn metadata_is_directory(metadata: &MetaData) -> Option<bool> {
    metadata.file_type().map(|kind| kind.is_dir())
}

pub(crate) fn metadata_mode(metadata: &MetaData) -> u32 {
    let permission_bits =
        metadata.permissions().map(permissions_to_mode).unwrap_or(0) & !MODE_TYPE_MASK;

    match metadata_is_directory(metadata) {
        Some(true) => MODE_TYPE_DIRECTORY | permission_bits,
        Some(false) => MODE_TYPE_FILE | permission_bits,
        None => permission_bits,
    }
}

pub(crate) async fn resolve_entry_metadata(
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

pub(crate) fn join_remote_path(parent: &str, child: &str) -> String {
    let normalized_parent = parent.trim_end_matches('/');
    if normalized_parent.is_empty() || normalized_parent == "." {
        return child.to_string();
    }
    if normalized_parent == "/" {
        return format!("/{child}");
    }
    format!("{normalized_parent}/{child}")
}

pub(crate) fn join_remote_relative_path(parent: &str, child: &str) -> String {
    if parent.is_empty() {
        return child.to_string();
    }
    format!("{parent}/{child}")
}
