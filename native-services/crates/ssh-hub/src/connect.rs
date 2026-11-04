//! Transport, handshake, host-key policy and authentication.

use crate::agent;
use crate::algorithms::preferred;
use crate::config::ConnectConfig;
use crate::hostkey::fingerprint;
use crate::interaction::{HostKeyInfo, HostKeyVerifier, Interaction, KeyboardPrompt};
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use netutil::{connect_tcp, connect_via_proxy};
use russh::client::{self, Handle, KeyboardInteractiveAuthResponse as Interactive, Msg};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg, PublicKey};
use russh::Channel;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::net::TcpStream;
use tokio::sync::mpsc;

/// Upper bounds on server-provided keyboard-interactive input.
const MAX_INTERACTIVE_ROUNDS: usize = 8;
const MAX_PROMPTS: usize = 32;
const MAX_PROMPT_BYTES: usize = 4096;
const MAX_AGENT_IDENTITIES: usize = 64;

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

/// A channel the server opened for a remote (`-R`) forward.
pub struct ForwardedChannel {
    pub channel: Channel<Msg>,
    pub address: String,
    pub port: u32,
}

/// State shared by a connection's handler and its leases.
pub(crate) struct ConnectionShared {
    host_key: Mutex<Option<HostKeyInfo>>,
    agent: Mutex<Option<String>>,
    remote_forwards: Mutex<HashMap<(String, u32), mpsc::UnboundedSender<ForwardedChannel>>>,
    started: Instant,
    last_received_ms: AtomicU64,
}

impl ConnectionShared {
    fn new(agent: Option<String>) -> Self {
        Self {
            host_key: Mutex::new(None),
            agent: Mutex::new(agent),
            remote_forwards: Mutex::new(HashMap::new()),
            started: Instant::now(),
            last_received_ms: AtomicU64::new(0),
        }
    }

    pub(crate) fn host_key(&self) -> Option<HostKeyInfo> {
        lock(&self.host_key).clone()
    }

    /// Later consumers may supply the agent used for forwarding.
    pub(crate) fn offer_agent(&self, agent: Option<&str>) {
        let mut current = lock(&self.agent);
        if current.is_none() {
            *current = agent.map(str::to_string);
        }
    }

    pub(crate) fn route_remote_forward(
        &self,
        address: &str,
        port: u32,
        sender: mpsc::UnboundedSender<ForwardedChannel>,
    ) {
        lock(&self.remote_forwards).insert((address.to_string(), port), sender);
    }

    pub(crate) fn unroute_remote_forward(&self, address: &str, port: u32) {
        lock(&self.remote_forwards).remove(&(address.to_string(), port));
    }

    pub(crate) fn mark_received(&self) {
        let elapsed = self.started.elapsed().as_millis() as u64;
        self.last_received_ms
            .store(elapsed.max(1), Ordering::Relaxed);
    }

    /// Time since a lease last reported received data, if ever.
    pub(crate) fn since_received(&self) -> Option<std::time::Duration> {
        match self.last_received_ms.load(Ordering::Relaxed) {
            0 => None,
            at => Some(
                self.started
                    .elapsed()
                    .saturating_sub(std::time::Duration::from_millis(at)),
            ),
        }
    }
}

pub(crate) enum HostKeyPolicy {
    Pinned(String),
    Ask(HostKeyVerifier),
}

/// russh client handler for hub connections.
pub struct HubHandler {
    policy: HostKeyPolicy,
    shared: Arc<ConnectionShared>,
}

pub type HubHandle = Handle<HubHandler>;

pub(crate) fn host_key_info(key: &PublicKey) -> Result<HostKeyInfo, russh::Error> {
    let blob = key.to_bytes().map_err(russh::Error::from)?;
    Ok(HostKeyInfo {
        fingerprint: fingerprint(key)?,
        algorithm: key.algorithm().as_str().to_string(),
        key_base64: BASE64_STANDARD.encode(blob),
    })
}

