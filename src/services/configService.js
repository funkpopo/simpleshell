const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

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
      typeof this.crypto.decryptText !== "function"
    ) {
      console.error("ConfigService: Required functions are not available");
      return false;
    }

    // 初始化 JSON Schema 验证器
    this._initializeValidator();

    // 设置配置文件路径
    try {
      this.mainConfigPath = this._getMainConfigPath();
      this._log(
        `ConfigService initialized. Main config path: ${this.mainConfigPath}`,
        "INFO"
      );
      this._initialized = true;
      return true;
    } catch (error) {
      this._log(
        `ConfigService: Error setting paths during init - ${error.message}`,
        "ERROR"
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
        "WARN"
      );
      return true; // 如果没有验证器，默认通过
    }

    const valid = validator(data);
    if (!valid) {
      this._log(
        `ConfigService: Validation failed for ${schemaName}: ${JSON.stringify(validator.errors)}`,
        "ERROR"
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
      const fallbackCwd = process.cwd ? process.cwd() : ".";
      return path.join(fallbackCwd, "config.json_fallback_no_app");
    }

    try {
      const isDev = process.env.NODE_ENV === "development" || !this.app.isPackaged;
      if (isDev) {
        return path.join(process.cwd(), "config.json");
      } else {
        return path.join(path.dirname(this.app.getPath("exe")), "config.json");
      }
    } catch (error) {
      this._log(
        `ConfigService: Error getting main config path - ${error.message}`,
        "ERROR"
      );
      return path.join(
        this.app.getPath("userData"),
        "config.json_fallback_general_error"
      );
    }
  }

  /**
   * 初始化主配置文件（如果不存在则创建）
   */
  initializeMainConfig() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Call init() first.",
        "ERROR"
      );
      return;
    }

    try {
      if (!fs.existsSync(this.mainConfigPath)) {
        const defaultConfig = {
          connections: [],
          uiSettings: {
            language: "zh-CN",
            fontSize: 14,
            editorFont: "system",
            darkMode: true,
            terminalFont: "Fira Code",
            terminalFontSize: 14,
            performance: {},
            externalEditor: {},
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

        fs.writeFileSync(
          this.mainConfigPath,
          JSON.stringify(defaultConfig, null, 2),
          "utf8"
        );
        this._log("ConfigService: Main config file created.", "INFO");
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to initialize main config - ${error.message}`,
        "ERROR"
      );
    }
  }

  /**
   * 读取配置文件
   * @returns {Object} 配置对象
   */
  _readConfig() {
    if (!this.mainConfigPath) {
      this._log("ConfigService: Main config path not set.", "ERROR");
      return {};
    }

    try {
      if (fs.existsSync(this.mainConfigPath)) {
        const data = fs.readFileSync(this.mainConfigPath, "utf8");
        return JSON.parse(data);
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to read config - ${error.message}`,
        "ERROR"
      );
    }
    return {};
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
      fs.writeFileSync(
        this.mainConfigPath,
        JSON.stringify(config, null, 2),
        "utf8"
      );
      return true;
    } catch (error) {
      this._log(
        `ConfigService: Failed to write config - ${error.message}`,
        "ERROR"
      );
      return false;
    }
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
        "ERROR"
      );
      return items;
    }

    return items.map((item) => {
      const result = { ...item };
      if (item.type === "connection") {
        if (item.password) {
          result.password = this.crypto.encryptText(item.password);
        }
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
        "ERROR"
      );
      return items;
    }

    return items.map((item) => {
      const result = { ...item };
      if (item.type === "connection") {
        if (item.password) {
          try {
            result.password = this.crypto.decryptText(item.password);
          } catch (error) {
            this._log(
              `ConfigService: Failed to decrypt password - ${error.message}`,
              "WARN"
            );
            result.password = "";
          }
        }
        if (item.privateKeyPath) {
          try {
            result.privateKeyPath = this.crypto.decryptText(
              item.privateKeyPath
            );
          } catch (error) {
            this._log(
              `ConfigService: Failed to decrypt privateKeyPath - ${error.message}`,
              "WARN"
            );
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

  /**
   * 加载连接配置
   * @returns {Array} 连接配置数组
   */
  loadConnections() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load connections.",
        "ERROR"
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
        "ERROR"
      );
    }
    return [];
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
        "ERROR"
      );
      return false;
    }

    try {
      const config = this._readConfig();
      const processedConnections = this._processConnectionsForSave(connections);
      config.connections = processedConnections;

      if (this._writeConfig(config)) {
        this._log("ConfigService: Connections saved successfully.", "INFO");
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save connections - ${error.message}`,
        "ERROR"
      );
    }
    return false;
  }

  /**
   * 加载 AI 设置
   * @returns {Object} AI 设置对象
   */
  loadAISettings() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load AI settings.",
        "ERROR"
      );
      return {
        configs: [],
        current: { apiUrl: "", apiKey: "", model: "", streamEnabled: true },
      };
    }

    this._log(
      `ConfigService: Loading AI settings from ${this.mainConfigPath}`,
      "INFO"
    );

    try {
      const config = this._readConfig();
      if (config.aiSettings) {
        const settings = { ...config.aiSettings };

        // 解密 configs 数组中的 API keys
        if (settings.configs && Array.isArray(settings.configs)) {
          settings.configs = settings.configs.map((cfg) => {
            if (cfg.apiKey && this.crypto.decryptText) {
              try {
                return { ...cfg, apiKey: this.crypto.decryptText(cfg.apiKey) };
              } catch (error) {
                this._log(
                  `ConfigService: Failed to decrypt API key for config ${cfg.name || cfg.id} - ${error.message}`,
                  "WARN"
                );
                return { ...cfg, apiKey: "" };
              }
            }
            return cfg;
          });
        }

        // 解密当前配置的 API key
        if (settings.current && settings.current.apiKey && this.crypto.decryptText) {
          try {
            settings.current.apiKey = this.crypto.decryptText(
              settings.current.apiKey
            );
          } catch (error) {
            this._log(
              `ConfigService: Failed to decrypt current API key - ${error.message}`,
              "WARN"
            );
            settings.current.apiKey = "";
          }
        }

        // 验证加载的数据
        this._validate("aiSettings", settings);

        this._log(
          `ConfigService: Loaded ${settings.configs?.length || 0} AI configurations.`,
          "INFO"
        );
        return settings;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load AI settings - ${error.message}`,
        "ERROR"
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
        "ERROR"
      );
      return false;
    }

    this._log(
      `ConfigService: Saving AI settings to ${this.mainConfigPath}`,
      "INFO"
    );

    try {
      const config = this._readConfig();
      const settingsToSave = { ...settings };

      // 加密 configs 数组中的 API keys
      if (
        settingsToSave.configs &&
        Array.isArray(settingsToSave.configs) &&
        this.crypto.encryptText
      ) {
        settingsToSave.configs = settingsToSave.configs.map((cfg) => {
          if (cfg.apiKey) {
            try {
              const encryptedKey = this.crypto.encryptText(cfg.apiKey);
              return { ...cfg, apiKey: encryptedKey };
            } catch (error) {
              this._log(
                `ConfigService: Failed to encrypt API key for config ${cfg.name || cfg.id} - ${error.message}`,
                "WARN"
              );
              return { ...cfg, apiKey: "" };
            }
          }
          return cfg;
        });
      }

      // 加密当前配置的 API key
      if (
        settingsToSave.current &&
        settingsToSave.current.apiKey &&
        this.crypto.encryptText
      ) {
        try {
          settingsToSave.current.apiKey = this.crypto.encryptText(
            settingsToSave.current.apiKey
          );
        } catch (error) {
          this._log(
            `ConfigService: Failed to encrypt current API key - ${error.message}`,
            "WARN"
          );
          settingsToSave.current.apiKey = "";
        }
      }

      config.aiSettings = settingsToSave;

      if (this._writeConfig(config)) {
        this._log("ConfigService: AI settings saved successfully.", "INFO");
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save AI settings - ${error.message}`,
        "ERROR"
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
        "ERROR"
      );
      return this._getDefaultUISettings();
    }

    try {
      const config = this._readConfig();
      if (config.uiSettings) {
        const settings = { ...this._getDefaultUISettings(), ...config.uiSettings };
        this._validate("uiSettings", settings);
        return settings;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load UI settings - ${error.message}`,
        "ERROR"
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
      terminalFont: "Fira Code",
      terminalFontSize: 14,
      performance: {},
      externalEditor: {},
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
        "ERROR"
      );
      return false;
    }

    try {
      // 验证数据
      if (!this._validate("uiSettings", settings)) {
        return false;
      }

      const config = this._readConfig();
      config.uiSettings = settings;

      if (this._writeConfig(config)) {
        this._log("ConfigService: UI settings saved successfully.", "INFO");
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save UI settings - ${error.message}`,
        "ERROR"
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
        "ERROR"
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
        "ERROR"
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
        "ERROR"
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
        "ERROR"
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
        "ERROR"
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
        "ERROR"
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
        "ERROR"
      );
      return false;
    }

    try {
      const config = this._readConfig();
      config.shortcutCommands = JSON.stringify(commands);

      if (this._writeConfig(config)) {
        this._log(
          "ConfigService: Shortcut commands saved successfully.",
          "INFO"
        );
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save shortcut commands - ${error.message}`,
        "ERROR"
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
        "INFO"
      );

      return result;
    } catch (error) {
      this._log(
        `ConfigService: Failed to compress command history - ${error.message}`,
        "ERROR"
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
        "ERROR"
      );
      return [];
    }
  }

  /**
   * 加载命令历史
   * @returns {Array} 命令历史数组
   */
  loadCommandHistory() {
    if (!this._initialized) {
      this._log(
        "ConfigService: Service not initialized. Cannot load command history.",
        "ERROR"
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
            "INFO"
          );
          return config.commandHistory;
        }
        // 新格式（压缩对象）
        return this._decompressCommandHistory(config.commandHistory);
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to load command history - ${error.message}`,
        "ERROR"
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
        "ERROR"
      );
      return false;
    }

    try {
      const config = this._readConfig();
      config.commandHistory = this._compressCommandHistory(history);

      if (this._writeConfig(config)) {
        this._log(
          "ConfigService: Command history saved successfully.",
          "INFO"
        );
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save command history - ${error.message}`,
        "ERROR"
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
        "ERROR"
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
        "ERROR"
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
        "ERROR"
      );
      return false;
    }

    try {
      const config = this._readConfig();
      config.topConnections = this._processConnectionsForSave(connections);

      if (this._writeConfig(config)) {
        this._log(
          "ConfigService: Top connections saved successfully.",
          "INFO"
        );
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save top connections - ${error.message}`,
        "ERROR"
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
        "ERROR"
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
        "ERROR"
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
        "ERROR"
      );
      return false;
    }

    try {
      const config = this._readConfig();
      config.lastConnections = this._processConnectionsForSave(connections);

      if (this._writeConfig(config)) {
        this._log(
          "ConfigService: Last connections saved successfully.",
          "INFO"
        );
        return true;
      }
    } catch (error) {
      this._log(
        `ConfigService: Failed to save last connections - ${error.message}`,
        "ERROR"
      );
    }
    return false;
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
      this._log(`ConfigService: Failed to get config key '${key}' - ${error.message}`, "ERROR");
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
        this._log(`ConfigService: Saved config key '${key}' via set().`, "INFO");
      }
      return success;
    } catch (error) {
      this._log(`ConfigService: Failed to set config key '${key}' - ${error.message}`, "ERROR");
      return false;
    }
  }
}

// 导出单例实例
module.exports = new ConfigService();
