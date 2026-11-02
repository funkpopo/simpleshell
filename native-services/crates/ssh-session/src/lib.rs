//! SSH sessions for terminals and remote commands, on shared hub connections.
//!
//! * `ssh-connection` — authenticates (asking the main process to trust host
//!   keys and answer keyboard-interactive prompts) and holds the lease.
//! * `ssh-channel` — a shell or exec channel on that connection, with raw
//!   data, stderr and per-channel flow control; in pipe mode it also runs
//!   the terminal output pipeline and ZMODEM in the core.

mod channel;
mod connection;
mod pipe;
mod registry;

pub use channel::serve as serve_channel;
pub use connection::serve as serve_connection;
