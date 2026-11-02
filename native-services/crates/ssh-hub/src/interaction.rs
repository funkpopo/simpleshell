//! Callbacks a connecting stream supplies for decisions only the user (via
//! the main process) can make: trusting a host key and answering
//! keyboard-interactive prompts.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

/// The server's host key as presented to a verifier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKeyInfo {
    /// `SHA256:<hex>` of the public key blob.
    pub fingerprint: String,
    pub algorithm: String,
    /// Base64 of the public key blob.
    pub key_base64: String,
}

#[derive(Debug, Clone)]
pub struct KeyboardPrompt {
    pub name: String,
    pub instructions: String,
    /// `(prompt, echo)` pairs.
    pub prompts: Vec<(String, bool)>,
}

/// Resolves to whether the key is trusted.
pub type HostKeyVerifier = Arc<dyn Fn(HostKeyInfo) -> BoxFuture<bool> + Send + Sync>;
/// Resolves to one answer per prompt, or `None` to abort authentication.
pub type KeyboardResponder =
    Arc<dyn Fn(KeyboardPrompt) -> BoxFuture<Option<Vec<String>>> + Send + Sync>;

#[derive(Clone, Default)]
pub struct Interaction {
    pub host_key: Option<HostKeyVerifier>,
    pub keyboard: Option<KeyboardResponder>,
}
