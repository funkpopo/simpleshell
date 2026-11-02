//! Drives `simpleshell-core serve` over its stdio frame protocol.

use bytes::{Bytes, BytesMut};
use core_protocol::{Control, ControlEnvelope, Frame, FrameCodec, FrameKind};
use futures_util::StreamExt;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::time::timeout;
use tokio_util::codec::{Encoder, FramedRead};

struct Core {
    child: Child,
    stdin: ChildStdin,
    frames: FramedRead<ChildStdout, FrameCodec>,
}

impl Core {
    async fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_simpleshell-core"))
            .args(["serve", "--role", "test"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .expect("core starts");
        let stdin = child.stdin.take().unwrap();
        let frames = FramedRead::new(child.stdout.take().unwrap(), FrameCodec);
        let mut core = Self {
            child,
            stdin,
            frames,
        };
        match core.next_control().await {
            Control::Ready { role, services, .. } => {
                assert_eq!(role, "test");
                assert!(services.iter().any(|name| name == "sftp-session"));
            }
            other => panic!("expected ready, got {other:?}"),
        }
        core
    }

    async fn send(&mut self, frame: Frame) {
        let mut buffer = BytesMut::new();
        FrameCodec.encode(frame, &mut buffer).unwrap();
        tokio::io::AsyncWriteExt::write_all(&mut self.stdin, &buffer)
            .await
            .unwrap();
    }

    async fn control(&mut self, message: Control) {
        self.send(Frame::control_json(
            ControlEnvelope::new(message).to_bytes(),
        ))
        .await;
    }

    async fn open(&mut self, stream: u32, service: &str) {
        self.control(Control::Open {
            stream,
            service: service.into(),
            args: Vec::new(),
        })
        .await;
    }

    async fn line(&mut self, stream: u32, text: &str) {
        self.send(Frame::data(stream, Bytes::from(format!("{text}\n"))))
            .await;
    }

    async fn next(&mut self) -> Frame {
        timeout(Duration::from_secs(10), self.frames.next())
            .await
            .expect("frame within 10s")
            .expect("core still running")
            .expect("valid frame")
    }

    async fn next_control(&mut self) -> Control {
        let frame = self.next().await;
        assert_eq!(frame.kind, FrameKind::Control, "expected control frame");
        ControlEnvelope::parse(&frame.payload).unwrap().message
    }

    /// Collects data for `stream` until its exit arrives.
    async fn until_exit(&mut self, stream: u32) -> (String, Control) {
        let mut data = String::new();
        loop {
            let frame = self.next().await;
            match frame.kind {
                FrameKind::Data if frame.stream == stream => {
                    data.push_str(&String::from_utf8_lossy(&frame.payload))
                }
                FrameKind::Data | FrameKind::Event | FrameKind::Stderr => {}
                FrameKind::Control => {
                    let message = ControlEnvelope::parse(&frame.payload).unwrap().message;
                    if matches!(message, Control::Exit { stream: id, .. } if id == stream) {
                        return (data, message);
                    }
                }
            }
        }
    }
}

#[tokio::test]
async fn streams_echo_and_exit_cleanly_on_eof() {
    let mut core = Core::start().await;
    core.open(1, "diagnostic-echo").await;
    core.line(1, "hello 中文").await;
    core.control(Control::Eof { stream: 1 }).await;
    let (data, exit) = core.until_exit(1).await;
    assert_eq!(data, "hello 中文\n");
    assert_eq!(
        exit,
        Control::Exit {
            stream: 1,
            code: Some(0),
            signal: None,
            error: None
        }
    );
}

#[tokio::test]
async fn a_panicking_stream_does_not_affect_other_streams() {
    let mut core = Core::start().await;
    core.open(1, "diagnostic-echo").await;
    core.open(2, "diagnostic-echo").await;
    core.line(1, "panic").await;
    let (_, exit) = core.until_exit(1).await;
    match exit {
        Control::Exit { code, error, .. } => {
            assert_eq!(code, Some(101));
            assert!(error.unwrap().contains("diagnostic panic requested"));
        }
        other => panic!("unexpected {other:?}"),
    }
    core.line(2, "still alive").await;
    core.control(Control::Eof { stream: 2 }).await;
    let (data, _) = core.until_exit(2).await;
    assert_eq!(data, "still alive\n");

    core.open(3, "diagnostic-echo").await;
    core.line(3, "fail").await;
    match core.until_exit(3).await.1 {
        Control::Exit { code, error, .. } => {
            assert_eq!(code, Some(1));
            assert_eq!(error.as_deref(), Some("diagnostic failure requested"));
        }
        other => panic!("unexpected {other:?}"),
    }
}

#[tokio::test]
async fn kill_stops_the_stream_and_its_background_tasks() {
    let mut core = Core::start().await;
    core.open(7, "diagnostic-echo").await;
    core.line(7, "ticker").await;
    // Wait until the background task is demonstrably running.
    let mut seen = String::new();
    while !seen.contains("tick") {
        let frame = core.next().await;
        seen.push_str(&String::from_utf8_lossy(&frame.payload));
    }
    core.control(Control::Kill { stream: 7 }).await;
    let (_, exit) = core.until_exit(7).await;
    assert_eq!(
        exit,
        Control::Exit {
            stream: 7,
            code: None,
            signal: Some("SIGTERM".into()),
            error: None
        }
    );
    // No further output may arrive for the killed stream.
    core.control(Control::Ping { id: 9 }).await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    core.control(Control::Ping { id: 10 }).await;
    loop {
        let frame = core.next().await;
        assert!(
            frame.kind != FrameKind::Data || frame.stream != 7,
            "killed stream kept emitting"
        );
        if frame.kind == FrameKind::Control
            && ControlEnvelope::parse(&frame.payload).unwrap().message == (Control::Pong { id: 10 })
        {
            break;
        }
    }
}

#[tokio::test]
async fn rejects_bad_requests_without_stopping() {
    let mut core = Core::start().await;
    core.open(1, "no-such-service").await;
    match core.next_control().await {
        Control::Exit { stream, code, .. } => assert_eq!((stream, code), (1, Some(1))),
        other => panic!("unexpected {other:?}"),
    }
    core.open(0, "diagnostic-echo").await;
    assert!(matches!(
        core.next_control().await,
        Control::Error {
            stream: Some(0),
            ..
        }
    ));
    core.send(Frame::control_json(
        &b"{\"schemaVersion\":1,\"op\":\"reboot\"}"[..],
    ))
    .await;
    assert!(matches!(
        core.next_control().await,
        Control::Error { stream: None, .. }
    ));
    core.control(Control::Ping { id: 1 }).await;
    assert_eq!(core.next_control().await, Control::Pong { id: 1 });
}

#[tokio::test]
async fn shutdown_and_closed_stdin_end_the_process() {
    let mut core = Core::start().await;
    core.open(1, "diagnostic-echo").await;
    core.control(Control::Shutdown).await;
    let (_, exit) = core.until_exit(1).await;
    assert!(matches!(exit, Control::Exit { code: None, .. }));
    let status = timeout(Duration::from_secs(5), core.child.wait())
        .await
        .unwrap()
        .unwrap();
    assert!(status.success());

    let mut core = Core::start().await;
    drop(core.stdin);
    let status = timeout(Duration::from_secs(5), core.child.wait())
        .await
        .unwrap()
        .unwrap();
    assert!(status.success());
}
