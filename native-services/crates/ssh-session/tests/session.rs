//! `ssh-connection` / `ssh-channel` driven in-process against the test server.

use bytes::Bytes;
use core_protocol::service::{channel_input, Output, ServiceContext};
use core_protocol::{Frame, FrameKind, StreamIo};
use serde_json::{json, Value};
use std::future::Future;
use std::time::Duration;
use test_sshd::{Event, TestSshd, OTP, PASSWORD};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::timeout;

struct Stream {
    input: Option<mpsc::UnboundedSender<Bytes>>,
    events: mpsc::UnboundedSender<Value>,
    output: mpsc::UnboundedReceiver<Frame>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    _task: JoinHandle<Result<(), String>>,
}

impl Stream {
    fn open<F, Fut>(service: F) -> Self
    where
        F: FnOnce(StreamIo) -> Fut,
        Fut: Future<Output = Result<(), String>> + Send + 'static,
    {
        let (input, input_rx) = mpsc::unbounded_channel();
        let (events, events_rx) = mpsc::unbounded_channel();
        let (out_tx, output) = mpsc::unbounded_channel();
        let io = StreamIo {
            input: channel_input(input_rx),
            events: events_rx,
        };
        let context = ServiceContext::new(Output::frames(1, out_tx));
        let task = tokio::spawn(context.run(service(io)));
        Self {
            input: Some(input),
            events,
            output,
            stdout: Vec::new(),
            stderr: Vec::new(),
            _task: task,
        }
    }

    fn send(&self, event: Value) {
        self.events.send(event).unwrap();
    }

    fn write(&self, bytes: &str) {
        self.input
            .as_ref()
            .unwrap()
            .send(Bytes::copy_from_slice(bytes.as_bytes()))
            .unwrap();
    }

    /// Next event, collecting data and stderr seen on the way.
    async fn event(&mut self) -> Value {
        loop {
            let frame = timeout(Duration::from_secs(10), self.output.recv())
                .await
                .expect("frame within 10s")
                .expect("stream still running");
            match frame.kind {
                FrameKind::Event => return serde_json::from_slice(&frame.payload).unwrap(),
                FrameKind::Data => self.stdout.extend_from_slice(&frame.payload),
                FrameKind::Stderr => self.stderr.extend_from_slice(&frame.payload),
                FrameKind::Control => {}
            }
        }
    }

    async fn event_of(&mut self, kind: &str) -> Value {
        loop {
            let event = self.event().await;
            if event["type"] == kind {
                return event;
            }
            assert_ne!(event["type"], "error", "unexpected error: {event}");
        }
    }

    /// Drains output until `needle` appears in stdout. Only new bytes (plus
    /// an overlap) are searched, so large outputs stay linear.
    async fn stdout_until(&mut self, needle: &str) {
        let mut searched: usize = 0;
        loop {
            let from = searched.saturating_sub(needle.len());
            if contains(&self.stdout[from..], needle) {
                return;
            }
            searched = self.stdout.len();
            let frame = timeout(Duration::from_secs(10), self.output.recv())
                .await
                .expect("output within 10s")
                .expect("stream still running");
            match frame.kind {
                FrameKind::Data => self.stdout.extend_from_slice(&frame.payload),
                FrameKind::Stderr => self.stderr.extend_from_slice(&frame.payload),
                _ => {}
            }
        }
    }

    /// Bytes that arrive within `window` without blocking for more.
    async fn drain_for(&mut self, window: Duration) -> usize {
        let mut received = 0;
        while let Ok(Some(frame)) = timeout(window, self.output.recv()).await {
            if frame.kind == FrameKind::Data {
                received += frame.payload.len();
                self.stdout.extend_from_slice(&frame.payload);
            }
        }
        received
    }
}

fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle.as_bytes())
}

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
    stalled.write(&format!("flood {FLOOD}\n"));
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
