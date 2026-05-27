const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  nativeImage,
} = require("electron");
const fs = require("fs");
const path = require("path");
const configService = require("../../services/configService");
const { logToFile } = require("../utils/logger");
const { safeSendToRenderer } = require("../window/windowManager");
const { MENU_ACTIONS } = require("./systemMenu");

const PRODUCT_NAME = "SimpleShell";
const APP_USER_MODEL_ID = "com.funkpopo.simpleshell";

const DEFAULT_DESKTOP_INTEGRATION = Object.freeze({
  trayEnabled: false,
  closeToTray: false,
});

const pendingOpenFiles = [];
let tray = null;
let trayIconPath = "";
let desktopIntegrationSettings = { ...DEFAULT_DESKTOP_INTEGRATION };
let isQuitting = false;

function normalizeLocalOpenFilePath(filePath) {
  if (typeof filePath !== "string") {
    return "";
  }

  const trimmed = filePath.trim();
  if (!trimmed || trimmed.startsWith("-")) {
    return "";
  }

  let normalizedPath = trimmed;
  try {
    if (trimmed.startsWith("file://")) {
      normalizedPath = decodeURIComponent(new URL(trimmed).pathname);
      if (process.platform === "win32" && /^\/[A-Za-z]:/.test(normalizedPath)) {
        normalizedPath = normalizedPath.slice(1);
      }
    }
  } catch {
    normalizedPath = trimmed;
  }

  const resolvedPath = path.resolve(normalizedPath);
  if (resolvedPath === path.resolve(process.execPath)) {
    return "";
  }

  try {
    if (!fs.existsSync(resolvedPath)) {
      return "";
    }
  } catch {
    return "";
  }

  return resolvedPath;
}

function extractLocalOpenFilePaths(argv = []) {
  if (!Array.isArray(argv)) {
    return [];
  }

  const candidates = argv
    .slice(1)
    .map(normalizeLocalOpenFilePath)
    .filter(Boolean);
  return Array.from(new Set(candidates));
}

function normalizeDesktopIntegrationSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};

  return {
    trayEnabled: source.trayEnabled === true,
    closeToTray: source.closeToTray === true,
  };
}

function getPrimaryWindow() {
  const windows = BrowserWindow.getAllWindows();
  return windows.find((win) => win && !win.isDestroyed()) || null;
}

function sendDesktopMenuAction(action) {
  safeSendToRenderer("app:menu-action", {
    action,
    source: "desktop-integration",
    timestamp: Date.now(),
  });
}

function sendDesktopOpenFiles(filePaths = []) {
  const normalizedPaths = Array.from(
    new Set(
      filePaths
        .map((filePath) =>
          typeof filePath === "string" ? filePath.trim() : "",
        )
        .filter(Boolean),
    ),
  );

  if (normalizedPaths.length === 0) {
    return;
  }

  if (Notification.isSupported()) {
    const [firstPath] = normalizedPaths;
    const body =
      normalizedPaths.length === 1
        ? `Received local file open request: ${path.basename(firstPath)}`
        : `Received ${normalizedPaths.length} local file open requests`;
    new Notification({
      title: PRODUCT_NAME,
      body,
      silent: true,
    }).show();
  }

  safeSendToRenderer("app:open-files", {
    filePaths: normalizedPaths,
    source: "desktop-integration",
    timestamp: Date.now(),
  });
}

function flushPendingOpenFiles() {
  if (pendingOpenFiles.length === 0) {
    return;
  }

  const filePaths = pendingOpenFiles.splice(0, pendingOpenFiles.length);
  sendDesktopOpenFiles(filePaths);
}

function showPrimaryWindow({ createWindow } = {}) {
  let mainWindow = getPrimaryWindow();

  if (!mainWindow && typeof createWindow === "function") {
    mainWindow = createWindow();
  }

  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();

  if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once("did-finish-load", flushPendingOpenFiles);
    } else {
      flushPendingOpenFiles();
    }
  }
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: PRODUCT_NAME,
      enabled: false,
    },
    { type: "separator" },
    {
      label: "Show SimpleShell",
      click: () => showPrimaryWindow(),
    },
    {
      label: "Settings...",
      click: () => {
        showPrimaryWindow();
        sendDesktopMenuAction(MENU_ACTIONS.SETTINGS);
      },
    },
    {
      label: "Check for Updates...",
      click: () => {
        showPrimaryWindow();
        sendDesktopMenuAction(MENU_ACTIONS.CHECK_FOR_UPDATES);
      },
    },
    { type: "separator" },
    {
      label: "Quit SimpleShell",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  if (tray || !desktopIntegrationSettings.trayEnabled) {
    return;
  }

  const image = nativeImage.createFromPath(trayIconPath);
  if (image.isEmpty()) {
    throw new Error(`Tray icon is not available: ${trayIconPath}`);
  }

  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip(PRODUCT_NAME);
  tray.setContextMenu(buildTrayMenu());
  tray.on("click", showPrimaryWindow);
  tray.on("double-click", showPrimaryWindow);
  logToFile("Desktop tray enabled by user setting", "INFO");
}

