// @ts-check

const {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
} = require("../domain/terminalScrollback");

const UPDATE_REMINDER_INTERVAL_OPTIONS = [1, 4, 12, 24, 72];
const RESOURCE_SYSTEM_REFRESH_OPTIONS = [2, 5, 10, 15, 30];
const RESOURCE_PROCESS_REFRESH_OPTIONS = [5, 10, 15, 30, 60];
const RESOURCE_MAX_PROCESSES_OPTIONS = [25, 50, 100, 200];
const TERMINAL_CURSOR_STYLE_OPTIONS = ["block", "underline", "bar"];
const TERMINAL_FONT_WEIGHT_BOLD_OPTIONS = [500, 600, 700, 800, 900];
const DEFAULT_TERMINAL_THEME = "default-auto";
const TERMINAL_THEME_OPTIONS = [
  "default-auto",
  "one-dark",
  "dracula",
  "nord",
  "tokyo-night",
  "catppuccin-mocha",
  "catppuccin-latte",
  "gruvbox-dark",
  "solarized-dark",
  "solarized-light",
];
const EDITOR_FONT_OPTIONS = ["system", "fira-code", "consolas", "space-mono"];
const NETWORK_LATENCY_INTERVAL_OPTIONS = [0, 15, 30, 60, 120, 300];
const FILE_MANAGER_SORT_MODE_OPTIONS = ["name", "time"];
const DIRECTORY_WATCH_INTERVAL_OPTIONS = [0, 1500, 3000, 5000, 10000];

const UI_NESTED_SECTIONS = [
  "performance",
  "externalEditor",
  "resourceMonitor",
  "updates",
  "zmodem",
  "ssh",
  "reconnect",
  "networkLatency",
  "sftp",
  "fileManager",
  "storage",
  "desktopIntegration",
  "onboarding",
  "windowBounds",
];

/**
 * Checks whether a value is a non-null plain object.
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Safely retrieves a plain object subsection from an untyped settings object.
 * @param {unknown} uiSettings
 * @param {string} key
 * @returns {Record<string, any>}
 */
function getSection(uiSettings, key) {
  if (!isPlainObject(uiSettings)) {
    return {};
  }
  const section = uiSettings[key];
  return isPlainObject(section) ? section : {};
}

/**
 * Creates a fresh default UI settings tree.
 * @returns {Record<string, any>}
 */
function createDefaultUISettings() {
  return {
    transferIntegrity: false,
    sftpFollowTerminalDirectory: true,
    language: "zh-CN",
    fontSize: 14,
    editorFont: "system",
    darkMode: true,
    sidebarPosition: "right",
    terminalFont: "Fira Code",
    terminalFontSize: 14,
    terminalLineHeight: 1.0,
    terminalTheme: DEFAULT_TERMINAL_THEME,
    terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
    terminalCursorStyle: "block",
    terminalCursorBlink: true,
    terminalLetterSpacing: 0,
    terminalFontWeight: 400,
    terminalFontWeightBold: 700,
    terminalCopyOnSelect: false,
    terminalRightClickSelectsWord: false,
    terminalMiddleClickPaste: true,
    terminalMacOptionIsMeta: false,
    commandHistoryMaxSize: 1000,
    commandHistoryMinLength: 3,
    commandSuggestionsEnabled: true,
    commandSuggestionLimit: 10,
    defaultLocalShell: "auto",
    zmodem: {
      saveDirectory: "",
    },
    updates: {
      autoCheckOnStartup: false,
      reminderIntervalHours: 4,
    },
    notificationDurationSeconds: 5,
    recentConnectionsLimit: 5,
    performance: {
      hardwareAcceleration: true,
      webglEnabled: true,
      cacheEnabled: true,
      terminalPerfMonitor: false,
    },
    externalEditor: {
      enabled: false,
      command: "",
      autoUploadDebounceMs: 700,
    },
    resourceMonitor: {
      displayMode: "independent",
      systemRefreshSeconds: 5,
      processRefreshSeconds: 15,
      maxVisibleProcesses: 50,
    },
    ssh: {
      keepaliveIntervalSeconds: 10,
      keepaliveCountMax: 9,
      readyTimeoutSeconds: 30,
      connectionTimeoutSeconds: 15,
      idleTimeoutMinutes: 30,
    },
    reconnect: {
      maxRetries: 10,
      initialDelayMs: 1500,
      totalTimeCapSeconds: 120,
      fastReconnectEnabled: true,
    },
    networkLatency: {
      checkIntervalSeconds: 60,
    },
    sftp: {
      parallelUploads: 4,
      parallelDownloads: 6,
      maxRetries: 2,
      sessionIdleTimeoutMinutes: 10,
    },
    fileManager: {
      defaultSortMode: "name",
      showHiddenFiles: true,
      directoryWatchIntervalMs: 1500,
      directoryCacheTtlSeconds: 10,
      maxPreviewSizeMB: 10,
    },
    storage: {
      fileCacheMaxMB: 128,
      fileCacheMaxAgeMinutes: 60,
      snapshotMaxPerFile: 50,
      snapshotRetentionDays: 30,
    },
    desktopIntegration: {
      trayEnabled: false,
      closeToTray: false,
    },
    onboarding: {
      completed: false,
      completedAt: null,
      version: 1,
    },
    ipQueryHistory: [],
    windowBounds: {},
    backupRetentionDays: 30,
    restoreSessionOnStartup: true,
  };
}

