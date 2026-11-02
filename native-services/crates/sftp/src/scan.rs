use crate::ops::*;
use crate::protocol::*;
use futures_util::StreamExt;
use openssh_sftp_client::Sftp;
use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalFileEntry {
    pub(crate) local_path: String,
    pub(crate) relative_path: String,
    pub(crate) name: String,
    pub(crate) size: u64,
    pub(crate) is_directory: bool,
    pub(crate) mtime: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanError {
    pub(crate) path: String,
    pub(crate) error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScanResult {
    pub(crate) schema_version: u32,
    pub(crate) scan_id: String,
    pub(crate) root_path: String,
    pub(crate) relative_base: String,
    pub(crate) generated_at: u64,
    pub(crate) truncated: bool,
    pub(crate) truncated_reason: Option<String>,
    pub(crate) max_entries_hit: bool,
    pub(crate) max_depth_hit: bool,
    pub(crate) max_bytes_hit: bool,
    pub(crate) total_size: u64,
    pub(crate) file_count: usize,
    pub(crate) directory_count: usize,
    pub(crate) files: Vec<LocalFileEntry>,
    pub(crate) directories: Vec<String>,
    pub(crate) errors: Vec<ScanError>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteFolderFileEntry {
    pub(crate) remote_path: String,
    pub(crate) relative_path: String,
    pub(crate) file_name: String,
    pub(crate) size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteFolderScanResult {
    pub(crate) schema_version: u32,
    pub(crate) scan_id: String,
    pub(crate) root_path: String,
    pub(crate) generated_at: u64,
    pub(crate) truncated: bool,
    pub(crate) truncated_reason: Option<String>,
    pub(crate) max_entries_hit: bool,
    pub(crate) max_depth_hit: bool,
    pub(crate) max_bytes_hit: bool,
    pub(crate) total_bytes: u64,
    pub(crate) file_count: usize,
    pub(crate) directory_count: usize,
    pub(crate) files: Vec<RemoteFolderFileEntry>,
    pub(crate) directories: Vec<String>,
    pub(crate) errors: Vec<ScanError>,
}

#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct ScanLimits {
    pub(crate) max_entries: Option<usize>,
    pub(crate) max_depth: Option<usize>,
    pub(crate) max_bytes: Option<u64>,
}

#[derive(Debug, Default)]
pub(crate) struct ScanControl {
    pub(crate) truncated: bool,
    pub(crate) truncated_reason: Option<String>,
    pub(crate) max_entries_hit: bool,
    pub(crate) max_depth_hit: bool,
    pub(crate) max_bytes_hit: bool,
}

pub async fn run_scan_folder(mut args: impl Iterator<Item = String>) -> Result<(), String> {
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
                emit_stdout_line(env!("CARGO_PKG_VERSION").to_string())?;
                return Ok(());
            }
            other => return Err(format!("unsupported argument: {other}")),
        }
    }

    let folder = folder_path.ok_or_else(|| "--path is required".to_string())?;
    // The walk is blocking filesystem IO; keep it off the async workers.
    let result = tokio::task::spawn_blocking(move || {
        scan_folder(
            &folder,
            &relative_base,
            ScanLimits {
                max_entries,
                max_depth,
                max_bytes,
            },
        )
    })
    .await
    .map_err(|error| format!("folder scan task failed: {error}"))??;
    let json =
        serde_json::to_string(&result).map_err(|error| format!("failed to serialize: {error}"))?;
    emit_stdout_line(json)?;
    Ok(())
}

pub(crate) fn create_scan_id(prefix: &str) -> String {
    format!("{prefix}-{}-{}", current_timestamp_ms(), process::id())
}

pub(crate) fn should_stop_scan(
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

pub(crate) async fn scan_remote_folder_tree(
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

pub(crate) fn scan_folder(
    root: &Path,
    relative_base: &str,
    limits: ScanLimits,
) -> Result<ScanResult, String> {
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

pub(crate) fn normalize_relative_prefix(prefix: &str) -> String {
    prefix
        .trim_matches(|ch| ch == '/' || ch == '\\')
        .replace('\\', "/")
}

pub(crate) fn join_relative_path(base: &str, relative: &Path) -> String {
    let mut normalized = relative.to_string_lossy().replace('\\', "/");
    if !base.is_empty() {
        normalized = format!("{base}/{normalized}");
    }
    normalized
}
