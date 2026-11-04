//! Fuzz harnesses for the parsers that consume untrusted bytes.
//!
//! A panic in one stream only ends that stream, but these parsers run inside
//! the resident `simpleshell-core`, so they must never panic, loop forever or
//! grow without bound on hostile input from a remote host.
//!
//! Every harness takes one fuzz input: the first 8 bytes (little endian,
//! zero padded) seed how the rest is cut into chunks, so the streaming
//! parsers also see arbitrary chunk boundaries. The same functions back the
//! cargo-fuzz targets (`native-services/fuzz/`) and the stable
//! `tests/robustness.rs`. Besides "no panic" they check cheap invariants:
//!
//! - `term_pipe`: without highlighting the pipeline reproduces
//!   `String::from_utf8_lossy` of the whole input at any chunking (stdout and
//!   stderr); editor-mode changes alternate; highlighting does not panic.
//! - `telnet`: chunking does not change data or replies; replies are whole
//!   IAC commands; input without IAC passes unchanged; `escape` round-trips.
//! - `zmodem`: until a session starts, passthrough is exactly the input
//!   before the first `**\x18B0[01]` intro (all of it if there is none).
//! - `frame_codec`: chunking does not change decoded frames or the error;
//!   decoded frames re-encode to the consumed bytes; encode → decode
//!   round-trips; parsed control messages round-trip.

use bytes::BytesMut;
use core_protocol::frame::{Frame, FrameCodec, FrameError, FrameKind};
use core_protocol::ControlEnvelope;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use telnet::protocol::{escape, Received, Telnet, IAC};
use term_pipe::{Highlighter, RuleConfig, TermPipe};
use tokio_util::codec::{Decoder, Encoder};
use zmodem::{Detector, GrantedFile, Out};

/// SplitMix64: small, seedable, good enough to pick chunk sizes.
#[derive(Clone)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform in `0..bound` (`bound` > 0).
    pub fn below(&mut self, bound: usize) -> usize {
        (self.next_u64() % bound as u64) as usize
    }
}

/// `(seed, body)`: the first 8 bytes seed the chunking.
pub fn split_input(data: &[u8]) -> (u64, &[u8]) {
    let head = data.len().min(8);
    let mut seed = [0u8; 8];
    seed[..head].copy_from_slice(&data[..head]);
    (u64::from_le_bytes(seed), &data[head..])
}

/// A fuzz input from a seed and a body (the inverse of [`split_input`]).
pub fn make_input(seed: u64, body: &[u8]) -> Vec<u8> {
    let mut data = seed.to_le_bytes().to_vec();
    data.extend_from_slice(body);
    data
}

/// Cuts `body` into chunks (some empty) with sizes drawn from `seed`.
pub fn chunks(body: &[u8], seed: u64) -> Vec<&[u8]> {
    const MAX_CHUNK: [usize; 8] = [1, 2, 3, 5, 8, 64, 1024, usize::MAX];
    let mut rng = Rng::new(seed);
    let max = MAX_CHUNK[rng.below(MAX_CHUNK.len())];
    let mut parts = Vec::new();
    let mut at = 0;
    while at < body.len() {
        let size = if max == usize::MAX {
            body.len() - at
        } else {
            rng.below(max + 1).min(body.len() - at)
        };
        parts.push(&body[at..at + size]);
        at += size;
    }
    parts
}

// ---------------------------------------------------------------- term-pipe

/// The app's default highlight rules (`src/shared/domain/highlight-configs.js`).
pub const DEFAULT_RULES_JSON: &str = include_str!("default-rules.json");

fn default_highlighter() -> Arc<Highlighter> {
    static HIGHLIGHTER: OnceLock<Arc<Highlighter>> = OnceLock::new();
    Arc::clone(HIGHLIGHTER.get_or_init(|| {
        let rules: Vec<RuleConfig> =
            serde_json::from_str(DEFAULT_RULES_JSON).expect("default rules parse");
        Arc::new(Highlighter::new(&rules))
    }))
}

/// Editor-mode changes must alternate (a change is reported only on change).
struct EditorTrack(bool);

impl EditorTrack {
    fn observe(&mut self, change: Option<bool>) {
        if let Some(active) = change {
            assert_ne!(active, self.0, "editor mode reported without a change");
            self.0 = active;
        }
    }
}

fn strip_red(text: &str) -> &str {
    text.strip_prefix("\x1b[31m")
        .and_then(|inner| inner.strip_suffix("\x1b[0m"))
        .unwrap_or_else(|| panic!("stderr not wrapped in red: {text:?}"))
}

