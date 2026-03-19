use serde::Serialize;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    local_path: String,
    relative_path: String,
    name: String,
    size: u64,
    is_directory: bool,
    mtime: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanError {
    path: String,
    error: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    total_size: u64,
    file_count: usize,
    files: Vec<FileEntry>,
    errors: Vec<ScanError>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args
        .next()
        .ok_or_else(|| "missing command, expected scan-folder".to_string())?;

    match command.as_str() {
        "scan-folder" => {
            let mut folder_path: Option<PathBuf> = None;
            let mut relative_base = String::new();

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
                    "--version" => {
                        println!("{}", env!("CARGO_PKG_VERSION"));
                        return Ok(());
                    }
                    other => {
                        return Err(format!("unsupported argument: {other}"));
                    }
                }
            }

            let folder = folder_path.ok_or_else(|| "--path is required".to_string())?;
            let result = scan_folder(&folder, &relative_base)?;
            let json = serde_json::to_string(&result)
                .map_err(|error| format!("failed to serialize result: {error}"))?;
            println!("{json}");
            Ok(())
        }
        "--version" => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        other => Err(format!("unsupported command: {other}")),
    }
}

fn scan_folder(root: &Path, relative_base: &str) -> Result<ScanResult, String> {
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
    let mut errors = Vec::new();
    let mut total_size = 0u64;
    let mut stack = vec![normalized_root.clone()];
    let normalized_base = normalize_relative_prefix(relative_base);

    while let Some(current_dir) = stack.pop() {
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
                stack.push(entry_path);
                continue;
            }

            if !metadata.is_file() {
                continue;
            }

            let relative_path = match entry_path.strip_prefix(&normalized_root) {
                Ok(relative) => join_relative_path(&normalized_base, relative),
                Err(_) => join_relative_path(&normalized_base, Path::new(&entry.file_name())),
            };
            let file_size = metadata.len();
            total_size += file_size;

            let mtime = metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);

            files.push(FileEntry {
                local_path: entry_path.to_string_lossy().to_string(),
                relative_path,
                name: entry.file_name().to_string_lossy().to_string(),
                size: file_size,
                is_directory: false,
                mtime,
            });
        }
    }

    Ok(ScanResult {
        total_size,
        file_count: files.len(),
        files,
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
