//! Hub behaviour against an in-process russh server.

use russh::keys::ssh_key::rand_core::OsRng;
use russh::keys::{Algorithm, PrivateKey};
use russh::server::{self, Auth, Msg, Session};
use russh::Channel;
use ssh_hub::{hostkey, ConnectConfig, Hub, HubStats};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

#[derive(Default)]
struct Counters {
    connections: AtomicUsize,
    sessions: AtomicUsize,
}

struct ServerHandler {
    counters: Arc<Counters>,
}

impl server::Handler for ServerHandler {
    type Error = russh::Error;

    async fn auth_password(&mut self, _user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(if password == "secret" {
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
        self.counters.sessions.fetch_add(1, Ordering::SeqCst);
        Ok(true)
    }
}

struct TestServer {
    port: u16,
    fingerprint: String,
    counters: Arc<Counters>,
    sessions: Arc<Mutex<Vec<server::Handle>>>,
    accept: JoinHandle<()>,
}

impl TestServer {
    async fn start() -> Self {
        let key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let fingerprint = hostkey::fingerprint(key.public_key()).unwrap();
        let config = Arc::new(server::Config {
            keys: vec![key],
            auth_rejection_time: Duration::from_millis(5),
            auth_rejection_time_initial: Some(Duration::ZERO),
            ..Default::default()
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let counters = Arc::new(Counters::default());
        let sessions = Arc::new(Mutex::new(Vec::new()));
        let accept = {
            let counters = Arc::clone(&counters);
            let sessions = Arc::clone(&sessions);
            tokio::spawn(async move {
                while let Ok((socket, _)) = listener.accept().await {
                    counters.connections.fetch_add(1, Ordering::SeqCst);
                    let handler = ServerHandler {
                        counters: Arc::clone(&counters),
                    };
                    if let Ok(session) =
                        server::run_stream(Arc::clone(&config), socket, handler).await
                    {
                        sessions.lock().unwrap().push(session.handle());
                        tokio::spawn(session);
                    }
                }
            })
        };
        Self {
            port,
            fingerprint,
            counters,
            sessions,
            accept,
        }
    }

    fn config(&self) -> ConnectConfig {
        ConnectConfig {
            host: "127.0.0.1".into(),
            port: Some(self.port),
            username: "tester".into(),
            password: Some("secret".into()),
            private_key: None,
            passphrase: None,
            expected_host_fingerprint: Some(self.fingerprint.clone()),
            proxy: None,
            proxy_required: None,
        }
    }

    fn connections(&self) -> usize {
        self.counters.connections.load(Ordering::SeqCst)
    }

    /// Ends every server-side session.
    async fn sever(&self) {
        let sessions: Vec<_> = self.sessions.lock().unwrap().drain(..).collect();
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
}

impl Drop for TestServer {
    fn drop(&mut self) {
        self.accept.abort();
    }
}

fn no_stage(_: &str) {}

async fn eventually(mut condition: impl FnMut() -> bool) {
    for _ in 0..200 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("condition not reached");
}

#[tokio::test]
async fn leases_share_one_connection_and_channels() {
    let server = TestServer::start().await;
    let hub = Hub::new(Duration::from_secs(60));
    let stages = Mutex::new(Vec::new());
    let record = |stage: &str| stages.lock().unwrap().push(stage.to_string());

    let first = hub.acquire(&server.config(), &record).await.unwrap();
    assert!(!first.reused());
    assert_eq!(
        *stages.lock().unwrap(),
        ["tcpConnected", "sshHandshakeCompleted", "authenticated"]
    );
    let second = hub.acquire(&server.config(), &record).await.unwrap();
    assert!(second.reused());
    assert_eq!(second.connection_id(), first.connection_id());
    assert_eq!(
        stages.lock().unwrap().last().unwrap(),
        "sshConnectionReused"
    );

    let channels = futures_join(&first, &second).await;
    assert_eq!(channels, 2);
    assert_eq!(server.counters.sessions.load(Ordering::SeqCst), 2);
    assert_eq!(server.connections(), 1);
    assert_eq!(
        hub.stats(),
        HubStats {
            connections: 1,
            leases: 2,
            handshakes: 1
        }
    );
}

async fn futures_join(first: &ssh_hub::Lease, second: &ssh_hub::Lease) -> usize {
    let (a, b) = tokio::join!(first.open_session(), second.open_session());
    usize::from(a.is_ok()) + usize::from(b.is_ok())
}

#[tokio::test]
async fn concurrent_acquires_perform_a_single_handshake() {
    let server = TestServer::start().await;
    let hub = Arc::new(Hub::new(Duration::from_secs(60)));
    let tasks: Vec<_> = (0..8)
        .map(|_| {
            let hub = Arc::clone(&hub);
            let config = server.config();
            tokio::spawn(async move { hub.acquire(&config, &no_stage).await.unwrap() })
        })
        .collect();
    let mut leases = Vec::new();
    for task in tasks {
        leases.push(task.await.unwrap());
    }
    assert_eq!(server.connections(), 1);
    assert_eq!(leases.iter().filter(|lease| !lease.reused()).count(), 1);
    assert_eq!(hub.stats().handshakes, 1);
}

#[tokio::test]
async fn different_identities_get_separate_connections() {
    let server = TestServer::start().await;
    let hub = Hub::new(Duration::from_secs(60));
    let _a = hub.acquire(&server.config(), &no_stage).await.unwrap();
    let mut other_user = server.config();
    other_user.username = "other".into();
    let _b = hub.acquire(&other_user, &no_stage).await.unwrap();
    assert_eq!(server.connections(), 2);

    let mut wrong_password = server.config();
    wrong_password.password = Some("nope".into());
    let error = hub.acquire(&wrong_password, &no_stage).await.err().unwrap();
    assert!(error.contains("password authentication failed"), "{error}");

    let mut wrong_key = server.config();
    wrong_key.expected_host_fingerprint = Some("SHA256:00".into());
    let error = hub.acquire(&wrong_key, &no_stage).await.err().unwrap();
    assert!(error.contains("host key verification failed"), "{error}");
    assert_eq!(hub.stats().connections, 2);
}

#[tokio::test]
async fn idle_connections_are_reclaimed_after_the_last_lease() {
    let server = TestServer::start().await;
    let hub = Hub::new(Duration::from_millis(100));
    let lease = hub.acquire(&server.config(), &no_stage).await.unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(hub.stats().connections, 1, "a leased connection stays open");

    drop(lease);
    eventually(|| hub.stats().connections == 0).await;
    let next = hub.acquire(&server.config(), &no_stage).await.unwrap();
    assert!(!next.reused());
    assert_eq!(server.connections(), 2);
}

#[tokio::test]
async fn a_dead_connection_is_replaced_on_the_next_acquire() {
    let server = TestServer::start().await;
    let hub = Hub::new(Duration::from_secs(60));
    let lease = hub.acquire(&server.config(), &no_stage).await.unwrap();
    server.sever().await;
    eventually(|| lease.handle().is_closed()).await;
    assert!(lease.open_session().await.is_err());
    drop(lease);

    let replacement = hub.acquire(&server.config(), &no_stage).await.unwrap();
    assert!(!replacement.reused());
    assert!(replacement.open_session().await.is_ok());
    assert_eq!(server.connections(), 2);
}