/**
 * Creates a fresh default log settings object.
 * @returns {{ level: string, maxFileSize: number, maxFiles: number, compressOldLogs: boolean, cleanupIntervalDays: number }}
 */
function createDefaultLogSettings() {
  return {
    level: "INFO",
    maxFileSize: 5242880,
    maxFiles: 5,
    compressOldLogs: true,
    cleanupIntervalDays: 7,
  };
}

/**
 * Deep-merges known nested uiSettings subsections while preserving explicit
 * non-undefined primitive/array overrides for validation.
 * @param  {...unknown} layers
 * @returns {Record<string, any>}
 */
function mergeUISettings(...layers) {
  /** @type {Record<string, any>} */
  const result = {};

  for (const layer of layers) {
    if (!isPlainObject(layer)) {
      continue;
    }

    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) {
        continue;
      }

      if (
        (UI_NESTED_SECTIONS.includes(key) ||
          (isPlainObject(result[key]) && isPlainObject(value))) &&
        isPlainObject(value)
      ) {
        result[key] = isPlainObject(result[key])
          ? { ...result[key], ...value }
          : { ...value };
        continue;
      }

      result[key] = value;
    }
  }

  return result;
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

/**
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

/**
 * @template T
 * @param {unknown} value
 * @param {readonly T[]} allowed
 * @param {T} fallback
 * @returns {T}
 */
function pickEnum(value, allowed, fallback) {
  return allowed.includes(/** @type {T} */ (value))
    ? /** @type {T} */ (value)
    : fallback;
}

/**
 * Normalizes logSettings, migrating legacy `cleanupInterval` when present.
 * @param {unknown} rawLogSettings
 * @returns {{ level: string, maxFileSize: number, maxFiles: number, compressOldLogs: boolean, cleanupIntervalDays: number }}
 */
function normalizeLogSettings(rawLogSettings) {
  const defaults = createDefaultLogSettings();
  const source = isPlainObject(rawLogSettings) ? rawLogSettings : {};
  const legacyDays =
    typeof source.cleanupInterval === "number" &&
    Number.isFinite(source.cleanupInterval)
      ? source.cleanupInterval
      : undefined;

  return {
    level: pickEnum(
      source.level,
      ["DEBUG", "INFO", "WARN", "ERROR"],
      defaults.level,
    ),
    maxFileSize: Math.max(
      1024,
      Math.round(Number(source.maxFileSize) || defaults.maxFileSize),
    ),
    maxFiles: clampInt(source.maxFiles, 1, 50, defaults.maxFiles),
    compressOldLogs:
      typeof source.compressOldLogs === "boolean"
        ? source.compressOldLogs
        : defaults.compressOldLogs,
    cleanupIntervalDays: clampInt(
      source.cleanupIntervalDays !== undefined
        ? source.cleanupIntervalDays
        : legacyDays,
      1,
      365,
      defaults.cleanupIntervalDays,
    ),
  };
}

/**
 * @param {unknown} uiSettings
 * @returns {{ autoCheckOnStartup: boolean, reminderIntervalHours: number }}
 */
