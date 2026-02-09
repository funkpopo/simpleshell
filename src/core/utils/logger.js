const path = require("path");
const fs = require("fs");
const zlib = require("zlib");

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

function detectEnvironment(electronApp) {
  if (electronApp && typeof electronApp.isPackaged === "boolean") {
    return electronApp.isPackaged ? "production" : "development";
  }
  if (process.env.NODE_ENV === "development") return "development";
  if (process.env.NODE_ENV === "production") return "production";
  if (__dirname.includes("node_modules") || __dirname.includes(".webpack")) {
    return "production";
  }
  return "development";
}

function getLogDirectory(electronApp) {
  const environment = detectEnvironment(electronApp);
  if (environment === "development") {
    return path.join(process.cwd(), "log");
  }
  return path.join(path.dirname(process.execPath), "log");
}

function loadLogConfig() {
  try {
    const configPath = appInstance
      ? appInstance.isPackaged
        ? path.join(path.dirname(process.execPath), "config.json")
        : path.join(process.cwd(), "config.json")
      : path.join(process.cwd(), "config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.logSettings) {
        logConfig = { ...DEFAULT_LOG_CONFIG, ...config.logSettings };
      }
    }
  } catch { /* intentionally ignored */ }
  return logConfig;
}

function startFlushTimer() {
  stopFlushTimer();
  const interval = Number(logConfig.flushIntervalMs) || DEFAULT_LOG_CONFIG.flushIntervalMs;
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
    checkLogFileSize();
  } catch {
    try {
      const batch = writeQueue;
      writeQueue = [];
      const data = batch.join("");
      fs.appendFileSync(logFile || "app_emergency.log", data);
    } catch { /* intentionally ignored */ }
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

function checkLogFileSize() {
  try {
    if (!logFile || !fs.existsSync(logFile)) return;
    const stats = fs.statSync(logFile);
    if (stats.size >= logConfig.maxFileSize) rotateLogs();
  } catch { /* intentionally ignored */ }
}

function rotateLogs() {
  try {
    if (!logFile) return;
    const logDir = path.dirname(logFile);
    const baseName = path.basename(logFile);
    const ext = path.extname(baseName);
    const nameWithoutExt = baseName.substring(0, baseName.length - ext.length);

    cleanupOldLogs(logDir, nameWithoutExt, ext);

    for (let i = logConfig.maxFiles - 1; i > 0; i--) {
      const srcPlain = path.join(logDir, `${nameWithoutExt}.${i}${ext}`);
      const srcGz = path.join(logDir, `${nameWithoutExt}.${i}${ext}.gz`);
      const dstPlain = path.join(logDir, `${nameWithoutExt}.${i + 1}${ext}`);
      const dstGz = path.join(logDir, `${nameWithoutExt}.${i + 1}${ext}.gz`);

      try {
        if (fs.existsSync(srcGz)) {
          if (fs.existsSync(dstGz)) fs.unlinkSync(dstGz);
          fs.renameSync(srcGz, dstGz);
        } else if (fs.existsSync(srcPlain)) {
          if (logConfig.compressOldLogs && i + 1 > 1) {
            if (fs.existsSync(dstGz)) fs.unlinkSync(dstGz);
            gzipFileSync(srcPlain, dstGz);
            try { fs.unlinkSync(srcPlain); } catch { /* intentionally ignored */ }
          } else {
            if (fs.existsSync(dstPlain)) fs.unlinkSync(dstPlain);
            fs.renameSync(srcPlain, dstPlain);
          }
        }
      } catch { /* intentionally ignored */ }
    }

    const firstRotated = path.join(logDir, `${nameWithoutExt}.1${ext}`);
    if (fs.existsSync(firstRotated)) fs.unlinkSync(firstRotated);
    fs.renameSync(logFile, firstRotated);
    fs.writeFileSync(logFile, "", "utf8");
    logToFileInternal("Log rotation completed.", "INFO", true);
  } catch { /* intentionally ignored */ }
}

function cleanupOldLogs(logDir, nameWithoutExt, ext) {
  try {
    const files = fs.readdirSync(logDir);
    const rotated = files.filter((file) => {
      const plain = file.match(
        new RegExp(`^${escapeRegExp(nameWithoutExt)}\\.(\\d+)${escapeRegExp(ext)}$`),
      );
      const gz = file.match(
        new RegExp(`^${escapeRegExp(nameWithoutExt)}\\.(\\d+)${escapeRegExp(ext)}\\.gz$`),
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
        try { fs.unlinkSync(fileToRemove); } catch { /* intentionally ignored */ }
      }
    }
  } catch { /* intentionally ignored */ }
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
    } catch { /* intentionally ignored */ }
  }
}

