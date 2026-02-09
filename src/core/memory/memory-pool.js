const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");
const MemoryLeakDetector = require("./memory-leak-detector");

// 内存池配置 - 简化为4级分级，减少管理开销
const MEMORY_POOL_CONFIG = {
  pools: {
    small: { size: 4 * 1024, count: 150 }, // 4KB 小块 (合并tiny)
    medium: { size: 128 * 1024, count: 100 }, // 128KB 中块 (优化medium)
    large: { size: 2 * 1024 * 1024, count: 50 }, // 2MB 大块 (合并huge)
    xlarge: { size: 16 * 1024 * 1024, count: 20 }, // 16MB 超大块 (合并massive)
  },

  management: {
    maxPoolMemory: 1024 * 1024 * 1024, // 最大池内存（1GB）
    gcThreshold: 0.85, // 垃圾回收阈值（85%）
    defragmentThreshold: 0.75, // 碎片整理阈值（75%）
    cleanupInterval: 30 * 1000, // 清理间隔（30秒）
    metricsInterval: 10 * 1000, // 指标收集间隔（10秒）
    adaptiveResize: true, // 自适应池大小调整
    smartPreallocation: true, // 智能预分配
  },

  optimization: {
    enableCompression: true, // 启用压缩
    enableZeroCopy: true, // 启用零拷贝
    adaptivePooling: true, // 自适应池大小
    memoryMapping: true, // 内存映射
    backgroundDefrag: true, // 后台碎片整理
    predictiveAllocation: true, // 预测性分配
  },

  monitoring: {
    enableMetrics: true, // 启用指标收集
    enableAlerts: true, // 启用告警
    performanceTracking: true, // 性能跟踪
    memoryLeakDetection: true, // 内存泄漏检测
    allocationPatternAnalysis: true, // 分配模式分析
  },
};

/**
 * 内存池管理器类
 */
