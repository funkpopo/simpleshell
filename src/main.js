const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { Worker } = require("worker_threads");
const {
  logToFile,
  initLogger,
  updateLogConfig,
} = require("./core/utils/logger");
const configService = require("./services/configService");
const sftpCore = require("./core/transfer/sftp-engine"); // 已合并sftpCore到sftp-engine
const sftpTransfer = require("./modules/sftp/sftpTransfer");
const externalEditorManager = require("./modules/sftp/externalEditorManager");
const systemInfo = require("./modules/system-info");
const terminalManager = require("./modules/terminal");
const commandHistoryService = require("./modules/terminal/command-history");
const fileCache = require("./core/utils/fileCache");
const connectionManager = require("./modules/connection");
const {
  registerReconnectHandlers,
} = require("./core/ipc/handlers/reconnectHandlers");
const LatencyHandlers = require("./core/ipc/handlers/latencyHandlers");
const LocalTerminalHandlers = require("./core/ipc/handlers/localTerminalHandlers");
const { safeHandle, wrapIpcHandler } = require("./core/ipc/ipcResponse");

// 应用设置和状态管理
const childProcesses = new Map();
let nextProcessId = 1;

// 跟踪编辑器会话状态的正则表达式
const editorCommandRegex = /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;
const editorExitCommands = [
  "q",
  "quit",
  "exit",
  "wq",
  "ZZ",
  "x",
  ":q",
  ":wq",
  ":x",
  "Ctrl+X",
];
const editorExitRegex = new RegExp(
  `^(${editorExitCommands.join("|").replace(/\+/g, "\\+")}|:\\w+)$`,
  "i",
);

// 全局变量用于存储AI worker实例
let aiWorker = null;
let aiRequestMap = new Map();
let nextRequestId = 1;

// 全局变量
const terminalProcesses = new Map(); // 存储终端进程ID映射

// 用于跟踪流式请求的会话
const streamSessions = new Map(); // 存储会话ID -> 请求ID的映射

// 跟踪当前活跃的会话ID
let currentSessionId = null;

// 导入IP地址查询模块
const ipQuery = require("./modules/system-info/ip-query");

// 全局延迟处理器实例
let latencyHandlers = null;

// 全局本地终端处理器实例
let localTerminalHandlers = null;

function getPrimaryWindow() {
  const windows = BrowserWindow.getAllWindows();
  if (!windows || windows.length === 0) {
    return null;
  }
  const [mainWindow] = windows;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow;
}

function safeSendToRenderer(channel, ...args) {
  const targetWindow = getPrimaryWindow();
  if (
    targetWindow &&
    targetWindow.webContents &&
    !targetWindow.webContents.isDestroyed()
  ) {
    targetWindow.webContents.send(channel, ...args);
  }
}


const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // 激活已有主窗口
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 获取worker文件路径
function getWorkerPath() {
  // 先尝试相对于__dirname的路径
  let workerPath = path.join(__dirname, "workers", "ai-worker.js");

  // 检查文件是否存在
  if (fs.existsSync(workerPath)) {
    return workerPath;
  }

  // 如果文件不存在，可能是在开发环境，尝试使用源代码路径
  workerPath = path.join(__dirname, "..", "src", "workers", "ai-worker.js");
  if (fs.existsSync(workerPath)) {
    return workerPath;
  }

  // 如果都找不到，返回null
  throw new Error("找不到AI worker文件");
}

// 创建AI Worker线程
function createAIWorker() {
  if (aiWorker) {
    aiWorker.terminate();
  }

  try {
    const workerPath = getWorkerPath();
    logToFile(`创建AI Worker: ${workerPath}`, "INFO");

    // 创建worker实例
    aiWorker = new Worker(workerPath);

    // 监听worker线程的消息
    aiWorker.on("message", (message) => {
      const { id, type, result, error, data } = message;

      // 处理不同类型的消息
      if (type) {
        handleWorkerTypeMessage(type, id, data, result, error);
        return;
      }

      // 处理标准请求响应
      const callback = aiRequestMap.get(id);
      if (callback) {
        if (error) {
          // 将Worker错误对象转换为字符串，避免序列化问题
          const errorMessage = error.message || 'Unknown error';
          callback.reject(new Error(errorMessage));
        } else {
          callback.resolve(result);
        }
        // 处理完成后从Map中移除
        aiRequestMap.delete(id);
      } else {
        logToFile(`收到未知请求ID的响应: ${id}`, "WARN");
      }
    });

    // 处理worker错误
    aiWorker.on("error", (error) => {
      logToFile(`AI Worker错误: ${error.message}`, "ERROR");

      // 向所有待处理的请求返回错误
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(
          new Error("AI Worker encountered an error: " + error.message),
        );
        aiRequestMap.delete(id);
      }

      // 清理所有流式会话
      streamSessions.clear();
    });

    // 处理worker退出
    aiWorker.on("exit", (code) => {
      logToFile(`AI Worker退出，代码: ${code}`, "WARN");

      // 如果退出码不是正常退出(0)，尝试重启worker
      if (code !== 0) {
        setTimeout(() => {
          logToFile("尝试重启AI Worker", "INFO");
          createAIWorker();
        }, 1000);
      }

      // 向所有待处理的请求返回错误
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(
          new Error(`AI Worker stopped unexpectedly with code ${code}`),
        );
        aiRequestMap.delete(id);
      }

      // 清理所有流式会话
      streamSessions.clear();
    });

    return aiWorker;
  } catch (error) {
    logToFile(`创建AI Worker失败: ${error.message}`, "ERROR");
    return null;
  }
}

/**
 * 处理Worker发送的类型化消息
 * @param {string} type - 消息类型
 * @param {string} id - 请求ID
 * @param {Object} data - 消息数据
 * @param {Object} result - 结果数据
 * @param {Object} error - 错误数据
 */
function handleWorkerTypeMessage(type, id, data, result, error) {
  // 获取主窗口
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (
    !mainWindow ||
    !mainWindow.webContents ||
    mainWindow.webContents.isDestroyed()
  ) {
    logToFile("无法发送Worker消息: 主窗口不可用", "ERROR");
    return;
  }

  switch (type) {
    case "init":
      logToFile(`AI Worker初始化完成: ${JSON.stringify(result)}`, "INFO");
      break;

    case "stream_chunk":
      if (data && data.sessionId) {
        // 存储会话ID和请求ID的映射
        streamSessions.set(data.sessionId, id);

        // 转发流式数据块到渲染进程
        mainWindow.webContents.send("stream-chunk", {
          tabId: "ai",
          chunk: data.chunk,
          sessionId: data.sessionId,
        });
      }
      break;

    case "stream_end":
      if (data && data.sessionId) {
        // 转发流结束事件到渲染进程
        mainWindow.webContents.send("stream-end", {
          tabId: "ai",
          sessionId: data.sessionId,
          aborted: data.aborted || false,
        });

        // 清理会话映射
        streamSessions.delete(data.sessionId);
      }
      break;

    case "stream_error":
      if (data && data.sessionId) {
        // 转发流错误事件到渲染进程
        mainWindow.webContents.send("stream-error", {
          tabId: "ai",
          sessionId: data.sessionId,
          error: data.error || { message: "未知错误" },
        });

        // 清理会话映射
        streamSessions.delete(data.sessionId);
      }
      break;

    case "worker_error":
      logToFile(`AI Worker内部错误: ${error?.message || "未知错误"}`, "ERROR");
      break;

    case "worker_exit":
      logToFile(`AI Worker退出事件: ${JSON.stringify(result)}`, "INFO");
      break;

    default:
      logToFile(`未知的Worker消息类型: ${type}`, "WARN");
  }
}

// 处理生产和开发环境中的路径差异
if (require("electron-squirrel-startup")) {
  app.quit();
}

// 选择密钥文件
const selectKeyFile = async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "私钥文件", extensions: ["pem", "ppk", "key"] },
      { name: "所有文件", extensions: ["*"] },
    ],
    title: "选择SSH私钥文件",
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
};

const createWindow = () => {
  // 根据环境确定图标路径
  let iconPath;
  if (process.env.NODE_ENV === "development") {
    // 开发环境使用绝对路径
    iconPath = path.join(process.cwd(), "src", "assets", "logo.ico");
  } else {
    // 生产环境使用相对于__dirname的路径
    iconPath = path.join(__dirname, "assets", "logo.ico");
  }

  // 创建浏览器窗口
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: iconPath, // 使用环境相关的图标路径
  });

  // 隐藏菜单栏
  mainWindow.setMenuBarVisibility(false);

  const emitWindowState = () => {
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("window:state", {
        isMaximized: mainWindow.isMaximized(),
        isFullScreen: mainWindow.isFullScreen(),
      });
    }
  };

  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);
  mainWindow.once("ready-to-show", emitWindowState);

  // 加载应用 URL
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // 开发工具自动打开
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  // 注册IPC通信
  setupIPC(mainWindow);
};

// 全局错误处理器
process.on('uncaughtException', (error) => {
  logToFile(`未捕获的异常: ${error.message}`, 'ERROR');
  logToFile(`堆栈: ${error.stack}`, 'ERROR');

  // 清理错误消息，移除堆栈信息发送到前端
  const cleanMessage = error.message || String(error);

  // 发送错误到渲染进程显示
  const mainWindow = getPrimaryWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    safeSendToRenderer('app:error', {
      type: 'uncaughtException',
      message: cleanMessage, // 只发送消息，不发送堆栈
      timestamp: Date.now()
    });
  }
});

process.on('unhandledRejection', (reason, promise) => {
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  const errorStack = reason instanceof Error ? reason.stack : '';

  logToFile(`未处理的Promise拒绝: ${errorMessage}`, 'ERROR');
  if (errorStack) {
    logToFile(`堆栈: ${errorStack}`, 'ERROR');
  }

  // 清理错误消息
  const cleanMessage = errorMessage || '未知Promise错误';

  // 发送错误到渲染进程显示
  const mainWindow = getPrimaryWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    safeSendToRenderer('app:error', {
      type: 'unhandledRejection',
      message: cleanMessage, // 只发送消息，不发送堆栈
      timestamp: Date.now()
    });
  }
});

// 在应用准备好时创建窗口并初始化配置
app.whenReady().then(async () => {
  initLogger(app); // 初始化日志模块

  // Inject dependencies into configService
  configService.init(app, { logToFile }, require("./core/utils/crypto"));
  configService.initializeMainConfig(); // 初始化主配置文件

  // 加载日志配置并更新日志模块
  const logSettings = configService.loadLogSettings();
  updateLogConfig(logSettings);

  // Initialize sftpCore module
  sftpCore.init({ logToFile }, (tabId) => childProcesses.get(tabId)); // Pass logger and childProcesses getter
  sftpCore.startSftpHealthCheck(); // Start health check after core init

  // Initialize sftpTransfer module
  sftpTransfer.init(
    { logToFile },
    sftpCore,
    dialog,
    shell,
    (tabId) => childProcesses.get(tabId),
    (channel, ...args) => safeSendToRenderer(channel, ...args),
  );

  try {
    externalEditorManager.init({
      app,
      logger: { logToFile },
      configService,
      sftpCore,
      shell,
      sendToRenderer: (channel, payload) => safeSendToRenderer(channel, payload),
    });
    logToFile("External editor manager initialised", "INFO");
  } catch (error) {
    logToFile(`Failed to initialise external editor manager: ${error.message}`, "ERROR");
  }

  // Initialize file cache module
  fileCache.init(logToFile, app);
  fileCache.startPeriodicCleanup(); // 启动定期清理

  // Initialize connection manager
  connectionManager.initialize();

  // Load last connections from config and initialize connection pools
  try {
    const lastConnections = configService.loadLastConnections();
    if (lastConnections && lastConnections.length > 0) {
      connectionManager.loadLastConnectionsFromConfig(lastConnections);
      logToFile(
        `Loaded ${lastConnections.length} last connections on startup`,
        "INFO",
      );
    }
  } catch (error) {
    logToFile(
      `Failed to load last connections on startup: ${error.message}`,
      "ERROR",
    );
  }

  // Register reconnection handlers
  try {
    registerReconnectHandlers(connectionManager.sshConnectionPool);
    logToFile("重连处理器已注册", "INFO");
  } catch (error) {
    logToFile(`重连处理器注册失败: ${error.message}`, "ERROR");
  }

  // Initialize latency handlers
  try {
    latencyHandlers = new LatencyHandlers();
    const handlers = latencyHandlers.getHandlers();

    handlers.forEach(({ channel, handler }) => {
      safeHandle(ipcMain, channel, handler);
    });

    logToFile(`已注册 ${handlers.length} 个延迟检测IPC处理器`, "INFO");
  } catch (error) {
    logToFile(`延迟检测服务初始化失败: ${error.message}`, "ERROR");
  }

  // Register critical IPC handlers BEFORE creating window to prevent race conditions
  try {
    // Register settings handlers
    const SettingsHandlers = require("./core/ipc/handlers/settingsHandlers");
    const settingsHandlers = new SettingsHandlers();
    settingsHandlers.getHandlers().forEach(({ channel, handler }) => {
      safeHandle(ipcMain, channel, handler);
    });
    logToFile("Settings handlers registered", "INFO");

    // Register app handlers
    const AppHandlers = require("./core/ipc/handlers/appHandlers");
    const appHandlers = new AppHandlers();
    appHandlers.getHandlers().forEach(({ channel, handler }) => {
      safeHandle(ipcMain, channel, handler);
    });
    logToFile("App handlers registered", "INFO");

    // Register basic terminal handlers (connection loading)
    safeHandle(ipcMain, "terminal:loadConnections", async () => {
      return configService.loadConnections();
    });

    safeHandle(ipcMain, "terminal:loadTopConnections", async () => {
      try {
        return configService.loadLastConnections();
      } catch (e) {
        return [];
      }
    });

    safeHandle(ipcMain, "terminal:getSystemInfo", async (event, processId) => {
      try {
        const systemInfo = require("./modules/system-info");
        if (!processId || !childProcesses.has(processId)) {
          return await systemInfo.getLocalSystemInfo();
        } else {
          const processObj = childProcesses.get(processId);
          if (
            (processObj.type === "ssh2" || processObj.type === "ssh") &&
            (processObj.process || processObj.client || processObj.channel)
          ) {
            const sshClient =
              processObj.client || processObj.process || processObj.channel;
            if (
              !sshClient ||
              (sshClient._readableState && sshClient._readableState.ended) ||
              (sshClient._sock &&
                (!sshClient._sock.readable || !sshClient._sock.writable))
            ) {
              logToFile(
                `SSH connection not available for process ${processId}, falling back to local system info`,
                "WARN",
              );
              return await systemInfo.getLocalSystemInfo();
            }
            return systemInfo.getRemoteSystemInfo(sshClient);
          } else {
            return await systemInfo.getLocalSystemInfo();
          }
        }
      } catch (error) {
        logToFile(`Failed to get system info: ${error.message}`, "ERROR");
        try {
          const systemInfo = require("./modules/system-info");
          return await systemInfo.getLocalSystemInfo();
        } catch (fallbackError) {
          return {
            error: "获取系统信息失败",
            message: error.message,
          };
        }
      }
    });

    safeHandle(ipcMain, "terminal:getProcessList", async (event, processId) => {
      try {
        const systemInfo = require("./modules/system-info");
        if (!processId || !childProcesses.has(processId)) {
          return systemInfo.getProcessList();
        } else {
          const processObj = childProcesses.get(processId);
          if (
            (processObj.type === "ssh2" || processObj.type === "ssh") &&
            (processObj.process || processObj.client || processObj.channel)
          ) {
            const sshClient =
              processObj.client || processObj.process || processObj.channel;
            if (
              !sshClient ||
              (sshClient._readableState && sshClient._readableState.ended) ||
              (sshClient._sock &&
                (!sshClient._sock.readable || !sshClient._sock.writable))
            ) {
              logToFile(
                `SSH connection not available for process ${processId}, falling back to local process list`,
                "WARN",
              );
              return systemInfo.getProcessList();
            }
            return systemInfo.getRemoteProcessList(sshClient);
          } else {
            return systemInfo.getProcessList();
          }
        }
      } catch (error) {
        logToFile(`Failed to get process list: ${error.message}`, "ERROR");
        try {
          const systemInfo = require("./modules/system-info");
          return systemInfo.getProcessList();
        } catch (fallbackError) {
          return {
            error: "获取进程列表失败",
            message: error.message,
          };
        }
      }
    });

    logToFile("Critical IPC handlers registered before window creation", "INFO");
  } catch (error) {
    logToFile(`Failed to register critical IPC handlers: ${error.message}`, "ERROR");
  }

  createWindow();
  createAIWorker();

  // 初始化命令历史服务
  try {
    const commandHistory = configService.loadCommandHistory();
    commandHistoryService.initialize(commandHistory);
    logToFile(
      `Command history service initialized with ${commandHistory.length} entries`,
      "INFO",
    );
  } catch (error) {
    logToFile(
      `Failed to initialize command history service: ${error.message}`,
      "ERROR",
    );
  }

  logToFile("Application ready and window created", "INFO");
});

