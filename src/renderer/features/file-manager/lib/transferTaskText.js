// Pure helpers shared by the file-manager transfer hooks. Each helper receives
// the translator explicitly so callers keep their own `t` identity.

export function normalizeExistsResponse(result) {
  if (typeof result === "boolean") {
    return result;
  }
  if (result && typeof result === "object") {
    return result.exists === true;
  }
  return false;
}

export function isTransferCancellationError(error, t) {
  // 检查错误对象
  if (!error) return false;

  // 如果是字符串类型的错误消息
  if (typeof error === "string") {
    return (
      error.includes("cancel") ||
      error.includes("abort") ||
      error.includes(t("fileManager.errors.userCancelled")) ||
      error.includes(t("fileManager.errors.transferCancelled"))
    );
  }

  // 如果是带有message属性的错误对象
  if (error.message) {
    return (
      error.message.includes("cancel") ||
      error.message.includes("abort") ||
      error.message.includes(t("fileManager.errors.userCancelled")) ||
      error.message.includes(t("fileManager.errors.transferCancelled"))
    );
  }

  // 如果是API响应对象
  if (error.error) {
    return (
      error.error.includes("cancel") ||
      error.error.includes("abort") ||
      error.error.includes(t("fileManager.errors.userCancelled")) ||
      error.error.includes(t("fileManager.errors.transferCancelled")) ||
      error.userCancelled ||
      error.cancelled
    );
  }

  // 检查特殊标志
  return error.userCancelled || error.cancelled;
}

export function buildBatchDownloadStatusText(
  t,
  { processedFiles = 0, totalFiles = 0, currentFile = "" } = {},
) {
  if (currentFile) {
    return t("fileManager.transfer.status.downloadingFile", {
      name: currentFile,
    });
  }
  if (totalFiles > 1) {
    const completedCount = Math.max(0, Number(processedFiles) || 0);
    return t("fileManager.transfer.status.downloadingBatch", {
      completed: Math.min(completedCount, totalFiles),
      total: totalFiles,
    });
  }
  return t("fileManager.transfer.status.downloading");
}

export function buildFolderDownloadStatusText(
  t,
  { currentFile = "", processedFiles = 0, totalFiles = 0 } = {},
) {
  if (currentFile) {
    return t("fileManager.transfer.status.downloadingFile", {
      name: currentFile,
    });
  }
  if (totalFiles > 0) {
    const completedCount = Math.max(0, Number(processedFiles) || 0);
    return t("fileManager.transfer.status.processingFolder", {
      completed: Math.min(completedCount, totalFiles),
      total: totalFiles,
    });
  }
  return t("fileManager.transfer.status.scanningRemoteFolder");
}

export function getDropValidationMessage(t, rejectedItem) {
  const name =
    rejectedItem?.name ||
    rejectedItem?.relativePath ||
    rejectedItem?.localPath ||
    t("fileManager.messages.unknownFile");
  if (rejectedItem?.reason === "missing-local-path") {
    return t("fileManager.errors.dragDropLocalPathRequired");
  }
  if (rejectedItem?.reason === "permission-denied") {
    return t("fileManager.errors.dragDropPermissionDenied", {
      name,
    });
  }
  if (rejectedItem?.reason === "unsupported-file-type") {
    return t("fileManager.errors.dragDropUnsupportedItem", {
      name,
    });
  }
  return t("fileManager.errors.dragDropValidationFailed", {
    reason: rejectedItem?.message || t("fileManager.errors.unknownError"),
  });
}
