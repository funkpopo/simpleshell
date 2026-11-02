//! Port forwards run on the shared hub connection for their account, the
//! same one terminals and SFTP use. Keyboard-interactive prompts reach the
//! main process as `auth` messages and come back as `authResponse`.

use super::{Output, Request};
use serde_json::json;
use ssh_hub::{ConnectConfig, Interaction, KeyboardPrompt, Lease};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

const MAX_PROMPT_BYTES: usize = 4096;

/// `authResponse` answers routed to the pending keyboard-interactive prompt.
type Answers = Arc<Mutex<mpsc::Receiver<(u32, Vec<String>)>>>;

fn config(request: &Request) -> Result<ConnectConfig, &'static str> {
    let ssh = request.ssh.as_ref().ok_or("INVALID_CONFIG")?;
    Ok(ConnectConfig {
        host: ssh.host.clone(),
        port: Some(ssh.port),
        username: ssh.username.clone(),
        password: ssh.password.clone(),
        private_key: ssh.private_key.clone(),
        passphrase: ssh.passphrase.clone(),
        expected_host_fingerprint: Some(ssh.expected_host_fingerprint.clone()),
        proxy: ssh.proxy.clone(),
        proxy_required: Some(ssh.proxy_required),
        agent: ssh.agent_path.clone(),
        try_keyboard: Some(ssh.keyboard_interactive),
        ..ConnectConfig::default()
    })
}

fn keyboard_responder(
    request: &Request,
    out: &Output,
    answers: Answers,
) -> ssh_hub::KeyboardResponder {
    let template = request.message("auth");
    let out = out.clone();
    let challenges = Arc::new(AtomicU32::new(0));
    Arc::new(move |prompt: KeyboardPrompt| {
        let (out, answers) = (out.clone(), Arc::clone(&answers));
        let challenge = challenges.fetch_add(1, Ordering::Relaxed) + 1;
        let mut message = template.clone();
        Box::pin(async move {
            if prompt
                .prompts
                .iter()
                .any(|(text, _)| text.len() > MAX_PROMPT_BYTES)
            {
                return None;
            }
            message["challengeId"] = json!(challenge);
            message["name"] = json!(prompt.name);
            message["instructions"] = json!(prompt.instructions);
            message["prompts"] = json!(prompt
                .prompts
                .iter()
                .map(|(text, echo)| json!({"prompt": text, "echo": echo}))
                .collect::<Vec<_>>());
            out.send(message).await.ok()?;
            let (id, values) = answers.lock().await.recv().await?;
            (id == challenge && values.len() == prompt.prompts.len()).then_some(values)
        }) as ssh_hub::BoxFuture<Option<Vec<String>>>
    })
}

/// Maps hub errors onto the forwarding protocol's error codes.
fn error_code(message: &str) -> &'static str {
    let lower = message.to_ascii_lowercase();
    // Proxy refusals ("407 Proxy Authentication Required") are transport
    // failures, not SSH authentication failures.
    if lower.contains("proxy required") {
        "PROXY_REQUIRED"
    } else if lower.contains("proxy") {
        "CONNECT_FAILED"
    } else if lower.contains("host key verification failed") {
        "HOST_KEY_MISMATCH"
    } else if lower.contains("cancelled") {
        "CANCELLED"
    } else if lower.contains("private key") {
        "INVALID_KEY"
    } else if lower.contains("agent unavailable") {
        "AGENT_UNAVAILABLE"
    } else if lower.contains("authentication") {
        "AUTH_FAILED"
    } else if lower.contains("no matching") {
        "ALGORITHM_UNSUPPORTED"
    } else if lower.contains("timed out") {
        "CONNECT_TIMEOUT"
    } else {
        "CONNECT_FAILED"
    }
}

pub(super) async fn acquire(
    request: &Request,
    out: &Output,
    answers: mpsc::Receiver<(u32, Vec<String>)>,
) -> Result<Lease, &'static str> {
    let config = config(request)?;
    let interaction = Interaction {
        host_key: None,
        keyboard: Some(keyboard_responder(
            request,
            out,
            Arc::new(Mutex::new(answers)),
        )),
    };
    ssh_hub::global()
        .acquire(&config, &interaction, &|_| {})
        .await
        .map_err(|message| error_code(&message))
}

#[cfg(test)]
mod tests {
    use super::error_code;

    #[test]
    fn maps_hub_errors_to_protocol_codes() {
        for (message, code) in [
            (
                "SSH host key verification failed for h:22",
                "HOST_KEY_MISMATCH",
            ),
            (
                "All configured authentication methods failed",
                "AUTH_FAILED",
            ),
            ("failed to decode private key: bad", "INVALID_KEY"),
            (
                "proxy required for SSH connection, but none",
                "PROXY_REQUIRED",
            ),
            (
                "no matching Kex algorithm with the SSH server",
                "ALGORITHM_UNSUPPORTED",
            ),
            ("Connection timed out: h:22", "CONNECT_TIMEOUT"),
            ("SSH target TCP connect failed: refused", "CONNECT_FAILED"),
            (
                "HTTP proxy CONNECT failed: 407 Proxy Authentication Required",
                "CONNECT_FAILED",
            ),
        ] {
            assert_eq!(error_code(message), code, "{message}");
        }
    }
}
