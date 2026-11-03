//! Drives a service in-process the way the core's server does (feature
//! `testing`, for the service crates' tests).

use crate::service::{channel_input, Output, ServiceContext};
use crate::{Frame, FrameKind, StreamIo};
use bytes::Bytes;
use serde_json::Value;
use std::future::Future;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::timeout;

/// How long a test waits for the next frame.
const FRAME_TIMEOUT: Duration = Duration::from_secs(10);

/// One service stream: send events and input, collect data and stderr.
pub struct TestStream {
    pub input: Option<mpsc::UnboundedSender<Bytes>>,
    events: mpsc::UnboundedSender<Value>,
    output: mpsc::UnboundedReceiver<Frame>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
    _task: JoinHandle<Result<(), String>>,
}

impl TestStream {
    pub fn open<F, Fut>(service: F) -> Self
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

    pub fn send(&self, event: Value) {
        self.events.send(event).unwrap();
    }

    pub fn write(&self, bytes: impl AsRef<[u8]>) {
        self.input
            .as_ref()
            .unwrap()
            .send(Bytes::copy_from_slice(bytes.as_ref()))
            .unwrap();
    }

    fn collect(&mut self, frame: Frame) -> Option<Value> {
        match frame.kind {
            FrameKind::Event => Some(serde_json::from_slice(&frame.payload).unwrap()),
            FrameKind::Data => {
                self.stdout.extend_from_slice(&frame.payload);
                None
            }
            FrameKind::Stderr => {
                self.stderr.extend_from_slice(&frame.payload);
                None
            }
            FrameKind::Control => None,
        }
    }

    async fn next_frame(&mut self) -> Frame {
        timeout(FRAME_TIMEOUT, self.output.recv())
            .await
            .expect("frame within 10s")
            .expect("stream still running")
    }

    /// Next event, collecting data and stderr seen on the way.
    pub async fn event(&mut self) -> Value {
        loop {
            let frame = self.next_frame().await;
            if let Some(event) = self.collect(frame) {
                return event;
            }
        }
    }

    /// Next event of `kind`; fails on an `error` event first.
    pub async fn event_of(&mut self, kind: &str) -> Value {
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
    pub async fn stdout_until(&mut self, needle: &str) {
        let mut searched: usize = 0;
        loop {
            let from = searched.saturating_sub(needle.len());
            if contains(&self.stdout[from..], needle) {
                return;
            }
            searched = self.stdout.len();
            let frame = self.next_frame().await;
            self.collect(frame);
        }
    }

    /// Data bytes that arrive within `window` without blocking for more.
    pub async fn drain_for(&mut self, window: Duration) -> usize {
        let mut received = 0;
        while let Ok(Some(frame)) = timeout(window, self.output.recv()).await {
            if frame.kind == FrameKind::Data {
                received += frame.payload.len();
            }
            self.collect(frame);
        }
        received
    }
}

pub fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle.as_bytes())
}
