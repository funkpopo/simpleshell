import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import "@xterm/xterm/css/xterm.css";
import "./WebTerminal.css";
import { debounce, createResizeObserver } from "../core/utils/performance.js";
import { useEventManager } from "../core/utils/eventManager.js";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PasteIcon from "@mui/icons-material/ContentPaste";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import { findGroupByTab } from "../core/syncInputGroups";
import { dispatchCommandToGroup } from "../core/syncGroupCommandDispatcher";
import CommandSuggestion from "./CommandSuggestion";

// 添加全局样式以确保xterm正确填满容器
const terminalStyles = `
.xterm {
  height: 100%;
  width: 100%;
  padding: 0;
}
.xterm-viewport {
  width: 100% !important;
  height: 100% !important;
  overflow-y: auto;
}
.xterm-viewport::-webkit-scrollbar {
  width: 10px;
}
.xterm-viewport::-webkit-scrollbar-track {
  background: transparent;
}
.xterm-viewport::-webkit-scrollbar-thumb {
  background-color: rgba(128, 128, 128, 0.5);
  border-radius: 10px;
  border: 2px solid transparent;
  background-clip: content-box;
}
.xterm-viewport::-webkit-scrollbar-thumb:hover {
  background-color: rgba(128, 128, 128, 0.8);
}
.xterm-screen {
  width: 100% !important;
  height: 100% !important;
}
.xterm-scrollable-element {
  width: 100% !important;
  height: 100% !important;
}
.terminal-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

/* 增强版选中高亮样式 */
.xterm-selection {
  opacity: 1 !important;
  z-index: 10 !important;
  pointer-events: none !important;
  position: absolute !important;
}

/* 默认隐藏所有选择div */
.xterm .xterm-selection div {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
  position: absolute !important;
  box-sizing: border-box !important;
}

/* 仅显示第一个选择容器中的第一个div */
.xterm .xterm-selection:first-of-type div:first-child {
  display: block !important;
  opacity: 1 !important;
  visibility: visible !important;
  will-change: transform, width, height !important;
  transition: transform 0.05s ease !important; /* 平滑过渡效果 */
  box-sizing: border-box !important;
}

/* 彻底隐藏任何额外的选择容器 */
.xterm-selection:not(:first-of-type) {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
}

/* 标记为重复的选择元素彻底隐藏 */
.xterm-selection-duplicate {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

/* 确保选择高亮颜色正确显示，并有合适的半透明效果 */
.xterm .xterm-selection div {
  background-color: rgba(255, 255, 255, 0.3) !important; /* 浅色主题 */
}

/* 深色主题下的选择高亮 */
.dark-theme .xterm .xterm-selection div {
  background-color: rgba(255, 255, 170, 0.3) !important;
}
`;

// 添加搜索相关样式
const searchBarStyles = `
.search-bar {
  position: absolute;
  top: 5px;
  right: 15px; /* 搜索栏位置靠近右侧边缘 */
  z-index: 10;
  display: flex;
  background: rgba(30, 30, 30, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  padding: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  align-items: center;
  transition: all 0.2s ease;
  backdrop-filter: blur(5px);
}
.search-input {
  border: none;
  outline: none;
  background: transparent;
  color: white;
  font-size: 14px;
  padding: 4px 8px;
  width: 200px;
  transition: all 0.2s ease;
}
.search-input::placeholder {
  color: rgba(255, 255, 255, 0.5);
}
.search-input:focus {
  border-bottom: 1px solid rgba(255, 255, 255, 0.3);
}
.search-button {
  color: white !important;
  cursor: pointer;
  margin-left: 2px;
  opacity: 0.8;
  transition: opacity 0.2s ease;
}
.search-button:hover {
  background-color: rgba(255, 255, 255, 0.1) !important;
  opacity: 1;
}
.search-button:disabled {
  opacity: 0.3 !important;
  cursor: default;
}
.search-icon-btn {
  position: absolute;
  top: 5px;
  right: 15px; /* 搜索按钮位置靠近右侧边缘 */
  z-index: 9;
  color: rgba(255, 255, 255, 0.7);
  background-color: rgba(0, 0, 0, 0.3);
  border-radius: 4px;
  transition: all 0.2s ease;
  opacity: 0.6;
}
.search-icon-btn:hover {
  color: white;
  background-color: rgba(0, 0, 0, 0.5);
  opacity: 1;
}
`;

// 使用对象来存储所有终端实例，实现跨标签页缓存
const terminalCache = {};
const fitAddonCache = {};
const processCache = {};

const SHARED_STYLE_ELEMENT_ID = "web-terminal-shared-style";
let sharedStyleElement = null;

const ensureSharedTerminalStyles = () => {
  if (sharedStyleElement && document.contains(sharedStyleElement)) {
    return sharedStyleElement;
  }

  const existing = document.getElementById(SHARED_STYLE_ELEMENT_ID);
  if (existing) {
    sharedStyleElement = existing;
    return sharedStyleElement;
  }

  const style = document.createElement("style");
  style.id = SHARED_STYLE_ELEMENT_ID;
  document.head.appendChild(style);
  sharedStyleElement = style;
  return sharedStyleElement;
};

const terminalGeometryCache = new Map();

const getGeometryKey = (processId, tabId) => {
  if (processId) return `process:${processId}`;
  if (tabId) return `tab:${tabId}`;
  return null;
};

const clearGeometryFor = (processId, tabId) => {
  const key = getGeometryKey(processId, tabId);
  if (key) {
    terminalGeometryCache.delete(key);
  }
};

const normalizeGeometry = (cols = 0, rows = 0) => ({
  cols: Math.max(Math.floor(cols) || 1, 1),
  rows: Math.max(Math.floor(rows) || 1, 1),
});

const shouldTransmitGeometry = (processId, tabId, cols, rows) => {
  const key = getGeometryKey(processId, tabId);
  if (!key) {
    return { key: null, cols, rows, changed: false };
  }

  const { cols: normalizedCols, rows: normalizedRows } = normalizeGeometry(cols, rows);
  const cached = terminalGeometryCache.get(key);
  if (cached && cached.cols === normalizedCols && cached.rows === normalizedRows) {
    return { key, cols: normalizedCols, rows: normalizedRows, changed: false };
  }

  terminalGeometryCache.set(key, { cols: normalizedCols, rows: normalizedRows });
  return { key, cols: normalizedCols, rows: normalizedRows, changed: true };
};

const sendResizeIfNeeded = (processId, tabId, cols, rows) => {
  const { key, cols: nextCols, rows: nextRows, changed } = shouldTransmitGeometry(
    processId,
    tabId,
    cols,
    rows,
  );

  if (!changed || !window.terminalAPI?.resizeTerminal) {
    return Promise.resolve();
  }

  return window.terminalAPI
    .resizeTerminal(processId || tabId, nextCols, nextRows)
    .catch((error) => {
      if (key) {
        terminalGeometryCache.delete(key);
      }
    });
};

// 将processCache暴露到全局window对象，以便其他模块可以访问进程ID映射
window.processCache = processCache;

// 字符度量计算辅助函数
const getCharacterMetrics = (term) => {
  if (!term || !term.element) return null;

  try {
    // 获取终端的实际字符尺寸
    const charMeasureElement = term.element.querySelector(
      ".xterm-char-measure-element",
    );
    let charWidth = 9; // 默认值
    let charHeight = 17; // 默认值

    // 尝试多种方法获取精确的字符宽度
    if (
      term._core?._renderService?._renderer?.dimensions?.actualCellWidth > 0
    ) {
      // 优先使用渲染器提供的精确值
      charWidth =
        term._core._renderService._renderer.dimensions.actualCellWidth;
    } else if (term._core?._renderService?.dimensions?.actualCellWidth > 0) {
      // 兼容旧版本的路径
      charWidth = term._core._renderService.dimensions.actualCellWidth;
    } else if (charMeasureElement) {
      // 回退到DOM元素测量
      charWidth = charMeasureElement.getBoundingClientRect().width;
    }

    // 尝试多种方法获取精确的字符高度
    if (
      term._core?._renderService?._renderer?.dimensions?.actualCellHeight > 0
    ) {
      // 优先使用渲染器提供的精确值
      charHeight =
        term._core._renderService._renderer.dimensions.actualCellHeight;
    } else if (term._core?._renderService?.dimensions?.actualCellHeight > 0) {
      // 兼容旧版本的路径
      charHeight = term._core._renderService.dimensions.actualCellHeight;
    } else if (charMeasureElement) {
      // 回退到DOM元素测量
      charHeight = charMeasureElement.getBoundingClientRect().height;
    }

    // 确保尺寸至少为1，避免0或负值
    charWidth = Math.max(1, Math.round(charWidth * 100) / 100);
    charHeight = Math.max(1, Math.round(charHeight * 100) / 100);

    // 获取终端视口和屏幕的元素
    const viewport = term.element.querySelector(".xterm-viewport");
    const screen = term.element.querySelector(".xterm-screen");

    // 获取视口和屏幕的位置信息
    const viewportRect = viewport?.getBoundingClientRect() || {
      left: 0,
      top: 0,
    };
    const screenRect = screen?.getBoundingClientRect() || { left: 0, top: 0 };

    // 计算滚动偏移量
    const scrollTop = viewport ? viewport.scrollTop : 0;
    const scrollLeft = viewport ? viewport.scrollLeft : 0;

    // 考虑终端的滚动状态
    const terminalScrollPosition = term.buffer?.active?.viewportY || 0;
    const terminalHasScrolled = terminalScrollPosition > 0;

    // 计算偏移量时考虑终端的缩放因子
    const termScale = term._core?.scaleFactor || 1;

    return {
      charWidth,
      charHeight,
      viewportOffset: {
        x: viewportRect.left,
        y: viewportRect.top,
        scrollLeft,
        scrollTop,
      },
      screenOffset: {
        x: screenRect.left,
        y: screenRect.top,
      },
      scrollPosition: terminalScrollPosition,
      hasScrolled: terminalHasScrolled,
      scaleFactor: termScale,
      // 附加调试信息，用于排查问题
      debug: {
        viewportRect: {
          left: viewportRect.left,
          top: viewportRect.top,
          width: viewportRect.width,
          height: viewportRect.height,
        },
        screenRect: {
          left: screenRect.left,
          top: screenRect.top,
          width: screenRect.width,
          height: screenRect.height,
        },
      },
    };
  } catch (error) {
    // 获取字符度量失败，使用默认值
    console.warn("Failed to get character metrics:", error);
    return {
      charWidth: 9,
      charHeight: 17,
      viewportOffset: { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 },
      screenOffset: { x: 0, y: 0 },
      scrollPosition: 0,
      hasScrolled: false,
      scaleFactor: 1,
    };
  }
};

