const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const FILE_PLACEHOLDER = "%FILE%";
const DEFAULT_DEBOUNCE_MS = 700;
const RETRYABLE_ERRORS = new Set(["EBUSY", "EPERM", "EACCES"]);

let electronApp = null;
let logToFile = (message, level = "INFO") => {
  if (process.env.NODE_ENV !== "test") {
    // Fallback logger to avoid crashes when logger is not injected
    console.log(`[ExternalEditor][${level}] ${message}`);
  }
};
let configManager = null;
let sftpCore = null;
let shellModule = null;
let sendToRenderer = null;

const watchers = new Map();

let cachedProjectRoot = null;
let cachedDevTempRoot = null;

function findProjectRoot() {
  if (cachedProjectRoot) {
    return cachedProjectRoot;
  }

  if (!electronApp) {
    throw new Error("External editor manager not initialized");
  }

  let currentDir = electronApp.getAppPath ? electronApp.getAppPath() : process.cwd();

  while (currentDir && currentDir !== path.dirname(currentDir)) {
    try {
      const packageJsonPath = path.join(currentDir, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        cachedProjectRoot = currentDir;
        return cachedProjectRoot;
      }
    } catch (error) {
      logToFile(`Failed to inspect ${currentDir}: ${error.message}`, "WARN");
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  cachedProjectRoot = process.cwd();
  return cachedProjectRoot;
}

function getDevelopmentTempRoot() {
  if (cachedDevTempRoot) {
    return cachedDevTempRoot;
  }

  const projectRoot = findProjectRoot();
  cachedDevTempRoot = path.join(projectRoot, "temp");
  return cachedDevTempRoot;
}

function getExternalEditRoot() {
  if (!electronApp) {
    throw new Error("External editor manager not initialized");
  }

  const isPackaged =
    typeof electronApp.isPackaged === "boolean"
      ? electronApp.isPackaged
      : process.env.NODE_ENV !== "development";

  if (isPackaged) {
    return path.join(electronApp.getPath("temp"), "simpleshell", "external-edit");
  }

  return path.join(getDevelopmentTempRoot(), "external-edit");
}

async function removeEmptyDirectories(targetDir, stopDir) {
  if (!targetDir || !stopDir) {
    return;
  }

  const resolvedStop = path.resolve(stopDir);
  let current = path.resolve(targetDir);

  while (current.startsWith(resolvedStop) && current !== resolvedStop) {
    try {
      const entries = await fs.promises.readdir(current);
      if (entries.length > 0) {
        break;
      }
      await fs.promises.rmdir(current);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
        logToFile(
          `Failed to remove directory ${current}: ${error.message}`,
          "WARN",
        );
      }
      break;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
}

async function removeDirIfEmpty(dirPath) {
  if (!dirPath) {
    return;
  }

  try {
    const entries = await fs.promises.readdir(dirPath);
    if (entries.length === 0) {
      await fs.promises.rmdir(dirPath);
    }
  } catch (error) {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") {
      logToFile(`Failed to remove directory ${dirPath}: ${error.message}`, "WARN");
    }
  }
}

async function removeDirectoryRecursive(dirPath) {
  if (!dirPath) {
    return;
  }

  try {
    if (fs.promises.rm) {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
    } else {
      await fs.promises.rmdir(dirPath, { recursive: true });
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      logToFile(`Failed to remove directory ${dirPath}: ${error.message}`, "WARN");
    }
  }
}

function getWatcherKey(tabId, remotePath) {
  return `${tabId}::${remotePath}`;
}

function ensureInitialized() {
  if (!electronApp || !configManager || !sftpCore) {
    throw new Error("External editor manager not initialized");
  }
}

function sanitizePathSegment(segment) {
  return segment.replace(/[<>:"/\\|?*]/g, "_");
}

function toLocalRelativePath(remotePath) {
  if (!remotePath || remotePath === "/") {
    return "remote-file";
  }
  const trimmed = remotePath.replace(/^\/+/, "");
  const parts = trimmed.split("/").filter(Boolean).map(sanitizePathSegment);
  return parts.length > 0 ? path.join(...parts) : "remote-file";
}

async function ensureDirectoryExists(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function quoteFilePathForShell(filePath) {
  if (process.platform === "win32") {
    return `"${filePath.replace(/"/g, '""')}"`;
  }
  return `"${filePath.replace(/(["$`\\])/g, "\\$1")}"`;
}

async function downloadFile(tabId, remotePath, localPath) {
  const { sftp, sessionId } = await sftpCore.borrowSftpSession(tabId);
  try {
    await new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, {}, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
    logToFile(`Downloaded ${remotePath} to ${localPath}`, "INFO");
  } finally {
    if (sessionId) {
      sftpCore.releaseSftpSession(tabId, sessionId);
    }
  }
}

async function uploadFile(tabId, remotePath, localPath) {
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { sftp, sessionId } = await sftpCore.borrowSftpSession(tabId);
    try {
      await new Promise((resolve, reject) => {
        sftp.fastPut(localPath, remotePath, {}, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
      logToFile(`Uploaded ${localPath} back to ${remotePath}`, "INFO");
      if (sessionId) {
        sftpCore.releaseSftpSession(tabId, sessionId);
      }
      return;
    } catch (error) {
      lastError = error;
      logToFile(
        `Upload attempt ${attempt + 1} failed for ${remotePath}: ${error.message}`,
        "WARN",
      );
      if (!RETRYABLE_ERRORS.has(error.code)) {
        if (sessionId) {
          sftpCore.releaseSftpSession(tabId, sessionId);
        }
        break;
      }
      if (sessionId) {
        sftpCore.releaseSftpSession(tabId, sessionId);
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  if (lastError) {
    throw lastError;
  }
}

function emitSyncEvent(status, payload) {
  if (typeof sendToRenderer === "function") {
    sendToRenderer("external-editor:sync", {
      status,
      ...payload,
      timestamp: Date.now(),
    });
  }
}

function attachWatcher(entry) {
  if (entry.unwatch) {
    entry.unwatch();
  }
  const handler = (curr, prev) => {
    if (entry.suspended) return;
    if (curr.mtimeMs === prev.mtimeMs && curr.size === prev.size) {
      return;
    }
    entry.pendingStats = curr;
    scheduleUpload(entry);
  };
  fs.watchFile(entry.localPath, { interval: 500 }, handler);
  entry.unwatch = () => fs.unwatchFile(entry.localPath, handler);
}

function scheduleUpload(entry) {
  if (entry.suspended) return;
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }
  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    triggerUpload(entry).catch((error) => {
      logToFile(
        `Failed to trigger upload for ${entry.remotePath}: ${error.message}`,
        "ERROR",
      );
    });
  }, DEFAULT_DEBOUNCE_MS);
}

async function triggerUpload(entry) {
  if (entry.uploading) {
    entry.pendingAfterUpload = true;
    return;
  }
  entry.uploading = true;
  try {
    const stats = entry.pendingStats || (await fs.promises.stat(entry.localPath));
    entry.pendingStats = null;
    if (
      typeof entry.lastUploadedMtime === "number" &&
      stats.mtimeMs <= entry.lastUploadedMtime + 1
    ) {
      return;
    }
    await uploadFile(entry.tabId, entry.remotePath, entry.localPath);
    entry.lastUploadedMtime = stats.mtimeMs;
    emitSyncEvent("success", {
      tabId: entry.tabId,
      remotePath: entry.remotePath,
      localPath: entry.localPath,
      fileName: entry.fileName,
    });
  } catch (error) {
    emitSyncEvent("error", {
      tabId: entry.tabId,
      remotePath: entry.remotePath,
      localPath: entry.localPath,
      fileName: entry.fileName,
      error: error.message,
    });
    logToFile(
      `Auto sync failed for ${entry.remotePath}: ${error.message}`,
      "ERROR",
    );
  } finally {
    entry.uploading = false;
    if (entry.pendingAfterUpload) {
      entry.pendingAfterUpload = false;
      scheduleUpload(entry);
    }
  }
}

async function launchExternalEditor(entry, command) {
  const quotedPath = quoteFilePathForShell(entry.localPath);
  if (command && command.trim().length > 0) {
    const prepared = command.includes(FILE_PLACEHOLDER)
      ? command.replace(new RegExp(FILE_PLACEHOLDER, "g"), quotedPath)
      : `${command} ${quotedPath}`;

    await new Promise((resolve, reject) => {
      try {
        const child = spawn(prepared, {
          shell: true,
          detached: true,
          stdio: "ignore",
        });
        child.on("error", (error) => {
          reject(error);
        });
        child.unref();
        entry.child = child;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    return;
  }

  if (!shellModule || typeof shellModule.openPath !== "function") {
    throw new Error("No external editor configured and shell.openPath unavailable");
  }
  const result = await shellModule.openPath(entry.localPath);
  if (result) {
    throw new Error(result);
  }
}

async function openFileInExternalEditor(tabId, remotePath) {
  ensureInitialized();
  if (!tabId) {
    throw new Error("Missing tabId");
  }
  if (!remotePath) {
    throw new Error("Missing remotePath");
  }

  const settings = configManager.loadUISettings
    ? configManager.loadUISettings()
    : {};
  const externalEditorSettings = settings?.externalEditor || {};
  const isEnabled =
    externalEditorSettings.enabled === true ||
    settings?.externalEditorEnabled === true;
  if (!isEnabled) {
    throw new Error("External editor is disabled in settings");
  }
  const command = (externalEditorSettings.command || settings?.externalEditorCommand || "").trim();

  const externalRoot = getExternalEditRoot();
  const localBase = path.join(externalRoot, String(tabId));

  await ensureDirectoryExists(localBase);

  const relative = toLocalRelativePath(remotePath);
  const localPath = path.join(localBase, relative);
  await ensureDirectoryExists(path.dirname(localPath));

  await downloadFile(tabId, remotePath, localPath);
  const stats = await fs.promises.stat(localPath);

  const key = getWatcherKey(tabId, remotePath);
  const fileName = path.posix.basename(remotePath);
  let entry = watchers.get(key);
  if (entry) {
    entry.suspended = true;
    if (entry.unwatch) {
      entry.unwatch();
      entry.unwatch = null;
    }
  }
  entry = {
    tabId,
    remotePath,
    localPath,
    fileName,
    baseDir: localBase,
    suspended: false,
    uploading: false,
    pendingAfterUpload: false,
    debounceTimer: null,
    lastUploadedMtime: stats.mtimeMs,
    child: null,
    unwatch: null,
    pendingStats: null,
  };
  watchers.set(key, entry);
  attachWatcher(entry);

  await launchExternalEditor(entry, command);

  emitSyncEvent("opened", {
    tabId,
    remotePath,
    localPath,
    fileName,
  });

  return { success: true, localPath };
}

async function cleanupWatcher(entry) {
  if (!entry) return;

  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }

  if (entry.unwatch) {
    entry.unwatch();
  }

  entry.debounceTimer = null;
  entry.unwatch = null;
  entry.child = null;

  if (entry.localPath) {
    try {
      await fs.promises.unlink(entry.localPath);
      logToFile(`Removed temp file ${entry.localPath}`, "INFO");
    } catch (error) {
      if (error.code !== "ENOENT") {
        logToFile(
          `Failed to remove temp file ${entry.localPath}: ${error.message}`,
          "WARN",
        );
      }
    }

    const baseDir = entry.baseDir;
    try {
      await removeEmptyDirectories(path.dirname(entry.localPath), baseDir);
    } catch (error) {
      logToFile(
        `Failed to prune directories for ${entry.localPath}: ${error.message}`,
        "WARN",
      );
    }

    try {
      await removeDirIfEmpty(baseDir);
    } catch (error) {
      logToFile(
        `Failed to clean base dir ${baseDir}: ${error.message}`,
        "WARN",
      );
    }
  }
}

async function cleanup() {
  const entries = Array.from(watchers.values());
  watchers.clear();

  await Promise.all(entries.map((entry) => cleanupWatcher(entry)));

  const externalRoot = getExternalEditRoot();
  const isPackaged =
    typeof electronApp.isPackaged === "boolean"
      ? electronApp.isPackaged
      : process.env.NODE_ENV !== "development";

  await removeDirectoryRecursive(externalRoot);

  if (!isPackaged) {
    await removeDirectoryRecursive(getDevelopmentTempRoot());
  } else {
    await removeDirIfEmpty(path.dirname(externalRoot));
  }
}

function init({ app, logger, configManager: cfg, sftpCore: core, shell, sendToRenderer: send }) {
  electronApp = app;
  if (logger && typeof logger.logToFile === "function") {
    logToFile = logger.logToFile;
  }
  configManager = cfg;
  sftpCore = core;
  shellModule = shell;
  sendToRenderer = send;
}

module.exports = {
  init,
  openFileInExternalEditor,
  cleanup,
};
