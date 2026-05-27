const { BrowserWindow, screen, session, shell } = require("electron");
const path = require("path");
const configService = require("../../services/configService");
const { IPC_EVENT_CHANNELS } = require("../ipc/schema/channels");
const { logToFile } = require("../utils/logger");

const DEFAULT_WINDOW_BOUNDS = Object.freeze({
  width: 1200,
  height: 800,
});

const MIN_VISIBLE_PIXELS = 80;
const WINDOW_BOUNDS_SAVE_DELAY_MS = 500;
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

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

function normalizeBounds(bounds) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const x = Math.round(Number(bounds.x));
  const y = Math.round(Number(bounds.y));
  const width = Math.round(Number(bounds.width));
  const height = Math.round(Number(bounds.height));

  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 400 ||
    height < 300
  ) {
    return null;
  }

  return { x, y, width, height };
}

function intersectsEnough(rect, displayBounds) {
  const left = Math.max(rect.x, displayBounds.x);
  const top = Math.max(rect.y, displayBounds.y);
  const right = Math.min(
    rect.x + rect.width,
    displayBounds.x + displayBounds.width,
  );
  const bottom = Math.min(
    rect.y + rect.height,
    displayBounds.y + displayBounds.height,
  );

  return (
    right - left >= MIN_VISIBLE_PIXELS && bottom - top >= MIN_VISIBLE_PIXELS
  );
}

function getRestoredWindowState() {
  try {
    const uiSettings = configService.loadUISettings();
    const saved = uiSettings.windowBounds || {};
    const bounds = normalizeBounds(saved.bounds);
    const displays = screen.getAllDisplays();
    const isVisible =
      bounds &&
      displays.some((display) => intersectsEnough(bounds, display.workArea));

    return {
      bounds: isVisible ? bounds : { ...DEFAULT_WINDOW_BOUNDS },
      maximized: saved.maximized === true,
      fullScreen: saved.fullScreen === true,
    };
  } catch {
    return {
      bounds: { ...DEFAULT_WINDOW_BOUNDS },
      maximized: false,
      fullScreen: false,
    };
  }
}

function persistWindowState(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  try {
    const uiSettings = configService.loadUISettings();
    const bounds =
      mainWindow.isMaximized() || mainWindow.isFullScreen()
        ? mainWindow.getNormalBounds()
        : mainWindow.getBounds();

    configService.saveUISettings({
      ...uiSettings,
      windowBounds: {
        bounds,
        maximized: mainWindow.isMaximized(),
        fullScreen: mainWindow.isFullScreen(),
        updatedAt: Date.now(),
      },
    });
  } catch {
    /* best-effort window state persistence */
  }
}

function registerWindowStatePersistence(mainWindow) {
  let saveTimer = null;

  const scheduleSave = () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistWindowState(mainWindow);
    }, WINDOW_BOUNDS_SAVE_DELAY_MS);
  };

  mainWindow.on("resize", scheduleSave);
  mainWindow.on("move", scheduleSave);
  mainWindow.on("maximize", scheduleSave);
  mainWindow.on("unmaximize", scheduleSave);
  mainWindow.on("enter-full-screen", scheduleSave);
  mainWindow.on("leave-full-screen", scheduleSave);
  mainWindow.on("close", () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistWindowState(mainWindow);
  });
}

function getExpectedRendererOrigin(webpackEntry) {
  try {
    return new URL(webpackEntry).origin;
  } catch {
    return "file://";
  }
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return ALLOWED_EXTERNAL_PROTOCOLS.has(url.protocol.toLowerCase());
  } catch {
    return false;
  }
}

function registerSessionSecurityHandlers() {
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      logToFile(`Denied renderer permission request: ${permission}`, "WARN");
      callback(false);
    },
  );
}

function registerWindowSecurityHandlers(mainWindow, webpackEntry) {
  const expectedOrigin = getExpectedRendererOrigin(webpackEntry);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url).catch((error) => {
        logToFile(
          `Blocked window.open target failed to open: ${error.message}`,
          "ERROR",
        );
      });
    } else {
      logToFile(`Blocked renderer window.open target: ${url}`, "WARN");
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    let targetOrigin = null;
    try {
      targetOrigin = new URL(url).origin;
    } catch {
      targetOrigin = null;
    }

    if (targetOrigin !== expectedOrigin) {
      event.preventDefault();
      logToFile(`Blocked renderer navigation to ${url}`, "WARN");
    }
  });
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
  const restoredWindowState = getRestoredWindowState();

  const mainWindow = new BrowserWindow({
    ...restoredWindowState.bounds,
    frame: false,
    show: false,
    backgroundColor,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: preloadEntry,
      contextIsolation: true,
      nodeIntegration: false,
      // Avoid background timer throttling that can delay terminal repaint / input after tab switches.
      backgroundThrottling: false,
      // Electron 40 may run preloads in a sandboxed context depending on defaults.
      // Our webpack preload bundle includes asset-relocator runtime that uses `__dirname`,
      // which is not available in sandboxed preloads. Keep renderer Node disabled, but
      // ensure preload runs in the normal (non-sandboxed) context.
      sandbox: false,
    },
    icon: iconPath,
  });

  mainWindow.setMenuBarVisibility(false);
  registerSessionSecurityHandlers();
  registerWindowSecurityHandlers(mainWindow, webpackEntry);

  const emitWindowState = () => {
    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(IPC_EVENT_CHANNELS.WINDOW_STATE, {
        isMaximized: mainWindow.isMaximized(),
        isFullScreen: mainWindow.isFullScreen(),
      });
    }
  };

  mainWindow.on("maximize", emitWindowState);
  mainWindow.on("unmaximize", emitWindowState);
  mainWindow.on("enter-full-screen", emitWindowState);
  mainWindow.on("leave-full-screen", emitWindowState);
  registerWindowStatePersistence(mainWindow);

  mainWindow.once("ready-to-show", () => {
    if (restoredWindowState.fullScreen) {
      mainWindow.setFullScreen(true);
    } else if (restoredWindowState.maximized) {
      mainWindow.maximize();
    }

    mainWindow.show();
    emitWindowState();

    // 硬件加速开启时显式锁定 60Hz，避免高刷新率显示器把渲染推到 144Hz+
    // 造成不必要的 GPU/CPU 开销；关闭时不调用，沿用系统默认。
    if (global.__hardwareAccelerationEnabled !== false) {
      try {
        mainWindow.webContents.setFrameRate(60);
      } catch {
        /* intentionally ignored — older Electron / unsupported */
      }
    }
  });

  mainWindow.loadURL(webpackEntry);

  // In production, enforce a strict CSP via response headers.
  // In dev, Forge's devContentSecurityPolicy handles this.
  if (process.env.NODE_ENV !== "development") {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: ws: wss:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none';",
          ],
        },
      });
    });
  }

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
