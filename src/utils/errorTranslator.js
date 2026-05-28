/**
 * 用户友好的错误翻译器
 * 将技术性错误信息转换为易于理解的用户友好提示
 * 支持 i18n 国际化
 */

import i18n from "../i18n/i18n";
import errorClassification from "../shared/errorClassification";

const {
  ERROR_NOTIFICATION_LEVELS,
  ERROR_TYPES: SharedErrorTypes,
  classifyError,
  detectErrorType: detectSharedErrorType,
} = errorClassification;

/**
 * 错误类型定义
 */
export const ErrorType = SharedErrorTypes;

const getClassificationLabel = (category) => {
  switch (category) {
    case ERROR_NOTIFICATION_LEVELS.RECOVERABLE:
      return i18n.t("errors.classification.recoverable");
    case ERROR_NOTIFICATION_LEVELS.RETRY:
      return i18n.t("errors.classification.retry");
    case ERROR_NOTIFICATION_LEVELS.FATAL:
      return i18n.t("errors.classification.fatal");
    case ERROR_NOTIFICATION_LEVELS.FEEDBACK:
    default:
      return i18n.t("errors.classification.feedback");
  }
};

/**
 * 检测错误类型
 * @param {Error|string} error - 错误对象或错误消息
 * @returns {string|null} - 错误类型或null
 */
export function detectErrorType(error) {
  return detectSharedErrorType(error);
}

export function classifyErrorForNotification(error) {
  const explicit =
    typeof error === "object" && error?.errorClassification
      ? error.errorClassification
      : null;
  const classification = explicit || classifyError(error);
  const category =
    classification.category || ERROR_NOTIFICATION_LEVELS.FEEDBACK;

  return {
    ...classification,
    category,
    label: getClassificationLabel(category),
    severity: classification.severity || "error",
    persistent: classification.persistent === true,
    showFeedback: classification.showFeedback === true,
    showDiagnostics: classification.showDiagnostics === true,
  };
}

function getClassifiedErrorTranslation(error, classification) {
  const category =
    classification.category || ERROR_NOTIFICATION_LEVELS.FEEDBACK;
  const originalMessage =
    typeof error === "string"
      ? error
      : error?.message || error?.error || error?.reason || "Unknown error";

  const base = {
    severity: classification.severity || "error",
    originalError: originalMessage,
    errorType: classification.code || "UNKNOWN",
    classification,
  };

  switch (category) {
    case ERROR_NOTIFICATION_LEVELS.RECOVERABLE:
      return {
        ...base,
        title: i18n.t("errors.classified.recoverable.title"),
        message: i18n.t("errors.classified.recoverable.message", {
          message: originalMessage,
          code: classification.code || "",
        }),
        solutions: i18n.t("errors.classified.recoverable.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.classified.recoverable.action"),
      };
    case ERROR_NOTIFICATION_LEVELS.RETRY:
      return {
        ...base,
        title: i18n.t("errors.classified.retry.title"),
        message: i18n.t("errors.classified.retry.message", {
          message: originalMessage,
          code: classification.code || "",
        }),
        solutions: i18n.t("errors.classified.retry.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.classified.retry.action"),
      };
    case ERROR_NOTIFICATION_LEVELS.FATAL:
      return {
        ...base,
        title: i18n.t("errors.classified.fatal.title"),
        message: i18n.t("errors.classified.fatal.message", {
          message: originalMessage,
          code: classification.code || "",
        }),
        solutions: i18n.t("errors.classified.fatal.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.classified.fatal.action"),
      };
    case ERROR_NOTIFICATION_LEVELS.FEEDBACK:
    default:
      return {
        ...base,
        title: i18n.t("errors.classified.feedback.title"),
        message: i18n.t("errors.classified.feedback.message", {
          message: originalMessage,
          code: classification.code || "",
        }),
        solutions: i18n.t("errors.classified.feedback.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.classified.feedback.action"),
      };
  }
}

