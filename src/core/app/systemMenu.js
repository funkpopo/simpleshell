const { BrowserWindow, Menu, app } = require("electron");
const { safeSendToRenderer } = require("../window/windowManager");

const MENU_ACTIONS = Object.freeze({
  ABOUT: "about",
  SETTINGS: "settings",
  CHECK_FOR_UPDATES: "check-for-updates",
  OPEN_LOG_DIRECTORY: "open-log-directory",
  EXPORT_DIAGNOSTICS: "export-diagnostics",
});

function sendMenuAction(action) {
  safeSendToRenderer("app:menu-action", {
    action,
    source: "system-menu",
    timestamp: Date.now(),
  });
}

function buildAppMenuItems() {
  return [
    {
      label: "About SimpleShell",
      click: () => sendMenuAction(MENU_ACTIONS.ABOUT),
    },
    {
      label: "Settings...",
      accelerator: "CmdOrCtrl+,",
      click: () => sendMenuAction(MENU_ACTIONS.SETTINGS),
    },
    {
      label: "Check for Updates...",
      click: () => sendMenuAction(MENU_ACTIONS.CHECK_FOR_UPDATES),
    },
    { type: "separator" },
    {
      label: "Open Logs",
      click: () => sendMenuAction(MENU_ACTIONS.OPEN_LOG_DIRECTORY),
    },
    {
      label: "Export Diagnostics",
      click: () => sendMenuAction(MENU_ACTIONS.EXPORT_DIAGNOSTICS),
    },
    { type: "separator" },
  ];
}

function buildDarwinTemplate() {
  return [
    {
      label: app.name || "SimpleShell",
      submenu: [
        ...buildAppMenuItems(),
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
        { role: "close" },
      ],
    },
  ];
}

function buildDefaultTemplate() {
  return [
    {
      label: "File",
      submenu: [
        ...buildAppMenuItems(),
        {
          label: "Quit",
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        {
          label: "Maximize",
          click: () => {
            const targetWindow = BrowserWindow.getFocusedWindow();
            if (!targetWindow || targetWindow.isDestroyed()) {
              return;
            }
            if (targetWindow.isMaximized()) {
              targetWindow.unmaximize();
            } else {
              targetWindow.maximize();
            }
          },
        },
        { role: "close" },
      ],
    },
  ];
}

function installSystemMenu() {
  const template =
    process.platform === "darwin"
      ? buildDarwinTemplate()
      : buildDefaultTemplate();
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = {
  installSystemMenu,
  MENU_ACTIONS,
};
