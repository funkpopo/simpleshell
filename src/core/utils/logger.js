const path = require("path");
const fs = require("fs");

let logFile = null; // Will be set by initLogger
let appInstance = null;

// 初始化日志模块，必须在 app 'ready' 后调用
function initLogger(electronApp) {
  appInstance = electronApp;
  try {
    const logDir = appInstance.getPath("logs");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    logFile = path.join(logDir, "app.log");
    // 写入一条初始化成功的日志，以便确认路径设置正确
    logToFileInternal("Logger initialized. Log path: " + logFile, "INFO", true);
  } catch (error) {
    console.error(
      "Failed to initialize logger or create log directory:",
      error,
    );
    // 如果初始化失败，尝试回退到原先的基于 __dirname 的路径，但这在打包后可能不准确
    try {
      const fallbackLogDir = path.join(__dirname, "..", "..", "..", "logs"); //  假设 logger.js 在 src/core/utils
      if (!fs.existsSync(fallbackLogDir)) {
        fs.mkdirSync(fallbackLogDir, { recursive: true });
      }
      logFile = path.join(fallbackLogDir, "app_fallback.log");
      logToFileInternal(
        "Logger initialized with fallback path: " + logFile,
        "WARN",
        true,
      );
    } catch (fallbackError) {
      console.error(
        "Failed to initialize logger with fallback path:",
        fallbackError,
      );
      logFile = "app_emergency.log"; // 最终回退，直接在工作目录下
      logToFileInternal(
        "Logger initialized with emergency path in current working directory: " +
          logFile,
        "ERROR",
        true,
      );
    }
  }
}

// 内部日志函数，允许在 initLogger 自身中使用，避免循环依赖或在 logFile 未设置时出错
function logToFileInternal(message, type = "INFO", isInitialization = false) {
  if (!logFile && !isInitialization) {
    // 如果 logFile 未设置且不是初始化调用，说明 initLogger 未被调用或失败
    console.error(
      "Logger not initialized. Call initLogger(app) first. Message: ",
      message,
    );
    return;
  }
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type}] ${message}\n`;
    // 对于初始化阶段的日志，如果 logFile 仍然为 null (例如，在 initLogger 内部，路径设置失败前的 console.error 后的回退尝试)
    // 这种情况应该由 initLogger 内部的 try-catch 处理，这里主要是防止外部调用时 logFile 为 null。
    // 如果是初始化调用，则路径可能正在被设置，所以使用当前 logFile 的值。
    const currentLogPath =
      isInitialization && logFile ? logFile : logFile || "app_init_error.log";
    fs.appendFileSync(currentLogPath, logEntry);
  } catch (error) {
    console.error(
      "Failed to write to log file:",
      error,
      "Original message:",
      message,
    );
  }
}

// 公开的日志函数
const logToFile = (message, type = "INFO") => {
  logToFileInternal(message, type, false);
};

/**
 * 记录信息日志
 * @param {string} message - 日志消息
 */
const logInfo = (message) => {
  logToFile(message, "INFO");
};

/**
 * 记录警告日志
 * @param {string} message - 日志消息
 */
const logWarn = (message) => {
  logToFile(message, "WARN");
};

/**
 * 记录错误日志
 * @param {string} message - 日志消息
 */
const logError = (message) => {
  logToFile(message, "ERROR");
};

/**
 * 记录调试日志
 * @param {string} message - 日志消息
 */
const logDebug = (message) => {
  logToFile(message, "DEBUG");
};

module.exports = {
  logToFile,
  initLogger,
  logInfo,
  logWarn,
  logError,
  logDebug,
  logFile,
};
