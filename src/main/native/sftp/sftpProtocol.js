/** Native SFTP protocol normalization, structured errors, and stage logging. */
function createSftpProtocol({
  NATIVE_SFTP_SCHEMA_VERSION,
  logToFile,
  normalizeErrorMessage,
}) {
  let nativeRequestSequence = 0;

  function createNativeRequestId(operation) {
    nativeRequestSequence =
      (nativeRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
    return `native-sftp-${operation || "request"}-${Date.now()}-${nativeRequestSequence}`;
  }

  function normalizeNativeRequest(request = {}) {
    const operation = request?.operation || "unknown-operation";
    return {
      ...request,
      schemaVersion: NATIVE_SFTP_SCHEMA_VERSION,
      requestId: request.requestId || createNativeRequestId(operation),
    };
  }

  function normalizeLogLevel(level, fallback = "WARN") {
    const normalized = String(level || "")
      .trim()
      .toUpperCase();
    return ["DEBUG", "INFO", "WARN", "ERROR"].includes(normalized)
      ? normalized
      : fallback;
  }

  function logNativeStage(operation, requestId, stage, elapsedMs, startedAt) {
    const numericElapsed = Number(elapsedMs);
    const nativeElapsed = Number.isFinite(numericElapsed)
      ? ` nativeElapsedMs=${Math.max(0, numericElapsed)}`
      : "";
    const observedElapsed = startedAt
      ? ` observedElapsedMs=${Math.max(0, Date.now() - startedAt)}`
      : "";
    logToFile(
      `Native SFTP: stage=${stage} operation=${operation || "unknown-operation"} requestId=${requestId || "none"}${nativeElapsed}${observedElapsed}`,
      "INFO",
    );
  }

  function isExpectedNativeFailure(value, options = {}) {
    if (typeof options.expectedFailure !== "function") {
      return false;
    }

    try {
      return options.expectedFailure(value) === true;
    } catch (error) {
      logToFile(
        `Native SFTP: expectedFailure predicate failed - ${normalizeErrorMessage(error)}`,
        "WARN",
      );
      return false;
    }
  }

  function parseStructuredErrorText(value) {
    const text = String(value || "").trim();
    if (!text || (!text.startsWith("{") && !text.startsWith("["))) {
      return null;
    }

    try {
      const parsed = JSON.parse(text);
      if (parsed?.type === "result" && parsed.result) {
        return parsed.result;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function createNativeSidecarError(message, payload = {}) {
    const error = new Error(
      message || payload.error || "Native sidecar failed",
    );
    const errorCode =
      payload.errorCode || payload.code || "NATIVE_SFTP_SIDECAR";
    error.code = errorCode;
    error.errorCode = errorCode;
    error.errorKind = payload.errorKind || payload.kind || "sidecar";
    error.retryable = payload.retryable === true;
    error.module = payload.module || "native-sidecar";
    error.operation = payload.operation || null;
    error.requestId = payload.requestId || null;
    error.sidecarVersion = payload.sidecarVersion || null;
    error.raw = payload.raw || payload;
    return error;
  }

  function normalizeNativeErrorPayload(payload, fallbackMessage) {
    const structured =
      payload && typeof payload === "object"
        ? payload
        : parseStructuredErrorText(payload);
    const message =
      structured?.error ||
      structured?.message ||
      fallbackMessage ||
      normalizeErrorMessage(payload);

    if (structured && typeof structured === "object") {
      return {
        ...structured,
        success: false,
        error: message,
        message,
        errorCode:
          structured.errorCode || structured.code || "NATIVE_SFTP_SIDECAR",
        errorKind: structured.errorKind || structured.kind || "sidecar",
        retryable: structured.retryable === true,
        module: structured.module || "native-sidecar",
      };
    }

    return {
      success: false,
      error: message,
      message,
      errorCode: "NATIVE_SFTP_SIDECAR",
      errorKind: "sidecar",
      retryable: false,
      module: "native-sidecar",
    };
  }

  function normalizeNativeResultPayload(result, request) {
    if (!result || typeof result !== "object") {
      return result;
    }

    return {
      schemaVersion: result.schemaVersion || NATIVE_SFTP_SCHEMA_VERSION,
      requestId: result.requestId || request?.requestId || null,
      operation: result.operation || request?.operation || null,
      ...result,
    };
  }

  function buildInvalidSidecarOutputError(error, request, line) {
    return createNativeSidecarError(
      `Native SFTP sidecar returned invalid JSON: ${normalizeErrorMessage(error)}`,
      {
        errorCode: "NATIVE_SFTP_INVALID_SIDECAR_OUTPUT",
        errorKind: "internal",
        retryable: false,
        operation: request.operation || null,
        requestId: request.requestId,
        raw: { line },
      },
    );
  }

  function requireNativeSuccess(result) {
    if (result?.success === true) return result;
    const details = normalizeNativeErrorPayload(
      result,
      "Native SFTP operation failed",
    );
    throw Object.assign(new Error(details.error), details);
  }

  return {
    createNativeRequestId,
    normalizeNativeRequest,
    normalizeLogLevel,
    logNativeStage,
    isExpectedNativeFailure,
    parseStructuredErrorText,
    createNativeSidecarError,
    normalizeNativeErrorPayload,
    normalizeNativeResultPayload,
    buildInvalidSidecarOutputError,
    requireNativeSuccess,
  };
}

module.exports = createSftpProtocol;
