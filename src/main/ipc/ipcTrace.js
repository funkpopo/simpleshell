const { performance } = require("perf_hooks");
const { logToFile } = require("../utils/logger");

const SENSITIVE_KEY_PATTERN =
  /password|passphrase|privatekey|privateKey|apiKey|token|secret|credential/i;
const MAX_SERIALIZED_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_SLOW_THRESHOLD_MS = 100;
const CHANNEL_SLOW_THRESHOLD_MS = Object.freeze({
  "settings:unlockCredentialStore": 1000,
  "terminal:startSSH": 2000,
  startDirectoryWatch: 1000,
  checkDroppedUploadConflicts: 5000,
  uploadFile: 5000,
  uploadFolder: 5000,
  uploadDroppedFiles: 5000,
  downloadFile: 5000,
  downloadFiles: 5000,
  downloadFolder: 5000,
  createFolder: 1000,
  moveFile: 1000,
  deleteFile: 1000,
});

let nextRequestId = 1;

function isTracingEnabled() {
  if (process.env.SIMPLE_SHELL_IPC_TRACE === "0") {
    return false;
  }
  if (process.env.SIMPLE_SHELL_IPC_TRACE === "1") {
    return true;
  }
  return process.env.NODE_ENV !== "production";
}

function now() {
  return performance.now();
}

function createRequestId() {
  const id = nextRequestId;
  nextRequestId = nextRequestId >= Number.MAX_SAFE_INTEGER ? 1 : id + 1;
  return `ipc-${Date.now().toString(36)}-${id.toString(36)}`;
}

function estimatePayloadSize(value) {
  if (value === undefined || value === null) {
    return 0;
  }

  try {
    if (Buffer.isBuffer(value)) {
      return value.length;
    }
    if (typeof value === "string") {
      return Buffer.byteLength(value, "utf8");
    }
    if (ArrayBuffer.isView(value)) {
      return value.byteLength;
    }
    if (value instanceof ArrayBuffer) {
      return value.byteLength;
    }

    let truncated = false;
    const seen = new WeakSet();
    const serialized = JSON.stringify(value, (key, nestedValue) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return "<redacted>";
      }
      if (typeof nestedValue === "string") {
        const maxStringLength = 2048;
        if (nestedValue.length > maxStringLength) {
          truncated = true;
          return `${nestedValue.slice(0, maxStringLength)}<truncated>`;
        }
        return nestedValue;
      }
      if (Buffer.isBuffer(nestedValue)) {
        return `<Buffer:${nestedValue.length}>`;
      }
      if (nestedValue && typeof nestedValue === "object") {
        if (seen.has(nestedValue)) {
          return "<circular>";
        }
        seen.add(nestedValue);
      }
      return nestedValue;
    });

    if (!serialized) {
      return 0;
    }

    const bytes = Buffer.byteLength(serialized, "utf8");
    return truncated ? Math.min(bytes, MAX_SERIALIZED_PAYLOAD_BYTES) : bytes;
  } catch {
    return -1;
  }
}

function estimateArgsPayloadSize(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return 0;
  }
  return args.reduce((total, arg) => {
    const size = estimatePayloadSize(arg);
    return size < 0 || total < 0 ? -1 : total + size;
  }, 0);
}

function getSlowThresholdMs(channel, options = {}) {
  if (Number.isFinite(options.slowThresholdMs)) {
    return options.slowThresholdMs;
  }
  const channelThreshold = CHANNEL_SLOW_THRESHOLD_MS[channel];
  return Number.isFinite(channelThreshold)
    ? channelThreshold
    : DEFAULT_SLOW_THRESHOLD_MS;
}

function startTrace(channel, args = [], options = {}) {
  if (!isTracingEnabled()) {
    return null;
  }

  const normalizedChannel = channel || "<unknown>";
  return {
    requestId: createRequestId(),
    channel: normalizedChannel,
    category: options.category || "ipc",
    startedAt: now(),
    payloadSize: estimateArgsPayloadSize(args),
    slowThresholdMs: getSlowThresholdMs(normalizedChannel, options),
    logAll:
      options.logAll === true || process.env.SIMPLE_SHELL_IPC_TRACE === "1",
  };
}

function finishTrace(trace, outcome = {}) {
  if (!trace) {
    return;
  }

  const durationMs = Math.round((now() - trace.startedAt) * 100) / 100;
  const failed = outcome.success === false;
  const shouldLog =
    trace.logAll || failed || durationMs >= trace.slowThresholdMs;

  if (!shouldLog) {
    return;
  }

  const level = failed
    ? "WARN"
    : durationMs >= trace.slowThresholdMs
      ? "INFO"
      : "DEBUG";
  const payload =
    trace.payloadSize >= 0 ? `${trace.payloadSize}b` : "unknown-size";
  const status = failed ? "failed" : "completed";
  const error = outcome.error
    ? ` error=${String(outcome.error).slice(0, 160)}`
    : "";

  logToFile(
    `IPC trace ${status}: requestId=${trace.requestId} channel=${trace.channel} category=${trace.category} durationMs=${durationMs} payloadSize=${payload}${error}`,
    level,
  );
}

module.exports = {
  estimatePayloadSize,
  finishTrace,
  isTracingEnabled,
  startTrace,
};
