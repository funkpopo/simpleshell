const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const { promisify } = require("util");
const { getConfigPath, getLogDirectory } = require("./appPaths");
const { escapeRegExp } = require("./textUtils");

let logFile = null;
let appInstance = null;

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

const DEFAULT_LOG_CONFIG = {
  level: "INFO",
  maxFileSize: 5 * 1024 * 1024,
  maxFiles: 5,
  compressOldLogs: true,
  cleanupIntervalDays: 7,
  flushIntervalMs: 250,
  batchSize: 50,
};

let logConfig = { ...DEFAULT_LOG_CONFIG };

// Async write queue
let writeQueue = [];
let isFlushing = false;
let pendingFlush = false;
let flushTimer = null;
let flushesSinceSizeCheck = 0;
let lastSizeCheckAt = 0;
let isRotating = false;
const SIZE_CHECK_FLUSH_INTERVAL = 10;
const SIZE_CHECK_MIN_INTERVAL_MS = 5000;

function getLoggerEnvironment(electronApp) {
  return electronApp && electronApp.isPackaged ? "production" : "development";
}

function loadLogConfig() {
  if (!appInstance) {
    return logConfig;
  }

  try {
    const configPath = getConfigPath(appInstance);
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.logSettings) {
        logConfig = { ...DEFAULT_LOG_CONFIG, ...config.logSettings };
      }
    }
  } catch (error) {
    console.warn(
      `Failed to load log settings from config.json: ${error.message}`,
    );
  }
  return logConfig;
}

