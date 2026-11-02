//! Service I/O context.
//!
//! A service is an NDJSON (or byte) protocol implementation such as
//! `zmodem-serve`. The same implementation runs either
//!
//! * standalone over the process stdio (`simpleshell-core zmodem-serve`), or
//! * as a stream inside the resident core, where its output becomes `Data`
//!   frames and its input arrives from `Data` frames.
//!
//! Services read from the [`Input`] they are given and write through
//! [`emit_line`] / [`emit_json`], which resolve the current stream from a
//! task-local context. Background work must use [`spawn`] so it inherits the
//! context and is aborted together with the stream.

use crate::frame::Frame;
use bytes::{BufMut, Bytes, BytesMut};
use serde::Serialize;
use std::future::Future;
use std::io::Write;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use tokio::io::{AsyncBufRead, AsyncRead, BufReader, ReadBuf};
use tokio::sync::mpsc;
use tokio::task::{AbortHandle, JoinHandle};

pub type Input = Box<dyn AsyncBufRead + Send + Unpin>;

static STDOUT_RESERVED: AtomicBool = AtomicBool::new(false);

/// Called by the frame server: from now on stdout carries frames only, and
/// output emitted outside any stream context is diverted to stderr.
pub fn reserve_stdout() {
    STDOUT_RESERVED.store(true, Ordering::SeqCst);
}

#[derive(Clone)]
enum Sink {
    Stdout,
    Frames {
        stream: u32,
        tx: mpsc::UnboundedSender<Frame>,
    },
}

/// Where a service's protocol output goes.
#[derive(Clone)]
pub struct Output {
    sink: Sink,
}

impl Output {
    pub fn stdout() -> Self {
        Self { sink: Sink::Stdout }
    }

    pub fn frames(stream: u32, tx: mpsc::UnboundedSender<Frame>) -> Self {
        Self {
            sink: Sink::Frames { stream, tx },
        }
    }

    /// Writes raw bytes as one unit (no newline is added).
    pub fn write_bytes(&self, bytes: Bytes) -> Result<(), String> {
        match &self.sink {
            Sink::Stdout if STDOUT_RESERVED.load(Ordering::Relaxed) => {
                eprintln!(
                    "core: dropped output outside a stream context: {}",
                    String::from_utf8_lossy(&bytes).trim_end()
                );
                Ok(())
            }
            Sink::Stdout => {
                let mut stdout = std::io::stdout().lock();
                stdout
                    .write_all(&bytes)
                    .and_then(|_| stdout.flush())
                    .map_err(|error| format!("failed to write stdout: {error}"))
            }
            Sink::Frames { stream, tx } => tx
                .send(Frame::data(*stream, bytes))
                .map_err(|_| "core output channel closed".to_string()),
        }
    }

    /// Writes one protocol line; the trailing newline is appended here.
    pub fn write_line(&self, line: &[u8]) -> Result<(), String> {
        let mut buffer = BytesMut::with_capacity(line.len() + 1);
        buffer.put_slice(line);
        buffer.put_u8(b'\n');
        self.write_bytes(buffer.freeze())
    }

    pub fn write_json<T: Serialize + ?Sized>(&self, value: &T) -> Result<(), String> {
        let mut line = serde_json::to_vec(value)
            .map_err(|error| format!("failed to serialize output: {error}"))?;
        line.push(b'\n');
        self.write_bytes(Bytes::from(line))
    }
}

#[derive(Default)]
struct SpawnedTasks(Mutex<Vec<AbortHandle>>);

impl SpawnedTasks {
    fn push(&self, handle: AbortHandle) {
        let mut handles = self.0.lock().unwrap_or_else(|poison| poison.into_inner());
        handles.retain(|handle| !handle.is_finished());
        handles.push(handle);
    }

    fn abort_all(&self) {
        let handles =
            std::mem::take(&mut *self.0.lock().unwrap_or_else(|poison| poison.into_inner()));
        for handle in handles {
            handle.abort();
        }
    }
}

/// Per-stream context: output sink plus the tasks the stream spawned.
#[derive(Clone)]
pub struct ServiceContext {
    output: Output,
    tasks: Arc<SpawnedTasks>,
}

tokio::task_local! {
    static CONTEXT: ServiceContext;
}

impl ServiceContext {
    pub fn new(output: Output) -> Self {
        Self {
            output,
            tasks: Arc::new(SpawnedTasks::default()),
        }
    }

