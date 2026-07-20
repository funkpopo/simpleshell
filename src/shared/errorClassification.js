const ERROR_NOTIFICATION_LEVELS = Object.freeze({
  RECOVERABLE: "recoverable",
  RETRY: "retry",
  FEEDBACK: "feedback",
  FATAL: "fatal",
});

const ERROR_ACTIONS = Object.freeze({
  RECOVER: "recover",
  RETRY: "retry",
  FEEDBACK: "feedback",
  FATAL: "fatal",
  RESTART: "restart",
});

const ERROR_TYPES = Object.freeze({
  CONNECTION_REFUSED: "ECONNREFUSED",
  CONNECTION_TIMEOUT: "ETIMEDOUT",
  HOST_UNREACHABLE: "EHOSTUNREACH",
  HOST_NOT_FOUND: "ENOTFOUND",
  CONNECTION_RESET: "ECONNRESET",
  NETWORK_UNREACHABLE: "ENETUNREACH",
  AUTH_FAILED: "AUTH_FAILED",
  KEY_ERROR: "KEY_ERROR",
  PERMISSION_DENIED: "EACCES",
  FILE_NOT_FOUND: "ENOENT",
  OPERATION_TIMEOUT: "OPERATION_TIMEOUT",
  INVALID_INPUT: "EINVAL",
  BUSY: "EBUSY",
  CANCELLED: "ECANCELLED",
});

const RETRYABLE_CODES = new Set([
  ERROR_TYPES.CONNECTION_REFUSED,
  ERROR_TYPES.CONNECTION_TIMEOUT,
  ERROR_TYPES.HOST_UNREACHABLE,
  ERROR_TYPES.CONNECTION_RESET,
  ERROR_TYPES.NETWORK_UNREACHABLE,
  ERROR_TYPES.OPERATION_TIMEOUT,
  "EPIPE",
  "ECONNABORTED",
  "EAI_AGAIN",
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NETWORK_CHANGED",
  "NATIVE_SFTP_TIMEOUT",
  "NATIVE_SFTP_NETWORK",
  "NATIVE_SFTP_TRANSFER_FAILED",
  "NATIVE_SFTP_WATCH_CLOSED",
  "NATIVE_SFTP_WATCH_CLOSED_BEFORE_READY",
]);

const RECOVERABLE_CODES = new Set([
  ERROR_TYPES.AUTH_FAILED,
  ERROR_TYPES.KEY_ERROR,
  ERROR_TYPES.PERMISSION_DENIED,
  ERROR_TYPES.FILE_NOT_FOUND,
  ERROR_TYPES.HOST_NOT_FOUND,
  ERROR_TYPES.INVALID_INPUT,
  ERROR_TYPES.BUSY,
  ERROR_TYPES.CANCELLED,
  "EPERM",
  "ENOTDIR",
  "EISDIR",
  "ENAMETOOLONG",
  "ENOSPC",
  "NATIVE_SFTP_AUTH_FAILED",
  "NATIVE_SFTP_PERMISSION_DENIED",
  "NATIVE_SFTP_NOT_FOUND",
  "NATIVE_SFTP_INVALID_REQUEST",
  "NATIVE_SFTP_UNSUPPORTED_OPERATION",
  "NATIVE_SFTP_MISSING_CONFIG",
]);

const FEEDBACK_CODES = new Set([
  "NATIVE_SFTP_INTERNAL",
  "NATIVE_SFTP_SIDECAR",
  "NATIVE_SFTP_SIDECAR_MISSING",
  "NATIVE_SFTP_SIDECAR_START_FAILED",
  "NATIVE_SFTP_INVALID_SIDECAR_OUTPUT",
  "NATIVE_SFTP_MISSING_RESULT",
]);

const FATAL_TYPES = new Set([
  "uncaughtException",
  "unhandledRejection",
  "rendererCrash",
  "render-process-gone",
  "child-process-gone",
  "runtime-crash",
  "fatal",
]);

// 认证类错误关键字（各处散落判定表的并集，统一小写匹配）
const AUTH_ERROR_KEYWORDS = Object.freeze([
  "authentication",
  "auth fail",
  "configured authentication methods failed",
  "permission",
  "publickey",
  "password",
  "private key",
  "keyboard-interactive",
  "认证失败",
  "身份验证",
  "密码",
  "私钥",
]);

