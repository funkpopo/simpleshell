//! Connection settings as sent by the main process, and the identity that
//! decides which requests may share one SSH connection.

use crate::hostkey::{hex, normalize_fingerprint};
use netutil::ProxyConfig;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;

/// Algorithm names in preference order (the shape of `sshAlgorithms.js`).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlgorithmNames {
    #[serde(default)]
    pub kex: Vec<String>,
    #[serde(default)]
    pub server_host_key: Vec<String>,
    #[serde(default)]
    pub cipher: Vec<String>,
    #[serde(default)]
    pub hmac: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectConfig {
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    /// Pins the host key. Without it the caller must supply a verifier.
    pub expected_host_fingerprint: Option<String>,
    pub proxy: Option<ProxyConfig>,
    pub proxy_required: Option<bool>,
    /// Agent socket / named pipe path, or `pageant`.
    pub agent: Option<String>,
    /// Authenticate with agent identities (default: when `agent` is set).
    pub agent_auth: Option<bool>,
    /// Forward the agent on session channels that request it.
    pub agent_forward: Option<bool>,
    /// Allow keyboard-interactive authentication (needs a responder).
    pub try_keyboard: Option<bool>,
    pub algorithms: Option<AlgorithmNames>,
    pub keepalive_interval_ms: Option<u64>,
    pub keepalive_count_max: Option<usize>,
    pub ready_timeout_ms: Option<u64>,
}

/// Opaque identity of a connection: target, user and network path. As with
/// OpenSSH connection multiplexing, an authenticated connection is shared by
/// every consumer for the same account, whichever credentials or host-key
/// policy each consumer brings; host-key policies are still checked against
/// the key the connection verified.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnectionKey(String);

impl ConnectionKey {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

pub(crate) const DEFAULT_READY_TIMEOUT: Duration = Duration::from_secs(20);
pub(crate) const DEFAULT_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);
pub(crate) const DEFAULT_KEEPALIVE_MAX: usize = 3;

impl ConnectConfig {
    pub fn port(&self) -> u16 {
        self.port.unwrap_or(22)
    }

    /// The pinned fingerprint in `SHA256:<hex>` form, if any.
    pub fn pinned_fingerprint(&self) -> Option<String> {
        self.expected_host_fingerprint
            .as_deref()
            .and_then(normalize_fingerprint)
    }

    pub fn uses_agent_auth(&self) -> bool {
        self.agent.is_some() && self.agent_auth.unwrap_or(true)
    }

    pub(crate) fn ready_timeout(&self) -> Duration {
        self.ready_timeout_ms
            .map(Duration::from_millis)
            .unwrap_or(DEFAULT_READY_TIMEOUT)
    }

    pub(crate) fn keepalive_interval(&self) -> Duration {
        self.keepalive_interval_ms
            .filter(|ms| *ms > 0)
            .map(Duration::from_millis)
            .unwrap_or(DEFAULT_KEEPALIVE_INTERVAL)
    }

    pub(crate) fn keepalive_max(&self) -> usize {
        self.keepalive_count_max
            .filter(|count| *count > 0)
            .unwrap_or(DEFAULT_KEEPALIVE_MAX)
    }

    pub fn key(&self) -> ConnectionKey {
        let mut digest = Sha256::new();
        let mut field = |value: &str| {
            digest.update((value.len() as u64).to_le_bytes());
            digest.update(value.as_bytes());
        };
        field(&self.host.to_ascii_lowercase());
        field(&self.port().to_string());
        field(&self.username);
        field(if self.proxy_required.unwrap_or(false) {
            "1"
        } else {
            "0"
        });
        match &self.proxy {
            Some(proxy) => {
                field(&proxy.r#type.trim().to_ascii_lowercase());
                field(&proxy.host);
                field(&proxy.port.to_string());
                field(proxy.username.as_deref().unwrap_or(""));
                field(proxy.password.as_deref().unwrap_or(""));
            }
            None => field("direct"),
        }
        ConnectionKey(hex(&digest.finalize()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ConnectConfig {
        ConnectConfig {
            host: "Example.com".into(),
            username: "root".into(),
            password: Some("secret".into()),
            expected_host_fingerprint: Some("abc".into()),
            ..ConnectConfig::default()
        }
    }

    #[test]
    fn key_is_target_user_and_network_path() {
        let base = config().key();
        let mut same = config();
        same.host = "example.com".into();
        same.port = Some(22);
        same.password = None;
        same.private_key = Some("key".into());
        same.expected_host_fingerprint = None;
        same.try_keyboard = Some(true);
        assert_eq!(same.key(), base);

        for change in [
            |c: &mut ConnectConfig| c.username = "admin".into(),
            |c: &mut ConnectConfig| c.port = Some(2222),
            |c: &mut ConnectConfig| c.host = "other.example.com".into(),
            |c: &mut ConnectConfig| c.proxy_required = Some(true),
        ] {
            let mut changed = config();
            change(&mut changed);
            assert_ne!(changed.key(), base);
        }
    }

    #[test]
    fn pinned_fingerprint_and_agent_defaults() {
        assert_eq!(config().pinned_fingerprint().as_deref(), Some("SHA256:abc"));
        let mut agent = config();
        assert!(!agent.uses_agent_auth());
        agent.agent = Some("pageant".into());
        assert!(agent.uses_agent_auth());
        agent.agent_auth = Some(false);
        assert!(!agent.uses_agent_auth());
        assert_eq!(config().keepalive_max(), DEFAULT_KEEPALIVE_MAX);
    }
}
