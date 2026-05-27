const { classifyErrorResponse } = require("../../shared/errorClassification");

function normalizeErrorMessage(error) {
  if (!error) {
    return "Unknown error";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message || String(error);
  }
  if (typeof error === "object") {
    if (error.message || error.error || error.reason || error.statusText) {
      return error.message || error.error || error.reason || error.statusText;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return "Unserializable error object";
    }
  }
  return String(error);
}

function pickErrorCode(error) {
  if (!error || typeof error !== "object") {
    return null;
  }
  return error.errorCode || error.code || error.error?.code || null;
}

function normalizeResponseOptions(options = {}) {
  if (typeof options === "string") {
    return { message: options };
  }
  if (options && typeof options === "object") {
    return options;
  }
  return {};
}

function buildErrorResponse(error, options = {}) {
  const normalizedOptions = normalizeResponseOptions(options);
  const source = error && typeof error === "object" ? error : {};
  const technicalMessage = normalizeErrorMessage(error);
  const message =
    typeof normalizedOptions.message === "string" &&
    normalizedOptions.message.trim()
      ? normalizedOptions.message.trim()
      : technicalMessage;
  const operation = normalizedOptions.operation || source.operation || null;
  const moduleName = normalizedOptions.module || source.module || null;
  const errorCode = pickErrorCode(source);
  const errorForClassification =
    error && typeof error === "object" ? source : technicalMessage;
  const classificationFields = classifyErrorResponse(errorForClassification, {
    ...(normalizedOptions.context || {}),
    module: moduleName,
    operation,
    type: normalizedOptions.type || source.type,
    message: technicalMessage,
    error: technicalMessage,
    errorCode,
    code: errorCode,
    errorKind: source.errorKind || normalizedOptions.errorKind || null,
    retryable:
      source.retryable === true || normalizedOptions.retryable === true,
  });

  return {
    success: false,
    error: message,
    message,
    technicalMessage,
    errorCode,
    code: errorCode,
    errorKind: source.errorKind || normalizedOptions.errorKind || null,
    module: moduleName,
    operation,
    raw: source.raw || null,
    ...classificationFields,
  };
}

function buildErrorEvent(error, options = {}) {
  const normalizedOptions = normalizeResponseOptions(options);
  const response = buildErrorResponse(error, normalizedOptions);
  return {
    type: normalizedOptions.type || "runtime-error",
    module: response.module,
    operation: response.operation,
    message: response.message,
    technicalMessage: response.technicalMessage,
    errorCode: response.errorCode,
    code: response.code,
    errorKind: response.errorKind,
    timestamp: normalizedOptions.timestamp || Date.now(),
    errorCategory: response.errorCategory,
    errorAction: response.errorAction,
    errorSeverity: response.errorSeverity,
    errorClassification: response.errorClassification,
    retryable: response.retryable,
    reportable: response.reportable,
    userRecoverable: response.userRecoverable,
    fatal: response.fatal,
  };
}

module.exports = {
  buildErrorEvent,
  buildErrorResponse,
  normalizeErrorMessage,
  normalizeResponseOptions,
};
