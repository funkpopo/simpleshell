import { useCallback, useState } from "react";

/**
 * Right-click context menu state and actions for WebTerminal.
 */
export function useTerminalContextMenu({
  termRef,
  isActiveRef,
  markPasteIfAllowed,
  handlePasteText,
  clearTerminal,
  openSearchBar,
  setShowSuggestions,
  setSuggestions,
}) {
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedText, setSelectedText] = useState("");

  const handleClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenu = useCallback(
    (event) => {
      event.preventDefault();

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
    if (selectedText) {
      window.dispatchEvent(
        new CustomEvent("sendToAI", {
          detail: { text: selectedText },
        }),
      );
    }
    handleClose();
  }, [handleClose, selectedText]);

  const handleClear = useCallback(() => {
    clearTerminal();
    handleClose();
  }, [clearTerminal, handleClose]);

  const handleSearchFromMenu = useCallback(() => {
    if (!isActiveRef.current) return;
    openSearchBar();
    handleClose();
  }, [handleClose, isActiveRef, openSearchBar]);

  return {
    contextMenu,
    selectedText,
    handleContextMenu,
    handleClose,
    handleCopy,
    handlePaste,
    handleSendToAI,
    handleClear,
    handleSearchFromMenu,
  };
}
