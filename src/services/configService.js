const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const SQLiteConfigStorage = require("../core/storage/sqliteConfigStorage");

class ConfigService {
  constructor() {
    this.app = null;
    this.logger = null;
    this.crypto = null;

    this.databasePath = null;

    this.storage = null;
    this.ajv = null;
    this.validators = {};
    this._initialized = false;
  }

  init(appInstance, loggerModule, cryptoModule) {
    if (!appInstance || !loggerModule || !cryptoModule) {
      console.error("ConfigService: Missing required dependencies");
      return false;
    }

    this.app = appInstance;
    this.logger = loggerModule;
    this.crypto = cryptoModule;

    if (
      typeof this.logger.logToFile !== "function" ||
      typeof this.crypto.encryptText !== "function" ||
      typeof this.crypto.decryptText !== "function"
    ) {
      console.error("ConfigService: Required functions are not available");
      return false;
    }

    this._initializeValidator();

    try {
      this.databasePath = this._getDatabasePath();
      this.storage = new SQLiteConfigStorage({
        dbPath: this.databasePath,
        logger: this.logger,
        encryptText: this.crypto.encryptText,
        decryptText: this.crypto.decryptText,
      });

      this._initialized = true;
      this._log(
        `ConfigService initialized. DB path: ${this.databasePath}`,
        "INFO",
      );
      return true;
    } catch (error) {
      this._log(`ConfigService init failed: ${error.message}`, "ERROR");
      return false;
    }
  }

