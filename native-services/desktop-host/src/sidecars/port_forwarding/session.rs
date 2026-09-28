use super::{auth, socks, Output, Request, Rule, CONNECT_TIMEOUT, MAX_STREAMS};
use crate::shared::network::{connect_tcp, connect_via_proxy};
use futures_util::FutureExt;
use russh::client::{self, Handle, Msg};
use russh::keys::PublicKey;
use russh::{Channel, Disconnect};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::copy_bidirectional_with_sizes;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;
use tokio::task::{JoinHandle, JoinSet};
use tokio::time::timeout;
use tokio_util::sync::CancellationToken;

enum Incoming {
    Local(TcpStream, Rule),
    Remote(Channel<Msg>, String, u32),
}
struct Handler {
    fingerprint: String,
    incoming: mpsc::Sender<Incoming>,
}
impl client::Handler for Handler {
    type Error = russh::Error;
    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        let digest = Sha256::digest(key.to_bytes()?);
        Ok(format!("SHA256:{digest:x}") == self.fingerprint)
    }
    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<Msg>,
        address: &str,
        port: u32,
        _origin: &str,
        _origin_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if let Err(error) = self
            .incoming
            .try_send(Incoming::Remote(channel, address.into(), port))
        {
            discard(error.into_inner());
        }
        Ok(())
    }
}
fn discard(incoming: Incoming) {
    if let Incoming::Remote(channel, _, _) = incoming {
        drop(channel.into_stream());
    }
}
type SshHandle = Arc<Handle<Handler>>;

fn algorithms() -> russh::Preferred {
    // Retain the terminal's legacy compatibility options after modern defaults.
    // This changes only forwarding negotiation, not other sidecars' policies.
    let mut preferred = russh::Preferred::default();
    preferred.kex.to_mut().extend([
        russh::kex::ECDH_SHA2_NISTP256,
        russh::kex::ECDH_SHA2_NISTP384,
        russh::kex::ECDH_SHA2_NISTP521,
        russh::kex::DH_G14_SHA1,
        russh::kex::DH_GEX_SHA1,
        russh::kex::DH_G1_SHA1,
    ]);
    preferred.cipher.to_mut().extend([
        russh::cipher::AES_128_GCM,
        russh::cipher::AES_256_GCM_LEGACY,
        russh::cipher::AES_128_GCM_LEGACY,
        russh::cipher::AES_128_CBC,
        russh::cipher::AES_192_CBC,
        russh::cipher::AES_256_CBC,
        russh::cipher::TRIPLE_DES_CBC,
    ]);
    preferred.key.to_mut().push(russh::keys::Algorithm::Dsa);
    preferred.mac.to_mut().extend([
        russh::mac::HMAC_SHA256_96,
        russh::mac::HMAC_SHA512_96,
        russh::mac::HMAC_SHA1_96,
        russh::mac::HMAC_MD5,
        russh::mac::HMAC_MD5_96,
    ]);
    preferred
}

async fn connect(
    request: &Request,
    incoming: mpsc::Sender<Incoming>,
    out: &Output,
    answers: &mut mpsc::Receiver<(u32, Vec<String>)>,
) -> Result<SshHandle, &'static str> {
    let ssh = request.ssh.as_ref().ok_or("INVALID_CONFIG")?;
    let transport = async {
        let socket = if let Some(proxy) = &ssh.proxy {
            connect_via_proxy(proxy, &ssh.host, ssh.port).await
        } else if ssh.proxy_required {
            return Err("PROXY_REQUIRED");
        } else {
            connect_tcp(&ssh.host, ssh.port, "SSH").await
        }
        .map_err(|_| "CONNECT_FAILED")?;
        let config = client::Config {
            preferred: algorithms(),
            window_size: 256 * 1024,
            maximum_packet_size: 32 * 1024,
            channel_buffer_size: 16,
            keepalive_interval: Some(Duration::from_secs(5)),
            keepalive_max: 3,
            nodelay: true,
            ..Default::default()
        };
        client::connect_stream(
            Arc::new(config),
            socket,
            Handler {
                fingerprint: ssh.expected_host_fingerprint.clone(),
                incoming,
            },
        )
        .await
        .map_err(|e| {
            if matches!(e, russh::Error::UnknownKey) {
                "HOST_KEY_MISMATCH"
            } else if matches!(e, russh::Error::NoCommonAlgo { .. }) {
                "ALGORITHM_UNSUPPORTED"
            } else {
                "CONNECT_FAILED"
            }
        })
    };
    let mut handle = timeout(Duration::from_secs(15), transport)
        .await
        .map_err(|_| "CONNECT_TIMEOUT")??;
    auth::authenticate(&mut handle, request, out, answers)
        .boxed()
        .await?;
    Ok(Arc::new(handle))
}

