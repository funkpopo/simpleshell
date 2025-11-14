const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const configService = require("../services/configService");

// Module-level variables to store injected dependencies
let app = null;
let logToFile = null;
let encryptText = null;
let decryptText = null;

// Path for main configuration file, will be set in init
let mainConfigPath = null;

function init(appInstance, loggerModule, cryptoModule) {
  if (!appInstance || !loggerModule || !cryptoModule) {
    return;
  }
  app = appInstance;
  logToFile = loggerModule.logToFile; // Assuming loggerModule is { logToFile: function }
  encryptText = cryptoModule.encryptText; // Assuming cryptoModule is { encryptText: function, decryptText: function }
  decryptText = cryptoModule.decryptText;

  if (
    typeof logToFile !== "function" ||
    typeof encryptText !== "function" ||
    typeof decryptText !== "function"
  ) {
    // 如果依赖函数不完整，记录错误但不继续初始化
    console.error("ConfigManager: Required functions are not available");
    return;
  }

  try {
    mainConfigPath = _getMainConfigPathInternal(); // Call the renamed internal function
    if (logToFile) {
      logToFile(
        "ConfigManager initialized. Main config path: " + mainConfigPath,
        "INFO",
      );
    }
  } catch (error) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Error setting paths during init - " + error.message,
        "ERROR",
      );
    }
  }
}

function _getMainConfigPathInternal() {
  // Renamed to avoid conflict if we export a public getConfigPath later
  if (!app) {
    // Attempt a graceful fallback, though this indicates an issue with initialization order or dependency injection.
    const fallbackCwd =
      typeof process !== "undefined" && process.cwd ? process.cwd() : ".";
    return path.join(fallbackCwd, "config.json_fallback_no_app");
  }
  try {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    if (isDev) {
      return path.join(process.cwd(), "config.json");
    } else {
      return path.join(path.dirname(app.getPath("exe")), "config.json");
    }
  } catch (error) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Error getting main config path - " + error.message,
        "ERROR",
      );
    }
    // Fallback to userData directory if other methods fail, ensuring app is defined
    return path.join(
      app.getPath("userData"),
      "config.json_fallback_general_error",
    );
  }
}

function _processConnectionsForSave(items) {
  if (!encryptText) {
    if (logToFile)
      logToFile(
        "ConfigManager: encryptText function is not available in _processConnectionsForSave.",
        "ERROR",
      );
    // Return items as is, or throw error, depending on desired strictness
    return items;
  }
  return items.map((item) => {
    const result = { ...item };
    if (item.type === "connection") {
      if (item.password) result.password = encryptText(item.password);
      if (item.privateKeyPath)
        result.privateKeyPath = encryptText(item.privateKeyPath);
    }
    if (item.type === "group" && Array.isArray(item.items)) {
      result.items = _processConnectionsForSave(item.items); // Recursive call
    }
    return result;
  });
}

function _processConnectionsForLoad(items) {
  if (!decryptText) {
    if (logToFile)
      logToFile(
        "ConfigManager: decryptText function is not available in _processConnectionsForLoad.",
        "ERROR",
      );
    return items;
  }
  return items.map((item) => {
    const result = { ...item };
    if (item.type === "connection") {
      if (item.password) result.password = decryptText(item.password);
      if (item.privateKeyPath)
        result.privateKeyPath = decryptText(item.privateKeyPath);
    }
    if (item.type === "group" && Array.isArray(item.items)) {
      result.items = _processConnectionsForLoad(item.items); // Recursive call
    }
    return result;
  });
}

function loadConnections() {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot load connections.",
        "ERROR",
      );
    return [];
  }
  try {
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      const config = JSON.parse(data);
      if (config.connections && Array.isArray(config.connections)) {
        return _processConnectionsForLoad(config.connections);
      }
    }
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to load connections config - " + error.message,
        "ERROR",
      );
  }
  return [];
}

