const { BrowserWindow, screen, session, shell } = require("electron");
const path = require("path");
const configService = require("../../services/configService");
const { IPC_EVENT_CHANNELS } = require("../ipc/schema/channels");
const { logToFile } = require("../utils/logger");
const { recordCrashMarker } = require("../utils/crashReporter");
const { buildErrorEvent } = require("../utils/errorResponse");
const {
  buildStartupDarkModeArg,
  getStartupBackgroundColor,
} = require("../../shared/startupTheme");

const DEFAULT_WINDOW_BOUNDS = Object.freeze({
  width: 1200,
  height: 800,
});

const MIN_VISIBLE_PIXELS = 80;
const WINDOW_BOUNDS_SAVE_DELAY_MS = 500;
/** ready-to-show 后若渲染进程未回报首屏就绪，超时后仍显示，避免卡在隐藏状态 */
const RENDERER_READY_FALLBACK_MS = 4000;
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** @type {WeakMap<Electron.BrowserWindow, () => void>} */
const rendererReadyRevealHandlers = new WeakMap();

/**
 * 惰性获取BrowserWindow，保证在electron被按需mock/替换时也能取到当前实现
 */
function getBrowserWindow() {
  return require("electron").BrowserWindow;
}

/**
 * 获取主窗口实例
 */
