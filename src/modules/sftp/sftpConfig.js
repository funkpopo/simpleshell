/**
 * SFTP Engine Configuration
 * Centralized configuration for all SFTP operations including session management,
 * transfer parameters, timeouts, and performance tuning.
 */

// ========================================================================================
// SESSION MANAGEMENT CONFIGURATION
// ========================================================================================

const SESSION_CONFIG = {
  // Session pool limits
  MAX_SESSIONS_PER_TAB: 3, // 每个标签页的最大并发会话数
  MAX_TOTAL_SESSIONS: 50, // 所有标签页累计的最大会话数

  // Session lifecycle
  SESSION_IDLE_TIMEOUT: 600000, // 会话空闲超时时间 (10 分钟)
  HEALTH_CHECK_INTERVAL: 90000, // 健康检查间隔 (90 秒)
  HEALTH_CHECK_TIMEOUT: 5000, // 单次健康检查操作超时 (5 秒)
  QUICK_HEALTH_CHECK_TIMEOUT: 2000, // 快速健康检查超时 (2 秒)

  // Session creation
  SSH_READY_WAIT_TIMEOUT: 10000, // 等待SSH连接就绪的最大时间 (10 秒)
  SSH_READY_CHECK_INTERVAL: 100, // SSH就绪状态检查间隔 (100 毫秒)
  SESSION_CREATION_TIMEOUT: 172800000, // 会话创建操作超时 (48 小时, 用于慢速网络)
};

// ========================================================================================
// OPERATION TIMEOUT CONFIGURATION
// ========================================================================================

const TIMEOUT_CONFIG = {
  // Base operation timeouts
  BASE_OPERATION_TIMEOUT: 86400000, // 基础操作超时 (24 小时)
  LARGE_FILE_TIMEOUT: 86400000, // 大文件传输超时 (24 小时)
  LARGE_FILE_THRESHOLD: 100 * 1024 * 1024, // 大文件阈值 (100 MB)

  // No-progress watchdog timeouts (用于检测传输卡死)
  SMALL_FILE_NO_PROGRESS_TIMEOUT: 30000, // 小文件无进度超时 (30 秒)
  LARGE_FILE_NO_PROGRESS_TIMEOUT: 60000, // 大文件无进度超时 (60 秒)
  NO_PROGRESS_THRESHOLD: 100 * 1024 * 1024, // 判断大文件的阈值 (100 MB)
};

// ========================================================================================
// TRANSFER PERFORMANCE TUNING
// ========================================================================================

const TRANSFER_CONFIG = {
  // Concurrent file transfer limits
  PARALLEL_FILES_UPLOAD: 4, // 并发上传文件数
  PARALLEL_FILES_DOWNLOAD: 4, // 并发下载文件数

  // Dynamic concurrency adjustment thresholds
  SMALL_FILE_THRESHOLD: 10 * 1024 * 1024, // 小文件阈值 (10 MB)
  MEDIUM_FILE_THRESHOLD: 100 * 1024 * 1024, // 中等文件阈值 (100 MB)

  // Dynamic concurrency values
  HIGH_CONCURRENCY: 12, // 高并发度 (用于大量小文件)
  MEDIUM_CONCURRENCY: 4, // 中等并发度 (用于中等文件)
  LOW_CONCURRENCY: 2, // 低并发度 (用于大文件)

  // Stream chunk sizes (highWaterMark for fs/sftp streams)
  CHUNK_SIZE_SMALL: 256 * 1024, // 小文件块大小 (256 KB)
  CHUNK_SIZE_MEDIUM: 1024 * 1024, // 中等文件块大小 (1 MB)
  CHUNK_SIZE_LARGE: 2 * 1024 * 1024, // 大文件块大小 (2 MB)

  // Progress reporting
  PROGRESS_INTERVAL_MS: 100, // 进度上报节流间隔 (100 毫秒)

  // Transfer speed calculation
  SPEED_SMOOTHING_FACTOR: 0.3, // 速度平滑因子 (0-1,越小越平滑)
};