function saveConnections(connections) {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot save connections.",
        "ERROR",
      );
    return false;
  }
  try {
    let config = {};
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      config = JSON.parse(data);
    }
    const processedConnections = _processConnectionsForSave(connections);
    config.connections = processedConnections;
    fs.writeFileSync(mainConfigPath, JSON.stringify(config, null, 2), "utf8");
    if (logToFile)
      logToFile(
        "ConfigManager: Connections config saved successfully.",
        "INFO",
      );
    return true;
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to save connections config - " + error.message,
        "ERROR",
      );

    return false;
  }
}

function loadAISettings() {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot load AI settings.",
        "ERROR",
      );
    return {
      configs: [],
      current: { apiUrl: "", apiKey: "", model: "", streamEnabled: true },
    };
  }
  if (logToFile)
    logToFile(
      `ConfigManager: Loading AI settings from ${mainConfigPath}`,
      "INFO",
    );

  try {
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      const config = JSON.parse(data);
      if (config.aiSettings) {
        const settings = { ...config.aiSettings };
        if (logToFile) {
          logToFile(
            `ConfigManager: Loaded ${settings.configs?.length || 0} AI configurations.`,
            "INFO",
          );
        }
        // Decrypt API keys in configs array
        if (settings.configs && Array.isArray(settings.configs)) {
          settings.configs = settings.configs.map((cfg) => {
            if (cfg.apiKey && decryptText) {
              try {
                return { ...cfg, apiKey: decryptText(cfg.apiKey) };
              } catch (decryptError) {
                if (logToFile)
                  logToFile(
                    `ConfigManager: Failed to decrypt API key for config ${cfg.name || cfg.id}. Error: ${decryptError.message}`,
                    "WARN",
                  );
                return { ...cfg, apiKey: "" }; // Clear the key if decryption fails
              }
            }
            return cfg;
          });
        }
        // Decrypt current API key
        if (settings.current && settings.current.apiKey && decryptText) {
          try {
            settings.current.apiKey = decryptText(settings.current.apiKey);
          } catch (decryptError) {
            if (logToFile)
              logToFile(
                `ConfigManager: Failed to decrypt current API key. Error: ${decryptError.message}`,
                "WARN",
              );
            settings.current.apiKey = ""; // Clear the key if decryption fails
          }
        }
        return settings;
      }
    }
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to load AI settings - " + error.message,
        "ERROR",
      );
  }
  return {
    configs: [],
    current: { apiUrl: "", apiKey: "", model: "", streamEnabled: true },
  };
}

function saveAISettings(settings) {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot save AI settings.",
        "ERROR",
      );
    return false;
  }
  if (logToFile)
    logToFile(`ConfigManager: Saving AI settings to ${mainConfigPath}`, "INFO");

  try {
    let config = {};
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      config = JSON.parse(data);
    }

    const settingsToSave = { ...settings };

    // Encrypt API keys in configs array
    if (
      settingsToSave.configs &&
      Array.isArray(settingsToSave.configs) &&
      encryptText
    ) {
      settingsToSave.configs = settingsToSave.configs.map((cfg) => {
        if (cfg.apiKey) {
          const encryptedKey = encryptText(cfg.apiKey);
          if (encryptedKey === null) {
            if (logToFile)
              logToFile(
                `ConfigManager: Failed to encrypt API key for config ${cfg.name || cfg.id}.`,
                "ERROR",
              );
            return { ...cfg, apiKey: "" }; // Clear the key if encryption fails
          }
          return { ...cfg, apiKey: encryptedKey };
        }
        return cfg;
      });
    }

    // Encrypt current API key
    if (
      settingsToSave.current &&
      settingsToSave.current.apiKey &&
      encryptText
    ) {
      const encryptedCurrentKey = encryptText(settingsToSave.current.apiKey);
      if (encryptedCurrentKey === null) {
        if (logToFile)
          logToFile(
            "ConfigManager: Failed to encrypt current API key.",
            "ERROR",
          );
        settingsToSave.current.apiKey = ""; // Clear the key if encryption fails
      } else {
        settingsToSave.current.apiKey = encryptedCurrentKey;
      }
    }

    config.aiSettings = settingsToSave;
    fs.writeFileSync(mainConfigPath, JSON.stringify(config, null, 2), "utf8");
    if (logToFile)
      logToFile("ConfigManager: AI settings saved successfully.", "INFO");
    return true;
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to save AI settings - " + error.message,
        "ERROR",
      );

    return false;
  }
}

