import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import '@xterm/xterm/css/xterm.css';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PasteIcon from '@mui/icons-material/ContentPaste';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import Divider from '@mui/material/Divider';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';

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
    const termElementWidth = termElement ? termElement.clientWidth : 'NA';
    const termElementHeight = termElement ? termElement.clientHeight : 'NA';
    
    console.log(`[终端大小信息] ${message}:`, {
      container: `${containerWidth}x${containerHeight}`,
      terminal: `${termCols}x${termRows}`,
      element: `${termElementWidth}x${termElementHeight}`
    });
  } catch (error) {
    console.error('记录终端大小信息时出错:', error);
  }
};

// 添加一个用于强制重新计算和同步终端大小的辅助函数
const forceResizeTerminal = (term, container, processId, tabId, fitAddon) => {
  if (!term || !container || !fitAddon) return;
  
  try {
    // 强制重新计算DOM大小
    const currentWidth = container.clientWidth;
    const currentHeight = container.clientHeight;
    
    // 记录调整前的大小信息
    logTerminalSize('强制调整前', term, container);
    
    // 确保终端完全填充容器
    if (term && term.element) {
      term.element.style.width = `${currentWidth}px`;
      term.element.style.height = `${currentHeight}px`;
    }
    
    // 适配终端大小
    fitAddon.fit();
    
    // 记录调整后的大小信息
    logTerminalSize('强制调整后', term, container);
    
    // 获取当前终端的大小
    const cols = Math.max(Math.floor(term.cols || 120), 1);
    const rows = Math.max(Math.floor(term.rows || 30), 1);
    
    console.log(`强制调整终端大小: 进程ID=${processId || tabId}, 列=${cols}, 行=${rows}`);
    
    // 通知后端调整终端大小
    if (window.terminalAPI && window.terminalAPI.resizeTerminal) {
      window.terminalAPI.resizeTerminal(processId || tabId, cols, rows)
        .catch(err => console.error('终端大小强制调整失败:', err));
    }
  } catch (error) {
    console.error('强制调整终端大小时出错:', error);
  }
};