struct Binding {
    rule: Rule,
    listener: Option<JoinHandle<()>>,
    streams: JoinSet<()>,
    reported: usize,
}
impl Binding {
    async fn close(&mut self) {
        if let Some(listener) = self.listener.take() {
            listener.abort();
            let _ = listener.await;
        }
        self.streams.abort_all();
        while self.streams.join_next().await.is_some() {}
    }
}
#[derive(Default)]
struct Resources {
    handle: Option<SshHandle>,
    bindings: Vec<Binding>,
}
impl Resources {
    async fn add(
        &mut self,
        rules: &[Rule],
        incoming: mpsc::Sender<Incoming>,
    ) -> Result<(), &'static str> {
        if self.bindings.len() + rules.len() > 100 {
            return Err("BUSY");
        }
        if rules
            .iter()
            .any(|r| self.bindings.iter().any(|b| b.rule.id == r.id))
        {
            return Err("RULE_EXISTS");
        }
        let old_len = self.bindings.len();
        for rule in rules {
            if let Err(error) = self.bind(rule, incoming.clone()).await {
                while self.bindings.len() > old_len {
                    let id = self.bindings.last().unwrap().rule.id.clone();
                    self.remove(&id).await?;
                }
                return Err(error);
            }
        }
        Ok(())
    }
    async fn bind(
        &mut self,
        rule: &Rule,
        incoming: mpsc::Sender<Incoming>,
    ) -> Result<(), &'static str> {
        let handle = self.handle.as_ref().ok_or("DISCONNECTED")?;
        let mut bound = rule.clone();
        let listener = if rule.mode == "remote" {
            let port = handle
                .tcpip_forward(&rule.listen_host, u32::from(rule.listen_port))
                .await
                .map_err(|_| "REMOTE_BIND_FAILED")?;
            if rule.listen_port == 0 {
                bound.listen_port = u16::try_from(port)
                    .ok()
                    .filter(|p| *p > 0)
                    .ok_or("REMOTE_BIND_FAILED")?;
            }
            None
        } else {
            let listener = TcpListener::bind((rule.listen_host.as_str(), rule.listen_port))
                .await
                .map_err(|_| "LOCAL_BIND_FAILED")?;
            bound.listen_port = listener
                .local_addr()
                .map_err(|_| "LOCAL_BIND_FAILED")?
                .port();
            let rule = bound.clone();
            Some(tokio::spawn(async move {
                while let Ok((socket, _)) = listener.accept().await {
                    let _ = socket.set_nodelay(true);
                    let _ = incoming.try_send(Incoming::Local(socket, rule.clone()));
                }
            }))
        };
        self.bindings.push(Binding {
            rule: bound,
            listener,
            streams: JoinSet::new(),
            reported: 0,
        });
        Ok(())
    }
    async fn remove(&mut self, id: &str) -> Result<(), &'static str> {
        if let Some(index) = self.bindings.iter().position(|b| b.rule.id == id) {
            let mut binding = self.bindings.remove(index);
            binding.close().await;
            if binding.rule.mode == "remote" {
                let handle = self.handle.as_ref().ok_or("DISCONNECTED")?;
                timeout(
                    Duration::from_millis(500),
                    handle.cancel_tcpip_forward(
                        &binding.rule.listen_host,
                        u32::from(binding.rule.listen_port),
                    ),
                )
                .await
                .map_err(|_| "DISCONNECTED")?
                .map_err(|_| "DISCONNECTED")?;
            }
        }
        Ok(())
    }
    async fn close(&mut self) {
        for binding in &mut self.bindings {
            binding.close().await;
        }
        if let Some(handle) = self.handle.take() {
            let _ = timeout(Duration::from_millis(500), async {
                for binding in &self.bindings {
                    if binding.rule.mode == "remote" && !handle.is_closed() {
                        let _ = handle
                            .cancel_tcpip_forward(
                                &binding.rule.listen_host,
                                u32::from(binding.rule.listen_port),
                            )
                            .await;
                    }
                }
            })
            .await;
            let _ = timeout(
                Duration::from_millis(500),
                handle.disconnect(Disconnect::ByApplication, "", ""),
            )
            .await;
            if let Ok(handle) = Arc::try_unwrap(handle) {
                let _ = timeout(Duration::from_secs(1), handle).await;
            }
        }
    }
    fn result(&self, request: &Request) -> Value {
        let mut message = request.message("result");
        message["bindings"] = json!(self.bindings.iter().filter(|b| request.rules.iter().any(|r| r.id == b.rule.id))
            .map(|b| json!({"id":b.rule.id,"type":b.rule.mode,"host":b.rule.listen_host,"port":b.rule.listen_port})).collect::<Vec<_>>());
        message
    }
    fn reap(&mut self, owner: &Request, out: &Output) {
        for binding in &mut self.bindings {
            while binding.streams.try_join_next().is_some() {}
            let count = binding.streams.len();
            if count != binding.reported {
                let mut event = owner.message("event");
                event["state"] = json!("connections");
                event["ruleId"] = json!(binding.rule.id);
                event["activeConnections"] = json!(count);
                if out.try_send(event).is_ok() {
                    binding.reported = count;
                }
            }
        }
    }
    fn accept(&mut self, incoming: Incoming) {
        if self.bindings.iter().map(|b| b.streams.len()).sum::<usize>() >= MAX_STREAMS {
            discard(incoming);
            return;
        }
        match incoming {
            Incoming::Local(socket, rule) => {
                if let Some(binding) = self
                    .bindings
                    .iter_mut()
                    .find(|b| b.rule.id == rule.id && b.rule.listen_port == rule.listen_port)
                {
                    let handle = self.handle.as_ref().unwrap().clone();
                    binding.streams.spawn(async move {
                        let _ = local(socket, rule, handle).await;
                    });
                }
            }
            Incoming::Remote(channel, address, port) => {
                if let Some(binding) = self.bindings.iter_mut().find(|b| {
                    b.rule.mode == "remote"
                        && b.rule.listen_host == address
                        && u32::from(b.rule.listen_port) == port
                }) {
                    let rule = binding.rule.clone();
                    binding.streams.spawn(async move {
                        let mut stream = channel.into_stream();
                        if let Ok(Ok(mut socket)) = timeout(
                            CONNECT_TIMEOUT,
                            TcpStream::connect((
                                rule.target_host.as_deref().unwrap(),
                                rule.target_port.unwrap(),
                            )),
                        )
                        .await
                        {
                            let _ = socket.set_nodelay(true);
                            let _ = copy_bidirectional_with_sizes(
                                &mut socket,
                                &mut stream,
                                32 * 1024,
                                32 * 1024,
                            )
                            .await;
                        }
                    });
                } else {
                    drop(channel.into_stream());
                }
            }
        }
    }
}

