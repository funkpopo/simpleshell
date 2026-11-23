import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { redactTerminalText } from "../lib/terminalContextCollector.js";
import { requestTerminalContextAttach } from "../../../shared/state/workingDirectoryStore.js";
import {
  buildScrollbackExportFilename,
  extractTerminalScrollback,
} from "../lib/terminalBufferExport.js";

/**
 * Right-click context menu state and actions for WebTerminal.
 */
export function useTerminalContextMenu({
  sessionKey,
  termRef,
  isActiveRef,
  markPasteIfAllowed,
  handlePasteText,
  clearTerminal,
  openSearchBar,
  setShowSuggestions,
  setSuggestions,
  getTerminalContext,
  sessionMetadata = null,
  t: tProp = null,
  notification = null,
}) {
  const { t: i18nT } = useTranslation();
  const t = tProp || i18nT;
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedText, setSelectedText] = useState("");

  const handleClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenu = useCallback(
    (event) => {
      event.preventDefault();
      // Our menu reads xterm's selection directly; bypass xterm's native-menu
      // textarea relocation and selection changes before opening it.
      event.stopPropagation();

      setShowSuggestions(false);
      setSuggestions([]);

      if (termRef.current) {
        const selection = termRef.current.getSelection();
        setSelectedText(selection);
      }

      setContextMenu((previous) =>
        previous === null
          ? { mouseX: event.clientX - 2, mouseY: event.clientY - 4 }
          : null,
      );
    },
    [setShowSuggestions, setSuggestions, termRef],
  );

  const handleCopy = useCallback(() => {
    if (selectedText) {
      window.clipboardAPI.writeText(selectedText).catch(() => {
        // 复制到剪贴板失败
      });
    }
    handleClose();
  }, [handleClose, selectedText]);

  const handlePaste = useCallback(() => {
    if (!markPasteIfAllowed()) {
      handleClose();
      return;
    }

    window.clipboardAPI
      .readText()
      .then((text) => {
        handlePasteText(text);
      })
      .catch(() => {
        // 从剪贴板读取失败
      });
    handleClose();
  }, [handleClose, handlePasteText, markPasteIfAllowed]);

  const handleSendToAI = useCallback(() => {
    requestTerminalContextAttach(sessionKey);
    if (selectedText) {
      window.dispatchEvent(
        new CustomEvent("sendToAI", {
          detail: { text: redactTerminalText(selectedText), sessionKey },
        }),
      );
    } else {
      const context = getTerminalContext?.();
      const promptHeader = t("terminal.explainRecentOutputPrompt");
      const output = context?.recentOutput || "";
      const fence = output.includes("```") ? "````" : "```";
      const text = output
        ? `${promptHeader}\n\n${fence}text\n${output}\n${fence}`
        : promptHeader;
      window.dispatchEvent(
        new CustomEvent("sendToAI", {
          detail: { text, sessionKey },
        }),
      );
    }
    handleClose();
  }, [getTerminalContext, handleClose, selectedText, sessionKey, t]);

  const handleClear = useCallback(() => {
    clearTerminal();
    handleClose();
  }, [clearTerminal, handleClose]);

  const handleSearchFromMenu = useCallback(() => {
    if (!isActiveRef.current) return;
    openSearchBar();
    handleClose();
  }, [handleClose, isActiveRef, openSearchBar]);

  const handleSelectAll = useCallback(() => {
    if (termRef.current && typeof termRef.current.selectAll === "function") {
      termRef.current.selectAll();
      setSelectedText(termRef.current.getSelection?.() || "");
    }
    handleClose();
  }, [handleClose, termRef]);

  const handleCopyAllOutput = useCallback(async () => {
    handleClose();
    const extracted = extractTerminalScrollback(termRef.current, {
      includeHeader: false,
    });
    if (extracted.isEmpty) {
      if (t) {
        notification?.showInfo?.(t("terminal.exportScrollbackEmpty"));
      }
      return { success: false, empty: true };
    }
    try {
      await window.clipboardAPI?.writeText?.(extracted.text);
      if (t) {
        notification?.showSuccess?.(t("terminal.copyAllOutputSuccess"));
      }
      return { success: true, lineCount: extracted.lineCount };
    } catch {
      return { success: false };
    }
  }, [handleClose, notification, t, termRef]);

  const handleExportScrollback = useCallback(async () => {
    handleClose();
    const metadata =
      sessionMetadata && typeof sessionMetadata === "object"
        ? sessionMetadata
        : { sessionKey };
    const extracted = extractTerminalScrollback(termRef.current, {
      includeHeader: true,
      metadata,
    });
    if (extracted.isEmpty) {
      if (t) {
        notification?.showInfo?.(t("terminal.exportScrollbackEmpty"));
      }
      return { success: false, empty: true };
    }
    if (!window.terminalAPI?.exportScrollback) {
      return { success: false };
    }
    try {
      const response = await window.terminalAPI.exportScrollback({
        content: extracted.text,
        defaultFilename: buildScrollbackExportFilename(metadata),
      });
      if (response?.success) {
        if (t) {
          notification?.showSuccess?.(t("terminal.exportScrollbackSuccess"));
        }
        return response;
      }
      if (!response?.cancelled && response?.error && t) {
        notification?.showError?.(
          t("terminal.exportScrollbackFailed", { error: response.error }),
        );
      }
      return response;
    } catch (error) {
      if (t) {
        notification?.showError?.(
          t("terminal.exportScrollbackFailed", {
            error: error?.message || String(error),
          }),
        );
      }
      return { success: false, error: error?.message || String(error) };
    }
  }, [handleClose, notification, sessionKey, sessionMetadata, t, termRef]);

  return {
    contextMenu,
    selectedText,
    handleContextMenu,
    handleClose,
    handleCopy,
    handlePaste,
    handleSelectAll,
    handleSendToAI,
    handleClear,
    handleSearchFromMenu,
    handleCopyAllOutput,
    handleExportScrollback,
  };
}
