//! Wire framing between the JS supervisor and `simpleshell-core`.
//!
//! ```text
//! +-----------+---------+-------------+------------------+
//! | len: u32  | kind: u8| stream: u32 | payload          |
//! +-----------+---------+-------------+------------------+
//!   len = 5 + payload.len(), little endian
//! ```
//!
//! * `Control` frames carry one UTF-8 JSON object (see [`crate::control`]); they
//!   always use stream 0.
//! * `Data` frames carry opaque bytes for one stream (>= 1). The supervisor
//!   forwards them without parsing.

use bytes::{Buf, BufMut, Bytes, BytesMut};
use std::fmt;
use tokio_util::codec::{Decoder, Encoder};

/// Bytes after the length prefix that every frame carries (kind + stream).
pub const FRAME_META_BYTES: usize = 5;
/// Length prefix + meta.
pub const FRAME_HEADER_BYTES: usize = 4 + FRAME_META_BYTES;
/// Upper bound for a single frame payload. Larger writes must be chunked.
pub const MAX_FRAME_PAYLOAD: usize = 16 * 1024 * 1024;
/// Stream id reserved for control frames.
pub const CONTROL_STREAM: u32 = 0;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FrameKind {
    Control = 1,
    Data = 2,
}

impl FrameKind {
    fn from_u8(value: u8) -> Option<Self> {
        match value {
            1 => Some(Self::Control),
            2 => Some(Self::Data),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    pub kind: FrameKind,
    pub stream: u32,
    pub payload: Bytes,
}

impl Frame {
    pub fn data(stream: u32, payload: impl Into<Bytes>) -> Self {
        Self {
            kind: FrameKind::Data,
            stream,
            payload: payload.into(),
        }
    }

    pub fn control_json(payload: impl Into<Bytes>) -> Self {
        Self {
            kind: FrameKind::Control,
            stream: CONTROL_STREAM,
            payload: payload.into(),
        }
    }

    pub fn encoded_len(&self) -> usize {
        FRAME_HEADER_BYTES + self.payload.len()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum FrameError {
    UnknownKind(u8),
    TooLarge(usize),
    Truncated,
    Io(String),
}

impl fmt::Display for FrameError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnknownKind(kind) => write!(f, "unknown frame kind {kind}"),
            Self::TooLarge(size) => write!(f, "frame payload {size} exceeds {MAX_FRAME_PAYLOAD}"),
            Self::Truncated => write!(f, "frame length shorter than header"),
            Self::Io(error) => write!(f, "frame io error: {error}"),
        }
    }
}

impl std::error::Error for FrameError {}

impl From<std::io::Error> for FrameError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error.to_string())
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct FrameCodec;

impl Decoder for FrameCodec {
    type Item = Frame;
    type Error = FrameError;

    fn decode(&mut self, src: &mut BytesMut) -> Result<Option<Frame>, FrameError> {
        if src.len() < 4 {
            return Ok(None);
        }
        let len = u32::from_le_bytes([src[0], src[1], src[2], src[3]]) as usize;
        if len < FRAME_META_BYTES {
            return Err(FrameError::Truncated);
        }
        let payload_len = len - FRAME_META_BYTES;
        if payload_len > MAX_FRAME_PAYLOAD {
            return Err(FrameError::TooLarge(payload_len));
        }
        if src.len() < 4 + len {
            src.reserve(4 + len - src.len());
            return Ok(None);
        }
        src.advance(4);
        let kind_byte = src.get_u8();
        let kind = FrameKind::from_u8(kind_byte).ok_or(FrameError::UnknownKind(kind_byte))?;
        let stream = src.get_u32_le();
        let payload = src.split_to(payload_len).freeze();
        Ok(Some(Frame {
            kind,
            stream,
            payload,
        }))
    }
}

impl Encoder<Frame> for FrameCodec {
    type Error = FrameError;

    fn encode(&mut self, frame: Frame, dst: &mut BytesMut) -> Result<(), FrameError> {
        if frame.payload.len() > MAX_FRAME_PAYLOAD {
            return Err(FrameError::TooLarge(frame.payload.len()));
        }
        dst.reserve(frame.encoded_len());
        dst.put_u32_le((FRAME_META_BYTES + frame.payload.len()) as u32);
        dst.put_u8(frame.kind as u8);
        dst.put_u32_le(frame.stream);
        dst.extend_from_slice(&frame.payload);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode(frame: Frame) -> BytesMut {
        let mut buffer = BytesMut::new();
        FrameCodec.encode(frame, &mut buffer).unwrap();
        buffer
    }

    #[test]
    fn round_trips_control_and_data_frames() {
        let mut buffer = encode(Frame::control_json(&b"{\"op\":\"ready\"}"[..]));
        buffer.extend_from_slice(&encode(Frame::data(7, vec![0, 255, 10, 13])));
        let mut codec = FrameCodec;
        let control = codec.decode(&mut buffer).unwrap().unwrap();
        assert_eq!(control.kind, FrameKind::Control);
        assert_eq!(control.stream, CONTROL_STREAM);
        assert_eq!(&control.payload[..], b"{\"op\":\"ready\"}");
        let data = codec.decode(&mut buffer).unwrap().unwrap();
        assert_eq!(data, Frame::data(7, vec![0, 255, 10, 13]));
        assert!(codec.decode(&mut buffer).unwrap().is_none());
    }

    #[test]
    fn waits_for_partial_frames_byte_by_byte() {
        let encoded = encode(Frame::data(3, b"hello".to_vec()));
        let mut codec = FrameCodec;
        let mut buffer = BytesMut::new();
        for (index, byte) in encoded.iter().enumerate() {
            buffer.put_u8(*byte);
            let decoded = codec.decode(&mut buffer).unwrap();
            if index + 1 < encoded.len() {
                assert!(decoded.is_none());
            } else {
                assert_eq!(decoded.unwrap().payload, Bytes::from_static(b"hello"));
            }
        }
    }

    #[test]
    fn empty_payload_is_valid() {
        let mut buffer = encode(Frame::data(1, Vec::new()));
        assert_eq!(buffer.len(), FRAME_HEADER_BYTES);
        let frame = FrameCodec.decode(&mut buffer).unwrap().unwrap();
        assert!(frame.payload.is_empty());
    }

    #[test]
    fn rejects_malformed_headers() {
        let mut short = BytesMut::from(&[2u8, 0, 0, 0, 2, 0][..]);
        assert_eq!(FrameCodec.decode(&mut short), Err(FrameError::Truncated));

        let mut unknown = BytesMut::new();
        unknown.put_u32_le(5);
        unknown.put_u8(9);
        unknown.put_u32_le(1);
        assert_eq!(
            FrameCodec.decode(&mut unknown),
            Err(FrameError::UnknownKind(9))
        );

        let mut huge = BytesMut::new();
        huge.put_u32_le((MAX_FRAME_PAYLOAD + FRAME_META_BYTES + 1) as u32);
        assert!(matches!(
            FrameCodec.decode(&mut huge),
            Err(FrameError::TooLarge(_))
        ));
    }
}
