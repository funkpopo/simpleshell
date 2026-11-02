use crate::protocol::*;
use netutil::{
    connect_tcp, connect_via_proxy, direct_network_path, safe_proxy_config, NetworkPath,
};
use openssh_sftp_client::{Sftp, SftpOptions};
use russh::client::{self, Handle};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;

pub(crate) type SshHandle = Handle<ExpectedServerKey>;

#[derive(Debug)]
pub(crate) struct ExpectedServerKey {
    pub(crate) expected_fingerprint: String,
}

impl client::Handler for ExpectedServerKey {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let actual_fingerprint = compute_sha256_host_fingerprint(server_public_key)?;
        Ok(actual_fingerprint == self.expected_fingerprint)
    }
}

pub(crate) fn normalize_host_fingerprint(fingerprint: &str) -> Option<String> {
    let trimmed = fingerprint.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("SHA256:") {
        return Some(format!("SHA256:{}", &trimmed[7..]));
    }

    Some(format!("SHA256:{trimmed}"))
}

pub(crate) fn compute_sha256_host_fingerprint(
    server_public_key: &PublicKey,
) -> Result<String, russh::Error> {
    let key_blob = server_public_key.to_bytes().map_err(russh::Error::from)?;
    let digest = Sha256::digest(&key_blob);
    Ok(format!("SHA256:{}", hex_lower(&digest)))
}

pub(crate) fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

pub(crate) fn resolve_network_path(config: &SshConnectionConfig) -> NetworkPath {
    if let Some(proxy) = config.proxy.as_ref() {
        return NetworkPath {
            mode: "proxy".to_string(),
            proxy_required: true,
            proxy: Some(safe_proxy_config(proxy)),
        };
    }

    config
        .network_path
        .clone()
        .unwrap_or_else(|| direct_network_path(config.proxy_required.unwrap_or(false)))
}

pub(crate) async fn open_ssh_transport(config: &SshConnectionConfig) -> Result<TcpStream, String> {
    let target_port = config.port.unwrap_or(22);

    if let Some(proxy) = config.proxy.as_ref() {
        return connect_via_proxy(proxy, &config.host, target_port).await;
    }

    if config.proxy_required.unwrap_or(false) {
        return Err(
            "proxy required for native SFTP request, but no supported proxy was provided"
                .to_string(),
        );
    }

    connect_tcp(&config.host, target_port, "SSH target").await
}

pub(crate) async fn connect_sftp(
    config: &SshConnectionConfig,
    request_id: Option<&str>,
    stage_started_at: &Instant,
) -> Result<(Sftp, SshHandle), String> {
    let client_config = Arc::new(client::Config {
        inactivity_timeout: Some(Duration::from_secs(30)),
        ..Default::default()
    });
    let expected_fingerprint = config
        .expected_host_fingerprint
        .as_deref()
        .and_then(normalize_host_fingerprint)
        .ok_or_else(|| {
            "missing trusted SSH host fingerprint for native SFTP request".to_string()
        })?;

    let socket = open_ssh_transport(config).await?;
    let _ = emit_stage(
        request_id,
        "tcpConnected",
        stage_started_at.elapsed().as_millis() as u64,
    );
    if client_config.as_ref().nodelay {
        let _ = socket.set_nodelay(true);
    }

    let mut handle = client::connect_stream(
        client_config,
        socket,
        ExpectedServerKey {
            expected_fingerprint: expected_fingerprint.clone(),
        },
    )
    .await
    .map_err(|error| {
        if matches!(error, russh::Error::UnknownKey) {
            format!(
                "SSH host key verification failed for {}:{}",
                config.host,
                config.port.unwrap_or(22)
            )
        } else {
            format!("failed to connect SSH session: {error}")
        }
    })?;
    let _ = emit_stage(
        request_id,
        "sshHandshakeCompleted",
        stage_started_at.elapsed().as_millis() as u64,
    );

    if let Some(private_key) = config.private_key.as_deref() {
        let key = decode_secret_key(private_key, config.passphrase.as_deref())
            .map_err(|error| format!("failed to decode private key: {error}"))?;
        let auth_result = handle
            .authenticate_publickey(
                config.username.clone(),
                PrivateKeyWithHashAlg::new(
                    Arc::new(key),
                    handle
                        .best_supported_rsa_hash()
                        .await
                        .map_err(|error| format!("failed to resolve RSA hash: {error}"))?
                        .flatten(),
                ),
            )
            .await
            .map_err(|error| format!("public key authentication failed: {error}"))?;

        if !auth_result.success() {
            return Err("public key authentication failed".to_string());
        }
    } else if let Some(password) = config.password.as_deref() {
        let auth_result = handle
            .authenticate_password(config.username.clone(), password.to_string())
            .await
            .map_err(|error| format!("password authentication failed: {error}"))?;

        if !auth_result.success() {
            return Err("password authentication failed".to_string());
        }
    } else {
        return Err("missing SSH credentials for native SFTP request".to_string());
    }
    let _ = emit_stage(
        request_id,
        "authenticated",
        stage_started_at.elapsed().as_millis() as u64,
    );

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|error| format!("failed to open SSH channel: {error}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|error| format!("failed to start sftp subsystem: {error}"))?;

    let channel_stream = channel.into_stream();
    let (reader, writer) = tokio::io::split(channel_stream);
    let sftp = Sftp::new(writer, reader, SftpOptions::default())
        .await
        .map_err(|error| format!("failed to initialize openssh-sftp-client: {error}"))?;
    let _ = emit_stage(
        request_id,
        "sftpReady",
        stage_started_at.elapsed().as_millis() as u64,
    );

    Ok((sftp, handle))
}
