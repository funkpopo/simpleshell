const { logToFile } = require("../utils/logger");
const { ipcMain: electronIpcMain } = require("electron");
const { finishTrace, startTrace } = require("./ipcTrace");

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
  } catch {
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
  const { logPerformance = false, channelName, category } = options;
  return async (event, ...args) => {
    const start = Date.now();
    const trace = startTrace(channelName, args, { category });
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
      if (isStandardResponse(result)) {
        finishTrace(trace, {
          success: result.success !== false,
          error: result.error,
        });
        return result;
      }
      finishTrace(trace, { success: true });
      return result;
    } catch (err) {
      const message = serializeError(err);
      const ch = channelName || "<unknown>";
      logToFile(`Error in IPC handler ${ch}: ${message}`, "ERROR");
      finishTrace(trace, { success: false, error: message });
      return failure(message);
    }
  };
}

function safeHandle(
  ipcMainOrChannel,
  channelOrHandler,
  handlerOrOptions,
  options = {},
) {
  let ipcMain = ipcMainOrChannel;
  let channel = channelOrHandler;
  let handler = handlerOrOptions;

  // 兼容旧用法: safeHandle("channel", handler, options?)
  if (
    typeof ipcMainOrChannel === "string" &&
    typeof channelOrHandler === "function" &&
    (handlerOrOptions === undefined || typeof handlerOrOptions === "object")
  ) {
    channel = ipcMainOrChannel;
    handler = channelOrHandler;
    options = handlerOrOptions || options;
    ipcMain = electronIpcMain;
  }

  if (!ipcMain || typeof ipcMain.handle !== "function") {
    const errorMsg = `safeHandle: ipcMain is invalid or doesn't have 'handle' method for channel: ${channel}`;
    logToFile(errorMsg, "ERROR");
    throw new Error(errorMsg);
  }

  const wrapped = wrapIpcHandler(handler, { ...options, channelName: channel });
  ipcMain.handle(channel, wrapped);
}

module.exports = {
  success,
  failure,
  wrapIpcHandler,
  safeHandle,
};
