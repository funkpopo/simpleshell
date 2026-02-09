/**
 * SimpleShell 主入口文件
 * 仅包含应用生命周期事件和模块初始化
 */
const { app, BrowserWindow, dialog, shell } = require("electron");
const { logToFile } = require("./core/utils/logger");
const { AppInitializer, AppCleanup, ipcSetup } = require("./core/app");
const aiWorkerManager = require("./core/workers/aiWorkerManager");
const { createWindow } = require("./core/window/windowManager");
const setupIPC = require("./core/ipc/setupIPC");

// 单实例锁
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 处理Squirrel启动
if (require("electron-squirrel-startup")) {
  app.quit();
}

// 全局错误处理器
process.on("uncaughtException", (error) => {
  logToFile(`未捕获的异常: ${error.message}`, "ERROR");
  logToFile(`堆栈: ${error.stack}`, "ERROR");

  const { getPrimaryWindow, safeSendToRenderer } = require("./core/window/windowManager");
  const mainWindow = getPrimaryWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    safeSendToRenderer("app:error", {
      type: "uncaughtException",
      message: error.message || String(error),
      timestamp: Date.now(),
    });
  }
});

process.on("unhandledRejection", (reason) => {
  const errorMessage = reason instanceof Error ? reason.message : String(reason);
  const errorStack = reason instanceof Error ? reason.stack : "";

  logToFile(`未处理的Promise拒绝: ${errorMessage}`, "ERROR");
  if (errorStack) {
    logToFile(`堆栈: ${errorStack}`, "ERROR");
  }

  const { getPrimaryWindow, safeSendToRenderer } = require("./core/window/windowManager");
  const mainWindow = getPrimaryWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    safeSendToRenderer("app:error", {
      type: "unhandledRejection",
      message: errorMessage || "未知Promise错误",
      timestamp: Date.now(),
    });
  }
});

// 应用初始化器和清理器实例
let appInitializer = null;
let appCleanup = null;

// 应用准备就绪
app.whenReady().then(async () => {
  // 初始化应用
  appInitializer = new AppInitializer(app);
  await appInitializer.initialize(dialog, shell);

  // 初始化IPC（在窗口创建前）
  ipcSetup.initializeBeforeWindow();

  // 创建窗口
  createWindow({
    preloadEntry: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    webpackEntry: MAIN_WINDOW_WEBPACK_ENTRY,
    onSetupIPC: setupIPC,
  });

  // 创建AI Worker
  aiWorkerManager.createAIWorker();

  logToFile("Application ready and window created", "INFO");
});

// 应用退出前清理
appCleanup = new AppCleanup(app);
app.on("before-quit", async (event) => {
  await appCleanup.handleBeforeQuit(event, ipcSetup);
});

// 关闭所有窗口时退出应用（macOS除外）
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    aiWorkerManager.terminateAIWorker();
    app.quit();
  }
});

// macOS激活应用
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow({
      preloadEntry: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      webpackEntry: MAIN_WINDOW_WEBPACK_ENTRY,
      onSetupIPC: setupIPC,
    });
  }
});
