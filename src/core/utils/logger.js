const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { pipeline } = require("stream");
const { promisify } = require("util");

const pipelineAsync = promisify(pipeline);

let logFile = null; // 由 initLogger 设置
let appInstance = null;

// 日志级别定义（从低到高）
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

// 默认配置，可由 config.json 覆盖
const DEFAULT_LOG_CONFIG = {
  level: "INFO", // 默认日志级别
  maxFileSize: 5 * 1024 * 1024, // 日志文件大小上限 5MB
  maxFiles: 5, // 保留历史日志文件数量
  compressOldLogs: true, // 是否压缩历史日志（占位，未实现）
  cleanupIntervalDays: 7, // 日志清理周期（天）
};

// 运行时配置
let logConfig = { ...DEFAULT_LOG_CONFIG };

function detectEnvironment(electronApp) {
  // 优先使用 Electron 的 app.isPackaged 判断
  if (electronApp && typeof electronApp.isPackaged === "boolean") {
    return electronApp.isPackaged ? "production" : "development";
  }

  // 回退方式 1：NODE_ENV
  if (process.env.NODE_ENV === "development") {
    return "development";
  }
  if (process.env.NODE_ENV === "production") {
    return "production";
  }

  // 回退方式 2：路径特征
  if (__dirname.includes("node_modules") || __dirname.includes(".webpack")) {
    return "production";
  }

  // 默认视为开发环境
  return "development";
}

function getLogDirectory(electronApp) {
  const environment = detectEnvironment(electronApp);

  if (environment === "development") {
    // 开发环境：使用项目目录下 log 目录
    return path.join(process.cwd(), "log");
  } else {
    // 生产环境：使用可执行文件同级 log 目录
    return path.join(path.dirname(process.execPath), "log");
  }
}

// 读取日志配置
function loadLogConfig() {
  try {
    // 组合配置文件路径
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
    // 读取失败时保持默认配置
  }
  return logConfig;
}

// 当日志文件超过阈值时执行滚动
function checkLogFileSize() {
  try {
    if (!logFile || !fs.existsSync(logFile)) return;

    const stats = fs.statSync(logFile);
    if (stats.size >= logConfig.maxFileSize) {
      rotateLogs();
    }
  } catch (error) {}
}

// 执行日志滚动（简化实现）
function rotateLogs() {
  try {
    if (!logFile) return;

    const logDir = path.dirname(logFile);
    const baseName = path.basename(logFile);
    const ext = path.extname(baseName);
    const nameWithoutExt = baseName.substring(0, baseName.length - ext.length);

    // 清理多余的历史日志
    cleanupOldLogs(logDir, nameWithoutExt, ext);

    // 依次上移历史文件名
    for (let i = logConfig.maxFiles - 1; i > 0; i--) {
      const oldFile = path.join(logDir, `${nameWithoutExt}.${i}${ext}`);
      const newFile = path.join(logDir, `${nameWithoutExt}.${i + 1}${ext}`);

      if (fs.existsSync(oldFile)) {
        try {
          // 目标文件存在则先删除
          if (fs.existsSync(newFile)) fs.unlinkSync(newFile);
          fs.renameSync(oldFile, newFile);

          // 压缩旧日志（编号大于1的文件）
          if (logConfig.compressOldLogs && i + 1 > 1) {
            compressLogFile(newFile);
          }
        } catch (err) {}
      }
    }

    // 将当前日志文件移动为 .1
    const newFile = path.join(logDir, `${nameWithoutExt}.1${ext}`);
    if (fs.existsSync(newFile)) fs.unlinkSync(newFile);

    // 重命名当前日志文件
    fs.renameSync(logFile, newFile);

    // 创建新的空日志文件
    fs.writeFileSync(logFile, "", "utf8");

    // 记录滚动事件
    logToFileInternal("Log rotation completed.", "INFO", true);
  } catch (error) {}
}

/**
 * 压缩日志文件
 * @param {string} filePath - 要压缩的日志文件路径
 */
