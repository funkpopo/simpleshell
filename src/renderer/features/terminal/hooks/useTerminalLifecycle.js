import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { TerminalSearchAddon as SearchAddon } from "../runtime/TerminalSearchAddon.js";
import { useTranslation } from "react-i18next";
import {
  ensureSharedTerminalStyles,
  searchBarStyles,
  syncTerminalLinkCtrlState,
  terminalStyles,
} from "../runtime/terminalDom.js";
import {
  disposeTerminalSession,
  disposablesCache,
  fitAddonCache,
  processCache,
  terminalCache,
  unregisterTerminalIOMailbox,
} from "../runtime/terminalSessionStore.js";
import { getTerminalTheme } from "../model/terminalTheme.js";
import { setTerminalWorkingDirectory } from "../model/workingDirectoryStore.js";
import { attachMoshTransportStatus } from "../model/moshTransportStatus.js";
import {
  applyStoredFontSettings,
  bindTerminalIOMailbox,
  createXtermTerminal,
  ensureTerminalDiagnostics,
} from "../runtime/terminalBootstrap.js";
import {
  createExternalUrlOpener,
  createTerminalLinkProvider,
} from "../runtime/terminalLinkProvider.js";
import { startTerminalSession } from "../runtime/terminalSessionConnect.js";
import { attachTerminalShortcutHandlers } from "../runtime/terminalShortcuts.js";
import { attachTerminalContainerListeners } from "../runtime/terminalContainerListeners.js";
import { useTerminalCacheInvalidation } from "./useTerminalCacheInvalidation.js";
import { useTerminalSettingsSync } from "./useTerminalSettingsSync.js";
import { useTerminalLifecycleCallbackRefs } from "./useTerminalLifecycleCallbackRefs.js";

/**
 * Terminal create / cache reuse / mailbox / connection / DOM listeners / cleanup.
 *
 * Effects run in their original order: unmount disposal, cache invalidation,
 * settings sync, callback-ref refresh, font-ready refit, the long-lived
 * lifecycle effect, then theme updates. The lifecycle effect delegates to
 * runtime helpers that it calls synchronously in the original sequence.
 */
