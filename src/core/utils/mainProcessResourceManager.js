/**
 * Electron 主进程资源管理器
 * 管理主进程中的所有资源，包括：
 * - Worker 线程
 * - IPC 监听器
 * - 事件监听器
 * - SSH/Telnet 连接
 * - 子进程
 * - 定时器
 */

const { logToFile } = require('./logger');

class MainProcessResourceManager {
  constructor() {
    this.resources = new Map();
    this.resourceIdCounter = 0;
    this.isShuttingDown = false;

    // 资源分类统计
    this.stats = {
      workers: 0,
      ipcHandlers: 0,
      eventListeners: 0,
      connections: 0,
      childProcesses: 0,
      timers: 0,
      cleaned: 0
    };

    // 清理队列 - 按优先级排序
    this.cleanupPriority = {
      'ipcHandler': 1,      // 最高优先级
      'worker': 2,
      'childProcess': 3,
      'connection': 4,
      'eventListener': 5,
      'timer': 6,           // 最低优先级
      'custom': 7
    };

    logToFile('[资源管理器] 已初始化', 'INFO');
  }

  /**
   * 生成唯一资源ID
   */
  generateId(type) {
    return `${type}_${++this.resourceIdCounter}_${Date.now()}`;
  }

  /**
   * 注册 Worker 线程
   */
  addWorker(worker, description = '') {
    if (this.isShuttingDown || !worker) {
      return () => {};
    }

    const id = this.generateId('worker');

    this.resources.set(id, {
      type: 'worker',
      resource: worker,
      description,
      createdAt: Date.now()
    });

    this.stats.workers++;
    logToFile(`[资源管理器] 注册 Worker: ${description} (${id})`, 'DEBUG');

    return () => this.removeResource(id);
  }

  /**
   * 注册 IPC Handler
   */
  addIpcHandler(ipcMain, channel, description = '') {
    if (this.isShuttingDown || !ipcMain || !channel) {
      return () => {};
    }

    const id = this.generateId('ipcHandler');

    this.resources.set(id, {
      type: 'ipcHandler',
      ipcMain,
      channel,
      description,
      createdAt: Date.now()
    });

    this.stats.ipcHandlers++;
    logToFile(`[资源管理器] 注册 IPC Handler: ${channel} (${id})`, 'DEBUG');

    return () => this.removeResource(id);
  }

  /**
   * 注册事件监听器
   */
  addEventListener(target, eventName, handler, description = '') {
    if (this.isShuttingDown || !target || !eventName) {
      return () => {};
    }

    const id = this.generateId('eventListener');

    this.resources.set(id, {
      type: 'eventListener',
      target,
      eventName,
      handler,
      description,
      createdAt: Date.now()
    });

    this.stats.eventListeners++;
    logToFile(`[资源管理器] 注册事件监听器: ${eventName} - ${description} (${id})`, 'DEBUG');

    return () => this.removeResource(id);
  }

  /**
   * 注册 SSH/Telnet 连接
   */
  addConnection(connection, type = 'connection', description = '') {
    if (this.isShuttingDown || !connection) {
      return () => {};
    }

    const id = this.generateId('connection');

    this.resources.set(id, {
      type: 'connection',
      connectionType: type,
      resource: connection,
      description,
      createdAt: Date.now()
    });

    this.stats.connections++;
    logToFile(`[资源管理器] 注册连接: ${type} - ${description} (${id})`, 'DEBUG');

    return () => this.removeResource(id);
  }

  /**
   * 注册子进程
   */
  addChildProcess(process, description = '') {
    if (this.isShuttingDown || !process) {
      return () => {};
    }

    const id = this.generateId('childProcess');

    this.resources.set(id, {
      type: 'childProcess',
      resource: process,
      description,
      createdAt: Date.now()
    });

    this.stats.childProcesses++;
    logToFile(`[资源管理器] 注册子进程: ${description} (${id})`, 'DEBUG');

    return () => this.removeResource(id);
  }

  /**
   * 注册定时器
   */
  addTimer(timerId, timerType = 'timeout', description = '') {
    if (this.isShuttingDown) {
      return () => {};
    }

    const id = this.generateId('timer');

    this.resources.set(id, {
      type: 'timer',
      timerType,
      timerId,
      description,
      createdAt: Date.now()
    });

    this.stats.timers++;

    return () => this.removeResource(id);
  }

  /**
   * 注册自定义清理函数
   */
  addCleanup(cleanupFn, description = '') {
    if (this.isShuttingDown || typeof cleanupFn !== 'function') {
      return () => {};
    }

    const id = this.generateId('custom');

    this.resources.set(id, {
      type: 'custom',
      cleanupFn,
      description,
      createdAt: Date.now()
    });

    logToFile(`[资源管理器] 注册自定义清理: ${description} (${id})`, 'DEBUG');

    return () => this.removeResource(id);
  }

