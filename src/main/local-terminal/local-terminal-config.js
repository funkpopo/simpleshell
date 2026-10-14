const fs = require("fs");
const os = require("os");
const path = require("path");

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

const WINDOWS_POWERSHELL_COMMANDS = new Set(["powershell.exe", "pwsh.exe"]);
const WINDOWS_CMD_COMMANDS = new Set(["cmd.exe"]);
const WINDOWS_WSL_COMMANDS = new Set(["wsl.exe"]);
const POSIX_SHELL_NAMES = new Set(["sh", "bash", "zsh", "fish", "dash", "ksh"]);
const POSIX_SHELL_DIRECTORIES = new Set([
  "/bin",
  "/usr/bin",
  "/usr/local/bin",
  "/opt/homebrew/bin",
]);
const POSIX_INTERACTIVE_ARGS = new Set([
  "-l",
  "--login",
  "-i",
  "--interactive",
  "-il",
  "-li",
  "--noprofile",
  "--norc",
  "--no-config",
]);

function isAllowedPosixShell(command, trustedShell = "") {
  if (!path.posix.isAbsolute(command) || /[\u0000-\u001f\u007f]/.test(command))
    return false;
  if (path.posix.normalize(command) !== command) return false;
  return (
    POSIX_SHELL_NAMES.has(path.posix.basename(command)) &&
    (POSIX_SHELL_DIRECTORIES.has(path.posix.dirname(command)) ||
      command === trustedShell)
  );
}

function normalizePosixArgs(value) {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 8 ||
    value.some(
      (arg) => typeof arg !== "string" || !POSIX_INTERACTIVE_ARGS.has(arg),
    )
  ) {
    throw new Error(
      "Only interactive/login shell options are allowed for local terminals",
    );
  }
  return [...value];
}

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

function getWindowsCommandName(command) {
  const normalizedCommand = normalizeString(command).replace(/\\/g, "/");
  const parts = normalizedCommand.split("/");
  return (parts[parts.length - 1] || "").toLowerCase();
}

function selectAllowedWindowsCommand(command, allowedCommands, fallback) {
  const normalizedCommand = normalizeString(command);
  if (!normalizedCommand) {
    return fallback;
  }

  const commandName = getWindowsCommandName(normalizedCommand);
  return allowedCommands.has(commandName) ? normalizedCommand : fallback;
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
  if (isAllowedPosixShell(envShell, envShell)) {
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
    normalizeString(input.distribution) ||
    parseDistributionFromArgs(launchArgs);

  const requestedCommand =
    normalizeString(input.command) ||
    normalizeString(input.executablePath) ||
    normalizeString(input.executable);
  let command = requestedCommand;
  let args = launchArgs;

  if (platform === "win32") {
    if (type === SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_CMD) {
      command = selectAllowedWindowsCommand(
        requestedCommand,
        WINDOWS_CMD_COMMANDS,
        "cmd.exe",
      );
      args = launchArgs;
    } else if (type === SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_WSL) {
      command = selectAllowedWindowsCommand(
        requestedCommand,
        WINDOWS_WSL_COMMANDS,
        "wsl.exe",
      );
      args = distribution ? ["-d", distribution] : [];
    } else {
      command = selectAllowedWindowsCommand(
        requestedCommand,
        WINDOWS_POWERSHELL_COMMANDS,
        "powershell.exe",
      );
      args = launchArgs;
    }
  } else {
    const defaultShell = getDefaultPosixShell(envSource);
    command = command || defaultShell;
    if (!isAllowedPosixShell(command, defaultShell)) {
      throw new Error("Unsupported local terminal shell path");
    }
    args = normalizePosixArgs(input.launchArgs ?? input.args);
  }

  const name =
    normalizeString(input.name) ||
    (type === SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_WSL && distribution
      ? distribution
      : command);

  const cwd = normalizeString(input.cwd) || homeDirectory;
  if (
    platform !== "win32" &&
    (!path.posix.isAbsolute(cwd) ||
      cwd.length > 4096 ||
      /[\u0000-\u001f\u007f]/.test(cwd))
  ) {
    throw new Error(
      "Local terminal working directory must be an absolute path",
    );
  }
  const mergedEnv = {
    ...envSource,
    // Renderer overrides such as BASH_ENV, ENV, LD_PRELOAD or PATH can
    // execute code before the first prompt. Inherit the main process env.
    ...(platform === "win32" && isPlainObject(input.env) ? input.env : {}),
  };

  return {
    name,
    type,
    executable: command,
    executablePath: command,
    launchArgs: args,
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
