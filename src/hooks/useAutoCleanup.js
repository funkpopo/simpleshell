import { useEffect, useRef, useCallback } from "react";

/**
 * 自动清理资源的 Hook。
 *
 * 在组件卸载时统一清理定时器、事件监听、各种 Observer 等资源，
 * 避免内存泄漏，同时提供少量统计信息方便调试。
 */
export function useAutoCleanup() {
  const cleanupManagerRef = useRef(null);

  // 初始化清理管理器（单例）
  if (!cleanupManagerRef.current) {
    cleanupManagerRef.current = new CleanupManager();
  }

  // 组件卸载时自动执行一次全量清理
  useEffect(() => {
    return () => {
      if (cleanupManagerRef.current) {
        cleanupManagerRef.current.cleanup();
        cleanupManagerRef.current = null;
      }
    };
  }, []);

  // 注册一次性定时器（setTimeout），并在清理时自动取消
  const addTimeout = useCallback((callback, delay) => {
    return cleanupManagerRef.current?.addTimeout(callback, delay);
  }, []);

  // 注册轮询定时器（setInterval），并在清理时自动取消
  const addInterval = useCallback((callback, interval) => {
    return cleanupManagerRef.current?.addInterval(callback, interval);
  }, []);

  // 注册事件监听器，并在清理时自动移除
  const addEventListener = useCallback((target, event, handler, options) => {
    return cleanupManagerRef.current?.addEventListener(
      target,
      event,
      handler,
      options,
    );
  }, []);

  // 注册 ResizeObserver，并在清理时断开观察
  const addResizeObserver = useCallback((callback, element, options) => {
    return cleanupManagerRef.current?.addResizeObserver(
      callback,
      element,
      options,
    );
  }, []);

  // 注册 IntersectionObserver，并在清理时断开观察
  const addIntersectionObserver = useCallback(
    (callback, element, options) => {
      return cleanupManagerRef.current?.addIntersectionObserver(
        callback,
        element,
        options,
      );
    },
    [],
  );

  // 注册 MutationObserver，并在清理时断开观察
  const addMutationObserver = useCallback((callback, element, options) => {
    return cleanupManagerRef.current?.addMutationObserver(
      callback,
      element,
      options,
    );
  }, []);

  // 注册自定义清理函数
  const addCleanup = useCallback((cleanupFn) => {
    return cleanupManagerRef.current?.addCleanup(cleanupFn);
  }, []);

  // 创建 AbortController，并在全局清理时自动 abort
  const createAbortController = useCallback(() => {
    return cleanupManagerRef.current?.createAbortController();
  }, []);

  // 获取当前资源统计信息（调试用）
  const getStats = useCallback(() => {
    return cleanupManagerRef.current?.getStats() || {};
  }, []);

  // 手动移除指定资源
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
 * 负责管理和清理各种异步资源的管理器。
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
    return id;
  }

  removeResource(id) {
    const entry = this.resources.get(id);
    if (!entry) return;

    try {
      if (typeof entry.cleanupFn === "function") {
        entry.cleanupFn();
      }
    } catch (error) {
      console.error(`清理资源失败 (${id}):`, error);
    }

    this.resources.delete(id);
  }

  // 注册一次性定时器
  addTimeout(callback, delay) {
    if (this.isDestroyed) return () => {};

    let id = null;
    const timerId = setTimeout(() => {
      try {
        callback();
      } catch (error) {
        console.error("定时器回调执行失败:", error);
      } finally {
        if (id) {
          this.removeResource(id);
        }
      }
    }, delay);

    id = this.addResource("timeout", timerId, () => clearTimeout(timerId));
    return id;
  }

  // 注册轮询定时器
  addInterval(callback, interval) {
    if (this.isDestroyed) return () => {};

    const wrapped = () => {
      try {
        callback();
      } catch (error) {
        console.error("定时器回调执行失败:", error);
      }
    };

    const timerId = setInterval(wrapped, interval);
    return this.addResource("interval", timerId, () =>
      clearInterval(timerId),
    );
  }

  // 事件监听封装，自动捕获错误并在清理时移除监听
  addEventListener(target, event, handler, options = {}) {
    if (this.isDestroyed || !target || !event || !handler) return () => {};

    const wrappedHandler = (...args) => {
      try {
        return handler(...args);
      } catch (error) {
        console.error("事件监听回调执行失败:", error);
      }
    };

    target.addEventListener(event, wrappedHandler, options);

    return this.addResource(
      "eventListener",
      { target, event, handler: wrappedHandler, options },
      () => target.removeEventListener(event, wrappedHandler, options),
    );
  }

  // ResizeObserver 封装
  addResizeObserver(callback, element, options = {}) {
    if (this.isDestroyed || !element || typeof ResizeObserver === "undefined") {
      return () => {};
    }

    const observer = new ResizeObserver((entries) => {
      try {
        callback(entries);
      } catch (error) {
        console.error("ResizeObserver 回调执行失败:", error);
      }
    });

    observer.observe(element, options);

    return this.addResource("resizeObserver", observer, () =>
      observer.disconnect(),
    );
  }

  // IntersectionObserver 封装
  addIntersectionObserver(callback, element, options = {}) {
    if (
      this.isDestroyed ||
      !element ||
      typeof IntersectionObserver === "undefined"
    ) {
      return () => {};
    }

    const observer = new IntersectionObserver((entries) => {
      try {
        callback(entries);
      } catch (error) {
        console.error("IntersectionObserver 回调执行失败:", error);
      }
    }, options);

    observer.observe(element);

    return this.addResource("intersectionObserver", observer, () =>
      observer.disconnect(),
    );
  }

  // MutationObserver 封装
  addMutationObserver(callback, element, options = {}) {
    if (
      this.isDestroyed ||
      !element ||
      typeof MutationObserver === "undefined"
    ) {
      return () => {};
    }

    const observer = new MutationObserver((mutations) => {
      try {
        callback(mutations);
      } catch (error) {
        console.error("MutationObserver 回调执行失败:", error);
      }
    });

    observer.observe(element, options);

    return this.addResource("mutationObserver", observer, () =>
      observer.disconnect(),
    );
  }

  // AbortController 封装
  createAbortController() {
    if (this.isDestroyed || typeof AbortController === "undefined") {
      return null;
    }

    const controller = new AbortController();

    this.addResource("abortController", controller, () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    });

    return controller;
  }

  // 注册自定义清理函数
  addCleanup(cleanupFn) {
    if (this.isDestroyed || typeof cleanupFn !== "function") return () => {};
    return this.addResource("custom", cleanupFn, cleanupFn);
  }

  // 获取资源统计信息（数量 / 类型分布 / 最老资源等）
  getStats() {
    const stats = {
      total: this.resources.size,
      byType: {},
      oldestResource: null,
      memoryEstimate: 0,
    };

    let oldestTime = Infinity;

    for (const [id, resource] of this.resources) {
      stats.byType[resource.type] = (stats.byType[resource.type] || 0) + 1;

      if (resource.createdAt < oldestTime) {
        oldestTime = resource.createdAt;
        stats.oldestResource = {
          id,
          type: resource.type,
          age: Date.now() - resource.createdAt,
        };
      }

      stats.memoryEstimate += this.estimateResourceMemory(resource);
    }

    return stats;
  }

  // 粗略估算资源占用的内存大小（仅用于调试）
  estimateResourceMemory(resource) {
    // 基础大小
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

  // 释放当前管理器中的所有资源
  cleanup() {
    if (this.isDestroyed) return;

    // 逆序清理，尽量先清理后创建的资源
    const ids = Array.from(this.resources.keys()).reverse();
    for (const id of ids) {
      this.removeResource(id);
    }

    this.resources.clear();
    this.isDestroyed = true;
  }

  // 清理已存在太久的资源（可选，用于长时间运行场景）
  cleanupOldResources(maxAge = 3600000) {
    // 默认 1 小时
    const now = Date.now();
    const toRemove = [];

    for (const [id, resource] of this.resources) {
      if (now - resource.createdAt > maxAge) {
        toRemove.push(id);
      }
    }

    for (const id of toRemove) {
      console.warn(
        `自动清理过期资源 (${id}), 存活时间: ${(now - this.resources.get(id).createdAt) / 1000} 秒`,
      );
      this.removeResource(id);
    }

    return toRemove.length;
  }
}

/**
 * 带自动清理能力的 useEffect 封装版。
 * 在 effect 中可以直接通过 context 注册需要托管的资源。
 */
export function useEffectWithCleanup(effect, deps) {
  useEffect(() => {
    const manager = new CleanupManager();

    // 提供增强版上下文，方便在 effect 中注册资源
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

    // 执行 effect，并传入增强上下文
    const cleanup = effect(context);

    // 清理阶段：先执行用户自定义清理，再释放所有托管资源
    return () => {
      if (typeof cleanup === "function") {
        cleanup();
      }
      manager.cleanup();
    };
  }, deps);
}

export default useAutoCleanup;

