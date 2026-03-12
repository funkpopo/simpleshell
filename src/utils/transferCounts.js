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

export { getNormalizedTransferFileCount, sumTransferFileCount };
