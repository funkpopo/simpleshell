use crate::ops::*;
use crate::protocol::*;
use crate::transfer::*;
use md5::Md5;
use openssh_sftp_client::file::TokioCompatFile;
use openssh_sftp_client::Sftp;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::env;
use tokio::io::{self, AsyncReadExt, AsyncSeekExt};

pub(crate) async fn hash_reader<R: io::AsyncRead + Unpin, D: Digest + Default>(
    reader: &mut R,
) -> Result<String, String> {
    let mut hash = D::default();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|error| format!("checksum read failed: {error}"))?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

pub(crate) async fn checksum_remote_file(
    sftp: &Sftp,
    path: &str,
    algorithm: &str,
    offset: Option<u64>,
    length: Option<u64>,
) -> Result<String, String> {
    if algorithm != "md5" && algorithm != "sha256" {
        return Err(format!("unsupported checksum algorithm: {algorithm}"));
    }
    let before = stat_path(sftp, path).await?;
    if before.is_directory {
        return Err("checksum requires a regular file".to_string());
    }
    let file = sftp
        .open(path)
        .await
        .map_err(|error| format!("checksum open failed: {error}"))?;
    let reader = TokioCompatFile::new(file);
    futures_util::pin_mut!(reader);
    let (offset, length) = resolve_transfer_window(before.size, offset, length)?;
    reader
        .as_mut()
        .seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|error| format!("checksum seek failed: {error}"))?;
    let mut reader = reader.take(length);
    let digest = match algorithm {
        "md5" => hash_reader::<_, Md5>(&mut reader).await?,
        "sha256" => hash_reader::<_, Sha256>(&mut reader).await?,
        _ => unreachable!(),
    };
    if reader.limit() != 0 {
        return Err("checksum source truncated while reading".to_string());
    }
    let after = stat_path(sftp, path).await?;
    if before.size != after.size || before.modify_time != after.modify_time {
        return Err("checksum source changed while reading".to_string());
    }
    Ok(digest)
}

// ------------------------- 本地校验和一次性命令 -------------------------
// checksum-file --path <absolute-path> --algorithm <md5|sha256> [--offset <bytes>] [--length <bytes>]
// stdout 恰好输出一行 JSON；成功退出码 0，业务/参数错误退出码非 0 且仍输出结构化失败。

pub(crate) struct ChecksumFileInvocation {
    pub(crate) path: String,
    pub(crate) algorithm: String,
    pub(crate) offset: Option<u64>,
    pub(crate) length: Option<u64>,
}

pub(crate) fn parse_checksum_file_args(
    mut args: impl Iterator<Item = String>,
) -> Result<ChecksumFileInvocation, String> {
    let mut path: Option<String> = None;
    let mut algorithm: Option<String> = None;
    let mut offset: Option<u64> = None;
    let mut length: Option<u64> = None;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--path" => {
                path = Some(args.next().ok_or("--path requires a value")?);
            }
            "--algorithm" => {
                algorithm = Some(args.next().ok_or("--algorithm requires a value")?);
            }
            "--offset" => {
                let value = args
                    .next()
                    .ok_or("--offset requires a value")?
                    .parse::<u64>()
                    .map_err(|error| format!("invalid --offset: {error}"))?;
                offset = Some(value);
            }
            "--length" => {
                let value = args
                    .next()
                    .ok_or("--length requires a value")?
                    .parse::<u64>()
                    .map_err(|error| format!("invalid --length: {error}"))?;
                length = Some(value);
            }
            other => return Err(format!("unsupported checksum-file argument: {other}")),
        }
    }

    Ok(ChecksumFileInvocation {
        path: path.ok_or("--path is required")?,
        algorithm: algorithm.ok_or("--algorithm is required")?,
        offset,
        length,
    })
}