const TIMEOUT_ERROR_KEYWORDS = Object.freeze([
  "etimedout",
  "timed out",
  "timeout",
  "超时",
]);

const NETWORK_UNREACHABLE_KEYWORDS = Object.freeze([
  "enetunreach",
  "network unreachable",
  "ehostunreach",
  "host unreachable",
  "network changed",
  "internet disconnected",
  "网络不可达",
  "主机不可达",
  "断网",
]);

function includesAnyKeyword(message, keywords) {
  const lower = String(message || "").toLowerCase();
  if (!lower) {
    return false;
  }
  return keywords.some((keyword) => lower.includes(keyword));
}

function isAuthErrorMessage(message) {
  return includesAnyKeyword(message, AUTH_ERROR_KEYWORDS);
}

function isTimeoutErrorMessage(message) {
  return includesAnyKeyword(message, TIMEOUT_ERROR_KEYWORDS);
}

function isNetworkUnreachableMessage(message) {
  return includesAnyKeyword(message, NETWORK_UNREACHABLE_KEYWORDS);
}

function toUpperCode(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  return value.trim().toUpperCase();
}

function normalizeMessage(error) {
  if (typeof error === "string") {
    return error;
  }
  if (!error || typeof error !== "object") {
    return "";
  }
  return String(
    error.message ||
      error.error ||
      error.reason ||
      error.statusText ||
      error.type ||
      "",
  );
}

function extractCode(error) {
  if (!error || typeof error !== "object") {
    return null;
  }

  return (
    toUpperCode(error.errorCode) ||
    toUpperCode(error.code) ||
    toUpperCode(error.error?.code) ||
    toUpperCode(error.raw?.errorCode) ||
    toUpperCode(error.raw?.code)
  );
}

function detectErrorType(error) {
  const explicitCode = extractCode(error);
  if (explicitCode) {
    if (Object.values(ERROR_TYPES).includes(explicitCode)) {
      return explicitCode;
    }
    return explicitCode;
  }

  const lowerMessage = normalizeMessage(error).toLowerCase();

  if (
    lowerMessage.includes("econnrefused") ||
    lowerMessage.includes("connection refused") ||
    lowerMessage.includes("连接被拒绝")
  ) {
    return ERROR_TYPES.CONNECTION_REFUSED;
  }
  if (
    lowerMessage.includes("etimedout") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("超时")
  ) {
    return lowerMessage.includes("connect")
      ? ERROR_TYPES.CONNECTION_TIMEOUT
      : ERROR_TYPES.OPERATION_TIMEOUT;
  }
  if (
    lowerMessage.includes("ehostunreach") ||
    lowerMessage.includes("host unreachable") ||
    lowerMessage.includes("主机不可达")
  ) {
    return ERROR_TYPES.HOST_UNREACHABLE;
  }
  if (
    lowerMessage.includes("enotfound") ||
    lowerMessage.includes("getaddrinfo") ||
    lowerMessage.includes("hostname") ||
    lowerMessage.includes("dns") ||
    lowerMessage.includes("主机名")
  ) {
    return ERROR_TYPES.HOST_NOT_FOUND;
  }
  if (
    lowerMessage.includes("econnreset") ||
    lowerMessage.includes("connection reset") ||
    lowerMessage.includes("socket hang up") ||
    lowerMessage.includes("连接被重置")
  ) {
    return ERROR_TYPES.CONNECTION_RESET;
  }
  if (
    lowerMessage.includes("enetunreach") ||
    lowerMessage.includes("network unreachable") ||
    lowerMessage.includes("network changed") ||
    lowerMessage.includes("internet disconnected") ||
    lowerMessage.includes("网络不可达") ||
    lowerMessage.includes("断网")
  ) {
    return ERROR_TYPES.NETWORK_UNREACHABLE;
  }
  if (
    lowerMessage.includes("authentication failed") ||
    lowerMessage.includes("auth fail") ||
    lowerMessage.includes("configured authentication methods failed") ||
    lowerMessage.includes("认证失败") ||
    lowerMessage.includes("身份验证")
  ) {
    return ERROR_TYPES.AUTH_FAILED;
  }
  if (
    lowerMessage.includes("private key") ||
    (lowerMessage.includes("key") &&
      (lowerMessage.includes("invalid") || lowerMessage.includes("error"))) ||
    lowerMessage.includes("密钥")
  ) {
    return ERROR_TYPES.KEY_ERROR;
  }
  if (
    lowerMessage.includes("eacces") ||
    lowerMessage.includes("eperm") ||
    lowerMessage.includes("permission denied") ||
    lowerMessage.includes("权限")
  ) {
    return ERROR_TYPES.PERMISSION_DENIED;
  }
  if (
    lowerMessage.includes("enoent") ||
    lowerMessage.includes("no such file") ||
    lowerMessage.includes("not found") ||
    lowerMessage.includes("不存在")
  ) {
    return ERROR_TYPES.FILE_NOT_FOUND;
  }
  if (
    lowerMessage.includes("invalid") ||
    lowerMessage.includes("unsupported") ||
    lowerMessage.includes("required") ||
    lowerMessage.includes("无效") ||
    lowerMessage.includes("不支持") ||
    lowerMessage.includes("不能为空")
  ) {
    return ERROR_TYPES.INVALID_INPUT;
  }
  if (
    lowerMessage.includes("busy") ||
    lowerMessage.includes("already in progress") ||
    lowerMessage.includes("占用") ||
    lowerMessage.includes("正在进行")
  ) {
    return ERROR_TYPES.BUSY;
  }
  if (
    lowerMessage.includes("cancelled") ||
    lowerMessage.includes("canceled") ||
    lowerMessage.includes("aborted") ||
    lowerMessage.includes("取消")
  ) {
    return ERROR_TYPES.CANCELLED;
  }

  return null;
}

