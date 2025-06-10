const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const Client = require("ssh2").Client;
const os = require("os");
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

// 保存全局事件对象，用于流式响应
let globalEvent = null;

// 用于保存流式请求的引用，以便取消
let activeAPIRequest = null;

// 跟踪当前活跃的会话ID
let currentSessionId = null;

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
    // 创建worker实例
    aiWorker = new Worker(workerPath);

    // 监听worker线程的消息
    aiWorker.on("message", (message) => {
      const { id, result, error } = message;
      // 查找对应的请求处理函数
      const callback = aiRequestMap.get(id);
      if (callback) {
        if (error) {
          callback.reject(error);
        } else {
          callback.resolve(result);
        }
        // 处理完成后从Map中移除
        aiRequestMap.delete(id);
      }
    });

    // 处理worker错误
    aiWorker.on("error", (error) => {
      // 向所有待处理的请求返回错误
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(
          new Error("AI Worker encountered an error: " + error.message),
        );
        aiRequestMap.delete(id);
      }
    });

    // 处理worker退出
    aiWorker.on("exit", (code) => {
      // 如果退出码不是正常退出(0)，尝试重启worker
      if (code !== 0) {
        setTimeout(() => {
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
    });

    return aiWorker;
  } catch (error) {
    return null;
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

      if (proc.process) {
        // 移除所有事件监听器
        if (proc.process.stdout) {
          proc.process.stdout.removeAllListeners();
        }
        if (proc.process.stderr) {
          proc.process.stderr.removeAllListeners();
        }

        // 终止进程
        try {
          if (typeof proc.process.kill === "function") {
            // 正常终止进程
            proc.process.kill();
          }
        } catch (error) {
          logToFile(`Error killing process ${id}: ${error.message}`, "ERROR");
        }
      }
    } catch (error) {
      logToFile(`Error cleaning up process ${id}: ${error.message}`, "ERROR");
    }
  }
  // 清空进程映射
  childProcesses.clear();

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

    return new Promise((resolve, reject) => {
      try {
        // 创建SSH2客户端连接
        const ssh = new Client();

        // 存储进程信息 - 这里保存ssh客户端实例
        childProcesses.set(processId, {
          process: ssh,
          listeners: new Set(),
          config: sshConfig,
          type: "ssh2",
          ready: false, // 标记SSH连接状态，默认为未就绪
          editorMode: false, // 初始化编辑器模式为false
          commandBuffer: "", // 初始化命令缓冲区
          lastOutputLines: [], // 存储最近的终端输出行，用于提取远程命令
          outputBuffer: "", // 用于存储当前未处理完的输出
          isRemote: true, // 标记为远程SSH会话
        });

        // 存储相同的SSH客户端，使用tabId（通常是形如'ssh-timestamp'的标识符）
        if (sshConfig.tabId) {
          childProcesses.set(sshConfig.tabId, {
            process: ssh,
            listeners: new Set(),
            config: sshConfig,
            type: "ssh2",
            ready: false, // 标记SSH连接状态，默认为未就绪
            editorMode: false, // 初始化编辑器模式为false
            commandBuffer: "", // 初始化命令缓冲区
            lastOutputLines: [], // 存储最近的终端输出行，用于提取远程命令
            outputBuffer: "", // 用于存储当前未处理完的输出
            isRemote: true, // 标记为远程SSH会话
          });
        }

        // 设置连接超时定时器
        const connectionTimeout = setTimeout(() => {
          logToFile("SSH connection timed out after 15 seconds", "ERROR");
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n连接超时，请检查网络和服务器状态\r\n`,
            );
          }
          // 不主动断开连接，让用户决定是否关闭
        }, 15000);

        let connectionTimeoutRejected = false;

        // 监听就绪事件
        ssh.on("ready", () => {
          // 清除超时定时器
          clearTimeout(connectionTimeout);

          // 标记SSH连接为就绪状态
          const procInfo = childProcesses.get(processId);
          if (procInfo) {
            procInfo.ready = true;
          }

          // 同时更新tabId对应的连接状态
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
              term: "xterm-256color", // 使用更高级的终端类型
              cols: 120, // 设置更宽的初始终端列数
              rows: 30, // 设置初始终端行数
            },
            (err, stream) => {
              if (err) {
                logToFile(
                  `SSH shell error for processId ${processId}: ${err.message}`,
                  "ERROR",
                );
                // 清理与此进程相关的待处理SFTP操作
                if (
                  sftpCore &&
                  typeof sftpCore.clearPendingOperationsForTab === "function"
                ) {
                  sftpCore.clearPendingOperationsForTab(processId);
                  if (sshConfig && sshConfig.tabId)
                    sftpCore.clearPendingOperationsForTab(sshConfig.tabId);
                }
                childProcesses.delete(processId);
                if (sshConfig && sshConfig.tabId)
                  childProcesses.delete(sshConfig.tabId);
                try {
                  ssh.end();
                } catch (e) {
                  /* ignore */
                }
                return reject(err);
              }

              const procToUpdate = childProcesses.get(processId);
              if (procToUpdate) {
                procToUpdate.stream = stream;
              }

              // 监听数据事件 - 使用Buffer拼接确保UTF-8字符完整
              let buffer = Buffer.from([]);

              stream.on("data", (data) => {
                try {
                  // 拼接数据到缓冲区
                  buffer = Buffer.concat([buffer, data]);

                  // 尝试将缓冲区转换为UTF-8字符串
                  try {
                    const output = buffer.toString("utf8");

                    // 处理输出以检测编辑器退出
                    const processedOutput = terminalManager.processOutput(
                      processId,
                      output,
                    );

                    // 发送到前端
                    if (mainWindow && !mainWindow.isDestroyed()) {
                      mainWindow.webContents.send(
                        `process:output:${processId}`,
                        processedOutput,
                      );
                    }

                    // 重置缓冲区
                    buffer = Buffer.from([]);
                  } catch (error) {
                    // 如果转换失败，说明可能是不完整的UTF-8序列，保留缓冲区继续等待
                    logToFile(
                      `Failed to convert buffer to string: ${error.message}`,
                      "ERROR",
                    );
                  }
                } catch (error) {
                  logToFile(
                    `Error handling stream data: ${error.message}`,
                    "ERROR",
                  );
                }
              });

              // 监听扩展数据（通常是错误消息）
              stream.on("extended data", (data, type) => {
                try {
                  // type为1时表示stderr数据
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(
                      `process:output:${processId}`,
                      `\x1b[31m${data.toString("utf8")}\x1b[0m`,
                    );
                  }
                } catch (error) {
                  logToFile(
                    `Error handling extended data: ${error.message}`,
                    "ERROR",
                  );
                }
              });

              // 监听关闭事件
              stream.on("close", () => {
                logToFile(
                  `SSH stream closed for processId: ${processId}`,
                  "INFO",
                );

                // 向前端发送SSH断开连接的通知（如果连接已经建立）
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

                // 添加: 清理与此SSH连接相关的活跃SFTP传输
                if (
                  sftpTransfer &&
                  typeof sftpTransfer.cleanupActiveTransfersForTab ===
                    "function"
                ) {
                  try {
                    sftpTransfer
                      .cleanupActiveTransfersForTab(processId)
                      .then((result) => {
                        if (result.cleanedCount > 0) {
                          logToFile(
                            `Cleaned up ${result.cleanedCount} active SFTP transfers for processId ${processId} on stream close`,
                            "INFO",
                          );
                        }
                      })
                      .catch((err) => {
                        logToFile(
                          `Error cleaning up SFTP transfers for processId ${processId} on stream close: ${err.message}`,
                          "ERROR",
                        );
                      });

                    // 如果有tabId，也清理tabId相关的传输
                    if (
                      sshConfig &&
                      sshConfig.tabId &&
                      sshConfig.tabId !== processId
                    ) {
                      sftpTransfer
                        .cleanupActiveTransfersForTab(sshConfig.tabId)
                        .then((result) => {
                          if (result.cleanedCount > 0) {
                            logToFile(
                              `Cleaned up ${result.cleanedCount} active SFTP transfers for tabId ${sshConfig.tabId} on stream close`,
                              "INFO",
                            );
                          }
                        })
                        .catch((err) => {
                          logToFile(
                            `Error cleaning up SFTP transfers for tabId ${sshConfig.tabId} on stream close: ${err.message}`,
                            "ERROR",
                          );
                        });
                    }
                  } catch (cleanupError) {
                    logToFile(
                      `Error initiating SFTP transfer cleanup for processId ${processId} on stream close: ${cleanupError.message}`,
                      "ERROR",
                    );
                  }
                }

                // 清理与此进程相关的待处理SFTP操作
                if (
                  sftpCore &&
                  typeof sftpCore.clearPendingOperationsForTab === "function"
                ) {
                  sftpCore.clearPendingOperationsForTab(processId);
                  if (sshConfig && sshConfig.tabId)
                    sftpCore.clearPendingOperationsForTab(sshConfig.tabId);
                }
                childProcesses.delete(processId);
                if (sshConfig && sshConfig.tabId)
                  childProcesses.delete(sshConfig.tabId);
                try {
                  ssh.end();
                } catch (e) {
                  /* ignore */
                }
                // Resolve promise when stream closes after setup, only if not already rejected by connection timeout
                if (!connectionTimeoutRejected) {
                  resolve(processId);
                }
              });
            },
          );
        });

        // 监听错误事件
        ssh.on("error", (err) => {
          logToFile(
            `SSH connection error for processId ${processId}: ${err.message}`,
            "ERROR",
          );
          clearTimeout(connectionTimeout);
          // 清理与此进程相关的待处理SFTP操作
          if (
            sftpCore &&
            typeof sftpCore.clearPendingOperationsForTab === "function"
          ) {
            sftpCore.clearPendingOperationsForTab(processId);
            if (sshConfig && sshConfig.tabId)
              sftpCore.clearPendingOperationsForTab(sshConfig.tabId);
          }
          childProcesses.delete(processId);
          if (sshConfig && sshConfig.tabId)
            childProcesses.delete(sshConfig.tabId);
          try {
            // ssh.end(); // ssh might be in a bad state, end() might throw or hang.
          } catch (e) {
            /* ignore */
          }
          if (!connectionTimeoutRejected) {
            // Avoid double rejection
            reject(err);
          }
        });

        // 监听关闭事件
        ssh.on("close", () => {
          logToFile(
            `SSH connection closed for processId: ${processId}`,
            "INFO",
          );
          clearTimeout(connectionTimeout); // Clear timeout on successful close

          // 向前端发送SSH断开连接的通知
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n\x1b[33m*** SSH连接已断开 ***\x1b[0m\r\n`,
            );
          }

          // 添加: 清理与此SSH连接相关的活跃SFTP传输
          if (
            sftpTransfer &&
            typeof sftpTransfer.cleanupActiveTransfersForTab === "function"
          ) {
            try {
              sftpTransfer
                .cleanupActiveTransfersForTab(processId)
                .then((result) => {
                  if (result.cleanedCount > 0) {
                    logToFile(
                      `Cleaned up ${result.cleanedCount} active SFTP transfers for processId ${processId} on SSH close`,
                      "INFO",
                    );
                  }
                })
                .catch((err) => {
                  logToFile(
                    `Error cleaning up SFTP transfers for processId ${processId} on SSH close: ${err.message}`,
                    "ERROR",
                  );
                });

              // 如果有tabId，也清理tabId相关的传输
              if (
                sshConfig &&
                sshConfig.tabId &&
                sshConfig.tabId !== processId
              ) {
                sftpTransfer
                  .cleanupActiveTransfersForTab(sshConfig.tabId)
                  .then((result) => {
                    if (result.cleanedCount > 0) {
                      logToFile(
                        `Cleaned up ${result.cleanedCount} active SFTP transfers for tabId ${sshConfig.tabId} on SSH close`,
                        "INFO",
                      );
                    }
                  })
                  .catch((err) => {
                    logToFile(
                      `Error cleaning up SFTP transfers for tabId ${sshConfig.tabId} on SSH close: ${err.message}`,
                      "ERROR",
                    );
                  });
              }
            } catch (cleanupError) {
              logToFile(
                `Error initiating SFTP transfer cleanup for processId ${processId} on SSH close: ${cleanupError.message}`,
                "ERROR",
              );
            }
          }

          // 通常 stream.on('close') 会先处理清理，但作为双重保险或处理未成功建立shell的情况
          if (
            sftpCore &&
            typeof sftpCore.clearPendingOperationsForTab === "function"
          ) {
            sftpCore.clearPendingOperationsForTab(processId);
            if (sshConfig && sshConfig.tabId)
              sftpCore.clearPendingOperationsForTab(sshConfig.tabId);
          }

          childProcesses.delete(processId);
          if (sshConfig && sshConfig.tabId)
            childProcesses.delete(sshConfig.tabId);
          // No reject here as it's a normal close, resolve might have happened on stream ready/close
        });

        // 监听键盘交互事件（用于处理密码认证）
        ssh.on(
          "keyboard-interactive",
          (name, instructions, lang, prompts, finish) => {
            if (
              prompts.length > 0 &&
              prompts[0].prompt.toLowerCase().includes("password")
            ) {
              finish([sshConfig.password || ""]);
            } else {
              finish([]);
            }
          },
        );

        // 开始连接
        const connectConfig = {
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.username,
          readyTimeout: 10000, // 10秒连接超时
          keepaliveInterval: 30000, // 30秒发送一次心跳保持连接
        };

        // 根据是否有密码和私钥设置不同的认证方式
        if (sshConfig.privateKeyPath) {
          try {
            // 读取私钥文件
            const privateKey = fs.readFileSync(
              sshConfig.privateKeyPath,
              "utf8",
            );
            connectConfig.privateKey = privateKey;

            // 如果私钥有密码保护
            if (sshConfig.password) {
              connectConfig.passphrase = sshConfig.password;
            }
          } catch (error) {
            logToFile(
              `Error reading private key file: ${error.message}`,
              "ERROR",
            );
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(
                `process:output:${processId}`,
                `\r\n\x1b[31m*** 读取私钥文件错误: ${error.message} ***\x1b[0m\r\n`,
              );
            }
            reject(error);
            return;
          }
        } else if (sshConfig.password) {
          // 使用密码认证
          connectConfig.password = sshConfig.password;
          // 同时启用键盘交互认证，某些服务器可能需要
          connectConfig.tryKeyboard = true;
        }

        // 连接到SSH服务器
        ssh.connect(connectConfig);

        // 返回进程ID
        resolve(processId);
      } catch (error) {
        logToFile(`Failed to start SSH connection: ${error.message}`, "ERROR");
        reject(error);
      }
    });
  });

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

        // 移除stdout和stderr的监听器，防止在进程被kill后继续触发
        if (proc.process.stdout) {
          proc.process.stdout.removeAllListeners();
        }
        if (proc.process.stderr) {
          proc.process.stderr.removeAllListeners();
        }

        // 终止进程
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

  // 直接处理API请求，绕过CORS限制
  ipcMain.handle("ai:sendAPIRequest", async (event, requestData, isStream) => {
    try {
      // 保存事件对象，用于后续消息发送
      globalEvent = event;

      // 验证请求数据
      if (
        !requestData.url ||
        !requestData.apiKey ||
        !requestData.model ||
        !requestData.messages
      ) {
        throw new Error("请求数据无效，缺少必要参数");
      }

      if (isStream) {
        // 保存当前会话ID
        currentSessionId = requestData.sessionId;

        // 处理流式请求
        const https = require("https");
        const http = require("http");
        const url = new URL(requestData.url);

        const requestModule = url.protocol === "https:" ? https : http;

        const options = {
          method: "POST",
          hostname: url.hostname,
          path: url.pathname + url.search,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${requestData.apiKey}`,
          },
        };

        const req = requestModule.request(options, (res) => {
          if (res.statusCode !== 200) {
            event.sender.send("stream-error", {
              tabId: "ai",
              sessionId: requestData.sessionId,
              error: {
                message: `API请求失败: ${res.statusCode} ${res.statusMessage}`,
              },
            });
            return;
          }

          res.on("data", (chunk) => {
            try {
              const data = chunk.toString("utf-8");
              const lines = data.split("\n");

              for (const line of lines) {
                if (line.startsWith("data: ") && line !== "data: [DONE]") {
                  try {
                    const jsonData = JSON.parse(line.substring(6));
                    if (
                      jsonData.choices &&
                      jsonData.choices[0] &&
                      jsonData.choices[0].delta &&
                      jsonData.choices[0].delta.content
                    ) {
                      const chunkData = {
                        tabId: "ai",
                        chunk: jsonData.choices[0].delta.content,
                        sessionId: requestData.sessionId,
                      };
                      event.sender.send("stream-chunk", chunkData);
                    }
                  } catch (e) {}
                }
              }
            } catch (error) {
              logToFile(`处理流数据时出错: ${error.message}`, "ERROR");
            }
          });

          res.on("end", () => {
            event.sender.send("stream-end", {
              tabId: "ai",
              sessionId: requestData.sessionId,
            });
            // 清理请求引用和会话ID
            activeAPIRequest = null;
            currentSessionId = null;
          });
        });

        req.on("error", (error) => {
          logToFile(`请求出错: ${error.message}`, "ERROR");
          event.sender.send("stream-error", {
            tabId: "ai",
            sessionId: requestData.sessionId,
            error: { message: error.message },
          });
          // 清理请求引用和会话ID
          activeAPIRequest = null;
          currentSessionId = null;
        });

        // 保存请求引用以便后续中断
        activeAPIRequest = req;

        // 发送请求数据
        req.write(
          JSON.stringify({
            model: requestData.model,
            messages: requestData.messages,
            stream: true,
          }),
        );

        req.end();

        return { success: true, message: "流式请求已开始" };
      } else {
        // 处理标准请求
        return new Promise((resolve, reject) => {
          try {
            const https = require("https");
            const http = require("http");
            const url = new URL(requestData.url);

            const requestModule = url.protocol === "https:" ? https : http;

            const options = {
              method: "POST",
              hostname: url.hostname,
              path: url.pathname + url.search,
              port: url.port || (url.protocol === "https:" ? 443 : 80),
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${requestData.apiKey}`,
              },
            };

            const req = requestModule.request(options, (res) => {
              let responseData = "";

              // 处理状态码非200的情况
              if (res.statusCode !== 200) {
                resolve({
                  success: false,
                  error: `API请求失败: ${res.statusCode} ${res.statusMessage}`,
                });
                return;
              }

              res.on("data", (chunk) => {
                responseData += chunk.toString("utf-8");
              });

              res.on("end", () => {
                try {
                  // 解析JSON响应
                  const data = JSON.parse(responseData);
                  if (
                    data.choices &&
                    data.choices[0] &&
                    data.choices[0].message &&
                    data.choices[0].message.content
                  ) {
                    resolve({
                      success: true,
                      content: data.choices[0].message.content,
                    });
                  } else {
                    resolve({
                      success: false,
                      error: "无法解析API响应",
                      rawResponse: responseData,
                    });
                  }
                } catch (error) {
                  logToFile(`解析API响应时出错: ${error.message}`, "ERROR");
                  resolve({
                    success: false,
                    error: `解析响应失败: ${error.message}`,
                    rawResponse: responseData.substring(0, 200) + "...",
                  });
                }
              });
            });

            req.on("error", (error) => {
              logToFile(`请求出错: ${error.message}`, "ERROR");
              resolve({
                success: false,
                error: `请求失败: ${error.message}`,
              });
            });

            // 发送请求数据
            req.write(
              JSON.stringify({
                model: requestData.model,
                messages: requestData.messages,
                stream: false,
              }),
            );

            req.end();
          } catch (error) {
            logToFile(`创建请求时出错: ${error.message}`, "ERROR");
            resolve({
              success: false,
              error: `创建请求失败: ${error.message}`,
            });
          }
        });
      }
    } catch (error) {
      logToFile(`发送API请求时出错: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 处理中断API请求
  ipcMain.handle("ai:abortAPIRequest", async (event) => {
    try {
      if (activeAPIRequest) {
        // 中断请求
        activeAPIRequest.abort();

        // 发送中断消息给渲染进程
        if (globalEvent) {
          globalEvent.sender.send("stream-end", {
            tabId: "ai",
            aborted: true,
            sessionId: currentSessionId, // 使用当前会话ID而不是null
          });
        }

        // 清理请求引用和会话ID
        activeAPIRequest = null;
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

          return new Promise((resolve, reject) => {
            sftp.readFile(filePath, (err, data) => {
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

              // 转换为base64
              const base64Data = data.toString("base64");

              resolve({
                success: true,
                content: base64Data,
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
        `Read file as base64 error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `读取文件内容失败: ${error.message}` };
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
} // Closing brace for setupIPC function
