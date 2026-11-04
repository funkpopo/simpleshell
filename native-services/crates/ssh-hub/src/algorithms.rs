//! Maps algorithm names from `src/shared/domain/sshAlgorithms.js` onto
//! russh's preference lists.
//!
//! Order is preserved and names russh does not implement (for example
//! `umac-128-etm@openssh.com`) are skipped. The kex extension markers
//! (`ext-info-c`, strict kex) are always kept: without them servers cannot
//! offer rsa-sha2 signatures and the Terrapin mitigation is lost.

use crate::config::AlgorithmNames;
use russh::keys::{Algorithm, HashAlg};
use russh::{cipher, compression, kex, mac, Preferred};
use std::borrow::Cow;
use std::str::FromStr;

const KEX_EXTENSIONS: &[kex::Name] = &[
    kex::EXTENSION_SUPPORT_AS_CLIENT,
    kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT,
];

fn pick<T: Copy + AsRef<str>>(names: &[String], known: &[&T]) -> Vec<T> {
    let mut picked: Vec<T> = Vec::new();
    for name in names {
        if let Some(found) = known.iter().find(|candidate| candidate.as_ref() == name) {
            if !picked.iter().any(|existing| existing.as_ref() == name) {
                picked.push(**found);
            }
        }
    }
    picked
}

fn host_key_algorithms(names: &[String]) -> Vec<Algorithm> {
    let mut picked: Vec<Algorithm> = Vec::new();
    let mut push = |algorithm: Algorithm| {
        if !picked.contains(&algorithm) {
            picked.push(algorithm);
        }
    };
    for name in names {
        match name.as_str() {
            // `ssh-rsa` names the key type as well as the SHA-1 signature;
            // like OpenSSH, prefer the SHA-2 signatures for RSA host keys.
            "ssh-rsa" => {
                push(Algorithm::Rsa {
                    hash: Some(HashAlg::Sha512),
                });
                push(Algorithm::Rsa {
                    hash: Some(HashAlg::Sha256),
                });
                push(Algorithm::Rsa { hash: None });
            }
            other => {
                if let Ok(algorithm) = Algorithm::from_str(other) {
                    push(algorithm);
                }
            }
        }
    }
    picked
}

/// Compression offered when enabled: OpenSSH's delayed variant first (it
/// starts after authentication, so auth packets stay uncompressed), then
/// plain zlib, and `none` last so servers without zlib still connect.
const COMPRESSION_ENABLED: &[compression::Name] = &[
    compression::ZLIB_LEGACY,
    compression::ZLIB,
    compression::NONE,
];

/// Compression offered when disabled: `none` only, so the server cannot
/// pick zlib from our list.
const COMPRESSION_DISABLED: &[compression::Name] = &[compression::NONE];

/// russh preferences for `names`; lists left empty fall back to the defaults
/// extended with legacy algorithms, so old servers still negotiate.
pub fn preferred(names: Option<&AlgorithmNames>, compress: bool) -> Preferred {
    let mut preferred = compatible_defaults();
    preferred.compression = Cow::Borrowed(if compress {
        COMPRESSION_ENABLED
    } else {
        COMPRESSION_DISABLED
    });
    let Some(names) = names else {
        return preferred;
    };

    let mut kex_names: Vec<kex::Name> = pick(&names.kex, kex::ALL_KEX_ALGORITHMS);
    if !kex_names.is_empty() {
        kex_names.extend_from_slice(KEX_EXTENSIONS);
        preferred.kex = Cow::Owned(kex_names);
    }
    let keys = host_key_algorithms(&names.server_host_key);
    if !keys.is_empty() {
        preferred.key = Cow::Owned(keys);
    }
    let ciphers: Vec<cipher::Name> = pick(&names.cipher, cipher::ALL_CIPHERS);
    if !ciphers.is_empty() {
        preferred.cipher = Cow::Owned(ciphers);
    }
    let macs: Vec<mac::Name> = pick(&names.hmac, mac::ALL_MAC_ALGORITHMS);
    if !macs.is_empty() {
        preferred.mac = Cow::Owned(macs);
    }
    preferred
}

