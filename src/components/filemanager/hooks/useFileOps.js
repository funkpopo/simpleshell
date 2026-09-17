import { useState, useEffect, useCallback, useRef } from "react";
import useAutoCleanup from "../../../hooks/useAutoCleanup";
import {
  formatFileSize,
  formatAbsoluteDateTime,
} from "../../../core/utils/formatters.js";
import { useTranslation } from "react-i18next";
import { joinPath, getParentPath, withSftpRetry } from "../fileManagerUtils.js";
/** Owns file mutations and editor/dialog state. Navigation and confirmation are explicit commands. */
export default function useFileOps({
  showNotification,
  confirmAction,
  currentPath,
  tabId,
  loadDirectory,
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
  const { addEventListener } = useAutoCleanup();
  const [isDeleting, setIsDeleting] = useState(false);

  const isDeletingRef = useRef(isDeleting);

  useEffect(() => {
    isDeletingRef.current = isDeleting;
  }, [isDeleting]);

  const [showRenameDialog, setShowRenameDialog] = useState(false);

  const [newName, setNewName] = useState("");

  const [renameDialogError, setRenameDialogError] = useState("");

  const [renameSubmitting, setRenameSubmitting] = useState(false);

  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);

  const [newFolderName, setNewFolderName] = useState("");

  const [createFolderDialogError, setCreateFolderDialogError] = useState("");

  const [createFolderSubmitting, setCreateFolderSubmitting] = useState(false);

  const [showCreateFileDialog, setShowCreateFileDialog] = useState(false);

  const [newFileName, setNewFileName] = useState("");

  const [createFileDialogError, setCreateFileDialogError] = useState("");

  const [createFileSubmitting, setCreateFileSubmitting] = useState(false);

  const [filePreview, setFilePreview] = useState(null);

  const [showPreview, setShowPreview] = useState(false);

  const [showPropertiesDialog, setShowPropertiesDialog] = useState(false);

  const [propertiesLoading, setPropertiesLoading] = useState(false);

  const [propertiesData, setPropertiesData] = useState(null);

  const [externalEditorEnabled, setExternalEditorEnabled] = useState(false);

  const [showPermissionDialog, setShowPermissionDialog] = useState(false);

  const [permDialogPermissions, setPermDialogPermissions] = useState("644");

  const [permDialogOwner, setPermDialogOwner] = useState("");

  const [permDialogGroup, setPermDialogGroup] = useState("");

  const [permInitial, setPermInitial] = useState({
    permissions: "",
    owner: "",
    group: "",
  });

  const externalEditorEventThrottles = useRef(new Map());

  useEffect(() => {
    let ignore = false;

    const loadExternalEditorSetting = async () => {
      if (!window.terminalAPI?.loadUISettings) {
        if (!ignore) {
          setExternalEditorEnabled(false);
        }
        return;
      }
      try {
        const settings = await window.terminalAPI.loadUISettings();
        if (!ignore) {
          setExternalEditorEnabled(settings?.externalEditor?.enabled === true);
        }
      } catch {
        if (!ignore) {
          setExternalEditorEnabled(false);
        }
      }
    };

    loadExternalEditorSetting();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    // addEventListener 返回资源ID用于管理，而不是清理函数
    // useAutoCleanup会在组件卸载时自动清理
    addEventListener(window, "settingsChanged", (event) => {
      const externalEditorSettings = event.detail?.externalEditor;
      if (
        externalEditorSettings &&
        typeof externalEditorSettings.enabled === "boolean"
      ) {
        setExternalEditorEnabled(externalEditorSettings.enabled);
      }
    });
    // useEffect 不应该返回 addEventListener 的返回值
  }, [addEventListener]);

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
    [formatSelectedFilesSummary, t],
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
    [showBatchOperationConfirm, t],
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

      setIsDeleting(true);

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
          await loadDirectory(currentPath, 0, true);
        }

        if (failedFiles.length > 0) {
          const failedSelection = failedFiles
            .filter((item) => item.retainSelection !== false)
            .map((item) => item.file);

          if (failedSelection.length > 0) {
            replaceSelection(failedSelection);
          } else {
            clearSelection();
          }
        } else {
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
        setIsDeleting(false);
      }
    },
    [
      clearSelection,
      createFolderWithRetry,
      currentPath,
      deleteFileWithRetry,
      loadDirectory,
      moveFileWithRetry,
      buildCurrentFilePath,
      showNotification,
      t,
    ],
  );

  const getFullPathForFile = useCallback(
    (file) => {
      if (!file) return "";
      const base = currentPath && currentPath.length > 0 ? currentPath : "/";
      if (base === "/") return `/${file.name}`;
      return `${base}/${file.name}`;
    },
    [currentPath],
  );

  const formatAbsoluteTime = useCallback(
    (timestamp) =>
      formatAbsoluteDateTime(timestamp, {
        fallback: t("fileManager.propertiesDialog.notAvailable"),
        requirePositiveNumber: true,
      }),
    [t],
  );

  const formatPermissionMode = useCallback((mode) => {
    if (!Number.isFinite(mode)) {
      return "";
    }
    return (mode & 0o777).toString(8).padStart(3, "0");
  }, []);

  const normalizePropertiesData = useCallback(
    (file, fullPath) => {
      if (!file) return null;
      return {
        name: file.name || "",
        type: file.isDirectory
          ? t("fileManager.fileTypes.folder")
          : t("fileManager.fileTypes.file"),
        path: fullPath || "",
        size: Number.isFinite(file.size) ? file.size : null,
        modifyTime: Number.isFinite(file.modifyTime) ? file.modifyTime : null,
        accessTime: Number.isFinite(file.accessTime) ? file.accessTime : null,
        createTime: Number.isFinite(file.createTime) ? file.createTime : null,
        permissions: formatPermissionMode(file.mode),
        uid: Number.isFinite(file.uid) ? file.uid : null,
        gid: Number.isFinite(file.gid) ? file.gid : null,
        isDirectory: Boolean(file.isDirectory),
      };
    },
    [formatPermissionMode, t],
  );

  const handleOpenProperties = useCallback(async () => {
    if (!selectedFile) return;

    const fullPath = getFullPathForFile(selectedFile);
    setPropertiesData(normalizePropertiesData(selectedFile, fullPath));
    setShowPropertiesDialog(true);
    setPropertiesLoading(true);

    try {
      const [absolutePathResp, permissionResp] = await Promise.all([
        window.terminalAPI?.getAbsolutePath
          ? window.terminalAPI.getAbsolutePath(tabId, fullPath)
          : Promise.resolve(null),
        window.terminalAPI?.getFilePermissions
          ? window.terminalAPI.getFilePermissions(tabId, fullPath)
          : Promise.resolve(null),
      ]);

      setPropertiesData((prev) => {
        if (!prev) return prev;

        const mode =
          permissionResp?.stats?.mode ?? permissionResp?.mode ?? null;
        const uid = permissionResp?.stats?.uid ?? permissionResp?.uid;
        const gid = permissionResp?.stats?.gid ?? permissionResp?.gid;
        const statsSize = permissionResp?.stats?.size;
        const statsMtime = permissionResp?.stats?.mtime;
        const statsAtime = permissionResp?.stats?.atime;
        const statsCtime = permissionResp?.stats?.ctime;

        return {
          ...prev,
          path:
            absolutePathResp?.success && absolutePathResp?.path
              ? absolutePathResp.path
              : prev.path,
          permissions: formatPermissionMode(mode) || prev.permissions || "",
          uid: Number.isFinite(uid) ? uid : prev.uid,
          gid: Number.isFinite(gid) ? gid : prev.gid,
          size: Number.isFinite(statsSize) ? statsSize : prev.size,
          modifyTime: Number.isFinite(statsMtime)
            ? statsMtime * 1000
            : prev.modifyTime,
          accessTime: Number.isFinite(statsAtime)
            ? statsAtime * 1000
            : prev.accessTime,
          createTime: Number.isFinite(statsCtime)
            ? statsCtime * 1000
            : prev.createTime,
        };
      });
    } catch (e) {
      showNotification(
        e?.message || t("fileManager.propertiesDialog.loadFailed"),
        "warning",
        3000,
      );
    } finally {
      setPropertiesLoading(false);
    }
  }, [
    selectedFile,
    getFullPathForFile,
    normalizePropertiesData,
    tabId,
    formatPermissionMode,
    showNotification,
    t,
  ]);

  const handleClosePropertiesDialog = useCallback(() => {
    setShowPropertiesDialog(false);
    setPropertiesLoading(false);
    setPropertiesData(null);
  }, []);

  const handleOpenPermissions = useCallback(async () => {
    if (!selectedFile) return;
    try {
      const fullPath = getFullPathForFile(selectedFile);
      // 默认权限
      const defaultPerm = selectedFile.isDirectory ? "755" : "644";
      setPermDialogPermissions(defaultPerm);
      setPermDialogOwner("");
      setPermDialogGroup("");
      setPermInitial({ permissions: defaultPerm, owner: "", group: "" });

      if (window.terminalAPI?.getFilePermissions) {
        const resp = await window.terminalAPI.getFilePermissions(
          tabId,
          fullPath,
        );
        if (resp?.success) {
          if (resp.permissions) {
            setPermDialogPermissions(resp.permissions);
          }
          // 预填 uid/gid（字符串），用户可改为名称
          const uid = resp.stats?.uid;
          const gid = resp.stats?.gid;
          const ownerStr =
            typeof uid === "number" || typeof uid === "string"
              ? String(uid)
              : "";
          const groupStr =
            typeof gid === "number" || typeof gid === "string"
              ? String(gid)
              : "";
          setPermDialogOwner(ownerStr);
          setPermDialogGroup(groupStr);
          setPermInitial({
            permissions: resp.permissions || defaultPerm,
            owner: ownerStr,
            group: groupStr,
          });
        }
      }
    } catch {
      // 忽略预取失败，使用默认
    }
    setShowPermissionDialog(true);
  }, [selectedFile, tabId, getFullPathForFile]);

  const handlePermissionDialogClose = useCallback(() => {
    setShowPermissionDialog(false);
  }, []);

  const handlePermissionDialogSubmit = useCallback(
    async (e) => {
      if (e && e.preventDefault) e.preventDefault();
      if (!selectedFile) return;
      const fullPath = getFullPathForFile(selectedFile);
      const ops = [];
      try {
        // 权限变更
        if (
          permDialogPermissions &&
          permDialogPermissions !== permInitial.permissions &&
          window.terminalAPI?.setFilePermissions
        ) {
          ops.push(
            window.terminalAPI.setFilePermissions(
              tabId,
              fullPath,
              permDialogPermissions,
            ),
          );
        }

        // 所有者/组变更
        const ownerChanged = permDialogOwner !== permInitial.owner;
        const groupChanged = permDialogGroup !== permInitial.group;
        if (
          (ownerChanged || groupChanged) &&
          window.terminalAPI?.setFileOwnership
        ) {
          ops.push(
            window.terminalAPI.setFileOwnership(
              tabId,
              fullPath,
              permDialogOwner || undefined,
              permDialogGroup || undefined,
            ),
          );
        }

        if (ops.length > 0) {
          const results = await Promise.all(ops);
          const failed = results.find((r) => !r?.success);
          if (failed) {
            showOperationError(
              failed.error || t("fileManager.errors.permissionSetFailed"),
            );
          } else {
            await loadDirectory(currentPath, 0, true);
          }
        }
      } catch (err) {
        showOperationError(
          `${t("fileManager.errors.permissionSetFailed")}: ${
            err?.message || t("fileManager.errors.unknownError")
          }`,
        );
      } finally {
        setShowPermissionDialog(false);
      }
    },
    [
      selectedFile,
      tabId,
      getFullPathForFile,
      permDialogPermissions,
      permDialogOwner,
      permDialogGroup,
      permInitial.permissions,
      permInitial.owner,
      permInitial.group,
      loadDirectory,
      currentPath,
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

  const handleCreateFolder = () => {
    setNewFolderName("");
    setCreateFolderDialogError("");
    setCreateFolderSubmitting(false);
    setShowCreateFolderDialog(true);
  };

  const handleCloseCreateFolderDialog = useCallback(() => {
    if (createFolderSubmitting) {
      return;
    }

    setShowCreateFolderDialog(false);
    setCreateFolderDialogError("");
  }, [createFolderSubmitting]);

  const getNameInputPrereqError = useCallback(
    (name, apiMethodName) => {
      if (!name) {
        return t("fileManager.errors.emptyName");
      }

      if (!sshConnection) {
        return t("fileManager.errors.noConnection");
      }

      if (!window.terminalAPI || !window.terminalAPI[apiMethodName]) {
        return t("fileManager.errors.fileApiNotAvailable");
      }

      return null;
    },
    [sshConnection, t],
  );

  const handleCreateFolderSubmit = async (e) => {
    e.preventDefault();

    const folderName = newFolderName.trim();
    const prereqError = getNameInputPrereqError(folderName, "createFolder");

    if (prereqError) {
      setCreateFolderDialogError(prereqError);
      return;
    }

    const fullPath =
      currentPath === "/" ? "/" + folderName : currentPath + "/" + folderName;

    setCreateFolderSubmitting(true);
    setCreateFolderDialogError("");

    try {
      const result = await withSftpRetry(
        async () => {
          const response = await window.terminalAPI.createFolder(
            tabId,
            fullPath,
          );

          if (response?.success) {
            await loadDirectory(currentPath, 0, true);
          }

          return response;
        },
        {
          maxRetries: 3,
          baseDelay: 500,
          fallbackError: t("fileManager.errors.createFolderFailed"),
          onRetry: (current, max) =>
            setCreateFolderDialogError(
              t("fileManager.messages.createFolderFailedRetrying", {
                current,
                max,
              }),
            ),
          formatCaughtError: (error) =>
            t("fileManager.errors.createFolderFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError")),
        },
      );

      if (result.success) {
        setShowCreateFolderDialog(false);
        setNewFolderName("");
        return;
      }

      setCreateFolderDialogError(result.error);
    } finally {
      setCreateFolderSubmitting(false);
    }
  };

  const handleCreateFile = () => {
    setNewFileName("");
    setCreateFileDialogError("");
    setCreateFileSubmitting(false);
    setShowCreateFileDialog(true);
  };

  const handleCloseCreateFileDialog = useCallback(() => {
    if (createFileSubmitting) {
      return;
    }

    setShowCreateFileDialog(false);
    setCreateFileDialogError("");
  }, [createFileSubmitting]);

  const handleCreateFileSubmit = async (e) => {
    e.preventDefault();

    const fileName = newFileName.trim();
    const prereqError = getNameInputPrereqError(fileName, "createFile");

    if (prereqError) {
      setCreateFileDialogError(prereqError);
      return;
    }

    const fullPath =
      currentPath === "/" ? "/" + fileName : currentPath + "/" + fileName;

    setCreateFileSubmitting(true);
    setCreateFileDialogError("");

    try {
      const result = await window.terminalAPI.createFile(tabId, fullPath);
      if (result?.success) {
        await loadDirectory(currentPath, 0, true);
        setShowCreateFileDialog(false);
        setNewFileName("");
        return;
      }

      setCreateFileDialogError(
        `${t("fileManager.errors.createFileFailed")}: ${result?.error || t("fileManager.errors.unknownError")}`,
      );
    } catch (error) {
      setCreateFileDialogError(
        t("fileManager.errors.createFileFailed") +
          ": " +
          (error.message || t("fileManager.errors.unknownError")),
      );
    } finally {
      setCreateFileSubmitting(false);
    }
  };

  useEffect(() => {
    if (!window.terminalAPI?.onExternalEditorEvent || !tabId) {
      externalEditorEventThrottles.current.clear();
      return undefined;
    }

    externalEditorEventThrottles.current.clear();

    const unsubscribe = window.terminalAPI.onExternalEditorEvent((event) => {
      if (!event || event.tabId !== tabId) {
        return;
      }

      const displayName =
        event.fileName ||
        event.remotePath ||
        t("fileManager.externalEditor.unknownFile");

      if (event.status === "opened") {
        showNotification(
          t("fileManager.externalEditor.opened", { name: displayName }),
          "info",
          2000,
        );
        return;
      }

      if (event.status === "success") {
        const throttleKey = `${event.tabId}::${event.remotePath || event.fileName || displayName}`;
        const now = Date.now();
        const last = externalEditorEventThrottles.current.get(throttleKey) || 0;
        if (now - last < 4000) {
          return;
        }
        externalEditorEventThrottles.current.set(throttleKey, now);
        showNotification(
          t("fileManager.externalEditor.synced", { name: displayName }),
          "success",
          2500,
        );
        refreshAfterUserActivity();
        return;
      }

      if (event.status === "error") {
        showNotification(
          t("fileManager.externalEditor.syncFailed", {
            name: displayName,
            error: event.error || t("fileManager.errors.unknownError"),
          }),
          "error",
          6000,
        );
      }
    });

    return () => {
      externalEditorEventThrottles.current.clear();
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [tabId, showNotification, t, refreshAfterUserActivity]);

  const openFilePreview = useCallback(
    (file) => {
      if (!file || file.isDirectory) {
        return false;
      }

      const maxFileSize = 10 * 1024 * 1024;
      if (file.size && file.size > maxFileSize) {
        showOperationError(
          t("fileManager.messages.fileSizeExceedsLimit", {
            name: file.name,
            size: formatFileSize(file.size, { t }),
          }),
        );
        return false;
      }

      setFilePreview(file);
      setShowPreview(true);
      refreshAfterUserActivity();
      return true;
    },
    [refreshAfterUserActivity, t],
  );

  const handleFileActivate = async (file) => {
    if (file.isDirectory) {
      const basePath =
        currentPath && currentPath.length > 0 ? currentPath : "/";
      const newPath =
        basePath === "/"
          ? `/${file.name}`
          : basePath.endsWith("/")
            ? `${basePath}${file.name}`
            : `${basePath}/${file.name}`;

      handleEnterDirectory(newPath);
      return;
    }

    if (
      !externalEditorEnabled ||
      !window.terminalAPI?.openFileInExternalEditor
    ) {
      openFilePreview(file);
      return;
    }

    if (!tabId) {
      showNotification(
        t("fileManager.externalEditor.missingSession"),
        "error",
        6000,
      );
      return;
    }

    const basePath = currentPath && currentPath.length > 0 ? currentPath : "/";
    let remotePath;
    if (basePath === "/") {
      remotePath = `/${file.name}`;
    } else if (basePath.endsWith("/")) {
      remotePath = `${basePath}${file.name}`;
    } else {
      remotePath = `${basePath}/${file.name}`;
    }

    try {
      const result = await window.terminalAPI.openFileInExternalEditor(
        tabId,
        remotePath,
      );
      if (!result?.success) {
        const errorMessage =
          result?.error || t("fileManager.errors.unknownError");
        showNotification(
          t("fileManager.externalEditor.launchFailed", {
            name: file.name,
            error: errorMessage,
          }),
          "error",
          6000,
        );
        openFilePreview(file);
        return;
      }
    } catch (error) {
      const errorMessage =
        (error && (error.message || error.error)) ||
        (typeof error === "string"
          ? error
          : t("fileManager.errors.unknownError"));

      if (
        typeof errorMessage === "string" &&
        errorMessage.toLowerCase().includes("disabled")
      ) {
        openFilePreview(file);
        return;
      }

      showNotification(
        t("fileManager.externalEditor.launchFailed", {
          name: file.name,
          error: errorMessage,
        }),
        "error",
        6000,
      );
      openFilePreview(file);
    }
  };

  const handleClosePreview = () => {
    setShowPreview(false);
  };

  const handleRename = async () => {
    if (!selectedFile) return;
    setNewName(selectedFile.name);
    setRenameDialogError("");
    setRenameSubmitting(false);
    // 打开重命名对话框
    setShowRenameDialog(true);
  };

  const handleCloseRenameDialog = useCallback(() => {
    if (renameSubmitting) {
      return;
    }

    setShowRenameDialog(false);
    setRenameDialogError("");
  }, [renameSubmitting]);

  const handleRenameSubmit = async (e) => {
    e.preventDefault();

    if (!selectedFile) return;

    const prereqError = getNameInputPrereqError(newName.trim(), "renameFile");

    if (prereqError) {
      setRenameDialogError(prereqError);
      return;
    }

    // 检查是否有更改
    const nameChanged = newName && newName !== selectedFile.name;
    if (!nameChanged) {
      handleCloseRenameDialog();
      return;
    }

    const oldPath =
      currentPath === "/"
        ? "/" + selectedFile.name
        : currentPath
          ? currentPath + "/" + selectedFile.name
          : selectedFile.name;

    setRenameSubmitting(true);
    setRenameDialogError("");

    try {
      const result = await withSftpRetry(
        async () => {
          const renameResponse = await window.terminalAPI.renameFile(
            tabId,
            oldPath,
            newName,
          );

          if (renameResponse?.success) {
            await loadDirectory(currentPath, 0, true);
          }

          return renameResponse;
        },
        {
          maxRetries: 3,
          baseDelay: 500,
          fallbackError: t("fileManager.errors.renameFailed"),
          onRetry: (current, max) =>
            setRenameDialogError(
              t("fileManager.messages.updateFailedRetrying", {
                current,
                max,
              }),
            ),
          formatCaughtError: (error) =>
            `${t("fileManager.errors.updateFailed")}: ${error.message || t("fileManager.errors.unknownError")}`,
        },
      );

      if (result.success) {
        setShowRenameDialog(false);
        return;
      }

      setRenameDialogError(result.error);
    } finally {
      setRenameSubmitting(false);
    }
  };
  return {
    isDeleting,
    showRenameDialog,
    newName,
    setNewName,
    renameDialogError,
    renameSubmitting,
    showCreateFolderDialog,
    newFolderName,
    setNewFolderName,
    createFolderDialogError,
    createFolderSubmitting,
    showCreateFileDialog,
    newFileName,
    setNewFileName,
    createFileDialogError,
    createFileSubmitting,
    filePreview,
    showPreview,
    showPropertiesDialog,
    propertiesLoading,
    propertiesData,
    showPermissionDialog,
    permDialogPermissions,
    setPermDialogPermissions,
    permDialogOwner,
    setPermDialogOwner,
    permDialogGroup,
    setPermDialogGroup,
    formatAbsoluteTime,
    handleOpenProperties,
    handleClosePropertiesDialog,
    handleOpenPermissions,
    handlePermissionDialogClose,
    handlePermissionDialogSubmit,
    handleDelete,
    handleCopyAbsolutePath,
    handleCreateFolder,
    handleCloseCreateFolderDialog,
    handleCreateFolderSubmit,
    handleCreateFile,
    handleCloseCreateFileDialog,
    handleCreateFileSubmit,
    handleFileActivate,
    handleClosePreview,
    handleRename,
    handleCloseRenameDialog,
    handleRenameSubmit,
  };
}
