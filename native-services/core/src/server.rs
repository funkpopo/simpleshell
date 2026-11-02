//! Resident core: multiplexes service streams over one stdio frame pipe.
//!
//! Each `open` starts a service as an isolated tokio task with its own input
//! channel and output context. A failing stream (error, panic or kill) reports
//! an `exit` for that stream only; the process keeps serving the others. The
//! core exits when the supervisor closes stdin or sends `shutdown`.

use crate::panic::payload_message;
use crate::services;
use bytes::Bytes;
use core_protocol::service::{self, channel_input, Output, ServiceContext};
use core_protocol::{Control, ControlEnvelope, Frame, FrameCodec, FrameKind, StreamIo};
use futures_util::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::task::AbortHandle;
use tokio_util::codec::{FramedRead, FramedWrite};

struct StreamHandle {
    input: Option<mpsc::UnboundedSender<Bytes>>,
    events: mpsc::UnboundedSender<serde_json::Value>,
    abort: AbortHandle,
}

fn control(tx: &mpsc::UnboundedSender<Frame>, message: Control) {
    let _ = tx.send(Frame::control_json(
        ControlEnvelope::new(message).to_bytes(),
    ));
}

fn exit_status(
    result: Result<Result<(), String>, tokio::task::JoinError>,
) -> (Option<i32>, Option<String>, Option<String>) {
    match result {
        Ok(Ok(())) => (Some(0), None, None),
        Ok(Err(error)) => (Some(1), None, (!error.is_empty()).then_some(error)),
        Err(join) if join.is_cancelled() => (None, Some("SIGTERM".to_string()), None),
        Err(join) => {
            let message = payload_message(&*join.into_panic());
            (
                Some(101),
                None,
                Some(format!("service panicked: {message}")),
            )
        }
    }
}

fn open_stream(
    stream: u32,
    service: String,
    args: Vec<String>,
    out: &mpsc::UnboundedSender<Frame>,
    done: &mpsc::UnboundedSender<u32>,
) -> StreamHandle {
    let (input_tx, input_rx) = mpsc::unbounded_channel();
    let (events_tx, events_rx) = mpsc::unbounded_channel();
    let context = ServiceContext::new(Output::frames(stream, out.clone()));
    let io = StreamIo {
        input: channel_input(input_rx),
        events: events_rx,
    };
    let task = tokio::spawn(
        context
            .clone()
            .run(async move { services::run(&service, args, io).await }),
    );
    let abort = task.abort_handle();
    let out = out.clone();
    let done = done.clone();
    tokio::spawn(async move {
        let result = task.await;
        // Background work belongs to the stream; nothing may outlive its exit.
        context.abort_spawned();
        let (code, signal, error) = exit_status(result);
        control(
            &out,
            Control::Exit {
                stream,
                code,
                signal,
                error,
            },
        );
        let _ = done.send(stream);
    });
    StreamHandle {
        input: Some(input_tx),
        events: events_tx,
        abort,
    }
}

pub async fn serve(role: String) -> Result<(), String> {
    service::reserve_stdout();
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Frame>();
    let writer = tokio::spawn(async move {
        let mut sink = FramedWrite::new(tokio::io::stdout(), FrameCodec);
        while let Some(frame) = out_rx.recv().await {
            sink.feed(frame).await.map_err(|error| error.to_string())?;
            // Coalesce whatever is already queued into one flush.
            while let Ok(frame) = out_rx.try_recv() {
                sink.feed(frame).await.map_err(|error| error.to_string())?;
            }
            sink.flush().await.map_err(|error| error.to_string())?;
        }
        Ok::<(), String>(())
    });

    control(
        &out_tx,
        Control::Ready {
            version: env!("CARGO_PKG_VERSION").to_string(),
            pid: std::process::id(),
            role,
            services: services::SERVICES
                .iter()
                .map(|name| name.to_string())
                .collect(),
        },
    );

    let mut reader = FramedRead::new(tokio::io::stdin(), FrameCodec);
    let mut streams: HashMap<u32, StreamHandle> = HashMap::new();
    let (done_tx, mut done_rx) = mpsc::unbounded_channel::<u32>();

    let result = loop {
        let frame = tokio::select! {
            frame = reader.next() => frame,
            Some(stream) = done_rx.recv() => {
                streams.remove(&stream);
                continue;
            }
        };
        let frame = match frame {
            None => break Ok(()),
            Some(Err(error)) => break Err(format!("core input failed: {error}")),
            Some(Ok(frame)) => frame,
        };

        match frame.kind {
            FrameKind::Data => {
                if let Some(input) = streams.get(&frame.stream).and_then(|s| s.input.as_ref()) {
                    let _ = input.send(frame.payload);
                }
                continue;
            }
            FrameKind::Event => {
                match serde_json::from_slice(&frame.payload) {
                    Ok(event) => {
                        if let Some(handle) = streams.get(&frame.stream) {
                            let _ = handle.events.send(event);
                        }
                    }
                    Err(error) => control(
                        &out_tx,
                        Control::Error {
                            stream: Some(frame.stream),
                            message: format!("invalid stream event: {error}"),
                        },
                    ),
                }
                continue;
            }
            FrameKind::Stderr => {
                control(
                    &out_tx,
                    Control::Error {
                        stream: Some(frame.stream),
                        message: "stderr frames only flow from the core".into(),
                    },
                );
                continue;
            }
            FrameKind::Control => {}
        }

        let message = match ControlEnvelope::parse(&frame.payload) {
            Ok(envelope) => envelope.message,
            Err(message) => {
                control(
                    &out_tx,
                    Control::Error {
                        stream: None,
                        message,
                    },
                );
                continue;
            }
        };
        match message {
            Control::Open {
                stream,
                service,
                args,
            } => {
                if stream == 0 || streams.contains_key(&stream) {
                    control(
                        &out_tx,
                        Control::Error {
                            stream: Some(stream),
                            message: format!("stream id {stream} is invalid or in use"),
                        },
                    );
                } else if !services::is_service(&service) {
                    control(
                        &out_tx,
                        Control::Exit {
                            stream,
                            code: Some(1),
                            signal: None,
                            error: Some(format!("unsupported service: {service}")),
                        },
                    );
                } else {
                    let handle = open_stream(stream, service, args, &out_tx, &done_tx);
                    streams.insert(stream, handle);
                }
            }
            Control::Eof { stream } => {
                if let Some(handle) = streams.get_mut(&stream) {
                    handle.input = None;
                }
            }
            Control::Kill { stream } => {
                if let Some(handle) = streams.get(&stream) {
                    handle.abort.abort();
                }
            }
            Control::Ping { id } => control(&out_tx, Control::Pong { id }),
            Control::Shutdown => break Ok(()),
            other => control(
                &out_tx,
                Control::Error {
                    stream: None,
                    message: format!("unexpected control message: {other:?}"),
                },
            ),
        }
    };

    for handle in streams.values() {
        handle.abort.abort();
    }
    drop(done_tx);
    // Give the exit frames a moment to reach a still-listening supervisor.
    let mut remaining = streams.len();
    let drain = async {
        while remaining > 0 && done_rx.recv().await.is_some() {
            remaining -= 1;
        }
    };
    let _ = tokio::time::timeout(Duration::from_millis(500), drain).await;
    drop(out_tx);
    let _ = tokio::time::timeout(Duration::from_secs(1), writer).await;
    result
}