function loadUISettings() {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot load UI settings.",
        "ERROR",
      );
    return {
      language: "zh-CN",
      fontSize: 14,
      editorFont: "system",
      darkMode: true,
      terminalFont: "Consolas",
      terminalFontSize: 14,
      performance: {
        imageSupported: true,
        cacheEnabled: true,
        prefetchEnabled: true,
        webglEnabled: true,
      },
      dnd: {
        enabled: true,
        autoScroll: true,
        compactDragPreview: false,
      },
      externalEditor: {
        enabled: false,
        command: "",
      },
    };
  }
  if (logToFile)
    logToFile(
      `ConfigManager: Loading UI settings from ${mainConfigPath}`,
      "INFO",
    );

  try {
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      const config = JSON.parse(data);
      if (config.uiSettings) {
        // 确保性能设置存在
        const uiSettings = {
          ...config.uiSettings,
          editorFont: config.uiSettings.editorFont || "system",
          terminalFont: config.uiSettings.terminalFont || "Fira Code",
          terminalFontSize: config.uiSettings.terminalFontSize || 14,
          performance: {
            imageSupported:
              config.uiSettings.performance?.imageSupported !== false,
            cacheEnabled: config.uiSettings.performance?.cacheEnabled !== false,
            prefetchEnabled:
              config.uiSettings.performance?.prefetchEnabled !== false,
            webglEnabled: config.uiSettings.performance?.webglEnabled !== false,
          },
          dnd: {
            enabled:
              config.uiSettings.dnd &&
              typeof config.uiSettings.dnd.enabled === "boolean"
                ? config.uiSettings.dnd.enabled
                : true,
            autoScroll:
              config.uiSettings.dnd &&
              typeof config.uiSettings.dnd.autoScroll === "boolean"
                ? config.uiSettings.dnd.autoScroll
                : true,
            compactDragPreview:
              config.uiSettings.dnd &&
              typeof config.uiSettings.dnd.compactDragPreview === "boolean"
                ? config.uiSettings.dnd.compactDragPreview
                : false,
          },
          externalEditor: {
            enabled:
              typeof config.uiSettings.externalEditor?.enabled === "boolean"
                ? config.uiSettings.externalEditor.enabled
                : false,
            command:
              typeof config.uiSettings.externalEditor?.command === "string"
                ? config.uiSettings.externalEditor.command
                : config.uiSettings.externalEditorCommand || "",
          },
        };
        if (logToFile)
          logToFile("ConfigManager: UI settings loaded successfully.", "INFO");
        return uiSettings;
      }
    }
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to load UI settings - " + error.message,
        "ERROR",
      );
  }
  return {
    language: "zh-CN",
    fontSize: 14,
    editorFont: "system",
    darkMode: true,
    terminalFont: "Fira Code",
    terminalFontSize: 14,
    performance: {
      imageSupported: true,
      cacheEnabled: true,
      prefetchEnabled: true,
      webglEnabled: true,
    },
    externalEditor: {
      enabled: false,
      command: "",
    },
  };
}

function saveUISettings(settings) {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot save UI settings.",
        "ERROR",
      );
    return false;
  }
  if (logToFile)
    logToFile(`ConfigManager: Saving UI settings to ${mainConfigPath}`, "INFO");

  try {
    let config = {};
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      config = JSON.parse(data);
    }
    config.uiSettings = settings;
    fs.writeFileSync(mainConfigPath, JSON.stringify(config, null, 2), "utf8");
    if (logToFile)
      logToFile("ConfigManager: UI settings saved successfully.", "INFO");
    return true;
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to save UI settings - " + error.message,
        "ERROR",
      );

    return false;
  }
}

