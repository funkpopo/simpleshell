import { useCallback, useEffect, useRef } from "react";
import { TERMINAL_RESIZE_QUERY_REGEX } from "../runtime/terminalDom.js";
import {
  clearGeometryFor,
  processCache,
} from "../runtime/terminalSessionStore.js";
import { clearPendingWrappedInputRefresh } from "../lib/terminalHelpers.js";

/**
 * Builds the process data-listener binding and exposes the latest versions of
 * the callbacks the long-lived lifecycle effect invokes, through stable refs
 * refreshed after every render.
 */
export function useTerminalLifecycleCallbackRefs({
  sessionKey,
  terminalIOMailboxRef,
  scheduleTerminalLayoutSyncRef,
  clearInputQueue,
  resetPromptTracking,
  syncPromptTrackingFromTerminal,
  setupCommandDetection,
  handleContextMenu,
  handlePasteText,
  clearTerminal,
  markPasteIfAllowed,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
}) {
  const setupDataListener = useCallback(
    (processId, term) => {
      const previousProcessId = processCache[sessionKey];
      const mailbox = terminalIOMailboxRef.current;

      clearInputQueue();

      if (previousProcessId && previousProcessId !== processId) {
        clearGeometryFor(previousProcessId, sessionKey);
      }
      processCache[sessionKey] = processId;
      clearGeometryFor(processId, sessionKey);
      resetPromptTracking();
      clearPendingWrappedInputRefresh(term);
      syncPromptTrackingFromTerminal(term);

      // Only a remote window-size request (CSI 8;rows;cols t) needs us to push
      // the real geometry back. Clear-screen/cursor-home sequences are emitted
      // on every TUI frame (top/htop/vim/watch); forcing fit + full refresh +
      // resize IPC for each of them caused stutter and flicker. Alternate
      // screen enter/exit is handled by onBufferChange in prompt tracking.
      const handleProcessOutput = (data) => {
        if (data && TERMINAL_RESIZE_QUERY_REGEX.test(data)) {
          scheduleTerminalLayoutSyncRef.current(
            "terminal-control-sequence-force",
          );
        }
      };

      if (mailbox) {
        mailbox.setTerm(term);
        mailbox.updateHandlers({
          onOutput: handleProcessOutput,
        });
        mailbox.attachProcess(processId);
      }

      scheduleTerminalLayoutSyncRef.current("data-listener");

      return () => {};
    },
    [
      clearInputQueue,
      resetPromptTracking,
      scheduleTerminalLayoutSyncRef,
      syncPromptTrackingFromTerminal,
      sessionKey,
      terminalIOMailboxRef,
    ],
  );

  // Stable refs for callbacks used inside the long-lived lifecycle effect
  const setupCommandDetectionRef = useRef(setupCommandDetection);
  const setupDataListenerRef = useRef(setupDataListener);
  const handleContextMenuRef = useRef(handleContextMenu);
  const handlePasteTextRef = useRef(handlePasteText);
  const clearTerminalRef = useRef(clearTerminal);
  const markPasteIfAllowedRef = useRef(markPasteIfAllowed);
  const handleMouseDownRef = useRef(handleMouseDown);
  const handleMouseMoveRef = useRef(handleMouseMove);
  const handleMouseUpRef = useRef(handleMouseUp);

  useEffect(() => {
    setupCommandDetectionRef.current = setupCommandDetection;
    setupDataListenerRef.current = setupDataListener;
    handleContextMenuRef.current = handleContextMenu;
    handlePasteTextRef.current = handlePasteText;
    clearTerminalRef.current = clearTerminal;
    markPasteIfAllowedRef.current = markPasteIfAllowed;
    handleMouseDownRef.current = handleMouseDown;
    handleMouseMoveRef.current = handleMouseMove;
    handleMouseUpRef.current = handleMouseUp;
  });

  return {
    setupCommandDetectionRef,
    setupDataListenerRef,
    handleContextMenuRef,
    handlePasteTextRef,
    clearTerminalRef,
    markPasteIfAllowedRef,
    handleMouseDownRef,
    handleMouseMoveRef,
    handleMouseUpRef,
  };
}
