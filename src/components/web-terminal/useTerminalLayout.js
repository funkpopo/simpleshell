import { useCallback, useEffect, useRef } from "react";
import {
  processCache,
  sendResizeIfNeeded,
  terminalCache,
} from "../../modules/terminal/controller/terminalSessionStore.js";

/**
 * Terminal attach / focus / fit / layout-sync scheduling.
 */
export function useTerminalLayout({
  tabId,
  terminalRef,
  termRef,
  fitAddonRef,
  isActiveRef,
  scheduleTerminalRedrawRef,
}) {
  const layoutSyncFrameRef = useRef(null);
  const pendingLayoutSyncReasonRef = useRef(null);
  const scheduleTerminalLayoutSyncRef = useRef(() => {});
  const lastLayoutGeometryRef = useRef({
    width: 0,
    height: 0,
    cols: 0,
    rows: 0,
  });

  const attachTerminalToContainer = useCallback(
    (termInstance = null) => {
      const container = terminalRef.current;
      const resolvedTerm =
        termInstance || termRef.current || terminalCache[tabId];

      if (!container || !resolvedTerm) {
        return false;
      }

      if (resolvedTerm.element) {
        if (resolvedTerm.element.parentElement !== container) {
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
          container.appendChild(resolvedTerm.element);
        }
        return true;
      }

      if (typeof resolvedTerm.open === "function") {
        resolvedTerm.open(container);
        return true;
      }

      return false;
    },
    [tabId, terminalRef, termRef],
  );

  const focusTerminalInput = useCallback(() => {
    if (
      !isActiveRef.current ||
      !termRef.current ||
      !terminalRef.current ||
      terminalRef.current.offsetWidth <= 0 ||
      terminalRef.current.offsetHeight <= 0
    ) {
      return false;
    }

    try {
      attachTerminalToContainer(termRef.current);

      const helperTextarea = termRef.current.element?.querySelector(
        ".xterm-helper-textarea",
      );

      if (helperTextarea && document.activeElement !== helperTextarea) {
        helperTextarea.focus();
        return true;
      }

      if (typeof termRef.current.focus === "function") {
        termRef.current.focus();
        return true;
      }
    } catch {
      /* intentionally ignored */
    }

    return false;
  }, [attachTerminalToContainer, isActiveRef, terminalRef, termRef]);

  const isTerminalContainerVisible = useCallback((container) => {
    if (!container || typeof window === "undefined") {
      return false;
    }

    let current = container;
    while (current) {
      const style = window.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        current.getAttribute("aria-hidden") === "true"
      ) {
        return false;
      }
      current = current.parentElement;
    }

    const rect = container.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, []);

  const syncTerminalLayoutNow = useCallback(
    (reason = "layout") => {
      const term = termRef.current;
      const fitAddon = fitAddonRef.current;
      const container = terminalRef.current;

      if (!term || !fitAddon || !isTerminalContainerVisible(container)) {
        return false;
      }

      try {
        attachTerminalToContainer(term);

        const rect = container.getBoundingClientRect();
        const previous = lastLayoutGeometryRef.current;
        const sizeChanged =
          Math.abs(rect.width - previous.width) > 0.5 ||
          Math.abs(rect.height - previous.height) > 0.5;

        if (sizeChanged && term.element) {
          term.element.style.width = `${rect.width}px`;
          term.element.style.height = `${rect.height}px`;
        }

        fitAddon.fit();

        const colsChanged = term.cols !== previous.cols;
        const rowsChanged = term.rows !== previous.rows;

        lastLayoutGeometryRef.current = {
          width: rect.width,
          height: rect.height,
          cols: term.cols,
          rows: term.rows,
        };

        const processId = processCache[tabId];
        const forceResizeMessage = String(reason).includes("force");
        if (processId && (colsChanged || rowsChanged || forceResizeMessage)) {
          sendResizeIfNeeded(processId, tabId, term.cols, term.rows, {
            force: forceResizeMessage,
            immediate: forceResizeMessage,
          });
        }

        if (!term.__webglEnabled && typeof term.refresh === "function") {
          scheduleTerminalRedrawRef.current(term, { force: sizeChanged });
        }

        return true;
      } catch {
        return false;
      }
    },
    [
      attachTerminalToContainer,
      fitAddonRef,
      isTerminalContainerVisible,
      scheduleTerminalRedrawRef,
      tabId,
      terminalRef,
      termRef,
    ],
  );

  const scheduleTerminalLayoutSync = useCallback(
    (reason = "layout", options = {}) => {
      pendingLayoutSyncReasonRef.current = reason;

      if (layoutSyncFrameRef.current !== null && !options.immediate) {
        return;
      }

      const run = () => {
        layoutSyncFrameRef.current = null;
        const pendingReason = pendingLayoutSyncReasonRef.current || reason;
        pendingLayoutSyncReasonRef.current = null;
        syncTerminalLayoutNow(pendingReason);
      };

      if (options.immediate || typeof requestAnimationFrame !== "function") {
        if (layoutSyncFrameRef.current !== null) {
          cancelAnimationFrame(layoutSyncFrameRef.current);
          layoutSyncFrameRef.current = null;
        }
        run();
        return;
      }

      layoutSyncFrameRef.current = requestAnimationFrame(run);
    },
    [syncTerminalLayoutNow],
  );

  useEffect(() => {
    scheduleTerminalLayoutSyncRef.current = scheduleTerminalLayoutSync;
  }, [scheduleTerminalLayoutSync]);

  const hasMeaningfulLayoutGeometryChange = useCallback(
    (width, height, threshold = 1) => {
      const previous = lastLayoutGeometryRef.current;

      return (
        Math.abs(width - previous.width) > threshold ||
        Math.abs(height - previous.height) > threshold
      );
    },
    [],
  );

  const cancelLayoutSync = useCallback(() => {
    if (layoutSyncFrameRef.current !== null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(layoutSyncFrameRef.current);
      }
      layoutSyncFrameRef.current = null;
    }
    pendingLayoutSyncReasonRef.current = null;
  }, []);

  return {
    layoutSyncFrameRef,
    pendingLayoutSyncReasonRef,
    scheduleTerminalLayoutSyncRef,
    lastLayoutGeometryRef,
    attachTerminalToContainer,
    focusTerminalInput,
    isTerminalContainerVisible,
    syncTerminalLayoutNow,
    scheduleTerminalLayoutSync,
    hasMeaningfulLayoutGeometryChange,
    cancelLayoutSync,
  };
}
