const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const { encryptText, decryptText } = require("./crypto");

// 默认日志配置
const DEFAULT_LOG_CONFIG = {
  level: "INFO", // 日志级别：DEBUG, INFO, WARN, ERROR
  maxFileSize: 5 * 1024 * 1024, // 最大文件大小（字节）
  maxFiles: 5, // 最大历史文件数
  compressOldLogs: true, // 是否压缩旧日志
};

function getConfigPath() {
  try {
    // 判断是否为开发环境
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;

    if (isDev) {
      // 开发环境：使用应用根目录下的config.json
      return path.join(__dirname, "..", "..", "..", "config.json");
    } else {
      // 生产环境：使用exe同级目录下的config.json
      const exePath = process.execPath;
      const exeDir = path.dirname(exePath);
      return path.join(exeDir, "config.json");
    }
  } catch (error) {
    // 如果获取路径失败，使用当前目录
    return path.join(__dirname, "..", "..", "..", "config.json");
  }
}

function processConnectionsForSave(items) {
  return items.map((item) => {
    const processedItem = { ...item };

    // 加密敏感字段
    if (processedItem.password) {
      processedItem.password = encryptText(processedItem.password);
    }
    if (processedItem.passphrase) {
      processedItem.passphrase = encryptText(processedItem.passphrase);
    }

    return processedItem;
  });
}

function processConnectionsForLoad(items) {
  return items.map((item) => {
    const processedItem = { ...item };

    try {
      // 解密敏感字段
      if (processedItem.password) {
        processedItem.password = decryptText(processedItem.password);
      }
      if (processedItem.passphrase) {
        processedItem.passphrase = decryptText(processedItem.passphrase);
      }
    } catch (error) {
      // 如果解密失败，保持原值（可能是未加密的旧数据）
    }

    return processedItem;
  });
}

const loadConnectionsConfig = () => {
  try {
    const configPath = getConfigPath();

    if (!fs.existsSync(configPath)) {
      return [];
    }

    const data = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(data);

    if (!config.connections) {
      return [];
    }

    return processConnectionsForLoad(config.connections);
  } catch (error) {
    return [];
  }
};

const saveConnectionsConfig = (connections) => {
  try {
    const configPath = getConfigPath();
    let config = {};

    // 如果配置文件已存在，先读取现有配置
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, "utf8");
      config = JSON.parse(data);
    }

    // 处理连接配置（加密敏感信息）
    config.connections = processConnectionsForSave(connections);

    // 写入配置文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

    return true;
  } catch (error) {
    return false;
  }
};

async function loadUISettings() {
  try {
    const configPath = getConfigPath();

    // 检查配置文件是否存在
    if (!fs.existsSync(configPath)) {
      // 返回默认设置
      return {
        language: "zh-CN",
        fontSize: 14,
        darkMode: true,
      };
    }

    // 读取配置文件
    const data = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(data);

    // 如果配置中没有uiSettings，返回默认值
    if (!config.uiSettings) {
      return {
        language: "zh-CN",
        fontSize: 14,
        darkMode: true,
        performance: {
          webglEnabled: true,
          imageSupported: true,
          cacheEnabled: true,
          prefetchEnabled: true
        }
      };
    }

    // 确保所有必要的字段都存在，添加默认值
    const uiSettings = {
      language: config.uiSettings.language || "zh-CN",
      fontSize: config.uiSettings.fontSize || 14,
      darkMode:
        config.uiSettings.darkMode !== undefined
          ? config.uiSettings.darkMode
          : true,
      performance: {
        webglEnabled: config.uiSettings.performance?.webglEnabled !== false,
        imageSupported: config.uiSettings.performance?.imageSupported !== false,
        cacheEnabled: config.uiSettings.performance?.cacheEnabled !== false,
        prefetchEnabled: config.uiSettings.performance?.prefetchEnabled !== false
      }
    };

    return uiSettings;
  } catch (error) {
    // 出错时返回默认设置
    return {
      language: "zh-CN",
      fontSize: 14,
      darkMode: true,
      performance: {
        webglEnabled: true,
        imageSupported: true,
        cacheEnabled: true,
        prefetchEnabled: true
      }
    };
  }
}

async function saveUISettings(settings) {
  try {
    const configPath = getConfigPath();
    let config = {};

    // 检查配置文件是否存在
    if (fs.existsSync(configPath)) {
      // 读取现有配置
      const data = fs.readFileSync(configPath, "utf8");
      config = JSON.parse(data);
    }

    // 确保设置包含所有必要字段
    const completeSettings = {
      language: settings.language || "zh-CN",
      fontSize: settings.fontSize || 14,
      darkMode: settings.darkMode !== undefined ? settings.darkMode : true,
      performance: {
        webglEnabled: settings.performance?.webglEnabled !== false,
        imageSupported: settings.performance?.imageSupported !== false,
        cacheEnabled: settings.performance?.cacheEnabled !== false,
        prefetchEnabled: settings.performance?.prefetchEnabled !== false
      }
    };

    // 更新UI设置
    config.uiSettings = completeSettings;

    // 写入配置文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 加载日志设置
function loadLogSettings() {
  try {
    const configPath = getConfigPath();

    // 检查配置文件是否存在
    if (!fs.existsSync(configPath)) {
      // 返回默认设置
      return DEFAULT_LOG_CONFIG;
    }

    // 读取配置文件
    const data = fs.readFileSync(configPath, "utf8");
    const config = JSON.parse(data);

    // 如果配置中没有logSettings，返回默认值
    if (!config.logSettings) {
      return DEFAULT_LOG_CONFIG;
    }

    // 合并默认配置和用户配置
    return {
      ...DEFAULT_LOG_CONFIG,
      ...config.logSettings,
    };
  } catch (error) {
    // 出错时返回默认设置
    return DEFAULT_LOG_CONFIG;
  }
}

// 保存日志设置
function saveLogSettings(settings) {
  try {
    const configPath = getConfigPath();
    let config = {};

    // 检查配置文件是否存在
    if (fs.existsSync(configPath)) {
      // 读取现有配置
      const data = fs.readFileSync(configPath, "utf8");
      config = JSON.parse(data);
    }

    // 确保设置包含所有必要字段
    const completeSettings = {
      ...DEFAULT_LOG_CONFIG,
      ...settings,
    };

    // 更新日志设置
    config.logSettings = completeSettings;

    // 写入配置文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

const initializeConfig = () => {
  try {
    const configPath = getConfigPath();

    // 如果配置文件不存在，创建默认配置
    if (!fs.existsSync(configPath)) {
      const defaultConfig = {
        connections: [],
        uiSettings: {
          language: "zh-CN",
          fontSize: 14,
          darkMode: true,
        },
        logSettings: DEFAULT_LOG_CONFIG,
      };

      // 确保配置目录存在
      const configDir = path.dirname(configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }

      fs.writeFileSync(
        configPath,
        JSON.stringify(defaultConfig, null, 2),
        "utf8",
      );
    } else {
      // 如果配置文件已存在，但没有logSettings部分，添加默认日志设置
      const data = fs.readFileSync(configPath, "utf8");
      const config = JSON.parse(data);

      if (!config.logSettings) {
        config.logSettings = DEFAULT_LOG_CONFIG;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
      }
    }

    return { success: true, path: configPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

module.exports = {
  getConfigPath,
  processConnectionsForSave,
  processConnectionsForLoad,
  loadConnectionsConfig,
  saveConnectionsConfig,
  loadUISettings,
  saveUISettings,
  loadLogSettings,
  saveLogSettings,
  initializeConfig,
};
