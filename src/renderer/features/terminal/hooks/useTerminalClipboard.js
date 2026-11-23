import { useCallback } from "react";
import { syncTerminalLinkCtrlState } from "../runtime/terminalDom.js";

/**
 * Mouse middle-click paste and Ctrl-link hover state for the terminal surface.
 */
export function useTerminalClipboard({
  termRef,
  markPasteIfAllowed,
  handlePasteText,
}) {
  const handleMouseDown = useCallback(
    (e) => {
      syncTerminalLinkCtrlState(termRef.current, e.ctrlKey);

      if (e.button === 1) {
        if (termRef.current?.__simpleShellMiddleClickPaste === false) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (!markPasteIfAllowed()) {
          return;
        }

        window.clipboardAPI
          .readText()
          .then((text) => {
            handlePasteText(text);
          })
          .catch(() => {
            // 剪贴板读取失败
          });
      }
    },
    [handlePasteText, markPasteIfAllowed, termRef],
  );

  const handleMouseMove = useCallback(
    (e) => {
      syncTerminalLinkCtrlState(termRef.current, e.ctrlKey);
    },
    [termRef],
  );

  const handleMouseUp = useCallback(
    (e) => {
      syncTerminalLinkCtrlState(termRef.current, e.ctrlKey);
      if (termRef.current?.options?.copyOnSelect === true) {
        const selectedText = termRef.current.getSelection?.() || "";
        if (selectedText && window.clipboardAPI?.writeText) {
          window.clipboardAPI.writeText(selectedText).catch(() => {});
        }
      }
    },
    [termRef],
  );

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