// 在应用退出前清理资源
let isQuitting = false;
app.on("before-quit", async (event) => {
  // 如果已经在退出流程中，不要阻止
  if (isQuitting) {
    return;
  }

  // 阻止默认退出行为，等待清理完成
  event.preventDefault();
  isQuitting = true;

  logToFile("应用开始退出流程，执行清理操作...", "INFO");
  // 清理本地终端处理器
  if (localTerminalHandlers) {
    try {
      await localTerminalHandlers.cleanup();
      logToFile("本地终端处理器已清理", "INFO");
    } catch (error) {
      logToFile(`本地终端处理器清理失败: ${error.message}`, "ERROR");
    }
  }

  // 清理延迟检测服务
  if (latencyHandlers) {
    try {
      latencyHandlers.cleanup();
      logToFile("延迟检测服务已清理", "INFO");
    } catch (error) {
      logToFile(`延迟检测服务清理失败: ${error.message}`, "ERROR");
    }
  }

  // 移除所有事件监听器和子进程
  if (
    externalEditorManager &&
    typeof externalEditorManager.cleanup === "function"
  ) {
    try {
      await externalEditorManager.cleanup();
      logToFile("External editor manager cleaned up", "INFO");
    } catch (error) {
      logToFile(
        `External editor manager cleanup failed: ${error.message}`,
        "ERROR",
      );
    }
  }

  for (const [id, proc] of childProcesses.entries()) {
    try {
      // 清理与此进程相关的待处理SFTP操作
      if (
        sftpCore &&
        typeof sftpCore.clearPendingOperationsForTab === "function"
      ) {
        sftpCore.clearPendingOperationsForTab(id);
        // 如果proc.config && proc.config.tabId 与 id 不同，也清理 proc.config.tabId
        // 因为 SSH 进程可能会在 childProcesses 中用两个键存储 (processId 和 sshConfig.tabId)
        if (proc.config && proc.config.tabId && proc.config.tabId !== id) {
          sftpCore.clearPendingOperationsForTab(proc.config.tabId);
        }
      }

      // 添加: 清理与此进程相关的活跃SFTP传输
      if (
        sftpTransfer &&
        typeof sftpTransfer.cleanupActiveTransfersForTab === "function"
      ) {
        try {
          sftpTransfer
            .cleanupActiveTransfersForTab(id)
            .then((result) => {
              if (result.cleanedCount > 0) {
                logToFile(
                  `Cleaned up ${result.cleanedCount} active SFTP transfers for tab ${id} during app quit`,
                  "INFO",
                );
              }
            })
            .catch((err) => {
              logToFile(
                `Error cleaning up SFTP transfers for tab ${id} during app quit: ${err.message}`,
                "ERROR",
              );
            });

          // 如果proc.config && proc.config.tabId 与 id 不同，也清理 proc.config.tabId 相关的传输
          if (proc.config && proc.config.tabId && proc.config.tabId !== id) {
            sftpTransfer
              .cleanupActiveTransfersForTab(proc.config.tabId)
              .then((result) => {
                if (result.cleanedCount > 0) {
                  logToFile(
                    `Cleaned up ${result.cleanedCount} active SFTP transfers for tabId ${proc.config.tabId} during app quit`,
                    "INFO",
                  );
                }
              })
              .catch((err) => {
                logToFile(
                  `Error cleaning up SFTP transfers for tabId ${proc.config.tabId} during app quit: ${err.message}`,
                  "ERROR",
                );
              });
          }
        } catch (cleanupError) {
          logToFile(
            `Error initiating SFTP transfer cleanup for tab ${id}: ${cleanupError.message}`,
            "ERROR",
          );
        }
      }

      // 如果是SSH连接，释放连接池中的连接引用
      if (proc.type === "ssh2" && proc.connectionInfo) {
        try {
          connectionManager.releaseSSHConnection(
            proc.connectionInfo.key,
            proc.config?.tabId,
          );
          logToFile(
            `释放SSH连接池引用 (app quit): ${proc.connectionInfo.key}`,
            "INFO",
          );
        } catch (error) {
          logToFile(
            `Error releasing SSH connection during app quit: ${error.message}`,
            "ERROR",
          );
        }
      }

      if (proc.process) {
        // 移除所有事件监听器
        if (proc.process.stdout) {
          proc.process.stdout.removeAllListeners();
        }
        if (proc.process.stderr) {
          proc.process.stderr.removeAllListeners();
        }

        // 对于SSH连接，关闭stream而不是直接kill SSH客户端
        if (proc.type === "ssh2" && proc.stream) {
          try {
            proc.stream.close();
            logToFile(`关闭SSH stream (app quit): ${id}`, "INFO");
          } catch (error) {
            logToFile(
              `Error closing SSH stream during app quit ${id}: ${error.message}`,
              "ERROR",
            );
          }
        } else {
          // 终止其他类型的进程
          try {
            if (typeof proc.process.kill === "function") {
              // 正常终止进程
              proc.process.kill();
            }
          } catch (error) {
            logToFile(`Error killing process ${id}: ${error.message}`, "ERROR");
          }
        }
      }
    } catch (error) {
      logToFile(`Error cleaning up process ${id}: ${error.message}`, "ERROR");
    }
  }
  // 清空进程映射
  childProcesses.clear();

  // 清理连接管理器
  connectionManager.cleanup();

  // 清理所有缓存文件
  (async () => {
    try {
      const cleanedCount = await fileCache.cleanupAllCaches();
      logToFile(
        `Cleaned up ${cleanedCount} cache files on app quit`,
        "INFO",
      );
    } catch (error) {
      logToFile(
        `Failed to cleanup cache files on quit: ${error.message}`,
        "ERROR",
      );
    }

    try {
      const cleared = await fileCache.clearCacheDirectory();
      if (cleared) {
        logToFile(
          `Cleared temp directory on app quit: ${fileCache.cacheDir}`,
          "INFO",
        );
      }
    } catch (error) {
      logToFile(
        `Failed to clear temp directory on quit: ${error.message}`,
        "ERROR",
      );
    }
  })();
  // 保存命令历史
  try {
    const historyToSave = commandHistoryService.exportHistory();
    configService.saveCommandHistory(historyToSave);
    logToFile(
      `Saved ${historyToSave.length} command history entries on app quit`,
      "INFO",
    );
  } catch (error) {
    logToFile(
      `Failed to save command history on quit: ${error.message}`,
      "ERROR",
    );
  }

  // Save last connections
  try {
    const lastConnections = connectionManager.getLastConnections(5);
    // 调试日志：检查获取的最近连接
    logToFile(
      `App quit: Got ${lastConnections.length} last connections: ${JSON.stringify(lastConnections)}`,
      "DEBUG",
    );

    // 即使数组为空也保存，以保持配置文件的一致性
    const saved = configService.saveLastConnections(lastConnections);

    if (lastConnections && lastConnections.length > 0) {
      logToFile(
        `Saved ${lastConnections.length} last connections on app quit${saved ? " successfully" : " - save returned false"}`,
        "INFO",
      );
    } else {
      logToFile(
        `Saved empty last connections list on app quit${saved ? " successfully" : " - save returned false"}`,
        "INFO",
      );
    }
  } catch (error) {
    logToFile(
      `Failed to save last connections on quit: ${error.message}`,
      "ERROR",
    );
  }

  // 所有清理操作完成，现在真正退出应用
  logToFile("所有清理操作完成，应用即将退出", "INFO");
  app.quit();
});

