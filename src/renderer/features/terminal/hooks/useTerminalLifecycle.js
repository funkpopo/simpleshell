import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { useTranslation } from "react-i18next";
import {
  debounce,
  createResizeObserver,
  isElementVisible,
} from "../../../shared/lib/performance.js";
import { TerminalPerformanceMonitor } from "../runtime/TerminalPerformanceMonitor.js";
import { ScrollbackUsageTracker } from "../runtime/ScrollbackUsageTracker.js";
import { RendererTerminalIOMailbox } from "../io/RendererTerminalIOMailbox.js";
import { shouldIgnoreCommandSuggestionKeyEvent } from "../model/commandSuggestionState.js";
import {
  isSystemShortcutRecoveryKey,
  shouldArmSystemShortcutRecovery,
} from "../model/systemShortcutRecovery.js";
import {
  TERMINAL_RESIZE_QUERY_REGEX,
  ensureSharedTerminalStyles,
  isCtrlLeftMouseClick,
  searchBarStyles,
  syncTerminalLinkCtrlState,
  terminalStyles,
} from "../runtime/terminalDom.js";
import {
  clearGeometryFor,
  disposeTerminalSession,
  disposablesCache,
  fitAddonCache,
  processCache,
  registerTerminalIOMailbox,
  terminalCache,
  unregisterTerminalIOMailbox,
} from "../runtime/terminalSessionStore.js";
import {
  DEFAULT_TERMINAL_LINE_HEIGHT,
  getTerminalTheme,
  normalizeTerminalLineHeight,
} from "../model/terminalTheme.js";
import {
  FIRA_CODE_FONT_FAMILY,
  getTerminalFontFamily,
} from "../../../shared/lib/fonts.js";
import {
  clearPendingWrappedInputRefresh,
  getTerminalConfigSignature,
  shouldForceTerminalViewportRefresh,
} from "../lib/terminalHelpers.js";
import { setupSimulatedTerminal } from "../lib/simulatedTerminal.js";
import { attachWorkingDirectoryTracking } from "../model/workingDirectoryTracking.js";
import { setTerminalWorkingDirectory } from "../model/workingDirectoryStore.js";
import { attachMoshTransportStatus } from "../model/moshTransportStatus.js";
import { attachTerminalSelection } from "../runtime/terminalSelection.js";

