/**
 * 高负载写入策略管理器
 * 根据系统负载动态调整终端写入和刷新策略
 */

export class WriteStrategyManager {
  constructor(options = {}) {
    // 配置参数
    this.config = {
      // 批处理阈值
      lowLoadBatchSize: options.lowLoadBatchSize || 16384,        // 低负载：16KB
      mediumLoadBatchSize: options.mediumLoadBatchSize || 65536,  // 中负载：64KB
      highLoadBatchSize: options.highLoadBatchSize || 262144,     // 高负载：256KB

      // 刷新延迟
      lowLoadFlushDelay: options.lowLoadFlushDelay || 16,         // 低负载：16ms (60fps)
      mediumLoadFlushDelay: options.mediumLoadFlushDelay || 33,   // 中负载：33ms (30fps)
      highLoadFlushDelay: options.highLoadFlushDelay || 66,       // 高负载：66ms (15fps)

      // 负载阈值
      lowLoadThreshold: options.lowLoadThreshold || 0.3,          // 低负载：<30%
      mediumLoadThreshold: options.mediumLoadThreshold || 0.6,    // 中负载：30-60%
      highLoadThreshold: options.highLoadThreshold || 0.8,        // 高负载：>60%

      // 自适应参数
      adaptiveEnabled: options.adaptiveEnabled !== false,         // 启用自适应
      loadCheckInterval: options.loadCheckInterval || 1000,       // 负载检查间隔：1秒
      loadSampleWindow: options.loadSampleWindow || 5,            // 负载采样窗口：5个样本
    };

    // 当前状态
    this.currentLoad = 0;                     // 当前负载（0-1）
    this.currentStrategy = 'low';             // 当前策略：low/medium/high
    this.writeQueue = [];                     // 写入队列
    this.queueSize = 0;                       // 队列大小（字节）
    this.flushTimer = null;                   // 刷新定时器
    this.flushTimerType = null;               // 定时器类型：'raf' | 'timeout'

    // 性能指标采样
    this.loadSamples = [];                    // 负载采样
    this.lastLoadCheck = 0;                   // 上次负载检查时间
    this.loadCheckTimer = null;               // 负载检查定时器

    // 统计信息
    this.stats = {
      totalEnqueued: 0,                       // 总入队次数
      totalFlushed: 0,                        // 总刷新次数
      totalBytesWritten: 0,                   // 总写入字节数
      strategyChanges: 0,                     // 策略切换次数
      avgQueueSize: 0,                        // 平均队列大小
      avgFlushSize: 0,                        // 平均刷新大小
      lastStrategyChange: 0,                  // 上次策略切换时间
    };

    // 回调
    this.onFlush = options.onFlush || null;              // 刷新回调
    this.onStrategyChange = options.onStrategyChange || null;  // 策略变化回调

    // 启动自适应负载检查
    if (this.config.adaptiveEnabled) {
      this.startLoadMonitoring();
    }
  }

  /**
   * 启动负载监控
   */
  startLoadMonitoring() {
    this.loadCheckTimer = setInterval(() => {
      this.checkLoad();
    }, this.config.loadCheckInterval);
  }

  /**
   * 停止负载监控
   */
  stopLoadMonitoring() {
    if (this.loadCheckTimer) {
      clearInterval(this.loadCheckTimer);
      this.loadCheckTimer = null;
    }
  }

  /**
   * 检查系统负载
   */
  checkLoad() {
    // 计算负载指标
    const load = this.calculateLoad();

    // 添加到采样窗口
    this.loadSamples.push(load);
    if (this.loadSamples.length > this.config.loadSampleWindow) {
      this.loadSamples.shift();
    }

    // 计算平均负载
    const avgLoad = this.loadSamples.reduce((sum, l) => sum + l, 0) / this.loadSamples.length;
    this.currentLoad = avgLoad;

    // 根据负载调整策略
    this.adjustStrategy(avgLoad);

    this.lastLoadCheck = Date.now();
  }

  /**
   * 计算当前负载
   * @returns {number} 负载值（0-1）
   */
  calculateLoad() {
    // 计算负载的多个因素
    let load = 0;

    // 1. 队列大小因素（权重：0.4）
    const queueFactor = Math.min(1, this.queueSize / this.config.highLoadBatchSize);
    load += queueFactor * 0.4;

    // 2. 入队频率因素（权重：0.3）
    const now = Date.now();
    const timeSinceLastCheck = now - this.lastLoadCheck;
    if (timeSinceLastCheck > 0) {
      const enqueueRate = (this.stats.totalEnqueued / timeSinceLastCheck) * 1000; // 每秒入队次数
      const enqueueFactor = Math.min(1, enqueueRate / 100); // 假设100次/秒为高负载
      load += enqueueFactor * 0.3;
    }

    // 3. 内存使用因素（权重：0.3）
    if (performance.memory) {
      const memoryUsage = performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit;
      load += memoryUsage * 0.3;
    }

    return Math.min(1, load);
  }

  /**
   * 根据负载调整策略
   * @param {number} load - 当前负载
   */
  adjustStrategy(load) {
    let newStrategy;

    if (load < this.config.lowLoadThreshold) {
      newStrategy = 'low';
    } else if (load < this.config.mediumLoadThreshold) {
      newStrategy = 'medium';
    } else {
      newStrategy = 'high';
    }

    if (newStrategy !== this.currentStrategy) {
      const oldStrategy = this.currentStrategy;
      this.currentStrategy = newStrategy;
      this.stats.strategyChanges++;
      this.stats.lastStrategyChange = Date.now();

      // 触发策略变化回调
      if (this.onStrategyChange) {
        this.onStrategyChange({
          oldStrategy,
          newStrategy,
          load,
          config: this.getCurrentConfig(),
        });
      }
    }
  }

