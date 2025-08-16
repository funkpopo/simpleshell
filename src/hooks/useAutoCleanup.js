import { useEffect, useRef, useCallback } from "react";

/**
 * 自动清理管理器Hook
 * 自动管理和清理定时器、事件监听器、观察器等资源
 * 防止内存泄漏
 */
export function useAutoCleanup() {
  const cleanupManagerRef = useRef(null);

  // 初始化清理管理器
  if (!cleanupManagerRef.current) {
    cleanupManagerRef.current = new CleanupManager();
  }

  // 组件卸载时自动清理所有资源
  useEffect(() => {
    return () => {
      if (cleanupManagerRef.current) {
        cleanupManagerRef.current.cleanup();
        cleanupManagerRef.current = null;
      }
    };
  }, []);

  // 添加定时器
  const addTimeout = useCallback((callback, delay) => {
    return cleanupManagerRef.current?.addTimeout(callback, delay);
  }, []);

  const addInterval = useCallback((callback, interval) => {
    return cleanupManagerRef.current?.addInterval(callback, interval);
  }, []);

  // 添加事件监听器
  const addEventListener = useCallback((target, event, handler, options) => {
    return cleanupManagerRef.current?.addEventListener(
      target,
      event,
      handler,
      options
    );
  }, []);

  // 添加观察器
  const addResizeObserver = useCallback((callback, element, options) => {
    return cleanupManagerRef.current?.addResizeObserver(
      callback,
      element,
      options
    );
  }, []);

  const addIntersectionObserver = useCallback((callback, element, options) => {
    return cleanupManagerRef.current?.addIntersectionObserver(
      callback,
      element,
      options
    );
  }, []);

  const addMutationObserver = useCallback((callback, element, options) => {
    return cleanupManagerRef.current?.addMutationObserver(
      callback,
      element,
      options
    );
  }, []);

  // 添加自定义清理函数
  const addCleanup = useCallback((cleanupFn) => {
    return cleanupManagerRef.current?.addCleanup(cleanupFn);
  }, []);

  // 添加 AbortController
  const createAbortController = useCallback(() => {
    return cleanupManagerRef.current?.createAbortController();
  }, []);

  // 获取统计信息
  const getStats = useCallback(() => {
    return cleanupManagerRef.current?.getStats() || {};
  }, []);

  // 手动清理特定资源
  const removeResource = useCallback((resourceId) => {
    return cleanupManagerRef.current?.removeResource(resourceId);
  }, []);

  return {
    addTimeout,
    addInterval,
    addEventListener,
    addResizeObserver,
    addIntersectionObserver,
    addMutationObserver,
    addCleanup,
    createAbortController,
    getStats,
    removeResource,
  };
}

/**
 * 清理管理器类
 */
class CleanupManager {
  constructor() {
    this.resources = new Map();
    this.resourceIdCounter = 0;
    this.isDestroyed = false;
  }

  generateId() {
    return `resource_${++this.resourceIdCounter}_${Date.now()}`;
  }

  addResource(type, resource, cleanupFn) {
    if (this.isDestroyed) return null;

    const id = this.generateId();
    this.resources.set(id, {
      type,
      resource,
      cleanupFn,
      createdAt: Date.now(),
    });

    // 返回移除函数
    return () => this.removeResource(id);
  }

  removeResource(id) {
    const resource = this.resources.get(id);
    if (resource) {
      try {
        resource.cleanupFn();
      } catch (error) {
        console.error(`清理资源失败 (${id}):`, error);
      }
      this.resources.delete(id);
    }
  }

  // 定时器管理
  addTimeout(callback, delay) {
    if (this.isDestroyed) return () => {};

    const timerId = setTimeout(() => {
      try {
        callback();
      } catch (error) {
        console.error("定时器回调执行失败:", error);
      }
      // 执行后自动从资源列表中移除
      this.removeResourceByValue("timeout", timerId);
    }, delay);

    return this.addResource("timeout", timerId, () => clearTimeout(timerId));
  }

  addInterval(callback, interval) {
    if (this.isDestroyed) return () => {};

    const wrappedCallback = () => {
      try {
        callback();
      } catch (error) {
        console.error("定时器回调执行失败:", error);
      }
    };

    const timerId = setInterval(wrappedCallback, interval);
    return this.addResource("interval", timerId, () => clearInterval(timerId));
  }

  // 事件监听器管理
  addEventListener(target, event, handler, options = {}) {
    if (this.isDestroyed || !target) return () => {};

    const wrappedHandler = (...args) => {
      try {
        return handler(...args);
      } catch (error) {
        console.error("事件处理器执行失败:", error);
      }
    };

    target.addEventListener(event, wrappedHandler, options);

    return this.addResource(
      "eventListener",
      { target, event, handler: wrappedHandler, options },
      () => target.removeEventListener(event, wrappedHandler, options)
    );
  }

