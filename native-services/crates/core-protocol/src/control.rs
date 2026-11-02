//! JSON control messages carried by `FrameKind::Control` frames.
//!
//! Every message has `schemaVersion` and an `op` tag. The supervisor checks the
//! version in `ready`; unknown ops are rejected with an `error` message instead
//! of tearing down the connection.

use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Control {
    /// core -> JS once the frame loop is running.
    Ready {
        version: String,
        pid: u32,
        role: String,
        services: Vec<String>,
    },
    /// JS -> core: start `service` as stream `stream` (a "virtual child process").
    Open {
        stream: u32,
        service: String,
        #[serde(default)]
        args: Vec<String>,
    },
    /// JS -> core: the stream's stdin was closed.
    Eof {
        stream: u32,
    },
    /// JS -> core: terminate the stream and all tasks it spawned.
    Kill {
        stream: u32,
    },
    /// core -> JS: the stream finished. `code` is `None` when it was killed.
    Exit {
        stream: u32,
        code: Option<i32>,
        signal: Option<String>,
        error: Option<String>,
    },
    Ping {
        id: u64,
    },
    Pong {
        id: u64,
    },
    /// core -> JS: a malformed or unsupported control message.
    Error {
        stream: Option<u32>,
        message: String,
    },
    /// JS -> core: stop every stream and exit.
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlEnvelope {
    pub schema_version: u32,
    #[serde(flatten)]
    pub message: Control,
}

impl ControlEnvelope {
    pub fn new(message: Control) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            message,
        }
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("control messages always serialize")
    }

    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        let envelope: Self = serde_json::from_slice(bytes)
            .map_err(|error| format!("invalid control message: {error}"))?;
        if envelope.schema_version != SCHEMA_VERSION {
            return Err(format!(
                "unsupported control schemaVersion {} (expected {SCHEMA_VERSION})",
                envelope.schema_version
            ));
        }
        Ok(envelope)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_version_and_camel_case_fields() {
        let bytes = ControlEnvelope::new(Control::Exit {
            stream: 4,
            code: None,
            signal: Some("SIGTERM".into()),
            error: None,
        })
        .to_bytes();
        let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["schemaVersion"], 1);
        assert_eq!(value["op"], "exit");
        assert_eq!(value["stream"], 4);
        assert_eq!(value["signal"], "SIGTERM");
    }

    #[test]
    fn parses_open_with_default_args() {
        let parsed = ControlEnvelope::parse(
            br#"{"schemaVersion":1,"op":"open","stream":2,"service":"zmodem-serve"}"#,
        )
        .unwrap();
        assert_eq!(
            parsed.message,
            Control::Open {
                stream: 2,
                service: "zmodem-serve".into(),
                args: Vec::new(),
            }
        );
        assert_eq!(
            ControlEnvelope::parse(br#"{"schemaVersion":1,"op":"shutdown"}"#)
                .unwrap()
                .message,
            Control::Shutdown
        );
    }

    #[test]
    fn rejects_other_versions_and_unknown_ops() {
        assert!(ControlEnvelope::parse(br#"{"schemaVersion":2,"op":"ping","id":1}"#).is_err());
        assert!(ControlEnvelope::parse(br#"{"schemaVersion":1,"op":"reboot"}"#).is_err());
    }
}
