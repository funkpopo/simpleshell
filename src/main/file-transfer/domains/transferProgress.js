/** TransferProgress: explicit dependencies supplied by the service facade. */
function createTransferProgress(
  dependencies,
  {
    normalizeTransferName,
    DEFAULT_PROGRESS_INTERVAL_MS,
    PREPARATION_PROGRESS_PERCENT,
    IPC_EVENT_CHANNELS,
  },
) {
  return new (class TransferProgress {
    constructor() {
      this.dependencies = dependencies;
    }
    _setTransferPreparation(transferKey, totalSteps = 0) {
      const transfer = this.dependencies._getTransfer(transferKey);
      if (!transfer) return null;

      transfer.preparationTotal = Math.max(0, totalSteps || 0);
      transfer.preparationCompleted = 0;
      return transfer;
    }
    _advanceTransferPreparation(transferKey, steps = 1) {
      const transfer = this.dependencies._getTransfer(transferKey);
      if (!transfer) return null;

      transfer.preparationCompleted = Math.min(
        transfer.preparationTotal,
        transfer.preparationCompleted + Math.max(0, steps || 0),
      );
      return transfer;
    }
    _getTransferDisplayName(transfer, fallback = "") {
      const fallbackName = normalizeTransferName(fallback);
      if (!transfer) {
        return fallbackName;
      }

      return (
        normalizeTransferName(transfer.lastDisplayName) ||
        normalizeTransferName(transfer.displayName) ||
        normalizeTransferName(transfer.lastCurrentFile) ||
        fallbackName
      );
    }
    _emitTransferProgress(
      transferKey,
      {
        channel = null,
        force = false,
        isBatch = false,
        fileName = "",
        currentFile = "",
        currentFileIndex = 0,
        extra = {},
      } = {},
    ) {
      const transfer = this.dependencies._getTransfer(transferKey);
      if (!transfer) return;

      const normalizedFileName = normalizeTransferName(fileName);
      const normalizedCurrentFile = normalizeTransferName(currentFile);

      if (normalizedFileName) {
        transfer.lastDisplayName = normalizedFileName;
      }
      if (normalizedCurrentFile) {
        transfer.lastCurrentFile = normalizedCurrentFile;
      }

      const resolvedFileName =
        normalizedFileName ||
        this._getTransferDisplayName(transfer) ||
        normalizedCurrentFile;

      const now = Date.now();
      if (!force && now - transfer.lastEmitAt < DEFAULT_PROGRESS_INTERVAL_MS) {
        return;
      }

      transfer.lastEmitAt = now;

      const elapsedSec = Math.max(0.001, (now - transfer.startAt) / 1000);
      const speed = transfer.networkBytes / elapsedSec;
      const remainingBytes = Math.max(
        0,
        transfer.totalBytes - transfer.transferredBytes,
      );
      const remainingTime = speed > 0 ? remainingBytes / speed : 0;
      const byteProgress =
        transfer.totalBytes > 0
          ? Math.min(
              100,
              (transfer.transferredBytes / transfer.totalBytes) * 100,
            )
          : transfer.processedFiles >= transfer.totalFiles
            ? 100
            : 0;
      const hasPreparation = transfer.preparationTotal > 0;
      const preparationRatio = hasPreparation
        ? Math.min(
            1,
            transfer.preparationCompleted /
              Math.max(1, transfer.preparationTotal),
          )
        : 0;
      let progress = byteProgress;

      if (progress < 100 && hasPreparation) {
        const preparationProgress =
          preparationRatio * PREPARATION_PROGRESS_PERCENT;
        progress =
          byteProgress > 0
            ? Math.max(
                preparationProgress,
                PREPARATION_PROGRESS_PERCENT +
                  (byteProgress / 100) * (100 - PREPARATION_PROGRESS_PERCENT),
              )
            : preparationProgress;
      }

      const payload = {
        tabId: transfer.tabId,
        transferKey,
        progress:
          transfer.processedFiles < transfer.totalFiles
            ? Math.min(99.9, progress)
            : progress,
        status: transfer.status,
        algorithm: transfer.algorithm,
        verified:
          transfer.verifiedFiles > 0 &&
          transfer.verifiedFiles === transfer.totalFiles,
        integrity: transfer.integrity || null,
        resumeIds: [...transfer.resumeIds],
        type: transfer.type,
        fileName: resolvedFileName,
        currentFile,
        transferredBytes: transfer.transferredBytes,
        totalBytes: transfer.totalBytes,
        transferSpeed: speed,
        remainingTime,
        currentFileIndex,
        processedFiles: transfer.processedFiles,
        totalFiles: transfer.totalFiles,
        preparationCompleted: transfer.preparationCompleted,
        preparationTotal: transfer.preparationTotal,
        isBatch,
        ...extra,
      };

      const finalChannel = channel || transfer.progressChannel;
      this.dependencies._safeSend(transfer.sender, finalChannel, payload);
      this.dependencies._safeSend(
        transfer.sender,
        IPC_EVENT_CHANNELS.SFTP_TRANSFER_STATE,
        payload,
      );
    }
  })();
}
module.exports = createTransferProgress;
