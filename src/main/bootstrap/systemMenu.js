const { BrowserWindow, Menu, app } = require("electron");
const configService = require("../settings/configService");
const { safeSendToRenderer } = require("../window/windowManager");

const MENU_ACTIONS = Object.freeze({
  ABOUT: "about",
  SETTINGS: "settings",
  CHECK_FOR_UPDATES: "check-for-updates",
  OPEN_LOG_DIRECTORY: "open-log-directory",
  EXPORT_DIAGNOSTICS: "export-diagnostics",
  FEEDBACK_ISSUE: "feedback-issue",
});

// 获取当前 UI 语言下的 mainT 与语言码（惰性加载以避免初始化顺序耦合）。
function getMenuT() {
  const { t: mainT, getUiLanguage } = require("../../shared/mainI18n");
  return { mainT, lng: getUiLanguage(configService) };
}

function sendMenuAction(action) {
  safeSendToRenderer("app:menu-action", {
    action,
    source: "system-menu",
    timestamp: Date.now(),
  });
}

function buildAppMenuItems() {
  const { mainT, lng } = getMenuT();
  return [
    {
      label: mainT("mainProcess.menu.about", { lng }),
      click: () => sendMenuAction(MENU_ACTIONS.ABOUT),
    },
    {
      label: mainT("mainProcess.menu.settings", { lng }),
      accelerator: "CmdOrCtrl+,",
      click: () => sendMenuAction(MENU_ACTIONS.SETTINGS),
    },
    {
      label: mainT("mainProcess.menu.checkForUpdates", { lng }),
      click: () => sendMenuAction(MENU_ACTIONS.CHECK_FOR_UPDATES),
    },
    { type: "separator" },
    {
      label: mainT("mainProcess.menu.openLogs", { lng }),
      click: () => sendMenuAction(MENU_ACTIONS.OPEN_LOG_DIRECTORY),
    },
    {
      label: mainT("mainProcess.menu.exportDiagnostics", { lng }),
      click: () => sendMenuAction(MENU_ACTIONS.EXPORT_DIAGNOSTICS),
    },
    {
      label: mainT("mainProcess.menu.feedbackIssue", { lng }),
      click: () => sendMenuAction(MENU_ACTIONS.FEEDBACK_ISSUE),
    },
    { type: "separator" },
  ];
}

function buildEditSubmenu() {
  const { mainT, lng } = getMenuT();
  return [
    { role: "undo", label: mainT("mainProcess.menu.undo", { lng }) },
    { role: "redo", label: mainT("mainProcess.menu.redo", { lng }) },
    { type: "separator" },
    { role: "cut", label: mainT("mainProcess.menu.cut", { lng }) },
    { role: "copy", label: mainT("mainProcess.menu.copy", { lng }) },
    { role: "paste", label: mainT("mainProcess.menu.paste", { lng }) },
    {
      role: "selectAll",
      label: mainT("mainProcess.menu.selectAll", { lng }),
    },
  ];
}

function buildDarwinTemplate() {
  const { mainT, lng } = getMenuT();
  return [
    {
      label: app.name || "SimpleShell",
      submenu: [
        ...buildAppMenuItems(),
        {
          role: "hide",
          label: mainT("mainProcess.menu.hide", {
            lng,
            appName: app.name || "SimpleShell",
          }),
        },
        {
          role: "hideOthers",
          label: mainT("mainProcess.menu.hideOthers", { lng }),
        },
        { role: "unhide", label: mainT("mainProcess.menu.unhide", { lng }) },
        { type: "separator" },
        { role: "quit", label: mainT("mainProcess.menu.quit", { lng }) },
      ],
    },
    {
      label: mainT("mainProcess.menu.edit", { lng }),
      submenu: buildEditSubmenu(),
    },
    {
      label: mainT("mainProcess.menu.window", { lng }),
      submenu: [
        {
          role: "minimize",
          label: mainT("mainProcess.menu.minimize", { lng }),
        },
        { role: "zoom", label: mainT("mainProcess.menu.zoom", { lng }) },
        { type: "separator" },
        { role: "front", label: mainT("mainProcess.menu.front", { lng }) },
        { role: "close", label: mainT("mainProcess.menu.close", { lng }) },
      ],
    },
  ];
}

function buildDefaultTemplate() {
  const { mainT, lng } = getMenuT();
  return [
    {
      label: mainT("mainProcess.menu.file", { lng }),
      submenu: [
        ...buildAppMenuItems(),
        {
          label: mainT("mainProcess.menu.quit", { lng }),
          accelerator: "CmdOrCtrl+Q",
          click: () => app.quit(),
        },
      ],
    },
    {
      label: mainT("mainProcess.menu.edit", { lng }),
      submenu: buildEditSubmenu(),
    },
    {
      label: mainT("mainProcess.menu.window", { lng }),
      submenu: [
        {
          role: "minimize",
          label: mainT("mainProcess.menu.minimize", { lng }),
        },
        {
          label: mainT("mainProcess.menu.maximize", { lng }),
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
        { role: "close", label: mainT("mainProcess.menu.close", { lng }) },
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

// 语言切换后按新语言重建菜单。
function rebuildSystemMenu() {
  installSystemMenu();
}

module.exports = {
  installSystemMenu,
  rebuildSystemMenu,
  MENU_ACTIONS,
};
