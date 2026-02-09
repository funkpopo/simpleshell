const { BrowserWindow } = require("electron");
const path = require("path");
const configService = require("../../services/configService");

/**
 * 获取主窗口实例
 */
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

/**
 * 安全地向渲染进程发送消息
 */
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

/**
 * 获取启动时的主题背景色
 */
function getStartupBackgroundColor() {
  try {
    const uiSettings = configService.loadUISettings();
    return uiSettings.darkMode ? "#121212" : "#f0f2f5";
  } catch {
    return "#121212";
  }
}

/**
 * 创建主窗口
 * @param {Object} options - 窗口配置选项
 * @param {string} options.preloadEntry - preload脚本入口
 * @param {string} options.webpackEntry - webpack入口URL
 * @param {Function} options.onSetupIPC - IPC设置回调
 */
function createWindow({ preloadEntry, webpackEntry, onSetupIPC }) {
  let iconPath;
  if (process.env.NODE_ENV === "development") {
    iconPath = path.join(process.cwd(), "src", "assets", "logo.ico");
  } else {
    iconPath = path.join(__dirname, "..", "..", "assets", "logo.ico");
  }

  const backgroundColor = getStartupBackgroundColor();

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    show: false,
    backgroundColor,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: preloadEntry,
      contextIsolation: true,
      nodeIntegration: false,
      // Electron 40 may run preloads in a sandboxed context depending on defaults.
      // Our webpack preload bundle includes asset-relocator runtime that uses `__dirname`,
      // which is not available in sandboxed preloads. Keep renderer Node disabled, but
      // ensure preload runs in the normal (non-sandboxed) context.
      sandbox: false,
    },
    icon: iconPath,
  });

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

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    emitWindowState();
  });

  mainWindow.loadURL(webpackEntry);

  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  if (onSetupIPC) {
    onSetupIPC(mainWindow);
  }

  return mainWindow;
}

module.exports = {
  getPrimaryWindow,
  safeSendToRenderer,
  getStartupBackgroundColor,
  createWindow,
};
