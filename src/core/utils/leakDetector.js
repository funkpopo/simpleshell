/**
 * 开发环境内存泄漏检测工具
 * 提供实时监控、可视化报告和自动修复建议
 */

class LeakDetector {
  constructor() {
    this.isEnabled = process.env.NODE_ENV === 'development';
    this.snapshots = [];
    this.leakReports = [];
    this.listeners = new Map(); // 跟踪所有事件监听器
    this.timers = new Set(); // 跟踪所有定时器
    this.observers = new Set(); // 跟踪所有Observer
    this.websockets = new Set(); // 跟踪所有WebSocket
    this.components = new Map(); // 跟踪React组件

    // 阈值配置
    this.thresholds = {
      memoryGrowthRate: 10, // MB/分钟
      listenerCount: 100,
      timerCount: 50,
      observerCount: 20,
      componentLifetime: 600000, // 10分钟
    };

    if (this.isEnabled) {
      this.initialize();
    }
  }

  initialize() {
    console.log('[泄漏检测器] 已启动');

    // 拦截原生API
    this.interceptAPIs();

    // 启动监控
    this.startMonitoring();

    // 添加全局访问
    if (typeof window !== 'undefined') {
      window.__leakDetector = this;
    }
  }

  /**
   * 拦截原生API以跟踪资源创建
   */
  interceptAPIs() {
    // 拦截 addEventListener
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    const self = this;

    EventTarget.prototype.addEventListener = function(type, listener, options) {
      const id = `${Date.now()}_${Math.random()}`;
      self.listeners.set(id, {
        target: this,
        type,
        listener,
        options,
        stack: self.captureStack(),
        timestamp: Date.now()
      });

      // 调用原始方法
      return originalAddEventListener.call(this, type, listener, options);
    };

    // 拦截 removeEventListener
    const originalRemoveEventListener = EventTarget.prototype.removeEventListener;

    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      // 从跟踪中移除
      for (const [id, item] of self.listeners.entries()) {
        if (item.target === this && item.type === type && item.listener === listener) {
          self.listeners.delete(id);
          break;
        }
      }

      return originalRemoveEventListener.call(this, type, listener, options);
    };

    // 拦截 setTimeout
    const originalSetTimeout = window.setTimeout;

    window.setTimeout = function(callback, delay, ...args) {
      const timerId = originalSetTimeout.call(window, function() {
        // 执行后从跟踪中移除
        self.timers.delete(timerId);
        return callback(...args);
      }, delay);

      self.timers.add({
        id: timerId,
        type: 'timeout',
        stack: self.captureStack(),
        timestamp: Date.now()
      });

      return timerId;
    };

    // 拦截 setInterval
    const originalSetInterval = window.setInterval;

    window.setInterval = function(callback, delay, ...args) {
      const timerId = originalSetInterval.call(window, callback, delay, ...args);

      self.timers.add({
        id: timerId,
        type: 'interval',
        stack: self.captureStack(),
        timestamp: Date.now()
      });

      return timerId;
    };

    // 拦截 clearTimeout/clearInterval
    const originalClearTimeout = window.clearTimeout;
    const originalClearInterval = window.clearInterval;

    window.clearTimeout = function(timerId) {
      for (const timer of self.timers) {
        if (timer.id === timerId) {
          self.timers.delete(timer);
          break;
        }
      }
      return originalClearTimeout.call(window, timerId);
    };

    window.clearInterval = function(timerId) {
      for (const timer of self.timers) {
        if (timer.id === timerId) {
          self.timers.delete(timer);
          break;
        }
      }
      return originalClearInterval.call(window, timerId);
    };

    // 拦截 Observer 构造函数
    this.interceptObserver('ResizeObserver');
    this.interceptObserver('IntersectionObserver');
    this.interceptObserver('MutationObserver');

    // 拦截 WebSocket
    const originalWebSocket = window.WebSocket;

    window.WebSocket = function(...args) {
      const ws = new originalWebSocket(...args);

      self.websockets.add({
        ws,
        url: args[0],
        stack: self.captureStack(),
        timestamp: Date.now()
      });

      // 监听关闭事件
      const originalClose = ws.close;
      ws.close = function(...closeArgs) {
        for (const item of self.websockets) {
          if (item.ws === ws) {
            self.websockets.delete(item);
            break;
          }
        }
        return originalClose.call(ws, ...closeArgs);
      };

      return ws;
    };

