import { useState, useCallback, useRef } from "react";
import { EditorSelection } from "@codemirror/state";
import { useTranslation } from "react-i18next";

export default function usePreviewContextMenu({
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
}) {
  const { t } = useTranslation();
  const getEditorSelectedText = (view) => {
    if (!view?.state) {
      return "";
    }

    return view.state.selection.ranges
      .filter((range) => !range.empty)
      .map((range) => view.state.doc.sliceString(range.from, range.to))
      .join("\n");
  };
  const [contextMenu, setContextMenu] = useState(null);
  const diffBaseViewRef = useRef(null);
  const diffCurrentViewRef = useRef(null);
  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);
  const getContextMenuEditorView = useCallback(() => {
    switch (contextMenu?.kind) {
      case "text":
        return textEditorRef.current;
      case "diff-base":
        return diffBaseViewRef.current;
      case "diff-current":
        return diffCurrentViewRef.current;
      default:
        return null;
    }
  }, [contextMenu?.kind]);
  const openPreviewContextMenu = useCallback((event, kind) => {
    const target = event.target;
    if (
      target?.closest?.(
        ".cm-panel.cm-search, input, textarea, select, button, [role='button']",
      )
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    let resolvedKind = kind;
    let view = null;

    if (kind === "text") {
      view = textEditorRef.current;
    } else if (kind === "diff") {
      if (target?.closest?.(".file-preview-diff-pane-base")) {
        resolvedKind = "diff-base";
        view = diffBaseViewRef.current;
      } else {
        resolvedKind = "diff-current";
        view = diffCurrentViewRef.current;
      }
    }

    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      kind: resolvedKind,
      canCopy: Boolean(getEditorSelectedText(view)),
    });
  }, []);
  const handleTextContextMenu = useCallback(
    (event) => openPreviewContextMenu(event, "text"),
    [openPreviewContextMenu],
  );
  const handleDiffContextMenu = useCallback(
    (event) => openPreviewContextMenu(event, "diff"),
    [openPreviewContextMenu],
  );
  const handleCopySelection = useCallback(async () => {
    const view = getContextMenuEditorView();
    const selectedText = getEditorSelectedText(view);
    handleContextMenuClose();

    if (!selectedText) {
      return;
    }

    try {
      await window.clipboardAPI?.writeText(selectedText);
    } catch (_error) {
      setNotification({
        message: t("filePreview.contextMenu.copyFailed"),
        severity: "error",
      });
    }
  }, [getContextMenuEditorView, handleContextMenuClose, t]);
  const handleCutSelection = useCallback(async () => {
    const view = textEditorRef.current;
    const selectedText = getEditorSelectedText(view);
    handleContextMenuClose();

    if (!view || !isEditing || pendingRestoreSnapshot || !selectedText) {
      return;
    }

    try {
      await window.clipboardAPI?.writeText(selectedText);
      const ranges = view.state.selection.ranges.filter(
        (range) => !range.empty,
      );
      const cursorPosition = ranges[0]?.from ?? 0;
      view.dispatch({
        changes: ranges.map((range) => ({
          from: range.from,
          to: range.to,
          insert: "",
        })),
        selection: EditorSelection.cursor(cursorPosition),
      });
      setContent(view.state.doc.toString());
      setModified(true);
      view.focus();
    } catch (_error) {
      setNotification({
        message: t("filePreview.contextMenu.cutFailed"),
        severity: "error",
      });
    }
  }, [handleContextMenuClose, isEditing, pendingRestoreSnapshot, t]);
  const handlePasteText = useCallback(async () => {
    const view = textEditorRef.current;
    handleContextMenuClose();

    if (!view || !isEditing || pendingRestoreSnapshot) {
      return;
    }

    try {
      const clipboardText = await window.clipboardAPI?.readText();
      if (typeof clipboardText !== "string" || !clipboardText) {
        view.focus();
        return;
      }

      const ranges = view.state.selection.ranges;
      const cursorPosition = (ranges[0]?.from ?? 0) + clipboardText.length;
      view.dispatch({
        changes: ranges.map((range) => ({
          from: range.from,
          to: range.to,
          insert: clipboardText,
        })),
        selection: EditorSelection.cursor(cursorPosition),
      });
      setContent(view.state.doc.toString());
      setModified(true);
      view.focus();
    } catch (_error) {
      setNotification({
        message: t("filePreview.contextMenu.pasteFailed"),
        severity: "error",
      });
    }
  }, [handleContextMenuClose, isEditing, pendingRestoreSnapshot, t]);
  const handleSelectAllContent = useCallback(() => {
    const view = getContextMenuEditorView();
    handleContextMenuClose();

    if (!view?.state) {
      return;
    }

    view.focus();
    view.dispatch({
      selection: EditorSelection.single(0, view.state.doc.length),
    });
  }, [getContextMenuEditorView, handleContextMenuClose]);
  const handleSearchFromContextMenu = useCallback(() => {
    handleContextMenuClose();
    handleOpenTextSearch();
  }, [handleContextMenuClose, handleOpenTextSearch]);
  const handleDownloadFromContextMenu = useCallback(() => {
    handleContextMenuClose();
    handleDownload();
  }, [handleContextMenuClose, handleDownload]);
  const isTextContextMenu = contextMenu?.kind === "text";
  const isEditorContextMenu =
    isTextContextMenu ||
    contextMenu?.kind === "diff-base" ||
    contextMenu?.kind === "diff-current";
  const canEditFromContextMenu =
    isTextContextMenu &&
    isEditing &&
    !pendingRestoreSnapshot &&
    !loading &&
    !savingFile &&
    !syntaxHighlightState.loading &&
    !syntaxHighlightState.error;
  const canSearchFromContextMenu =
    isTextContextMenu &&
    !pendingRestoreSnapshot &&
    !loading &&
    !savingFile &&
    !syntaxHighlightState.loading &&
    !syntaxHighlightState.error;
  return {
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
  };
}
