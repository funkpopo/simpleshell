import { useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";

/** Routes keyboard actions to the focused file manager commands. */
export default function useFileKeyboard({
  rootRef,
  selectAll,
  clearSelection,
  open,
  showPreview,
  getSelectedFiles,
  handleDownloadSelection,
  handleDelete,
  showNotification,
  handleRename,
  handleOpenPermissions,
  handleOpenProperties,
  handleRefresh,

  handleCopyAbsolutePath,
  handleCreateFile,
  handleCreateFolder,
  handleUploadFile,
  handleUploadFolder,
}) {
  const { t } = useTranslation();
  const handleKeyDown = useCallback(
    (event) => {
      // 只有当文件管理器打开时才处理键盘事件
      if (!open || showPreview) return;

      const targetElement = event.target || document.activeElement;
      if (event.defaultPrevented || !rootRef.current?.contains(targetElement))
        return;
      if (
        targetElement &&
        typeof targetElement.closest === "function" &&
        targetElement.closest('[data-file-preview-dialog="true"]')
      ) {
        return;
      }

      // 防止在输入框中触发快捷键
      if (
        targetElement.closest(
          'input, textarea, select, [contenteditable="true"]',
        )
      ) {
        return;
      }

      const selectedFilesData = getSelectedFiles();

      // Ctrl+D: 下载文件/文件夹
      if (event.ctrlKey && event.key === "d") {
        event.preventDefault();
        handleDownloadSelection();
      }

      // Delete: 删除文件/文件夹
      if (event.key === "Delete") {
        event.preventDefault();
        if (selectedFilesData.length > 0) {
          handleDelete();
        } else {
          showNotification(
            t("fileManager.messages.selectFileOrFolderToDelete"),
            "warning",
          );
        }
      }

      // F2: 重命名
      if (event.key === "F2") {
        event.preventDefault();
        if (selectedFilesData.length === 1) {
          handleRename();
        } else if (selectedFilesData.length > 1) {
          showNotification(
            t("fileManager.messages.batchRenameError"),
            "warning",
          );
        } else {
          showNotification(
            t("fileManager.messages.selectFileToRename"),
            "warning",
          );
        }
      }

      // F3: 权限设置
      if (event.key === "F3") {
        event.preventDefault();
        if (selectedFilesData.length === 1) {
          handleOpenPermissions();
        } else if (selectedFilesData.length > 1) {
          showNotification(
            t("fileManager.messages.batchSetPermissionsError"),
            "warning",
          );
        } else {
          showNotification(
            t("fileManager.messages.selectFileOrFolderToSetPermissions"),
            "warning",
          );
        }
      }

      // F4: 文件属性
      if (event.key === "F4") {
        event.preventDefault();
        if (selectedFilesData.length === 1) {
          handleOpenProperties();
        } else if (selectedFilesData.length > 1) {
          showNotification(
            t("fileManager.messages.batchViewPropertiesError"),
            "warning",
          );
        } else {
          showNotification(
            t("fileManager.messages.selectFileOrFolderToViewProperties"),
            "warning",
          );
        }
      }

      // F5: 刷新
      if (event.key === "F5") {
        event.preventDefault();
        handleRefresh();
      }

      // Ctrl+A: 全选
      if (event.ctrlKey && event.key === "a") {
        event.preventDefault();
        selectAll(); // 设置锚点为第一个文件
      }

      // Escape: 取消选择
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
      }

      // Ctrl+Shift+C: 复制绝对路径
      if (event.ctrlKey && event.shiftKey && event.key === "C") {
        event.preventDefault();
        handleCopyAbsolutePath();
      }

      // Ctrl+N: 创建文件
      if (event.ctrlKey && !event.shiftKey && event.key === "n") {
        event.preventDefault();
        handleCreateFile();
      }

      // Ctrl+Shift+N: 创建文件夹
      if (event.ctrlKey && event.shiftKey && event.key === "N") {
        event.preventDefault();
        handleCreateFolder();
      }

      // Ctrl+U: 上传文件
      if (event.ctrlKey && !event.shiftKey && event.key === "u") {
        event.preventDefault();
        handleUploadFile();
      }

      // Ctrl+Shift+U: 上传文件夹
      if (event.ctrlKey && event.shiftKey && event.key === "U") {
        event.preventDefault();
        handleUploadFolder();
      }
    },
    [
      selectAll,
      rootRef,
      clearSelection,
      open,
      showPreview,
      getSelectedFiles,
      handleDownloadSelection,
      handleDelete,
      handleRename,
      handleOpenPermissions,
      handleOpenProperties,
      handleRefresh,

      handleCopyAbsolutePath,
      handleCreateFile,
      handleCreateFolder,
      handleUploadFile,
      handleUploadFolder,
      showNotification,
      t,
    ],
  );

  useEffect(() => {
    if (!open) return;

    const keydownHandler = (event) => {
      try {
        handleKeyDown(event);
      } catch {
        // Silently handle keyboard event errors
      }
    };

    window.addEventListener("keydown", keydownHandler);

    return () => {
      window.removeEventListener("keydown", keydownHandler);
    };
  }, [open, handleKeyDown]);
}
