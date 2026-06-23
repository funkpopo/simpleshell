const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const {
  getConfigBackupDirectory,
  getConfigPath,
} = require("../core/utils/appPaths");

const CURRENT_CONFIG_SCHEMA_VERSION = 1;
const MAX_CONFIG_BACKUPS = 50;

/**
 * ConfigService - 配置管理服务类
 * 负责应用程序配置的加载、保存、验证和加密处理
 */
class ConfigService {
  constructor() {
    this.app = null;
    this.logger = null;
    this.crypto = null;
    this.mainConfigPath = null;
    this.ajv = null;
    this.validators = {};
    this._initialized = false;
    this._configCache = null;
    this._lastSerializedConfig = null;
  }

  /**
   * 初始化配置服务
   * @param {Object} appInstance - Electron app 实例
   * @param {Object} loggerModule - 日志模块，包含 logToFile 方法
   * @param {Object} cryptoModule - 加密模块，包含 encryptText 和 decryptText 方法
   */
  init(appInstance, loggerModule, cryptoModule) {
    if (!appInstance || !loggerModule || !cryptoModule) {
      console.error("ConfigService: Missing required dependencies");
      return false;
    }

    this.app = appInstance;
    this.logger = loggerModule;
    this.crypto = cryptoModule;

    // 验证依赖的函数是否可用
    if (
      typeof this.logger.logToFile !== "function" ||
      typeof this.crypto.encryptText !== "function" ||
      typeof this.crypto.decryptText !== "function" ||
      typeof this.crypto.configureSecurity !== "function" ||
      typeof this.crypto.getSecurityStatus !== "function" ||
      typeof this.crypto.createSecurityConfig !== "function" ||
      typeof this.crypto.unlockWithMasterPassword !== "function"
    ) {
      console.error("ConfigService: Required functions are not available");
      return false;
    }

    // 初始化 JSON Schema 验证器
    this._initializeValidator();

    // 设置配置文件路径
    try {
      this.mainConfigPath = this._getMainConfigPath();
      this._configCache = null;
      this._lastSerializedConfig = null;
      this._log(
        `ConfigService initialized. Main config path: ${this.mainConfigPath}`,
        "INFO",
      );
      this._initialized = true;
      return true;
    } catch (error) {
      this._log(
        `ConfigService: Error setting paths during init - ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  /**
   * 初始化 Ajv 验证器并定义配置的 JSON Schema
   */
  _initializeValidator() {
    this.ajv = new Ajv({ allErrors: true, useDefaults: true, strict: false });
    addFormats(this.ajv);

    // 连接配置验证 Schema
    this.validators.connection = this.ajv.compile({
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
    this.validators.aiSettings = this.ajv.compile({
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
      },
      required: ["configs"],
      default: { configs: [], current: null },
    });

    // UI 设置验证 Schema
    this.validators.uiSettings = this.ajv.compile({
      type: "object",
      properties: {
        language: { type: "string", default: "zh-CN" },
        fontSize: { type: "number", minimum: 10, maximum: 30, default: 14 },
        editorFont: { type: "string", default: "system" },
        darkMode: { type: "boolean", default: true },
        sidebarPosition: {
          type: "string",
          enum: ["left", "right"],
          default: "right",
        },
        terminalFont: { type: "string", default: "Fira Code" },
        terminalFontSize: {
          type: "number",
          minimum: 10,
          maximum: 30,
          default: 14,
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
  }

  /**
   * 验证数据是否符合指定的 Schema
   * @param {string} schemaName - Schema 名称
   * @param {*} data - 待验证的数据
   * @returns {boolean} 验证是否通过
   */
  _validate(schemaName, data) {
    const validator = this.validators[schemaName];
    if (!validator) {
      this._log(
        `ConfigService: No validator found for schema: ${schemaName}`,
        "WARN",
      );
      return true; // 如果没有验证器，默认通过
    }

    const valid = validator(data);
    if (!valid) {
      this._log(
        `ConfigService: Validation failed for ${schemaName}: ${JSON.stringify(validator.errors)}`,
        "ERROR",
      );
    }
    return valid;
  }

  /**
   * 记录日志
   * @param {string} message - 日志消息
   * @param {string} level - 日志级别
   */
  _log(message, level = "INFO") {
    if (this.logger && typeof this.logger.logToFile === "function") {
      this.logger.logToFile(message, level);
    }
  }

  /**
   * 获取主配置文件路径
   * @returns {string} 配置文件路径
   */
  _getMainConfigPath() {
    if (!this.app) {
      throw new Error("Electron app instance is required");
    }

    return getConfigPath(this.app);
  }

  /**
   * 获取默认安全设置
   * @param {Object} existingSecurity - 现有安全配置
   * @returns {Object} 安全设置
   */
  _getDefaultSecuritySettings(existingSecurity = {}) {
    const masterPasswordEnabled =
      existingSecurity?.masterPasswordEnabled === true &&
      typeof existingSecurity?.masterPasswordVerifier === "string" &&
      existingSecurity.masterPasswordVerifier.trim() !== "";

    return this.crypto.createSecurityConfig({
      currentSecurity: existingSecurity,
      masterPasswordEnabled,
      masterPassword: "",
    });
  }

  _getConfigBackupDirectory() {
    return getConfigBackupDirectory(this.app);
  }

  _formatTimestampForFile(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, "-");
  }

  _safeJsonStringify(config) {
    return JSON.stringify(config, null, 2);
  }

  _ensureDirectory(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  _createConfigBackup(reason = "manual") {
    if (!this.mainConfigPath || !fs.existsSync(this.mainConfigPath)) {
      return null;
    }

    const backupDir = this._getConfigBackupDirectory();
    this._ensureDirectory(backupDir);
    const normalizedReason = String(reason || "manual")
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 40);
    const backupPath = path.join(
      backupDir,
      `config.${this._formatTimestampForFile()}.${normalizedReason}.json`,
    );
    fs.copyFileSync(this.mainConfigPath, backupPath);
    this._cleanupOldConfigBackups();
    this._log(`ConfigService: Backup created at ${backupPath}`, "INFO");
    return backupPath;
  }

  _cleanupOldConfigBackups() {
    const backupDir = this._getConfigBackupDirectory();
    if (!fs.existsSync(backupDir)) {
      return;
    }

    const backupFiles = fs
      .readdirSync(backupDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          /^config\..+\.[a-zA-Z0-9_-]+\.json$/.test(entry.name),
      )
      .map((entry) => ({
        name: entry.name,
        path: path.join(backupDir, entry.name),
        mtimeMs: fs.statSync(path.join(backupDir, entry.name)).mtimeMs,
      }))
      .sort((left, right) => right.mtimeMs - left.mtimeMs);

    backupFiles.slice(MAX_CONFIG_BACKUPS).forEach((entry) => {
      try {
        fs.unlinkSync(entry.path);
      } catch (error) {
        this._log(
          `ConfigService: Failed to remove old backup ${entry.name} - ${error.message}`,
          "WARN",
        );
      }
    });
  }

  /**
   * 构建默认配置对象
   * @returns {Object} 默认配置
   */
  _buildDefaultConfig() {
    return {
      schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
      security: this.crypto.createSecurityConfig(),
      connections: [],
      uiSettings: {
        language: "zh-CN",
        fontSize: 14,
        editorFont: "system",
        darkMode: true,
        sidebarPosition: "right",
        terminalFont: "Fira Code",
        terminalFontSize: 14,
        performance: {},
        externalEditor: {},
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
      },
      aiSettings: {
        configs: [],
        current: null,
      },
      logSettings: {
        level: "INFO",
        maxFileSize: 5242880,
        maxFiles: 5,
        compressOldLogs: true,
        cleanupInterval: 24,
      },
      shortcutCommands: "{}",
      commandHistory: {
        compressed: false,
        data: [],
      },
      topConnections: [],
      lastConnections: [],
    };
  }

  _normalizeConfigShape(config) {
    const defaultConfig = this._buildDefaultConfig();
    const source = config && typeof config === "object" ? config : {};
    const normalized = {
      ...defaultConfig,
      ...source,
      schemaVersion: CURRENT_CONFIG_SCHEMA_VERSION,
      uiSettings: {
        ...defaultConfig.uiSettings,
        ...(source.uiSettings && typeof source.uiSettings === "object"
          ? source.uiSettings
          : {}),
      },
      aiSettings:
        source.aiSettings && typeof source.aiSettings === "object"
          ? source.aiSettings
          : defaultConfig.aiSettings,
      logSettings: {
        ...defaultConfig.logSettings,
        ...(source.logSettings && typeof source.logSettings === "object"
          ? source.logSettings
          : {}),
      },
      connections: Array.isArray(source.connections)
        ? source.connections
        : defaultConfig.connections,
      topConnections: Array.isArray(source.topConnections)
        ? source.topConnections
        : defaultConfig.topConnections,
      lastConnections: Array.isArray(source.lastConnections)
        ? source.lastConnections
        : defaultConfig.lastConnections,
      commandHistory:
        source.commandHistory !== undefined
          ? source.commandHistory
          : defaultConfig.commandHistory,
      shortcutCommands:
        source.shortcutCommands !== undefined
          ? source.shortcutCommands
          : defaultConfig.shortcutCommands,
    };

    if (
      source.uiSettings &&
      typeof source.uiSettings === "object" &&
      source.uiSettings.onboarding === undefined
    ) {
      normalized.uiSettings.onboarding = {
        completed: true,
        completedAt: null,
        version: 1,
        inferredFromExistingConfig: true,
      };
    }

    return {
      config: normalized,
      changed:
        this._safeJsonStringify(source) !== this._safeJsonStringify(normalized),
    };
  }

  /**
   * 确保配置中包含安全配置
   * @param {Object} config - 原始配置
   * @returns {{config: Object, changed: boolean}} 归一化结果
   */
  _ensureSecurityConfig(config) {
    const normalizedConfig =
      config && typeof config === "object" ? { ...config } : {};
    const existingSecurity =
      normalizedConfig.security && typeof normalizedConfig.security === "object"
        ? normalizedConfig.security
        : {};
    const existingMode =
      typeof existingSecurity.mode === "string" ? existingSecurity.mode : "";
    const randomKey =
      typeof existingSecurity.randomKey === "string"
        ? existingSecurity.randomKey.trim()
        : "";
    const masterPasswordEnabled =
      existingSecurity.masterPasswordEnabled === true;
    const masterPasswordVerifier =
      masterPasswordEnabled &&
      typeof existingSecurity.masterPasswordVerifier === "string"
        ? existingSecurity.masterPasswordVerifier.trim()
        : "";

    let nextSecurity = null;
    if (masterPasswordEnabled && randomKey && masterPasswordVerifier) {
      nextSecurity = {
        mode: this.crypto.SECURITY_MODE_MASTER_PASSWORD,
        randomKey,
        masterPasswordEnabled: true,
        masterPasswordVerifier,
        kdf:
          existingSecurity.kdf && typeof existingSecurity.kdf === "object"
            ? existingSecurity.kdf
            : {
                algorithm: "scrypt",
                version: this.crypto.KDF_VERSION,
                ...this.crypto.SCRYPT_PARAMS,
              },
      };
    } else if (
      existingMode === this.crypto.SECURITY_MODE_LEGACY_RANDOM_KEY ||
      randomKey
    ) {
      nextSecurity = {
        mode: this.crypto.SECURITY_MODE_LEGACY_RANDOM_KEY,
        randomKey,
        masterPasswordEnabled: false,
        masterPasswordVerifier: "",
        kdf: null,
      };
    } else {
      nextSecurity = this.crypto.createSecurityConfig({
        currentSecurity: existingSecurity,
        masterPasswordEnabled: false,
      });
    }

    normalizedConfig.security = nextSecurity;

    return {
      config: normalizedConfig,
      changed:
        JSON.stringify(existingSecurity || {}) !== JSON.stringify(nextSecurity),
    };
  }

  /**
   * 将安全配置应用到运行时加密上下文
   * @param {Object} security - 安全配置
   */
  _applySecuritySettings(security) {
    this.crypto.configureSecurity(security);
  }

  _readConfigFromDisk() {
    const data = fs.readFileSync(this.mainConfigPath, "utf8");
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("config.json must contain a JSON object");
    }
    return parsed;
  }

  _writeRawConfig(config) {
    const serialized = this._safeJsonStringify(config);
    const tempPath = `${this.mainConfigPath}.tmp-${process.pid}`;
    fs.writeFileSync(tempPath, serialized, "utf8");
    fs.renameSync(tempPath, this.mainConfigPath);
    this._configCache = this._cloneConfig(config);
    this._lastSerializedConfig = serialized;
    return true;
  }

  _recoverCorruptedConfig(error) {
    const corruptBackup = this._createConfigBackup("corrupt-json");
    const defaultConfig = this._buildDefaultConfig();
    this._writeRawConfig(defaultConfig);
    this._applySecuritySettings(defaultConfig.security);
    this._log(
      `ConfigService: config.json was corrupt and has been replaced. Backup: ${corruptBackup || "not-created"}. Error: ${error.message}`,
      "ERROR",
    );
    return defaultConfig;
  }

  _reEncryptSensitiveDataWithSecurity(config, nextSecurity) {
    this._applySecuritySettings(nextSecurity);
    const nextConfig = {
      ...config,
      security: nextSecurity,
      connections: this._processConnectionsForSave(config.connections || []),
      topConnections: this._processConnectionsForSave(
        config.topConnections || [],
      ),
      lastConnections: this._processConnectionsForSave(
        config.lastConnections || [],
      ),
      aiSettings: this._processAISettingsForSave(config.aiSettings || {}),
    };
    return nextConfig;
  }

  _upgradeLegacyCredentialSecurity(config) {
    const security = config?.security || {};
    if (security.mode !== this.crypto.SECURITY_MODE_LEGACY_RANDOM_KEY) {
      return { config, changed: false };
    }

    this._applySecuritySettings(security);
    const decryptedConfig = {
      ...config,
      connections: this._processConnectionsForLoad(config.connections || []),
      topConnections: this._processConnectionsForLoad(
        config.topConnections || [],
      ),
      lastConnections: this._processConnectionsForLoad(
        config.lastConnections || [],
      ),
      aiSettings: this._processAISettingsForLoad(config.aiSettings || {}),
    };
    const nextSecurity = this.crypto.createSecurityConfig();
    const nextConfig = this._reEncryptSensitiveDataWithSecurity(
      decryptedConfig,
      nextSecurity,
    );
    this._log(
      "ConfigService: Upgraded legacy randomKey credential storage to safeStorage.",
      "INFO",
    );
    return { config: nextConfig, changed: true };
  }

  /**
   * 初始化主配置文件（如果不存在则创建）
   */
  initializeMainConfig() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Call init() first.",
        "ERROR",
      );
      return;
    }

    try {
      if (!fs.existsSync(this.mainConfigPath)) {
        const defaultConfig = this._buildDefaultConfig();

        this._writeRawConfig(defaultConfig);
        this._applySecuritySettings(defaultConfig.security);
        this._log("ConfigService: Main config file created.", "INFO");
        return;
      }

      this._createConfigBackup("startup");

      let config;
      try {
        config = this._readConfigFromDisk();
      } catch (error) {
        this._recoverCorruptedConfig(error);
        return;
      }

      const shapeResult = this._normalizeConfigShape(config);
      const securityResult = this._ensureSecurityConfig(shapeResult.config);
      const upgradeResult = this._upgradeLegacyCredentialSecurity(
        securityResult.config,
      );
      const normalizedConfig = upgradeResult.config;
      const changed =
        shapeResult.changed || securityResult.changed || upgradeResult.changed;

      if (changed) {
        this._writeRawConfig(normalizedConfig);
        this._log("ConfigService: config.json normalized in place.", "INFO");
      } else {
        this._configCache = this._cloneConfig(normalizedConfig);
        this._lastSerializedConfig = JSON.stringify(normalizedConfig, null, 2);
      }

      this._applySecuritySettings(normalizedConfig.security);
    } catch (error) {
      this._log(
        `ConfigService: Failed to initialize main config - ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 深拷贝配置对象，避免缓存被外部引用意外修改
   * @param {Object} config - 原始配置对象
   * @returns {Object} 拷贝后的配置对象
   */
  _cloneConfig(config) {
    if (!config || typeof config !== "object") {
      return {};
    }

    try {
      return JSON.parse(JSON.stringify(config));
    } catch {
      return {};
    }
  }

  /**
   * 读取配置文件
   * @param {boolean} forceRefresh - 是否强制从磁盘刷新
   * @returns {Object} 配置对象
   */
  _readConfig(forceRefresh = false) {
    if (!this.mainConfigPath) {
      this._log("ConfigService: Main config path not set.", "ERROR");
      throw new Error("Main config path not set");
    }

    if (!forceRefresh && this._configCache) {
      return this._cloneConfig(this._configCache);
    }

    try {
      if (fs.existsSync(this.mainConfigPath)) {
        const parsed = this._readConfigFromDisk();
        const { config: shapedConfig } = this._normalizeConfigShape(parsed);
        this._configCache = shapedConfig;
        this._lastSerializedConfig = this._safeJsonStringify(shapedConfig);
        return this._cloneConfig(shapedConfig);
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to read config - ${error.message}`,
        "ERROR",
      );
      return this._cloneConfig(this._recoverCorruptedConfig(error));
    }

    const defaultConfig = this._buildDefaultConfig();
    this._writeRawConfig(defaultConfig);
    return this._cloneConfig(defaultConfig);
  }

  /**
   * 写入配置文件
   * @param {Object} config - 配置对象
   * @returns {boolean} 是否成功
   */
  _writeConfig(config) {
    if (!this.mainConfigPath) {
      this._log("ConfigService: Main config path not set.", "ERROR");
      return false;
    }

    try {
      const { config: normalizedConfig } = this._normalizeConfigShape(config);
      const serialized = this._safeJsonStringify(normalizedConfig);

      // 内容未变更时跳过写盘，减少高频同步 I/O
      if (this._lastSerializedConfig === serialized) {
        this._configCache = this._cloneConfig(normalizedConfig);
        return true;
      }

      const previousSerialized = fs.existsSync(this.mainConfigPath)
        ? fs.readFileSync(this.mainConfigPath, "utf8")
        : null;

      try {
        this._writeRawConfig(normalizedConfig);
      } catch (writeError) {
        if (previousSerialized !== null) {
          fs.writeFileSync(this.mainConfigPath, previousSerialized, "utf8");
          this._configCache = JSON.parse(previousSerialized);
          this._lastSerializedConfig = previousSerialized;
          this._log(
            `ConfigService: Write failed and previous config was restored - ${writeError.message}`,
            "ERROR",
          );
        }
        throw writeError;
      }

      return true;
    } catch (error) {
      this._log(
        `ConfigService: Failed to write config - ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  /**
   * 凭据存储是否处于锁定状态
   * @returns {boolean} 是否锁定
   */
  _isCredentialStoreLocked() {
    const status =
      this.crypto && typeof this.crypto.getSecurityStatus === "function"
        ? this.crypto.getSecurityStatus()
        : null;
    return Boolean(status?.requiresUnlock);
  }

  /**
   * 处理连接配置以进行加密保存
   * @param {Array} items - 连接项数组
   * @returns {Array} 处理后的连接项
   */
  _processConnectionsForSave(items) {
    if (!this.crypto || !this.crypto.encryptText) {
      this._log(
        "ConfigService: encryptText function is not available.",
        "ERROR",
      );
      return items;
    }

    return items.map((item) => {
      const result = { ...item };
      if (item.type === "connection") {
        if (item._passwordAlreadyEncrypted === true) {
          result.password = item.password || "";
        } else if (item.password) {
          result.password = this.crypto.encryptText(item.password);
        }
        delete result._passwordAlreadyEncrypted;
        delete result._preservePassword;
        if (item.privateKeyPath) {
          result.privateKeyPath = this.crypto.encryptText(item.privateKeyPath);
        }
      }
      if (item.type === "group" && Array.isArray(item.items)) {
        result.items = this._processConnectionsForSave(item.items);
      }
      return result;
    });
  }

  /**
   * 处理连接配置以进行解密加载
   * @param {Array} items - 连接项数组
   * @returns {Array} 处理后的连接项
   */
  _processConnectionsForLoad(items) {
    if (!this.crypto || !this.crypto.decryptText) {
      this._log(
        "ConfigService: decryptText function is not available.",
        "ERROR",
      );
      return items;
    }

    const storeLocked = this._isCredentialStoreLocked();

    return items.map((item) => {
      const result = { ...item };
      if (item.type === "connection") {
        if (item.password) {
          try {
            const decryptedPassword = this.crypto.decryptText(item.password);
            if (decryptedPassword === null && !storeLocked) {
              this._log("ConfigService: Failed to decrypt password.", "WARN");
            }
            result.password = decryptedPassword ?? "";
          } catch (error) {
            if (!storeLocked) {
              this._log(
                `ConfigService: Failed to decrypt password - ${error.message}`,
                "WARN",
              );
            }
            result.password = "";
          }
        }
        if (item.privateKeyPath) {
          try {
            const decryptedPrivateKeyPath = this.crypto.decryptText(
              item.privateKeyPath,
            );
            if (decryptedPrivateKeyPath === null && !storeLocked) {
              this._log(
                "ConfigService: Failed to decrypt privateKeyPath.",
                "WARN",
              );
            }
            result.privateKeyPath = decryptedPrivateKeyPath ?? "";
          } catch (error) {
            if (!storeLocked) {
              this._log(
                `ConfigService: Failed to decrypt privateKeyPath - ${error.message}`,
                "WARN",
              );
            }
            result.privateKeyPath = "";
          }
        }
      }
      if (item.type === "group" && Array.isArray(item.items)) {
        result.items = this._processConnectionsForLoad(item.items);
      }
      return result;
    });
  }

  _mergePreservedConnectionCredentials(items, existingItems) {
    if (!Array.isArray(items)) {
      return items;
    }

    const existingById = new Map();
    const collectExisting = (entries = []) => {
      entries.forEach((entry) => {
        if (!entry || typeof entry !== "object") {
          return;
        }
        if (entry.type === "connection" && entry.id) {
          existingById.set(entry.id, entry);
          return;
        }
        if (entry.type === "group") {
          collectExisting(entry.items || []);
        }
      });
    };

    collectExisting(existingItems || []);

    const mergeItems = (entries = []) =>
      entries.map((entry) => {
        if (!entry || typeof entry !== "object") {
          return entry;
        }

        const result = { ...entry };
        if (result.type === "connection") {
          const existing = result.id ? existingById.get(result.id) : null;
          if (result._preservePassword === true && existing) {
            result.password = existing.password || "";
            result._passwordAlreadyEncrypted = true;
          }
          delete result._preservePassword;
        }

        if (result.type === "group" && Array.isArray(result.items)) {
          result.items = mergeItems(result.items);
        }

        return result;
      });

    return mergeItems(items);
  }

  /**
   * 加载连接配置
   * @returns {Array} 连接配置数组
   */
  loadConnections() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load connections.",
        "ERROR",
      );
      return [];
    }

    try {
      const config = this._readConfig();
      if (config.connections && Array.isArray(config.connections)) {
        return this._processConnectionsForLoad(config.connections);
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load connections - ${error.message}`,
        "ERROR",
      );
    }
    return [];
  }

  _findConnectionById(items, connectionId) {
    if (!Array.isArray(items) || !connectionId) {
      return null;
    }

    for (const item of items) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (item.type === "connection" && item.id === connectionId) {
        return item;
      }

      if (item.type === "group") {
        const found = this._findConnectionById(item.items || [], connectionId);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  getSavedConnectionPassword(connectionId) {
    if (!this._initialized) {
      return {
        success: false,
        error: "Config service is not initialized",
      };
    }

    const securityStatus = this.getCredentialSecurityStatus();
    if (securityStatus.masterPasswordEnabled !== true) {
      return {
        success: false,
        error: "Master password is not configured",
        code: "MASTER_PASSWORD_NOT_CONFIGURED",
        status: securityStatus,
      };
    }

    if (securityStatus.requiresUnlock || securityStatus.unlocked === false) {
      return {
        success: false,
        error: "Credential store is locked",
        code: "CREDENTIAL_STORE_LOCKED",
        status: securityStatus,
      };
    }

    try {
      const config = this._readConfig();
      const connection = this._findConnectionById(
        config.connections || [],
        connectionId,
      );

      if (!connection) {
        return {
          success: false,
          error: "Connection not found",
          code: "CONNECTION_NOT_FOUND",
          status: securityStatus,
        };
      }

      if (!connection.password) {
        return {
          success: true,
          password: "",
          status: securityStatus,
        };
      }

      const password = this.crypto.decryptText(connection.password);
      if (password === null) {
        return {
          success: false,
          error: "Failed to decrypt password",
          code: "DECRYPT_FAILED",
          status: securityStatus,
        };
      }

      return {
        success: true,
        password,
        status: securityStatus,
      };
    } catch (error) {
      this._log(
        `ConfigService: Failed to get saved connection password - ${error.message}`,
        "ERROR",
      );
      return {
        success: false,
        error: error.message,
        code: "PASSWORD_READ_FAILED",
        status: securityStatus,
      };
    }
  }

  /**
   * 保存连接配置
   * @param {Array} connections - 连接配置数组
   * @returns {boolean} 是否成功
   */
  saveConnections(connections) {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot save connections.",
        "ERROR",
      );
      return false;
    }

    try {
      const config = this._readConfig();
      const mergedConnections = this._mergePreservedConnectionCredentials(
        connections,
        config.connections || [],
      );
      const processedConnections =
        this._processConnectionsForSave(mergedConnections);
      config.connections = processedConnections;

      if (this._writeConfig(config)) {
        this._log("ConfigService: Connections saved successfully.", "INFO");
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save connections - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }

  /**
   * 处理 AI 设置以进行解密加载
   * @param {Object} settings - 原始 AI 设置
   * @returns {Object} 处理后的 AI 设置
   */
  _processAISettingsForLoad(settings) {
    const result =
      settings && typeof settings === "object" ? { ...settings } : {};
    const storeLocked = this._isCredentialStoreLocked();

    if (Array.isArray(result.configs)) {
      result.configs = result.configs.map((cfg) => {
        if (cfg.apiKey && this.crypto.decryptText) {
          try {
            const decryptedApiKey = this.crypto.decryptText(cfg.apiKey);
            if (decryptedApiKey === null && !storeLocked) {
              this._log(
                `ConfigService: Failed to decrypt API key for config ${cfg.name || cfg.id}.`,
                "WARN",
              );
            }
            return { ...cfg, apiKey: decryptedApiKey ?? "" };
          } catch (error) {
            if (!storeLocked) {
              this._log(
                `ConfigService: Failed to decrypt API key for config ${cfg.name || cfg.id} - ${error.message}`,
                "WARN",
              );
            }
            return { ...cfg, apiKey: "" };
          }
        }
        return cfg;
      });
    }

    if (result.current && result.current.apiKey && this.crypto.decryptText) {
      try {
        const decryptedCurrentApiKey = this.crypto.decryptText(
          result.current.apiKey,
        );
        if (decryptedCurrentApiKey === null && !storeLocked) {
          this._log(
            "ConfigService: Failed to decrypt current API key.",
            "WARN",
          );
        }
        result.current = {
          ...result.current,
          apiKey: decryptedCurrentApiKey ?? "",
        };
      } catch (error) {
        if (!storeLocked) {
          this._log(
            `ConfigService: Failed to decrypt current API key - ${error.message}`,
            "WARN",
          );
        }
        result.current = {
          ...result.current,
          apiKey: "",
        };
      }
    }

    return result;
  }

  /**
   * 处理 AI 设置以进行加密保存
   * @param {Object} settings - AI 设置
   * @returns {Object} 处理后的 AI 设置
   */
  _processAISettingsForSave(settings) {
    const settingsToSave =
      settings && typeof settings === "object" ? { ...settings } : {};
    const normalizeApiConfig = (cfg) => {
      if (!cfg || typeof cfg !== "object") {
        return cfg;
      }

      const { maxTokens, temperature, ...normalized } = cfg;
      void maxTokens;
      void temperature;

      if (typeof normalized.model === "string") {
        normalized.model = normalized.model.trim();
        if (normalized.model) {
          normalized.name = normalized.model;
        }
      }

      return normalized;
    };

    if (Array.isArray(settingsToSave.configs)) {
      settingsToSave.configs = settingsToSave.configs.map(normalizeApiConfig);
    }

    if (settingsToSave.current) {
      settingsToSave.current = normalizeApiConfig(settingsToSave.current);
    }

    if (Array.isArray(settingsToSave.configs) && this.crypto.encryptText) {
      settingsToSave.configs = settingsToSave.configs.map((cfg) => {
        if (cfg.apiKey) {
          try {
            const encryptedKey = this.crypto.encryptText(cfg.apiKey);
            return { ...cfg, apiKey: encryptedKey };
          } catch (error) {
            this._log(
              `ConfigService: Failed to encrypt API key for config ${cfg.name || cfg.id} - ${error.message}`,
              "WARN",
            );
            return { ...cfg, apiKey: "" };
          }
        }
        return cfg;
      });
    }

    if (
      settingsToSave.current &&
      settingsToSave.current.apiKey &&
      this.crypto.encryptText
    ) {
      try {
        settingsToSave.current = {
          ...settingsToSave.current,
          apiKey: this.crypto.encryptText(settingsToSave.current.apiKey),
        };
      } catch (error) {
        this._log(
          `ConfigService: Failed to encrypt current API key - ${error.message}`,
          "WARN",
        );
        settingsToSave.current = {
          ...settingsToSave.current,
          apiKey: "",
        };
      }
    }

    return settingsToSave;
  }

  /**
   * 加载 AI 设置
   * @returns {Object} AI 设置对象
   */
  loadAISettings() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load AI settings.",
        "ERROR",
      );
      return {
        configs: [],
        current: { apiUrl: "", apiKey: "", model: "", streamEnabled: true },
      };
    }

    this._log(
      `ConfigService: Loading AI settings from ${this.mainConfigPath}`,
      "INFO",
    );

    try {
      const config = this._readConfig();
      if (config.aiSettings) {
        const settings = this._processAISettingsForLoad(config.aiSettings);

        // 验证加载的数据
        this._validate("aiSettings", settings);

        this._log(
          `ConfigService: Loaded ${settings.configs?.length || 0} AI configurations.`,
          "INFO",
        );
        return settings;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load AI settings - ${error.message}`,
        "ERROR",
      );
    }

    return {
      configs: [],
      current: { apiUrl: "", apiKey: "", model: "", streamEnabled: true },
    };
  }

  /**
   * 保存 AI 设置
   * @param {Object} settings - AI 设置对象
   * @returns {boolean} 是否成功
   */
  saveAISettings(settings) {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot save AI settings.",
        "ERROR",
      );
      return false;
    }

    this._log(
      `ConfigService: Saving AI settings to ${this.mainConfigPath}`,
      "INFO",
    );

    try {
      const config = this._readConfig();
      const settingsToSave = this._processAISettingsForSave(settings);

      config.aiSettings = settingsToSave;

      if (this._writeConfig(config)) {
        this._log("ConfigService: AI settings saved successfully.", "INFO");
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save AI settings - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }

  /**
   * 加载 UI 设置
   * @returns {Object} UI 设置对象
   */
  loadUISettings() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load UI settings.",
        "ERROR",
      );
      return this._getDefaultUISettings();
    }

    try {
      const config = this._readConfig();
      if (config.uiSettings) {
        const settings = {
          ...this._getDefaultUISettings(),
          ...config.uiSettings,
        };
        this._validate("uiSettings", settings);
        return settings;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load UI settings - ${error.message}`,
        "ERROR",
      );
    }
    return this._getDefaultUISettings();
  }

  /**
   * 获取默认 UI 设置
   * @returns {Object} 默认 UI 设置
   */
  _getDefaultUISettings() {
    return {
      language: "zh-CN",
      fontSize: 14,
      editorFont: "system",
      darkMode: true,
      sidebarPosition: "right",
      terminalFont: "Fira Code",
      terminalFontSize: 14,
      performance: {},
      externalEditor: {},
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
    };
  }

  /**
   * 保存 UI 设置
   * @param {Object} settings - UI 设置对象
   * @returns {boolean} 是否成功
   */
  saveUISettings(settings) {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot save UI settings.",
        "ERROR",
      );
      return false;
    }

    try {
      const config = this._readConfig();
      const mergedSettings = {
        ...this._getDefaultUISettings(),
        ...(config.uiSettings || {}),
        ...settings,
      };

      // 验证数据
      if (!this._validate("uiSettings", mergedSettings)) {
        return false;
      }

      config.uiSettings = mergedSettings;

      if (this._writeConfig(config)) {
        this._log("ConfigService: UI settings saved successfully.", "INFO");
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save UI settings - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }

  /**
   * 加载日志设置
   * @returns {Object} 日志设置对象
   */
  loadLogSettings() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load log settings.",
        "ERROR",
      );
      return this._getDefaultLogSettings();
    }

    try {
      const config = this._readConfig();
      if (config.logSettings) {
        const settings = {
          ...this._getDefaultLogSettings(),
          ...config.logSettings,
        };
        this._validate("logSettings", settings);
        return settings;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load log settings - ${error.message}`,
        "ERROR",
      );
    }
    return this._getDefaultLogSettings();
  }

