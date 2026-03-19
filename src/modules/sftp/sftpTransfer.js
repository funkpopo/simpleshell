const filemanagementService = require("../filemanagement/filemanagementService");

let logToFile = () => {};

function init(logger) {
  logToFile =
    logger && typeof logger.logToFile === "function" ? logger.logToFile : () => {};
  logToFile("sftpTransfer compatibility shim initialized", "INFO");
}

async function handleDownloadFile(event, tabId, remotePath) {
  return filemanagementService.downloadFile(event, tabId, remotePath);
}

async function handleDownloadFiles(event, tabId, files) {
  return filemanagementService.downloadFiles(event, tabId, files);
}

async function handleUploadFile(event, tabId, targetFolder, progressChannel) {
  return filemanagementService.uploadFile(
    event,
    tabId,
    targetFolder,
    progressChannel,
  );
}

async function handleUploadFolder(event, tabId, targetFolder, progressChannel) {
  return filemanagementService.uploadFolder(
    event,
    tabId,
    targetFolder,
    progressChannel,
  );
}

async function handleDownloadFolder(event, tabId, remotePath) {
  return filemanagementService.downloadFolder(event, tabId, remotePath);
}

async function handleCancelTransfer(event, tabId, transferKey) {
  return filemanagementService.cancelTransfer(event, tabId, transferKey);
}

async function cancelTransfer(tabId, transferKey) {
  return filemanagementService.cancelTransfer(null, tabId, transferKey);
}

async function cleanupActiveTransfersForTab(tabId) {
  const result = filemanagementService.cleanupTransfersForTab(tabId);
  return {
    success: true,
    cleanedCount: result?.cleanedCount || 0,
    remainingTransfers: result?.remainingTransfers || 0,
  };
}

async function cleanupAllActiveTransfers(options = {}) {
  const before = filemanagementService.getTransferRuntimeStats();
  filemanagementService.cleanup();
  const after = filemanagementService.getTransferRuntimeStats();
  return {
    success: true,
    cleanedCount: before?.activeTransferCount || 0,
    stoppedStreams: before?.activeStreamCount || 0,
    reason: options.reason || "cleanup",
    remainingTransfers: after?.activeTransferCount || 0,
  };
}

function getTransferRuntimeStats() {
  return filemanagementService.getTransferRuntimeStats();
}

module.exports = {
  init,
  downloadFile: handleDownloadFile,
  downloadFiles: handleDownloadFiles,
  uploadFile: handleUploadFile,
  uploadFolder: handleUploadFolder,
  downloadFolder: handleDownloadFolder,
  cancelTransfer,
  handleDownloadFile,
  handleDownloadFiles,
  handleUploadFile,
  handleUploadFolder,
  handleDownloadFolder,
  handleCancelTransfer,
  cleanupActiveTransfersForTab,
  cleanupAllActiveTransfers,
  getTransferRuntimeStats,
  getResumableTransfers: () => [],
  resumeTransfer: async () => ({
    success: false,
    error: "Legacy resumable transfer manager has been removed",
  }),
  getTransferStatistics: () => null,
};