impl client::Handler for HubHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        let info = host_key_info(key)?;
        *lock(&self.shared.host_key) = Some(info.clone());
        Ok(match &self.policy {
            HostKeyPolicy::Pinned(expected) => &info.fingerprint == expected,
            HostKeyPolicy::Ask(verifier) => verifier(info).await,
        })
    }

    async fn server_channel_open_agent_forward(
        &mut self,
        channel: Channel<Msg>,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let Some(path) = lock(&self.shared.agent).clone() else {
            return Ok(());
        };
        tokio::spawn(async move {
            if let Ok(mut agent) = agent::open_stream(&path).await {
                let mut stream = channel.into_stream();
                let _ = tokio::io::copy_bidirectional(&mut stream, &mut agent).await;
            }
        });
        Ok(())
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        address: &str,
        port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        let route = lock(&self.shared.remote_forwards)
            .get(&(address.to_string(), port))
            .cloned();
        if let Some(route) = route {
            let _ = route.send(ForwardedChannel {
                channel,
                address: address.to_string(),
                port,
            });
        }
        Ok(())
    }
}

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

async fn rsa_hash(handle: &HubHandle) -> Result<Option<russh::keys::HashAlg>, String> {
    Ok(handle
        .best_supported_rsa_hash()
        .await
        .map_err(|error| format!("failed to resolve RSA hash: {error}"))?
        .flatten())
}

async fn sign_with_agent<S>(
    handle: &mut HubHandle,
    mut agent: AgentClient<S>,
    username: &str,
) -> Result<bool, String>
where
    S: AgentStream + Send + Unpin + 'static,
{
    let identities = agent
        .request_identities()
        .await
        .map_err(|error| format!("SSH agent unavailable: {error}"))?;
    let hash = rsa_hash(handle).await?;
    for key in identities.into_iter().take(MAX_AGENT_IDENTITIES) {
        let result = handle
            .authenticate_publickey_with(username.to_string(), key, hash, &mut agent)
            .await
            .map_err(|error| format!("agent authentication failed: {error}"))?;
        if result.success() {
            return Ok(true);
        }
    }
    Ok(false)
}

// Concrete stream types per platform keep the signing future `Send`.
async fn authenticate_agent(
    handle: &mut HubHandle,
    config: &ConnectConfig,
) -> Result<bool, String> {
    let Some(path) = config.agent.as_deref() else {
        return Ok(false);
    };
    let unavailable = |error: russh::keys::Error| format!("SSH agent unavailable: {error}");
    #[cfg(windows)]
    {
        if path.eq_ignore_ascii_case("pageant") {
            let agent = AgentClient::connect_pageant().await.map_err(unavailable)?;
            return sign_with_agent(handle, agent, &config.username).await;
        }
        let agent = AgentClient::connect_named_pipe(path)
            .await
            .map_err(unavailable)?;
        sign_with_agent(handle, agent, &config.username).await
    }
    #[cfg(unix)]
    {
        let agent = AgentClient::connect_uds(path).await.map_err(unavailable)?;
        sign_with_agent(handle, agent, &config.username).await
    }
}

async fn authenticate_keyboard(
    handle: &mut HubHandle,
    config: &ConnectConfig,
    interaction: &Interaction,
) -> Result<bool, String> {
    let Some(responder) = interaction.keyboard.as_ref() else {
        return Ok(false);
    };
    let mut response = handle
        .authenticate_keyboard_interactive_start(config.username.clone(), None)
        .await
        .map_err(|error| format!("keyboard-interactive authentication failed: {error}"))?;
    for _ in 0..MAX_INTERACTIVE_ROUNDS {
        match response {
            Interactive::Success => return Ok(true),
            Interactive::Failure { .. } => return Ok(false),
            Interactive::InfoRequest {
                name,
                instructions,
                prompts,
            } => {
                if prompts.len() > MAX_PROMPTS
                    || name.len() > MAX_PROMPT_BYTES
                    || instructions.len() > 2 * MAX_PROMPT_BYTES
                    || prompts.iter().any(|p| p.prompt.len() > MAX_PROMPT_BYTES)
                {
                    return Err("keyboard-interactive request exceeds limits".into());
                }
                let expected = prompts.len();
                let answers = responder(KeyboardPrompt {
                    name,
                    instructions,
                    prompts: prompts.into_iter().map(|p| (p.prompt, p.echo)).collect(),
                })
                .await
                .ok_or_else(|| "Authentication cancelled by user".to_string())?;
                if answers.len() != expected {
                    return Err("keyboard-interactive answers do not match prompts".into());
                }
                response = handle
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|error| {
                        format!("keyboard-interactive authentication failed: {error}")
                    })?;
            }
        }
    }
    Ok(matches!(response, Interactive::Success))
}

