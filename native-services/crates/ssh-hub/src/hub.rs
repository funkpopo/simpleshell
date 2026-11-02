//! Shared SSH connections: one russh connection per connection identity,
//! leased by every stream that needs a channel on it.

use crate::config::{ConnectConfig, ConnectionKey};
use crate::connect::{establish, ConnectionShared, ForwardedChannel, HubHandle};
use crate::interaction::{HostKeyInfo, Interaction};
use russh::client::Msg;
use russh::{Channel, Disconnect};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio::sync::{mpsc, Mutex as AsyncMutex};

pub const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(30);
const CHANNEL_OPEN_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_REAP_INTERVAL: Duration = Duration::from_secs(5);

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}

struct Connection {
    id: u64,
    handle: HubHandle,
    shared: Arc<ConnectionShared>,
    leases: AtomicUsize,
    idle_since: Mutex<Option<Instant>>,
    broken: AtomicBool,
}

impl Connection {
    fn usable(&self) -> bool {
        !self.broken.load(Ordering::Acquire) && !self.handle.is_closed()
    }

    fn lease(self: &Arc<Self>, reused: bool) -> Lease {
        self.leases.fetch_add(1, Ordering::AcqRel);
        *lock(&self.idle_since) = None;
        Lease {
            connection: Arc::clone(self),
            reused,
        }
    }

    fn idle_for(&self, now: Instant) -> Option<Duration> {
        if self.leases.load(Ordering::Acquire) > 0 {
            return None;
        }
        lock(&self.idle_since).map(|since| now.saturating_duration_since(since))
    }
}

async fn verify_reused(
    connection: &Connection,
    config: &ConnectConfig,
    interaction: &Interaction,
) -> Result<(), String> {
    let info = connection
        .shared
        .host_key()
        .ok_or_else(|| "shared connection has no verified host key".to_string())?;
    let trusted = match (config.pinned_fingerprint(), interaction.host_key.as_ref()) {
        (Some(pinned), _) => pinned == info.fingerprint,
        (None, Some(verifier)) => verifier(info).await,
        (None, None) => false,
    };
    if trusted {
        Ok(())
    } else {
        Err(format!(
            "SSH host key verification failed for {}:{}",
            config.host,
            config.port()
        ))
    }
}

fn retire(connection: Arc<Connection>) {
    tokio::spawn(async move {
        let _ = connection
            .handle
            .disconnect(Disconnect::ByApplication, "", "English")
            .await;
    });
}

/// A claim on a shared connection. The connection stays open while any lease
/// exists and is closed after the hub's idle timeout once the last one drops.
pub struct Lease {
    connection: Arc<Connection>,
    reused: bool,
}

impl Lease {
    /// Whether this lease joined an existing connection (no handshake).
    pub fn reused(&self) -> bool {
        self.reused
    }

    pub fn connection_id(&self) -> u64 {
        self.connection.id
    }

    pub fn handle(&self) -> &HubHandle {
        &self.connection.handle
    }

    /// Opens a session channel. A failure marks the connection broken so the
    /// next acquire reconnects instead of reusing a half-dead transport.
    pub async fn open_session(&self) -> Result<Channel<Msg>, String> {
        match tokio::time::timeout(
            CHANNEL_OPEN_TIMEOUT,
            self.connection.handle.channel_open_session(),
        )
        .await
        {
            Ok(Ok(channel)) => Ok(channel),
            Ok(Err(error)) => {
                self.mark_broken();
                Err(format!("failed to open SSH channel: {error}"))
            }
            Err(_) => {
                self.mark_broken();
                Err("timed out opening SSH channel".to_string())
            }
        }
    }

    pub fn mark_broken(&self) {
        self.connection.broken.store(true, Ordering::Release);
    }

    /// The host key this connection verified during its handshake.
    pub fn host_key(&self) -> Option<HostKeyInfo> {
        self.connection.shared.host_key()
    }

    /// Records traffic on one of this connection's channels (liveness proof).
    pub fn mark_received(&self) {
        self.connection.shared.mark_received();
    }

    /// Transport health: a keepalive answered within `timeout`, or channel
    /// data received within it. A busy peer may queue global replies behind
    /// earlier requests while it keeps sending channel data.
    pub async fn check_alive(&self, timeout: Duration) -> bool {
        if !self.connection.usable() {
            return false;
        }
        match tokio::time::timeout(timeout, self.connection.handle.send_ping()).await {
            Ok(Ok(())) => true,
            Ok(Err(_)) => false,
            Err(_) => self
                .connection
                .shared
                .since_received()
                .is_some_and(|since| since < timeout),
        }
    }

    /// Requests a remote (`-R`) forward and routes its incoming channels to
    /// the returned receiver until [`Lease::cancel_remote_forward`].
    pub async fn remote_forward(
        &self,
        address: &str,
        port: u32,
    ) -> Result<(u32, mpsc::UnboundedReceiver<ForwardedChannel>), String> {
        let bound = self
            .connection
            .handle
            .tcpip_forward(address, port)
            .await
            .map_err(|error| format!("remote forward failed: {error}"))?;
        let bound = if port == 0 { bound } else { port };
        let (tx, rx) = mpsc::unbounded_channel();
        self.connection
            .shared
            .route_remote_forward(address, bound, tx);
        Ok((bound, rx))
    }