function destroyTray() {
  if (!tray) {
    return;
  }

  tray.destroy();
  tray = null;
  logToFile("Desktop tray disabled", "INFO");
}

function applyDesktopIntegrationSettings(settings = {}) {
  desktopIntegrationSettings = normalizeDesktopIntegrationSettings(settings);

  if (desktopIntegrationSettings.trayEnabled) {
    createTray();
    if (tray) {
      tray.setContextMenu(buildTrayMenu());
    }
  } else {
    destroyTray();
  }

  return { ...desktopIntegrationSettings };
}

function loadDesktopIntegrationSettings() {
  const uiSettings = configService.loadUISettings();
  return normalizeDesktopIntegrationSettings(uiSettings.desktopIntegration);
}

function handleSystemOpenFiles(filePaths = [], { createWindow } = {}) {
  const normalizedPaths = filePaths
    .map(normalizeLocalOpenFilePath)
    .filter(Boolean);

  if (normalizedPaths.length === 0) {
    return;
  }

  pendingOpenFiles.push(...normalizedPaths);
  showPrimaryWindow({ createWindow });
}

function handleSecondInstance(commandLine = [], { createWindow } = {}) {
  const filePaths = extractLocalOpenFilePaths(commandLine);
  if (filePaths.length > 0) {
    handleSystemOpenFiles(filePaths, { createWindow });
    return;
  }

  showPrimaryWindow({ createWindow });
}

function buildNativeContextMenu(params = {}) {
  const template = [];
  const isEditable = params.isEditable === true;
  const hasSelection = Boolean(params.selectionText);

  if (isEditable) {
    template.push(
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy", enabled: hasSelection },
      { role: "paste" },
      { role: "selectAll" },
    );
  } else if (hasSelection) {
    template.push({ role: "copy" }, { type: "separator" });
  }

  if (!isEditable && hasSelection) {
    template.push({ role: "selectAll" });
  }

  return template.length > 0 ? Menu.buildFromTemplate(template) : null;
}

function attachDesktopWindowIntegration(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.setMinimumSize(800, 560);

  mainWindow.on("close", (event) => {
    if (
      desktopIntegrationSettings.trayEnabled &&
      desktopIntegrationSettings.closeToTray &&
      !isQuitting
    ) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.on("context-menu", (event, params = {}) => {
    const menu = buildNativeContextMenu(params);
    if (!menu) {
      return;
    }

    event.preventDefault();
    menu.popup({ window: mainWindow });
  });

  mainWindow.webContents.once("did-finish-load", flushPendingOpenFiles);
}

function resolveTrayIconPath() {
  if (process.env.NODE_ENV === "development") {
    return path.join(process.cwd(), "src", "assets", "logo.ico");
  }

  return path.join(__dirname, "assets", "logo.ico");
}

function installDesktopIntegration() {
  trayIconPath = resolveTrayIconPath();

  if (
    process.platform === "win32" &&
    typeof app.setAppUserModelId === "function"
  ) {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }

  if (process.platform === "darwin" && app.dock) {
    app.dock.show();
  }

  app.on("before-quit", () => {
    isQuitting = true;
  });

  app.on("will-quit", () => {
    destroyTray();
  });

  return applyDesktopIntegrationSettings(loadDesktopIntegrationSettings());
}

function getDesktopIntegrationSettings() {
  return { ...desktopIntegrationSettings };
}

module.exports = {
  APP_USER_MODEL_ID,
  DEFAULT_DESKTOP_INTEGRATION,
  attachDesktopWindowIntegration,
  applyDesktopIntegrationSettings,
  extractLocalOpenFilePaths,
  flushPendingOpenFiles,
  getDesktopIntegrationSettings,
  handleSecondInstance,
  handleSystemOpenFiles,
  installDesktopIntegration,
  loadDesktopIntegrationSettings,
  normalizeDesktopIntegrationSettings,
  showPrimaryWindow,
};
