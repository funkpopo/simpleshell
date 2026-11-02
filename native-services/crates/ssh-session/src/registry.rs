//! Live `ssh-connection` leases, addressed by the token sent in `ready`.
//! A channel keeps its own reference, so it outlives an ended connection
//! stream until the channel itself closes.

use ssh_hub::Lease;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

fn leases() -> &'static Mutex<HashMap<String, Arc<Lease>>> {
    static LEASES: OnceLock<Mutex<HashMap<String, Arc<Lease>>>> = OnceLock::new();
    LEASES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock() -> std::sync::MutexGuard<'static, HashMap<String, Arc<Lease>>> {
    leases().lock().unwrap_or_else(|poison| poison.into_inner())
}

pub(crate) fn insert(lease: Arc<Lease>) -> String {
    static NEXT: AtomicU64 = AtomicU64::new(1);
    let token = format!("ssh-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    lock().insert(token.clone(), lease);
    token
}

pub(crate) fn get(token: &str) -> Option<Arc<Lease>> {
    lock().get(token).cloned()
}

pub(crate) fn remove(token: &str) {
    lock().remove(token);
}
