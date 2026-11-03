//! `ssh-connection` / `ssh-channel` driven in-process against the test server.

use core_protocol::testing::{contains, TestStream as Stream};
use serde_json::{json, Value};
use std::time::Duration;
use test_sshd::{Event, TestSshd, OTP, PASSWORD};

async fn connect(server: &TestSshd, extra: Value) -> (Stream, String) {
    let mut config = json!({
        "host": "127.0.0.1",
        "port": server.port,
        "username": "tester",
        "password": PASSWORD,
        "expectedHostFingerprint": server.fingerprint,
    });
    config
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    let mut connection = Stream::open(ssh_session::serve_connection);
    connection.send(json!({"type": "connect", "config": config}));
    let ready = connection.event_of("ready").await;
    (connection, ready["token"].as_str().unwrap().to_string())
}

async fn open_channel(token: &str, open: Value) -> Stream {
    let mut channel = Stream::open(ssh_session::serve_channel);
    let mut event = json!({"type": "open", "connection": token});
    event
        .as_object_mut()
        .unwrap()
        .extend(open.as_object().unwrap().clone());
    channel.send(event);
    channel.event_of("opened").await;
    channel
}

#[tokio::test]
async fn shell_with_pty_env_resize_and_exit_status() {
    let server = TestSshd::start().await;
    let (_connection, token) = connect(&server, json!({})).await;
    let mut shell = open_channel(
        &token,
        json!({
            "kind": "shell",
            "pty": {"term": "xterm-256color", "cols": 120, "rows": 30},
            "env": {"LANG": "en_US.UTF-8"},
        }),
    )
    .await;
    shell.stdout_until("$ ").await;
    shell.write("hello 中文\n");
    shell.stdout_until("hello 中文").await;
    shell.send(json!({"type": "resize", "cols": 100, "rows": 40}));
    shell.write("stderr oops\n");
    shell.write("exit 3\n");
    assert_eq!(shell.event_of("exit").await["code"], 3);
    shell.event_of("closed").await;
    assert_eq!(String::from_utf8_lossy(&shell.stderr), "oops\r\n");

    let events = server.events();
    assert!(events.contains(&Event::Pty {
        term: "xterm-256color".into(),
        cols: 120,
        rows: 30
    }));
    assert!(events.contains(&Event::Env {
        name: "LANG".into(),
        value: "en_US.UTF-8".into()
    }));
    assert!(events.contains(&Event::WindowChange {
        cols: 100,
        rows: 40
    }));
}

