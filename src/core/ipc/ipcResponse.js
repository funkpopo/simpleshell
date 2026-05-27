const { logToFile } = require("../utils/logger");
const { ipcMain: electronIpcMain } = require("electron");
const { finishTrace, startTrace } = require("./ipcTrace");
const {
  buildErrorResponse,
  normalizeErrorMessage,
} = require("../utils/errorResponse");

function isStandardResponse(result) {
  return result && typeof result === "object" && "success" in result;
}

function serializeError(error) {
  return normalizeErrorMessage(error);
}

function success(data) {
  return { success: true, data };
}

function failure(error) {
  return buildErrorResponse(error);
}

function normalizeFailureResponse(result, options = {}) {
  if (!isStandardResponse(result) || result.success !== false) {
    return result;
  }

  if (result.errorClassification && result.errorCategory) {
    return result;
  }

  return {
    ...result,
    ...buildErrorResponse(result, {
      message: result.message || result.error,
      module: result.module || options.category || null,
      operation: result.operation || options.channelName || null,
    }),
  };
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
        const normalizedResult = normalizeFailureResponse(result, {
          channelName,
          category,
        });
        finishTrace(trace, {
          success: normalizedResult.success !== false,
          error: normalizedResult.error,
        });
        return normalizedResult;
      }
      finishTrace(trace, { success: true });
      return result;
    } catch (err) {
      const message = serializeError(err);
      const ch = channelName || "<unknown>";
      logToFile(`Error in IPC handler ${ch}: ${message}`, "ERROR");
      finishTrace(trace, { success: false, error: message });
      return buildErrorResponse(err, {
        module: category || "ipc",
        operation: ch,
      });
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
