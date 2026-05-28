const fs = require("fs");
const nativeSftpClient = require("../../utils/nativeSftpClient");
const { logToFile } = require("../../utils/logger");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

const MAX_CALLS_PER_BATCH = 100;
const MAX_BATCH_PAYLOAD_BYTES = 256 * 1024;

function isStandardResponse(obj) {
  return obj && typeof obj === "object" && typeof obj.success === "boolean";
}

function normalizeResult(raw) {
  if (!isStandardResponse(raw)) {
    return { success: true, data: raw };
  }
  if (raw.success === false) {
    return {
      success: false,
      error: raw.error || "Operation failed",
      message: raw.message || raw.error || "Operation failed",
      errorCode: raw.errorCode || raw.code || null,
      code: raw.code || raw.errorCode || null,
      errorKind: raw.errorKind || null,
      retryable: raw.retryable === true,
      module: raw.module || null,
      operation: raw.operation || null,
    };
  }
  // Prefer unwrapping standardized { success: true, data } shapes.
  if ("data" in raw) {
    return { success: true, data: raw.data };
  }
  // Otherwise keep the entire object as data so callers don't lose fields like { exists }.
  return { success: true, data: raw };
}

/**
 * ipc:batchInvoke
 * calls: Array<[channel: string, ...args]>
 *
 * Returns: Array<{ success: boolean, data?: any, error?: string }>
 */
async function batchInvoke(_event, calls) {
  if (!Array.isArray(calls)) {
    return [{ success: false, error: "calls must be an array" }];
  }

  if (calls.length > MAX_CALLS_PER_BATCH) {
    return [
      {
        success: false,
        error: `Too many calls in one batch (max ${MAX_CALLS_PER_BATCH})`,
      },
    ];
  }

  let payloadBytes = 0;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(calls), "utf8");
  } catch {
    return [{ success: false, error: "Batch payload is not serializable" }];
  }

  if (payloadBytes > MAX_BATCH_PAYLOAD_BYTES) {
    return [
      {
        success: false,
        error: `Batch payload too large (max ${MAX_BATCH_PAYLOAD_BYTES} bytes)`,
      },
    ];
  }

  const results = [];

  for (const call of calls) {
    if (!Array.isArray(call) || call.length === 0) {
      results.push({ success: false, error: "Invalid call entry" });
      continue;
    }

    const [channel, ...args] = call;
    if (typeof channel !== "string" || channel.trim() === "") {
      results.push({ success: false, error: "Invalid channel" });
      continue;
    }

    try {
      // Strict allowlist: keep narrow to avoid arbitrary IPC execution.
      if (channel === IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS) {
        const [tabId, filePath] = args;
        const raw = await nativeSftpClient.getFilePermissions(tabId, filePath);
        results.push(normalizeResult(raw));
        continue;
      }

      if (channel === IPC_REQUEST_CHANNELS.FILE_CHECK_PATH_EXISTS) {
        const [checkPath] = args;
        const exists = fs.existsSync(checkPath);
        results.push({ success: true, data: { exists } });
        continue;
      }

      results.push({
        success: false,
        error: `Channel not allowed: ${channel}`,
      });
    } catch (error) {
      logToFile(
        `ipc:batchInvoke failed for ${channel}: ${error?.message || String(error)}`,
        "ERROR",
      );
      results.push({
        success: false,
        error: error?.message || String(error),
        message: error?.message || String(error),
        errorCode: error?.errorCode || error?.code || null,
        code: error?.code || error?.errorCode || null,
        errorKind: error?.errorKind || null,
        retryable: error?.retryable === true,
        module: error?.module || null,
        operation: error?.operation || null,
      });
    }
  }

  return results;
}

function registerBatchInvokeHandlers(ipcMain, safeHandle) {
  safeHandle(ipcMain, IPC_REQUEST_CHANNELS.IPC_BATCH_INVOKE, batchInvoke);
}

module.exports = {
  registerBatchInvokeHandlers,
};
