use super::{Output, Request};
use russh::client::{Handle, Handler, KeyboardInteractiveAuthResponse as Interactive};
use russh::keys::agent::client::{AgentClient, AgentStream};
use russh::keys::{decode_secret_key, PrivateKeyWithHashAlg};
use serde_json::json;
use std::sync::Arc;
use tokio::sync::mpsc;

async fn sign_agent<H: Handler + Sync, S: AgentStream + Send + Unpin + 'static>(
    handle: &mut Handle<H>,
    mut agent: AgentClient<S>,
    user: &str,
) -> Result<bool, &'static str> {
    let identities = agent
        .request_identities()
        .await
        .map_err(|_| "AGENT_UNAVAILABLE")?;
    let alg = handle
        .best_supported_rsa_hash()
        .await
        .map_err(|_| "AUTH_FAILED")?
        .flatten();
    for key in identities.into_iter().take(64) {
        if handle
            .authenticate_publickey_with(user.to_string(), key, alg, &mut agent)
            .await
            .map_err(|_| "AUTH_FAILED")?
            .success()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn agent<H: Handler + Sync>(
    handle: &mut Handle<H>,
    path: &str,
    user: &str,
) -> Result<bool, &'static str> {
    #[cfg(windows)]
    {
        if path.eq_ignore_ascii_case("pageant") {
            return sign_agent(
                handle,
                AgentClient::connect_pageant()
                    .await
                    .map_err(|_| "AGENT_UNAVAILABLE")?,
                user,
            )
            .await;
        }
        sign_agent(
            handle,
            AgentClient::connect_named_pipe(path)
                .await
                .map_err(|_| "AGENT_UNAVAILABLE")?,
            user,
        )
        .await
    }
    #[cfg(unix)]
    {
        sign_agent(
            handle,
            AgentClient::connect_uds(path)
                .await
                .map_err(|_| "AGENT_UNAVAILABLE")?,
            user,
        )
        .await
    }
}

pub(super) async fn authenticate<H: Handler + Sync>(
    handle: &mut Handle<H>,
    request: &Request,
    out: &Output,
    answers: &mut mpsc::Receiver<(u32, Vec<String>)>,
) -> Result<(), &'static str> {
    let ssh = request.ssh.as_ref().ok_or("INVALID_CONFIG")?;
    if handle
        .authenticate_none(ssh.username.clone())
        .await
        .map_err(|_| "AUTH_FAILED")?
        .success()
    {
        return Ok(());
    }
    if let Some(password) = &ssh.password {
        if handle
            .authenticate_password(ssh.username.clone(), password.clone())
            .await
            .map_err(|_| "AUTH_FAILED")?
            .success()
        {
            return Ok(());
        }
    }
    if let Some(private_key) = &ssh.private_key {
        let key =
            decode_secret_key(private_key, ssh.passphrase.as_deref()).map_err(|_| "INVALID_KEY")?;
        let alg = handle
            .best_supported_rsa_hash()
            .await
            .map_err(|_| "AUTH_FAILED")?
            .flatten();
        if handle
            .authenticate_publickey(
                ssh.username.clone(),
                PrivateKeyWithHashAlg::new(Arc::new(key), alg),
            )
            .await
            .map_err(|_| "AUTH_FAILED")?
            .success()
        {
            return Ok(());
        }
    }
    if let Some(path) = &ssh.agent_path {
        if agent(handle, path, &ssh.username).await? {
            return Ok(());
        }
    }
    if ssh.keyboard_interactive {
        let mut response = handle
            .authenticate_keyboard_interactive_start(ssh.username.clone(), None)
            .await
            .map_err(|_| "AUTH_FAILED")?;
        for challenge in 1..=8 {
            match response {
                Interactive::Success => return Ok(()),
                Interactive::Failure { .. } => return Err("AUTH_FAILED"),
                Interactive::InfoRequest {
                    name,
                    instructions,
                    prompts,
                } => {
                    if name.len() > 4096
                        || instructions.len() > 8192
                        || prompts.len() > 32
                        || prompts.iter().any(|p| p.prompt.len() > 4096)
                    {
                        return Err("AUTH_FAILED");
                    }
                    let mut message = request.message("auth");
                    message["challengeId"] = json!(challenge);
                    message["name"] = json!(name);
                    message["instructions"] = json!(instructions);
                    message["prompts"] = json!(prompts
                        .iter()
                        .map(|p| json!({"prompt":p.prompt,"echo":p.echo}))
                        .collect::<Vec<_>>());
                    out.send(message).await.map_err(|_| "CANCELLED")?;
                    let (id, values) = answers.recv().await.ok_or("CANCELLED")?;
                    if id != challenge || values.len() != prompts.len() {
                        return Err("AUTH_FAILED");
                    }
                    response = handle
                        .authenticate_keyboard_interactive_respond(values)
                        .await
                        .map_err(|_| "AUTH_FAILED")?;
                }
            }
        }
        if matches!(response, Interactive::Success) {
            return Ok(());
        }
    }
    Err("AUTH_FAILED")
}
