/**
 * 统一资源管理器 - 处理应用程序中的所有资源清理
 * 包括事件监听器、定时器、观察者、WebSocket连接等
 */

class ResourceManager {
  constructor(name = 'ResourceManager') {
    this.name = name;
    this.resources = new Map();
    this.resourceIdCounter = 0;
    this.isDestroyed = false;
    this.controller = null; // 全局 AbortController

    // 资源统计
    this.stats = {
      created: 0,
      cleaned: 0,
      leaked: 0
    };

    // 开发环境下的泄漏检测
    if (process.env.NODE_ENV === 'development') {
      this.enableLeakDetection();
    }
  }

  /**
   * 生成唯一资源ID
   */
  generateId() {
    return `${this.name}_${++this.resourceIdCounter}_${Date.now()}`;
  }

  /**
   * 创建全局 AbortController
   */
  createGlobalController() {
    if (!this.controller && typeof AbortController !== 'undefined') {
      this.controller = new AbortController();
    }
    return this.controller;
  }

  /**
   * 获取全局 AbortSignal
   */
  getSignal() {
    if (!this.controller) {
      this.createGlobalController();
    }
    return this.controller?.signal;
  }

  /**
   * 注册事件监听器（支持 AbortController）
   */
  addEventListener(target, eventName, handler, options = {}) {
    if (this.isDestroyed || !target || !eventName || !handler) {
      return () => {};
    }

    const id = this.generateId();

    // 如果支持 AbortController 且未提供 signal，使用全局 signal
    const finalOptions = { ...options };
    if (typeof AbortController !== 'undefined' && !finalOptions.signal) {
      finalOptions.signal = this.getSignal();
    }

    // 包装处理函数以捕获错误
    const wrappedHandler = (...args) => {
      try {
        return handler(...args);
      } catch (error) {
        console.error(`[${this.name}] 事件处理器错误:`, error);
      }
    };

    target.addEventListener(eventName, wrappedHandler, finalOptions);

    // 存储资源信息
    this.resources.set(id, {
      type: 'eventListener',
      target,
      eventName,
      handler: wrappedHandler,
      options: finalOptions,
      createdAt: Date.now(),
      stack: this.captureStack()
    });

    this.stats.created++;

    // 返回清理函数
    return () => this.removeResource(id);
  }

