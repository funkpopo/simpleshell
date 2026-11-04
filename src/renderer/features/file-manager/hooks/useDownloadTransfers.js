import { useCallback } from "react";
import { normalizeTransferProgress } from "../../transfers/lib/transferTaskHelpers.js";
import { buildTransferDisplayName } from "../../../../shared/transferNameUtils";
import { joinPath } from "../fileManagerUtils.js";
import { buildBatchDownloadStatusText as formatBatchDownloadStatusText } from "../lib/transferTaskText.js";

/** Single and batch downloads of the selected (non-directory) files. */
export default function useDownloadTransfers({
  tabId,
  showNotification,
  sshConnection,
  currentPath,
  getSelectedFiles,
  t,
  addTransferProgress,
  updateTransferProgress,
  isUserCancellationError,
  markTransferCancelled,
  markTransferFailed,
  markTransferCompleted,
  showDownloadedLocationNotification,
}) {
  const buildBatchDownloadStatusText = useCallback(
    (options) => formatBatchDownloadStatusText(t, options),
    [t],
  );
  const handleDownload = async () => {
    const filesToDownload = getSelectedFiles().filter((f) => !f.isDirectory);
    if (filesToDownload.length === 0 || !sshConnection) return;
    const savedCurrentPath = currentPath;
    if (filesToDownload.length === 1) {
      const savedSelectedFile = filesToDownload[0];
      let activeDownloadTransferId = null;
      try {
        const fullPath = joinPath(savedCurrentPath, savedSelectedFile.name);
        if (!window.terminalAPI?.downloadFile) {
          throw new Error(t("fileManager.errors.fileApiNotAvailable"));
        }
        showNotification(
          t("fileManager.messages.startDownloadNamed", {
            name: savedSelectedFile.name,
          }),
          "info",
          2000,
        );
        const transferId = addTransferProgress({
          type: "download",
          progress: 0,
          fileName: savedSelectedFile.name,
          statusText: t("fileManager.transfer.status.waitingForSaveLocation"),
          currentFile: savedSelectedFile.name,
          transferredBytes: 0,
          totalBytes: savedSelectedFile.size || 0,
          transferSpeed: 0,
          remainingTime: 0,
          processedFiles: 0,
          totalFiles: 1,
        });
        activeDownloadTransferId = transferId;
        const result = await window.terminalAPI.downloadFile(
          tabId,
          fullPath,
          (
            progress,
            fileName,
            transferredBytes,
            totalBytes,
            transferSpeed,
            remainingTime,
            processedFiles,
            totalFiles,
            transferKey,
          ) => {
            updateTransferProgress(transferId, {
              ...normalizeTransferProgress({
                progress,
                transferredBytes,
                totalBytes,
                transferSpeed,
                remainingTime,
                processedFiles,
                transferKey,
              }),
              fileName: fileName || savedSelectedFile.name,
              statusText: t("fileManager.transfer.status.downloading"),
              currentFile: fileName || savedSelectedFile.name,
              totalFiles: Math.max(1, totalFiles || 1),
            });
          },
          Number.isFinite(savedSelectedFile.size) && savedSelectedFile.size >= 0
            ? savedSelectedFile.size
            : 0,
        );
        if (result?.cancelled || isUserCancellationError(result)) {
          markTransferCancelled(transferId, {
            statusText: t("fileManager.transfer.status.downloadCancelled"),
            cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
          });
          showNotification(
            t("fileManager.errors.downloadCancelledByUser"),
            "info",
            3000,
          );
        } else if (result?.success) {
          markTransferCompleted(transferId, {
            fileName: savedSelectedFile.name,
            statusText: t("fileManager.transfer.status.completed"),
            currentFile: "",
            processedFiles: 1,
            totalFiles: 1,
            downloadPath: result.downloadPath || "",
          });
          void showDownloadedLocationNotification({
            itemName: savedSelectedFile.name,
            downloadPath: result.downloadPath,
            successMessage: t("fileManager.messages.downloadSavedToLocal", {
              name: savedSelectedFile.name,
            }),
          });
        } else {
          const errorMessage =
            result?.error || t("fileManager.errors.downloadFailed");
          markTransferFailed(transferId, errorMessage, {
            statusText: t("fileManager.transfer.status.downloadFailed"),
          });
          showNotification(
            `${t("fileManager.errors.downloadFailed")}: ${errorMessage}`,
            "error",
            6000,
          );
        }
      } catch (error) {
        const errorMessage =
          error?.message || t("fileManager.errors.unknownError");
        if (isUserCancellationError(error)) {
          markTransferCancelled(activeDownloadTransferId, {
            statusText: t("fileManager.transfer.status.downloadCancelled"),
            cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
          });
          showNotification(
            t("fileManager.errors.downloadCancelledByUser"),
            "info",
            3000,
          );
        } else if (!errorMessage.includes("reply was never sent")) {
          markTransferFailed(activeDownloadTransferId, errorMessage, {
            statusText: t("fileManager.transfer.status.downloadFailed"),
          });
          showNotification(
            `${t("fileManager.errors.downloadFailed")}: ${errorMessage}`,
            "error",
            6000,
          );
        }
      }
    } else {
      let batchTransferId = null;
      try {
        showNotification(
          t("fileManager.messages.startDownload", {
            count: filesToDownload.length,
          }),
          "info",
        );
        if (!window.terminalAPI?.downloadFiles) {
          throw new Error(t("fileManager.errors.fileApiNotAvailable"));
        }
        const batchDisplayName =
          buildTransferDisplayName(
            filesToDownload.map((file) => file.name),
            ({ firstName, count }) =>
              t("fileManager.multipleItemsName", {
                name: firstName,
                count,
                itemLabel: t("fileManager.itemLabels.files"),
              }),
          ) ||
          t("fileManager.messages.batchDownloadTitle", {
            count: filesToDownload.length,
          });
        batchTransferId = addTransferProgress({
          type: "download",
          progress: 0,
          fileName: batchDisplayName,
          statusText: t("fileManager.transfer.status.waitingForTargetFolder"),
          currentFile: "",
          transferredBytes: 0,
          totalBytes: filesToDownload.reduce(
            (sum, file) => sum + (file.size || 0),
            0,
          ),
          transferSpeed: 0,
          remainingTime: 0,
          processedFiles: 0,
          totalFiles: filesToDownload.length,
        });
        const files = filesToDownload.map((file) => ({
          remotePath: joinPath(savedCurrentPath, file.name),
          fileName: file.name,
          size: file.size || 0,
        }));
        const result = await window.terminalAPI.downloadFiles(
          tabId,
          files,
          (
            progress,
            fileName,
            transferredBytes,
            totalBytes,
            transferSpeed,
            remainingTime,
            processedFiles,
            totalFiles,
            transferKey,
          ) => {
            updateTransferProgress(batchTransferId, {
              ...normalizeTransferProgress({
                progress,
                transferredBytes,
                totalBytes,
                transferSpeed,
                remainingTime,
                processedFiles,
                transferKey,
              }),
              fileName: batchDisplayName,
              statusText: buildBatchDownloadStatusText({
                processedFiles,
                totalFiles,
                currentFile: fileName,
              }),
              currentFile: fileName || "",
              totalFiles: Math.max(1, totalFiles || filesToDownload.length),
            });
          },
        );
        if (result?.cancelled || isUserCancellationError(result)) {
          markTransferCancelled(batchTransferId, {
            statusText: t("fileManager.transfer.status.batchDownloadCancelled"),
            cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
          });
          showNotification(
            t("fileManager.errors.downloadCancelledByUser"),
            "info",
            3000,
          );
        } else if (result?.partialSuccess) {
          const completedCount = Math.max(0, result.completed || 0);
          const failedCount = Math.max(0, result.failed || 0);
          const warningMessage = t(
            "fileManager.messages.partialDownloadCompleted",
            {
              completed: completedCount,
              total: completedCount + failedCount,
            },
          );
          markTransferCompleted(
            batchTransferId,
            {
              fileName: batchDisplayName,
              statusText: warningMessage,
              warning: warningMessage,
              currentFile: "",
              processedFiles: completedCount + failedCount,
              totalFiles: Math.max(1, filesToDownload.length),
            },
            6000,
          );
          showNotification(warningMessage, "warning", 6000);
          void showDownloadedLocationNotification({
            itemName: t("fileManager.messages.batchDownloadItemName"),
            downloadPath: result.targetDir,
            successMessage: result.targetDir
              ? t("fileManager.messages.batchDownloadSavedToPath", {
                  path: result.targetDir,
                })
              : warningMessage,
            severity: "warning",
          });
        } else if (result?.success) {
          const completedCount = Math.max(
            0,
            result.completed || filesToDownload.length,
          );
          markTransferCompleted(batchTransferId, {
            fileName: batchDisplayName,
            statusText: t("fileManager.transfer.status.completed"),
            currentFile: "",
            processedFiles: completedCount,
            totalFiles: filesToDownload.length,
          });
          showNotification(
            t("fileManager.messages.downloadSuccessCount", {
              count: completedCount,
            }),
            "success",
            3000,
          );
          void showDownloadedLocationNotification({
            itemName: t("fileManager.messages.batchDownloadItemName"),
            downloadPath: result.targetDir,
            successMessage: result.targetDir
              ? t("fileManager.messages.batchDownloadSavedToPath", {
                  path: result.targetDir,
                })
              : t("fileManager.messages.downloadSuccessCount", {
                  count: completedCount,
                }),
          });
        } else {
          const errorMessage =
            result?.error || t("fileManager.errors.batchDownloadFailed");
          markTransferFailed(batchTransferId, errorMessage, {
            statusText: t("fileManager.transfer.status.batchDownloadFailed"),
          });
          showNotification(
            `${t("fileManager.errors.batchDownloadFailed")}: ${errorMessage}`,
            "error",
            6000,
          );
        }
      } catch (error) {
        const errorMessage =
          error?.message || t("fileManager.errors.unknownError");
        if (isUserCancellationError(error)) {
          markTransferCancelled(batchTransferId, {
            statusText: t("fileManager.transfer.status.batchDownloadCancelled"),
            cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
          });
          showNotification(
            t("fileManager.errors.downloadCancelledByUser"),
            "info",
            3000,
          );
        } else if (!errorMessage.includes("reply was never sent")) {
          markTransferFailed(batchTransferId, errorMessage, {
            statusText: t("fileManager.transfer.status.batchDownloadFailed"),
          });
          showNotification(
            `${t("fileManager.errors.batchDownloadFailed")}: ${errorMessage}`,
            "error",
            6000,
          );
        }
      }
    }
  };
  return handleDownload;
}
