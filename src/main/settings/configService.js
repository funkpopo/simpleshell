const serviceDependencies = require("../utils/serviceDependencies");
const createConfigBackups = require("./domains/configBackups");
const createConnectionSettings = require("./domains/connectionSettings");
const createAiSettings = require("./domains/aiSettings");
const createApplicationSettings = require("./domains/applicationSettings");
const createConfigMaintenance = require("./domains/configMaintenance");
const createCredentialSecurity = require("./domains/credentialSecurity");
const fs = require("fs");
const path = require("path");
const {
  filterCommandHistory,
} = require("../../shared/security/commandPrivacy");
const {
  compressCommandHistory,
  decompressCommandHistory,
} = require("./commandHistoryCodec");
const { createConfigValidators } = require("./configSchemas");
const {
  getConfigBackupDirectory,
  getConfigPath,
  migrateLegacyConfigIfNeeded,
} = require("../utils/appPaths");
const { buildFileTimestamp } = require("../utils/textUtils");

const CURRENT_CONFIG_SCHEMA_VERSION = 1;
const MAX_CONFIG_BACKUPS = 50;

class ConfigService {
  constructor() {
    this._configBackups = createConfigBackups(
      serviceDependencies(this, {
        methods: ["_log", "_readConfig"],
        fields: ["app", "mainConfigPath"],
      }),
      {
        getConfigBackupDirectory,
        buildFileTimestamp,
        fs,
        path,
        MAX_CONFIG_BACKUPS,
      },
    );
    this._connectionSettings = createConnectionSettings(
      serviceDependencies(this, {
        methods: [
          "_log",
          "_isCredentialStoreLocked",
          "_loadSection",
          "_saveSection",
          "getCredentialSecurityStatus",
          "_readConfig",
        ],
        fields: ["crypto", "_initialized"],
      }),
      {},
    );
    this._aiSettings = createAiSettings(
      serviceDependencies(this, {
        methods: [
          "_isCredentialStoreLocked",
          "_log",
          "_loadSection",
          "_validate",
          "_saveSection",
        ],
        fields: ["crypto", "mainConfigPath"],
      }),
      {},
    );
    this._applicationSettings = createApplicationSettings(
      serviceDependencies(this, {
        methods: ["_loadSection", "_validate", "_saveSection", "_log"],
        fields: [],
      }),
      {
        filterCommandHistory,
        decompressCommandHistory,
        compressCommandHistory,
      },
    );
    this._configMaintenance = createConfigMaintenance(
      serviceDependencies(this, {
        methods: [
          "_readConfig",
          "_cloneConfig",
          "_createConfigBackup",
          "_log",
          "_getDefaultUISettings",
          "_writeConfig",
        ],
        fields: ["_initialized"],
      }),
      { compressCommandHistory },
    );
    this._credentialSecurity = createCredentialSecurity(
      serviceDependencies(this, {
        methods: [
          "_processConnectionsForSave",
          "_processAISettingsForSave",
          "_processConnectionsForLoad",
          "_processAISettingsForLoad",
          "_log",
          "_readConfig",
          "loadConnections",
          "loadTopConnections",
          "loadLastConnections",
          "loadAISettings",
          "_writeConfig",
        ],
        fields: ["crypto", "_initialized"],
      }),
      {},
    );
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
    Object.assign(this, createConfigValidators());

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

  _log(message, level = "INFO") {
    if (this.logger && typeof this.logger.logToFile === "function") {
      this.logger.logToFile(message, level);
    }
  }

  _getMainConfigPath() {
    if (!this.app) {
      throw new Error("Electron app instance is required");
    }

    return getConfigPath(this.app);
  }

  _getDefaultSecuritySettings(...args) {
    return this._credentialSecurity._getDefaultSecuritySettings(...args);
  }

  _getConfigBackupDirectory(...args) {
    return this._configBackups._getConfigBackupDirectory(...args);
  }

  _formatTimestampForFile(...args) {
    return this._configBackups._formatTimestampForFile(...args);
  }

  _safeJsonStringify(...args) {
    return this._configBackups._safeJsonStringify(...args);
  }

  _ensureDirectory(...args) {
    return this._configBackups._ensureDirectory(...args);
  }

  _createConfigBackup(...args) {
    return this._configBackups._createConfigBackup(...args);
  }

  _cleanupOldConfigBackups(...args) {
    return this._configBackups._cleanupOldConfigBackups(...args);
  }

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
        terminalLineHeight: 1.0,
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
        backupRetentionDays: 30,
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
      portForwards: [],
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
      portForwards: Array.isArray(source.portForwards)
        ? source.portForwards
        : defaultConfig.portForwards,
      commandHistory:
        source.commandHistory !== undefined
          ? source.commandHistory
          : defaultConfig.commandHistory,
      shortcutCommands:
        source.shortcutCommands !== undefined
          ? source.shortcutCommands
          : defaultConfig.shortcutCommands,
    };

