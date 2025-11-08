/**
 * 终端性能监控工具类
 * 用于监控和分析 WebTerminal 组件的性能指标
 */

export class TerminalPerformanceMonitor {
  constructor(options = {}) {
    this.enabled = options.enabled !== false;
    this.sampleRate = options.sampleRate || 100; // 采样率：每100次操作采样一次
    this.maxHistorySize = options.maxHistorySize || 1000; // 最大历史记录数

    // 性能指标
    this.metrics = {
      writeCount: 0,              // 写入次数
      writeBytes: 0,              // 写入字节数
      flushCount: 0,              // 刷新次数
      renderCount: 0,             // 渲染次数
      droppedFrames: 0,           // 丢帧数
      avgWriteTime: 0,            // 平均写入时间 (ms)
      avgFlushTime: 0,            // 平均刷新时间 (ms)
      avgRenderTime: 0,           // 平均渲染时间 (ms)
      peakMemoryUsage: 0,         // 峰值内存使用 (bytes)
      currentBufferSize: 0,       // 当前缓冲区大小
      scrollbackUsage: 0,         // 滚回缓冲使用率 (%)
    };

    // 时间序列数据
    this.history = {
      writeTime: [],              // 写入时间历史
      flushTime: [],              // 刷新时间历史
      renderTime: [],             // 渲染时间历史
      bufferSize: [],             // 缓冲区大小历史
      fps: [],                    // 帧率历史
    };

    // 性能计时器
    this.timers = new Map();

    // FPS 监控
    this.lastFrameTime = performance.now();
    this.frameCount = 0;
    this.currentFPS = 0;
    this.fpsCheckInterval = null;

    // 内存监控
    this.memoryCheckInterval = null;

    // 性能警告阈值
    this.thresholds = {
      maxWriteTime: options.maxWriteTime || 50,      // 最大写入时间 (ms)
      maxFlushTime: options.maxFlushTime || 16,      // 最大刷新时间 (ms)
      maxRenderTime: options.maxRenderTime || 16,    // 最大渲染时间 (ms)
      minFPS: options.minFPS || 30,                  // 最小帧率
      maxBufferSize: options.maxBufferSize || 1048576, // 最大缓冲区大小 (1MB)
    };

    // 警告回调
    this.onWarning = options.onWarning || null;

    // 统计回调
    this.onStats = options.onStats || null;

    // 启动定期检查
    this.startPeriodicChecks();
  }

  /**
   * 启动定期性能检查
   */
  startPeriodicChecks() {
    if (!this.enabled) return;

    // FPS 检查 (每秒一次)
    this.fpsCheckInterval = setInterval(() => {
      this.updateFPS();
    }, 1000);

    // 内存检查 (每5秒一次)
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, 5000);

