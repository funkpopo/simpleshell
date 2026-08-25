/**
 * 启动期主题常量与解析。
 * 主进程 BrowserWindow、preload 首屏 DOM、渲染进程 React 初始状态共用，
 * 避免 ready-to-show 时 CSS 默认浅色 / 异步主题加载造成的窗口闪屏。
 */

const STARTUP_BACKGROUND = Object.freeze({
  dark: "#121212",
  light: "#e8eaed",
});

/** Electron additionalArguments / process.argv 中的主题开关前缀 */
const STARTUP_DARK_MODE_ARG_PREFIX = "--simpleshell-dark-mode=";

/**
 * @param {boolean} darkMode
 * @returns {string}
 */
function getStartupBackgroundColor(darkMode) {
  return darkMode ? STARTUP_BACKGROUND.dark : STARTUP_BACKGROUND.light;
}

/**
 * @param {boolean} darkMode
 * @returns {string}
 */
function buildStartupDarkModeArg(darkMode) {
  return `${STARTUP_DARK_MODE_ARG_PREFIX}${darkMode ? "1" : "0"}`;
}

/**
 * 从 process.argv / additionalArguments 解析启动主题。
 * 未找到参数时默认深色（与 appReducer / configService 默认一致）。
 * @param {string[]} [argv=process.argv]
 * @returns {{ darkMode: boolean, backgroundColor: string }}
 */
function parseStartupThemeFromArgv(argv = process.argv) {
  const list = Array.isArray(argv) ? argv : [];
  const match = list.find(
    (entry) =>
      typeof entry === "string" &&
      entry.startsWith(STARTUP_DARK_MODE_ARG_PREFIX),
  );

  let darkMode = true;
  if (match) {
    const value = match
      .slice(STARTUP_DARK_MODE_ARG_PREFIX.length)
      .toLowerCase();
    darkMode = value !== "0" && value !== "false";
  }

  return {
    darkMode,
    backgroundColor: getStartupBackgroundColor(darkMode),
  };
}

/**
 * 将启动主题立刻写到 DOM，尽量赶在首次绘制前。
 * @param {{ darkMode: boolean, backgroundColor: string }} theme
 * @param {Document} [doc=document]
 */
function applyStartupThemeToDocument(theme, doc = document) {
  if (!doc || !theme) {
    return;
  }

  const { darkMode, backgroundColor } = theme;
  const root = doc.documentElement;
  if (root) {
    root.style.backgroundColor = backgroundColor;
    root.style.colorScheme = darkMode ? "dark" : "light";
    root.setAttribute("data-ss-boot-theme", darkMode ? "dark" : "light");
  }

  const body = doc.body;
  if (body) {
    body.style.backgroundColor = backgroundColor;
    body.classList.add("ss-bootstrapping");
    body.classList.toggle("dark-theme", darkMode);
    body.classList.toggle("light-theme", !darkMode);
    body.setAttribute("data-mui-color-scheme", darkMode ? "dark" : "light");
  }

  const appRoot = doc.getElementById("root");
  if (appRoot) {
    appRoot.style.backgroundColor = backgroundColor;
  }
}

/**
 * 首屏就绪后移除启动期锁定（允许主题切换过渡等）。
 * @param {Document} [doc=document]
 */
function clearStartupThemeBootstrap(doc = document) {
  if (!doc?.body) {
    return;
  }

  doc.body.classList.remove("ss-bootstrapping");
  // 清除内联背景，交还给 CSS 变量 / MUI CssBaseline
  if (doc.documentElement) {
    doc.documentElement.style.removeProperty("background-color");
  }
  doc.body.style.removeProperty("background-color");
  const appRoot = doc.getElementById("root");
  if (appRoot) {
    appRoot.style.removeProperty("background-color");
  }
}

module.exports = {
  STARTUP_BACKGROUND,
  STARTUP_DARK_MODE_ARG_PREFIX,
  getStartupBackgroundColor,
  buildStartupDarkModeArg,
  parseStartupThemeFromArgv,
  applyStartupThemeToDocument,
  clearStartupThemeBootstrap,
};
