const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");

// 背压控制配置
const BACKPRESSURE_CONFIG = {
  limits: {
    maxMemoryUsage: 256 * 1024 * 1024, // 最大内存使用（256MB）
    maxConcurrentStreams: 10, // 最大并发流
    bufferHighWaterMark: 64 * 1024, // 缓冲区高水位（64KB）
    bufferLowWaterMark: 16 * 1024, // 缓冲区低水位（16KB）
    maxQueueSize: 100, // 最大队列大小
  },

  thresholds: {
    memoryPressure: 0.8, // 内存压力阈值（80%）
    cpuPressure: 0.9, // CPU压力阈值（90%）
    networkLatency: 1000, // 网络延迟阈值（1秒）
    errorRate: 0.05, // 错误率阈值（5%）
  },

  adaptation: {
    enabled: true, // 启用自适应控制
    adjustmentInterval: 1000, // 调整间隔（1秒）
    aggressiveness: 0.1, // 调整激进程度（10%）
    recoveryFactor: 1.2, // 恢复因子
  },
};

// 背压状态
const PRESSURE_STATE = {
  NORMAL: "normal", // 正常
  LOW: "low", // 低压力
  MEDIUM: "medium", // 中等压力
  HIGH: "high", // 高压力
  CRITICAL: "critical", // 临界压力
};

// 控制策略
const CONTROL_STRATEGY = {
  THROTTLE: "throttle", // 限流
  BUFFER: "buffer", // 缓冲
  DROP: "drop", // 丢弃
  PAUSE: "pause", // 暂停
  REDIRECT: "redirect", // 重定向
};

class PressureMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...BACKPRESSURE_CONFIG, ...config };

    this.metrics = {
      memory: {
        current: 0,
        peak: 0,
        pressure: 0,
      },
      cpu: {
        current: 0,
        average: 0,
        pressure: 0,
      },
      network: {
        latency: 0,
        throughput: 0,
        errors: 0,
      },
      streams: {
        active: 0,
        queued: 0,
        blocked: 0,
      },
    };

    this.history = [];
    this.isMonitoring = false;
    this.monitorTimer = null;
  }

  start() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.monitorTimer = setInterval(() => {
      this.collectMetrics();
    }, 1000); // 每秒收集一次指标

    logToFile("背压监控器已启动", "DEBUG");
    this.emit("started");
  }

  stop() {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    logToFile("背压监控器已停止", "DEBUG");
    this.emit("stopped");
  }

  collectMetrics() {
    try {
      // 收集内存指标
      this.collectMemoryMetrics();

      // 收集CPU指标
      this.collectCpuMetrics();

      // 更新压力状态
      this.updatePressureStates();

      // 保存历史记录
      this.saveMetricsHistory();

      this.emit("metricsUpdated", this.metrics);
    } catch (error) {
      logToFile(`收集指标时出错: ${error.message}`, "ERROR");
    }
  }

  collectMemoryMetrics() {
    const usage = process.memoryUsage();

    this.metrics.memory.current = usage.heapUsed;
    this.metrics.memory.peak = Math.max(
      this.metrics.memory.peak,
      usage.heapUsed,
    );

    // 计算内存压力（相对于配置的最大值）
    this.metrics.memory.pressure =
      this.metrics.memory.current / this.config.limits.maxMemoryUsage;
  }

  collectCpuMetrics() {
    // 简化的CPU使用率计算
    const usage = process.cpuUsage();
    const currentCpu = (usage.user + usage.system) / 1000000; // 转换为秒

    // 计算CPU使用率（需要与时间间隔比较）
    if (this.lastCpuUsage) {
      const cpuDelta = currentCpu - this.lastCpuUsage;
      this.metrics.cpu.current = Math.min(1.0, cpuDelta); // 限制在0-1之间

      // 计算移动平均
      this.metrics.cpu.average =
        this.metrics.cpu.average * 0.9 + this.metrics.cpu.current * 0.1;
    }

    this.lastCpuUsage = currentCpu;
    this.metrics.cpu.pressure = this.metrics.cpu.average;
  }

  updatePressureStates() {
    // 内存压力状态
    if (this.metrics.memory.pressure > this.config.thresholds.memoryPressure) {
      this.emit("memoryPressure", {
        level: this.metrics.memory.pressure,
        current: this.metrics.memory.current,
        limit: this.config.limits.maxMemoryUsage,
      });
    }

    // CPU压力状态
    if (this.metrics.cpu.pressure > this.config.thresholds.cpuPressure) {
      this.emit("cpuPressure", {
        level: this.metrics.cpu.pressure,
        current: this.metrics.cpu.current,
      });
    }
  }

  saveMetricsHistory() {
    this.history.push({
      timestamp: Date.now(),
      metrics: JSON.parse(JSON.stringify(this.metrics)),
    });

    // 保持历史记录长度限制
    if (this.history.length > 100) {
      this.history = this.history.slice(-50);
    }
  }

  getCurrentPressureState() {
    const maxPressure = Math.max(
      this.metrics.memory.pressure,
      this.metrics.cpu.pressure,
    );

    if (maxPressure < 0.3) return PRESSURE_STATE.LOW;
    if (maxPressure < 0.6) return PRESSURE_STATE.NORMAL;
    if (maxPressure < 0.8) return PRESSURE_STATE.MEDIUM;
    if (maxPressure < 0.95) return PRESSURE_STATE.HIGH;
    return PRESSURE_STATE.CRITICAL;
  }

  getMetrics() {
    return {
      ...this.metrics,
      pressureState: this.getCurrentPressureState(),
      timestamp: Date.now(),
    };
  }
}

