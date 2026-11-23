const {
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
} = require("../../shared/settings/uiSettingsDefaults");

const SCHEMA_KEYS = ["connection", "aiSettings", "uiSettings", "logSettings"];
let cachedCompiled = null;

function compileConfigValidators() {
  if (cachedCompiled) {
    return cachedCompiled;
  }

  const Ajv = require("ajv");
  const addFormats = require("ajv-formats");
  const validators = {};

  const ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
  addFormats(ajv);

  // 连接配置验证 Schema
  validators.connection = ajv.compile({
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      type: { type: "string", enum: ["connection", "group"] },
      protocol: { type: "string", enum: ["ssh", "telnet"] },
      host: { type: "string" },
      port: { type: "number", minimum: 1, maximum: 65535 },
      username: { type: "string" },
      password: { type: "string" },
      privateKeyPath: { type: "string" },
      pinned: { type: "boolean" },
      tags: {
        type: "array",
        items: { type: "string" },
      },
      colorTag: { type: "string" },
      items: { type: "array" },
    },
  });

  // AI 设置验证 Schema
  validators.aiSettings = ajv.compile({
    type: "object",
    properties: {
      configs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            apiUrl: { type: "string", format: "uri" },
            apiKey: { type: "string" },
            model: { type: "string" },
            streamEnabled: { type: "boolean", default: true },
          },
          required: ["id", "name", "apiUrl"],
        },
      },
      current: {
        type: ["object", "null"],
        properties: {
          apiUrl: { type: "string" },
          apiKey: { type: "string" },
          model: { type: "string" },
          streamEnabled: { type: "boolean", default: true },
        },
      },
      windowSize: {
        type: "object",
        properties: {
          width: { type: "number", minimum: 300, maximum: 1000 },
          height: { type: "number", minimum: 500, maximum: 1000 },
        },
        required: ["width", "height"],
      },
      proxyConfig: {
        type: "object",
        properties: {
          enabled: { type: "boolean" },
          type: { type: "string", enum: ["http", "https"] },
          host: { type: "string", maxLength: 255 },
          port: { type: "integer", minimum: 0, maximum: 65535 },
          username: { type: "string" },
          password: { type: "string" },
        },
      },
    },
    required: ["configs"],
    default: { configs: [], current: null },
  });

  // UI 设置验证 Schema
  validators.uiSettings = ajv.compile({
    type: "object",
    properties: {
      transferIntegrity: { type: "boolean", default: false },
      sftpFollowTerminalDirectory: { type: "boolean", default: true },
      language: { type: "string", default: "zh-CN" },
      fontSize: { type: "number", minimum: 10, maximum: 30, default: 14 },
      editorFont: {
        type: "string",
        enum: EDITOR_FONT_OPTIONS,
        default: "system",
      },
      darkMode: { type: "boolean", default: true },
      sidebarPosition: {
        type: "string",
        enum: ["left", "right"],
        default: "right",
      },
      sidebarWidth: {
        type: "number",
        minimum: 240,
        maximum: 560,
      },
      backupRetentionDays: { type: "number", minimum: 1, default: 30 },
      terminalFont: { type: "string", default: "Fira Code" },
      terminalFontSize: {
        type: "number",
        minimum: 10,
        maximum: 30,
        default: 14,
      },
      terminalLineHeight: {
        type: "number",
        minimum: 1.0,
        maximum: 1.4,
        default: 1.0,
      },
      terminalTheme: {
        type: "string",
        enum: TERMINAL_THEME_OPTIONS,
        default: DEFAULT_TERMINAL_THEME,
      },
      terminalScrollbackLines: {
        type: "integer",
        minimum: 1000,
        maximum: 500000,
        default: 50000,
      },
      terminalCursorStyle: {
        type: "string",
        enum: TERMINAL_CURSOR_STYLE_OPTIONS,
        default: "block",
      },
      terminalCursorBlink: { type: "boolean", default: true },
      terminalLetterSpacing: {
        type: "number",
        minimum: -2,
        maximum: 4,
        default: 0,
      },
      terminalFontWeight: {
        type: "integer",
        minimum: 300,
        maximum: 1000,
        default: 400,
      },
      terminalFontWeightBold: {
        type: "integer",
        enum: TERMINAL_FONT_WEIGHT_BOLD_OPTIONS,
        default: 700,
      },
      terminalCopyOnSelect: { type: "boolean", default: false },
      terminalRightClickSelectsWord: { type: "boolean", default: false },
      terminalMiddleClickPaste: { type: "boolean", default: true },
      terminalMacOptionIsMeta: { type: "boolean", default: false },
      commandHistoryMaxSize: {
        type: "integer",
        minimum: 100,
        maximum: 10000,
        default: 1000,
      },
      commandHistoryMinLength: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        default: 3,
      },
      commandSuggestionsEnabled: { type: "boolean", default: true },
      commandSuggestionLimit: {
        type: "integer",
        minimum: 3,
        maximum: 30,
        default: 10,
      },
      defaultLocalShell: { type: "string", default: "auto" },
      zmodem: {
        type: "object",
        default: {},
        properties: {
          saveDirectory: { type: "string", default: "" },
        },
      },
      updates: {
        type: "object",
        default: {},
        properties: {
          autoCheckOnStartup: { type: "boolean", default: false },
          reminderIntervalHours: {
            type: "integer",
            enum: UPDATE_REMINDER_INTERVAL_OPTIONS,
            default: 4,
          },
        },
      },
      notificationDurationSeconds: {
        type: "integer",
        minimum: 2,
        maximum: 15,
        default: 5,
      },
      recentConnectionsLimit: {
        type: "integer",
        minimum: 0,
        maximum: 20,
        default: 5,
      },
      performance: {
        type: "object",
        default: {},
        properties: {
          hardwareAcceleration: { type: "boolean", default: true },
          webglEnabled: { type: "boolean", default: true },
          cacheEnabled: { type: "boolean", default: true },
          terminalPerfMonitor: { type: "boolean", default: false },
        },
      },
      externalEditor: {
        type: "object",
        default: {},
        properties: {
          enabled: { type: "boolean", default: false },
          command: { type: "string", default: "" },
          autoUploadDebounceMs: {
            type: "integer",
            minimum: 200,
            maximum: 5000,
            default: 700,
          },
        },
      },
      resourceMonitor: {
        type: "object",
        default: {},
        properties: {
          displayMode: { type: "string", default: "independent" },
          systemRefreshSeconds: {
            type: "integer",
            enum: RESOURCE_SYSTEM_REFRESH_OPTIONS,
            default: 5,
          },
          processRefreshSeconds: {
            type: "integer",
            enum: RESOURCE_PROCESS_REFRESH_OPTIONS,
            default: 15,
          },
          maxVisibleProcesses: {
            type: "integer",
            enum: RESOURCE_MAX_PROCESSES_OPTIONS,
            default: 50,
          },
        },
      },
      ssh: {
        type: "object",
        default: {},
        properties: {
          keepaliveIntervalSeconds: {
            type: "integer",
            minimum: 5,
            maximum: 120,
            default: 10,
          },
          keepaliveCountMax: {
            type: "integer",
            minimum: 3,
            maximum: 30,
            default: 9,
          },
          readyTimeoutSeconds: {
            type: "integer",
            minimum: 10,
            maximum: 180,
            default: 30,
          },
          connectionTimeoutSeconds: {
            type: "integer",
            minimum: 5,
            maximum: 60,
            default: 15,
          },
          idleTimeoutMinutes: {
            type: "integer",
            minimum: 5,
            maximum: 240,
            default: 30,
          },
        },
      },
      reconnect: {
        type: "object",
        default: {},
        properties: {
          maxRetries: {
            type: "integer",
            minimum: 0,
            maximum: 30,
            default: 10,
          },
          initialDelayMs: {
            type: "integer",
            minimum: 500,
            maximum: 10000,
            default: 1500,
          },
          totalTimeCapSeconds: {
            type: "integer",
            minimum: 30,
            maximum: 600,
            default: 120,
          },
          fastReconnectEnabled: { type: "boolean", default: true },
        },
      },
      networkLatency: {
        type: "object",
        default: {},
        properties: {
          checkIntervalSeconds: {
            type: "integer",
            enum: NETWORK_LATENCY_INTERVAL_OPTIONS,
            default: 60,
          },
        },
      },
      sftp: {
        type: "object",
        default: {},
        properties: {
          parallelUploads: {
            type: "integer",
            minimum: 1,
            maximum: 8,
            default: 4,
          },
          parallelDownloads: {
            type: "integer",
            minimum: 1,
            maximum: 8,
            default: 6,
          },
          maxRetries: {
            type: "integer",
            minimum: 0,
            maximum: 5,
            default: 2,
          },
          sessionIdleTimeoutMinutes: {
            type: "integer",
            minimum: 1,
            maximum: 120,
            default: 10,
          },
        },
      },
      fileManager: {
        type: "object",
        default: {},
        properties: {
          defaultSortMode: {
            type: "string",
            enum: FILE_MANAGER_SORT_MODE_OPTIONS,
            default: "name",
          },
          showHiddenFiles: { type: "boolean", default: true },
          directoryWatchIntervalMs: {
            type: "integer",
            enum: DIRECTORY_WATCH_INTERVAL_OPTIONS,
            default: 1500,
          },
          directoryCacheTtlSeconds: {
            type: "integer",
            minimum: 0,
            maximum: 300,
            default: 10,
          },
          maxPreviewSizeMB: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            default: 10,
          },
        },
      },
      storage: {
        type: "object",
        default: {},
        properties: {
          fileCacheMaxMB: {
            type: "integer",
            minimum: 32,
            maximum: 2048,
            default: 128,
          },
          fileCacheMaxAgeMinutes: {
            type: "integer",
            minimum: 10,
            maximum: 1440,
            default: 60,
          },
          snapshotMaxPerFile: {
            type: "integer",
            minimum: 5,
            maximum: 200,
            default: 50,
          },
          snapshotRetentionDays: {
            type: "integer",
            minimum: 1,
            maximum: 365,
            default: 30,
          },
        },
      },
      desktopIntegration: {
        type: "object",
        default: {},
        properties: {
          trayEnabled: { type: "boolean", default: false },
          closeToTray: { type: "boolean", default: false },
        },
      },
      ipQueryHistory: {
        type: "array",
        default: [],
        items: {
          type: "object",
          properties: {
            id: { type: ["number", "string"] },
            ip: { type: "string" },
            locationText: { type: "string" },
            latitude: { type: ["number", "string", "null"] },
            longitude: { type: ["number", "string", "null"] },
            time: { type: "number" },
          },
        },
      },
      windowBounds: {
        type: "object",
        default: {},
        properties: {
          bounds: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number", minimum: 400 },
              height: { type: "number", minimum: 300 },
            },
          },
          maximized: { type: "boolean", default: false },
          fullScreen: { type: "boolean", default: false },
          updatedAt: { type: "number" },
        },
      },
      restoreSessionOnStartup: { type: "boolean", default: true },
    },
    default: {},
  });

  // 日志设置验证 Schema
  validators.logSettings = ajv.compile({
    type: "object",
    properties: {
      level: {
        type: "string",
        enum: ["DEBUG", "INFO", "WARN", "ERROR"],
        default: "INFO",
      },
      maxFileSize: { type: "number", minimum: 1024, default: 5242880 },
      maxFiles: { type: "integer", minimum: 1, maximum: 50, default: 5 },
      compressOldLogs: { type: "boolean", default: true },
      cleanupIntervalDays: {
        type: "number",
        minimum: 1,
        maximum: 365,
        default: 7,
      },
      cleanupInterval: { type: "number", minimum: 1 },
    },
    default: {},
  });

  cachedCompiled = { ajv, validators };
  return cachedCompiled;
}

function createConfigValidators() {
  const validators = {};
  for (const key of SCHEMA_KEYS) {
    let compiled = null;
    const validate = (data) => {
      if (!compiled) {
        compiled = compileConfigValidators().validators[key];
      }
      const ok = compiled(data);
      validate.errors = compiled.errors;
      return ok;
    };
    validate.errors = null;
    validators[key] = validate;
  }
  return { ajv: null, validators };
}
module.exports = { createConfigValidators };
