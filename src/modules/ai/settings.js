const fs = require("fs");
const { logToFile } = require("../../core/utils/logger");
const { encryptText, decryptText } = require("../../core/utils/encryption");
const { getConfigPath } = require("../../core/utils/config");

// 为了兼容性，创建别名函数
const encrypt = encryptText;
const decrypt = decryptText;

/**
 * 加载AI设置，使用统一的config.json
 * @returns {Object} AI设置对象
 */
const loadAISettings = () => {
  const configPath = getConfigPath();
  logToFile(`Loading AI settings from ${configPath}`);

  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(data);

      // 从config对象中读取AI设置
      if (config.aiSettings) {
        const settings = { ...config.aiSettings };
        logToFile(
          `Loaded settings: ${JSON.stringify({
            hasConfigs: Array.isArray(settings.configs),
            configsCount: Array.isArray(settings.configs)
              ? settings.configs.length
              : 0,
            hasCurrent: !!settings.current,
          })}`,
        );

        // 确保必要的属性存在
        if (!settings.configs) {
          settings.configs = [];
          logToFile("No configs array found, initializing empty array", "WARN");
        }

        // 解密所有配置中的API密钥
        if (settings.configs && Array.isArray(settings.configs)) {
          settings.configs = settings.configs.map((cfg) => {
            if (cfg.apiKey) {
              try {
                return { ...cfg, apiKey: decrypt(cfg.apiKey) };
              } catch (err) {
                logToFile(
                  `Failed to decrypt API key for config ${cfg.id}: ${err.message}`,
                  "ERROR",
                );
                return cfg;
              }
            }
            return cfg;
          });
        }

        // 解密当前设置的API密钥
        if (settings.current && settings.current.apiKey) {
          try {
            settings.current.apiKey = decrypt(settings.current.apiKey);
          } catch (err) {
            logToFile(
              `Failed to decrypt current API key: ${err.message}`,
              "ERROR",
            );
          }
        }

        // 确保当前设置存在所有字段
        if (!settings.current) {
          settings.current = {
            apiUrl: "",
            apiKey: "",
            model: "",
            streamEnabled: true,
          };
          logToFile(
            "No current settings found, initializing with defaults",
            "WARN",
          );
        }

        return settings;
      } else {
        logToFile("No aiSettings found in config", "WARN");
      }
    } else {
      logToFile(`Config file does not exist: ${configPath}`, "WARN");
    }
  } catch (error) {
    logToFile(`Failed to load AI settings: ${error.message}`, "ERROR");
    console.error("Failed to load AI settings:", error);
  }

  // 默认设置
  logToFile("Returning default settings");
  return {
    configs: [],
    current: {
      apiUrl: "",
      apiKey: "",
      model: "",
      streamEnabled: true,
    },
  };
};

/**
 * 保存AI设置，使用统一的config.json
 * @param {Object} settings - AI设置对象
 * @returns {boolean} 保存是否成功
 */
const saveAISettings = (settings) => {
  const configPath = getConfigPath();
  logToFile(`Saving AI settings to ${configPath}`);
  logToFile(
    `Settings to save: ${JSON.stringify({
      hasConfigs: Array.isArray(settings.configs),
      configsCount: Array.isArray(settings.configs)
        ? settings.configs.length
        : 0,
      hasCurrent: !!settings.current,
    })}`,
  );

  try {
    // 加载当前配置
    let config = {};
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf8");
      config = JSON.parse(data);
      logToFile("Loaded existing config");
    } else {
      logToFile("No existing config, creating new one");
    }

    // 创建设置副本以避免修改原始对象
    const settingsToSave = JSON.parse(JSON.stringify(settings));

    // 确保configs是数组
    if (!settingsToSave.configs) {
      settingsToSave.configs = [];
      logToFile(
        "No configs array in settings to save, initializing empty array",
        "WARN",
      );
    }

    // 加密所有配置的API密钥
    if (settingsToSave.configs && Array.isArray(settingsToSave.configs)) {
      logToFile(`Encrypting ${settingsToSave.configs.length} configs`);
      settingsToSave.configs = settingsToSave.configs.map((cfg) => {
        const configCopy = { ...cfg };
        if (configCopy.apiKey) {
          try {
            configCopy.apiKey = encrypt(configCopy.apiKey);
          } catch (err) {
            logToFile(
              `Failed to encrypt API key for config ${cfg.id}: ${err.message}`,
              "ERROR",
            );
          }
        }
        return configCopy;
      });
    }

    // 加密当前设置的API密钥
    if (settingsToSave.current && settingsToSave.current.apiKey) {
      try {
        settingsToSave.current.apiKey = encrypt(settingsToSave.current.apiKey);
        logToFile("Encrypted current API key");
      } catch (err) {
        logToFile(`Failed to encrypt current API key: ${err.message}`, "ERROR");
      }
    }

    // 更新AI设置部分
    config.aiSettings = settingsToSave;

    // 写回配置文件
    const configJson = JSON.stringify(config, null, 2);
    logToFile(`Config to write: ${configJson.substring(0, 100)}...`);
    fs.writeFileSync(configPath, configJson, "utf8");
    logToFile("Successfully saved AI settings");
    return true;
  } catch (error) {
    logToFile(`Failed to save AI settings: ${error.message}`, "ERROR");
    console.error("Failed to save AI settings:", error);
    return false;
  }
};

module.exports = {
  loadAISettings,
  saveAISettings,
};