class MemoryPool extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = { ...MEMORY_POOL_CONFIG, ...config };
    this.pools = new Map();
    this.allocatedBuffers = new Map();
    this.freeBuffers = new Map();
    this.metrics = {
      totalAllocated: 0,
      totalFreed: 0,
      currentUsage: 0,
      peakUsage: 0,
      allocationCount: 0,
      freeCount: 0,
      gcCount: 0,
      defragCount: 0,
      hitRate: 0,
      missRate: 0,
      allocationHistory: [],
      performanceHistory: [],
    };

    this.allocationPatterns = new Map();
    this.cleanupTimer = null;
    this.metricsTimer = null;
    this.isInitialized = false;

    // 初始化内存泄漏检测器
    this.leakDetector = null;
    if (this.config.monitoring.memoryLeakDetection) {
      this.initializeLeakDetector();
    }

    this.init();
  }

  init() {
    try {
      // 初始化各种大小的内存池
      Object.entries(this.config.pools).forEach(([name, config]) => {
        this.initializePool(name, config);
      });

      // 启动定期清理
      if (this.config.management.cleanupInterval > 0) {
        this.startCleanupTimer();
      }

      // 启动指标收集
      if (this.config.monitoring.enableMetrics) {
        this.startMetricsCollection();
      }

      // 启动内存泄漏检测
      if (this.leakDetector && this.config.monitoring.memoryLeakDetection) {
        this.leakDetector.start();
      }

      this.isInitialized = true;
      this.emit("initialized", { pools: this.pools.size });

      logToFile("内存池初始化成功", "INFO");
    } catch (error) {
      logToFile(`内存池初始化失败: ${error.message}`, "ERROR");
      throw error;
    }
  }

  initializePool(name, config) {
    const pool = {
      name,
      size: config.size,
      maxCount: config.count,
      currentCount: 0,
      available: [],
      allocated: new Set(),
      totalAllocated: 0,
      totalFreed: 0,
      hitCount: 0,
      missCount: 0,
    };

    // 预分配一些缓冲区
    const preAllocCount = Math.min(config.count, Math.ceil(config.count * 0.3));
    for (let i = 0; i < preAllocCount; i++) {
      const buffer = Buffer.allocUnsafe(config.size);
      pool.available.push(buffer);
      pool.currentCount++;
    }

    this.pools.set(name, pool);
    this.freeBuffers.set(name, pool.available);

    logToFile(
      `内存池 ${name} 初始化完成: ${config.size} bytes x ${preAllocCount}`,
      "DEBUG",
    );
  }

  /**
   * 初始化内存泄漏检测器
   */
  initializeLeakDetector() {
    try {
      this.leakDetector = new MemoryLeakDetector(this, {
        checkInterval: 30 * 1000, // 30秒检查间隔
        thresholds: {
          consecutiveGrowthLimit: 5,
          memoryGrowthRateThreshold: 15, // 15%增长率阈值
          absoluteGrowthThreshold: 100, // 100MB绝对增长阈值
          memoryUsageThreshold: 85, // 85%使用率阈值
          longLivedObjectThreshold: 10 * 60 * 1000, // 10分钟长期存活阈值
          abnormalAllocationThreshold: 50, // 50MB异常分配阈值
        },
      });

      // 监听泄漏检测事件
      this.leakDetector.on("memoryLeakDetected", (alert) => {
        this.handleMemoryLeakAlert(alert);
      });

      this.leakDetector.on("started", () => {
        logToFile("内存泄漏检测器已启动", "INFO");
      });

      this.leakDetector.on("stopped", () => {
        logToFile("内存泄漏检测器已停止", "INFO");
      });

      logToFile("内存泄漏检测器初始化成功", "INFO");
    } catch (error) {
      logToFile(`内存泄漏检测器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 处理内存泄漏告警
   */
  handleMemoryLeakAlert(alert) {
    const { level, memoryInfo, leakResults, recommendations } = alert;

    // 记录详细的泄漏信息
    const leakSummary = Object.entries(leakResults)
      .filter(([, result]) => result.detected)
      .map(([type, result]) => `${type}: ${result.reason}`)
      .join("; ");

    logToFile(
      `内存泄漏检测告警 [${level.toUpperCase()}]: ${leakSummary}`,
      level === "critical" ? "ERROR" : "WARN",
    );

    // 打印修复建议
    if (recommendations && recommendations.length > 0) {
      logToFile(`修复建议: ${recommendations.join("; ")}`, "INFO");
    }

    // 发出内存泄漏告警事件
    this.emit("memoryLeakAlert", {
      level,
      timestamp: alert.timestamp,
      summary: leakSummary,
      memoryInfo,
      recommendations,
      stats: this.getStats(),
    });

    // 如果是关键级别的泄漏，执行紧急清理
    if (level === "critical") {
      this.performEmergencyCleanup();
    }
  }

  /**
   * 执行紧急清理
   */
  performEmergencyCleanup() {
    try {
      logToFile("执行紧急内存清理", "WARN");

      // 强制垃圾回收
      this.performGarbageCollection();

      // 如果支持全局垃圾回收
      if (global.gc) {
        global.gc();
        logToFile("执行了全局垃圾回收", "INFO");
      }

      // 执行碎片整理
      this.performDefragmentation();

      // 清理分配模式历史
      if (this.allocationPatterns.size > 100) {
        const oldPatterns = Array.from(this.allocationPatterns.entries())
          .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
          .slice(0, Math.floor(this.allocationPatterns.size / 2));

        oldPatterns.forEach(([key]) => {
          this.allocationPatterns.delete(key);
        });

        logToFile(`清理了${oldPatterns.length}个旧的分配模式`, "INFO");
      }

      // 清理性能历史记录
      if (this.metrics.performanceHistory.length > 500) {
        this.metrics.performanceHistory =
          this.metrics.performanceHistory.slice(-100);
        logToFile("清理了性能历史记录", "INFO");
      }

      this.emit("emergencyCleanupCompleted", {
        timestamp: Date.now(),
        stats: this.getStats(),
      });
    } catch (error) {
      logToFile(`紧急清理失败: ${error.message}`, "ERROR");
    }
  }

  allocate(size, options = {}) {
    const startTime = performance.now();

    try {
      // 选择最适合的池
      const poolName = this.selectOptimalPool(size);
      const pool = this.pools.get(poolName);

      if (!pool) {
        throw new Error(`未找到适合大小 ${size} 的内存池`);
      }

      let buffer;

      // 尝试从池中获取缓冲区
      if (pool.available.length > 0) {
        buffer = pool.available.pop();
        pool.hitCount++;
        this.metrics.hitRate = this.calculateHitRate();
      } else {
        // 池中没有可用缓冲区，创建新的
        if (pool.currentCount < pool.maxCount) {
          buffer = Buffer.allocUnsafe(pool.size);
          pool.currentCount++;
        } else {
          // 池已满，触发垃圾回收
          this.performGarbageCollection();

          // 再次尝试
          if (pool.available.length > 0) {
            buffer = pool.available.pop();
            pool.hitCount++;
          } else {
            // 仍然没有可用缓冲区，创建临时缓冲区
            buffer = Buffer.allocUnsafe(size);
            logToFile(`内存池 ${poolName} 已满，创建临时缓冲区`, "WARN");
          }
        }

        pool.missCount++;
        this.metrics.missRate = this.calculateMissRate();
      }

      // 记录分配信息
      const allocationId = this.generateAllocationId();
      const allocation = {
        id: allocationId,
        buffer,
        size: buffer.length,
        poolName,
        allocatedAt: Date.now(),
        options,
      };

      this.allocatedBuffers.set(allocationId, allocation);
      pool.allocated.add(allocationId);
      pool.totalAllocated++;

      // 更新指标
      this.metrics.totalAllocated++;
      this.metrics.allocationCount++;
      this.metrics.currentUsage += buffer.length;
      this.metrics.peakUsage = Math.max(
        this.metrics.peakUsage,
        this.metrics.currentUsage,
      );

      // 记录分配模式
      this.recordAllocationPattern(size, poolName);

      // 记录性能
      const allocTime = performance.now() - startTime;
      this.metrics.performanceHistory.push({
        operation: "allocate",
        size,
        time: allocTime,
        timestamp: Date.now(),
      });

      // 保持性能历史记录在合理范围内
      if (this.metrics.performanceHistory.length > 1000) {
        this.metrics.performanceHistory =
          this.metrics.performanceHistory.slice(-500);
      }

      this.emit("allocated", {
        id: allocationId,
        size: buffer.length,
        pool: poolName,
      });

      return { buffer, blockId: allocationId };
    } catch (error) {
      logToFile(`内存分配失败: ${error.message}`, "ERROR");
      throw error;
    }
  }

  free(allocationId) {
    const startTime = performance.now();

    try {
      const allocation = this.allocatedBuffers.get(allocationId);
      if (!allocation) {
        logToFile(`尝试释放未知的分配ID: ${allocationId}`, "WARN");
        return false;
      }

      const pool = this.pools.get(allocation.poolName);
      if (!pool) {
        logToFile(`未找到内存池: ${allocation.poolName}`, "ERROR");
        return false;
      }

      // 清理缓冲区内容（安全考虑）
      if (this.config.optimization.enableZeroCopy) {
        allocation.buffer.fill(0);
      }

      // 将缓冲区返回到池中
      if (pool.available.length < pool.maxCount) {
        pool.available.push(allocation.buffer);
      }

      // 清理分配记录
      this.allocatedBuffers.delete(allocationId);
      pool.allocated.delete(allocationId);
      pool.totalFreed++;

      // 更新指标
      this.metrics.totalFreed++;
      this.metrics.freeCount++;
      this.metrics.currentUsage -= allocation.size;

      // 记录性能
      const freeTime = performance.now() - startTime;
      this.metrics.performanceHistory.push({
        operation: "free",
        size: allocation.size,
        time: freeTime,
        timestamp: Date.now(),
      });

      this.emit("freed", {
        id: allocationId,
        size: allocation.size,
        pool: allocation.poolName,
      });

      return true;
    } catch (error) {
      logToFile(`内存释放失败: ${error.message}`, "ERROR");
      return false;
    }
  }

  selectOptimalPool(size) {
    // 找到能容纳请求大小的最小池
    let bestPool = null;
    let bestSize = Infinity;

    for (const [name, config] of Object.entries(this.config.pools)) {
      if (config.size >= size && config.size < bestSize) {
        bestPool = name;
        bestSize = config.size;
      }
    }

    // 如果没有找到合适的池，使用最大的池
    if (!bestPool) {
      const poolNames = Object.keys(this.config.pools);
      bestPool = poolNames[poolNames.length - 1];
    }

    return bestPool;
  }

  performGarbageCollection() {
    const startTime = performance.now();

    try {
      let freedCount = 0;
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5分钟

      // 释放长时间未使用的分配
      for (const [id, allocation] of this.allocatedBuffers.entries()) {
        if (now - allocation.allocatedAt > maxAge) {
          this.free(id);
          freedCount++;
        }
      }

      this.metrics.gcCount++;

      const gcTime = performance.now() - startTime;
      logToFile(
        `垃圾回收完成: 释放 ${freedCount} 个分配，耗时 ${gcTime.toFixed(2)}ms`,
        "DEBUG",
      );

      this.emit("garbageCollected", { freedCount, time: gcTime });
    } catch (error) {
      logToFile(`垃圾回收失败: ${error.message}`, "ERROR");
    }
  }

  recordAllocationPattern(size, poolName) {
    if (!this.config.monitoring.allocationPatternAnalysis) return;

    const pattern = this.allocationPatterns.get(size) || {
      count: 0,
      pools: new Map(),
      lastAccess: 0,
    };

    pattern.count++;
    pattern.lastAccess = Date.now();

    const poolCount = pattern.pools.get(poolName) || 0;
    pattern.pools.set(poolName, poolCount + 1);

    this.allocationPatterns.set(size, pattern);
  }

  calculateHitRate() {
    const totalHits = Array.from(this.pools.values()).reduce(
      (sum, pool) => sum + pool.hitCount,
      0,
    );
    const totalRequests =
      totalHits +
      Array.from(this.pools.values()).reduce(
        (sum, pool) => sum + pool.missCount,
        0,
      );
    return totalRequests > 0 ? (totalHits / totalRequests) * 100 : 0;
  }

  calculateMissRate() {
    const totalMisses = Array.from(this.pools.values()).reduce(
      (sum, pool) => sum + pool.missCount,
      0,
    );
    const totalRequests =
      totalMisses +
      Array.from(this.pools.values()).reduce(
        (sum, pool) => sum + pool.hitCount,
        0,
      );
    return totalRequests > 0 ? (totalMisses / totalRequests) * 100 : 0;
  }

  generateAllocationId() {
    return `alloc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.performGarbageCollection();

      // 检查是否需要碎片整理
      if (this.shouldDefragment()) {
        this.performDefragmentation();
      }
    }, this.config.management.cleanupInterval);
  }

  startMetricsCollection() {
    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
      this.checkMemoryAlerts();
    }, this.config.monitoring.metricsInterval);
  }

  collectMetrics() {
    const metrics = {
      timestamp: Date.now(),
      currentUsage: this.metrics.currentUsage,
      peakUsage: this.metrics.peakUsage,
      hitRate: this.calculateHitRate(),
      missRate: this.calculateMissRate(),
      poolStats: {},
    };

    // 收集各池的统计信息
    for (const [name, pool] of this.pools.entries()) {
      metrics.poolStats[name] = {
        available: pool.available.length,
        allocated: pool.allocated.size,
        hitCount: pool.hitCount,
        missCount: pool.missCount,
        utilization: (pool.allocated.size / pool.maxCount) * 100,
      };
    }

    this.metrics.allocationHistory.push(metrics);

    // 保持历史记录在合理范围内
    if (this.metrics.allocationHistory.length > 1000) {
      this.metrics.allocationHistory =
        this.metrics.allocationHistory.slice(-500);
    }

    this.emit("metricsCollected", metrics);
  }

  checkMemoryAlerts() {
    if (!this.config.monitoring.enableAlerts) return;

    const usagePercent =
      (this.metrics.currentUsage / this.config.management.maxPoolMemory) * 100;

    if (usagePercent > 90) {
      this.emit("memoryAlert", {
        level: "critical",
        message: `内存使用率过高: ${usagePercent.toFixed(1)}%`,
        usage: this.metrics.currentUsage,
        limit: this.config.management.maxPoolMemory,
      });
    } else if (usagePercent > 80) {
      this.emit("memoryAlert", {
        level: "warning",
        message: `内存使用率较高: ${usagePercent.toFixed(1)}%`,
        usage: this.metrics.currentUsage,
        limit: this.config.management.maxPoolMemory,
      });
    }
  }

  shouldDefragment() {
    const fragmentationRatio = this.calculateFragmentation();
    return fragmentationRatio > this.config.management.defragmentThreshold;
  }

  calculateFragmentation() {
    let totalFragments = 0;
    let totalCapacity = 0;

    for (const pool of this.pools.values()) {
      totalFragments += pool.available.length;
      totalCapacity += pool.maxCount;
    }

    return totalCapacity > 0 ? totalFragments / totalCapacity : 0;
  }

  performDefragmentation() {
    const startTime = performance.now();

    try {
      // 简化的碎片整理：重新组织可用缓冲区
      for (const pool of this.pools.values()) {
        // 对可用缓冲区进行排序和整理
        pool.available.sort((a, b) => a.length - b.length);
      }

      this.metrics.defragCount++;

      const defragTime = performance.now() - startTime;
      logToFile(`碎片整理完成，耗时 ${defragTime.toFixed(2)}ms`, "DEBUG");

      this.emit("defragmented", { time: defragTime });
    } catch (error) {
      logToFile(`碎片整理失败: ${error.message}`, "ERROR");
    }
  }

  getStats() {
    const baseStats = {
      ...this.metrics,
      pools: Object.fromEntries(
        Array.from(this.pools.entries()).map(([name, pool]) => [
          name,
          {
            size: pool.size,
            maxCount: pool.maxCount,
            currentCount: pool.currentCount,
            available: pool.available.length,
            allocated: pool.allocated.size,
            hitCount: pool.hitCount,
            missCount: pool.missCount,
            utilization: (pool.allocated.size / pool.maxCount) * 100,
          },
        ]),
      ),
      fragmentation: this.calculateFragmentation(),
      usagePercent:
        (this.metrics.currentUsage / this.config.management.maxPoolMemory) *
        100,
    };

    // 添加内存泄漏检测器状态
    if (this.leakDetector) {
      baseStats.leakDetector = this.leakDetector.getStatus();
    }

    return baseStats;
  }

  // 启动内存池（为了兼容性）
  async start() {
    if (this.isInitialized) {
      return;
    }

    // 重新初始化
    this.init();
    this.emit("started");
    logToFile("内存池已启动", "INFO");
  }

  // 停止内存池（为了兼容性）
  async stop() {
    if (!this.isInitialized) {
      return;
    }

    this.dispose();
    this.emit("stopped");
    logToFile("内存池已停止", "INFO");
  }

  dispose() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    // 停止内存泄漏检测器
    if (this.leakDetector) {
      this.leakDetector.stop();
      this.leakDetector = null;
    }

    // 释放所有分配的内存
    for (const id of this.allocatedBuffers.keys()) {
      this.free(id);
    }

    this.pools.clear();
    this.allocatedBuffers.clear();
    this.freeBuffers.clear();
    this.allocationPatterns.clear();

    this.isInitialized = false;
    this.emit("disposed");

    logToFile("内存池已清理", "INFO");
  }
}

// 导出内存池实例
const memoryPool = new MemoryPool();

module.exports = memoryPool;
