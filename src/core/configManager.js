const fs = require("fs");
const path = require("path");

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
  )
    try {
      mainConfigPath = _getMainConfigPathInternal(); // Call the renamed internal function
      if (logToFile) {
        logToFile(
          "ConfigManager initialized. Main config path: " + mainConfigPath,
          "INFO",
        );
      }
    } catch (error) {
      console.error("ConfigManager: Failed to set paths during init:", error);
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
    const isDev = process.env.NODE_ENV === "development";
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
    console.error("ConfigManager: Failed to load connections config:", error);
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
    console.error("ConfigManager: Failed to save connections config:", error);
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
    console.error("ConfigManager: Failed to load AI settings:", error);
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
    console.error("ConfigManager: Failed to save AI settings:", error);
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
    return { language: "zh-CN", fontSize: 14, darkMode: true };
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
        if (logToFile)
          logToFile("ConfigManager: UI settings loaded successfully.", "INFO");
        return config.uiSettings;
      }
    }
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to load UI settings - " + error.message,
        "ERROR",
      );
    console.error("ConfigManager: Failed to load UI settings:", error);
  }
  return { language: "zh-CN", fontSize: 14, darkMode: true };
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
    console.error("ConfigManager: Failed to save UI settings:", error);
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
    console.error("ConfigManager: Error loading shortcut commands:", error);
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
    console.error("ConfigManager: Error saving shortcut commands:", error);
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
    console.error("ConfigManager: Failed to load log settings:", error);
  }

  // 返回默认日志设置
  return {
    level: "INFO",
    maxFileSize: 5 * 1024 * 1024,
    maxFiles: 5,
    compressOldLogs: true,
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
    console.error("ConfigManager: Failed to save log settings:", error);
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
          darkMode: true,
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
          darkMode: true,
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
    console.error("ConfigManager: Failed to initialize main config:", error);
    return { success: false, error: error.message };
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

      if (config.commandHistory && Array.isArray(config.commandHistory)) {
        if (logToFile)
          logToFile(
            `ConfigManager: Loaded ${config.commandHistory.length} command history entries.`,
            "INFO",
          );
        return config.commandHistory;
      }
    }
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to load command history - " + error.message,
        "ERROR",
      );
    console.error("ConfigManager: Failed to load command history:", error);
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

    config.commandHistory = Array.isArray(history) ? history : [];
    fs.writeFileSync(mainConfigPath, JSON.stringify(config, null, 2), "utf8");

    if (logToFile)
      logToFile(
        `ConfigManager: Saved ${config.commandHistory.length} command history entries.`,
        "INFO",
      );
    return true;
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Failed to save command history - " + error.message,
        "ERROR",
      );
    console.error("ConfigManager: Failed to save command history:", error);
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
  // Do not export _getMainConfigPathInternal, _processConnectionsForSave, _processConnectionsForLoad
  // as they are intended to be private helper functions.
};