function getKnownErrorTranslation(errorType, originalMessage, classification) {
  const base = {
    severity: classification.severity,
    originalError: originalMessage,
    errorType,
    classification,
  };

  switch (errorType) {
    case ErrorType.CONNECTION_REFUSED:
      return {
        ...base,
        title: i18n.t("errors.ECONNREFUSED.title"),
        message: i18n.t("errors.ECONNREFUSED.message"),
        solutions: i18n.t("errors.ECONNREFUSED.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.ECONNREFUSED.action"),
      };
    case ErrorType.CONNECTION_TIMEOUT:
      return {
        ...base,
        title: i18n.t("errors.ETIMEDOUT.title"),
        message: i18n.t("errors.ETIMEDOUT.message"),
        solutions: i18n.t("errors.ETIMEDOUT.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.ETIMEDOUT.action"),
      };
    case ErrorType.HOST_UNREACHABLE:
      return {
        ...base,
        title: i18n.t("errors.EHOSTUNREACH.title"),
        message: i18n.t("errors.EHOSTUNREACH.message"),
        solutions: i18n.t("errors.EHOSTUNREACH.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.EHOSTUNREACH.action"),
      };
    case ErrorType.HOST_NOT_FOUND:
      return {
        ...base,
        title: i18n.t("errors.ENOTFOUND.title"),
        message: i18n.t("errors.ENOTFOUND.message"),
        solutions: i18n.t("errors.ENOTFOUND.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.ENOTFOUND.action"),
      };
    case ErrorType.CONNECTION_RESET:
      return {
        ...base,
        title: i18n.t("errors.ECONNRESET.title"),
        message: i18n.t("errors.ECONNRESET.message"),
        solutions: i18n.t("errors.ECONNRESET.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.ECONNRESET.action"),
      };
    case ErrorType.NETWORK_UNREACHABLE:
      return {
        ...base,
        title: i18n.t("errors.ENETUNREACH.title"),
        message: i18n.t("errors.ENETUNREACH.message"),
        solutions: i18n.t("errors.ENETUNREACH.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.ENETUNREACH.action"),
      };
    case ErrorType.AUTH_FAILED:
      return {
        ...base,
        title: i18n.t("errors.AUTH_FAILED.title"),
        message: i18n.t("errors.AUTH_FAILED.message"),
        solutions: i18n.t("errors.AUTH_FAILED.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.AUTH_FAILED.action"),
      };
    case ErrorType.KEY_ERROR:
      return {
        ...base,
        title: i18n.t("errors.KEY_ERROR.title"),
        message: i18n.t("errors.KEY_ERROR.message"),
        solutions: i18n.t("errors.KEY_ERROR.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.KEY_ERROR.action"),
      };
    case ErrorType.PERMISSION_DENIED:
      return {
        ...base,
        title: i18n.t("errors.EACCES.title"),
        message: i18n.t("errors.EACCES.message"),
        solutions: i18n.t("errors.EACCES.solutions", { returnObjects: true }),
        action: i18n.t("errors.EACCES.action"),
      };
    case ErrorType.FILE_NOT_FOUND:
      return {
        ...base,
        title: i18n.t("errors.ENOENT.title"),
        message: i18n.t("errors.ENOENT.message"),
        solutions: i18n.t("errors.ENOENT.solutions", { returnObjects: true }),
        action: i18n.t("errors.ENOENT.action"),
      };
    case ErrorType.OPERATION_TIMEOUT:
      return {
        ...base,
        title: i18n.t("errors.OPERATION_TIMEOUT.title"),
        message: i18n.t("errors.OPERATION_TIMEOUT.message"),
        solutions: i18n.t("errors.OPERATION_TIMEOUT.solutions", {
          returnObjects: true,
        }),
        action: i18n.t("errors.OPERATION_TIMEOUT.action"),
      };
    default:
      return null;
  }
}

/**
 * 翻译错误信息为用户友好的格式
 * @param {Error|string} error - 错误对象或错误消息
 * @returns {Object} - 翻译后的错误信息对象
 */
export function translateError(error) {
  const errorType = detectErrorType(error);
  const classification = classifyErrorForNotification(error);
  const originalMessage =
    typeof error === "string"
      ? error
      : error?.message || error?.error || "未知错误";

  if (errorType) {
    const knownError = getKnownErrorTranslation(
      errorType,
      originalMessage,
      classification,
    );
    if (knownError) {
      return knownError;
    }
  }

  return getClassifiedErrorTranslation(error, classification);
}

/**
 * 获取简短的错误提示
 * @param {Error|string} error - 错误对象或错误消息
 * @returns {string} - 简短的错误提示
 */
export function getErrorSummary(error) {
  const translated = translateError(error);
  return translated.title;
}

/**
 * 获取错误的详细建议
 * @param {Error|string} error - 错误对象或错误消息
 * @returns {Array<string>} - 解决方案数组
 */
export function getErrorSolutions(error) {
  const translated = translateError(error);
  return translated.solutions;
}
