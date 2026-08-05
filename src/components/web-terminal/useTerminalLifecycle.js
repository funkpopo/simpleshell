import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { useTranslation } from "react-i18next";
import {
  debounce,
  createResizeObserver,
  isElementVisible,
} from "../../core/utils/performance.js";
import { TerminalPerformanceMonitor } from "../../utils/TerminalPerformanceMonitor.js";
import { ScrollbackUsageTracker } from "../../utils/ScrollbackUsageTracker.js";
import { RendererTerminalIOMailbox } from "../../modules/terminal/io/RendererTerminalIOMailbox.js";
import {
  shouldIgnoreCommandSuggestionKeyEvent,
} from "../../modules/terminal/commandSuggestionState.js";
import {
  isSystemShortcutRecoveryKey,
  shouldArmSystemShortcutRecovery,
} from "../../modules/terminal/systemShortcutRecovery.js";
import {
  TERMINAL_RESIZE_QUERY_REGEX,
  ensureSharedTerminalStyles,
  isCtrlLeftMouseClick,
  searchBarStyles,
  syncTerminalLinkCtrlState,
  terminalStyles,
} from "../../modules/terminal/controller/terminalDom.js";
import {
  clearGeometryFor,
  disposablesCache,
  fitAddonCache,
  processCache,
  registerTerminalIOMailbox,
  terminalCache,
  unregisterTerminalIOMailbox,
} from "../../modules/terminal/controller/terminalSessionStore.js";
import {
  DEFAULT_TERMINAL_LINE_HEIGHT,
  getTerminalTheme,
  normalizeTerminalLineHeight,
} from "../../modules/terminal/terminalTheme.js";
import {
  FIRA_CODE_FONT_FAMILY,
  getTerminalFontFamily,
} from "../../utils/fonts.js";
import {
  clearPendingWrappedInputRefresh,
  shouldForceTerminalViewportRefresh,
} from "./terminalHelpers.js";
import { setupSimulatedTerminal } from "./simulatedTerminal.js";

/**
 * Terminal create / cache reuse / mailbox / connection / DOM listeners / cleanup.
 */