  /**
   * 移除特定资源
   */
  async removeResource(id) {
    const resource = this.resources.get(id);
    if (!resource) return;

    try {
      logToFile(`[资源管理器] 清理资源: ${resource.type} - ${resource.description || ''} (${id})`, 'DEBUG');

      switch (resource.type) {
        case 'worker':
          if (resource.resource && typeof resource.resource.terminate === 'function') {
            await resource.resource.terminate();
          }
          break;

        case 'ipcHandler':
          if (resource.ipcMain && resource.channel) {
            resource.ipcMain.removeHandler(resource.channel);
          }
          break;

        case 'eventListener':
          if (resource.target && resource.eventName && resource.handler) {
            resource.target.removeListener(resource.eventName, resource.handler);
          }
          break;

        case 'connection':
          if (resource.resource) {
            if (typeof resource.resource.end === 'function') {
              resource.resource.end();
            } else if (typeof resource.resource.close === 'function') {
              resource.resource.close();
            } else if (typeof resource.resource.destroy === 'function') {
              resource.resource.destroy();
            }
          }
          break;

        case 'childProcess':
          if (resource.resource && !resource.resource.killed) {
            resource.resource.kill('SIGTERM');

            // 如果5秒后还没有退出，强制kill
            setTimeout(() => {
              if (resource.resource && !resource.resource.killed) {
                resource.resource.kill('SIGKILL');
              }
            }, 5000);
          }
          break;

        case 'timer':
          if (resource.timerType === 'timeout') {
            clearTimeout(resource.timerId);
          } else {
            clearInterval(resource.timerId);
          }
          break;

        case 'custom':
          if (typeof resource.cleanupFn === 'function') {
            await resource.cleanupFn();
          }
          break;
      }

      this.stats.cleaned++;
    } catch (error) {
      logToFile(`[资源管理器] 清理资源失败 (${id}): ${error.message}`, 'ERROR');
    } finally {
      this.resources.delete(id);
    }
  }

  /**
   * 清理所有资源
   */
  async cleanup() {
    if (this.isShuttingDown) {
      logToFile('[资源管理器] 已在清理中，跳过重复调用', 'WARN');
      return;
    }

    this.isShuttingDown = true;
    logToFile(`[资源管理器] 开始清理 ${this.resources.size} 个资源`, 'INFO');

    // 按优先级对资源进行分组
    const resourcesByPriority = new Map();

    for (const [id, resource] of this.resources) {
      const priority = this.cleanupPriority[resource.type] || 999;
      if (!resourcesByPriority.has(priority)) {
        resourcesByPriority.set(priority, []);
      }
      resourcesByPriority.get(priority).push(id);
    }

    // 按优先级排序
    const sortedPriorities = Array.from(resourcesByPriority.keys()).sort((a, b) => a - b);

    // 按优先级清理资源
    for (const priority of sortedPriorities) {
      const resourceIds = resourcesByPriority.get(priority);

      logToFile(`[资源管理器] 清理优先级 ${priority}，共 ${resourceIds.length} 个资源`, 'INFO');

      // 并行清理同优先级资源
      await Promise.allSettled(
        resourceIds.map(id => this.removeResource(id))
      );
    }

    this.resources.clear();
    logToFile('[资源管理器] 清理完成', 'INFO');
    logToFile(`[资源管理器] 统计: ${JSON.stringify(this.stats)}`, 'INFO');
  }

  /**
   * 获取资源统计信息
   */
  getStats() {
    const byType = {};
    const byAge = {
      fresh: 0,    // < 1分钟
      recent: 0,   // 1-5分钟
      old: 0,      // 5-30分钟
      ancient: 0   // > 30分钟
    };

    const now = Date.now();

    for (const resource of this.resources.values()) {
      // 按类型统计
      byType[resource.type] = (byType[resource.type] || 0) + 1;

      // 按年龄统计
      const age = now - resource.createdAt;
      if (age < 60000) {
        byAge.fresh++;
      } else if (age < 300000) {
        byAge.recent++;
      } else if (age < 1800000) {
        byAge.old++;
      } else {
        byAge.ancient++;
      }
    }

    return {
      total: this.resources.size,
      byType,
      byAge,
      lifetime: this.stats,
      isShuttingDown: this.isShuttingDown
    };
  }

  /**
   * 生成详细报告
   */
  generateReport() {
    const resources = Array.from(this.resources.entries()).map(([id, resource]) => ({
      id,
      type: resource.type,
      description: resource.description || '',
      age: Math.round((Date.now() - resource.createdAt) / 1000) + 's',
      details: this.getResourceDetails(resource)
    }));

    return {
      stats: this.getStats(),
      resources,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 获取资源详细信息
   */
  getResourceDetails(resource) {
    switch (resource.type) {
      case 'ipcHandler':
        return { channel: resource.channel };
      case 'eventListener':
        return { eventName: resource.eventName };
      case 'connection':
        return { connectionType: resource.connectionType };
      case 'timer':
        return { timerType: resource.timerType };
      default:
        return {};
    }
  }

  /**
   * 检查长时间未清理的资源
   */
  checkLeaks(maxAge = 1800000) { // 默认30分钟
    const now = Date.now();
    const leaks = [];

    for (const [id, resource] of this.resources) {
      const age = now - resource.createdAt;
      if (age > maxAge) {
        leaks.push({
          id,
          type: resource.type,
          description: resource.description || '',
          age: Math.round(age / 1000) + 's'
        });
      }
    }

    if (leaks.length > 0) {
      logToFile(`[资源管理器] 检测到 ${leaks.length} 个可能的泄漏:`, 'WARN');
      leaks.forEach(leak => {
        logToFile(`  - ${leak.type}: ${leak.description} (${leak.age})`, 'WARN');
      });
    }

    return leaks;
  }
}

// 创建全局实例
const mainProcessResourceManager = new MainProcessResourceManager();

// 定期检查泄漏（仅开发环境）
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    mainProcessResourceManager.checkLeaks();
  }, 300000); // 每5分钟检查一次
}

module.exports = {
  MainProcessResourceManager,
  mainProcessResourceManager
};
