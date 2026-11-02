//! In-process SSH server for the workspace's tests (never shipped).
//!
//! Authentication: password `secret`, the public key in
//! [`TestSshd::client_key`], or keyboard-interactive (`otp` then `123456`).
//!
//! Shell channels print `$ ` and run one command per input line:
//! `flood <bytes>` writes that many bytes then `DONE\r\n$ `, `stderr <text>`
//! writes to the extended stream, `exit <code>` ends the channel with that
//! status, anything else is echoed. Exec runs the same commands once.
//! Everything clients request is recorded in [`TestSshd::events`].

use bytes::Bytes;
use russh::keys::ssh_key::rand_core::OsRng;
use russh::keys::{Algorithm, PrivateKey, PublicKey};
use russh::server::{self, Auth, Msg, Response, Session};
use russh::{Channel, ChannelId, Pty};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

pub const PASSWORD: &str = "secret";
pub const OTP: &str = "123456";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Auth(String),
    Pty { term: String, cols: u32, rows: u32 },
    WindowChange { cols: u32, rows: u32 },
    Env { name: String, value: String },
    Shell,
    Exec(String),
    AgentForward,
    Input(Vec<u8>),
    Eof,
    TcpipForward { address: String, port: u32 },
    CancelTcpipForward { address: String, port: u32 },
}

#[derive(Default)]
struct State {
    events: Mutex<Vec<Event>>,
    connections: AtomicUsize,
    sessions: Mutex<Vec<server::Handle>>,
}

pub struct TestSshd {
    pub port: u16,
    /// `SHA256:<hex>` of the host key.
    pub fingerprint: String,
    client_key: PrivateKey,
    state: Arc<State>,
    accept: JoinHandle<()>,
}

impl TestSshd {
    pub async fn start() -> Self {
        let host_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let client_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let fingerprint = fingerprint(host_key.public_key());
        let config = Arc::new(server::Config {
            keys: vec![host_key],
            auth_rejection_time: Duration::from_millis(5),
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..Default::default()
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let state = Arc::new(State::default());
        let accept = {
            let state = Arc::clone(&state);
            let authorized = client_key.public_key().clone();
            tokio::spawn(async move {
                while let Ok((socket, _)) = listener.accept().await {
                    state.connections.fetch_add(1, Ordering::SeqCst);
                    let handler = Handler {
                        state: Arc::clone(&state),
                        authorized: authorized.clone(),
                        shells: HashMap::new(),
                        otp_sent: false,
                    };
                    if let Ok(session) =
                        server::run_stream(Arc::clone(&config), socket, handler).await
                    {
                        state.sessions.lock().unwrap().push(session.handle());
                        tokio::spawn(session);
                    }
                }
            })
        };
        Self {
            port,
            fingerprint,
            client_key,
            state,
            accept,
        }
    }

    pub fn client_key(&self) -> &PrivateKey {
        &self.client_key
    }

    /// OpenSSH PEM of the client key, encrypted when `passphrase` is given.
    pub fn client_key_pem(&self, passphrase: Option<&str>) -> String {
        let key = match passphrase {
            Some(passphrase) => self.client_key.encrypt(&mut OsRng, passphrase).unwrap(),
            None => self.client_key.clone(),
        };
        key.to_openssh(russh::keys::ssh_key::LineEnding::LF)
            .unwrap()
            .to_string()
    }

    pub fn connections(&self) -> usize {
        self.state.connections.load(Ordering::SeqCst)
    }

    pub fn events(&self) -> Vec<Event> {
        self.state.events.lock().unwrap().clone()
    }

    /// Ends every server-side session, as a network failure would.
    pub async fn sever(&self) {
        let sessions: Vec<_> = self.state.sessions.lock().unwrap().drain(..).collect();
        for session in sessions {
            let _ = session
                .disconnect(
                    russh::Disconnect::ByApplication,
                    String::new(),
                    String::new(),
                )
                .await;
        }
    }

    /// Opens a `forwarded-tcpip` channel towards the client on every session.
    pub async fn open_forwarded(&self, address: &str, port: u32) -> Vec<Channel<Msg>> {
        let sessions: Vec<_> = self.state.sessions.lock().unwrap().clone();
        let mut channels = Vec::new();
        for session in sessions {
            if let Ok(channel) = session
                .channel_open_forwarded_tcpip(address, port, "127.0.0.1", 40000)
                .await
            {
                channels.push(channel);
            }
        }
        channels
    }
}

impl Drop for TestSshd {
    fn drop(&mut self) {
        self.accept.abort();
    }
}

fn fingerprint(key: &PublicKey) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(key.to_bytes().unwrap());
    format!("SHA256:{digest:x}")
}

struct Handler {
    state: Arc<State>,
    authorized: PublicKey,
    shells: HashMap<ChannelId, String>,
    otp_sent: bool,
}

impl Handler {
    fn record(&self, event: Event) {
        self.state.events.lock().unwrap().push(event);
    }
}

fn run_command(
    handle: &server::Handle,
    channel: ChannelId,
    command: &str,
) -> impl std::future::Future<Output = Option<u32>> + Send + 'static {
    let handle = handle.clone();
    let command = command.trim().to_string();
    async move {
        if let Some(size) = command.strip_prefix("flood ") {
            let mut remaining: usize = size.parse().unwrap_or(0);
            let line = b"0123456789abcdefghijklmnopqrstuvwxyz\r\n";
            while remaining > 0 {
                let mut chunk = Vec::with_capacity(32 * 1024);
                while chunk.len() < 32 * 1024 && remaining > 0 {
                    let take = remaining.min(line.len());
                    chunk.extend_from_slice(&line[..take]);
                    remaining -= take;
                }
                if handle.data(channel, Bytes::from(chunk)).await.is_err() {
                    return None;
                }
            }
            let _ = handle.data(channel, Bytes::from_static(b"DONE\r\n")).await;
            None
        } else if let Some(text) = command.strip_prefix("stderr ") {
            let _ = handle
                .extended_data(channel, 1, Bytes::from(format!("{text}\r\n").into_bytes()))
                .await;
            None
        } else if let Some(code) = command.strip_prefix("exit ") {
            Some(code.parse().unwrap_or(1))
        } else {
            let _ = handle
                .data(channel, Bytes::from(format!("{command}\r\n").into_bytes()))
                .await;
            None
        }
    }
}

