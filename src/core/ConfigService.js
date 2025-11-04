const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

/**
 * 统一的配置服务类
 * 负责配置文件的读写、加解密、路径管理、版本校验
 */
class ConfigService {
  constructor() {
    // 依赖注入的实例
    this.app = null;
    this.logger = null;
    this.crypto = null;

    // 配置路径
    this.configPath = null;
    this.logDirectory = null;

    // 内存缓存
    this.config = null;

    // JSON Schema 校验器
    this.validator = null;
    this.schema = null;
  }

  /**
   * 初始化配置服务
   * @param {Object} app - Electron app 实例
   * @param {Object} logger - 日志模块 { logToFile: function }
   * @param {Object} crypto - 加密模块 { encryptText: function, decryptText: function }
   */
  init(app, logger, crypto) {
    if (!app || !logger || !crypto) {
      throw new Error("ConfigService: Required dependencies are missing");
    }

    if (!logger.logToFile || !crypto.encryptText || !crypto.decryptText) {
      throw new Error("ConfigService: Required functions are not available");
    }

    this.app = app;
    this.logger = logger;
    this.crypto = crypto;

    // 初始化配置路径
    this._initPaths();

    // 加载 JSON Schema
    this._initValidator();

    this.logger.logToFile(
      `ConfigService initialized. Config path: ${this.configPath}`,
      "INFO",
    );
  }

  /**
   * 初始化配置文件路径和日志目录
   * @private
   */
  _initPaths() {
    if (!this.app) {
      throw new Error("ConfigService: App instance not available");
    }

    try {
      const isDev =
        process.env.NODE_ENV === "development" || !this.app.isPackaged;

      if (isDev) {
        // 开发环境：使用当前工作目录
        this.configPath = path.join(process.cwd(), "config.json");
        this.logDirectory = path.join(process.cwd(), "log");
      } else {
        // 生产环境：使用可执行文件所在目录
        const exeDir = path.dirname(this.app.getPath("exe"));
        this.configPath = path.join(exeDir, "config.json");
        this.logDirectory = path.join(exeDir, "log");
      }

      // 确保日志目录存在
      if (!fs.existsSync(this.logDirectory)) {
        fs.mkdirSync(this.logDirectory, { recursive: true });
      }

      // 确保配置文件目录存在
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
    } catch (error) {
      this.logger.logToFile(
        `ConfigService: Error initializing paths - ${error.message}`,
        "ERROR",
      );
      // 回退到 userData 目录
      this.configPath = path.join(this.app.getPath("userData"), "config.json");
      this.logDirectory = path.join(this.app.getPath("userData"), "log");
    }
  }

  /**
   * 初始化 JSON Schema 校验器
   * @private
   */
  _initValidator() {
    try {
      const schemaPath = path.join(__dirname, "config.schema.json");
      this.schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));

      this.validator = new Ajv({ allErrors: true, strict: false });
      addFormats(this.validator);
      this.validator.compile(this.schema);