// ========================================================================================
// RETRY AND ERROR HANDLING
// ========================================================================================

const RETRY_CONFIG = {
  // Retry limits
  MAX_RETRIES: 2, // 操作失败后的最大重试次数
  MAX_OPERATION_ATTEMPTS: 3, // 单个传输操作的最大尝试次数 (initial + retries)

  // Backoff strategy
  RETRY_BASE_DELAY_MS: 1000, // 重试基础延迟 (1 秒)
  RETRY_BACKOFF_MULTIPLIER: 2, // 指数退避倍数

  // Retryable error patterns (小写,用于字符串匹配)
  RETRYABLE_ERRORS: [
    "timeout",
    "timed out",
    "disconnected",
    "reset",
    "econnreset",
    "eof",
    "socket hang up",
    "epipe",
    "no_progress_timeout",
    "channel closed",
    "sftp stream closed",
    "connection lost",
    "无法连接到远程主机",
    "ssh连接已关闭",
    "operation has been aborted",
  ],

  // Session recovery error patterns
  SESSION_ERRORS: [
    "econnreset",
    "eof",
    "connection lost",
    "socket hang up",
    "ssh connection closed",
    "sftp stream closed",
    "no response from server",
    "connection timed out",
    "disconnected",
    "channel closed",
    "not connected",
  ],
};

// ========================================================================================
// OPERATION QUEUE CONFIGURATION
// ========================================================================================

const QUEUE_CONFIG = {
  // Priority values (higher = more important)
  PRIORITY_HIGH: 10,
  PRIORITY_NORMAL: 5,
  PRIORITY_LOW: 1,
};

// ========================================================================================
// HELPER FUNCTIONS
// ========================================================================================

/**
 * 根据文件大小动态选择合适的块大小
 * @param {number} totalBytes - 文件总大小(字节)
 * @returns {number} - 推荐的块大小(字节)
 */
function chooseChunkSize(totalBytes) {
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    return TRANSFER_CONFIG.CHUNK_SIZE_MEDIUM;
  }

  if (totalBytes <= TRANSFER_CONFIG.SMALL_FILE_THRESHOLD) {
    return TRANSFER_CONFIG.CHUNK_SIZE_SMALL;
  }

  if (totalBytes <= TRANSFER_CONFIG.MEDIUM_FILE_THRESHOLD) {
    return TRANSFER_CONFIG.CHUNK_SIZE_MEDIUM;
  }

  return TRANSFER_CONFIG.CHUNK_SIZE_LARGE;
}

/**
 * 根据文件大小动态计算超时时间
 * @param {number} fileSize - 文件大小(字节)
 * @param {number} [baseTimeout] - 基础超时时间(毫秒)
 * @returns {number} - 计算后的超时时间(毫秒)
 */
function calculateDynamicTimeout(fileSize, baseTimeout = TIMEOUT_CONFIG.BASE_OPERATION_TIMEOUT) {
  if (!fileSize || fileSize <= 0) {
    return baseTimeout;
  }

  // 大文件使用更长的超时时间
  if (fileSize >= TIMEOUT_CONFIG.LARGE_FILE_THRESHOLD) {
    return TIMEOUT_CONFIG.LARGE_FILE_TIMEOUT;
  }

  // 中等文件按传输速度动态调整
  // 假设传输速度为 1MB/s,给 3 倍缓冲时间
  const estimatedTransferTime = (fileSize / (1024 * 1024)) * 1000; // 毫秒
  const dynamicTimeout = Math.max(baseTimeout, estimatedTransferTime * 3);

  // 限制最大超时时间
  return Math.min(dynamicTimeout, TIMEOUT_CONFIG.LARGE_FILE_TIMEOUT);
}

/**
 * 根据文件大小选择无进度超时时间
 * @param {number} fileSize - 文件大小(字节)
 * @returns {number} - 无进度超时时间(毫秒)
 */