async function compressLogFile(filePath) {
  try {
    // 如果已经是压缩文件，跳过
    if (filePath.endsWith('.gz')) {
      return;
    }

    const gzipPath = `${filePath}.gz`;

    // 如果压缩文件已存在，先删除
    if (fs.existsSync(gzipPath)) {
      fs.unlinkSync(gzipPath);
    }

    // 使用流式压缩，避免大文件内存占用过高
    await pipelineAsync(
      fs.createReadStream(filePath),
      zlib.createGzip({ level: 9 }), // 最高压缩级别
      fs.createWriteStream(gzipPath)
    );

    // 压缩成功后删除原文件
    fs.unlinkSync(filePath);

    logToFileInternal(
      `Log file compressed: ${path.basename(filePath)} -> ${path.basename(gzipPath)}`,
      "INFO",
      true
    );
  } catch (error) {
    // 压缩失败不影响主流程，仅记录错误
    try {
      logToFileInternal(
        `Failed to compress log file ${filePath}: ${error.message}`,
        "WARN",
        true
      );
    } catch (logError) {
      // 记录失败时静默忽略
    }
  }
}

// 清理超出数量限制的旧日志文件
function cleanupOldLogs(logDir, nameWithoutExt, ext) {
  try {
    const files = fs.readdirSync(logDir);

    // 找到相关的日志文件（包括 .gz 压缩文件）
    const logFiles = files.filter((file) => {
      if (!file.startsWith(nameWithoutExt)) return false;

      // 匹配 app.1.log 或 app.1.log.gz 格式
      const withoutGz = file.endsWith('.gz') ? file.slice(0, -3) : file;
      if (!withoutGz.endsWith(ext)) return false;

      const numPart = withoutGz.substring(
        nameWithoutExt.length + 1,
        withoutGz.length - ext.length,
      );
      return !isNaN(parseInt(numPart));
    });

    // 按编号降序排序
    logFiles.sort((a, b) => {
      const getNum = (filename) => {
        const withoutGz = filename.endsWith('.gz') ? filename.slice(0, -3) : filename;
        return parseInt(
          withoutGz.substring(nameWithoutExt.length + 1, withoutGz.length - ext.length)
        );
      };
      return getNum(b) - getNum(a);
    });

    // 删除超出数量限制的日志文件
    if (logFiles.length >= logConfig.maxFiles) {
      for (let i = logConfig.maxFiles; i < logFiles.length; i++) {
        const fileToRemove = path.join(logDir, logFiles[i]);
        fs.unlinkSync(fileToRemove);
      }
    }
  } catch (error) {
    // 清理失败时仅记录（避免影响主流程）
  }
}

// 定期清理日志内容，移除超出时间窗口的条目
function cleanupOldLogEntries() {
  try {
    if (!logFile || !fs.existsSync(logFile)) return;

    const now = new Date();
    const cutoffTime = new Date(
      now.getTime() - logConfig.cleanupIntervalDays * 24 * 60 * 60 * 1000,
    );

    // 读取当前日志
    const logContent = fs.readFileSync(logFile, "utf8");
    const lines = logContent.split("\n").filter((line) => line.trim());

    // 仅保留未过期的日志
    const validLines = lines.filter((line) => {
      // 匹配时间戳格式 [2025-10-24T03:04:34.360Z]
      const timestampMatch = line.match(
        /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/,
      );
      if (!timestampMatch) {
        // 无法解析时间戳则保留该行（兼容不同格式的日志）
        return true;
      }

      const logTime = new Date(timestampMatch[1]);
      return logTime >= cutoffTime;
    });

    // 写回清理后的日志
    if (validLines.length < lines.length) {
      const newContent = validLines.join("\n") + "\n";
      fs.writeFileSync(logFile, newContent, "utf8");

      const cleanedCount = lines.length - validLines.length;
      logToFileInternal(
        `Log cleanup completed. Removed ${cleanedCount} entries older than ${logConfig.cleanupIntervalDays} days.`,
        "INFO",
        true,
      );
    }

    // 清理过期的轮转日志文件（包括压缩文件）
    cleanupOldRotatedLogs(cutoffTime);
  } catch (error) {
    // 清理失败时记录错误但不抛出
    try {
      logToFileInternal(`Log cleanup failed: ${error.message}`, "ERROR", true);
    } catch (logError) {
      // 记录失败时静默忽略
    }
  }
}

