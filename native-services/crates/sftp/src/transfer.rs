use crate::ops::*;
use crate::protocol::*;
use openssh_sftp_client::file::{OpenOptions, TokioCompatFile};
use openssh_sftp_client::Sftp;
use std::cmp::min;
use std::path::Path;
use tokio::fs::OpenOptions as TokioOpenOptions;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

pub(crate) fn resolve_transfer_window(
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

pub(crate) fn remote_upload_open_options(sftp: &Sftp, flags: Option<&str>) -> OpenOptions {
    let mut options: OpenOptions = sftp.options();
    let normalized = flags.unwrap_or("").trim().to_ascii_lowercase();

    if normalized.contains('a') {
        options.write(true).append(true).create(true);
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
        options.read(true).write(true).create(true);
        return options;
    }

    options.write(true).create(true).truncate(true);
    options
}

pub(crate) fn local_download_open_options(flags: Option<&str>) -> TokioOpenOptions {
    let normalized = flags.unwrap_or("").trim().to_ascii_lowercase();
    let mut options = TokioOpenOptions::new();

    if normalized.contains('a') {
        options.append(true).create(true);
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
        options.read(true).write(true).create(true);
        return options;
    }

    options.write(true).create(true).truncate(true);
    options
}

#[allow(clippy::too_many_arguments)] // mirrors the request fields one to one
pub(crate) async fn upload_local_file(
    sftp: &Sftp,
    request_id: Option<&str>,
    local_path: &str,
    remote_path: &str,
    segment_offset: Option<u64>,
    segment_length: Option<u64>,
    remote_write_flags: Option<&str>,
    ensure_parent_directories: bool,
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

    if ensure_parent_directories {
        if let Some(parent) = Path::new(remote_path).parent() {
            let parent_path = parent.to_string_lossy();
            if !parent_path.is_empty() && parent_path != "." {
                create_remote_folders(sftp, &parent_path).await?;
            }
        }
    }

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

pub(crate) async fn download_remote_file(
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
    local_file
        .sync_all()
        .await
        .map_err(|error| format!("sync local file failed: {error}"))?;

    Ok(transferred)
}