function getNoProgressTimeout(fileSize) {
  if (!fileSize || fileSize <= TIMEOUT_CONFIG.NO_PROGRESS_THRESHOLD) {
    return TIMEOUT_CONFIG.SMALL_FILE_NO_PROGRESS_TIMEOUT;
  }
  return TIMEOUT_CONFIG.LARGE_FILE_NO_PROGRESS_TIMEOUT;
}

/**
 * 根据文件数量和平均大小动态调整并发度
 * @param {number} totalFiles - 文件总数
 * @param {number} totalBytes - 总字节数
 * @param {boolean} [isUpload=true] - 是否为上传操作
 * @returns {number} - 推荐的并发度
 */
function chooseConcurrency(totalFiles, totalBytes, isUpload = true) {
  const avgFileSize = totalFiles > 0 ? Math.floor(totalBytes / totalFiles) : 0;
  const baseConcurrency = isUpload
    ? TRANSFER_CONFIG.PARALLEL_FILES_UPLOAD
    : TRANSFER_CONFIG.PARALLEL_FILES_DOWNLOAD;

  // 大量小文件:提高并发
  if (totalFiles >= 8 && avgFileSize <= TRANSFER_CONFIG.SMALL_FILE_THRESHOLD) {
    return Math.min(TRANSFER_CONFIG.HIGH_CONCURRENCY, totalFiles);
  }

  // 巨大文件:降低并发
  if (avgFileSize > TRANSFER_CONFIG.MEDIUM_FILE_THRESHOLD) {
    return Math.min(TRANSFER_CONFIG.LOW_CONCURRENCY, totalFiles);
  }

  // 中等文件:使用默认并发
  if (avgFileSize > TRANSFER_CONFIG.SMALL_FILE_THRESHOLD) {
    return Math.min(TRANSFER_CONFIG.MEDIUM_CONCURRENCY, totalFiles);
  }

  return Math.min(baseConcurrency, totalFiles);
}

/**
 * 计算重试延迟(指数退避)
 * @param {number} attempt - 当前尝试次数 (1-based)
 * @returns {number} - 延迟时间(毫秒)
 */
function calculateRetryDelay(attempt) {
  const base = RETRY_CONFIG.RETRY_BASE_DELAY_MS;
  const multiplier = RETRY_CONFIG.RETRY_BACKOFF_MULTIPLIER;
  return base * Math.pow(multiplier, Math.max(0, attempt - 1));
}

/**
 * 检查错误是否可重试
 * @param {Error} error - 错误对象
 * @returns {boolean} - 是否可重试
 */
function isRetryableError(error) {
  if (!error || !error.message) return false;

  const message = error.message.toLowerCase();
  return RETRY_CONFIG.RETRYABLE_ERRORS.some(pattern =>
    message.includes(pattern.toLowerCase())
  );
}

/**
 * 检查是否为会话相关错误(需要重新建立会话)
 * @param {Error} error - 错误对象
 * @returns {boolean} - 是否为会话错误
 */
function isSessionError(error) {
  if (!error || !error.message) return false;

  const message = error.message.toLowerCase();
  return RETRY_CONFIG.SESSION_ERRORS.some(pattern =>
    message.includes(pattern.toLowerCase())
  );
}

/**
 * 解析优先级字符串到数值
 * @param {string} priority - 优先级字符串 ('high'|'normal'|'low')
 * @returns {number} - 优先级数值
 */
function parsePriority(priority) {
  switch (priority) {
    case "high":
      return QUEUE_CONFIG.PRIORITY_HIGH;
    case "low":
      return QUEUE_CONFIG.PRIORITY_LOW;
    default:
      return QUEUE_CONFIG.PRIORITY_NORMAL;
  }
}

// ========================================================================================
// EXPORTS
// ========================================================================================

module.exports = {
  // Configuration objects
  SESSION_CONFIG,
  TIMEOUT_CONFIG,
  TRANSFER_CONFIG,
  RETRY_CONFIG,
  QUEUE_CONFIG,

  // Helper functions
  chooseChunkSize,
  calculateDynamicTimeout,
  getNoProgressTimeout,
  chooseConcurrency,
  calculateRetryDelay,
  isRetryableError,
  isSessionError,
  parsePriority,
};