// 字符网格坐标转换函数
const getCharacterGridPosition = (term, pixelX, pixelY) => {
  const metrics = getCharacterMetrics(term);
  if (!metrics) return null;

  try {
    // 计算相对于终端屏幕的像素位置
    const relativeX = pixelX - metrics.screenOffset.x;
    const relativeY = pixelY - metrics.screenOffset.y;

    // 转换为字符网格坐标
    const col = Math.floor(relativeX / metrics.charWidth);
    const row = Math.floor(relativeY / metrics.charHeight);

    // 确保坐标在有效范围内
    const boundedCol = Math.max(0, Math.min(col, term.cols - 1));
    const boundedRow = Math.max(0, Math.min(row, term.rows - 1));

    return {
      col: boundedCol,
      row: boundedRow,
      pixelX: boundedCol * metrics.charWidth + metrics.screenOffset.x,
      pixelY: boundedRow * metrics.charHeight + metrics.screenOffset.y,
    };
  } catch (error) {
    // 字符网格坐标转换失败
    return null;
  }
};

// 优化的终端尺寸调整函数，使用防抖机制减少频繁调用
const forceResizeTerminal = debounce(
  (term, container, processId, tabId, fitAddon) => {
    try {
      if (!container || !term || !fitAddon) {
        return;
      }

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }

      fitAddon.fit();

      const cols = term.cols;
      const rows = term.rows;
      const resolvedProcessId = processId || processCache[tabId];

      if (resolvedProcessId) {
        sendResizeIfNeeded(resolvedProcessId, tabId, cols, rows);
      }
    } catch (error) {
      // Error in forceResizeTerminal
    }
  },
  30, // 从默认防抖时间减少到30ms，提高响应速度
);

