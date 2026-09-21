import { useState, useEffect, useCallback, useRef } from "react";
import { formatFileSize } from "../../../utils/formatters.js";
import { useTranslation } from "react-i18next";

/** Owns preview identity and external editor subscriptions. */
export default function useFilePreview({
  currentPath,
  tabId,
  showNotification,
  refreshAfterUserActivity,
  handleEnterDirectory,
}) {
  const { t } = useTranslation();
  const showOperationError = useCallback(
    (message) => showNotification(message, "error"),
    [showNotification],
  );
  const [filePreview, setFilePreview] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [externalEditorEnabled, setExternalEditorEnabled] = useState(false);
  const externalEditorEventThrottles = useRef(new Map());

  const [previewLocation, setPreviewLocation] = useState({
    currentPath,
    tabId,
  });
  const previewRequestRef = useRef(0);
  useEffect(() => {
    setShowPreview(false);
    setFilePreview(null);
    return () => {
      previewRequestRef.current += 1;
    };
  }, [tabId]);

  useEffect(() => {
    let active = true;
    let updated = false;
    const onSettingsChanged = (event) => {
      const enabled = event.detail?.externalEditor?.enabled;
      if (typeof enabled === "boolean") {
        updated = true;
        setExternalEditorEnabled(enabled);
      }
    };
    window.addEventListener("settingsChanged", onSettingsChanged);
    const load = async () => {
      if (!window.terminalAPI?.loadUISettings) return;
      try {
        const settings = await window.terminalAPI?.loadUISettings?.();
        if (active && !updated)
          setExternalEditorEnabled(settings?.externalEditor?.enabled === true);
      } catch {
        // The default remains disabled; a newer settings event takes precedence.
      }
    };
    void load();
    return () => {
      active = false;
      window.removeEventListener("settingsChanged", onSettingsChanged);
    };
  }, []);

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

      setPreviewLocation({ currentPath, tabId });
      setFilePreview(file);
      setShowPreview(true);
      refreshAfterUserActivity();
      return true;
    },
    [currentPath, tabId, refreshAfterUserActivity, showOperationError, t],
  );

  const handleFileActivate = async (file) => {
    const request = ++previewRequestRef.current;
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
      if (request !== previewRequestRef.current) return;
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
      if (request !== previewRequestRef.current) return;
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
    previewRequestRef.current += 1;
    setShowPreview(false);
  };

  return {
    handleFileActivate,
    showPreview,
    dialog: {
      showPreview,
      handleClosePreview,
      filePreview,
      ...previewLocation,
    },
  };
}
