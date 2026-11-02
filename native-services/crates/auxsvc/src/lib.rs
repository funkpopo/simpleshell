//! Auxiliary network services (AI requests, TCP latency probes, IP lookup).
//!
//! They share no state with the terminal/transfer services and run in the
//! separate `aux` core instance for fault isolation.

pub mod ai;
pub mod ip_query;
pub mod latency;
