import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useGlobalTransfers } from "../../transfers/state/globalTransferStore.js";
import {
  normalizeTransferProgress,
  createTransferUiHelpers,
} from "../../transfers/lib/transferTaskHelpers.js";

export default function usePreviewDownload({
  file,
  tabId,
  fullPath,
  setNotification,
}) {
  const { t } = useTranslation();
  const {
    addTransferProgress,
    updateTransferProgress,
    scheduleTransferCleanup,
  } = useGlobalTransfers(tabId);
  const { markTransferCancelled, markTransferFailed, markTransferCompleted } =
    useMemo(
      () =>
        createTransferUiHelpers({
          updateTransferProgress,
          scheduleTransferCleanup,
        }),
      [updateTransferProgress, scheduleTransferCleanup],
    );
  const handleDownload = async () => {
    if (!file) return;

    let transferId = null;
    try {
      if (!window.terminalAPI?.downloadFile) {
        throw new Error(t("fileManager.errors.fileApiNotAvailable"));
      }

      setNotification({
        message: t("fileManager.messages.startDownloadNamed", {
          name: file.name,
        }),
        severity: "info",
      });

      transferId = addTransferProgress({
        type: "download",
        progress: 0,
        fileName: file.name,
        statusText: t("fileManager.transfer.status.waitingForSaveLocation"),
        currentFile: file.name,
        transferredBytes: 0,
        totalBytes: file.size || 0,
        transferSpeed: 0,
        remainingTime: 0,
        processedFiles: 0,
        totalFiles: 1,
      });

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
          if (!transferId) {
            return;
          }

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
            fileName: fileName || file.name,
            statusText: t("fileManager.transfer.status.downloading"),
            currentFile: fileName || file.name,
            totalFiles: Math.max(1, totalFiles || 1),
          });
        },
        Number.isFinite(file.size) && file.size >= 0 ? file.size : 0,
      );

      if (result?.cancelled) {
        markTransferCancelled(transferId, {
          statusText: t("fileManager.transfer.status.downloadCancelled"),
          cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
        });
        setNotification({
          message: t("fileManager.errors.downloadCancelledByUser"),
          severity: "info",
        });
        return;
      }

      if (result?.success) {
        markTransferCompleted(transferId, {
          fileName: file.name,
          statusText: t("fileManager.transfer.status.completed"),
          currentFile: "",
          processedFiles: 1,
          totalFiles: 1,
          downloadPath: result.downloadPath || "",
        });
        setNotification({
          message: t("fileManager.messages.downloadCompleted", {
            name: file.name,
          }),
          severity: "success",
        });
        return;
      }

      const errorMessage =
        result?.error || t("fileManager.errors.downloadFailed");
      markTransferFailed(transferId, errorMessage, {
        statusText: t("fileManager.transfer.status.downloadFailed"),
      });
      setNotification({
        message: `${t("fileManager.errors.downloadFailed")}: ${errorMessage}`,
        severity: "error",
      });
    } catch (error) {
      const errorMessage =
        error?.message || t("fileManager.errors.downloadFailed");
      markTransferFailed(transferId, errorMessage, {
        statusText: t("fileManager.transfer.status.downloadFailed"),
      });
      setNotification({
        message: `${t("fileManager.errors.downloadFailed")}: ${errorMessage}`,
        severity: "error",
      });
    }
  };
  return handleDownload;
}
