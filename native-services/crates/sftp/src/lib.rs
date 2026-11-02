//! SFTP file management: one-shot requests, persistent sessions, directory
//! watches, remote/local scans and checksums. See README.md for the protocol.

mod checksum;
mod connect;
mod errors;
mod ops;
mod protocol;
mod scan;
mod session;
mod transfer;
mod watch;

pub use checksum::run_checksum_file;
pub use scan::run_scan_folder;
pub use session::{run_sftp_request, run_sftp_session, run_sftp_watch};

#[cfg(test)]
mod transfer_tests {
    use crate::checksum::*;
    use crate::errors::*;
    use crate::ops::*;
    use crate::protocol::*;
    use crate::transfer::*;
    use md5::Md5;
    use sha2::{Digest, Sha256};

    #[test]
    fn directory_paths_preserve_whitespace() {
        assert_eq!(resolve_directory_path(None), ".");
        assert_eq!(resolve_directory_path(Some("")), ".");
        assert_eq!(resolve_directory_path(Some("/srv/folder ")), "/srv/folder ");
        assert_eq!(resolve_directory_path(Some(" folder ")), " folder ");
        assert_eq!(resolve_directory_path(Some(" ")), " ");
    }

    #[tokio::test]
    async fn streaming_hash_vectors() {
        assert_eq!(
            hash_reader::<_, Md5>(&mut &b"abc"[..]).await.unwrap(),
            "900150983cd24fb0d6963f7d28e17f72"
        );
        assert_eq!(
            hash_reader::<_, Sha256>(&mut &b"abc"[..]).await.unwrap(),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            hash_reader::<_, Md5>(&mut &b""[..]).await.unwrap(),
            "d41d8cd98f00b204e9800998ecf8427e"
        );
        let bytes = vec![0x5a; 1024 * 1024 + 17];
        assert_eq!(
            hash_reader::<_, Sha256>(&mut &bytes[..]).await.unwrap(),
            format!("{:x}", Sha256::digest(&bytes))
        );
    }

    #[test]
    fn transfer_windows_and_protocol() {
        assert_eq!(
            resolve_transfer_window(100, Some(60), None).unwrap(),
            (60, 40)
        );
        assert_eq!(
            resolve_transfer_window(0, Some(0), Some(0)).unwrap(),
            (0, 0)
        );
        assert!(resolve_transfer_window(100, Some(101), None).is_err());
        assert!(resolve_transfer_window(100, Some(80), Some(21)).is_err());
        assert_eq!(
            SftpOperation::parse("statFile").unwrap(),
            SftpOperation::StatFile
        );
        assert_eq!(
            SftpOperation::parse("checksumFile").unwrap(),
            SftpOperation::ChecksumFile
        );
        assert!(!classify_error("checksum source changed while reading").retryable);
    }

    #[test]
    fn checksum_file_args_parse_and_validate() {
        let args = [
            "--path".to_string(),
            "/tmp/file".to_string(),
            "--algorithm".to_string(),
            "sha256".to_string(),
            "--offset".to_string(),
            "10".to_string(),
            "--length".to_string(),
            "20".to_string(),
        ];
        let parsed = parse_checksum_file_args(args.into_iter()).unwrap();
        assert_eq!(parsed.path, "/tmp/file");
        assert_eq!(parsed.algorithm, "sha256");
        assert_eq!(parsed.offset, Some(10));
        assert_eq!(parsed.length, Some(20));

        assert!(parse_checksum_file_args(Vec::new().into_iter()).is_err());
        assert!(parse_checksum_file_args(
            [
                "--path".to_string(),
                "/tmp/f".to_string(),
                "--algorithm".to_string(),
                "sha1".to_string()
            ]
            .into_iter()
        )
        .is_ok());
        assert!(parse_checksum_file_args(
            [
                "--path".to_string(),
                "/tmp/f".to_string(),
                "--offset".to_string(),
                "-1".to_string()
            ]
            .into_iter()
        )
        .is_err());
        assert!(parse_checksum_file_args(
            [
                "--path".to_string(),
                "/tmp/f".to_string(),
                "--unknown".to_string()
            ]
            .into_iter()
        )
        .is_err());
    }
}