pub fn term_pipe(data: &[u8]) {
    let (seed, body) = split_input(data);
    let parts = chunks(body, seed);
    let expected = String::from_utf8_lossy(body);

    // Plain pipeline: UTF-8 decoding and the OSC filter must be lossless.
    let mut pipe = TermPipe::new(None);
    let mut editor = EditorTrack(false);
    let mut text = String::new();
    for part in &parts {
        let processed = pipe.stdout(part);
        editor.observe(processed.editor_mode);
        text.push_str(&processed.text);
    }
    let processed = pipe.finish();
    editor.observe(processed.editor_mode);
    text.push_str(&processed.text);
    assert_eq!(text, expected, "stdout pipeline changed the text");

    let mut pipe = TermPipe::new(None);
    let mut text = String::new();
    for part in &parts {
        let red = pipe.stderr(part);
        if !red.is_empty() {
            text.push_str(strip_red(&red));
        }
    }
    let finished = pipe.finish();
    if !finished.text.is_empty() {
        text.push_str(strip_red(&finished.text));
    }
    assert_eq!(text, expected, "stderr pipeline changed the text");

    // Highlighting pipeline: must not panic; same chunking.
    let mut pipe = TermPipe::new(Some(default_highlighter()));
    let mut editor = EditorTrack(false);
    for part in &parts {
        editor.observe(pipe.stdout(part).editor_mode);
        let _ = pipe.stderr(part);
    }
    editor.observe(pipe.finish().editor_mode);
    let _ = default_highlighter().apply(&expected);
}

// ------------------------------------------------------------------- telnet

const WILL: u8 = 251;
const DONT: u8 = 254;
const SB: u8 = 250;
const SE: u8 = 240;

/// Replies must be whole commands: `IAC verb option` or `IAC SB … IAC SE`.
fn assert_whole_commands(reply: &[u8]) {
    let mut at = 0;
    while at < reply.len() {
        assert_eq!(reply[at], IAC, "reply byte {at} is not IAC: {reply:?}");
        match reply.get(at + 1) {
            Some(WILL..=DONT) => {
                assert!(at + 2 < reply.len(), "truncated negotiation: {reply:?}");
                at += 3;
            }
            Some(&SB) => {
                at += 2;
                loop {
                    match (reply.get(at), reply.get(at + 1)) {
                        (Some(&IAC), Some(&SE)) => break at += 2,
                        (Some(&IAC), Some(&IAC)) => at += 2,
                        (Some(&IAC), _) => panic!("bare IAC in subnegotiation: {reply:?}"),
                        (Some(_), _) => at += 1,
                        (None, _) => panic!("unterminated subnegotiation: {reply:?}"),
                    }
                }
            }
            other => panic!("unexpected command {other:?} in reply {reply:?}"),
        }
    }
}

pub fn telnet(data: &[u8]) {
    let (seed, body) = split_input(data);
    let parts = chunks(body, seed);
    let (cols, rows) = (seed as u16, (seed >> 16) as u16);

    let mut whole = Telnet::new("xterm-256color".into(), cols, rows);
    let expected = whole.receive(body);
    let mut split = Telnet::new("xterm-256color".into(), cols, rows);
    let mut received = Received::default();
    for part in &parts {
        let out = split.receive(part);
        received.data.extend(out.data);
        received.reply.extend(out.reply);
    }
    assert_eq!(received, expected, "chunking changed telnet output");
    assert_whole_commands(&expected.reply);
    if !body.contains(&IAC) {
        assert_eq!(expected.data, body);
        assert!(expected.reply.is_empty());
    }
    let resize = whole.resize(rows, cols);
    assert_eq!(split.resize(rows, cols), resize);
    assert_whole_commands(&resize);

    let mut fresh = Telnet::new("vt100".into(), 80, 24);
    let echoed = fresh.receive(&escape(body));
    assert_eq!(echoed.data, body, "escape did not round-trip");
    assert!(echoed.reply.is_empty());

    // Automatic login reads the same untrusted output.
    let mut login = telnet::AutoLogin::new(Some("user".into()), Some("secret".into()));
    let mut answers = Vec::new();
    for part in &parts {
        answers.extend(login.observe(part));
    }
    assert!(answers.len() <= 2, "answered more than two prompts");
    for answer in &answers {
        assert!(answer == "user\r\n" || answer == "secret\r\n");
    }
}

// ------------------------------------------------------------------- zmodem

