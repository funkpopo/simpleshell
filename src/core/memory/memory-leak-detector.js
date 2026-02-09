const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");

/**
 * 内存泄漏检测器配置
 */
const LEAK_DETECTOR_CONFIG = {
  // 检测间隔
  checkInterval: 30 * 1000, // 30秒

  // 内存增长阈值
  thresholds: {
    // 连续增长检查次数
    consecutiveGrowthLimit: 5,

    // 内存增长率阈值 (每次检查的增长百分比)
    memoryGrowthRateThreshold: 10, // 10%

    // 绝对内存增长阈值 (MB)
    absoluteGrowthThreshold: 100, // 100MB

    // 内存使用率阈值
    memoryUsageThreshold: 85, // 85%

    // 长期存活对象阈值 (毫秒)
    longLivedObjectThreshold: 10 * 60 * 1000, // 10分钟

    // 异常分配大小阈值 (MB)
    abnormalAllocationThreshold: 50, // 50MB
  },

  // 历史数据保留
  historyRetention: {
    maxSamples: 200, // 最多保留200个样本
    maxAge: 60 * 60 * 1000, // 最多保留1小时的数据
  },

  // 告警配置
  alerting: {
    enabled: true,
    cooldownPeriod: 5 * 60 * 1000, // 告警冷却期5分钟
    maxAlertsPerHour: 10, // 每小时最多10次告警
  },
};

/**
 * 内存泄漏检测器
 */
class MemoryLeakDetector extends EventEmitter {
  constructor(memoryPool, config = {}) {
    super();

    this.memoryPool = memoryPool;
    this.config = { ...LEAK_DETECTOR_CONFIG, ...config };

    // 检测状态
    this.isRunning = false;
    this.checkTimer = null;

    // 内存使用历史
    this.memoryHistory = [];
    this.allocationHistory = [];
    this.longLivedAllocations = new Map();

    // 告警状态
    this.lastAlertTime = 0;
    this.alertCount = 0;
    this.alertHistory = [];

    // 检测统计
    this.stats = {
      totalChecks: 0,
      leakDetections: 0,
      falsePositives: 0,
      averageMemoryGrowth: 0,
      maxMemoryUsage: 0,
      lastCheckTime: 0,
    };

    // 绑定内存池事件
    this.bindMemoryPoolEvents();
  }

  /**
   * 绑定内存池事件监听
   */
  bindMemoryPoolEvents() {
    if (!this.memoryPool) return;

    // 监听内存分配事件
    this.memoryPool.on("allocated", (data) => {
      this.trackAllocation(data);
    });

    // 监听内存释放事件
    this.memoryPool.on("freed", (data) => {
      this.trackDeallocation(data);
    });

    // 监听内存告警
    this.memoryPool.on("memoryAlert", (alert) => {
      this.handleMemoryAlert(alert);
    });
  }

  /**
   * 启动泄漏检测
   */
  start() {
    if (this.isRunning) {
      logToFile("内存泄漏检测器已在运行", "WARN");
      return;
    }

    this.isRunning = true;

    // 立即执行一次检查
    this.performLeakCheck();

    // 启动定期检查
    this.checkTimer = setInterval(() => {
      this.performLeakCheck();
    }, this.config.checkInterval);

    logToFile("内存泄漏检测器已启动", "INFO");
    this.emit("started");
  }

