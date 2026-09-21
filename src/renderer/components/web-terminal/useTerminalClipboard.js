import { useCallback } from "react";
import { syncTerminalLinkCtrlState } from "../../modules/terminal/controller/terminalDom.js";

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
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        if (!markPasteIfAllowed()) {
          return;
        }

        window.clipboardAPI.readText().then((text) => {
          handlePasteText(text);
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
    },
    [termRef],
  );

  return {
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
