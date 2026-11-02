pub(crate) struct ErrorClassification {
    pub(crate) error_code: &'static str,
    pub(crate) error_kind: &'static str,
    pub(crate) retryable: bool,
}

pub(crate) fn classify_error(message: &str) -> ErrorClassification {
    let lower = message.to_ascii_lowercase();
    if lower.contains("checksum source") {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_SOURCE_CHANGED",
            error_kind: "source-changed",
            retryable: false,
        };
    }

    if lower.contains("failed to parse request")
        || lower.contains("is required")
        || lower.contains("invalid base64")
        || lower.contains("invalid permissions")
        || lower.contains("invalid numeric id")
        || lower.contains("segment offset")
        || lower.contains("segment length")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_INVALID_REQUEST",
            error_kind: "validation",
            retryable: false,
        };
    }

    if lower.contains("unsupported") {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_UNSUPPORTED_OPERATION",
            error_kind: "unsupported",
            retryable: false,
        };
    }

    if lower.contains("authentication failed")
        || lower.contains("public key authentication")
        || lower.contains("password authentication")
        || lower.contains("missing ssh credentials")
        || lower.contains("decode private key")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_AUTH_FAILED",
            error_kind: "authentication",
            retryable: false,
        };
    }

    if lower.contains("host key verification")
        || lower.contains("host fingerprint")
        || lower.contains("trusted ssh host fingerprint")
        || lower.contains("unknown server key")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_HOST_KEY_VERIFICATION_FAILED",
            error_kind: "hostKey",
            retryable: false,
        };
    }

    if lower.contains("proxy") || lower.contains("socks4") || lower.contains("socks5") {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_PROXY",
            error_kind: "proxy",
            retryable: true,
        };
    }

    if lower.contains("permission denied") || lower.contains("access denied") {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_PERMISSION_DENIED",
            error_kind: "permission",
            retryable: false,
        };
    }

    if lower.contains("no such file")
        || lower.contains("not found")
        || lower.contains("path exists and is not a directory")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_NOT_FOUND",
            error_kind: "notFound",
            retryable: false,
        };
    }

    if lower.contains("timed out") || lower.contains("timeout") {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_TIMEOUT",
            error_kind: "timeout",
            retryable: true,
        };
    }

    if lower.contains("failed to connect")
        || lower.contains("connection reset")
        || lower.contains("connection refused")
        || lower.contains("connection closed")
        || lower.contains("network")
        || lower.contains("channel")
        || lower.contains("subsystem")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_NETWORK",
            error_kind: "network",
            retryable: true,
        };
    }

    if lower.contains("upload")
        || lower.contains("download")
        || lower.contains("read")
        || lower.contains("write")
        || lower.contains("flush")
        || lower.contains("shutdown")
    {
        return ErrorClassification {
            error_code: "NATIVE_SFTP_TRANSFER_FAILED",
            error_kind: "transfer",
            retryable: true,
        };
    }

    ErrorClassification {
        error_code: "NATIVE_SFTP_INTERNAL",
        error_kind: "internal",
        retryable: false,
    }
}
