//! ssh-hub: one SSH connection per host and credential set, shared by every
//! service in the core. SFTP sessions, transfers and (later) terminals and
//! forwards open channels on a leased connection instead of connecting on
//! their own; idle connections are closed after a timeout.

mod config;
mod connect;
pub mod hostkey;
mod hub;

pub use config::{ConnectConfig, ConnectionKey};
pub use connect::{HubHandle, HubHandler};
pub use hub::{global, Hub, HubStats, Lease, DEFAULT_IDLE_TIMEOUT};
