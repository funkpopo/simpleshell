import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTransferActions } from "../../../store/globalTransferStore.js";
import {
  normalizeTransferProgress,
  isSilentIpcReplyError,
  createTransferUiHelpers,
} from "../../../utils/transferTaskHelpers.js";
import {
  buildTransferDisplayName,
  getTopLevelTransferItemName,
} from "../../../shared/transferNameUtils";
import {
  TRANSFER_CONFLICT_PREVIEW_LIMIT,
  joinPath,
  getDroppedEntryName,
  joinDroppedLocalPath,
} from "../fileManagerUtils.js";
/** Starts and tracks transfers without subscribing the container to progress ticks. */
export default function useTransferTasks({
  tabId,
  showNotification,
  sshConnection,
  currentPath,
  selectedFile,
  refreshDirectory,
  showConfirmDialog,
  setNotification,
  getSelectedFiles,
}) {
  const { t } = useTranslation();
  const {
    getTransferList,
    addTransferProgress: storeAddTransferProgress,
    updateTransferProgress: storeUpdateTransferProgress,
    scheduleTransferCleanup: storeScheduleTransferCleanup,
  } = useTransferActions(tabId);
  const { markTransferCancelled, markTransferFailed, markTransferCompleted } =
    useMemo(
      () =>
        createTransferUiHelpers({
          updateTransferProgress: storeUpdateTransferProgress,
          scheduleTransferCleanup: storeScheduleTransferCleanup,
        }),
      [storeUpdateTransferProgress, storeScheduleTransferCleanup],
    );
  const addTransferProgress = (transferData) => {
    return storeAddTransferProgress(transferData);
  };
  const updateTransferProgress = (transferId, updateData) => {
    storeUpdateTransferProgress(transferId, updateData);
  };
  const normalizeExistsResponse = useCallback((result) => {
    if (typeof result === "boolean") {
      return result;
    }
    if (result && typeof result === "object") {
      return result.exists === true;
    }
    return false;
  }, []);
  const revealDownloadedItem = useCallback(
    async (targetPath) => {
      if (!targetPath) {
        return;
      }
      if (!window.terminalAPI?.showItemInFolder) {
        showNotification(
          t("fileManager.messages.openDownloadedLocationFailed", {
            path: targetPath,
          }),
          "warning",
        );
        return;
      }
      try {
        const response = await window.terminalAPI.showItemInFolder(targetPath);
        if (!response?.success) {
          showNotification(
            t("fileManager.messages.openDownloadedLocationFailed", {
              path: targetPath,
            }),
            "warning",
          );
        }
      } catch {
        showNotification(
          t("fileManager.messages.openDownloadedLocationFailed", {
            path: targetPath,
          }),
          "warning",
        );
      }
    },
    [showNotification, t],
  );
  const showDownloadedLocationNotification = useCallback(
    async ({
      itemName,
      downloadPath,
      successMessage,
      missingPathMessage,
      severity = "success",
      duration = 15000,
    }) => {
      const resolvedItemName = itemName || t("fileManager.fileTypes.file");
      const normalizedPath =
        typeof downloadPath === "string" && downloadPath.trim()
          ? downloadPath.replace(/\//g, "\\")
          : "";
      if (!normalizedPath) {
        showNotification(
          successMessage ||
            t("fileManager.messages.downloadCompleted", {
              name: resolvedItemName,
            }),
          severity,
          duration,
        );
        return;
      }
      let exists = true;
      if (window.terminalAPI?.checkPathExists) {
        try {
          exists = normalizeExistsResponse(
            await window.terminalAPI.checkPathExists(normalizedPath),
          );
        } catch {
          exists = true;
        }
      }
      if (!exists) {
        showNotification(
          missingPathMessage ||
            t("fileManager.messages.downloadMissingPath", {
              name: resolvedItemName,
              path: normalizedPath,
            }),
          "warning",
          10000,
        );
        return;
      }
      showNotification(
        successMessage ||
          t("fileManager.messages.downloadSavedToPath", {
            name: resolvedItemName,
            path: normalizedPath,
          }),
        severity,
        duration,
        true,
        () => {
          void revealDownloadedItem(normalizedPath);
        },
      );
    },
    [normalizeExistsResponse, revealDownloadedItem, showNotification, t],
  );
  const buildBatchDownloadStatusText = useCallback(
    ({ processedFiles = 0, totalFiles = 0, currentFile = "" } = {}) => {
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
    },
    [t],
  );
  const buildFolderDownloadStatusText = useCallback(
    ({ currentFile = "", processedFiles = 0, totalFiles = 0 } = {}) => {
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
    },
    [t],
  );
  const isUserCancellationError = (error) => {
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
  };
  const runUploadTransfer = async (mode) => {
    let transferCancelled = false;
    const isFolder = mode === "folder";
    const api = isFolder
      ? window.terminalAPI?.uploadFolder
      : window.terminalAPI?.uploadFile;
    if (!sshConnection) {
      showNotification(t("fileManager.errors.noConnection"), "warning");
      return;
    }

    // 保存当前路径状态
    const savedCurrentPath = currentPath;
    const savedSelectedFile = selectedFile;
    const targetPath = savedSelectedFile?.isDirectory
      ? joinPath(savedCurrentPath, savedSelectedFile.name)
      : savedCurrentPath;
    const refreshUploadDirectories = async (options) => {
      await refreshDirectory(targetPath, options);
      if (targetPath !== savedCurrentPath)
        await refreshDirectory(savedCurrentPath, options);
    };
    const transferType = isFolder ? "upload-folder" : "upload-multifile";
    let didRefresh = false;
    let activeUploadTransferId = null;
    const markUploadCancelled = () => {
      transferCancelled = true;
      markTransferCancelled(activeUploadTransferId, {
        statusText: t("fileManager.transfer.status.transferCancelled"),
        cancelMessage: t("fileManager.errors.userCancelled"),
      });
    };
    try {
      if (api) {
        // 触发应用内状态提示（与拖拽上传保持一致）
        showNotification(
          t("fileManager.messages.preparingUpload"),
          "info",
          2000,
        );
        activeUploadTransferId = addTransferProgress({
          type: transferType,
          progress: 0,
          fileName: t("fileManager.messages.preparingUpload"),
          statusText: t("fileManager.transfer.status.preparingUpload"),
          currentFile: "",
          transferredBytes: 0,
          totalBytes: 0,
          transferSpeed: 0,
          remainingTime: 0,
          ...(isFolder
            ? {}
            : {
                currentFileIndex: 0,
              }),
          processedFiles: 0,
          totalFiles: 1,
          transferKey: "",
          fileList: null,
        });

        // 使用progressCallback处理进度更新;两个 API 的回调签名不同,先解包成同一结构
        const result = await api(tabId, targetPath, (...args) => {
          const raw = isFolder
            ? {
                progress: args[0],
                fileName: args[1],
                currentFile: args[2],
                transferredBytes: args[3],
                totalBytes: args[4],
                transferSpeed: args[5],
                remainingTime: args[6],
                processedFiles: args[7],
                totalFiles: args[8],
                transferKey: args[9],
                fileList: args[10],
              }
            : {
                progress: args[0],
                fileName: args[1],
                currentFile: args[1],
                transferredBytes: args[2],
                totalBytes: args[3],
                transferSpeed: args[4],
                remainingTime: args[5],
                currentFileIndex: args[6],
                processedFiles: args[7],
                totalFiles: args[8],
                transferKey: args[9],
                fileList: args[10],
              };
          const normalized = normalizeTransferProgress(raw);
          const update = {
            ...normalized,
            fileName: raw.fileName || t("fileManager.messages.preparingUpload"),
            statusText: t("fileManager.transfer.status.uploading"),
            currentFile: raw.currentFile || "",
            fileList: raw.fileList || null,
          };
          if (!activeUploadTransferId) {
            activeUploadTransferId = addTransferProgress({
              type: transferType,
              ...update,
              totalFiles: isFolder
                ? normalized.totalFiles
                : normalized.totalFiles || 1,
            });
          }
          updateTransferProgress(activeUploadTransferId, update);
        });
        if (isUserCancellationError(result)) {
          markUploadCancelled();
        } else if (result?.success) {
          // 标记传输完成,完成后延迟移除
          markTransferCompleted(activeUploadTransferId, {
            fileName:
              result.message || t("fileManager.messages.uploadComplete"),
            statusText: t("fileManager.transfer.status.completed"),
            currentFile: "",
            ...(isFolder
              ? {}
              : {
                  processedFiles: Math.max(
                    0,
                    result.successfulFiles ?? result.totalFiles ?? 0,
                  ),
                  currentFileIndex: Math.max(0, result.totalFiles || 0),
                  totalFiles: Math.max(0, result.totalFiles || 0),
                }),
          });

          // Invalidate the upload target and its visible parent without navigating.
          await refreshUploadDirectories();
          didRefresh = true;

          // 如果有警告信息（部分文件上传失败），显示给用户
          if (result.partialSuccess && result.warning) {
            showNotification(result.warning, "warning", 6000);
          } else {
            showNotification(
              t("fileManager.messages.uploadSuccess"),
              "success",
              2000,
            );
          }
        } else if (!transferCancelled) {
          // 检查是否是取消操作相关的错误
          if (!isUserCancellationError(result)) {
            // 只有在不是用户主动取消的情况下才显示错误
            showNotification(
              result.error || t("fileManager.errors.uploadFailed"),
              "error",
              6000,
            );
            markTransferFailed(
              activeUploadTransferId,
              result.error || t("fileManager.errors.uploadFailed"),
              {
                statusText: t("fileManager.transfer.status.failed"),
              },
            );
          } else {
            markUploadCancelled();
          }
        }

        // 上传没有前台刷新结果时，提交一次静默刷新同步列表
        if (!didRefresh) {
          await refreshUploadDirectories({ background: true });
        }
      }
    } catch (error) {
      // 只有在不是用户主动取消的情况下才显示错误
      if (
        !transferCancelled &&
        !isUserCancellationError(error) &&
        !isSilentIpcReplyError(error)
      ) {
        showNotification(
          (error && (error.message || error.error)) ||
            t("fileManager.errors.uploadFailed"),
          "error",
          6000,
        );
        const errorMessage =
          error?.message || t("fileManager.errors.unknownError");
        if (activeUploadTransferId) {
          markTransferFailed(activeUploadTransferId, errorMessage, {
            statusText: t("fileManager.transfer.status.failed"),
          });
        }
      } else {
        transferCancelled = true;
        if (activeUploadTransferId) {
          markTransferCancelled(activeUploadTransferId, {
            statusText: t("fileManager.transfer.status.transferCancelled"),
            cancelMessage: t("fileManager.errors.userCancelled"),
          });
        }
      }

      // 异常分支如果尚未前台刷新，提交静默刷新同步列表
      if (!didRefresh) {
        await refreshUploadDirectories({ background: true });
      }
    }
  };
  const handleUploadFile = () => runUploadTransfer("file");
  const handleUploadFolder = () => runUploadTransfer("folder");
  const getDropValidationMessage = useCallback(
    (rejectedItem) => {
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
    },
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
        fileList: null,
      });
      let didRefresh = false;
      const droppedItems = [];
      const readEntry = async (entry, pathPrefix = "", localPath = "") => {
        if (!entry) return;
        const entryName = getDroppedEntryName(entry);
        if (entry.isFile) {
          if (!entryName) {
            droppedItems.push({
              name: "",
              relativePath: "",
              localPath,
              isFile: true,
            });
            return;
          }
          droppedItems.push({
            name: entryName,
            relativePath: `${pathPrefix}${entryName}`,
            localPath,
            isFile: true,
          });
          return;
        }
        if (!entry.isDirectory || typeof entry.createReader !== "function") {
          droppedItems.push({
            name: entryName,
            relativePath: entryName ? `${pathPrefix}${entryName}` : "",
            localPath: "",
          });
          return;
        }
        if (!entryName) {
          droppedItems.push({
            name: "",
            relativePath: "",
            localPath,
            isDirectory: true,
            directoryReadable: false,
          });
          return;
        }
        const directoryPrefix = `${pathPrefix}${entryName}/`;
        const directoryRelativePath = directoryPrefix.replace(/\/$/, "");
        const directoryLocalPath = localPath;
        const reader = entry.createReader();
        const childEntries = [];
        let directoryReadable = true;
        await new Promise((resolve) => {
          const readEntries = () => {
            reader.readEntries(
              (batch) => {
                if (!batch || batch.length === 0) {
                  resolve();
                  return;
                }
                childEntries.push(...batch);
                readEntries();
              },
              () => {
                directoryReadable = false;
                resolve();
              },
            );
          };
          readEntries();
        });
        droppedItems.push({
          name: entryName,
          relativePath: directoryRelativePath,
          localPath: directoryLocalPath,
          isDirectory: true,
          directoryReadable,
        });
        for (const childEntry of childEntries) {
          await readEntry(
            childEntry,
            directoryPrefix,
            joinDroppedLocalPath(directoryLocalPath, childEntry?.name),
          );
        }
      };
      for (const rootItem of entries) {
        await readEntry(rootItem.entry, "", rootItem.localPath);
      }
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
            fileList,
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
              fileList: fileList || null,
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
            fileName:
              result.message || t("fileManager.messages.uploadComplete"),
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
              fileName: fileName || batchDisplayName,
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
            fileName: t("fileManager.messages.batchDownloadCompleteTitle", {
              count: completedCount,
            }),
            statusText: t(
              "fileManager.messages.batchDownloadCompletedSummary",
              {
                completed: completedCount,
                total: filesToDownload.length,
              },
            ),
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
  const handleDownloadSelection = useCallback(async () => {
    const selectedItems = getSelectedFiles();
    if (selectedItems.length === 0) {
      showNotification(t("fileManager.messages.selectFileOrFolder"), "warning");
      return;
    }
    if (!sshConnection) {
      showNotification(t("fileManager.errors.noConnection"), "error");
      return;
    }
    const hasFiles = selectedItems.some((file) => !file.isDirectory);
    const hasFolders = selectedItems.some((file) => file.isDirectory);
    if (hasFiles && hasFolders) {
      showNotification(
        t("fileManager.messages.mixedSelectionDownload"),
        "info",
        4000,
      );
      await handleDownload();
      await handleDownloadFolder();
      return;
    }
    if (hasFolders) {
      await handleDownloadFolder();
      return;
    }
    await handleDownload();
  }, [
    getSelectedFiles,
    handleDownload,
    handleDownloadFolder,
    showNotification,
    sshConnection,
    t,
  ]);
  return {
    getTransferList,
    handleUploadFile,
    handleUploadFolder,
    handleDroppedItems,
    handleDownload,
    handleDownloadFolder,
    handleDownloadSelection,
  };
}