/// Reports a checksum failure on stdout. The caller exits with status 1; the
/// empty error string tells the host not to repeat it on stderr.
pub(crate) fn emit_checksum_file_error(
    message: &str,
    error_code: &str,
    error_kind: &str,
    retryable: bool,
) -> String {
    let _ = emit_stdout_line(
        serde_json::to_string(&json!({
            "schemaVersion": SIDECAR_SCHEMA_VERSION,
            "success": false,
            "error": message,
            "errorCode": error_code,
            "errorKind": error_kind,
            "retryable": retryable,
            "sidecarVersion": env!("CARGO_PKG_VERSION"),
            "timestamp": current_timestamp_ms(),
        }))
        .unwrap_or_else(|_| "{}".to_string()),
    );
    String::new()
}

/// 计算本地文件的校验和；错误以 (message, errorCode, errorKind) 返回。
pub(crate) async fn compute_local_checksum(
    invocation: &ChecksumFileInvocation,
) -> Result<serde_json::Value, (String, &'static str, &'static str)> {
    if invocation.algorithm != "md5" && invocation.algorithm != "sha256" {
        return Err((
            format!("unsupported checksum algorithm: {}", invocation.algorithm),
            "CHECKSUM_UNSUPPORTED_ALGORITHM",
            "unsupported",
        ));
    }

    let before = tokio::fs::metadata(&invocation.path)
        .await
        .map_err(|error| {
            (
                format!("checksum source open failed: {error}"),
                "CHECKSUM_SOURCE_UNAVAILABLE",
                "io",
            )
        })?;
    if !before.is_file() {
        return Err((
            "checksum requires a regular file".to_string(),
            "CHECKSUM_INVALID_REQUEST",
            "validation",
        ));
    }

    // 区间校验：offset <= size 且 length <= size - offset，不默默截断越界请求。
    let (offset, length) =
        resolve_transfer_window(before.len(), invocation.offset, invocation.length)
            .map_err(|message| (message, "CHECKSUM_INVALID_REQUEST", "validation"))?;

    let mut file = tokio::fs::File::open(&invocation.path)
        .await
        .map_err(|error| {
            (
                format!("checksum source open failed: {error}"),
                "CHECKSUM_SOURCE_UNAVAILABLE",
                "io",
            )
        })?;
    file.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|error| {
            (
                format!("checksum seek failed: {error}"),
                "CHECKSUM_READ_FAILED",
                "io",
            )
        })?;

    let mut reader = file.take(length);
    let digest = match invocation.algorithm.as_str() {
        "md5" => hash_reader::<_, Md5>(&mut reader).await,
        "sha256" => hash_reader::<_, Sha256>(&mut reader).await,
        _ => unreachable!(),
    }
    .map_err(|message| (message, "CHECKSUM_READ_FAILED", "io"))?;

    if reader.limit() != 0 {
        return Err((
            "checksum source truncated while reading".to_string(),
            "CHECKSUM_SOURCE_TRUNCATED",
            "io",
        ));
    }

    let after = tokio::fs::metadata(&invocation.path)
        .await
        .map_err(|error| {
            (
                format!("checksum source open failed: {error}"),
                "CHECKSUM_SOURCE_UNAVAILABLE",
                "io",
            )
        })?;
    let before_mtime = before.modified().ok();
    let after_mtime = after.modified().ok();
    if before.len() != after.len() || before_mtime != after_mtime {
        return Err((
            "checksum source changed while reading".to_string(),
            "CHECKSUM_SOURCE_CHANGED",
            "source-changed",
        ));
    }

    Ok(json!({
        "schemaVersion": SIDECAR_SCHEMA_VERSION,
        "success": true,
        "algorithm": invocation.algorithm,
        "digest": digest,
        "bytesHashed": length,
    }))
}

pub async fn run_checksum_file(args: impl Iterator<Item = String>) -> Result<(), String> {
    let result = match parse_checksum_file_args(args) {
        Ok(invocation) => compute_local_checksum(&invocation).await,
        Err(error) => Err((error, "CHECKSUM_INVALID_REQUEST", "validation")),
    };
    match result {
        Ok(value) => emit_stdout_line(
            serde_json::to_string(&value)
                .map_err(|error| format!("failed to serialize checksum result: {error}"))?,
        ),
        Err((message, error_code, error_kind)) => Err(emit_checksum_file_error(
            &message, error_code, error_kind, false,
        )),
    }
}