/// russh's safe defaults followed by the legacy algorithms SimpleShell has
/// always accepted.
fn compatible_defaults() -> Preferred {
    let mut preferred = Preferred::default();
    preferred.kex.to_mut().extend([
        kex::ECDH_SHA2_NISTP256,
        kex::ECDH_SHA2_NISTP384,
        kex::ECDH_SHA2_NISTP521,
        kex::DH_G14_SHA1,
        kex::DH_GEX_SHA1,
        kex::DH_G1_SHA1,
    ]);
    preferred.cipher.to_mut().extend([
        cipher::AES_128_GCM,
        cipher::AES_256_GCM_LEGACY,
        cipher::AES_128_GCM_LEGACY,
        cipher::AES_128_CBC,
        cipher::AES_192_CBC,
        cipher::AES_256_CBC,
        cipher::TRIPLE_DES_CBC,
    ]);
    preferred.key.to_mut().push(Algorithm::Dsa);
    preferred.mac.to_mut().extend([
        mac::HMAC_SHA256_96,
        mac::HMAC_SHA512_96,
        mac::HMAC_SHA1_96,
        mac::HMAC_MD5,
        mac::HMAC_MD5_96,
    ]);
    preferred
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn maps_the_basic_list_in_order_and_skips_unknown_names() {
        let preferred = preferred(
            Some(&AlgorithmNames {
                kex: names(&["curve25519-sha256", "diffie-hellman-group1-sha1", "bogus"]),
                server_host_key: names(&["ssh-ed25519", "ssh-rsa", "ssh-dss"]),
                cipher: names(&["aes128-ctr", "aes256-gcm", "3des-cbc"]),
                hmac: names(&["umac-128-etm@openssh.com", "hmac-sha2-256", "hmac-md5"]),
            }),
            false,
        );
        let kex: Vec<&str> = preferred.kex.iter().map(|n| n.as_ref()).collect();
        assert_eq!(
            kex,
            [
                "curve25519-sha256",
                "diffie-hellman-group1-sha1",
                "ext-info-c",
                "kex-strict-c-v00@openssh.com"
            ]
        );
        let ciphers: Vec<&str> = preferred.cipher.iter().map(|n| n.as_ref()).collect();
        assert_eq!(ciphers, ["aes128-ctr", "aes256-gcm", "3des-cbc"]);
        let macs: Vec<&str> = preferred.mac.iter().map(|n| n.as_ref()).collect();
        assert_eq!(macs, ["hmac-sha2-256", "hmac-md5"]);
        assert_eq!(
            preferred.key.as_ref(),
            [
                Algorithm::Ed25519,
                Algorithm::Rsa {
                    hash: Some(HashAlg::Sha512)
                },
                Algorithm::Rsa {
                    hash: Some(HashAlg::Sha256)
                },
                Algorithm::Rsa { hash: None },
                Algorithm::Dsa,
            ]
        );
    }

    #[test]
    fn empty_lists_keep_compatible_defaults() {
        let preferred = preferred(Some(&AlgorithmNames::default()), false);
        assert!(preferred
            .kex
            .iter()
            .any(|name| name.as_ref() == "diffie-hellman-group1-sha1"));
        assert!(preferred
            .kex
            .iter()
            .any(|name| name.as_ref() == "ext-info-c"));
        assert!(preferred.mac.iter().any(|name| name.as_ref() == "hmac-md5"));
    }

    #[test]
    fn compression_is_offered_only_when_enabled() {
        let order = |compress| -> Vec<String> {
            preferred(None, compress)
                .compression
                .iter()
                .map(|name| name.as_ref().to_string())
                .collect()
        };
        assert_eq!(order(false), ["none"]);
        assert_eq!(order(true), ["zlib@openssh.com", "zlib", "none"]);
    }
}
