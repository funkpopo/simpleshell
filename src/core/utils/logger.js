const path = require("path");
const fs = require("fs");

let logFile = null; // Will be set by initLogger
let appInstance = null;

// 日志级别常量，按严重性排序
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// 默认配置，可由config.json覆盖
const DEFAULT_LOG_CONFIG = {
  level: "INFO", // 默认日志级别
  maxFileSize: 5 * 1024 * 1024, // 默认日志文件大小上限：5MB
  maxFiles: 5, // 默认最大历史日志文件数量
  compressOldLogs: true, // 是否压缩旧日志文件
  cleanupIntervalDays: 7, // 日志清理时间间隔：7天
};

// 当前配置
let logConfig = { ...DEFAULT_LOG_CONFIG };

function detectEnvironment(electronApp) {
  // 主要检测方法：使用app.isPackaged
  if (electronApp && typeof electronApp.isPackaged === "boolean") {
    return electronApp.isPackaged ? "production" : "development";
  }

  // 备用检测方法1：NODE_ENV环境变量
  if (process.env.NODE_ENV === "development") {
    return "development";
  }
  if (process.env.NODE_ENV === "production") {
    return "production";
  }

  // 备用检测方法2：路径分析
  if (__dirname.includes("node_modules") || __dirname.includes(".webpack")) {
    return "production";
  }

  // 默认为开发环境
  return "development";
}

function getLogDirectory(electronApp) {
  const environment = detectEnvironment(electronApp);

  if (environment === "development") {
    // 开发环境：使用项目根目录下的log文件夹
    return path.join(process.cwd(), "log");
  } else {
    // 生产环境：使用exe同级的log文件夹
    return path.join(path.dirname(process.execPath), "log");
  }
}

// 获取日志配置
function loadLogConfig() {
  try {
    // 尝试加载配置文件
    const configPath = appInstance
      ? appInstance.isPackaged
        ? path.join(path.dirname(process.execPath), "config.json")
        : path.join(process.cwd(), "config.json")
      : path.join(process.cwd(), "config.json");

    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.logSettings) {
        // 合并用户配置与默认配置
        logConfig = {
          ...DEFAULT_LOG_CONFIG,
          ...config.logSettings,
        };
      }
    }
  } catch (error) {
    // 保持默认配置
  }
  return logConfig;
}

// 检查日志文件大小，如果超过阈值则执行日志轮转
function checkLogFileSize() {
  try {
    if (!logFile || !fs.existsSync(logFile)) return;

    const stats = fs.statSync(logFile);
    if (stats.size >= logConfig.maxFileSize) {
      rotateLogs();
    }
  } catch (error) {}
}

// 执行日志轮转
function rotateLogs() {
  try {
    if (!logFile) return;

    const logDir = path.dirname(logFile);
    const baseName = path.basename(logFile);
    const ext = path.extname(baseName);
    const nameWithoutExt = baseName.substring(0, baseName.length - ext.length);

    // 清理多余的旧日志文件
    cleanupOldLogs(logDir, nameWithoutExt, ext);

    // 轮转现有日志文件
    for (let i = logConfig.maxFiles - 1; i > 0; i--) {
      const oldFile = path.join(logDir, `${nameWithoutExt}.${i}${ext}`);
      const newFile = path.join(logDir, `${nameWithoutExt}.${i + 1}${ext}`);

      if (fs.existsSync(oldFile)) {
        try {
          // 如果目标文件已存在则先删除
          if (fs.existsSync(newFile)) fs.unlinkSync(newFile);
          fs.renameSync(oldFile, newFile);

          // 压缩日志文件（如果启用）
          if (logConfig.compressOldLogs && i + 1 > 1) {
            // 压缩功能可以在这里实现
            // 由于Electron环境中使用Node.js内置模块的限制，
            // 这里仅作为示例，实际项目可能需要添加额外依赖如zlib
          }
        } catch (err) {}
      }
    }

    // 轮转当前日志文件
    const newFile = path.join(logDir, `${nameWithoutExt}.1${ext}`);
    if (fs.existsSync(newFile)) fs.unlinkSync(newFile);

    // 将当前日志文件重命名为备份
    fs.renameSync(logFile, newFile);

    // 创建新的空日志文件
    fs.writeFileSync(logFile, "", "utf8");

    // 记录轮转事件
    logToFileInternal("Log rotation completed.", "INFO", true);
  } catch (error) {}
}

// 清理过期的日志文件
function cleanupOldLogs(logDir, nameWithoutExt, ext) {
  try {
    const files = fs.readdirSync(logDir);

    // 找出所有相关的日志文件
    const logFiles = files.filter((file) => {
      if (!file.startsWith(nameWithoutExt) || !file.endsWith(ext)) return false;
      const numPart = file.substring(
        nameWithoutExt.length + 1,
        file.length - ext.length,
      );
      return !isNaN(parseInt(numPart));
    });

    // 按文件编号排序
    logFiles.sort((a, b) => {
      const numA = parseInt(
        a.substring(nameWithoutExt.length + 1, a.length - ext.length),
      );
      const numB = parseInt(
        b.substring(nameWithoutExt.length + 1, b.length - ext.length),
      );
      return numB - numA; // 降序排列
    });

    // 删除多余的日志文件
    if (logFiles.length >= logConfig.maxFiles) {
      for (let i = logConfig.maxFiles; i < logFiles.length; i++) {
        const fileToRemove = path.join(logDir, logFiles[i]);
        fs.unlinkSync(fileToRemove);
      }
    }
  } catch (error) {
    // Failed to cleanup old logs - 避免在日志系统中使用console
  }
}

