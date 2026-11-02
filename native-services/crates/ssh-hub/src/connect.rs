//! Transport, handshake with a pinned host key, and authentication.

use crate::config::ConnectConfig;
use crate::hostkey::fingerprint;
use netutil::{connect_tcp, connect_via_proxy};
use russh::client::{self, Handle};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;

/// Keepalives detect dead peers on long-lived shared connections; there is
/// no inactivity timeout because idle reclaim is the hub's job.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(15);
const KEEPALIVE_MAX: usize = 3;

/// russh client handler for hub connections: accepts only the pinned key.
#[derive(Debug)]
pub struct HubHandler {
    expected_fingerprint: String,
}

impl client::Handler for HubHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        Ok(fingerprint(key)? == self.expected_fingerprint)
    }
}

pub type HubHandle = Handle<HubHandler>;

async fn open_transport(config: &ConnectConfig) -> Result<TcpStream, String> {
    if let Some(proxy) = config.proxy.as_ref() {
        return connect_via_proxy(proxy, &config.host, config.port()).await;
    }
    if config.proxy_required.unwrap_or(false) {
        return Err(
            "proxy required for SSH connection, but no supported proxy was provided".into(),
        );
    }
    connect_tcp(&config.host, config.port(), "SSH target").await
}

async fn authenticate(handle: &mut HubHandle, config: &ConnectConfig) -> Result<(), String> {
    if let Some(private_key) = config.private_key.as_deref() {
        let key = decode_secret_key(private_key, config.passphrase.as_deref())
            .map_err(|error| format!("failed to decode private key: {error}"))?;
        let hash = handle
            .best_supported_rsa_hash()
            .await
            .map_err(|error| format!("failed to resolve RSA hash: {error}"))?
            .flatten();
        let result = handle
            .authenticate_publickey(
                config.username.clone(),
                PrivateKeyWithHashAlg::new(Arc::new(key), hash),
            )
            .await
            .map_err(|error| format!("public key authentication failed: {error}"))?;
        return if result.success() {
            Ok(())
        } else {
            Err("public key authentication failed".into())
        };
    }
    if let Some(password) = config.password.as_deref() {
        let result = handle
            .authenticate_password(config.username.clone(), password.to_string())
            .await
            .map_err(|error| format!("password authentication failed: {error}"))?;
        return if result.success() {
            Ok(())
        } else {
            Err("password authentication failed".into())
        };
    }
    Err("missing SSH credentials".into())
}

/// Opens a new authenticated connection, reporting `tcpConnected`,
/// `sshHandshakeCompleted` and `authenticated` through `stage`.
pub(crate) async fn establish(
    config: &ConnectConfig,
    stage: &(dyn Fn(&str) + Sync),
) -> Result<HubHandle, String> {
    let expected_fingerprint = config.expected_fingerprint()?;
    let socket = open_transport(config).await?;
    let _ = socket.set_nodelay(true);
    stage("tcpConnected");

    let client_config = Arc::new(client::Config {
        inactivity_timeout: None,
        keepalive_interval: Some(KEEPALIVE_INTERVAL),
        keepalive_max: KEEPALIVE_MAX,
        nodelay: true,
        ..Default::default()
    });
    let mut handle = client::connect_stream(
        client_config,
        socket,
        HubHandler {
            expected_fingerprint,
        },
    )
    .await
    .map_err(|error| match error {
        russh::Error::UnknownKey => format!(
            "SSH host key verification failed for {}:{}",
            config.host,
            config.port()
        ),
        other => format!("failed to connect SSH session: {other}"),
    })?;
    stage("sshHandshakeCompleted");

    authenticate(&mut handle, config).await?;
    stage("authenticated");
    Ok(handle)
}