  // ResizeObserver 管理
  addResizeObserver(callback, element, options = {}) {
    if (this.isDestroyed || !element) return () => {};

    const observer = new ResizeObserver((entries) => {
      try {
        callback(entries);
      } catch (error) {
        console.error("ResizeObserver 回调执行失败:", error);
      }
    });

    observer.observe(element, options);

    return this.addResource("resizeObserver", observer, () =>
      observer.disconnect()
    );
  }

  // IntersectionObserver 管理
  addIntersectionObserver(callback, element, options = {}) {
    if (this.isDestroyed || !element) return () => {};

    const observer = new IntersectionObserver((entries) => {
      try {
        callback(entries);
      } catch (error) {
        console.error("IntersectionObserver 回调执行失败:", error);
      }
    }, options);

    observer.observe(element);

    return this.addResource("intersectionObserver", observer, () =>
      observer.disconnect()
    );
  }

  // MutationObserver 管理
  addMutationObserver(callback, element, options = {}) {
    if (this.isDestroyed || !element) return () => {};

    const observer = new MutationObserver((mutations) => {
      try {
        callback(mutations);
      } catch (error) {
        console.error("MutationObserver 回调执行失败:", error);
      }
    });

    observer.observe(element, options);

    return this.addResource("mutationObserver", observer, () =>
      observer.disconnect()
    );
  }

  // AbortController 管理
  createAbortController() {
    if (this.isDestroyed) return null;

    const controller = new AbortController();

    this.addResource("abortController", controller, () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    });

    return controller;
  }

  // 自定义清理函数
  addCleanup(cleanupFn) {
    if (this.isDestroyed || typeof cleanupFn !== "function") return () => {};

    return this.addResource("custom", cleanupFn, cleanupFn);
  }

  // 通过值查找并移除资源
  removeResourceByValue(type, value) {
    for (const [id, resource] of this.resources) {
      if (resource.type === type && resource.resource === value) {
        this.removeResource(id);
        break;
      }
    }
  }

  // 获取统计信息
  getStats() {
    const stats = {
      total: this.resources.size,
      byType: {},
      oldestResource: null,
      memoryEstimate: 0,
    };

    let oldestTime = Infinity;

    for (const [id, resource] of this.resources) {
      // 按类型统计
      stats.byType[resource.type] = (stats.byType[resource.type] || 0) + 1;

      // 找出最老的资源
      if (resource.createdAt < oldestTime) {
        oldestTime = resource.createdAt;
        stats.oldestResource = {
          id,
          type: resource.type,
          age: Date.now() - resource.createdAt,
        };
      }

      // 估算内存使用
      stats.memoryEstimate += this.estimateResourceMemory(resource);
    }

    return stats;
  }

  // 估算资源内存使用
  estimateResourceMemory(resource) {
    // 基础对象大小
    let size = 100;

    switch (resource.type) {
      case "timeout":
      case "interval":
        size += 50;
        break;
      case "eventListener":
        size += 150;
        break;
      case "resizeObserver":
      case "intersectionObserver":
      case "mutationObserver":
        size += 500;
        break;
      case "abortController":
        size += 200;
        break;
      default:
        size += 100;
    }

    return size;
  }

  // 清理所有资源
  cleanup() {
    if (this.isDestroyed) return;

    // 按照添加的逆序清理资源
    const resourceIds = Array.from(this.resources.keys()).reverse();

    for (const id of resourceIds) {
      this.removeResource(id);
    }

    this.resources.clear();
    this.isDestroyed = true;
  }

  // 清理超时的资源（可选功能）
  cleanupOldResources(maxAge = 3600000) {
    // 默认1小时
    const now = Date.now();
    const toRemove = [];

    for (const [id, resource] of this.resources) {
      if (now - resource.createdAt > maxAge) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      console.warn(`清理超时资源 (${id}), 年龄: ${(now - this.resources.get(id).createdAt) / 1000}秒`);
      this.removeResource(id);
    }

    return toRemove.length;
  }
}

// 导出 useEffect 增强版本，自动处理清理
export function useEffectWithCleanup(effect, deps) {
  useEffect(() => {
    const manager = new CleanupManager();

    // 创建增强的上下文对象
    const context = {
      addTimeout: manager.addTimeout.bind(manager),
      addInterval: manager.addInterval.bind(manager),
      addEventListener: manager.addEventListener.bind(manager),
      addResizeObserver: manager.addResizeObserver.bind(manager),
      addIntersectionObserver: manager.addIntersectionObserver.bind(manager),
      addMutationObserver: manager.addMutationObserver.bind(manager),
      addCleanup: manager.addCleanup.bind(manager),
      createAbortController: manager.createAbortController.bind(manager),
    };

    // 执行 effect，传入增强的上下文
    const cleanup = effect(context);

    // 返回清理函数
    return () => {
      // 执行用户自定义的清理（如果有）
      if (typeof cleanup === "function") {
        cleanup();
      }
      // 自动清理所有资源
      manager.cleanup();
    };
  }, deps);
}

export default useAutoCleanup;