// 清理过期日志记录（按时间清理app.log中的内容）
function cleanupOldLogEntries() {
  try {
    if (!logFile || !fs.existsSync(logFile)) return;

    const now = new Date();
    const cutoffTime = new Date(now.getTime() - (logConfig.cleanupIntervalDays * 24 * 60 * 60 * 1000));

    // 读取整个日志文件
    const logContent = fs.readFileSync(logFile, 'utf8');
    const lines = logContent.split('\n').filter(line => line.trim());

    // 过滤出未过期的日志行
    const validLines = lines.filter(line => {
      // 匹配时间戳格式 [2025-10-24T03:04:34.360Z]
      const timestampMatch = line.match(/^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/);
      if (!timestampMatch) {
        // 如果没有匹配到时间戳，保留这一行（可能是格式错误的日志）
        return true;
      }

      const logTime = new Date(timestampMatch[1]);
      return logTime >= cutoffTime;
    });

    // 如果有日志被清理，重新写入文件
    if (validLines.length < lines.length) {
      const newContent = validLines.join('\n') + '\n';
      fs.writeFileSync(logFile, newContent, 'utf8');

      const cleanedCount = lines.length - validLines.length;
      logToFileInternal(
        `Log cleanup completed. Removed ${cleanedCount} entries older than ${logConfig.cleanupIntervalDays} days.`,
        "INFO",
        true
      );
    }
  } catch (error) {
    // 清理失败时记录错误但不抛出异常
    try {
      logToFileInternal(`Log cleanup failed: ${error.message}`, "ERROR", true);
    } catch (logError) {
      // 如果连错误都无法记录，静默失败
    }
  }
}

// 初始化日志模块，必须在 app 'ready' 后调用
function initLogger(electronApp) {
  appInstance = electronApp;
  const environment = detectEnvironment(electronApp);

  // 加载日志配置
  loadLogConfig();

  try {
    // 根据环境选择日志目录
    const logDir = getLogDirectory(electronApp);

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    logFile = path.join(logDir, "app.log");

    // 检查日志文件大小并在必要时执行轮转
    checkLogFileSize();

    // 清理过期日志记录
    cleanupOldLogEntries();

    // 写入初始化成功的日志，包含环境信息
    logToFileInternal(
      `Logger initialized in ${environment} environment. Log path: ${logFile}`,
      "INFO",
      true,
    );
  } catch (error) {
    // 第一级回退：使用Electron默认日志路径
    try {
      const electronLogDir = electronApp.getPath("logs");
      if (!fs.existsSync(electronLogDir)) {
        fs.mkdirSync(electronLogDir, { recursive: true });
      }
      logFile = path.join(electronLogDir, "app.log");
      logToFileInternal(
        `Logger initialized with Electron default path (fallback level 1): ${logFile}`,
        "WARN",
        true,
      );
    } catch (electronError) {
      // 第二级回退：使用基于__dirname的路径
      try {
        const fallbackLogDir = path.join(__dirname, "..", "..", "..", "logs");
        if (!fs.existsSync(fallbackLogDir)) {
          fs.mkdirSync(fallbackLogDir, { recursive: true });
        }
        logFile = path.join(fallbackLogDir, "app_fallback.log");
        logToFileInternal(
          `Logger initialized with __dirname-based path (fallback level 2): ${logFile}`,
          "WARN",
          true,
        );
      } catch (fallbackError) {
        // 最终回退：直接在工作目录下
        logFile = "app_emergency.log";
        logToFileInternal(
          `Logger initialized with emergency path in current working directory (fallback level 3): ${logFile}`,
          "ERROR",
          true,
        );
      }
    }
  }
}

// 判断是否应该记录此级别的日志
function shouldLog(level) {
  const configLevel = logConfig.level || "INFO";
  return LOG_LEVELS[level] >= LOG_LEVELS[configLevel];
}

// 内部日志函数，允许在 initLogger 自身中使用，避免循环依赖或在 logFile 未设置时出错
function logToFileInternal(message, type = "INFO", isInitialization = false) {
  if (!logFile && !isInitialization) {
    // 如果 logFile 未设置且不是初始化调用，说明 initLogger 未被调用或失败
    return;
  }

  // 检查日志级别，决定是否记录
  if (!isInitialization && !shouldLog(type)) {
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type}] ${message}\n`;
    // 对于初始化阶段的日志，如果 logFile 仍然为 null (例如，在 initLogger 内部，路径设置失败前的
    // 这种情况应该由 initLogger 内部的 try-catch 处理，这里主要是防止外部调用时 logFile 为 null。
    // 如果是初始化调用，则路径可能正在被设置，所以使用当前 logFile 的值。
    const currentLogPath =
      isInitialization && logFile ? logFile : logFile || "app_init_error.log";
    fs.appendFileSync(currentLogPath, logEntry);

    // 在每次写入日志后检查文件大小
    if (!isInitialization && logFile) {
      checkLogFileSize();
    }
  } catch (error) {}
}

// 公开的日志函数
const logToFile = (message, type = "INFO") => {
  logToFileInternal(message, type, false);
};

const logInfo = (message) => {
  logToFile(message, "INFO");
};

const logWarn = (message) => {
  logToFile(message, "WARN");
};

const logError = (message) => {
  logToFile(message, "ERROR");
};

const logDebug = (message) => {
  logToFile(message, "DEBUG");
};

// 获取当前日志配置
function getLogConfig() {
  return { ...logConfig };
}

// 更新日志配置
function updateLogConfig(newConfig) {
  if (newConfig && typeof newConfig === "object") {
    logConfig = {
      ...logConfig,
      ...newConfig,
    };
    return true;
  }
  return false;
}

module.exports = {
  logToFile,
  initLogger,
  logInfo,
  logWarn,
  logError,
  logDebug,
  logFile,
  getLogConfig,
  updateLogConfig,
  cleanupOldLogEntries,
};