function normalizeCategory(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "retryable") return ERROR_NOTIFICATION_LEVELS.RETRY;
  if (normalized === "user-recoverable") {
    return ERROR_NOTIFICATION_LEVELS.RECOVERABLE;
  }
  if (normalized === "report" || normalized === "reportable") {
    return ERROR_NOTIFICATION_LEVELS.FEEDBACK;
  }
  if (Object.values(ERROR_NOTIFICATION_LEVELS).includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function normalizeAction(value) {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "recoverable") return ERROR_ACTIONS.RECOVER;
  if (normalized === "report") return ERROR_ACTIONS.FEEDBACK;
  if (Object.values(ERROR_ACTIONS).includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function buildPolicy(category, reason, details = {}) {
  const actionByCategory = {
    [ERROR_NOTIFICATION_LEVELS.RECOVERABLE]: ERROR_ACTIONS.RECOVER,
    [ERROR_NOTIFICATION_LEVELS.RETRY]: ERROR_ACTIONS.RETRY,
    [ERROR_NOTIFICATION_LEVELS.FEEDBACK]: ERROR_ACTIONS.FEEDBACK,
    [ERROR_NOTIFICATION_LEVELS.FATAL]: ERROR_ACTIONS.RESTART,
  };
  const severityByCategory = {
    [ERROR_NOTIFICATION_LEVELS.RECOVERABLE]: "warning",
    [ERROR_NOTIFICATION_LEVELS.RETRY]: "warning",
    [ERROR_NOTIFICATION_LEVELS.FEEDBACK]: "error",
    [ERROR_NOTIFICATION_LEVELS.FATAL]: "error",
  };

  if (!Object.values(ERROR_NOTIFICATION_LEVELS).includes(category)) {
    throw new Error(`Invalid error notification category: ${category}`);
  }

  return {
    schemaVersion: 1,
    category,
    level: category,
    action: actionByCategory[category],
    severity: severityByCategory[category],
    persistent:
      category === ERROR_NOTIFICATION_LEVELS.FEEDBACK ||
      category === ERROR_NOTIFICATION_LEVELS.FATAL,
    retryable: category === ERROR_NOTIFICATION_LEVELS.RETRY,
    userRecoverable: category === ERROR_NOTIFICATION_LEVELS.RECOVERABLE,
    reportable:
      category === ERROR_NOTIFICATION_LEVELS.FEEDBACK ||
      category === ERROR_NOTIFICATION_LEVELS.FATAL,
    fatal: category === ERROR_NOTIFICATION_LEVELS.FATAL,
    showDiagnostics: category !== ERROR_NOTIFICATION_LEVELS.RECOVERABLE,
    showFeedback:
      category === ERROR_NOTIFICATION_LEVELS.FEEDBACK ||
      category === ERROR_NOTIFICATION_LEVELS.FATAL,
    reason,
    ...details,
  };
}

function classifyError(error, context = {}) {
  const source =
    error && typeof error === "object" ? { ...error, ...context } : context;
  const explicitCategory = normalizeCategory(
    source.errorCategory || source.category || source.level,
  );
  const explicitAction = normalizeAction(source.errorAction || source.action);
  const code = detectErrorType(source) || detectErrorType(error);
  const errorKind =
    typeof source.errorKind === "string" ? source.errorKind.toLowerCase() : "";
  const type = typeof source.type === "string" ? source.type : "";
  const message = normalizeMessage(source) || normalizeMessage(error);
  const lowerMessage = message.toLowerCase();

  if (
    explicitCategory === ERROR_NOTIFICATION_LEVELS.FATAL ||
    explicitAction === ERROR_ACTIONS.RESTART ||
    explicitAction === ERROR_ACTIONS.FATAL ||
    FATAL_TYPES.has(type) ||
    lowerMessage.includes("renderer process gone") ||
    lowerMessage.includes("uncaughtexception") ||
    lowerMessage.includes("out of memory") ||
    lowerMessage.includes("oom")
  ) {
    return buildPolicy(ERROR_NOTIFICATION_LEVELS.FATAL, "fatal-signal", {
      code,
      errorKind: errorKind || null,
    });
  }

  if (
    explicitCategory === ERROR_NOTIFICATION_LEVELS.RETRY ||
    explicitAction === ERROR_ACTIONS.RETRY ||
    source.retryable === true ||
    (code && RETRYABLE_CODES.has(code))
  ) {
    return buildPolicy(ERROR_NOTIFICATION_LEVELS.RETRY, "retryable-signal", {
      code,
      errorKind: errorKind || null,
    });
  }

  if (
    explicitCategory === ERROR_NOTIFICATION_LEVELS.RECOVERABLE ||
    explicitAction === ERROR_ACTIONS.RECOVER ||
    source.userRecoverable === true ||
    (code && RECOVERABLE_CODES.has(code))
  ) {
    return buildPolicy(
      ERROR_NOTIFICATION_LEVELS.RECOVERABLE,
      "user-recoverable-signal",
      {
        code,
        errorKind: errorKind || null,
      },
    );
  }

  if (
    explicitCategory === ERROR_NOTIFICATION_LEVELS.FEEDBACK ||
    explicitAction === ERROR_ACTIONS.FEEDBACK ||
    source.reportable === true ||
    errorKind === "internal" ||
    (code && FEEDBACK_CODES.has(code)) ||
    lowerMessage.includes("sidecar") ||
    lowerMessage.includes("invalid json") ||
    lowerMessage.includes("invariant") ||
    lowerMessage.includes("assert")
  ) {
    return buildPolicy(ERROR_NOTIFICATION_LEVELS.FEEDBACK, "feedback-signal", {
      code,
      errorKind: errorKind || null,
    });
  }

  return buildPolicy(ERROR_NOTIFICATION_LEVELS.FEEDBACK, "unclassified", {
    code,
    errorKind: errorKind || null,
  });
}

function classifyErrorResponse(error, context = {}) {
  const classification = classifyError(error, context);
  return {
    errorCategory: classification.category,
    errorAction: classification.action,
    errorSeverity: classification.severity,
    errorClassification: classification,
    retryable: classification.retryable,
    reportable: classification.reportable,
    userRecoverable: classification.userRecoverable,
    fatal: classification.fatal,
  };
}

module.exports = {
  ERROR_ACTIONS,
  ERROR_NOTIFICATION_LEVELS,
  ERROR_TYPES,
  classifyError,
  classifyErrorResponse,
  detectErrorType,
  isAuthErrorMessage,
  isTimeoutErrorMessage,
  isNetworkUnreachableMessage,
};
