//! Product sidecars share this namespace. `main.rs` only routes subcommands;
//! each sidecar owns its protocol and execution implementation.

pub mod ai;
pub mod file_management;
