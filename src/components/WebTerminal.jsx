import React, { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import "@xterm/xterm/css/xterm.css";
import "./WebTerminal.css";
import PropTypes from "prop-types";
import { useCleanupManager } from "../hooks/useAutoCleanup.js";
import { useTerminalRender } from "../hooks/useTerminalRender.js";
import { useTerminalSearch } from "../hooks/useTerminalSearch.js";
import { useTerminalSuggestions } from "../hooks/useTerminalSuggestions.js";
import { useTerminalInputSync } from "../hooks/useTerminalInputSync.js";
import { shouldDisplayCommandSuggestions } from "../modules/terminal/commandSuggestionState.js";
import CommandSuggestion from "./CommandSuggestion";
import WebTerminalSearchOverlay from "./web-terminal/WebTerminalSearchOverlay.jsx";
import WebTerminalContextMenu from "./web-terminal/WebTerminalContextMenu.jsx";
import { areWebTerminalPropsEqual } from "./web-terminal/terminalHelpers.js";
import { useTerminalIO } from "./web-terminal/useTerminalIO.js";
import { useTerminalLayout } from "./web-terminal/useTerminalLayout.js";
import { usePromptTracking } from "./web-terminal/usePromptTracking.js";
import { useTerminalClipboard } from "./web-terminal/useTerminalClipboard.js";
import { useTerminalContextMenu } from "./web-terminal/useTerminalContextMenu.js";
import { useTerminalLifecycle } from "./web-terminal/useTerminalLifecycle.js";
import { useTerminalSessionEvents } from "./web-terminal/useTerminalSessionEvents.js";

const WebTerminal = ({
  tabId,
  refreshKey,
  sshConfig = null,
  terminalType = "ssh",
  localConfig = null,
  isActive = true,
}) => {
  const terminalRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const currentProcessId = useRef(null);
  const performanceMonitorRef = useRef(null);
  const scrollbackUsageTrackerRef = useRef(null);
  const terminalIOMailboxRef = useRef(null);
  const searchAddonRef = useRef(null);
  const webglRendererEnabledRef = useRef(true);
  const isActiveRef = useRef(isActive);
  const scheduleTerminalRedrawRef = useRef(() => {});
  const recoverTerminalInteractionStateRef = useRef(() => {});
  const pendingSystemShortcutRecoveryRef = useRef(false);
  const imeCompositionActiveRef = useRef(false);
  const inEditorModeRef = useRef(false);
  const isCommandExecutingRef = useRef(false);
  const suggestionUiRef = useRef({});
  const lastExecutedCommandTimeRef = useRef(0);
  const lastExecutedCommandRef = useRef("");

  const [contentUpdated, setContentUpdated] = useState(false);
  const contentUpdatedStateRef = useRef(false);
  const contentUpdateFrameRef = useRef(null);
  const contentUpdateFrameTypeRef = useRef(null);
  const contentUpdatedRef = useRef(false);
  const [webglRendererEnabled, setWebglRendererEnabled] = useState(true);
  const [searchAddonVersion, setSearchAddonVersion] = useState(0);

  const theme = useTheme();
  const eventManager = useCleanupManager();
  const lifecycleEventManager = useCleanupManager();

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    contentUpdatedStateRef.current = contentUpdated;
  }, [contentUpdated]);

  useEffect(() => {
    let active = true;
    const loadRendererPreference = async () => {
      try {
        if (window.terminalAPI?.loadUISettings) {
          const settings = await window.terminalAPI.loadUISettings();
          const hardwareOn =
            settings?.performance?.hardwareAcceleration !== false;
          const enabled =
            hardwareOn && settings?.performance?.webglEnabled !== false;
          if (active) {
            webglRendererEnabledRef.current = enabled;
            setWebglRendererEnabled(enabled);
          }
        }
      } catch {
        /* intentionally ignored */
      }
    };
    loadRendererPreference();
    return () => {
      active = false;
    };
  }, []);

  const {
    scheduleTerminalRedraw,
    tryEnableWebglRenderer,
    disableWebglRenderer,
    resetRenderState,
  } = useTerminalRender({
    termRef,
    webglRendererEnabled,
    webglRendererEnabledRef,
    setWebglRendererEnabled,
    performanceMonitorRef,
  });

  useEffect(() => {
    scheduleTerminalRedrawRef.current = scheduleTerminalRedraw;
  }, [scheduleTerminalRedraw]);

  const {
    scheduleTerminalLayoutSyncRef,
    attachTerminalToContainer,
    focusTerminalInput,
    isTerminalContainerVisible,
    hasMeaningfulLayoutGeometryChange,
    cancelLayoutSync,
  } = useTerminalLayout({
    tabId,
    terminalRef,
    termRef,
    fitAddonRef,
    isActiveRef,
    scheduleTerminalRedrawRef,
  });

  const {
    sendInputToProcess,
    enqueueInputToProcess,
    cancelInputQueueDrain,
    clearInputQueue,
    markPasteIfAllowed,
    handlePasteText,
    lastPasteTimeRef,
  } = useTerminalIO({
    tabId,
    terminalIOMailboxRef,
    eventManager,
    suggestionUiRef,
  });

  const { broadcastInputToGroup } = useTerminalInputSync({
    tabId,
    enqueueInputToProcess,
    termRef,
    eventManager,
  });

  const markTerminalContentUpdated = useCallback(() => {
    contentUpdatedRef.current = true;
    if (
      contentUpdatedStateRef.current ||
      contentUpdateFrameRef.current !== null
    ) {
      return;
    }
    if (typeof requestAnimationFrame === "function") {
      contentUpdateFrameTypeRef.current = "raf";
      contentUpdateFrameRef.current = requestAnimationFrame(() => {
        contentUpdateFrameRef.current = null;
        contentUpdateFrameTypeRef.current = null;
        if (!contentUpdatedStateRef.current) {
          setContentUpdated(true);
        }
      });
      return;
    }
    contentUpdateFrameTypeRef.current = "timeout";
    contentUpdateFrameRef.current = setTimeout(() => {
      contentUpdateFrameRef.current = null;
      contentUpdateFrameTypeRef.current = null;
      if (!contentUpdatedStateRef.current) {
        setContentUpdated(true);
      }
    }, 16);
  }, []);

  const {
    suggestions,
    setSuggestions,
    showSuggestions,
    setShowSuggestions,
    cursorPosition,
    currentInput,
    setCurrentInput,
    setSuggestionsHiddenByEsc,
    setSuggestionsSuppressedUntilEnter,
    suppressionContextRef,
    suggestionsSuppressedRef,
    suggestionsHiddenByEscRef,
    suggestionSelectedRef,
    getSuggestions,
    getSuggestionsRef,
    updateCursorPosition,
    handleSuggestionSelect,
    closeSuggestions,
  } = useTerminalSuggestions({
    tabId,
    termRef,
    terminalRef,
    inEditorModeRef,
    isCommandExecutingRef,
    lastExecutedCommandRef,
    lastExecutedCommandTimeRef,
    sendInputToProcess,
  });

  useEffect(() => {
    suggestionUiRef.current = {
      setShowSuggestions,
      setSuggestions,
      setCurrentInput,
      setSuggestionsHiddenByEsc,
    };
  }, [
    setShowSuggestions,
    setSuggestions,
    setCurrentInput,
    setSuggestionsHiddenByEsc,
  ]);

  const suggestionApi = {
    setShowSuggestions,
    setSuggestions,
    setCurrentInput,
    setSuggestionsHiddenByEsc,
    setSuggestionsSuppressedUntilEnter,
    suppressionContextRef,
    suggestionsSuppressedRef,
    suggestionsHiddenByEscRef,
    suggestionSelectedRef,
    getSuggestions,
    getSuggestionsRef,
    updateCursorPosition,
  };

  const {
    resetPromptTracking,
    syncPromptTrackingFromTerminal,
    recoverTerminalInteractionState,
    setupCommandDetection,
  } = usePromptTracking({
    tabId,
    termRef,
    inEditorModeRef,
    isCommandExecutingRef,
    lastExecutedCommandTimeRef,
    lastExecutedCommandRef,
    scheduleTerminalLayoutSyncRef,
    scheduleTerminalRedrawRef,
    scheduleTerminalRedraw,
    focusTerminalInput,
    broadcastInputToGroup,
    sendInputToProcess,
    enqueueInputToProcess,
    suggestionApi,
  });

  const recoverTerminalInteractionStateBound = useCallback(
    (options = {}) => {
      recoverTerminalInteractionState({
        ...options,
        pendingSystemShortcutRecoveryRef,
        imeCompositionActiveRef,
        currentInput,
      });
    },
    [currentInput, recoverTerminalInteractionState],
  );

  useEffect(() => {
    recoverTerminalInteractionStateRef.current =
      recoverTerminalInteractionStateBound;
  }, [recoverTerminalInteractionStateBound]);

  const recoverTerminalAfterActivation = useCallback(
    ({ resize = true, refocus = true, refreshSuggestions = false } = {}) => {
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
        if (resize) {
          scheduleTerminalLayoutSyncRef.current("activation");
        }
        recoverTerminalInteractionStateRef.current({
          refocus,
          refreshSuggestions:
            refreshSuggestions && !imeCompositionActiveRef.current,
        });
        return true;
      } catch {
        return false;
      }
    },
    [attachTerminalToContainer, scheduleTerminalLayoutSyncRef],
  );

  const {
    showSearchBar,
    searchTerm,
    searchResults,
    noMatchFound,
    caseSensitive,
    useRegex,
    wholeWord,
    setSearchTerm,
    handleSearch,
    handleSearchPrevious,
    openSearchBar,
    closeSearchBar,
    toggleSearchBar,
    toggleCaseSensitive,
    toggleRegex,
    toggleWholeWord,
  } = useTerminalSearch({
    searchAddonRef,
    termRef,
    searchAddonVersion,
  });

  const { handleMouseDown, handleMouseMove, handleMouseUp } =
    useTerminalClipboard({
      termRef,
      markPasteIfAllowed,
      handlePasteText,
    });

  const {
    contextMenu,
    selectedText,
    handleContextMenu,
    handleClose,
    handleCopy,
    handlePaste,
    handleSendToAI,
    handleClear,
    handleSearchFromMenu,
  } = useTerminalContextMenu({
    termRef,
    isActiveRef,
    markPasteIfAllowed,
    handlePasteText,
    openSearchBar,
    setShowSuggestions,
    setSuggestions,
  });

  useTerminalLifecycle({
    tabId,
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
    contentUpdated,
    setContentUpdated,
    contentUpdatedRef,
    contentUpdateFrameRef,
    contentUpdateFrameTypeRef,
    contentUpdatedStateRef,
    markTerminalContentUpdated,
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
  });

  useTerminalSessionEvents({
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
  });

  useEffect(() => {
    return () => {
      if (terminalIOMailboxRef.current) {
        terminalIOMailboxRef.current.detachProcess();
      }
      resetRenderState();
      cancelInputQueueDrain();
    };
  }, [cancelInputQueueDrain, resetRenderState]);

  useEffect(() => {
    if (!contentUpdated || !termRef.current) return;
    scheduleTerminalRedraw(termRef.current);
  }, [contentUpdated, scheduleTerminalRedraw]);

  return (
    <Box
      data-tab-id={tabId}
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        overflow: "hidden",
      }}
    >
      <div className="terminal-container">
        <div
          ref={terminalRef}
          style={{
            width: "100%",
            height: "100%",
            padding: "0 0 0 0",
          }}
        />

        <WebTerminalSearchOverlay
          isActive={isActive}
          showSearchBar={showSearchBar}
          searchTerm={searchTerm}
          searchResults={searchResults}
          noMatchFound={noMatchFound}
          caseSensitive={caseSensitive}
          useRegex={useRegex}
          wholeWord={wholeWord}
          onOpenSearch={openSearchBar}
          onCloseSearch={closeSearchBar}
          onSearchTermChange={setSearchTerm}
          onSearchNext={handleSearch}
          onSearchPrevious={handleSearchPrevious}
          onToggleCaseSensitive={toggleCaseSensitive}
          onToggleRegex={toggleRegex}
          onToggleWholeWord={toggleWholeWord}
        />
      </div>
      <WebTerminalContextMenu
        contextMenu={contextMenu}
        isActive={isActive}
        selectedText={selectedText}
        onClose={handleClose}
        onCopy={handleCopy}
        onPaste={handlePaste}
        onSendToAI={handleSendToAI}
        onSearch={handleSearchFromMenu}
        onClear={handleClear}
      />

      <CommandSuggestion
        suggestions={suggestions}
        visible={
          isActive &&
          shouldDisplayCommandSuggestions({
            showSuggestions,
            suggestions,
            currentInput,
            inEditorMode: inEditorModeRef.current,
            isCommandExecuting: isCommandExecutingRef.current,
          }) && Boolean(cursorPosition)
        }
        position={cursorPosition}
        onSelectSuggestion={handleSuggestionSelect}
        onClose={closeSuggestions}
        terminalElement={terminalRef.current}
        currentInput={currentInput}
        initialSelectedIndex={-1}
      />
    </Box>
  );
};

WebTerminal.propTypes = {
  tabId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  refreshKey: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  sshConfig: PropTypes.object,
  terminalType: PropTypes.oneOf(["ssh", "telnet", "local"]),
  localConfig: PropTypes.object,
  isActive: PropTypes.bool,
};

export default React.memo(WebTerminal, areWebTerminalPropsEqual);