  /**
   * 注册定时器 (setTimeout)
   */
  setTimeout(callback, delay, ...args) {
    if (this.isDestroyed) {
      return () => {};
    }

    const id = this.generateId();
    let timerId = null;

    const wrappedCallback = () => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`[${this.name}] 定时器回调错误:`, error);
      } finally {
        // 自动清理已执行的定时器
        this.removeResource(id);
      }
    };

    timerId = setTimeout(wrappedCallback, delay);

    this.resources.set(id, {
      type: 'timeout',
      timerId,
      createdAt: Date.now(),
      stack: this.captureStack()
    });

    this.stats.created++;

    return () => this.removeResource(id);
  }

  /**
   * 注册定时器 (setInterval)
   */
  setInterval(callback, interval, ...args) {
    if (this.isDestroyed) {
      return () => {};
    }

    const id = this.generateId();

    const wrappedCallback = () => {
      try {
        callback(...args);
      } catch (error) {
        console.error(`[${this.name}] 定时器回调错误:`, error);
      }
    };

    const timerId = setInterval(wrappedCallback, interval);

    this.resources.set(id, {
      type: 'interval',
      timerId,
      createdAt: Date.now(),
      stack: this.captureStack()
    });

    this.stats.created++;

    return () => this.removeResource(id);
  }

  /**
   * 注册观察者 (ResizeObserver, IntersectionObserver, MutationObserver)
   */
  addObserver(observer, type = 'observer') {
    if (this.isDestroyed || !observer) {
      return () => {};
    }

    const id = this.generateId();

    this.resources.set(id, {
      type,
      observer,
      createdAt: Date.now(),
      stack: this.captureStack()
    });

    this.stats.created++;

    return () => this.removeResource(id);
  }

  /**
   * 注册 WebSocket 连接
   */
  addWebSocket(ws) {
    if (this.isDestroyed || !ws) {
      return () => {};
    }

    const id = this.generateId();

    this.resources.set(id, {
      type: 'websocket',
      ws,
      createdAt: Date.now(),
      stack: this.captureStack()
    });

    this.stats.created++;

    return () => this.removeResource(id);
  }

  /**
   * 注册自定义清理函数
   */
  addCleanup(cleanupFn, description = '') {
    if (this.isDestroyed || typeof cleanupFn !== 'function') {
      return () => {};
    }

    const id = this.generateId();

    this.resources.set(id, {
      type: 'custom',
      cleanupFn,
      description,
      createdAt: Date.now(),
      stack: this.captureStack()
    });

    this.stats.created++;

    return () => this.removeResource(id);
  }

  /**
   * 移除特定资源
   */
  removeResource(id) {
    const resource = this.resources.get(id);
    if (!resource) return;

    try {
      switch (resource.type) {
        case 'eventListener':
          // 如果使用了 AbortController，不需要手动移除
          if (!resource.options?.signal) {
            resource.target.removeEventListener(
              resource.eventName,
              resource.handler,
              resource.options
            );
          }
          break;

        case 'timeout':
          clearTimeout(resource.timerId);
          break;

        case 'interval':
          clearInterval(resource.timerId);
          break;

        case 'observer':
        case 'resizeObserver':
        case 'intersectionObserver':
        case 'mutationObserver':
          if (resource.observer && typeof resource.observer.disconnect === 'function') {
            resource.observer.disconnect();
          }
          break;

        case 'websocket':
          if (resource.ws && resource.ws.readyState !== WebSocket.CLOSED) {
            resource.ws.close();
          }
          break;

        case 'custom':
          if (typeof resource.cleanupFn === 'function') {
            resource.cleanupFn();
          }
          break;
      }

      this.stats.cleaned++;
    } catch (error) {
      console.error(`[${this.name}] 清理资源失败 (${id}):`, error);
    } finally {
      this.resources.delete(id);
    }
  }

  /**
   * 清理所有资源
   */
  cleanup() {
    if (this.isDestroyed) return;

    console.log(`[${this.name}] 开始清理 ${this.resources.size} 个资源`);

    // 使用 AbortController 批量取消所有事件监听器
    if (this.controller && !this.controller.signal.aborted) {
      this.controller.abort();
    }

    // 逆序清理资源（后创建的先清理）
    const ids = Array.from(this.resources.keys()).reverse();
    for (const id of ids) {
      this.removeResource(id);
    }

    this.resources.clear();
    this.isDestroyed = true;

    // 打印统计信息
    const leaked = this.stats.created - this.stats.cleaned;
    if (leaked > 0) {
      console.warn(`[${this.name}] 可能存在 ${leaked} 个资源泄漏`);
      this.stats.leaked = leaked;
    }

    console.log(`[${this.name}] 清理完成，统计:`, this.stats);
  }

  /**
   * 获取资源统计信息
   */
  getStats() {
    const byType = {};

    for (const resource of this.resources.values()) {
      byType[resource.type] = (byType[resource.type] || 0) + 1;
    }

    return {
      total: this.resources.size,
      byType,
      stats: this.stats,
      isDestroyed: this.isDestroyed
    };
  }

  /**
   * 捕获堆栈跟踪（开发环境）
   */
  captureStack() {
    if (process.env.NODE_ENV !== 'development') {
      return null;
    }

    try {
      throw new Error();
    } catch (e) {
      return e.stack;
    }
  }

  /**
   * 启用泄漏检测（开发环境）
   */
  enableLeakDetection() {
    // 定期检查长时间未清理的资源
    const checkInterval = 60000; // 1分钟

    const check = () => {
      if (this.isDestroyed) return;

      const now = Date.now();
      const oldResources = [];

      for (const [id, resource] of this.resources) {
        const age = now - resource.createdAt;
        if (age > 300000) { // 5分钟
          oldResources.push({ id, ...resource, age });
        }
      }

      if (oldResources.length > 0) {
        console.warn(
          `[${this.name}] 检测到 ${oldResources.length} 个长时间未清理的资源:`,
          oldResources.map(r => ({
            id: r.id,
            type: r.type,
            age: Math.round(r.age / 1000) + 's',
            description: r.description || r.eventName || ''
          }))
        );
      }

      // 继续检查
      this.setTimeout(check, checkInterval);
    };

    this.setTimeout(check, checkInterval);
  }

  /**
   * 生成详细报告
   */
  generateReport() {
    const resources = Array.from(this.resources.entries()).map(([id, resource]) => ({
      id,
      type: resource.type,
      age: Date.now() - resource.createdAt,
      description: resource.description || resource.eventName || '',
      stack: resource.stack
    }));

    return {
      name: this.name,
      stats: this.getStats(),
      resources,
      timestamp: new Date().toISOString()
    };
  }
}

// 创建全局实例（用于浏览器环境）
let globalResourceManager = null;

/**
 * 获取或创建全局资源管理器
 */
function getGlobalResourceManager() {
  if (!globalResourceManager) {
    globalResourceManager = new ResourceManager('Global');

    // 在页面卸载时清理
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        globalResourceManager.cleanup();
      });
    }
  }

  return globalResourceManager;
}

/**
 * React Hook: 使用资源管理器
 */
function useResourceManager(name) {
  if (typeof require === 'function') {
    const { useRef, useEffect } = require('react');
    const managerRef = useRef(null);

    if (!managerRef.current) {
      managerRef.current = new ResourceManager(name || 'Component');
    }

    useEffect(() => {
      const manager = managerRef.current;

      return () => {
        if (manager && !manager.isDestroyed) {
          manager.cleanup();
        }
      };
    }, []);

    return managerRef.current;
  }

  return new ResourceManager(name);
}

// Node.js环境导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ResourceManager,
    getGlobalResourceManager,
    useResourceManager
  };
}

// ES Module导出
if (typeof exports !== 'undefined') {
  exports.ResourceManager = ResourceManager;
  exports.getGlobalResourceManager = getGlobalResourceManager;
  exports.useResourceManager = useResourceManager;
}

// 浏览器环境全局导出
if (typeof window !== 'undefined') {
  window.ResourceManager = ResourceManager;
  window.getGlobalResourceManager = getGlobalResourceManager;
  window.useResourceManager = useResourceManager;
}
