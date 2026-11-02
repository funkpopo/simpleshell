//! Host-key fingerprints in the `SHA256:<hex>` form the JS trust store uses.

use russh::keys::PublicKey;
use sha2::{Digest, Sha256};

pub fn normalize_fingerprint(fingerprint: &str) -> Option<String> {
    let trimmed = fingerprint.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.len() >= 7 && trimmed[..7].eq_ignore_ascii_case("SHA256:") {
        return Some(format!("SHA256:{}", &trimmed[7..]));
    }
    Some(format!("SHA256:{trimmed}"))
}

pub fn fingerprint(key: &PublicKey) -> Result<String, russh::Error> {
    let blob = key.to_bytes().map_err(russh::Error::from)?;
    Ok(format!("SHA256:{}", hex(&Sha256::digest(&blob))))
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(DIGITS[(byte >> 4) as usize] as char);
        output.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_prefix_and_whitespace() {
        assert_eq!(normalize_fingerprint(" abc "), Some("SHA256:abc".into()));
        assert_eq!(
            normalize_fingerprint("sha256:abc"),
            Some("SHA256:abc".into())
        );
        assert_eq!(normalize_fingerprint("  "), None);
        assert_eq!(hex(&[0, 0xab, 0xff]), "00abff");
    }
}