async fn finish(handle: server::Handle, channel: ChannelId, code: u32) {
    let _ = handle.exit_status_request(channel, code).await;
    let _ = handle.eof(channel).await;
    let _ = handle.close(channel).await;
}

impl server::Handler for Handler {
    type Error = russh::Error;

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if password == PASSWORD {
            self.record(Event::Auth(format!("password:{user}")));
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_publickey(&mut self, user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        Ok(if key.key_data() == self.authorized.key_data() {
            self.record(Event::Auth(format!("publickey:{user}")));
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn auth_keyboard_interactive<'a>(
        &'a mut self,
        user: &str,
        _submethods: &str,
        response: Option<Response<'a>>,
    ) -> Result<Auth, Self::Error> {
        let answers: Vec<Bytes> = response.map(|r| r.collect()).unwrap_or_default();
        if !self.otp_sent {
            self.otp_sent = true;
            return Ok(Auth::Partial {
                name: Cow::Borrowed("otp"),
                instructions: Cow::Borrowed("Enter your one-time code"),
                prompts: Cow::Owned(vec![(Cow::Borrowed("Code: "), false)]),
            });
        }
        self.otp_sent = false;
        Ok(if answers.first().map(|a| &a[..]) == Some(OTP.as_bytes()) {
            self.record(Event::Auth(format!("keyboard-interactive:{user}")));
            Auth::Accept
        } else {
            Auth::reject()
        })
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn pty_request(
        &mut self,
        channel: ChannelId,
        term: &str,
        cols: u32,
        rows: u32,
        _pix_width: u32,
        _pix_height: u32,
        _modes: &[(Pty, u32)],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(Event::Pty {
            term: term.to_string(),
            cols,
            rows,
        });
        session.channel_success(channel)?;
        Ok(())
    }

    async fn window_change_request(
        &mut self,
        _channel: ChannelId,
        cols: u32,
        rows: u32,
        _pix_width: u32,
        _pix_height: u32,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(Event::WindowChange { cols, rows });
        Ok(())
    }

    async fn env_request(
        &mut self,
        channel: ChannelId,
        name: &str,
        value: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(Event::Env {
            name: name.to_string(),
            value: value.to_string(),
        });
        session.channel_success(channel)?;
        Ok(())
    }

    async fn agent_request(
        &mut self,
        _channel: ChannelId,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.record(Event::AgentForward);
        Ok(true)
    }

    async fn shell_request(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(Event::Shell);
        self.shells.insert(channel, String::new());
        session.channel_success(channel)?;
        session.data(channel, Bytes::from_static(b"$ "))?;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let command = String::from_utf8_lossy(data).to_string();
        self.record(Event::Exec(command.clone()));
        session.channel_success(channel)?;
        let handle = session.handle();
        tokio::spawn(async move {
            let code = run_command(&handle, channel, &command).await.unwrap_or(0);
            finish(handle, channel, code).await;
        });
        Ok(())
    }

    async fn data(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(Event::Input(data.to_vec()));
        let Some(buffer) = self.shells.get_mut(&channel) else {
            return Ok(());
        };
        buffer.push_str(&String::from_utf8_lossy(data));
        while let Some(newline) = buffer.find('\n') {
            let line: String = buffer.drain(..=newline).collect();
            let handle = session.handle();
            tokio::spawn(async move {
                match run_command(&handle, channel, &line).await {
                    Some(code) => finish(handle, channel, code).await,
                    None => {
                        let _ = handle.data(channel, Bytes::from_static(b"$ ")).await;
                    }
                }
            });
        }
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        _channel: ChannelId,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.record(Event::Eof);
        Ok(())
    }

    async fn tcpip_forward(
        &mut self,
        address: &str,
        port: &mut u32,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        if *port == 0 {
            *port = 40022;
        }
        self.record(Event::TcpipForward {
            address: address.to_string(),
            port: *port,
        });
        Ok(true)
    }

    async fn cancel_tcpip_forward(
        &mut self,
        address: &str,
        port: u32,
        _session: &mut Session,
    ) -> Result<bool, Self::Error> {
        self.record(Event::CancelTcpipForward {
            address: address.to_string(),
            port,
        });
        Ok(true)
    }
}
