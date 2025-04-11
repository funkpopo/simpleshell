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

const WebTerminal = ({ tabId, refreshKey, usePowershell = true, sshConfig = null }) => {
  const terminalRef = useRef(null);
  const termRef = useRef(null);
  const fitAddonRef = useRef(null);
  const currentProcessId = useRef(null);
  const theme = useTheme();
  
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedText, setSelectedText] = useState('');
  const searchAddonRef = useRef(null);
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState({ count: 0, current: 0 });
  const [noMatchFound, setNoMatchFound] = useState(false);

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
          // 连接到SSH
          term.writeln(`正在连接到 ${sshConfig.host}:${sshConfig.port || 22}...`);
          term.writeln(`用户名: ${sshConfig.username}`);
          term.writeln(`认证方式: ${sshConfig.authType === 'privateKey' ? '私钥' : '密码'}`);
          
          // 创建一个连接状态指示器
          let statusElement = document.createElement('div');
          statusElement.className = 'ssh-connecting-status';
          statusElement.style.position = 'absolute';
          statusElement.style.top = '50%';
          statusElement.style.left = '50%';
          statusElement.style.transform = 'translate(-50%, -50%)';
          statusElement.style.background = 'rgba(0, 0, 0, 0.7)';
          statusElement.style.padding = '20px';
          statusElement.style.borderRadius = '5px';
          statusElement.style.color = '#fff';
          statusElement.style.fontSize = '14px';
          statusElement.style.fontFamily = 'Arial, sans-serif';
          statusElement.style.zIndex = '1000';
          
          statusElement.textContent = '连接中...';
          terminalRef.current.appendChild(statusElement);
          
          // 设置进度动画
          let dots = 0;
          
          const updateConnectingStatus = () => {
            dots = (dots + 1) % 4;
            statusElement.textContent = `连接中${''.padEnd(dots, '.')}`;
          };
          
          const progressInterval = setInterval(updateConnectingStatus, 500);
          
          // 获取终端的实际大小，放入SSH配置中
          const sshConfigWithSize = { 
            ...sshConfig,
            cols: term.cols || 120, 
            rows: term.rows || 30
          };
          
          // 发起SSH连接
          window.terminalAPI.startSSH(sshConfigWithSize)
            .then(processId => {
              // 清除连接状态指示器
              clearInterval(progressInterval);
              if (terminalRef.current && statusElement.parentNode === terminalRef.current) {
                terminalRef.current.removeChild(statusElement);
              }
              
              // 存储进程ID
              processCache[tabId] = processId;
              currentProcessId.current = processId;
              
              // 设置数据处理
              setupDataListener(processId, term);
            })
            .catch(error => {
              // 清除连接状态指示器
              clearInterval(progressInterval);
              if (terminalRef.current && statusElement.parentNode === terminalRef.current) {
                terminalRef.current.removeChild(statusElement);
              }
              
              console.error('SSH connection error:', error);
              
              // 根据错误类型提供更具体的提示
              if (error.message.includes('connect ECONNREFUSED')) {
                term.writeln('\r\n提示: 无法连接到服务器。请检查：');
                term.writeln('1. 主机地址和端口是否正确');
                term.writeln('2. 服务器SSH服务是否运行');
                term.writeln('3. 网络连接是否通畅');
                term.writeln('4. 防火墙是否允许SSH连接');
              } else if (error.message.includes('Authentication failed')) {
                term.writeln('\r\n提示: 身份验证失败。请检查：');
                term.writeln('1. 用户名是否正确');
                term.writeln('2. 密码是否正确');
                term.writeln('3. 如果使用密钥认证，请确保私钥文件有效');
              } else if (error.message.includes('timeout')) {
                term.writeln('\r\n提示: 连接超时。请检查：');
                term.writeln('1. 网络连接是否稳定');
                term.writeln('2. 服务器是否响应慢或繁忙');
              } else {
                term.writeln('\r\n提示: 请检查连接参数并重试。按Ctrl+R可以尝试重新连接');
              }
            });
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
              processMultiLineText(text);
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
              processMultiLineText(text);
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
            
            // 确保终端完全填充容器
            if (term && term.element) {
              term.element.style.width = `${currentWidth}px`;
              term.element.style.height = `${currentHeight}px`;
            }
          }
          
          // 适配终端大小
          fitAddon.fit();
          
          // 获取当前终端的大小
          const dimensions = term.options;
          // 改用正确的方法获取终端大小
          const actualCols = term.cols || dimensions.cols || 120;
          const actualRows = term.rows || dimensions.rows || 30;
          
          if (processCache[tabId] && window.terminalAPI && window.terminalAPI.resizeTerminal) {
            // 通知后端调整终端大小
            window.terminalAPI.resizeTerminal(
              processCache[tabId], 
              actualCols, 
              actualRows
            );
            
            // 调试信息
            console.debug(`终端大小已调整: ${actualCols}x${actualRows}`);
          }
        } catch (error) {
          console.error('Error resizing terminal:', error);
        }
      };

      // 立即调整大小
      handleResize();
      
      // 添加一个小延迟后再次调整大小，确保DOM完全渲染
      setTimeout(handleResize, 10);
      
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
        for (const mutation of mutations) {
          if (mutation.attributeName === 'style' || 
              mutation.attributeName === 'class' ||
              mutation.type === 'childList') {
            setTimeout(handleResize, 50);
            break;
          }
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
        handleResize();
        // 特别要检查xtermjs的内容元素是否需要重新适配
        if (termRef.current && termRef.current.element) {
          const xtermElement = termRef.current.element;
          const container = terminalRef.current;
          if (container && (
              Math.abs(xtermElement.clientWidth - container.clientWidth) > 5 ||
              Math.abs(xtermElement.clientHeight - container.clientHeight) > 5
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
        
        // 处理终端输入发送到PowerShell进程
        term.onData(data => {
          window.terminalAPI.sendToProcess(processId, data);
        });
        
        // 确保终端大小正确设置
        setTimeout(() => {
          if (fitAddonRef.current) {
            fitAddonRef.current.fit();
            
            // 获取当前终端的实际大小
            const actualCols = term.cols || 120;
            const actualRows = term.rows || 30;
            
            // 发送大小调整命令
            if (window.terminalAPI.resizeTerminal) {
              window.terminalAPI.resizeTerminal(processId, actualCols, actualRows);
              console.debug(`PowerShell终端大小已设置: ${actualCols}x${actualRows}`);
            }
          }
        }, 100);
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
          // 处理文本，保持原始缩进
          processMultiLineText(text);
        }
      })
      .catch(err => {
        console.error('从剪贴板读取失败:', err);
      });
    handleClose();
  };

  // 处理多行文本粘贴，保持原始缩进
  const processMultiLineText = (text) => {
    if (!text || !processCache[tabId]) return;
    
    // 按行分割文本，保留每行结尾的换行符
    const lines = text.split(/\r?\n/);
    
    // 如果只有一行不包含换行符的文本，直接发送
    if (lines.length === 1) {
      window.terminalAPI.sendToProcess(processCache[tabId], text);
      return;
    }
    
    console.log(`正在处理多行文本粘贴，共 ${lines.length} 行`);
    
    // 获取进程信息，确定终端类型
    const procInfo = processCache[tabId];
    
    // 针对PowerShell/SSH终端采用字符发送策略
    // 基本策略：依次发送每一行，每行后面跟一个回车
    const sendLines = async () => {
      // 发送第一行
      if (lines[0]) {
        window.terminalAPI.sendToProcess(processCache[tabId], lines[0]);
      }
      
      // 等待第一行处理完成
      await new Promise(resolve => setTimeout(resolve, 10));
      
      // 依次发送剩余行，每行前面添加一个回车
      for (let i = 1; i < lines.length; i++) {
        // 发送回车换行
        window.terminalAPI.sendToProcess(processCache[tabId], '\r');
        
        // 等待回车处理完成
        await new Promise(resolve => setTimeout(resolve, 5));
        
        // 发送行内容（保持原始缩进）
        window.terminalAPI.sendToProcess(processCache[tabId], lines[i]);
        
        // 如果不是最后一行，等待一小段时间以确保处理完成
        if (i < lines.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      
      console.log('多行文本粘贴处理完成');
    };
    
    // 执行发送
    sendLines().catch(err => {
      console.error('发送多行文本失败:', err);
    });
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
    // 保存进程ID以便后续可以关闭
    processCache[tabId] = processId;
    
    // 设置数据处理
    window.terminalAPI.onProcessOutput(processId, (data) => {
      if (data) {
        term.write(data);
      }
    });
    
    // 处理终端输入发送到进程
    term.onData(data => {
      window.terminalAPI.sendToProcess(processId, data);
    });
    
    // 连接建立后，主动调整终端大小
    setTimeout(() => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit();
        const dims = term.options;
        if (window.terminalAPI.resizeTerminal && dims) {
          window.terminalAPI.resizeTerminal(
            processId, 
            dims.cols || 120, 
            dims.rows || 30
          );
        }
      }
    }, 500);  // 延迟500ms确保终端已准备好
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