function getPrimaryWindow() {
  const windows = getBrowserWindow().getAllWindows();
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
 * 向所有未销毁的窗口广播消息
 */
function broadcastToAllWindows(channel, ...args) {
  const windows = getBrowserWindow().getAllWindows();
  windows.forEach((win) => {
    if (win && !win.isDestroyed() && win.webContents) {
      win.webContents.send(channel, ...args);
    }
  });
}

/**
 * 读取启动主题（与 config / MUI palette.background.default 对齐）
 * @returns {{ darkMode: boolean, backgroundColor: string }}
 */
function getStartupTheme() {
  try {
    const uiSettings = configService.loadUISettings();
    const darkMode = uiSettings?.darkMode !== false;
    return {
      darkMode,
      backgroundColor: getStartupBackgroundColor(darkMode),
    };
  } catch {
    return {
      darkMode: true,
      backgroundColor: getStartupBackgroundColor(true),
    };
  }
}

/**
 * 渲染进程首屏就绪后调用：在主题已落地的前提下再显示主窗口，避免闪屏。
 */
function notifyPrimaryWindowRendererReady() {
  const mainWindow = getPrimaryWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  const reveal = rendererReadyRevealHandlers.get(mainWindow);
  if (typeof reveal === "function") {
    reveal();
    return true;
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  return true;
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

function registerRendererCrashHandlers(mainWindow) {
  mainWindow.webContents.on("render-process-gone", (_event, details = {}) => {
    const reason = details.reason || "unknown";
    if (reason === "clean-exit") {
      return;
    }

    const message = `Renderer process gone: ${reason} (exitCode=${details.exitCode ?? "unknown"})`;
    logToFile(
      message,
      reason === "crashed" || reason === "oom" ? "ERROR" : "WARN",
    );
    recordCrashMarker(null, {
      module: "renderer",
      processType: "renderer",
      type: "render-process-gone",
      reason,
      exitCode: details.exitCode,
      error: new Error(message),
      extra: details,
    });

    if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(
        IPC_EVENT_CHANNELS.APP_ERROR,
        buildErrorEvent(new Error(message), {
          type: "rendererCrash",
          module: "renderer",
        }),
      );
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

  const startupTheme = getStartupTheme();
  const { backgroundColor, darkMode: startupDarkMode } = startupTheme;
  const restoredWindowState = getRestoredWindowState();

  const mainWindow = new BrowserWindow({
    ...restoredWindowState.bounds,
    frame: false,
    show: false,
    title: "SimpleShell",
    backgroundColor,
    // 与主题底色一致，减少 Windows 无边框窗口合成时的白边/闪白
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      preload: preloadEntry,
      contextIsolation: true,
      nodeIntegration: false,
      // Avoid background timer throttling that can delay terminal repaint / input after tab switches.
      backgroundThrottling: false,
      // Keep preload sandboxed. The renderer webpack config excludes asset-relocator
      // runtime from preload bundles, and Node-backed APIs are exposed through IPC.
      sandbox: true,
      // 供 preload 在首屏绘制前同步应用主题类名与背景色
      additionalArguments: [buildStartupDarkModeArg(startupDarkMode)],
    },
    icon: iconPath,
  });

  mainWindow.setMenuBarVisibility(false);
  registerSessionSecurityHandlers();
  registerWindowSecurityHandlers(mainWindow, webpackEntry);
  registerRendererCrashHandlers(mainWindow);

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

  // 显示门闩：须同时满足 ready-to-show + 渲染进程主题首屏就绪（或超时兜底）
  let compositorReady = false;
  let rendererReady = false;
  let hasRevealed = false;
  let revealFallbackTimer = null;
  /** @type {string|null} dom-ready 注入的启动底色样式 key，reveal 后移除以免锁死主题切换 */
  let bootCssKey = null;

  const clearBootCss = () => {
    if (!bootCssKey || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      bootCssKey = null;
      return;
    }
    const key = bootCssKey;
    bootCssKey = null;
    try {
      mainWindow.webContents.removeInsertedCSS(key);
    } catch {
      /* best-effort */
    }
  };

  const revealMainWindow = () => {
    if (hasRevealed || mainWindow.isDestroyed()) {
      return;
    }
    if (!compositorReady || !rendererReady) {
      return;
    }

    hasRevealed = true;
    if (revealFallbackTimer) {
      clearTimeout(revealFallbackTimer);
      revealFallbackTimer = null;
    }

    const showMainWindow = () => {
      if (mainWindow.isDestroyed()) {
        return;
      }

      clearBootCss();
      mainWindow.show();
      emitWindowState();

      // DevTools 在 show 之后打开，避免开发模式下过早弹出/带出隐藏窗口造成闪屏
      if (process.env.NODE_ENV === "development") {
        try {
          mainWindow.webContents.openDevTools({ mode: "detach" });
        } catch {
          /* intentionally ignored */
        }
      }

      // 硬件加速开启时显式锁定 60Hz，避免高刷新率显示器把渲染推到 144Hz+
      // 造成不必要的 GPU/CPU 开销；关闭时不调用，沿用系统默认。
      if (global.__hardwareAccelerationEnabled !== false) {
        try {
          mainWindow.webContents.setFrameRate(60);
        } catch {
          /* intentionally ignored — older Electron / unsupported */
        }
      }
    };

    if (restoredWindowState.fullScreen) {
      mainWindow.once("enter-full-screen", showMainWindow);
      mainWindow.setFullScreen(true);
    } else if (restoredWindowState.maximized) {
      mainWindow.once("maximize", showMainWindow);
      mainWindow.maximize();
    } else {
      showMainWindow();
    }
  };

  rendererReadyRevealHandlers.set(mainWindow, () => {
    rendererReady = true;
    revealMainWindow();
  });

  mainWindow.once("ready-to-show", () => {
    compositorReady = true;
    // 渲染进程异常时仍保证窗口最终可见
    revealFallbackTimer = setTimeout(() => {
      revealFallbackTimer = null;
      if (!rendererReady) {
        logToFile(
          "Renderer ready signal timed out; revealing main window to avoid stuck hidden state",
          "WARN",
        );
        rendererReady = true;
      }
      revealMainWindow();
    }, RENDERER_READY_FALLBACK_MS);
    revealMainWindow();
  });

  mainWindow.webContents.on("dom-ready", () => {
    // 双保险：在隐藏阶段注入与主题一致的底色，覆盖 CSS :root 默认浅色
    if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      return;
    }
    const bootCss = [
      `html, body, #root { background-color: ${backgroundColor}; }`,
      `html { color-scheme: ${startupDarkMode ? "dark" : "light"}; }`,
    ].join("\n");
    void mainWindow.webContents
      .insertCSS(bootCss)
      .then((key) => {
        // 若已 reveal，立即清掉，避免残留样式干扰后续主题切换
        if (hasRevealed) {
          try {
            mainWindow.webContents.removeInsertedCSS(key);
          } catch {
            /* best-effort */
          }
          return;
        }
        bootCssKey = key;
      })
      .catch(() => {
        /* best-effort anti-flash injection */
      });
  });

  mainWindow.on("closed", () => {
    if (revealFallbackTimer) {
      clearTimeout(revealFallbackTimer);
      revealFallbackTimer = null;
    }
    clearBootCss();
    rendererReadyRevealHandlers.delete(mainWindow);
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

  if (onSetupIPC) {
    onSetupIPC(mainWindow);
  }

  return mainWindow;
}

module.exports = {
  getPrimaryWindow,
  safeSendToRenderer,
  broadcastToAllWindows,
  getStartupTheme,
  getStartupBackgroundColor: () => getStartupTheme().backgroundColor,
  notifyPrimaryWindowRendererReady,
  createWindow,
};