    pub async fn cancel_remote_forward(&self, address: &str, port: u32) -> Result<(), String> {
        self.connection.shared.unroute_remote_forward(address, port);
        self.connection
            .handle
            .cancel_tcpip_forward(address, port)
            .await
            .map_err(|error| format!("cancel remote forward failed: {error}"))
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        if self.connection.leases.fetch_sub(1, Ordering::AcqRel) == 1 {
            *lock(&self.connection.idle_since) = Some(Instant::now());
        }
    }
}

#[derive(Default)]
struct Slot {
    connection: AsyncMutex<Option<Arc<Connection>>>,
}

struct Inner {
    slots: Mutex<HashMap<ConnectionKey, Arc<Slot>>>,
    idle_timeout: Duration,
    handshakes: AtomicU64,
    next_id: AtomicU64,
    reaper_started: AtomicBool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct HubStats {
    /// Live connections.
    pub connections: usize,
    /// Outstanding leases across all connections.
    pub leases: usize,
    /// Handshakes performed since the hub was created.
    pub handshakes: u64,
}

pub struct Hub {
    inner: Arc<Inner>,
}

impl Hub {
    pub fn new(idle_timeout: Duration) -> Self {
        Self {
            inner: Arc::new(Inner {
                slots: Mutex::new(HashMap::new()),
                idle_timeout,
                handshakes: AtomicU64::new(0),
                next_id: AtomicU64::new(1),
                reaper_started: AtomicBool::new(false),
            }),
        }
    }

    /// Returns a lease on the connection for `config`, connecting first when
    /// there is none. Concurrent acquires for one identity share a handshake.
    /// A reused connection is still checked against this caller's host-key
    /// policy: a pinned fingerprint must match, and a verifier is consulted.
    pub async fn acquire(
        &self,
        config: &ConnectConfig,
        interaction: &Interaction,
        stage: &(dyn Fn(&str) + Sync),
    ) -> Result<Lease, String> {
        let slot = Arc::clone(lock(&self.inner.slots).entry(config.key()).or_default());
        let mut current = slot.connection.lock().await;
        if let Some(connection) = current.as_ref() {
            if connection.usable() {
                verify_reused(connection, config, interaction).await?;
                connection.shared.offer_agent(
                    config
                        .agent
                        .as_deref()
                        .filter(|_| config.agent_forward.unwrap_or(false)),
                );
                stage("sshConnectionReused");
                return Ok(connection.lease(true));
            }
            if let Some(stale) = current.take() {
                retire(stale);
            }
        }

        let (handle, shared) = establish(config, interaction, stage).await?;
        self.inner.handshakes.fetch_add(1, Ordering::Relaxed);
        let connection = Arc::new(Connection {
            id: self.inner.next_id.fetch_add(1, Ordering::Relaxed),
            handle,
            shared,
            leases: AtomicUsize::new(0),
            idle_since: Mutex::new(None),
            broken: AtomicBool::new(false),
        });
        let lease = connection.lease(false);
        *current = Some(connection);
        drop(current);
        self.ensure_reaper();
        Ok(lease)
    }

    pub fn stats(&self) -> HubStats {
        let mut stats = HubStats {
            handshakes: self.inner.handshakes.load(Ordering::Relaxed),
            ..HubStats::default()
        };
        for slot in lock(&self.inner.slots).values() {
            if let Ok(current) = slot.connection.try_lock() {
                if let Some(connection) = current.as_ref().filter(|c| c.usable()) {
                    stats.connections += 1;
                    stats.leases += connection.leases.load(Ordering::Acquire);
                }
            }
        }
        stats
    }

    /// Closes connections that are broken, or idle past the timeout.
    /// Returns how many were closed.
    pub fn reap(&self) -> usize {
        let now = Instant::now();
        let mut closed = 0;
        let mut slots = lock(&self.inner.slots);
        slots.retain(|_, slot| {
            // A locked slot is being acquired right now; leave it alone.
            let Ok(mut current) = slot.connection.try_lock() else {
                return true;
            };
            let expired = current.as_ref().is_some_and(|connection| {
                !connection.usable()
                    || connection
                        .idle_for(now)
                        .is_some_and(|idle| idle >= self.inner.idle_timeout)
            });
            if expired {
                if let Some(connection) = current.take() {
                    retire(connection);
                    closed += 1;
                }
            }
            current.is_some()
        });
        closed
    }

    /// Disconnects every connection gracefully (process shutdown).
    pub async fn shutdown(&self) {
        let slots: Vec<_> = lock(&self.inner.slots)
            .drain()
            .map(|(_, slot)| slot)
            .collect();
        for slot in slots {
            if let Some(connection) = slot.connection.lock().await.take() {
                let _ = connection
                    .handle
                    .disconnect(Disconnect::ByApplication, "", "English")
                    .await;
            }
        }
    }

    fn ensure_reaper(&self) {
        if self.inner.reaper_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let inner = Arc::downgrade(&self.inner);
        let period =
            (self.inner.idle_timeout / 4).clamp(Duration::from_millis(20), MAX_REAP_INTERVAL);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(period).await;
                let Some(inner) = inner.upgrade() else { break };
                Hub { inner }.reap();
            }
        });
    }
}

/// The process-wide hub. `SIMPLESHELL_HUB_IDLE_MS` overrides the idle timeout.
pub fn global() -> &'static Hub {
    static HUB: OnceLock<Hub> = OnceLock::new();
    HUB.get_or_init(|| {
        let idle = std::env::var("SIMPLESHELL_HUB_IDLE_MS")
            .ok()
            .and_then(|value| value.parse::<u64>().ok())
            .map(Duration::from_millis)
            .unwrap_or(DEFAULT_IDLE_TIMEOUT);
        Hub::new(idle)
    })
}
