import { useEffect } from "react";
import { resetSessionRestoreInteractionState } from "../../modules/terminal/sessionRestoreUI.js";
import {
  clearGeometryFor,
  processCache,
} from "../../modules/terminal/controller/terminalSessionStore.js";
import { clearPendingWrappedInputRefresh } from "./terminalHelpers.js";

/**
 * Secondary session/tab/resize/focus event wiring for WebTerminal.
 */
export function useTerminalSessionEvents({
  tabId,
  isActive,
  terminalRef,
  termRef,
  fitAddonRef,
  isActiveRef,
  terminalIOMailboxRef,
  eventManager,
  recoverTerminalAfterActivation,
  scheduleTerminalLayoutSyncRef,
  scheduleTerminalRedraw,
  resetPromptTracking,
  syncPromptTrackingFromTerminal,
  updateCursorPosition,
  setContentUpdated,
  setShowSuggestions,
  setSuggestions,
  setCurrentInput,
  setSuggestionsHiddenByEsc,
  setSuggestionsSuppressedUntilEnter,
  suggestionSelectedRef,
  suppressionContextRef,
}) {
  // Focus when tab becomes active
  useEffect(() => {
    if (!isActive || !termRef.current) return;
    const timer = setTimeout(() => {
      try {
        if (termRef.current && typeof termRef.current.focus === "function") {
          termRef.current.focus();
        }
      } catch {
        /* ignore */
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [isActive, tabId, termRef]);

  useEffect(() => {
    const handleTabFocus = (event) => {
      const detail = event.detail || {};
      if (detail.tabId !== tabId || !termRef.current) return;
      setTimeout(() => {
        try {
          if (termRef.current && typeof termRef.current.focus === "function") {
            termRef.current.focus();
          }
        } catch {
          /* ignore */
        }
      }, 50);
    };
    window.addEventListener("tabChanged", handleTabFocus);
    return () => window.removeEventListener("tabChanged", handleTabFocus);
  }, [tabId, termRef]);

  useEffect(() => {
    window.sshProcessIdCallback = (terminalId, processId) => {
      try {
        window.dispatchEvent(
          new CustomEvent("sshProcessIdUpdated", {
            detail: { terminalId, processId },
          }),
        );
      } catch {
        /* ignore */
      }
    };
    return () => {
      window.sshProcessIdCallback = null;
    };
  }, []);

  useEffect(() => {
    if (!isActive || !termRef.current) return undefined;
    const timers = [80, 160, 260, 380, 520].map((delay) =>
      setTimeout(() => {
        recoverTerminalAfterActivation({ resize: true, refocus: true });
      }, delay),
    );
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [isActive, recoverTerminalAfterActivation, termRef]);

  useEffect(() => {
    const handleTabFocus = (event) => {
      if (!event.detail || event.detail.tabId !== tabId) return;
      if (!terminalRef.current || !termRef.current) return;
      eventManager.setTimeout(() => {
        recoverTerminalAfterActivation({ resize: true, refocus: true });
      }, 120);
    };
    const remove = eventManager.addEventListener(
      window,
      "tabChanged",
      handleTabFocus,
    );
    return () => remove();
  }, [tabId, eventManager, recoverTerminalAfterActivation, terminalRef, termRef]);

  useEffect(() => {
    const syncTerminalAfterSessionRestore = (processIdFromEvent = null) => {
      const resolvedProcessId = processIdFromEvent || processCache[tabId];
      if (resolvedProcessId) {
        clearGeometryFor(resolvedProcessId, tabId);
      }
      if (terminalIOMailboxRef.current?.resetResizeState) {
        terminalIOMailboxRef.current.resetResizeState();
      }

      const syncGeometry = () => {
        if (!termRef.current || !fitAddonRef.current || !terminalRef.current) {
          return;
        }
        if (
          terminalRef.current.offsetWidth <= 0 ||
          terminalRef.current.offsetHeight <= 0
        ) {
          return;
        }
        scheduleTerminalLayoutSyncRef.current("session-restored", {
          immediate: true,
        });
        updateCursorPosition();
      };

      const focusTerminal = () => {
        if (
          !isActiveRef.current ||
          !termRef.current ||
          !terminalRef.current ||
          terminalRef.current.offsetWidth <= 0 ||
          terminalRef.current.offsetHeight <= 0
        ) {
          return;
        }
        try {
          const helperTextarea = termRef.current.element?.querySelector(
            ".xterm-helper-textarea",
          );
          if (helperTextarea && document.activeElement !== helperTextarea) {
            helperTextarea.focus();
            return;
          }
          if (typeof termRef.current.focus === "function") {
            termRef.current.focus();
          }
        } catch {
          /* ignore */
        }
      };

      resetPromptTracking();
      resetSessionRestoreInteractionState({
        setShowSuggestions,
        setSuggestions,
        setCurrentInput,
        setSuggestionsHiddenByEsc,
        setSuggestionsSuppressedUntilEnter,
        suggestionSelectedRef,
        suppressionContextRef,
      });

      if (termRef.current) {
        clearPendingWrappedInputRefresh(termRef.current);
        syncPromptTrackingFromTerminal(termRef.current);
        scheduleTerminalRedraw(termRef.current);
        updateCursorPosition();
      }
      setContentUpdated(true);
      syncGeometry();
      focusTerminal();
      [60, 180, 320].forEach((delay) => {
        eventManager.setTimeout(syncGeometry, delay);
      });
      [40, 140, 260].forEach((delay) => {
        eventManager.setTimeout(focusTerminal, delay);
      });
    };

    const handleTerminalSessionRestored = (event) => {
      const detail = event.detail || {};
      if (detail.tabId && detail.tabId !== tabId) return;
      const currentPid = processCache[tabId];
      if (
        !detail.tabId &&
        detail.processId &&
        currentPid &&
        String(detail.processId) !== String(currentPid)
      ) {
        return;
      }
      syncTerminalAfterSessionRestore(detail.processId);
    };

    const remove = eventManager.addEventListener(
      window,
      "terminalSessionRestored",
      handleTerminalSessionRestored,
    );
    return () => remove();
  }, [
    eventManager,
    fitAddonRef,
    isActiveRef,
    resetPromptTracking,
    scheduleTerminalLayoutSyncRef,
    scheduleTerminalRedraw,
    setContentUpdated,
    setCurrentInput,
    setShowSuggestions,
    setSuggestions,
    setSuggestionsHiddenByEsc,
    setSuggestionsSuppressedUntilEnter,
    suggestionSelectedRef,
    suppressionContextRef,
    syncPromptTrackingFromTerminal,
    tabId,
    terminalIOMailboxRef,
    terminalRef,
    termRef,
    updateCursorPosition,
  ]);

  useEffect(() => {
    const handleTabChanged = (event) => {
      if (event.detail && event.detail.tabId === tabId) {
        setContentUpdated(true);
        scheduleTerminalLayoutSyncRef.current(
          event.detail.forceRefresh ? "tab-force-refresh" : "tab-activated",
          { immediate: event.detail.forceRefresh },
        );
      }
    };
    const handleTerminalResize = (event) => {
      const { tabId: eventTabId, layoutType } = event.detail || {};
      if (
        eventTabId === tabId &&
        terminalRef.current &&
        fitAddonRef.current &&
        termRef.current
      ) {
        setContentUpdated(true);
        scheduleTerminalLayoutSyncRef.current(
          `terminal-resize:${layoutType || "default"}`,
        );
      }
    };
    const handleTerminalForceRefresh = (event) => {
      const { tabId: eventTabId, layoutType } = event.detail || {};
      if (
        eventTabId === tabId &&
        terminalRef.current &&
        fitAddonRef.current &&
        termRef.current
      ) {
        setContentUpdated(true);
        scheduleTerminalLayoutSyncRef.current(
          `terminal-force-refresh:${layoutType || "default"}`,
          { immediate: true },
        );
      }
    };

    const removeTab = eventManager.addEventListener(
      window,
      "tabChanged",
      handleTabChanged,
    );
    const removeResize = eventManager.addEventListener(
      window,
      "terminalResize",
      handleTerminalResize,
    );
    const removeForce = eventManager.addEventListener(
      window,
      "terminalForceRefresh",
      handleTerminalForceRefresh,
    );
    return () => {
      removeTab();
      removeResize();
      removeForce();
    };
  }, [
    eventManager,
    fitAddonRef,
    scheduleTerminalLayoutSyncRef,
    setContentUpdated,
    tabId,
    terminalRef,
    termRef,
  ]);
}
