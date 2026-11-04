import { useCallback } from "react";
import { normalizeTransferProgress } from "../../transfers/lib/transferTaskHelpers.js";
import { joinPath } from "../fileManagerUtils.js";
import { buildFolderDownloadStatusText as formatFolderDownloadStatusText } from "../lib/transferTaskText.js";

/** Sequential downloads of the selected remote folders with a summary. */
export default function useFolderDownloads({
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
  handleDownload,
}) {
  const buildFolderDownloadStatusText = useCallback(
    (options) => formatFolderDownloadStatusText(t, options),
    [t],
  );
  const handleDownloadFolder = async () => {
    if (!sshConnection) {
      showNotification(t("fileManager.errors.noConnection"), "error");
      return;
    }
    const foldersToDownload = getSelectedFiles().filter((f) => f.isDirectory);
    if (foldersToDownload.length === 0) {
      showNotification(
        t("fileManager.messages.selectFolderToDownload"),
        "warning",
      );
      return;
    }

    // 保存当前路径状态
    const savedCurrentPath = currentPath;

    // 重置取消状态

    const runSingleFolderDownload = async (folder, index = 0, total = 1) => {
      const displayName =
        total > 1 ? `${folder.name} (${index + 1}/${total})` : folder.name;
      const fullPath = joinPath(savedCurrentPath, folder.name);
      const transferId = addTransferProgress({
        type: "download-folder",
        progress: 0,
        fileName: displayName,
        statusText: t("fileManager.transfer.status.waitingForTargetFolder"),
        currentFile: "",
        transferredBytes: 0,
        totalBytes: 0,
        transferSpeed: 0,
        remainingTime: 0,
        processedFiles: 0,
        totalFiles: 0,
      });
      try {
        if (!window.terminalAPI?.downloadFolder) {
          throw new Error(t("fileManager.errors.fileApiNotAvailable"));
        }
        const result = await window.terminalAPI.downloadFolder(
          tabId,
          fullPath,
          (
            progress,
            currentFile,
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
                totalFiles,
                transferKey,
              }),
              fileName: displayName,
              statusText: buildFolderDownloadStatusText({
                currentFile,
                processedFiles,
                totalFiles,
              }),
              currentFile: currentFile || "",
            });
          },
        );
        if (result?.cancelled || isUserCancellationError(result)) {
          markTransferCancelled(transferId, {
            statusText: t(
              "fileManager.transfer.status.folderDownloadCancelled",
            ),
            cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
          });
          return {
            state: "cancelled",
            transferId,
            result,
          };
        }
        if (result?.partialSuccess) {
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
            transferId,
            {
              fileName: displayName,
              statusText: warningMessage,
              warning: warningMessage,
              currentFile: "",
              processedFiles: completedCount + failedCount,
              totalFiles: completedCount + failedCount,
              downloadPath: result.downloadPath || "",
            },
            6000,
          );
          return {
            state: "warning",
            transferId,
            result,
            message: warningMessage,
          };
        }
        if (result?.success) {
          const completedCount = Math.max(0, result.completed || 0);
          markTransferCompleted(transferId, {
            fileName: displayName,
            statusText: t("fileManager.transfer.status.completed"),
            currentFile: "",
            processedFiles: completedCount,
            totalFiles: completedCount,
            downloadPath: result.downloadPath || "",
          });
          return {
            state: "success",
            transferId,
            result,
          };
        }
        const errorMessage =
          result?.error || t("fileManager.messages.downloadFolderFailed");
        markTransferFailed(transferId, errorMessage, {
          statusText: t("fileManager.transfer.status.folderDownloadFailed"),
        });
        return {
          state: "error",
          transferId,
          result,
          message: errorMessage,
        };
      } catch (error) {
        const errorMessage =
          error?.message || t("fileManager.errors.unknownError");
        if (isUserCancellationError(error)) {
          markTransferCancelled(transferId, {
            statusText: t(
              "fileManager.transfer.status.folderDownloadCancelled",
            ),
            cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
          });
          return {
            state: "cancelled",
            transferId,
            message: t("fileManager.errors.downloadCancelledByUser"),
          };
        }
        markTransferFailed(transferId, errorMessage, {
          statusText: t("fileManager.transfer.status.folderDownloadFailed"),
        });
        return {
          state: "error",
          transferId,
          message: errorMessage,
        };
      }
    };
    if (foldersToDownload.length === 1) {
      const savedSelectedFile = foldersToDownload[0];
      if (!savedSelectedFile.isDirectory) {
        return handleDownload();
      }
      showNotification(
        t("fileManager.messages.startDownloadFolderNamed", {
          name: savedSelectedFile.name,
        }),
        "info",
      );
      const outcome = await runSingleFolderDownload(savedSelectedFile);
      if (outcome.state === "cancelled") {
        showNotification(
          t("fileManager.errors.downloadCancelledByUser"),
          "info",
          3000,
        );
      } else if (outcome.state === "warning") {
        showNotification(outcome.message, "warning", 6000);
        void showDownloadedLocationNotification({
          itemName: savedSelectedFile.name,
          downloadPath: outcome.result?.downloadPath,
          successMessage: t(
            "fileManager.messages.folderPartialDownloadSavedToLocal",
            {
              name: savedSelectedFile.name,
            },
          ),
          severity: "warning",
        });
      } else if (outcome.state === "success") {
        void showDownloadedLocationNotification({
          itemName: savedSelectedFile.name,
          downloadPath: outcome.result?.downloadPath,
          successMessage: t("fileManager.messages.folderDownloadSavedToLocal", {
            name: savedSelectedFile.name,
          }),
        });
      } else if (outcome.message) {
        showNotification(
          `${t("fileManager.messages.downloadFolderFailed")}: ${outcome.message}`,
          "error",
          8000,
        );
      }
    } else {
      showNotification(
        t("fileManager.messages.startDownloadFolders", {
          count: foldersToDownload.length,
        }),
        "info",
      );
      let successfulFolders = 0;
      let warningFolders = 0;
      let failedFolders = 0;
      let cancelledFolders = 0;
      for (let index = 0; index < foldersToDownload.length; index += 1) {
        const folder = foldersToDownload[index];
        const outcome = await runSingleFolderDownload(
          folder,
          index,
          foldersToDownload.length,
        );
        if (outcome.state === "success") {
          successfulFolders += 1;
          continue;
        }
        if (outcome.state === "warning") {
          successfulFolders += 1;
          warningFolders += 1;
          continue;
        }
        if (outcome.state === "cancelled") {
          cancelledFolders += 1;
          break;
        }
        failedFolders += 1;
        if (outcome.message) {
          showNotification(
            t("fileManager.messages.downloadFolderItemFailed", {
              name: folder.name,
              error: outcome.message,
            }),
            "error",
            6000,
          );
        }
      }
      if (cancelledFolders > 0 && successfulFolders === 0) {
        showNotification(
          t("fileManager.errors.downloadCancelledByUser"),
          "info",
          3000,
        );
      } else if (failedFolders === 0 && warningFolders === 0) {
        showNotification(
          t("fileManager.messages.downloadFoldersSuccessCount", {
            count: successfulFolders,
          }),
          "success",
          3000,
        );
      } else {
        showNotification(
          t("fileManager.messages.downloadFoldersSummary", {
            success: successfulFolders,
            warning: warningFolders,
            failed: failedFolders,
          }),
          failedFolders > 0 || warningFolders > 0 ? "warning" : "success",
          6000,
        );
      }
    }
  };
  return handleDownloadFolder;
}
