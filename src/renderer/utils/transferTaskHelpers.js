// FileManager/FilePreview 传输流程共享工具:
// 归一化进度回调字段,并统一"取消/失败/完成 + 延迟清理"的传输状态更新样板。

const NON_NEGATIVE_FIELDS = [
  "transferredBytes",
  "totalBytes",
  "transferSpeed",
  "remainingTime",
  "currentFileIndex",
  "processedFiles",
  "totalFiles",
];

// 仅归一化 raw 中出现的字段,避免向传输条目写入调用方并不维护的键
export const normalizeTransferProgress = (raw = {}) => {
  const normalized = {};
  if ("progress" in raw) {
    normalized.progress = Math.max(0, Math.min(100, raw.progress || 0));
  }
  for (const field of NON_NEGATIVE_FIELDS) {
    if (field in raw) {
      normalized[field] = Math.max(0, raw[field] || 0);
    }
  }
  if ("transferKey" in raw) {
    normalized.transferKey = raw.transferKey || "";
  }
  return normalized;
};

// Electron 主进程 handler 未回包时渲染进程收到的错误,不应作为传输失败提示用户
export const isSilentIpcReplyError = (error) =>
  Boolean(error?.message?.includes("reply was never sent"));

export const createTransferUiHelpers = ({
  updateTransferProgress,
  scheduleTransferCleanup,
}) => {
  const markTransferCancelled = (
    transferId,
    { statusText, cancelMessage, cleanupDelay = 3000 } = {},
  ) => {
    if (!transferId) return;
    updateTransferProgress(transferId, {
      isCancelled: true,
      statusText,
      cancelMessage,
    });
    scheduleTransferCleanup(transferId, cleanupDelay);
  };

  const markTransferFailed = (
    transferId,
    errorMessage,
    { statusText, cleanupDelay = 5000 } = {},
  ) => {
    if (!transferId) return;
    updateTransferProgress(transferId, {
      error: errorMessage,
      statusText,
    });
    scheduleTransferCleanup(transferId, cleanupDelay);
  };

  const markTransferCompleted = (
    transferId,
    updates = {},
    cleanupDelay = 3000,
  ) => {
    if (!transferId) return;
    updateTransferProgress(transferId, {
      progress: 100,
      ...updates,
    });
    scheduleTransferCleanup(transferId, cleanupDelay);
  };

  return { markTransferCancelled, markTransferFailed, markTransferCompleted };
};
