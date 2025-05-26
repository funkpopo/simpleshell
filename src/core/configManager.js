const fs = require("fs");
const path = require("path");

// Module-level variables to store injected dependencies
let app = null;
let logToFile = null;
let encryptText = null;
let decryptText = null;

// Path for main configuration file, will be set in init
let mainConfigPath = null;

/**
 * Initializes the ConfigManager with necessary dependencies.
 * This must be called once when the application starts.
 * @param {object} appInstance - The Electron app instance.
 * @param {object} loggerModule - The logger module (e.g., { logToFile }).
 * @param {object} cryptoModule - The crypto module (e.g., { encryptText, decryptText }).
 */
function init(appInstance, loggerModule, cryptoModule) {
  if (!appInstance || !loggerModule || !cryptoModule) {
    console.error(
      "ConfigManager init failed: Missing one or more dependencies (app, logger, crypto).",
    );
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
    console.error(
      "ConfigManager init warning: One or more functions (logToFile, encryptText, decryptText) are missing or not functions in injected modules.",
    );
    // We can still proceed, but some functionalities might be impaired or log errors.
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
    console.error("ConfigManager: Failed to set paths during init:", error);
    if (logToFile) {
      logToFile(
        "ConfigManager: Error setting paths during init - " + error.message,
        "ERROR",
      );
    }
  }
}

/**
 * Gets the path to the main configuration file (config.json).
 * Private helper function.
 * @returns {string}
 */
