const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const socketServer = require('./services/socket-server');
const sshService = require('./services/ssh');
const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const { dialog } = require('electron');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow = null;
// 存储活动的进程
const activeProcesses = new Map();
// 存储配置文件路径
const configDir = path.join(app.getPath('userData'), 'config');
const connectionsFile = path.join(configDir, 'connections.json');

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    autoHideMenuBar: true,
    frame: true,
    icon: path.join(__dirname, 'assets/logo.ico'),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    },
  });

  // 移除默认菜单栏
  mainWindow.setMenu(null);

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Open the DevTools in development mode
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
};

// 确保配置目录存在
const ensureConfigDir = () => {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
};

// 初始化Socket服务器
const initSocketServer = async () => {
  try {
    await socketServer.init();
    console.log('Socket服务器初始化完成');
  } catch (err) {
    console.error('Socket服务器初始化失败:', err);
  }
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // 确保配置目录存在
  ensureConfigDir();
  
  // 先启动Socket服务器
  await initSocketServer();
  
  // 然后创建窗口
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
  
  // 设置IPC处理器
  setupIPCHandlers();
});

// 处理IPC消息
const setupIPCHandlers = () => {
  // 获取Socket服务器端口
  ipcMain.handle('get-socket-port', () => {
    return socketServer.port;
  });
  
  // SSH相关处理
  ipcMain.handle('start-ssh', async (event, config) => {
    try {
      console.log('收到SSH连接请求:', config.host);
      
      // 确保Socket服务器已经初始化
      if (!socketServer.port) {
        console.error('Socket服务器未初始化');
        throw new Error('内部错误: Socket服务器未初始化');
      }
      
      // 验证连接配置
      if (!config.host) {
        throw new Error('主机地址不能为空');
      }
      
      if (!config.username) {
        throw new Error('用户名不能为空');
      }
      
      if (config.authType === 'password' && !config.password) {
        throw new Error('密码不能为空');
      }
      
      if (config.authType === 'privateKey' && !config.privateKeyPath) {
        throw new Error('私钥文件路径不能为空');
      }
      
      // 读取私钥文件（如果使用私钥认证）
      if (config.authType === 'privateKey' && config.privateKeyPath) {
        try {
          const privateKey = fs.readFileSync(config.privateKeyPath, 'utf8');
          config.privateKey = privateKey;
        } catch (error) {
          console.error('读取私钥文件失败:', error);
          throw new Error(`无法读取私钥文件: ${error.message}`);
        }
      }
      
      // 使用Socket.io服务处理SSH连接
      // 这里我们创建一个Socket.io客户端连接，目的是为了通过WebSocket建立SSH连接
      const io = require('socket.io-client');
      
      // 连接到本地Socket.io服务器，确保仅使用WebSocket传输
      const socket = io(`http://localhost:${socketServer.port}`, {
        transports: ['websocket'],
        upgrade: false,
        reconnection: false,
        timeout: 10000
      });
      
      return new Promise((resolve, reject) => {
        let timeoutId = null;
        
        // 设置连接超时
        timeoutId = setTimeout(() => {
          if (socket.connected) {
            socket.disconnect();
          }
          reject(new Error('连接超时，请检查服务器状态和网络连接'));
        }, 15000);
        
        // 清除超时计时器
        const cancelTimeout = () => {
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        };
        
        // 监听连接建立
        socket.on('connect', () => {
          console.log('Socket.io客户端已连接');
          
          // 检查传输类型，确保使用WebSocket
          const transport = socket.io.engine.transport.name;
          console.log(`传输类型: ${transport}`);
          
          if (transport !== 'websocket') {
            cancelTimeout();
            socket.disconnect();
            reject(new Error('不支持的传输方式，仅支持WebSocket连接'));
            return;
          }
          
          // 发送SSH连接请求
          socket.emit('ssh:connect', config);
          
          // 监听SSH连接成功
          socket.once('ssh:connected', () => {
            console.log(`SSH连接成功: ${config.host}`);
            cancelTimeout();
            
            // 生成唯一的进程ID
            const processId = `ssh-${Date.now()}`;
            
            // 存储socket连接
            activeProcesses.set(processId, {
              socket,
              config
            });
            
            // 当从SSH服务接收到数据时，发送给渲染进程
            socket.on('ssh:data', ({ data }) => {
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(`process-output-${processId}`, data);
              }
            });
            
            // 监听SSH错误
            socket.on('ssh:error', ({ message }) => {
              console.error(`SSH错误 (${processId}):`, message);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(`process-output-${processId}`, `\r\n错误: ${message}\r\n`);
              }
            });
            
            // 监听SSH连接关闭
            socket.on('ssh:close', ({ message }) => {
              console.log(`SSH连接已关闭 (${processId}): ${message || ''}`);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(`process-output-${processId}`, `\r\n连接已关闭: ${message || ''}\r\n`);
              }
              socket.disconnect();
              activeProcesses.delete(processId);
            });
            
            // 返回进程ID
            resolve(processId);
          });
          
          // 监听SSH连接错误
          socket.once('ssh:error', ({ message }) => {
            console.error('SSH连接错误:', message);
            cancelTimeout();
            socket.disconnect();
            reject(new Error(message));
          });
        });
        
        // 监听Socket.io连接错误
        socket.on('connect_error', (err) => {
          console.error('Socket.io连接错误:', err.message);
          cancelTimeout();
          socket.disconnect();
          reject(new Error(`WebSocket连接失败: ${err.message}`));
        });
        
        // 监听Socket.io连接失败
        socket.on('connect_failed', (err) => {
          console.error('Socket.io连接失败:', err ? err.message : '未知错误');
          cancelTimeout();
          socket.disconnect();
          reject(new Error('WebSocket连接失败'));
        });
        
        // 监听Socket.io错误
        socket.on('error', (err) => {
          console.error('Socket.io错误:', err ? err.message : '未知错误');
          cancelTimeout();
          socket.disconnect();
          reject(new Error(`WebSocket错误: ${err ? err.message : '未知错误'}`));
        });
      });
    } catch (error) {
      console.error('启动SSH连接时出错:', error);
      return Promise.reject(error);
    }
  });
  
  // 向SSH进程发送数据
  ipcMain.handle('send-to-process', (event, processId, data) => {
    try {
      const process = activeProcesses.get(processId);
      if (!process) {
        return false;
      }
      
      if (process.socket) {
        // 通过Socket.io发送数据到SSH连接
        process.socket.emit('ssh:data', { data });
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('发送数据到进程时出错:', error);
      return false;
    }
  });
  
  // 调整终端大小
  ipcMain.handle('resize-terminal', (event, processId, cols, rows) => {
    try {
      const process = activeProcesses.get(processId);
      if (!process) {
        return false;
      }
      
      if (process.socket) {
        // 通过Socket.io发送调整终端大小请求
        process.socket.emit('ssh:resize', { cols, rows });
        return true;
      }
      
      // 添加对PowerShell进程的大小调整支持
      if (process.process && process.type === 'powershell') {
        try {
          // 在Windows上，使用PowerShell命令设置控制台大小
          if (process.platform === 'win32') {
            // 使用PowerShell命令设置控制台窗口大小
            const resizeCommand = `$host.UI.RawUI.WindowSize = New-Object System.Management.Automation.Host.Size(${cols}, ${rows}); $host.UI.RawUI.BufferSize = New-Object System.Management.Automation.Host.Size(${cols}, ${Math.max(rows, 3000)});\r\n`;
            process.process.stdin.write(resizeCommand);
          } else if (process.process.resize) {
            // 对于支持resize方法的PTY进程（通常在Linux/Mac上）
            process.process.resize(cols, rows);
          }
          return true;
        } catch (resizeError) {
          console.error('调整PowerShell终端大小时出错:', resizeError);
          return false;
        }
      }
      
      return false;
    } catch (error) {
      console.error('调整终端大小时出错:', error);
      return false;
    }
  });
  
  // 终止进程
  ipcMain.handle('kill-process', (event, processId) => {
    try {
      const process = activeProcesses.get(processId);
      if (!process) {
        return false;
      }
      
      if (process.socket) {
        // 通过Socket.io发送断开连接请求
        process.socket.emit('ssh:disconnect');
        process.socket.disconnect();
        activeProcesses.delete(processId);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('终止进程时出错:', error);
      return false;
    }
  });
  
  // 启动PowerShell
  ipcMain.handle('start-powershell', async () => {
    try {
      // 生成唯一的进程ID
      const processId = `ps-${Date.now()}`;
      
      // 获取PowerShell路径
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';
      
      // 启动子进程
      const ps = spawn(shell, [], {
        env: process.env,
        shell: true
      });
      
      // 存储进程
      activeProcesses.set(processId, {
        process: ps,
        type: 'powershell'
      });
      
      // 处理进程数据输出
      ps.stdout.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`process-output-${processId}`, data.toString());
        }
      });
      
      ps.stderr.on('data', (data) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`process-output-${processId}`, data.toString());
        }
      });
      
      // 处理进程退出
      ps.on('exit', (code) => {
        console.log(`PowerShell进程已退出，退出码: ${code}`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`process-output-${processId}`, `\r\n进程已退出，退出码: ${code}\r\n`);
        }
        activeProcesses.delete(processId);
      });
      
      // 返回进程ID
      return processId;
    } catch (error) {
      console.error('启动PowerShell时出错:', error);
      return Promise.reject(error);
    }
  });
  
  // 加载连接配置
  ipcMain.handle('load-connections', async () => {
    try {
      if (fs.existsSync(connectionsFile)) {
        const data = fs.readFileSync(connectionsFile, 'utf8');
        return JSON.parse(data);
      }
      return [];
    } catch (error) {
      console.error('加载连接配置时出错:', error);
      return [];
    }
  });
  
  // 保存连接配置
  ipcMain.handle('save-connections', async (event, connections) => {
    try {
      const data = JSON.stringify(connections, null, 2);
      fs.writeFileSync(connectionsFile, data, 'utf8');
      return true;
    } catch (error) {
      console.error('保存连接配置时出错:', error);
      return false;
    }
  });
  
  // 获取系统信息
  ipcMain.handle('get-system-info', async (event, tabId) => {
    try {
      const mem = process.memoryUsage();
      const cpus = os.cpus();
      
      return {
        platform: process.platform,
        arch: process.arch,
        version: process.version,
        cpus: cpus.length,
        cpuModel: cpus[0]?.model || 'Unknown',
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          process: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external
          }
        },
        uptime: os.uptime(),
        processUptime: process.uptime()
      };
    } catch (error) {
      console.error('获取系统信息时出错:', error);
      return {};
    }
  });
  
  // 选择私钥文件
  ipcMain.handle('select-key-file', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Private Key Files', extensions: ['pem', 'key', 'ppk'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        title: '选择SSH私钥文件'
      });
      
      if (result.canceled) {
        return null;
      }
      
      return result.filePaths[0];
    } catch (error) {
      console.error('选择SSH私钥文件时出错:', error);
      return null;
    }
  });
  
  // 打开外部链接
  ipcMain.handle('open-external', async (event, url) => {
    try {
      require('electron').shell.openExternal(url);
      return true;
    } catch (error) {
      console.error('打开外部链接时出错:', error);
      return false;
    }
  });
  
  // 获取应用版本
  ipcMain.handle('get-app-version', () => {
    return app.getVersion();
  });
  
  // 检查更新
  ipcMain.handle('check-for-update', async () => {
    try {
      // 使用GitHub API获取最新版本信息
      const https = require('https');
      
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.github.com',
          path: '/repos/funkpopo/simpleshell/releases/latest',
          method: 'GET',
          headers: {
            'User-Agent': 'SimpleShell-App'
          }
        };
        
        const req = https.request(options, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                const releaseData = JSON.parse(data);
                resolve({ success: true, data: releaseData });
              } catch (error) {
                resolve({ success: false, error: '解析版本数据失败' });
              }
            } else {
              resolve({ success: false, error: `服务器返回错误: ${res.statusCode}` });
            }
          });
        });
        
        req.on('error', (error) => {
          resolve({ success: false, error: error.message });
        });
        
        req.end();
      });
    } catch (error) {
      console.error('检查更新时出错:', error);
      return { success: false, error: error.message };
    }
  });
  
  // 退出应用
  ipcMain.handle('close-app', () => {
    app.quit();
  });
};

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 应用退出前执行清理
app.on('before-quit', () => {
  // 关闭所有活动进程
  for (const [processId, process] of activeProcesses.entries()) {
    try {
      if (process.socket) {
        process.socket.emit('ssh:disconnect');
        process.socket.disconnect();
      } else if (process.process) {
        process.process.kill();
      }
    } catch (error) {
      console.error(`关闭进程 ${processId} 时出错:`, error);
    }
  }
  
  // 关闭Socket服务器和所有SSH连接
  socketServer.close();
  sshService.closeAllConnections();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
