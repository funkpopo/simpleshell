import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { joinPath, getParentPath, withSftpRetry } from "../fileManagerUtils.js";
import useFileNameDialog from "./useFileNameDialog.js";
import useFileDetails from "./useFileDetails.js";
import useFilePreview from "./useFilePreview.js";

/** Composes file commands; each dialog owns its draft, target and request lifecycle. */
export default function useFileOps({
  showNotification,
  confirmAction,
  currentPath,
  tabId,
  refreshDirectory,
  replaceSelection,
  clearSelection,
  selectedFile,
  getSelectedFiles,
  sshConnection,
  refreshAfterUserActivity,
  handleEnterDirectory,
}) {
  const { t } = useTranslation();
  const showOperationError = useCallback(
    (message) => showNotification(message, "error"),
    [showNotification],
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const isDeletingRef = useRef(false);
  const contextRef = useRef({ tabId, currentPath });
  useEffect(() => {
    contextRef.current = { tabId, currentPath };
    return () => {
      contextRef.current = null;
    };
  }, [tabId, currentPath]);
  const nameDialogOptions = {
    tabId,
    currentPath,
    sshConnection,
    selectedFile,
    refreshDirectory,
  };
  const rename = useFileNameDialog({ ...nameDialogOptions, mode: "rename" });
  const createFile = useFileNameDialog({
    ...nameDialogOptions,
    mode: "createFile",
  });
  const createFolder = useFileNameDialog({
    ...nameDialogOptions,
    mode: "createFolder",
  });
  const details = useFileDetails({
    selectedFile,
    tabId,
    currentPath,
    refreshDirectory,
    showNotification,
  });
  const preview = useFilePreview({
    currentPath,
    tabId,
    showNotification,
    refreshAfterUserActivity,
    handleEnterDirectory,
  });
  const formatSelectedFilesSummary = useCallback(
    (files, previewCount = 6) => {
      const names = files
        .map((file) => file?.name)
        .filter((name) => typeof name === "string" && name.length > 0);

      if (names.length <= previewCount) {
        return names.join(", ");
      }

      return t("fileManager.messages.fileListSummary", {
        shown: names.slice(0, previewCount).join(", "),
        remaining: names.length - previewCount,
      });
    },
    [t],
  );

  const showBatchOperationConfirm = useCallback(
    (operation, files, onConfirm) => {
      const fileCount = files.length;
      const fileList = formatSelectedFilesSummary(files);
      const message = t("fileManager.batchOperationConfirm", {
        operation,
        count: fileCount,
        files: fileList,
      });
      confirmAction({
        open: true,
        title: t("fileManager.confirmTitle"),
        message,
        onConfirm,
        confirmText: operation,
        confirmColor: "error",
      });
    },
    [confirmAction, formatSelectedFilesSummary, t],
  );

  const showDeleteConfirm = useCallback(
    (files, onConfirm) => {
      if (!Array.isArray(files) || files.length === 0) {
        return;
      }

      if (files.length === 1) {
        confirmAction({
          open: true,
          title: t("fileManager.confirmTitle"),
          message: t("fileManager.messages.deleteConfirm", {
            name: files[0].name,
          }),
          onConfirm,
          confirmText: t("fileManager.delete"),
          confirmColor: "error",
        });
        return;
      }

      showBatchOperationConfirm(t("fileManager.delete"), files, onConfirm);
    },
    [confirmAction, showBatchOperationConfirm, t],
  );

  const buildCurrentFilePath = useCallback(
    (fileName) => {
      return currentPath ? joinPath(currentPath, fileName) : fileName;
    },
    [currentPath],
  );

  const deleteFileWithRetry = useCallback(
    (targetPath, isDirectory) =>
      withSftpRetry(
        () => window.terminalAPI.deleteFile(tabId, targetPath, isDirectory),
        {
          maxRetries: 3,
          baseDelay: 500,
          fallbackError: t("fileManager.errors.deleteFailed"),
          formatCaughtError: (error) =>
            error?.message || t("fileManager.errors.unknownError"),
        },
      ),
    [t, tabId],
  );

  const createFolderWithRetry = useCallback(
    (folderPath) =>
      withSftpRetry(() => window.terminalAPI.createFolder(tabId, folderPath), {
        maxRetries: 2,
        baseDelay: 300,
        fallbackError: t("fileManager.errors.createFolderFailed"),
        treatErrorAsSuccess: (responseError) =>
          responseError.includes("already exists") ||
          responseError.includes("已存在") ||
          responseError.includes("File exists") ||
          /file exists/i.test(responseError),
      }),
    [t, tabId],
  );

  const moveFileWithRetry = useCallback(
    (sourcePath, targetPath) =>
      withSftpRetry(
        () => window.terminalAPI.moveFile(tabId, sourcePath, targetPath),
        {
          maxRetries: 2,
          baseDelay: 300,
          fallbackError: t("fileManager.errors.deleteFailed"),
        },
      ),
    [t, tabId],
  );

  const executeDeleteFiles = useCallback(
    async (filesToDelete) => {
      if (!Array.isArray(filesToDelete) || filesToDelete.length === 0) {
        return;
      }

      if (isDeletingRef.current) return;
      isDeletingRef.current = true;
      setIsDeleting(true);
      const selectionContext = contextRef.current;
      const canUpdateSelection = () =>
        contextRef.current === selectionContext &&
        selectionContext?.tabId === tabId &&
        selectionContext?.currentPath === currentPath;

      const deletedFiles = [];
      const failedFiles = [];
      const stagedEntries = [];

      try {
        if (
          !window.terminalAPI ||
          !window.terminalAPI.deleteFile ||
          !window.terminalAPI.moveFile ||
          !window.terminalAPI.createFolder
        ) {
          showNotification(
            t("fileManager.errors.fileApiNotAvailable"),
            "error",
          );
          return;
        }

        const selectionNames = new Set(
          filesToDelete.map((file) => file?.name).filter(Boolean),
        );
        const parentPath = getParentPath(currentPath);
        let stagingFolderName = `.simpleshell-delete-staging-${Date.now().toString(36)}`;
        while (selectionNames.has(stagingFolderName)) {
          stagingFolderName = `.simpleshell-delete-staging-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        }

        const stagingRootPath = joinPath(parentPath, stagingFolderName);
        const createStagingResult =
          await createFolderWithRetry(stagingRootPath);

        if (!createStagingResult.success) {
          showNotification(
            createStagingResult.error || t("fileManager.errors.deleteFailed"),
            "error",
            6000,
          );
          return;
        }

        for (const file of filesToDelete) {
          const sourcePath = buildCurrentFilePath(file.name);
          const stagedPath = joinPath(stagingRootPath, file.name);
          const stageResult = await moveFileWithRetry(sourcePath, stagedPath);

          if (!stageResult.success) {
            failedFiles.push({
              file,
              error:
                stageResult.error ||
                t("fileManager.messages.deleteRollbackStageFailed"),
              retainSelection: true,
            });
            continue;
          }

          stagedEntries.push({
            file,
            sourcePath,
            stagedPath,
          });
        }

        for (const stagedEntry of stagedEntries) {
          const result = await deleteFileWithRetry(
            stagedEntry.stagedPath,
            stagedEntry.file.isDirectory,
          );

          if (result.success) {
            deletedFiles.push(stagedEntry.file);
          } else {
            const rollbackResult = await moveFileWithRetry(
              stagedEntry.stagedPath,
              stagedEntry.sourcePath,
            );

            failedFiles.push({
              file: stagedEntry.file,
              retainSelection: rollbackResult.success,
              error: rollbackResult.success
                ? result.error || t("fileManager.errors.deleteFailed")
                : t("fileManager.messages.deleteRollbackRestoreFailed", {
                    name: stagedEntry.file.name,
                    error:
                      rollbackResult.error ||
                      t("fileManager.errors.deleteFailed"),
                  }),
            });
          }
        }

        await deleteFileWithRetry(stagingRootPath, true);

        if (stagedEntries.length > 0) {
          await refreshDirectory(currentPath);
        }

        if (canUpdateSelection() && failedFiles.length > 0) {
          const failedSelection = failedFiles
            .filter((item) => item.retainSelection !== false)
            .map((item) => item.file);

          if (failedSelection.length > 0) {
            replaceSelection(failedSelection);
          } else {
            clearSelection();
          }
        } else if (canUpdateSelection()) {
          clearSelection();
        }

        if (failedFiles.length === 0) {
          showNotification(
            t("fileManager.messages.deleteSuccessCount", {
              count: deletedFiles.length,
            }),
            "success",
          );
          return;
        }

        const summaryMessage = t("fileManager.messages.deletePartialResult", {
          deleted: deletedFiles.length,
          failed: failedFiles.length,
        });
        const firstError = failedFiles[0]?.error;
        const rollbackMessage =
          deletedFiles.length > 0
            ? t("fileManager.messages.deleteRollbackApplied")
            : t("fileManager.messages.deleteRollbackKeptFiles");
        showNotification(
          firstError
            ? `${summaryMessage} ${rollbackMessage}：${firstError}`
            : `${summaryMessage} ${rollbackMessage}`,
          deletedFiles.length > 0 ? "warning" : "error",
          6000,
        );
      } catch (error) {
        showNotification(
          `${t("fileManager.errors.deleteFailed")}: ${error.message || t("fileManager.errors.unknownError")}`,
          "error",
          6000,
        );
      } finally {
        isDeletingRef.current = false;
        setIsDeleting(false);
      }
    },
    [
      clearSelection,
      replaceSelection,
      tabId,
      createFolderWithRetry,
      currentPath,
      deleteFileWithRetry,
      refreshDirectory,
      moveFileWithRetry,
      buildCurrentFilePath,
      showNotification,
      t,
    ],
  );

  const handleBatchDelete = useCallback(() => {
    if (isDeletingRef.current) return;
    const filesToDelete = getSelectedFiles();
    if (filesToDelete.length === 0) return;

    showDeleteConfirm(filesToDelete, () => executeDeleteFiles(filesToDelete));
  }, [executeDeleteFiles, getSelectedFiles, showDeleteConfirm]);

  const handleDelete = useCallback(() => {
    handleBatchDelete();
  }, [handleBatchDelete]);

  const handleCopyAbsolutePath = async () => {
    const selectedItems = getSelectedFiles();
    if (selectedItems.length !== 1) {
      showNotification(t("fileManager.messages.copyPathError"), "warning");
      return;
    }
    const targetItem = selectedItems[0];

    try {
      const relativePath =
        currentPath === "/"
          ? "/" + targetItem.name
          : currentPath
            ? currentPath + "/" + targetItem.name
            : targetItem.name;

      if (window.terminalAPI && window.terminalAPI.getAbsolutePath) {
        const response = await window.terminalAPI.getAbsolutePath(
          tabId,
          relativePath,
        );
        if (response?.success && response.path) {
          await window.clipboardAPI.writeText(response.path);
        }
      }
    } catch (error) {
      showOperationError(
        t("fileManager.errors.unknownError") +
          ": " +
          (error.message || t("fileManager.errors.unknownError")),
      );
    }
  };

  return {
    isDeleting,
    showPreview: preview.showPreview,
    handleDelete,
    handleCopyAbsolutePath,
    handleRename: rename.openDialog,
    handleCreateFile: createFile.openDialog,
    handleCreateFolder: createFolder.openDialog,
    handleOpenProperties: details.handleOpenProperties,
    handleOpenPermissions: details.handleOpenPermissions,
    handleFileActivate: preview.handleFileActivate,
    dialogs: {
      rename,
      createFile,
      createFolder,
      properties: details.properties,
      permissions: details.permissions,
      preview: preview.dialog,
    },
  };
}