/**
 * 清理过期的轮转日志文件（包括 .gz 压缩文件）
 * @param {Date} cutoffTime - 截止时间，早于此时间的文件将被删除
 */
function cleanupOldRotatedLogs(cutoffTime) {
  try {
    if (!logFile) return;

    const logDir = path.dirname(logFile);
    const baseName = path.basename(logFile);
    const ext = path.extname(baseName);
    const nameWithoutExt = baseName.substring(0, baseName.length - ext.length);

    const files = fs.readdirSync(logDir);
    let removedCount = 0;

    // 查找所有相关的轮转日志文件
    files.forEach((file) => {
      if (!file.startsWith(nameWithoutExt)) return;

      // 匹配 app.1.log 或 app.1.log.gz 格式
      const withoutGz = file.endsWith('.gz') ? file.slice(0, -3) : file;
      if (!withoutGz.endsWith(ext)) return;

      const numPart = withoutGz.substring(
        nameWithoutExt.length + 1,
        withoutGz.length - ext.length,
      );

      // 只处理轮转的日志文件（带编号的）
      if (isNaN(parseInt(numPart))) return;

      const filePath = path.join(logDir, file);

      try {
        const stats = fs.statSync(filePath);
        // 根据文件修改时间判断是否过期
        if (stats.mtime < cutoffTime) {
          fs.unlinkSync(filePath);
          removedCount++;
          logToFileInternal(
            `Removed expired rotated log file: ${file}`,
            "INFO",
            true,
          );
        }
      } catch (statError) {
        // 文件状态获取失败，跳过
      }
    });

    if (removedCount > 0) {
      logToFileInternal(
        `Rotated log cleanup: Removed ${removedCount} expired file(s) older than ${logConfig.cleanupIntervalDays} days.`,
        "INFO",
        true,
      );
    }
  } catch (error) {
    // 清理失败不影响主流程
    try {
      logToFileInternal(
        `Failed to cleanup rotated logs: ${error.message}`,
        "WARN",
        true,
      );
    } catch (logError) {
      // 静默忽略
    }
  }
}

// 初始化日志模块，建议在 app 'ready' 后调用
function initLogger(electronApp) {
  appInstance = electronApp;
  const environment = detectEnvironment(electronApp);

  // 载入日志配置
  loadLogConfig();

  try {
    // 根据环境选择日志目录
    const logDir = getLogDirectory(electronApp);

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    logFile = path.join(logDir, "app.log");

    // 检查日志文件大小，必要时滚动
    checkLogFileSize();

    // 进行一次日志内容清理
    cleanupOldLogEntries();

    // 写入初始化成功日志（包括路径与环境）
    logToFileInternal(
      `Logger initialized in ${environment} environment. Log path: ${logFile}`,
      "INFO",
      true,
    );
  } catch (error) {
    // 回退 1：使用 Electron 默认 logs 路径
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
      // 回退 2：使用 __dirname 相对路径
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
        // 回退 3：工作目录的紧急日志文件
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

// 是否应记录该级别日志
function shouldLog(level) {
  const configLevel = logConfig.level || "INFO";
  return LOG_LEVELS[level] >= LOG_LEVELS[configLevel];
}

// 内部日志写入函数；初始化阶段也可调用（跳过级别判断）
function logToFileInternal(message, type = "INFO", isInitialization = false) {
  if (!logFile && !isInitialization) {
    // 未初始化或初始化失败时不记录
    return;
  }

  // 非初始化阶段按级别判断是否写入
  if (!isInitialization && !shouldLog(type)) {
    return;
  }

  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type}] ${message}\n`;
    const currentLogPath =
      isInitialization && logFile ? logFile : logFile || "app_init_error.log";
    fs.appendFileSync(currentLogPath, logEntry);

    // 写入后检查文件大小
    if (!isInitialization && logFile) {
      checkLogFileSize();
    }
  } catch (error) {}
}

// 对外日志 API
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

// 获取当前日志配置快照
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

