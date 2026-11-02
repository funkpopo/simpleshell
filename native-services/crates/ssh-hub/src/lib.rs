//! ssh-hub: one SSH connection per host and account, shared by every service
//! in the core. Terminals, SFTP sessions, transfers and port forwards open
//! channels on a leased connection instead of connecting on their own; idle
//! connections are closed after a timeout.

mod agent;
pub mod algorithms;
mod config;
mod connect;
pub mod hostkey;
mod hub;
mod interaction;

pub use config::{AlgorithmNames, ConnectConfig, ConnectionKey};
pub use connect::{ForwardedChannel, HubHandle, HubHandler};
pub use hub::{global, Hub, HubStats, Lease, DEFAULT_IDLE_TIMEOUT};
pub use interaction::{
    BoxFuture, HostKeyInfo, HostKeyVerifier, Interaction, KeyboardPrompt, KeyboardResponder,
};