// 关闭所有窗口时退出应用（macOS除外）
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // 关闭应用前终止worker线程
    if (aiWorker) {
      aiWorker
        .terminate()
        .catch((err) =>
          logToFile(`Error terminating AI worker: ${err.message}`, "ERROR"),
        );
    }
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 设置IPC通信
function setupIPC(mainWindow) {
  logToFile("setupIPC started", "INFO");

  // 初始化本地终端处理器
  try {
    localTerminalHandlers = new LocalTerminalHandlers(mainWindow, ipcMain);
    logToFile("本地终端处理器初始化成功", "INFO");
  } catch (error) {
    logToFile(`本地终端处理器初始化失败: ${error.message}`, "ERROR");
    logToFile(`Stack: ${error.stack}`, "ERROR");
  }

  // 文件对话框处理器
  try {
    safeHandle(ipcMain, "dialog:showOpenDialog", async (event, options) => {
      const result = await dialog.showOpenDialog(mainWindow, options);
      return result;
    });

    safeHandle(ipcMain, "dialog:showSaveDialog", async (event, options) => {
      const result = await dialog.showSaveDialog(mainWindow, options);
      return result;
    });

    safeHandle(ipcMain, "dialog:showMessageBox", async (event, options) => {
      const result = await dialog.showMessageBox(mainWindow, options);
      return result;
    });

    logToFile("Dialog handlers registered", "INFO");
  } catch (error) {
    logToFile(`Failed to register dialog handlers: ${error.message}`, "ERROR");
  }

  // 窗口控制
  try {
    safeHandle(ipcMain, "window:minimize", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return false;
      }
      mainWindow.minimize();
      return true;
    });

    safeHandle(ipcMain, "window:toggleMaximize", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return false;
      }

      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
      } else if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }

      return {
        isMaximized: mainWindow.isMaximized(),
        isFullScreen: mainWindow.isFullScreen(),
      };
    });

    safeHandle(ipcMain, "window:close", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return false;
      }
      mainWindow.close();
      return true;
    });

    safeHandle(ipcMain, "window:getState", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { isMaximized: false, isFullScreen: false };
      }

      return {
        isMaximized: mainWindow.isMaximized(),
        isFullScreen: mainWindow.isFullScreen(),
      };
    });

    logToFile("Window control handlers registered", "INFO");
  } catch (error) {
    logToFile(`Failed to register window control handlers: ${error.message}`, "ERROR");
    logToFile(`Stack: ${error.stack}`, "ERROR");
  }

  // 启动SSH连接
  try {
    safeHandle(ipcMain, "terminal:startSSH", async (event, sshConfig) => {
    const processId = nextProcessId++;

    if (!sshConfig || !sshConfig.host) {
      logToFile("Invalid SSH configuration", "ERROR");
      throw new Error("Invalid SSH configuration");
    }

    try {
      // 使用连接池获取SSH连接
      const connectionInfo =
        await connectionManager.getSSHConnection(sshConfig);
      // 广播最近连接更新（实时）
      try {
        const lastConnections = connectionManager.getLastConnections(5);
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (win && !win.isDestroyed() && win.webContents) {
            win.webContents.send("top-connections-changed", lastConnections);
          }
        }
      } catch (err) {
        // ignore broadcast errors
      }
      const ssh = connectionInfo.client;

      // 添加标签页引用追踪
      if (sshConfig.tabId) {
        connectionManager.addTabReference(sshConfig.tabId, connectionInfo.key);
      }

      // 存储进程信息 - 这里保存连接池返回的连接信息
      childProcesses.set(processId, {
        process: ssh,
        connectionInfo: connectionInfo, // 保存完整的连接信息
        listeners: new Set(),
        config: sshConfig,
        type: "ssh2",
        ready: connectionInfo.ready, // 使用连接池的就绪状态
        editorMode: false,
        commandBuffer: "",
        lastOutputLines: [],
        outputBuffer: "",
        isRemote: true,
      });

      // 存储相同的SSH客户端，使用tabId
      if (sshConfig.tabId) {
        childProcesses.set(sshConfig.tabId, {
          process: ssh,
          connectionInfo: connectionInfo,
          listeners: new Set(),
          config: sshConfig,
          type: "ssh2",
          ready: connectionInfo.ready,
          editorMode: false,
          commandBuffer: "",
          lastOutputLines: [],
          outputBuffer: "",
          isRemote: true,
        });
      }

      // 如果连接已经就绪，直接创建shell
      if (connectionInfo.ready) {
        logToFile(`复用现有SSH连接: ${connectionInfo.key}`, "INFO");

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n*** ${sshConfig.host} SSH连接已建立（复用现有连接） ***\r\n`,
          );
        }

        return new Promise((resolve, reject) => {
          // 创建Shell会话
          ssh.shell(
            {
              term: "xterm-256color",
              cols: 120,
              rows: 30,
            },
            (err, stream) => {
              if (err) {
                logToFile(
                  `SSH shell error for processId ${processId}: ${err.message}`,
                  "ERROR",
                );
                // 释放连接引用
                connectionManager.releaseSSHConnection(
                  connectionInfo.key,
                  sshConfig.tabId,
                );
                // 清理进程信息
                childProcesses.delete(processId);
                if (sshConfig.tabId) childProcesses.delete(sshConfig.tabId);
                return reject(err);
              }

              // 更新进程信息中的stream
              const procToUpdate = childProcesses.get(processId);
              if (procToUpdate) {
                procToUpdate.stream = stream;
              }
              const tabProcToUpdate = childProcesses.get(sshConfig.tabId);
              if (tabProcToUpdate) {
                tabProcToUpdate.stream = stream;
              }

              // 设置stream事件监听器
              setupStreamEventListeners(
                stream,
                processId,
                sshConfig,
                connectionInfo,
              );

              // 注册SSH连接的延迟检测（复用连接）
              if (latencyHandlers && sshConfig.tabId) {
                try {
                  latencyHandlers.latencyService.registerSSHConnection(
                    sshConfig.tabId,
                    ssh,
                    sshConfig.host,
                    sshConfig.port || 22,
                  );
                  logToFile(
                    `已为复用SSH连接注册延迟检测: ${sshConfig.tabId}`,
                    "DEBUG",
                  );
                } catch (latencyError) {
                  logToFile(
                    `延迟检测注册失败: ${latencyError.message}`,
                    "WARN",
                  );
                }
              }

              resolve(processId);
            },
          );
        });
      } else {
        // 新连接，等待就绪事件
        return new Promise((resolve, reject) => {
          const connectionTimeout = setTimeout(() => {
            logToFile("SSH connection timed out after 15 seconds", "ERROR");
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(
                `process:output:${processId}`,
                `\r\n连接超时，请检查网络和服务器状态\r\n`,
              );
            }
            // 释放连接引用
            connectionManager.releaseSSHConnection(
              connectionInfo.key,
              sshConfig.tabId,
            );
            reject(new Error("SSH connection timeout"));
          }, 15000);

          // 监听就绪事件
          ssh.on("ready", () => {
            clearTimeout(connectionTimeout);

            // 更新进程状态
            const procInfo = childProcesses.get(processId);
            if (procInfo) {
              procInfo.ready = true;
            }
            if (sshConfig.tabId) {
              const tabProcInfo = childProcesses.get(sshConfig.tabId);
              if (tabProcInfo) {
                tabProcInfo.ready = true;
              }

              // 发送连接状态变化事件到渲染进程
              if (mainWindow && !mainWindow.isDestroyed()) {
                const connectionStatus = {
                  isConnected: true,
                  isConnecting: false,
                  quality: "excellent",
                  lastUpdate: Date.now(),
                  connectionType: "SSH",
                  host: sshConfig.host,
                  port: sshConfig.port,
                  username: sshConfig.username,
                };
                mainWindow.webContents.send("tab-connection-status", {
                  tabId: sshConfig.tabId,
                  connectionStatus,
                });
              }
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(
                `process:output:${processId}`,
                `\r\n*** ${sshConfig.host} SSH连接已建立 ***\r\n`,
              );
            }

            // 创建Shell会话
            ssh.shell(
              {
                term: "xterm-256color",
                cols: 120,
                rows: 30,
              },
              (err, stream) => {
                if (err) {
                  logToFile(
                    `SSH shell error for processId ${processId}: ${err.message}`,
                    "ERROR",
                  );
                  // 释放连接引用
                  connectionManager.releaseSSHConnection(
                    connectionInfo.key,
                    sshConfig.tabId,
                  );
                  // 清理进程信息
                  childProcesses.delete(processId);
                  if (sshConfig.tabId) childProcesses.delete(sshConfig.tabId);
                  return reject(err);
                }

                // 更新进程信息中的stream
                const procToUpdate = childProcesses.get(processId);
                if (procToUpdate) {
                  procToUpdate.stream = stream;
                }
                const tabProcToUpdate = childProcesses.get(sshConfig.tabId);
                if (tabProcToUpdate) {
                  tabProcToUpdate.stream = stream;
                }

                // 设置stream事件监听器
                setupStreamEventListeners(
                  stream,
                  processId,
                  sshConfig,
                  connectionInfo,
                );

                // 注册SSH连接的延迟检测
                if (latencyHandlers && sshConfig.tabId) {
                  try {
                    latencyHandlers.latencyService.registerSSHConnection(
                      sshConfig.tabId,
                      ssh,
                      sshConfig.host,
                      sshConfig.port || 22,
                    );
                    logToFile(
                      `已为SSH连接注册延迟检测: ${sshConfig.tabId}`,
                      "DEBUG",
                    );
                  } catch (latencyError) {
                    logToFile(
                      `延迟检测注册失败: ${latencyError.message}`,
                      "WARN",
                    );
                  }
                }

                resolve(processId);
              },
            );
          });

          // 监听错误事件
          ssh.on("error", (err) => {
            clearTimeout(connectionTimeout);
            logToFile(
              `SSH connection error for processId ${processId}: ${err.message}`,
              "ERROR",
            );

            // 发送连接断开状态到渲染进程
            if (sshConfig.tabId && mainWindow && !mainWindow.isDestroyed()) {
              const connectionStatus = {
                isConnected: false,
                isConnecting: false,
                quality: "offline",
                lastUpdate: Date.now(),
                connectionType: "SSH",
                host: sshConfig.host,
                port: sshConfig.port,
                username: sshConfig.username,
                error: err.message,
              };
              mainWindow.webContents.send("tab-connection-status", {
                tabId: sshConfig.tabId,
                connectionStatus,
              });
            }

            // 释放连接引用
            connectionManager.releaseSSHConnection(
              connectionInfo.key,
              sshConfig.tabId,
            );
            // 清理进程信息
            childProcesses.delete(processId);
            if (sshConfig.tabId) childProcesses.delete(sshConfig.tabId);
            reject(err);
          });
        });
      }
    } catch (error) {
      logToFile(`Failed to start SSH connection: ${error.message}`, "ERROR");

      throw error;
    }
  });

    logToFile("SSH connection handler registered", "INFO");
  } catch (error) {
    logToFile(`Failed to register SSH connection handler: ${error.message}`, "ERROR");
    logToFile(`Stack: ${error.stack}`, "ERROR");
  }

  // 启动Telnet连接
  try {
    safeHandle(ipcMain, "terminal:startTelnet", async (event, telnetConfig) => {
    const processId = nextProcessId++;

    if (!telnetConfig || !telnetConfig.host) {
      logToFile("Invalid Telnet configuration", "ERROR");
      throw new Error("Invalid Telnet configuration");
    }

    try {
      // 使用连接池获取Telnet连接
      const connectionInfo =
        await connectionManager.getTelnetConnection(telnetConfig);
      // 广播最近连接更新（实时）
      try {
        const lastConnections = connectionManager.getLastConnections(5);
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (win && !win.isDestroyed() && win.webContents) {
            win.webContents.send("top-connections-changed", lastConnections);
          }
        }
      } catch (err) {
        // ignore broadcast errors
      }
      const telnet = connectionInfo.client;

      // 添加标签页引用追踪
      if (telnetConfig.tabId) {
        connectionManager.addTabReference(
          telnetConfig.tabId,
          connectionInfo.key,
        );
      }

      // 存储进程信息 - 这里保存连接池返回的连接信息
      childProcesses.set(processId, {
        process: telnet,
        connectionInfo: connectionInfo, // 保存完整的连接信息
        listeners: new Set(),
        config: telnetConfig,
        type: "telnet",
        ready: connectionInfo.ready, // 使用连接池的就绪状态
        editorMode: false,
        commandBuffer: "",
        lastOutputLines: [],
        outputBuffer: "",
        isRemote: true,
      });

      // 存储相同的Telnet客户端，使用tabId
      if (telnetConfig.tabId) {
        childProcesses.set(telnetConfig.tabId, {
          process: telnet,
          connectionInfo: connectionInfo,
          listeners: new Set(),
          config: telnetConfig,
          type: "telnet",
          ready: connectionInfo.ready,
          editorMode: false,
          commandBuffer: "",
          lastOutputLines: [],
          outputBuffer: "",
          isRemote: true,
        });
      }

      // 如果连接已经就绪，直接开始交互
      if (connectionInfo.ready) {
        logToFile(`复用现有Telnet连接: ${connectionInfo.key}`, "INFO");

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n*** ${telnetConfig.host} Telnet连接已建立（复用现有连接） ***\r\n`,
          );
        }

        // 设置数据监听器
        setupTelnetEventListeners(
          telnet,
          processId,
          telnetConfig,
          connectionInfo,
        );

        return processId;
      } else {
        logToFile(`Telnet连接未就绪，这不应该发生`, "ERROR");
        throw new Error("Telnet connection not ready");
      }
    } catch (error) {
      logToFile(`Failed to start Telnet connection: ${error.message}`, "ERROR");
      throw error;
    }
  });

    logToFile("Telnet connection handler registered", "INFO");
  } catch (error) {
    logToFile(`Failed to register Telnet connection handler: ${error.message}`, "ERROR");
    logToFile(`Stack: ${error.stack}`, "ERROR");
  }

  // Telnet事件监听器设置函数
  function setupTelnetEventListeners(
    telnet,
    processId,
    telnetConfig,
    connectionInfo,
  ) {
    // 监听数据事件
    telnet.on("data", (data) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            data.toString(),
          );
        }
      } catch (error) {
        logToFile(`Error handling Telnet data: ${error.message}`, "ERROR");
      }
    });

    // 监听错误事件
    telnet.on("error", (err) => {
      logToFile(
        `Telnet error for processId ${processId}: ${err.message}`,
        "ERROR",
      );

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n*** Telnet连接错误: ${err.message} ***\r\n`,
        );
        mainWindow.webContents.send(`process:exit:${processId}`, {
          code: 1,
          signal: null,
        });
      }

      // 释放连接引用
      connectionManager.releaseTelnetConnection(
        connectionInfo.key,
        telnetConfig.tabId,
      );
    });

    // 监听关闭事件
    telnet.on("end", () => {
      logToFile(`Telnet connection ended for processId ${processId}`, "INFO");

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n*** Telnet连接已关闭 ***\r\n`,
        );
        mainWindow.webContents.send(`process:exit:${processId}`, {
          code: 0,
          signal: null,
        });
      }

      // 释放连接引用
      connectionManager.releaseTelnetConnection(
        connectionInfo.key,
        telnetConfig.tabId,
      );
    });

    // 监听超时事件
    telnet.on("timeout", () => {
      logToFile(`Telnet connection timeout for processId ${processId}`, "WARN");

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n*** Telnet连接超时 ***\r\n`,
        );
      }
    });
  }

  // SSH Stream事件监听器设置函数
  function setupStreamEventListeners(
    stream,
    processId,
    sshConfig,
    connectionInfo,
  ) {
    let buffer = Buffer.from([]);

    // 监听数据事件
    stream.on("data", (data) => {
      try {
        buffer = Buffer.concat([buffer, data]);
        try {
          // 修改：确保使用UTF-8编码正确处理中文字符
          // 检查是否包含中文字符
          const bufferStr = buffer.toString();
          const containsChinese = /[\u4e00-\u9fa5]/.test(bufferStr);

          // 使用Buffer的toString方法时，显式指定'utf8'编码
          let output;
          if (containsChinese) {
            // 对于包含中文字符的数据，确保使用UTF-8编码
            output = Buffer.from(buffer).toString("utf8");
          } else {
            output = buffer.toString("utf8");
          }

          const processedOutput = terminalManager.processOutput(
            processId,
            output,
          );

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              processedOutput,
            );
          }

          buffer = Buffer.from([]);
        } catch (error) {
          logToFile(
            `Failed to convert buffer to string: ${error.message}`,
            "ERROR",
          );
        }
      } catch (error) {
        logToFile(`Error handling stream data: ${error.message}`, "ERROR");
      }
    });

    // 监听扩展数据（stderr）
    stream.on("extended data", (data, type) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          // 修改：确保使用UTF-8编码正确处理中文字符
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\x1b[31m${data.toString("utf8")}\x1b[0m`,
          );
        }
      } catch (error) {
        logToFile(`Error handling extended data: ${error.message}`, "ERROR");
      }
    });

    // 监听关闭事件
    stream.on("close", () => {
      logToFile(`SSH stream closed for processId: ${processId}`, "INFO");

      // 发送断开连接通知
      const procInfo = childProcesses.get(processId);

      // 发送连接状态变化事件到渲染进程
      if (sshConfig.tabId && mainWindow && !mainWindow.isDestroyed()) {
        const connectionStatus = {
          isConnected: false,
          isConnecting: false,
          quality: "offline",
          lastUpdate: Date.now(),
          connectionType: "SSH",
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
        };
        mainWindow.webContents.send("tab-connection-status", {
          tabId: sshConfig.tabId,
          connectionStatus,
        });
      }

      if (
        procInfo &&
        procInfo.ready &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n\x1b[33m*** SSH连接已断开 ***\x1b[0m\r\n`,
        );
      }

      // 清理SFTP传输
      if (
        sftpTransfer &&
        typeof sftpTransfer.cleanupActiveTransfersForTab === "function"
      ) {
        sftpTransfer.cleanupActiveTransfersForTab(processId).catch((err) => {
          logToFile(
            `Error cleaning up SFTP transfers: ${err.message}`,
            "ERROR",
          );
        });
        if (sshConfig.tabId && sshConfig.tabId !== processId) {
          sftpTransfer
            .cleanupActiveTransfersForTab(sshConfig.tabId)
            .catch((err) => {
              logToFile(
                `Error cleaning up SFTP transfers for tabId: ${err.message}`,
                "ERROR",
              );
            });
        }
      }

      // 清理SFTP操作
      if (
        sftpCore &&
        typeof sftpCore.clearPendingOperationsForTab === "function"
      ) {
        sftpCore.clearPendingOperationsForTab(processId);
        if (sshConfig.tabId)
          sftpCore.clearPendingOperationsForTab(sshConfig.tabId);
      }

      // 清理SFTP会话池（SSH断开时关闭对应标签页的所有SFTP会话）
      try {
        if (
          sftpCore &&
          typeof sftpCore.closeAllSftpSessionsForTab === "function"
        ) {
          sftpCore.closeAllSftpSessionsForTab(processId);
          if (sshConfig.tabId) {
            sftpCore.closeAllSftpSessionsForTab(sshConfig.tabId);
          }
        }
      } catch (err) {
        logToFile(
          `Error closing SFTP sessions on SSH close: ${err.message}`,
          "ERROR",
        );
      }

      // 释放连接引用
      connectionManager.releaseSSHConnection(
        connectionInfo.key,
        sshConfig.tabId,
      );

      // 清理进程信息
      childProcesses.delete(processId);
      if (sshConfig.tabId) childProcesses.delete(sshConfig.tabId);
    });
  }

  // 发送数据到进程
  safeHandle(ipcMain, "terminal:sendToProcess", async (event, processId, data) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo || !procInfo.process) {
      return false;
    }

    try {
      // 确保退格键字符正确转换
      let processedData = data;

      // 检测是否包含中文字符
      const containsChinese = /[\u4e00-\u9fa5]/.test(data);
      if (containsChinese && procInfo.type === "ssh2") {
        // 确保中文字符能够正确处理
        // 对于SSH连接，我们需要确保数据是UTF-8编码的
        try {
          // 创建Buffer时显式指定UTF-8编码
          processedData = Buffer.from(data, "utf8").toString("utf8");
        } catch (error) {
          logToFile(
            `Error encoding Chinese characters: ${error.message}`,
            "ERROR",
          );
          // 如果编码失败，使用原始数据
          processedData = data;
        }
      }

      // 检测Tab键 (ASCII 9, \t, \x09)
      if (data === "\t" || data === "\x09") {
        // 直接发送到进程
        if (procInfo.type === "ssh2") {
          if (procInfo.stream) {
            procInfo.stream.write(processedData);
            return true;
          } else {
            logToFile("SSH2 stream not available", "ERROR");
            return false;
          }
        } else if (typeof procInfo.process.write === "function") {
          procInfo.process.write(processedData);
          return true;
        } else if (procInfo.process.stdin) {
          procInfo.process.stdin.write(processedData);
          return true;
        } else {
          logToFile("Process has no valid write method", "ERROR");
          return false;
        }
      }

      // 检测回车键并提取可能的命令
      if (data === "\r" || data === "\n") {
        // 可能是一个命令的结束，尝试从缓冲区获取命令
        if (procInfo.commandBuffer && procInfo.commandBuffer.trim()) {
          const command = procInfo.commandBuffer.trim();

          // 检测是否启动了编辑器（作为备用机制，现在优先使用buffer类型检测）
          if (!procInfo.editorMode && editorCommandRegex.test(command)) {
            procInfo.editorMode = true;
            procInfo.lastEditorCommand = command;
          }
          // 检测是否可能退出了编辑器（作为备用机制，现在优先使用buffer类型检测）
          else if (procInfo.editorMode) {
            // 检查是否是退出命令
            if (editorExitRegex.test(command)) {
              // 为某些编辑器，我们可以立即确认退出（但如果前端使用buffer类型检测，这段代码会被前端通知覆盖）
              if (/^(q|quit|exit|:q|:quit|:wq)$/i.test(command)) {
                procInfo.editorMode = false;
              } else {
                // 对于其他情况，设置一个退出检测标志，下一个命令会确认是否真的退出
                procInfo.possibleEditorExit = true;
              }
            }
            // 如果上一个命令可能是退出，且这个命令不是编辑器命令，则确认已退出
            else if (
              procInfo.possibleEditorExit &&
              !editorCommandRegex.test(command)
            ) {
              procInfo.editorMode = false;
              procInfo.possibleEditorExit = false;
            }
            // 如果收到普通shell命令且不在编辑器命令中，则退出编辑器模式
            else if (
              command.startsWith("$") ||
              command.startsWith(">") ||
              (command.includes(" ") &&
                !/^\s*(w|write|q|quit|exit|ZZ|x|c|change|d|delete|y|yank|p|put|u|undo|r|redo|i|insert|a|append)\s*/.test(
                  command,
                ))
            ) {
              procInfo.editorMode = false;
            }
          }
          // 只有不在编辑器模式下才添加到历史记录
          else if (!procInfo.editorMode) {
            // 修改命令记录逻辑，只记录远程命令
            // 对于SSH会话，先标记这个命令，稍后会通过输出提取确认的远程命令
            if (procInfo.isRemote) {
              // 只存储到lastLocalCommand，但不添加到历史记录
              procInfo.lastLocalCommand = command;
            }
            // 移除本地命令记录，不再记录非SSH会话的命令
          }
        }

        // 清空命令缓冲区
        procInfo.commandBuffer = "";
      } else {
        // 累积命令缓冲区
        procInfo.commandBuffer += data;
      }

      // 发送数据到进程
      if (procInfo.type === "ssh2") {
        if (procInfo.stream) {
          // 修改：对于SSH连接，确保使用UTF-8编码写入数据
          if (containsChinese) {
            // 对于包含中文字符的数据，确保使用Buffer写入
            procInfo.stream.write(Buffer.from(processedData, "utf8"));
          } else {
            procInfo.stream.write(processedData);
          }
          return true;
        } else {
          logToFile("SSH2 stream not available", "ERROR");
          return false;
        }
      } else if (typeof procInfo.process.write === "function") {
        procInfo.process.write(processedData);
        return true;
      } else if (procInfo.process.stdin) {
        procInfo.process.stdin.write(processedData);
        return true;
      } else {
        logToFile("Process has no valid write method", "ERROR");
        return false;
      }
    } catch (error) {
      logToFile(`Failed to send data to process: ${error.message}`, "ERROR");
      return false;
    }
  });

  // 终止进程
  safeHandle(ipcMain, "terminal:killProcess", async (event, processId) => {
    const proc = childProcesses.get(processId);
    if (proc && proc.process) {
      try {
        // 清理与此进程相关的待处理SFTP操作
        if (
          sftpCore &&
          typeof sftpCore.clearPendingOperationsForTab === "function"
        ) {
          sftpCore.clearPendingOperationsForTab(processId);
          // 如果是SSH进程，它可能在childProcesses中用config.tabId也存储了
          if (
            proc.config &&
            proc.config.tabId &&
            proc.config.tabId !== processId
          ) {
            sftpCore.clearPendingOperationsForTab(proc.config.tabId);
          }
        }

        // 如果是SSH连接，释放连接池中的连接引用
        if (proc.type === "ssh2" && proc.connectionInfo) {
          connectionManager.releaseSSHConnection(
            proc.connectionInfo.key,
            proc.config?.tabId,
          );
          logToFile(`释放SSH连接池引用: ${proc.connectionInfo.key}`, "INFO");

          // 注销延迟检测
          if (latencyHandlers && proc.config?.tabId) {
            try {
              latencyHandlers.latencyService.unregisterConnection(
                proc.config.tabId,
              );
              logToFile(`已注销SSH连接延迟检测: ${proc.config.tabId}`, "DEBUG");
            } catch (latencyError) {
              logToFile(`延迟检测注销失败: ${latencyError.message}`, "WARN");
            }
          }
        }

        // 移除stdout和stderr的监听器，防止在进程被kill后继续触发
        if (proc.process.stdout) {
          proc.process.stdout.removeAllListeners();
        }
        if (proc.process.stderr) {
          proc.process.stderr.removeAllListeners();
        }

        // 对于SSH连接，关闭stream而不是直接kill SSH客户端
        if (proc.type === "ssh2" && proc.stream) {
          try {
            proc.stream.close();
            logToFile(`关闭SSH stream for processId: ${processId}`, "INFO");
          } catch (error) {
            logToFile(
              `Error closing SSH stream ${processId}: ${error.message}`,
              "ERROR",
            );
          }
        } else {
          // 终止其他类型的进程
          try {
            if (typeof proc.process.kill === "function") {
              // 正常终止进程
              proc.process.kill();
            }
          } catch (error) {
            logToFile(
              `Error killing process ${processId}: ${error.message}`,
              "ERROR",
            );
          }
        }

        // 清理进程映射
        childProcesses.delete(processId);
        if (proc.config?.tabId && proc.config.tabId !== processId) {
          childProcesses.delete(proc.config.tabId);
        }
      } catch (error) {
        logToFile(`Error handling process kill: ${error.message}`, "ERROR");
      }
    }
  });

  // 接收编辑器模式状态变更通知
  safeHandle(
    "terminal:notifyEditorModeChange",
    async (event, processId, isEditorMode) => {
      const procInfo = childProcesses.get(processId);
      if (!procInfo) {
        return false;
      }

      // 记录状态变更前的值，用于调试
      const previousState = procInfo.editorMode;

      // 更新进程信息中的编辑器模式状态
      procInfo.editorMode = isEditorMode;

      // 仅当状态实际变化时记录详细日志
      if (previousState !== isEditorMode) {
        // 记录更多调试信息
        if (isEditorMode) {
          logToFile(
            `[EDITOR] 进程 ${processId} 进入编辑器模式（通过buffer类型检测）`,
            "DEBUG",
          );
        } else {
          logToFile(
            `[EDITOR] 进程 ${processId} 退出编辑器模式（通过buffer类型检测）`,
            "DEBUG",
          );
        }
      }

      // 如果退出编辑器模式，清除相关标志
      if (!isEditorMode) {
        procInfo.possibleEditorExit = false;
      }

      return true;
    },
  );

  // Save connection configuration
  safeHandle(ipcMain, "terminal:saveConnections", async (event, connections) => {
    const result = configService.saveConnections(connections);

    // 保存成功后,通知所有渲染进程连接配置已更新
    if (result) {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send("connections-changed");
        }
      }
    }

    return result;
  });

  // Note: terminal:loadConnections and terminal:loadTopConnections are registered before window creation

  // 选择密钥文件
  safeHandle(ipcMain, "terminal:selectKeyFile", async () => {
    return selectKeyFile();
  });

  // 代理配置相关IPC处理程序
  safeHandle(ipcMain, "proxy:getStatus", async () => {
    const proxyManager = require("./core/proxy/proxy-manager");
    return proxyManager.getProxyStatus();
  });

  safeHandle(ipcMain, "proxy:getDefaultConfig", async () => {
    const proxyManager = require("./core/proxy/proxy-manager");
    return proxyManager.getDefaultProxyConfig();
  });

  safeHandle(ipcMain, "proxy:saveDefaultConfig", async (event, proxyConfig) => {
    const proxyManager = require("./core/proxy/proxy-manager");
    return proxyManager.saveDefaultProxyConfig(proxyConfig);
  });

  safeHandle(ipcMain, "proxy:getSystemConfig", async () => {
    const proxyManager = require("./core/proxy/proxy-manager");
    return proxyManager.getSystemProxyConfig();
  });

  // Note: app:getVersion, app:close, app:reloadWindow, app:openExternal,
  // and app:checkForUpdate are registered before window creation via AppHandlers

  // 处理简单的命令
  safeHandle(ipcMain, "terminal:command", async (event, command) => {
    try {
      // 简单内部命令处理
      if (command === "date") {
        return { output: new Date().toString() };
      } else if (command.startsWith("echo ")) {
        return { output: command.substring(5) };
      } else {
        return { output: `Command not recognized: ${command}` };
      }
    } catch (error) {
      logToFile(`Command error: ${error.message}`, "ERROR");
      return { error: error.message };
    }
  });

  // 添加调整终端大小的处理
  safeHandle(ipcMain, "terminal:resize", async (event, processId, cols, rows) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo) {
      return false;
    }

    try {
      // 针对不同类型的进程进行不同的处理
      if (procInfo.type === "ssh2" && procInfo.stream) {
        // SSH2连接使用stream.setWindow方法调整大小
        if (typeof procInfo.stream.setWindow === "function") {
          procInfo.stream.setWindow(rows, cols);
          return true;
        }
      } else if (typeof procInfo.process.resize === "function") {
        // node-pty进程使用resize方法
        procInfo.process.resize(cols, rows);
        return true;
      }
      return false;
    } catch (error) {
      logToFile(`Failed to resize terminal: ${error.message}`, "ERROR");
      return false;
    }
  });

  // Note: terminal:getSystemInfo and terminal:getProcessList are registered
  // before window creation to prevent race conditions

  // 清理终端连接（用于连接刷新）
  safeHandle(ipcMain, "terminal:cleanupConnection", async (event, processId) => {
    try {
      if (!processId) {
        logToFile("No processId provided for cleanup", "WARN");
        return { success: false, error: "No processId provided" };
      }

      logToFile(`Cleaning up connection for process ${processId}`, "INFO");

      // 删除子进程映射
      if (childProcesses.has(processId)) {
        const processObj = childProcesses.get(processId);

        // 关闭SSH连接（如果存在）
        try {
          if (
            processObj.client &&
            typeof processObj.client.end === "function"
          ) {
            processObj.client.end();
          }
          if (
            processObj.process &&
            typeof processObj.process.kill === "function"
          ) {
            processObj.process.kill();
          }
        } catch (cleanupError) {
          logToFile(
            `Error during connection cleanup: ${cleanupError.message}`,
            "WARN",
          );
        }

        childProcesses.delete(processId);

        // 如果有tabId也清理
        if (processObj.config && processObj.config.tabId) {
          childProcesses.delete(processObj.config.tabId);
        }
      }

      return { success: true };
    } catch (error) {
      logToFile(`Failed to cleanup connection: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // AI设置相关IPC处理
  safeHandle(ipcMain, "ai:loadSettings", async () => {
    return configService.loadAISettings();
  });

  safeHandle(ipcMain, "ai:saveSettings", async (event, settings) => {
    return configService.saveAISettings(settings);
  });

  // 新增: 处理API配置的IPC方法
  safeHandle(ipcMain, "ai:saveApiConfig", async (event, config) => {
    try {
      if (logToFile) {
        logToFile(
          `Saving API config (via main.js IPC): ${JSON.stringify({
            id: config.id,
            name: config.name,
            model: config.model,
          })}`,
          "INFO",
        );
      }
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      if (!config.id) config.id = Date.now().toString();
      const existingIndex = settings.configs.findIndex(
        (c) => c.id === config.id,
      );
      if (existingIndex >= 0) {
        settings.configs[existingIndex] = config;
      } else {
        settings.configs.push(config);
      }
      return configService.saveAISettings(settings);
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to save API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      return false;
    }
  });

  safeHandle(ipcMain, "ai:deleteApiConfig", async (event, configId) => {
    try {
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      const originalLength = settings.configs.length;
      settings.configs = settings.configs.filter((c) => c.id !== configId);
      if (settings.current && settings.current.id === configId) {
        if (settings.configs.length > 0) {
          settings.current = { ...settings.configs[0] };
        } else {
          settings.current = {
            apiUrl: "",
            apiKey: "",
            model: "",
            streamEnabled: true,
          };
        }
      }
      if (settings.configs.length !== originalLength) {
        return configService.saveAISettings(settings);
      }
      return true;
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to delete API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      return false;
    }
  });

  safeHandle(ipcMain, "ai:setCurrentApiConfig", async (event, configId) => {
    try {
      if (logToFile)
        logToFile(
          `Setting current API config with ID (via main.js IPC): ${configId}`,
          "INFO",
        );
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      const selectedConfig = settings.configs.find((c) => c.id === configId);
      if (selectedConfig) {
        settings.current = { ...selectedConfig };
        return configService.saveAISettings(settings);
      }
      return false;
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to set current API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      return false;
    }
  });

  safeHandle(ipcMain, "ai:sendPrompt", async (event, prompt, settings) => {
    try {
      return await configService.sendAIPrompt(prompt, settings);
    } catch (error) {
      logToFile(`Error sending AI prompt: ${error.message}`, "ERROR");
      return { error: error.message || "发送请求时出错" };
    }
  });

  // 通过Worker线程处理API请求，绕过CORS限制
  safeHandle(ipcMain, "ai:sendAPIRequest", async (event, requestData, isStream) => {
    try {
      // 验证请求数据
      if (!requestData || !requestData.url || !requestData.apiKey || !requestData.model) {
        throw new Error("请先配置 AI API，包括 API 地址、密钥和模型");
      }

      if (!requestData.messages) {
        throw new Error("请求数据无效，缺少消息内容");
      }

      // 确保Worker已创建
      if (!aiWorker) {
        logToFile("AI Worker未初始化，尝试创建", "WARN");
        aiWorker = createAIWorker();
        if (!aiWorker) {
          throw new Error("无法创建AI Worker");
        }
      }

      // 生成请求ID
      const requestId = `req_${nextRequestId++}`;

      // 如果是流式请求，保存会话ID
      if (isStream) {
        currentSessionId = requestData.sessionId;
      }

      // 准备发送到Worker的数据
      const workerData = {
        ...requestData,
        isStream,
      };

      // 发送请求到Worker
      return new Promise((resolve, reject) => {
        // 设置请求超时
        const timeoutId = setTimeout(() => {
          aiRequestMap.delete(requestId);
          reject(new Error("请求超时"));
        }, 60000); // 60秒超时

        // 存储回调函数
        aiRequestMap.set(requestId, {
          resolve: (result) => {
            clearTimeout(timeoutId);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeoutId);
            reject(error);
          },
          timestamp: Date.now(),
        });

        // 发送消息到Worker
        aiWorker.postMessage({
          type: "api_request",
          id: requestId,
          data: workerData,
        });

        // 如果是流式请求，立即返回成功
        if (isStream) {
          resolve({ success: true, message: "流式请求已开始" });
        }
      });
    } catch (error) {
      logToFile(`处理AI请求时出错: ${error.message}`, "ERROR");
      return { error: error.message || "处理请求时出错" };
    }
  });

  // 处理中断API请求
  safeHandle(ipcMain, "ai:abortAPIRequest", async (event) => {
    try {
      // 检查是否有当前会话ID
      if (currentSessionId && aiWorker) {
        // 生成取消请求ID
        const cancelRequestId = `cancel_${Date.now()}`;

        // 尝试通过Worker取消请求
        aiWorker.postMessage({
          type: "cancel_request",
          id: cancelRequestId,
          data: {
            sessionId: currentSessionId,
          },
        });

        // 获取主窗口
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
          // 发送中断消息给渲染进程
          mainWindow.webContents.send("stream-end", {
            tabId: "ai",
            aborted: true,
            sessionId: currentSessionId,
          });
        }

        // 清理会话ID和映射
        streamSessions.delete(currentSessionId);
        currentSessionId = null;

        return { success: true, message: "请求已中断" };
      } else {
        return { success: false, message: "没有活跃的请求" };
      }
    } catch (error) {
      logToFile(`中断API请求时出错: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 获取可用模型列表
  safeHandle(ipcMain, "ai:fetchModels", async (event, requestData) => {
    try {
      // 确保Worker已创建
      if (!aiWorker) {
        logToFile("AI Worker未初始化，尝试创建", "WARN");
        aiWorker = createAIWorker();
        if (!aiWorker) {
          throw new Error("无法创建AI Worker");
        }
      }

      const requestId = nextRequestId++;
      const timeout = 30000; // 30秒超时

      return new Promise((resolve, reject) => {
        // 存储回调
        aiRequestMap.set(requestId, { resolve, reject });

        // 发送消息到worker
        aiWorker.postMessage({
          id: requestId,
          type: "api_request",
          data: {
            ...requestData,
            type: "models",
          },
        });

        // 设置超时
        setTimeout(() => {
          if (aiRequestMap.has(requestId)) {
            aiRequestMap.delete(requestId);
            reject(new Error("获取模型列表请求超时"));
          }
        }, timeout);
      });
    } catch (error) {
      logToFile(`获取模型列表失败: ${error.message}`, "ERROR");
      throw error;
    }
  });

  // 文件管理相关API
  safeHandle(ipcMain, "listFiles", async (event, tabId, path, options = {}) => {
    try {
      // 先确保SFTP会话有效
      if (sftpCore && typeof sftpCore.ensureSftpSession === "function") {
        try {
          await sftpCore.ensureSftpSession(tabId);
          logToFile(
            `Successfully ensured SFTP session for tab ${tabId} before listing files`,
            "INFO",
          );
        } catch (sessionError) {
          logToFile(
            `Failed to ensure SFTP session for tab ${tabId}: ${sessionError.message}`,
            "ERROR",
          );
          // 继续处理，让enqueueSftpOperation中的错误处理机制处理潜在问题
        }
      }

      // 使用 SFTP 会话池获取会话，而不是每次都创建新会话
      return sftpCore.enqueueSftpOperation(
        tabId,
        async () => {
          try {
            const sftp = await sftpCore.getSftpSession(tabId);

            return new Promise((resolve, reject) => {
              sftp.readdir(path || ".", (err, list) => {
                if (err) {
                  logToFile(
                    `Failed to list directory for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `无法列出目录: ${err.message}`,
                  });
                }

                const files = list.map((item) => ({
                  name: item.filename,
                  size: item.attrs.size,
                  isDirectory: item.attrs.isDirectory(),
                  modifyTime: new Date(item.attrs.mtime * 1000).toISOString(),
                  mtimeMs: item.attrs.mtime * 1000,
                  permissions: item.attrs.mode,
                }));

                // 非阻塞模式：分批发送，避免一次性大目录阻塞渲染
                const nonBlocking = Boolean(options.nonBlocking);
                const chunkSize = Math.max(
                  50,
                  Math.min(Number(options.chunkSize) || 200, 1000),
                );

                if (nonBlocking && files.length > chunkSize) {
                  const token = `${tabId}:${Date.now()}:${Math.random()
                    .toString(36)
                    .slice(2, 8)}`;
                  const firstChunk = files.slice(0, chunkSize);
                  // 立即返回首批，提升首屏响应
                  resolve({
                    success: true,
                    data: firstChunk,
                    token,
                    total: files.length,
                    chunked: true,
                    path,
                  });

                  // 异步分批推送剩余数据
                  const sender = event?.sender;
                  if (sender) {
                    let index = chunkSize;
                    let chunkIndex = 1;
                    const pushNext = () => {
                      if (index >= files.length) {
                        sender.send("listFiles:chunk", {
                          tabId,
                          path,
                          token,
                          chunkIndex,
                          items: [],
                          done: true,
                          total: files.length,
                        });
                        return;
                      }
                      const end = Math.min(index + chunkSize, files.length);
                      const items = files.slice(index, end);
                      sender.send("listFiles:chunk", {
                        tabId,
                        path,
                        token,
                        chunkIndex,
                        items,
                        done: end >= files.length,
                        total: files.length,
                      });
                      index = end;
                      chunkIndex += 1;
                      // 让出事件循环，避免长任务阻塞
                      setTimeout(pushNext, 0);
                    };
                    setTimeout(pushNext, 0);
                  }
                } else {
                  resolve({ success: true, data: files, path, chunked: false });
                }
              });
            });
          } catch (error) {
            return { success: false, error: `SFTP会话错误: ${error.message}` };
          }
        },
        {
          type: options.type || "readdir",
          path,
          canMerge: options.canMerge || false,
          priority: options.priority || "normal",
        },
      );
    } catch (error) {
      logToFile(
        `List files error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `列出文件失败: ${error.message}` };
    }
  });

  safeHandle(ipcMain, "copyFile", async (event, tabId, sourcePath, targetPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (
            !processInfo ||
            !processInfo.process ||
            processInfo.type !== "ssh2"
          ) {
            return { success: false, error: "无效的SSH连接" };
          }

          const sshClient = processInfo.process;

          return new Promise((resolve, reject) => {
            // 在远程服务器上执行复制命令
            sshClient.exec(
              `cp -r "${sourcePath}" "${targetPath}"`,
              (err, stream) => {
                if (err) {
                  logToFile(
                    `Failed to copy file for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `复制文件失败: ${err.message}`,
                  });
                }

                let errorOutput = "";

                stream.on("data", (data) => {
                  // 通常cp命令执行成功不会有输出
                });

                stream.stderr.on("data", (data) => {
                  errorOutput += data.toString();
                });

                stream.on("close", (code) => {
                  if (code === 0) {
                    resolve({ success: true });
                  } else {
                    logToFile(
                      `File copy failed with code ${code} for session ${tabId}: ${errorOutput}`,
                      "ERROR",
                    );
                    resolve({
                      success: false,
                      error: errorOutput || `复制文件失败，错误代码: ${code}`,
                    });
                  }
                });
              },
            );
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Copy file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `复制文件失败: ${error.message}` };
    }
  });

  safeHandle(ipcMain, "moveFile", async (event, tabId, sourcePath, targetPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (
            !processInfo ||
            !processInfo.process ||
            processInfo.type !== "ssh2"
          ) {
            return { success: false, error: "无效的SSH连接" };
          }

          const sshClient = processInfo.process;

          return new Promise((resolve, reject) => {
            // 在远程服务器上执行移动命令
            sshClient.exec(
              `mv "${sourcePath}" "${targetPath}"`,
              (err, stream) => {
                if (err) {
                  logToFile(
                    `Failed to move file for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `移动文件失败: ${err.message}`,
                  });
                }

                let errorOutput = "";

                stream.on("data", (data) => {
                  // 通常mv命令执行成功不会有输出
                });

                stream.stderr.on("data", (data) => {
                  errorOutput += data.toString();
                });

                stream.on("close", (code) => {
                  if (code === 0) {
                    resolve({ success: true });
                  } else {
                    logToFile(
                      `File move failed with code ${code} for session ${tabId}: ${errorOutput}`,
                      "ERROR",
                    );
                    resolve({
                      success: false,
                      error: errorOutput || `移动文件失败，错误代码: ${code}`,
                    });
                  }
                });
              },
            );
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Move file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `移动文件失败: ${error.message}` };
    }
  });

  safeHandle(ipcMain, "deleteFile", async (event, tabId, filePath, isDirectory) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (
            !processInfo ||
            !processInfo.process ||
            processInfo.type !== "ssh2"
          ) {
            return { success: false, error: "无效的SSH连接" };
          }

          const sshClient = processInfo.process;

          return new Promise((resolve, reject) => {
            // 根据是否为目录选择不同的删除命令
            const command = isDirectory
              ? `rm -rf "${filePath}"`
              : `rm "${filePath}"`;

            sshClient.exec(command, (err, stream) => {
              if (err) {
                logToFile(
                  `Failed to delete file for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `删除文件失败: ${err.message}`,
                });
              }

              let errorOutput = "";

              stream.on("data", (data) => {
                // 通常rm命令执行成功不会有输出
              });

              stream.stderr.on("data", (data) => {
                errorOutput += data.toString();
              });

              stream.on("close", (code) => {
                if (code === 0) {
                  resolve({ success: true });
                } else {
                  logToFile(
                    `File deletion failed with code ${code} for session ${tabId}: ${errorOutput}`,
                    "ERROR",
                  );
                  resolve({
                    success: false,
                    error: errorOutput || `删除文件失败，错误代码: ${code}`,
                  });
                }
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Delete file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `删除文件失败: ${error.message}` };
    }
  });

  // 创建文件夹
  safeHandle(ipcMain, "createFolder", async (event, tabId, folderPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise((resolve, reject) => {
            // 创建文件夹
            sftp.mkdir(folderPath, (err) => {
              if (err) {
                logToFile(
                  `Failed to create folder for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `创建文件夹失败: ${err.message}`,
                });
              }

              resolve({ success: true });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Create folder error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `创建文件夹失败: ${error.message}` };
    }
  });

  // 创建文件
  safeHandle(ipcMain, "createFile", async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise((resolve, reject) => {
            // 使用writeFile创建一个空文件
            const emptyBuffer = Buffer.from("");
            sftp.writeFile(filePath, emptyBuffer, (err) => {
              if (err) {
                logToFile(
                  `Failed to create file for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `创建文件失败: ${err.message}`,
                });
              }

              resolve({ success: true });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Create file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `创建文件失败: ${error.message}` };
    }
  });

  // 设置文件权限
  safeHandle(
    "setFilePermissions",
    async (event, tabId, filePath, permissions) => {
      try {
        // 使用 SFTP 会话池获取会话
        return sftpCore.enqueueSftpOperation(tabId, async () => {
          try {
            // 查找对应的SSH客户端
            const processInfo = childProcesses.get(tabId);
            if (
              !processInfo ||
              !processInfo.process ||
              processInfo.type !== "ssh2"
            ) {
              return { success: false, error: "无效的SSH连接" };
            }
            const sshClient = processInfo.process;
            return new Promise((resolve, reject) => {
              // 使用SSH执行chmod命令设置权限
              const command = `chmod ${permissions} "${filePath}"`;
              sshClient.exec(command, (err, stream) => {
                if (err) {
                  logToFile(
                    `Failed to set file permissions for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `设置权限失败: ${err.message}`,
                  });
                }

                let stderr = "";
                stream
                  .on("close", (code, signal) => {
                    if (code === 0) {
                      logToFile(
                        `Successfully set permissions ${permissions} for file ${filePath} in session ${tabId}`,
                        "INFO",
                      );
                      resolve({ success: true });
                    } else {
                      const errorMsg =
                        stderr || `chmod命令执行失败，退出码: ${code}`;
                      logToFile(
                        `Failed to set permissions for session ${tabId}: ${errorMsg}`,
                        "ERROR",
                      );
                      resolve({
                        success: false,
                        error: `设置权限失败: ${errorMsg}`,
                      });
                    }
                  })
                  .on("data", (data) => {
                    // 标准输出通常没有内容
                  })
                  .stderr.on("data", (data) => {
                    stderr += data.toString();
                  });
              });
            });
          } catch (error) {
            return { success: false, error: `SFTP会话错误: ${error.message}` };
          }
        });
      } catch (error) {
        logToFile(
          `Set file permissions error for session ${tabId}: ${error.message}`,
          "ERROR",
        );
        return { success: false, error: `设置权限失败: ${error.message}` };
      }
    },
  );

  // 获取文件权限
  safeHandle(ipcMain, "getFilePermissions", async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);
          return new Promise((resolve, reject) => {
            // 使用SFTP的stat方法获取文件信息
            sftp.stat(filePath, (err, stats) => {
              if (err) {
                logToFile(
                  `Failed to get file permissions for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `获取权限失败: ${err.message}`,
                });
              }

              // 从stats中提取权限信息
              const mode = stats.mode;
              // 提取权限位（去掉文件类型位）
              const permissions = (mode & parseInt("777", 8)).toString(8);

              resolve({
                success: true,
                permissions: permissions.padStart(3, "0"),
                mode: mode,
                stats: stats,
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Get file permissions error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `获取权限失败: ${error.message}` };
    }
  });

  safeHandle(ipcMain, "downloadFile", async (event, tabId, remotePath) => {
    if (
      !sftpTransfer ||
      typeof sftpTransfer.handleDownloadFile !== "function"
    ) {
      logToFile(
        "sftpTransfer.handleDownloadFile is not available or not a function.",
        "ERROR",
      );
      return {
        success: false,
        error: "SFTP Download feature not properly initialized.",
      };
    }
    // sftpTransfer.handleDownloadFile signature is: async function handleDownloadFile(event, tabId, remotePath)
    return sftpTransfer.handleDownloadFile(event, tabId, remotePath);
  });

  // 设置文件所有者/组
  safeHandle(
    "setFileOwnership",
    async (event, tabId, filePath, owner, group) => {
      try {
        // 使用 SFTP 会话池串行化该类操作
        return sftpCore.enqueueSftpOperation(tabId, async () => {
          try {
            // 查找对应的SSH客户端
            const processInfo = childProcesses.get(tabId);
            if (
              !processInfo ||
              !processInfo.process ||
              processInfo.type !== "ssh2"
            ) {
              return { success: false, error: "无效的SSH连接" };
            }

            // 构建 chown 参数
            const ownerSpec =
              owner && group
                ? `${owner}:${group}`
                : owner && !group
                  ? `${owner}`
                  : !owner && group
                    ? `:${group}`
                    : null;

            if (!ownerSpec) {
              // 没有需要变更的内容
              return { success: true };
            }

            const sshClient = processInfo.process;
            return new Promise((resolve) => {
              const command = `chown ${ownerSpec} "${filePath}"`;
              sshClient.exec(command, (err, stream) => {
                if (err) {
                  logToFile(
                    `Failed to set file ownership for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `设置所有者/组失败: ${err.message}`,
                  });
                }

                let stderr = "";
                stream
                  .on("close", (code) => {
                    if (code === 0) {
                      logToFile(
                        `Successfully set ownership ${ownerSpec} for ${filePath} in session ${tabId}`,
                        "INFO",
                      );
                      resolve({ success: true });
                    } else {
                      const errorMsg =
                        stderr || `chown命令执行失败，退出码: ${code}`;
                      logToFile(
                        `Failed to set ownership for session ${tabId}: ${errorMsg}`,
                        "ERROR",
                      );
                      resolve({
                        success: false,
                        error: `设置所有者/组失败: ${errorMsg}`,
                      });
                    }
                  })
                  .on("data", () => {})
                  .stderr.on("data", (data) => {
                    stderr += data.toString();
                  });
              });
            });
          } catch (error) {
            return { success: false, error: `SFTP会话错误: ${error.message}` };
          }
        });
      } catch (error) {
        logToFile(
          `Set file ownership error for session ${tabId}: ${error.message}`,
          "ERROR",
        );
        return { success: false, error: `设置所有者/组失败: ${error.message}` };
      }
    },
  );

  safeHandle(
    "external-editor:open",
    async (event, tabId, remotePath) => {
      if (
        !externalEditorManager ||
        typeof externalEditorManager.openFileInExternalEditor !== "function"
      ) {
        return {
          success: false,
          error: "External editor feature not available.",
        };
      }

      if (!tabId || !remotePath) {
        return { success: false, error: "Missing parameters." };
      }

      try {
        return await externalEditorManager.openFileInExternalEditor(
          tabId,
          remotePath,
        );
      } catch (error) {
        logToFile(
          `External editor open failed for ${remotePath}: ${error.message}`,
          "ERROR",
        );
        return { success: false, error: error.message };
      }
    },
  );
  // Handle creating remote folder structure
  safeHandle(ipcMain, "createRemoteFolders", async (event, tabId, folderPath) => {
    try {
      const processInfo = childProcesses.get(tabId);
      if (!processInfo || !processInfo.config || processInfo.type !== "ssh2") {
        return { success: false, error: "Invalid SSH connection" };
      }

      // 使用sftpCore获取SFTP会话
      const sftp = await sftpCore.getSftpSession(tabId);

      // 递归创建目录
      const createDirRecursive = async (dirPath) => {
        const parts = dirPath.split("/").filter(Boolean);
        let currentPath = dirPath.startsWith("/") ? "/" : "";

        for (const part of parts) {
          currentPath = path.posix.join(currentPath, part);

          try {
            await new Promise((resolve, reject) => {
              sftp.stat(currentPath, (err, stats) => {
                if (err) {
                  if (err.code === 2) {
                    // No such file
                    sftp.mkdir(currentPath, (mkdirErr) => {
                      if (mkdirErr && mkdirErr.code !== 4) {
                        // 4 = already exists
                        reject(mkdirErr);
                      } else {
                        resolve();
                      }
                    });
                  } else {
                    reject(err);
                  }
                } else if (stats.isDirectory()) {
                  resolve();
                } else {
                  reject(
                    new Error(
                      `Path exists but is not a directory: ${currentPath}`,
                    ),
                  );
                }
              });
            });
          } catch (error) {
            // 继续处理，目录可能已存在
            logToFile(
              `Warning creating folder ${currentPath}: ${error.message}`,
              "WARN",
            );
          }
        }
      };

      await createDirRecursive(folderPath);
      return { success: true };
    } catch (error) {
      logToFile(`Error creating remote folders: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // Handle SFTP Upload File
  safeHandle(
    "uploadFile",
    async (event, tabId, targetFolder, progressChannel) => {
      // Ensure sftpTransfer module is available
      if (
        !sftpTransfer ||
        typeof sftpTransfer.handleUploadFile !== "function"
      ) {
        logToFile(
          "sftpTransfer.handleUploadFile is not available or not a function.",
          "ERROR",
        );
        return {
          success: false,
          error: "SFTP Upload feature not properly initialized.",
        };
      }

      const processInfo = childProcesses.get(tabId);
      if (
        !processInfo ||
        !processInfo.config ||
        !processInfo.process ||
        processInfo.type !== "ssh2"
      ) {
        logToFile(
          `Invalid or not ready SSH connection for tabId: ${tabId}`,
          "ERROR",
        );
        return { success: false, error: "无效或未就绪的SSH连接" };
      }

      const mainWindow =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!mainWindow) {
        logToFile("No main window available for dialog.", "ERROR");
        return { success: false, error: "无法显示对话框" };
      }

      // Open file selection dialog
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "选择要上传的文件",
        properties: ["openFile", "multiSelections"],
        buttonLabel: "上传文件",
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, cancelled: true, error: "用户取消上传" };
      }

      try {
        // Call the refactored sftpTransfer function, now passing progressChannel
        return await sftpTransfer.handleUploadFile(
          event,
          tabId,
          targetFolder,
          filePaths,
          progressChannel,
        );
      } catch (error) {
        logToFile(`Error in uploadFile IPC handler: ${error.message}`, "ERROR");

        // 检查是否是由用户取消操作引起的错误
        const isCancelError =
          error.message?.includes("cancel") ||
          error.message?.includes("abort") ||
          error.message?.includes("用户取消") ||
          error.message?.includes("user cancelled");

        // 如果是取消操作，返回成功状态而非错误
        if (isCancelError) {
          logToFile(
            `Upload cancelled by user for tab ${tabId}, suppressing error display`,
            "INFO",
          );

          // 触发目录刷新
          if (sftpCore && typeof sftpCore.enqueueSftpOperation === "function") {
            try {
              // 异步刷新目录，不等待结果
              setTimeout(() => {
                sftpCore
                  .enqueueSftpOperation(
                    tabId,
                    async () => {
                      try {
                        logToFile(
                          `Refreshing directory listing for tab ${tabId} after cancel at path: ${targetFolder}`,
                          "INFO",
                        );
                        return { success: true, refreshed: true };
                      } catch (refreshError) {
                        logToFile(
                          `Error refreshing directory after cancel: ${refreshError.message}`,
                          "WARN",
                        );
                        return { success: false, error: refreshError.message };
                      }
                    },
                    {
                      type: "readdir",
                      path: targetFolder || ".",
                      priority: "high",
                      canMerge: true,
                    },
                  )
                  .catch((err) => {
                    logToFile(
                      `Failed to enqueue refresh operation: ${err.message}`,
                      "WARN",
                    );
                  });
              }, 500); // 延迟500ms执行刷新
            } catch (refreshError) {
              logToFile(
                `Error triggering directory refresh: ${refreshError.message}`,
                "WARN",
              );
            }
          }

          // 返回成功状态，表明这是用户取消操作
          return {
            success: true,
            cancelled: true,
            userCancelled: true,
            message: "用户已取消操作",
          };
        }

        // 其他类型的错误，正常返回错误信息
        return {
          success: false,
          error: `上传文件失败: ${error.message}`,
        };
      }
    },
  );

  // Handle SFTP Upload Dropped Files (from drag-and-drop)
  safeHandle(
    "uploadDroppedFiles",
    async (event, tabId, targetFolder, uploadData, progressChannel) => {
      // Ensure sftpTransfer module is available
      if (
        !sftpTransfer ||
        typeof sftpTransfer.handleUploadFile !== "function"
      ) {
        logToFile(
          "sftpTransfer.handleUploadFile is not available or not a function.",
          "ERROR",
        );
        return {
          success: false,
          error: "SFTP Upload feature not properly initialized.",
        };
      }

      const processInfo = childProcesses.get(tabId);
      if (
        !processInfo ||
        !processInfo.config ||
        !processInfo.process ||
        processInfo.type !== "ssh2"
      ) {
        logToFile(
          `Invalid or not ready SSH connection for tabId: ${tabId}`,
          "ERROR",
        );
        return { success: false, error: "无效或未就绪的SSH连接" };
      }

      try {
        const fs = require("fs");
        const path = require("path");
        const os = require("os");
        const tempDir = os.tmpdir();

        // 首先创建远程文件夹结构
        if (uploadData.folders && uploadData.folders.length > 0) {
          const sftp = await sftpCore.getSftpSession(tabId);

          for (const folderPath of uploadData.folders) {
            const remoteFolderPath = path.posix
              .join(targetFolder, folderPath)
              .replace(/\\/g, "/");

            try {
              await new Promise((resolve, reject) => {
                sftp.mkdir(remoteFolderPath, (err) => {
                  if (err) {
                    // 忽略文件夹已存在的错误
                    if (err.code === 4 || err.message.includes("File exists")) {
                      resolve();
                    } else {
                      logToFile(
                        `Error creating folder ${remoteFolderPath}: ${err.message}`,
                        "WARN",
                      );
                      resolve(); // 继续处理，不中断整个上传
                    }
                  } else {
                    logToFile(`Created folder: ${remoteFolderPath}`, "INFO");
                    resolve();
                  }
                });
              });
            } catch (folderError) {
              logToFile(
                `Error creating folder ${remoteFolderPath}: ${folderError.message}`,
                "WARN",
              );
            }
          }
        }

        // 将拖拽的文件数据转换为文件路径数组
        const filePaths = [];
        const filesData = uploadData.files || uploadData; // 兼容旧格式

        // 为每个文件创建临时文件
        for (const fileData of filesData) {
          if (fileData) {
            // 创建临时文件路径，保持相对路径结构
            const relativePath = fileData.relativePath || fileData.name;
            const tempFilePath = path.join(
              tempDir,
              "simpleshell-upload",
              relativePath,
            );
            const tempFileDir = path.dirname(tempFilePath);

            // 确保目录存在
            if (!fs.existsSync(tempFileDir)) {
              fs.mkdirSync(tempFileDir, { recursive: true });
            }

            // 处理分块数据
            let buffer;
            if (fileData.chunks && fileData.isChunked) {
              // 合并分块
              const totalLength = fileData.chunks.reduce(
                (sum, chunk) => sum + chunk.length,
                0,
              );
              buffer = Buffer.alloc(totalLength);
              let offset = 0;
              for (const chunk of fileData.chunks) {
                const chunkBuffer = Buffer.from(chunk);
                chunkBuffer.copy(buffer, offset);
                offset += chunkBuffer.length;
              }
            } else if (fileData.chunks && fileData.chunks.length === 1) {
              // 单块数据
              buffer = Buffer.from(fileData.chunks[0]);
            } else if (fileData.data) {
              // 兼容旧格式
              buffer = Buffer.from(fileData.data);
            } else {
              continue;
            }

            // 将文件内容写入临时文件
            fs.writeFileSync(tempFilePath, buffer);

            // 如果有相对路径，需要保持文件夹结构
            if (fileData.relativePath && fileData.relativePath.includes("/")) {
              // 文件在子文件夹中，需要调整目标路径
              const remoteFilePath = path.posix
                .join(targetFolder, fileData.relativePath)
                .replace(/\\/g, "/");
              filePaths.push({
                localPath: tempFilePath,
                remotePath: remoteFilePath,
              });
            } else {
              filePaths.push(tempFilePath);
            }
          }
        }

        if (filePaths.length === 0) {
          return { success: false, error: "没有有效的文件可上传" };
        }

        // 调用现有的上传处理函数
        // 如果有自定义路径映射，需要特殊处理
        const hasCustomPaths = filePaths.some((f) => typeof f === "object");

        if (hasCustomPaths) {
          // 需要逐个上传文件到指定路径
          let uploadedCount = 0;
          let failedCount = 0;
          const totalFiles = filePaths.length;
          let totalBytesUploaded = 0;
          let totalBytesToUpload = 0;

          // 计算总文件大小
          for (const fileInfo of filePaths) {
            const localPath =
              typeof fileInfo === "string" ? fileInfo : fileInfo.localPath;
            try {
              const stats = fs.statSync(localPath);
              totalBytesToUpload += stats.size;
            } catch (e) {
              // 忽略无法读取的文件
            }
          }

          // 发送初始进度
          if (progressChannel) {
            event.sender.send(progressChannel, {
              tabId,
              progress: 0,
              fileName: "准备上传文件...",
              currentFileIndex: 0,
              totalFiles: totalFiles,
              transferredBytes: 0,
              totalBytes: totalBytesToUpload,
              transferSpeed: 0,
              remainingTime: 0,
            });
          }

          const startTime = Date.now();
          let lastProgressTime = Date.now();
          let lastBytesTransferred = 0;

          for (let i = 0; i < filePaths.length; i++) {
            const fileInfo = filePaths[i];
            const localPath =
              typeof fileInfo === "string" ? fileInfo : fileInfo.localPath;
            const remotePath =
              typeof fileInfo === "string"
                ? path.posix
                    .join(targetFolder, path.basename(fileInfo))
                    .replace(/\\/g, "/")
                : fileInfo.remotePath;

            // 获取远程目录路径
            const remoteDir = path.posix.dirname(remotePath);
            const fileName = path.basename(localPath);

            // 获取当前文件大小
            let currentFileSize = 0;
            try {
              const stats = fs.statSync(localPath);
              currentFileSize = stats.size;
            } catch (e) {
              // 忽略
            }

            // 发送当前文件进度
            if (progressChannel) {
              const now = Date.now();
              const timeDiff = (now - lastProgressTime) / 1000;
              const bytesDiff = totalBytesUploaded - lastBytesTransferred;
              const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
              const remainingBytes = totalBytesToUpload - totalBytesUploaded;
              const remainingTime = speed > 0 ? remainingBytes / speed : 0;

              event.sender.send(progressChannel, {
                tabId,
                fileName: fileName,
                currentFileIndex: i,
                totalFiles: totalFiles,
                progress: Math.floor(
                  (totalBytesUploaded / totalBytesToUpload) * 100,
                ),
                transferredBytes: totalBytesUploaded,
                totalBytes: totalBytesToUpload,
                transferSpeed: speed,
                remainingTime: remainingTime,
              });

              lastProgressTime = now;
              lastBytesTransferred = totalBytesUploaded;
            }

            // 创建单个文件的进度通道
            const singleFileProgressChannel = `${progressChannel}-file-${i}`;
            let currentFileBytesTransferred = 0;

            // 转发单个文件的进度
            const progressHandler = (evt, data) => {
              if (progressChannel) {
                // 更新当前文件的传输字节数
                if (data.transferredBytes !== undefined) {
                  const newBytes =
                    data.transferredBytes - currentFileBytesTransferred;
                  currentFileBytesTransferred = data.transferredBytes;
                  totalBytesUploaded += newBytes;
                }

                const now = Date.now();
                const timeDiff = (now - lastProgressTime) / 1000;
                const bytesDiff = totalBytesUploaded - lastBytesTransferred;
                const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
                const remainingBytes = totalBytesToUpload - totalBytesUploaded;
                const remainingTime = speed > 0 ? remainingBytes / speed : 0;
                const overallProgress = Math.floor(
                  (totalBytesUploaded / totalBytesToUpload) * 100,
                );

                event.sender.send(progressChannel, {
                  tabId,
                  currentFileIndex: i,
                  totalFiles: totalFiles,
                  fileName: fileName,
                  progress: overallProgress,
                  transferredBytes: totalBytesUploaded,
                  totalBytes: totalBytesToUpload,
                  transferSpeed: speed,
                  remainingTime: remainingTime,
                });

                if (timeDiff > 0.5) {
                  // 每0.5秒更新速度
                  lastProgressTime = now;
                  lastBytesTransferred = totalBytesUploaded;
                }
              }
            };

            event.sender.on(singleFileProgressChannel, progressHandler);

            // 上传单个文件
            const singleResult = await sftpTransfer.handleUploadFile(
              event,
              tabId,
              remoteDir,
              [localPath],
              singleFileProgressChannel,
            );

            // 清理监听器
            event.sender.removeListener(
              singleFileProgressChannel,
              progressHandler,
            );

            if (singleResult.success) {
              uploadedCount++;
              // 确保在成功后总字节数是正确的
              if (currentFileBytesTransferred < currentFileSize) {
                totalBytesUploaded +=
                  currentFileSize - currentFileBytesTransferred;
              }
            } else {
              failedCount++;
            }
          }

          // 发送完成状态
          if (progressChannel) {
            event.sender.send(progressChannel, {
              tabId,
              progress: 100,
              operationComplete: true,
              fileName: "所有文件上传完成",
              currentFileIndex: totalFiles,
              totalFiles: totalFiles,
              transferredBytes: totalBytesUploaded,
              totalBytes: totalBytesToUpload,
              transferSpeed: 0,
              remainingTime: 0,
              successfulFiles: uploadedCount,
              failedFiles: failedCount,
            });
          }

          // 清理临时文件
          try {
            const tempUploadDir = path.join(tempDir, "simpleshell-upload");
            if (fs.existsSync(tempUploadDir)) {
              fs.rmSync(tempUploadDir, { recursive: true, force: true });
            }
          } catch (cleanupError) {
            logToFile(
              `Error cleaning up temp files: ${cleanupError.message}`,
              "WARN",
            );
          }

          return {
            success: failedCount === 0,
            uploadedCount,
            totalFiles,
            failedCount,
          };
        } else {
          // 所有文件上传到同一目录
          const uploadPaths = filePaths.map((f) =>
            typeof f === "string" ? f : f.localPath,
          );
          const result = await sftpTransfer.handleUploadFile(
            event,
            tabId,
            targetFolder,
            uploadPaths,
            progressChannel,
          );

          // 清理临时文件
          try {
            const tempUploadDir = path.join(tempDir, "simpleshell-upload");
            if (fs.existsSync(tempUploadDir)) {
              fs.rmSync(tempUploadDir, { recursive: true, force: true });
            }
          } catch (cleanupError) {
            logToFile(
              `Error cleaning up temp files: ${cleanupError.message}`,
              "WARN",
            );
          }

          return result;
        }
      } catch (error) {
        logToFile(
          `Error in uploadDroppedFiles IPC handler: ${error.message}`,
          "ERROR",
        );
        // 检查是否是由用户取消操作引起的错误
        const isCancelError =
          error.message?.includes("cancel") ||
          error.message?.includes("abort") ||
          error.message?.includes("用户取消") ||
          error.message?.includes("user cancelled");

        // 如果是取消操作，返回成功状态而非错误
        if (isCancelError) {
          logToFile(
            `Upload cancelled by user for tab ${tabId}, suppressing error display`,
            "INFO",
          );

          // 触发目录刷新
          if (sftpCore && typeof sftpCore.enqueueSftpOperation === "function") {
            try {
              // 异步刷新目录，不等待结果
              setTimeout(() => {
                sftpCore
                  .enqueueSftpOperation(
                    tabId,
                    async () => {
                      try {
                        logToFile(
                          `Refreshing directory listing for tab ${tabId} after cancel at path: ${targetFolder}`,
                          "INFO",
                        );
                        return { success: true, refreshed: true };
                      } catch (refreshError) {
                        logToFile(
                          `Error refreshing directory after cancel: ${refreshError.message}`,
                          "WARN",
                        );
                        return { success: false, error: refreshError.message };
                      }
                    },
                    {
                      type: "readdir",
                      path: targetFolder || ".",
                      priority: "high",
                    },
                  )
                  .catch((err) => {
                    logToFile(
                      `Error triggering directory refresh after cancel: ${err.message}`,
                      "WARN",
                    );
                  });
              }, 100);
            } catch (refreshErr) {
              logToFile(
                `Error setting up directory refresh after cancel: ${refreshErr.message}`,
                "WARN",
              );
            }
          }

          // 返回成功状态，表明这是用户取消操作
          return {
            success: true,
            cancelled: true,
            userCancelled: true,
            message: "用户已取消操作",
          };
        }

        // 其他类型的错误，正常返回错误信息
        return {
          success: false,
          error: `上传文件失败: ${error.message}`,
        };
      }
    },
  );

  safeHandle(ipcMain, "renameFile", async (event, tabId, oldPath, newName) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          // 从原路径中提取目录部分
          const lastSlashIndex = oldPath.lastIndexOf("/");
          const dirPath =
            lastSlashIndex > 0 ? oldPath.substring(0, lastSlashIndex) : "/";

          // 构建新路径
          const newPath =
            dirPath === "/" ? `/${newName}` : `${dirPath}/${newName}`;

          return new Promise((resolve, reject) => {
            // 使用SFTP重命名文件/文件夹
            sftp.rename(oldPath, newPath, (err) => {
              if (err) {
                logToFile(
                  `Failed to rename file for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `重命名失败: ${err.message}`,
                });
              }

              resolve({ success: true });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Rename file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `重命名失败: ${error.message}` };
    }
  });

  safeHandle(ipcMain, "getAbsolutePath", async (event, tabId, relativePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (
            !processInfo ||
            !processInfo.process ||
            processInfo.type !== "ssh2"
          ) {
            return { success: false, error: "无效的SSH连接" };
          }

          const sshClient = processInfo.process;

          return new Promise((resolve, reject) => {
            // 使用SSH执行pwd命令获取当前目录（用作基准目录）
            sshClient.exec("pwd", (err, stream) => {
              if (err) {
                return resolve({
                  success: false,
                  error: `无法获取绝对路径: ${err.message}`,
                });
              }

              let pwdOutput = "";

              stream.on("data", (data) => {
                pwdOutput += data.toString().trim();
              });

              stream.on("close", () => {
                let absolutePath;

                if (relativePath.startsWith("/")) {
                  // 如果是绝对路径，则直接使用
                  absolutePath = relativePath;
                } else if (relativePath.startsWith("~")) {
                  // 如果以~开头，替换为home目录
                  absolutePath = relativePath.replace(
                    "~",
                    sshClient._sock._handle.remoteAddress,
                  );
                } else {
                  // 相对路径，基于pwd结果计算
                  absolutePath = pwdOutput + "/" + relativePath;
                }

                resolve({ success: true, path: absolutePath });
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Get absolute path error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `获取绝对路径失败: ${error.message}` };
    }
  });

  // 取消所有类型的文件传输（单文件传输、文件夹上传、文件夹下载等）
  safeHandle(ipcMain, "cancelTransfer", async (event, tabId, transferKey) => {
    if (
      !sftpTransfer ||
      typeof sftpTransfer.handleCancelTransfer !== "function"
    ) {
      logToFile(
        "sftpTransfer.handleCancelTransfer is not available or not a function.",
        "ERROR",
      );
      return {
        success: false,
        error: "SFTP Cancel Transfer feature not properly initialized.",
      };
    }

    try {
      // 调用取消传输处理函数
      const result = await sftpTransfer.handleCancelTransfer(
        event,
        tabId,
        transferKey,
      );

      // 如果结果表明这是用户主动取消，不作为错误处理
      if (result.userCancelled) {
        logToFile(
          `User cancelled transfer ${transferKey} for tab ${tabId}, suppressing error display`,
          "INFO",
        );
        // 确保success为true，确保前端不会显示错误
        return {
          ...result,
          success: true,
          suppressError: true,
          message: result.message || "传输已取消",
        };
      }

      return result;
    } catch (error) {
      logToFile(
        `Error in cancelTransfer IPC handler: ${error.message}`,
        "ERROR",
      );
      return {
        success: false,
        error: `处理传输取消请求时出错: ${error.message}`,
      };
    }
  });

  // 获取或创建 SFTP 会话
  safeHandle(ipcMain, "getSftpSession", async (event, tabId) => {
    try {
      return sftpCore.getSftpSession(tabId);
    } catch (error) {
      logToFile(`Error getting SFTP session: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 处理 SFTP 操作队列
  safeHandle(ipcMain, "enqueueSftpOperation", async (event, tabId, operation) => {
    try {
      return sftpCore.enqueueSftpOperation(tabId, operation);
    } catch (error) {
      logToFile(`Error enqueuing SFTP operation: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 处理队列中的 SFTP 操作
  safeHandle(ipcMain, "processSftpQueue", async (event, tabId) => {
    try {
      return sftpCore.processSftpQueue(tabId);
    } catch (error) {
      logToFile(`Error processing SFTP queue: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 读取文件内容，返回文本
  safeHandle(ipcMain, "readFileContent", async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise((resolve, reject) => {
            sftp.readFile(filePath, (err, data) => {
              if (err) {
                logToFile(
                  `Failed to read file content for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `读取文件内容失败: ${err.message}`,
                });
              }

              resolve({
                success: true,
                content: data.toString("utf8"),
                filePath,
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Read file content error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `读取文件内容失败: ${error.message}` };
    }
  });

  // 读取文件内容，返回base64编码的数据（适用于图片等二进制文件）
  safeHandle(ipcMain, "readFileAsBase64", async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise(async (resolve, reject) => {
            sftp.readFile(filePath, async (err, data) => {
              if (err) {
                logToFile(
                  `Failed to read file as base64 for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `读取文件内容失败: ${err.message}`,
                });
              }

              try {
                // 缓存文件到本地
                const fileName = path.basename(filePath);
                const cacheFilePath = await fileCache.cacheFile(
                  fileName,
                  data,
                  tabId,
                );

                // 转换为base64
                const base64Data = data.toString("base64");

                resolve({
                  success: true,
                  content: base64Data,
                  filePath,
                  cacheFilePath, // 返回缓存文件路径
                });
              } catch (cacheError) {
                logToFile(
                  `Failed to cache file ${filePath}: ${cacheError.message}`,
                  "WARN",
                );

                // 即使缓存失败，仍然返回base64数据
                const base64Data = data.toString("base64");
                resolve({
                  success: true,
                  content: base64Data,
                  filePath,
                });
              }
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Read file as base64 error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `读取文件内容失败: ${error.message}` };
    }
  });

  // 清理文件缓存
  safeHandle(ipcMain, "cleanupFileCache", async (event, cacheFilePath) => {
    try {
      if (cacheFilePath) {
        const success = await fileCache.cleanupCacheFile(cacheFilePath);
        return { success };
      } else {
        return { success: false, error: "缓存文件路径不能为空" };
      }
    } catch (error) {
      logToFile(
        `Failed to cleanup cache file ${cacheFilePath}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  });

  // 清理标签页缓存
  safeHandle(ipcMain, "cleanupTabCache", async (event, tabId) => {
    try {
      const cleanedCount = await fileCache.cleanupTabCaches(tabId);
      return { success: true, cleanedCount };
    } catch (error) {
      logToFile(
        `Failed to cleanup tab cache for ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  });

  // 新增：保存文件内容
  safeHandle(ipcMain, "saveFileContent", async (event, tabId, filePath, content) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise((resolve, reject) => {
            // 将内容转换为Buffer
            const buffer = Buffer.from(content, "utf8");

            sftp.writeFile(filePath, buffer, (err) => {
              if (err) {
                logToFile(
                  `Failed to save file content for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `保存文件内容失败: ${err.message}`,
                });
              }

              resolve({
                success: true,
                filePath,
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Save file content error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `保存文件内容失败: ${error.message}` };
    }
  });

  // 新增：上传文件夹处理函数
  safeHandle(
    "upload-folder",
    async (event, tabId, targetFolder, progressChannel) => {
      // Ensure sftpTransfer module is available
      if (
        !sftpTransfer ||
        typeof sftpTransfer.handleUploadFolder !== "function"
      ) {
        logToFile(
          "sftpTransfer.handleUploadFolder is not available or not a function.",
          "ERROR",
        );
        return {
          success: false,
          error: "SFTP Upload feature not properly initialized.",
        };
      }

      const processInfo = childProcesses.get(tabId);
      if (
        !processInfo ||
        !processInfo.config ||
        !processInfo.process ||
        processInfo.type !== "ssh2"
      ) {
        logToFile(
          `Invalid or not ready SSH connection for tabId: ${tabId}`,
          "ERROR",
        );
        return { success: false, error: "无效或未就绪的SSH连接" };
      }

      const mainWindow =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!mainWindow) {
        logToFile("No main window available for dialog.", "ERROR");
        return { success: false, error: "无法显示对话框" };
      }

      // Open folder selection dialog
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "选择要上传的文件夹",
        properties: ["openDirectory"],
        buttonLabel: "上传文件夹",
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, cancelled: true, error: "用户取消上传" };
      }

      const localFolderPath = filePaths[0];

      try {
        // Call the refactored sftpTransfer function, now passing progressChannel
        return await sftpTransfer.handleUploadFolder(
          tabId,
          localFolderPath,
          targetFolder,
          progressChannel,
        );
      } catch (error) {
        logToFile(
          `Error in upload-folder IPC handler: ${error.message}`,
          "ERROR",
        );

        // 检查是否是由用户取消操作引起的错误
        const isCancelError =
          error.message?.includes("cancel") ||
          error.message?.includes("abort") ||
          error.message?.includes("用户取消") ||
          error.message?.includes("user cancelled");

        // 如果是取消操作，返回成功状态而非错误
        if (isCancelError) {
          logToFile(
            `Folder upload cancelled by user for tab ${tabId}, suppressing error display`,
            "INFO",
          );

          // 触发目录刷新
          if (sftpCore && typeof sftpCore.enqueueSftpOperation === "function") {
            try {
              // 异步刷新目录，不等待结果
              setTimeout(() => {
                sftpCore
                  .enqueueSftpOperation(
                    tabId,
                    async () => {
                      try {
                        logToFile(
                          `Refreshing directory listing for tab ${tabId} after cancel at path: ${targetFolder}`,
                          "INFO",
                        );
                        return { success: true, refreshed: true };
                      } catch (refreshError) {
                        logToFile(
                          `Error refreshing directory after cancel: ${refreshError.message}`,
                          "WARN",
                        );
                        return { success: false, error: refreshError.message };
                      }
                    },
                    {
                      type: "readdir",
                      path: targetFolder || ".",
                      priority: "high",
                      canMerge: true,
                    },
                  )
                  .catch((err) => {
                    logToFile(
                      `Failed to enqueue refresh operation: ${err.message}`,
                      "WARN",
                    );
                  });
              }, 500); // 延迟500ms执行刷新
            } catch (refreshError) {
              logToFile(
                `Error triggering directory refresh: ${refreshError.message}`,
                "WARN",
              );
            }
          }

          // 返回成功状态，表明这是用户取消操作
          return {
            success: true,
            cancelled: true,
            userCancelled: true,
            message: "用户已取消操作",
          };
        }

        // 其他类型的错误，正常返回错误信息
        return {
          success: false,
          error: `上传文件夹失败: ${error.message}`,
        };
      }
    },
  );

  // 添加检查路径是否存在的API
  safeHandle(ipcMain, "checkPathExists", async (event, checkPath) => {
    try {
      logToFile(`检查路径是否存在: ${checkPath}`, "INFO");
      const exists = fs.existsSync(checkPath);
      logToFile(`路径 ${checkPath} ${exists ? "存在" : "不存在"}`, "INFO");
      return exists;
    } catch (error) {
      logToFile(`检查路径出错: ${error.message}`, "ERROR");
      return false;
    }
  });

  // 添加在文件管理器中显示文件/文件夹的API
  safeHandle(ipcMain, "showItemInFolder", async (event, itemPath) => {
    try {
      logToFile(`尝试在文件管理器中显示: ${itemPath}`, "INFO");
      shell.showItemInFolder(itemPath);
      return true;
    } catch (error) {
      logToFile(`显示文件或文件夹失败: ${error.message}`, "ERROR");
      return false;
    }
  });

  // Note: Settings handlers (settings:loadUISettings, settings:saveUISettings, etc.)
  // are registered before window creation via SettingsHandlers

  // 获取标签页连接状态
  safeHandle(ipcMain, "connection:getTabStatus", async (event, tabId) => {
    try {
      if (!tabId || tabId === "welcome") {
        return { success: true, data: null };
      }

      // 检查是否有对应的进程信息
      const processInfo = childProcesses.get(tabId);

      if (!processInfo) {
        return { success: true, data: null };
      }

      // 根据进程类型返回连接状态
      if (processInfo.type === "ssh2") {
        const connectionState = {
          isConnected: processInfo.ready && !!processInfo.stream,
          isConnecting: !processInfo.ready,
          quality: processInfo.ready ? "excellent" : "offline",
          lastUpdate: Date.now(),
          connectionType: "SSH",
          host: processInfo.config?.host,
          port: processInfo.config?.port,
          username: processInfo.config?.username,
        };
        return { success: true, data: connectionState };
      } else if (processInfo.type === "powershell") {
        const connectionState = {
          isConnected: true,
          isConnecting: false,
          quality: "excellent",
          lastUpdate: Date.now(),
          connectionType: "Local",
          host: "localhost",
        };
        return { success: true, data: connectionState };
      } else if (processInfo.type === "telnet") {
        const connectionState = {
          isConnected: processInfo.ready && !!processInfo.process,
          isConnecting: !processInfo.ready,
          quality: processInfo.ready ? "good" : "offline",
          lastUpdate: Date.now(),
          connectionType: "Telnet",
          host: processInfo.config?.host,
          port: processInfo.config?.port,
        };
        return { success: true, data: connectionState };
      }

      return { success: true, data: null };
    } catch (error) {
      logToFile(`获取标签页连接状态失败: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // Note: Shortcut command handlers (get-shortcut-commands, save-shortcut-commands)
  // are registered before window creation via SettingsHandlers

  safeHandle(ipcMain, "downloadFolder", async (event, tabId, remotePath) => {
    if (
      !sftpTransfer ||
      typeof sftpTransfer.handleDownloadFolder !== "function"
    ) {
      logToFile(
        "sftpTransfer.handleDownloadFolder is not available or not a function.",
        "ERROR",
      );
      return {
        success: false,
        error: "SFTP Download feature not properly initialized.",
      };
    }
    // sftpTransfer.handleDownloadFolder signature is: async function handleDownloadFolder(tabId, remoteFolderPath)
    return sftpTransfer.handleDownloadFolder(tabId, remotePath);
  });

  // Note: Command history handlers (command-history:*) are registered
  // before window creation via SettingsHandlers

  // 添加IP地址查询API处理函数
  safeHandle(ipcMain, "ip:query", async (event, ip = "") => {
    try {
      // 获取默认代理配置以用于IP查询
      const proxyManager = require("./core/proxy/proxy-manager");
      const proxyConfig = proxyManager.getDefaultProxyConfig();
      return await ipQuery.queryIpAddress(ip, logToFile, proxyConfig);
    } catch (error) {
      logToFile(`IP地址查询失败: ${error.message}`, "ERROR");
      return {
        ret: "failed",
        msg: error.message,
      };
    }
  });

  // 新增：获取进程信息
  safeHandle(ipcMain, "terminal:getProcessInfo", async (event, processId) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo) {
      return null;
    }

    // 返回安全的进程信息副本，不包含敏感数据和不可序列化的对象
    return {
      type: procInfo.type || null,
      isRemote: procInfo.isRemote || false,
      editorMode: procInfo.editorMode || false,
      // 不返回process、stream等不可序列化的对象
    };
  });

  // SSH密钥生成器处理
  safeHandle(ipcMain, "generateSSHKeyPair", async (event, options) => {
    try {
      const crypto = require("crypto");
      const { generateKeyPair } = crypto;
      const util = require("util");
      const generateKeyPairAsync = util.promisify(generateKeyPair);

      const {
        type = "ed25519",
        bits = 256,
        comment = "",
        passphrase = "",
      } = options;

      let keyGenOptions = {};

      if (type === "rsa") {
        keyGenOptions = {
          modulusLength: bits,
          publicKeyEncoding: {
            type: "spki",
            format: "pem",
          },
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: passphrase ? "aes-256-cbc" : undefined,
            passphrase: passphrase || undefined,
          },
        };
      } else if (type === "ed25519") {
        keyGenOptions = {
          publicKeyEncoding: {
            type: "spki",
            format: "pem",
          },
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: passphrase ? "aes-256-cbc" : undefined,
            passphrase: passphrase || undefined,
          },
        };
      } else if (type === "ecdsa") {
        const namedCurve =
          bits === 256
            ? "prime256v1"
            : bits === 384
              ? "secp384r1"
              : "secp521r1";
        keyGenOptions = {
          namedCurve: namedCurve,
          publicKeyEncoding: {
            type: "spki",
            format: "pem",
          },
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: passphrase ? "aes-256-cbc" : undefined,
            passphrase: passphrase || undefined,
          },
        };
      }

      const { publicKey, privateKey } = await generateKeyPairAsync(
        type,
        keyGenOptions,
      );

      // 格式化公钥为SSH格式
      let sshPublicKey;
      if (type === "rsa") {
        // 简化的SSH RSA公钥格式（实际应用中需要更复杂的转换）
        const keyData = publicKey
          .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
          .replace(/\n?-----END PUBLIC KEY-----/, "")
          .replace(/\n/g, "");
        sshPublicKey = `ssh-rsa ${keyData} ${comment}`;
      } else if (type === "ed25519") {
        // 简化的SSH ED25519公钥格式
        const keyData = publicKey
          .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
          .replace(/\n?-----END PUBLIC KEY-----/, "")
          .replace(/\n/g, "");
        sshPublicKey = `ssh-ed25519 ${keyData} ${comment}`;
      } else {
        // ECDSA格式
        const keyData = publicKey
          .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
          .replace(/\n?-----END PUBLIC KEY-----/, "")
          .replace(/\n/g, "");
        const curveType =
          bits === 256
            ? "ecdsa-sha2-nistp256"
            : bits === 384
              ? "ecdsa-sha2-nistp384"
              : "ecdsa-sha2-nistp521";
        sshPublicKey = `${curveType} ${keyData} ${comment}`;
      }

      return {
        success: true,
        publicKey: sshPublicKey.trim(),
        privateKey: privateKey,
      };
    } catch (error) {
      logToFile(`SSH key generation failed: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 保存SSH密钥到文件
  safeHandle(ipcMain, "saveSSHKey", async (event, options) => {
    try {
      const { content, filename } = options;

      const result = await dialog.showSaveDialog({
        defaultPath: filename,
        filters: [
          { name: "SSH Key Files", extensions: ["pub", "pem", "key"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!result.canceled && result.filePath) {
        await fs.promises.writeFile(result.filePath, content, "utf8");
        return { success: true };
      }

      return { success: false, error: "User cancelled" };
    } catch (error) {
      logToFile(`Save SSH key failed: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 发送输入到进程
  ipcMain.on("terminal:sendInput", (event, { processId, input }) => {
    const processInfo = childProcesses.get(processId);
    if (!processInfo) {
      logToFile(`Process not found: ${processId}`, "ERROR");
      return;
    }

    try {
      if (processInfo.type === "node-pty") {
        processInfo.process.write(input);
      } else if (processInfo.type === "ssh2" && processInfo.stream) {
        processInfo.stream.write(input);
      } else if (processInfo.type === "telnet" && processInfo.process) {
        // 对于Telnet连接，使用shell方法发送数据
        processInfo.process.shell((err, stream) => {
          if (err) {
            logToFile(`Error getting telnet shell: ${err.message}`, "ERROR");
            return;
          }
          stream.write(input);
        });
      } else {
        logToFile(
          `Invalid process type or stream for input: ${processId}`,
          "ERROR",
        );
      }
    } catch (error) {
      logToFile(
        `Error sending input to process ${processId}: ${error.message}`,
        "ERROR",
      );
    }
  });

  logToFile("setupIPC completed successfully", "INFO");
} // Closing brace for setupIPC function