function normalizeUpdatesSettings(uiSettings) {
  const defaults = createDefaultUISettings().updates;
  const raw = getSection(uiSettings, "updates");
  return {
    autoCheckOnStartup:
      typeof raw.autoCheckOnStartup === "boolean"
        ? raw.autoCheckOnStartup
        : defaults.autoCheckOnStartup,
    reminderIntervalHours: pickEnum(
      Number(raw.reminderIntervalHours),
      UPDATE_REMINDER_INTERVAL_OPTIONS,
      defaults.reminderIntervalHours,
    ),
  };
}

/**
 * @param {unknown} uiSettings
 * @returns {number}
 */
function normalizeNotificationDurationMs(uiSettings) {
  const seconds = clampInt(
    isPlainObject(uiSettings)
      ? uiSettings.notificationDurationSeconds
      : undefined,
    2,
    15,
    5,
  );
  return seconds * 1000;
}

/**
 * @param {unknown} uiSettings
 * @returns {{ displayMode: string, systemRefreshSeconds: number, processRefreshSeconds: number, maxVisibleProcesses: number }}
 */
function normalizeResourceMonitorSettings(uiSettings) {
  const defaults = createDefaultUISettings().resourceMonitor;
  const raw = getSection(uiSettings, "resourceMonitor");
  return {
    displayMode:
      typeof raw.displayMode === "string" && raw.displayMode.trim()
        ? raw.displayMode.trim()
        : defaults.displayMode,
    systemRefreshSeconds: pickEnum(
      Number(raw.systemRefreshSeconds),
      RESOURCE_SYSTEM_REFRESH_OPTIONS,
      defaults.systemRefreshSeconds,
    ),
    processRefreshSeconds: pickEnum(
      Number(raw.processRefreshSeconds),
      RESOURCE_PROCESS_REFRESH_OPTIONS,
      defaults.processRefreshSeconds,
    ),
    maxVisibleProcesses: pickEnum(
      Number(raw.maxVisibleProcesses),
      RESOURCE_MAX_PROCESSES_OPTIONS,
      defaults.maxVisibleProcesses,
    ),
  };
}

/**
 * @param {unknown} uiSettings
 * @returns {number}
 */
function normalizeRecentConnectionsLimit(uiSettings) {
  return clampInt(
    isPlainObject(uiSettings) ? uiSettings.recentConnectionsLimit : undefined,
    0,
    20,
    5,
  );
}

/**
 * @param {unknown} uiSettings
 * @returns {number}
 */
function normalizeAutoUploadDebounceMs(uiSettings) {
  const raw = getSection(uiSettings, "externalEditor").autoUploadDebounceMs;
  return clampInt(raw, 200, 5000, 700);
}

/**
 * @param {unknown} uiSettings
 * @returns {{ hardwareAcceleration: boolean, webglEnabled: boolean, cacheEnabled: boolean, terminalPerfMonitor: boolean }}
 */
