use crate::ops::*;
use crate::protocol::*;
use openssh_sftp_client::Sftp;
use serde_json::json;
use std::time::Duration;

pub(crate) fn update_signature_bytes(hash: &mut u64, bytes: &[u8]) {
    const FNV_PRIME: u64 = 1099511628211;
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(FNV_PRIME);
    }
    *hash ^= 0xff;
    *hash = hash.wrapping_mul(FNV_PRIME);
}

pub(crate) fn update_signature_u64(hash: &mut u64, value: u64) {
    update_signature_bytes(hash, &value.to_le_bytes());
}

pub(crate) fn compute_directory_signature(entries: &[RemoteFileEntry]) -> String {
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

pub(crate) async fn watch_directory(sftp: &Sftp, request: &SftpRequest) -> Result<(), String> {
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