function loadShortcutCommands() {
  const defaultShortcuts = { commands: [], categories: [] };
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot load shortcuts.",
        "ERROR",
      );
    return defaultShortcuts;
  }
  if (logToFile)
    logToFile(
      `ConfigManager: Loading shortcut commands from ${mainConfigPath}`,
      "INFO",
    );

  try {
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      const config = JSON.parse(data);

      if (config.shortcutCommands) {
        let shortcuts;
        try {
          // 直接解析为明文JSON，不再使用加密
          shortcuts = JSON.parse(config.shortcutCommands);
        } catch (parseError) {
          if (logToFile)
            logToFile(
              `ConfigManager: Error parsing shortcut commands data: ${parseError.message}`,
              "ERROR",
            );
          return defaultShortcuts;
        }
        if (logToFile)
          logToFile(
            `ConfigManager: Loaded ${shortcuts.commands?.length || 0} shortcut commands and ${shortcuts.categories?.length || 0} categories.`,
            "INFO",
          );
        return shortcuts || defaultShortcuts; // Ensure we return an object
      }
      if (logToFile)
        logToFile(
          "ConfigManager: No shortcut commands field found in config. Returning defaults.",
          "INFO",
        );
    } else {
      if (logToFile)
        logToFile(
          "ConfigManager: No main config file found. Returning defaults.",
          "INFO",
        );
    }
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Error loading shortcut commands - " + error.message,
        "ERROR",
      );
  }
  return defaultShortcuts;
}

function saveShortcutCommands(data) {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot save shortcuts.",
        "ERROR",
      );
    return false;
  }
  if (logToFile)
    logToFile(
      `ConfigManager: Saving shortcut commands to ${mainConfigPath}`,
      "INFO",
    );

  try {
    let config = {};
    if (fs.existsSync(mainConfigPath)) {
      const configData = fs.readFileSync(mainConfigPath, "utf8");
      config = JSON.parse(configData);
    }

    // 直接存储为明文JSON，不再使用加密
    config.shortcutCommands = JSON.stringify(data);
    fs.writeFileSync(mainConfigPath, JSON.stringify(config, null, 2), "utf8");
    if (logToFile)
      logToFile(
        `ConfigManager: Saved ${data.commands?.length || 0} shortcut commands and ${data.categories?.length || 0} categories.`,
        "INFO",
      );
    return true;
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Error saving shortcut commands - " + error.message,
        "ERROR",
      );

    return false;
  }
}

function loadLogSettings() {
  if (!mainConfigPath) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Main config path not set. Cannot load log settings.",
        "ERROR",
      );
    }
    return {
      level: "INFO",
      maxFileSize: 5 * 1024 * 1024,
      maxFiles: 5,
      compressOldLogs: true,
      cleanupIntervalDays: 7,
    };
  }

  if (logToFile) {
    logToFile(
      `ConfigManager: Loading log settings from ${mainConfigPath}`,
      "INFO",
    );
  }

  try {
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      const config = JSON.parse(data);

      if (config.logSettings) {
        // 返回日志设置，确保包含所有默认值
        return {
          level: config.logSettings.level || "INFO",
          maxFileSize: config.logSettings.maxFileSize || 5 * 1024 * 1024,
          maxFiles: config.logSettings.maxFiles || 5,
          compressOldLogs:
            config.logSettings.compressOldLogs !== undefined
              ? config.logSettings.compressOldLogs
              : true,
          cleanupIntervalDays: config.logSettings.cleanupIntervalDays || 7,
        };
      }
    }
  } catch (error) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Failed to load log settings - " + error.message,
        "ERROR",
      );
    }
  }

  // 返回默认日志设置
  return {
    level: "INFO",
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 5,
    compressOldLogs: true,
    cleanupIntervalDays: 7,
  };
}

