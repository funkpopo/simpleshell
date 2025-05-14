import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import Box from "@mui/material/Box";
import { useTheme } from "@mui/material/styles";
import "@xterm/xterm/css/xterm.css";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import PasteIcon from "@mui/icons-material/ContentPaste";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import SearchIcon from "@mui/icons-material/Search";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import CloseIcon from "@mui/icons-material/Close";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";

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
/* 优化终端选择文本的显示效果 */
.xterm-selection {
  opacity: 1 !important; 
  z-index: 10 !important;
  mix-blend-mode: difference !important;
}
.terminal-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  padding-right: 5px; /* 添加右侧边距，避免内容被右侧边栏遮挡 */
}
`;

// 添加搜索相关样式
const searchBarStyles = `
.search-bar {
  position: absolute;
  top: 5px;
  right: 65px; /* 将搜索栏向左移动，从60px改为65px */
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
  right: 65px; /* 将搜索按钮向左移动，从60px改为65px */
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

// 添加一个辅助函数，用于在调试模式下记录终端大小相关信息
const logTerminalSize = (message, term, container) => {
  // 确保参数有效
  if (!term || !container) return;

  try {
    const termCols = term.cols;
    const termRows = term.rows;
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const termElement = term.element;
    const termElementWidth = termElement ? termElement.clientWidth : "NA";
    const termElementHeight = termElement ? termElement.clientHeight : "NA";

    console.log(`[终端大小信息] ${message}:`, {
      container: `${containerWidth}x${containerHeight}`,
      terminal: `${termCols}x${termRows}`,
      element: `${termElementWidth}x${termElementHeight}`,
    });
  } catch (error) {
    console.error("记录终端大小信息时出错:", error);
  }
};

// 添加一个辅助函数，用于强制重新计算和同步终端大小的辅助函数
const forceResizeTerminal = (term, container, processId, tabId, fitAddon) => {
  if (!term || !container || !fitAddon) return;

  try {
    // 强制重新计算DOM大小
    const currentWidth = container.clientWidth;
    const currentHeight = container.clientHeight;

    // 确保终端完全填充容器
    if (term && term.element) {
      term.element.style.width = `${currentWidth}px`;
      term.element.style.height = `${currentHeight}px`;

      // 添加强制重排的代码
      term.element.getBoundingClientRect();
    }

    // 适配终端大小
    fitAddon.fit();

    // 二次确认适配，有时首次fit可能不会完全生效
    setTimeout(() => {
      if (term && term.element && container) {
        // 再次检查尺寸是否一致
        const elemWidth = term.element.clientWidth;
        const elemHeight = term.element.clientHeight;
        
        if (Math.abs(elemWidth - currentWidth) > 5 || 
            Math.abs(elemHeight - currentHeight) > 5) {
          fitAddon.fit();
        }
      }
    }, 10);

    // 获取当前终端的大小
    const cols = Math.max(Math.floor(term.cols || 120), 1);
    const rows = Math.max(Math.floor(term.rows || 30), 1);

    // 通知后端调整终端大小
    if (window.terminalAPI && window.terminalAPI.resizeTerminal) {
      window.terminalAPI
        .resizeTerminal(processId || tabId, cols, rows)
        .catch((err) => console.error("终端大小强制调整失败:", err));
    }
  } catch (error) {}
};

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
    /^\s*#/,    // Python, Bash, Ruby 等的注释 #
    /^\s*--/,   // SQL, Lua 等的注释 --
    /^\s*;/,    // Assembly, INI 等的注释 ;
    /^\s*%/,    // LaTeX, Matlab 等的注释 %
    /^\s*\/\*/, // C, Java 等的多行注释开始 /*
    /^\s*\*\//  // C, Java 等的多行注释结束 */
  ];
  
  // 判断当前行是否包含注释
  const isCommentLine = (line) => {
    return commentPatterns.some(pattern => pattern.test(line));
  };
  
  // 检测是否有注释行
  const hasCommentLines = lines.some(line => isCommentLine(line));
  
  // 如果检测到注释行并且开启了逐行发送选项（默认为true），返回特殊标记对象
  // 这将触发调用方进行逐行处理
  if (hasCommentLines && (options.sendLineByLine !== false)) {
    return {
      type: 'multiline-with-comments',
      lines: lines,
      isCommentLine: isCommentLine
    };
  }
  //统一使用'\n'
  const lineEnding = '\n';
  
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
  usePowershell = true,
  sshConfig = null,
}) => {
  const terminalRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const currentProcessId = useRef(null);
  const theme = useTheme();
  let resizeTimeout = null;
  // 添加内容更新标志，用于跟踪终端内容是否有更新
  const [contentUpdated, setContentUpdated] = useState(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedText, setSelectedText] = useState("");
  const searchAddonRef = useRef(null);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState({ count: 0, current: 0 });
  const [noMatchFound, setNoMatchFound] = useState(false);

  // 定义检测用户输入命令的函数，用于监控特殊命令执行
  const setupCommandDetection = (term, processId) => {
    // 用于存储用户正在输入的命令
    let currentInputBuffer = '';
    // 标记上一个按键是否是特殊键序列的开始
    let isEscapeSequence = false;
    // 用于存储转义序列
    let escapeBuffer = '';
    // 用于记录最后一个执行的命令，避免重复添加到历史记录
    let lastExecutedCommand = '';
    // 跟踪编辑器模式状态
    let inEditorMode = false;
    // 标记是否刚刚使用了Tab补全
    let tabCompletionUsed = false;
    // 用于临时存储当前行位置和内容，以便在Tab补全后能恢复正确位置
    let currentLineBeforeTab = null;
    
    // 识别编辑器命令的正则表达式
    const editorCommandRegex = /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;
    
    // 添加buffer类型监听，用于检测编辑器模式
    // xterm.js在全屏应用（如vi）运行时会切换到alternate buffer
    const bufferTypeObserver = {
      handleBufferTypeChange: (type) => {
        console.log(`终端缓冲区类型变化: ${type}`);
        if (type === 'alternate') {
          // 进入编辑器/全屏应用模式
          inEditorMode = true;
          console.log("编辑器模式已启动（通过buffer类型检测）");
          
          // 通知主进程编辑器模式状态变更
          if (processId && window.terminalAPI?.notifyEditorModeChange) {
            window.terminalAPI.notifyEditorModeChange(processId, true);
          }
        } else if (type === 'normal') {
          // 退出编辑器/全屏应用模式
          if (inEditorMode) {
            inEditorMode = false;
            console.log("编辑器模式已退出（通过buffer类型检测）");
            
            // 通知主进程编辑器模式状态变更
            if (processId && window.terminalAPI?.notifyEditorModeChange) {
              window.terminalAPI.notifyEditorModeChange(processId, false);
            }
          }
        }
      }
    };
    
    // 监听buffer类型变化
    if (term.buffer && typeof term.buffer.onBufferChange === 'function') {
      // 如果xterm.js版本支持此方法
      term.buffer.onBufferChange((e) => {
        bufferTypeObserver.handleBufferTypeChange(term.buffer.active.type);
      });
      
      // 初始检查当前buffer类型
      bufferTypeObserver.handleBufferTypeChange(term.buffer.active.type);
    } else {
      console.log("当前xterm.js版本不支持buffer类型监听，将使用传统方法检测编辑器模式");
    }
    
    // 监听终端数据输出，用于检测编辑器特征
    term.onData((data) => {
      // 检查是否是ESC开头的转义序列（通常是方向键等特殊键）
      if (data === '\x1b') {
        isEscapeSequence = true;
        escapeBuffer = data;
        // 方向键等特殊键不会影响命令历史记录，直接发送到进程
        if (processId) {
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
          escapeBuffer = '';
        }
        
        // 转义序列不会记录到命令历史，直接发送到进程
        if (processId) {
          window.terminalAPI.sendToProcess(processId, data);
        }
        return;
      }
      
      // 处理退格键
      if (data === '\b' || data === '\x7f') {
        if (currentInputBuffer.length > 0) {
          currentInputBuffer = currentInputBuffer.slice(0, -1);
        }
        // 发送数据到进程
        if (processId) {
          window.terminalAPI.sendToProcess(processId, data);
        }
        return;
      }
      
      // 处理Tab键，标记Tab补全被使用
      if (data === '\t') {
        tabCompletionUsed = true;
        // 存储当前行内容，以便于之后获取Tab补全后的完整命令
        currentLineBeforeTab = {
          y: term.buffer.active.cursorY,
          content: term.buffer.active.getLine(term.buffer.active.cursorY)?.translateToString() || ""
        };
        
        // 发送数据到进程
        if (processId) {
          window.terminalAPI.sendToProcess(processId, data);
        }
        return;
      }
      
      // 检测回车键（命令执行的触发）
      if (data === "\r" || data === "\n") {
        try {
          // 获取终端的最后一行内容（可能包含用户输入的命令）
          const lastLine =
            term.buffer.active
              .getLine(term.buffer.active.cursorY)
              ?.translateToString() || "";
              
          // 提取用户输入的命令（去除提示符）
          // 改进提示符检测，支持更多类型的shell提示符
          const commandMatch = lastLine.match(/(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w\/.]+[$#>])\s*(.+)$/);
          
          // 获取实际命令，优先使用终端行显示的内容（包含tab补全后的结果）
          let command = '';
          if (commandMatch && commandMatch[1] && commandMatch[1].trim() !== "") {
            // 优先使用从终端行获取的命令，这包含了Tab补全后的结果
            command = commandMatch[1].trim();
          } else if (currentInputBuffer.trim() !== "") {
            // 如果无法从终端行获取，回退到使用输入缓冲区
            command = currentInputBuffer.trim();
          }
          
          // 如果发现命令为空但刚刚使用了Tab补全，尝试从整个终端缓冲区捕获命令
          if ((!command || command === "") && tabCompletionUsed && currentLineBeforeTab) {
            // 搜索从当前行向上几行，查找可能出现的完整命令
            const linesCount = term.buffer.active.length;
            const linesToCheck = Math.min(5, linesCount); // 检查最近5行
            
            for (let i = 0; i < linesToCheck; i++) {
              const line = term.buffer.active.getLine(term.buffer.active.cursorY - i)?.translateToString() || "";
              const potentialCommandMatch = line.match(/(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w\/.]+[$#>])\s*(.+)$/);
              if (potentialCommandMatch && potentialCommandMatch[1] && potentialCommandMatch[1].trim() !== "") {
                command = potentialCommandMatch[1].trim();
                break;
              }
            }
          }
          
          // 检测是否进入了编辑器模式（备用模式。确保能够实施resize）
          // 只有在不支持buffer类型检测时才使用命令识别
          if (command && 
              editorCommandRegex.test(command) && 
              (!term.buffer || typeof term.buffer.onBufferChange !== 'function')) {
            inEditorMode = true;
            console.log("编辑器模式已启动（通过命令检测）:", command);
            
            // 通知主进程编辑器模式状态变更
            if (processId && window.terminalAPI?.notifyEditorModeChange) {
              window.terminalAPI.notifyEditorModeChange(processId, true);
            }
          }
          
          // 确保命令不为空且不与上一次执行的命令相同，并且不在编辑器模式中
          // 注意：inEditorMode可能已经被buffer类型检测器更新
          if (command && command !== lastExecutedCommand && !inEditorMode) {
            lastExecutedCommand = command;
          }
          
          // 重置当前输入缓冲区和Tab补全状态
          currentInputBuffer = '';
          tabCompletionUsed = false;
          currentLineBeforeTab = null;

          // 检查这一行是否包含常见的全屏应用命令
          if (
            /\b(top|htop|vi|vim|nano|less|more|watch|tail -f)\b/.test(lastLine)
          ) {
            console.log("检测到用户输入全屏应用命令:", lastLine);

            // 使用延迟序列触发终端大小调整
            const delayTimes = [200, 500, 1000, 1500];
            delayTimes.forEach((delay) => {
              setTimeout(() => {
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
          console.error("检测用户输入命令时出错:", error);
        }
      } else if (data !== '\t') {
        // 对于非Tab键输入，追加到输入缓冲区
        currentInputBuffer += data;
      }

      // 发送数据到进程
      if (processId) {
        window.terminalAPI.sendToProcess(processId, data);
      }
    });
    
    // 添加输出监听，以检测编辑器退出（仅作为备用方法）
    term.onLineFeed(() => {
      // 当获得新的一行时，检查是否有shell提示符出现，这可能表示编辑器已退出
      // 注意：如果buffer类型检测可用，此方法是不必要的
      try {
        // 只在不支持buffer类型检测时使用此备用方法
        if (inEditorMode && (!term.buffer || typeof term.buffer.onBufferChange !== 'function')) {
          // 检查最后几行，寻找shell提示符
          const linesCount = term.buffer.active.length;
          const lastRowsToCheck = Math.min(5, linesCount); // 检查最后5行
          
          for (let i = 0; i < lastRowsToCheck; i++) {
            const line = term.buffer.active.getLine(linesCount - 1 - i)?.translateToString() || "";
            // 检查是否包含典型的shell提示符
            if (/(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w\/.]+[$#>])\s*$/.test(line)) {
              inEditorMode = false;
              console.log("编辑器模式已退出（通过shell提示符检测）");
              
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
        console.error("检测编辑器退出时出错:", error);
      }
    });
    
    // 添加终端数据处理监听，用于捕获Tab补全后的内容
    term.onRender(() => {
      // 如果使用了Tab补全并且有存储的之前行内容
      if (tabCompletionUsed && currentLineBeforeTab) {
        try {
          // 获取当前行内容，看是否有变化（可能是Tab补全导致的）
          const currentLine = term.buffer.active.getLine(term.buffer.active.cursorY)?.translateToString() || "";
          const previousContent = currentLineBeforeTab.content;
          
          // 如果行内容发生了变化，可能是Tab补全生效了
          if (currentLine !== previousContent) {
            // 尝试提取命令部分（去除提示符）
            const commandMatch = currentLine.match(/(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w\/.]+[$#>])\s*(.+)$/);
            if (commandMatch && commandMatch[1] && commandMatch[1].trim() !== "") {
              // 更新当前输入缓冲区为Tab补全后的命令
              currentInputBuffer = commandMatch[1].trim();
            }
          }
          
          // 重置，因为我们已经处理了这次Tab补全
          currentLineBeforeTab = null;
        } catch (error) {
          console.error("处理Tab补全后内容时出错:", error);
        }
      }
    });
  };

  // 定义响应主题模式的终端主题
  const terminalTheme = {
    // 背景色根据应用主题模式设置
    background: theme.palette.mode === "light" ? "#ffffff" : "#1e1e1e",
    // 文本颜色根据背景色调整，浅色背景使用暗色文本
    foreground: theme.palette.mode === "light" ? "#000000" : "#ffffff",
    // 光标颜色根据背景自动调整
    cursor: theme.palette.mode === "light" ? "#000000" : "#ffffff",
    // 选择文本的背景色，使用半透明色以避免遮挡字符
    selectionBackground:
      theme.palette.mode === "light"
        ? "rgba(255, 255, 170, 0.65)"
        : "rgba(255, 255, 170, 0.65)",
    // 选择文本的前景色，确保文字清晰可见
    selectionForeground: 
      theme.palette.mode === "light" 
        ? "#000000" 
        : "#ffffff",
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

  // 获取存储的字体大小或使用默认值
  const getFontSize = async () => {
    try {
      if (window.terminalAPI?.loadUISettings) {
        const settings = await window.terminalAPI.loadUISettings();
        return settings.fontSize || 14;
      }
    } catch (error) {
      console.error("Failed to load font size from config:", error);
    }
    return 14;
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
          console.error("Failed to kill process:", error);
        }
        delete processCache[tabId];
      }

      // 清除旧终端
      try {
        terminalCache[tabId].dispose();
      } catch (error) {
        console.error("Failed to dispose terminal:", error);
      }
      delete terminalCache[tabId];
    }
  }, [refreshKey, tabId]);

  // 监听设置变更事件
  useEffect(() => {
    const handleSettingsChanged = async (event) => {
      const { fontSize } = event.detail;
      
      if (terminalRef.current && terminalCache[tabId] && fitAddonRef.current) {
        // 更新终端字体大小
        terminalCache[tabId].options.fontSize = parseInt(fontSize, 10);
        
        // 触发终端大小调整
        setTimeout(() => {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit();
            
            // 同步到后端进程
            const processId = processCache[tabId];
            if (processId && window.terminalAPI?.resizeTerminal) {
              const dims = terminalCache[tabId].cols + "," + terminalCache[tabId].rows;
              window.terminalAPI.resizeTerminal(processId, dims);
            }
          }
        }, 100);
      }
    };

    window.addEventListener("settingsChanged", handleSettingsChanged);
    
    return () => {
      window.removeEventListener("settingsChanged", handleSettingsChanged);
    };
  }, [tabId]);

  useEffect(() => {
    // 添加全局样式
    const styleElement = document.createElement("style");
    styleElement.textContent = terminalStyles + searchBarStyles;
    document.head.appendChild(styleElement);

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
      } else {
        // 创建新的终端实例
        term = new Terminal({
          cursorBlink: true,
          theme: terminalTheme, // 使用固定的终端主题
          fontFamily: 'Consolas, "Courier New", monospace',
          fontSize: 14, // 默认大小，稍后会更新
          scrollback: 10000,
          allowTransparency: true,
          cols: 120, // 设置更宽的初始列数
          rows: 30, // 设置初始行数
          convertEol: true, // 自动将行尾换行符转换为CRLF
          disableStdin: false,
          rendererType: "canvas",
          termName: "xterm-256color", // 使用更高级的终端类型
          allowProposedApi: true, // 允许使用提议的API
          rightClickSelectsWord: false, // 禁用右键点击选中单词，使用自定义右键菜单
          copyOnSelect: false, // 选中后不自动复制
        });

        // 异步加载字体大小设置并应用
        (async () => {
          try {
            const fontSize = await getFontSize();
            term.options.fontSize = fontSize;
            // 应用字体大小后自动调整大小
            setTimeout(() => {
              if (fitAddon) {
                fitAddon.fit();
              }
            }, 0);
          } catch (error) {
            console.error("Failed to apply font size:", error);
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
            console.log("在系统默认浏览器打开链接:", uri);
            window.terminalAPI.openExternal(uri)
              .catch(err => console.error("打开链接失败:", err));
          } else {
            console.warn("terminalAPI.openExternal不可用，无法打开链接");
          }
        });

        term.loadAddon(fitAddon);
        term.loadAddon(searchAddon);
        term.loadAddon(webLinksAddon);

        // 打开终端
        term.open(terminalRef.current);

        // 确保适配容器大小
        setTimeout(() => {
          fitAddon.fit();
        }, 0);

        // 如果有SSH配置，则优先使用SSH连接
        if (sshConfig && window.terminalAPI && window.terminalAPI.startSSH) {
          // 显示连接信息
          term.writeln(`正在连接到 ${sshConfig.host}...`);

          try {
            // 启动SSH连接
            window.terminalAPI
              .startSSH(sshConfig)
              .then((processId) => {
                if (processId) {
                  console.log(
                    `SSH连接成功，tabId=${tabId}, processId=${processId}`,
                  );

                  // 存储进程ID
                  currentProcessId.current = processId;

                  // 存储到进程缓存中
                  processCache[tabId] = processId;

                  // 触发SSH进程ID更新事件，用于通知其他组件
                  const event = new CustomEvent("sshProcessIdUpdated", {
                    detail: { terminalId: tabId, processId },
                  });

                  window.dispatchEvent(event);

                  // 设置数据接收监听
                  setupDataListener(processId, term);

                  // 设置命令检测
                  setupCommandDetection(term, processId);

                  term.writeln(`已连接到 ${sshConfig.host}`);

                  // 连接成功后多次尝试同步终端大小，确保远程终端能够正确获取前端显示区域的大小
                  setTimeout(() => {
                    if (terminalRef.current && fitAddonRef.current) {
                      forceResizeTerminal(
                        term,
                        terminalRef.current,
                        processId,
                        tabId,
                        fitAddonRef.current,
                      );
                    }
                  }, 1000);

                  setTimeout(() => {
                    if (terminalRef.current && fitAddonRef.current) {
                      forceResizeTerminal(
                        term,
                        terminalRef.current,
                        processId,
                        tabId,
                        fitAddonRef.current,
                      );
                    }
                  }, 2000);
                } else {
                  term.writeln(`连接失败: 未能获取进程ID`);
                }
              })
              .catch((error) => {
                console.error("SSH connection error:", error);
                term.writeln(`\r\n连接失败: ${error.message || "未知错误"}`);
              });
          } catch (error) {
            console.error("Failed to start SSH:", error);
            term.writeln(`\r\n连接失败: ${error.message || "未知错误"}`);
          }
        }
        // 连接到本地PowerShell
        else if (
          usePowershell &&
          window.terminalAPI &&
          window.terminalAPI.startPowerShell
        ) {
          startPowerShell(term, tabId);
        } else {
          // 如果不使用PowerShell或API不可用，使用模拟终端
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
        // 如果是在终端内部，则不处理快捷键
        if (
          e.target &&
          e.target.classList &&
          e.target.classList.contains("xterm-helper-textarea")
        ) {
          return;
        }

        // Ctrl+Alt+C 复制 (改为Ctrl+Alt+C)
        if (e.ctrlKey && e.altKey && e.key === "c") {
          const selection = term.getSelection();
          if (selection) {
            e.preventDefault();
            navigator.clipboard.writeText(selection);
            console.log("已复制文本:", selection);
          }
        }
        // Ctrl+Alt+V 粘贴 (改为Ctrl+Alt+V)
        else if (e.ctrlKey && e.altKey && e.key === "v") {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            if (text && processCache[tabId]) {
              // 使用预处理函数处理多行文本，防止注释和缩进问题
              const processedText = processMultilineInput(text);
              window.terminalAPI.sendToProcess(processCache[tabId], processedText);
            }
          });
        }
        // Ctrl+Alt+F 搜索 (改为Ctrl+Alt+F)
        else if (e.ctrlKey && e.altKey && e.key === "f") {
          e.preventDefault();
          setShowSearchBar(true);
        }
        // Esc 关闭搜索
        else if (e.key === "Escape" && showSearchBar) {
          e.preventDefault();
          setShowSearchBar(false);
        }
        // F3 查找下一个
        else if (e.key === "F3" || (e.ctrlKey && e.key === "g")) {
          if (searchAddonRef.current && searchTerm) {
            e.preventDefault();
            handleSearch();
          }
        }
        // Shift+F3 查找上一个
        else if (
          (e.shiftKey && e.key === "F3") ||
          (e.ctrlKey && e.shiftKey && e.key === "g")
        ) {
          if (searchAddonRef.current && searchTerm) {
            e.preventDefault();
            handleSearchPrevious();
          }
        }
      };

      // 添加键盘事件监听
      document.addEventListener("keydown", handleKeyDown);

      // 添加鼠标中键粘贴功能
      const handleMouseDown = (e) => {
        // 鼠标中键点击 (e.button === 1 表示鼠标中键)
        if (e.button === 1) {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            if (text && processCache[tabId]) {
              // 使用预处理函数处理多行文本，防止注释和缩进问题
              const processedText = processMultilineInput(text);
              
              // 检查是否需要逐行发送（含有注释的多行文本）
              if (processedText && typeof processedText === 'object' && processedText.type === 'multiline-with-comments') {
                // 逐行发送文本，每行之间添加适当延迟
                processedText.lines.forEach((line, index) => {
                  setTimeout(() => {
                    window.terminalAPI.sendToProcess(processCache[tabId], line + (index < processedText.lines.length - 1 ? '\n' : ''));
                  }, index * 50); // 50毫秒的延迟，可以根据实际情况调整
                });
              } else {
                // 正常发送处理后的文本
                window.terminalAPI.sendToProcess(processCache[tabId], processedText);
              }
            }
          });
        }
      };

      // 添加鼠标事件监听
      if (terminalRef.current) {
        terminalRef.current.addEventListener("mousedown", handleMouseDown);
      }

      // 添加右键菜单事件监听
      if (terminalRef.current) {
        terminalRef.current.addEventListener("contextmenu", handleContextMenu);
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

            // 记录调整前的大小信息
            logTerminalSize("调整前", term, container);

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

          // 二次检查适配结果
          setTimeout(() => {
            if (terminalRef.current && term && term.element) {
              const container = terminalRef.current;
              const currentWidth = container.clientWidth;
              const currentHeight = container.clientHeight;
              const elemWidth = term.element.clientWidth;
              const elemHeight = term.element.clientHeight;
              
              if (Math.abs(elemWidth - currentWidth) > 5 || 
                  Math.abs(elemHeight - currentHeight) > 5) {
                console.log("检测到终端尺寸不匹配，执行二次适配");
                fitAddon.fit();
              }
            }
          }, 10);

          // 记录调整后的大小信息
          if (terminalRef.current) {
            logTerminalSize("调整后", term, terminalRef.current);
          }

          // 获取当前终端的大小
          // 直接获取fit后的实际尺寸而非options中的值
          const dimensions = {
            cols: term.cols,
            rows: term.rows,
          };

          if (processCache[tabId] && window.terminalAPI.resizeTerminal) {
            // 确保cols和rows是有效的正整数
            const cols = Math.max(Math.floor(dimensions.cols || 120), 1);
            const rows = Math.max(Math.floor(dimensions.rows || 30), 1);

            console.log(
              `调整终端大小: 进程ID=${processCache[tabId]}, 列=${cols}, 行=${rows}`,
            );

            // 通知后端调整终端大小
            window.terminalAPI
              .resizeTerminal(processCache[tabId], cols, rows)
              .catch((err) => {
                console.error("终端大小调整失败:", err);
              });

            // 延迟再次调整大小，确保在某些情况下终端尺寸能够正确同步
            setTimeout(() => {
              if (terminalRef.current && term && processCache[tabId]) {
                window.terminalAPI
                  .resizeTerminal(
                    processCache[tabId],
                    Math.max(Math.floor(term.cols || 120), 1),
                    Math.max(Math.floor(term.rows || 30), 1),
                  )
                  .catch((err) => console.error("延迟终端大小调整失败:", err));
                  
                // 重置内容更新标志，表示已处理完成
                setContentUpdated(false);
              }
            }, 300);
          }
        } catch (error) {
          console.error("Error resizing terminal:", error);
        }
      };

      // 立即调整大小
      handleResize();

      // 添加resize事件监听
      window.addEventListener("resize", handleResize);

      // 添加标签页激活/可见性事件处理
      const handleVisibilityChange = () => {
        if (!document.hidden && termRef.current) {
          // 页面可见时调整大小
          setTimeout(handleResize, 50);
        }
      };

      document.addEventListener("visibilitychange", handleVisibilityChange);

      // 创建一个MutationObserver来检测元素的可见性变化
      const observer = new MutationObserver((mutations) => {
        let shouldResize = false;
        let visibilityChanged = false;

        // 检查变化是否可能影响大小
        for (const mutation of mutations) {
          // 属性变化可能影响大小
          if (
            mutation.attributeName === "style" ||
            mutation.attributeName === "class"
          ) {
            const target = mutation.target;
            
            // 检查是否是display属性变化
            if (target.style && 
                (target.style.display === 'block' || 
                 target.style.display === 'flex' || 
                 target.style.display === 'grid' || 
                 target.getAttribute('aria-hidden') === 'false')) {
              visibilityChanged = true;
              break;
            }
            
            // 检查是否涉及visibility或opacity变化
            const computedStyle = window.getComputedStyle(target);
            if (computedStyle && 
                (computedStyle.visibility === 'visible' || 
                 computedStyle.opacity !== '0')) {
              visibilityChanged = true;
              break;
            }
            
            shouldResize = true;
          }

          // 子元素变化也可能影响大小
          if (mutation.type === "childList") {
            shouldResize = true;
          }
        }

        // 如果检测到可见性变化，则立即重新计算大小
        if (visibilityChanged) {
          clearTimeout(resizeTimeout);
          if (terminalRef.current && termRef.current && fitAddonRef.current) {
            // 延迟一小段时间确保DOM已完全更新
            setTimeout(() => {
              forceResizeTerminal(
                termRef.current, 
                terminalRef.current, 
                processCache[tabId], 
                tabId, 
                fitAddonRef.current
              );
            }, 10);

            setTimeout(() => {
              if (terminalRef.current && termRef.current && fitAddonRef.current) {
                forceResizeTerminal(
                  termRef.current, 
                  terminalRef.current, 
                  processCache[tabId], 
                  tabId, 
                  fitAddonRef.current
                );
              }
            }, 100);
          }
        } else if (shouldResize) {
          // 使用节流函数延迟调用resize，避免频繁调整
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(() => {
            // 检查终端容器和DOM尺寸
            if (terminalRef.current && termRef.current) {
              // 检查尺寸是否确实发生变化
              const container = terminalRef.current;
              const xtermElement = termRef.current.element;

              if (
                xtermElement &&
                (Math.abs(xtermElement.clientWidth - container.clientWidth) >
                  2 ||
                  Math.abs(xtermElement.clientHeight - container.clientHeight) >
                    2)
              ) {
                handleResize();
              }
            }
          }, 50);
        }
      });

      // 观察终端容器及其父元素
      if (terminalRef.current) {
        observer.observe(terminalRef.current, {
          attributes: true,
          childList: true,
          subtree: true,
          attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] // 只观察这些属性的变化
        });

        // 尝试观察父元素
        let parent = terminalRef.current.parentElement;
        if (parent) {
          observer.observe(parent, { 
            attributes: true,
            attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] 
          });

          // 对于TabPanel的特殊处理
          if (parent.parentElement) {
            observer.observe(parent.parentElement, { 
              attributes: true,
              attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] 
            });

            if (parent.parentElement.parentElement) {
              observer.observe(parent.parentElement.parentElement, { 
                attributes: true,
                attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'] 
              });
            }
          }
        }
      }

      // 定时检查并调整大小，以确保在不同情况下都能正确适配
      const resizeInterval = setInterval(() => {
        if (termRef.current && termRef.current.element) {
          const xtermElement = termRef.current.element;
          const container = terminalRef.current;
          if (
            container &&
            (Math.abs(xtermElement.clientWidth - container.clientWidth) > 10 ||
              Math.abs(xtermElement.clientHeight - container.clientHeight) > 10)
          ) {
            handleResize();
          }
        }
      }, 200);

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
            const cols = Math.max(Math.floor(term.cols || 120), 1);
            const rows = Math.max(Math.floor(term.rows || 30), 1);

            // 同步到后端
            if (window.terminalAPI.resizeTerminal) {
              window.terminalAPI
                .resizeTerminal(processId, cols, rows)
                .catch((err) => console.error("初始终端大小同步失败:", err));
            }
          } catch (error) {}
        }
      };

      // 立即同步一次
      syncTerminalSize();

      // 延迟后同步，确保布局稳定后大小正确
      setTimeout(syncTerminalSize, 100);
      
      // 添加一个新的辅助函数，确保终端在被激活时调整大小
      const ensureTerminalSizeOnVisibilityChange = () => {
        // 检查当前标签是否可见（通过DOM属性或样式）
        if (terminalRef.current) {
          const isVisible = isElementVisible(terminalRef.current);
          
          // 只有当终端可见且内容有更新时，才执行大小调整
          if (isVisible && termRef.current && fitAddonRef.current && contentUpdated) {            
            // 使用延迟执行强制调整大小
            setTimeout(() => {
              forceResizeTerminal(
                termRef.current,
                terminalRef.current,
                processCache[tabId],
                tabId,
                fitAddonRef.current
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
          if (style.display === 'none' || 
              style.visibility === 'hidden' || 
              style.opacity === '0' ||
              current.getAttribute('aria-hidden') === 'true') {
            return false;
          }
          current = current.parentElement;
        }
        
        // 检查元素是否在视口内
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      
      // 添加一个新的定时器，定期检查终端可见性
      const visibilityCheckInterval = setInterval(() => {
        // 只有当内容有更新时才检查并调整大小
        if (contentUpdated) {
          ensureTerminalSizeOnVisibilityChange();
        }
      }, 200); // 从100ms改为200ms，减轻性能负担
      
      // 添加定时器清理
      return () => {
        window.removeEventListener("resize", handleResize);
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
        document.removeEventListener("keydown", handleKeyDown);
        observer.disconnect();
        clearInterval(resizeInterval);
        clearInterval(visibilityCheckInterval);

        // 清理任何事件监听器
        if (window.terminalAPI) {
          if (processCache[tabId]) {
            window.terminalAPI.removeOutputListener(processCache[tabId]);
          } else {
            window.terminalAPI.removeOutputListener();
          }
        }

        if (terminalRef.current) {
          terminalRef.current.removeEventListener(
            "contextmenu",
            handleContextMenu,
          );
          terminalRef.current.removeEventListener("mousedown", handleMouseDown);
        }

        // 注意：我们不再在这里销毁终端实例，而是保存在缓存中
        // 但仍需要从DOM中分离
        if (termRef.current) {
          try {
            // 这将从DOM中分离终端但不销毁它
            const element = terminalRef.current;
            while (element.firstChild) {
              element.removeChild(element.firstChild);
            }
          } catch (err) {
            console.error("Error detaching terminal:", err);
          }
        }

        if (styleElement) {
          document.head.removeChild(styleElement);
        }
      };
    }
  }, [tabId, usePowershell, refreshKey, sshConfig]);

  // 启动PowerShell的辅助函数
  const startPowerShell = (term, tabId) => {
    // 先显示连接信息
    term.writeln("正在连接到 PowerShell...");

    // 启动PowerShell进程
    window.terminalAPI
      .startPowerShell()
      .then((processId) => {
        // 保存进程ID以便后续可以关闭
        processCache[tabId] = processId;

        // 设置数据处理
        window.terminalAPI.onProcessOutput(processId, (data) => {
          if (data) {
            term.write(data);
            // 更新内容状态标志，表示终端内容已更新
            setContentUpdated(true);
          }
        });

        // 设置命令检测
        setupCommandDetection(term, processId);
      })
      .catch((err) => {
        term.writeln(`连接到PowerShell失败: ${err.message || "未知错误"}`);
        term.writeln("正在回退到模拟终端模式...");
        setupSimulatedTerminal(term);
      });
  };

  // 设置模拟终端（用于无法使用IPC API时的回退）
  const setupSimulatedTerminal = (term) => {
    const term_prompt = "$ ";
    let userInput = "";
    
    // 初始化编辑器模式状态
    let inEditorMode = false;
    // 识别编辑器命令的正则表达式
    const editorCommandRegex = /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;

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
            console.log("Editor mode detected in simulated terminal:", command);
            // 模拟编辑器输出
            term.writeln(`Simulated ${command} editor mode. Type 'exit' to return.`);
          } 
          // 检测是否退出编辑器模式
          else if (inEditorMode && /^(exit|quit|q|:q|:wq|:x)$/i.test(command)) {
            inEditorMode = false;
            console.log("Editor mode exited in simulated terminal");
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
        console.error("Search error:", error);
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
        console.error("Search error:", error);
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
      console.error("Error calculating search results:", error);
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

  // 处理快捷搜索选项
  const handleSearchFromMenu = () => {
    setShowSearchBar(true);
    handleClose();
  };

  // 处理右键菜单打开
  const handleContextMenu = (event) => {
    event.preventDefault();

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
  };

  // 复制选中的文本
  const handleCopy = () => {
    if (selectedText) {
      navigator.clipboard
        .writeText(selectedText)
        .then(() => {
          console.log("文本已复制到剪贴板");
        })
        .catch((err) => {
          console.error("复制到剪贴板失败:", err);
        });
    }
    handleClose();
  };

  // 粘贴剪贴板内容
  const handlePaste = () => {
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text && termRef.current && processCache[tabId]) {
          // 使用预处理函数处理多行文本，防止注释和缩进问题
          const processedText = processMultilineInput(text);
          
          // 检查是否需要逐行发送（含有注释的多行文本）
          if (processedText && typeof processedText === 'object' && processedText.type === 'multiline-with-comments') {
            // 逐行发送文本，每行之间添加适当延迟
            processedText.lines.forEach((line, index) => {
              setTimeout(() => {
                window.terminalAPI.sendToProcess(processCache[tabId], line + (index < processedText.lines.length - 1 ? '\n' : ''));
              }, index * 50); // 50毫秒的延迟，可以根据实际情况调整
            });
          } else {
            // 正常发送处理后的文本
            window.terminalAPI.sendToProcess(processCache[tabId], processedText);
          }
        }
      })
      .catch((err) => {
        console.error("从剪贴板读取失败:", err);
      });
    handleClose();
  };

  // 将选中的文本发送给AI进行解析
  const handleParse = () => {
    if (selectedText) {
      // 创建一个自定义事件，将选中文本传递给AIAssistant组件
      const event = new CustomEvent("terminal:parseText", {
        detail: { text: selectedText }
      });
      // 分发事件
      window.dispatchEvent(event);
      console.log("发送文本到AI解析:", selectedText.substring(0, 30) + (selectedText.length > 30 ? "..." : ""));
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
        console.error("Failed to update SSH process ID:", error);
      }
    };

    return () => {
      // 清理回调
      window.sshProcessIdCallback = null;
    };
  }, []);

  // 设置数据监听器的函数，处理终端输出
  const setupDataListener = (processId, term) => {
    // 防止重复添加监听器
    window.terminalAPI.removeOutputListener(processId);

    // 保存进程ID以便后续可以关闭
    processCache[tabId] = processId;

    // 添加数据监听
    window.terminalAPI.onProcessOutput(processId, (data) => {
      if (data) {
        term.write(data);
        // 更新内容状态标志，表示终端内容已更新
        setContentUpdated(true);

        // 检测全屏应用启动并触发重新调整大小
        // 通常像top, htop, vim, nano等全屏应用会发送特定的ANSI转义序列
        const dataStr = data.toString();

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
          console.log("检测到可能的全屏应用启动或屏幕刷新，调整终端大小");

          // 创建一系列延迟执行，以适应不同应用的启动速度
          const delayTimes = [100, 300, 600, 1000];

          delayTimes.forEach((delay) => {
            setTimeout(() => {
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
          // 先调用fit
          fitAddonRef.current.fit();

          // 获取实际尺寸
          const cols = Math.max(Math.floor(term.cols || 120), 1);
          const rows = Math.max(Math.floor(term.rows || 30), 1);

          console.log(
            `初始同步终端大小: 进程ID=${processId}, 列=${cols}, 行=${rows}`,
          );

          // 同步到后端
          if (window.terminalAPI.resizeTerminal) {
            window.terminalAPI
              .resizeTerminal(processId, cols, rows)
              .catch((err) => console.error("初始终端大小同步失败:", err));
          }
        } catch (error) {
          console.error("终端大小适配失败:", error);
        }
      }
    };

    // 立即同步一次
    syncTerminalSize();

    // 延迟后多次同步，确保布局稳定后大小正确
    setTimeout(syncTerminalSize, 100);
    
    // 添加一个新的辅助函数，确保终端在被激活时调整大小
    const ensureTerminalSizeOnVisibilityChange = () => {
      // 检查当前标签是否可见（通过DOM属性或样式）
      if (terminalRef.current) {
        const isVisible = isElementVisible(terminalRef.current);
        
        if (isVisible && termRef.current && fitAddonRef.current && contentUpdated) {
          // 使用延迟执行强制调整大小
          setTimeout(() => {
            forceResizeTerminal(
              termRef.current,
              terminalRef.current,
              processCache[tabId],
              tabId,
              fitAddonRef.current
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
        if (style.display === 'none' || 
            style.visibility === 'hidden' || 
            style.opacity === '0' ||
            current.getAttribute('aria-hidden') === 'true') {
          return false;
        }
        current = current.parentElement;
      }
      
      // 检查元素是否在视口内
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    
    // 添加一个新的定时器，定期检查终端可见性
    const visibilityCheckInterval = setInterval(() => {
      // 只有当内容有更新时才检查并调整大小
      if (contentUpdated) {
        ensureTerminalSizeOnVisibilityChange();
      }
    }, 200); // 从100ms改为200ms，减轻性能负担
    
    // 添加定时器清理
    return () => {
      clearInterval(visibilityCheckInterval);
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
        
        // 延迟执行以确保DOM已完全更新
        setTimeout(() => {
          if (terminalRef.current && fitAddonRef.current && termRef.current) {
            forceResizeTerminal(
              termRef.current,
              terminalRef.current,
              processCache[tabId],
              tabId,
              fitAddonRef.current
            );
          }
        }, 10);
        
        // 多次尝试调整，以处理某些特殊情况
        const delayTimes = [50, 150, 300];
        delayTimes.forEach(delay => {
          setTimeout(() => {
            if (terminalRef.current && fitAddonRef.current && termRef.current) {
              forceResizeTerminal(
                termRef.current,
                terminalRef.current,
                processCache[tabId],
                tabId,
                fitAddonRef.current
              );
            }
          }, delay);
        });
      }
    };
    
    // 添加事件监听器
    window.addEventListener("tabChanged", handleTabChanged);
    
    // 组件卸载时移除监听器
    return () => {
      window.removeEventListener("tabChanged", handleTabChanged);
    };
  }, [tabId]);

  // 在创建终端前获取当前字体大小
  const createTerminal = () => {
    if (terminalRef.current) {
      // 根据存储的设置获取字体大小
      const currentFontSize = getFontSize();
      
      // 创建新的终端实例
      const newTerm = new Terminal({
        cursorBlink: true,
        cursorStyle: "block",
        scrollback: 10000,
        theme: terminalTheme,
        fontSize: currentFontSize, // 使用存储的字体大小
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        allowTransparency: true,
        disableStdin: false, // 允许用户输入
        convertEol: true, // 将回车转换为换行
        // ... 其他现有选项
      });

      // ... 其余代码保持不变
    }
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        overflow: "hidden",
        pr: "5px" /* 添加右侧边距，避免内容被右侧边栏遮挡 */,
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

        {!showSearchBar && (
          <Tooltip title="搜索 (Ctrl+Alt+F)">
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

        {showSearchBar && (
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
            <Tooltip title="查找下一个 (F3)">
              <span>
                <IconButton
                  size="small"
                  onClick={handleSearch}
                  className="search-button"
                  disabled={!searchTerm || noMatchFound}
                >
                  <SearchIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="查找上一个 (Shift+F3)">
              <span>
                <IconButton
                  size="small"
                  onClick={handleSearchPrevious}
                  className="search-button"
                  disabled={!searchTerm || noMatchFound}
                >
                  <SearchIcon
                    fontSize="small"
                    style={{ transform: "rotate(180deg)" }}
                  />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="关闭">
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
          <div style={{ marginLeft: 8, opacity: 0.7 }}>Ctrl+Alt+C</div>
        </MenuItem>
        <MenuItem onClick={handlePaste}>
          <ListItemIcon>
            <PasteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>粘贴</ListItemText>
          <div style={{ marginLeft: 8, opacity: 0.7 }}>Ctrl+Alt+V / 中键</div>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleSearchFromMenu}>
          <ListItemIcon>
            <SearchIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>搜索</ListItemText>
          <div style={{ marginLeft: 8, opacity: 0.7 }}>Ctrl+Alt+F</div>
        </MenuItem>
        <MenuItem onClick={handleParse} disabled={!selectedText}>
          <ListItemIcon>
            <AutoFixHighIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>解析</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleClear}>
          <ListItemIcon>
            <ClearAllIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>清空</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  );
};

export default WebTerminal;