const WebTerminal = ({ tabId, refreshKey, usePowershell = true, sshConfig = null }) => {
  const terminalRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const currentProcessId = useRef(null);
  const theme = useTheme();
  let resizeTimeout = null;
  
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedText, setSelectedText] = useState('');
  const searchAddonRef = useRef(null);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState({ count: 0, current: 0 });
  const [noMatchFound, setNoMatchFound] = useState(false);

  // 定义检测用户输入命令的函数，用于监控特殊命令执行
  const setupCommandDetection = (term, processId) => {
    term.onData(data => {
      // 检测回车键（通常是命令执行的触发）
      if (data === '\r' || data === '\n') {
        try {
          // 获取终端的最后一行内容（可能包含用户输入的命令）
          const lastLine = term.buffer.active.getLine(term.buffer.active.cursorY)?.translateToString() || '';
          
          // 检查这一行是否包含常见的全屏应用命令
          if (/\b(top|htop|vi|vim|nano|less|more|watch|tail -f)\b/.test(lastLine)) {
            console.log('检测到用户输入全屏应用命令:', lastLine);
            
            // 使用延迟序列触发终端大小调整
            const delayTimes = [200, 500, 1000, 1500];
            delayTimes.forEach(delay => {
              setTimeout(() => {
                if (terminalRef.current && fitAddonRef.current) {
                  forceResizeTerminal(term, terminalRef.current, processId, tabId, fitAddonRef.current);
                }
              }, delay);
            });
          }
        } catch (error) {
          // 忽略任何错误，不影响正常功能
          console.error('检测用户输入命令时出错:', error);
        }
      }
      
      // 发送数据到进程
      if (processId) {
        window.terminalAPI.sendToProcess(processId, data);
      }
    });
  };

  // 定义响应主题模式的终端主题
  const terminalTheme = {
    // 背景色根据应用主题模式设置
    background: theme.palette.mode === 'light' ? '#ffffff' : '#1e1e1e',
    // 文本颜色根据背景色调整，浅色背景使用暗色文本
    foreground: theme.palette.mode === 'light' ? '#000000' : '#ffffff',
    // 光标颜色根据背景自动调整
    cursor: theme.palette.mode === 'light' ? '#000000' : '#ffffff',
    // 选择文本的背景色，使用半透明色以避免遮挡字符
    selectionBackground: theme.palette.mode === 'light' ? 'rgba(255, 255, 170, 0.35)' : 'rgba(30, 100, 255, 0.3)',
    // 选择文本的前景色，确保文字清晰可见
    selectionForeground: theme.palette.mode === 'light' ? '#000000' : '#ffffff',
    // 基础颜色
    black: '#000000',
    red: '#cc0000',
    green: '#4e9a06',
    yellow: '#c4a000',
    blue: '#3465a4',
    magenta: '#75507b',
    cyan: '#06989a',
    white: '#d3d7cf',
    // 亮色版本
    brightBlack: theme.palette.mode === 'light' ? '#555753' : '#555753',
    brightRed: '#ef2929',
    brightGreen: '#8ae234',
    brightYellow: '#fce94f',
    brightBlue: '#729fcf',
    brightMagenta: '#ad7fa8',
    brightCyan: '#34e2e2',
    brightWhite: '#eeeeec'
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
          console.error('Failed to kill process:', error);
        }
        delete processCache[tabId];
      }
      
      // 清除旧终端
      try {
        terminalCache[tabId].dispose();
      } catch (error) {
        console.error('Failed to dispose terminal:', error);
      }
      
      delete terminalCache[tabId];
      delete fitAddonCache[tabId];
    }
  }, [refreshKey, tabId]);

  useEffect(() => {
    // 添加全局样式
    const styleElement = document.createElement('style');
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
          fontSize: 14,
          scrollback: 10000,
          allowTransparency: true,
          cols: 120,  // 设置更宽的初始列数
          rows: 30,   // 设置初始行数
          convertEol: true,  // 自动将行尾换行符转换为CRLF
          disableStdin: false,
          rendererType: 'canvas',
          termName: 'xterm-256color',  // 使用更高级的终端类型
          allowProposedApi: true,      // 允许使用提议的API
          rightClickSelectsWord: false, // 禁用右键点击选中单词，使用自定义右键菜单
          copyOnSelect: false          // 选中后不自动复制
        });

        // 创建并加载插件
        fitAddon = new FitAddon();
        searchAddon = new SearchAddon();
        const webLinksAddon = new WebLinksAddon();
        
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
            window.terminalAPI.startSSH(sshConfig)
              .then(processId => {
                if (processId) {
                  console.log(`SSH连接成功，tabId=${tabId}, processId=${processId}`);
                  
                  // 存储进程ID
                  currentProcessId.current = processId;
                  
                  // 存储到进程缓存中
                  processCache[tabId] = processId;
                  
                  // 触发SSH进程ID更新事件，用于通知其他组件
                  const event = new CustomEvent('sshProcessIdUpdated', {
                    detail: { terminalId: tabId, processId }
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
                      forceResizeTerminal(term, terminalRef.current, processId, tabId, fitAddonRef.current);
                    }
                  }, 1000);
                  
                  setTimeout(() => {
                    if (terminalRef.current && fitAddonRef.current) {
                      forceResizeTerminal(term, terminalRef.current, processId, tabId, fitAddonRef.current);
                    }
                  }, 2000);
                } else {
                  term.writeln(`连接失败: 未能获取进程ID`);
                }
              })
              .catch(error => {
                console.error('SSH connection error:', error);
                term.writeln(`\r\n连接失败: ${error.message || '未知错误'}`);
              });
          } catch (error) {
            console.error('Failed to start SSH:', error);
            term.writeln(`\r\n连接失败: ${error.message || '未知错误'}`);
          }
        }
        // 连接到本地PowerShell
        else if (usePowershell && window.terminalAPI && window.terminalAPI.startPowerShell) {
          startPowerShell(term, tabId);
        } else {
          // 如果不使用PowerShell或API不可用，使用模拟终端
          term.writeln('Welcome to WebTerminal!');
          term.writeln('Type "help" for available commands.');
          term.writeln('');
          term.write('$ ');
          
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
        if (e.target && e.target.classList && e.target.classList.contains('xterm-helper-textarea')) {
          return;
        }
        
        // Ctrl+Alt+C 复制 (改为Ctrl+Alt+C)
        if (e.ctrlKey && e.altKey && e.key === 'c') {
          const selection = term.getSelection();
          if (selection) {
            e.preventDefault();
            navigator.clipboard.writeText(selection);
            console.log('已复制文本:', selection);
          }
        }
        // Ctrl+Alt+V 粘贴 (改为Ctrl+Alt+V)
        else if (e.ctrlKey && e.altKey && e.key === 'v') {
          e.preventDefault();
          navigator.clipboard.readText().then(text => {
            if (text && processCache[tabId]) {
              window.terminalAPI.sendToProcess(processCache[tabId], text);
            }
          });
        }
        // Ctrl+Alt+F 搜索 (改为Ctrl+Alt+F)
        else if (e.ctrlKey && e.altKey && e.key === 'f') {
          e.preventDefault();
          setShowSearchBar(true);
        }
        // Esc 关闭搜索
        else if (e.key === 'Escape' && showSearchBar) {
          e.preventDefault();
          setShowSearchBar(false);
        }
        // F3 查找下一个
        else if (e.key === 'F3' || (e.ctrlKey && e.key === 'g')) {
          if (searchAddonRef.current && searchTerm) {
            e.preventDefault();
            handleSearch();
          }
        }
        // Shift+F3 查找上一个
        else if ((e.shiftKey && e.key === 'F3') || (e.ctrlKey && e.shiftKey && e.key === 'g')) {
          if (searchAddonRef.current && searchTerm) {
            e.preventDefault();
            handleSearchPrevious();
          }
        }
      };
      
      // 添加键盘事件监听
      document.addEventListener('keydown', handleKeyDown);
      
      // 添加鼠标中键粘贴功能
      const handleMouseDown = (e) => {
        // 鼠标中键点击 (e.button === 1 表示鼠标中键)
        if (e.button === 1) {
          e.preventDefault();
          navigator.clipboard.readText().then(text => {
            if (text && processCache[tabId]) {
              window.terminalAPI.sendToProcess(processCache[tabId], text);
            }
          });
        }
      };
      
      // 添加鼠标事件监听
      if (terminalRef.current) {
        terminalRef.current.addEventListener('mousedown', handleMouseDown);
      }
      
      // 添加右键菜单事件监听
      if (terminalRef.current) {
        terminalRef.current.addEventListener('contextmenu', handleContextMenu);
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
            logTerminalSize('调整前', term, container);
            
            // 确保终端完全填充容器
            if (term && term.element) {
              term.element.style.width = `${currentWidth}px`;
              term.element.style.height = `${currentHeight}px`;
            }
          }
          
          // 适配终端大小
          fitAddon.fit();
          
          // 记录调整后的大小信息
          if (terminalRef.current) {
            logTerminalSize('调整后', term, terminalRef.current);
          }
          
          // 获取当前终端的大小
          // 直接获取fit后的实际尺寸而非options中的值
          const dimensions = {
            cols: term.cols,
            rows: term.rows
          };
          
          if (processCache[tabId] && window.terminalAPI.resizeTerminal) {
            // 确保cols和rows是有效的正整数
            const cols = Math.max(Math.floor(dimensions.cols || 120), 1);
            const rows = Math.max(Math.floor(dimensions.rows || 30), 1);
            
            console.log(`调整终端大小: 进程ID=${processCache[tabId]}, 列=${cols}, 行=${rows}`);
            
            // 通知后端调整终端大小
            window.terminalAPI.resizeTerminal(
              processCache[tabId], 
              cols, 
              rows
            ).catch(err => {
              console.error('终端大小调整失败:', err);
            });
            
            // 延迟再次调整大小，确保在某些情况下终端尺寸能够正确同步
            setTimeout(() => {
              if (terminalRef.current && term && processCache[tabId]) {
                window.terminalAPI.resizeTerminal(
                  processCache[tabId],
                  Math.max(Math.floor(term.cols || 120), 1),
                  Math.max(Math.floor(term.rows || 30), 1)
                ).catch(err => console.error('延迟终端大小调整失败:', err));
              }
            }, 300);
          }
        } catch (error) {
          console.error('Error resizing terminal:', error);
        }
      };

      // 立即调整大小
      handleResize();
      
      // 添加resize事件监听
      window.addEventListener('resize', handleResize);
      
      // 添加标签页激活/可见性事件处理
      const handleVisibilityChange = () => {
        if (!document.hidden && termRef.current) {
          // 页面可见时调整大小
          setTimeout(handleResize, 50);
        }
      };
      
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      // 创建一个MutationObserver来检测元素的可见性变化
      const observer = new MutationObserver((mutations) => {
        let shouldResize = false;
        
        // 检查变化是否可能影响大小
        for (const mutation of mutations) {
          // 属性变化可能影响大小
          if (mutation.attributeName === 'style' || 
              mutation.attributeName === 'class') {
            shouldResize = true;
            break;
          }
          
          // 子元素变化也可能影响大小
          if (mutation.type === 'childList') {
            shouldResize = true;
            break;
          }
        }
        
        if (shouldResize) {
          // 使用节流函数延迟调用resize，避免频繁调整
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(() => {
            // 检查终端容器和DOM尺寸
            if (terminalRef.current && termRef.current) {
              // 检查尺寸是否确实发生变化
              const container = terminalRef.current;
              const xtermElement = termRef.current.element;
              
              if (xtermElement && (
                  Math.abs(xtermElement.clientWidth - container.clientWidth) > 2 ||
                  Math.abs(xtermElement.clientHeight - container.clientHeight) > 2
              )) {
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
          subtree: true 
        });
        
        // 尝试观察父元素
        let parent = terminalRef.current.parentElement;
        if (parent) {
          observer.observe(parent, { attributes: true });
          
          // 对于TabPanel的特殊处理
          if (parent.parentElement) {
            observer.observe(parent.parentElement, { attributes: true });
          }
        }
      }
      
      // 定时检查并调整大小，以确保在不同情况下都能正确适配
      const resizeInterval = setInterval(() => {
        if (termRef.current && termRef.current.element) {
          const xtermElement = termRef.current.element;
          const container = terminalRef.current;
          if (container && (
              Math.abs(xtermElement.clientWidth - container.clientWidth) > 10 ||
              Math.abs(xtermElement.clientHeight - container.clientHeight) > 10
          )) {
            handleResize();
          }
        }
      }, 200);

      // 保存引用以在其他方法中使用
      termRef.current = term;
      fitAddonRef.current = fitAddon;

      // 清理函数
      return () => {
        window.removeEventListener('resize', handleResize);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        document.removeEventListener('keydown', handleKeyDown);
        observer.disconnect();
        clearInterval(resizeInterval);
        
        // 清理任何事件监听器
        if (window.terminalAPI) {
          if (processCache[tabId]) {
            window.terminalAPI.removeOutputListener(processCache[tabId]);
          } else {
            window.terminalAPI.removeOutputListener();
          }
        }
        
        if (terminalRef.current) {
          terminalRef.current.removeEventListener('contextmenu', handleContextMenu);
          terminalRef.current.removeEventListener('mousedown', handleMouseDown);
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
            console.error('Error detaching terminal:', err);
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
    term.writeln('正在连接到 PowerShell...');
    
    // 启动PowerShell进程
    window.terminalAPI.startPowerShell()
      .then(processId => {
        // 保存进程ID以便后续可以关闭
        processCache[tabId] = processId;
        
        // 设置数据处理
        window.terminalAPI.onProcessOutput(processId, (data) => {
          if (data) {
            term.write(data);
          }
        });
        
        // 设置命令检测
        setupCommandDetection(term, processId);
      })
      .catch(err => {
        term.writeln(`连接到PowerShell失败: ${err.message || '未知错误'}`);
        term.writeln('正在回退到模拟终端模式...');
        setupSimulatedTerminal(term);
      });
  };

  // 设置模拟终端的功能
  const setupSimulatedTerminal = (term) => {
    // 处理用户输入
    let userInput = '';
    
    term.onKey(({ key, domEvent }) => {
      const printable = !domEvent.altKey && !domEvent.ctrlKey && !domEvent.metaKey;

      // 回车键处理
      if (domEvent.keyCode === 13) {
        term.writeln('');
        
        // 处理命令
        if (userInput.trim() !== '') {
          // 如果 IPC API 不可用，使用本地处理命令
          handleCommand(term, userInput);
          term.write('$ ');
        } else {
          term.write('$ ');
        }
        
        // 重置输入
        userInput = '';
      } 
      // 退格键处理
      else if (domEvent.keyCode === 8) {
        if (userInput.length > 0) {
          userInput = userInput.slice(0, -1);
          term.write('\b \b');
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
      case 'help':
        term.writeln('Available commands:');
        term.writeln('  help     - Show this help message');
        term.writeln('  clear    - Clear the terminal');
        term.writeln('  date     - Show current date and time');
        term.writeln('  echo     - Echo back your text');
        break;
      case 'clear':
        term.clear();
        break;
      case 'date':
        term.writeln(new Date().toString());
        break;
      default:
        if (command.startsWith('echo ')) {
          term.writeln(command.substring(5));
        } else if (command !== '') {
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
            setSearchResults(prev => ({
              ...prev,
              current: (prev.current % prev.count) + 1
            }));
          }
        }
      } catch (error) {
        console.error('Search error:', error);
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
            setSearchResults(prev => ({
              ...prev,
              current: prev.current <= 1 ? prev.count : prev.current - 1
            }));
          }
        }
      } catch (error) {
        console.error('Search error:', error);
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
      console.error('Error calculating search results:', error);
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
      navigator.clipboard.writeText(selectedText)
        .then(() => {
          console.log('文本已复制到剪贴板');
        })
        .catch(err => {
          console.error('复制到剪贴板失败:', err);
        });
    }
    handleClose();
  };

  // 粘贴剪贴板内容
  const handlePaste = () => {
    navigator.clipboard.readText()
      .then(text => {
        if (text && termRef.current && processCache[tabId]) {
          window.terminalAPI.sendToProcess(processCache[tabId], text);
        }
      })
      .catch(err => {
        console.error('从剪贴板读取失败:', err);
      });
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
        const event = new CustomEvent('sshProcessIdUpdated', { 
          detail: { terminalId, processId } 
        });
        window.dispatchEvent(event);
      } catch (error) {
        console.error('Failed to update SSH process ID:', error);
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
        
        // 检测全屏应用启动并触发重新调整大小
        // 通常像top, htop, vim, nano等全屏应用会发送特定的ANSI转义序列
        const dataStr = data.toString();
        
        // 检测常见的全屏应用启动特征
        if (
          // 检测清屏命令
          dataStr.includes('\u001b[2J') ||
          // 检测光标定位到左上角
          dataStr.includes('\u001b[H') ||
          // 检测光标位置保存或恢复（常见于全屏应用）
          dataStr.includes('\u001b[s') || dataStr.includes('\u001b[u') ||
          // 检测屏幕清除到结尾（常见于全屏刷新）
          dataStr.includes('\u001b[J') ||
          // 检测常见的全屏应用命令名称
          /\b(top|htop|vi|vim|nano|less|more|tail -f|watch)\b/.test(dataStr) ||
          // 检测终端屏幕缓冲区交替（用于全屏应用）
          dataStr.includes('\u001b[?1049h') || dataStr.includes('\u001b[?1049l') ||
          // 检测终端大小查询回复
          /\u001b\[8;\d+;\d+t/.test(dataStr)
        ) {
          console.log('检测到可能的全屏应用启动或屏幕刷新，调整终端大小');
          
          // 创建一系列延迟执行，以适应不同应用的启动速度
          const delayTimes = [100, 300, 600, 1000];
          
          delayTimes.forEach(delay => {
            setTimeout(() => {
              if (terminalRef.current && fitAddonRef.current) {
                forceResizeTerminal(term, terminalRef.current, processId, tabId, fitAddonRef.current);
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
          
          console.log(`初始同步终端大小: 进程ID=${processId}, 列=${cols}, 行=${rows}`);
          
          // 同步到后端
          if (window.terminalAPI.resizeTerminal) {
            window.terminalAPI.resizeTerminal(processId, cols, rows)
              .catch(err => console.error('初始终端大小同步失败:', err));
          }
        } catch (error) {
          console.error('终端大小适配失败:', error);
        }
      }
    };
    
    // 立即同步一次
    syncTerminalSize();
    
    // 延迟后多次同步，确保布局稳定后大小正确
    setTimeout(syncTerminalSize, 100);
    setTimeout(syncTerminalSize, 300);
    setTimeout(syncTerminalSize, 800);
    setTimeout(syncTerminalSize, 1500);
  };

  // 监听主题变化并更新终端主题
  useEffect(() => {
    if (terminalCache[tabId]) {
      // 更新主题
      terminalCache[tabId].options.theme = terminalTheme;
    }
  }, [theme.palette.mode, tabId]);

  return (
    <Box sx={{ 
      width: '100%', 
      height: '100%', 
      display: 'flex', 
      overflow: 'hidden',
      pr: '5px', /* 添加右侧边距，避免内容被右侧边栏遮挡 */
    }}>
      <div className="terminal-container">
        <div 
          ref={terminalRef} 
          style={{ 
            width: '100%', 
            height: '100%',
            padding: '0 0 0 0',
          }}
        />
        
        {!showSearchBar && (
          <Tooltip title="搜索 (Ctrl+Alt+F)">
            <IconButton 
              size="small" 
              className="search-icon-btn"
              onClick={() => setShowSearchBar(true)}
              sx={{
                padding: '4px',
                '& svg': {
                  fontSize: '18px'
                }
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
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowSearchBar(false);
                }
              }}
              style={{
                borderColor: noMatchFound ? 'red' : undefined,
                width: searchTerm ? '150px' : '200px', // 有搜索结果显示时调整宽度
              }}
            />
            {searchTerm && (
              <div style={{ 
                color: noMatchFound ? '#ff6b6b' : '#aaa', 
                margin: '0 8px', 
                fontSize: '12px', 
                whiteSpace: 'nowrap',
                minWidth: '50px',
                textAlign: 'center'
              }}>
                {noMatchFound ? '无匹配结果' : (searchResults.count > 0 ? `${searchResults.current}/${searchResults.count}` : '')}
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
                  <SearchIcon fontSize="small" style={{ transform: 'rotate(180deg)' }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="关闭">
              <IconButton size="small" onClick={() => setShowSearchBar(false)} className="search-button">
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
            bgcolor: 'background.paper',
            color: 'text.primary'
          }
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