      this.logger.logToFile(
        "ConfigService: JSON Schema validator initialized",
        "INFO",
      );
    } catch (error) {
      this.logger.logToFile(
        `ConfigService: Failed to initialize validator - ${error.message}`,
        "WARN",
      );
    }
  }

  /**
   * 校验配置数据
   * @param {Object} config - 配置对象
   * @returns {Object} { valid: boolean, errors: array }
   */
  validateConfig(config) {
    if (!this.validator || !this.schema) {
      this.logger.logToFile(
        "ConfigService: Validator not initialized, skipping validation",
        "WARN",
      );
      return { valid: true, errors: [] };
    }

    const validate = this.validator.compile(this.schema);
    const valid = validate(config);

    if (!valid) {
      this.logger.logToFile(
        `ConfigService: Configuration validation failed: ${JSON.stringify(validate.errors)}`,
        "ERROR",
      );
      return { valid: false, errors: validate.errors || [] };
    }

    return { valid: true, errors: [] };
  }

  /**
   * 加载配置文件（带校验）
   * @returns {Object} 配置对象
   */
  loadConfig() {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.logger.logToFile(
          "ConfigService: Config file does not exist, creating default",
          "WARN",
        );
        const defaultConfig = this._getDefaultConfig();
        this.saveConfig(defaultConfig);
        return defaultConfig;
      }

      const fileContent = fs.readFileSync(this.configPath, "utf8");
      let config = JSON.parse(fileContent);

      // 解密敏感字段
      config = this._decryptConfig(config);

      // 校验配置
      const validation = this.validateConfig(config);
      if (!validation.valid) {
        this.logger.logToFile(
          `ConfigService: Config validation failed with ${validation.errors.length} errors`,
          "ERROR",
        );

        // 备份损坏的配置文件
        const backupPath = `${this.configPath}.invalid.${Date.now()}`;
        fs.copyFileSync(this.configPath, backupPath);
        this.logger.logToFile(
          `ConfigService: Invalid config backed up to ${backupPath}`,
          "WARN",
        );

        // 尝试自动修复
        config = this._autoFixConfig(config);
        const revalidation = this.validateConfig(config);

        if (!revalidation.valid) {
          this.logger.logToFile(
            "ConfigService: Auto-fix failed, using default config",
            "ERROR",
          );
          config = this._getDefaultConfig();
        } else {
          this.logger.logToFile(
            "ConfigService: Config auto-fixed successfully",
            "INFO",
          );
          this.saveConfig(config);
        }
      }

      this.config = config;
      return config;
    } catch (error) {
      this.logger.logToFile(
        `ConfigService: Error loading config - ${error.message}`,
        "ERROR",
      );

      // 返回默认配置
      const defaultConfig = this._getDefaultConfig();
      this.config = defaultConfig;
      return defaultConfig;
    }
  }

  /**
   * 保存配置文件（带加密）
   * @param {Object} config - 配置对象
   */
  saveConfig(config) {
    try {
      // 校验配置
      const validation = this.validateConfig(config);
      if (!validation.valid) {
        this.logger.logToFile(
          `ConfigService: Cannot save invalid config: ${JSON.stringify(validation.errors)}`,
          "ERROR",
        );
        throw new Error("Configuration validation failed");
      }

      // 加密敏感字段
      const encryptedConfig = this._encryptConfig(config);

      // 确保目录存在
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      // 写入文件
      fs.writeFileSync(
        this.configPath,
        JSON.stringify(encryptedConfig, null, 2),
        "utf8",
      );

      this.config = config;
      this.logger.logToFile("ConfigService: Config saved successfully", "INFO");
    } catch (error) {
      this.logger.logToFile(
        `ConfigService: Error saving config - ${error.message}`,
        "ERROR",
      );
      throw error;
    }
  }

  /**
   * 加密配置中的敏感字段
   * @private
   * @param {Object} config - 配置对象
   * @returns {Object} 加密后的配置
   */
  _encryptConfig(config) {
    const encrypted = JSON.parse(JSON.stringify(config)); // 深拷贝

    // 加密连接密码和私钥路径
    if (Array.isArray(encrypted.connections)) {
      encrypted.connections = this._encryptConnections(encrypted.connections);
    }

    // 加密 AI API Keys
    if (encrypted.aiSettings) {
      if (encrypted.aiSettings.current && encrypted.aiSettings.current.apiKey) {
        encrypted.aiSettings.current.apiKey = this.crypto.encryptText(
          encrypted.aiSettings.current.apiKey,
        );
      }

      if (Array.isArray(encrypted.aiSettings.configs)) {
        encrypted.aiSettings.configs = encrypted.aiSettings.configs.map(
          (cfg) => {
            if (cfg.apiKey) {
              return {
                ...cfg,
                apiKey: this.crypto.encryptText(cfg.apiKey),
              };
            }
            return cfg;
          },
        );
      }
    }

    return encrypted;
  }

  /**
   * 递归加密连接项
   * @private
   */
  _encryptConnections(items) {
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
        result.items = this._encryptConnections(item.items);
      }

      return result;
    });
  }

  /**
   * 解密配置中的敏感字段
   * @private
   * @param {Object} config - 加密的配置对象
   * @returns {Object} 解密后的配置
   */
  _decryptConfig(config) {
    const decrypted = JSON.parse(JSON.stringify(config)); // 深拷贝

    // 解密连接密码和私钥路径
    if (Array.isArray(decrypted.connections)) {
      decrypted.connections = this._decryptConnections(decrypted.connections);
    }

    // 解密 AI API Keys
    if (decrypted.aiSettings) {
      if (decrypted.aiSettings.current && decrypted.aiSettings.current.apiKey) {
        try {
          decrypted.aiSettings.current.apiKey = this.crypto.decryptText(
            decrypted.aiSettings.current.apiKey,
          );
        } catch (error) {
          this.logger.logToFile(
            `ConfigService: Failed to decrypt current API key - ${error.message}`,
            "WARN",
          );
          decrypted.aiSettings.current.apiKey = "";
        }
      }

      if (Array.isArray(decrypted.aiSettings.configs)) {
        decrypted.aiSettings.configs = decrypted.aiSettings.configs.map(
          (cfg) => {
            if (cfg.apiKey) {
              try {
                return {
                  ...cfg,
                  apiKey: this.crypto.decryptText(cfg.apiKey),
                };
              } catch (error) {
                this.logger.logToFile(
                  `ConfigService: Failed to decrypt API key for config ${cfg.id} - ${error.message}`,
                  "WARN",
                );
                return { ...cfg, apiKey: "" };
              }
            }
            return cfg;
          },
        );
      }
    }

    return decrypted;
  }

  /**
   * 递归解密连接项
   * @private
   */
  _decryptConnections(items) {
    return items.map((item) => {
      const result = { ...item };

      if (item.type === "connection") {
        if (item.password) {
          try {
            result.password = this.crypto.decryptText(item.password);
          } catch (error) {
            this.logger.logToFile(
              `ConfigService: Failed to decrypt password for ${item.name} - ${error.message}`,
              "WARN",
            );
            result.password = "";
          }
        }
        if (item.privateKeyPath) {
          try {
            result.privateKeyPath = this.crypto.decryptText(
              item.privateKeyPath,
            );
          } catch (error) {
            this.logger.logToFile(
              `ConfigService: Failed to decrypt privateKeyPath for ${item.name} - ${error.message}`,
              "WARN",
            );
            result.privateKeyPath = "";
          }
        }
      }

      if (item.type === "group" && Array.isArray(item.items)) {
        result.items = this._decryptConnections(item.items);
      }

      return result;
    });
  }

  /**
   * 自动修复配置（补全缺失字段）
   * @private
   * @param {Object} config - 配置对象
   * @returns {Object} 修复后的配置
   */
  _autoFixConfig(config) {
    const defaultConfig = this._getDefaultConfig();
    const fixed = { ...config };

    // 补全顶级字段
    if (!Array.isArray(fixed.connections)) {
      fixed.connections = defaultConfig.connections;
    }
    if (!fixed.aiSettings || typeof fixed.aiSettings !== "object") {
      fixed.aiSettings = defaultConfig.aiSettings;
    }
    if (!fixed.uiSettings || typeof fixed.uiSettings !== "object") {
      fixed.uiSettings = defaultConfig.uiSettings;
    }
    if (!fixed.logSettings || typeof fixed.logSettings !== "object") {
      fixed.logSettings = defaultConfig.logSettings;
    }

    // 补全 aiSettings 子字段
    if (!fixed.aiSettings.current) {
      fixed.aiSettings.current = defaultConfig.aiSettings.current;
    }
    if (!Array.isArray(fixed.aiSettings.configs)) {
      fixed.aiSettings.configs = defaultConfig.aiSettings.configs;
    }

    // 补全 uiSettings 子字段
    if (!fixed.uiSettings.language) {
      fixed.uiSettings.language = defaultConfig.uiSettings.language;
    }
    if (!fixed.uiSettings.fontSize) {
      fixed.uiSettings.fontSize = defaultConfig.uiSettings.fontSize;
    }
    if (!fixed.uiSettings.terminalFont) {
      fixed.uiSettings.terminalFont = defaultConfig.uiSettings.terminalFont;
    }
    if (typeof fixed.uiSettings.darkMode !== "boolean") {
      fixed.uiSettings.darkMode = defaultConfig.uiSettings.darkMode;
    }

    // 补全 logSettings 子字段
    if (!fixed.logSettings.level) {
      fixed.logSettings.level = defaultConfig.logSettings.level;
    }
    if (!fixed.logSettings.maxFileSize) {
      fixed.logSettings.maxFileSize = defaultConfig.logSettings.maxFileSize;
    }
    if (!fixed.logSettings.maxFiles) {
      fixed.logSettings.maxFiles = defaultConfig.logSettings.maxFiles;
    }
    if (typeof fixed.logSettings.compressOldLogs !== "boolean") {
      fixed.logSettings.compressOldLogs =
        defaultConfig.logSettings.compressOldLogs;
    }
    if (!fixed.logSettings.cleanupIntervalDays) {
      fixed.logSettings.cleanupIntervalDays =
        defaultConfig.logSettings.cleanupIntervalDays;
    }

    // 补全其他字段
    if (!fixed.shortcutCommands) {
      fixed.shortcutCommands = defaultConfig.shortcutCommands;
    }
    if (!fixed.commandHistory) {
      fixed.commandHistory = defaultConfig.commandHistory;
    }
    if (!Array.isArray(fixed.topConnections)) {
      fixed.topConnections = defaultConfig.topConnections;
    }
    if (!Array.isArray(fixed.lastConnections)) {
      fixed.lastConnections = defaultConfig.lastConnections;
    }

    return fixed;
  }

  /**
   * 获取默认配置
   * @private
   * @returns {Object} 默认配置对象
   */
  _getDefaultConfig() {
    return {
      connections: [],
      aiSettings: {
        current: {
          apiUrl: "",
          apiKey: "",
          model: "",
        },
        configs: [],
      },
      uiSettings: {
        language: "zh-CN",
        fontSize: 14,
        terminalFont: "Fira Code",
        darkMode: true,
        performance: {
          imageSupported: true,
          cacheEnabled: true,
          webglEnabled: false,
        },
      },
      logSettings: {
        level: "INFO",
        maxFileSize: 5242880, // 5MB
        maxFiles: 5,
        compressOldLogs: true,
        cleanupIntervalDays: 7,
      },
      shortcutCommands: "{}",
      commandHistory: [],
      topConnections: [],
      lastConnections: [],
    };
  }

  /**
   * 获取配置路径
   * @returns {string} 配置文件路径
   */
  getConfigPath() {
    return this.configPath;
  }

  /**
   * 获取日志目录
   * @returns {string} 日志目录路径
   */
  getLogDirectory() {
    return this.logDirectory;
  }

  /**
   * 获取完整配置
   * @returns {Object} 配置对象
   */
  getConfig() {
    if (!this.config) {
      return this.loadConfig();
    }
    return this.config;
  }

  /**
   * 更新配置（部分更新）
   * @param {Object} updates - 要更新的配置字段
   */
  updateConfig(updates) {
    const currentConfig = this.getConfig();
    const newConfig = { ...currentConfig, ...updates };
    this.saveConfig(newConfig);
  }

  // ============ 兼容旧 API 的便捷方法 ============

  /**
   * 获取连接列表
   */
  getConnections() {
    return this.getConfig().connections || [];
  }

  /**
   * 保存连接列表
   */
  saveConnections(connections) {
    this.updateConfig({ connections });
  }

  /**
   * 获取 AI 设置
   */
  getAISettings() {
    return this.getConfig().aiSettings;
  }

  /**
   * 保存 AI 设置
   */
  saveAISettings(aiSettings) {
    this.updateConfig({ aiSettings });
  }

  /**
   * 获取 UI 设置
   */
  getUISettings() {
    return this.getConfig().uiSettings;
  }

  /**
   * 保存 UI 设置
   */
  saveUISettings(uiSettings) {
    this.updateConfig({ uiSettings });
  }

  /**
   * 获取日志设置
   */
  getLogSettings() {
    return this.getConfig().logSettings;
  }

  /**
   * 保存日志设置
   */
  saveLogSettings(logSettings) {
    this.updateConfig({ logSettings });
  }

  /**
   * 获取快捷命令
   */
  getShortcutCommands() {
    const config = this.getConfig();
    try {
      return JSON.parse(config.shortcutCommands || "{}");
    } catch (error) {
      this.logger.logToFile(
        `ConfigService: Failed to parse shortcut commands - ${error.message}`,
        "ERROR",
      );
      return {};
    }
  }

  /**
   * 保存快捷命令
   */
  saveShortcutCommands(commands) {
    this.updateConfig({ shortcutCommands: JSON.stringify(commands) });
  }

  /**
   * 获取命令历史（自动解压）
   */
  getCommandHistory() {
    const config = this.getConfig();
    const history = config.commandHistory;

    if (!history) return [];

    // 检查是否是压缩格式
    if (
      history.compressed &&
      history.data &&
      typeof history.data === "string"
    ) {
      try {
        const buffer = Buffer.from(history.data, "base64");
        const decompressed = zlib.gunzipSync(buffer);
        return JSON.parse(decompressed.toString("utf8"));
      } catch (error) {
        this.logger.logToFile(
          `ConfigService: Failed to decompress command history - ${error.message}`,
          "ERROR",
        );
        return [];
      }
    }

    // 旧格式（数组）
    return Array.isArray(history) ? history : [];
  }

  /**
   * 保存命令历史（自动压缩）
   */
  saveCommandHistory(history) {
    if (!Array.isArray(history)) {
      this.logger.logToFile(
        "ConfigService: Command history must be an array",
        "ERROR",
      );
      return;
    }

    try {
      const jsonString = JSON.stringify(history);
      const originalSize = Buffer.byteLength(jsonString, "utf8");

      // 如果历史记录超过 10KB，则压缩
      if (originalSize > 10240) {
        const compressed = zlib.gzipSync(jsonString, { level: 9 });
        const compressedSize = compressed.length;

        this.updateConfig({
          commandHistory: {
            compressed: true,
            data: compressed.toString("base64"),
            originalSize,
            compressedSize,
            timestamp: Date.now(),
          },
        });

        this.logger.logToFile(
          `ConfigService: Command history compressed (${originalSize} -> ${compressedSize} bytes)`,
          "INFO",
        );
      } else {
        // 小数据不压缩
        this.updateConfig({ commandHistory: history });
      }
    } catch (error) {
      this.logger.logToFile(
        `ConfigService: Failed to save command history - ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 获取最常用连接
   */
  getTopConnections() {
    return this.getConfig().topConnections || [];
  }

  /**
   * 保存最常用连接
   */
  saveTopConnections(topConnections) {
    this.updateConfig({ topConnections });
  }

  /**
   * 获取最近连接
   */
  getLastConnections() {
    return this.getConfig().lastConnections || [];
  }

  /**
   * 保存最近连接
   */
  saveLastConnections(lastConnections) {
    this.updateConfig({ lastConnections });
  }
}

// 导出单例
module.exports = new ConfigService();
