const { logToFile } = require("../utils/logger");

function isStandardResponse(result) {
  return result && typeof result === "object" && "success" in result;
}

function serializeError(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || String(error);
  if (typeof error === "object") return error.message || JSON.stringify(error);
  try {
    return String(error);
  } catch (_) {
    return "Unknown error";
  }
}

function success(data) {
  return { success: true, data };
}

function failure(error) {
  return { success: false, error: serializeError(error) };
}

function wrapIpcHandler(handler, options = {}) {
  const { logPerformance = false, channelName } = options;
  return async (event, ...args) => {
    const start = Date.now();
    try {
      const result = await handler(event, ...args);
      if (logPerformance) {
        const duration = Date.now() - start;
        if (duration > 100) {
          logToFile(
            `IPC ${channelName || "<unknown>"} took ${duration}ms`,
            "WARN",
          );
        }
      }
      // Pass-through if already standardized. Otherwise, preserve existing shape.
      if (isStandardResponse(result)) return result;
      return result;
    } catch (err) {
      const message = serializeError(err);
      const ch = channelName || "<unknown>";
      logToFile(`Error in IPC handler ${ch}: ${message}`, "ERROR");
      return failure(message);
    }
  };
}

function safeHandle(ipcMain, channel, handler, options = {}) {
  const wrapped = wrapIpcHandler(handler, { ...options, channelName: channel });
  ipcMain.handle(channel, wrapped);
}

module.exports = {
  success,
  failure,
  wrapIpcHandler,
  safeHandle,
};

