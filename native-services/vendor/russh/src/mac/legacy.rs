// SimpleShell SSH compatibility MACs (Apache-2.0).
// Keep legacy negotiation opt-in: this module does not change Preferred::DEFAULT.
use std::{collections::HashMap, marker::PhantomData};

use digest::typenum::U16;
use hmac::Hmac;
use md5_digest::Md5;
use subtle::ConstantTimeEq;

use super::{Mac, MacAlgorithm, Name, crypto::CryptoMacAlgorithm};

pub const HMAC_SHA1_96: Name = Name("hmac-sha1-96");
pub const HMAC_MD5: Name = Name("hmac-md5");
pub const HMAC_MD5_96: Name = Name("hmac-md5-96");
pub const HMAC_SHA256_96: Name = Name("hmac-sha2-256-96");
pub const HMAC_SHA512_96: Name = Name("hmac-sha2-512-96");

static MD5: CryptoMacAlgorithm<Hmac<Md5>, U16> = CryptoMacAlgorithm(PhantomData, PhantomData);
static SHA1_96: TruncatedAlgorithm = TruncatedAlgorithm(&super::_HMAC_SHA1);
static MD5_96: TruncatedAlgorithm = TruncatedAlgorithm(&MD5);
static SHA256_96: TruncatedAlgorithm = TruncatedAlgorithm(&super::_HMAC_SHA256);
static SHA512_96: TruncatedAlgorithm = TruncatedAlgorithm(&super::_HMAC_SHA512);

pub(super) fn register(
    map: &mut HashMap<&'static Name, &'static (dyn MacAlgorithm + Send + Sync)>,
) {
    map.insert(&HMAC_SHA1_96, &SHA1_96);
    map.insert(&HMAC_MD5, &MD5);
    map.insert(&HMAC_MD5_96, &MD5_96);
    map.insert(&HMAC_SHA256_96, &SHA256_96);
    map.insert(&HMAC_SHA512_96, &SHA512_96);
}

// RFC 4253 section 6.4: truncate the *tag*, never the derived key.
struct TruncatedAlgorithm(&'static (dyn MacAlgorithm + Send + Sync));
impl MacAlgorithm for TruncatedAlgorithm {
    fn key_len(&self) -> usize {
        self.0.key_len()
    }
    fn make_mac(&self, key: &[u8]) -> Box<dyn Mac + Send> {
        Box::new(TruncatedMac(self.0.make_mac(key)))
    }
}

struct TruncatedMac(Box<dyn Mac + Send>);
impl Mac for TruncatedMac {
    fn mac_len(&self) -> usize {
        12
    }
    fn compute(&self, sequence: u32, payload: &[u8], output: &mut [u8]) {
        let mut full = [0u8; 64];
        self.0
            .compute(sequence, payload, &mut full[..self.0.mac_len()]);
        output.copy_from_slice(&full[..12]);
    }
    fn verify(&self, sequence: u32, payload: &[u8], received: &[u8]) -> bool {
        if received.len() != 12 {
            return false;
        }
        let mut expected = [0u8; 12];
        self.compute(sequence, payload, &mut expected);
        expected.ct_eq(received).into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn independent_vectors_and_rejected_tampering() {
        // Python hmac/OpenSSL vectors: key=bytes(range(key_len)); the authenticated
        // SSH input is uint32_be(0xfffffffe) followed by this binary payload.
        let payload = b"SSH legacy MAC fixture\0\xff";
        for (name, key_len, expected) in [
            (HMAC_SHA1_96, 20, "8f1188a819ed56f093f64a03"),
            (HMAC_MD5, 16, "430f946b7fa93a89d59f9933c287c94d"),
            (HMAC_MD5_96, 16, "430f946b7fa93a89d59f9933"),
            (HMAC_SHA256_96, 32, "8c61238dd657e1052fdd6317"),
            (HMAC_SHA512_96, 64, "fb2c84b0488bab3280cfc603"),
        ] {
            let algorithm = super::super::MACS.get(&name).unwrap();
            assert_eq!(algorithm.key_len(), key_len);
            let key: Vec<u8> = (0..key_len as u8).collect();
            let mac = algorithm.make_mac(&key);
            let mut output = vec![0; mac.mac_len()];
            mac.compute(0xffff_fffe, payload, &mut output);
            let actual: String = output.iter().map(|v| format!("{v:02x}")).collect();
            assert_eq!(actual, expected);
            assert!(mac.verify(0xffff_fffe, payload, &output));
            assert!(!mac.verify(0xffff_ffff, payload, &output));
            assert!(!mac.verify(0xffff_fffe, b"modified payload", &output));
            assert!(!mac.verify(0xffff_fffe, payload, &output[..output.len() - 1]));
            let mut longer = output.clone();
            longer.push(0);
            assert!(!mac.verify(0xffff_fffe, payload, &longer));
            output[0] ^= 1;
            assert!(!mac.verify(0xffff_fffe, payload, &output));
        }
    }

    #[test]
    fn upstream_defaults_do_not_enable_legacy_algorithms() {
        let preferred = crate::Preferred::default();
        for name in [
            HMAC_SHA1_96,
            HMAC_MD5,
            HMAC_MD5_96,
            HMAC_SHA256_96,
            HMAC_SHA512_96,
        ] {
            assert!(!preferred.mac.contains(&name));
        }
        assert!(
            !preferred
                .cipher
                .contains(&crate::cipher::AES_128_GCM_LEGACY)
        );
        assert!(
            !preferred
                .cipher
                .contains(&crate::cipher::AES_256_GCM_LEGACY)
        );
    }
}
