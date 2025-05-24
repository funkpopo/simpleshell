const fs = require("fs");
const { logToFile } = require("../../core/utils/logger");
const { encryptText, decryptText } = require("../../core/utils/crypto");
const { getConfigPath } = require("../../core/utils/config");

// 为了兼容性，创建别名函数
const encrypt = encryptText;
const decrypt = decryptText;

// 导入旧的加密方法用于数据迁移
const crypto = require("crypto");
const LEGACY_ENCRYPTION_KEY = "simple-shell-encryption-key-12345";
const LEGACY_ENCRYPTION_ALGORITHM = "aes-256-cbc";

/**
 * 检测加密数据格式是否为新格式
 * @param {string} encryptedText - 加密的文本
 * @returns {boolean} 是否为新格式
 */
function isNewFormat(encryptedText) {
  if (typeof encryptedText !== "string" || !encryptedText.includes(":")) {
    return false;
  }
  const parts = encryptedText.split(":");
  if (parts.length !== 2) {
    return false;
  }
  // 新格式的IV应该是32个十六进制字符（16字节）
  const ivHex = parts[0];
  return ivHex.length === 32 && /^[0-9a-fA-F]+$/.test(ivHex);
}

/**
 * 使用旧方法解密数据（用于数据迁移）
 * @param {string} text - 要解密的文本
 * @returns {string|null} 解密后的文本，失败返回null
 */
function legacyDecrypt(text) {
  try {
    const textParts = text.split(":");
    const iv = Buffer.from(textParts.shift(), "hex");
    const encryptedText = textParts.join(":");
    const decipher = crypto.createDecipher(LEGACY_ENCRYPTION_ALGORITHM, LEGACY_ENCRYPTION_KEY);
    let decrypted = decipher.update(encryptedText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    logToFile(`Legacy decryption failed: ${error.message}`, "ERROR");
    return null;
  }
}

/**
 * 智能解密函数，支持新旧格式
 * @param {string} encryptedText - 加密的文本
 * @returns {string|null} 解密后的文本，失败返回null
 */
function smartDecrypt(encryptedText) {
  if (!encryptedText) {
    return null;
  }
  
  // 首先尝试新格式解密
  if (isNewFormat(encryptedText)) {
    try {
      return decrypt(encryptedText);
    } catch (error) {
      logToFile(`New format decryption failed: ${error.message}`, "ERROR");
    }
  }
  
  // 如果新格式失败，尝试旧格式解密
  logToFile("Attempting legacy decryption for old format data", "INFO");
  return legacyDecrypt(encryptedText);
}

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

        // 解密所有配置中的API密钥，支持数据迁移
        let needsMigration = false;
        if (settings.configs && Array.isArray(settings.configs)) {
          settings.configs = settings.configs.map((cfg) => {
            if (cfg.apiKey) {
              const decryptedKey = smartDecrypt(cfg.apiKey);
              if (decryptedKey) {
                // 检查是否使用了旧格式
                if (!isNewFormat(cfg.apiKey)) {
                  needsMigration = true;
                  logToFile(`Migrating API key for config ${cfg.id} from old format`, "INFO");
                }
                return { ...cfg, apiKey: decryptedKey };
              } else {
                logToFile(
                  `Failed to decrypt API key for config ${cfg.id}`,
                  "ERROR",
                );
                return cfg;
              }
            }
            return cfg;
          });
        }

        // 解密当前设置的API密钥，支持数据迁移
        if (settings.current && settings.current.apiKey) {
          const decryptedKey = smartDecrypt(settings.current.apiKey);
          if (decryptedKey) {
            // 检查是否使用了旧格式
            if (!isNewFormat(settings.current.apiKey)) {
              needsMigration = true;
              logToFile("Migrating current API key from old format", "INFO");
            }
            settings.current.apiKey = decryptedKey;
          } else {
            logToFile("Failed to decrypt current API key", "ERROR");
          }
        }

        // 如果检测到旧格式数据，自动迁移到新格式
        if (needsMigration) {
          logToFile("Auto-migrating AI settings to new encryption format", "INFO");
          saveAISettings(settings);
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
