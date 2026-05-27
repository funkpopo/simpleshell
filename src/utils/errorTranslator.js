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

/**
 * 错误信息映射键名(用于i18n)
 */
const errorI18nKeys = {
  [ErrorType.CONNECTION_REFUSED]: "errors.ECONNREFUSED",
  [ErrorType.CONNECTION_TIMEOUT]: "errors.ETIMEDOUT",
  [ErrorType.HOST_UNREACHABLE]: "errors.EHOSTUNREACH",
  [ErrorType.HOST_NOT_FOUND]: "errors.ENOTFOUND",
  [ErrorType.CONNECTION_RESET]: "errors.ECONNRESET",
  [ErrorType.NETWORK_UNREACHABLE]: "errors.ENETUNREACH",
  [ErrorType.AUTH_FAILED]: "errors.AUTH_FAILED",
  [ErrorType.KEY_ERROR]: "errors.KEY_ERROR",
  [ErrorType.PERMISSION_DENIED]: "errors.EACCES",
  [ErrorType.FILE_NOT_FOUND]: "errors.ENOENT",
  [ErrorType.OPERATION_TIMEOUT]: "errors.OPERATION_TIMEOUT",
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
    label: i18n.t(`errors.classification.${category}`),
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
  const baseKey = `errors.classified.${category}`;

  return {
    title: i18n.t(`${baseKey}.title`),
    message: i18n.t(`${baseKey}.message`, {
      message: originalMessage,
      code: classification.code || "",
    }),
    solutions: i18n.t(`${baseKey}.solutions`, { returnObjects: true }),
    action: i18n.t(`${baseKey}.action`),
    severity: classification.severity || "error",
    originalError: originalMessage,
    errorType: classification.code || "UNKNOWN",
    classification,
  };
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

  if (errorType && errorI18nKeys[errorType]) {
    const i18nKey = errorI18nKeys[errorType];

    return {
      title: i18n.t(`${i18nKey}.title`),
      message: i18n.t(`${i18nKey}.message`),
      solutions: i18n.t(`${i18nKey}.solutions`, { returnObjects: true }),
      action: i18n.t(`${i18nKey}.action`),
      severity: classification.severity,
      originalError: originalMessage,
      errorType,
      classification,
    };
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
