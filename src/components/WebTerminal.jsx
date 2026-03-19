import React, { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import "@xterm/xterm/css/xterm.css";
import "./WebTerminal.css";
import { debounce, createResizeObserver } from "../core/utils/performance.js";
import { useEventManager } from "../core/utils/eventManager.js";
import { useTerminalRender } from "../hooks/useTerminalRender.js";
import { useTerminalSearch } from "../hooks/useTerminalSearch.js";
import { useTerminalSuggestions } from "../hooks/useTerminalSuggestions.js";
import { useTerminalInputSync } from "../hooks/useTerminalInputSync.js";
import { TerminalPerformanceMonitor } from "../utils/TerminalPerformanceMonitor.js";
import { ScrollbackUsageTracker } from "../utils/ScrollbackUsageTracker.js";
import PropTypes from "prop-types";
import CommandSuggestion from "./CommandSuggestion";
import WebTerminalSearchOverlay from "./web-terminal/WebTerminalSearchOverlay.jsx";
import WebTerminalContextMenu from "./web-terminal/WebTerminalContextMenu.jsx";
import { RendererTerminalIOMailbox } from "../modules/terminal/io/RendererTerminalIOMailbox.js";
import { isPromptReadyFromTerminal } from "../modules/terminal/promptDetection.js";
import {
  TERMINAL_RESIZE_QUERY_REGEX,
  ensureSharedTerminalStyles,
  getCharacterMetricsCss,
  isCtrlLeftMouseClick,
  searchBarStyles,
  syncTerminalLinkCtrlState,
  terminalStyles,
} from "../modules/terminal/controller/terminalDom.js";
import {
  clearGeometryFor,
  disposablesCache,
  fitAddonCache,
  forceResizeTerminal,
  processCache,
  registerTerminalIOMailbox,
  sendResizeIfNeeded,
  terminalCache,
  unregisterTerminalIOMailbox,
} from "../modules/terminal/controller/terminalSessionStore.js";
import {
  COMMENT_LINE_SEND_INTERVAL_MS,
  INPUT_SEND_CHUNK_SIZE,
  INPUT_SEND_FRAME_DELAY_MS,
  INPUT_SEND_MAX_CHUNKS_PER_FRAME,
  processMultilineInput,
  shouldChunkInputPayload,
} from "../modules/terminal/controller/terminalInput.js";

const getTerminalConfigSignature = (config) => {
  if (!config) return "__NO_CONFIG__";

  return [
    config.id || "",
    config.connectionId || "",
    config.host || "",
    config.port || "",
    config.username || "",
    config.protocol || "ssh",
    config.authType || "",
    config.privateKeyPath || "",
    config.splitReconnect ? "1" : "0",
  ].join("|");
};

const areWebTerminalPropsEqual = (prevProps, nextProps) => {
  if (prevProps.tabId !== nextProps.tabId) return false;
  if (prevProps.refreshKey !== nextProps.refreshKey) return false;
  if (prevProps.isActive !== nextProps.isActive) return false;

  return (
    getTerminalConfigSignature(prevProps.sshConfig) ===
    getTerminalConfigSignature(nextProps.sshConfig)
  );
};

const TERMINAL_COMMAND_LINE_REGEX =
  /(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w/.]+[$#>])\s*(.+)$/;
const FULLSCREEN_COMMAND_REGEX =
  /\b(top|htop|vi|vim|nano|less|more|watch|tail -f)\b/;

const createPromptTrackingState = () => ({
  promptReady: false,
  commandRunning: false,
});

const isCursorInsideWrappedInputBlock = (term) => {
  const buffer = term?.buffer?.active;
  if (!buffer) {
    return false;
  }

  const currentLine = buffer.getLine(buffer.cursorY);
  if (currentLine?.isWrapped) {
    return true;
  }

  if (buffer.cursorY <= 0) {
    return false;
  }

  const previousLine = buffer.getLine(buffer.cursorY - 1);
  return previousLine?.isWrapped === true;
};

const clearPendingWrappedInputRefresh = (term) => {
  if (!term) {
    return;
  }

  term.__pendingWrappedInputRefresh = false;
};

const shouldForceTerminalViewportRefresh = (term, inEditorMode = false) => {
  if (!term || inEditorMode || term.buffer?.active?.type === "alternate") {
    return false;
  }

  return term.__pendingWrappedInputRefresh === true;
};

const WebTerminal = ({
  tabId,
  refreshKey,
  sshConfig = null,
  isActive = true,
}) => {
  const terminalRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const currentProcessId = useRef(null);

  // 性能优化相关 refs
  const performanceMonitorRef = useRef(null);
  const scrollbackUsageTrackerRef = useRef(null);
  const terminalIOMailboxRef = useRef(null);

  const theme = useTheme();
  const eventManager = useEventManager(); // 使用统一的事件管理器
  const lifecycleEventManager = useEventManager(); // 生命周期重资源单独管理
  // 添加内容更新标志，用于跟踪终端内容是否有更新
  const [contentUpdated, setContentUpdated] = useState(false);
  const [webglRendererEnabled, setWebglRendererEnabled] = useState(true);
  const [, setPerformanceStats] = useState(null);

  // 添加最近粘贴时间引用，用于防止重复粘贴
  const lastPasteTimeRef = useRef(0);
  const inputQueueRef = useRef([]);
  const inputQueueBytesRef = useRef(0);
  const inputQueueDrainHandleRef = useRef(null);
  const inputQueueDrainHandleTypeRef = useRef(null);
  const webglRendererEnabledRef = useRef(true);
  const isActiveRef = useRef(isActive);

  useEffect(() => {
    isActiveRef.current = isActive;
  }, [isActive]);

  // 当前 tab 变为激活状态时，强制让终端获得键盘焦点
  useEffect(() => {
    if (!isActive || !termRef.current) return;

    const timer = setTimeout(() => {
      try {
        if (termRef.current && typeof termRef.current.focus === "function") {
          termRef.current.focus();
        }
      } catch {
        // ignore focus errors
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isActive, tabId]);

  // 标签切换事件触发时，对应 tab 的终端再做一轮聚焦兜底
  useEffect(() => {
    const handleTabFocus = (event) => {
      const detail = event.detail || {};
      if (detail.tabId !== tabId) return;
      if (!termRef.current) return;

      setTimeout(() => {
        try {
          if (termRef.current && typeof termRef.current.focus === "function") {
            termRef.current.focus();
          }
        } catch {
          // ignore focus errors
        }
      }, 50);
    };

    window.addEventListener("tabChanged", handleTabFocus);
    return () => window.removeEventListener("tabChanged", handleTabFocus);
  }, [tabId]);

  useEffect(() => {
    let isActive = true;

    const loadRendererPreference = async () => {
      try {
        if (window.terminalAPI?.loadUISettings) {
          const settings = await window.terminalAPI.loadUISettings();
          const enabled = settings?.performance?.webglEnabled !== false;
          if (isActive) {
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
      isActive = false;
    };
  }, []);

  const {
    scheduleHighlightRefresh,
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

  const sendInputToProcess = useCallback((processId, input) => {
    if (
      processId === undefined ||
      processId === null ||
      input === undefined ||
      input === null
    ) {
      return;
    }

    const inputStr = typeof input === "string" ? input : input.toString();
    if (!inputStr) {
      return;
    }

    const mailbox = terminalIOMailboxRef.current;
    if (mailbox && String(mailbox.getProcessId()) === String(processId)) {
      mailbox.sendInput(inputStr);
      return;
    }

    if (window.terminalAPI?.sendToProcess) {
      window.terminalAPI.sendToProcess(processId, inputStr);
    }
  }, []);

  const cancelInputQueueDrain = useCallback(() => {
    if (inputQueueDrainHandleRef.current === null) {
      return;
    }

    if (
      inputQueueDrainHandleTypeRef.current === "raf" &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(inputQueueDrainHandleRef.current);
    } else {
      clearTimeout(inputQueueDrainHandleRef.current);
    }

    inputQueueDrainHandleRef.current = null;
    inputQueueDrainHandleTypeRef.current = null;
  }, []);

  const scheduleInputQueueDrain = useCallback(() => {
    if (inputQueueDrainHandleRef.current !== null) {
      return;
    }

    const runDrain = () => {
      inputQueueDrainHandleRef.current = null;
      inputQueueDrainHandleTypeRef.current = null;

      const queue = inputQueueRef.current;
      if (!queue.length) {
        return;
      }

      let processedChunks = 0;
      while (
        queue.length > 0 &&
        processedChunks < INPUT_SEND_MAX_CHUNKS_PER_FRAME
      ) {
        const chunkItem = queue.shift();
        if (!chunkItem) {
          continue;
        }

        inputQueueBytesRef.current = Math.max(
          0,
          inputQueueBytesRef.current - chunkItem.input.length,
        );
        sendInputToProcess(chunkItem.processId, chunkItem.input);
        processedChunks += 1;
      }

      if (queue.length > 0) {
        scheduleInputQueueDrain();
      }
    };

    if (
      INPUT_SEND_FRAME_DELAY_MS <= 16 &&
      typeof requestAnimationFrame === "function"
    ) {
      inputQueueDrainHandleTypeRef.current = "raf";
      inputQueueDrainHandleRef.current = requestAnimationFrame(runDrain);
      return;
    }

    inputQueueDrainHandleTypeRef.current = "timeout";
    inputQueueDrainHandleRef.current = setTimeout(
      runDrain,
      INPUT_SEND_FRAME_DELAY_MS,
    );
  }, [sendInputToProcess]);

  const enqueueInputToProcess = useCallback(
    (processId, input, options = {}) => {
      if (
        processId === undefined ||
        processId === null ||
        input === undefined ||
        input === null
      ) {
        return;
      }

      const inputStr = typeof input === "string" ? input : input.toString();
      if (!inputStr) {
        return;
      }

      const forceChunk = options.forceChunk === true;
      const chunkSize = Math.max(
        256,
        Math.floor(Number(options.chunkSize) || INPUT_SEND_CHUNK_SIZE),
      );
      const hasPendingQueue = inputQueueRef.current.length > 0;
      const shouldChunk =
        forceChunk || hasPendingQueue || shouldChunkInputPayload(inputStr);

      if (!shouldChunk) {
        sendInputToProcess(processId, inputStr);
        return;
      }

      for (let offset = 0; offset < inputStr.length; offset += chunkSize) {
        const chunk = inputStr.slice(offset, offset + chunkSize);
        inputQueueRef.current.push({ processId, input: chunk });
        inputQueueBytesRef.current += chunk.length;
      }

      scheduleInputQueueDrain();
    },
    [scheduleInputQueueDrain, sendInputToProcess],
  );

  const sendCommentLinesToProcess = useCallback(
    (processId, lines) => {
      if (!Array.isArray(lines) || lines.length === 0) {
        return;
      }

      let currentIndex = 0;
      const sendNextLine = () => {
        if (currentIndex >= lines.length) {
          return;
        }

        const line = lines[currentIndex] || "";
        const chunk = `${line}${currentIndex < lines.length - 1 ? "\n" : ""}`;
        enqueueInputToProcess(processId, chunk, { forceChunk: true });
        currentIndex += 1;

        if (currentIndex < lines.length) {
          eventManager.setTimeout(sendNextLine, COMMENT_LINE_SEND_INTERVAL_MS);
        }
      };

      sendNextLine();
    },
    [enqueueInputToProcess, eventManager],
  );

  const sendProcessedInputToProcess = useCallback(
    (processId, processedInput, options = {}) => {
      if (
        processId === undefined ||
        processId === null ||
        processedInput === undefined ||
        processedInput === null
      ) {
        return;
      }

      if (
        processedInput &&
        typeof processedInput === "object" &&
        processedInput.type === "multiline-with-comments"
      ) {
        sendCommentLinesToProcess(processId, processedInput.lines);
        return;
      }

      enqueueInputToProcess(processId, processedInput, options);
    },
    [enqueueInputToProcess, sendCommentLinesToProcess],
  );

  const markPasteIfAllowed = useCallback(() => {
    const now = Date.now();
    if (now - lastPasteTimeRef.current < 100) {
      return false;
    }

    lastPasteTimeRef.current = now;
    return true;
  }, []);

  const handlePasteText = useCallback(
    (text, options = {}) => {
      const processId = processCache[tabId];
      if (!text || !processId) {
        return;
      }

      // 粘贴时隐藏建议，减少额外渲染与计算
      setShowSuggestions(false);
      setSuggestions([]);
      setCurrentInput("");
      setSuggestionsHiddenByEsc(false);

      // 使用预处理函数处理多行文本，防止注释和缩进问题
      const processedText = processMultilineInput(text);
      sendProcessedInputToProcess(processId, processedText, {
        ...options,
        forceChunk: true,
      });
    },
    [sendProcessedInputToProcess, tabId],
  );

  const { broadcastInputToGroup } = useTerminalInputSync({
    tabId,
    enqueueInputToProcess,
    termRef,
    eventManager,
  });

  // 优化：使用ref追踪内容更新状态，避免频繁的React状态更新
  const contentUpdatedRef = useRef(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedText, setSelectedText] = useState("");
  const searchAddonRef = useRef(null);
  const [inEditorMode, setInEditorMode] = useState(false);

  // 命令执行状态跟踪
  const [isCommandExecuting, setIsCommandExecuting] = useState(false);
  const [isShellPromptReady, setIsShellPromptReady] = useState(false);
  const lastExecutedCommandTimeRef = useRef(0);
  const lastExecutedCommandRef = useRef("");
  const promptTrackingStateRef = useRef(createPromptTrackingState());
  const pendingCommandBoundaryRef = useRef({
    command: "",
    capturedAt: 0,
  });

  const {
    showSearchBar,
    searchTerm,
    searchResults,
    noMatchFound,
    setSearchTerm,
    handleSearch,
    handleSearchPrevious,
    openSearchBar,
    closeSearchBar,
    toggleSearchBar,
  } = useTerminalSearch({
    searchAddonRef,
    termRef,
    isActive,
  });

  const {
    suggestions,
    setSuggestions,
    showSuggestions,
    setShowSuggestions,
    cursorPosition,
    currentInput,
    setCurrentInput,
    suggestionsHiddenByEsc,
    setSuggestionsHiddenByEsc,
    suggestionsSuppressedUntilEnter,
    setSuggestionsSuppressedUntilEnter,
    suppressionContextRef,
    suggestionsSuppressedRef,
    suggestionSelectedRef,
    getSuggestions,
    updateCursorPosition,
    handleSuggestionSelect,
    closeSuggestions,
  } = useTerminalSuggestions({
    tabId,
    termRef,
    terminalRef,
    inEditorMode,
    isCommandExecuting,
    lastExecutedCommandRef,
    lastExecutedCommandTimeRef,
    sendInputToProcess,
  });

  const inEditorModeRef = useRef(false);

  useEffect(() => {
    inEditorModeRef.current = inEditorMode;
  }, [inEditorMode]);

  const applyPromptTrackingState = useCallback((nextState = {}) => {
    const state = promptTrackingStateRef.current;
    let promptReadyChanged = false;
    let commandRunningChanged = false;

    if (
      typeof nextState.promptReady === "boolean" &&
      state.promptReady !== nextState.promptReady
    ) {
      state.promptReady = nextState.promptReady;
      promptReadyChanged = true;
    }

    if (
      typeof nextState.commandRunning === "boolean" &&
      state.commandRunning !== nextState.commandRunning
    ) {
      state.commandRunning = nextState.commandRunning;
      commandRunningChanged = true;
    }

    if (promptReadyChanged) {
      setIsShellPromptReady(state.promptReady);
    }

    if (promptReadyChanged || commandRunningChanged) {
      setIsCommandExecuting(state.commandRunning && !state.promptReady);
    }
  }, []);

  const resetPromptTracking = useCallback(() => {
    promptTrackingStateRef.current = createPromptTrackingState();
    pendingCommandBoundaryRef.current = {
      command: "",
      capturedAt: 0,
    };
    clearPendingWrappedInputRefresh(termRef.current);

    setIsShellPromptReady(false);
    setIsCommandExecuting(false);
  }, []);

  const commitExecutedCommand = useCallback(() => {
    const pendingCommand = pendingCommandBoundaryRef.current?.command || "";
    const command = pendingCommand.trim();
    if (!command || inEditorModeRef.current) {
      return;
    }

    const now = Date.now();
    const isNearDuplicate =
      command === lastExecutedCommandRef.current &&
      now - lastExecutedCommandTimeRef.current < 300;
    if (isNearDuplicate) {
      return;
    }

    lastExecutedCommandRef.current = command;
    lastExecutedCommandTimeRef.current = now;

    if (
      !suggestionSelectedRef.current &&
      window.terminalAPI?.addToCommandHistory
    ) {
      window.terminalAPI.addToCommandHistory(command);
    }
  }, [suggestionSelectedRef]);

  const syncPromptTrackingFromTerminal = useCallback(
    (term) => {
      if (!term) {
        return;
      }

      const promptReady = isPromptReadyFromTerminal(term);
      if (promptReady) {
        clearPendingWrappedInputRefresh(term);
        applyPromptTrackingState({
          promptReady: true,
          commandRunning: false,
        });
        return;
      }

      applyPromptTrackingState({ promptReady: false });
    },
    [applyPromptTrackingState],
  );

  // 优化的选择元素调整函数 - 避免重复高亮
  const adjustSelectionElements = () => {
    if (!termRef.current) return;

    try {
      // 获取终端DOM元素
      const terminalElement = termRef.current.element;
      if (!terminalElement) return;

      // 获取所有选择相关元素
      const selectionElements = terminalElement.querySelectorAll(
        ".xterm-selection div",
      );

      // 如果没有选择元素，直接返回
      if (selectionElements.length === 0) return;

      // 彻底处理重复的选择元素
      if (selectionElements.length > 1) {
        // 保留第一个元素，彻底隐藏其他重复元素
        selectionElements.forEach((elem, index) => {
          if (index > 0) {
            // 使用多种方式彻底隐藏重复元素
            elem.style.display = "none";
            elem.style.opacity = "0";
            elem.style.visibility = "hidden";
            elem.style.pointerEvents = "none";
            // 添加标记类以便CSS规则识别
            elem.classList.add("xterm-selection-duplicate");
          } else {
            // 确保第一个元素完全可见
            elem.style.display = "";
            elem.style.opacity = "1";
            elem.style.visibility = "visible";
            elem.classList.remove("xterm-selection-duplicate");
          }
        });
      }

      // 同时检查是否有多个选择容器
      const allSelectionContainers =
        terminalElement.querySelectorAll(".xterm-selection");
      if (allSelectionContainers.length > 1) {
        allSelectionContainers.forEach((container, index) => {
          if (index > 0) {
            container.style.display = "none";
            container.style.opacity = "0";
            container.style.visibility = "hidden";
          }
        });
      }

      // 只对第一个（主要的）选择元素进行调整
      const primaryElement = selectionElements[0];
      if (!primaryElement) return;

      // 获取字符度量信息
      const metrics = getCharacterMetricsCss(termRef.current);
      if (!metrics) return;

      // 获取选择元素的当前位置
      const computedStyle = window.getComputedStyle(primaryElement);
      const currentLeft = parseFloat(computedStyle.left) || 0;
      const currentTop = parseFloat(computedStyle.top) || 0;
      const currentWidth = parseFloat(computedStyle.width) || 0;

      // 计算需要的偏移量
      const leftOffset =
        (currentLeft - metrics.screenOffset.x) % metrics.charWidth;
      const topOffset =
        (currentTop - metrics.screenOffset.y) % metrics.charHeight;

      // 计算更精确的调整值
      let adjustX = 0;
      let adjustY = 0;

      // 判断是否需要调整X轴
      if (Math.abs(leftOffset) > 0.5) {
        // 如果偏移接近字符宽度，则对齐到下一个字符位置
        if (Math.abs(metrics.charWidth - leftOffset) < 1.5) {
          adjustX = metrics.charWidth - leftOffset;
        } else {
          // 否则对齐到当前字符位置
          adjustX = -leftOffset;
        }
      }

      // 判断是否需要调整Y轴
      if (Math.abs(topOffset) > 0.5) {
        // 如果偏移接近字符高度，则对齐到下一行
        if (Math.abs(metrics.charHeight - topOffset) < 1.5) {
          adjustY = metrics.charHeight - topOffset;
        } else {
          // 否则对齐到当前行
          adjustY = -topOffset;
        }
      }

      // 仅在需要调整时应用变换
      if (Math.abs(adjustX) > 0.5 || Math.abs(adjustY) > 0.5) {
        primaryElement.style.transform = `translate(${adjustX}px, ${adjustY}px)`;
        primaryElement.style.willChange = "transform";
      } else {
        // 如果不需要调整，清除变换
        primaryElement.style.transform = "";
        primaryElement.style.willChange = "";
      }

      // 确保选择元素的宽度是字符宽度的整数倍
      if (currentWidth > 0) {
        const widthInChars = Math.round(currentWidth / metrics.charWidth);
        const idealWidth = widthInChars * metrics.charWidth;
        const widthDifference = idealWidth - currentWidth;

        // 如果宽度差异较大，应用宽度调整
        if (Math.abs(widthDifference) > 1) {
          primaryElement.style.width = `${idealWidth}px`;
        }
      }
    } catch {
      // 选择元素调整失败，简化的回退处理 - 清理所有transform
      const selectionElements = document.querySelectorAll(
        ".xterm .xterm-selection div",
      );
      selectionElements.forEach((elem) => {
        elem.style.transform = "";
        elem.style.willChange = "";
        elem.style.opacity = "";
      });
    }
  };

  // 简化的选择监控 - 只在选择完成后进行调整
  const lastSelectionAdjustmentRef = useRef(0);
  const scheduleSelectionAdjustment = () => {
    // 节流：防止过于频繁的调整
    const now = Date.now();
    if (now - lastSelectionAdjustmentRef.current < 100) {
      return; // 100ms内不重复调整
    }
    lastSelectionAdjustmentRef.current = now;

    // 使用EventManager管理定时器
    eventManager.setTimeout(() => {
      requestAnimationFrame(adjustSelectionElements);
    }, 100); // 适当延迟以减少调整频率
  };

  // 添加选择事件监听，确保在用户通过键盘选择时也能调整选择区域
  const handleSelectionChange = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      // 只有当选择发生在终端内部时才进行调整
      const isInTerminal =
        selection.anchorNode &&
        termRef.current &&
        termRef.current.element &&
        (termRef.current.element.contains(selection.anchorNode) ||
          termRef.current.element.contains(selection.focusNode));

      if (isInTerminal) {
        scheduleSelectionAdjustment();
      }
    }
  };

  // 添加鼠标中键粘贴功能
  const handleMouseDown = (e) => {
    syncTerminalLinkCtrlState(termRef.current, e.ctrlKey);

    // 鼠标中键点击 (e.button === 1 表示鼠标中键)
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation(); // 阻止同一元素上的其他监听器执行

      // 检查是否是重复粘贴（100毫秒内的操作视为重复）
      if (!markPasteIfAllowed()) {
        // 忽略短时间内的重复粘贴请求
        return;
      }

      window.clipboardAPI.readText().then((text) => {
        handlePasteText(text);
      });
    }

    // 在mousedown时记录选择开始，帮助确保选择行为的准确性
    if (e.button === 0 && termRef.current) {
      // 左键点击 - 标记选择开始
      const isTextSelection =
        e.target &&
        (e.target.closest(".xterm-screen") ||
          e.target.closest(".terminal-container"));

      // 如果是在终端内容区点击，准备进行选择操作
      if (isTextSelection) {
        // 立即调整一次，确保初始选择状态正确
        setTimeout(() => {
          adjustSelectionElements();
        }, 0);
      }
    }
  };

  // 简化的鼠标事件处理 - 减少频繁调整
  const handleMouseMove = (e) => {
    syncTerminalLinkCtrlState(termRef.current, e.ctrlKey);

    // 检测是否正在进行选择操作
    if (e.buttons === 1) {
      // 左键按下
      const isTextSelection = window.getSelection()?.toString()?.length > 0;
      if (isTextSelection && termRef.current) {
        // 延迟调整选择，避免频繁调整影响性能
        // 不需要做任何操作，将在mouseup时进行调整
      }
    }
  };

  const handleMouseUp = (e) => {
    syncTerminalLinkCtrlState(termRef.current, e.ctrlKey);

    // 鼠标释放时进行一次性选择区域调整
    if (termRef.current) {
      const selection = window.getSelection?.();
      const hasSelection = selection && selection.toString().length > 0;

      // 只有当确实存在选中文本时才进行调整
      if (hasSelection) {
        // 使用调度函数进行延迟调整
        scheduleSelectionAdjustment();

        // 额外添加一个延时调整，处理某些浏览器选择完成后的渲染延迟
        setTimeout(() => {
          adjustSelectionElements();
        }, 150);
      }
    }
  };

  // 定义检测用户输入命令的函数，用于监控特殊命令执行
  const setupCommandDetection = (
    term,
    processId,
    isRemoteInput = false,
    disposables = [],
  ) => {
    console.debug(
      `[setupCommandDetection] Starting for processId=${processId}, isRemoteInput=${isRemoteInput}, disposables.length=${disposables.length}`,
    );

    // 用于存储用户正在输入的命令
    let currentInputBuffer = "";
    // 标记上一个按键是否是特殊键序列的开始
    let isEscapeSequence = false;
    // 用于存储转义序列
    // 跟踪编辑器模式状态
    let inEditorMode = false;
    // 标记是否刚刚使用了Tab补全
    let tabCompletionUsed = false;
    // 用于临时存储当前行位置和内容，以便在Tab补全后能恢复正确位置
    let currentLineBeforeTab = null;

    // 识别编辑器命令的正则表达式
    const editorCommandRegex =
      /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;
    const extractCommand = (line) => {
      const normalizedLine =
        typeof line === "string" ? line : line?.toString?.() || "";
      const commandMatch = normalizedLine.match(TERMINAL_COMMAND_LINE_REGEX);

      if (commandMatch && commandMatch[1] && commandMatch[1].trim() !== "") {
        return commandMatch[1].trim();
      }

      if (currentInputBuffer.trim() !== "") {
        return currentInputBuffer.trim();
      }

      return "";
    };

    const syncPromptState = () => {
      if (inEditorMode) {
        applyPromptTrackingState({ promptReady: false });
        return;
      }

      if (
        !promptTrackingStateRef.current.commandRunning &&
        currentInputBuffer.trim() !== ""
      ) {
        applyPromptTrackingState({
          promptReady: true,
          commandRunning: false,
        });
        return;
      }

      syncPromptTrackingFromTerminal(term);
    };

    // 添加buffer类型监听，用于检测编辑器模式
    // xterm.js在全屏应用（如vi）运行时会切换到alternate buffer
    const bufferTypeObserver = {
      handleBufferTypeChange: (type) => {
        if (type === "alternate") {
          // 进入编辑器/全屏应用模式
          inEditorMode = true;
          clearPendingWrappedInputRefresh(term);
          applyPromptTrackingState({ promptReady: false });
          setInEditorMode(true);

          // 通知主进程编辑器模式状态变更
          if (processId && window.terminalAPI?.notifyEditorModeChange) {
            window.terminalAPI.notifyEditorModeChange(processId, true);
          }

          // 隐藏命令建议
          setShowSuggestions(false);
          setSuggestions([]);
        } else if (type === "normal") {
          // 退出编辑器/全屏应用模式
          clearPendingWrappedInputRefresh(term);
          if (inEditorMode) {
            inEditorMode = false;
            setInEditorMode(false);

            // 通知主进程编辑器模式状态变更
            if (processId && window.terminalAPI?.notifyEditorModeChange) {
              window.terminalAPI.notifyEditorModeChange(processId, false);
            }
          }
          syncPromptState();
        }
      },
    };

    // 存储事件监听器的 disposables 以便清理
    // 使用传入的 disposables 数组

    // 监听buffer类型变化
    if (term.buffer && typeof term.buffer.onBufferChange === "function") {
      // 如果xterm.js版本支持此方法
      const bufferDisposable = term.buffer.onBufferChange(() => {
        bufferTypeObserver.handleBufferTypeChange(term.buffer.active.type);
      });
      if (bufferDisposable && typeof bufferDisposable.dispose === "function") {
        disposables.push(bufferDisposable);
      }

      // 初始检查当前buffer类型
      bufferTypeObserver.handleBufferTypeChange(term.buffer.active.type);
    }

    // 监听终端数据输出，用于检测编辑器特征
    const onDataDisposable = term.onData((data) => {
      // 添加调试日志
      if (data && data.length > 0) {
        // console.log("[onData]", JSON.stringify(data), "processId=", processId);
      }
      const canTrackPromptInput =
        promptTrackingStateRef.current.promptReady &&
        !promptTrackingStateRef.current.commandRunning;

      if (
        canTrackPromptInput &&
        !inEditorMode &&
        (data === "\b" || data === "\x7f" || data === "\x03") &&
        isCursorInsideWrappedInputBlock(term)
      ) {
        term.__pendingWrappedInputRefresh = true;
      }

      // 输入阶段只触发渲染层刷新，避免通过额外写入污染终端缓冲区
      scheduleHighlightRefresh(term);

      // 检查是否正在处理外部命令
      let shouldSkipSendToProcess = false;
      if (term._externalCommand) {
        const extCmd = term._externalCommand;
        // 检查当前字符是否匹配外部命令的对应位置
        if (extCmd.processedLength < extCmd.totalLength) {
          const expectedChar = extCmd.command[extCmd.processedLength];
          if (data === expectedChar) {
            // 匹配外部命令，跳过发送到进程
            shouldSkipSendToProcess = true;
            extCmd.processedLength++;

            // 如果外部命令完全处理完毕，清理标记
            if (extCmd.processedLength >= extCmd.totalLength) {
              delete term._externalCommand;
            }
          } else {
            // 不匹配，说明不是外部命令或者有用户输入，清理标记
            delete term._externalCommand;
          }
        }
      }

      // 回环防护：远程同步输入不再广播
      if (!isRemoteInput) {
        broadcastInputToGroup(data, tabId);
      }

      // 粘贴或批量输入快速通道：跳过逐键分析，分片发送避免主线程阻塞
      if (
        typeof data === "string" &&
        (shouldChunkInputPayload(data) ||
          (data.includes("\u001b[200~") && data.includes("\u001b[201~")))
      ) {
        currentInputBuffer = "";
        setCurrentInput("");
        setShowSuggestions(false);
        setSuggestions([]);
        if (processId && !shouldSkipSendToProcess) {
          enqueueInputToProcess(processId, data, { forceChunk: true });
        }
        return;
      }

      // 检查是否是ESC开头的转义序列（通常是方向键等特殊键）
      if (data === "\x1b") {
        isEscapeSequence = true;
        // 方向键等特殊键不会影响命令历史记录，直接发送到进程
        if (processId && !shouldSkipSendToProcess) {
          sendInputToProcess(processId, data);
        }
        return;
      }

      // 处理转义序列的后续字符
      if (isEscapeSequence) {
        // 检查是否是常见的转义序列结束符
        if (/[A-Za-z~]/.test(data)) {
          isEscapeSequence = false;
        }

        // 转义序列不会记录到命令历史，直接发送到进程
        if (processId && !shouldSkipSendToProcess) {
          sendInputToProcess(processId, data);
        }
        return;
      }

      // 处理退格键
      if (data === "\b" || data === "\x7f") {
        // 只有在非Tab补全状态下才处理退格
        if (
          canTrackPromptInput &&
          !tabCompletionUsed &&
          currentInputBuffer.length > 0
        ) {
          currentInputBuffer = currentInputBuffer.slice(0, -1);

          // 实时更新光标位置
          setTimeout(() => {
            if (typeof updateCursorPosition === "function") {
              updateCursorPosition();
            }
          }, 10); // 10ms延迟确保终端已处理退格

          // 更新当前输入状态并触发建议搜索
          if (!inEditorMode) {
            setCurrentInput(currentInputBuffer);

            // 只有在非命令执行状态下才触发建议搜索
            if (
              !suggestionsHiddenByEsc &&
              !suggestionsSuppressedUntilEnter &&
              !isCommandExecuting
            ) {
              getSuggestions(currentInputBuffer);
            }
            if (currentInputBuffer.length === 0) {
              setSuggestionsHiddenByEsc(false);
              setSuggestionsSuppressedUntilEnter(false);
            }
          }
        }
        // 发送数据到进程
        if (processId && !shouldSkipSendToProcess) {
          sendInputToProcess(processId, data);
        }
        return;
      }

      // 处理Tab键，标记Tab补全被使用
      if (data === "\t") {
        if (canTrackPromptInput) {
          tabCompletionUsed = true;
          // 清空当前输入缓冲区，避免记录不完整的命令
          currentInputBuffer = "";

          // 存储当前行内容，以便于之后获取Tab补全后的完整命令
          currentLineBeforeTab = {
            y: term.buffer.active.cursorY,
            content:
              term.buffer.active
                .getLine(term.buffer.active.cursorY)
                ?.translateToString() || "",
          };

          // 隐藏命令建议窗口（因为用户在使用原生Tab补全）
          if (!inEditorMode) {
            setShowSuggestions(false);
            setSuggestions([]);
            setCurrentInput("");
            setSuggestionsHiddenByEsc(false);
            // 解除因手动关闭而设置的抑制，仅在回车时恢复
            setSuggestionsSuppressedUntilEnter(false);
          }
        }

        // 发送数据到进程
        if (processId && !shouldSkipSendToProcess) {
          sendInputToProcess(processId, data);
        }

        // 重要：阻止xterm.js的默认Tab处理，避免重复显示
        // 通过不继续执行后续逻辑来防止重复处理
        return;
      }

      // 检测回车键（命令执行的触发）
      if (data === "\r" || data === "\n") {
        // 如果这是外部命令的回车字符，跳过所有处理
        if (shouldSkipSendToProcess) {
          return;
        }

        clearPendingWrappedInputRefresh(term);

        if (!canTrackPromptInput) {
          currentInputBuffer = "";
          setCurrentInput("");
          if (processId) {
            sendInputToProcess(processId, data);
          }
          return;
        }

        // 回车进入新一行：解除因 ESC 或手动关闭导致的抑制，允许下一次正常输入时显示建议
        setSuggestionsHiddenByEsc(false);
        setSuggestionsSuppressedUntilEnter(false);

        try {
          // 获取终端的最后一行内容（可能包含用户输入的命令）
          const lastLine =
            term.buffer.active
              .getLine(term.buffer.active.cursorY)
              ?.translateToString() || "";

          // 特殊处理：如果使用了Tab补全，直接使用当前行的完整内容
          let command = extractCommand(lastLine);
          if (tabCompletionUsed) {
            command = extractCommand(lastLine);
          }

          // 检测是否进入了编辑器模式（备用模式。确保能够实施resize）
          // 只有在不支持buffer类型检测时才使用命令识别
          if (
            command &&
            editorCommandRegex.test(command) &&
            (!term.buffer || typeof term.buffer.onBufferChange !== "function")
          ) {
            inEditorMode = true;

            // 通知主进程编辑器模式状态变更
            if (processId && window.terminalAPI?.notifyEditorModeChange) {
              window.terminalAPI.notifyEditorModeChange(processId, true);
            }
          }

          pendingCommandBoundaryRef.current = {
            command,
            capturedAt: Date.now(),
          };

          // 重置Tab补全状态（立即重置，因为已经处理完命令）
          tabCompletionUsed = false;
          currentLineBeforeTab = null;

          // 重置当前输入缓冲区
          currentInputBuffer = "";

          // 重置建议选择标记
          suggestionSelectedRef.current = false;

          // 隐藏命令建议
          setShowSuggestions(false);
          setSuggestions([]);
          setCurrentInput("");
          setSuggestionsHiddenByEsc(false);
          applyPromptTrackingState({
            promptReady: false,
            commandRunning: true,
          });
          commitExecutedCommand();
          pendingCommandBoundaryRef.current = {
            command: "",
            capturedAt: 0,
          };

          // 检查这一行是否包含常见的全屏应用命令
          if (FULLSCREEN_COMMAND_REGEX.test(lastLine)) {
            // 使用EventManager管理延迟序列触发终端大小调整
            const delayTimes = [200, 500, 1000, 1500];
            delayTimes.forEach((delay) => {
              eventManager.setTimeout(() => {
                if (terminalRef.current && fitAddonRef.current) {
                  // 强制设置内容已更新，确保调整生效
                  setContentUpdated(true);
                  forceResizeTerminal(
                    term,
                    terminalRef.current,
                    processId,
                    tabId,
                    fitAddonRef.current,
                  );
                }
              }, delay);
            });
          }
        } catch {
          // 忽略任何错误，不影响正常功能
        }

        // 发送回车键到进程
        if (processId) {
          sendInputToProcess(processId, data);
        }
        return;
      } else if (data !== "\t") {
        // 对于非Tab键输入，只有在非Tab补全状态下才追加到输入缓冲区
        if (canTrackPromptInput && !tabCompletionUsed) {
          currentInputBuffer += data;
        }

        // 实时更新光标位置
        setTimeout(() => {
          if (typeof updateCursorPosition === "function") {
            updateCursorPosition();
          }
        }, 10); // 10ms延迟确保终端已处理输入

        // 更新当前输入状态并触发建议搜索（仅在普通字符输入时，且不在Tab补全状态）
        if (
          canTrackPromptInput &&
          !inEditorMode &&
          !tabCompletionUsed &&
          data.length === 1 &&
          data.charCodeAt(0) >= 32 &&
          data.charCodeAt(0) <= 126
        ) {
          setCurrentInput(currentInputBuffer);

          // 若用户在手动关闭后继续输入了新内容，则自动解除抑制
          if (suggestionsSuppressedRef.current) {
            try {
              const anchor = (
                suppressionContextRef.current?.input || ""
              ).trim();
              const nowInput = currentInputBuffer.trim();
              if (!anchor || nowInput.length === 0 || nowInput !== anchor) {
                setSuggestionsSuppressedUntilEnter(false);
                setSuggestionsHiddenByEsc(false);
              }
            } catch {
              /* intentionally ignored */
            }
          }

          // 只有在非命令执行状态下才触发建议搜索
          if (
            !suggestionsHiddenByEsc &&
            !suggestionsSuppressedUntilEnter &&
            !isCommandExecuting
          ) {
            getSuggestions(currentInputBuffer);
          }
        }
      }

      // 发送数据到进程（如果不是外部命令）
      if (processId && !shouldSkipSendToProcess) {
        sendInputToProcess(processId, data);
      }
    });

    // 添加输出监听，以检测编辑器退出（仅作为备用方法）
    const onLineFeedDisposable = term.onLineFeed(() => {
      // 当获得新的一行时，检查是否有shell提示符出现，这可能表示编辑器已退出
      // 注意：如果buffer类型检测可用，此方法是不必要的
      try {
        // 只在不支持buffer类型检测时使用此备用方法
        if (
          inEditorMode &&
          (!term.buffer || typeof term.buffer.onBufferChange !== "function")
        ) {
          // 检查最后几行，寻找shell提示符
          const linesCount = term.buffer.active.length;
          const lastRowsToCheck = Math.min(5, linesCount); // 检查最后5行

          for (let i = 0; i < lastRowsToCheck; i++) {
            const line =
              term.buffer.active
                .getLine(linesCount - 1 - i)
                ?.translateToString() || "";
            // 检查是否包含典型的shell提示符
            if (/(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w/.]+[$#>])\s*$/.test(line)) {
              inEditorMode = false;

              // 通知主进程编辑器模式状态变更
              if (processId && window.terminalAPI?.notifyEditorModeChange) {
                window.terminalAPI.notifyEditorModeChange(processId, false);
              }
              break;
            }
          }
        }

        syncPromptState();
      } catch {
        // 忽略任何错误，不影响正常功能
      }
    });

    if (
      onLineFeedDisposable &&
      typeof onLineFeedDisposable.dispose === "function"
    ) {
      disposables.push(onLineFeedDisposable);
    }

    // 添加终端数据处理监听，用于捕获Tab补全后的内容
    const onRenderDisposable = term.onRender(() => {
      // 如果使用了Tab补全并且有存储的之前行内容
      if (tabCompletionUsed && currentLineBeforeTab) {
        try {
          // 获取当前行内容，看是否有变化（可能是Tab补全导致的）
          const currentLine =
            term.buffer.active
              .getLine(term.buffer.active.cursorY)
              ?.translateToString() || "";
          const previousContent = currentLineBeforeTab.content;

          // 如果行内容发生了变化，可能是Tab补全生效了
          if (currentLine !== previousContent) {
            // 尝试提取命令部分（去除提示符）
            const commandMatch = currentLine.match(TERMINAL_COMMAND_LINE_REGEX);
            if (
              commandMatch &&
              commandMatch[1] &&
              commandMatch[1].trim() !== ""
            ) {
              // 更新当前输入缓冲区为Tab补全后的命令，用于后续回车时记录
              currentInputBuffer = commandMatch[1].trim();

              // 同时更新显示状态
              if (!inEditorMode) {
                setCurrentInput(currentInputBuffer);
              }
            }
          }

          // 延迟重置Tab补全状态，给足够时间处理补全
          setTimeout(() => {
            currentLineBeforeTab = null;
          }, 100);
        } catch {
          // 处理Tab补全后内容时出错
        }
      }

      syncPromptState();
    });

    if (
      onRenderDisposable &&
      typeof onRenderDisposable.dispose === "function"
    ) {
      disposables.push(onRenderDisposable);
    }

    const onWriteParsedDisposable = term.onWriteParsed(() => {
      scheduleHighlightRefresh(term);
      syncPromptState();
    });

    if (
      onWriteParsedDisposable &&
      typeof onWriteParsedDisposable.dispose === "function"
    ) {
      disposables.push(onWriteParsedDisposable);
    }

    // 添加 onData disposable 到列表
    if (onDataDisposable && typeof onDataDisposable.dispose === "function") {
      disposables.push(onDataDisposable);
    }
  };

  // 定义响应主题模式的终端主题
  const terminalTheme = {
    // 现代化背景色 - 深色更深，浅色更柔和
    background: theme.palette.mode === "light" ? "#f6f8fa" : "#1e1e1e",
    // 文本颜色 - 提高对比度
    foreground: theme.palette.mode === "light" ? "#24292f" : "#e6edf3",
    // 光标颜色 - 更醒目
    cursor: theme.palette.mode === "light" ? "#0969da" : "#58a6ff",
    cursorAccent: theme.palette.mode === "light" ? "#f3f4f6" : "#0d1117",
    // 选择高亮 - 优化可见度，日间和夜间模式下都有足够的对比度
    selectionBackground:
      theme.palette.mode === "light"
        ? "rgba(79, 126, 255, 0.43)"
        : "rgba(212, 253, 62, 0.49)",
    selectionForeground: undefined,
    // ANSI颜色 - 现代化配色方案（参考GitHub/VSCode主题）
    black: theme.palette.mode === "light" ? "#24292f" : "#484f58",
    red: theme.palette.mode === "light" ? "#cf222e" : "#ff7b72",
    green: theme.palette.mode === "light" ? "#116329" : "#3fb950",
    yellow: theme.palette.mode === "light" ? "#9a6700" : "#d29922",
    blue: theme.palette.mode === "light" ? "#0969da" : "#58a6ff",
    magenta: theme.palette.mode === "light" ? "#8250df" : "#bc8cff",
    cyan: theme.palette.mode === "light" ? "#1b7c83" : "#39c5cf",
    white: theme.palette.mode === "light" ? "#6e7781" : "#b1bac4",
    // 亮色版本 - 更高饱和度
    brightBlack: theme.palette.mode === "light" ? "#57606a" : "#6e7681",
    brightRed: theme.palette.mode === "light" ? "#d1242f" : "#ffa198",
    brightGreen: theme.palette.mode === "light" ? "#1a7f37" : "#56d364",
    brightYellow: theme.palette.mode === "light" ? "#bf8700" : "#e3b341",
    brightBlue: theme.palette.mode === "light" ? "#218bff" : "#79c0ff",
    brightMagenta: theme.palette.mode === "light" ? "#a371f7" : "#d2a8ff",
    brightCyan: theme.palette.mode === "light" ? "#3192aa" : "#56d4dd",
    brightWhite: theme.palette.mode === "light" ? "#8c959f" : "#f0f6fc",
  };

  // 根据字体名称生成完整的字体族字符串
  const getFontFamilyString = (fontName) => {
    const fontFamilyMap = {
      "Fira Code":
        '"Fira Code", "Consolas", "Monaco", "Courier New", monospace',
      "Space Mono":
        '"Space Mono", "Consolas", "Monaco", "Courier New", monospace',
      Consolas: '"Consolas", "Monaco", "Courier New", monospace',
    };
    return fontFamilyMap[fontName] || fontFamilyMap["Fira Code"];
  };

  // 获取存储的字体大小和字体族或使用默认值
  const getFontSettings = async () => {
    try {
      if (window.terminalAPI?.loadUISettings) {
        const settings = await window.terminalAPI.loadUISettings();
        const enabled = settings?.performance?.webglEnabled !== false;
        webglRendererEnabledRef.current = enabled;
        setWebglRendererEnabled(enabled);
        return {
          fontSize: settings.terminalFontSize || 14,
          fontFamily: getFontFamilyString(settings.terminalFont || "Fira Code"),
          fontWeight: settings.terminalFontWeight || 500,
        };
      }
    } catch {
      // Failed to load font settings from config
    }
    webglRendererEnabledRef.current = true;
    setWebglRendererEnabled(true);
    return {
      fontSize: 14,
      fontFamily: getFontFamilyString("Fira Code"),
      fontWeight: 500,
    };
  };

  // 如果refreshKey变化，清除缓存强制重新创建终端
  useEffect(() => {
    if (refreshKey && terminalCache[tabId]) {
      // 关闭旧的进程
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

      // 清除旧终端
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
        performance,
      } = event.detail;

      if (
        performance &&
        Object.prototype.hasOwnProperty.call(performance, "webglEnabled")
      ) {
        const enabled = performance.webglEnabled !== false;
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
        // 更新终端字体设置
        if (terminalFontSize !== undefined) {
          terminalCache[tabId].options.fontSize = parseInt(
            terminalFontSize,
            10,
          );
        }
        if (terminalFont !== undefined) {
          terminalCache[tabId].options.fontFamily =
            getFontFamilyString(terminalFont);
        }
        if (terminalFontWeight !== undefined) {
          terminalCache[tabId].options.fontWeight = parseInt(
            terminalFontWeight,
            10,
          );
        }

        // 使用EventManager管理定时器
        eventManager.setTimeout(() => {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit();

            // Canvas 渲染器需要手动刷新
            const cachedTerminal = terminalCache[tabId];
            if (
              cachedTerminal &&
              !cachedTerminal.__webglEnabled &&
              typeof cachedTerminal.refresh === "function"
            ) {
              cachedTerminal.refresh(0, cachedTerminal.rows - 1);
            }

            // 同步到后端进程
            const processId = processCache[tabId];
            if (processId) {
              if (cachedTerminal) {
                sendResizeIfNeeded(
                  processId,
                  tabId,
                  cachedTerminal.cols,
                  cachedTerminal.rows,
                );
              }
            }
          }
        }, 100);
      }
    };

    // 使用EventManager管理事件监听器
    const removeSettingsChangedListener = eventManager.addEventListener(
      window,
      "settingsChanged",
      handleSettingsChanged,
    );

    return () => {
      removeSettingsChangedListener();
    };
  }, [tabId, eventManager, disableWebglRenderer, tryEnableWebglRenderer]);

  useEffect(() => {
    // 为重资源初始化流程使用独立 EventManager，避免与轻量监听互相干扰
    const eventManager = lifecycleEventManager;
    eventManager.reset();

    // 添加全局样式
    const styleElement = ensureSharedTerminalStyles();
    if (styleElement.textContent !== terminalStyles + searchBarStyles) {
      styleElement.textContent = terminalStyles + searchBarStyles;
    }

    // 存储终端事件监听器的 disposables 以便清理
    // 使用缓存的disposables数组,如果不存在则创建新的
    if (!disposablesCache[tabId]) {
      disposablesCache[tabId] = [];
    }
    const terminalDisposables = disposablesCache[tabId];

    // 初始化 xterm.js
    if (terminalRef.current) {
      let term;
      let fitAddon;
      let searchAddon;

      // 检查缓存中是否已有此终端实例
      if (terminalCache[tabId]) {
        // 清理旧的事件监听器
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
          // 清空disposables数组但保留引用
          disposablesCache[tabId].length = 0;
        }

        // 使用缓存的终端实例
        term = terminalCache[tabId];
        fitAddon = fitAddonCache[tabId];

        console.debug(
          `[WebTerminal] Reusing cached terminal for tabId=${tabId}, processId=${processCache[tabId]}`,
        );

        // 当主题变化时，更新终端主题
        term.options.theme = terminalTheme;

        // 搜索插件需要重新创建
        searchAddon = new SearchAddon();
        term.loadAddon(searchAddon);

        // 重新打开终端并附加到DOM
        term.open(terminalRef.current);
        syncTerminalLinkCtrlState(term, false);

        // 确保 Alt+F1 快捷键能冒泡到全局处理
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

        // 如果标签页不活跃，避免立即触发resize以减少性能影响
        if (isActiveRef.current) {
          // 使用EventManager管理确保适配容器大小
          eventManager.setTimeout(() => {
            fitAddon.fit();

            // Canvas 渲染器需要手动刷新
            if (!term.__webglEnabled && typeof term.refresh === "function") {
              term.refresh(0, term.rows - 1);
            }
          }, 0);
        }
        const existingProcessId = processCache[tabId];
        if (existingProcessId) {
          try {
            console.debug(
              `[WebTerminal] Rebinding listeners for tabId=${tabId}, processId=${existingProcessId}`,
            );
          } catch {
            // ignore log errors
          }

          setupDataListener(existingProcessId, term);
          setupCommandDetection(
            term,
            existingProcessId,
            false,
            terminalDisposables,
          );
        }
      } else {
        // 创建新的终端实例
        term = new Terminal({
          cursorBlink: true,
          cursorStyle: "block", // 明确指定光标样式
          theme: terminalTheme,
          fontFamily:
            '"Fira Code", "Consolas", "Monaco", "Courier New", monospace',
          fontSize: 14,
          fontWeight: 500, // 字重优化，提高清晰度
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
          letterSpacing: 0.3, // 轻微增加字符间距
          lineHeight: 1.0, // 优化行高，提高可读性
          macOptionIsMeta: false,
          macOptionClickForcesSelection: false,
        });

        // 异步加载字体设置并应用
        (async () => {
          try {
            const fontSettings = await getFontSettings();
            term.options.fontSize = fontSettings.fontSize;
            term.options.fontFamily = fontSettings.fontFamily;
            term.options.fontWeight = fontSettings.fontWeight;
            // 使用EventManager管理应用字体设置后自动调整大小
            eventManager.setTimeout(() => {
              if (fitAddon) {
                fitAddon.fit();

                // Canvas 渲染器需要手动刷新
                if (
                  !term.__webglEnabled &&
                  typeof term.refresh === "function"
                ) {
                  term.refresh(0, term.rows - 1);
                }
              }
            }, 0);
          } catch {
            // Failed to apply font settings
          }
        })();

        // 创建并加载插件
        fitAddon = new FitAddon();
        searchAddon = new SearchAddon();

        // 使用轻量链接提供器替代 WebLinksAddon，避免大输出时的错位链接热区问题
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

            // 收集与当前行同属一个 wrapped 块的所有行，实现跨行 URL 识别
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

              // 避免 rawUrl 被裁剪后，正则 lastIndex 指向错误位置
              if (trimmedUrl.length !== rawUrl.length) {
                simpleUrlRegex.lastIndex = globalStart + trimmedUrl.length;
              }
            }

            callback(links);
          },
        });

        term.loadAddon(fitAddon);
        term.loadAddon(searchAddon);

        // 打开终端
        term.open(terminalRef.current);
        syncTerminalLinkCtrlState(term, false);

        // 拦截 Alt+F1 快捷键，让其冒泡到全局处理
        term.attachCustomKeyEventHandler((event) => {
          if (event.altKey && event.key === "F1") {
            return false; // 返回 false 表示不由 xterm 处理，让事件继续冒泡
          }
          return true; // 其他按键由 xterm 正常处理
        });

        // 初始化性能监控器
        if (!performanceMonitorRef.current) {
          // 优化：使用节流的stats更新，避免频繁React状态更新
          let lastStatsUpdate = 0;
          const statsUpdateInterval = 2000; // 每2秒更新一次stats状态

          performanceMonitorRef.current = new TerminalPerformanceMonitor({
            enabled: true,
            sampleRate: 100,
            maxHistorySize: 1000,
            onStats: (stats) => {
              // 优化：节流stats更新，减少React重渲染
              const now = Date.now();
              if (now - lastStatsUpdate >= statsUpdateInterval) {
                lastStatsUpdate = now;
                setPerformanceStats(stats);
              }
            },
          });
        }

        // 初始化轻量滚回统计器（只统计，不重复保存输出内容）
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

        if (!terminalIOMailboxRef.current) {
          terminalIOMailboxRef.current = new RendererTerminalIOMailbox({
            term,
            onQueueOutput: (data) => {
              if (scrollbackUsageTrackerRef.current) {
                scrollbackUsageTrackerRef.current.addData(data);
              }
              contentUpdatedRef.current = true;
              setContentUpdated(true);
            },
            onWriteComplete: ({ data, duration }) => {
              if (performanceMonitorRef.current) {
                performanceMonitorRef.current.recordWrite(
                  data.length,
                  duration,
                );
              }
              const forceRefresh = shouldForceTerminalViewportRefresh(
                term,
                inEditorModeRef.current,
              );
              clearPendingWrappedInputRefresh(term);
              scheduleHighlightRefresh(term, { force: forceRefresh });
            },
          });
        } else {
          terminalIOMailboxRef.current.setTerm(term);
          terminalIOMailboxRef.current.updateHandlers({
            onQueueOutput: (data) => {
              if (scrollbackUsageTrackerRef.current) {
                scrollbackUsageTrackerRef.current.addData(data);
              }
              contentUpdatedRef.current = true;
              setContentUpdated(true);
            },
            onWriteComplete: ({ data, duration }) => {
              if (performanceMonitorRef.current) {
                performanceMonitorRef.current.recordWrite(
                  data.length,
                  duration,
                );
              }
              const forceRefresh = shouldForceTerminalViewportRefresh(
                term,
                inEditorModeRef.current,
              );
              clearPendingWrappedInputRefresh(term);
              scheduleHighlightRefresh(term, { force: forceRefresh });
            },
          });
        }
        registerTerminalIOMailbox(tabId, terminalIOMailboxRef.current);
        if (webglRendererEnabledRef.current) {
          tryEnableWebglRenderer(term);
        } else {
          disableWebglRenderer(term);
        }

        // 使用EventManager管理确保适配容器大小
        eventManager.setTimeout(() => {
          fitAddon.fit();

          // Canvas 渲染器需要手动刷新
          if (!term.__webglEnabled && typeof term.refresh === "function") {
            term.refresh(0, term.rows - 1);
          }
        }, 0);

        // 如果有SSH配置，则优先使用SSH连接
        if (sshConfig && window.terminalAPI) {
          // 检查是否是拆分重连模式
          if (sshConfig.splitReconnect) {
            // 拆分重连模式：显示重连信息
            term.writeln(`正在重新连接到 ${sshConfig.host} ...`);
          } else {
            // 正常连接模式
            term.writeln(`正在连接到 ${sshConfig.host}...`);
          }

          const formatConnectionError = (error) => {
            const rawMessage =
              typeof error?.message === "string" && error.message.trim()
                ? error.message
                : String(error || "").trim();
            const isCancelled =
              /cancel(l)?ed/i.test(rawMessage) || rawMessage.includes("取消");
            if (isCancelled) {
              return "\r\n已取消连接";
            }
            const fallbackMessage = rawMessage || "未知错误";
            return sshConfig.splitReconnect
              ? `\r\n重连失败: ${fallbackMessage}`
              : `\r\n连接失败: ${fallbackMessage}`;
          };

          const normalizeConnectResult = (result) => {
            if (
              result &&
              typeof result === "object" &&
              Object.prototype.hasOwnProperty.call(result, "success")
            ) {
              if (!result.success) {
                return { processId: null, error: result.error };
              }
              return { processId: result.data ?? null, error: null };
            }
            return { processId: result, error: null };
          };

          try {
            // 根据协议类型选择连接方式
            const connectPromise =
              sshConfig.protocol === "telnet"
                ? window.terminalAPI.startTelnet(sshConfig)
                : window.terminalAPI.startSSH(sshConfig);

            // 启动连接
            connectPromise
              .then((result) => {
                const { processId, error } = normalizeConnectResult(result);
                if (error) {
                  term.writeln(formatConnectionError(error));
                  return;
                }
                if (processId) {
                  // 存储进程ID
                  currentProcessId.current = processId;

                  // 存储到进程缓存中
                  const previousProcessId = processCache[tabId];
                  if (previousProcessId) {
                    clearGeometryFor(previousProcessId, tabId);
                  }
                  processCache[tabId] = processId;
                  clearGeometryFor(processId, tabId);

                  // 触发进程ID更新事件，用于通知其他组件
                  const event = new CustomEvent("terminalProcessIdUpdated", {
                    detail: {
                      terminalId: tabId,
                      processId,
                      protocol: sshConfig.protocol || "ssh",
                      splitReconnect: sshConfig.splitReconnect || false,
                    },
                  });

                  window.dispatchEvent(event);

                  // 在重新绑定事件监听器之前，清理旧的监听器
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
                    } catch (error) {
                      console.error(
                        `[WebTerminal] Failed to dispose event listener:`,
                        error,
                      );
                    }
                  });
                  // 清空数组
                  terminalDisposables.length = 0;

                  // 设置数据接收监听
                  setupDataListener(processId, term);

                  // 设置命令边界检测与提示符状态同步
                  console.debug(
                    `[WebTerminal] Setting up command detection for tabId=${tabId}, processId=${processId}`,
                  );
                  setupCommandDetection(
                    term,
                    processId,
                    false,
                    terminalDisposables,
                  );

                  // 拆分重连模式需要更快的resize响应
                  const resizeDelays = sshConfig.splitReconnect
                    ? [200, 500, 1000]
                    : [1000, 2000];

                  // 使用EventManager管理连接成功后多次尝试同步终端大小
                  resizeDelays.forEach((delay) => {
                    eventManager.setTimeout(() => {
                      if (terminalRef.current && fitAddonRef.current) {
                        forceResizeTerminal(
                          term,
                          terminalRef.current,
                          processId,
                          tabId,
                          fitAddonRef.current,
                        );
                      }
                    }, delay);
                  });

                  // 拆分重连成功后的额外处理
                  if (sshConfig.splitReconnect) {
                    term.writeln(`\r\n已建立新连接`);

                    // 强制触发终端内容刷新
                    eventManager.setTimeout(() => {
                      if (term.refresh) {
                        term.refresh(0, term.rows - 1);
                      }
                    }, 300);
                  }
                } else {
                  const errorMsg = sshConfig.splitReconnect
                    ? `重连失败: 未能获取进程ID`
                    : `连接失败: 未能获取进程ID`;
                  term.writeln(errorMsg);
                }
              })
              .catch((error) => {
                term.writeln(formatConnectionError(error));
              });
          } catch (error) {
            term.writeln(formatConnectionError(error));
          }
        }
        // 使用模拟终端
        else {
          term.writeln("Welcome to WebTerminal!");
          term.writeln('Type "help" for available commands.');
          term.writeln("");
          term.write("$ ");

          setupSimulatedTerminal(term);
        }

        // 将新创建的终端实例和fitAddon保存到缓存中
        terminalCache[tabId] = term;
        fitAddonCache[tabId] = fitAddon;
      }

      // 保存搜索插件引用
      searchAddonRef.current = searchAddon;

      // 确保termRef也被设置，用于搜索功能
      termRef.current = term;

      // 添加键盘快捷键支持
      const handleKeyDown = (e) => {
        syncTerminalLinkCtrlState(term, e.ctrlKey);

        // Alt+F1 全局快捷键，始终允许冒泡到 app.jsx 处理
        if (e.altKey && e.key === "F1") {
          return;
        }

        // 如果是在终端内部，则只处理特定的快捷键
        const isTerminalInput =
          e.target &&
          e.target.classList &&
          e.target.classList.contains("xterm-helper-textarea");

        // 在终端内部时，只允许搜索相关的快捷键
        if (isTerminalInput) {
          const allowedKeys = [
            "/", // Ctrl+/ 搜索
            "Escape", // 关闭搜索
            "F3", // 搜索导航
            ",", // Ctrl+, 搜索上一个
            ".", // Ctrl+. 搜索下一个
            ";", // Ctrl+; 复制
            "'", // Ctrl+' 粘贴
            "g", // 搜索导航
          ];

          const isAllowedKey =
            allowedKeys.includes(e.key) ||
            (e.key === "g" && e.ctrlKey) || // Ctrl+G
            (e.key === "/" && e.ctrlKey) || // Ctrl+/
            (e.key === "," && e.ctrlKey) || // Ctrl+,
            (e.key === "." && e.ctrlKey) || // Ctrl+.
            (e.key === ";" && e.ctrlKey) || // Ctrl+;
            (e.key === "'" && e.ctrlKey); // Ctrl+'

          if (!isAllowedKey) {
            return;
          }
        }

        // Ctrl+; 复制 (改为Ctrl+;)
        if (e.ctrlKey && e.key === ";") {
          const selection = term.getSelection();
          if (selection) {
            e.preventDefault();
            window.clipboardAPI.writeText(selection);
          }
        }
        // Ctrl+' 粘贴 (改为Ctrl+')
        else if (e.ctrlKey && e.key === "'") {
          e.preventDefault();

          // 检查是否是重复粘贴（100毫秒内的操作视为重复）
          if (!markPasteIfAllowed()) {
            // 忽略短时间内的重复粘贴请求
            return;
          }

          window.clipboardAPI.readText().then((text) => {
            handlePasteText(text);
          });
        }
        // Ctrl+/ 搜索切换 (打开/关闭搜索栏)
        else if (e.ctrlKey && e.key === "/") {
          // 只有当前活跃的终端才处理搜索快捷键
          if (!isActiveRef.current) return;

          e.preventDefault();
          e.stopPropagation();
          toggleSearchBar();
        }
        // Esc 关闭搜索或建议
        else if (e.key === "Escape") {
          if (showSearchBar) {
            // 只有当前活跃的终端才处理搜索相关快捷键
            if (!isActiveRef.current) return;
            e.preventDefault();
            closeSearchBar();
          } else if (showSuggestions) {
            e.preventDefault();
            setShowSuggestions(false);
            setSuggestions([]);
            setSuggestionsHiddenByEsc(true);
            // 视为手动关闭：直到下一次回车前不再显示
            setSuggestionsSuppressedUntilEnter(true);
            suppressionContextRef.current = {
              input: currentInput,
              timestamp: Date.now(),
            };
          }
        }
        // Ctrl+. 查找下一个
        else if (
          e.key === "F3" ||
          (e.ctrlKey && e.key === "g") ||
          (e.ctrlKey && e.key === ".")
        ) {
          if (searchAddonRef.current && searchTerm) {
            // 只有当前活跃的终端才处理搜索相关快捷键
            if (!isActiveRef.current) return;
            e.preventDefault();
            handleSearch();
          }
        }
        // Ctrl+, 查找上一个
        else if (
          (e.shiftKey && e.key === "F3") ||
          (e.ctrlKey && e.key === ",")
        ) {
          if (searchAddonRef.current && searchTerm) {
            // 只有当前活跃的终端才处理搜索相关快捷键
            if (!isActiveRef.current) return;
            e.preventDefault();
            handleSearchPrevious();
          }
        }
      };

      const handleKeyUp = (e) => {
        syncTerminalLinkCtrlState(term, e.ctrlKey);
      };

      const handleWindowBlur = () => {
        syncTerminalLinkCtrlState(term, false);
      };

      // 使用EventManager添加键盘事件监听
      eventManager.addEventListener(document, "keydown", handleKeyDown);
      eventManager.addEventListener(document, "keyup", handleKeyUp);
      eventManager.addEventListener(window, "blur", handleWindowBlur);

      // 使用EventManager添加鼠标事件监听
      // 中键事件使用捕获阶段，确保在xterm.js处理之前拦截
      if (terminalRef.current) {
        eventManager.addEventListener(
          terminalRef.current,
          "mousedown",
          handleMouseDown,
          { capture: true },
        );
        // 添加auxclick事件处理，某些浏览器中键点击会触发此事件
        eventManager.addEventListener(
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
        // 拦截paste事件，防止xterm.js内部处理中键粘贴
        eventManager.addEventListener(
          terminalRef.current,
          "paste",
          (e) => {
            const pastedText =
              typeof e.clipboardData?.getData === "function"
                ? e.clipboardData.getData("text/plain")
                : "";
            if (pastedText) {
              // 接管原生粘贴，统一走分片发送逻辑，避免一次性大包导致卡顿
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
              if (markPasteIfAllowed()) {
                handlePasteText(pastedText);
              }
              return;
            }

            // 只在中键粘贴时阻止（通过检查最近是否有中键点击）
            const now = Date.now();
            if (now - lastPasteTimeRef.current < 200) {
              e.preventDefault();
              e.stopPropagation();
              e.stopImmediatePropagation();
            }
          },
          { capture: true },
        );

        eventManager.addEventListener(
          terminalRef.current,
          "mousemove",
          handleMouseMove,
        );
        eventManager.addEventListener(
          terminalRef.current,
          "mouseup",
          handleMouseUp,
        );
      }

      // 添加选择变化事件监听
      if (document.onselectionchange !== undefined) {
        eventManager.addEventListener(
          document,
          "selectionchange",
          handleSelectionChange,
        );
      }

      // 使用EventManager添加右键菜单事件监听
      if (terminalRef.current) {
        eventManager.addEventListener(
          terminalRef.current,
          "contextmenu",
          handleContextMenu,
        );
      }

      // 处理窗口调整大小
      const handleResize = () => {
        if (!fitAddon) return;

        try {
          // 强制重新计算DOM大小
          if (terminalRef.current) {
            const container = terminalRef.current;
            const currentWidth = container.clientWidth;
            const currentHeight = container.clientHeight;

            // 确保终端完全填充容器
            if (term && term.element) {
              term.element.style.width = `${currentWidth}px`;
              term.element.style.height = `${currentHeight}px`;

              // 添加强制重排的代码
              term.element.getBoundingClientRect();
            }
          }

          // 适配终端大小
          fitAddon.fit();

          // Canvas 渲染器需要手动刷新
          if (!term.__webglEnabled && typeof term.refresh === "function") {
            term.refresh(0, term.rows - 1);
          }

          // 使用requestAnimationFrame进行二次检查，确保在下一帧进行适配检查
          requestAnimationFrame(() => {
            if (terminalRef.current && term && term.element) {
              const container = terminalRef.current;
              const currentWidth = container.clientWidth;
              const currentHeight = container.clientHeight;
              const elemWidth = term.element.clientWidth;
              const elemHeight = term.element.clientHeight;

              if (
                Math.abs(elemWidth - currentWidth) > 5 ||
                Math.abs(elemHeight - currentHeight) > 5
              ) {
                fitAddon.fit();

                // Canvas 渲染器需要手动刷新
                if (
                  !term.__webglEnabled &&
                  typeof term.refresh === "function"
                ) {
                  term.refresh(0, term.rows - 1);
                }
              }
            }
          });

          // 记录调整后的大小信息
          if (terminalRef.current) {
            // logTerminalSize("调整后", term, terminalRef.current);
          }

          // 获取当前终端的大小
          // 直接获取fit后的实际尺寸而非options中的值
          const dimensions = {
            cols: term.cols,
            rows: term.rows,
          };

          const processId = processCache[tabId];
          if (processId) {
            sendResizeIfNeeded(
              processId,
              tabId,
              dimensions.cols,
              dimensions.rows,
            );

            eventManager.setTimeout(() => {
              if (terminalRef.current && term && processCache[tabId]) {
                sendResizeIfNeeded(
                  processCache[tabId],
                  tabId,
                  term.cols,
                  term.rows,
                );
                setContentUpdated(false);
              }
            }, 300);
          }
        } catch {
          // Error resizing terminal
        }
      };

      // 立即调整大小
      handleResize();

      // 使用ResizeObserver替代window resize事件监听，提供更精确的尺寸变化检测
      const resizeObserver = createResizeObserver(
        terminalRef.current,
        ({ width, height }) => {
          // 只有当尺寸确实发生变化时才触发resize
          if (termRef.current && termRef.current.element) {
            const currentWidth = termRef.current.element.clientWidth;
            const currentHeight = termRef.current.element.clientHeight;

            // 提高阈值到10px，减少微小变化触发的resize
            if (
              Math.abs(width - currentWidth) > 10 ||
              Math.abs(height - currentHeight) > 10
            ) {
              handleResize();
            }
          }
        },
        { debounceTime: 100 }, // 优化防抖时间到100ms，减少频繁调用
      );

      // 使用EventManager管理window resize事件作为备用
      eventManager.addEventListener(window, "resize", handleResize);

      // 添加侧边栏变化事件监听，实现快速响应
      const handleSidebarChanged = (event) => {
        if (
          event.detail &&
          terminalRef.current &&
          fitAddonRef.current &&
          termRef.current
        ) {
          // 侧边栏变化时立即触发resize，无需防抖
          setTimeout(() => {
            forceResizeTerminal(
              termRef.current,
              terminalRef.current,
              processCache[tabId],
              tabId,
              fitAddonRef.current,
            );
          }, 10);

          // 添加一个短延迟的二次调整确保完全适配
          setTimeout(() => {
            if (terminalRef.current && fitAddonRef.current && termRef.current) {
              handleResize();
            }
          }, 60);
        }
      };

      eventManager.addEventListener(
        window,
        "sidebarChanged",
        handleSidebarChanged,
      );

      // 优化的可见性变化处理，使用防抖减少频繁调用
      const handleVisibilityChange = debounce(() => {
        if (
          !document.hidden &&
          termRef.current &&
          isElementVisible(terminalRef.current)
        ) {
          handleResize();
        }
      }, 50);

      eventManager.addEventListener(
        document,
        "visibilitychange",
        handleVisibilityChange,
      );

      const attributeObserver =
        typeof MutationObserver === "function"
          ? new MutationObserver(() => {
              if (
                terminalRef.current &&
                termRef.current &&
                fitAddonRef.current &&
                isElementVisible(terminalRef.current)
              ) {
                eventManager.setTimeout(() => {
                  forceResizeTerminal(
                    termRef.current,
                    terminalRef.current,
                    processCache[tabId],
                    tabId,
                    fitAddonRef.current,
                  );
                }, 0);
              }
            })
          : null;

      if (attributeObserver && terminalRef.current) {
        attributeObserver.observe(terminalRef.current, {
          attributes: true,
          attributeFilter: ["style", "class", "hidden", "aria-hidden"],
        });
        eventManager.addObserver(attributeObserver);
      }

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
                  eventManager.setTimeout(() => {
                    forceResizeTerminal(
                      termRef.current,
                      terminalRef.current,
                      processCache[tabId],
                      tabId,
                      fitAddonRef.current,
                    );
                  }, 16);
                }
              });
            })
          : null;

      if (intersectionObserver && terminalRef.current) {
        intersectionObserver.observe(terminalRef.current);
        eventManager.addObserver(intersectionObserver);
      }
      // 保存引用以在其他方法中使用
      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // 同步终端大小
      const syncTerminalSize = () => {
        if (fitAddonRef.current) {
          try {
            // 先调用fit
            fitAddonRef.current.fit();

            // Canvas 渲染器需要手动刷新
            if (!term.__webglEnabled && typeof term.refresh === "function") {
              term.refresh(0, term.rows - 1);
            }

            // 获取实际尺寸
            const cols = term.cols;
            const rows = term.rows;
            const processId = processCache[tabId];

            if (processId) {
              sendResizeIfNeeded(processId, tabId, cols, rows);
            }
          } catch {
            /* intentionally ignored */
          }
        }
      };

      // 立即同步一次
      syncTerminalSize();

      // 使用EventManager管理延迟同步，确保布局稳定后大小正确
      eventManager.setTimeout(syncTerminalSize, 100);

      // 添加一个新的辅助函数，确保终端在被激活时调整大小
      const ensureTerminalSizeOnVisibilityChange = () => {
        // 检查当前标签是否可见（通过DOM属性或样式）
        if (terminalRef.current) {
          const isVisible = isElementVisible(terminalRef.current);

          // 只有当终端可见且内容有更新时，才执行大小调整
          if (
            isVisible &&
            termRef.current &&
            fitAddonRef.current &&
            contentUpdated
          ) {
            // 使用EventManager管理延迟执行强制调整大小
            eventManager.setTimeout(() => {
              forceResizeTerminal(
                termRef.current,
                terminalRef.current,
                processCache[tabId],
                tabId,
                fitAddonRef.current,
              );
              // 重置内容更新标志
              setContentUpdated(false);
            }, 10);
          }
        }
      };

      // 添加一个检查元素可见性的函数
      const isElementVisible = (element) => {
        if (!element) return false;

        // 检查元素及其所有父元素的可见性
        let current = element;
        while (current) {
          const style = window.getComputedStyle(current);
          if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0" ||
            current.getAttribute("aria-hidden") === "true"
          ) {
            return false;
          }
          current = current.parentElement;
        }

        // 检查元素是否在视口内
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      // 使用EventManager管理定期检查终端可见性的定时器
      // 优化：增加间隔到1000ms，使用ref而不是state来检查更新
      eventManager.setInterval(() => {
        // 使用ref检查更新，避免状态依赖导致的闭包问题
        if (contentUpdatedRef.current) {
          contentUpdatedRef.current = false;
          ensureTerminalSizeOnVisibilityChange();
        }
      }, 1000); // 优化检查间隔到1000ms，降低CPU占用

      // 添加定时器清理
      // 添加ResizeObserver到EventManager管理
      eventManager.addObserver(resizeObserver);

      // 添加自定义清理逻辑到EventManager
      eventManager.addCleanup(() => {
        if (terminalIOMailboxRef.current) {
          terminalIOMailboxRef.current.detachProcess();
        }

        // 从DOM中分离终端但保留缓存
        if (termRef.current) {
          try {
            const element = terminalRef.current;
            if (element) {
              while (element.firstChild) {
                element.removeChild(element.firstChild);
              }
            }
          } catch {
            // Error detaching terminal
          }
        }

        // 移除样式元素
      });

      if (process.env.NODE_ENV === "development") {
        console.debug(
          `[WebTerminal] lifecycle manager setup tabId=${tabId}`,
          eventManager.getStats(),
        );
      }

      // EventManager会自动清理所有事件监听器、定时器和观察者
      return () => {
        // 清理性能监控器
        if (performanceMonitorRef.current) {
          performanceMonitorRef.current.destroy();
          performanceMonitorRef.current = null;
        }

        // 清理滚回统计器
        if (scrollbackUsageTrackerRef.current) {
          scrollbackUsageTrackerRef.current.destroy();
          scrollbackUsageTrackerRef.current = null;
        }

        if (terminalIOMailboxRef.current) {
          unregisterTerminalIOMailbox(tabId, terminalIOMailboxRef.current);
          terminalIOMailboxRef.current.destroy();
          terminalIOMailboxRef.current = null;
        }

        // 清理终端事件监听器
        terminalDisposables.forEach((disposable) => {
          try {
            if (disposable && typeof disposable.dispose === "function") {
              disposable.dispose();
            }
          } catch {
            // 忽略disposal错误
          }
        });
        terminalDisposables.length = 0; // 清空数组

        if (process.env.NODE_ENV === "development") {
          console.debug(
            `[WebTerminal] lifecycle manager cleanup tabId=${tabId}`,
            eventManager.getStats(),
          );
        }

        // 清理本 effect 的事件/定时器/观察器，防止切换标签后叠加
        eventManager.reset();
      };
    }
  }, [
    tabId,
    refreshKey,
    sshConfig,
    lifecycleEventManager,
    tryEnableWebglRenderer,
    disableWebglRenderer,
    scheduleHighlightRefresh,
  ]);

  // 设置模拟终端（用于无法使用IPC API时的回退）
  const setupSimulatedTerminal = (term) => {
    const term_prompt = "$ ";
    let userInput = "";

    // 初始化编辑器模式状态
    let inEditorMode = false;
    // 识别编辑器命令的正则表达式
    const editorCommandRegex =
      /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;

    // 写入初始提示符
    term.write(term_prompt);

    term.onKey(({ key, domEvent }) => {
      const printable =
        !domEvent.altKey && !domEvent.ctrlKey && !domEvent.metaKey;

      // 回车键处理
      if (domEvent.keyCode === 13) {
        term.writeln("");

        // 处理命令
        if (userInput.trim() !== "") {
          const command = userInput.trim();

          // 检测是否是编辑器命令
          if (editorCommandRegex.test(command)) {
            inEditorMode = true;
            // 模拟编辑器输出
            term.writeln(
              `Simulated ${command} editor mode. Type 'exit' to return.`,
            );
          }
          // 检测是否退出编辑器模式
          else if (inEditorMode && /^(exit|quit|q|:q|:wq|:x)$/i.test(command)) {
            inEditorMode = false;
          }
          // 只有不在编辑器模式下才添加到历史记录
          else if (!inEditorMode) {
            // 命令历史记录功能已移除
            // if (window.terminalAPI?.addToCommandHistory) {
            //   window.terminalAPI.addToCommandHistory(command);
            // }

            // 如果 IPC API 不可用，使用本地处理命令
            handleCommand(term, command);
          }

          term.write("$ ");
        } else {
          term.write("$ ");
        }

        // 重置输入
        userInput = "";
      }
      // 退格键处理
      else if (domEvent.keyCode === 8) {
        if (userInput.length > 0) {
          userInput = userInput.slice(0, -1);
          term.write("\b \b");
        }
      }
      // 普通文本输入处理
      else if (printable) {
        userInput += key;
        term.write(key);
      }
    });
  };

  // 处理命令（本地模式）
  const handleCommand = (term, input) => {
    const command = input.trim();

    switch (command) {
      case "help":
        term.writeln("Available commands:");
        term.writeln("  help     - Show this help message");
        term.writeln("  clear    - Clear the terminal");
        term.writeln("  date     - Show current date and time");
        term.writeln("  echo     - Echo back your text");
        break;
      case "clear":
        term.clear();
        break;
      case "date":
        term.writeln(new Date().toString());
        break;
      default:
        if (command.startsWith("echo ")) {
          term.writeln(command.substring(5));
        } else if (command !== "") {
          term.writeln(`Command not found: ${command}`);
        }
        break;
    }
  };

  // 处理快捷搜索选项
  const handleSearchFromMenu = () => {
    // 只有当前活跃的终端才处理搜索
    if (!isActiveRef.current) return;
    openSearchBar();
    handleClose();
  };

  // 处理右键菜单打开
  const handleContextMenu = (event) => {
    event.preventDefault();

    // 新增：右键菜单弹出时自动隐藏命令提示浮动窗口
    setShowSuggestions(false);
    setSuggestions([]);

    // 检查是否有选中的文本
    if (termRef.current) {
      const selection = termRef.current.getSelection();
      setSelectedText(selection);
    }

    setContextMenu(
      contextMenu === null
        ? { mouseX: event.clientX - 2, mouseY: event.clientY - 4 }
        : null,
    );
  };

  // 关闭右键菜单
  const handleClose = () => {
    setContextMenu(null);
    // 新增：关闭标签页时释放后端连接
    if (tabId && window.terminalAPI && window.terminalAPI.releaseConnection) {
      window.terminalAPI.releaseConnection(tabId);
    }
  };

  // 复制选中的文本
  const handleCopy = () => {
    if (selectedText) {
      window.clipboardAPI.writeText(selectedText).catch(() => {
        // 复制到剪贴板失败
      });
    }
    handleClose();
  };

  // 粘贴剪贴板内容
  const handlePaste = () => {
    // 检查是否是重复粘贴（100毫秒内的操作视为重复）
    if (!markPasteIfAllowed()) {
      // 忽略短时间内的重复粘贴请求
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
  };

  // 发送选中文本到AI助手
  const handleSendToAI = () => {
    if (selectedText) {
      // 触发全局事件，将选中文本发送到AI助手
      window.dispatchEvent(
        new CustomEvent("sendToAI", {
          detail: { text: selectedText },
        }),
      );
    }
    handleClose();
  };

  // 清空终端
  const handleClear = () => {
    if (termRef.current) {
      termRef.current.clear();
    }
    handleClose();
  };

  // 通过window对象暴露更新SSH进程ID的回调函数
  useEffect(() => {
    // 定义一个更新SSH进程ID的回调
    window.sshProcessIdCallback = (terminalId, processId) => {
      // 在父组件的状态中存储进程ID
      try {
        // 可以通过自定义事件通知父组件
        const event = new CustomEvent("sshProcessIdUpdated", {
          detail: { terminalId, processId },
        });
        window.dispatchEvent(event);
      } catch {
        // Failed to update SSH process ID
      }
    };

    return () => {
      // 清理回调
      window.sshProcessIdCallback = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (terminalIOMailboxRef.current) {
        terminalIOMailboxRef.current.detachProcess();
      }

      resetRenderState();

      cancelInputQueueDrain();
      inputQueueRef.current = [];
      inputQueueBytesRef.current = 0;
    };
  }, [cancelInputQueueDrain, resetRenderState]);

  useEffect(() => {
    if (!contentUpdated || !termRef.current) {
      return;
    }

    scheduleHighlightRefresh(termRef.current);
  }, [contentUpdated, scheduleHighlightRefresh]);

  // 设置数据监听器的函数，处理终端输出
  const setupDataListener = (processId, term) => {
    const previousProcessId = processCache[tabId];
    const mailbox = terminalIOMailboxRef.current;

    cancelInputQueueDrain();
    inputQueueRef.current = [];
    inputQueueBytesRef.current = 0;

    // 保存进程ID以便后续可以关闭
    if (previousProcessId && previousProcessId !== processId) {
      clearGeometryFor(previousProcessId, tabId);
    }
    processCache[tabId] = processId;
    clearGeometryFor(processId, tabId);
    resetPromptTracking();
    clearPendingWrappedInputRefresh(term);
    syncPromptTrackingFromTerminal(term);

    // 添加数据监听
    const handleProcessOutput = (data) => {
      if (!data) {
        return;
      }

      const dataStr = typeof data === "string" ? data : data.toString();

      // 检测全屏应用启动并触发重新调整大小
      // 通常像top, htop, vim, nano等全屏应用会发送特定的ANSI转义序列
      // const dataStr = data.toString(); // Already defined above

      // 检测常见的全屏应用启动特征
      if (
        // 检测清屏命令
        dataStr.includes("\u001b[2J") ||
        // 检测光标定位到左上角
        dataStr.includes("\u001b[H") ||
        // 检测光标位置保存或恢复（常见于全屏应用）
        dataStr.includes("\u001b[s") ||
        dataStr.includes("\u001b[u") ||
        // 检测屏幕清除到结尾（常见于全屏刷新）
        dataStr.includes("\u001b[J") ||
        // 检测常见的全屏应用命令名称
        /(^|\s)(top|htop|vi|vim|nano|less|more|tail -f|watch)(\s|$)/.test(
          dataStr,
        ) ||
        // 检测终端屏幕缓冲区交替（用于全屏应用）
        dataStr.includes("\u001b[?1049h") ||
        dataStr.includes("\u001b[?1049l") ||
        // 检测终端大小查询回复
        TERMINAL_RESIZE_QUERY_REGEX.test(dataStr)
      ) {
        // 使用EventManager管理一系列延迟执行，以适应不同应用的启动速度
        const delayTimes = [100, 300, 600, 1000];

        delayTimes.forEach((delay) => {
          eventManager.setTimeout(() => {
            if (terminalRef.current && fitAddonRef.current) {
              // 强制设置内容已更新，确保调整生效
              setContentUpdated(true);
              forceResizeTerminal(
                term,
                terminalRef.current,
                processId,
                tabId,
                fitAddonRef.current,
              );
            }
          }, delay);
        });
      }
    };

    if (mailbox) {
      mailbox.setTerm(term);
      mailbox.updateHandlers({
        onOutput: handleProcessOutput,
      });
      mailbox.attachProcess(processId);
    }

    // 同步终端大小
    const syncTerminalSize = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();

          // Canvas 渲染器需要手动刷新
          if (!term.__webglEnabled && typeof term.refresh === "function") {
            term.refresh(0, term.rows - 1);
          }

          const processId = processCache[tabId];
          if (processId) {
            sendResizeIfNeeded(processId, tabId, term.cols, term.rows);
          }
        } catch {
          // 终端大小适配失败
        }
      }
    };

    // 立即同步一次
    syncTerminalSize();

    // 使用EventManager管理延迟同步，确保布局稳定后大小正确
    eventManager.setTimeout(syncTerminalSize, 100);

    // 使用EventManager管理定期检查终端可见性的定时器
    // 优化：移除此重复的定时器，主useEffect中已有相同功能
    // 依靠主useEffect中的定时器进行统一管理

    // EventManager会自动清理定时器，无需返回清理函数
    return () => {
      // 留空，清理由EventManager处理
    };
  };

  // 监听主题变化并更新终端主题
  useEffect(() => {
    if (terminalCache[tabId]) {
      // 更新主题
      terminalCache[tabId].options.theme = terminalTheme;
    }
  }, [theme.palette.mode, tabId]);

  // 监听isActive变化，管理终端焦点状态
  useEffect(() => {
    // 当标签变为活动状态时，确保终端获得焦点以接收键盘输入
    if (isActive && termRef.current) {
      let focusAttempt = 0;
      const maxAttempts = 5;
      const timers = [];

      // ʹ�õ������ӳ�����γ������ý���
      const attemptFocus = () => {
        try {
          // ��֤�ն�ʵ���ͽ��㷽������
          if (termRef.current && terminalRef.current) {
            // ����ն�Ԫ���Ƿ������ɼ�
            const isVisible =
              terminalRef.current.offsetWidth > 0 &&
              terminalRef.current.offsetHeight > 0;

            if (isVisible && termRef.current.element) {
              // 检查xterm-helper-textarea是否已经获得焦点
              const helperTextarea = termRef.current.element.querySelector(
                ".xterm-helper-textarea",
              );

              if (helperTextarea && document.activeElement !== helperTextarea) {
                // 让终端获得焦点，使其能够接收键盘输入
                helperTextarea.focus();
                console.debug(
                  `[WebTerminal] Successfully focused terminal for tabId=${tabId} on attempt ${focusAttempt + 1}`,
                );
              } else if (
                helperTextarea &&
                document.activeElement === helperTextarea
              ) {
                console.debug(
                  `[WebTerminal] Terminal already focused for tabId=${tabId}`,
                );
                return; // 已经获得焦点，不需要继续尝试
              }
            }
          }

          // 继续重试（如果还未达到最大尝试次数）
          focusAttempt++;
          if (focusAttempt < maxAttempts) {
            const nextDelay = 50 + focusAttempt * 50; // 递增延迟: 100ms, 150ms, 200ms, 250ms, 300ms
            const timer = setTimeout(attemptFocus, nextDelay);
            timers.push(timer);
          }
        } catch (error) {
          // 记录焦点设置失败的错误
          console.error(
            `[WebTerminal] Terminal focus failed for tabId=${tabId} on attempt ${focusAttempt + 1}:`,
            error,
          );

          // 继续重试（如果还未达到最大尝试次数）
          focusAttempt++;
          if (focusAttempt < maxAttempts) {
            const nextDelay = 50 + focusAttempt * 50;
            const timer = setTimeout(attemptFocus, nextDelay);
            timers.push(timer);
          }
        }
      };

      // 初始延迟后开始首次尝试
      const initialTimer = setTimeout(attemptFocus, 100);
      timers.push(initialTimer);

      // 清理所有定时器
      return () => {
        timers.forEach((timer) => clearTimeout(timer));
      };
    }
  }, [isActive, tabId]); // 监听isActive和tabId变化

  useEffect(() => {
    const handleTabFocus = (event) => {
      if (!event.detail || event.detail.tabId !== tabId) return;
      if (!terminalRef.current || !termRef.current) return;

      eventManager.setTimeout(() => {
        try {
          if (
            !terminalRef.current ||
            !termRef.current ||
            terminalRef.current.offsetWidth <= 0 ||
            terminalRef.current.offsetHeight <= 0
          ) {
            return;
          }

          const helperTextarea = termRef.current.element?.querySelector(
            ".xterm-helper-textarea",
          );

          if (helperTextarea && document.activeElement !== helperTextarea) {
            helperTextarea.focus();
          }
        } catch {
          /* intentionally ignored */
        }
      }, 120);
    };

    const removeTabFocusListener = eventManager.addEventListener(
      window,
      "tabChanged",
      handleTabFocus,
    );

    return () => {
      removeTabFocusListener();
    };
  }, [tabId, eventManager]);

  // 添加标签切换监听器
  useEffect(() => {
    // 创建一个用于监听标签切换事件的处理函数
    const handleTabChanged = (event) => {
      // 检查是否是当前终端所在的标签被激活
      if (event.detail && event.detail.tabId === tabId) {
        // 标签激活时设置内容已更新，确保调整生效
        setContentUpdated(true);

        // 如果是强制刷新（如拆分后），立即触发多次resize
        if (event.detail.forceRefresh) {
          const executeResize = () => {
            if (terminalRef.current && fitAddonRef.current && termRef.current) {
              forceResizeTerminal(
                termRef.current,
                terminalRef.current,
                processCache[tabId],
                tabId,
                fitAddonRef.current,
              );
            }
          };

          // 立即执行一次
          executeResize();

          // 针对拆分操作的特殊处理
          if (event.detail.splitOperation) {
            // 拆分操作需要更积极的刷新策略
            const delayTimes = event.detail.finalRefresh
              ? [100, 250, 500] // 最终刷新使用更长的间隔
              : event.detail.retryAttempt
                ? [100, 200, 400] // 重试时使用渐进式延迟
                : [25, 75, 150, 300, 500, 750]; // 初始拆分使用密集刷新

            delayTimes.forEach((delay) => {
              eventManager.setTimeout(() => {
                // 在每次重试前检查终端状态
                if (
                  terminalRef.current &&
                  fitAddonRef.current &&
                  termRef.current
                ) {
                  const container = terminalRef.current;
                  const termElement = termRef.current.element;

                  // 检查容器是否可见且有正确的尺寸
                  if (
                    container &&
                    container.offsetWidth > 0 &&
                    container.offsetHeight > 0
                  ) {
                    executeResize();

                    // 特殊处理：强制刷新终端内容显示
                    if (termRef.current.refresh) {
                      setTimeout(() => {
                        if (termRef.current && termRef.current.refresh) {
                          termRef.current.refresh(0, termRef.current.rows - 1);

                          // 强制触发重绘
                          if (termRef.current.focus) {
                            termRef.current.focus();
                            setTimeout(() => termRef.current.blur(), 10);
                          }
                        }
                      }, 25);
                    }

                    // 额外的DOM刷新
                    if (termElement) {
                      termElement.style.opacity = "0.99";
                      setTimeout(() => {
                        if (termElement) termElement.style.opacity = "1";
                      }, 10);
                    }
                  } else {
                    // 如果容器不可见，尝试重新显示
                    if (container) {
                      container.style.display = "block";
                      container.style.visibility = "visible";
                      container.style.opacity = "1";
                    }
                  }
                }
              }, delay);
            });
          } else {
            // 常规强制刷新的重试机制
            const delayTimes = event.detail.retryAttempt
              ? [100, 200, 400]
              : [50, 150, 300, 500, 800];
            delayTimes.forEach((delay) => {
              eventManager.setTimeout(() => {
                // 在每次重试前检查终端状态
                if (
                  terminalRef.current &&
                  fitAddonRef.current &&
                  termRef.current
                ) {
                  const container = terminalRef.current;

                  // 检查容器是否可见且有正确的尺寸
                  if (
                    container &&
                    container.offsetWidth > 0 &&
                    container.offsetHeight > 0
                  ) {
                    executeResize();

                    // 额外的终端内容刷新
                    if (termRef.current.refresh) {
                      setTimeout(() => {
                        if (termRef.current && termRef.current.refresh) {
                          termRef.current.refresh(0, termRef.current.rows - 1);
                        }
                      }, 50);
                    }
                  }
                }
              }, delay);
            });
          }

          // 最后一次验证和修复
          setTimeout(
            () => {
              if (
                terminalRef.current &&
                fitAddonRef.current &&
                termRef.current
              ) {
                const container = terminalRef.current;
                const termElement = termRef.current.element;

                // 如果终端仍然没有正确显示，进行最后的修复尝试
                if (
                  container &&
                  (!termElement || termElement.offsetWidth === 0)
                ) {
                  // 强制重新适配
                  fitAddonRef.current.fit();

                  // 触发内容刷新
                  if (termRef.current.refresh) {
                    termRef.current.refresh(0, termRef.current.rows - 1);
                  }

                  // 同步到后端
                  const processId = processCache[tabId];
                  if (processId) {
                    sendResizeIfNeeded(
                      processId,
                      tabId,
                      termRef.current.cols,
                      termRef.current.rows,
                    );
                  }
                }
              }
            },
            event.detail.splitOperation ? 1200 : 1000,
          );
        } else {
          // 正常的标签切换处理
          eventManager.setTimeout(() => {
            if (terminalRef.current && fitAddonRef.current && termRef.current) {
              forceResizeTerminal(
                termRef.current,
                terminalRef.current,
                processCache[tabId],
                tabId,
                fitAddonRef.current,
              );
            }
          }, 10);

          // 使用EventManager管理多次尝试调整，以处理某些特殊情况
          const delayTimes = [50, 150, 300];
          delayTimes.forEach((delay) => {
            eventManager.setTimeout(() => {
              if (
                terminalRef.current &&
                fitAddonRef.current &&
                termRef.current
              ) {
                forceResizeTerminal(
                  termRef.current,
                  terminalRef.current,
                  processCache[tabId],
                  tabId,
                  fitAddonRef.current,
                );
              }
            }, delay);
          });
        }
      }
    };

    // 添加专门的终端resize事件监听，用于分屏布局变化
    const handleTerminalResize = (event) => {
      const { tabId: eventTabId, layoutType } = event.detail || {};

      // 只处理属于当前终端的事件
      if (
        eventTabId === tabId &&
        terminalRef.current &&
        fitAddonRef.current &&
        termRef.current
      ) {
        // 设置内容已更新标志
        setContentUpdated(true);

        // 延迟执行resize，确保DOM布局已经完成
        const resizeDelay = layoutType === "split" ? 200 : 100;

        setTimeout(() => {
          if (terminalRef.current && fitAddonRef.current && termRef.current) {
            // 强制重新计算容器尺寸
            const container = terminalRef.current;
            const currentWidth = container.clientWidth;
            const currentHeight = container.clientHeight;

            // 确保终端完全填充容器
            if (termRef.current.element) {
              termRef.current.element.style.width = `${currentWidth}px`;
              termRef.current.element.style.height = `${currentHeight}px`;

              // 强制重排
              termRef.current.element.getBoundingClientRect();
            }

            // 执行尺寸适配
            fitAddonRef.current.fit();

            // 同步到后端进程
            const processId = processCache[tabId];
            if (processId) {
              sendResizeIfNeeded(
                processId,
                tabId,
                termRef.current.cols,
                termRef.current.rows,
              );
            }

            // 如果是拆分操作，额外进行多次resize确保显示正确
            if (layoutType === "split") {
              const additionalDelays = [100, 300, 500];
              additionalDelays.forEach((delay) => {
                eventManager.setTimeout(() => {
                  if (fitAddonRef.current && termRef.current) {
                    fitAddonRef.current.fit();
                  }
                }, delay);
              });
            }
          }
        }, resizeDelay);
      }
    };

    // 添加专门的终端强制刷新事件监听
    const handleTerminalForceRefresh = (event) => {
      const { tabId: eventTabId, layoutType } = event.detail || {};

      // 只处理属于当前终端的事件
      if (
        eventTabId === tabId &&
        terminalRef.current &&
        fitAddonRef.current &&
        termRef.current
      ) {
        // 设置内容已更新标志
        setContentUpdated(true);

        // 强制刷新终端显示
        const executeForceRefresh = () => {
          if (terminalRef.current && fitAddonRef.current && termRef.current) {
            // 强制重新计算容器尺寸
            const container = terminalRef.current;
            const currentWidth = container.clientWidth;
            const currentHeight = container.clientHeight;

            // 确保终端完全填充容器
            if (termRef.current.element) {
              termRef.current.element.style.width = `${currentWidth}px`;
              termRef.current.element.style.height = `${currentHeight}px`;

              // 强制重排
              termRef.current.element.getBoundingClientRect();
            }

            // 执行尺寸适配
            fitAddonRef.current.fit();

            // 同步到后端进程
            const processId = processCache[tabId];
            if (processId) {
              sendResizeIfNeeded(
                processId,
                tabId,
                termRef.current.cols,
                termRef.current.rows,
              );
            }

            // 强制刷新终端内容显示
            if (termRef.current.refresh) {
              termRef.current.refresh(0, termRef.current.rows - 1);
            }

            // 特殊处理拆分重连后的情况
            if (
              layoutType === "post-split-reconnect" ||
              layoutType === "post-split" ||
              layoutType === "post-split-retry"
            ) {
              // 额外的重绘和聚焦操作
              setTimeout(() => {
                if (termRef.current && termRef.current.element) {
                  // 强制DOM重绘
                  const element = termRef.current.element;
                  element.style.transform = "translateZ(0)";
                  element.offsetHeight; // 触发重排
                  element.style.transform = "";

                  // 尝试聚焦和失焦以触发渲染
                  if (termRef.current.focus && termRef.current.blur) {
                    termRef.current.focus();
                    setTimeout(() => {
                      if (termRef.current && termRef.current.blur) {
                        termRef.current.blur();
                      }
                    }, 50);
                  }

                  // 拆分重连模式下的特殊处理
                  if (layoutType === "post-split-reconnect") {
                    // 检查当前组件的SSH配置中是否有拆分重连标记
                    if (sshConfig && sshConfig.splitReconnect) {
                      // 强制刷新终端内容
                      if (termRef.current.refresh) {
                        termRef.current.refresh(0, termRef.current.rows - 1);
                      }

                      // 触发窗口resize确保布局正确
                      window.dispatchEvent(new Event("resize"));
                    }
                  }
                }
              }, 100);
            }
          }
        };

        // 立即执行一次
        executeForceRefresh();

        // 针对拆分重连的特殊情况，使用更密集的重试策略
        if (
          layoutType === "post-split-reconnect" ||
          layoutType === "post-split" ||
          layoutType === "post-split-retry"
        ) {
          const retryDelays =
            layoutType === "post-split-reconnect"
              ? [50, 150, 300, 500, 800, 1200] // 重连模式使用更密集的重试
              : layoutType === "post-split-retry"
                ? [100, 300, 600] // 重试时使用更长间隔
                : [50, 150, 300, 500, 800]; // 初始拆分时密集重试

          retryDelays.forEach((delay) => {
            eventManager.setTimeout(() => {
              if (
                terminalRef.current &&
                fitAddonRef.current &&
                termRef.current
              ) {
                const container = terminalRef.current;

                // 检查容器是否正确显示
                if (
                  container &&
                  container.offsetWidth > 0 &&
                  container.offsetHeight > 0
                ) {
                  executeForceRefresh();

                  // 拆分重连模式的额外验证
                  if (layoutType === "post-split-reconnect") {
                    const processId = processCache[tabId];
                    if (processId) {
                      // 验证SSH连接是否正常
                      setTimeout(() => {
                        if (termRef.current && termRef.current.refresh) {
                          termRef.current.refresh(0, termRef.current.rows - 1);
                        }
                      }, 100);
                    }
                  }
                } else {
                  // 容器不可见，尝试修复
                  if (container) {
                    container.style.display = "flex";
                    container.style.visibility = "visible";
                    container.style.opacity = "1";

                    // 修复后再次执行刷新
                    setTimeout(() => {
                      executeForceRefresh();
                    }, 50);
                  }
                }
              }
            }, delay);
          });

          // 最终保险措施（拆分重连模式下延长验证时间）
          const finalCheckDelay =
            layoutType === "post-split-reconnect" ? 2000 : 1500;
          setTimeout(() => {
            if (terminalRef.current && fitAddonRef.current && termRef.current) {
              const termElement = termRef.current.element;

              // 最后检查：如果仍然有问题，进行强制修复
              if (
                !termElement ||
                termElement.offsetWidth === 0 ||
                termElement.offsetHeight === 0
              ) {
                // 强制重新创建终端显示
                if (fitAddonRef.current && termRef.current) {
                  fitAddonRef.current.fit();

                  if (termRef.current.refresh) {
                    termRef.current.refresh(0, termRef.current.rows - 1);
                  }

                  // 强制触发窗口resize事件
                  window.dispatchEvent(new Event("resize"));
                }
              }
            }
          }, finalCheckDelay);
        }
      }
    };

    // 使用EventManager添加事件监听器
    const removeTabChangedListener = eventManager.addEventListener(
      window,
      "tabChanged",
      handleTabChanged,
    );
    const removeTerminalResizeListener = eventManager.addEventListener(
      window,
      "terminalResize",
      handleTerminalResize,
    );
    const removeTerminalForceRefreshListener = eventManager.addEventListener(
      window,
      "terminalForceRefresh",
      handleTerminalForceRefresh,
    );

    return () => {
      removeTabChangedListener();
      removeTerminalResizeListener();
      removeTerminalForceRefreshListener();
    };
  }, [tabId, eventManager]);

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
          onOpenSearch={openSearchBar}
          onCloseSearch={closeSearchBar}
          onSearchTermChange={setSearchTerm}
          onSearchNext={handleSearch}
          onSearchPrevious={handleSearchPrevious}
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

      {/* 命令建议组件 */}
      <CommandSuggestion
        suggestions={suggestions}
        visible={showSuggestions && isShellPromptReady}
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
  isActive: PropTypes.bool,
};

export default React.memo(WebTerminal, areWebTerminalPropsEqual);
