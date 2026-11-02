//! Streaming UTF-8 decoding: incomplete trailing sequences wait for the next
//! chunk, invalid bytes become U+FFFD (as Node's `StringDecoder`).

#[derive(Default)]
pub struct Utf8Decoder {
    pending: Vec<u8>,
}

/// Start of an incomplete multi-byte sequence at the end of `bytes`.
fn incomplete_tail(bytes: &[u8]) -> usize {
    let len = bytes.len();
    for back in 1..=len.min(3) {
        let byte = bytes[len - back];
        if byte & 0b1100_0000 == 0b1000_0000 {
            continue;
        }
        let needed = match byte {
            0xC2..=0xDF => 2,
            0xE0..=0xEF => 3,
            0xF0..=0xF4 => 4,
            _ => 1,
        };
        return if needed > back { len - back } else { len };
    }
    len
}

impl Utf8Decoder {
    pub fn decode(&mut self, bytes: &[u8]) -> String {
        if self.pending.is_empty() {
            let cut = incomplete_tail(bytes);
            self.pending.extend_from_slice(&bytes[cut..]);
            return String::from_utf8_lossy(&bytes[..cut]).into_owned();
        }
        let mut joined = std::mem::take(&mut self.pending);
        joined.extend_from_slice(bytes);
        let cut = incomplete_tail(&joined);
        self.pending.extend_from_slice(&joined[cut..]);
        joined.truncate(cut);
        String::from_utf8_lossy(&joined).into_owned()
    }

    /// Flushes what is left (an incomplete sequence becomes U+FFFD).
    pub fn finish(&mut self) -> String {
        let rest = std::mem::take(&mut self.pending);
        String::from_utf8_lossy(&rest).into_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_multibyte_characters_at_any_boundary() {
        let text = "中文😀 ok é";
        let bytes = text.as_bytes();
        for split in 0..=bytes.len() {
            let mut decoder = Utf8Decoder::default();
            let mut out = decoder.decode(&bytes[..split]);
            out += &decoder.decode(&bytes[split..]);
            out += &decoder.finish();
            assert_eq!(out, text, "split at {split}");
        }
        let mut decoder = Utf8Decoder::default();
        assert_eq!(
            decoder.decode(&[b'a', 0xFF, b'b', 0xE4, 0xB8]),
            "a\u{FFFD}b"
        );
        assert_eq!(decoder.finish(), "\u{FFFD}");
    }
}
