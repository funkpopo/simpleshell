import {
  isSilentIpcReplyError,
  normalizeTransferProgress,
} from "../../transfers/lib/transferTaskHelpers.js";
import { joinPath } from "../fileManagerUtils.js";

/** Picker-driven file/folder uploads into the current (or selected) folder. */
export default function useUploadTransfers({
  tabId,
  showNotification,
  sshConnection,
  currentPath,
  selectedFile,
  refreshDirectory,
  t,
  addTransferProgress,
  updateTransferProgress,
  isUserCancellationError,
  markTransferCancelled,
  markTransferFailed,
  markTransferCompleted,
}) {
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
              };
          const normalized = normalizeTransferProgress(raw);
          const update = {
            ...normalized,
            fileName: raw.fileName || t("fileManager.messages.preparingUpload"),
            statusText: t("fileManager.transfer.status.uploading"),
            currentFile: raw.currentFile || "",
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
          // 标记传输完成,完成后延迟移除；保留原显示名，完成状态由状态文本体现
          markTransferCompleted(activeUploadTransferId, {
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
  return { handleUploadFile, handleUploadFolder };
}
