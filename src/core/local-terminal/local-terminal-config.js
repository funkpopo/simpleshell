const fs = require("fs");
const os = require("os");

const LOCAL_TERMINAL_TAB_TYPE = "local";

const SUPPORTED_LOCAL_TERMINAL_TYPES = Object.freeze({
  WINDOWS_POWERSHELL: "powershell",
  WINDOWS_CMD: "cmd",
  WINDOWS_WSL: "wsl",
  POSIX_SHELL: "shell",
});

const UNSUPPORTED_GUI_TERMINAL_TYPES = Object.freeze([
  "windows-terminal",
  "terminal",
  "iterm",
  "iterm2",
  "hyper",
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "terminator",
]);

const DEFAULT_WINDOWS_SHELL_TYPES = new Set([
  SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_POWERSHELL,
  SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_CMD,
  SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_WSL,
]);

const POSIX_SHELL_CANDIDATES = Object.freeze([
  "/bin/zsh",
  "/bin/bash",
  "/bin/sh",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeArgs(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item !== undefined && item !== null)
    .map((item) => String(item));
}

function parseDistributionFromArgs(args) {
  const distributionFlags = new Set(["-d", "--distribution"]);
  for (let index = 0; index < args.length; index += 1) {
    if (distributionFlags.has(args[index]) && args[index + 1]) {
      return args[index + 1];
    }
  }
  return "";
}

function getDefaultPosixShell(env = process.env) {
  const envShell = normalizeString(env.SHELL);
  if (envShell) {
    return envShell;
  }

  const candidate = POSIX_SHELL_CANDIDATES.find((shellPath) => {
    try {
      return fs.existsSync(shellPath);
    } catch {
      return false;
    }
  });

  return candidate || "/bin/sh";
}

function isSupportedLocalTerminalType(type, platform = process.platform) {
  const normalizedType = normalizeString(type).toLowerCase();
  if (!normalizedType) {
    return false;
  }

  if (platform === "win32") {
    return DEFAULT_WINDOWS_SHELL_TYPES.has(normalizedType);
  }

  return normalizedType === SUPPORTED_LOCAL_TERMINAL_TYPES.POSIX_SHELL;
}

function isUnsupportedGuiTerminalType(type) {
  const normalizedType = normalizeString(type).toLowerCase();
  return UNSUPPORTED_GUI_TERMINAL_TYPES.includes(normalizedType);
}

function normalizeLocalTerminalConfig(localConfig = {}, options = {}) {
  const input = isPlainObject(localConfig) ? localConfig : {};
  const platform = options.platform || process.platform;
  const envSource = isPlainObject(options.env) ? options.env : process.env;
  const homeDirectory = options.homeDirectory || os.homedir();

  const type =
    normalizeString(input.type).toLowerCase() ||
    (platform === "win32"
      ? SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_POWERSHELL
      : SUPPORTED_LOCAL_TERMINAL_TYPES.POSIX_SHELL);
  const launchArgs = normalizeArgs(input.launchArgs || input.args);
  const distribution =
    normalizeString(input.distribution) || parseDistributionFromArgs(launchArgs);

  let command =
    normalizeString(input.command) ||
    normalizeString(input.executablePath) ||
    normalizeString(input.executable);
  let args = launchArgs;

  if (platform === "win32") {
    if (type === SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_CMD) {
      command = command || "cmd.exe";
      args = launchArgs;
    } else if (type === SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_WSL) {
      command = command || "wsl.exe";
      args = distribution ? ["-d", distribution] : [];
    } else {
      command = command || "powershell.exe";
      args = launchArgs;
    }
  } else {
    command = command || getDefaultPosixShell(envSource);
    args = launchArgs;
  }

  const name =
    normalizeString(input.name) ||
    (type === SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_WSL && distribution
      ? distribution
      : command);

  const cwd = normalizeString(input.cwd) || homeDirectory;
  const mergedEnv = {
    ...envSource,
    ...(isPlainObject(input.env) ? input.env : {}),
  };

  return {
    name,
    type,
    executable: normalizeString(input.executable) || command,
    executablePath: normalizeString(input.executablePath) || command,
    launchArgs,
    cwd,
    env: mergedEnv,
    distribution: distribution || undefined,
    command,
    args,
  };
}

function createLocalTerminalTabData(localConfig = {}, options = {}) {
  const normalizedConfig = normalizeLocalTerminalConfig(localConfig, options);
  const now = options.now || Date.now();
  return {
    type: LOCAL_TERMINAL_TAB_TYPE,
    id: `local-${now}`,
    label: normalizedConfig.name,
    localConfig: normalizedConfig,
  };
}

module.exports = {
  LOCAL_TERMINAL_TAB_TYPE,
  POSIX_SHELL_CANDIDATES,
  SUPPORTED_LOCAL_TERMINAL_TYPES,
  UNSUPPORTED_GUI_TERMINAL_TYPES,
  createLocalTerminalTabData,
  getDefaultPosixShell,
  isSupportedLocalTerminalType,
  isUnsupportedGuiTerminalType,
  normalizeLocalTerminalConfig,
};