export function useTerminalLifecycle({
  sessionKey,
  refreshKey,
  sshConfig,
  terminalType,
  localConfig,
  theme,
  terminalRef,
  termRef,
  fitAddonRef,
  currentProcessId,
  performanceMonitorRef,
  scrollbackUsageTrackerRef,
  terminalIOMailboxRef,
  searchAddonRef,
  webglRendererEnabledRef,
  setWebglRendererEnabled,
  isActiveRef,
  lifecycleEventManager,
  eventManager,
  tryEnableWebglRenderer,
  disableWebglRenderer,
  attachTerminalToContainer,
  isTerminalContainerVisible,
  hasMeaningfulLayoutGeometryChange,
  scheduleTerminalLayoutSyncRef,
  scheduleTerminalRedrawRef,
  cancelLayoutSync,
  recoverTerminalAfterActivation,
  recoverTerminalInteractionStateRef,
  pendingSystemShortcutRecoveryRef,
  imeCompositionActiveRef,
  inEditorModeRef,
  setupCommandDetection,
  resetPromptTracking,
  syncPromptTrackingFromTerminal,
  clearInputQueue,
  markPasteIfAllowed,
  handlePasteText,
  clearTerminal,
  handleMouseDown,
  handleMouseMove,
  handleMouseUp,
  handleContextMenu,
  toggleSearchBar,
  closeSearchBar,
  handleSearch,
  handleSearchPrevious,
  showSearchBar,
  showSuggestions,
  searchTerm,
  setShowSuggestions,
  setSuggestions,
  setSuggestionsHiddenByEsc,
  setSuggestionsSuppressedUntilEnter,
  suppressionContextRef,
  currentInput,
  lastPasteTimeRef,
  setSearchAddonVersion,
}) {
  const { t, i18n } = useTranslation();
  // P0：不再为性能监控保留废弃 state（此前每 10s 的 onStats 会触发一次
  // 无人消费的整树重渲染）。监控数据仅在开发/诊断分支内被消费。
  // Keep theme/i18n readable from the long-lived lifecycle effect without
  // putting freshly-allocated objects into the effect dependency list.
  const themeModeRef = useRef(theme.palette.mode);
  const tRef = useRef(t);
  const languageRef = useRef(i18n.language);
  themeModeRef.current = theme.palette.mode;
  tRef.current = t;
  languageRef.current = i18n.language;

  // Keyboard shortcuts read live UI state through this ref so the long-lived
  // keydown listener (mounted once) never closes over mount-time booleans.
  const shortcutUiRef = useRef({});
  shortcutUiRef.current = {
    toggleSearchBar,
    closeSearchBar,
    handleSearch,
    handleSearchPrevious,
    showSearchBar,
    showSuggestions,
    searchTerm,
    setShowSuggestions,
    setSuggestions,
    setSuggestionsHiddenByEsc,
    setSuggestionsSuppressedUntilEnter,
    suppressionContextRef,
    currentInput,
  };

  // Closing a tab unmounts WebTerminal. Keep this cleanup separate from the
  // long-lived setup effect so dependency refreshes can still reuse a cached
  // terminal, while a real unmount always releases the xterm object graph.
  useEffect(
    () => () => {
      disposeTerminalSession(sessionKey);
      termRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
      currentProcessId.current = null;
    },
    [currentProcessId, fitAddonRef, searchAddonRef, sessionKey, termRef],
  );

  useTerminalCacheInvalidation({ sessionKey, refreshKey, sshConfig });

  const getFontSettings = useTerminalSettingsSync({
    sessionKey,
    terminalRef,
    termRef,
    fitAddonRef,
    scrollbackUsageTrackerRef,
    webglRendererEnabledRef,
    setWebglRendererEnabled,
    tryEnableWebglRenderer,
    disableWebglRenderer,
    eventManager,
    scheduleTerminalLayoutSyncRef,
  });

  // Stable refs for callbacks used inside the long-lived lifecycle effect
  const {
    setupCommandDetectionRef,
    setupDataListenerRef,
    handleContextMenuRef,
    handlePasteTextRef,
    clearTerminalRef,
    markPasteIfAllowedRef,
    handleMouseDownRef,
    handleMouseMoveRef,
    handleMouseUpRef,
  } = useTerminalLifecycleCallbackRefs({
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
  });

  // 字体异步加载完成后触发一次 refit：
  // xterm 首次用回退等宽字体度量单元格，Fira Code 就绪后字符宽度可能变化，
  // 不重新 fit 会出现网格错位直到下一次手动 resize。
  useEffect(() => {
    if (
      typeof document === "undefined" ||
      !document.fonts ||
      typeof document.fonts.ready?.then !== "function"
    ) {
      return undefined;
    }
    let cancelled = false;
    document.fonts.ready
      .then(() => {
        if (
          !cancelled &&
          isActiveRef.current &&
          termRef.current &&
          fitAddonRef.current
        ) {
          scheduleTerminalLayoutSyncRef.current?.("fonts-ready");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fitAddonRef, isActiveRef, termRef]);

  useEffect(() => {
    const lifecycleManager = lifecycleEventManager;
    lifecycleManager.reset();

    const styleElement = ensureSharedTerminalStyles();
    if (styleElement.textContent !== terminalStyles + searchBarStyles) {
      styleElement.textContent = terminalStyles + searchBarStyles;
    }

    if (!disposablesCache[sessionKey]) {
      disposablesCache[sessionKey] = [];
    }
    const terminalDisposables = disposablesCache[sessionKey];
    const observeMoshStatus = (term, processId) => {
      if (sshConfig?.protocol === "mosh") {
        terminalDisposables.push(
          attachMoshTransportStatus(term, sessionKey, processId),
        );
      }
    };

    const ensureTerminalMailbox = (term) =>
      bindTerminalIOMailbox(term, {
        sessionKey,
        terminalType,
        sshConfig,
        terminalIOMailboxRef,
        scrollbackUsageTrackerRef,
        performanceMonitorRef,
        inEditorModeRef,
        scheduleTerminalRedrawRef,
      });

    if (terminalRef.current) {
      let term;
      let fitAddon;
      let searchAddon;

      if (terminalCache[sessionKey]) {
        if (
          disposablesCache[sessionKey] &&
          Array.isArray(disposablesCache[sessionKey])
        ) {
          console.debug(
            `[WebTerminal] Cleaning up ${disposablesCache[sessionKey].length} old event listeners for sessionKey=${sessionKey}`,
          );
          disposablesCache[sessionKey].forEach((disposable) => {
            try {
              if (disposable && typeof disposable.dispose === "function") {
                disposable.dispose();
              }
            } catch (error) {
              console.error(
                `[WebTerminal] Failed to dispose event listener for sessionKey=${sessionKey}:`,
                error,
              );
            }
          });
          disposablesCache[sessionKey].length = 0;
        }

        term = terminalCache[sessionKey];
        fitAddon = fitAddonCache[sessionKey];

        console.debug(
          `[WebTerminal] Reusing cached terminal for sessionKey=${sessionKey}, processId=${processCache[sessionKey]}`,
        );

        term.options.theme = getTerminalTheme(themeModeRef.current);

        searchAddon = new SearchAddon();
        term.loadAddon(searchAddon);

        attachTerminalToContainer(term);
        syncTerminalLinkCtrlState(term, false);

        term.attachCustomKeyEventHandler((event) => {
          if (event.altKey && event.key === "F1") {
            return false;
          }
          return true;
        });
        if (webglRendererEnabledRef.current) {
          tryEnableWebglRenderer(term);
        } else {
          disableWebglRenderer(term);
        }

        if (isActiveRef.current) {
          scheduleTerminalLayoutSyncRef.current("terminal-reused");
        }
        ensureTerminalMailbox(term);

        const existingProcessId = processCache[sessionKey];
        if (existingProcessId) {
          try {
            console.debug(
              `[WebTerminal] Rebinding listeners for sessionKey=${sessionKey}, processId=${existingProcessId}`,
            );
          } catch {
            // ignore log errors
          }

          setupDataListenerRef.current(existingProcessId, term);
          observeMoshStatus(term, existingProcessId);
          setupCommandDetectionRef.current(
            term,
            existingProcessId,
            false,
            terminalDisposables,
            { pendingSystemShortcutRecoveryRef },
          );
        }
      } else {
        setTerminalWorkingDirectory(sessionKey, null);
        term = createXtermTerminal(themeModeRef.current);

        applyStoredFontSettings({
          term,
          getFontSettings,
          scrollbackUsageTrackerRef,
          scheduleTerminalLayoutSyncRef,
        });

        fitAddon = new FitAddon();
        searchAddon = new SearchAddon();

        term.registerLinkProvider(
          createTerminalLinkProvider(term, createExternalUrlOpener(term, tRef)),
        );

        term.loadAddon(fitAddon);
        term.loadAddon(searchAddon);

        term.open(terminalRef.current);
        syncTerminalLinkCtrlState(term, false);

        term.attachCustomKeyEventHandler((event) => {
          if (event.altKey && event.key === "F1") {
            return false;
          }
          return true;
        });

        ensureTerminalDiagnostics({
          performanceMonitorRef,
          scrollbackUsageTrackerRef,
        });

        ensureTerminalMailbox(term);
        if (webglRendererEnabledRef.current) {
          tryEnableWebglRenderer(term);
        } else {
          disableWebglRenderer(term);
        }

        scheduleTerminalLayoutSyncRef.current("terminal-created");

        startTerminalSession({
          term,
          sessionKey,
          terminalType,
          sshConfig,
          localConfig,
          languageRef,
          tRef,
          currentProcessId,
          terminalDisposables,
          ensureTerminalMailbox,
          observeMoshStatus,
          setupDataListenerRef,
          setupCommandDetectionRef,
          pendingSystemShortcutRecoveryRef,
          scheduleTerminalLayoutSyncRef,
          lifecycleManager,
        });

        terminalCache[sessionKey] = term;
        fitAddonCache[sessionKey] = fitAddon;
      }

      const previousSearchAddon = searchAddonRef.current;
      const previousSearchTerm = termRef.current;
      searchAddonRef.current = searchAddon;
      termRef.current = term;

      if (previousSearchAddon !== searchAddon || previousSearchTerm !== term) {
        setSearchAddonVersion((prev) => prev + 1);
      }

      const { scheduleActivationRecovery } = attachTerminalShortcutHandlers({
        term,
        terminalRef,
        lifecycleManager,
        isActiveRef,
        searchAddonRef,
        shortcutUiRef,
        pendingSystemShortcutRecoveryRef,
        recoverTerminalInteractionStateRef,
        recoverTerminalAfterActivation,
        imeCompositionActiveRef,
        markPasteIfAllowedRef,
        handlePasteTextRef,
        clearTerminalRef,
      });

      const resizeObserver = attachTerminalContainerListeners({
        term,
        terminalRef,
        termRef,
        fitAddonRef,
        lifecycleManager,
        handleMouseDownRef,
        handleMouseMoveRef,
        handleMouseUpRef,
        handleContextMenuRef,
        markPasteIfAllowedRef,
        handlePasteTextRef,
        lastPasteTimeRef,
        scheduleTerminalLayoutSyncRef,
        isTerminalContainerVisible,
        hasMeaningfulLayoutGeometryChange,
        scheduleActivationRecovery,
      });

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      scheduleTerminalLayoutSyncRef.current("initial", { immediate: true });

      lifecycleManager.addObserver(resizeObserver);

      lifecycleManager.addCleanup(() => {
        if (terminalIOMailboxRef.current) {
          terminalIOMailboxRef.current.detachProcess();
        }
      });

      if (process.env.NODE_ENV === "development") {
        console.debug(
          `[WebTerminal] lifecycle manager setup sessionKey=${sessionKey}`,
          lifecycleManager.getStats(),
        );
      }

      return () => {
        cancelLayoutSync();

        if (performanceMonitorRef.current) {
          performanceMonitorRef.current.destroy();
          performanceMonitorRef.current = null;
        }

        if (scrollbackUsageTrackerRef.current) {
          scrollbackUsageTrackerRef.current.destroy();
          scrollbackUsageTrackerRef.current = null;
        }

        if (terminalIOMailboxRef.current) {
          unregisterTerminalIOMailbox(sessionKey, terminalIOMailboxRef.current);
          terminalIOMailboxRef.current.destroy();
          terminalIOMailboxRef.current = null;
        }

        terminalDisposables.forEach((disposable) => {
          try {
            if (disposable && typeof disposable.dispose === "function") {
              disposable.dispose();
            }
          } catch {
            // ignore
          }
        });
        terminalDisposables.length = 0;

        if (process.env.NODE_ENV === "development") {
          console.debug(
            `[WebTerminal] lifecycle manager cleanup sessionKey=${sessionKey}`,
            lifecycleManager.getStats(),
          );
        }

        lifecycleManager.reset();
      };
    }

    return undefined;
    // Match pre-split dependency set: do not include freshly-allocated theme
    // objects / i18n function identities or this effect will teardown mailbox,
    // listeners and layout state on every render (misaligned display, lag).
  }, [
    sessionKey,
    refreshKey,
    sshConfig,
    terminalType,
    localConfig,
    lifecycleEventManager,
    tryEnableWebglRenderer,
    disableWebglRenderer,
    attachTerminalToContainer,
    hasMeaningfulLayoutGeometryChange,
    isTerminalContainerVisible,
    recoverTerminalAfterActivation,
  ]);

  // Theme updates
  useEffect(() => {
    if (terminalCache[sessionKey]) {
      terminalCache[sessionKey].options.theme = getTerminalTheme(
        theme.palette.mode,
      );
    }
  }, [theme.palette.mode, sessionKey]);
}
