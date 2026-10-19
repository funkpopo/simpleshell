import { useState, useEffect, useCallback, useRef } from "react";
import { Typography, CircularProgress } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { EditorSelection } from "@codemirror/state";
import { useTranslation } from "react-i18next";
import { formatFileSize } from "../../../shared/lib/formatters.js";
import { isTextFile } from "../lib/filePreviewTypes.js";
import usePreviewNotification from "../hooks/usePreviewNotification.js";
import usePreviewDownload from "../hooks/usePreviewDownload.js";
import useTextPreviewEditor from "../hooks/useTextPreviewEditor.js";
import usePreviewSnapshots from "../hooks/usePreviewSnapshots.js";
import usePreviewContextMenu from "../hooks/usePreviewContextMenu.js";
import TextPreviewDialog from "./TextPreviewDialog.jsx";
import TextPreviewContent from "./TextPreviewContent.jsx";

export default function TextPreview({ open, onClose, file, path, tabId }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [modified, setModified] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [pendingRestoreSnapshot, setPendingRestoreSnapshot] = useState(null);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const syncedContentRef = useRef(null);
  const syncedContentTimestampRef = useRef(null);
  const closeInProgressRef = useRef(false);
  const isTextPreview = true;
  const fullPath = path === "/" ? "/" + file?.name : path + "/" + file?.name;
  const setNotification = usePreviewNotification();
  const handleDownload = usePreviewDownload({
    file,
    tabId,
    fullPath,
    setNotification,
  });
  const {
    textEditorRef,
    textEditorScrollSnapshotRef,
    captureTextEditorScrollPosition,
    queueTextEditorScrollRestore,
    restoreTextEditorScrollPosition,
    handleTextEditorCreate,
    globalEditorFont,
    codemirrorLangExtensions,
    syntaxHighlightState,
    textEditorExtensions,
    handleEditorChange,
    handleOpenTextSearch,
    switchToPreviewMode,
    switchToEditMode,
  } = useTextPreviewEditor({
    open,
    file,
    setContent,
    setModified,
    loading,
    savingFile,
    pendingRestoreSnapshot,
    isEditing,
    setIsEditing,
  });
  const {
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
  } = usePreviewSnapshots({
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
  });
  const {
    contextMenu,
    diffBaseViewRef,
    diffCurrentViewRef,
    handleTextContextMenu,
    handleDiffContextMenu,
    handleContextMenuClose,
    isEditorContextMenu,
    isTextContextMenu,
    handleCutSelection,
    canEditFromContextMenu,
    handleCopySelection,
    handlePasteText,
    handleSelectAllContent,
    handleSearchFromContextMenu,
    canSearchFromContextMenu,
    handleDownloadFromContextMenu,
  } = usePreviewContextMenu({
    textEditorRef,
    setNotification,
    isEditing,
    pendingRestoreSnapshot,
    setContent,
    setModified,
    handleOpenTextSearch,
    handleDownload,
    loading,
    savingFile,
    syntaxHighlightState,
  });
  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;

    const loadFileContent = async () => {
      setLoading(true);
      setError(null);
      setPendingRestoreSnapshot(null);
      setSnapshots([]);
      syncedContentRef.current = null;
      syncedContentTimestampRef.current = null;
      textEditorScrollSnapshotRef.current = { top: 0, left: 0 };
      queueTextEditorScrollRestore();

      try {
        // 检查文件大小限制 (10MB = 10 * 1024 * 1024 bytes)
        const maxFileSize = 10 * 1024 * 1024;
        if (file.size && file.size > maxFileSize) {
          setError(
            t("filePreview.errors.fileTooLarge", {
              size: formatFileSize(file.size),
            }),
          );
          setLoading(false);
          return;
        }

        // 尝试读取文本文件
        if (window.terminalAPI && window.terminalAPI.readFileContent) {
          const response = await window.terminalAPI.readFileContent(
            tabId,
            fullPath,
          );
          if (cancelled) return;
          if (response.success) {
            // 检查内容是否可能是二进制数据
            const content = response.content;
            if (typeof content === "string") {
              // 简单检查是否包含大量不可打印字符（可能是二进制文件）
              const nonPrintableCount = [...content].filter((char) => {
                const code = char.charCodeAt(0);
                return (
                  (code >= 0 && code <= 8) ||
                  (code >= 14 && code <= 31) ||
                  (code >= 127 && code <= 255)
                );
              }).length;
              const nonPrintableRatio =
                content.length > 0 ? nonPrintableCount / content.length : 0;

              if (nonPrintableRatio > 0.3) {
                // 如果不可打印字符超过30%，可能是二进制文件
                setError(t("filePreview.errors.binaryTextUnsafe"));
              } else {
                setContent(content);
                syncedContentRef.current = content;
                syncedContentTimestampRef.current = new Date().toISOString();
                // 重置修改状态
                setModified(false);
              }
            } else {
              setContent(response.content);
              syncedContentRef.current = response.content;
              syncedContentTimestampRef.current = new Date().toISOString();
              setModified(false);
            }
          } else {
            // 如果读取失败，提供更友好的错误信息
            const errorMsg =
              response.error || t("filePreview.errors.readContentFailed");
            if (errorMsg.includes("binary") || errorMsg.includes("二进制")) {
              setError(t("filePreview.errors.binaryTextBlocked"));
            } else {
              setError(
                t("filePreview.errors.readContentFailedWithHint", {
                  error: errorMsg,
                }),
              );
            }
          }
        } else {
          setError(t("filePreview.errors.fileReadApiUnavailable"));
        }
      } catch (err) {
        if (!cancelled)
          setError(
            t("filePreview.errors.previewFailed", {
              error: err.message || t("fileManager.errors.unknownError"),
            }),
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadFileContent();
    // 重置编辑状态
    setIsEditing(false);
    return () => {
      cancelled = true;
    };
  }, [
    open,
    file,
    fullPath,
    tabId,
    createSnapshot,
    queueTextEditorScrollRestore,
    t,
  ]);
  useEffect(() => {
    if (!open || !isTextPreview || pendingRestoreSnapshot) {
      return;
    }

    restoreTextEditorScrollPosition();
  }, [
    content,
    globalEditorFont,
    fullPath,
    isEditing,
    isTextPreview,
    open,
    pendingRestoreSnapshot,
    restoreTextEditorScrollPosition,
    theme.palette.mode,
  ]);
  const handleSaveFile = useCallback(async () => {
    if (!file || !isTextFile(file.name) || !modified) return;

    try {
      setSavingFile(true);
      const saveClickedAt = new Date().toISOString();
      const baselineContent = syncedContentRef.current;
      const baselineCreatedAt =
        syncedContentTimestampRef.current || saveClickedAt;
      // 历史记录只保留被本次保存替换掉的旧版本；当前文件内容不进入历史，
      // 避免出现与当前内容完全相同、diff 无差异的"已保存版本"记录。
      const shouldSnapshotBaseline =
        typeof baselineContent === "string" && baselineContent !== content;
      const isFirstSnapshot = visibleSnapshots.length === 0;

      if (window.terminalAPI && window.terminalAPI.saveFileContent) {
        const response = await window.terminalAPI.saveFileContent(
          tabId,
          fullPath,
          content,
        );

        if (response.success) {
          if (shouldSnapshotBaseline) {
            await createSnapshot(baselineContent, {
              label: isFirstSnapshot
                ? t("filePreview.initialVersionLabel")
                : t("filePreview.savedVersionLabel"),
              type: isFirstSnapshot ? "initial" : "save",
              silent: true,
              createdAt: baselineCreatedAt,
            });
          }
          syncedContentRef.current = content;
          syncedContentTimestampRef.current = saveClickedAt;
          setNotification({
            message:
              shouldSnapshotBaseline && isFirstSnapshot
                ? t("filePreview.saveSuccessWithInitial")
                : t("filePreview.saveSuccess"),
            severity: "success",
          });
          setModified(false);
          return true;
        } else {
          setNotification({
            message: t("filePreview.errors.saveFailed", {
              error: response.error || t("fileManager.errors.unknownError"),
            }),
            severity: "error",
          });
          return false;
        }
      } else {
        setNotification({
          message: t("filePreview.errors.saveApiUnavailable"),
          severity: "error",
        });
        return false;
      }
    } catch (error) {
      setNotification({
        message: t("filePreview.errors.saveFailed", {
          error: error.message || t("fileManager.errors.unknownError"),
        }),
        severity: "error",
      });
      return false;
    } finally {
      setSavingFile(false);
    }
  }, [
    file,
    content,
    modified,
    tabId,
    fullPath,
    createSnapshot,
    visibleSnapshots.length,
    t,
  ]);
  useEffect(() => {
    if (!open || showCloseConfirm) return undefined;

    // 预览对话框是模态窗口，打开期间焦点被限制在对话框内，
    // 但初始焦点常落在 MUI Dialog 容器上（位于 Paper 之外），
    // 因此这里不再要求事件目标位于对话框内部，直接接管通用快捷键。
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.defaultPrevented) return;

      const key = (event.key || "").toLowerCase();

      if (key === "f") {
        if (!isTextFile(file?.name) || pendingRestoreSnapshot) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        handleOpenTextSearch();
        return;
      }

      if (key === "s") {
        if (!isTextFile(file?.name)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (!modified || savingFile || pendingRestoreSnapshot) {
          return;
        }

        handleSaveFile();
        return;
      }

      if (key === "a") {
        if (!isTextFile(file?.name) || pendingRestoreSnapshot) {
          return;
        }

        // 焦点位于输入框或编辑器内时，交由原生/编辑器自身处理全选
        const target = event.target;
        const tagName = String(target?.tagName || "").toLowerCase();
        if (
          target?.isContentEditable ||
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select"
        ) {
          return;
        }

        const view = textEditorRef.current;
        if (!view) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        view.focus();
        const docLength = view.state.doc.length;
        view.dispatch({
          selection: EditorSelection.single(0, docLength),
          scrollIntoView: true,
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    open,
    showCloseConfirm,
    file,
    modified,
    savingFile,
    pendingRestoreSnapshot,
    handleOpenTextSearch,
    handleSaveFile,
  ]);
  const handleClose = async () => {
    if (closeInProgressRef.current) {
      return;
    }

    if (savingFile) {
      return;
    }

    if (isTextPreview && modified) {
      setShowCloseConfirm(true);
      return;
    }

    closeInProgressRef.current = true;
    try {
      onClose();
    } finally {
      closeInProgressRef.current = false;
    }
  };
  const handleDiscardAndClose = async () => {
    setShowCloseConfirm(false);

    onClose();
  };
  const handleSaveAndClose = async () => {
    if (!modified) {
      await handleDiscardAndClose();
      return;
    }

    const saved = await handleSaveFile();
    if (saved) {
      setShowCloseConfirm(false);

      onClose();
    }
  };
  useEffect(() => {
    if (!open || showCloseConfirm) {
      return undefined;
    }

    const selector = '[data-file-preview-dialog="true"]';
    const handlePreviewEscape = (event) => {
      if (
        event.key !== "Escape" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target;
      const activeElement = document.activeElement;
      const isInsideDialog =
        (target &&
          typeof target.closest === "function" &&
          target.closest(selector)) ||
        (activeElement &&
          typeof activeElement.closest === "function" &&
          activeElement.closest(selector));

      if (!isInsideDialog) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      handleClose();
    };

    document.addEventListener("keydown", handlePreviewEscape, true);
    return () => {
      document.removeEventListener("keydown", handlePreviewEscape, true);
    };
  }, [handleClose, open, showCloseConfirm]);
  return (
    <TextPreviewDialog
      open={open}
      handleClose={handleClose}
      isTextPreview={isTextPreview}
      file={file}
      modified={modified}
      fullPath={fullPath}
      syntaxHighlightState={syntaxHighlightState}
      pendingRestoreSnapshot={pendingRestoreSnapshot}
      isEditing={isEditing}
      savingFile={savingFile}
      handleDownload={handleDownload}
      loading={loading}
      handleOpenTextSearch={handleOpenTextSearch}
      switchToPreviewMode={switchToPreviewMode}
      switchToEditMode={switchToEditMode}
      handleSaveFile={handleSaveFile}
      contextMenu={contextMenu}
      handleContextMenuClose={handleContextMenuClose}
      isEditorContextMenu={isEditorContextMenu}
      isTextContextMenu={isTextContextMenu}
      handleCutSelection={handleCutSelection}
      canEditFromContextMenu={canEditFromContextMenu}
      handleCopySelection={handleCopySelection}
      handlePasteText={handlePasteText}
      handleSelectAllContent={handleSelectAllContent}
      handleSearchFromContextMenu={handleSearchFromContextMenu}
      canSearchFromContextMenu={canSearchFromContextMenu}
      handleDownloadFromContextMenu={handleDownloadFromContextMenu}
      showCloseConfirm={showCloseConfirm}
      setShowCloseConfirm={setShowCloseConfirm}
      handleDiscardAndClose={handleDiscardAndClose}
      handleSaveAndClose={handleSaveAndClose}
    >
      {loading ? (
        <CircularProgress size={40} />
      ) : error ? (
        <Typography color="error">{error}</Typography>
      ) : (
        <TextPreviewContent
          visibleSnapshots={visibleSnapshots}
          syntaxHighlightState={syntaxHighlightState}
          pendingRestoreSnapshot={pendingRestoreSnapshot}
          diffBaseViewRef={diffBaseViewRef}
          diffCurrentViewRef={diffCurrentViewRef}
          snapshotDiffData={snapshotDiffData}
          globalEditorFont={globalEditorFont}
          codemirrorLangExtensions={codemirrorLangExtensions}
          handleDiffContextMenu={handleDiffContextMenu}
          loadingSelectedSnapshot={loadingSelectedSnapshot}
          snapshotDiffPaneData={snapshotDiffPaneData}
          handleTextContextMenu={handleTextContextMenu}
          content={content}
          textEditorExtensions={textEditorExtensions}
          isEditing={isEditing}
          handleEditorChange={handleEditorChange}
          handleTextEditorCreate={handleTextEditorCreate}
          refreshSnapshots={refreshSnapshots}
          loadingSnapshots={loadingSnapshots}
          creatingSnapshot={creatingSnapshot}
          handleSelectSnapshot={handleSelectSnapshot}
          restoringSnapshotId={restoringSnapshotId}
          handleRestoreSnapshot={handleRestoreSnapshot}
          savingFile={savingFile}
          handleClearSnapshotSelection={handleClearSnapshotSelection}
        />
      )}
    </TextPreviewDialog>
  );
}