function saveLogSettings(settings) {
  if (!mainConfigPath) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Main config path not set. Cannot save log settings.",
        "ERROR",
      );
    }
    return false;
  }

  try {
    let config = {};
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      config = JSON.parse(data);
    }

    // 确保设置包含所有必要字段
    config.logSettings = {
      level: settings.level || "INFO",
      maxFileSize: settings.maxFileSize || 5 * 1024 * 1024,
      maxFiles: settings.maxFiles || 5,
      compressOldLogs:
        settings.compressOldLogs !== undefined
          ? settings.compressOldLogs
          : true,
      cleanupIntervalDays: settings.cleanupIntervalDays || 7,
    };

    fs.writeFileSync(mainConfigPath, JSON.stringify(config, null, 2), "utf8");

    if (logToFile) {
      logToFile("ConfigManager: Log settings saved successfully.", "INFO");
    }
    return true;
  } catch (error) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Failed to save log settings - " + error.message,
        "ERROR",
      );
    }

    return false;
  }
}

function initializeMainConfig() {
  if (!mainConfigPath) {
    return { success: false, error: "Configuration path not set" };
  }

  if (logToFile)
    logToFile(
      "ConfigManager: Initializing main config at " + mainConfigPath,
      "INFO",
    );

  try {
    // If config doesn't exist, create default
    if (!fs.existsSync(mainConfigPath)) {
      const defaultConfig = {
        connections: [],
        uiSettings: {
          language: "zh-CN",
          fontSize: 14,
          editorFont: "system",
          darkMode: true,
          terminalFont: "Fira Code",
          terminalFontSize: 14,
          performance: {
            imageSupported: true,
            cacheEnabled: true,
            prefetchEnabled: true,
            webglEnabled: true,
          },
        },
        aiSettings: {
          configs: [],
          current: null,
        },
        logSettings: {
          level: "INFO",
          maxFileSize: 5 * 1024 * 1024,
          maxFiles: 5,
          compressOldLogs: true,
        },
        transferHistory: [],
        lastConnections: [],
      };

      // Ensure the directory exists
      const dir = path.dirname(mainConfigPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(
        mainConfigPath,
        JSON.stringify(defaultConfig, null, 2),
        "utf8",
      );
      if (logToFile)
        logToFile(
          "ConfigManager: Created default config at " + mainConfigPath,
          "INFO",
        );
    } else {
      // If config exists, make sure it has all the required sections
      const data = fs.readFileSync(mainConfigPath, "utf8");
      let config = {};
      try {
        config = JSON.parse(data);
      } catch (parseError) {
        if (logToFile)
          logToFile(
            "ConfigManager: Error parsing existing config, will create backup and new default - " +
              parseError.message,
            "ERROR",
          );
        // Backup corrupted file
        const backupPath = mainConfigPath + ".backup." + Date.now();
        fs.copyFileSync(mainConfigPath, backupPath);
        // Create new default
        throw new Error(
          "Config parsing failed, created backup at " + backupPath,
        );
      }

      let changed = false;

      // Ensure connections exists
      if (!config.connections) {
        config.connections = [];
        changed = true;
      }

      // Ensure uiSettings exists
      if (!config.uiSettings) {
        config.uiSettings = {
          language: "zh-CN",
          fontSize: 14,
          editorFont: "system",
          darkMode: true,
          terminalFont: "Fira Code",
          terminalFontSize: 14,
          performance: {
            imageSupported: true,
            cacheEnabled: true,
            prefetchEnabled: true,
            webglEnabled: true,
          },
        };
        changed = true;
      } else {
        // Ensure all UI settings fields exist
        if (!config.uiSettings.language) {
          config.uiSettings.language = "zh-CN";
          changed = true;
        }
        if (config.uiSettings.fontSize === undefined) {
          config.uiSettings.fontSize = 14;
          changed = true;
        }
        if (config.uiSettings.darkMode === undefined) {
          config.uiSettings.darkMode = true;
          changed = true;
        }
        if (!config.uiSettings.editorFont) {
          config.uiSettings.editorFont = "system";
          changed = true;
        }
        if (!config.uiSettings.terminalFont) {
          config.uiSettings.terminalFont = "Fira Code";
          changed = true;
        }
        if (config.uiSettings.terminalFontSize === undefined) {
          config.uiSettings.terminalFontSize = 14;
          changed = true;
        }
        if (!config.uiSettings.performance) {
          config.uiSettings.performance = {
            imageSupported: true,
            cacheEnabled: true,
            prefetchEnabled: true,
            webglEnabled: true,
          };
          changed = true;
        } else {
          if (config.uiSettings.performance.imageSupported === undefined) {
            config.uiSettings.performance.imageSupported = true;
            changed = true;
          }
          if (config.uiSettings.performance.cacheEnabled === undefined) {
            config.uiSettings.performance.cacheEnabled = true;
            changed = true;
          }
          if (config.uiSettings.performance.prefetchEnabled === undefined) {
            config.uiSettings.performance.prefetchEnabled = true;
            changed = true;
          }
          if (config.uiSettings.performance.webglEnabled === undefined) {
            config.uiSettings.performance.webglEnabled = true;
            changed = true;
          }
        }
      }

      // Ensure aiSettings exists
      if (!config.aiSettings) {
        config.aiSettings = {
          configs: [],
          current: null,
        };
        changed = true;
      } else {
        // Ensure all AI settings fields exist
        if (!config.aiSettings.configs) {
          config.aiSettings.configs = [];
          changed = true;
        }
      }

      // Ensure logSettings exists
      if (!config.logSettings) {
        config.logSettings = {
          level: "INFO",
          maxFileSize: 5 * 1024 * 1024,
          maxFiles: 5,
          compressOldLogs: true,
        };
        changed = true;
      } else {
        // Ensure all log settings fields exist
        if (!config.logSettings.level) {
          config.logSettings.level = "INFO";
          changed = true;
        }
        if (config.logSettings.maxFileSize === undefined) {
          config.logSettings.maxFileSize = 5 * 1024 * 1024;
          changed = true;
        }
        if (config.logSettings.maxFiles === undefined) {
          config.logSettings.maxFiles = 5;
          changed = true;
        }
        if (config.logSettings.compressOldLogs === undefined) {
          config.logSettings.compressOldLogs = true;
          changed = true;
        }
      }

      // Ensure lastConnections exists
      if (!Array.isArray(config.lastConnections)) {
        config.lastConnections = [];
        changed = true;
      }

      // Write updated config if changes were made
      if (changed) {
        fs.writeFileSync(
          mainConfigPath,
          JSON.stringify(config, null, 2),
          "utf8",
        );
        if (logToFile)
          logToFile(
            "ConfigManager: Updated existing config with missing sections at " +
              mainConfigPath,
            "INFO",
          );
      }
    }

    return { success: true };
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to initialize main config - " + error.message,
        "ERROR",
      );

    return { success: false, error: error.message };
  }
}

