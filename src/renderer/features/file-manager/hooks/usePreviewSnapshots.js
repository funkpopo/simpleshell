import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  formatSnapshotDate,
  buildSnapshotDiffData,
  buildDiffPaneData,
} from "../lib/snapshotDiff.js";

export default function usePreviewSnapshots({
  content,
  open,
  tabId,
  fullPath,
  setNotification,
  pendingRestoreSnapshot,
  setPendingRestoreSnapshot,
  queueTextEditorScrollRestore,
  captureTextEditorScrollPosition,
  setContent,
  syncedContentRef,
  syncedContentTimestampRef,
  setModified,
  setIsEditing,
}) {
  const { t } = useTranslation();
  const isTextPreview = true;
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState(null);
  const [selectedSnapshotContent, setSelectedSnapshotContent] = useState(null);
  const [loadingSelectedSnapshot, setLoadingSelectedSnapshot] = useState(false);
  const visibleSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot?.type !== "rollback-backup"),
    [snapshots],
  );
  const snapshotDiffData = useMemo(() => {
    if (
      typeof content !== "string" ||
      typeof selectedSnapshotContent !== "string"
    ) {
      return null;
    }

    return buildSnapshotDiffData(selectedSnapshotContent, content);
  }, [content, selectedSnapshotContent]);
  const snapshotDiffPaneData = useMemo(() => {
    if (!snapshotDiffData) {
      return null;
    }

    return {
      base: buildDiffPaneData(snapshotDiffData.rows, "base"),
      current: buildDiffPaneData(snapshotDiffData.rows, "current"),
    };
  }, [snapshotDiffData]);
  const refreshSnapshots = useCallback(async () => {
    if (!open || !isTextPreview || !window.terminalAPI?.listFileSnapshots) {
      setSnapshots([]);
      return;
    }

    setLoadingSnapshots(true);
    try {
      const response = await window.terminalAPI.listFileSnapshots(
        tabId,
        fullPath,
      );
      if (response?.success) {
        setSnapshots(
          Array.isArray(response.snapshots) ? response.snapshots : [],
        );
      } else {
        throw new Error(
          response?.error || t("filePreview.errors.loadSnapshotsFailed"),
        );
      }
    } catch (error) {
      setNotification({
        message: t("filePreview.errors.loadSnapshotPointsFailed", {
          error: error.message || t("fileManager.errors.unknownError"),
        }),
        severity: "error",
      });
    } finally {
      setLoadingSnapshots(false);
    }
  }, [open, isTextPreview, tabId, fullPath]);
  const createSnapshot = useCallback(
    async (
      snapshotContent,
      {
        label = t("filePreview.savedVersionLabel"),
        type = "save",
        silent = false,
        successMessage = t("filePreview.snapshotCreated"),
        createdAt,
        force = false,
      } = {},
    ) => {
      if (
        !isTextPreview ||
        typeof snapshotContent !== "string" ||
        !window.terminalAPI?.createFileSnapshot
      ) {
        return null;
      }

      setCreatingSnapshot(true);
      try {
        const response = await window.terminalAPI.createFileSnapshot(
          tabId,
          fullPath,
          snapshotContent,
          {
            label,
            type,
            createdAt,
            force,
          },
        );

        if (!response?.success) {
          throw new Error(
            response?.error || t("filePreview.errors.createSnapshotFailed"),
          );
        }

        await refreshSnapshots();

        if (!silent) {
          setNotification({
            message: response.deduplicated
              ? t("filePreview.snapshotDeduplicated")
              : successMessage,
            severity: "success",
          });
        }

        return response.snapshot || null;
      } catch (error) {
        if (!silent) {
          setNotification({
            message: t("filePreview.errors.createSnapshotPointFailed", {
              error: error.message || t("fileManager.errors.unknownError"),
            }),
            severity: "error",
          });
        }
        return null;
      } finally {
        setCreatingSnapshot(false);
      }
    },
    [isTextPreview, tabId, fullPath, refreshSnapshots, t],
  );
  useEffect(() => {
    if (!open || !isTextPreview) {
      setSnapshots([]);
      return;
    }

    refreshSnapshots();
  }, [open, isTextPreview, refreshSnapshots]);
  useEffect(() => {
    if (
      pendingRestoreSnapshot?.id &&
      !visibleSnapshots.some(
        (snapshot) => snapshot.id === pendingRestoreSnapshot.id,
      )
    ) {
      setPendingRestoreSnapshot(null);
      setSelectedSnapshotContent(null);
    }
  }, [pendingRestoreSnapshot, visibleSnapshots]);
  useEffect(() => {
    if (!pendingRestoreSnapshot?.id) {
      setSelectedSnapshotContent(null);
      setLoadingSelectedSnapshot(false);
      return;
    }

    if (!window.terminalAPI?.getFileSnapshot) {
      setNotification({
        message: t("filePreview.errors.snapshotReadApiUnavailable"),
        severity: "error",
      });
      setPendingRestoreSnapshot(null);
      setSelectedSnapshotContent(null);
      setLoadingSelectedSnapshot(false);
      return;
    }

    let cancelled = false;
    const snapshotId = pendingRestoreSnapshot.id;

    setLoadingSelectedSnapshot(true);

    const loadSelectedSnapshot = async () => {
      try {
        const response = await window.terminalAPI.getFileSnapshot(
          tabId,
          fullPath,
          snapshotId,
        );

        if (!response?.success) {
          throw new Error(
            response?.error || t("filePreview.errors.readSnapshotFailed"),
          );
        }

        if (!cancelled) {
          setSelectedSnapshotContent(
            typeof response.snapshot?.content === "string"
              ? response.snapshot.content
              : "",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setNotification({
            message: t("filePreview.errors.loadDiffFailed", {
              error: error.message || t("fileManager.errors.unknownError"),
            }),
            severity: "error",
          });
          setPendingRestoreSnapshot((current) =>
            current?.id === snapshotId ? null : current,
          );
          setSelectedSnapshotContent(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingSelectedSnapshot(false);
        }
      }
    };

    loadSelectedSnapshot();

    return () => {
      cancelled = true;
    };
  }, [pendingRestoreSnapshot, tabId, fullPath, t]);
  const handleSelectSnapshot = useCallback(
    (snapshot) => {
      if (!snapshot?.id || restoringSnapshotId) {
        return;
      }

      if (pendingRestoreSnapshot?.id === snapshot.id) {
        queueTextEditorScrollRestore();
        setPendingRestoreSnapshot(null);
        setSelectedSnapshotContent(null);
        return;
      }

      captureTextEditorScrollPosition();
      queueTextEditorScrollRestore();
      setPendingRestoreSnapshot(snapshot);
    },
    [
      captureTextEditorScrollPosition,
      pendingRestoreSnapshot,
      queueTextEditorScrollRestore,
      restoringSnapshotId,
    ],
  );
  const handleClearSnapshotSelection = useCallback(() => {
    queueTextEditorScrollRestore();
    setPendingRestoreSnapshot(null);
    setSelectedSnapshotContent(null);
  }, [queueTextEditorScrollRestore]);
  const handleRestoreSnapshot = useCallback(async () => {
    if (
      !pendingRestoreSnapshot?.id ||
      !window.terminalAPI?.restoreFileSnapshot ||
      typeof content !== "string"
    ) {
      return;
    }

    setRestoringSnapshotId(pendingRestoreSnapshot.id);

    try {
      const response = await window.terminalAPI.restoreFileSnapshot(
        tabId,
        fullPath,
        pendingRestoreSnapshot.id,
        content,
      );

      if (!response?.success) {
        throw new Error(
          response?.error || t("filePreview.errors.restoreFailed"),
        );
      }

      setContent(response.content);
      syncedContentRef.current = response.content;
      syncedContentTimestampRef.current = new Date().toISOString();
      setModified(false);
      setIsEditing(true);
      setSnapshots(Array.isArray(response.snapshots) ? response.snapshots : []);
      setSelectedSnapshotContent(null);
      queueTextEditorScrollRestore();
      setNotification({
        message: t("filePreview.restoredToVersion", {
          date: formatSnapshotDate(pendingRestoreSnapshot.createdAt),
        }),
        severity: "success",
      });
      setPendingRestoreSnapshot(null);
    } catch (error) {
      setNotification({
        message: t("filePreview.errors.restoreFailedWithMessage", {
          error: error.message || t("fileManager.errors.unknownError"),
        }),
        severity: "error",
      });
    } finally {
      setRestoringSnapshotId(null);
    }
  }, [
    pendingRestoreSnapshot,
    tabId,
    fullPath,
    content,
    queueTextEditorScrollRestore,
    t,
  ]);
  return {
    loadingSelectedSnapshot,
    visibleSnapshots,
    snapshotDiffData,
    snapshotDiffPaneData,
    refreshSnapshots,
    creatingSnapshot,
    loadingSnapshots,
    restoringSnapshotId,
    createSnapshot,
    handleSelectSnapshot,
    handleClearSnapshotSelection,
    handleRestoreSnapshot,
    setSnapshots,
  };
}