    // 清理历史弱网/网络韧性 UI 配置（策略已固定，无用户开关）
    if (normalized.uiSettings && typeof normalized.uiSettings === "object") {
      delete normalized.uiSettings.networkResilience;
      delete normalized.uiSettings.networkResilienceMode;
    }

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

  _ensureSecurityConfig(...args) {
    return this._credentialSecurity._ensureSecurityConfig(...args);
  }

  _applySecuritySettings(...args) {
    return this._credentialSecurity._applySecuritySettings(...args);
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

  _reEncryptSensitiveDataWithSecurity(...args) {
    return this._credentialSecurity._reEncryptSensitiveDataWithSecurity(
      ...args,
    );
  }

  _upgradeLegacyCredentialSecurity(...args) {
    return this._credentialSecurity._upgradeLegacyCredentialSecurity(...args);
  }

  _countConnections(...args) {
    return this._connectionSettings._countConnections(...args);
  }

  initializeMainConfig() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Call init() first.",
        "ERROR",
      );
      return;
    }

    try {
      // 打包版：把旧版 exe 旁的 config.json 迁到 userData，避免升级后“读不到配置”
      if (this.app) {
        const migration = migrateLegacyConfigIfNeeded(this.app);
        if (migration.migrated) {
          this._log(
            `ConfigService: Migrated legacy config from ${migration.from} to ${migration.to}`,
            "INFO",
          );
        } else if (migration.error) {
          this._log(
            `ConfigService: Legacy config migration failed (${migration.from} -> ${migration.to}): ${migration.error}`,
            "WARN",
          );
        }
      }

      // 确保配置目录存在（userData 下首次运行）
      try {
        fs.mkdirSync(path.dirname(this.mainConfigPath), { recursive: true });
      } catch (mkdirError) {
        this._log(
          `ConfigService: Failed to ensure config directory - ${mkdirError.message}`,
          "WARN",
        );
      }

      if (!fs.existsSync(this.mainConfigPath)) {
        const defaultConfig = this._buildDefaultConfig();

        this._writeRawConfig(defaultConfig);
        this._applySecuritySettings(defaultConfig.security);
        this._log(
          `ConfigService: Main config file created at ${this.mainConfigPath}`,
          "INFO",
        );
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

      const connectionCount = this._countConnections(
        normalizedConfig.connections,
      );
      const lastConnectionCount = Array.isArray(
        normalizedConfig.lastConnections,
      )
        ? normalizedConfig.lastConnections.length
        : 0;
      this._log(
        `ConfigService: Loaded config from ${this.mainConfigPath} (connections=${connectionCount}, lastConnections=${lastConnectionCount}, language=${normalizedConfig.uiSettings?.language || "n/a"})`,
        "INFO",
      );
    } catch (error) {
      this._log(
        `ConfigService: Failed to initialize main config - ${error.message}`,
        "ERROR",
      );
    }
  }

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

  _isCredentialStoreLocked(...args) {
    return this._credentialSecurity._isCredentialStoreLocked(...args);
  }

  _processConnectionsForSave(...args) {
    return this._connectionSettings._processConnectionsForSave(...args);
  }

  _processConnectionsForLoad(...args) {
    return this._connectionSettings._processConnectionsForLoad(...args);
  }

  _mergePreservedConnectionCredentials(...args) {
    return this._connectionSettings._mergePreservedConnectionCredentials(
      ...args,
    );
  }

  _loadSection(label, { read, fallback, onStart }) {
    if (!this._initialized) {
      this._log(
        `ConfigService: Service not initialized. Cannot load ${label}.`,
        "ERROR",
      );
      return fallback();
    }

    if (onStart) {
      onStart();
    }

    try {
      const config = this._readConfig();
      const result = read(config);
      if (result !== undefined) {
        return result;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load ${label} - ${error.message}`,
        "ERROR",
      );
    }
    return fallback();
  }

  _saveSection(label, { write, preValidate, onStart }) {
    if (!this._initialized) {
      this._log(
        `ConfigService: Service not initialized. Cannot save ${label}.`,
        "ERROR",
      );
      return false;
    }

    if (onStart) {
      onStart();
    }

    try {
      if (preValidate && !preValidate()) {
        return false;
      }

      const config = this._readConfig();
      if (write(config) === false) {
        return false;
      }

      if (this._writeConfig(config)) {
        this._log(
          `ConfigService: ${label.charAt(0).toUpperCase()}${label.slice(1)} saved successfully.`,
          "INFO",
        );
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save ${label} - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }

  loadConnections(...args) {
    return this._connectionSettings.loadConnections(...args);
  }

  loadPortForwards(...args) {
    return this._connectionSettings.loadPortForwards(...args);
  }

  savePortForwards(...args) {
    return this._connectionSettings.savePortForwards(...args);
  }

  _findConnectionById(...args) {
    return this._connectionSettings._findConnectionById(...args);
  }

  getSavedConnectionPassword(...args) {
    return this._connectionSettings.getSavedConnectionPassword(...args);
  }

  saveConnections(...args) {
    return this._connectionSettings.saveConnections(...args);
  }

  _decryptAISecret(...args) {
    return this._aiSettings._decryptAISecret(...args);
  }

  _encryptAISecret(...args) {
    return this._aiSettings._encryptAISecret(...args);
  }

  _processAISettingsForLoad(...args) {
    return this._aiSettings._processAISettingsForLoad(...args);
  }

  _processAISettingsForSave(...args) {
    return this._aiSettings._processAISettingsForSave(...args);
  }

  loadAISettings(...args) {
    return this._aiSettings.loadAISettings(...args);
  }

  saveAISettings(...args) {
    return this._aiSettings.saveAISettings(...args);
  }

  loadUISettings(...args) {
    return this._applicationSettings.loadUISettings(...args);
  }

  _getDefaultUISettings(...args) {
    return this._applicationSettings._getDefaultUISettings(...args);
  }

  saveUISettings(...args) {
    return this._applicationSettings.saveUISettings(...args);
  }

  loadLogSettings(...args) {
    return this._applicationSettings.loadLogSettings(...args);
  }

  _getDefaultLogSettings(...args) {
    return this._applicationSettings._getDefaultLogSettings(...args);
  }

  saveLogSettings(...args) {
    return this._applicationSettings.saveLogSettings(...args);
  }

  loadShortcutCommands(...args) {
    return this._applicationSettings.loadShortcutCommands(...args);
  }

  saveShortcutCommands(...args) {
    return this._applicationSettings.saveShortcutCommands(...args);
  }

  _stripSensitiveConnectionFields(...args) {
    return this._configMaintenance._stripSensitiveConnectionFields(...args);
  }

  _stripSensitiveAIFields(...args) {
    return this._configMaintenance._stripSensitiveAIFields(...args);
  }

  clearLocalConfigData(...args) {
    return this._configMaintenance.clearLocalConfigData(...args);
  }

  loadCommandHistory(...args) {
    return this._applicationSettings.loadCommandHistory(...args);
  }

  saveCommandHistory(...args) {
    return this._applicationSettings.saveCommandHistory(...args);
  }

  loadTopConnections(...args) {
    return this._connectionSettings.loadTopConnections(...args);
  }

  saveTopConnections(...args) {
    return this._connectionSettings.saveTopConnections(...args);
  }

  loadLastConnections(...args) {
    return this._connectionSettings.loadLastConnections(...args);
  }

  saveLastConnections(...args) {
    return this._connectionSettings.saveLastConnections(...args);
  }

  getCredentialSecurityStatus(...args) {
    return this._credentialSecurity.getCredentialSecurityStatus(...args);
  }

  unlockCredentialStore(...args) {
    return this._credentialSecurity.unlockCredentialStore(...args);
  }

  lockCredentialStore(...args) {
    return this._credentialSecurity.lockCredentialStore(...args);
  }

  updateCredentialSecurity(...args) {
    return this._credentialSecurity.updateCredentialSecurity(...args);
  }

  isInitialized() {
    return this._initialized;
  }

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