// 压缩命令历史数据
function compressCommandHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }

  try {
    const jsonString = JSON.stringify(history);
    const compressed = zlib.gzipSync(jsonString);
    const base64 = compressed.toString("base64");

    const originalSize = Buffer.byteLength(jsonString, "utf8");
    const compressedSize = Buffer.byteLength(base64, "utf8");
    const compressionRatio = (
      ((originalSize - compressedSize) / originalSize) *
      100
    ).toFixed(1);

    if (logToFile) {
      logToFile(
        `ConfigManager: Command history compressed from ${originalSize} bytes to ${compressedSize} bytes (${compressionRatio}% reduction)`,
        "INFO",
      );
    }

    return {
      compressed: true,
      data: base64,
      originalSize,
      compressedSize,
      timestamp: Date.now(),
    };
  } catch (error) {
    if (logToFile) {
      logToFile(
        `ConfigManager: Failed to compress command history - ${error.message}`,
        "ERROR",
      );
    }
    return null;
  }
}

// 解压缩命令历史数据
function decompressCommandHistory(compressedData) {
  if (!compressedData || typeof compressedData !== "object") {
    return null;
  }

  try {
    const buffer = Buffer.from(compressedData.data, "base64");
    const decompressed = zlib.gunzipSync(buffer);
    const jsonString = decompressed.toString("utf8");
    const history = JSON.parse(jsonString);

    if (logToFile) {
      logToFile(
        `ConfigManager: Command history decompressed from ${compressedData.compressedSize} bytes to ${compressedData.originalSize} bytes`,
        "INFO",
      );
    }

    return Array.isArray(history) ? history : [];
  } catch (error) {
    if (logToFile) {
      logToFile(
        `ConfigManager: Failed to decompress command history - ${error.message}`,
        "ERROR",
      );
    }
    return null;
  }
}