  /**
   * 停止泄漏检测
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }

    logToFile("内存泄漏检测器已停止", "INFO");
    this.emit("stopped");
  }

  /**
   * 执行内存泄漏检查
   */
  performLeakCheck() {
    try {
      const timestamp = Date.now();

      // 收集内存使用情况
      const memoryInfo = this.collectMemoryInfo();

      // 添加到历史记录
      this.addToHistory(memoryInfo);

      // 执行各种泄漏检测
      const leakResults = {
        consecutiveGrowth: this.detectConsecutiveGrowth(),
        rapidGrowth: this.detectRapidGrowth(),
        longLivedObjects: this.detectLongLivedObjects(),
        abnormalAllocations: this.detectAbnormalAllocations(),
        memoryFragmentation: this.detectMemoryFragmentation(),
      };

      // 分析检测结果
      const leakDetected = Object.values(leakResults).some(
        (result) => result.detected,
      );

      if (leakDetected) {
        this.handleLeakDetection(leakResults, memoryInfo);
      }

      // 更新统计信息
      this.updateStats(memoryInfo, leakDetected);

      // 清理过期数据
      this.cleanupHistoryData();

      this.emit("checkCompleted", {
        timestamp,
        memoryInfo,
        leakResults,
        leakDetected,
      });
    } catch (error) {
      logToFile(`内存泄漏检查失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 收集内存信息
   */
  collectMemoryInfo() {
    const processMemory = process.memoryUsage();
    const poolStats = this.memoryPool ? this.memoryPool.getStats() : {};

    return {
      timestamp: Date.now(),
      process: {
        rss: processMemory.rss,
        heapUsed: processMemory.heapUsed,
        heapTotal: processMemory.heapTotal,
        external: processMemory.external,
      },
      pool: {
        currentUsage: poolStats.currentUsage || 0,
        peakUsage: poolStats.peakUsage || 0,
        totalAllocated: poolStats.totalAllocated || 0,
        totalFreed: poolStats.totalFreed || 0,
        usagePercent: poolStats.usagePercent || 0,
        fragmentation: poolStats.fragmentation || 0,
      },
      gc: {
        // 如果可能的话，收集垃圾回收信息
        forced: false,
      },
    };
  }

  /**
   * 添加到历史记录
   */
  addToHistory(memoryInfo) {
    this.memoryHistory.push(memoryInfo);

    // 限制历史记录大小
    const maxSamples = this.config.historyRetention.maxSamples;
    if (this.memoryHistory.length > maxSamples) {
      this.memoryHistory = this.memoryHistory.slice(-maxSamples);
    }
  }

  /**
   * 检测连续内存增长
   */
  detectConsecutiveGrowth() {
    const minSamples = this.config.thresholds.consecutiveGrowthLimit;
    if (this.memoryHistory.length < minSamples) {
      return { detected: false, reason: "样本数量不足" };
    }

    const recentSamples = this.memoryHistory.slice(-minSamples);
    let consecutiveGrowth = 0;

    for (let i = 1; i < recentSamples.length; i++) {
      const prev = recentSamples[i - 1];
      const curr = recentSamples[i];

      if (curr.process.heapUsed > prev.process.heapUsed) {
        consecutiveGrowth++;
      } else {
        consecutiveGrowth = 0;
        break;
      }
    }

    const detected = consecutiveGrowth >= minSamples - 1;

    return {
      detected,
      consecutiveGrowth,
      threshold: minSamples - 1,
      reason: detected
        ? `连续${consecutiveGrowth}次内存增长`
        : "未检测到连续增长",
    };
  }

  /**
   * 检测快速内存增长
   */
  detectRapidGrowth() {
    if (this.memoryHistory.length < 2) {
      return { detected: false, reason: "样本数量不足" };
    }

    const current = this.memoryHistory[this.memoryHistory.length - 1];
    const previous = this.memoryHistory[this.memoryHistory.length - 2];

    const growthRate =
      ((current.process.heapUsed - previous.process.heapUsed) /
        previous.process.heapUsed) *
      100;
    const absoluteGrowth =
      (current.process.heapUsed - previous.process.heapUsed) / (1024 * 1024); // MB

    const rateExceeded =
      growthRate > this.config.thresholds.memoryGrowthRateThreshold;
    const absoluteExceeded =
      absoluteGrowth > this.config.thresholds.absoluteGrowthThreshold;

    const detected = rateExceeded || absoluteExceeded;

    return {
      detected,
      growthRate: growthRate.toFixed(2),
      absoluteGrowth: absoluteGrowth.toFixed(2),
      rateThreshold: this.config.thresholds.memoryGrowthRateThreshold,
      absoluteThreshold: this.config.thresholds.absoluteGrowthThreshold,
      reason: detected
        ? `内存快速增长: ${growthRate.toFixed(2)}% (${absoluteGrowth.toFixed(2)}MB)`
        : "未检测到快速增长",
    };
  }

  /**
   * 检测长期存活对象
   */
  detectLongLivedObjects() {
    const now = Date.now();
    const threshold = this.config.thresholds.longLivedObjectThreshold;

    let longLivedCount = 0;
    let totalSize = 0;

    for (const allocation of this.longLivedAllocations.values()) {
      const age = now - allocation.allocatedAt;
      if (age > threshold) {
        longLivedCount++;
        totalSize += allocation.size;
      }
    }

    const detected = longLivedCount > 0 && totalSize > 50 * 1024 * 1024; // 50MB

    return {
      detected,
      longLivedCount,
      totalSize: (totalSize / (1024 * 1024)).toFixed(2), // MB
      threshold: threshold / (60 * 1000), // 分钟
      reason: detected
        ? `检测到${longLivedCount}个长期存活对象，总大小${(totalSize / (1024 * 1024)).toFixed(2)}MB`
        : "未检测到异常长期存活对象",
    };
  }

  /**
   * 检测异常分配
   */
  detectAbnormalAllocations() {
    const recentAllocations = this.allocationHistory.filter(
      (alloc) => Date.now() - alloc.timestamp < 60 * 1000, // 最近1分钟
    );

    const largeAllocations = recentAllocations.filter(
      (alloc) =>
        alloc.size >
        this.config.thresholds.abnormalAllocationThreshold * 1024 * 1024,
    );

    const detected = largeAllocations.length > 0;

    return {
      detected,
      largeAllocationCount: largeAllocations.length,
      totalSize:
        largeAllocations.reduce((sum, alloc) => sum + alloc.size, 0) /
        (1024 * 1024),
      threshold: this.config.thresholds.abnormalAllocationThreshold,
      reason: detected
        ? `检测到${largeAllocations.length}个异常大小的分配`
        : "未检测到异常分配",
    };
  }

  /**
   * 检测内存碎片化
   */
  detectMemoryFragmentation() {
    if (!this.memoryPool) {
      return { detected: false, reason: "内存池不可用" };
    }

    const stats = this.memoryPool.getStats();
    const fragmentation = stats.fragmentation || 0;

    const detected = fragmentation > 0.8; // 80%碎片化阈值

    return {
      detected,
      fragmentation: (fragmentation * 100).toFixed(2),
      threshold: 80,
      reason: detected
        ? `内存碎片化严重: ${(fragmentation * 100).toFixed(2)}%`
        : "内存碎片化正常",
    };
  }

  /**
   * 处理泄漏检测结果
   */
  handleLeakDetection(leakResults, memoryInfo) {
    const now = Date.now();

    // 检查告警冷却期
    if (
      this.config.alerting.enabled &&
      now - this.lastAlertTime < this.config.alerting.cooldownPeriod
    ) {
      return;
    }

    // 检查每小时告警次数限制
    const oneHourAgo = now - 60 * 60 * 1000;
    const recentAlerts = this.alertHistory.filter(
      (alert) => alert.timestamp > oneHourAgo,
    );
    if (recentAlerts.length >= this.config.alerting.maxAlertsPerHour) {
      return;
    }

    const leakAlert = {
      timestamp: now,
      level: this.determineSeverityLevel(leakResults),
      memoryInfo,
      leakResults,
      recommendations: this.generateRecommendations(leakResults),
    };

    // 记录告警
    this.alertHistory.push(leakAlert);
    this.lastAlertTime = now;
    this.alertCount++;

    // 发出告警事件
    this.emit("memoryLeakDetected", leakAlert);

    // 记录日志
    const severity = leakAlert.level.toUpperCase();
    const message = `内存泄漏告警 [${severity}]: ${this.formatLeakSummary(leakResults)}`;
    logToFile(message, severity === "CRITICAL" ? "ERROR" : "WARN");
  }

  /**
   * 确定严重性级别
   */
  determineSeverityLevel(leakResults) {
    const criticalConditions = [
      leakResults.rapidGrowth?.detected &&
        parseFloat(leakResults.rapidGrowth.growthRate) > 50,
      leakResults.longLivedObjects?.detected &&
        parseFloat(leakResults.longLivedObjects.totalSize) > 200,
      leakResults.memoryFragmentation?.detected &&
        parseFloat(leakResults.memoryFragmentation.fragmentation) > 90,
    ];

    if (criticalConditions.some((condition) => condition)) {
      return "critical";
    }

    const warningConditions = [
      leakResults.consecutiveGrowth?.detected,
      leakResults.rapidGrowth?.detected,
      leakResults.abnormalAllocations?.detected,
    ];

    if (warningConditions.some((condition) => condition)) {
      return "warning";
    }

    return "info";
  }

  /**
   * 生成修复建议
   */
  generateRecommendations(leakResults) {
    const recommendations = [];

    if (leakResults.consecutiveGrowth?.detected) {
      recommendations.push("检查是否存在无限循环或递归调用");
      recommendations.push("验证事件监听器是否正确移除");
    }

    if (leakResults.rapidGrowth?.detected) {
      recommendations.push("检查大对象分配逻辑");
      recommendations.push("考虑实施内存使用限制");
    }

    if (leakResults.longLivedObjects?.detected) {
      recommendations.push("检查缓存清理策略");
      recommendations.push("验证对象生命周期管理");
    }

    if (leakResults.abnormalAllocations?.detected) {
      recommendations.push("审查大内存分配的合理性");
      recommendations.push("考虑分批处理大数据");
    }

    if (leakResults.memoryFragmentation?.detected) {
      recommendations.push("执行内存池碎片整理");
      recommendations.push("考虑重启应用程序");
    }

    return recommendations;
  }

  /**
   * 格式化泄漏摘要
   */
  formatLeakSummary(leakResults) {
    const detected = [];

    Object.entries(leakResults).forEach(([type, result]) => {
      if (result.detected) {
        detected.push(`${type}: ${result.reason}`);
      }
    });

    return detected.join("; ");
  }

  /**
   * 跟踪内存分配
   */
  trackAllocation(data) {
    const allocation = {
      id: data.id,
      size: data.size,
      pool: data.pool,
      timestamp: Date.now(),
      allocatedAt: Date.now(),
    };

    this.allocationHistory.push(allocation);
    this.longLivedAllocations.set(data.id, allocation);

    // 限制历史记录大小
    if (this.allocationHistory.length > 1000) {
      this.allocationHistory = this.allocationHistory.slice(-500);
    }
  }

  /**
   * 跟踪内存释放
   */
  trackDeallocation(data) {
    this.longLivedAllocations.delete(data.id);
  }

  /**
   * 处理内存告警
   */
  handleMemoryAlert(alert) {
    // 将内存池的告警也纳入泄漏检测考虑
    if (alert.level === "critical") {
      this.performLeakCheck();
    }
  }

  /**
   * 更新统计信息
   */
  updateStats(memoryInfo, leakDetected) {
    this.stats.totalChecks++;
    this.stats.lastCheckTime = Date.now();

    if (leakDetected) {
      this.stats.leakDetections++;
    }

    this.stats.maxMemoryUsage = Math.max(
      this.stats.maxMemoryUsage,
      memoryInfo.process.heapUsed,
    );

    // 计算平均内存增长率
    if (this.memoryHistory.length >= 2) {
      const recent = this.memoryHistory.slice(-10); // 最近10次
      let totalGrowth = 0;
      let validSamples = 0;

      for (let i = 1; i < recent.length; i++) {
        const growth =
          recent[i].process.heapUsed - recent[i - 1].process.heapUsed;
        if (growth > 0) {
          totalGrowth += (growth / recent[i - 1].process.heapUsed) * 100;
          validSamples++;
        }
      }

      if (validSamples > 0) {
        this.stats.averageMemoryGrowth = totalGrowth / validSamples;
      }
    }
  }

  /**
   * 清理历史数据
   */
  cleanupHistoryData() {
    const now = Date.now();
    const maxAge = this.config.historyRetention.maxAge;

    // 清理过期的内存历史
    this.memoryHistory = this.memoryHistory.filter(
      (item) => now - item.timestamp < maxAge,
    );

    // 清理过期的分配历史
    this.allocationHistory = this.allocationHistory.filter(
      (item) => now - item.timestamp < maxAge,
    );

    // 清理过期的告警历史
    this.alertHistory = this.alertHistory.filter(
      (alert) => now - alert.timestamp < maxAge,
    );
  }

  /**
   * 获取检测器状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      stats: this.stats,
      memoryHistorySize: this.memoryHistory.length,
      longLivedAllocationsCount: this.longLivedAllocations.size,
      recentAlerts: this.alertHistory.slice(-10), // 最近10次告警
      lastCheck: this.stats.lastCheckTime,
    };
  }

  /**
   * 强制执行内存泄漏检查
   */
  forceCheck() {
    if (!this.isRunning) {
      throw new Error("检测器未运行");
    }

    this.performLeakCheck();
  }

  /**
   * 重置检测器状态
   */
  reset() {
    this.memoryHistory = [];
    this.allocationHistory = [];
    this.longLivedAllocations.clear();
    this.alertHistory = [];

    this.stats = {
      totalChecks: 0,
      leakDetections: 0,
      falsePositives: 0,
      averageMemoryGrowth: 0,
      maxMemoryUsage: 0,
      lastCheckTime: 0,
    };

    this.lastAlertTime = 0;
    this.alertCount = 0;

    logToFile("内存泄漏检测器状态已重置", "INFO");
    this.emit("reset");
  }
}

module.exports = MemoryLeakDetector;
