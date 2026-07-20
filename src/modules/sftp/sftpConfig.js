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
  MAX_SESSIONS_PER_TAB: 8, // 每个标签页的最大并发会话数（匹配并发下载数）
  MAX_TOTAL_SESSIONS: 50, // 所有标签页累计的最大会话数

  // Session lifecycle
  SESSION_IDLE_TIMEOUT: 600000, // 会话空闲超时时间 (10 分钟)
  HEALTH_CHECK_INTERVAL: 90000, // 健康检查间隔 (90 秒)
  HEALTH_CHECK_TIMEOUT: 5000, // 单次健康检查操作超时 (5 秒)
  QUICK_HEALTH_CHECK_TIMEOUT: 2000, // 快速健康检查超时 (2 秒)

  // Session creation
  SSH_READY_WAIT_TIMEOUT: 30000, // 等待SSH连接就绪的最大时间 (30 秒)
  SSH_READY_CHECK_INTERVAL: 100, // SSH就绪状态检查间隔 (100 毫秒)
  SESSION_CREATION_TIMEOUT: 172800000, // 会话创建操作超时 (48 小时, 用于慢速网络)
};

// ========================================================================================
// TRANSFER PERFORMANCE TUNING
// ========================================================================================

const TRANSFER_CONFIG = {
  // Concurrent file transfer limits
  PARALLEL_FILES_UPLOAD: 4, // 并发上传文件数
  PARALLEL_FILES_DOWNLOAD: 6, // 并发下载文件数

  // Dynamic concurrency adjustment thresholds
  SMALL_FILE_THRESHOLD: 10 * 1024 * 1024, // 小文件阈值 (10 MB)
  MEDIUM_FILE_THRESHOLD: 100 * 1024 * 1024, // 中等文件阈值 (100 MB)

  // Dynamic concurrency values
  HIGH_CONCURRENCY: 12, // 高并发度 (用于大量小文件)
  MEDIUM_CONCURRENCY: 4, // 中等并发度 (用于中等文件)
  LOW_CONCURRENCY: 2, // 低并发度 (用于大文件)

  // Stream chunk sizes (highWaterMark for fs/sftp streams)
  CHUNK_SIZE_SMALL: 512 * 1024, // 小文件块大小 (512 KB)
  CHUNK_SIZE_MEDIUM: 2 * 1024 * 1024, // 中等文件块大小 (2 MB)
  CHUNK_SIZE_LARGE: 4 * 1024 * 1024, // 大文件块大小 (4 MB)

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
    "channel open failure",
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
    "channel open failure",
    "not connected",
  ],
};

// ========================================================================================
// HELPER FUNCTIONS
// ========================================================================================

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

// ========================================================================================
// EXPORTS
// ========================================================================================

module.exports = {
  // Configuration objects
  SESSION_CONFIG,
  TRANSFER_CONFIG,

  // Helper functions
  calculateRetryDelay,
};