/// `**\x18B0`: the start of a ZRQINIT (`0`) or ZRINIT (`1`) hex header.
pub const ZMODEM_INTRO: &[u8] = b"**\x18B0";

fn crc16_xmodem(bytes: &[u8]) -> u16 {
    let mut crc = 0u16;
    for &byte in bytes {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

/// A valid ZMODEM hex header (`**\x18B` + type + 4 flag bytes + CRC, CR LF XON).
pub fn zmodem_hex_header(frame_type: u8, flags: [u8; 4]) -> Vec<u8> {
    let mut raw = vec![frame_type];
    raw.extend_from_slice(&flags);
    raw.extend_from_slice(&crc16_xmodem(&raw).to_be_bytes());
    let mut out = b"**\x18B".to_vec();
    for byte in raw {
        out.extend_from_slice(format!("{byte:02x}").as_bytes());
    }
    out.extend_from_slice(b"\r\n\x11");
    out
}

fn push_zdle_escaped(out: &mut Vec<u8>, byte: u8) {
    if matches!(byte, 0x18 | 0x10 | 0x90 | 0x11 | 0x91 | 0x13 | 0x93) {
        out.extend_from_slice(&[0x18, byte ^ 0x40]);
    } else {
        out.push(byte);
    }
}

/// A valid ZMODEM binary header with CRC-16 (`*\x18A` + escaped type,
/// flags and CRC), the form senders use for ZFILE and ZDATA.
pub fn zmodem_bin_header(frame_type: u8, flags: [u8; 4]) -> Vec<u8> {
    let mut raw = vec![frame_type];
    raw.extend_from_slice(&flags);
    raw.extend_from_slice(&crc16_xmodem(&raw).to_be_bytes());
    let mut out = b"*\x18A".to_vec();
    for byte in raw {
        push_zdle_escaped(&mut out, byte);
    }
    out
}

/// A ZMODEM data subpacket with a CRC-16 (after a CRC-16 binary header): ZDLE
/// escaped `data`, `ZDLE terminator` (`h`/`i`/`j`/`k`) and the CRC.
pub fn zmodem_subpacket(data: &[u8], terminator: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 8);
    for &byte in data {
        push_zdle_escaped(&mut out, byte);
    }
    out.extend_from_slice(&[0x18, terminator]);
    let mut crc_input = data.to_vec();
    crc_input.push(terminator);
    for byte in crc16_xmodem(&crc_input).to_be_bytes() {
        push_zdle_escaped(&mut out, byte);
    }
    out
}

/// Index of the first intro that starts a session, like `zmodem::find_intro`.
fn first_session_intro(bytes: &[u8]) -> Option<usize> {
    bytes.windows(ZMODEM_INTRO.len() + 1).position(|window| {
        window.starts_with(ZMODEM_INTRO) && matches!(window[ZMODEM_INTRO.len()], b'0' | b'1')
    })
}

fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("tokio runtime")
    })
}

fn temp_path(kind: &str) -> std::path::PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    std::env::temp_dir().join(format!(
        "simpleshell-fuzz-{kind}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ))
}

fn event_field<'a>(out: &'a Out, kind: &str, field: &str) -> Option<&'a serde_json::Value> {
    match out {
        Out::Event(name, value) if *name == kind => value.get(field),
        _ => None,
    }
}