export function useTerminalLifecycle({
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
}) {
  const { t, i18n } = useTranslation();
  const [, setPerformanceStats] = useState(null);
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

  const getFontSettings = useCallback(async () => {
    try {
      if (window.terminalAPI?.loadUISettings) {
        const settings = await window.terminalAPI.loadUISettings();
        const hardwareOn =
          settings?.performance?.hardwareAcceleration !== false;
        const enabled =
          hardwareOn && settings?.performance?.webglEnabled !== false;
        webglRendererEnabledRef.current = enabled;
        setWebglRendererEnabled(enabled);
        const rawScroll = Number(settings.terminalScrollbackLines);
        const terminalScrollbackLines = Number.isFinite(rawScroll)
          ? Math.min(500000, Math.max(1000, Math.floor(rawScroll)))
          : 50000;
        return {
          fontSize: settings.terminalFontSize || 14,
          fontFamily: getTerminalFontFamily(
            settings.terminalFont || "Fira Code",
          ),
          fontWeight: settings.terminalFontWeight || 500,
          lineHeight: normalizeTerminalLineHeight(settings.terminalLineHeight),
          terminalScrollbackLines,
        };
      }
    } catch {
      // Failed to load font settings from config
    }
    webglRendererEnabledRef.current = true;
    setWebglRendererEnabled(true);
    return {
      fontSize: 14,
      fontFamily: getTerminalFontFamily("Fira Code"),
      fontWeight: 500,
      lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
      terminalScrollbackLines: 50000,
    };
  }, [setWebglRendererEnabled, webglRendererEnabledRef]);

  // 如果 refreshKey 变化，清除缓存强制重新创建终端
  useEffect(() => {
    if (refreshKey && terminalCache[tabId]) {
      if (processCache[tabId]) {
        try {
          if (window.terminalAPI && window.terminalAPI.killProcess) {
            window.terminalAPI.killProcess(processCache[tabId]);
          }
        } catch {
          // Failed to kill process
        }
        clearGeometryFor(processCache[tabId], tabId);
        delete processCache[tabId];
      }

      try {
        if (
          terminalCache[tabId].__simpleShellOsc133Disposable &&
          typeof terminalCache[tabId].__simpleShellOsc133Disposable.dispose ===
            "function"
        ) {
          terminalCache[tabId].__simpleShellOsc133Disposable.dispose();
          delete terminalCache[tabId].__simpleShellOsc133Disposable;
        }
        terminalCache[tabId].dispose();
      } catch {
        // Failed to dispose terminal
      }
      delete terminalCache[tabId];
      delete fitAddonCache[tabId];
    }
  }, [refreshKey, tabId]);

  // 监听设置变更事件
  useEffect(() => {
    const handleSettingsChanged = async (event) => {
      const {
        terminalFontSize,
        terminalFont,
        terminalFontWeight,
        terminalLineHeight,
        performance,
        terminalScrollbackLines,
      } = event.detail;

      if (terminalScrollbackLines !== undefined) {
        const rawScroll = Number(terminalScrollbackLines);
        if (Number.isFinite(rawScroll)) {
          const scrollLines = Math.min(
            500000,
            Math.max(1000, Math.floor(rawScroll)),
          );
          if (terminalCache[tabId]) {
            terminalCache[tabId].options.scrollback = scrollLines;
          }
          if (scrollbackUsageTrackerRef.current) {
            scrollbackUsageTrackerRef.current.maxLines = scrollLines;
          }
        }
      }

      if (
        performance &&
        (Object.prototype.hasOwnProperty.call(performance, "webglEnabled") ||
          Object.prototype.hasOwnProperty.call(
            performance,
            "hardwareAcceleration",
          ))
      ) {
        const hardwareOn = performance.hardwareAcceleration !== false;
        const enabled = hardwareOn && performance.webglEnabled !== false;
        webglRendererEnabledRef.current = enabled;
        setWebglRendererEnabled(enabled);
        if (termRef.current) {
          if (enabled) {
            tryEnableWebglRenderer(termRef.current);
          } else {
            disableWebglRenderer(termRef.current);
          }
        }
      }

      if (terminalRef.current && terminalCache[tabId] && fitAddonRef.current) {
        if (terminalFontSize !== undefined) {
          terminalCache[tabId].options.fontSize = parseInt(
            terminalFontSize,
            10,
          );
        }
        if (terminalFont !== undefined) {
          terminalCache[tabId].options.fontFamily =
            getTerminalFontFamily(terminalFont);
        }
        if (terminalFontWeight !== undefined) {
          terminalCache[tabId].options.fontWeight = parseInt(
            terminalFontWeight,
            10,
          );
        }
        if (terminalLineHeight !== undefined) {
          terminalCache[tabId].options.lineHeight =
            normalizeTerminalLineHeight(terminalLineHeight);
        }

        eventManager.setTimeout(() => {
          scheduleTerminalLayoutSyncRef.current("theme-updated");
        }, 100);
      }
    };

    const removeSettingsChangedListener = eventManager.addEventListener(
      window,
      "settingsChanged",
      handleSettingsChanged,
    );

    return () => {
      removeSettingsChangedListener();
    };
  }, [
    tabId,
    eventManager,
    disableWebglRenderer,
    tryEnableWebglRenderer,
    fitAddonRef,
    scheduleTerminalLayoutSyncRef,
    scrollbackUsageTrackerRef,
    setWebglRendererEnabled,
    termRef,
    terminalRef,
    webglRendererEnabledRef,
  ]);

  const setupDataListener = useCallback(
    (processId, term) => {
      const previousProcessId = processCache[tabId];
      const mailbox = terminalIOMailboxRef.current;

      clearInputQueue();

      if (previousProcessId && previousProcessId !== processId) {
        clearGeometryFor(previousProcessId, tabId);
      }
      processCache[tabId] = processId;
      clearGeometryFor(processId, tabId);
      resetPromptTracking();
      clearPendingWrappedInputRefresh(term);
      syncPromptTrackingFromTerminal(term);

      const handleProcessOutput = (data) => {
        if (!data) {
          return;
        }

        const dataStr = typeof data === "string" ? data : data.toString();

        if (
          dataStr.includes("\u001b[2J") ||
          dataStr.includes("\u001b[H") ||
          dataStr.includes("\u001b[s") ||
          dataStr.includes("\u001b[u") ||
          dataStr.includes("\u001b[J") ||
          /(^|\s)(top|htop|vi|vim|nano|less|more|tail -f|watch)(\s|$)/.test(
            dataStr,
          ) ||
          dataStr.includes("\u001b[?1049h") ||
          dataStr.includes("\u001b[?1049l") ||
          TERMINAL_RESIZE_QUERY_REGEX.test(dataStr)
        ) {
          setContentUpdated(true);
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
      setContentUpdated,
      syncPromptTrackingFromTerminal,
      tabId,
      terminalIOMailboxRef,
    ],
  );

  // Stable refs for callbacks used inside the long-lived lifecycle effect
  const setupCommandDetectionRef = useRef(setupCommandDetection);
  const setupDataListenerRef = useRef(setupDataListener);
  const handleContextMenuRef = useRef(handleContextMenu);
  const handlePasteTextRef = useRef(handlePasteText);
  const markPasteIfAllowedRef = useRef(markPasteIfAllowed);
  const handleMouseDownRef = useRef(handleMouseDown);
  const handleMouseMoveRef = useRef(handleMouseMove);
  const handleMouseUpRef = useRef(handleMouseUp);

  useEffect(() => {
    setupCommandDetectionRef.current = setupCommandDetection;
    setupDataListenerRef.current = setupDataListener;
    handleContextMenuRef.current = handleContextMenu;
    handlePasteTextRef.current = handlePasteText;
    markPasteIfAllowedRef.current = markPasteIfAllowed;
    handleMouseDownRef.current = handleMouseDown;
    handleMouseMoveRef.current = handleMouseMove;
    handleMouseUpRef.current = handleMouseUp;
  });

  useEffect(() => {
    const lifecycleManager = lifecycleEventManager;
    lifecycleManager.reset();
    let lifecycleActive = true;

    const styleElement = ensureSharedTerminalStyles();
    if (styleElement.textContent !== terminalStyles + searchBarStyles) {
      styleElement.textContent = terminalStyles + searchBarStyles;
    }

    if (!disposablesCache[tabId]) {
      disposablesCache[tabId] = [];
    }
    const terminalDisposables = disposablesCache[tabId];

    const ensureTerminalMailbox = (term) => {
      const queueOutputHandler = (data) => {
        if (scrollbackUsageTrackerRef.current) {
          scrollbackUsageTrackerRef.current.addData(data);
        }
        markTerminalContentUpdated();
      };
      const writeCompleteHandler = ({ data, duration }) => {
        if (performanceMonitorRef.current) {
          performanceMonitorRef.current.recordWrite(data.length, duration);
        }
        const forceRefresh = shouldForceTerminalViewportRefresh(
          term,
          inEditorModeRef.current,
        );
        clearPendingWrappedInputRefresh(term);
        scheduleTerminalRedrawRef.current(term, { force: forceRefresh });
      };

      if (!terminalIOMailboxRef.current) {
        terminalIOMailboxRef.current = new RendererTerminalIOMailbox({
          term,
          onQueueOutput: queueOutputHandler,
          onWriteComplete: writeCompleteHandler,
        });
      } else {
        terminalIOMailboxRef.current.setTerm(term);
        terminalIOMailboxRef.current.updateHandlers({
          onQueueOutput: queueOutputHandler,
          onWriteComplete: writeCompleteHandler,
        });
      }
      registerTerminalIOMailbox(tabId, terminalIOMailboxRef.current);
    };

    if (terminalRef.current) {
      let term;
      let fitAddon;
      let searchAddon;

      if (terminalCache[tabId]) {
        if (disposablesCache[tabId] && Array.isArray(disposablesCache[tabId])) {
          console.debug(
            `[WebTerminal] Cleaning up ${disposablesCache[tabId].length} old event listeners for tabId=${tabId}`,
          );
          disposablesCache[tabId].forEach((disposable) => {
            try {
              if (disposable && typeof disposable.dispose === "function") {
                disposable.dispose();
              }
            } catch (error) {
              console.error(
                `[WebTerminal] Failed to dispose event listener for tabId=${tabId}:`,
                error,
              );
            }
          });
          disposablesCache[tabId].length = 0;
        }

        term = terminalCache[tabId];
        fitAddon = fitAddonCache[tabId];

        console.debug(
          `[WebTerminal] Reusing cached terminal for tabId=${tabId}, processId=${processCache[tabId]}`,
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

        const existingProcessId = processCache[tabId];
        if (existingProcessId) {
          try {
            console.debug(
              `[WebTerminal] Rebinding listeners for tabId=${tabId}, processId=${existingProcessId}`,
            );
          } catch {
            // ignore log errors
          }

          setupDataListenerRef.current(existingProcessId, term);
          setupCommandDetectionRef.current(
            term,
            existingProcessId,
            false,
            terminalDisposables,
            {
              pendingSystemShortcutRecoveryRef,
              setContentUpdated,
            },
          );
        }
      } else {
        term = new Terminal({
          cursorBlink: true,
          cursorStyle: "block",
          theme: getTerminalTheme(themeModeRef.current),
          fontFamily: FIRA_CODE_FONT_FAMILY,
          fontSize: 14,
          fontWeight: 500,
          fontWeightBold: 700,
          scrollback: 50000,
          allowTransparency: true,
          cols: 120,
          rows: 30,
          convertEol: true,
          disableStdin: false,
          rightClickSelectsWord: false,
          copyOnSelect: false,
          selectionScrollSpeed: 5,
          fastScrollModifier: "shift",
          letterSpacing: 0,
          lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
          macOptionIsMeta: false,
          macOptionClickForcesSelection: false,
        });

        (async () => {
          try {
            const fontSettings = await getFontSettings();
            term.options.fontSize = fontSettings.fontSize;
            term.options.fontFamily = fontSettings.fontFamily;
            term.options.fontWeight = fontSettings.fontWeight;
            term.options.lineHeight = fontSettings.lineHeight;
            const scrollLines = fontSettings.terminalScrollbackLines || 50000;
            term.options.scrollback = scrollLines;
            if (scrollbackUsageTrackerRef.current) {
              scrollbackUsageTrackerRef.current.maxLines = scrollLines;
            }
            scheduleTerminalLayoutSyncRef.current("font-settings");
          } catch {
            // Failed to apply font settings
          }
        })();

        fitAddon = new FitAddon();
        searchAddon = new SearchAddon();

        const openExternalUrl = async (uri) => {
          try {
            if (!window.terminalAPI?.openExternal) {
              throw new Error("terminalAPI.openExternal is unavailable");
            }

            const result = await window.terminalAPI.openExternal(uri, {
              source: "terminal",
            });
            if (
              result &&
              typeof result === "object" &&
              "success" in result &&
              !result.success
            ) {
              throw new Error(result.error || "Failed to open external URL");
            }
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Failed to open external URL";
            console.error(`Failed to open external link: ${uri}`, error);

            if (typeof term.writeln === "function") {
              term.writeln(`\r\n[Link Error] ${message}`);
              term.writeln(`[Link Error] ${uri}`);
            }
          }
        };

        const simpleUrlRegex =
          /(?:https?:\/\/[^\s"'`<>]+|(?:\b\d{1,3}(?:\.\d{1,3}){3}\b)(?::\d{1,5})?(?:\/[^\s"'`<>]*)?)/g;
        const ipv4LikeRegex = /^\d{1,3}(?:\.\d{1,3}){3}(?::\d{1,5})?(?:\/.*)?$/;
        const normalizeExternalUrl = (value) => {
          if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(value)) {
            return value;
          }
          if (ipv4LikeRegex.test(value)) {
            return `http://${value}`;
          }
          return value;
        };
        const isValidIpv4Like = (value) => {
          if (!ipv4LikeRegex.test(value)) {
            return false;
          }

          const [hostAndPort] = value.split("/");
          const [host, port] = hostAndPort.split(":");
          const octets = host.split(".");
          if (octets.length !== 4) {
            return false;
          }

          const isValidOctet = octets.every((octet) => {
            if (!/^\d{1,3}$/.test(octet)) {
              return false;
            }
            const numeric = Number(octet);
            return Number.isInteger(numeric) && numeric >= 0 && numeric <= 255;
          });

          if (!isValidOctet) {
            return false;
          }

          if (port == null || port === "") {
            return true;
          }

          if (!/^\d{1,5}$/.test(port)) {
            return false;
          }

          const numericPort = Number(port);
          return (
            Number.isInteger(numericPort) &&
            numericPort >= 1 &&
            numericPort <= 65535
          );
        };
        const isValidExternalUrl = (originalValue, normalizedValue) => {
          if (ipv4LikeRegex.test(originalValue)) {
            return isValidIpv4Like(originalValue);
          }

          try {
            const parsed = new URL(normalizedValue);
            return parsed.protocol === "http:" || parsed.protocol === "https:";
          } catch {
            return false;
          }
        };
        term.registerLinkProvider({
          provideLinks: (y, callback) => {
            const buffer = term.buffer.active;
            const targetLineIndex = y - 1;
            const targetLine = buffer.getLine(targetLineIndex);
            if (!targetLine) {
              callback([]);
              return;
            }

            let blockStart = targetLineIndex;
            while (blockStart > 0) {
              const current = buffer.getLine(blockStart);
              if (!current || !current.isWrapped) {
                break;
              }
              blockStart -= 1;
            }

            let blockEnd = targetLineIndex;
            let searchingWrappedLines = true;
            while (searchingWrappedLines) {
              const next = buffer.getLine(blockEnd + 1);
              if (!next || !next.isWrapped) {
                searchingWrappedLines = false;
                continue;
              }
              blockEnd += 1;
            }

            const segments = [];
            let offset = 0;
            for (
              let lineIndex = blockStart;
              lineIndex <= blockEnd;
              lineIndex++
            ) {
              const line = buffer.getLine(lineIndex);
              if (!line) {
                continue;
              }
              const text = line.translateToString(true);
              segments.push({
                lineIndex,
                text,
                startOffset: offset,
                endOffset: offset + text.length,
              });
              offset += text.length;
            }

            const fullText = segments.map((seg) => seg.text).join("");
            const links = [];
            let match = null;

            simpleUrlRegex.lastIndex = 0;
            while ((match = simpleUrlRegex.exec(fullText)) !== null) {
              const rawUrl = match[0];
              const trimmedUrl = rawUrl.replace(/[),.;!?]+$/g, "");
              if (!trimmedUrl) {
                continue;
              }

              const fullUrl = trimmedUrl;
              const globalStart = match.index;
              const externalUrl = normalizeExternalUrl(fullUrl);
              if (!isValidExternalUrl(fullUrl, externalUrl)) {
                if (trimmedUrl.length !== rawUrl.length) {
                  simpleUrlRegex.lastIndex = globalStart + trimmedUrl.length;
                }
                continue;
              }
              const globalEndExclusive = globalStart + fullUrl.length;

              for (const seg of segments) {
                if (seg.lineIndex !== targetLineIndex) {
                  continue;
                }

                const intersectStart = Math.max(globalStart, seg.startOffset);
                const intersectEndExclusive = Math.min(
                  globalEndExclusive,
                  seg.endOffset,
                );
                if (intersectStart >= intersectEndExclusive) {
                  continue;
                }

                const localStart = intersectStart - seg.startOffset;
                const localEndExclusive =
                  intersectEndExclusive - seg.startOffset;

                links.push({
                  text: fullUrl,
                  range: {
                    start: { x: localStart + 1, y },
                    end: { x: localEndExclusive, y },
                  },
                  activate: (event) => {
                    event?.preventDefault?.();
                    if (!isCtrlLeftMouseClick(event)) {
                      return;
                    }
                    void openExternalUrl(externalUrl);
                  },
                });
              }

              if (trimmedUrl.length !== rawUrl.length) {
                simpleUrlRegex.lastIndex = globalStart + trimmedUrl.length;
              }
            }

            callback(links);
          },
        });

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

        if (!performanceMonitorRef.current) {
          let lastStatsUpdate = 0;
          const statsUpdateInterval = 2000;

          performanceMonitorRef.current = new TerminalPerformanceMonitor({
            enabled: true,
            sampleRate: 100,
            maxHistorySize: 1000,
            onStats: (stats) => {
              const now = Date.now();
              if (now - lastStatsUpdate >= statsUpdateInterval) {
                lastStatsUpdate = now;
                setPerformanceStats(stats);
              }
            },
          });
        }

        if (!scrollbackUsageTrackerRef.current) {
          scrollbackUsageTrackerRef.current = new ScrollbackUsageTracker({
            maxLines: 50000,
            onChange: (info) => {
              if (performanceMonitorRef.current) {
                performanceMonitorRef.current.recordBufferSize(info.bufferSize);
                performanceMonitorRef.current.recordScrollbackUsage(
                  info.usagePercent,
                );
              }
            },
          });
        }

        ensureTerminalMailbox(term);
        if (webglRendererEnabledRef.current) {
          tryEnableWebglRenderer(term);
        } else {
          disableWebglRenderer(term);
        }

        scheduleTerminalLayoutSyncRef.current("terminal-created");

        const isLocalTerminal = terminalType === "local";
        const hasTerminalConfig = isLocalTerminal ? localConfig : sshConfig;

        if (hasTerminalConfig && window.terminalAPI) {
          const localizedSshConfig = sshConfig
            ? {
                ...sshConfig,
                language: languageRef.current,
              }
            : null;
          const localizedLocalConfig = localConfig
            ? {
                ...localConfig,
                tabId,
              }
            : null;

          const translate = (...args) => tRef.current(...args);

          if (isLocalTerminal) {
            term.writeln(
              `Starting ${localizedLocalConfig?.name || "local terminal"}...`,
            );
          } else if (localizedSshConfig.splitReconnect) {
            term.writeln(
              translate("webTerminal.runtime.reconnecting", {
                host: localizedSshConfig.host,
              }),
            );
          } else {
            term.writeln(
              translate("webTerminal.runtime.connecting", {
                host: localizedSshConfig.host,
              }),
            );
          }

          const formatConnectionError = (error) => {
            const errorObject =
              error && typeof error === "object" ? error : null;
            const localError =
              errorObject?.data?.error ||
              errorObject?.error ||
              errorObject?.message ||
              error;
            const rawMessage =
              typeof errorObject?.error === "string" &&
              errorObject.error.trim()
                ? errorObject.error
                : typeof errorObject?.message === "string" &&
                    errorObject.message.trim()
                  ? errorObject.message
                  : String(error || "").trim();
            if (isLocalTerminal) {
              const message =
                typeof localError === "string"
                  ? localError
                  : localError?.message || rawMessage;
              return `\r\nLocal terminal failed to start: ${
                message || translate("webTerminal.runtime.unknownError")
              }`;
            }
            const isCancelled =
              /cancel(l)?ed/i.test(rawMessage) || rawMessage.includes("取消");
            if (isCancelled) {
              return `\r\n${translate("webTerminal.runtime.connectionCancelled")}`;
            }
            const connectionFailure = errorObject?.connectionFailure;
            const reason =
              typeof connectionFailure?.message === "string" &&
              connectionFailure.message.trim()
                ? connectionFailure.message.trim()
                : rawMessage || translate("webTerminal.runtime.unknownError");
            const baseMessage = localizedSshConfig.splitReconnect
              ? `\r\n${translate("webTerminal.runtime.reconnectFailed", {
                  error: reason,
                })}`
              : `\r\n${translate("webTerminal.runtime.connectionFailed", {
                  error: reason,
                })}`;
            const suggestion =
              typeof connectionFailure?.suggestion === "string" &&
              connectionFailure.suggestion.trim()
                ? connectionFailure.suggestion.trim()
                : "";
            return suggestion
              ? `${baseMessage}\r\n${translate("webTerminal.runtime.connectionAdvice", {
                  advice: suggestion,
                })}`
              : baseMessage;
          };

          const normalizeConnectResult = (result) => {
            if (
              result &&
              typeof result === "object" &&
              Object.prototype.hasOwnProperty.call(result, "success")
            ) {
              if (!result.success) {
                return { processId: null, error: result };
              }
              const data = result.data ?? null;
              const processId =
                data && typeof data === "object" ? data.processId : data;
              return { processId, metadata: data, error: null };
            }
            return { processId: result, metadata: result, error: null };
          };

          try {
            let connectPromise;
            if (isLocalTerminal) {
              connectPromise =
                window.terminalAPI.startLocalTerminal(localizedLocalConfig);
            } else {
              connectPromise =
                localizedSshConfig.protocol === "telnet"
                  ? window.terminalAPI.startTelnet(localizedSshConfig)
                  : window.terminalAPI.startSSH(localizedSshConfig);
            }

            connectPromise
              .then((result) => {
                if (!lifecycleActive && terminalCache[tabId] !== term) {
                  return;
                }

                const { processId, error } = normalizeConnectResult(result);
                if (error) {
                  term.writeln(formatConnectionError(error));
                  return;
                }
                if (processId) {
                  currentProcessId.current = processId;

                  const previousProcessId = processCache[tabId];
                  if (previousProcessId) {
                    clearGeometryFor(previousProcessId, tabId);
                  }
                  processCache[tabId] = processId;
                  clearGeometryFor(processId, tabId);

                  const event = new CustomEvent("terminalProcessIdUpdated", {
                    detail: {
                      terminalId: tabId,
                      processId,
                      protocol: isLocalTerminal
                        ? "local"
                        : localizedSshConfig.protocol || "ssh",
                      terminalType: isLocalTerminal ? "local" : "remote",
                      splitReconnect:
                        localizedSshConfig?.splitReconnect || false,
                    },
                  });

                  window.dispatchEvent(event);

                  console.debug(
                    `[WebTerminal] Clearing old event listeners before rebinding for tabId=${tabId}, old count=${terminalDisposables.length}`,
                  );
                  terminalDisposables.forEach((disposable) => {
                    try {
                      if (
                        disposable &&
                        typeof disposable.dispose === "function"
                      ) {
                        disposable.dispose();
                      }
                    } catch (disposeError) {
                      console.error(
                        `[WebTerminal] Failed to dispose event listener:`,
                        disposeError,
                      );
                    }
                  });
                  terminalDisposables.length = 0;

                  ensureTerminalMailbox(term);
                  setupDataListenerRef.current(processId, term);

                  console.debug(
                    `[WebTerminal] Setting up command detection for tabId=${tabId}, processId=${processId}`,
                  );
                  setupCommandDetectionRef.current(
                    term,
                    processId,
                    false,
                    terminalDisposables,
                    {
                      pendingSystemShortcutRecoveryRef,
                      setContentUpdated,
                    },
                  );

                  scheduleTerminalLayoutSyncRef.current("connection-ready");

                  if (localizedSshConfig?.splitReconnect) {
                    term.writeln(
                      `\r\n${translate("webTerminal.runtime.newConnectionEstablished")}`,
                    );

                    lifecycleManager.setTimeout(() => {
                      if (term.refresh) {
                        term.refresh(0, term.rows - 1);
                      }
                    }, 300);
                  }
                } else {
                  const errorMsg = localizedSshConfig?.splitReconnect
                    ? translate("webTerminal.runtime.reconnectFailed", {
                        error: translate("webTerminal.runtime.noProcessId"),
                      })
                    : isLocalTerminal
                      ? "Local terminal failed to start: no process id"
                      : translate("webTerminal.runtime.connectionFailed", {
                          error: translate("webTerminal.runtime.noProcessId"),
                        });
                  term.writeln(errorMsg);
                }
              })
              .catch((error) => {
                if (!lifecycleActive && terminalCache[tabId] !== term) {
                  return;
                }
                term.writeln(formatConnectionError(error));
              });
          } catch (error) {
            term.writeln(formatConnectionError(error));
          }
        } else {
          term.writeln(tRef.current("webTerminal.runtime.welcome"));
          term.writeln(tRef.current("webTerminal.runtime.helpHint"));
          term.writeln("");
          term.write("$ ");

          setupSimulatedTerminal(term);
        }

        terminalCache[tabId] = term;
        fitAddonCache[tabId] = fitAddon;
      }

      const previousSearchAddon = searchAddonRef.current;
      const previousSearchTerm = termRef.current;
      searchAddonRef.current = searchAddon;
      termRef.current = term;

      if (previousSearchAddon !== searchAddon || previousSearchTerm !== term) {
        setSearchAddonVersion((prev) => prev + 1);
      }

      const isTerminalShortcutContext = (target) => {
        const helperTextarea = term.element?.querySelector(
          ".xterm-helper-textarea",
        );

        return (
          target?.classList?.contains?.("xterm-helper-textarea") ||
          document.activeElement === helperTextarea
        );
      };

      const scheduleShortcutRecovery = ({
        delays = [0, 40, 120],
        refocus = true,
        refreshSuggestions = false,
      } = {}) => {
        if (!pendingSystemShortcutRecoveryRef.current) {
          return;
        }

        delays.forEach((delay) => {
          lifecycleManager.setTimeout(() => {
            if (!pendingSystemShortcutRecoveryRef.current) {
              return;
            }

            recoverTerminalInteractionStateRef.current({
              refocus,
              refreshSuggestions,
            });
          }, delay);
        });
      };

      const scheduleActivationRecovery = ({
        delays = [0, 60, 160],
        refreshSuggestions = false,
      } = {}) => {
        delays.forEach((delay) => {
          lifecycleManager.setTimeout(() => {
            if (document.hidden) {
              return;
            }

            recoverTerminalAfterActivation({
              resize: true,
              refocus: true,
              refreshSuggestions,
            });
          }, delay);
        });
      };

      const handleKeyDown = (e) => {
        syncTerminalLinkCtrlState(term, e.ctrlKey);

        if (shouldIgnoreCommandSuggestionKeyEvent(e)) {
          if (
            shouldArmSystemShortcutRecovery(e, {
              terminalFocused: isTerminalShortcutContext(e.target),
            })
          ) {
            pendingSystemShortcutRecoveryRef.current = true;
          }
          return;
        }

        if (
          shouldArmSystemShortcutRecovery(e, {
            terminalFocused: isTerminalShortcutContext(e.target),
          })
        ) {
          pendingSystemShortcutRecoveryRef.current = true;
          return;
        }

        if (e.altKey && e.key === "F1") {
          return;
        }

        const isTerminalInput =
          e.target &&
          e.target.classList &&
          e.target.classList.contains("xterm-helper-textarea");

        if (isTerminalInput) {
          const allowedKeys = [
            "/",
            "Escape",
            "F3",
            ",",
            ".",
            ";",
            "'",
            "g",
            "l",
            "L",
          ];

          const isAllowedKey =
            allowedKeys.includes(e.key) ||
            (e.key === "g" && e.ctrlKey) ||
            (e.key === "/" && e.ctrlKey) ||
            (e.key === "," && e.ctrlKey) ||
            (e.key === "." && e.ctrlKey) ||
            (e.key === ";" && e.ctrlKey) ||
            (e.key === "'" && e.ctrlKey) ||
            (e.key.toLowerCase?.() === "l" && e.ctrlKey);

          if (!isAllowedKey) {
            return;
          }
        }

        if (e.ctrlKey && e.key === ";") {
          const selection = term.getSelection();
          if (selection) {
            e.preventDefault();
            window.clipboardAPI.writeText(selection);
          }
        } else if (e.ctrlKey && e.key === "'") {
          e.preventDefault();

          if (!markPasteIfAllowedRef.current()) {
            return;
          }

          window.clipboardAPI.readText().then((text) => {
            handlePasteTextRef.current(text);
          });
        } else if (
          e.ctrlKey &&
          !e.altKey &&
          !e.shiftKey &&
          e.key.toLowerCase() === "l"
        ) {
          if (!isActiveRef.current) return;
          e.preventDefault();
          e.stopPropagation();
          term.clear();
        } else if (e.ctrlKey && e.key === "/") {
          if (!isActiveRef.current) return;

          e.preventDefault();
          e.stopPropagation();
          shortcutUiRef.current.toggleSearchBar?.();
        } else if (e.key === "Escape") {
          const ui = shortcutUiRef.current;
          if (ui.showSearchBar) {
            if (!isActiveRef.current) return;
            e.preventDefault();
            ui.closeSearchBar?.();
          } else if (ui.showSuggestions) {
            e.preventDefault();
            ui.setShowSuggestions?.(false);
            ui.setSuggestions?.([]);
            ui.setSuggestionsHiddenByEsc?.(true);
            ui.setSuggestionsSuppressedUntilEnter?.(true);
            if (ui.suppressionContextRef) {
              ui.suppressionContextRef.current = {
                input: ui.currentInput,
                timestamp: Date.now(),
              };
            }
          }
        } else if (
          e.key === "F3" ||
          (e.ctrlKey && e.key === "g") ||
          (e.ctrlKey && e.key === ".")
        ) {
          const ui = shortcutUiRef.current;
          if (searchAddonRef.current && ui.searchTerm) {
            if (!isActiveRef.current) return;
            e.preventDefault();
            ui.handleSearch?.();
          }
        } else if (
          (e.shiftKey && e.key === "F3") ||
          (e.ctrlKey && e.key === ",")
        ) {
          const ui = shortcutUiRef.current;
          if (searchAddonRef.current && ui.searchTerm) {
            if (!isActiveRef.current) return;
            e.preventDefault();
            ui.handleSearchPrevious?.();
          }
        }
      };

      const handleKeyUp = (e) => {
        syncTerminalLinkCtrlState(term, e.ctrlKey);

        if (
          pendingSystemShortcutRecoveryRef.current &&
          isSystemShortcutRecoveryKey(e)
        ) {
          scheduleShortcutRecovery();
        }
      };

      const handleWindowBlur = () => {
        syncTerminalLinkCtrlState(term, false);
      };

      const handleWindowFocus = () => {
        if (pendingSystemShortcutRecoveryRef.current) {
          scheduleShortcutRecovery({ delays: [0, 60, 160] });
        }

        scheduleActivationRecovery();
      };

      const handleShortcutRecoveryVisibilityChange = () => {
        if (!document.hidden) {
          if (pendingSystemShortcutRecoveryRef.current) {
            scheduleShortcutRecovery({ delays: [0, 80, 180] });
          }

          scheduleActivationRecovery({ delays: [40, 140, 260] });
        }
      };

      lifecycleManager.addEventListener(document, "keydown", handleKeyDown);
      lifecycleManager.addEventListener(document, "keyup", handleKeyUp);
      lifecycleManager.addEventListener(window, "blur", handleWindowBlur);
      lifecycleManager.addEventListener(window, "focus", handleWindowFocus);
      lifecycleManager.addEventListener(
        document,
        "visibilitychange",
        handleShortcutRecoveryVisibilityChange,
      );

      if (terminalRef.current) {
        const helperTextarea = term.element?.querySelector(
          ".xterm-helper-textarea",
        );
        if (helperTextarea) {
          lifecycleManager.addEventListener(
            helperTextarea,
            "compositionstart",
            () => {
              imeCompositionActiveRef.current = true;
            },
          );
          lifecycleManager.addEventListener(helperTextarea, "blur", () => {
            if (pendingSystemShortcutRecoveryRef.current) {
              scheduleShortcutRecovery({ delays: [20, 100, 220] });
            }
          });
          lifecycleManager.addEventListener(
            helperTextarea,
            "compositionend",
            () => {
              imeCompositionActiveRef.current = false;
              if (pendingSystemShortcutRecoveryRef.current) {
                scheduleShortcutRecovery({ delays: [0, 40, 120] });
              }
            },
          );
          lifecycleManager.addEventListener(
            helperTextarea,
            "compositioncancel",
            () => {
              imeCompositionActiveRef.current = false;
              if (pendingSystemShortcutRecoveryRef.current) {
                scheduleShortcutRecovery({ delays: [0, 40, 120] });
              }
            },
          );
        }

        lifecycleManager.addEventListener(
          terminalRef.current,
          "mousedown",
          (e) => handleMouseDownRef.current(e),
          { capture: true },
        );
        lifecycleManager.addEventListener(
          terminalRef.current,
          "auxclick",
          (e) => {
            if (e.button === 1) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
            }
          },
          { capture: true },
        );
        lifecycleManager.addEventListener(
          terminalRef.current,
          "paste",
          (e) => {
            const pastedText =
              typeof e.clipboardData?.getData === "function"
                ? e.clipboardData.getData("text/plain")
                : "";
            if (pastedText) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              if (markPasteIfAllowedRef.current()) {
                handlePasteTextRef.current(pastedText);
              }
              return;
            }

            const now = Date.now();
            const lastPasteAt = lastPasteTimeRef?.current || 0;
            if (now - lastPasteAt < 200) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
            }
          },
          { capture: true },
        );

        lifecycleManager.addEventListener(
          terminalRef.current,
          "mousemove",
          (e) => handleMouseMoveRef.current(e),
        );
        lifecycleManager.addEventListener(
          terminalRef.current,
          "mouseup",
          (e) => handleMouseUpRef.current(e),
        );
      }

      if (terminalRef.current) {
        lifecycleManager.addEventListener(
          terminalRef.current,
          "contextmenu",
          (event) => handleContextMenuRef.current(event),
        );
      }

      const handleResize = () => {
        scheduleTerminalLayoutSyncRef.current("resize");
      };

      handleResize();

      const resizeObserver = createResizeObserver(
        terminalRef.current,
        ({ width, height }) => {
          if (
            !terminalRef.current ||
            !termRef.current ||
            !fitAddonRef.current ||
            !isTerminalContainerVisible(terminalRef.current)
          ) {
            return;
          }

          if (hasMeaningfulLayoutGeometryChange(width, height)) {
            scheduleTerminalLayoutSyncRef.current("container-resize");
          }
        },
        { debounceTime: 16 },
      );

      lifecycleManager.addEventListener(window, "resize", handleResize);

      const handleSidebarChanged = (event) => {
        if (
          event.detail &&
          terminalRef.current &&
          fitAddonRef.current &&
          termRef.current
        ) {
          scheduleTerminalLayoutSyncRef.current("sidebar");
        }
      };

      lifecycleManager.addEventListener(
        window,
        "sidebarChanged",
        handleSidebarChanged,
      );

      const handleTerminalVisibilityChange = debounce(() => {
        if (
          !document.hidden &&
          termRef.current &&
          isElementVisible(terminalRef.current)
        ) {
          scheduleTerminalLayoutSyncRef.current("visibility");
          scheduleActivationRecovery({ delays: [60, 180] });
        }
      }, 50);

      lifecycleManager.addEventListener(
        document,
        "visibilitychange",
        handleTerminalVisibilityChange,
      );

      const intersectionObserver =
        typeof IntersectionObserver === "function"
          ? new IntersectionObserver((entries) => {
              entries.forEach((entry) => {
                if (
                  entry.isIntersecting &&
                  terminalRef.current &&
                  termRef.current &&
                  fitAddonRef.current
                ) {
                  scheduleTerminalLayoutSyncRef.current("intersection");
                }
              });
            })
          : null;

      if (intersectionObserver && terminalRef.current) {
        intersectionObserver.observe(terminalRef.current);
        lifecycleManager.addObserver(intersectionObserver);
      }

      termRef.current = term;
      fitAddonRef.current = fitAddon;

      scheduleTerminalLayoutSyncRef.current("initial", { immediate: true });

      const ensureTerminalSizeOnVisibilityChange = () => {
        if (terminalRef.current) {
          const isVisible = isElementVisible(terminalRef.current);

          if (
            isVisible &&
            termRef.current &&
            fitAddonRef.current &&
            contentUpdated
          ) {
            lifecycleManager.setTimeout(() => {
              scheduleTerminalLayoutSyncRef.current("content-visible");
              setContentUpdated(false);
            }, 10);
          }
        }
      };

      lifecycleManager.setInterval(() => {
        if (contentUpdatedRef.current) {
          contentUpdatedRef.current = false;
          ensureTerminalSizeOnVisibilityChange();
        }
      }, 1000);

      lifecycleManager.addObserver(resizeObserver);

      lifecycleManager.addCleanup(() => {
        if (terminalIOMailboxRef.current) {
          terminalIOMailboxRef.current.detachProcess();
        }
      });

      if (process.env.NODE_ENV === "development") {
        console.debug(
          `[WebTerminal] lifecycle manager setup tabId=${tabId}`,
          lifecycleManager.getStats(),
        );
      }

      return () => {
        lifecycleActive = false;
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
          unregisterTerminalIOMailbox(tabId, terminalIOMailboxRef.current);
          terminalIOMailboxRef.current.destroy();
          terminalIOMailboxRef.current = null;
        }

        if (contentUpdateFrameRef.current !== null) {
          if (
            contentUpdateFrameTypeRef.current === "raf" &&
            typeof cancelAnimationFrame === "function"
          ) {
            cancelAnimationFrame(contentUpdateFrameRef.current);
          } else {
            clearTimeout(contentUpdateFrameRef.current);
          }
          contentUpdateFrameRef.current = null;
          contentUpdateFrameTypeRef.current = null;
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
            `[WebTerminal] lifecycle manager cleanup tabId=${tabId}`,
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
    tabId,
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
    markTerminalContentUpdated,
  ]);

  // Theme updates
  useEffect(() => {
    if (terminalCache[tabId]) {
      terminalCache[tabId].options.theme = getTerminalTheme(theme.palette.mode);
    }
  }, [theme.palette.mode, tabId]);
}
