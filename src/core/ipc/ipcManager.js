const ipcRegistry = require("../ipc/ipcRegistry");
const TerminalHandlers = require("../ipc/handlers/terminalHandlers");
const FileHandlers = require("../ipc/handlers/fileHandlers");
const SettingsHandlers = require("../ipc/handlers/settingsHandlers");
const AppHandlers = require("../ipc/handlers/appHandlers");
const { logToFile } = require("../utils/logger");

/**
 * 初始化所有IPC处理器的管理器
 */
class IPCManager {
  constructor() {
    this.handlers = {
      terminal: null,
      file: null,
      settings: null,
      app: null
    };
    this.isInitialized = false;
  }

  /**
   * 初始化所有IPC处理器
   * @param {Object} dependencies - 依赖注入对象
   * @param {Map} dependencies.childProcesses - 子进程映射
   * @param {Map} dependencies.terminalProcesses - 终端进程映射
   * @param {Object} dependencies.aiWorker - AI Worker实例
   * @param {Object} dependencies.mainWindow - 主窗口实例
   */
  initialize(dependencies) {
    if (this.isInitialized) {
      logToFile("IPC Manager already initialized", "WARN");
      return;
    }

    const { childProcesses, terminalProcesses, aiWorker, mainWindow } = dependencies;

    try {
      // 创建各个处理器实例
      this.handlers.terminal = new TerminalHandlers(childProcesses, terminalProcesses);
      this.handlers.file = new FileHandlers();
      this.handlers.settings = new SettingsHandlers();
      this.handlers.app = new AppHandlers();

      // 注册所有处理器
      this.registerAllHandlers();
      
      // 如果有AI Worker，初始化AI处理器
      if (aiWorker) {
        this.initializeAIHandlers(aiWorker, mainWindow);
      }

      this.isInitialized = true;
      
      // 输出统计信息
      const stats = ipcRegistry.getStatistics();
      logToFile(`IPC Manager initialized with ${stats.total} handlers`, "INFO");
      logToFile(`Handler distribution: ${JSON.stringify(stats.byCategory)}`, "DEBUG");
      
    } catch (error) {
      logToFile(`Failed to initialize IPC Manager: ${error.message}`, "ERROR");
      throw error;
    }
  }

  /**
   * 注册所有处理器
   */
  registerAllHandlers() {
    // 注册终端处理器
    if (this.handlers.terminal) {
      const terminalHandlers = this.handlers.terminal.getHandlers();
      ipcRegistry.registerBatch(terminalHandlers);
      
      // 注册终端监听器
      const terminalListeners = this.handlers.terminal.getListeners();
      for (const listener of terminalListeners) {
        ipcRegistry.on(listener.channel, listener.category, listener.handler);
      }
    }

    // 注册文件处理器
    if (this.handlers.file) {
      const fileHandlers = this.handlers.file.getHandlers();
      ipcRegistry.registerBatch(fileHandlers);
    }

    // 注册设置处理器
    if (this.handlers.settings) {
      const settingsHandlers = this.handlers.settings.getHandlers();
      ipcRegistry.registerBatch(settingsHandlers);
    }

    // 注册应用处理器
    if (this.handlers.app) {
      const appHandlers = this.handlers.app.getHandlers();
      ipcRegistry.registerBatch(appHandlers);
    }
  }

  /**
   * 初始化AI相关的IPC处理器
   * @param {Object} aiWorker - AI Worker实例
   * @param {Object} mainWindow - 主窗口实例
   */
  initializeAIHandlers(aiWorker, mainWindow) {
    // 动态导入AI处理器以避免循环依赖
    try {
      const AIHandlers = require("../ipc/handlers/aiHandlers");
      this.handlers.ai = new AIHandlers(aiWorker, mainWindow);
      
      const aiHandlers = this.handlers.ai.getHandlers();
      ipcRegistry.registerBatch(aiHandlers);
      
      logToFile("AI handlers initialized", "INFO");
    } catch (error) {
      logToFile(`Failed to initialize AI handlers: ${error.message}`, "ERROR");
    }
  }

  /**
   * 清理特定类别的处理器
   * @param {string} category - 处理器类别
   */
  cleanupCategory(category) {
    const count = ipcRegistry.unregisterCategory(category);
    
    // 清理处理器实例
    if (this.handlers[category] && typeof this.handlers[category].cleanup === 'function') {
      this.handlers[category].cleanup();
    }
    
    logToFile(`Cleaned up ${count} handlers from category: ${category}`, "INFO");
    return count;
  }

  /**
   * 清理所有IPC处理器
   */
  cleanup() {
    logToFile("Starting IPC Manager cleanup", "INFO");
    
    // 清理所有处理器实例
    for (const [category, handler] of Object.entries(this.handlers)) {
      if (handler && typeof handler.cleanup === 'function') {
        try {
          handler.cleanup();
          logToFile(`Cleaned up ${category} handler instance`, "DEBUG");
        } catch (error) {
          logToFile(`Error cleaning up ${category} handler: ${error.message}`, "ERROR");
        }
      }
    }
    
    // 清理IPC注册表
    const cleanedCount = ipcRegistry.cleanup();
    
    this.isInitialized = false;
    logToFile(`IPC Manager cleanup complete. Removed ${cleanedCount} handlers`, "INFO");
    
    return cleanedCount;
  }

  /**
   * 获取当前注册的处理器统计信息
   */
  getStatistics() {
    return ipcRegistry.getStatistics();
  }

  /**
   * 检查处理器是否已注册
   * @param {string} channel - IPC通道名称
   */
  hasHandler(channel) {
    return ipcRegistry.has(channel);
  }

  /**
   * 重新加载特定类别的处理器
   * @param {string} category - 处理器类别
   */
  reloadCategory(category) {
    // 先清理旧的处理器
    this.cleanupCategory(category);
    
    // 重新注册处理器
    if (this.handlers[category]) {
      const handlers = this.handlers[category].getHandlers();
      ipcRegistry.registerBatch(handlers);
      
      // 如果有监听器，也重新注册
      if (typeof this.handlers[category].getListeners === 'function') {
        const listeners = this.handlers[category].getListeners();
        for (const listener of listeners) {
          ipcRegistry.on(listener.channel, listener.category, listener.handler);
        }
      }
      
      logToFile(`Reloaded ${category} handlers`, "INFO");
    }
  }
}

// 创建单例实例
const ipcManager = new IPCManager();

module.exports = ipcManager;