function loadCommandHistory() {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot load command history.",
        "ERROR",
      );
    return [];
  }

  try {
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      const config = JSON.parse(data);

      if (config.commandHistory) {
        // 检测是否为压缩格式
        if (
          typeof config.commandHistory === "object" &&
          config.commandHistory.compressed === true
        ) {
          // 解压缩格式
          const decompressedHistory = decompressCommandHistory(
            config.commandHistory,
          );
          if (decompressedHistory) {
            if (logToFile)
              logToFile(
                `ConfigManager: Loaded ${decompressedHistory.length} command history entries (compressed format).`,
                "INFO",
              );
            return decompressedHistory;
          } else {
            if (logToFile)
              logToFile(
                "ConfigManager: Failed to decompress command history, returning empty array.",
                "WARN",
              );
            return [];
          }
        } else if (Array.isArray(config.commandHistory)) {
          // 旧格式（未压缩数组）- 自动迁移到压缩格式
          if (logToFile)
            logToFile(
              `ConfigManager: Detected legacy command history format with ${config.commandHistory.length} entries, migrating to compressed format.`,
              "INFO",
            );

          // 备份原数据并转换为压缩格式
          const originalHistory = [...config.commandHistory];
          const compressedData = compressCommandHistory(originalHistory);

          if (compressedData) {
            // 保存压缩格式
            config.commandHistory = compressedData;
            try {
              fs.writeFileSync(
                mainConfigPath,
                JSON.stringify(config, null, 2),
                "utf8",
              );
              if (logToFile)
                logToFile(
                  "ConfigManager: Successfully migrated command history to compressed format.",
                  "INFO",
                );
            } catch (saveError) {
              if (logToFile)
                logToFile(
                  `ConfigManager: Failed to save migrated command history - ${saveError.message}`,
                  "ERROR",
                );
            }
          }

          return originalHistory;
        }
      }
    }
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to load command history - " + error.message,
        "ERROR",
      );
  }

  return [];
}

function saveCommandHistory(history) {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot save command history.",
        "ERROR",
      );
    return false;
  }

  try {
    let config = {};
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      config = JSON.parse(data);
    }

    const historyArray = Array.isArray(history) ? history : [];

    // 压缩命令历史数据
    const compressedData = compressCommandHistory(historyArray);

    if (compressedData) {
      config.commandHistory = compressedData;

      if (logToFile)
        logToFile(
          `ConfigManager: Saved ${historyArray.length} command history entries in compressed format.`,
          "INFO",
        );
    } else {
      // 如果压缩失败，回退到原始格式
      config.commandHistory = historyArray;

      if (logToFile)
        logToFile(
          `ConfigManager: Compression failed, saved ${historyArray.length} command history entries in legacy format.`,
          "WARN",
        );
    }

    fs.writeFileSync(mainConfigPath, JSON.stringify(config, null, 2), "utf8");
    return true;
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to save command history - " + error.message,
        "ERROR",
      );

    return false;
  }
}

function loadTopConnections() {
  if (!mainConfigPath) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Main config path not set. Cannot load top connections.",
        "ERROR",
      );
    }
    return [];
  }
  try {
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      const config = JSON.parse(data);
      if (config.topConnections && Array.isArray(config.topConnections)) {
        return config.topConnections;
      }
    }
  } catch (error) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Failed to load top connections - " + error.message,
        "ERROR",
      );
    }
  }
  return [];
}

