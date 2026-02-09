class EventManager {
  constructor() {
    this.listeners = new Map(); // 存储所有事件监听器
    this.timers = new Set(); // 存储所有定时器
    this.observers = new Set(); // 存储所有观察者
    this.cleanupFunctions = new Set(); // 存储自定义清理函数
    this.isDestroyed = false;
  }

  addEventListener(target, event, handler, options = {}) {
    if (this.isDestroyed) {
      // EventManager已销毁，无法添加新的事件监听器
      return () => {};
    }

    // 生成唯一标识
    const id = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 包装处理函数以便调试
    const wrappedHandler = (...args) => {
      try {
        return handler(...args);
      } catch {
        // 事件处理器执行失败，可以考虑使用项目的日志系统
      }
    };

    // 添加事件监听器
    target.addEventListener(event, wrappedHandler, options);

    // 存储监听器信息
    this.listeners.set(id, {
      target,
      event,
      handler: wrappedHandler,
      options,
      originalHandler: handler,
    });

    // 返回移除函数
    return () => this.removeEventListener(id);
  }

  removeEventListener(id) {
    const listener = this.listeners.get(id);
    if (listener) {
      const { target, event, handler, options } = listener;
      target.removeEventListener(event, handler, options);
      this.listeners.delete(id);
    }
  }

  addTimer(callback, delay, isInterval = false) {
    if (this.isDestroyed) {
      // EventManager已销毁，无法添加新的定时器
      return () => {};
    }

    const wrappedCallback = () => {
      try {
        callback();
      } catch {
        // 定时器回调执行失败，可以考虑使用项目的日志系统
      }
    };

    const timerId = isInterval
      ? setInterval(wrappedCallback, delay)
      : setTimeout(wrappedCallback, delay);

    this.timers.add({ id: timerId, isInterval });

    // 返回清除函数
    return () => this.clearTimer(timerId, isInterval);
  }

  setTimeout(callback, delay) {
    return this.addTimer(callback, delay, false);
  }

  setInterval(callback, interval) {
    return this.addTimer(callback, interval, true);
  }

  clearTimer(timerId, isInterval) {
    if (isInterval) {
      clearInterval(timerId);
    } else {
      clearTimeout(timerId);
    }

    // 从集合中移除
    for (const timer of this.timers) {
      if (timer.id === timerId) {
        this.timers.delete(timer);
        break;
      }
    }
  }

  addObserver(observer) {
    if (this.isDestroyed) {
      // EventManager已销毁，无法添加新的观察者
      return () => {};
    }

    this.observers.add(observer);

    // 返回断开函数
    return () => this.removeObserver(observer);
  }

  removeObserver(observer) {
    if (observer && typeof observer.disconnect === "function") {
      observer.disconnect();
    }
    this.observers.delete(observer);
  }

  addCleanup(cleanupFn) {
    if (this.isDestroyed) {
      // EventManager已销毁，无法添加新的清理函数
      return () => {};
    }

    this.cleanupFunctions.add(cleanupFn);

    // 返回移除函数
    return () => this.cleanupFunctions.delete(cleanupFn);
  }

  getStats() {
    return {
      listeners: this.listeners.size,
      timers: this.timers.size,
      observers: this.observers.size,
      cleanupFunctions: this.cleanupFunctions.size,
      isDestroyed: this.isDestroyed,
    };
  }

  destroy() {
    if (this.isDestroyed) {
      return;
    }

    // 清理所有事件监听器
    for (const [, listener] of this.listeners) {
      const { target, event, handler, options } = listener;
      try {
        target.removeEventListener(event, handler, options);
      } catch {
        // 移除事件监听器失败，可以考虑使用项目的日志系统
      }
    }
    this.listeners.clear();

    // 清理所有定时器
    for (const timer of this.timers) {
      try {
        if (timer.isInterval) {
          clearInterval(timer.id);
        } else {
          clearTimeout(timer.id);
        }
      } catch {
        // 清除定时器失败，可以考虑使用项目的日志系统
      }
    }
    this.timers.clear();

    // 清理所有观察者
    for (const observer of this.observers) {
      try {
        if (observer && typeof observer.disconnect === "function") {
          observer.disconnect();
        }
      } catch {
        // 断开观察者失败，可以考虑使用项目的日志系统
      }
    }
    this.observers.clear();

    // 执行所有自定义清理函数
    for (const cleanupFn of this.cleanupFunctions) {
      try {
        cleanupFn();
      } catch {
        // 执行清理函数失败，可以考虑使用项目的日志系统
      }
    }
    this.cleanupFunctions.clear();

    this.isDestroyed = true;
  }
}

export function useEventManager() {
  const { useRef, useEffect } = require("react");
  const managerRef = useRef(null);

  if (!managerRef.current) {
    managerRef.current = new EventManager();
  }

  useEffect(() => {
    const manager = managerRef.current;

    return () => {
      if (manager && !manager.isDestroyed) {
        manager.destroy();
      }
    };
  }, []);

  return managerRef.current;
}

export default EventManager;