function initLogger(electronApp) {
  appInstance = electronApp;
  const environment = detectEnvironment(electronApp);
  loadLogConfig();
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
  } catch {
    try {
      const electronLogDir = electronApp.getPath("logs");
      if (!fs.existsSync(electronLogDir)) fs.mkdirSync(electronLogDir, { recursive: true });
      logFile = path.join(electronLogDir, "app.log");
      logToFileInternal(
        `Logger initialized with Electron default path (fallback level 1): ${logFile}`,
        "WARN",
        true,
      );
      startFlushTimer();
    } catch {
      try {
        const fallbackLogDir = path.join(__dirname, "..", "..", "..", "logs");
        if (!fs.existsSync(fallbackLogDir)) fs.mkdirSync(fallbackLogDir, { recursive: true });
        logFile = path.join(fallbackLogDir, "app_fallback.log");
        logToFileInternal(
          `Logger initialized with __dirname-based path (fallback level 2): ${logFile}`,
          "WARN",
          true,
        );
        startFlushTimer();
      } catch {
        logFile = "app_emergency.log";
        logToFileInternal(
          `Logger initialized with emergency path in current working directory (fallback level 3): ${logFile}`,
          "ERROR",
          true,
        );
        startFlushTimer();
      }
    }
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
      try { fs.appendFileSync("app_init_error.log", logEntry); } catch { /* intentionally ignored */ }
    }
    if (!isInitialization && logFile) {
      checkLogFileSize();
    }
  } catch { /* intentionally ignored */ }
}

const logToFile = (message, type = "INFO") => {
  logToFileInternal(message, type, false);
};

const logInfo = (message) => logToFile(message, "INFO");
const logWarn = (message) => logToFile(message, "WARN");
const logError = (message) => logToFile(message, "ERROR");
const logDebug = (message) => logToFile(message, "DEBUG");

function getLogConfig() {
  return { ...logConfig };
}

function updateLogConfig(newConfig) {
  if (newConfig && typeof newConfig === "object") {
    logConfig = { ...logConfig, ...newConfig };
    if (newConfig.flushIntervalMs !== undefined) startFlushTimer();
    return true;
  }
  return false;
}

function extractRotationIndex(fileName, nameWithoutExt, ext) {
  const plain = fileName.match(
    new RegExp(`^${escapeRegExp(nameWithoutExt)}\\.(\\d+)${escapeRegExp(ext)}$`),
  );
  if (plain) return parseInt(plain[1], 10);
  const gz = fileName.match(
    new RegExp(`^${escapeRegExp(nameWithoutExt)}\\.(\\d+)${escapeRegExp(ext)}\\.gz$`),
  );
  if (gz) return parseInt(gz[1], 10);
  return -1;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gzipFileSync(srcPath, destPath) {
  try {
    const buf = fs.readFileSync(srcPath);
    const gz = zlib.gzipSync(buf);
    fs.writeFileSync(destPath, gz);
  } catch { /* intentionally ignored */ }
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
            } catch { /* intentionally ignored */ }
          }
        } catch { /* intentionally ignored */ }
      });
    } catch { /* intentionally ignored */ }
  });
}

setupProcessFlushHooks();

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

