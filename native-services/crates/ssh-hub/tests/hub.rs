//! Hub behaviour against the in-process test server.

use russh::ChannelMsg;
use ssh_hub::{ConnectConfig, Hub, HubStats, Interaction, KeyboardPrompt};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use test_sshd::{Event, TestSshd, OTP, PASSWORD};

fn config(server: &TestSshd) -> ConnectConfig {
    ConnectConfig {
        host: "127.0.0.1".into(),
        port: Some(server.port),
        username: "tester".into(),
        password: Some(PASSWORD.into()),
        expected_host_fingerprint: Some(server.fingerprint.clone()),
        ..ConnectConfig::default()
    }
}

fn no_stage(_: &str) {}

fn plain() -> Interaction {
    Interaction::default()
}

async fn eventually(mut condition: impl FnMut() -> bool) {
    for _ in 0..200 {
        if condition() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("condition not reached");
}

#[tokio::test]
async fn leases_share_one_connection_and_channels() {
    let server = TestSshd::start().await;
    let hub = Hub::new(Duration::from_secs(60));
    let stages = Mutex::new(Vec::new());
    let record = |stage: &str| stages.lock().unwrap().push(stage.to_string());

    let first = hub
        .acquire(&config(&server), &plain(), &record)
        .await
        .unwrap();
    assert!(!first.reused());
    assert_eq!(
        *stages.lock().unwrap(),
        ["tcpConnected", "sshHandshakeCompleted", "authenticated"]
    );
    // A different credential for the same account joins the connection.
    let mut by_key = config(&server);
    by_key.password = None;
    by_key.private_key = Some(server.client_key_pem(None));
    let second = hub.acquire(&by_key, &plain(), &record).await.unwrap();
    assert!(second.reused());
    assert_eq!(second.connection_id(), first.connection_id());
    assert_eq!(
        stages.lock().unwrap().last().unwrap(),
        "sshConnectionReused"
    );

    let (a, b) = tokio::join!(first.open_session(), second.open_session());
    assert!(a.is_ok() && b.is_ok());
    assert_eq!(server.connections(), 1);
    assert_eq!(
        hub.stats(),
        HubStats {
            connections: 1,
            leases: 2,
            handshakes: 1
        }
    );
}

#[tokio::test]
async fn concurrent_acquires_perform_a_single_handshake() {
    let server = TestSshd::start().await;
    let hub = Arc::new(Hub::new(Duration::from_secs(60)));
    let tasks: Vec<_> = (0..8)
        .map(|_| {
            let hub = Arc::clone(&hub);
            let config = config(&server);
            tokio::spawn(async move { hub.acquire(&config, &plain(), &no_stage).await.unwrap() })
        })
        .collect();
    let mut leases = Vec::new();
    for task in tasks {
        leases.push(task.await.unwrap());
    }
    assert_eq!(server.connections(), 1);
    assert_eq!(leases.iter().filter(|lease| !lease.reused()).count(), 1);
    assert_eq!(hub.stats().handshakes, 1);
}

#[tokio::test]
async fn authenticates_with_encrypted_keys_and_rejects_bad_credentials() {
    let server = TestSshd::start().await;
    let hub = Hub::new(Duration::from_secs(60));
    let mut encrypted = config(&server);
    encrypted.password = None;
    encrypted.private_key = Some(server.client_key_pem(Some("pass phrase")));
    encrypted.passphrase = Some("pass phrase".into());
    hub.acquire(&encrypted, &plain(), &no_stage).await.unwrap();
    assert!(server
        .events()
        .contains(&Event::Auth("publickey:tester".into())));

    let fresh = Hub::new(Duration::from_secs(60));
    let mut wrong = config(&server);
    wrong.password = Some("nope".into());
    let error = fresh
        .acquire(&wrong, &plain(), &no_stage)
        .await
        .err()
        .unwrap();
    assert!(error.contains("failed"), "{error}");

    let mut wrong_key = config(&server);
    wrong_key.expected_host_fingerprint = Some("SHA256:00".into());
    let error = fresh
        .acquire(&wrong_key, &plain(), &no_stage)
        .await
        .err()
        .unwrap();
    assert!(error.contains("host key verification failed"), "{error}");
    // ...including when the connection already exists.
    let error = hub
        .acquire(&wrong_key, &plain(), &no_stage)
        .await
        .err()
        .unwrap();
    assert!(error.contains("host key verification failed"), "{error}");
}

#[tokio::test]
async fn asks_for_host_keys_and_answers_keyboard_interactive_prompts() {
    let server = TestSshd::start().await;
    let hub = Hub::new(Duration::from_secs(60));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let prompts = Arc::new(Mutex::new(Vec::<KeyboardPrompt>::new()));
    let interaction = |trust: bool| {
        let seen = Arc::clone(&seen);
        let prompts = Arc::clone(&prompts);
        Interaction {
            host_key: Some(Arc::new(move |info| {
                seen.lock().unwrap().push(info);
                Box::pin(async move { trust })
            })),
            keyboard: Some(Arc::new(move |prompt| {
                prompts.lock().unwrap().push(prompt);
                Box::pin(async { Some(vec![OTP.to_string()]) })
            })),
        }
    };
    let mut interactive = config(&server);
    interactive.password = None;
    interactive.expected_host_fingerprint = None;
    interactive.try_keyboard = Some(true);

    let error = hub
        .acquire(&interactive, &interaction(false), &no_stage)
        .await
        .err()
        .unwrap();
    assert!(error.contains("host key verification failed"), "{error}");

    let lease = hub
        .acquire(&interactive, &interaction(true), &no_stage)
        .await
        .unwrap();
    assert_eq!(
        seen.lock().unwrap().last().unwrap().fingerprint,
        server.fingerprint
    );
    assert_eq!(lease.host_key().unwrap().fingerprint, server.fingerprint);
    assert_eq!(
        prompts.lock().unwrap()[0].prompts,
        [("Code: ".to_string(), false)]
    );
    assert!(server
        .events()
        .contains(&Event::Auth("keyboard-interactive:tester".into())));

    // Reuse consults the verifier again and honours its answer.
    assert!(hub
        .acquire(&interactive, &interaction(true), &no_stage)
        .await
        .is_ok());
    assert!(hub
        .acquire(&interactive, &interaction(false), &no_stage)
        .await
        .is_err());
    assert_eq!(server.connections(), 2);
}

#[tokio::test]
async fn idle_connections_are_reclaimed_after_the_last_lease() {
    let server = TestSshd::start().await;
    let hub = Hub::new(Duration::from_millis(100));
    let lease = hub
        .acquire(&config(&server), &plain(), &no_stage)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(hub.stats().connections, 1, "a leased connection stays open");

    drop(lease);
    eventually(|| hub.stats().connections == 0).await;
    let next = hub
        .acquire(&config(&server), &plain(), &no_stage)
        .await
        .unwrap();
    assert!(!next.reused());
    assert_eq!(server.connections(), 2);
}

#[tokio::test]
async fn dead_connections_fail_health_checks_and_are_replaced() {
    let server = TestSshd::start().await;
    let hub = Hub::new(Duration::from_secs(60));
    let lease = hub
        .acquire(&config(&server), &plain(), &no_stage)
        .await
        .unwrap();
    assert!(lease.check_alive(Duration::from_secs(2)).await);

    server.sever().await;
    eventually(|| lease.handle().is_closed()).await;
    assert!(!lease.check_alive(Duration::from_secs(2)).await);
    assert!(lease.open_session().await.is_err());
    drop(lease);

    let replacement = hub
        .acquire(&config(&server), &plain(), &no_stage)
        .await
        .unwrap();
    assert!(!replacement.reused());
    assert!(replacement.open_session().await.is_ok());
    assert_eq!(server.connections(), 2);
}

#[tokio::test]
async fn remote_forwards_route_server_channels_to_their_lease() {
    let server = TestSshd::start().await;
    let hub = Hub::new(Duration::from_secs(60));
    let lease = hub
        .acquire(&config(&server), &plain(), &no_stage)
        .await
        .unwrap();
    let (port, mut incoming) = lease.remote_forward("127.0.0.1", 0).await.unwrap();
    assert_eq!(port, 40022);

    let mut opened = server.open_forwarded("127.0.0.1", port).await;
    let forwarded = tokio::time::timeout(Duration::from_secs(5), incoming.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (forwarded.address.as_str(), forwarded.port),
        ("127.0.0.1", port)
    );
    forwarded.channel.data(&b"ping"[..]).await.unwrap();
    match opened[0].wait().await {
        Some(ChannelMsg::Data { data }) => assert_eq!(&data[..], b"ping"),
        other => panic!("unexpected {other:?}"),
    }

    lease
        .cancel_remote_forward("127.0.0.1", port)
        .await
        .unwrap();
    assert!(server.events().contains(&Event::CancelTcpipForward {
        address: "127.0.0.1".into(),
        port
    }));
}

/// Bytes on an exec channel until it closes.
async fn exec_output(lease: &ssh_hub::Lease, command: &str) -> Vec<u8> {
    let mut channel = lease.open_session().await.unwrap();
    channel.exec(true, command).await.unwrap();
    let mut out = Vec::new();
    while let Some(message) = channel.wait().await {
        match message {
            ChannelMsg::Data { data } => out.extend_from_slice(&data),
            ChannelMsg::Close | ChannelMsg::Eof => break,
            _ => {}
        }
    }
    out
}

#[tokio::test]
async fn compressed_connections_carry_bulk_output_intact() {
    let server = TestSshd::start().await;
    let hub = Hub::new(Duration::from_secs(60));
    let mut compressed = config(&server);
    compressed.enable_compression = Some(true);
    let lease = hub.acquire(&compressed, &plain(), &no_stage).await.unwrap();

    let out = exec_output(&lease, "flood 200000").await;
    assert!(out.len() >= 200_000, "got {} bytes", out.len());
    assert!(String::from_utf8_lossy(&out).contains("DONE"));
    // Compression does not change which consumers share the connection.
    let plain_lease = hub
        .acquire(&config(&server), &plain(), &no_stage)
        .await
        .unwrap();
    assert!(plain_lease.reused());
}
