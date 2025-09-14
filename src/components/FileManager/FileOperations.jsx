import React, { memo } from "react";
import { useTranslation } from "react-i18next";
import { debounce } from "../../core/utils/performance.js";

// 用户活动后的刷新延迟(ms)
const USER_ACTIVITY_REFRESH_DELAY = 1000;

const FileOperations = memo(
  ({
    tabId,
    currentPath,
    selectedFile,
    selectedFiles,
    sshConnection,
    onLoadDirectory,
    onSilentRefresh,
    onError,
    onLoading,
  }) => {
    const { t } = useTranslation();

    // 用户活动后的刷新函数，使用防抖优化
    const refreshAfterUserActivity = debounce(() => {
      if (currentPath) {
        onSilentRefresh();
      }
    }, USER_ACTIVITY_REFRESH_DELAY);

    // 创建文件夹
    const createFolder = async (folderName) => {
      if (!folderName.trim() || !sshConnection) {
        return { success: false, error: t("fileManager.errors.invalidFolderName") };
      }

      onLoading(true);
      onError(null);
      let retryCount = 0;
      const maxRetries = 3;

      const attemptCreateFolder = async () => {
        try {
          const fullPath =
            currentPath === "/"
              ? "/" + folderName.trim()
              : currentPath + "/" + folderName.trim();

          if (window.terminalAPI && window.terminalAPI.createFolder) {
            const response = await window.terminalAPI.createFolder(
              tabId,
              fullPath
            );

            if (response?.success) {
              await onLoadDirectory(currentPath);
              refreshAfterUserActivity();
              return { success: true };
            } else if (
              response?.error?.includes("SFTP错误") &&
              retryCount < maxRetries
            ) {
              retryCount++;
              onError(
                t("fileManager.messages.createFolderFailedRetrying", {
                  current: retryCount,
                  max: maxRetries,
                })
              );
              await new Promise((resolve) => setTimeout(resolve, 500 * retryCount));
              return attemptCreateFolder();
            } else {
              onError(
                response?.error || t("fileManager.errors.createFolderFailed")
              );
              return { success: false, error: response?.error };
            }
          } else {
            onError(t("fileManager.errors.fileApiNotAvailable"));
            return { success: false, error: t("fileManager.errors.fileApiNotAvailable") };
          }
        } catch (error) {
          if (retryCount < maxRetries) {
            retryCount++;
            onError(
              t("fileManager.messages.createFolderFailedRetrying", {
                current: retryCount,
                max: maxRetries,
              })
            );
            await new Promise((resolve) => setTimeout(resolve, 500 * retryCount));
            return attemptCreateFolder();
          }

          onError(
            t("fileManager.errors.createFolderFailed") +
              ": " +
              (error.message || t("fileManager.errors.unknownError"))
          );
          return { success: false, error: error.message };
        } finally {
          if (retryCount === 0 || retryCount >= maxRetries) {
            onLoading(false);
          }
        }
      };

      return attemptCreateFolder();
    };

    // 创建文件
    const createFile = async (fileName) => {
      if (!fileName.trim() || !sshConnection) {
        return { success: false, error: t("fileManager.errors.invalidFileName") };
      }

      onLoading(true);

      try {
        const fullPath =
          currentPath === "/"
            ? "/" + fileName.trim()
            : currentPath + "/" + fileName.trim();

        if (window.terminalAPI && window.terminalAPI.createFile) {
          const result = await window.terminalAPI.createFile(tabId, fullPath);
          if (result.success) {
            await onLoadDirectory(currentPath);
            refreshAfterUserActivity();
            return { success: true };
          } else {
            onError(
              `${t("fileManager.errors.createFileFailed")}: ${result.error || t("fileManager.errors.unknownError")}`
            );
            return { success: false, error: result.error };
          }
        } else {
          onError(t("fileManager.errors.fileApiNotAvailable"));
          return { success: false, error: t("fileManager.errors.fileApiNotAvailable") };
        }
      } catch (error) {
        onError(
          t("fileManager.errors.createFileFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError"))
        );
        return { success: false, error: error.message };
      } finally {
        onLoading(false);
      }
    };

    // 重命名文件或文件夹
    const rename = async (oldName, newName) => {
      if (!oldName || !newName.trim() || !sshConnection) {
        return { success: false, error: t("fileManager.errors.invalidName") };
      }

      onLoading(true);

      try {
        const oldPath =
          currentPath === "/" ? "/" + oldName : currentPath + "/" + oldName;
        const newPath =
          currentPath === "/" ? "/" + newName.trim() : currentPath + "/" + newName.trim();

        if (window.terminalAPI && window.terminalAPI.renameFile) {
          const result = await window.terminalAPI.renameFile(
            tabId,
            oldPath,
            newPath
          );
          if (result.success) {
            await onLoadDirectory(currentPath);
            refreshAfterUserActivity();
            return { success: true };
          } else {
            onError(
              `${t("fileManager.errors.renameFailed")}: ${result.error || t("fileManager.errors.unknownError")}`
            );
            return { success: false, error: result.error };
          }
        } else {
          onError(t("fileManager.errors.fileApiNotAvailable"));
          return { success: false, error: t("fileManager.errors.fileApiNotAvailable") };
        }
      } catch (error) {
        onError(
          t("fileManager.errors.renameFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError"))
        );
        return { success: false, error: error.message };
      } finally {
        onLoading(false);
      }
    };

    // 删除文件或文件夹
    const deleteItems = async (itemsToDelete) => {
      if (!itemsToDelete || itemsToDelete.length === 0 || !sshConnection) {
        return { success: false, error: t("fileManager.errors.noItemsSelected") };
      }

      onLoading(true);

      try {
        const filePaths = itemsToDelete.map((file) =>
          currentPath === "/" ? "/" + file.name : currentPath + "/" + file.name
        );

        if (window.terminalAPI && window.terminalAPI.deleteFiles) {
          const result = await window.terminalAPI.deleteFiles(tabId, filePaths);
          if (result.success) {
            await onLoadDirectory(currentPath);
            refreshAfterUserActivity();
            return { success: true };
          } else {
            onError(
              `${t("fileManager.errors.deleteFailed")}: ${result.error || t("fileManager.errors.unknownError")}`
            );
            return { success: false, error: result.error };
          }
        } else {
          onError(t("fileManager.errors.fileApiNotAvailable"));
          return { success: false, error: t("fileManager.errors.fileApiNotAvailable") };
        }
      } catch (error) {
        onError(
          t("fileManager.errors.deleteFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError"))
        );
        return { success: false, error: error.message };
      } finally {
        onLoading(false);
      }
    };

    // 修改文件权限
    const changePermissions = async (filePath, permissions) => {
      if (!filePath || !permissions || !sshConnection) {
        return { success: false, error: t("fileManager.errors.invalidPermissions") };
      }

      onLoading(true);

      try {
        if (window.terminalAPI && window.terminalAPI.changeFilePermissions) {
          const result = await window.terminalAPI.changeFilePermissions(
            tabId,
            filePath,
            permissions
          );
          if (result.success) {
            await onLoadDirectory(currentPath);
            refreshAfterUserActivity();
            return { success: true };
          } else {
            onError(
              `${t("fileManager.errors.changePermissionsFailed")}: ${result.error || t("fileManager.errors.unknownError")}`
            );
            return { success: false, error: result.error };
          }
        } else {
          onError(t("fileManager.errors.fileApiNotAvailable"));
          return { success: false, error: t("fileManager.errors.fileApiNotAvailable") };
        }
      } catch (error) {
        onError(
          t("fileManager.errors.changePermissionsFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError"))
        );
        return { success: false, error: error.message };
      } finally {
        onLoading(false);
      }
    };

    return {
      createFolder,
      createFile,
      rename,
      deleteItems,
      changePermissions,
    };
  }
);

FileOperations.displayName = "FileOperations";

export default FileOperations;