  /**
   * 获取默认日志设置
   * @returns {Object} 默认日志设置
   */
  _getDefaultLogSettings() {
    return {
      level: "INFO",
      maxFileSize: 5242880,
      maxFiles: 5,
      compressOldLogs: true,
      cleanupInterval: 24,
    };
  }

  /**
   * 保存日志设置
   * @param {Object} settings - 日志设置对象
   * @returns {boolean} 是否成功
   */
  saveLogSettings(settings) {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot save log settings.",
        "ERROR",
      );
      return false;
    }

    try {
      // 验证数据
      if (!this._validate("logSettings", settings)) {
        return false;
      }

      const config = this._readConfig();
      config.logSettings = settings;

      if (this._writeConfig(config)) {
        this._log("ConfigService: Log settings saved successfully.", "INFO");
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save log settings - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }

  /**
   * 加载快捷命令
   * @returns {Object} 快捷命令对象
   */
  loadShortcutCommands() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load shortcut commands.",
        "ERROR",
      );
      return {};
    }

    try {
      const config = this._readConfig();
      if (config.shortcutCommands) {
        if (typeof config.shortcutCommands === "string") {
          return JSON.parse(config.shortcutCommands);
        }
        return config.shortcutCommands;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load shortcut commands - ${error.message}`,
        "ERROR",
      );
    }
    return {};
  }

  /**
   * 保存快捷命令
   * @param {Object} commands - 快捷命令对象
   * @returns {boolean} 是否成功
   */
  saveShortcutCommands(commands) {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot save shortcut commands.",
        "ERROR",
      );
      return false;
    }

    try {
      const config = this._readConfig();
      config.shortcutCommands = JSON.stringify(commands);

      if (this._writeConfig(config)) {
        this._log(
          "ConfigService: Shortcut commands saved successfully.",
          "INFO",
        );
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save shortcut commands - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }

  /**
   * 压缩命令历史
   * @param {Array} history - 命令历史数组
   * @returns {Object} 压缩后的数据对象
   */
  _compressCommandHistory(history) {
    try {
      const jsonStr = JSON.stringify(history);
      const compressed = zlib.gzipSync(jsonStr);
      const base64Data = compressed.toString("base64");

      const result = {
        compressed: true,
        data: base64Data,
        originalSize: Buffer.byteLength(jsonStr, "utf8"),
        compressedSize: compressed.length,
        timestamp: Date.now(),
      };

      this._log(
        `ConfigService: Command history compressed from ${result.originalSize} to ${result.compressedSize} bytes (${((result.compressedSize / result.originalSize) * 100).toFixed(2)}%)`,
        "INFO",
      );

      return result;
    } catch (error) {
      this._log(
        `ConfigService: Failed to compress command history - ${error.message}`,
        "ERROR",
      );
      return {
        compressed: false,
        data: history,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 解压命令历史
   * @param {Object} data - 压缩后的数据对象
   * @returns {Array} 命令历史数组
   */
  _decompressCommandHistory(data) {
    try {
      if (!data.compressed) {
        return Array.isArray(data.data) ? data.data : [];
      }

      const compressed = Buffer.from(data.data, "base64");
      const decompressed = zlib.gunzipSync(compressed);
      const jsonStr = decompressed.toString("utf8");
      return JSON.parse(jsonStr);
    } catch (error) {
      this._log(
        `ConfigService: Failed to decompress command history - ${error.message}`,
        "ERROR",
      );
      return [];
    }
  }

  _stripSensitiveConnectionFields(items) {
    if (!Array.isArray(items)) {
      return [];
    }

    return items.map((item) => {
      const result = { ...item };
      if (result.type === "connection") {
        delete result.password;
        delete result.passphrase;
        delete result.privateKey;
        delete result.privateKeyPath;
      }
      if (result.type === "group") {
        result.items = this._stripSensitiveConnectionFields(result.items || []);
      }
      return result;
    });
  }

  _stripSensitiveAIFields(settings) {
    const result =
      settings && typeof settings === "object" ? { ...settings } : {};

    if (Array.isArray(result.configs)) {
      result.configs = result.configs.map((cfg) => ({
        ...cfg,
        apiKey: "",
      }));
    }

    if (result.current && typeof result.current === "object") {
      result.current = {
        ...result.current,
        apiKey: "",
      };
    }

    return result;
  }

  clearLocalConfigData(options = {}) {
    if (!this._initialized) {
      throw new Error("Config service is not initialized");
    }

    const sections = Array.isArray(options?.sections) ? options.sections : [];
    const sectionSet = new Set(sections);
    const config = this._readConfig(true);
    const nextConfig = this._cloneConfig(config);

    this._createConfigBackup("before-clear");

    if (sectionSet.has("connections")) {
      nextConfig.connections = [];
      nextConfig.topConnections = [];
      nextConfig.lastConnections = [];
    }

    if (sectionSet.has("credentials")) {
      nextConfig.connections = this._stripSensitiveConnectionFields(
        nextConfig.connections || [],
      );
      nextConfig.topConnections = this._stripSensitiveConnectionFields(
        nextConfig.topConnections || [],
      );
      nextConfig.lastConnections = this._stripSensitiveConnectionFields(
        nextConfig.lastConnections || [],
      );
      nextConfig.aiSettings = this._stripSensitiveAIFields(
        nextConfig.aiSettings || {},
      );
    }

    if (sectionSet.has("commandHistory")) {
      nextConfig.commandHistory = this._compressCommandHistory([]);
    }

    if (sectionSet.has("shortcutCommands")) {
      nextConfig.shortcutCommands = "{}";
    }

    if (sectionSet.has("uiSettings")) {
      nextConfig.uiSettings = this._getDefaultUISettings();
    }

    if (sectionSet.has("aiSettings")) {
      nextConfig.aiSettings = {
        configs: [],
        current: null,
      };
    }

    if (!this._writeConfig(nextConfig)) {
      throw new Error("Failed to clear local config data");
    }

    return {
      success: true,
      sections,
    };
  }

  /**
   * 加载命令历史
   * @returns {Array} 命令历史数组
   */
  loadCommandHistory() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load command history.",
        "ERROR",
      );
      return [];
    }

    try {
      const config = this._readConfig();
      if (config.commandHistory) {
        // 支持旧格式（未压缩的数组）
        if (Array.isArray(config.commandHistory)) {
          this._log(
            "ConfigService: Migrating old command history format to compressed format.",
            "INFO",
          );
          return config.commandHistory;
        }
        // 新格式（压缩对象）
        return this._decompressCommandHistory(config.commandHistory);
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load command history - ${error.message}`,
        "ERROR",
      );
    }
    return [];
  }

  /**
   * 保存命令历史
   * @param {Array} history - 命令历史数组
   * @returns {boolean} 是否成功
   */
  saveCommandHistory(history) {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot save command history.",
        "ERROR",
      );
      return false;
    }

    try {
      const config = this._readConfig();
      config.commandHistory = this._compressCommandHistory(history);

      if (this._writeConfig(config)) {
        this._log("ConfigService: Command history saved successfully.", "INFO");
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save command history - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }

  /**
   * 加载热门连接
   * @returns {Array} 热门连接数组
   */
  loadTopConnections() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load top connections.",
        "ERROR",
      );
      return [];
    }

    try {
      const config = this._readConfig();
      if (config.topConnections && Array.isArray(config.topConnections)) {
        return this._processConnectionsForLoad(config.topConnections);
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load top connections - ${error.message}`,
        "ERROR",
      );
    }
    return [];
  }

  /**
   * 保存热门连接
   * @param {Array} connections - 热门连接数组
   * @returns {boolean} 是否成功
   */
  saveTopConnections(connections) {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot save top connections.",
        "ERROR",
      );
      return false;
    }

    try {
      const config = this._readConfig();
      config.topConnections = this._processConnectionsForSave(connections);

      if (this._writeConfig(config)) {
        this._log("ConfigService: Top connections saved successfully.", "INFO");
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save top connections - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }

  /**
   * 加载最近连接
   * @returns {Array} 最近连接数组
   */
  loadLastConnections() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load last connections.",
        "ERROR",
      );
      return [];
    }

    try {
      const config = this._readConfig();
      if (config.lastConnections && Array.isArray(config.lastConnections)) {
        return this._processConnectionsForLoad(config.lastConnections);
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load last connections - ${error.message}`,
        "ERROR",
      );
    }
    return [];
  }

  /**
   * 保存最近连接
   * @param {Array} connections - 最近连接数组
   * @returns {boolean} 是否成功
   */
  saveLastConnections(connections) {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot save last connections.",
        "ERROR",
      );
      return false;
    }

    try {
      const config = this._readConfig();
      config.lastConnections = this._processConnectionsForSave(connections);

      if (this._writeConfig(config)) {
        this._log(
          "ConfigService: Last connections saved successfully.",
          "INFO",
        );
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save last connections - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }

  /**
   * 加载凭据安全状态
   * @returns {Object} 安全状态
   */
  getCredentialSecurityStatus() {
    if (!this._initialized) {
      return {
        randomKeyConfigured: false,
        masterPasswordEnabled: false,
        unlocked: true,
        requiresUnlock: false,
      };
    }

    try {
      const config = this._readConfig();
      const { config: normalizedConfig } = this._ensureSecurityConfig(config);
      const runtimeStatus = this.crypto.getSecurityStatus();

      return {
        randomKeyConfigured: Boolean(normalizedConfig?.security?.randomKey),
        masterPasswordEnabled:
          normalizedConfig?.security?.masterPasswordEnabled === true,
        unlocked: runtimeStatus?.unlocked !== false,
        requiresUnlock: Boolean(runtimeStatus?.requiresUnlock),
      };
    } catch (error) {
      this._log(
        `ConfigService: Failed to get credential security status - ${error.message}`,
        "ERROR",
      );
      return {
        randomKeyConfigured: false,
        masterPasswordEnabled: false,
        unlocked: true,
        requiresUnlock: false,
      };
    }
  }

  /**
   * 解锁凭据存储
   * @param {string} masterPassword - 主密码
   * @returns {{success: boolean, error?: string, status?: Object}} 结果
   */
  unlockCredentialStore(masterPassword) {
    if (!this._initialized) {
      return {
        success: false,
        error: "Config service is not initialized",
      };
    }

    try {
      const config = this._readConfig();
      const { config: normalizedConfig } = this._ensureSecurityConfig(config);
      this._applySecuritySettings(normalizedConfig.security);
      const result = this.crypto.unlockWithMasterPassword(masterPassword);

      if (!result.success) {
        return result;
      }

      return {
        success: true,
        status: this.getCredentialSecurityStatus(),
      };
    } catch (error) {
      this._log(
        `ConfigService: Failed to unlock credential store - ${error.message}`,
        "ERROR",
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 锁定凭据存储
   * @returns {{success: boolean, error?: string, status?: Object}} 结果
   */
  lockCredentialStore() {
    if (!this._initialized) {
      return {
        success: false,
        error: "Config service is not initialized",
      };
    }

    try {
      const config = this._readConfig();
      const { config: normalizedConfig } = this._ensureSecurityConfig(config);
      this._applySecuritySettings(normalizedConfig.security);
      const status = this.crypto.lockCredentialStore();
      return {
        success: true,
        status: {
          randomKeyConfigured: Boolean(normalizedConfig?.security?.randomKey),
          masterPasswordEnabled:
            normalizedConfig?.security?.masterPasswordEnabled === true,
          unlocked: status?.unlocked !== false,
          requiresUnlock: Boolean(status?.requiresUnlock),
        },
      };
    } catch (error) {
      this._log(
        `ConfigService: Failed to lock credential store - ${error.message}`,
        "ERROR",
      );
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * 更新凭据安全配置，并按新配置重加密敏感字段
   * @param {Object} options - 安全配置
   * @returns {Object} 更新后的安全状态
   */
  updateCredentialSecurity(options = {}) {
    if (!this._initialized) {
      throw new Error("Config service is not initialized");
    }

    const masterPasswordEnabled = options?.masterPasswordEnabled === true;
    const masterPassword =
      typeof options?.masterPassword === "string" ? options.masterPassword : "";

    if (masterPasswordEnabled && !masterPassword) {
      throw new Error("Master password is required");
    }

    const decryptedConnections = this.loadConnections();
    const decryptedTopConnections = this.loadTopConnections();
    const decryptedLastConnections = this.loadLastConnections();
    const decryptedAISettings = this.loadAISettings();

    const config = this._readConfig(true);
    const { config: normalizedConfig } = this._ensureSecurityConfig(config);
    const nextSecurity = masterPasswordEnabled
      ? this.crypto.createSecurityConfig({
          currentSecurity: normalizedConfig.security,
          masterPasswordEnabled: true,
          masterPassword,
        })
      : this.crypto.createSecurityConfig({
          currentSecurity: normalizedConfig.security,
          masterPasswordEnabled: false,
        });

    normalizedConfig.security = nextSecurity;
    this._applySecuritySettings(nextSecurity);

    if (masterPasswordEnabled) {
      const unlockResult = this.crypto.unlockWithMasterPassword(masterPassword);
      if (!unlockResult.success) {
        throw new Error(unlockResult.error || "Invalid master password");
      }
    }

    normalizedConfig.connections =
      this._processConnectionsForSave(decryptedConnections);
    normalizedConfig.topConnections = this._processConnectionsForSave(
      decryptedTopConnections,
    );
    normalizedConfig.lastConnections = this._processConnectionsForSave(
      decryptedLastConnections,
    );
    normalizedConfig.aiSettings =
      this._processAISettingsForSave(decryptedAISettings);

    if (!this._writeConfig(normalizedConfig)) {
      throw new Error("Failed to persist security settings");
    }

    return this.getCredentialSecurityStatus();
  }

  /**
   * 检查服务是否已初始化
   * @returns {boolean} 是否已初始化
   */
  isInitialized() {
    return this._initialized;
  }

  /**
   * 获取配置项
   * @param {string} key - 配置键名
   * @returns {*} 配置值
   */
  get(key) {
    if (!key) return undefined;
    if (!this._initialized) {
      this._log("ConfigService: Service not initialized for get().", "ERROR");
      return undefined;
    }
    try {
      const config = this._readConfig();
      return config?.[key];
    } catch (error) {
      this._log(
        `ConfigService: Failed to get config key '${key}' - ${error.message}`,
        "ERROR",
      );
      return undefined;
    }
  }

  /**
   * 设置配置项
   * @param {string} key - 配置键名
   * @param {*} value - 配置值
   * @returns {boolean} 是否成功
   */
  set(key, value) {
    if (!key) return false;
    if (!this._initialized) {
      this._log("ConfigService: Service not initialized for set().", "ERROR");
      return false;
    }
    try {
      const config = this._readConfig() || {};
      config[key] = value;
      const success = this._writeConfig(config);
      if (success) {
        this._log(
          `ConfigService: Saved config key '${key}' via set().`,
          "INFO",
        );
      }
      return success;
    } catch (error) {
      this._log(
        `ConfigService: Failed to set config key '${key}' - ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }
}

// 导出单例实例
module.exports = new ConfigService();