/**
 * Terminal create / cache reuse / mailbox / connection / DOM listeners / cleanup.
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
        // setWebglRendererEnabled 已被 WebTerminal 包装：同时尊重设置项与
        // 分屏窗格数（allowWebgl）并同步 ref
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
    setWebglRendererEnabled(true);
    return {
      fontSize: 14,
      fontFamily: getTerminalFontFamily("Fira Code"),
      fontWeight: 500,
      lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
      terminalScrollbackLines: 50000,
    };
  }, [setWebglRendererEnabled, webglRendererEnabledRef]);

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

  // 如果 refreshKey 变化，清除缓存强制重新创建终端
  useEffect(() => {
    if (refreshKey && terminalCache[sessionKey]) {
      if (processCache[sessionKey]) {
        try {
          if (window.terminalAPI && window.terminalAPI.killProcess) {
            window.terminalAPI.killProcess(processCache[sessionKey]);
          }
        } catch {
          // Failed to kill process
        }
        clearGeometryFor(processCache[sessionKey], sessionKey);
        delete processCache[sessionKey];
      }

      try {
        if (
          terminalCache[sessionKey].__simpleShellOsc133Disposable &&
          typeof terminalCache[sessionKey].__simpleShellOsc133Disposable
            .dispose === "function"
        ) {
          terminalCache[sessionKey].__simpleShellOsc133Disposable.dispose();
          delete terminalCache[sessionKey].__simpleShellOsc133Disposable;
        }
        terminalCache[sessionKey].__workingDirectoryTracker?.dispose();
        terminalCache[sessionKey].dispose();
      } catch {
        // Failed to dispose terminal
      }
      delete terminalCache[sessionKey];
      delete fitAddonCache[sessionKey];
    }
  }, [refreshKey, sessionKey]);

  // 已失败的初次连接没有进程可供主进程更新，配置修正后重新建立该终端。
  const previousSshConfigRef = useRef(sshConfig);
  useEffect(() => {
    const changed =
      getTerminalConfigSignature(previousSshConfigRef.current) !==
      getTerminalConfigSignature(sshConfig);
    previousSshConfigRef.current = sshConfig;
    const cached = terminalCache[sessionKey];
    if (changed && cached?.__connectionFailed && !processCache[sessionKey]) {
      cached.__workingDirectoryTracker?.dispose();
      cached.dispose();
      delete terminalCache[sessionKey];
      delete fitAddonCache[sessionKey];
    }
  }, [sshConfig, sessionKey]);

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
          if (terminalCache[sessionKey]) {
            terminalCache[sessionKey].options.scrollback = scrollLines;
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
        setWebglRendererEnabled(enabled);
        if (termRef.current) {
          if (enabled) {
            tryEnableWebglRenderer(termRef.current);
          } else {
            disableWebglRenderer(termRef.current);
          }
        }
      }

      if (
        terminalRef.current &&
        terminalCache[sessionKey] &&
        fitAddonRef.current
      ) {
        if (terminalFontSize !== undefined) {
          terminalCache[sessionKey].options.fontSize = parseInt(
            terminalFontSize,
            10,
          );
        }
        if (terminalFont !== undefined) {
          terminalCache[sessionKey].options.fontFamily =
            getTerminalFontFamily(terminalFont);
        }
        if (terminalFontWeight !== undefined) {
          terminalCache[sessionKey].options.fontWeight = parseInt(
            terminalFontWeight,
            10,
          );
        }
        if (terminalLineHeight !== undefined) {
          terminalCache[sessionKey].options.lineHeight =
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
    sessionKey,
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

    const ensureTerminalMailbox = (term) => {
      if (
        terminalType === "ssh" &&
        sshConfig &&
        (!sshConfig.protocol || sshConfig.protocol === "ssh")
      ) {
        // The tracker belongs to xterm, not a mailbox binding. Retain OSC
        // precedence and learned host identity when listeners are rebound.
        if (!term.__workingDirectoryTracker) {
          term.__workingDirectoryTracker = attachWorkingDirectoryTracking(
            term,
            sessionKey,
            sshConfig,
          );
        }
      }
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
      registerTerminalIOMailbox(sessionKey, terminalIOMailboxRef.current);
    };

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
            {
              pendingSystemShortcutRecoveryRef,
              setContentUpdated,
            },
          );
        }
      } else {
        setTerminalWorkingDirectory(sessionKey, null);
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
                // 主进程契约字段名保持 tabId，值使用会话键（窗格即轻量会话）
                tabId: sessionKey,
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
              typeof errorObject?.error === "string" && errorObject.error.trim()
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
              ? `${baseMessage}\r\n${translate(
                  "webTerminal.runtime.connectionAdvice",
                  {
                    advice: suggestion,
                  },
                )}`
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
              const connectProtocol = localizedSshConfig.protocol || "ssh";
              connectPromise =
                connectProtocol === "telnet"
                  ? window.terminalAPI.startTelnet(localizedSshConfig)
                  : connectProtocol === "serial"
                    ? window.terminalAPI.startSerial(localizedSshConfig)
                    : connectProtocol === "mosh"
                      ? window.terminalAPI.startMosh(localizedSshConfig)
                      : window.terminalAPI.startSSH(localizedSshConfig);
            }

            connectPromise
              .then((result) => {
                const { processId, error } = normalizeConnectResult(result);
                if (terminalCache[sessionKey] !== term) {
                  // 连接可能在关闭窗格之后才成功；结束迟到的进程，禁止重新填充缓存。
                  if (processId)
                    void window.terminalAPI
                      .killProcess(processId)
                      .catch((closeError) => console.warn(closeError));
                  return;
                }
                if (error) {
                  term.__connectionFailed = true;
                  term.writeln(formatConnectionError(error));
                  return;
                }
                if (processId) {
                  term.__connectionFailed = false;
                  currentProcessId.current = processId;

                  const previousProcessId = processCache[sessionKey];
                  if (previousProcessId) {
                    clearGeometryFor(previousProcessId, sessionKey);
                  }
                  processCache[sessionKey] = processId;
                  clearGeometryFor(processId, sessionKey);

                  const event = new CustomEvent("terminalProcessIdUpdated", {
                    detail: {
                      terminalId: sessionKey,
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
                    `[WebTerminal] Clearing old event listeners before rebinding for sessionKey=${sessionKey}, old count=${terminalDisposables.length}`,
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
                  observeMoshStatus(term, processId);

                  console.debug(
                    `[WebTerminal] Setting up command detection for sessionKey=${sessionKey}, processId=${processId}`,
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
                  term.__connectionFailed = true;
                }
              })
              .catch((error) => {
                if (terminalCache[sessionKey] !== term) {
                  return;
                }
                term.__connectionFailed = true;
                term.writeln(formatConnectionError(error));
              });
          } catch (error) {
            term.__connectionFailed = true;
            term.writeln(formatConnectionError(error));
          }
        } else {
          term.writeln(tRef.current("webTerminal.runtime.welcome"));
          term.writeln(tRef.current("webTerminal.runtime.helpHint"));
          term.writeln("");
          term.write("$ ");

          setupSimulatedTerminal(term);
        }

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
          clearTerminalRef.current();
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
        lifecycleManager.addEventListener(terminalRef.current, "mouseup", (e) =>
          handleMouseUpRef.current(e),
        );
      }

      if (terminalRef.current) {
        lifecycleManager.addCleanup(
          attachTerminalSelection(term, terminalRef.current),
        );
        lifecycleManager.addEventListener(
          terminalRef.current,
          "contextmenu",
          (event) => handleContextMenuRef.current(event),
          { capture: true },
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
    markTerminalContentUpdated,
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
