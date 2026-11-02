//! Connection settings as sent by the main process, and the identity that
//! decides which requests may share one SSH connection.

use crate::hostkey::{hex, normalize_fingerprint};
use netutil::ProxyConfig;
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectConfig {
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub expected_host_fingerprint: Option<String>,
    pub proxy: Option<ProxyConfig>,
    pub proxy_required: Option<bool>,
}

/// Opaque identity of a connection. Two configs share a connection only when
/// target, credentials, pinned host key and network path are all equal; the
/// secrets are hashed so they never appear in the key itself.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ConnectionKey(String);

impl ConnectionKey {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl ConnectConfig {
    pub fn port(&self) -> u16 {
        self.port.unwrap_or(22)
    }

    pub fn expected_fingerprint(&self) -> Result<String, String> {
        self.expected_host_fingerprint
            .as_deref()
            .and_then(normalize_fingerprint)
            .ok_or_else(|| "missing trusted SSH host fingerprint".to_string())
    }

    pub fn key(&self) -> Result<ConnectionKey, String> {
        let mut digest = Sha256::new();
        let mut field = |value: &str| {
            digest.update((value.len() as u64).to_le_bytes());
            digest.update(value.as_bytes());
        };
        field(&self.host.to_ascii_lowercase());
        field(&self.port().to_string());
        field(&self.username);
        field(self.password.as_deref().unwrap_or(""));
        field(self.private_key.as_deref().unwrap_or(""));
        field(self.passphrase.as_deref().unwrap_or(""));
        field(&self.expected_fingerprint()?);
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
        Ok(ConnectionKey(hex(&digest.finalize())))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> ConnectConfig {
        ConnectConfig {
            host: "Example.com".into(),
            port: None,
            username: "root".into(),
            password: Some("secret".into()),
            private_key: None,
            passphrase: None,
            expected_host_fingerprint: Some("abc".into()),
            proxy: None,
            proxy_required: None,
        }
    }

    #[test]
    fn key_covers_identity_and_hides_secrets() {
        let base = config().key().unwrap();
        assert!(!base.as_str().contains("secret"));
        let mut same = config();
        same.host = "example.com".into();
        same.port = Some(22);
        assert_eq!(same.key().unwrap(), base);

        for change in [
            |c: &mut ConnectConfig| c.password = Some("other".into()),
            |c: &mut ConnectConfig| c.username = "admin".into(),
            |c: &mut ConnectConfig| c.port = Some(2222),
            |c: &mut ConnectConfig| c.expected_host_fingerprint = Some("def".into()),
            |c: &mut ConnectConfig| c.proxy_required = Some(true),
        ] {
            let mut changed = config();
            change(&mut changed);
            assert_ne!(changed.key().unwrap(), base);
        }
    }

    #[test]
    fn key_requires_a_pinned_host_key() {
        let mut unpinned = config();
        unpinned.expected_host_fingerprint = None;
        assert!(unpinned.key().is_err());
    }
}