function startFlushTimer() {
  stopFlushTimer();
  const interval =
    Number(logConfig.flushIntervalMs) || DEFAULT_LOG_CONFIG.flushIntervalMs;
  flushTimer = setInterval(() => {
    flushQueue();
  }, interval);
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

function stopFlushTimer() {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

async function flushQueue() {
  if (!logFile || writeQueue.length === 0) return;
  if (isFlushing) {
    pendingFlush = true;
    return;
  }
  isFlushing = true;
  try {
    const batch = writeQueue;
    writeQueue = [];
    const data = batch.join("");
    await fs.promises.appendFile(logFile, data);

    flushesSinceSizeCheck += 1;
    const now = Date.now();
    if (
      flushesSinceSizeCheck >= SIZE_CHECK_FLUSH_INTERVAL ||
      now - lastSizeCheckAt >= SIZE_CHECK_MIN_INTERVAL_MS
    ) {
      flushesSinceSizeCheck = 0;
      lastSizeCheckAt = now;
      // 轮转在 isFlushing 临界区内完成，与写入互斥，避免轮转 rename 期间并发 append
      await checkLogFileSize();
    }
  } catch {
    try {
      const batch = writeQueue;
      writeQueue = [];
      const data = batch.join("");
      if (logFile) {
        fs.appendFileSync(logFile, data);
      }
    } catch (error) {
      console.error(`Failed to flush log queue: ${error.message}`);
    }
  } finally {
    isFlushing = false;
    if (pendingFlush) {
      pendingFlush = false;
      setImmediate(() => flushQueue());
    }
  }
}

function enqueue(entry) {
  writeQueue.push(entry);
  const size = Number(logConfig.batchSize) || DEFAULT_LOG_CONFIG.batchSize;
  if (writeQueue.length >= size) setImmediate(() => flushQueue());
}

async function pathExists(target) {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}

async function checkLogFileSize() {
  try {
    if (!logFile) return;
    const stats = await fs.promises.stat(logFile).catch(() => null);
    if (stats && stats.size >= logConfig.maxFileSize) await rotateLogs();
  } catch {
    /* intentionally ignored */
  }
}

async function rotateLogs() {
  if (isRotating) return;
  isRotating = true;
  try {
    if (!logFile) return;
    const logDir = path.dirname(logFile);
    const baseName = path.basename(logFile);
    const ext = path.extname(baseName);
    const nameWithoutExt = baseName.substring(0, baseName.length - ext.length);

    await cleanupOldLogs(logDir, nameWithoutExt, ext);

    for (let i = logConfig.maxFiles - 1; i > 0; i--) {
      const srcPlain = path.join(logDir, `${nameWithoutExt}.${i}${ext}`);
      const srcGz = path.join(logDir, `${nameWithoutExt}.${i}${ext}.gz`);
      const dstPlain = path.join(logDir, `${nameWithoutExt}.${i + 1}${ext}`);
      const dstGz = path.join(logDir, `${nameWithoutExt}.${i + 1}${ext}.gz`);

      try {
        if (await pathExists(srcGz)) {
          if (await pathExists(dstGz)) await fs.promises.unlink(dstGz);
          await fs.promises.rename(srcGz, dstGz);
        } else if (await pathExists(srcPlain)) {
          if (logConfig.compressOldLogs && i + 1 > 1) {
            if (await pathExists(dstGz)) await fs.promises.unlink(dstGz);
            // gzip 失败时抛出，保留 srcPlain，避免误删未压缩日志
            await gzipFileAsync(srcPlain, dstGz);
            try {
              await fs.promises.unlink(srcPlain);
            } catch {
              /* intentionally ignored */
            }
          } else {
            if (await pathExists(dstPlain)) await fs.promises.unlink(dstPlain);
            await fs.promises.rename(srcPlain, dstPlain);
          }
        }
      } catch {
        /* intentionally ignored */
      }
    }

    const firstRotated = path.join(logDir, `${nameWithoutExt}.1${ext}`);
    if (await pathExists(firstRotated)) await fs.promises.unlink(firstRotated);
    await fs.promises.rename(logFile, firstRotated);
    await fs.promises.writeFile(logFile, "", "utf8");
    logToFileInternal("Log rotation completed.", "INFO", true);
  } catch {
    /* intentionally ignored */
  } finally {
    isRotating = false;
  }
}

async function cleanupOldLogs(logDir, nameWithoutExt, ext) {
  try {
    const files = await fs.promises.readdir(logDir);
    const rotated = files.filter((file) => {
      const plain = file.match(
        new RegExp(
          `^${escapeRegExp(nameWithoutExt)}\\.(\\d+)${escapeRegExp(ext)}$`,
        ),
      );
      const gz = file.match(
        new RegExp(
          `^${escapeRegExp(nameWithoutExt)}\\.(\\d+)${escapeRegExp(ext)}\\.gz$`,
        ),
      );
      return !!(plain || gz);
    });
    rotated.sort((a, b) => {
      const na = extractRotationIndex(a, nameWithoutExt, ext);
      const nb = extractRotationIndex(b, nameWithoutExt, ext);
      return nb - na;
    });
    if (rotated.length >= logConfig.maxFiles) {
      for (let i = logConfig.maxFiles; i < rotated.length; i++) {
        const fileToRemove = path.join(logDir, rotated[i]);
        try {
          await fs.promises.unlink(fileToRemove);
        } catch {
          /* intentionally ignored */
        }
      }
    }
  } catch {
    /* intentionally ignored */
  }
}

function cleanupOldLogEntries() {
  try {
    if (!logFile || !fs.existsSync(logFile)) return;
    const now = new Date();
    const cutoffTime = new Date(
      now.getTime() - logConfig.cleanupIntervalDays * 24 * 60 * 60 * 1000,
    );
    const logContent = fs.readFileSync(logFile, "utf8");
    const lines = logContent.split("\n").filter((line) => line.trim());
    const validLines = lines.filter((line) => {
      const ts = line.match(
        /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\]/,
      );
      if (!ts) return true;
      const logTime = new Date(ts[1]);
      return logTime >= cutoffTime;
    });
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
  } catch {
    try {
      logToFileInternal(`Log cleanup failed`, "ERROR", true);
    } catch {
      /* intentionally ignored */
    }
  }
}

function initLogger(electronApp) {
  appInstance = electronApp;
  const environment = getLoggerEnvironment(electronApp);
  loadLogConfig();
  flushesSinceSizeCheck = 0;
  lastSizeCheckAt = 0;

  try {
    const logDir = getLogDirectory(electronApp);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    logFile = path.join(logDir, "app.log");
    checkLogFileSize();
    cleanupOldLogEntries();
    logToFileInternal(
      `Logger initialized in ${environment} environment. Log path: ${logFile}`,
      "INFO",
      true,
    );
    startFlushTimer();
  } catch (error) {
    logFile = null;
    console.error(`Logger initialization failed: ${error.message}`);
    throw error;
  }
}

function shouldLog(level) {
  const configLevel = logConfig.level || "INFO";
  return LOG_LEVELS[level] >= LOG_LEVELS[configLevel];
}

function logToFileInternal(message, type = "INFO", isInitialization = false) {
  if (!logFile && !isInitialization) return;
  if (!isInitialization && !shouldLog(type)) return;
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type}] ${message}\n`;
    if (logFile) {
      enqueue(logEntry);
    } else {
      console.error(logEntry.trimEnd());
    }
  } catch {
    /* intentionally ignored */
  }
}

const logToFile = (message, type = "INFO") => {
  logToFileInternal(message, type, false);
};

const logError = (message) => logToFile(message, "ERROR");

function updateLogConfig(newConfig) {
  if (newConfig && typeof newConfig === "object") {
    logConfig = { ...logConfig, ...newConfig };
    if (newConfig.flushIntervalMs !== undefined) startFlushTimer();
    return true;
  }
  return false;
}

function getLogDirectoryPath() {
  return appInstance ? getLogDirectory(appInstance) : null;
}

function getLogFilePath() {
  return logFile;
}

function extractRotationIndex(fileName, nameWithoutExt, ext) {
  const plain = fileName.match(
    new RegExp(
      `^${escapeRegExp(nameWithoutExt)}\\.(\\d+)${escapeRegExp(ext)}$`,
    ),
  );
  if (plain) return parseInt(plain[1], 10);
  const gz = fileName.match(
    new RegExp(
      `^${escapeRegExp(nameWithoutExt)}\\.(\\d+)${escapeRegExp(ext)}\\.gz$`,
    ),
  );
  if (gz) return parseInt(gz[1], 10);
  return -1;
}

async function gzipFileAsync(srcPath, destPath) {
  const buf = await fs.promises.readFile(srcPath);
  // zlib 无内置 promises API（仅 fs 有），用 util.promisify 包装回调版 gzip
  const gz = await promisify(zlib.gzip)(buf);
  await fs.promises.writeFile(destPath, gz);
}

function setupProcessFlushHooks() {
  ["beforeExit", "exit", "SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => {
    try {
      process.on(sig, () => {
        try {
          stopFlushTimer();
          if (writeQueue.length > 0 && logFile) {
            try {
              const data = writeQueue.join("");
              writeQueue = [];
              fs.appendFileSync(logFile, data);
            } catch {
              /* intentionally ignored */
            }
          }
        } catch {
          /* intentionally ignored */
        }
      });
    } catch {
      /* intentionally ignored */
    }
  });
}

setupProcessFlushHooks();

module.exports = {
  logToFile,
  initLogger,
  logError,
  getLogDirectoryPath,
  getLogFilePath,
  updateLogConfig,
};