class BackpressureController extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...BACKPRESSURE_CONFIG, ...config };

    this.monitor = new PressureMonitor(this.config);
    this.controlQueue = []; // 控制队列
    this.activeStreams = new Map(); // 活跃流
    this.blockedStreams = new Set(); // 被阻塞的流

    this.controlState = {
      enabled: true,
      strategy: CONTROL_STRATEGY.THROTTLE,
      adaptiveRate: 1.0, // 自适应速率
      lastAdjustment: Date.now(),
    };

    this.statistics = {
      totalRequests: 0,
      throttledRequests: 0,
      droppedRequests: 0,
      pausedStreams: 0,
      avgResponseTime: 0,
    };

    this.setupMonitorListeners();
  }

  setupMonitorListeners() {
    this.monitor.on("memoryPressure", (data) => {
      this.handleMemoryPressure(data);
    });

    this.monitor.on("cpuPressure", (data) => {
      this.handleCpuPressure(data);
    });

    this.monitor.on("metricsUpdated", () => {
      if (this.config.adaptation.enabled) {
        this.performAdaptiveControl();
      }
    });
  }

  async start() {
    await this.monitor.start();

    if (this.config.adaptation.enabled) {
      this.startAdaptiveControl();
    }

    this.emit("started");
    logToFile("背压控制器已启动", "INFO");
  }

  async stop() {
    await this.monitor.stop();

    if (this.adaptiveTimer) {
      clearInterval(this.adaptiveTimer);
      this.adaptiveTimer = null;
    }

    this.emit("stopped");
    logToFile("背压控制器已停止", "INFO");
  }

  // 流控制接口
  async requestStream(streamId, options = {}) {
    this.statistics.totalRequests++;

    const currentPressure = this.monitor.getCurrentPressureState();
    const decision = await this.makeControlDecision(
      streamId,
      currentPressure,
      options,
    );

    switch (decision.action) {
      case CONTROL_STRATEGY.THROTTLE:
        return await this.throttleStream(streamId, decision.params);

      case CONTROL_STRATEGY.BUFFER:
        return await this.bufferStream(streamId, decision.params);

      case CONTROL_STRATEGY.DROP:
        this.statistics.droppedRequests++;
        throw new Error(`请求被丢弃: ${decision.reason}`);

      case CONTROL_STRATEGY.PAUSE:
        return await this.pauseStream(streamId, decision.params);

      default:
        return await this.allowStream(streamId, options);
    }
  }

  async makeControlDecision(streamId, pressureState, options) {
    // 检查并发限制
    if (this.activeStreams.size >= this.config.limits.maxConcurrentStreams) {
      return {
        action: CONTROL_STRATEGY.DROP,
        reason: "超过最大并发流限制",
      };
    }

    // 检查队列限制
    if (this.controlQueue.length >= this.config.limits.maxQueueSize) {
      return {
        action: CONTROL_STRATEGY.DROP,
        reason: "控制队列已满",
      };
    }

    // 根据压力状态决定策略
    switch (pressureState) {
      case PRESSURE_STATE.CRITICAL:
        return {
          action: CONTROL_STRATEGY.DROP,
          reason: "系统压力临界",
        };

      case PRESSURE_STATE.HIGH:
        if (options.priority === "high") {
          return {
            action: CONTROL_STRATEGY.THROTTLE,
            params: { rate: 0.3 },
          };
        } else {
          return {
            action: CONTROL_STRATEGY.PAUSE,
            params: { delay: 5000 },
          };
        }

      case PRESSURE_STATE.MEDIUM:
        return {
          action: CONTROL_STRATEGY.THROTTLE,
          params: { rate: 0.7 },
        };

      default:
        return {
          action: "allow",
          params: {},
        };
    }
  }

  async throttleStream(streamId, params) {
    this.statistics.throttledRequests++;

    const throttleRate = params.rate * this.controlState.adaptiveRate;
    const delay = Math.max(0, (1 - throttleRate) * 1000); // 最大1秒延迟

    if (delay > 0) {
      logToFile(`限流流 ${streamId}: 延迟 ${delay}ms`, "DEBUG");
      await this.sleep(delay);
    }

    return await this.allowStream(streamId, {
      throttled: true,
      rate: throttleRate,
    });
  }

  async bufferStream(streamId, params) {
    return new Promise((resolve, reject) => {
      const queueItem = {
        streamId,
        resolve,
        reject,
        timestamp: Date.now(),
        params,
      };

      this.controlQueue.push(queueItem);
      logToFile(
        `缓冲流 ${streamId}: 队列位置 ${this.controlQueue.length}`,
        "DEBUG",
      );

      // 设置超时
      setTimeout(() => {
        const index = this.controlQueue.indexOf(queueItem);
        if (index !== -1) {
          this.controlQueue.splice(index, 1);
          reject(new Error("缓冲超时"));
        }
      }, 30000); // 30秒超时
    });
  }

  async pauseStream(streamId, params) {
    this.statistics.pausedStreams++;
    this.blockedStreams.add(streamId);

    logToFile(`暂停流 ${streamId}: ${params.delay}ms`, "DEBUG");

    await this.sleep(params.delay);
    this.blockedStreams.delete(streamId);

    return await this.allowStream(streamId, { paused: true });
  }

  async allowStream(streamId, metadata = {}) {
    const stream = {
      id: streamId,
      startTime: Date.now(),
      metadata,
      bytes: 0,
      status: "active",
    };

    this.activeStreams.set(streamId, stream);

    // 创建流控制器
    const controller = new StreamController(streamId, this);

    logToFile(`允许流 ${streamId}`, "DEBUG");
    return controller;
  }

  // 流生命周期管理
  streamCompleted(streamId, stats) {
    const stream = this.activeStreams.get(streamId);
    if (stream) {
      const duration = Date.now() - stream.startTime;

      // 更新统计
      this.updateResponseTimeStats(duration);

      this.activeStreams.delete(streamId);
      this.emit("streamCompleted", { streamId, duration, stats });

      // 处理队列中的等待流
      this.processQueuedStreams();
    }
  }

  streamFailed(streamId, error) {
    this.activeStreams.delete(streamId);
    this.blockedStreams.delete(streamId);

    this.emit("streamFailed", { streamId, error });
    this.processQueuedStreams();
  }

  updateResponseTimeStats(duration) {
    this.statistics.avgResponseTime =
      this.statistics.avgResponseTime * 0.9 + duration * 0.1;
  }

  async processQueuedStreams() {
    if (this.controlQueue.length === 0) return;

    const currentPressure = this.monitor.getCurrentPressureState();

    // 如果压力降低，处理队列中的流
    if (
      currentPressure === PRESSURE_STATE.LOW ||
      currentPressure === PRESSURE_STATE.NORMAL
    ) {
      const queueItem = this.controlQueue.shift();
      if (queueItem) {
        try {
          const controller = await this.allowStream(
            queueItem.streamId,
            queueItem.params,
          );
          queueItem.resolve(controller);
        } catch (error) {
          queueItem.reject(error);
        }
      }
    }
  }

  // 压力处理
  handleMemoryPressure(data) {
    logToFile(`内存压力告警: ${(data.level * 100).toFixed(1)}%`, "WARN");

    if (data.level > 0.9) {
      // 高内存压力：暂停新流，减少缓冲区大小
      this.controlState.strategy = CONTROL_STRATEGY.PAUSE;
      this.adjustBufferSizes(0.5);
    } else if (data.level > 0.8) {
      // 中等内存压力：启用限流
      this.controlState.strategy = CONTROL_STRATEGY.THROTTLE;
      this.controlState.adaptiveRate = Math.max(0.3, 1 - data.level);
    }
  }

  handleCpuPressure(data) {
    logToFile(`CPU压力告警: ${(data.level * 100).toFixed(1)}%`, "WARN");

    if (data.level > 0.95) {
      // 极高CPU压力：丢弃低优先级请求
      this.controlState.strategy = CONTROL_STRATEGY.DROP;
    } else if (data.level > 0.9) {
      // 高CPU压力：大幅限流
      this.controlState.adaptiveRate = Math.max(0.2, 1 - data.level);
    }
  }

  adjustBufferSizes(factor) {
    const newHighWaterMark = Math.max(
      this.config.limits.bufferLowWaterMark,
      this.config.limits.bufferHighWaterMark * factor,
    );

    // 通知所有活跃流调整缓冲区大小
    for (const stream of this.activeStreams.values()) {
      this.emit("adjustBuffer", {
        streamId: stream.id,
        newHighWaterMark,
        factor,
      });
    }

    logToFile(
      `调整缓冲区大小: ${newHighWaterMark}字节 (因子: ${factor})`,
      "DEBUG",
    );
  }

  // 自适应控制
  startAdaptiveControl() {
    this.adaptiveTimer = setInterval(() => {
      this.performAdaptiveAdjustment();
    }, this.config.adaptation.adjustmentInterval);
  }

  performAdaptiveControl() {
    const now = Date.now();
    const timeSinceLastAdjustment = now - this.controlState.lastAdjustment;

    if (timeSinceLastAdjustment < this.config.adaptation.adjustmentInterval) {
      return; // 避免过于频繁的调整
    }

    const pressureState = this.monitor.getCurrentPressureState();
    this.adaptControlStrategy(pressureState);

    this.controlState.lastAdjustment = now;
  }

  performAdaptiveAdjustment() {
    const pressureState = this.monitor.getCurrentPressureState();

    // 根据系统状态调整控制策略
    if (
      pressureState === PRESSURE_STATE.LOW ||
      pressureState === PRESSURE_STATE.NORMAL
    ) {
      // 系统压力低，可以放松控制
      this.controlState.adaptiveRate = Math.min(
        1.0,
        this.controlState.adaptiveRate * this.config.adaptation.recoveryFactor,
      );
    } else if (
      pressureState === PRESSURE_STATE.HIGH ||
      pressureState === PRESSURE_STATE.CRITICAL
    ) {
      // 系统压力高，加强控制
      this.controlState.adaptiveRate *=
        1 - this.config.adaptation.aggressiveness;
      this.controlState.adaptiveRate = Math.max(
        0.1,
        this.controlState.adaptiveRate,
      );
    }

    logToFile(
      `自适应调整: 速率=${this.controlState.adaptiveRate.toFixed(2)}, ` +
        `压力=${pressureState}`,
      "DEBUG",
    );
  }

  adaptControlStrategy(pressureState) {
    switch (pressureState) {
      case PRESSURE_STATE.CRITICAL:
        this.controlState.strategy = CONTROL_STRATEGY.DROP;
        break;

      case PRESSURE_STATE.HIGH:
        this.controlState.strategy = CONTROL_STRATEGY.PAUSE;
        break;

      case PRESSURE_STATE.MEDIUM:
        this.controlState.strategy = CONTROL_STRATEGY.THROTTLE;
        break;

      default:
        this.controlState.strategy = CONTROL_STRATEGY.THROTTLE;
        break;
    }
  }

  // 公共接口
  getControllerStatus() {
    return {
      state: this.controlState,
      metrics: this.monitor.getMetrics(),
      statistics: this.statistics,
      activeStreams: this.activeStreams.size,
      queuedStreams: this.controlQueue.length,
      blockedStreams: this.blockedStreams.size,
    };
  }

  getDetailedStats() {
    return {
      controller: this.getControllerStatus(),
      streams: Array.from(this.activeStreams.values()),
      queue: this.controlQueue.map((item) => ({
        streamId: item.streamId,
        waitTime: Date.now() - item.timestamp,
        params: item.params,
      })),
      history: this.monitor.history.slice(-10),
    };
  }

  // 手动控制接口
  setControlStrategy(strategy) {
    this.controlState.strategy = strategy;
    logToFile(`手动设置控制策略: ${strategy}`, "INFO");
  }

  setAdaptiveRate(rate) {
    this.controlState.adaptiveRate = Math.max(0.1, Math.min(1.0, rate));
    logToFile(`手动设置自适应速率: ${this.controlState.adaptiveRate}`, "INFO");
  }

  pauseAllStreams() {
    for (const streamId of this.activeStreams.keys()) {
      this.blockedStreams.add(streamId);
    }
    logToFile("暂停所有活跃流", "WARN");
  }

  resumeAllStreams() {
    this.blockedStreams.clear();
    logToFile("恢复所有流", "INFO");
  }

  // 辅助方法
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// 流控制器类
class StreamController extends EventEmitter {
  constructor(streamId, backpressureController) {
    super();
    this.streamId = streamId;
    this.controller = backpressureController;
    this.isActive = true;
    this.stats = {
      bytesTransferred: 0,
      startTime: Date.now(),
      lastActivity: Date.now(),
    };
  }

