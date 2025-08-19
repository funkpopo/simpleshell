/**
 * 内存泄漏检测和预防工具
 */

class MemoryLeakDetector {
  constructor() {
    this.snapshots = [];
    this.leakReports = [];
    this.monitoringInterval = null;
    this.resourceTracking = new Map();
    this.warningThresholds = {
      memoryGrowthRate: 10, // MB per minute
      resourceCount: 1000,
      eventListenerCount: 100,
      timerCount: 50,
      observerCount: 20,
    };
  }

  /**
   * 开始内存监控
   */
  startMonitoring(interval = 60000) {
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    this.takeSnapshot("initial");

    this.monitoringInterval = setInterval(() => {
      this.checkForLeaks();
    }, interval);

    console.log(`内存泄漏检测器已启动，检测间隔: ${interval}ms`);
  }

  /**
   * 停止内存监控
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log("内存泄漏检测器已停止");
    }
  }

  /**
   * 拍摄内存快照
   */
  takeSnapshot(label = "snapshot") {
    const snapshot = {
      label,
      timestamp: Date.now(),
      memory: this.getMemoryInfo(),
      resources: this.getResourceInfo(),
      domNodes: document.getElementsByTagName("*").length,
    };

    this.snapshots.push(snapshot);

    // 只保留最近10个快照
    if (this.snapshots.length > 10) {
      this.snapshots.shift();
    }

    return snapshot;
  }

  /**
   * 获取内存信息
   */
  getMemoryInfo() {
    if (performance.memory) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
      };
    }
    return null;
  }

  /**
   * 获取资源信息
   */
  getResourceInfo() {
    const info = {
      eventListeners: 0,
      timers: 0,
      observers: 0,
      promises: 0,
    };

    // 统计事件监听器（需要手动跟踪）
    if (window.__eventListenerCount) {
      info.eventListeners = window.__eventListenerCount;
    }

    // 统计活跃的资源
    this.resourceTracking.forEach((resource) => {
      switch (resource.type) {
        case "timer":
          info.timers++;
          break;
        case "observer":
          info.observers++;
          break;
        case "promise":
          info.promises++;
          break;
      }
    });

    return info;
  }

  /**
   * 检查内存泄漏
   */
  checkForLeaks() {
    const currentSnapshot = this.takeSnapshot("check");

    if (this.snapshots.length < 2) {
      return null;
    }

    const previousSnapshot = this.snapshots[this.snapshots.length - 2];
    const analysis = this.analyzeSnapshots(previousSnapshot, currentSnapshot);

    if (analysis.hasLeak) {
      this.reportLeak(analysis);
    }

    return analysis;
  }

  /**
   * 分析快照差异
   */
  analyzeSnapshots(previous, current) {
    const analysis = {
      hasLeak: false,
      issues: [],
      memoryGrowth: 0,
      resourceGrowth: {},
      domNodeGrowth: 0,
    };

    // 检查内存增长
    if (previous.memory && current.memory) {
      const memoryDiff =
        current.memory.usedJSHeapSize - previous.memory.usedJSHeapSize;
      const timeDiff = (current.timestamp - previous.timestamp) / 60000; // 分钟
      const growthRate = memoryDiff / 1048576 / timeDiff; // MB per minute

      analysis.memoryGrowth = growthRate;

      if (growthRate > this.warningThresholds.memoryGrowthRate) {
        analysis.hasLeak = true;
        analysis.issues.push({
          type: "memory",
          severity: "high",
          message: `内存增长过快: ${growthRate.toFixed(2)} MB/分钟`,
        });
      }
    }

    // 检查资源增长
    if (previous.resources && current.resources) {
      for (const key in current.resources) {
        const growth = current.resources[key] - (previous.resources[key] || 0);
        analysis.resourceGrowth[key] = growth;

        if (growth > 10) {
          analysis.hasLeak = true;
          analysis.issues.push({
            type: "resource",
            severity: "medium",
            message: `${key} 增长过快: +${growth}`,
          });
        }
      }
    }

    // 检查DOM节点增长
    analysis.domNodeGrowth = current.domNodes - previous.domNodes;
    if (analysis.domNodeGrowth > 100) {
      analysis.hasLeak = true;
      analysis.issues.push({
        type: "dom",
        severity: "medium",
        message: `DOM节点增长过多: +${analysis.domNodeGrowth}`,
      });
    }

    return analysis;
  }

  /**
   * 报告内存泄漏
   */
  reportLeak(analysis) {
    const report = {
      timestamp: Date.now(),
      analysis,
      stackTrace: this.getStackTrace(),
    };

    this.leakReports.push(report);

    console.warn("检测到潜在的内存泄漏:", analysis);

    // 触发自定义事件
    window.dispatchEvent(
      new CustomEvent("memoryLeakDetected", {
        detail: report,
      }),
    );
  }

  /**
   * 获取堆栈跟踪
   */
  getStackTrace() {
    try {
      throw new Error("Stack trace");
    } catch (e) {
      return e.stack;
    }
  }

  /**
   * 跟踪资源
   */
  trackResource(id, type, metadata = {}) {
    this.resourceTracking.set(id, {
      type,
      createdAt: Date.now(),
      metadata,
    });
  }

  /**
   * 取消跟踪资源
   */
  untrackResource(id) {
    this.resourceTracking.delete(id);
  }

  /**
   * 获取泄漏报告
   */
  getLeakReports() {
    return this.leakReports;
  }

  /**
   * 清理旧报告
   */
  clearReports() {
    this.leakReports = [];
  }

  /**
   * 获取当前状态摘要
   */
  getSummary() {
    const latest = this.snapshots[this.snapshots.length - 1];
    return {
      monitoring: !!this.monitoringInterval,
      snapshotCount: this.snapshots.length,
      leakReportCount: this.leakReports.length,
      currentMemory: latest?.memory,
      currentResources: latest?.resources,
      currentDomNodes: latest?.domNodes,
      trackedResources: this.resourceTracking.size,
    };
  }

  /**
   * 自动修复常见内存泄漏
   */
  autoFix() {
    const fixes = [];

    // 清理未使用的事件监听器
    if (window.__unusedEventListeners) {
      window.__unusedEventListeners.forEach((listener) => {
        listener.target.removeEventListener(
          listener.event,
          listener.handler,
          listener.options,
        );
      });
      fixes.push(
        `清理了 ${window.__unusedEventListeners.size} 个未使用的事件监听器`,
      );
    }

    // 清理孤立的定时器
    if (window.__orphanedTimers) {
      window.__orphanedTimers.forEach((timerId) => {
        clearInterval(timerId);
        clearTimeout(timerId);
      });
      fixes.push(`清理了 ${window.__orphanedTimers.size} 个孤立的定时器`);
    }

    // 清理断开连接的观察器
    if (window.__disconnectedObservers) {
      window.__disconnectedObservers.forEach((observer) => {
        observer.disconnect();
      });
      fixes.push(
        `清理了 ${window.__disconnectedObservers.size} 个断开连接的观察器`,
      );
    }

    console.log("自动修复完成:", fixes);
    return fixes;
  }

  /**
   * 生成详细报告
   */
  generateDetailedReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: this.getSummary(),
      snapshots: this.snapshots,
      leaks: this.leakReports,
      recommendations: this.getRecommendations(),
    };

    return report;
  }

  /**
   * 获取优化建议
   */
  getRecommendations() {
    const recommendations = [];
    const latest = this.snapshots[this.snapshots.length - 1];

    if (!latest) {
      return recommendations;
    }

    // 基于当前状态提供建议
    if (
      latest.resources?.eventListeners >
      this.warningThresholds.eventListenerCount
    ) {
      recommendations.push({
        type: "eventListeners",
        priority: "high",
        message: "事件监听器过多，建议使用事件委托或清理未使用的监听器",
      });
    }

    if (latest.resources?.timers > this.warningThresholds.timerCount) {
      recommendations.push({
        type: "timers",
        priority: "medium",
        message: "定时器过多，建议合并定时器或使用 requestAnimationFrame",
      });
    }

    if (latest.domNodes > 5000) {
      recommendations.push({
        type: "dom",
        priority: "high",
        message: "DOM节点过多，建议使用虚拟列表或分页加载",
      });
    }

    if (latest.memory?.usedJSHeapSize > latest.memory?.jsHeapSizeLimit * 0.8) {
      recommendations.push({
        type: "memory",
        priority: "critical",
        message: "内存使用接近上限，建议立即进行内存优化",
      });
    }

    return recommendations;
  }
}