#[tokio::test]
async fn exec_returns_output_and_status_and_closes_on_input_eof() {
    let server = TestSshd::start().await;
    let (_connection, token) = connect(&server, json!({})).await;
    let mut exec = open_channel(&token, json!({"kind": "exec", "command": "echo hi"})).await;
    assert_eq!(exec.event_of("exit").await["code"], 0);
    exec.event_of("closed").await;
    assert_eq!(String::from_utf8_lossy(&exec.stdout), "echo hi\r\n");

    // Input EOF reaches the server; closing stays the client's decision.
    let mut shell = open_channel(&token, json!({"kind": "shell"})).await;
    shell.input.take();
    for _ in 0..200 {
        if server.events().contains(&Event::Eof) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(server.events().contains(&Event::Eof));
    shell.send(json!({"type": "close"}));
    shell.event_of("closed").await;
}

#[tokio::test]
async fn asks_the_main_process_for_host_keys_and_prompts() {
    let server = TestSshd::start().await;
    let mut connection = Stream::open(ssh_session::serve_connection);
    connection.send(json!({"type": "connect", "config": {
        "host": "127.0.0.1",
        "port": server.port,
        "username": "otp-user",
        "tryKeyboard": true,
    }}));
    let host_key = connection.event_of("hostKey").await;
    assert_eq!(host_key["fingerprint"], server.fingerprint.as_str());
    assert_eq!(host_key["algorithm"], "ssh-ed25519");
    connection.send(json!({"type": "hostKeyDecision", "id": host_key["id"], "trusted": true}));
    let prompt = connection.event_of("keyboard").await;
    assert_eq!(
        prompt["prompts"],
        json!([{"prompt": "Code: ", "echo": false}])
    );
    connection.send(json!({"type": "keyboardAnswers", "id": prompt["id"], "answers": [OTP]}));
    let ready = connection.event_of("ready").await;
    assert_eq!(ready["reused"], false);

    connection.send(json!({"type": "ping", "id": 7, "timeoutMs": 2000}));
    let pong = connection.event_of("pong").await;
    assert_eq!(
        (pong["id"].as_u64(), pong["healthy"].as_bool()),
        (Some(7), Some(true))
    );

    // Rejecting the key fails the connection.
    let mut rejected = Stream::open(ssh_session::serve_connection);
    rejected.send(json!({"type": "connect", "config": {
        "host": "127.0.0.1", "port": server.port, "username": "other", "password": PASSWORD,
    }}));
    let host_key = rejected.event_of("hostKey").await;
    rejected.send(json!({"type": "hostKeyDecision", "id": host_key["id"], "trusted": false}));
    let error = rejected.event_of("error").await;
    assert!(error["message"]
        .as_str()
        .unwrap()
        .contains("host key verification failed"));
}

#[tokio::test]
async fn a_paused_channel_stalls_alone_and_resumes_without_loss() {
    let server = TestSshd::start().await;
    let (_connection, token) = connect(&server, json!({})).await;
    let mut stalled = open_channel(&token, json!({"kind": "shell"})).await;
    let mut flowing = open_channel(&token, json!({"kind": "shell"})).await;
    stalled.stdout_until("$ ").await;
    stalled.stdout.clear();

    const FLOOD: usize = 16 * 1024 * 1024;
    stalled.send(json!({"type": "pause"}));
    stalled.write(format!("flood {FLOOD}\n"));
    let before_resume = stalled.drain_for(Duration::from_millis(500)).await;
    // Nothing is read while paused: at most what was already decoded.
    assert!(before_resume < 4 * 1024 * 1024, "{before_resume}");

    // The other channel on the same connection is not blocked.
    flowing.write("still flowing\n");
    flowing.stdout_until("still flowing").await;

    stalled.send(json!({"type": "resume"}));
    stalled.stdout_until("DONE").await;
    let done = stalled
        .stdout
        .windows(4)
        .position(|window| window == b"DONE")
        .unwrap();
    assert_eq!(done, FLOOD, "every flooded byte arrives, in order, once");
}

#[tokio::test]
async fn reports_a_closed_connection() {
    let server = TestSshd::start().await;
    let (mut connection, _token) = connect(&server, json!({"username": "closer"})).await;
    server.sever().await;
    let closed = connection.event_of("closed").await;
    assert_eq!(closed["reason"], "connection closed");
}

fn highlight_rules() -> Value {
    json!([{"type": "regex", "enabled": true, "pattern": "error", "flags": "g", "style": "color: red;"}])
}

/// The next ZMODEM event of `kind`.
async fn zmodem(stream: &mut Stream, kind: &str) -> Value {
    loop {
        let event = stream.event_of("zmodem").await;
        assert_ne!(event["kind"], "error", "unexpected error: {event}");
        if event["kind"] == kind {
            return event["event"].clone();
        }
    }
}

#[tokio::test]
async fn pipe_mode_turns_output_into_terminal_text() {
    let server = TestSshd::start().await;
    let (_connection, token) = connect(&server, json!({})).await;
    let mut shell = open_channel(
        &token,
        json!({"kind": "shell", "pty": {}, "pipe": {"rules": highlight_rules()}}),
    )
    .await;
    shell.stdout_until("$ ").await;
    shell.write("an error 中文\n");
    shell.stdout_until("an \x1b[31merror\x1b[0m 中文").await;
    // Stderr is merged, in order, and never highlighted.
    shell.write("stderr error\n");
    shell.stdout_until("\x1b[31merror\r\n\x1b[0m").await;
    assert!(shell.stderr.is_empty());
    shell.write("vim notes.txt\n");
    assert_eq!(shell.event_of("editorMode").await["active"], true);
}

#[tokio::test]
async fn pipe_mode_credit_counts_text_and_pause_reasons_stack() {
    let server = TestSshd::start().await;
    let (_connection, token) = connect(&server, json!({})).await;
    let mut shell = open_channel(
        &token,
        json!({"kind": "shell", "pipe": {}, "credit": 64 * 1024}),
    )
    .await;
    shell.stdout_until("$ ").await;
    shell.stdout.clear();

    const FLOOD: usize = 4 * 1024 * 1024;
    shell.write(format!("flood {FLOOD}\n"));
    let first = shell.drain_for(Duration::from_millis(500)).await;
    // Reading stops once the credit is spent (plus at most one message).
    assert!(first <= 64 * 1024 + 64 * 1024, "{first}");

    shell.send(json!({"type": "pause", "reason": "renderer"}));
    shell.send(json!({"type": "pause", "reason": "zmodem-dialog"}));
    shell.send(json!({"type": "credit", "bytes": 64 * 1024 * 1024}));
    shell.send(json!({"type": "resume", "reason": "renderer"}));
    let paused = shell.drain_for(Duration::from_millis(300)).await;
    assert!(
        paused <= 64 * 1024,
        "still paused by the other reason: {paused}"
    );

    shell.send(json!({"type": "resume", "reason": "zmodem-dialog"}));
    shell.stdout_until("DONE").await;
    let done = shell
        .stdout
        .windows(4)
        .position(|window| window == b"DONE")
        .unwrap();
    assert_eq!(done, FLOOD, "every byte arrives once, in order");
}

#[tokio::test]
async fn zmodem_transfers_run_inside_the_stream() {
    let dir = std::env::temp_dir().join(format!("ssh-session-zmodem-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let server = TestSshd::start().await;
    let (_connection, token) = connect(&server, json!({})).await;
    let mut shell = open_channel(&token, json!({"kind": "shell", "pty": {}, "pipe": {}})).await;
    shell.stdout_until("$ ").await;

    // Download: the remote `sz` is detected and received in the core.
    const SIZE: usize = 300_000;
    shell.write(format!("sz {SIZE}\n"));
    assert_eq!(zmodem(&mut shell, "intro").await["direction"], "download");
    let offer = zmodem(&mut shell, "offer").await;
    assert_eq!(offer["fileName"], format!("sz-{SIZE}.bin"));
    assert_eq!(offer["fileSize"], SIZE);
    let target = dir.join("download.bin");
    let _ = std::fs::remove_file(&target);
    shell.send(json!({"type": "zmodemAccept", "path": target}));
    zmodem(&mut shell, "done").await;
    shell.stdout_until("sz done").await;
    assert_eq!(std::fs::read(&target).unwrap(), test_sshd::sz_payload(SIZE));
    // No protocol bytes reached the terminal.
    assert!(!contains(&shell.stdout, "\x18B0"));

    // Upload: the remote `rz` asks for files.
    let source = dir.join("upload.bin");
    let payload: Vec<u8> = (0..123_457u32)
        .map(|index| (index * 7 % 251) as u8)
        .collect();
    std::fs::write(&source, &payload).unwrap();
    shell.write("rz\n");
    assert_eq!(zmodem(&mut shell, "intro").await["direction"], "upload");
    shell.send(json!({"type": "zmodemSend", "files": [
        {"path": source, "name": "upload.bin", "size": payload.len()}
    ]}));
    zmodem(&mut shell, "done").await;
    use sha2::Digest;
    let digest: String = sha2::Sha256::digest(&payload)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    shell
        .stdout_until(&format!("rz upload.bin {} {digest}", payload.len()))
        .await;

    // Detection resumes: the shell works normally afterwards.
    shell.write("still here\n");
    shell.stdout_until("still here").await;
    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test]
async fn pipe_mode_never_runs_ahead_of_granted_credit() {
    let server = TestSshd::start().await;
    let (_connection, token) = connect(&server, json!({})).await;
    const CREDIT: usize = 64 * 1024;
    let mut shell = open_channel(
        &token,
        json!({"kind": "shell", "pipe": {}, "credit": CREDIT}),
    )
    .await;
    shell.stdout_until("$ ").await;
    let mut delivered = shell.stdout.len();
    let mut granted = 0;
    shell.write("flood 8388608\n");
    let mut peak = 0;
    while !contains(
        &shell.stdout[shell.stdout.len().saturating_sub(64)..],
        "DONE",
    ) {
        shell.drain_for(Duration::from_millis(2)).await;
        let now = shell.stdout.len();
        peak = peak.max(now - granted);
        if now > delivered {
            shell.send(json!({"type": "credit", "bytes": now - delivered}));
            granted += now - delivered;
            delivered = now;
        }
    }
    assert!(peak <= CREDIT + 32 * 1024, "peak {peak}");
}