  /**
   * 获取当前策略的配置
   * @returns {Object} 配置对象
   */
  getCurrentConfig() {
    switch (this.currentStrategy) {
      case 'low':
        return {
          batchSize: this.config.lowLoadBatchSize,
          flushDelay: this.config.lowLoadFlushDelay,
          strategy: 'low',
        };
      case 'medium':
        return {
          batchSize: this.config.mediumLoadBatchSize,
          flushDelay: this.config.mediumLoadFlushDelay,
          strategy: 'medium',
        };
      case 'high':
        return {
          batchSize: this.config.highLoadBatchSize,
          flushDelay: this.config.highLoadFlushDelay,
          strategy: 'high',
        };
      default:
        return {
          batchSize: this.config.lowLoadBatchSize,
          flushDelay: this.config.lowLoadFlushDelay,
          strategy: 'low',
        };
    }
  }

  /**
   * 入队写入数据
   * @param {string} data - 要写入的数据
   */
  enqueue(data) {
    if (!data) return;

    const dataStr = typeof data === 'string' ? data : data.toString();
    if (!dataStr) return;

    // 添加到队列
    this.writeQueue.push(dataStr);
    this.queueSize += dataStr.length;
    this.stats.totalEnqueued++;

    // 更新平均队列大小
    this.stats.avgQueueSize =
      (this.stats.avgQueueSize * (this.stats.totalEnqueued - 1) + this.queueSize) /
      this.stats.totalEnqueued;

    // 获取当前策略配置
    const config = this.getCurrentConfig();

    // 检查是否需要立即刷新
    if (this.queueSize >= config.batchSize) {
      // 取消现有定时器
      this.cancelFlushTimer();

      // 立即刷新
      this.flush();
      return;
    }

    // 如果已有定时器，不重复设置
    if (this.flushTimer !== null) {
      return;
    }

    // 设置刷新定时器
    this.scheduleFlush(config.flushDelay);
  }

  /**
   * 调度刷新
   * @param {number} delay - 延迟时间（ms）
   */
  scheduleFlush(delay) {
    // 对于很短的延迟，优先使用 RAF
    if (delay <= 16 && typeof requestAnimationFrame === 'function') {
      this.flushTimerType = 'raf';
      this.flushTimer = requestAnimationFrame(() => {
        this.flushTimer = null;
        this.flushTimerType = null;
        this.flush();
      });
    } else {
      this.flushTimerType = 'timeout';
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.flushTimerType = null;
        this.flush();
      }, delay);
    }
  }

  /**
   * 取消刷新定时器
   */
  cancelFlushTimer() {
    if (this.flushTimer === null) return;

    if (this.flushTimerType === 'raf' && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.flushTimer);
    } else if (this.flushTimerType === 'timeout') {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = null;
    this.flushTimerType = null;
  }

  /**
   * 刷新队列
   * @returns {string|null} 刷新的数据
   */
  flush() {
    if (this.writeQueue.length === 0) {
      return null;
    }

    // 合并队列数据
    const data = this.writeQueue.join('');
    const byteCount = this.queueSize;

    // 清空队列
    this.writeQueue = [];
    this.queueSize = 0;

    // 更新统计
    this.stats.totalFlushed++;
    this.stats.totalBytesWritten += byteCount;
    this.stats.avgFlushSize =
      (this.stats.avgFlushSize * (this.stats.totalFlushed - 1) + byteCount) /
      this.stats.totalFlushed;

    // 触发刷新回调
    if (this.onFlush) {
      this.onFlush(data, {
        byteCount,
        strategy: this.currentStrategy,
        load: this.currentLoad,
      });
    }

    return data;
  }

  /**
   * 强制刷新（忽略延迟）
   */
  forceFlush() {
    this.cancelFlushTimer();
    return this.flush();
  }

  /**
   * 获取当前队列状态
   * @returns {Object} 状态对象
   */
  getQueueStatus() {
    return {
      queueLength: this.writeQueue.length,
      queueSize: this.queueSize,
      hasPendingFlush: this.flushTimer !== null,
      currentStrategy: this.currentStrategy,
      currentLoad: this.currentLoad,
    };
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计对象
   */
  getStats() {
    return {
      ...this.stats,
      currentStrategy: this.currentStrategy,
      currentLoad: this.currentLoad,
      queueSize: this.queueSize,
      queueLength: this.writeQueue.length,
      config: this.getCurrentConfig(),
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalEnqueued: 0,
      totalFlushed: 0,
      totalBytesWritten: 0,
      strategyChanges: 0,
      avgQueueSize: 0,
      avgFlushSize: 0,
      lastStrategyChange: 0,
    };
  }

  /**
   * 清空队列
   */
  clear() {
    this.cancelFlushTimer();
    this.writeQueue = [];
    this.queueSize = 0;
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.stopLoadMonitoring();
    this.clear();
    this.loadSamples = [];
    this.onFlush = null;
    this.onStrategyChange = null;
  }
}

export default WriteStrategyManager;
