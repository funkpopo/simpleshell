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
const configManager = require("./core/configManager");
const sftpCore = require("./modules/sftp/sftpCore");
const sftpTransfer = require("./modules/sftp/sftpTransfer");
const systemInfo = require("./modules/system-info");
const terminalManager = require("./modules/terminal");
const commandHistoryService = require("./modules/terminal/command-history");
const fileCache = require("./core/utils/fileCache");
const connectionManager = require("./modules/connection");

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
          callback.reject(error);
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
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: iconPath, // 使用环境相关的图标路径
  });

  // 隐藏菜单栏
  mainWindow.setMenuBarVisibility(false);

  // 加载应用 URL
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // 开发工具自动打开
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  // 注册IPC通信
  setupIPC(mainWindow);
};

// 在应用准备好时创建窗口并初始化配置
app.whenReady().then(() => {
  initLogger(app); // 初始化日志模块
  // Inject dependencies into configManager
  configManager.init(app, { logToFile }, require("./core/utils/crypto"));
  configManager.initializeMainConfig(); // 初始化主配置文件

  // 加载日志配置并更新日志模块
  const logSettings = configManager.loadLogSettings();
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
    (channel, ...args) => {
      // sendToRendererFunction
      const mainWindow = BrowserWindow.getAllWindows()[0]; // Assuming single main window
      if (
        mainWindow &&
        mainWindow.webContents &&
        !mainWindow.webContents.isDestroyed()
      ) {
        mainWindow.webContents.send(channel, ...args);
      }
    },
  );

  // Initialize file cache module
  fileCache.init(logToFile, app);
  fileCache.startPeriodicCleanup(); // 启动定期清理

  // Initialize connection manager
  connectionManager.initialize();

  createWindow();
  createAIWorker();

  // 初始化命令历史服务
  try {
    const commandHistory = configManager.loadCommandHistory();
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
app.on("before-quit", () => {
  // 移除所有事件监听器和子进程
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
  fileCache
    .cleanupAllCaches()
    .then((cleanedCount) => {
      logToFile(`Cleaned up ${cleanedCount} cache files on app quit`, "INFO");
    })
    .catch((error) => {
      logToFile(
        `Failed to cleanup cache files on quit: ${error.message}`,
        "ERROR",
      );
    });

  // 保存命令历史
  try {
    const historyToSave = commandHistoryService.exportHistory();
    configManager.saveCommandHistory(historyToSave);
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

  // Save top connections
  try {
    const topConnections = connectionManager.getTopConnections(5);
    if (topConnections && topConnections.length > 0) {
      configManager.saveTopConnections(topConnections);
      logToFile(`Saved ${topConnections.length} top connections on app quit`, "INFO");
    }
  } catch (error) {
    logToFile(`Failed to save top connections on quit: ${error.message}`, "ERROR");
  }
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
  // 启动PowerShell进程
  ipcMain.handle("terminal:startPowerShell", async () => {
    const processId = nextProcessId++;

    // 获取PowerShell路径
    const powershellPath =
      process.platform === "win32" ? "powershell.exe" : "pwsh";

    try {
      // 启动PowerShell进程
      const ps = spawn(powershellPath, ["-NoLogo"], {
        env: process.env,
        cwd: process.env.USERPROFILE || process.env.HOME,
      });

      // 存储进程信息
      childProcesses.set(processId, {
        process: ps,
        listeners: new Set(),
        editorMode: false, // 初始化编辑器模式为false
        commandBuffer: "", // 初始化命令缓冲区
      });

      // 处理PowerShell输出
      ps.stdout.on("data", (data) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            const output = data.toString();
            // 处理输出以检测编辑器退出
            const processedOutput = terminalManager.processOutput(
              processId,
              output,
            );
            mainWindow.webContents.send(
              `process:output:${processId}`,
              processedOutput,
            );
          }
        } catch (error) {
          logToFile(`Error handling stdout data: ${error.message}`, "ERROR");
        }
      });

      ps.stderr.on("data", (data) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            const output = data.toString();
            // 处理输出以检测编辑器退出
            const processedOutput = terminalManager.processOutput(
              processId,
              output,
            );
            mainWindow.webContents.send(
              `process:output:${processId}`,
              processedOutput,
            );
          }
        } catch (error) {
          logToFile(`Error handling stderr data: ${error.message}`, "ERROR");
        }
      });

      // 处理进程退出
      ps.on("exit", (code) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\nProcess exited with code ${code || 0}\r\n`,
            );
          }
          // 清理与此进程相关的待处理SFTP操作
          if (
            sftpCore &&
            typeof sftpCore.clearPendingOperationsForTab === "function"
          ) {
            sftpCore.clearPendingOperationsForTab(processId);
          }
          childProcesses.delete(processId);
        } catch (error) {
          logToFile(`Error handling process exit: ${error.message}`, "ERROR");
        }
      });

      // 处理进程错误
      ps.on("error", (err) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\nProcess error: ${err.message}\r\n`,
            );
          }
          // 清理与此进程相关的待处理SFTP操作
          if (
            sftpCore &&
            typeof sftpCore.clearPendingOperationsForTab === "function"
          ) {
            sftpCore.clearPendingOperationsForTab(processId);
          }
          childProcesses.delete(processId);
        } catch (error) {
          logToFile(`Error handling process error: ${error.message}`, "ERROR");
        }
      });

      return processId;
    } catch (error) {
      logToFile(`Failed to start PowerShell: ${error.message}`, "ERROR");
      throw error;
    }
  });

  // 启动SSH连接
  ipcMain.handle("terminal:startSSH", async (event, sshConfig) => {
    const processId = nextProcessId++;

    if (!sshConfig || !sshConfig.host) {
      logToFile("Invalid SSH configuration", "ERROR");
      throw new Error("Invalid SSH configuration");
    }

    try {
      // 使用连接池获取SSH连接
      const connectionInfo =
        await connectionManager.getSSHConnection(sshConfig);
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
          const output = buffer.toString("utf8");
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
  ipcMain.handle("terminal:sendToProcess", async (event, processId, data) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo || !procInfo.process) {
      return false;
    }

    try {
      // 确保退格键字符正确转换
      let processedData = data;
      // 对特殊情况的处理（如果需要）

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

          // 清空命令缓冲区
          procInfo.commandBuffer = "";
        }
      } else if (data === "\u0003") {
        // Ctrl+C
        // 清空命令缓冲区
        procInfo.commandBuffer = "";

        // 如果在编辑器模式，可能是用户中断了编辑
        if (procInfo.editorMode) {
          // 为部分编辑器，Ctrl+C会导致退出
          setTimeout(() => {
            procInfo.possibleEditorExit = true;
            // 设置一个较长的检测时间，在下一个提示符出现时确认退出
            setTimeout(() => {
              if (procInfo.possibleEditorExit) {
                procInfo.editorMode = false;
                procInfo.possibleEditorExit = false;
              }
            }, 1000);
          }, 200);
        }
      } else if (data === "\u007F" || data === "\b") {
        // 退格键
        // 从缓冲区中删除最后一个字符
        if (procInfo.commandBuffer && procInfo.commandBuffer.length > 0) {
          procInfo.commandBuffer = procInfo.commandBuffer.slice(0, -1);
        }
      } else if (data === "\u001B" && procInfo.editorMode) {
        // ESC键，在编辑器模式下可能表示模式切换
        // 在vi/vim中，ESC会从插入模式返回到命令模式，但不退出编辑器
        // 仅记录这个键，不做特殊处理
        if (!procInfo.commandBuffer) procInfo.commandBuffer = "";
        procInfo.commandBuffer += data;
      } else {
        // 将字符添加到命令缓冲区
        if (!procInfo.commandBuffer) procInfo.commandBuffer = "";
        procInfo.commandBuffer += data;
      }

      // 根据进程类型选择不同的写入方式
      if (procInfo.type === "ssh2") {
        // SSH2连接使用保存的流对象写入数据
        if (procInfo.stream) {
          procInfo.stream.write(processedData);
          return true;
        } else {
          logToFile("SSH2 stream not available", "ERROR");
          return false;
        }
      } else if (typeof procInfo.process.write === "function") {
        // node-pty进程直接调用write方法
        procInfo.process.write(processedData);
        return true;
      } else if (procInfo.process.stdin) {
        // 标准子进程使用stdin
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
  ipcMain.handle("terminal:killProcess", async (event, processId) => {
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
  ipcMain.handle(
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

  // 加载连接配置
  ipcMain.handle("terminal:loadConnections", async () => {
    return configManager.loadConnections();
  });

  // 保存连接配置
  ipcMain.handle("terminal:saveConnections", async (event, connections) => {
    return configManager.saveConnections(connections);
  });

  // Load top connections
  ipcMain.handle("terminal:loadTopConnections", async () => {
    return configManager.loadTopConnections();
  });

  // 选择密钥文件
  ipcMain.handle("terminal:selectKeyFile", async () => {
    return selectKeyFile();
  });

  // 获取应用版本号
  ipcMain.handle("app:getVersion", async () => {
    return app.getVersion();
  });

  // 关闭应用
  ipcMain.handle("app:close", async () => {
    app.quit();
    return true;
  });

  // 重新加载窗口
  ipcMain.handle("app:reloadWindow", async () => {
    mainWindow.reload();
    return true;
  });

  // 在外部浏览器打开链接
  ipcMain.handle("app:openExternal", async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      logToFile(`Failed to open external link: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 检查更新
  ipcMain.handle("app:checkForUpdate", async () => {
    try {
      const https = require("https");

      // 创建一个Promise来处理HTTPS请求
      const fetchGitHubRelease = () => {
        return new Promise((resolve, reject) => {
          const options = {
            hostname: "api.github.com",
            path: "/repos/funkpopo/simpleshell/releases/latest",
            method: "GET",
            headers: {
              "User-Agent": "SimpleShell-App",
            },
          };

          const req = https.request(options, (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`GitHub API返回错误状态码: ${res.statusCode}`));
              return;
            }

            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
            });

            res.on("end", () => {
              try {
                const releaseData = JSON.parse(data);
                resolve(releaseData);
              } catch (error) {
                reject(new Error(`解析GitHub API响应失败: ${error.message}`));
              }
            });
          });

          req.on("error", (error) => {
            reject(new Error(`请求GitHub API失败: ${error.message}`));
          });

          req.end();
        });
      };

      const releaseData = await fetchGitHubRelease();
      return {
        success: true,
        data: releaseData,
      };
    } catch (error) {
      logToFile(`检查更新失败: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 处理简单的命令
  ipcMain.handle("terminal:command", async (event, command) => {
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
  ipcMain.handle("terminal:resize", async (event, processId, cols, rows) => {
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

  // 获取系统资源信息
  ipcMain.handle("terminal:getSystemInfo", async (event, processId) => {
    try {
      // 只有当提供了有效的进程ID且该进程存在于childProcesses映射中时才获取远程系统信息
      if (!processId || !childProcesses.has(processId)) {
        return systemInfo.getLocalSystemInfo();
      } else {
        // SSH远程系统信息
        const processObj = childProcesses.get(processId);

        // 支持多种SSH客户端类型
        if (
          (processObj.type === "ssh2" || processObj.type === "ssh") &&
          (processObj.process || processObj.client || processObj.channel)
        ) {
          const sshClient =
            processObj.client || processObj.process || processObj.channel;
          return systemInfo.getRemoteSystemInfo(sshClient); // This might be another issue for later
        } else {
          return systemInfo.getLocalSystemInfo();
        }
      }
    } catch (error) {
      logToFile(`Failed to get system info: ${error.message}`, "ERROR");
      return {
        error: "获取系统信息失败",
        message: error.message,
      };
    }
  });

  // 获取进程列表
  ipcMain.handle("terminal:getProcessList", async (event, processId) => {
    try {
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
          return systemInfo.getRemoteProcessList(sshClient);
        } else {
          return systemInfo.getProcessList();
        }
      }
    } catch (error) {
      logToFile(`Failed to get process list: ${error.message}`, "ERROR");
      return {
        error: "获取进程列表失败",
        message: error.message,
      };
    }
  });

  // AI设置相关IPC处理
  ipcMain.handle("ai:loadSettings", async () => {
    return configManager.loadAISettings();
  });

  ipcMain.handle("ai:saveSettings", async (event, settings) => {
    return configManager.saveAISettings(settings);
  });

  // 新增: 处理API配置的IPC方法
  ipcMain.handle("ai:saveApiConfig", async (event, config) => {
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
      const settings = configManager.loadAISettings();
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
      return configManager.saveAISettings(settings);
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to save API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      return false;
    }
  });

  ipcMain.handle("ai:deleteApiConfig", async (event, configId) => {
    try {
      const settings = configManager.loadAISettings();
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
        return configManager.saveAISettings(settings);
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

  ipcMain.handle("ai:setCurrentApiConfig", async (event, configId) => {
    try {
      if (logToFile)
        logToFile(
          `Setting current API config with ID (via main.js IPC): ${configId}`,
          "INFO",
        );
      const settings = configManager.loadAISettings();
      if (!settings.configs) settings.configs = [];
      const selectedConfig = settings.configs.find((c) => c.id === configId);
      if (selectedConfig) {
        settings.current = { ...selectedConfig };
        return configManager.saveAISettings(settings);
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

  ipcMain.handle("ai:sendPrompt", async (event, prompt, settings) => {
    try {
      return await configManager.sendAIPrompt(prompt, settings);
    } catch (error) {
      logToFile(`Error sending AI prompt: ${error.message}`, "ERROR");
      return { error: error.message || "发送请求时出错" };
    }
  });

  // 通过Worker线程处理API请求，绕过CORS限制
  ipcMain.handle("ai:sendAPIRequest", async (event, requestData, isStream) => {
    try {
      // 验证请求数据
      if (
        !requestData.url ||
        !requestData.apiKey ||
        !requestData.model ||
        !requestData.messages
      ) {
        throw new Error("请求数据无效，缺少必要参数");
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
  ipcMain.handle("ai:abortAPIRequest", async (event) => {
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

  // 文件管理相关API
  ipcMain.handle("listFiles", async (event, tabId, path, options = {}) => {
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
                  permissions: item.attrs.mode,
                }));

                resolve({ success: true, data: files });
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

  ipcMain.handle("copyFile", async (event, tabId, sourcePath, targetPath) => {
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

  ipcMain.handle("moveFile", async (event, tabId, sourcePath, targetPath) => {
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

  ipcMain.handle("deleteFile", async (event, tabId, filePath, isDirectory) => {
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
  ipcMain.handle("createFolder", async (event, tabId, folderPath) => {
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
  ipcMain.handle("createFile", async (event, tabId, filePath) => {
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

  ipcMain.handle("downloadFile", async (event, tabId, remotePath) => {
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

  // Handle SFTP Upload File
  ipcMain.handle(
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

  ipcMain.handle("renameFile", async (event, tabId, oldPath, newName) => {
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

  ipcMain.handle("getAbsolutePath", async (event, tabId, relativePath) => {
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
  ipcMain.handle("cancelTransfer", async (event, tabId, transferKey) => {
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
  ipcMain.handle("getSftpSession", async (event, tabId) => {
    try {
      return sftpCore.getSftpSession(tabId);
    } catch (error) {
      logToFile(`Error getting SFTP session: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 处理 SFTP 操作队列
  ipcMain.handle("enqueueSftpOperation", async (event, tabId, operation) => {
    try {
      return sftpCore.enqueueSftpOperation(tabId, operation);
    } catch (error) {
      logToFile(`Error enqueuing SFTP operation: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 处理队列中的 SFTP 操作
  ipcMain.handle("processSftpQueue", async (event, tabId) => {
    try {
      return sftpCore.processSftpQueue(tabId);
    } catch (error) {
      logToFile(`Error processing SFTP queue: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 读取文件内容，返回文本
  ipcMain.handle("readFileContent", async (event, tabId, filePath) => {
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
  ipcMain.handle("readFileAsBase64", async (event, tabId, filePath) => {
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
  ipcMain.handle("cleanupFileCache", async (event, cacheFilePath) => {
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
  ipcMain.handle("cleanupTabCache", async (event, tabId) => {
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
  ipcMain.handle("saveFileContent", async (event, tabId, filePath, content) => {
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
  ipcMain.handle(
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
  ipcMain.handle("checkPathExists", async (event, checkPath) => {
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
  ipcMain.handle("showItemInFolder", async (event, itemPath) => {
    try {
      logToFile(`尝试在文件管理器中显示: ${itemPath}`, "INFO");
      shell.showItemInFolder(itemPath);
      return true;
    } catch (error) {
      logToFile(`显示文件或文件夹失败: ${error.message}`, "ERROR");
      return false;
    }
  });

  // UI设置相关API
  ipcMain.handle("settings:loadUISettings", async () => {
    return await configManager.loadUISettings(); // loadUISettings in configManager is not async, but IPC handler can be
  });

  ipcMain.handle("settings:saveUISettings", async (event, settings) => {
    return await configManager.saveUISettings(settings); // saveUISettings in configManager is not async
  });

  // 日志设置相关API
  ipcMain.handle("settings:loadLogSettings", async () => {
    return await configManager.loadLogSettings();
  });

  ipcMain.handle("settings:saveLogSettings", async (event, settings) => {
    const saved = await configManager.saveLogSettings(settings);
    if (saved) {
      // 更新当前运行的日志系统配置
      updateLogConfig(settings);
    }
    return saved;
  });

  // 性能设置实时更新API
  ipcMain.handle("settings:updateCacheSettings", async (event, settings) => {
    try {
      // 这里可以实时更新缓存设置
      logToFile(`缓存设置已更新: ${JSON.stringify(settings)}`, "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`更新缓存设置失败: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("settings:updatePrefetchSettings", async (event, settings) => {
    try {
      // 这里可以实时更新预取设置
      logToFile(`预取设置已更新: ${JSON.stringify(settings)}`, "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`更新预取设置失败: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 获取快捷命令
  ipcMain.handle("get-shortcut-commands", async () => {
    try {
      const data = configManager.loadShortcutCommands();
      return { success: true, data };
    } catch (error) {
      if (logToFile)
        logToFile(
          `Error in get-shortcut-commands (IPC): ${error.message}`,
          "ERROR",
        );
      return { success: false, error: error.message };
    }
  });

  // 保存快捷命令
  ipcMain.handle("save-shortcut-commands", async (_, data) => {
    try {
      const result = configManager.saveShortcutCommands(data);
      return {
        success: result,
        error: result ? null : "Failed to save shortcut commands (IPC)",
      };
    } catch (error) {
      if (logToFile)
        logToFile(
          `Error in save-shortcut-commands (IPC): ${error.message}`,
          "ERROR",
        );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("downloadFolder", async (event, tabId, remotePath) => {
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

  // 命令历史相关API
  ipcMain.handle("command-history:add", async (event, command) => {
    try {
      const added = commandHistoryService.addCommand(command);
      if (added) {
        // 异步保存到配置文件
        setTimeout(() => {
          try {
            const historyToSave = commandHistoryService.exportHistory();
            configManager.saveCommandHistory(historyToSave);
          } catch (saveError) {
            logToFile(
              `Failed to save command history: ${saveError.message}`,
              "ERROR",
            );
          }
        }, 1000); // 延迟1秒保存，避免频繁写入
      }
      return { success: added };
    } catch (error) {
      logToFile(`Error adding command to history: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    "command-history:getSuggestions",
    async (event, input, maxResults = 10) => {
      try {
        const suggestions = commandHistoryService.getSuggestions(
          input,
          maxResults,
        );
        return { success: true, suggestions };
      } catch (error) {
        logToFile(
          `Error getting command suggestions: ${error.message}`,
          "ERROR",
        );
        return { success: false, error: error.message, suggestions: [] };
      }
    },
  );

  ipcMain.handle("command-history:incrementUsage", async (event, command) => {
    try {
      commandHistoryService.incrementCommandUsage(command);
      return { success: true };
    } catch (error) {
      logToFile(`Error incrementing command usage: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("command-history:clear", async (event) => {
    try {
      commandHistoryService.clearHistory();
      configManager.saveCommandHistory([]);
      return { success: true };
    } catch (error) {
      logToFile(`Error clearing command history: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("command-history:getStatistics", async (event) => {
    try {
      const stats = commandHistoryService.getStatistics();
      return { success: true, statistics: stats };
    } catch (error) {
      logToFile(
        `Error getting command history statistics: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message, statistics: null };
    }
  });

  // 新增：获取所有历史命令
  ipcMain.handle("command-history:getAll", async (event) => {
    try {
      const history = commandHistoryService.getAllHistory();
      return { success: true, data: history };
    } catch (error) {
      logToFile(`Error getting all command history: ${error.message}`, "ERROR");
      return { success: false, error: error.message, data: [] };
    }
  });

  // 新增：删除单个历史命令
  ipcMain.handle("command-history:delete", async (event, command) => {
    try {
      commandHistoryService.removeCommand(command);
      // 保存到配置文件
      const historyToSave = commandHistoryService.exportHistory();
      configManager.saveCommandHistory(historyToSave);
      return { success: true };
    } catch (error) {
      logToFile(
        `Error deleting command from history: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  });

  // 新增：批量删除历史命令
  ipcMain.handle("command-history:deleteBatch", async (event, commands) => {
    try {
      if (!Array.isArray(commands)) {
        throw new Error("Commands must be an array");
      }

      commands.forEach((command) => {
        commandHistoryService.removeCommand(command);
      });

      // 保存到配置文件
      const historyToSave = commandHistoryService.exportHistory();
      configManager.saveCommandHistory(historyToSave);

      return { success: true };
    } catch (error) {
      logToFile(
        `Error batch deleting commands from history: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  });

  // 添加IP地址查询API处理函数
  ipcMain.handle("ip:query", async (event, ip = "") => {
    try {
      return await ipQuery.queryIpAddress(ip, logToFile);
    } catch (error) {
      logToFile(`IP地址查询失败: ${error.message}`, "ERROR");
      return {
        ret: "failed",
        msg: error.message,
      };
    }
  });
} // Closing brace for setupIPC function
