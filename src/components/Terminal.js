import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import io from 'socket.io-client';
import '../styles/terminal.css';

/**
 * WebTerminal组件类
 * 实现一个基于xterm.js的终端界面，通过Socket.io与Electron主进程通信
 */
class WebTerminal {
  /**
   * 构造函数
   * @param {Object} options 终端选项
   * @param {string} options.containerId 终端容器ID
   * @param {number} options.socketPort Socket服务器端口号
   */
  constructor(options) {
    this.containerId = options.containerId || 'terminal-container';
    this.socketPort = options.socketPort || 3000;
    this.container = document.getElementById(this.containerId);
    
    if (!this.container) {
      throw new Error(`找不到ID为 ${this.containerId} 的容器元素`);
    }

    this.terminal = null;
    this.fitAddon = null;
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    
    this.init();
  }

  /**
   * 初始化终端
   */
  init() {
    // 创建xterm.js终端实例
    this.terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
      theme: {
        background: '#1e1e1e',
        foreground: '#f0f0f0'
      }
    });

    // 添加FitAddon以自适应容器大小
    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    // 打开终端
    this.terminal.open(this.container);
    this.fitAddon.fit();

    // 初始界面显示
    this.terminal.writeln('欢迎使用 Web Terminal');
    this.terminal.writeln('请使用 connect 命令连接到远程服务器');
    this.terminal.writeln('示例: connect user@host:port password');
    this.terminal.writeln('');
    this.terminal.write('> ');

    // 注册事件处理器
    this.registerEvents();
    
    // 窗口大小改变时调整终端大小
    window.addEventListener('resize', () => {
      this.fitAddon.fit();
      this.updateTerminalSize();
    });
  }

  /**
   * 注册终端事件处理
   */
  registerEvents() {
    // 处理用户输入
    let commandBuffer = '';
    
    this.terminal.onData((data) => {
      // 如果已连接到SSH，直接发送用户输入
      if (this.connected && this.socket) {
        this.socket.emit('ssh:data', { data });
        return;
      }

      // 否则，处理本地命令
      switch (data) {
        case '\r': // 回车键
          this.terminal.write('\r\n');
          this.processCommand(commandBuffer);
          commandBuffer = '';
          if (!this.connected) {
            this.terminal.write('> ');
          }
          break;
        case '\u007F': // 退格键
          if (commandBuffer.length > 0) {
            commandBuffer = commandBuffer.slice(0, -1);
            this.terminal.write('\b \b');
          }
          break;
        default:
          // 忽略控制字符
          if (data >= ' ') {
            commandBuffer += data;
            this.terminal.write(data);
          }
          break;
      }
    });
  }

  /**
   * 处理本地命令
   * @param {string} command 命令字符串
   */
  processCommand(command) {
    if (!command) return;

    const cmd = command.trim().split(' ')[0].toLowerCase();
    
    switch (cmd) {
      case 'connect':
        this.handleConnectCommand(command);
        break;
      case 'disconnect':
        this.disconnect();
        break;
      case 'clear':
        this.terminal.clear();
        break;
      case 'help':
        this.showHelp();
        break;
      default:
        this.terminal.writeln(`未知命令: ${command}`);
        break;
    }
  }

  /**
   * 处理连接命令
   * @param {string} command 完整的连接命令
   */
  handleConnectCommand(command) {
    const parts = command.trim().split(' ');
    if (parts.length < 2) {
      this.terminal.writeln('格式错误，请使用: connect user@host:port password');
      return;
    }

    // 解析连接字符串
    const connectionString = parts[1];
    const password = parts[2] || '';
    
    const match = connectionString.match(/^(.+)@([^:]+)(?::(\d+))?$/);
    if (!match) {
      this.terminal.writeln('连接字符串格式错误，应为: user@host:port');
      return;
    }

    const [, username, host, port] = match;
    
    // 初始化Socket连接
    this.initSocket({
      host,
      port: port ? parseInt(port, 10) : 22,
      username,
      password
    });
  }

  /**
   * 初始化Socket连接
   * @param {Object} sshConfig SSH连接配置
   */
  initSocket(sshConfig) {
    if (this.socket) {
      // 如果已有连接，先断开
      this.socket.disconnect();
    }

    this.terminal.writeln(`正在连接到 ${sshConfig.username}@${sshConfig.host}:${sshConfig.port}...`);
    
    // 重置重连尝试次数
    this.reconnectAttempts = 0;
    
    // 连接到Socket服务器，使用WebSocket传输
    this.socket = io(`http://localhost:${this.socketPort}`, {
      // 强制仅使用WebSocket传输
      transports: ['websocket'],
      // 不尝试其他传输方式
      upgrade: false,
      // 连接超时
      timeout: 10000,
      // 自定义重连逻辑
      reconnection: false,
      // 自动连接
      autoConnect: true,
      forceNew: true
    });

    // 连接成功事件
    this.socket.on('connect', () => {
      this.terminal.writeln('与Socket服务器连接成功，正在建立SSH连接...');
      // 检查连接类型
      const transport = this.socket.io.engine.transport.name;
      this.terminal.writeln(`连接类型: ${transport}`);
      
      if (transport !== 'websocket') {
        this.terminal.writeln('警告: 未使用WebSocket连接，将尝试断开并重连');
        this.socket.disconnect();
        // 延迟后重试
        setTimeout(() => {
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.terminal.writeln(`尝试使用WebSocket重连(${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            this.initSocket(sshConfig);
          } else {
            this.terminal.writeln('无法建立WebSocket连接，请检查网络环境后重试');
          }
        }, 1000);
        return;
      }
      
      // 发送SSH连接请求
      this.socket.emit('ssh:connect', sshConfig);
    });

    // 连接错误
    this.socket.on('connect_error', (err) => {
      this.terminal.writeln(`Socket连接错误: ${err.message}`);
      
      // 尝试重连
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        this.terminal.writeln(`尝试重连(${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        setTimeout(() => {
          this.socket.connect();
        }, 2000); // 2秒后重试
      } else {
        this.terminal.writeln('重连失败，请检查网络连接或服务器状态');
        this.disconnect();
      }
    });

    // SSH连接成功
    this.socket.on('ssh:connected', ({ message }) => {
      this.connected = true;
      this.terminal.writeln(`SSH连接已建立: ${message || ''}`);
      
      // 更新终端大小
      this.updateTerminalSize();
    });

    // 接收SSH数据
    this.socket.on('ssh:data', ({ data }) => {
      this.terminal.write(data);
    });

    // SSH连接错误
    this.socket.on('ssh:error', ({ message }) => {
      this.terminal.writeln(`SSH错误: ${message}`);
      this.disconnect();
    });

    // SSH连接关闭
    this.socket.on('ssh:close', ({ message }) => {
      this.terminal.writeln(`SSH连接已关闭: ${message || ''}`);
      this.disconnect();
    });

    // Socket连接断开
    this.socket.on('disconnect', (reason) => {
      this.terminal.writeln(`与Socket服务器的连接已断开，原因: ${reason}`);
      this.disconnect();
    });
  }

  /**
   * 断开连接
   */
  disconnect() {
    if (this.socket) {
      // 发送断开SSH连接请求
      if (this.connected) {
        try {
          this.socket.emit('ssh:disconnect');
        } catch (error) {
          console.error('断开SSH连接时出错:', error);
        }
      }
      
      // 断开Socket连接
      try {
        this.socket.disconnect();
      } catch (error) {
        console.error('断开Socket连接时出错:', error);
      }
      
      this.socket = null;
    }
    
    this.connected = false;
    this.terminal.writeln('已断开连接');
    this.terminal.write('> ');
  }

  /**
   * 更新终端窗口大小
   */
  updateTerminalSize() {
    if (this.socket && this.connected) {
      const dimensions = this.terminal.rows 
        ? { cols: this.terminal.cols, rows: this.terminal.rows }
        : { cols: 80, rows: 24 };
      
      this.socket.emit('ssh:resize', dimensions);
    }
  }

  /**
   * 显示帮助信息
   */
  showHelp() {
    this.terminal.writeln('可用命令:');
    this.terminal.writeln('  connect user@host:port password - 连接到SSH服务器');
    this.terminal.writeln('  disconnect - 断开当前连接');
    this.terminal.writeln('  clear - 清屏');
    this.terminal.writeln('  help - 显示此帮助');
  }
}

export default WebTerminal; 