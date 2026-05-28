const { logToFile } = require("../utils/logger");
const { finishTrace, startTrace } = require("./ipcTrace");
const {
  buildErrorResponse,
  normalizeErrorMessage,
} = require("../utils/errorResponse");
const {
  getEventChannelDefinition,
  getRequestChannelDefinition,
} = require("./schema/channels");
const { validateSchema } = require("./schema/validator");

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
  const {
    logPerformance = false,
    channelName,
    category,
    channelDefinition = null,
  } = options;
  return async (event, ...args) => {
    const start = Date.now();
    const trace = startTrace(channelName, args, { category });
    try {
      if (channelDefinition?.requestSchema) {
        const validation = validateSchema(channelDefinition.requestSchema, args);
        if (!validation.valid) {
          const message = `Invalid IPC request payload for ${channelName}: ${validation.error}`;
          logToFile(message, "WARN");
          finishTrace(trace, { success: false, error: message });
          return buildErrorResponse(new Error(message), {
            module: category || channelDefinition.category || "ipc",
            operation: channelName,
          });
        }
      }

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
        if (channelDefinition?.responseSchema) {
          const validation = validateSchema(
            channelDefinition.responseSchema,
            normalizedResult,
          );
          if (!validation.valid) {
            const message = `Invalid IPC response payload for ${channelName}: ${validation.error}`;
            logToFile(message, "ERROR");
            finishTrace(trace, { success: false, error: message });
            return buildErrorResponse(new Error(message), {
              module: category || channelDefinition.category || "ipc",
              operation: channelName,
            });
          }
        }
        finishTrace(trace, {
          success: normalizedResult.success !== false,
          error: normalizedResult.error,
        });
        return normalizedResult;
      }
      if (channelDefinition?.responseSchema) {
        const validation = validateSchema(channelDefinition.responseSchema, result);
        if (!validation.valid) {
          const message = `Invalid IPC response payload for ${channelName}: ${validation.error}`;
          logToFile(message, "ERROR");
          finishTrace(trace, { success: false, error: message });
          return buildErrorResponse(new Error(message), {
            module: category || channelDefinition.category || "ipc",
            operation: channelName,
          });
        }
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

function safeHandle(ipcMain, channel, handler, options = {}) {
  if (!ipcMain || typeof ipcMain.handle !== "function") {
    const errorMsg = `safeHandle: ipcMain is invalid or doesn't have 'handle' method for channel: ${channel}`;
    logToFile(errorMsg, "ERROR");
    throw new Error(errorMsg);
  }

  if (typeof channel !== "string" || channel.trim() === "") {
    const errorMsg = "safeHandle: channel must be a declared IPC channel string";
    logToFile(errorMsg, "ERROR");
    throw new Error(errorMsg);
  }

  if (typeof handler !== "function") {
    const errorMsg = `safeHandle: handler must be a function for channel: ${channel}`;
    logToFile(errorMsg, "ERROR");
    throw new Error(errorMsg);
  }

  const channelDefinition = getRequestChannelDefinition(channel);
  if (!channelDefinition) {
    const errorMsg = `safeHandle: undeclared IPC request channel: ${channel}`;
    logToFile(errorMsg, "ERROR");
    throw new Error(errorMsg);
  }

  const wrapped = wrapIpcHandler(handler, {
    ...options,
    channelName: channel,
    category: options.category || channelDefinition?.category,
    channelDefinition,
  });
  ipcMain.handle(channel, wrapped);
}

function safeOn(ipcMain, channel, handler, options = {}) {
  if (!ipcMain || typeof ipcMain.on !== "function") {
    const errorMsg = `safeOn: ipcMain is invalid or doesn't have 'on' method for channel: ${channel}`;
    logToFile(errorMsg, "ERROR");
    throw new Error(errorMsg);
  }

  if (typeof channel !== "string" || channel.trim() === "") {
    const errorMsg = "safeOn: channel must be a declared IPC channel string";
    logToFile(errorMsg, "ERROR");
    throw new Error(errorMsg);
  }

  if (typeof handler !== "function") {
    const errorMsg = `safeOn: handler must be a function for channel: ${channel}`;
    logToFile(errorMsg, "ERROR");
    throw new Error(errorMsg);
  }

  const channelDefinition = getEventChannelDefinition(channel);
  if (!channelDefinition) {
    const errorMsg = `safeOn: undeclared IPC event channel: ${channel}`;
    logToFile(errorMsg, "ERROR");
    throw new Error(errorMsg);
  }

  const wrapped = (event, ...args) => {
    if (channelDefinition?.payloadSchema) {
      const validation = validateSchema(channelDefinition.payloadSchema, args);
      if (!validation.valid) {
        logToFile(
          `Invalid IPC event payload for ${channel}: ${validation.error}`,
          "WARN",
        );
        return;
      }
    }

    return handler(event, ...args);
  };

  ipcMain.on(channel, wrapped);
  return wrapped;
}

module.exports = {
  success,
  failure,
  wrapIpcHandler,
  safeOn,
  safeHandle,
};
