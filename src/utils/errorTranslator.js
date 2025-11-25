/**
 * 用户友好的错误翻译器
 * 将技术性错误信息转换为易于理解的用户友好提示
 * 支持 i18n 国际化
 */

import i18n from '../i18n/i18n';

/**
 * 错误类型定义
 */
export const ErrorType = {
  // 网络连接错误
  CONNECTION_REFUSED: 'ECONNREFUSED',
  CONNECTION_TIMEOUT: 'ETIMEDOUT',
  HOST_UNREACHABLE: 'EHOSTUNREACH',
  HOST_NOT_FOUND: 'ENOTFOUND',
  CONNECTION_RESET: 'ECONNRESET',
  NETWORK_UNREACHABLE: 'ENETUNREACH',

  // SSH认证错误
  AUTH_FAILED: 'AUTH_FAILED',
  KEY_ERROR: 'KEY_ERROR',

  // 其他错误
  PERMISSION_DENIED: 'EACCES',
  FILE_NOT_FOUND: 'ENOENT',
  OPERATION_TIMEOUT: 'OPERATION_TIMEOUT'
};

/**
 * 错误信息映射键名(用于i18n)
 */
const errorI18nKeys = {
  [ErrorType.CONNECTION_REFUSED]: 'errors.ECONNREFUSED',
  [ErrorType.CONNECTION_TIMEOUT]: 'errors.ETIMEDOUT',
  [ErrorType.HOST_UNREACHABLE]: 'errors.EHOSTUNREACH',
  [ErrorType.HOST_NOT_FOUND]: 'errors.ENOTFOUND',
  [ErrorType.CONNECTION_RESET]: 'errors.ECONNRESET',
  [ErrorType.NETWORK_UNREACHABLE]: 'errors.ENETUNREACH',
  [ErrorType.AUTH_FAILED]: 'errors.AUTH_FAILED',
  [ErrorType.KEY_ERROR]: 'errors.KEY_ERROR',
  [ErrorType.PERMISSION_DENIED]: 'errors.EACCES',
  [ErrorType.FILE_NOT_FOUND]: 'errors.ENOENT',
  [ErrorType.OPERATION_TIMEOUT]: 'errors.OPERATION_TIMEOUT'
};

/**
 * 检测错误类型
 * @param {Error|string} error - 错误对象或错误消息
 * @returns {string|null} - 错误类型或null
 */
export function detectErrorType(error) {
  const errorMessage = typeof error === 'string' ? error : (error?.message || error?.code || '');
  const errorCode = typeof error === 'object' ? error?.code : null;
  const lowerMessage = errorMessage.toLowerCase();

  // 优先检查错误代码
  if (errorCode) {
    if (Object.values(ErrorType).includes(errorCode)) {
      return errorCode;
    }
  }

  // 检查消息内容
  if (lowerMessage.includes('econnrefused') || lowerMessage.includes('connection refused')) {
    return ErrorType.CONNECTION_REFUSED;
  }
  if (lowerMessage.includes('etimedout') || lowerMessage.includes('timed out')) {
    return ErrorType.CONNECTION_TIMEOUT;
  }
  if (lowerMessage.includes('ehostunreach') || lowerMessage.includes('host unreachable')) {
    return ErrorType.HOST_UNREACHABLE;
  }
  if (lowerMessage.includes('enotfound') || lowerMessage.includes('getaddrinfo')) {
    return ErrorType.HOST_NOT_FOUND;
  }
  if (lowerMessage.includes('econnreset') || lowerMessage.includes('connection reset')) {
    return ErrorType.CONNECTION_RESET;
  }
  if (lowerMessage.includes('enetunreach') || lowerMessage.includes('network unreachable')) {
    return ErrorType.NETWORK_UNREACHABLE;
  }
  if (lowerMessage.includes('authentication failed') || lowerMessage.includes('auth fail')) {
    return ErrorType.AUTH_FAILED;
  }
  if (lowerMessage.includes('key') && (lowerMessage.includes('invalid') || lowerMessage.includes('error'))) {
    return ErrorType.KEY_ERROR;
  }
  if (lowerMessage.includes('eacces') || lowerMessage.includes('permission denied')) {
    return ErrorType.PERMISSION_DENIED;
  }
  if (lowerMessage.includes('enoent') || lowerMessage.includes('no such file')) {
    return ErrorType.FILE_NOT_FOUND;
  }
  if (lowerMessage.includes('timeout') && !lowerMessage.includes('etimedout')) {
    return ErrorType.OPERATION_TIMEOUT;
  }

  return null;
}

/**
 * 翻译错误信息为用户友好的格式
 * @param {Error|string} error - 错误对象或错误消息
 * @returns {Object} - 翻译后的错误信息对象
 */
export function translateError(error) {
  const errorType = detectErrorType(error);
  const originalMessage = typeof error === 'string' ? error : (error?.message || '未知错误');

  if (errorType && errorI18nKeys[errorType]) {
    const i18nKey = errorI18nKeys[errorType];

    return {
      title: i18n.t(`${i18nKey}.title`),
      message: i18n.t(`${i18nKey}.message`),
      solutions: i18n.t(`${i18nKey}.solutions`, { returnObjects: true }),
      action: i18n.t(`${i18nKey}.action`),
      severity: i18n.t(`${i18nKey}.severity`),
      originalError: originalMessage,
      errorType
    };
  }

  // 如果无法识别错误类型，返回通用格式
  return {
    title: i18n.t('errors.UNKNOWN.title'),
    message: originalMessage,
    solutions: i18n.t('errors.UNKNOWN.solutions', { returnObjects: true }),
    action: i18n.t('errors.UNKNOWN.action'),
    severity: 'error',
    originalError: originalMessage,
    errorType: 'UNKNOWN'
  };
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
