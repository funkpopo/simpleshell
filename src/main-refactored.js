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

// 导入新的IPC管理系统
const ipcManager = require("./core/ipc/ipcManager");

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
    case "stream":
      // 处理流式响应
      mainWindow.webContents.send("ai:stream", {
        sessionId: data.sessionId,
        content: data.content,
        done: data.done,
      });

      if (data.done) {
        // 流式响应完成，清理会话
        streamSessions.delete(data.sessionId);
        if (currentSessionId === data.sessionId) {
          currentSessionId = null;
        }
      }
      break;

    case "error":
      // 处理错误
      if (data && data.sessionId) {
        mainWindow.webContents.send("ai:error", {
          sessionId: data.sessionId,
          error: error || data.error,
        });
        // 清理会话
        streamSessions.delete(data.sessionId);
        if (currentSessionId === data.sessionId) {
          currentSessionId = null;
        }
      }
      break;

    case "log":
      // 处理日志消息
      logToFile(`[AI Worker] ${data.message}`, data.level || "INFO");
      break;

    default:
      logToFile(`未知的Worker消息类型: ${type}`, "WARN");
  }
}

// 主窗口引用
let mainWindow = null;

// 创建主窗口
function createWindow() {
  // 初始化日志系统
  initLogger();

  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, "../assets/icon.png"),
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#1e1e1e",
      symbolColor: "#ffffff",
      height: 30,
    },
  });

  // 加载应用的主页面
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:3000");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "../build/index.html"));
  }

  // 创建AI Worker
  createAIWorker();

  // 使用新的IPC管理系统初始化IPC处理器
  ipcManager.initialize({
    childProcesses,
    terminalProcesses,
    aiWorker,
    mainWindow
  });

  // 窗口关闭时的处理
  mainWindow.on("closed", () => {
    // 清理IPC处理器
    ipcManager.cleanup();
    
    // 终止AI Worker
    if (aiWorker) {
      aiWorker.terminate();
      aiWorker = null;
    }
    
    mainWindow = null;
  });

  // 处理窗口最大化状态变化
  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximized", false);
  });

  // 发送初始最大化状态
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("window:maximized", mainWindow.isMaximized());
  });
}

// 应用准备就绪时创建窗口
app.whenReady().then(() => {
  createWindow();
});

// 应用退出前的清理
app.on("before-quit", () => {
  // 清理IPC处理器
  ipcManager.cleanup();
  
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
                `Error cleaning up active transfers for tab ${id}: ${err.message}`,
                "ERROR",
              );
            });
        } catch (err) {
          logToFile(
            `Error initiating cleanup for tab ${id}: ${err.message}`,
            "ERROR",
          );
        }
      }

      // 清理文件缓存
      if (fileCache && typeof fileCache.cleanupTabFiles === "function") {
        fileCache.cleanupTabFiles(id);
      }

      // 终止子进程
      if (proc.process) {
        proc.process.kill();
      } else if (proc.end) {
        proc.end();
      }
    } catch (error) {
      logToFile(`Error cleaning up process ${id}: ${error.message}`, "ERROR");
    }
  }
  
  childProcesses.clear();
  terminalProcesses.clear();

  // 终止worker线程
  if (aiWorker) {
    aiWorker.terminate();
  }

  // 记录top connections
  try {
    const topConnections = connectionManager.getTopConnections();
    if (topConnections && topConnections.length > 0) {
      configManager.saveTopConnections(topConnections);
      logToFile(
        `Saved ${topConnections.length} top connections on quit`,
        "INFO",
      );
    }
  } catch (error) {
    logToFile(
      `Failed to save top connections on quit: ${error.message}`,
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

// 导出用于测试的函数
module.exports = {
  createWindow,
  ipcManager
};