    // 统计报告 (每10秒一次)
    this.statsInterval = setInterval(() => {
      this.reportStats();
    }, 10000);
  }

  /**
   * 停止定期检查
   */
  stopPeriodicChecks() {
    if (this.fpsCheckInterval) {
      clearInterval(this.fpsCheckInterval);
      this.fpsCheckInterval = null;
    }
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  /**
   * 开始计时
   * @param {string} label - 计时器标签
   */
  startTimer(label) {
    if (!this.enabled) return;
    this.timers.set(label, performance.now());
  }

  /**
   * 结束计时并记录
   * @param {string} label - 计时器标签
   * @returns {number} 持续时间 (ms)
   */
  endTimer(label) {
    if (!this.enabled) return 0;

    const startTime = this.timers.get(label);
    if (!startTime) return 0;

    const duration = performance.now() - startTime;
    this.timers.delete(label);

    return duration;
  }

  /**
   * 记录写入操作
   * @param {number} byteCount - 写入字节数
   * @param {number} duration - 持续时间 (ms)
   */
  recordWrite(byteCount, duration) {
    if (!this.enabled) return;

    this.metrics.writeCount++;
    this.metrics.writeBytes += byteCount;

    // 更新平均写入时间
    this.metrics.avgWriteTime =
      (this.metrics.avgWriteTime * (this.metrics.writeCount - 1) + duration) /
      this.metrics.writeCount;

    // 采样记录历史
    if (this.metrics.writeCount % this.sampleRate === 0) {
      this.addHistory('writeTime', duration);
    }

    // 检查性能警告
    if (duration > this.thresholds.maxWriteTime) {
      this.warn('write', `写入时间过长: ${duration.toFixed(2)}ms (阈值: ${this.thresholds.maxWriteTime}ms)`);
    }
  }

  /**
   * 记录刷新操作
   * @param {number} duration - 持续时间 (ms)
   */
  recordFlush(duration) {
    if (!this.enabled) return;

    this.metrics.flushCount++;

    // 更新平均刷新时间
    this.metrics.avgFlushTime =
      (this.metrics.avgFlushTime * (this.metrics.flushCount - 1) + duration) /
      this.metrics.flushCount;

    // 采样记录历史
    if (this.metrics.flushCount % this.sampleRate === 0) {
      this.addHistory('flushTime', duration);
    }

    // 检查性能警告
    if (duration > this.thresholds.maxFlushTime) {
      this.warn('flush', `刷新时间过长: ${duration.toFixed(2)}ms (阈值: ${this.thresholds.maxFlushTime}ms)`);
    }
  }

  /**
   * 记录渲染操作
   * @param {number} duration - 持续时间 (ms)
   */
  recordRender(duration) {
    if (!this.enabled) return;

    this.metrics.renderCount++;
    this.frameCount++;

    // 更新平均渲染时间
    this.metrics.avgRenderTime =
      (this.metrics.avgRenderTime * (this.metrics.renderCount - 1) + duration) /
      this.metrics.renderCount;

    // 采样记录历史
    if (this.metrics.renderCount % this.sampleRate === 0) {
      this.addHistory('renderTime', duration);
    }

    // 检查性能警告
    if (duration > this.thresholds.maxRenderTime) {
      this.metrics.droppedFrames++;
      this.warn('render', `渲染时间过长: ${duration.toFixed(2)}ms (阈值: ${this.thresholds.maxRenderTime}ms)`);
    }
  }

  /**
   * 记录缓冲区大小
   * @param {number} size - 缓冲区大小 (bytes)
   */
  recordBufferSize(size) {
    if (!this.enabled) return;

    this.metrics.currentBufferSize = size;

    // 采样记录历史
    if (this.metrics.writeCount % this.sampleRate === 0) {
      this.addHistory('bufferSize', size);
    }

    // 检查性能警告
    if (size > this.thresholds.maxBufferSize) {
      this.warn('buffer', `缓冲区过大: ${(size / 1024).toFixed(2)}KB (阈值: ${(this.thresholds.maxBufferSize / 1024).toFixed(2)}KB)`);
    }
  }

  /**
   * 记录滚回缓冲使用率
   * @param {number} usage - 使用率 (0-100)
   */
  recordScrollbackUsage(usage) {
    if (!this.enabled) return;
    this.metrics.scrollbackUsage = usage;
  }

  /**
   * 更新 FPS
   */
  updateFPS() {
    if (!this.enabled) return;

    this.currentFPS = this.frameCount;
    this.frameCount = 0;

    // 记录历史
    this.addHistory('fps', this.currentFPS);

    // 检查性能警告
    if (this.currentFPS < this.thresholds.minFPS) {
      this.warn('fps', `帧率过低: ${this.currentFPS}fps (阈值: ${this.thresholds.minFPS}fps)`);
    }
  }

  /**
   * 检查内存使用
   */
  checkMemoryUsage() {
    if (!this.enabled) return;

    // 检查浏览器是否支持 performance.memory
    if (performance.memory) {
      const memoryUsage = performance.memory.usedJSHeapSize;

      if (memoryUsage > this.metrics.peakMemoryUsage) {
        this.metrics.peakMemoryUsage = memoryUsage;
      }
    }
  }

  /**
   * 添加历史记录
   * @param {string} key - 指标键
   * @param {number} value - 指标值
   */
  addHistory(key, value) {
    if (!this.history[key]) {
      this.history[key] = [];
    }

    this.history[key].push({
      timestamp: Date.now(),
      value: value
    });

    // 限制历史记录大小
    if (this.history[key].length > this.maxHistorySize) {
      this.history[key].shift();
    }
  }

  /**
   * 发出性能警告
   * @param {string} type - 警告类型
   * @param {string} message - 警告消息
   */
  warn(type, message) {
    const warning = {
      type,
      message,
      timestamp: Date.now(),
      metrics: { ...this.metrics }
    };

    if (this.onWarning) {
      this.onWarning(warning);
    }

    // 开发模式下输出到控制台
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[TerminalPerformanceMonitor] ${message}`);
    }
  }

  /**
   * 报告统计信息
   */
  reportStats() {
    if (!this.enabled) return;

    const stats = this.getStats();

    if (this.onStats) {
      this.onStats(stats);
    }
  }

  /**
   * 获取性能统计
   * @returns {Object} 性能统计对象
   */
  getStats() {
    return {
      metrics: { ...this.metrics },
      currentFPS: this.currentFPS,
      history: {
        writeTime: this.getHistoryStats('writeTime'),
        flushTime: this.getHistoryStats('flushTime'),
        renderTime: this.getHistoryStats('renderTime'),
        bufferSize: this.getHistoryStats('bufferSize'),
        fps: this.getHistoryStats('fps'),
      }
    };
  }

  /**
   * 获取历史统计信息
   * @param {string} key - 指标键
   * @returns {Object} 统计对象
   */
  getHistoryStats(key) {
    const data = this.history[key] || [];

    if (data.length === 0) {
      return { min: 0, max: 0, avg: 0, count: 0 };
    }

    const values = data.map(item => item.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, val) => sum + val, 0) / values.length;

    return { min, max, avg, count: data.length };
  }

  /**
   * 重置统计信息
   */
  reset() {
    this.metrics = {
      writeCount: 0,
      writeBytes: 0,
      flushCount: 0,
      renderCount: 0,
      droppedFrames: 0,
      avgWriteTime: 0,
      avgFlushTime: 0,
      avgRenderTime: 0,
      peakMemoryUsage: 0,
      currentBufferSize: 0,
      scrollbackUsage: 0,
    };

    this.history = {
      writeTime: [],
      flushTime: [],
      renderTime: [],
      bufferSize: [],
      fps: [],
    };

    this.frameCount = 0;
    this.currentFPS = 0;
  }

  /**
   * 销毁监控器
   */
  destroy() {
    this.stopPeriodicChecks();
    this.timers.clear();
    this.reset();
    this.enabled = false;
  }
}

export default TerminalPerformanceMonitor;
