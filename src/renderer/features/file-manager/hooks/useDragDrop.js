import { useState, useCallback, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  getLocalPathBaseName,
  getDroppedEntryName,
} from "../fileManagerUtils.js";
/** Matches native drop entries to local paths before handing them to transfer tasks. */
export default function useDragDrop({
  open = true,
  sshConnection,
  setNotification,
  handleDroppedItems,
}) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);

  const dragCounterRef = useRef(0);
  useEffect(() => {
    if (!open) {
      dragCounterRef.current = 0;
      setIsDragging(false);
    }
  }, [open]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    // 增加计数器
    dragCounterRef.current += 1;

    // Only native file gestures should show an upload overlay.
    if (
      Array.from(e.dataTransfer?.items || []).some(
        (item) => item.kind === "file",
      )
    ) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    // 减少计数器
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    // 设置允许的拖拽效果
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const getDroppedFileLocalPath = useCallback((file) => {
    if (!file) return "";

    if (window.terminalAPI?.getPathForFile) {
      try {
        const resolvedPath = window.terminalAPI.getPathForFile(file);
        if (typeof resolvedPath === "string" && resolvedPath) {
          return resolvedPath;
        }
      } catch {
        return "";
      }
    }

    return "";
  }, []);

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault();
      e.stopPropagation();

      setIsDragging(false);
      dragCounterRef.current = 0;

      if (!sshConnection) {
        setNotification({
          message: t("fileManager.errors.noConnection"),
          severity: "error",
        });
        return;
      }

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      const itemsArray = Array.from(items);
      const nativeFiles = Array.from(e.dataTransfer.files || []);
      if (itemsArray.some((item) => item.kind === "string")) {
        setNotification({
          message: t("fileManager.errors.dragDropRemotePathUnsupported"),
          severity: "warning",
        });
        return;
      }

      if (nativeFiles.length !== itemsArray.length) {
        setNotification({
          message: t("fileManager.errors.dragDropRemotePathUnsupported"),
          severity: "warning",
        });
        return;
      }

      const nativePathByName = new Map();
      const duplicateNativeNames = new Set();
      let hasInvalidNativePath = false;
      for (const nativeFile of nativeFiles) {
        const localPath = getDroppedFileLocalPath(nativeFile);
        const localBaseName = getLocalPathBaseName(localPath);
        if (!localPath || !localBaseName) {
          hasInvalidNativePath = true;
          continue;
        }

        if (nativePathByName.has(localBaseName)) {
          duplicateNativeNames.add(localBaseName);
        }
        nativePathByName.set(localBaseName, localPath);
      }

      if (hasInvalidNativePath || duplicateNativeNames.size > 0) {
        setNotification({
          message: t("fileManager.errors.dragDropRemotePathUnsupported"),
          severity: "warning",
        });
        return;
      }

      const filesAndFolders = [];
      const rejectedItems = [];

      for (let index = 0; index < itemsArray.length; index += 1) {
        const item = itemsArray[index];
        if (item.kind !== "file") {
          rejectedItems.push(item);
          continue;
        }

        const entry = item.webkitGetAsEntry?.();
        const entryName = getDroppedEntryName(entry);
        const localPath = nativePathByName.get(entryName);

        if (entry && entryName && localPath) {
          filesAndFolders.push({ entry, localPath });
          continue;
        }

        rejectedItems.push(item);
      }

      if (rejectedItems.length > 0 || filesAndFolders.length === 0) {
        setNotification({
          message: t("fileManager.errors.dragDropRemotePathUnsupported"),
          severity: "warning",
        });
        return;
      }

      try {
        await handleDroppedItems(filesAndFolders);
      } catch (error) {
        setNotification({
          message:
            error?.message ||
            t("fileManager.errors.dragDropValidationFailed", {
              reason: t("fileManager.errors.unknownError"),
            }),
          severity: "error",
        });
      }
    },
    [
      sshConnection,
      t,
      handleDroppedItems,
      setNotification,
      getDroppedFileLocalPath,
    ],
  );
  return {
    isDragging,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  };
}