    console.log('[泄漏检测器] API拦截已设置');
  }

  /**
   * 拦截Observer构造函数
   */
  interceptObserver(observerName) {
    if (typeof window[observerName] === 'undefined') return;

    const OriginalObserver = window[observerName];
    const self = this;

    window[observerName] = function(...args) {
      const observer = new OriginalObserver(...args);

      self.observers.add({
        observer,
        type: observerName,
        stack: self.captureStack(),
        timestamp: Date.now()
      });

      // 拦截 disconnect
      const originalDisconnect = observer.disconnect;
      observer.disconnect = function() {
        for (const item of self.observers) {
          if (item.observer === observer) {
            self.observers.delete(item);
            break;
          }
        }
        return originalDisconnect.call(observer);
      };

      return observer;
    };

    // 保持原型链
    window[observerName].prototype = OriginalObserver.prototype;
  }

  /**
   * 启动监控
   */
  startMonitoring() {
    // 每30秒检查一次
    setInterval(() => {
      this.checkForLeaks();
    }, 30000);

    // 每5分钟生成报告
    setInterval(() => {
      this.generateDetailedReport();
    }, 300000);
  }

  /**
   * 检查泄漏
   */
  checkForLeaks() {
    const now = Date.now();
    const issues = [];

    // 检查事件监听器
    if (this.listeners.size > this.thresholds.listenerCount) {
      issues.push({
        type: 'listeners',
        count: this.listeners.size,
        threshold: this.thresholds.listenerCount,
        severity: 'high',
        message: `事件监听器数量过多: ${this.listeners.size} (阈值: ${this.thresholds.listenerCount})`
      });
    }

    // 检查定时器
    if (this.timers.size > this.thresholds.timerCount) {
      issues.push({
        type: 'timers',
        count: this.timers.size,
        threshold: this.thresholds.timerCount,
        severity: 'medium',
        message: `定时器数量过多: ${this.timers.size} (阈值: ${this.thresholds.timerCount})`
      });
    }

    // 检查Observer
    if (this.observers.size > this.thresholds.observerCount) {
      issues.push({
        type: 'observers',
        count: this.observers.size,
        threshold: this.thresholds.observerCount,
        severity: 'medium',
        message: `Observer数量过多: ${this.observers.size} (阈值: ${this.thresholds.observerCount})`
      });
    }

    // 检查长时间未清理的资源
    const oldListeners = Array.from(this.listeners.values()).filter(
      item => now - item.timestamp > 300000 // 5分钟
    );

    if (oldListeners.length > 10) {
      issues.push({
        type: 'old-listeners',
        count: oldListeners.length,
        severity: 'high',
        message: `检测到 ${oldListeners.length} 个长时间未清理的事件监听器`,
        details: oldListeners.slice(0, 5).map(l => ({
          type: l.type,
          age: Math.round((now - l.timestamp) / 1000) + 's',
          target: this.getTargetDescription(l.target)
        }))
      });
    }

    // 检查内存使用
    if (performance.memory) {
      const memoryUsage = performance.memory.usedJSHeapSize / 1048576; // MB
      const memoryLimit = performance.memory.jsHeapSizeLimit / 1048576; // MB

      if (memoryUsage > memoryLimit * 0.8) {
        issues.push({
          type: 'memory',
          severity: 'critical',
          message: `内存使用接近上限: ${memoryUsage.toFixed(2)}MB / ${memoryLimit.toFixed(2)}MB`,
          usage: memoryUsage,
          limit: memoryLimit
        });
      }
    }

    // 如果有问题，报告
    if (issues.length > 0) {
      this.reportLeaks(issues);
    }

    return issues;
  }

  /**
   * 报告泄漏
   */
  reportLeaks(issues) {
    console.group('🚨 [泄漏检测器] 检测到潜在问题');

    issues.forEach(issue => {
      const icon = issue.severity === 'critical' ? '🔴' :
                   issue.severity === 'high' ? '🟠' : '🟡';

      console.warn(`${icon} ${issue.message}`);

      if (issue.details) {
        console.table(issue.details);
      }
    });

    // 提供修复建议
    console.group('💡 修复建议:');
    issues.forEach(issue => {
      const suggestions = this.getSuggestions(issue.type);
      suggestions.forEach(s => console.log(`  • ${s}`));
    });
    console.groupEnd();

    console.groupEnd();

    // 记录到报告
    this.leakReports.push({
      timestamp: Date.now(),
      issues
    });

    // 触发自定义事件
    window.dispatchEvent(new CustomEvent('memoryLeakDetected', {
      detail: { issues }
    }));
  }

  /**
   * 获取修复建议
   */
  getSuggestions(type) {
    const suggestions = {
      listeners: [
        '使用 useResourceManager Hook 管理事件监听器',
        '确保在组件卸载时移除所有监听器',
        '考虑使用 AbortController 批量管理监听器',
        '检查是否有事件委托的机会'
      ],
      timers: [
        '使用 useResourceManager 管理定时器',
        '确保在组件卸载时清理定时器',
        '考虑合并多个定时器',
        '使用 requestAnimationFrame 代替 setInterval 进行动画'
      ],
      observers: [
        '确保在组件卸载时调用 observer.disconnect()',
        '使用 useResourceManager 自动管理Observer',
        '检查是否有重复创建的Observer'
      ],
      'old-listeners': [
        '这些监听器可能忘记清理',
        '检查对应组件的 useEffect cleanup 函数',
        '使用浏览器开发工具定位具体位置'
      ],
      memory: [
        '立即执行垃圾回收（浏览器开发工具）',
        '检查是否有大对象未释放',
        '使用 Memory Profiler 定位内存泄漏',
        '考虑使用虚拟列表减少DOM节点'
      ]
    };

    return suggestions[type] || ['检查对应资源是否正确清理'];
  }

  /**
   * 生成详细报告
   */
  generateDetailedReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        listeners: this.listeners.size,
        timers: this.timers.size,
        observers: this.observers.size,
        websockets: this.websockets.size,
        components: this.components.size
      },
      memory: performance.memory ? {
        used: (performance.memory.usedJSHeapSize / 1048576).toFixed(2) + 'MB',
        total: (performance.memory.totalJSHeapSize / 1048576).toFixed(2) + 'MB',
        limit: (performance.memory.jsHeapSizeLimit / 1048576).toFixed(2) + 'MB'
      } : null,
      topListeners: this.getTopListeners(),
      topTimers: this.getTopTimers(),
      recentLeaks: this.leakReports.slice(-5)
    };

    console.log('[泄漏检测器] 详细报告:', report);
    return report;
  }

  /**
   * 获取最多的监听器类型
   */
  getTopListeners() {
    const counts = {};

    for (const listener of this.listeners.values()) {
      const key = `${this.getTargetDescription(listener.target)}:${listener.type}`;
      counts[key] = (counts[key] || 0) + 1;
    }

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({ event: key, count }));
  }

  /**
   * 获取定时器统计
   */
  getTopTimers() {
    const timeouts = Array.from(this.timers).filter(t => t.type === 'timeout').length;
    const intervals = Array.from(this.timers).filter(t => t.type === 'interval').length;

    return { timeouts, intervals, total: this.timers.size };
  }

  /**
   * 获取目标描述
   */
  getTargetDescription(target) {
    if (target === window) return 'window';
    if (target === document) return 'document';
    if (target instanceof HTMLElement) {
      return target.tagName.toLowerCase() + (target.id ? `#${target.id}` : '');
    }
    return target.constructor.name;
  }

  /**
   * 捕获堆栈
   */
  captureStack() {
    try {
      throw new Error();
    } catch (e) {
      // 只保留前5行堆栈
      return e.stack.split('\n').slice(2, 7).join('\n');
    }
  }

  /**
   * 手动触发检查
   */
  check() {
    return this.checkForLeaks();
  }

  /**
   * 获取实时统计
   */
  getStats() {
    return {
      listeners: this.listeners.size,
      timers: this.timers.size,
      observers: this.observers.size,
      websockets: this.websockets.size,
      components: this.components.size,
      memory: performance.memory ? {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      } : null
    };
  }
}

// 创建全局实例
const leakDetector = new LeakDetector();

// 在开发环境下添加快捷命令
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  window.checkLeaks = () => leakDetector.check();
  window.leakReport = () => leakDetector.generateDetailedReport();
  window.leakStats = () => leakDetector.getStats();

  console.log('💡 开发工具提示:');
  console.log('  • 运行 checkLeaks() 检查当前泄漏');
  console.log('  • 运行 leakReport() 生成详细报告');
  console.log('  • 运行 leakStats() 查看实时统计');
}

export default leakDetector;