/// Tries the configured methods in ssh2's order: none, password, public key,
/// agent identities, keyboard-interactive.
async fn authenticate(
    handle: &mut HubHandle,
    config: &ConnectConfig,
    interaction: &Interaction,
) -> Result<(), String> {
    if handle
        .authenticate_none(config.username.clone())
        .await
        .map_err(|error| format!("authentication failed: {error}"))?
        .success()
    {
        return Ok(());
    }
    if let Some(password) = config.password.as_deref() {
        if handle
            .authenticate_password(config.username.clone(), password.to_string())
            .await
            .map_err(|error| format!("password authentication failed: {error}"))?
            .success()
        {
            return Ok(());
        }
    }
    if let Some(private_key) = config.private_key.as_deref() {
        let key = decode_secret_key(private_key, config.passphrase.as_deref())
            .map_err(|error| format!("failed to decode private key: {error}"))?;
        let hash = rsa_hash(handle).await?;
        if handle
            .authenticate_publickey(
                config.username.clone(),
                PrivateKeyWithHashAlg::new(Arc::new(key), hash),
            )
            .await
            .map_err(|error| format!("public key authentication failed: {error}"))?
            .success()
        {
            return Ok(());
        }
    }
    if config.uses_agent_auth() && authenticate_agent(handle, config).await? {
        return Ok(());
    }
    if config.try_keyboard.unwrap_or(false)
        && interaction.keyboard.is_some()
        && authenticate_keyboard(handle, config, interaction).await?
    {
        return Ok(());
    }
    // ssh2's wording: the main process classifies authentication failures by it.
    Err("All configured authentication methods failed".to_string())
}

/// Opens a new authenticated connection, reporting `tcpConnected`,
/// `sshHandshakeCompleted` and `authenticated` through `stage`.
pub(crate) async fn establish(
    config: &ConnectConfig,
    interaction: &Interaction,
    stage: &(dyn Fn(&str) + Sync),
) -> Result<(HubHandle, Arc<ConnectionShared>), String> {
    let policy = match (config.pinned_fingerprint(), interaction.host_key.clone()) {
        (Some(pinned), _) => HostKeyPolicy::Pinned(pinned),
        (None, Some(verifier)) => HostKeyPolicy::Ask(verifier),
        (None, None) => return Err("missing trusted SSH host fingerprint".into()),
    };
    let shared = Arc::new(ConnectionShared::new(
        config
            .agent
            .clone()
            .filter(|_| config.agent_forward.unwrap_or(false)),
    ));

    let ready_timeout = config.ready_timeout();
    let handshake = async {
        let socket = open_transport(config).await?;
        let _ = socket.set_nodelay(true);
        stage("tcpConnected");
        let client_config = Arc::new(client::Config {
            inactivity_timeout: None,
            keepalive_interval: Some(config.keepalive_interval()),
            keepalive_max: config.keepalive_max(),
            nodelay: true,
            preferred: preferred(config.algorithms.as_ref(), config.compression()),
            ..Default::default()
        });
        client::connect_stream(
            client_config,
            socket,
            HubHandler {
                policy,
                shared: Arc::clone(&shared),
            },
        )
        .await
        .map_err(|error| match error {
            russh::Error::UnknownKey => format!(
                "SSH host key verification failed for {}:{}",
                config.host,
                config.port()
            ),
            russh::Error::NoCommonAlgo { kind, .. } => {
                format!("no matching {kind:?} algorithm with the SSH server")
            }
            other => format!("failed to connect SSH session: {other}"),
        })
    };
    // User decisions (host key, prompts) are not bounded by the ready timeout.
    let mut handle = match interaction.host_key {
        Some(_) => handshake.await?,
        None => tokio::time::timeout(ready_timeout, handshake)
            .await
            .map_err(|_| format!("Connection timed out: {}:{}", config.host, config.port()))??,
    };
    stage("sshHandshakeCompleted");

    authenticate(&mut handle, config, interaction).await?;
    stage("authenticated");
    Ok((handle, shared))
}