function normalizePerformanceSettings(uiSettings) {
  const defaults = createDefaultUISettings().performance;
  const raw = getSection(uiSettings, "performance");
  return {
    hardwareAcceleration: raw.hardwareAcceleration !== false,
    webglEnabled:
      typeof raw.webglEnabled === "boolean"
        ? raw.webglEnabled
        : defaults.webglEnabled,
    cacheEnabled:
      typeof raw.cacheEnabled === "boolean"
        ? raw.cacheEnabled
        : defaults.cacheEnabled,
    terminalPerfMonitor:
      typeof raw.terminalPerfMonitor === "boolean"
        ? raw.terminalPerfMonitor
        : defaults.terminalPerfMonitor,
  };
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTerminalThemeId(value) {
  return pickEnum(
    typeof value === "string" ? value.trim() : value,
    TERMINAL_THEME_OPTIONS,
    DEFAULT_TERMINAL_THEME,
  );
}

/**
 * @param {unknown} uiSettings
 * @returns {{
 *   terminalTheme: string,
 *   cursorStyle: "block" | "underline" | "bar",
 *   cursorBlink: boolean,
 *   letterSpacing: number,
 *   fontWeight: number,
 *   fontWeightBold: number,
 *   copyOnSelect: boolean,
 *   rightClickSelectsWord: boolean,
 *   middleClickPaste: boolean,
 *   macOptionIsMeta: boolean,
 *   commandHistoryMaxSize: number,
 *   commandHistoryMinLength: number,
 *   commandSuggestionsEnabled: boolean,
 *   commandSuggestionLimit: number,
 *   defaultLocalShell: string,
 *   zmodemSaveDirectory: string
 * }}
 */
function normalizeTerminalUiSettings(uiSettings) {
  const defaults = createDefaultUISettings();
  const source = isPlainObject(uiSettings) ? uiSettings : {};
  const letterSpacingRaw = clampNumber(
    source.terminalLetterSpacing,
    -2,
    4,
    defaults.terminalLetterSpacing,
  );
  const letterSpacing = Math.round(letterSpacingRaw * 2) / 2;
  const zmodem = isPlainObject(source.zmodem) ? source.zmodem : {};

  return {
    terminalTheme: normalizeTerminalThemeId(source.terminalTheme),
    cursorStyle: /** @type {"block" | "underline" | "bar"} */ (
      pickEnum(
        source.terminalCursorStyle,
        TERMINAL_CURSOR_STYLE_OPTIONS,
        defaults.terminalCursorStyle,
      )
    ),
    cursorBlink:
      typeof source.terminalCursorBlink === "boolean"
        ? source.terminalCursorBlink
        : defaults.terminalCursorBlink,
    letterSpacing,
    fontWeight: clampInt(
      source.terminalFontWeight,
      300,
      1000,
      defaults.terminalFontWeight,
    ),
    fontWeightBold: pickEnum(
      Number(source.terminalFontWeightBold),
      TERMINAL_FONT_WEIGHT_BOLD_OPTIONS,
      defaults.terminalFontWeightBold,
    ),
    copyOnSelect:
      typeof source.terminalCopyOnSelect === "boolean"
        ? source.terminalCopyOnSelect
        : defaults.terminalCopyOnSelect,
    rightClickSelectsWord:
      typeof source.terminalRightClickSelectsWord === "boolean"
        ? source.terminalRightClickSelectsWord
        : defaults.terminalRightClickSelectsWord,
    middleClickPaste:
      typeof source.terminalMiddleClickPaste === "boolean"
        ? source.terminalMiddleClickPaste
        : defaults.terminalMiddleClickPaste,
    macOptionIsMeta:
      typeof source.terminalMacOptionIsMeta === "boolean"
        ? source.terminalMacOptionIsMeta
        : defaults.terminalMacOptionIsMeta,
    commandHistoryMaxSize: clampInt(
      source.commandHistoryMaxSize,
      100,
      10000,
      defaults.commandHistoryMaxSize,
    ),
    commandHistoryMinLength: clampInt(
      source.commandHistoryMinLength,
      1,
      10,
      defaults.commandHistoryMinLength,
    ),
    commandSuggestionsEnabled:
      typeof source.commandSuggestionsEnabled === "boolean"
        ? source.commandSuggestionsEnabled
        : defaults.commandSuggestionsEnabled,
    commandSuggestionLimit: clampInt(
      source.commandSuggestionLimit,
      3,
      30,
      defaults.commandSuggestionLimit,
    ),
    defaultLocalShell:
      typeof source.defaultLocalShell === "string" &&
      source.defaultLocalShell.trim()
        ? source.defaultLocalShell.trim()
        : defaults.defaultLocalShell,
    zmodemSaveDirectory:
      typeof zmodem.saveDirectory === "string"
        ? zmodem.saveDirectory.trim()
        : "",
  };
}

/**
 * @param {unknown} uiSettings
 * @returns {{
 *   keepaliveIntervalSeconds: number,
 *   keepaliveCountMax: number,
 *   readyTimeoutSeconds: number,
 *   connectionTimeoutSeconds: number,
 *   idleTimeoutMinutes: number
 * }}
 */
function normalizeSshUiSettings(uiSettings) {
  const defaults = createDefaultUISettings().ssh;
  const raw = getSection(uiSettings, "ssh");
  return {
    keepaliveIntervalSeconds: clampInt(
      raw.keepaliveIntervalSeconds,
      5,
      120,
      defaults.keepaliveIntervalSeconds,
    ),
    keepaliveCountMax: clampInt(
      raw.keepaliveCountMax,
      3,
      30,
      defaults.keepaliveCountMax,
    ),
    readyTimeoutSeconds: clampInt(
      raw.readyTimeoutSeconds,
      10,
      180,
      defaults.readyTimeoutSeconds,
    ),
    connectionTimeoutSeconds: clampInt(
      raw.connectionTimeoutSeconds,
      5,
      60,
      defaults.connectionTimeoutSeconds,
    ),
    idleTimeoutMinutes: clampInt(
      raw.idleTimeoutMinutes,
      5,
      240,
      defaults.idleTimeoutMinutes,
    ),
  };
}

/**
 * @param {unknown} uiSettings
 * @returns {{
 *   maxRetries: number,
 *   initialDelayMs: number,
 *   totalTimeCapSeconds: number,
 *   fastReconnectEnabled: boolean
 * }}
 */
function normalizeReconnectUiSettings(uiSettings) {
  const defaults = createDefaultUISettings().reconnect;
  const raw = getSection(uiSettings, "reconnect");
  return {
    maxRetries: clampInt(raw.maxRetries, 0, 30, defaults.maxRetries),
    initialDelayMs: clampInt(
      raw.initialDelayMs,
      500,
      10000,
      defaults.initialDelayMs,
    ),
    totalTimeCapSeconds: clampInt(
      raw.totalTimeCapSeconds,
      30,
      600,
      defaults.totalTimeCapSeconds,
    ),
    fastReconnectEnabled:
      typeof raw.fastReconnectEnabled === "boolean"
        ? raw.fastReconnectEnabled
        : defaults.fastReconnectEnabled,
  };
}

/**
 * @param {unknown} uiSettings
 * @returns {{ checkIntervalSeconds: number }}
 */
function normalizeNetworkLatencySettings(uiSettings) {
  const defaults = createDefaultUISettings().networkLatency;
  const raw = getSection(uiSettings, "networkLatency");
  return {
    checkIntervalSeconds: pickEnum(
      Number(raw.checkIntervalSeconds),
      NETWORK_LATENCY_INTERVAL_OPTIONS,
      defaults.checkIntervalSeconds,
    ),
  };
}

/**
 * @param {unknown} uiSettings
 * @returns {{
 *   parallelUploads: number,
 *   parallelDownloads: number,
 *   maxRetries: number,
 *   sessionIdleTimeoutMinutes: number
 * }}
 */
function normalizeSftpSettings(uiSettings) {
  const defaults = createDefaultUISettings().sftp;
  const raw = getSection(uiSettings, "sftp");
  return {
    parallelUploads: clampInt(
      raw.parallelUploads,
      1,
      8,
      defaults.parallelUploads,
    ),
    parallelDownloads: clampInt(
      raw.parallelDownloads,
      1,
      8,
      defaults.parallelDownloads,
    ),
    maxRetries: clampInt(raw.maxRetries, 0, 5, defaults.maxRetries),
    sessionIdleTimeoutMinutes: clampInt(
      raw.sessionIdleTimeoutMinutes,
      1,
      120,
      defaults.sessionIdleTimeoutMinutes,
    ),
  };
}

/**
 * @param {unknown} uiSettings
 * @returns {{
 *   defaultSortMode: "name" | "time",
 *   showHiddenFiles: boolean,
 *   directoryWatchIntervalMs: number,
 *   directoryCacheTtlSeconds: number,
 *   maxPreviewSizeMB: number
 * }}
 */
function normalizeFileManagerSettings(uiSettings) {
  const defaults = createDefaultUISettings().fileManager;
  const raw = getSection(uiSettings, "fileManager");
  return {
    defaultSortMode: /** @type {"name" | "time"} */ (
      pickEnum(
        raw.defaultSortMode,
        FILE_MANAGER_SORT_MODE_OPTIONS,
        defaults.defaultSortMode,
      )
    ),
    showHiddenFiles:
      typeof raw.showHiddenFiles === "boolean"
        ? raw.showHiddenFiles
        : defaults.showHiddenFiles,
    directoryWatchIntervalMs: pickEnum(
      Number(raw.directoryWatchIntervalMs),
      DIRECTORY_WATCH_INTERVAL_OPTIONS,
      defaults.directoryWatchIntervalMs,
    ),
    directoryCacheTtlSeconds: clampInt(
      raw.directoryCacheTtlSeconds,
      0,
      300,
      defaults.directoryCacheTtlSeconds,
    ),
    maxPreviewSizeMB: clampInt(
      raw.maxPreviewSizeMB,
      1,
      50,
      defaults.maxPreviewSizeMB,
    ),
  };
}

/**
 * @param {unknown} uiSettings
 * @returns {{
 *   fileCacheMaxMB: number,
 *   fileCacheMaxAgeMinutes: number,
 *   snapshotMaxPerFile: number,
 *   snapshotRetentionDays: number
 * }}
 */
function normalizeStorageSettings(uiSettings) {
  const defaults = createDefaultUISettings().storage;
  const raw = getSection(uiSettings, "storage");
  return {
    fileCacheMaxMB: clampInt(
      raw.fileCacheMaxMB,
      32,
      2048,
      defaults.fileCacheMaxMB,
    ),
    fileCacheMaxAgeMinutes: clampInt(
      raw.fileCacheMaxAgeMinutes,
      10,
      1440,
      defaults.fileCacheMaxAgeMinutes,
    ),
    snapshotMaxPerFile: clampInt(
      raw.snapshotMaxPerFile,
      5,
      200,
      defaults.snapshotMaxPerFile,
    ),
    snapshotRetentionDays: clampInt(
      raw.snapshotRetentionDays,
      1,
      365,
      defaults.snapshotRetentionDays,
    ),
  };
}

/**
 * Resolves maximum preview size in bytes from a MB number, fileManager section,
 * or full uiSettings object.
 * @param {unknown} source
 * @returns {number}
 */
function getMaxPreviewSizeBytes(source) {
  let mb = source;
  if (isPlainObject(source)) {
    mb = isPlainObject(source.fileManager)
      ? source.fileManager.maxPreviewSizeMB
      : source.maxPreviewSizeMB;
  }
  const safeMb = clampInt(mb, 1, 50, 10);
  return safeMb * 1024 * 1024;
}

/**
 * @param {unknown} uiSettings
 * @returns {boolean}
 */
function normalizeRestoreSessionOnStartup(uiSettings) {
  const defaults = createDefaultUISettings();
  if (!isPlainObject(uiSettings)) {
    return defaults.restoreSessionOnStartup;
  }
  return typeof uiSettings.restoreSessionOnStartup === "boolean"
    ? uiSettings.restoreSessionOnStartup
    : defaults.restoreSessionOnStartup;
}

module.exports = {
  UPDATE_REMINDER_INTERVAL_OPTIONS,
  RESOURCE_SYSTEM_REFRESH_OPTIONS,
  RESOURCE_PROCESS_REFRESH_OPTIONS,
  RESOURCE_MAX_PROCESSES_OPTIONS,
  TERMINAL_CURSOR_STYLE_OPTIONS,
  TERMINAL_FONT_WEIGHT_BOLD_OPTIONS,
  DEFAULT_TERMINAL_THEME,
  TERMINAL_THEME_OPTIONS,
  EDITOR_FONT_OPTIONS,
  NETWORK_LATENCY_INTERVAL_OPTIONS,
  FILE_MANAGER_SORT_MODE_OPTIONS,
  DIRECTORY_WATCH_INTERVAL_OPTIONS,
  UI_NESTED_SECTIONS,
  isPlainObject,
  createDefaultUISettings,
  createDefaultLogSettings,
  mergeUISettings,
  normalizeLogSettings,
  normalizeUpdatesSettings,
  normalizeNotificationDurationMs,
  normalizeResourceMonitorSettings,
  normalizeRecentConnectionsLimit,
  normalizeAutoUploadDebounceMs,
  normalizePerformanceSettings,
  normalizeTerminalThemeId,
  normalizeTerminalUiSettings,
  normalizeSshUiSettings,
  normalizeReconnectUiSettings,
  normalizeNetworkLatencySettings,
  normalizeSftpSettings,
  normalizeFileManagerSettings,
  normalizeStorageSettings,
  normalizeRestoreSessionOnStartup,
  getMaxPreviewSizeBytes,
};