  _initializeValidator() {
    this.ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
    addFormats(this.ajv);

    this.validators.uiSettings = this.ajv.compile({
      type: "object",
      properties: {
        language: { type: "string", default: "zh-CN" },
        fontSize: { type: "number", minimum: 10, maximum: 30, default: 14 },
        editorFont: { type: "string", default: "system" },
        darkMode: { type: "boolean", default: true },
        terminalFont: { type: "string", default: "Fira Code" },
        terminalFontSize: {
          type: "number",
          minimum: 10,
          maximum: 30,
          default: 14,
        },
        performance: { type: "object", default: {} },
        externalEditor: { type: "object", default: {} },
      },
      default: {},
    });

    this.validators.logSettings = this.ajv.compile({
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

    this.validators.aiSettings = this.ajv.compile({
      type: "object",
      properties: {
        configs: { type: "array", default: [] },
        current: { type: ["object", "null"], default: null },
      },
      default: { configs: [], current: null },
    });
  }

  _validate(type, data) {
    const validator = this.validators[type];
    if (!validator) {
      return true;
    }

    if (!validator(data)) {
      this._log(
        `ConfigService validation failed for ${type}: ${JSON.stringify(validator.errors)}`,
        "WARN",
      );
      return false;
    }

    return true;
  }

  _log(message, level = "INFO") {
    if (this.logger?.logToFile) {
      this.logger.logToFile(message, level);
    }
  }

  _isDevEnvironment() {
    return process.env.NODE_ENV === "development" || !this.app?.isPackaged;
  }

  _getDatabasePath() {
    if (!this.app) {
      return path.join(process.cwd(), "simpleshell.db");
    }

    if (this._isDevEnvironment()) {
      return path.join(process.cwd(), "simpleshell.db");
    }

    return path.join(path.dirname(this.app.getPath("exe")), "simpleshell.db");
  }

  getDatabasePath() {
    return this.databasePath;
  }

  initializeMainConfig() {
    if (!this._initialized || !this.storage) {
      this._log(
        "ConfigService: Service not initialized. Call init() first.",
        "ERROR",
      );
      return;
    }

    try {
      this.storage.initialize();
      this._ensureDefaultSettings();
    } catch (error) {
      this._log(
        `ConfigService: Failed to initialize storage - ${error.message}`,
        "ERROR",
      );
    }
  }

  _ensureDefaultSettings() {
    if (this.get("uiSettings") == null) {
      this.saveUISettings(this._getDefaultUISettings());
    }

    if (this.get("logSettings") == null) {
      this.saveLogSettings(this._getDefaultLogSettings());
    }

    if (this.get("shortcutCommands") == null) {
      this.saveShortcutCommands({});
    }

    if (this.get("topConnections") == null) {
      this.saveTopConnections([]);
    }

    if (this.get("lastConnections") == null) {
      this.saveLastConnections([]);
    }
  }

  _encodeConnectionSecretsForStore(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    return items.map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }

      const result = { ...item };

      if (item.type === "connection") {
        if (typeof item.password === "string" && item.password) {
          result.password = this._encryptMaybe(item.password);
        }
        if (typeof item.privateKeyPath === "string" && item.privateKeyPath) {
          result.privateKeyPath = this._encryptMaybe(item.privateKeyPath);
        }
        if (typeof item.privateKey === "string" && item.privateKey) {
          result.privateKey = this._encryptMaybe(item.privateKey);
        }
        if (
          typeof item.privateKeyPassphrase === "string" &&
          item.privateKeyPassphrase
        ) {
          result.privateKeyPassphrase = this._encryptMaybe(
            item.privateKeyPassphrase,
          );
        }
      }

      if (item.type === "group" && Array.isArray(item.items)) {
        result.items = this._encodeConnectionSecretsForStore(item.items);
      }

      return result;
    });
  }

  _processConnectionsForLoad(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    return items.map((item) => {
      if (!item || typeof item !== "object") {
        return item;
      }

      const result = { ...item };

      if (item.type === "connection") {
        if (typeof item.password === "string" && item.password) {
          result.password = this._decryptMaybe(item.password);
        }
        if (typeof item.privateKeyPath === "string" && item.privateKeyPath) {
          result.privateKeyPath = this._decryptMaybe(item.privateKeyPath);
        }
        if (typeof item.privateKey === "string" && item.privateKey) {
          result.privateKey = this._decryptMaybe(item.privateKey);
        }
        if (
          typeof item.privateKeyPassphrase === "string" &&
          item.privateKeyPassphrase
        ) {
          result.privateKeyPassphrase = this._decryptMaybe(
            item.privateKeyPassphrase,
          );
        }
        if (result.authType === "key") {
          result.authType = "privateKey";
        }
      }

      if (item.type === "group" && Array.isArray(item.items)) {
        result.items = this._processConnectionsForLoad(item.items);
      }

      return result;
    });
  }

  loadConnections() {
    if (!this._initialized || !this.storage) {
      return [];
    }

    try {
      return this.storage.loadConnections();
    } catch (error) {
      this._log(
        `ConfigService: Failed to load connections - ${error.message}`,
        "ERROR",
      );
      return [];
    }
  }

  saveConnections(connections) {
    if (!this._initialized || !this.storage) {
      return false;
    }

    try {
      return this.storage.saveConnections(connections);
    } catch (error) {
      this._log(
        `ConfigService: Failed to save connections - ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  loadAISettings() {
    if (!this._initialized || !this.storage) {
      return {
        configs: [],
        current: { apiUrl: "", apiKey: "", model: "", streamEnabled: true },
      };
    }

    try {
      const settings = this.storage.loadAISettings();
      this._validate("aiSettings", settings);
      return settings;
    } catch (error) {
      this._log(
        `ConfigService: Failed to load AI settings - ${error.message}`,
        "ERROR",
      );
      return {
        configs: [],
        current: { apiUrl: "", apiKey: "", model: "", streamEnabled: true },
      };
    }
  }

  saveAISettings(settings) {
    if (!this._initialized || !this.storage) {
      return false;
    }

    try {
      if (!this._validate("aiSettings", settings || {})) {
        return false;
      }
      return this.storage.saveAISettings(settings || {});
    } catch (error) {
      this._log(
        `ConfigService: Failed to save AI settings - ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  loadUISettings() {
    if (!this._initialized || !this.storage) {
      return this._getDefaultUISettings();
    }

    const settings = this.get("uiSettings");
    if (!settings || typeof settings !== "object") {
      return this._getDefaultUISettings();
    }

    const merged = { ...this._getDefaultUISettings(), ...settings };
    this._validate("uiSettings", merged);
    return merged;
  }

  _getDefaultUISettings() {
    return {
      language: "zh-CN",
      fontSize: 14,
      editorFont: "system",
      darkMode: true,
      terminalFont: "Fira Code",
      terminalFontSize: 14,
      performance: {},
      externalEditor: {},
    };
  }

  saveUISettings(settings) {
    if (!this._initialized || !this.storage) {
      return false;
    }

    if (!this._validate("uiSettings", settings || {})) {
      return false;
    }

    return this.set("uiSettings", settings);
  }

  loadLogSettings() {
    if (!this._initialized || !this.storage) {
      return this._getDefaultLogSettings();
    }

    const settings = this.get("logSettings");
    if (!settings || typeof settings !== "object") {
      return this._getDefaultLogSettings();
    }

    const merged = { ...this._getDefaultLogSettings(), ...settings };
    this._validate("logSettings", merged);
    return merged;
  }

  _getDefaultLogSettings() {
    return {
      level: "INFO",
      maxFileSize: 5242880,
      maxFiles: 5,
      compressOldLogs: true,
      cleanupInterval: 24,
    };
  }

  saveLogSettings(settings) {
    if (!this._initialized || !this.storage) {
      return false;
    }

    if (!this._validate("logSettings", settings || {})) {
      return false;
    }

    return this.set("logSettings", settings);
  }

  loadShortcutCommands() {
    if (!this._initialized || !this.storage) {
      return {};
    }

    const shortcuts = this.get("shortcutCommands");
    return shortcuts && typeof shortcuts === "object" ? shortcuts : {};
  }

  saveShortcutCommands(commands) {
    if (!this._initialized || !this.storage) {
      return false;
    }

    return this.set("shortcutCommands", commands || {});
  }

  loadCommandHistory() {
    if (!this._initialized || !this.storage) {
      return [];
    }

    try {
      return this.storage.loadCommandHistory();
    } catch (error) {
      this._log(
        `ConfigService: Failed to load command history - ${error.message}`,
        "ERROR",
      );
      return [];
    }
  }

  saveCommandHistory(history) {
    if (!this._initialized || !this.storage) {
      return false;
    }

    try {
      return this.storage.saveCommandHistory(history || []);
    } catch (error) {
      this._log(
        `ConfigService: Failed to save command history - ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  loadTopConnections() {
    if (!this._initialized || !this.storage) {
      return [];
    }

    return this._processConnectionsForLoad(this.get("topConnections") || []);
  }

  saveTopConnections(connections) {
    if (!this._initialized || !this.storage) {
      return false;
    }

    const payload = this._encodeConnectionSecretsForStore(connections || []);
    return this.set("topConnections", payload);
  }

  loadLastConnections() {
    if (!this._initialized || !this.storage) {
      return [];
    }

    return this._processConnectionsForLoad(this.get("lastConnections") || []);
  }

  saveLastConnections(connections) {
    if (!this._initialized || !this.storage) {
      return false;
    }

    const payload = this._encodeConnectionSecretsForStore(connections || []);
    return this.set("lastConnections", payload);
  }

  isInitialized() {
    return this._initialized;
  }

  get(key) {
    if (!this._initialized || !this.storage || !key) {
      return undefined;
    }

    try {
      return this.storage.readSetting(key, undefined);
    } catch (error) {
      this._log(
        `ConfigService: Failed to get key '${key}' - ${error.message}`,
        "ERROR",
      );
      return undefined;
    }
  }

  set(key, value) {
    if (!this._initialized || !this.storage || !key) {
      return false;
    }

    try {
      return this.storage.writeSetting(key, value);
    } catch (error) {
      this._log(
        `ConfigService: Failed to set key '${key}' - ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  async exportSyncPackage(targetPath) {
    if (!this._initialized || !this.storage) {
      throw new Error("ConfigService is not initialized");
    }

    await this.storage.exportDatabase(targetPath);
    return targetPath;
  }

  async importSyncPackage(sourcePath) {
    if (!this._initialized || !this.storage) {
      throw new Error("ConfigService is not initialized");
    }

    await this.storage.importDatabase(sourcePath);
  }

  async sendAIPrompt(_prompt, _settings) {
    return {
      error: "Deprecated API: use ai:sendAPIRequest instead.",
    };
  }

  _encryptMaybe(value) {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    if (this._looksEncrypted(trimmed)) {
      return trimmed;
    }

    const encrypted = this.crypto.encryptText(trimmed);
    return encrypted || trimmed;
  }

  _decryptMaybe(value) {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return "";
    }

    if (!this._looksEncrypted(trimmed)) {
      return trimmed;
    }

    const decrypted = this.crypto.decryptText(trimmed);
    return decrypted || "";
  }

  _looksEncrypted(value) {
    const index = value.indexOf(":");
    if (index <= 0 || index === value.length - 1) {
      return false;
    }

    const ivHex = value.slice(0, index);
    const cipherHex = value.slice(index + 1);
    if (ivHex.length !== 32 || cipherHex.length % 2 !== 0) {
      return false;
    }

    const hexPattern = /^[0-9a-fA-F]+$/;
    return hexPattern.test(ivHex) && hexPattern.test(cipherHex);
  }
}

module.exports = new ConfigService();
