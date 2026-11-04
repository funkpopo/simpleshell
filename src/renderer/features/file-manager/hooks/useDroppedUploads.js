import { useCallback } from "react";
import { normalizeTransferProgress } from "../../transfers/lib/transferTaskHelpers.js";
import {
  buildTransferDisplayName,
  getTopLevelTransferItemName,
} from "../../../../shared/transferNameUtils";
import {
  TRANSFER_CONFLICT_PREVIEW_LIMIT,
  joinPath,
} from "../fileManagerUtils.js";
import { getDropValidationMessage as formatDropValidationMessage } from "../lib/transferTaskText.js";
import { collectDroppedItems } from "../lib/droppedEntries.js";

/** Native drag-and-drop uploads: validation, overwrite confirmation and progress. */
export default function useDroppedUploads({
  tabId,
  currentPath,
  selectedFile,
  refreshDirectory,
  showConfirmDialog,
  setNotification,
  t,
  addTransferProgress,
  updateTransferProgress,
  storeScheduleTransferCleanup,
  isUserCancellationError,
  markTransferCancelled,
  markTransferFailed,
  markTransferCompleted,
}) {
  const getDropValidationMessage = useCallback(
    (rejectedItem) => formatDropValidationMessage(t, rejectedItem),
    [t],
  );
  const confirmDroppedUploadConflicts = useCallback(
    async (conflicts) => {
      if (!Array.isArray(conflicts) || conflicts.length === 0) {
        return true;
      }
      const conflictItems = conflicts
        .slice(0, TRANSFER_CONFLICT_PREVIEW_LIMIT)
        .map((item) => item.remotePath || item.relativePath || item.name)
        .filter(Boolean);
      const remainingCount = Math.max(
        0,
        conflicts.length - conflictItems.length,
      );
      return showConfirmDialog({
        title: t("fileManager.messages.dragDropConflictTitle"),
        message: t("fileManager.messages.dragDropConflictMessage", {
          count: conflicts.length,
        }),
        detailItems: conflictItems,
        detailFooter: remainingCount > 0 ? `... +${remainingCount}` : "",
        confirmText: t("fileManager.messages.dragDropConflictConfirm"),
        cancelText: t("fileManager.messages.dragDropConflictCancel"),
        confirmColor: "warning",
        defaultAction: "cancel",
      });
    },
    [showConfirmDialog, t],
  );
  const handleDroppedItems = useCallback(
    async (entries) => {
      let transferCancelled = false;
      const targetPath = selectedFile?.isDirectory
        ? joinPath(currentPath, selectedFile.name)
        : currentPath;
      const refreshUploadDirectories = async (options) => {
        await refreshDirectory(targetPath, options);
        if (targetPath !== currentPath)
          await refreshDirectory(currentPath, options);
      };
      if (
        !window.terminalAPI?.uploadDroppedFiles ||
        !window.terminalAPI?.validateDroppedItems ||
        !window.terminalAPI?.checkDroppedUploadConflicts
      ) {
        setNotification({
          message: t("fileManager.errors.dragDropNotSupported"),
          severity: "error",
        });
        return;
      }
      const transferId = addTransferProgress({
        type: "upload-multifile",
        progress: 0,
        fileName: t("fileManager.messages.preparingUpload"),
        statusText: t("fileManager.transfer.status.preparingUpload"),
        currentFile: "",
        transferredBytes: 0,
        totalBytes: 0,
        transferSpeed: 0,
        remainingTime: 0,
        currentFileIndex: 0,
        processedFiles: 0,
        totalFiles: Math.max(1, entries?.length || 1),
        transferKey: "",
      });
      let didRefresh = false;
      const droppedItems = await collectDroppedItems(entries);
      if (droppedItems.length === 0) {
        const message = t("fileManager.errors.noFilesSelected");
        markTransferFailed(transferId, message, {
          statusText: t("fileManager.transfer.status.failed"),
          cleanupDelay: 3000,
        });
        setNotification({
          message,
          severity: "warning",
        });
        return;
      }
      const validation =
        await window.terminalAPI.validateDroppedItems(droppedItems);
      if (!validation?.success || validation.rejected?.length > 0) {
        const message = getDropValidationMessage(validation?.rejected?.[0]);
        markTransferFailed(transferId, message, {
          statusText: t("fileManager.transfer.status.failed"),
        });
        setNotification({
          message,
          severity: "error",
        });
        return;
      }
      const filesDataForUpload = (validation.files || []).map((item) => {
        return {
          name: item.name,
          relativePath: item.relativePath,
          size: item.size,
          lastModified: item.lastModified,
          localPath: item.localPath,
        };
      });
      const foldersForUpload = (validation.folders || [])
        .map((item) => ({
          name: item.name,
          relativePath: item.relativePath,
          lastModified: item.lastModified,
          localPath: item.localPath,
        }))
        .sort((left, right) =>
          String(left.relativePath || "").localeCompare(
            String(right.relativePath || ""),
          ),
        );
      if (filesDataForUpload.length === 0 && foldersForUpload.length === 0) {
        const message = t("fileManager.errors.noFilesSelected");
        markTransferFailed(transferId, message, {
          statusText: t("fileManager.transfer.status.failed"),
          cleanupDelay: 3000,
        });
        setNotification({
          message,
          severity: "warning",
        });
        return;
      }
      const uploadData = {
        files: filesDataForUpload,
        folders: foldersForUpload,
      };
      const droppedDisplayName =
        buildTransferDisplayName(
          [
            ...filesDataForUpload.map((item) =>
              getTopLevelTransferItemName(item.relativePath || item.name),
            ),
            ...foldersForUpload.map((folder) =>
              getTopLevelTransferItemName(folder.relativePath || folder.name),
            ),
          ],
          ({ firstName, count }) =>
            t("fileManager.multipleItemsName", {
              name: firstName,
              count,
              itemLabel: t("fileManager.itemLabels.items"),
            }),
        ) || t("fileManager.messages.preparingUpload");
      updateTransferProgress(transferId, {
        fileName: droppedDisplayName,
        totalBytes: filesDataForUpload.reduce(
          (sum, item) => sum + Math.max(0, Number(item.size) || 0),
          0,
        ),
        totalFiles: Math.max(
          1,
          filesDataForUpload.length || foldersForUpload.length,
        ),
      });
      try {
        const conflictResult =
          await window.terminalAPI.checkDroppedUploadConflicts(
            tabId,
            targetPath,
            uploadData,
          );
        if (!conflictResult?.success) {
          throw new Error(
            t("fileManager.errors.dragDropValidationFailed", {
              reason:
                conflictResult?.error || t("fileManager.errors.unknownError"),
            }),
          );
        }
        if (conflictResult.hasConflicts) {
          const confirmed = await confirmDroppedUploadConflicts(
            conflictResult.conflicts,
          );
          if (!confirmed) {
            markTransferCancelled(transferId, {
              statusText: t("fileManager.transfer.status.transferCancelled"),
              cancelMessage: t("fileManager.errors.dragDropConflictCancelled"),
            });
            setNotification({
              message: t("fileManager.errors.dragDropConflictCancelled"),
              severity: "warning",
            });
            return;
          }
        }
        const result = await window.terminalAPI.uploadDroppedFiles(
          tabId,
          targetPath,
          uploadData,
          (
            progress,
            fileName,
            transferredBytes,
            totalBytes,
            transferSpeed,
            remainingTime,
            currentFileIndex,
            processedFiles,
            totalFiles,
            transferKey,
            operationComplete,
          ) => {
            if (transferCancelled) {
              return;
            }
            updateTransferProgress(transferId, {
              ...normalizeTransferProgress({
                progress,
                transferredBytes,
                totalBytes,
                transferSpeed,
                remainingTime,
                currentFileIndex,
                processedFiles,
                totalFiles,
                transferKey,
              }),
              fileName: fileName || droppedDisplayName,
              statusText: t("fileManager.transfer.status.uploading"),
              currentFile: fileName || "",
              isCompleted: operationComplete === true,
            });
          },
        );
        if (isUserCancellationError(result)) {
          transferCancelled = true;
          markTransferCancelled(transferId, {
            statusText: t("fileManager.transfer.status.transferCancelled"),
            cancelMessage: t("fileManager.errors.userCancelled"),
          });
        } else if (result?.success) {
          markTransferCompleted(transferId, {
            statusText: t("fileManager.transfer.status.completed"),
            currentFile: "",
            isCompleted: true,
            processedFiles: Math.max(
              0,
              result.uploadedCount ??
                result.successfulFiles ??
                result.totalFiles ??
                0,
            ),
            currentFileIndex: Math.max(0, result.totalFiles || 0),
            totalFiles: Math.max(0, result.totalFiles || 0),
          });
          await refreshUploadDirectories();
          didRefresh = true;
          if (result.partialSuccess && result.warning) {
            setNotification({
              message: result.warning,
              severity: "warning",
            });
          } else {
            setNotification({
              message: t("fileManager.messages.uploadSuccess"),
              severity: "success",
            });
          }
        } else {
          throw new Error(
            result?.error || t("fileManager.errors.uploadFailed"),
          );
        }
      } catch (error) {
        const isCancellation = isUserCancellationError(error);
        const errorMessage =
          error?.message ||
          error?.toString?.() ||
          t("fileManager.errors.unknownError");
        updateTransferProgress(transferId, {
          error: isCancellation ? "" : errorMessage,
          isCancelled: isCancellation,
          statusText: isCancellation
            ? t("fileManager.transfer.status.transferCancelled")
            : t("fileManager.transfer.status.failed"),
          errorMessage,
        });
        if (!isCancellation) {
          setNotification({
            message: errorMessage || t("fileManager.errors.uploadFailed"),
            severity: "error",
          });
        }
        storeScheduleTransferCleanup(transferId, isCancellation ? 3000 : 5000);
        if (!didRefresh) {
          await refreshUploadDirectories({ background: true });
        }
      }
    },
    [
      currentPath,
      selectedFile,
      tabId,
      t,
      addTransferProgress,
      updateTransferProgress,
      isUserCancellationError,
      setNotification,
      refreshDirectory,
      storeScheduleTransferCleanup,
      markTransferCancelled,
      markTransferFailed,
      markTransferCompleted,
      getDropValidationMessage,
      confirmDroppedUploadConflicts,
    ],
  );
  return handleDroppedItems;
}