  write(data) {
    if (!this.isActive) {
      throw new Error("流已关闭");
    }

    // 检查是否被阻塞
    if (this.controller.blockedStreams.has(this.streamId)) {
      return new Promise((resolve) => {
        const checkBlocked = () => {
          if (!this.controller.blockedStreams.has(this.streamId)) {
            resolve(this.performWrite(data));
          } else {
            setTimeout(checkBlocked, 100);
          }
        };
        checkBlocked();
      });
    }

    return this.performWrite(data);
  }

  performWrite(data) {
    const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
    this.stats.bytesTransferred += size;
    this.stats.lastActivity = Date.now();

    // 更新流状态
    const stream = this.controller.activeStreams.get(this.streamId);
    if (stream) {
      stream.bytes += size;
    }

    this.emit("data", data);
    return Promise.resolve(size);
  }

  async end(data) {
    if (data) {
      await this.write(data);
    }

    this.isActive = false;
    const duration = Date.now() - this.stats.startTime;

    this.controller.streamCompleted(this.streamId, {
      ...this.stats,
      duration,
    });

    this.emit("end");
  }

  destroy(error) {
    this.isActive = false;

    if (error) {
      this.controller.streamFailed(this.streamId, error);
      this.emit("error", error);
    } else {
      this.controller.streamCompleted(this.streamId, this.stats);
    }

    this.emit("close");
  }

  getStats() {
    return {
      ...this.stats,
      isActive: this.isActive,
      isBlocked: this.controller.blockedStreams.has(this.streamId),
    };
  }
}

// 导出
const backpressureController = new BackpressureController();

module.exports = {
  BackpressureController,
  StreamController,
  PRESSURE_STATE,
  CONTROL_STRATEGY,
  backpressureController,
};
