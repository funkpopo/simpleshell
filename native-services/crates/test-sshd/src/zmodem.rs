//! Server side of a ZMODEM transfer for the `sz` / `rz` shell commands.

use sha2::{Digest, Sha256};
use zmodem2::{Action, Event, FileInfo, Position, Receiver, Sender};

/// The bytes `sz <size>` sends: every byte value, ZMODEM escapes included.
pub fn sz_payload(size: usize) -> Vec<u8> {
    (0..size).map(|index| (index * 31 + 7) as u8).collect()
}

/// Flushes protocol bytes still queued when the session completed.
macro_rules! drain {
    ($machine:expr, $wire:expr) => {
        loop {
            let count = match $machine.poll() {
                Action::WriteWire(bytes) => {
                    $wire.extend_from_slice(bytes);
                    bytes.len()
                }
                _ => break,
            };
            $machine.wire_written(count);
        }
    };
}

pub(crate) enum Peer {
    Send {
        sender: Sender,
        data: Vec<u8>,
    },
    Receive {
        receiver: Receiver,
        name: String,
        received: Vec<u8>,
    },
}

impl Peer {
    pub fn sz(size: usize) -> Self {
        let mut sender = Sender::new().expect("sender");
        sender.set_streaming_window(usize::MAX);
        let name = format!("sz-{size}.bin");
        sender
            .start_file(FileInfo::new(
                name.as_bytes(),
                Some(Position::new(size as u32)),
            ))
            .expect("start file");
        Self::Send {
            sender,
            data: sz_payload(size),
        }
    }

    pub fn rz() -> Self {
        Self::Receive {
            receiver: Receiver::with_flow_control(0, true).expect("receiver"),
            name: String::new(),
            received: Vec::new(),
        }
    }

    /// Feeds client bytes; returns wire output and, once the session ended,
    /// the line the shell prints.
    pub fn feed(&mut self, mut input: &[u8]) -> (Vec<u8>, Option<String>) {
        let mut wire = Vec::new();
        loop {
            if let Some(done) = self.drive(&mut wire) {
                return (wire, Some(done));
            }
            if input.is_empty() {
                return (wire, None);
            }
            let consumed = match self {
                Self::Send { sender, .. } => sender.submit_wire(input),
                Self::Receive { receiver, .. } => receiver.submit_wire(input),
            };
            match consumed {
                Ok(0) => return (wire, None),
                Ok(count) => input = &input[count..],
                Err(error) => return (wire, Some(format!("zmodem failed: {error:?}"))),
            }
        }
    }

    fn drive(&mut self, wire: &mut Vec<u8>) -> Option<String> {
        loop {
            match self {
                Self::Send { sender, data } => match sender.poll() {
                    Action::WriteWire(bytes) => {
                        let count = bytes.len();
                        wire.extend_from_slice(bytes);
                        sender.wire_written(count);
                    }
                    Action::ReadFile { offset, max_len } => {
                        let start = offset.get() as usize;
                        let end = (start + max_len).min(data.len());
                        sender.submit_file(&data[start..end]).expect("file data");
                    }
                    Action::Event(Event::FileCompleted) => sender.finish().expect("finish"),
                    Action::Event(Event::SessionCompleted) => {
                        drain!(sender, wire);
                        return Some("sz done".into());
                    }
                    Action::Event(Event::Aborted) => return Some("sz aborted".into()),
                    Action::Idle => return None,
                    _ => {}
                },
                Self::Receive {
                    receiver,
                    name,
                    received,
                } => match receiver.poll() {
                    Action::WriteWire(bytes) => {
                        let count = bytes.len();
                        wire.extend_from_slice(bytes);
                        receiver.wire_written(count);
                    }
                    Action::WriteFile(bytes) => {
                        let count = bytes.len();
                        received.extend_from_slice(bytes);
                        receiver.file_written(count).expect("file written");
                    }
                    Action::Event(Event::FileStarted(info)) => {
                        *name = String::from_utf8_lossy(info.name).into_owned();
                    }
                    Action::Event(Event::SessionCompleted) => {
                        drain!(receiver, wire);
                        let digest = Sha256::digest(&received[..]);
                        let hex: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
                        return Some(format!("rz {name} {} {hex}", received.len()));
                    }
                    Action::Event(Event::Aborted) => return Some("rz aborted".into()),
                    Action::Idle => return None,
                    _ => {}
                },
            }
        }
    }
}
