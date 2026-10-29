const getNormalizedTransferFileCount = (transfer) => {
  if (!transfer) return 0;

  const totalFiles = Number(transfer.totalFiles);
  if (Number.isFinite(totalFiles) && totalFiles > 0) {
    return totalFiles;
  }

  if (Array.isArray(transfer.fileList) && transfer.fileList.length > 0) {
    return transfer.fileList.length;
  }

  if (
    totalFiles === 0 &&
    transfer.progress >= 100 &&
    !transfer.error &&
    !transfer.isCancelled
  ) {
    return 0;
  }

  return 1;
};

const sumTransferFileCount = (transfers = []) =>
  transfers.reduce(
    (sum, transfer) => sum + getNormalizedTransferFileCount(transfer),
    0,
  );

/**
 * 逐文件清单统计（主进程推送的 fileList）。无清单时返回 null。
 */
const getTransferFileListStats = (transfer) => {
  const fileList = transfer?.fileList;
  if (!Array.isArray(fileList) || fileList.length === 0) return null;
  let completed = 0;
  let failed = 0;
  for (const item of fileList) {
    if (item.status === "completed") completed += 1;
    else if (item.status === "failed") failed += 1;
  }
  return { completed, failed, total: fileList.length };
};

/**
 * 展示用的「已完成/总数」中的已完成文件数（TransferSidebar 与
 * GlobalTransferFloat 共用）。
 * 并发传输时 currentFileIndex 是「最近有进度的文件」序号，会来回跳动，
 * 因此只采用单调递增的口径：逐文件清单 > processedFiles。
 */
const getDisplayCompletedFileCount = (transfer) => {
  if (!transfer) return 0;

  const totalFiles = transfer.totalFiles || 0;
  const isCompleted = transfer.progress >= 100;
  const hasError = !!transfer.error;
  const isCancelled = !!transfer.isCancelled;
  const listStats = getTransferFileListStats(transfer);

  if (listStats) {
    return listStats.completed;
  }

  if (isCompleted && !hasError && !isCancelled && totalFiles > 0) {
    return totalFiles;
  }

  // 确保已完成数不超过总数
  return Math.min(Math.max(0, Number(transfer.processedFiles) || 0), totalFiles);
};

export {
  getNormalizedTransferFileCount,
  sumTransferFileCount,
  getDisplayCompletedFileCount,
  getTransferFileListStats,
};