// 创建全局实例
const memoryLeakDetector = new MemoryLeakDetector();

// 开发环境自动启动
if (process.env.NODE_ENV === "development") {
  // 延迟启动，等待应用初始化
  setTimeout(() => {
    memoryLeakDetector.startMonitoring(30000); // 30秒检查一次
  }, 5000);

  // 添加到全局对象方便调试
  window.memoryLeakDetector = memoryLeakDetector;
}

export default memoryLeakDetector;

/**
 * React Hook: 使用内存泄漏检测器
 */
export function useMemoryLeakDetector(options = {}) {
  const {
    enabled = process.env.NODE_ENV === "development",
    interval = 60000,
    onLeakDetected = null,
  } = options;

  React.useEffect(() => {
    if (!enabled) return;

    // 监听内存泄漏事件
    const handleLeakDetected = (event) => {
      console.warn("内存泄漏检测:", event.detail);
      if (onLeakDetected) {
        onLeakDetected(event.detail);
      }
    };

    window.addEventListener("memoryLeakDetected", handleLeakDetected);

    // 组件级别的资源跟踪
    const componentId = `component_${Date.now()}`;
    memoryLeakDetector.trackResource(componentId, "component", {
      name: options.componentName || "Unknown",
    });

    return () => {
      window.removeEventListener("memoryLeakDetected", handleLeakDetected);
      memoryLeakDetector.untrackResource(componentId);
    };
  }, [enabled, onLeakDetected]);

  return {
    takeSnapshot: () => memoryLeakDetector.takeSnapshot(),
    getSummary: () => memoryLeakDetector.getSummary(),
    getReports: () => memoryLeakDetector.getLeakReports(),
    autoFix: () => memoryLeakDetector.autoFix(),
  };
}
