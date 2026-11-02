//! Panic reporting. Inside the resident core a panic only ends the stream that
//! raised it (tokio isolates the task); the hook records a crash marker for the
//! supervisor and writes a structured line to stderr.

use serde_json::json;
use std::env;
use std::fs;
use std::panic;
use std::path::PathBuf;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

fn timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub fn payload_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<&str>()
        .map(|value| value.to_string())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "native core panic".to_string())
}

pub fn install_hook() {
    panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "unknown".to_string());
        let payload = json!({
            "schemaVersion": 1,
            "generatedAt": timestamp_ms() as u64,
            "module": "native-core",
            "processType": "native-sidecar",
            "type": "panic",
            "reason": payload_message(info.payload()),
            "location": location,
            "sidecarVersion": env!("CARGO_PKG_VERSION"),
            "platform": env::consts::OS,
            "arch": env::consts::ARCH,
            "pid": process::id(),
        });

        if let Ok(dir) = env::var("SIMPLESHELL_SIDECAR_CRASH_DIR") {
            let path = PathBuf::from(dir).join(format!(
                "native-sidecar-panic.{}.{}.json",
                timestamp_ms(),
                process::id()
            ));
            if let Some(parent) = path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if let Ok(content) = serde_json::to_string_pretty(&payload) {
                let _ = fs::write(path, content);
            }
        }

        eprintln!("{payload}");
    }));
}
