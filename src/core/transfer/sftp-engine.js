const nativeSftpClient = require("../utils/nativeSftpClient");

let logToFile = () => {};

const TRANSFER_TYPE = {
  UPLOAD: "upload",
  DOWNLOAD: "download",
  COPY: "copy",
  SYNC: "sync",
};

const TRANSFER_STATUS = {
  QUEUED: "queued",
  PREPARING: "preparing",
  TRANSFERRING: "transferring",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

function init(logger) {
  logToFile =
    logger && typeof logger.logToFile === "function" ? logger.logToFile : () => {};
  logToFile("sftpEngine compatibility shim initialized", "INFO");
}

function startSftpHealthCheck() {}

function stopSftpHealthCheck() {}

function getSftpRuntimeStats() {
  return {
    poolCount: 0,
    sessionCount: 0,
    pendingQueueCount: 0,
    pendingOperationCount: 0,
    inProgressOperationCount: 0,
    sessionLockCount: 0,
    borrowLockCount: 0,
    healthCheckTimerActive: false,
    native: true,
  };
}

async function shutdownAllSftpResources() {
  return {
    cleanedTabs: 0,
    before: getSftpRuntimeStats(),
    after: getSftpRuntimeStats(),
    native: true,
  };
}

async function getSftpSession(tabId) {
  return {
    tabId,
    backend: "rust-sidecar",
    native: true,
  };
}

async function getRawSftpSession(tabId) {
  return getSftpSession(tabId);
}

async function getSftpSessionInfo(tabId) {
  return getSftpSession(tabId);
}

async function optimizeSftpSessions() {
  return { success: true, native: true };
}

async function closeSftpSession(tabId) {
  void tabId;
  return { success: true, native: true };
}

async function closeAllSftpSessionsForTab(tabId) {
  void tabId;
  return { success: true, native: true };
}

function clearPendingOperationsForTab(tabId) {
  void tabId;
}

async function ensureSftpSession(tabId) {
  return getSftpSession(tabId);
}

function calculateDynamicTimeout() {
  return 30000;
}

async function borrowSftpSession(tabId) {
  return {
    sftp: await getSftpSession(tabId),
    sessionId: null,
    native: true,
  };
}

function releaseSftpSession(tabId, sessionId) {
  void tabId;
  void sessionId;
}

async function enqueueSftpOperation(tabId, operation) {
  void tabId;
  if (typeof operation === "function") {
    return Promise.resolve().then(operation);
  }
  return { success: true, queued: false, native: true };
}

async function listFiles(tabId, remotePath) {
  return nativeSftpClient.listFiles(tabId, remotePath);
}

async function copyFile(tabId, sourcePath, targetPath) {
  return nativeSftpClient.copyFile(tabId, sourcePath, targetPath);
}

async function deleteFile(tabId, remotePath, isDirectory = false) {
  return nativeSftpClient.deleteFile(tabId, remotePath, isDirectory);
}

async function createFolder(tabId, remotePath) {
  return nativeSftpClient.createFolder(tabId, remotePath);
}

async function createFile(tabId, remotePath) {
  return nativeSftpClient.createFile(tabId, remotePath);
}

async function getFilePermissions(tabId, remotePath) {
  return nativeSftpClient.getFilePermissions(tabId, remotePath);
}

async function getAbsolutePath(tabId, remotePath) {
  return nativeSftpClient.getAbsolutePath(tabId, remotePath);
}

async function readFileContent(tabId, remotePath) {
  return nativeSftpClient.readFileContent(tabId, remotePath);
}

async function readFileAsBase64(tabId, remotePath) {
  return nativeSftpClient.readFileAsBase64(tabId, remotePath);
}

async function saveFileContent(tabId, remotePath, content) {
  return nativeSftpClient.saveFileContent(tabId, remotePath, content);
}

class SftpEngine {}
class SftpTransfer {}

const sftpEngine = {};

module.exports = {
  init,
  startSftpHealthCheck,
  stopSftpHealthCheck,
  shutdownAllSftpResources,
  getSftpRuntimeStats,
  getSftpSession,
  getRawSftpSession,
  getSftpSessionInfo,
  optimizeSftpSessions,
  closeSftpSession,
  closeAllSftpSessionsForTab,
  enqueueSftpOperation,
  clearPendingOperationsForTab,
  ensureSftpSession,
  calculateDynamicTimeout,
  borrowSftpSession,
  releaseSftpSession,
  listFiles,
  copyFile,
  deleteFile,
  createFolder,
  createFile,
  getFilePermissions,
  getAbsolutePath,
  readFileContent,
  readFileAsBase64,
  saveFileContent,
  SftpEngine,
  sftpEngine,
  SftpTransfer,
  TRANSFER_TYPE,
  TRANSFER_STATUS,
};