async fn local(mut socket: TcpStream, rule: Rule, handle: SshHandle) -> Result<(), ()> {
    let dynamic = rule.mode == "dynamic";
    let channel = timeout(CONNECT_TIMEOUT, async {
        let (host, port) = if dynamic {
            socks::request(&mut socket).await.map_err(|_| ())?
        } else {
            (rule.target_host.unwrap(), rule.target_port.unwrap())
        };
        let peer = socket.peer_addr().map_err(|_| ())?;
        let opened = handle
            .channel_open_direct_tcpip(
                host,
                u32::from(port),
                peer.ip().to_string(),
                u32::from(peer.port()),
            )
            .await;
        if dynamic {
            socks::reply(&mut socket, if opened.is_ok() { 0 } else { 5 })
                .await
                .map_err(|_| ())?;
        }
        opened.map_err(|_| ())
    })
    .await
    .map_err(|_| ())??;
    let mut stream = channel.into_stream();
    copy_bidirectional_with_sizes(&mut socket, &mut stream, 32 * 1024, 32 * 1024)
        .await
        .map_err(|_| ())?;
    Ok(())
}

pub(super) async fn run(
    mut request: Request,
    out: Output,
    cancel: CancellationToken,
    mut commands: mpsc::Receiver<Request>,
    mut answers: mpsc::Receiver<(u32, Vec<String>)>,
) {
    let (incoming, mut accepted) = mpsc::channel(MAX_STREAMS);
    let mut resources = Resources::default();
    let setup_timeout = if request.ssh.as_ref().is_some_and(|s| s.keyboard_interactive) {
        Duration::from_secs(300)
    } else {
        Duration::from_secs(30)
    };
    let setup = tokio::select! {
        biased;
        _ = cancel.cancelled() => Err("CANCELLED"),
        result = timeout(setup_timeout, async {
            resources.handle = Some(connect(&request, incoming.clone(), &out, &mut answers).await?);
            timeout(CONNECT_TIMEOUT, resources.add(&request.rules, incoming.clone())).await.map_err(|_| "CONNECT_TIMEOUT")?
        }) => result.unwrap_or(Err("CONNECT_TIMEOUT")),
    };
    request.ssh = None;
    let reason = if let Err(code) = setup {
        request.error(&out, code).await;
        "closed"
    } else {
        let _ = out.send(resources.result(&request)).await;
        let mut poll = tokio::time::interval(Duration::from_millis(100));
        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => break "closed",
                _ = poll.tick() => {
                    resources.reap(&request, &out);
                    if resources.handle.as_ref().unwrap().is_closed() { break "disconnected"; }
                }
                command = commands.recv() => {
                    let Some(command) = command else { break "closed" };
                    let result = tokio::select! {
                        biased;
                        _ = cancel.cancelled() => Err("CANCELLED"),
                        result = timeout(CONNECT_TIMEOUT, async {
                            if command.kind == "addRules" { resources.add(&command.rules, incoming.clone()).await }
                            else { resources.remove(command.rule_id.as_deref().unwrap()).await }
                        }) => result.unwrap_or(Err("CONNECT_TIMEOUT")),
                    };
                    // Flush already accepted connections against the current bindings
                    // before a later command can reuse a removed rule ID and port.
                    for _ in 0..MAX_STREAMS {
                        if let Ok(value) = accepted.try_recv() { resources.accept(value); } else { break; }
                    }
                    match result {
                        Ok(()) => { let _ = out.send(resources.result(&command)).await; },
                        Err(code) => {
                            command.error(&out, code).await;
                            if matches!(code, "CANCELLED" | "CONNECT_TIMEOUT" | "DISCONNECTED") { break "disconnected"; }
                        }
                    }
                }
                value = accepted.recv() => { if let Some(value) = value { resources.accept(value); } }
            }
        }
    };
    accepted.close();
    while let Ok(value) = accepted.try_recv() {
        discard(value);
    }
    resources.close().await;
    commands.close();
    while let Some(command) = commands.recv().await {
        command.error(&out, "CANCELLED").await;
    }
    let mut event = request.message("event");
    event["state"] = json!(reason);
    let _ = out.send(event).await;
}
