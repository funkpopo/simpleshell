const Ajv = require("ajv");
const addFormats = require("ajv-formats");
function createConfigValidators() {
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
      editorFont: { type: "string", default: "system" },
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
      performance: { type: "object", default: {} },
      externalEditor: { type: "object", default: {} },
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
      maxFiles: { type: "number", minimum: 1, default: 5 },
      compressOldLogs: { type: "boolean", default: true },
      cleanupInterval: { type: "number", minimum: 1, default: 24 },
    },
    default: {},
  });

  return { ajv, validators };
}
module.exports = { createConfigValidators };