function saveTopConnections(connections) {
  if (!mainConfigPath) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Main config path not set. Cannot save top connections.",
        "ERROR",
      );
    }
    return false;
  }
  try {
    let config = {};
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      config = JSON.parse(data);
    }
    config.topConnections = connections;
    fs.writeFileSync(mainConfigPath, JSON.stringify(config, null, 2), "utf8");
    if (logToFile) {
      logToFile("ConfigManager: Top connections saved successfully.", "INFO");
    }
    return true;
  } catch (error) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Failed to save top connections - " + error.message,
        "ERROR",
      );
    }
    return false;
  }
}

function loadLastConnections() {
  if (!mainConfigPath) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Main config path not set. Cannot load last connections.",
        "ERROR",
      );
    }
    return [];
  }
  try {
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      const config = JSON.parse(data);
      if (config.lastConnections && Array.isArray(config.lastConnections)) {
        return config.lastConnections;
      }
    }
  } catch (error) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Failed to load last connections - " + error.message,
        "ERROR",
      );
    }
  }
  return [];
}

function saveLastConnections(connections) {
  if (!mainConfigPath) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Main config path not set. Cannot save last connections.",
        "ERROR",
      );
    }
    return false;
  }
  try {
    let config = {};
    if (fs.existsSync(mainConfigPath)) {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      config = JSON.parse(data);
    }
    config.lastConnections = connections;
    fs.writeFileSync(mainConfigPath, JSON.stringify(config, null, 2), "utf8");
    if (logToFile) {
      logToFile("ConfigManager: Last connections saved successfully.", "INFO");
    }
    return true;
  } catch (error) {
    if (logToFile) {
      logToFile(
        "ConfigManager: Failed to save last connections - " + error.message,
        "ERROR",
      );
    }
    return false;
  }
}

function get(key) {
  if (!key) return undefined;

  try {
    if (
      !configService ||
      typeof configService._readConfig !== "function" ||
      (typeof configService.isInitialized === "function" &&
        !configService.isInitialized())
    ) {
      if (logToFile) {
        logToFile(
          "ConfigManager: configService is not available or not initialized for get().",
          "ERROR",
        );
      }
      return undefined;
    }

    const config = configService._readConfig();
    if (config && typeof config === "object") {
      return config[key];
    }
    return undefined;
  } catch (error) {
    if (logToFile) {
      logToFile(
        `ConfigManager: Failed to get config key '${key}' - ${error.message}`,
        "ERROR",
      );
    }
    return undefined;
  }
}

function set(key, value) {
  if (!key) return false;

  try {
    if (
      !configService ||
      typeof configService._readConfig !== "function" ||
      typeof configService._writeConfig !== "function" ||
      (typeof configService.isInitialized === "function" &&
        !configService.isInitialized())
    ) {
      if (logToFile) {
        logToFile(
          "ConfigManager: configService is not available or not initialized for set().",
          "ERROR",
        );
      }
      return false;
    }

    const currentConfig = configService._readConfig();
    const config =
      currentConfig && typeof currentConfig === "object" ? currentConfig : {};

    config[key] = value;

    const success = configService._writeConfig(config);
    if (success && logToFile) {
      logToFile(
        `ConfigManager: Saved config key '${key}' via set().`,
        "INFO",
      );
    }
    return success;
  } catch (error) {
    if (logToFile) {
      logToFile(
        `ConfigManager: Failed to set config key '${key}' - ${error.message}`,
        "ERROR",
      );
    }
    return false;
  }
}

module.exports = {
  init,
  initializeMainConfig,
  loadConnections,
  saveConnections,
  loadAISettings,
  saveAISettings,
  loadUISettings,
  saveUISettings,
  loadShortcutCommands,
  saveShortcutCommands,
  loadLogSettings,
  saveLogSettings,
  loadCommandHistory,
  saveCommandHistory,
  loadTopConnections,
  saveTopConnections,
  loadLastConnections,
  saveLastConnections,
  get,
  set,
  // Do not export _getMainConfigPathInternal, _processConnectionsForSave, _processConnectionsForLoad
  // as they are intended to be private helper functions.
};