function _getMainConfigPathInternal() {
  // Renamed to avoid conflict if we export a public getConfigPath later
  if (!app) {
    console.error(
      "ConfigManager: app instance not available for _getMainConfigPathInternal. Was init called properly?",
    );
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
    console.error(
      "ConfigManager: Failed to determine main config path:",
      error,
    );
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

// === Connection Config Helpers (Private) ===

/**
 * Recursively processes connection items to encrypt sensitive fields for saving.
 * @param {Array<object>} items - Array of connection or group items.
 * @returns {Array<object>} Processed items with encrypted fields.
 */
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

/**
 * Recursively processes connection items to decrypt sensitive fields after loading.
 * @param {Array<object>} items - Array of connection or group items.
 * @returns {Array<object>} Processed items with decrypted fields.
 */
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

// === Public API for Connection Config ===

/**
 * Loads connection configurations from the main config file.
 * @returns {Array<object>} An array of connection items, or an empty array if failed.
 */
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

/**
 * Saves connection configurations to the main config file.
 * @param {Array<object>} connections - The array of connection items to save.
 * @returns {boolean} True if successful, false otherwise.
 */
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

// === Public API for AI Settings ===

/**
 * Loads AI settings from the main config file.
 * @returns {object} AI settings object, or a default structure if failed.
 */
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

/**
 * Saves AI settings to the main config file.
 * @param {object} settings - The AI settings object to save.
 * @returns {boolean} True if successful, false otherwise.
 */
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

// === Public API for UI Settings ===

/**
 * Loads UI settings from the main config file.
 * @returns {object} UI settings object, or a default structure if failed.
 */
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

/**
 * Saves UI settings to the main config file.
 * @param {object} settings - The UI settings object to save.
 * @returns {boolean} True if successful, false otherwise.
 */
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

// === Public API for Shortcut Commands ===

/**
 * Loads shortcut commands from the main config file.
 * @returns {object} Shortcut commands object (e.g., { commands: [], categories: [] }), or a default if failed.
 */
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

/**
 * Saves shortcut commands to the main config file.
 * @param {object} data - The shortcut commands object (e.g., { commands: [], categories: [] }) to save.
 * @returns {boolean} True if successful, false otherwise.
 */
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

// === Public API for Main Config Initialization ===

/**
 * Initializes the main configuration file (config.json).
 * Ensures the file exists and has the basic structure for connections and AI settings.
 * Handles migration of old AI settings format if necessary.
 */
function initializeMainConfig() {
  if (!mainConfigPath) {
    if (logToFile)
      logToFile(
        "ConfigManager: Main config path not set. Cannot initialize main config.",
        "ERROR",
      );
    return;
  }
  if (logToFile)
    logToFile(
      `ConfigManager: Initializing main config at ${mainConfigPath}`,
      "INFO",
    );

  const initialAIStructure = {
    configs: [],
    current: { apiUrl: "", apiKey: "", model: "", streamEnabled: true },
  };
  const initialUIStructure = {
    language: "zh-CN",
    fontSize: 14,
    darkMode: true,
  };
  const initialShortcutCommands = { commands: [], categories: [] };

  try {
    if (!fs.existsSync(mainConfigPath)) {
      const initialConfig = {
        connections: [],
        aiSettings: initialAIStructure,
        uiSettings: initialUIStructure,
        shortcutCommands: JSON.stringify(initialShortcutCommands),
      };
      fs.writeFileSync(
        mainConfigPath,
        JSON.stringify(initialConfig, null, 2),
        "utf8",
      );
      if (logToFile)
        logToFile("ConfigManager: Initial main config file created.", "INFO");
    } else {
      const data = fs.readFileSync(mainConfigPath, "utf8");
      let config = JSON.parse(data);
      let configUpdated = false;

      if (!config.connections) {
        config.connections = [];
        configUpdated = true;
        if (logToFile)
          logToFile(
            "ConfigManager: Added missing 'connections' array to main config.",
            "INFO",
          );
      }

      if (!config.aiSettings) {
        config.aiSettings = initialAIStructure;
        configUpdated = true;
        if (logToFile)
          logToFile(
            "ConfigManager: Added missing 'aiSettings' structure to main config.",
            "INFO",
          );
      } else {
        // Check and migrate old AI settings format
        const aiSettings = config.aiSettings;
        if (!aiSettings.configs) {
          // Old format detection
          aiSettings.configs = [];
          if (aiSettings.apiUrl || aiSettings.apiKey || aiSettings.model) {
            // If old data exists
            const oldConfig = {
              id: Date.now().toString(), // Simple unique ID
              name: "默认配置 (迁移)",
              apiUrl: aiSettings.apiUrl || "",
              apiKey: aiSettings.apiKey || "", // Will be encrypted on next saveAISettings call
              model: aiSettings.model || "",
              streamEnabled:
                aiSettings.streamEnabled !== undefined
                  ? aiSettings.streamEnabled
                  : true,
            };
            aiSettings.configs.push(oldConfig);
            // Set current to the migrated one if it looks valid
            if (oldConfig.apiUrl || oldConfig.apiKey) {
              aiSettings.current = { ...oldConfig };
            } else if (!aiSettings.current) {
              aiSettings.current = initialAIStructure.current;
            }
          }
          delete aiSettings.apiUrl;
          delete aiSettings.apiKey;
          delete aiSettings.model;
          delete aiSettings.streamEnabled; // Clean up old top-level fields
          configUpdated = true;
          if (logToFile)
            logToFile(
              "ConfigManager: Migrated old AI settings format to new structure.",
              "INFO",
            );
        }
        if (!aiSettings.current) {
          aiSettings.current = initialAIStructure.current;
          configUpdated = true;
        }
        // Ensure current has all fields
        const currentFields = ["apiUrl", "apiKey", "model", "streamEnabled"];
        currentFields.forEach((field) => {
          if (aiSettings.current[field] === undefined) {
            aiSettings.current[field] = initialAIStructure.current[field];
            configUpdated = true;
          }
        });
      }

      if (!config.uiSettings) {
        config.uiSettings = initialUIStructure;
        configUpdated = true;
        if (logToFile)
          logToFile(
            "ConfigManager: Added missing 'uiSettings' structure to main config.",
            "INFO",
          );
      } else {
        // Ensure all uiSettings fields exist
        const uiSettings = config.uiSettings;
        const defaultUISettings = initialUIStructure;
        if (uiSettings.language === undefined) {
          uiSettings.language = defaultUISettings.language;
          configUpdated = true;
        }
        if (uiSettings.fontSize === undefined) {
          uiSettings.fontSize = defaultUISettings.fontSize;
          configUpdated = true;
        }
        if (uiSettings.darkMode === undefined) {
          uiSettings.darkMode = defaultUISettings.darkMode;
          configUpdated = true;
        }
      }

      if (!config.shortcutCommands) {
        config.shortcutCommands = JSON.stringify(initialShortcutCommands);
        configUpdated = true;
        if (logToFile)
          logToFile(
            "ConfigManager: Added missing 'shortcutCommands' structure to main config.",
            "INFO",
          );
      }

      if (configUpdated) {
        fs.writeFileSync(
          mainConfigPath,
          JSON.stringify(config, null, 2),
          "utf8",
        );
        if (logToFile)
          logToFile(
            "ConfigManager: Main config file updated for missing fields/structure or AI settings migration.",
            "INFO",
          );
      }
    }
  } catch (error) {
    if (logToFile)
      logToFile(
        "ConfigManager: Error initializing main config - " + error.message,
        "ERROR",
      );
    console.error("ConfigManager: Error initializing main config:", error);
    // Attempt to create a new clean config file if parsing failed badly
    try {
      const initialConfig = {
        connections: [],
        aiSettings: initialAIStructure,
        uiSettings: initialUIStructure,
        shortcutCommands: JSON.stringify(initialShortcutCommands),
      };
      fs.writeFileSync(
        mainConfigPath,
        JSON.stringify(initialConfig, null, 2),
        "utf8",
      );
      if (logToFile)
        logToFile(
          "ConfigManager: Recreated main config file due to initialization error.",
          "WARN",
        );
    } catch (recreateError) {
      if (logToFile)
        logToFile(
          "ConfigManager: Failed to recreate main config file after error - " +
            recreateError.message,
          "ERROR",
        );
      console.error(
        "ConfigManager: Failed to recreate main config file:",
        recreateError,
      );
    }
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
  // Do not export _getMainConfigPathInternal, _processConnectionsForSave, _processConnectionsForLoad
  // as they are intended to be private helper functions.
};
