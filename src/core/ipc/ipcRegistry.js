const { ipcMain } = require("electron");
const { logToFile } = require("../utils/logger");

class IPCRegistry {
  constructor() {
    this.handlers = new Map();
    this.categories = new Map();
  }

  /**
   * 注册IPC处理器并归类
   * @param {string} channel - IPC通道名称
   * @param {string} category - 处理器类别（如：terminal, file, ai, app, settings）
   * @param {Function} handler - 处理函数
   * @param {Object} options - 配置选项
   */
  register(channel, category, handler, options = {}) {
    if (this.handlers.has(channel)) {
      logToFile(`Warning: Overwriting existing handler for ${channel}`, "WARN");
    }

    const wrappedHandler = async (event, ...args) => {
      try {
        const startTime = Date.now();
        const result = await handler(event, ...args);
        
        if (options.logPerformance) {
          const duration = Date.now() - startTime;
          if (duration > 100) {
            logToFile(`IPC ${channel} took ${duration}ms`, "WARN");
          }
        }
        
        return result;
      } catch (error) {
        logToFile(`Error in IPC handler ${channel}: ${error.message}`, "ERROR");
        throw error;
      }
    };

    // 注册处理器
    ipcMain.handle(channel, wrappedHandler);
    
    // 存储元数据
    this.handlers.set(channel, {
      category,
      handler: wrappedHandler,
      originalHandler: handler,
      options
    });

    // 按类别分组
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    this.categories.get(category).add(channel);

    return this;
  }

  /**
   * 批量注册处理器
   * @param {Array} handlers - 处理器配置数组
   */
  registerBatch(handlers) {
    for (const { channel, category, handler, options } of handlers) {
      this.register(channel, category, handler, options);
    }
    return this;
  }

  /**
   * 注册单向IPC监听器（用于不需要返回值的情况）
   * @param {string} channel - IPC通道名称
   * @param {string} category - 处理器类别
   * @param {Function} handler - 处理函数
   */
  on(channel, category, handler) {
    if (this.handlers.has(channel)) {
      logToFile(`Warning: Overwriting existing listener for ${channel}`, "WARN");
    }

    const wrappedHandler = (event, ...args) => {
      try {
        handler(event, ...args);
      } catch (error) {
        logToFile(`Error in IPC listener ${channel}: ${error.message}`, "ERROR");
      }
    };

    // 注册监听器
    ipcMain.on(channel, wrappedHandler);
    
    // 存储元数据
    this.handlers.set(channel, {
      category,
      handler: wrappedHandler,
      originalHandler: handler,
      type: 'listener'
    });

    // 按类别分组
    if (!this.categories.has(category)) {
      this.categories.set(category, new Set());
    }
    this.categories.get(category).add(channel);

    return this;
  }

  /**
   * 移除指定通道的处理器
   * @param {string} channel - IPC通道名称
   */
  unregister(channel) {
    const handlerInfo = this.handlers.get(channel);
    if (!handlerInfo) {
      return false;
    }

    // 移除IPC处理器
    if (handlerInfo.type === 'listener') {
      ipcMain.removeAllListeners(channel);
    } else {
      ipcMain.removeHandler(channel);
    }

    // 从类别中移除
    const category = handlerInfo.category;
    if (this.categories.has(category)) {
      this.categories.get(category).delete(channel);
      if (this.categories.get(category).size === 0) {
        this.categories.delete(category);
      }
    }

    // 从处理器映射中移除
    this.handlers.delete(channel);
    
    logToFile(`Unregistered IPC handler: ${channel}`, "DEBUG");
    return true;
  }

  /**
   * 移除指定类别的所有处理器
   * @param {string} category - 处理器类别
   */
  unregisterCategory(category) {
    const channels = this.categories.get(category);
    if (!channels) {
      return 0;
    }

    let count = 0;
    for (const channel of channels) {
      if (this.unregister(channel)) {
        count++;
      }
    }

    logToFile(`Unregistered ${count} handlers from category: ${category}`, "INFO");
    return count;
  }

  /**
   * 清理所有IPC处理器
   */
  cleanup() {
    let totalCount = 0;
    
    for (const [channel, handlerInfo] of this.handlers) {
      try {
        if (handlerInfo.type === 'listener') {
          ipcMain.removeAllListeners(channel);
        } else {
          ipcMain.removeHandler(channel);
        }
        totalCount++;
      } catch (error) {
        logToFile(`Error cleaning up handler ${channel}: ${error.message}`, "ERROR");
      }
    }

    this.handlers.clear();
    this.categories.clear();
    
    logToFile(`Cleaned up ${totalCount} IPC handlers`, "INFO");
    return totalCount;
  }

  /**
   * 获取注册的处理器统计信息
   */
  getStatistics() {
    const stats = {
      total: this.handlers.size,
      byCategory: {},
      channels: []
    };

    for (const [category, channels] of this.categories) {
      stats.byCategory[category] = channels.size;
    }

    for (const [channel, info] of this.handlers) {
      stats.channels.push({
        channel,
        category: info.category,
        type: info.type || 'handler'
      });
    }

    return stats;
  }

  /**
   * 检查处理器是否已注册
   * @param {string} channel - IPC通道名称
   */
  has(channel) {
    return this.handlers.has(channel);
  }

  /**
   * 获取指定类别的所有通道
   * @param {string} category - 处理器类别
   */
  getChannelsByCategory(category) {
    return Array.from(this.categories.get(category) || []);
  }
}

// 创建单例实例
const ipcRegistry = new IPCRegistry();

module.exports = ipcRegistry;