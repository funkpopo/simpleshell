const path = require("path");
const fs = require("fs");

let logFile = null; // Will be set by initLogger
let appInstance = null;

/**
 * 检测当前运行环境
 * @param {Electron.App} electronApp - Electron应用实例
 * @returns {string} 'development' 或 'production'
 */
function detectEnvironment(electronApp) {
  // 主要检测方法：使用app.isPackaged
  if (electronApp && typeof electronApp.isPackaged === 'boolean') {
    return electronApp.isPackaged ? 'production' : 'development';
  }
  
  // 备用检测方法1：NODE_ENV环境变量
  if (process.env.NODE_ENV === 'development') {
    return 'development';
  }
  if (process.env.NODE_ENV === 'production') {
    return 'production';
  }
  
  // 备用检测方法2：路径分析
  if (__dirname.includes('node_modules') || __dirname.includes('.webpack')) {
    return 'production';
  }
  
  // 默认为开发环境
  return 'development';
}

/**
 * 根据环境获取日志目录路径
 * @param {Electron.App} electronApp - Electron应用实例
 * @returns {string} 日志目录路径
 */
function getLogDirectory(electronApp) {
  const environment = detectEnvironment(electronApp);
  
  if (environment === 'development') {
    // 开发环境：使用项目根目录下的log文件夹
    return path.join(process.cwd(), 'log');
  } else {
    // 生产环境：使用exe同级的log文件夹
    return path.join(path.dirname(process.execPath), 'log');
  }
}

// 初始化日志模块，必须在 app 'ready' 后调用
function initLogger(electronApp) {
  appInstance = electronApp;
  const environment = detectEnvironment(electronApp);
  
  try {
    // 根据环境选择日志目录
    const logDir = getLogDirectory(electronApp);
    
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    logFile = path.join(logDir, "app.log");
    
    // 写入初始化成功的日志，包含环境信息
    logToFileInternal(
      `Logger initialized in ${environment} environment. Log path: ${logFile}`, 
      "INFO", 
      true
    );
    
  } catch (error) {
    console.error(
      "Failed to initialize logger with environment-specific path:",
      error,
    );
    
    // 第一级回退：使用Electron默认日志路径
    try {
      const electronLogDir = electronApp.getPath("logs");
      if (!fs.existsSync(electronLogDir)) {
        fs.mkdirSync(electronLogDir, { recursive: true });
      }
      logFile = path.join(electronLogDir, "app.log");
      logToFileInternal(
        `Logger initialized with Electron default path (fallback level 1): ${logFile}`,
        "WARN",
        true,
      );
    } catch (electronError) {
      console.error(
        "Failed to initialize logger with Electron default path:",
        electronError,
      );
      
      // 第二级回退：使用基于__dirname的路径
      try {
        const fallbackLogDir = path.join(__dirname, "..", "..", "..", "logs");
        if (!fs.existsSync(fallbackLogDir)) {
          fs.mkdirSync(fallbackLogDir, { recursive: true });
        }
        logFile = path.join(fallbackLogDir, "app_fallback.log");
        logToFileInternal(
          `Logger initialized with __dirname-based path (fallback level 2): ${logFile}`,
          "WARN",
          true,
        );
      } catch (fallbackError) {
        console.error(
          "Failed to initialize logger with __dirname-based path:",
          fallbackError,
        );
        
        // 最终回退：直接在工作目录下
        logFile = "app_emergency.log";
        logToFileInternal(
          `Logger initialized with emergency path in current working directory (fallback level 3): ${logFile}`,
          "ERROR",
          true,
        );
      }
    }
  }
}

// 内部日志函数，允许在 initLogger 自身中使用，避免循环依赖或在 logFile 未设置时出错
function logToFileInternal(message, type = "INFO", isInitialization = false) {
  if (!logFile && !isInitialization) {
    // 如果 logFile 未设置且不是初始化调用，说明 initLogger 未被调用或失败
    console.error(
      "Logger not initialized. Call initLogger(app) first. Message: ",
      message,
    );
    return;
  }
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type}] ${message}\n`;
    // 对于初始化阶段的日志，如果 logFile 仍然为 null (例如，在 initLogger 内部，路径设置失败前的 console.error 后的回退尝试)
    // 这种情况应该由 initLogger 内部的 try-catch 处理，这里主要是防止外部调用时 logFile 为 null。
    // 如果是初始化调用，则路径可能正在被设置，所以使用当前 logFile 的值。
    const currentLogPath =
      isInitialization && logFile ? logFile : logFile || "app_init_error.log";
    fs.appendFileSync(currentLogPath, logEntry);
  } catch (error) {
    console.error(
      "Failed to write to log file:",
      error,
      "Original message:",
      message,
    );
  }
}

// 公开的日志函数
const logToFile = (message, type = "INFO") => {
  logToFileInternal(message, type, false);
};

/**
 * 记录信息日志
 * @param {string} message - 日志消息
 */
const logInfo = (message) => {
  logToFile(message, "INFO");
};

/**
 * 记录警告日志
 * @param {string} message - 日志消息
 */
const logWarn = (message) => {
  logToFile(message, "WARN");
};

/**
 * 记录错误日志
 * @param {string} message - 日志消息
 */
const logError = (message) => {
  logToFile(message, "ERROR");
};

/**
 * 记录调试日志
 * @param {string} message - 日志消息
 */
const logDebug = (message) => {
  logToFile(message, "DEBUG");
};

module.exports = {
  logToFile,
  initLogger,
  logInfo,
  logWarn,
  logError,
  logDebug,
  logFile,
};