    /// Runs `future` with this context installed.
    pub async fn run<F: Future>(self, future: F) -> F::Output {
        CONTEXT.scope(self, future).await
    }

    /// Aborts every task spawned through [`spawn`] while this context was active.
    pub fn abort_spawned(&self) {
        self.tasks.abort_all();
    }
}

/// The current stream's output, or process stdout outside any stream.
pub fn output() -> Output {
    CONTEXT
        .try_with(|context| context.output.clone())
        .unwrap_or_else(|_| Output::stdout())
}

pub fn emit_line(line: impl AsRef<[u8]>) -> Result<(), String> {
    output().write_line(line.as_ref())
}

pub fn emit_json<T: Serialize + ?Sized>(value: &T) -> Result<(), String> {
    output().write_json(value)
}

/// `tokio::spawn` that keeps the current stream context and registers the task
/// so killing the stream also stops it.
pub fn spawn<F>(future: F) -> JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    match CONTEXT.try_with(Clone::clone) {
        Ok(context) => {
            let tasks = Arc::clone(&context.tasks);
            let handle = tokio::spawn(CONTEXT.scope(context, future));
            tasks.push(handle.abort_handle());
            handle
        }
        Err(_) => tokio::spawn(future),
    }
}

pub fn stdin_input() -> Input {
    Box::new(BufReader::new(tokio::io::stdin()))
}

/// Async reader over the byte chunks a stream receives; EOF once the sender drops.
pub struct ChannelReader {
    rx: mpsc::UnboundedReceiver<Bytes>,
    current: Bytes,
}

impl ChannelReader {
    pub fn new(rx: mpsc::UnboundedReceiver<Bytes>) -> Self {
        Self {
            rx,
            current: Bytes::new(),
        }
    }
}

impl AsyncRead for ChannelReader {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        while self.current.is_empty() {
            match self.rx.poll_recv(cx) {
                Poll::Ready(Some(chunk)) => self.current = chunk,
                Poll::Ready(None) => return Poll::Ready(Ok(())),
                Poll::Pending => return Poll::Pending,
            }
        }
        let count = self.current.len().min(buf.remaining());
        let chunk = self.current.split_to(count);
        buf.put_slice(&chunk);
        Poll::Ready(Ok(()))
    }
}

pub fn channel_input(rx: mpsc::UnboundedReceiver<Bytes>) -> Input {
    Box::new(BufReader::new(ChannelReader::new(rx)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::FrameKind;
    use tokio::io::AsyncBufReadExt;

    #[tokio::test]
    async fn emits_into_the_current_stream_and_spawned_tasks() {
        let (tx, mut rx) = mpsc::unbounded_channel();
        let context = ServiceContext::new(Output::frames(5, tx));
        context
            .clone()
            .run(async {
                emit_line("first").unwrap();
                spawn(async { emit_json(&serde_json::json!({"n": 2})).unwrap() })
                    .await
                    .unwrap();
            })
            .await;
        let first = rx.recv().await.unwrap();
        assert_eq!((first.kind, first.stream), (FrameKind::Data, 5));
        assert_eq!(&first.payload[..], b"first\n");
        assert_eq!(&rx.recv().await.unwrap().payload[..], b"{\"n\":2}\n");
    }

    #[tokio::test]
    async fn abort_spawned_stops_background_tasks() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let context = ServiceContext::new(Output::frames(1, tx));
        // The sender lives inside the background task; aborting drops it.
        let (alive, stopped) = tokio::sync::oneshot::channel::<()>();
        context
            .clone()
            .run(async move {
                spawn(async move {
                    let _alive = alive;
                    std::future::pending::<()>().await;
                });
            })
            .await;
        context.abort_spawned();
        assert!(stopped.await.is_err());
    }

    #[tokio::test]
    async fn channel_input_reads_lines_across_chunks_until_eof() {
        let (tx, rx) = mpsc::unbounded_channel();
        let mut lines = channel_input(rx).lines();
        tx.send(Bytes::from_static(b"al")).unwrap();
        tx.send(Bytes::from_static(b"pha\nbeta")).unwrap();
        tx.send(Bytes::from_static(b"\n")).unwrap();
        drop(tx);
        assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("alpha"));
        assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("beta"));
        assert_eq!(lines.next_line().await.unwrap(), None);
    }
}
