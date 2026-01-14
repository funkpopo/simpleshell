const fs = require("fs");
const sftpCore = require("../../transfer/sftp-engine");
const { logToFile } = require("../../utils/logger");

const MAX_CALLS_PER_BATCH = 100;

function isStandardResponse(obj) {
  return obj && typeof obj === "object" && typeof obj.success === "boolean";
}

function normalizeResult(raw) {
  if (!isStandardResponse(raw)) {
    return { success: true, data: raw };
  }
  if (raw.success === false) {
    return { success: false, error: raw.error || "Operation failed" };
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
      if (channel === "getFilePermissions") {
        const [tabId, filePath] = args;
        const raw = await sftpCore.getFilePermissions(tabId, filePath);
        results.push(normalizeResult(raw));
        continue;
      }

      if (channel === "checkPathExists") {
        const [checkPath] = args;
        const exists = fs.existsSync(checkPath);
        results.push({ success: true, data: { exists } });
        continue;
      }

      results.push({ success: false, error: `Channel not allowed: ${channel}` });
    } catch (error) {
      logToFile(
        `ipc:batchInvoke failed for ${channel}: ${error?.message || String(error)}`,
        "ERROR",
      );
      results.push({
        success: false,
        error: error?.message || String(error),
      });
    }
  }

  return results;
}

function registerBatchInvokeHandlers(ipcMain, safeHandle) {
  safeHandle(ipcMain, "ipc:batchInvoke", batchInvoke);
}

module.exports = {
  registerBatchInvokeHandlers,
};