// 添加辅助函数，用于处理多行粘贴文本，防止注释符号和缩进异常
const processMultilineInput = (text, options = {}) => {
  if (!text || typeof text !== "string") return text;

  // 如果文本不包含换行符，直接返回
  if (!text.includes("\n")) return text;

  // 分割成行数组
  const lines = text.split(/\r?\n/);
  if (lines.length <= 1) return text;

  // 常见的注释符号模式
  const commentPatterns = [
    /^\s*\/\//, // JavaScript, C, C++, Java 等的单行注释 //
    /^\s*#/, // Python, Bash, Ruby 等的注释 #
    /^\s*--/, // SQL, Lua 等的注释 --
    /^\s*;/, // Assembly, INI 等的注释 ;
    /^\s*%/, // LaTeX, Matlab 等的注释 %
    /^\s*\/\*/, // C, Java 等的多行注释开始 /*
    /^\s*\*\//, // C, Java 等的多行注释结束 */
  ];

  // 判断当前行是否包含注释
  const isCommentLine = (line) => {
    return commentPatterns.some((pattern) => pattern.test(line));
  };

  // 检测是否有注释行
  const hasCommentLines = lines.some((line) => isCommentLine(line));

  // 如果检测到注释行并且开启了逐行发送选项（默认为true），返回特殊标记对象
  // 这将触发调用方进行逐行处理
  if (hasCommentLines && options.sendLineByLine !== false) {
    return {
      type: "multiline-with-comments",
      lines: lines,
      isCommentLine: isCommentLine,
    };
  }
  //统一使用'\n'
  const lineEnding = "\n";

  // 处理每一行
  let result = "";
  let isInCommentBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 检测是否是注释行
    const hasComment = isCommentLine(line);

    // 检测多行注释块
    if (line.includes("/*")) isInCommentBlock = true;
    if (line.includes("*/")) isInCommentBlock = false;

    // 添加当前行
    result += line;

    // 如果不是最后一行，添加换行符
    if (i < lines.length - 1) {
      // 如果当前行包含注释或者在注释块内，添加一个额外的回车键输入
      // 这会触发终端执行当前行，防止注释符号影响下一行
      if (hasComment || isInCommentBlock) {
        result += lineEnding + String.fromCharCode(13); // 回车键
      } else {
        result += lineEnding;
      }
    }
  }

  return result;
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
  const theme = useTheme();
  const eventManager = useEventManager(); // 使用统一的事件管理器
  // 添加内容更新标志，用于跟踪终端内容是否有更新
  const [contentUpdated, setContentUpdated] = useState(false);

  // 添加最近粘贴时间引用，用于防止重复粘贴
  const lastPasteTimeRef = useRef(0);
  const highlightRefreshFrameRef = useRef(null);

  const scheduleHighlightRefresh = useCallback(
    (termInstance) => {
      if (!termInstance || typeof termInstance.refresh !== "function") {
        return;
      }

      if (
        highlightRefreshFrameRef.current &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(highlightRefreshFrameRef.current);
      }

      if (typeof requestAnimationFrame !== "function") {
        termInstance.refresh(0, termInstance.rows - 1);
        highlightRefreshFrameRef.current = null;
        return;
      }

      highlightRefreshFrameRef.current = requestAnimationFrame(() => {
        highlightRefreshFrameRef.current = null;
        termInstance.refresh(0, termInstance.rows - 1);
      });
    },
    [],
  );

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedText, setSelectedText] = useState("");
  const searchAddonRef = useRef(null);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState({ count: 0, current: 0 });
  const [noMatchFound, setNoMatchFound] = useState(false);

  const [inEditorMode, setInEditorMode] = useState(false);

  // 命令执行状态跟踪
  const [isCommandExecuting, setIsCommandExecuting] = useState(false);
  const lastExecutedCommandTimeRef = useRef(0);
  const lastExecutedCommandRef = useRef("");

  // 新增：确认提示状态
  const [isConfirmationPromptActive, setIsConfirmationPromptActive] =
    useState(false);

  // 命令建议相关状态
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [currentInput, setCurrentInput] = useState("");
  const [suggestionsHiddenByEsc, setSuggestionsHiddenByEsc] = useState(false);
  // 用户手动关闭命令快捷窗口后抑制显示，直到下一次按下回车才恢复
  const [suggestionsSuppressedUntilEnter, setSuggestionsSuppressedUntilEnter] =
    useState(false);

  // 密码提示检测模式（支持多语言和格式）
  const passwordPromptPatterns = [
    // 英文密码提示
    /password\s*[:：]/i,
    /passwd\s*[:：]/i,
    /enter\s+password/i,
    /\(password\)/i,
    /passphrase\s*[:：]/i,

    // SSH相关
    /'s\s+password\s*[:：]/,
    /ssh\s+password/i,

    // sudo相关
    /\[sudo\]\s+password\s+for/i,
    /sudo\s+password/i,

    // 中文密码提示
    /密码\s*[:：]/,
    /请输入密码/,
    /输入密码/,

    // PIN和Token
    /\bPIN\s*[:：]/i,
    /\btoken\s*[:：]/i,
    /authentication\s*[:：]/i,
    /authenticate/i,

    // 其他认证提示
    /enter\s+passphrase/i,
    /enter\s+pin/i,
    /security\s+code/i,
    /verification\s+code/i,
    /验证码/,

    // 数据库相关
    /database\s+password/i,
    /db\s+password/i,

    // 常见的密码输入提示结尾
    /password\s*$/i,
    /密码\s*$/,
  ];

  // 确认提示检测模式
  const confirmationPromptPatterns = [
    // 标准确认提示格式
    /\(yes\/no\)/i,
    /\(y\/n\)/i,
    /\[Y\/n\]/,
    /\[y\/N\]/,
    // 支持 [y]/n 与 y/[n] 形式
    /\[\s*[yY]\s*\]\s*\/\s*[nN]/,
    /[yY]\s*\/\s*\[\s*[nN]\s*\]/,
    /\[\s*[yY]\s*\]\s*\/\s*\[\s*[nN]\s*\]/,
    /\[yes\/no\]/i,
    /\[YES\/NO\]/i,
    // 带问号的确认提示
    /continue\s*\?/i,
    /proceed\s*\?/i,
    /confirm\s*\?/i,
    /are\s+you\s+sure\s*\?/i,
    // 带冒号的确认提示
    /\(y\/n\)\s*:/i,
    /\[y\/n\]\s*:/i,
    /confirm\s*:/i,
    // 中文确认提示
    /是\/否/,
    /确认/,
    /\(确定\/取消\)/,
    /\[是\/否\]/,
    /\[Y\/N\]/,
    // 确认提示在句子中间
    /\s+\(y\/n\)\s+/i,
    /\s+\[y\/n\]\s+/i,
    // 确认提示在句子开头
    /^\s*\(y\/n\)\s+/i,
    /^\s*\[y\/n\]\s+/i,
    // 确认提示在句子末尾
    /\s+\(y\/n\)\s*$/i,
    /\s+\[y\/n\]\s*$/i,
    /\s+\[\s*[yY]\s*\]\s*\/\s*[nN]\s*$/i,
    /\s+[yY]\s*\/\s*\[\s*[nN]\s*\]\s*$/i,
    // 带有yes/no的提示
    /yes\s+or\s+no/i,
    /y\s+or\s+n/i,
    // 其他常见格式
    /type\s+['"]*y['"]*\s+to\s+/i,
    /press\s+['"]*y['"]*\s+to\s+/i,
    /enter\s+['"]*y['"]*\s+to\s+/i,
  ];

  // 密码输入保护：跟踪是否正在等待密码输入
  const isPasswordPromptActiveRef = useRef(false);

  // 跟踪最近的终端输出行，用于上下文分析
  const recentOutputLinesRef = useRef([]);
  // 最大保存的输出行数
  const MAX_RECENT_LINES = 10;

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
      const metrics = getCharacterMetrics(termRef.current);
      if (!metrics) return;

      // 获取选择元素的当前位置
      const computedStyle = window.getComputedStyle(primaryElement);
      const currentLeft = parseFloat(computedStyle.left) || 0;
      const currentTop = parseFloat(computedStyle.top) || 0;
      const currentWidth = parseFloat(computedStyle.width) || 0;
      const currentHeight = parseFloat(computedStyle.height) || 0;

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
    } catch (error) {
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
  const scheduleSelectionAdjustment = () => {
    // 使用EventManager管理定时器
    eventManager.setTimeout(() => {
      requestAnimationFrame(adjustSelectionElements);
    }, 50); // 减少延迟以提高响应速度
  };

  // 添加选择事件监听，确保在用户通过键盘选择时也能调整选择区域
  const handleSelectionChange = (e) => {
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
    // 鼠标中键点击 (e.button === 1 表示鼠标中键)
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation(); // 阻止事件传播，进一步防止默认行为

      // 检查是否是重复粘贴（100毫秒内的操作视为重复）
      const now = Date.now();
      if (now - lastPasteTimeRef.current < 100) {
        // 忽略短时间内的重复粘贴请求
        return;
      }

      // 更新最后粘贴时间
      lastPasteTimeRef.current = now;

      // 隐藏命令建议窗口，避免与粘贴操作冲突
      setShowSuggestions(false);
      setSuggestions([]);
      setCurrentInput("");
      setSuggestionsHiddenByEsc(false);

      navigator.clipboard.readText().then((text) => {
        if (text && processCache[tabId]) {
          // 使用预处理函数处理多行文本，防止注释和缩进问题
          const processedText = processMultilineInput(text);

          // 检查是否需要逐行发送（含有注释的多行文本）
          if (
            processedText &&
            typeof processedText === "object" &&
            processedText.type === "multiline-with-comments"
          ) {
            // 使用EventManager管理逐行发送文本的延迟
            processedText.lines.forEach((line, index) => {
              eventManager.setTimeout(() => {
                window.terminalAPI.sendToProcess(
                  processCache[tabId],
                  line + (index < processedText.lines.length - 1 ? "\n" : ""),
                );
              }, index * 50); // 50毫秒的延迟，可以根据实际情况调整
            });
          } else {
            // 正常发送处理后的文本
            window.terminalAPI.sendToProcess(
              processCache[tabId],
              processedText,
            );
          }
        }
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

  // 分析确认对话上下文的函数
  const analyzeConfirmationContext = useCallback(
    (cleanData) => {
      // 将当前输出添加到最近输出行
      if (cleanData && cleanData.trim()) {
        const lines = cleanData.split(/\r?\n/).filter((line) => line.trim());
        if (lines.length > 0) {
          // 添加新行并保持最大行数限制
          recentOutputLinesRef.current = [
            ...lines,
            ...recentOutputLinesRef.current,
          ].slice(0, MAX_RECENT_LINES);
        }
      }

      // 检查最近几行是否构成确认对话上下文
      // 1. 检查是否有确认提示
      const hasExplicitPrompt = recentOutputLinesRef.current.some((line) =>
        confirmationPromptPatterns.some((pattern) => pattern.test(line)),
      );

      if (hasExplicitPrompt) {
        return true;
      }

      // 2. 检查是否有隐含的确认对话特征
      // 例如：短问题后跟空行，等待用户输入y/n
      if (recentOutputLinesRef.current.length >= 2) {
        const lastLine = recentOutputLinesRef.current[0].trim();
        const prevLine = recentOutputLinesRef.current[1].trim();

        // 检查最后一行是否为空或只有提示符，前一行是否是问句
        const isLastLineEmpty = lastLine === "" || /[>$#]\s*$/.test(lastLine);
        const isPrevLineQuestion =
          /\?\s*$/.test(prevLine) ||
          /continue|proceed|confirm|overwrite|replace|delete/i.test(prevLine);

        if (isLastLineEmpty && isPrevLineQuestion) {
          return true;
        }
      }

      return false;
    },
    [confirmationPromptPatterns],
  );

  // 检测提示的函数（包括密码提示和确认提示）
  const checkForPrompts = useCallback(
    (data) => {
      // 确保数据存在
      if (!data) return;

      // 转换为字符串
      const dataStr = typeof data === "string" ? data : data.toString();

      // 忽略ANSI转义序列
      const cleanData = dataStr.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");

      // 检查是否包含密码提示
      const hasPasswordPrompt = passwordPromptPatterns.some((pattern) =>
        pattern.test(cleanData),
      );

      // 检查是否包含确认提示（直接匹配或通过上下文分析）
      const hasDirectConfirmationPrompt = confirmationPromptPatterns.some(
        (pattern) => pattern.test(cleanData),
      );

      // 通过上下文分析检测确认对话
      const hasConfirmationContext = analyzeConfirmationContext(cleanData);

      if (hasPasswordPrompt) {
        isPasswordPromptActiveRef.current = true;
        // 同时更新React状态
        setIsConfirmationPromptActive(true);
      } else if (hasDirectConfirmationPrompt || hasConfirmationContext) {
        // 对于确认提示，也设置标志避免记录到历史
        isPasswordPromptActiveRef.current = true;
        setIsConfirmationPromptActive(true);
      }
    },
    [
      passwordPromptPatterns,
      confirmationPromptPatterns,
      analyzeConfirmationContext,
    ],
  );

  // 定义检测用户输入命令的函数，用于监控特殊命令执行
  const setupCommandDetection = (
    term,
    processId,
    isRemoteInput = false,
    disposables = [],
  ) => {
    // 用于存储用户正在输入的命令
    let currentInputBuffer = "";
    // 标记上一个按键是否是特殊键序列的开始
    let isEscapeSequence = false;
    // 用于存储转义序列
    let escapeBuffer = "";
    // 用于记录最后一个执行的命令，避免重复添加到历史记录
    let lastExecutedCommand = "";
    // 跟踪编辑器模式状态
    let inEditorMode = false;
    // 标记是否刚刚使用了Tab补全
    let tabCompletionUsed = false;
    // 用于临时存储当前行位置和内容，以便在Tab补全后能恢复正确位置
    let currentLineBeforeTab = null;

    // 清空最近输出行缓存，确保每个新会话都从空白开始
    recentOutputLinesRef.current = [];

    // 识别编辑器命令的正则表达式
    const editorCommandRegex =
      /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;

    // 添加buffer类型监听，用于检测编辑器模式
    // xterm.js在全屏应用（如vi）运行时会切换到alternate buffer
    const bufferTypeObserver = {
      handleBufferTypeChange: (type) => {
        if (type === "alternate") {
          // 进入编辑器/全屏应用模式
          inEditorMode = true;
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
          if (inEditorMode) {
            inEditorMode = false;
            setInEditorMode(false);

            // 通知主进程编辑器模式状态变更
            if (processId && window.terminalAPI?.notifyEditorModeChange) {
              window.terminalAPI.notifyEditorModeChange(processId, false);
            }
          }
        }
      },
    };

    // 存储事件监听器的 disposables 以便清理
    // 使用传入的 disposables 数组

    // 监听buffer类型变化
    if (term.buffer && typeof term.buffer.onBufferChange === "function") {
      // 如果xterm.js版本支持此方法
      const bufferDisposable = term.buffer.onBufferChange((e) => {
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
      // 检查是否是ESC开头的转义序列（通常是方向键等特殊键）
      if (data === "\x1b") {
        isEscapeSequence = true;
        escapeBuffer = data;
        // 方向键等特殊键不会影响命令历史记录，直接发送到进程
        if (processId && !shouldSkipSendToProcess) {
          window.terminalAPI.sendToProcess(processId, data);
        }
        return;
      }

      // 处理转义序列的后续字符
      if (isEscapeSequence) {
        escapeBuffer += data;

        // 检查是否是常见的转义序列结束符
        if (/[A-Za-z~]/.test(data)) {
          isEscapeSequence = false;
          escapeBuffer = "";
        }

        // 转义序列不会记录到命令历史，直接发送到进程
        if (processId && !shouldSkipSendToProcess) {
          window.terminalAPI.sendToProcess(processId, data);
        }
        return;
      }

      // 处理退格键
      if (data === "\b" || data === "\x7f") {
        // 只有在非Tab补全状态下才处理退格
        if (!tabCompletionUsed && currentInputBuffer.length > 0) {
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
            }
          }
        }
        // 发送数据到进程
        if (processId && !shouldSkipSendToProcess) {
          window.terminalAPI.sendToProcess(processId, data);
        }
        return;
      }

      // 处理Tab键，标记Tab补全被使用
      if (data === "\t") {
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

        // 发送数据到进程
        if (processId && !shouldSkipSendToProcess) {
          window.terminalAPI.sendToProcess(processId, data);
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

        // 设置命令执行状态，防止显示建议
        setIsCommandExecuting(true);

        try {
          // 获取终端的最后一行内容（可能包含用户输入的命令）
          const lastLine =
            term.buffer.active
              .getLine(term.buffer.active.cursorY)
              ?.translateToString() || "";

          // 提取用户输入的命令（去除提示符）
          // 改进提示符检测，支持更多类型的shell提示符
          const commandMatch = lastLine.match(
            /(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w\/.]+[$#>])\s*(.+)$/,
          );

          // 获取实际命令，优先使用终端行显示的内容（包含tab补全后的结果）
          let command = "";
          if (
            commandMatch &&
            commandMatch[1] &&
            commandMatch[1].trim() !== ""
          ) {
            // 优先使用从终端行获取的命令，这包含了Tab补全后的结果
            command = commandMatch[1].trim();
          } else if (currentInputBuffer.trim() !== "") {
            // 如果无法从终端行获取，回退到使用输入缓冲区
            command = currentInputBuffer.trim();
          }

          // 特殊处理：如果使用了Tab补全，直接使用当前行的完整内容
          if (tabCompletionUsed) {
            // 从当前行获取Tab补全后的完整命令
            const fullCommand = lastLine.match(
              /(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w\/.]+[$#>])\s*(.+)$/,
            );
            if (fullCommand && fullCommand[1] && fullCommand[1].trim() !== "") {
              command = fullCommand[1].trim();
            }
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

          // 密码输入保护：如果当前处于密码输入状态，不记录到历史
          const shouldSkipHistory = isPasswordPromptActiveRef.current;

          // 重置密码输入状态（用户已经输入并按下回车）
          if (isPasswordPromptActiveRef.current) {
            isPasswordPromptActiveRef.current = false;
            setIsConfirmationPromptActive(false);
          }

          // 增强的确认响应检测：检查整行是否包含确认对话特征
          const hasConfirmationPromptInLine =
            /(\[?[yY]\/[nN]\]?|\(?[yY]\/[nN]\)?|yes\/no|YES\/NO|是\/否)/i.test(
              lastLine,
            );

          // 检查用户输入是否为确认响应
          const isUserConfirmationInput =
            /^(y|n|yes|no|是|否|确认|取消)$/i.test(command) ||
            /^[yYnN]$/i.test(command);

          // 只有当整行包含确认提示且用户输入为确认响应时，才认定为确认响应
          const isConfirmationResponse =
            hasConfirmationPromptInLine && isUserConfirmationInput;

          // 确保命令不为空且不与上一次执行的命令相同，并且不在编辑器模式中
          // 注意：inEditorMode可能已经被buffer类型检测器更新
          if (
            command &&
            command !== lastExecutedCommand &&
            !inEditorMode &&
            !shouldSkipHistory &&
            !isConfirmationResponse
          ) {
            lastExecutedCommand = command;

            // 记录执行的命令和时间，用于防止后续显示该命令的建议
            lastExecutedCommandRef.current = command;
            lastExecutedCommandTimeRef.current = Date.now();

            // 只有不是通过建议选择的命令才添加到历史记录
            if (
              !suggestionSelectedRef.current &&
              window.terminalAPI?.addToCommandHistory
            ) {
              window.terminalAPI.addToCommandHistory(command);
            }
          }

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

          // 延迟重置命令执行状态，给足够时间让输出完成
          setTimeout(() => {
            setIsCommandExecuting(false);
          }, 100);

          // 检查这一行是否包含常见的全屏应用命令
          if (
            /\b(top|htop|vi|vim|nano|less|more|watch|tail -f)\b/.test(lastLine)
          ) {
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
        } catch (error) {
          // 忽略任何错误，不影响正常功能
          // 即使发生错误也要重置命令执行状态
          setTimeout(() => {
            setIsCommandExecuting(false);
          }, 100);
        }

        // 发送回车键到进程
        if (processId) {
          window.terminalAPI.sendToProcess(processId, data);
        }
        return;
      } else if (data !== "\t") {
        // 对于非Tab键输入，只有在非Tab补全状态下才追加到输入缓冲区
        if (!tabCompletionUsed) {
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
          !inEditorMode &&
          !tabCompletionUsed &&
          data.length === 1 &&
          data.charCodeAt(0) >= 32 &&
          data.charCodeAt(0) <= 126
        ) {
          setCurrentInput(currentInputBuffer);

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
        window.terminalAPI.sendToProcess(processId, data);
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
            if (/(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w\/.]+[$#>])\s*$/.test(line)) {
              inEditorMode = false;

              // 通知主进程编辑器模式状态变更
              if (processId && window.terminalAPI?.notifyEditorModeChange) {
                window.terminalAPI.notifyEditorModeChange(processId, false);
              }
              break;
            }
          }
        }
      } catch (error) {
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
            const commandMatch = currentLine.match(
              /(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w\/.]+[$#>])\s*(.+)$/,
            );
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
        } catch (error) {
          // 处理Tab补全后内容时出错
        }
      }
    });

    if (
      onRenderDisposable &&
      typeof onRenderDisposable.dispose === "function"
    ) {
      disposables.push(onRenderDisposable);
    }

    // 添加 onData disposable 到列表
    if (onDataDisposable && typeof onDataDisposable.dispose === "function") {
      disposables.push(onDataDisposable);
    }
  };

  // 定义响应主题模式的终端主题
  const terminalTheme = {
    // 背景色根据应用主题模式设置
    background: theme.palette.mode === "light" ? "#ffffff" : "#1e1e1e",
    // 文本颜色根据背景色调整，浅色背景使用暗色文本
    foreground: theme.palette.mode === "light" ? "#000000" : "#ffffff",
    // 光标颜色根据背景自动调整
    cursor: theme.palette.mode === "light" ? "#000000" : "#ffffff",
    // 选择文本的背景色，使用更透明的颜色以避免遮挡字符
    selectionBackground:
      theme.palette.mode === "light"
        ? "rgba(0, 120, 215, 0.3)" // 降低透明度，避免覆盖文字
        : "rgba(255, 255, 170, 0.3)", // 降低透明度，避免覆盖文字
    // 选择文本的前景色，保持原文字颜色可见
    selectionForeground: undefined, // 不设置前景色，保持原文字颜色
    // 基础颜色
    black: "#000000",
    red: "#cc0000",
    green: "#4e9a06",
    yellow: "#c4a000",
    blue: "#3465a4",
    magenta: "#75507b",
    cyan: "#06989a",
    white: "#d3d7cf",
    // 亮色版本
    brightBlack: theme.palette.mode === "light" ? "#555753" : "#555753",
    brightRed: "#ef2929",
    brightGreen: "#8ae234",
    brightYellow: "#fce94f",
    brightBlue: "#729fcf",
    brightMagenta: "#ad7fa8",
    brightCyan: "#34e2e2",
    brightWhite: "#eeeeec",
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
        return {
          fontSize: settings.terminalFontSize || 14,
          fontFamily: getFontFamilyString(settings.terminalFont || "Fira Code"),
        };
      }
    } catch (error) {
      // Failed to load font settings from config
    }
    return {
      fontSize: 14,
      fontFamily: getFontFamilyString("Fira Code"),
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
        } catch (error) {
          // Failed to kill process
        }
        clearGeometryFor(processCache[tabId], tabId);
        delete processCache[tabId];
      }

      // 清除旧终端
      try {
        terminalCache[tabId].dispose();
      } catch (error) {
        // Failed to dispose terminal
      }
      delete terminalCache[tabId];
      delete fitAddonCache[tabId];
    }
  }, [refreshKey, tabId]);

  // 监听设置变更事件
  useEffect(() => {
    const handleSettingsChanged = async (event) => {
      const { terminalFontSize, terminalFont } = event.detail;

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

        // 使用EventManager管理定时器
        eventManager.setTimeout(() => {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit();

            // 同步到后端进程
            const processId = processCache[tabId];
            if (processId) {
              const cachedTerminal = terminalCache[tabId];
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
    eventManager.addEventListener(
      window,
      "settingsChanged",
      handleSettingsChanged,
    );
  }, [tabId, eventManager]);

  useEffect(() => {
    // 添加全局样式
    const styleElement = ensureSharedTerminalStyles();
    if (styleElement.textContent !== terminalStyles + searchBarStyles) {
      styleElement.textContent = terminalStyles + searchBarStyles;
    }

    // 存储终端事件监听器的 disposables 以便清理
    const terminalDisposables = [];

    // 初始化 xterm.js
    if (terminalRef.current) {
      let term;
      let fitAddon;
      let searchAddon;

      // 检查缓存中是否已有此终端实例
      if (terminalCache[tabId]) {
        // 使用缓存的终端实例
        term = terminalCache[tabId];
        fitAddon = fitAddonCache[tabId];

        // 当主题变化时，更新终端主题
        term.options.theme = terminalTheme;

        // 搜索插件需要重新创建
        searchAddon = new SearchAddon();
        term.loadAddon(searchAddon);

        // 重新打开终端并附加到DOM
        term.open(terminalRef.current);

        // 如果标签页不活跃，避免立即触发resize以减少性能影响
        if (isActive) {
          // 使用EventManager管理确保适配容器大小
          eventManager.setTimeout(() => {
            fitAddon.fit();
          }, 0);
        }
      } else {
        // 创建新的终端实例
        term = new Terminal({
          cursorBlink: true,
          theme: terminalTheme, // 使用固定的终端主题
          fontFamily:
            '"Fira Code", "Consolas", "Monaco", "Courier New", monospace',
          fontSize: 14, // 默认大小，稍后会更新
          scrollback: 10000,
          allowTransparency: true,
          cols: 120, // 设置更宽的初始列数
          rows: 30, // 设置初始行数
          convertEol: true, // 自动将行尾换行符转换为CRLF
          disableStdin: false,
          rendererType: "canvas", // 使用canvas渲染器以保持稳定性
          termName: "xterm-256color", // 使用更高级的终端类型
          allowProposedApi: true, // 允许使用提议的API
          rightClickSelectsWord: false, // 禁用右键点击选中单词，使用自定义右键菜单
          copyOnSelect: false, // 选中后不自动复制
          // 添加选择相关的配置
          selectionScrollSpeed: 5, // 选择时的滚动速度
          fastScrollModifier: "shift", // 快速滚动修饰键
          // 优化字符渲染
          letterSpacing: 0, // 字符间距
          lineHeight: 1.0, // 行高
          // 禁用一些可能影响选择精度的特性
          macOptionIsMeta: false,
          macOptionClickForcesSelection: false,
        });

        // 异步加载字体设置并应用
        (async () => {
          try {
            const fontSettings = await getFontSettings();
            term.options.fontSize = fontSettings.fontSize;
            term.options.fontFamily = fontSettings.fontFamily;
            // 使用EventManager管理应用字体设置后自动调整大小
            eventManager.setTimeout(() => {
              if (fitAddon) {
                fitAddon.fit();
              }
            }, 0);
          } catch (error) {
            // Failed to apply font settings
          }
        })();

        // 创建并加载插件
        fitAddon = new FitAddon();
        searchAddon = new SearchAddon();

        // 自定义WebLinksAddon的链接处理逻辑，使用系统默认浏览器打开链接
        const webLinksAddon = new WebLinksAddon((event, uri) => {
          // 阻止默认行为（在应用内打开）
          event.preventDefault();

          // 使用预加载脚本中定义的API在系统默认浏览器中打开链接
          if (window.terminalAPI && window.terminalAPI.openExternal) {
            window.terminalAPI.openExternal(uri).catch((err) => {
              // 打开链接失败
            });
          } else {
            // terminalAPI.openExternal不可用，无法打开链接
          }
        });

        term.loadAddon(fitAddon);
        term.loadAddon(searchAddon);
        term.loadAddon(webLinksAddon);

        // 打开终端
        term.open(terminalRef.current);

        // 使用EventManager管理确保适配容器大小
        eventManager.setTimeout(() => {
          fitAddon.fit();
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

          try {
            // 根据协议类型选择连接方式
            const connectPromise =
              sshConfig.protocol === "telnet"
                ? window.terminalAPI.startTelnet(sshConfig)
                : window.terminalAPI.startSSH(sshConfig);

            // 启动连接
            connectPromise
              .then((processId) => {
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

                  // 设置数据接收监听
                  setupDataListener(processId, term);

                  // 设置命令检测（包含密码提示检测）
                  setupCommandDetection(
                    term,
                    processId,
                    false,
                    terminalDisposables,
                  );

                  // 监听数据输出以检测密码提示（补充命令检测中的输出监听）
                  const onWriteParsedDisposable = term.onWriteParsed((data) => {
                    checkForPrompts(data);
                    scheduleHighlightRefresh(term);
                  });
                  if (
                    onWriteParsedDisposable &&
                    typeof onWriteParsedDisposable.dispose === "function"
                  ) {
                    terminalDisposables.push(onWriteParsedDisposable);
                  }

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
                const errorMsg = sshConfig.splitReconnect
                  ? `\r\n重连失败: ${error.message || "未知错误"}`
                  : `\r\n连接失败: ${error.message || "未知错误"}`;
                term.writeln(errorMsg);
              });
          } catch (error) {
            const errorMsg = sshConfig.splitReconnect
              ? `\r\n重连失败: ${error.message || "未知错误"}`
              : `\r\n连接失败: ${error.message || "未知错误"}`;
            term.writeln(errorMsg);
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
            navigator.clipboard.writeText(selection);
          }
        }
        // Ctrl+' 粘贴 (改为Ctrl+')
        else if (e.ctrlKey && e.key === "'") {
          e.preventDefault();

          // 检查是否是重复粘贴（100毫秒内的操作视为重复）
          const now = Date.now();
          if (now - lastPasteTimeRef.current < 100) {
            // 忽略短时间内的重复粘贴请求
            return;
          }

          // 更新最后粘贴时间
          lastPasteTimeRef.current = now;

          navigator.clipboard.readText().then((text) => {
            if (text && processCache[tabId]) {
              // 使用预处理函数处理多行文本，防止注释和缩进问题
              const processedText = processMultilineInput(text);
              window.terminalAPI.sendToProcess(
                processCache[tabId],
                processedText,
              );
            }
          });
        }
        // Ctrl+/ 搜索切换 (打开/关闭搜索栏)
        else if (e.ctrlKey && e.key === "/") {
          // 只有当前活跃的终端才处理搜索快捷键
          if (!isActive) return;

          e.preventDefault();
          e.stopPropagation();

          // 切换搜索栏状态：如果已显示则关闭，如果已关闭则打开
          setShowSearchBar((prev) => !prev);
        }
        // Esc 关闭搜索或建议
        else if (e.key === "Escape") {
          if (showSearchBar) {
            // 只有当前活跃的终端才处理搜索相关快捷键
            if (!isActive) return;
            e.preventDefault();
            setShowSearchBar(false);
          } else if (showSuggestions) {
            e.preventDefault();
            setShowSuggestions(false);
            setSuggestions([]);
            setSuggestionsHiddenByEsc(true);
            // 视为手动关闭：直到下一次回车前不再显示
            setSuggestionsSuppressedUntilEnter(true);
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
            if (!isActive) return;
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
            if (!isActive) return;
            e.preventDefault();
            handleSearchPrevious();
          }
        }
      };

      // 使用EventManager添加键盘事件监听
      eventManager.addEventListener(document, "keydown", handleKeyDown);

      // 使用EventManager添加鼠标事件监听
      if (terminalRef.current) {
        eventManager.addEventListener(
          terminalRef.current,
          "mousedown",
          handleMouseDown,
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
            sendResizeIfNeeded(processId, tabId, dimensions.cols, dimensions.rows);

            eventManager.setTimeout(() => {
              if (terminalRef.current && term && processCache[tabId]) {
                sendResizeIfNeeded(processCache[tabId], tabId, term.cols, term.rows);
                setContentUpdated(false);
              }
            }, 300);
          }
        } catch (error) {
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

            if (
              Math.abs(width - currentWidth) > 5 ||
              Math.abs(height - currentHeight) > 5
            ) {
              handleResize();
            }
          }
        },
        { debounceTime: 50 }, // 从100ms优化到50ms防抖，提高响应速度
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

            // 获取实际尺寸
            const cols = term.cols;
            const rows = term.rows;
            const processId = processCache[tabId];

            if (processId) {
              sendResizeIfNeeded(processId, tabId, cols, rows);
            }
          } catch (error) {}
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
      eventManager.setInterval(() => {
        // 只有当内容有更新时才检查并调整大小
        if (contentUpdated) {
          ensureTerminalSizeOnVisibilityChange();
        }
      }, 200); // 从100ms改为200ms，减轻性能负担

      // 添加定时器清理
      // 添加ResizeObserver到EventManager管理
      eventManager.addObserver(resizeObserver);

      // 添加自定义清理逻辑到EventManager
      eventManager.addCleanup(() => {
        // 清理terminalAPI监听器
        if (window.terminalAPI) {
          if (processCache[tabId]) {
            window.terminalAPI.removeOutputListener(processCache[tabId]);
          } else {
            window.terminalAPI.removeOutputListener();
          }
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
          } catch (err) {
            // Error detaching terminal
          }
        }

        // 移除样式元素
      });

      // 添加选择变化事件监听
      if (document.onselectionchange !== undefined) {
        eventManager.addEventListener(
          document,
          "selectionchange",
          handleSelectionChange,
        );
      }

      // EventManager会自动清理所有事件监听器、定时器和观察者
      return () => {
        // 清理终端事件监听器
        terminalDisposables.forEach((disposable) => {
          try {
            if (disposable && typeof disposable.dispose === "function") {
              disposable.dispose();
            }
          } catch (error) {
            // 忽略disposal错误
          }
        });
        terminalDisposables.length = 0; // 清空数组

        // 移除选择变化事件监听器
        eventManager.removeEventListener(
          document,
          "selectionchange",
          handleSelectionChange,
        );

        // 移除样式元素

        // 这个函数现在很简洁，因为EventManager处理了大部分清理工作
        // 组件卸载时的清理工作由EventManager处理
      };
    }
  }, [tabId, refreshKey, sshConfig, isActive, eventManager]);

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

  // 处理搜索
  const handleSearch = () => {
    if (searchAddonRef.current && searchTerm) {
      // 重置无匹配状态
      setNoMatchFound(false);

      try {
        const result = searchAddonRef.current.findNext(searchTerm);
        if (!result) {
          setNoMatchFound(true);
        } else {
          // 更新当前匹配位置
          if (searchResults.count > 0) {
            setSearchResults((prev) => ({
              ...prev,
              current: (prev.current % prev.count) + 1,
            }));
          }
        }
      } catch (error) {
        // Search error
        setNoMatchFound(true);
      }
    }
  };

  // 处理搜索上一个
  const handleSearchPrevious = () => {
    if (searchAddonRef.current && searchTerm) {
      // 重置无匹配状态
      setNoMatchFound(false);

      try {
        const result = searchAddonRef.current.findPrevious(searchTerm);
        if (!result) {
          setNoMatchFound(true);
        } else {
          // 更新当前匹配位置
          if (searchResults.count > 0) {
            setSearchResults((prev) => ({
              ...prev,
              current: prev.current <= 1 ? prev.count : prev.current - 1,
            }));
          }
        }
      } catch (error) {
        // Search error
        setNoMatchFound(true);
      }
    }
  };

  // 计算搜索结果数量
  const calculateSearchResults = (term) => {
    if (!term || !termRef.current) {
      setSearchResults({ count: 0, current: 0 });
      return;
    }

    // 简单估算匹配数量 (xterm.js SearchAddon没有直接提供计数方法)
    // 这是一个近似值，实际上需要更复杂的实现来获取准确计数
    const buffer = termRef.current.buffer.active;
    let count = 0;

    try {
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        if (line) {
          const text = line.translateToString();
          // 统计当前行中的匹配数
          let pos = 0;
          while ((pos = text.indexOf(term, pos)) !== -1) {
            count++;
            pos += term.length;
          }
        }
      }

      setSearchResults({ count, current: count > 0 ? 1 : 0 });
      setNoMatchFound(count === 0);
    } catch (error) {
      // 搜索结果计算失败，重置为默认值
      setSearchResults({ count: 0, current: 0 });
    }
  };

  // 当搜索词变化时计算匹配数
  useEffect(() => {
    if (searchTerm && termRef.current) {
      calculateSearchResults(searchTerm);
    } else {
      setSearchResults({ count: 0, current: 0 });
      setNoMatchFound(false);
    }
  }, [searchTerm]);

  // 当终端变为非活跃状态时，隐藏搜索栏
  useEffect(() => {
    if (!isActive && showSearchBar) {
      setShowSearchBar(false);
    }
  }, [isActive, showSearchBar]);

  // 处理快捷搜索选项
  const handleSearchFromMenu = () => {
    // 只有当前活跃的终端才处理搜索
    if (!isActive) return;
    setShowSearchBar(true);
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
      navigator.clipboard.writeText(selectedText).catch((err) => {
        // 复制到剪贴板失败
      });
    }
    handleClose();
  };

  // 粘贴剪贴板内容
  const handlePaste = () => {
    // 新增：粘贴时自动隐藏命令提示浮动窗口
    setShowSuggestions(false);
    setSuggestions([]);

    // 检查是否是重复粘贴（100毫秒内的操作视为重复）
    const now = Date.now();
    if (now - lastPasteTimeRef.current < 100) {
      // 忽略短时间内的重复粘贴请求
      handleClose();
      return;
    }

    // 更新最后粘贴时间
    lastPasteTimeRef.current = now;

    navigator.clipboard
      .readText()
      .then((text) => {
        if (text && termRef.current && processCache[tabId]) {
          // 检测文本是否包含中文字符
          const containsChinese = /[\u4e00-\u9fa5]/.test(text);

          // 使用预处理函数处理多行文本，防止注释和缩进问题
          let processedText = processMultilineInput(text);

          // 如果包含中文字符，确保正确编码
          if (containsChinese) {
            // 对于SSH连接，确保中文字符能够正确传输
            const processInfo =
              window.terminalAPI && window.terminalAPI.getProcessInfo
                ? window.terminalAPI.getProcessInfo(processCache[tabId])
                : null;

            if (processInfo && processInfo.type === "ssh2") {
              // 对于SSH连接，确保使用UTF-8编码
              if (typeof processedText === "string") {
                // 确保字符串是有效的UTF-8编码
                try {
                  // 使用TextEncoder确保UTF-8编码
                  const encoder = new TextEncoder();
                  const decoder = new TextDecoder("utf-8");
                  const encoded = encoder.encode(processedText);
                  processedText = decoder.decode(encoded);
                } catch (e) {
                  // 如果浏览器不支持TextEncoder/TextDecoder，使用备用方法
                  processedText = processedText
                    .split("")
                    .map((char) => {
                      // 对于中文字符，确保正确编码
                      if (/[\u4e00-\u9fa5]/.test(char)) {
                        return char;
                      }
                      return char;
                    })
                    .join("");
                }
              } else if (
                processedText &&
                typeof processedText === "object" &&
                processedText.type === "multiline-with-comments"
              ) {
                // 处理多行带注释的情况
                try {
                  // 使用TextEncoder确保UTF-8编码
                  const encoder = new TextEncoder();
                  const decoder = new TextDecoder("utf-8");
                  processedText.lines = processedText.lines.map((line) => {
                    const encoded = encoder.encode(line);
                    return decoder.decode(encoded);
                  });
                } catch (e) {
                  // 备用方法
                  processedText.lines = processedText.lines.map((line) => {
                    return line
                      .split("")
                      .map((char) => {
                        // 对于中文字符，确保正确编码
                        if (/[\u4e00-\u9fa5]/.test(char)) {
                          return char;
                        }
                        return char;
                      })
                      .join("");
                  });
                }
              }
            }
          }

          // 检查是否需要逐行发送（含有注释的多行文本）
          if (
            processedText &&
            typeof processedText === "object" &&
            processedText.type === "multiline-with-comments"
          ) {
            // 使用EventManager管理逐行发送文本的延迟
            processedText.lines.forEach((line, index) => {
              eventManager.setTimeout(() => {
                window.terminalAPI.sendToProcess(
                  processCache[tabId],
                  line + (index < processedText.lines.length - 1 ? "\n" : ""),
                );
              }, index * 50); // 50毫秒的延迟，可以根据实际情况调整
            });
          } else {
            // 正常发送处理后的文本
            window.terminalAPI.sendToProcess(
              processCache[tabId],
              processedText,
            );
          }
        }
      })
      .catch((err) => {
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
      } catch (error) {
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
      if (
        highlightRefreshFrameRef.current &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(highlightRefreshFrameRef.current);
      }
      highlightRefreshFrameRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!contentUpdated || !termRef.current) {
      return;
    }

    scheduleHighlightRefresh(termRef.current);
  }, [contentUpdated, scheduleHighlightRefresh]);

  // 设置数据监听器的函数，处理终端输出
  const setupDataListener = (processId, term) => {
    // 防止重复添加监听器
    window.terminalAPI.removeOutputListener(processId);

    // 保存进程ID以便后续可以关闭
    const previousProcessId = processCache[tabId];
    if (previousProcessId && previousProcessId !== processId) {
      clearGeometryFor(previousProcessId, tabId);
    }
    processCache[tabId] = processId;
    clearGeometryFor(processId, tabId);

    // 添加数据监听
    window.terminalAPI.onProcessOutput(processId, (data) => {
      if (data) {
        try {
          term.write(data, () => scheduleHighlightRefresh(term));
        } catch (_error) {
          term.write(data);
          scheduleHighlightRefresh(term);
        }
        // 更新内容状态标志，表示终端内容已更新
        setContentUpdated(true);

        const dataStr = data.toString();

        // 检测密码和确认提示
        checkForPrompts(dataStr);

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
          /\b(top|htop|vi|vim|nano|less|more|tail -f|watch)\b/.test(dataStr) ||
          // 检测终端屏幕缓冲区交替（用于全屏应用）
          dataStr.includes("\u001b[?1049h") ||
          dataStr.includes("\u001b[?1049l") ||
          // 检测终端大小查询回复
          /\u001b\[8;\d+;\d+t/.test(dataStr)
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
      }
    });

    // 同步终端大小
    const syncTerminalSize = () => {
      if (fitAddonRef.current) {
        try {
          fitAddonRef.current.fit();
          const processId = processCache[tabId];
          if (processId) {
            sendResizeIfNeeded(processId, tabId, term.cols, term.rows);
          }
        } catch (error) {
          // 终端大小适配失败
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
    eventManager.setInterval(() => {
      // 只有当内容有更新时才检查并调整大小
      if (contentUpdated) {
        ensureTerminalSizeOnVisibilityChange();
      }
    }, 200); // 从100ms改为200ms，减轻性能负担

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
                  const termElement = termRef.current.element;

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
      const { tabId: eventTabId, layoutType, timestamp } = event.detail || {};

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
              sendResizeIfNeeded(processId, tabId, termRef.current.cols, termRef.current.rows);
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
      const {
        tabId: eventTabId,
        layoutType,
        timestamp,
        retryAttempt,
      } = event.detail || {};

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
              sendResizeIfNeeded(processId, tabId, termRef.current.cols, termRef.current.rows);
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
              const container = terminalRef.current;
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
    eventManager.addEventListener(window, "tabChanged", handleTabChanged);
    eventManager.addEventListener(
      window,
      "terminalResize",
      handleTerminalResize,
    );
    eventManager.addEventListener(
      window,
      "terminalForceRefresh",
      handleTerminalForceRefresh,
    );
  }, [tabId]);

  // 在创建终端前获取当前字体设置
  const createTerminal = () => {
    if (terminalRef.current) {
      // 根据存储的设置获取字体设置
      const currentFontSettings = getFontSettings();

      // 创建新的终端实例
      const newTerm = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 10000,
        theme: terminalTheme,
        fontSize: currentFontSettings.fontSize, // 使用存储的字体大小
        fontFamily: currentFontSettings.fontFamily, // 使用存储的字体族
        allowTransparency: true,
        disableStdin: false, // 允许用户输入
        convertEol: true, // 将回车转换为换行
        // ... 其他现有选项
      });

      // ... 其余代码保持不变
    }
  };

  // 清理最近输出行缓存
  useEffect(() => {
    return () => {
      // 组件卸载时清理最近输出行缓存
      recentOutputLinesRef.current = [];
    };
  }, []);

  // 输入同步广播封装
  const broadcastInputToGroup = useCallback(
    (input, sourceTabId) => {
      const group = findGroupByTab(tabId);
      if (group && group.members && group.members.length > 1) {
        group.members.forEach((targetTabId) => {
          if (
            targetTabId !== (sourceTabId || tabId) &&
            window.terminalAPI &&
            window.terminalAPI.sendToProcess &&
            processCache[targetTabId]
          ) {
            // 通过自定义事件将输入同步到目标终端
            const event = new CustomEvent("syncTerminalInput", {
              detail: {
                input,
                sourceTabId: sourceTabId || tabId,
                targetTabId,
              },
            });
            window.dispatchEvent(event);
          }
        });
      }
    },
    [tabId],
  );

  // 命令建议相关状态
  const suggestionSelectedRef = useRef(false);

  // 更新光标位置函数 - 简化版本，更可靠
  const updateCursorPosition = useCallback(() => {
    if (!termRef.current || !terminalRef.current) {
      setCursorPosition({ x: 0, y: 0 });
      return;
    }

    try {
      const term = termRef.current;
      const container = terminalRef.current;

      // 方法1：尝试获取xterm的实际光标元素
      const cursorElement = term.element?.querySelector(".xterm-cursor");
      if (cursorElement) {
        const cursorRect = cursorElement.getBoundingClientRect();
        if (cursorRect.width > 0 && cursorRect.height > 0) {

          const suggestionHeight = Math.min(
            (suggestions?.length || 0) * 48 + 64,
            300,
          );
          const showAbove =
            cursorRect.bottom + suggestionHeight + 30 > window.innerHeight &&
            cursorRect.top > suggestionHeight + 30;

          setCursorPosition({
            x: cursorRect.left,
            y: cursorRect.top,
            showAbove,
          });
          return;
        }
      }

      // 方法2：使用终端的字符度量计算
      const metrics = getCharacterMetrics(term);
      if (metrics) {
        // 获取当前光标位置（相对于终端buffer）
        const cursorX = term.buffer.active.cursorX;
        const cursorY = term.buffer.active.cursorY;

        // 考虑终端滚动位置
        const viewportY = term.buffer.active.viewportY || 0;
        const actualCursorY = cursorY - viewportY;

        // 获取终端内容区域
        const screen =
          term.element?.querySelector(".xterm-screen") ||
          term.element?.querySelector(".xterm-viewport") ||
          container;

        const screenRect = screen.getBoundingClientRect();

        // 计算光标的像素位置
        const pixelX = cursorX * metrics.charWidth;
        const pixelY = actualCursorY * metrics.charHeight;

        // 计算相对于视口的绝对位置
        const absoluteX = screenRect.left + pixelX;
        const absoluteY = screenRect.top + pixelY;

        const suggestionHeight = Math.min(
          (suggestions?.length || 0) * 48 + 64,
          300,
        );
        const showAbove =
          absoluteY + suggestionHeight + 30 > window.innerHeight &&
          absoluteY > suggestionHeight + 30;

        setCursorPosition({
          x: absoluteX,
          y: absoluteY,
          showAbove,
        });
        return;
      }

      // 方法3：降级到容器相对位置
      const containerRect = container.getBoundingClientRect();

      setCursorPosition({
        x: containerRect.left + 20,
        y: containerRect.top + 20,
      });
    } catch (error) {
      // 最后的降级方案
      try {
        const containerRect = terminalRef.current.getBoundingClientRect();
        setCursorPosition({
          x: containerRect.left + 50,
          y: containerRect.top + 50,
        });
      } catch (fallbackError) {
        setCursorPosition({ x: 100, y: 100 });
      }
    }
  }, [suggestions?.length || 0]);

  // 命令建议相关函数
  const getSuggestions = useCallback(
    async (input) => {

      if (!input || input.trim() === "" || inEditorMode || isCommandExecuting) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      const trimmedInput = input.trim();

      // 防止为最近执行的命令显示建议
      if (
        lastExecutedCommandRef.current &&
        trimmedInput === lastExecutedCommandRef.current &&
        Date.now() - lastExecutedCommandTimeRef.current < 2000
      ) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      try {
        // 从命令历史获取建议
        if (window.terminalAPI && window.terminalAPI.getCommandSuggestions) {
          const response =
            await window.terminalAPI.getCommandSuggestions(trimmedInput);

          // API返回的是 { success: true, suggestions: [...] } 格式
          const commandSuggestions = response?.success
            ? response.suggestions
            : [];

          if (commandSuggestions && commandSuggestions.length > 0) {
            // 过滤和排序建议
            const filteredSuggestions = commandSuggestions
              .filter(
                (suggestion) =>
                  suggestion.command &&
                  suggestion.command
                    .toLowerCase()
                    .includes(trimmedInput.toLowerCase()) &&
                  suggestion.command !== trimmedInput, // 不显示完全相同的命令
              )
              .sort((a, b) => {
                // 优先显示前缀匹配
                const aStartsWith = a.command
                  .toLowerCase()
                  .startsWith(trimmedInput.toLowerCase());
                const bStartsWith = b.command
                  .toLowerCase()
                  .startsWith(trimmedInput.toLowerCase());

                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;

                // 按使用次数排序
                return (b.count || 0) - (a.count || 0);
              })
              .slice(0, 10); // 最多显示10个建议

            if (filteredSuggestions.length > 0) {
              setSuggestions(filteredSuggestions);
              // 立即更新光标位置，然后显示建议
              updateCursorPosition();
              // 确保位置更新后再显示建议窗口
              requestAnimationFrame(() => {
                setShowSuggestions(true);
              });
            } else {
              setSuggestions([]);
              setShowSuggestions(false);
            }
          } else {
            setSuggestions([]);
            setShowSuggestions(false);
          }
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch (error) {
        // 获取建议失败，隐藏建议窗口
        setSuggestions([]);
        setShowSuggestions(false);
      }
    },
    [inEditorMode, isCommandExecuting, updateCursorPosition],
  );

  // 监听刷新建议事件
  useEffect(() => {
    const handleRefreshSuggestions = (event) => {
      const { input } = event.detail || {};
      if (
        input &&
        !suggestionsHiddenByEsc &&
        !suggestionsSuppressedUntilEnter &&
        !isCommandExecuting
      ) {
        getSuggestions(input);
      }
    };

    window.addEventListener(
      "refreshCommandSuggestions",
      handleRefreshSuggestions,
    );
    return () => {
      window.removeEventListener(
        "refreshCommandSuggestions",
        handleRefreshSuggestions,
      );
    };
  }, [getSuggestions, suggestionsHiddenByEsc, isCommandExecuting]);

  const handleSuggestionSelect = useCallback(
    (suggestion) => {
      if (!suggestion || !termRef.current || !processCache[tabId]) {
        setShowSuggestions(false);
        return;
      }

      try {
        // 标记这是通过建议选择的命令
        suggestionSelectedRef.current = true;

        // 获取当前终端行
        const currentLine =
          termRef.current.buffer.active
            .getLine(termRef.current.buffer.active.cursorY)
            ?.translateToString() || "";

        // 提取当前输入的命令部分（去除提示符）
        const commandMatch = currentLine.match(
          /(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w\/.]+[$#>])\s*(.*)$/,
        );

        const currentInputOnLine = commandMatch ? commandMatch[1] : "";
        const currentInputLength = currentInputOnLine.length;

        // 计算需要删除的字符数
        const deleteCount = currentInput.length || currentInputLength;

        // 发送退格键删除当前输入
        for (let i = 0; i < deleteCount; i++) {
          window.terminalAPI.sendToProcess(processCache[tabId], "\b");
        }

        // 发送选中的命令
        window.terminalAPI.sendToProcess(
          processCache[tabId],
          suggestion.command,
        );

        // 更新当前输入状态
        setCurrentInput(suggestion.command);

        // 隐藏建议窗口
        setShowSuggestions(false);
        setSuggestions([]);
      } catch (error) {
        setShowSuggestions(false);
      }
    },
    [tabId, currentInput],
  );

  const closeSuggestions = useCallback(() => {
    // 手动关闭建议窗口后，抑制再次显示，直到用户按下回车
    setShowSuggestions(false);
    setSuggestions([]);
    setSuggestionsSuppressedUntilEnter(true);
  }, []);

  // 示例：假设有如下输入处理函数
  const handleUserInput = (input) => {
    dispatchCommandToGroup(tabId, input);
  };

  // 注册表初始化
  if (typeof window !== "undefined" && !window.webTerminalRefs) {
    window.webTerminalRefs = {};
  }

  useEffect(() => {
    if (termRef.current && tabId) {
      window.webTerminalRefs[tabId] = termRef.current;
    }
    return () => {
      if (tabId && window.webTerminalRefs) {
        delete window.webTerminalRefs[tabId];
      }
    };
  }, [tabId, termRef.current]);

  // 监听来自其它终端的输入同步事件
  useEffect(() => {
    const handler = (e) => {
      const { input, sourceTabId, targetTabId } = e.detail || {};
      if (targetTabId === tabId && processCache[tabId]) {
        // 直接写入本地进程，且不再广播，防止回环
        if (termRef.current) {
          // 通过setupCommandDetection的isRemoteInput参数，模拟远程输入
          // 这里只写入进程，不触发本地onData
          window.terminalAPI.sendToProcess(processCache[tabId], input);
        }
      }
    };

    // 监听外部命令发送事件，设置临时屏蔽期
    const externalCommandHandler = (e) => {
      const { tabId: eventTabId, command, timestamp } = e.detail || {};
      if (eventTabId === tabId && termRef.current) {
        // 记录外部命令的详情，用于在onData中进行精确匹配
        termRef.current._externalCommand = {
          command: command,
          timestamp: timestamp,
          processedLength: 0,
          totalLength: command.length,
        };

        // 设置2秒后清理标记，防止影响后续正常输入
        setTimeout(() => {
          if (termRef.current && termRef.current._externalCommand) {
            delete termRef.current._externalCommand;
          }
        }, 2000);
      }
    };

    const removeSyncListener = eventManager.addEventListener(
      window,
      "syncTerminalInput",
      handler,
    );
    const removeExternalListener = eventManager.addEventListener(
      window,
      "externalCommandSending",
      externalCommandHandler,
    );

    return () => {
      removeSyncListener();
      removeExternalListener();
    };
  }, [tabId]);

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

        {!showSearchBar && isActive && (
          <Tooltip title="打开搜索 (Ctrl+/)">
            <IconButton
              size="small"
              className="search-icon-btn"
              onClick={() => setShowSearchBar(true)}
              sx={{
                padding: "4px",
                "& svg": {
                  fontSize: "18px",
                },
              }}
            >
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}

        {showSearchBar && isActive && (
          <div className="search-bar">
            <input
              type="text"
              className="search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSearch();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setShowSearchBar(false);
                }
              }}
              style={{
                borderColor: noMatchFound ? "red" : undefined,
                width: searchTerm ? "150px" : "200px", // 有搜索结果显示时调整宽度
              }}
            />
            {searchTerm && (
              <div
                style={{
                  color: noMatchFound ? "#ff6b6b" : "#aaa",
                  margin: "0 8px",
                  fontSize: "12px",
                  whiteSpace: "nowrap",
                  minWidth: "50px",
                  textAlign: "center",
                }}
              >
                {noMatchFound
                  ? "无匹配结果"
                  : searchResults.count > 0
                    ? `${searchResults.current}/${searchResults.count}`
                    : ""}
              </div>
            )}
            <Tooltip title="查找上一个 (Ctrl+,)">
              <span>
                <IconButton
                  size="small"
                  onClick={handleSearchPrevious}
                  className="search-button"
                  disabled={!searchTerm || noMatchFound}
                >
                  <NavigateBeforeIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="查找下一个 (Ctrl+.)">
              <span>
                <IconButton
                  size="small"
                  onClick={handleSearch}
                  className="search-button"
                  disabled={!searchTerm || noMatchFound}
                >
                  <NavigateNextIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="关闭搜索 (Ctrl+/ 或 Esc)">
              <IconButton
                size="small"
                onClick={() => setShowSearchBar(false)}
                className="search-button"
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </div>
        )}
      </div>
      <Menu
        open={contextMenu !== null}
        onClose={handleClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
        PaperProps={{
          sx: {
            boxShadow: theme.shadows[8],
            bgcolor: "background.paper",
            color: "text.primary",
          },
        }}
      >
        <MenuItem onClick={handleCopy} disabled={!selectedText}>
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>复制</ListItemText>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            Ctrl+;
          </Typography>
        </MenuItem>
        <MenuItem onClick={handlePaste}>
          <ListItemIcon>
            <PasteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>粘贴</ListItemText>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            Ctrl+' / 中键
          </Typography>
        </MenuItem>
        <MenuItem onClick={handleSendToAI} disabled={!selectedText}>
          <ListItemIcon>
            <SmartToyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>发送到AI助手</ListItemText>
        </MenuItem>
        <Divider />
        {isActive && (
          <MenuItem onClick={handleSearchFromMenu}>
            <ListItemIcon>
              <SearchIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>搜索</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+/
            </Typography>
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={handleClear}>
          <ListItemIcon>
            <ClearAllIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>清空</ListItemText>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            Ctrl+L
          </Typography>
        </MenuItem>
      </Menu>

      {/* 命令建议组件 */}
      <CommandSuggestion
        suggestions={suggestions}
        visible={showSuggestions && !isConfirmationPromptActive}
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

export default WebTerminal;
