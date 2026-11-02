use crate::protocol::*;
use netutil::{direct_network_path, safe_proxy_config, NetworkPath};
use openssh_sftp_client::{Sftp, SftpOptions};
use ssh_hub::Lease;
use std::time::Instant;

pub(crate) fn resolve_network_path(config: &SshConnectionConfig) -> NetworkPath {
    if let Some(proxy) = config.ssh.proxy.as_ref() {
        return NetworkPath {
            mode: "proxy".to_string(),
            proxy_required: true,
            proxy: Some(safe_proxy_config(proxy)),
        };
    }

    config
        .network_path
        .clone()
        .unwrap_or_else(|| direct_network_path(config.ssh.proxy_required.unwrap_or(false)))
}

/// Opens an SFTP channel on the shared hub connection for `config`. The
/// returned lease keeps that connection open for as long as the session lives.
pub(crate) async fn connect_sftp(
    config: &SshConnectionConfig,
    request_id: Option<&str>,
    stage_started_at: &Instant,
) -> Result<(Sftp, Lease), String> {
    let stage = |name: &str| {
        let _ = emit_stage(
            request_id,
            name,
            stage_started_at.elapsed().as_millis() as u64,
        );
    };
    let lease = ssh_hub::global()
        .acquire(&config.ssh, &ssh_hub::Interaction::default(), &stage)
        .await?;
    let channel = lease.open_session().await?;
    if let Err(error) = channel.request_subsystem(true, "sftp").await {
        lease.mark_broken();
        return Err(format!("failed to start sftp subsystem: {error}"));
    }

    let (reader, writer) = tokio::io::split(channel.into_stream());
    let sftp = Sftp::new(writer, reader, SftpOptions::default())
        .await
        .map_err(|error| format!("failed to initialize openssh-sftp-client: {error}"))?;
    stage("sftpReady");
    Ok((sftp, lease))
}
