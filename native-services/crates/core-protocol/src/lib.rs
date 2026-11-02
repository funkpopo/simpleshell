//! Shared contract between `simpleshell-core` and the Electron main process:
//! binary framing, control messages and the service I/O context.

pub mod control;
pub mod frame;
pub mod service;

pub use control::{Control, ControlEnvelope, SCHEMA_VERSION};
pub use frame::{Frame, FrameCodec, FrameKind};
pub use service::{Events, StreamIo};