/// Seed bits: 0-1 prefix (none / ZRQINIT / ZRINIT / none), 2 accept offered
/// downloads, 3 pick a file for uploads, 4 cancel midway, rest chunking.
pub fn zmodem(data: &[u8]) {
    let (seed, body) = split_input(data);
    let mut stream = match seed & 3 {
        1 => zmodem_hex_header(0, [0; 4]),
        2 => zmodem_hex_header(1, [0, 4, 0, 0x23]),
        _ => Vec::new(),
    };
    stream.extend_from_slice(body);
    let (accept, upload, cancel) = (seed & 4 != 0, seed & 8 != 0, seed & 16 != 0);
    let parts = chunks(&stream, seed >> 5);
    let cancel_at = (cancel && !parts.is_empty()).then(|| (seed >> 8) as usize % parts.len());

    let mut files = Vec::new();
    let outs = runtime().block_on(async {
        let mut detector = Detector::new();
        let mut outs = Vec::new();
        for (index, part) in parts.iter().enumerate() {
            let mut produced = detector.feed(part).await;
            let mut next = 0;
            while next < produced.len() {
                let out = produced[next].clone();
                next += 1;
                let reaction = if upload
                    && event_field(&out, "intro", "direction")
                        .is_some_and(|direction| direction.as_str() == Some("upload"))
                {
                    let path = temp_path("upload");
                    std::fs::write(&path, vec![b'z'; 3000]).expect("write upload file");
                    let file: GrantedFile = serde_json::from_value(serde_json::json!({
                        "path": path.to_string_lossy(),
                        "name": "fuzz.bin",
                        "size": 3000,
                    }))
                    .unwrap();
                    files.push(path);
                    detector.send_files(vec![file]).await
                } else if accept
                    && event_field(&out, "offer", "awaitingAccept")
                        .is_some_and(|awaiting| awaiting.as_bool() == Some(true))
                {
                    let path = temp_path("download");
                    files.push(path.clone());
                    detector.accept_file(&path.to_string_lossy()).await
                } else {
                    Vec::new()
                };
                outs.push(out);
                produced.extend(reaction);
            }
            if cancel_at == Some(index) {
                outs.extend(detector.cancel().await);
            }
            let _ = detector.in_transfer();
            let _ = detector.unprocessed_bytes();
        }
        outs.extend(detector.finish());
        assert!(!detector.in_transfer());
        outs
    });
    for file in files {
        let _ = std::fs::remove_file(file);
    }

    // Byte ownership before the first session.
    let mut passthrough = Vec::new();
    let mut session_started = false;
    for out in &outs {
        match out {
            Out::Passthrough(bytes) => passthrough.extend_from_slice(bytes),
            _ => {
                session_started = true;
                break;
            }
        }
    }
    match first_session_intro(&stream) {
        None => {
            assert!(!session_started, "session without an intro: {outs:?}");
            assert_eq!(passthrough, stream, "detection lost or reordered bytes");
        }
        Some(at) => {
            assert!(session_started, "intro at {at} did not start a session");
            assert_eq!(passthrough, &stream[..at], "bytes before the intro changed");
        }
    }
}

// -------------------------------------------------------------- core-protocol

fn decode_all(parts: &[&[u8]]) -> (Vec<Frame>, Option<FrameError>) {
    let mut codec = FrameCodec;
    let mut buffer = BytesMut::new();
    let mut frames = Vec::new();
    for part in parts {
        buffer.extend_from_slice(part);
        loop {
            match codec.decode(&mut buffer) {
                Ok(Some(frame)) => frames.push(frame),
                Ok(None) => break,
                Err(error) => return (frames, Some(error)),
            }
        }
    }
    // A partial frame at the end is an error, never a panic.
    let _ = codec.decode_eof(&mut buffer);
    (frames, None)
}

fn encode(frames: &[Frame]) -> BytesMut {
    let mut buffer = BytesMut::new();
    for frame in frames {
        FrameCodec
            .encode(frame.clone(), &mut buffer)
            .expect("decoded frames re-encode");
    }
    buffer
}

/// Parsing never panics; what parses serializes and parses back unchanged.
pub fn control(payload: &[u8]) {
    if let Ok(envelope) = ControlEnvelope::parse(payload) {
        let again = ControlEnvelope::parse(&envelope.to_bytes()).expect("round trip parses");
        assert_eq!(again, envelope, "control message did not round-trip");
    }
}

pub fn frame_codec(data: &[u8]) {
    let (seed, body) = split_input(data);
    let parts = chunks(body, seed);

    // Arbitrary bytes as a frame stream.
    let whole = decode_all(&[body]);
    let split = decode_all(&parts);
    assert_eq!(split, whole, "chunking changed decoding");
    let encoded = encode(&whole.0);
    assert_eq!(&encoded[..], &body[..encoded.len()], "re-encoding differs");
    for frame in &whole.0 {
        if frame.kind == FrameKind::Control {
            control(&frame.payload);
        }
    }

    // Frames built from the input survive encode → chunked decode.
    let mut rng = Rng::new(seed ^ 0x5EED);
    let mut frames = Vec::new();
    let mut rest = body;
    while let Some((&head, tail)) = rest.split_first() {
        let len = (head as usize >> 2).min(tail.len());
        let kind = [
            FrameKind::Control,
            FrameKind::Data,
            FrameKind::Event,
            FrameKind::Stderr,
        ][head as usize & 3];
        frames.push(Frame {
            kind,
            stream: rng.next_u64() as u32,
            payload: bytes::Bytes::copy_from_slice(&tail[..len]),
        });
        rest = &tail[len..];
    }
    let encoded = encode(&frames);
    let decoded = decode_all(&chunks(&encoded, seed.rotate_left(17)));
    assert_eq!(decoded, (frames, None), "encode/decode did not round-trip");

    control(body);
}
