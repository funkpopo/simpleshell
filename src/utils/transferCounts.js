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
 * 展示用的「已完成/总数」中的已完成文件数。
 * TransferSidebar 与 GlobalTransferFloat 的传输卡片共用；
 * GlobalTransferFloat 对 upload-multifile 类型采用 currentFileIndex 口径
 * （通过 multiFileUsesCurrentIndex 开启）。
 */
const getDisplayCompletedFileCount = (
  transfer,
  { multiFileUsesCurrentIndex = false } = {},
) => {
  if (!transfer) return 0;

  const totalFiles = transfer.totalFiles || 0;
  const isCompleted = transfer.progress >= 100;
  const hasError = !!transfer.error;
  const isCancelled = !!transfer.isCancelled;

  if (isCompleted && !hasError && !isCancelled && totalFiles > 0) {
    return totalFiles;
  }

  if (multiFileUsesCurrentIndex && transfer.type === "upload-multifile") {
    return Math.min(Math.max(0, transfer.currentFileIndex || 0), totalFiles);
  }

  // 确保已完成数不超过总数
  return Math.min(
    Math.max(
      Number(transfer.processedFiles) || 0,
      Math.max(0, (transfer.currentFileIndex || 1) - 1),
    ),
    totalFiles,
  );
};

export {
  getNormalizedTransferFileCount,
  sumTransferFileCount,
  getDisplayCompletedFileCount,
};
