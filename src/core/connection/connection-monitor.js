const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");

// 监控配置
const MONITOR_CONFIG = {
  healthCheck: {
    interval: 15000, // 健康检查间隔（15秒，更频繁）
    timeout: 5000, // 检查超时（5秒）
    retryAttempts: 3, // 重试次数
    retryDelay: 1000, // 重试延迟（1秒）
    // 新增：预警机制
    warningThreshold: 2, // 连续失败2次发出警告
    criticalThreshold: 3, // 连续失败3次标记为危急
  },

  performance: {
    sampleInterval: 10000, // 性能采样间隔（10秒）
    historyLength: 100, // 保留历史记录数量
    alertThresholds: {
      latency: 500, // 延迟告警阈值（毫秒）
      errorRate: 0.05, // 错误率告警阈值（5%）
      throughputDrop: 0.3, // 吞吐量下降告警阈值（30%）
    },
  },

  quality: {
    evaluationInterval: 60000, // 质量评估间隔（1分钟）
    metrics: {
      latency: { weight: 0.3, threshold: 200 },
      throughput: { weight: 0.3, threshold: 1024000 },
      stability: { weight: 0.2, threshold: 0.95 },
      errorRate: { weight: 0.2, threshold: 0.02 },
    },
  },

  // 新增：主动预警配置
  proactive: {
    enabled: true,
    degradationThreshold: 0.7, // 性能下降70%时预警
    latencyIncreaseThreshold: 2.0, // 延迟增加2倍时预警
    predictiveWindow: 5, // 预测窗口（最近5次数据）
  },
};

// 连接状态评级
const CONNECTION_GRADE = {
  EXCELLENT: { score: 90, label: "优秀" },
  GOOD: { score: 70, label: "良好" },
  FAIR: { score: 50, label: "一般" },
  POOR: { score: 30, label: "较差" },
  BAD: { score: 10, label: "糟糕" },
};

// 告警类型
const ALERT_TYPE = {
  HIGH_LATENCY: "high_latency",
  HIGH_ERROR_RATE: "high_error_rate",
  LOW_THROUGHPUT: "low_throughput",
  CONNECTION_UNSTABLE: "connection_unstable",
  HEALTH_CHECK_FAILED: "health_check_failed",
};

class ConnectionMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...MONITOR_CONFIG, ...config };

    // 监控数据存储
    this.connections = new Map(); // 连接监控数据
    this.performanceHistory = new Map(); // 性能历史记录
    this.qualityScores = new Map(); // 连接质量评分
    this.alerts = []; // 告警记录

    // 监控任务
    this.healthCheckTimers = new Map(); // 健康检查定时器
    this.performanceTimer = null; // 性能监控定时器
    this.qualityTimer = null; // 质量评估定时器

    // 统计数据
    this.globalStats = {
      totalChecks: 0,
      failedChecks: 0,
      averageLatency: 0,
      averageThroughput: 0,
      lastUpdated: Date.now(),
    };

    this.isRunning = false;
  }

  async start() {
    if (this.isRunning) {
      return;
    }

    try {
      logToFile("启动连接监控系统...", "INFO");

      // 启动性能监控
      this.startPerformanceMonitoring();

      // 启动质量评估
      this.startQualityEvaluation();

      this.isRunning = true;
      this.emit("started");
      logToFile("连接监控系统已启动", "INFO");
    } catch (error) {
      logToFile(`连接监控系统启动失败: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }

    logToFile("停止连接监控系统...", "INFO");

    // 停止所有定时器
    this.healthCheckTimers.forEach((timer) => clearInterval(timer));
    this.healthCheckTimers.clear();

    if (this.performanceTimer) {
      clearInterval(this.performanceTimer);
      this.performanceTimer = null;
    }

    if (this.qualityTimer) {
      clearInterval(this.qualityTimer);
      this.qualityTimer = null;
    }

    this.isRunning = false;
    this.emit("stopped");
    logToFile("连接监控系统已停止", "INFO");
  }

  // 注册连接监控
  registerConnection(connection) {
    const connectionId = connection.id;

    logToFile(`注册连接监控: ${connectionId}`, "DEBUG");

    const monitorData = {
      id: connectionId,
      connection,
      registeredAt: Date.now(),
      lastHealthCheck: null,
      healthCheckCount: 0,
      healthCheckFailures: 0,

      // 性能指标
      performance: {
        latency: [],
        throughput: [],
        errorCount: 0,
        successCount: 0,
        lastSample: Date.now(),
      },

      // 质量评估
      quality: {
        score: 100,
        grade: CONNECTION_GRADE.EXCELLENT.label,
        factors: {
          latency: 100,
          throughput: 100,
          stability: 100,
          errorRate: 100,
        },
        lastEvaluation: Date.now(),
      },

      // 状态信息
      status: {
        isHealthy: true,
        consecutiveFailures: 0,
        lastError: null,
        uptime: 0,
      },
    };

    this.connections.set(connectionId, monitorData);
    this.performanceHistory.set(connectionId, []);

    // 启动该连接的健康检查
    this.startHealthCheckForConnection(connectionId);

    this.emit("connectionRegistered", { connectionId, monitorData });
  }

  // 注销连接监控
  unregisterConnection(connectionId) {
    logToFile(`注销连接监控: ${connectionId}`, "DEBUG");

    // 停止健康检查
    this.stopHealthCheckForConnection(connectionId);

    // 清理监控数据
    this.connections.delete(connectionId);
    this.performanceHistory.delete(connectionId);
    this.qualityScores.delete(connectionId);

    this.emit("connectionUnregistered", { connectionId });
  }

  // 启动连接健康检查
  startHealthCheckForConnection(connectionId) {
    if (this.healthCheckTimers.has(connectionId)) {
      return; // 已经在运行
    }

    const timer = setInterval(async () => {
      await this.performHealthCheck(connectionId);
    }, this.config.healthCheck.interval);

    this.healthCheckTimers.set(connectionId, timer);
  }

  // 停止连接健康检查
  stopHealthCheckForConnection(connectionId) {
    const timer = this.healthCheckTimers.get(connectionId);
    if (timer) {
      clearInterval(timer);
      this.healthCheckTimers.delete(connectionId);
    }
  }

  // 执行健康检查
  async performHealthCheck(connectionId) {
    const monitorData = this.connections.get(connectionId);
    if (!monitorData) {
      return;
    }

    const startTime = Date.now();
    let isHealthy = false;
    let latency = 0;
    let error = null;

    try {
      // 执行ping测试
      latency = await this.pingConnection(monitorData.connection);
      isHealthy = true;

      monitorData.performance.successCount++;
      monitorData.status.consecutiveFailures = 0;
    } catch (err) {
      error = err;
      isHealthy = false;

      monitorData.performance.errorCount++;
      monitorData.status.consecutiveFailures++;
      monitorData.status.lastError = {
        message: err.message,
        timestamp: Date.now(),
      };

      logToFile(`连接健康检查失败: ${connectionId} - ${err.message}`, "WARN");
    }

    // 更新健康检查统计
    monitorData.healthCheckCount++;
    if (!isHealthy) {
      monitorData.healthCheckFailures++;
    }

    monitorData.lastHealthCheck = {
      timestamp: Date.now(),
      duration: Date.now() - startTime,
      isHealthy,
      latency,
      error: error ? error.message : null,
    };

    monitorData.status.isHealthy = isHealthy;

    // 更新性能数据
    if (isHealthy) {
      this.recordPerformanceMetric(connectionId, "latency", latency);
    }

    // 检查是否需要发出告警
    this.checkHealthAlerts(connectionId, monitorData);

    // 更新全局统计
    this.updateGlobalStats();

    this.emit("healthCheckCompleted", {
      connectionId,
      isHealthy,
      latency,
      error,
    });
  }

  // Ping连接测试
  async pingConnection(connection) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const timeout = setTimeout(() => {
        reject(new Error("Ping超时"));
      }, this.config.healthCheck.timeout);

      try {
        // 执行简单的SSH命令测试连接
        connection.client.exec("echo ping", (err, stream) => {
          clearTimeout(timeout);

          if (err) {
            reject(err);
            return;
          }

          let dataReceived = false;

          stream.on("data", () => {
            dataReceived = true;
            const latency = Date.now() - startTime;
            resolve(latency);
          });

          stream.on("error", (error) => {
            reject(error);
          });

          stream.on("close", () => {
            if (!dataReceived) {
              reject(new Error("未收到响应数据"));
            }
          });
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  }

  // 记录性能指标
  recordPerformanceMetric(connectionId, metricType, value) {
    const monitorData = this.connections.get(connectionId);
    if (!monitorData) {
      return;
    }

    const performance = monitorData.performance;
    const maxHistory = this.config.performance.historyLength;

    // 添加新数据点
    if (!performance[metricType]) {
      performance[metricType] = [];
    }

    performance[metricType].push({
      value,
      timestamp: Date.now(),
    });

    // 保持历史记录长度限制
    if (performance[metricType].length > maxHistory) {
      performance[metricType] = performance[metricType].slice(-maxHistory);
    }

    performance.lastSample = Date.now();

    // 检查性能告警
    this.checkPerformanceAlerts(connectionId, metricType, value);
  }

  // 启动性能监控
  startPerformanceMonitoring() {
    this.performanceTimer = setInterval(() => {
      this.collectPerformanceMetrics();
    }, this.config.performance.sampleInterval);
  }

  // 收集性能指标
  collectPerformanceMetrics() {
    for (const [connectionId, monitorData] of this.connections) {
      const connection = monitorData.connection;

      // 收集吞吐量数据（如果有活跃传输）
      if (connection.activeRequests > 0) {
        this.measureThroughput(connectionId);
      }

      // 更新连接运行时间
      monitorData.status.uptime = Date.now() - monitorData.registeredAt;
    }

    this.emit("performanceMetricsCollected");
  }

  // 测量吞吐量
  async measureThroughput(connectionId) {
    const monitorData = this.connections.get(connectionId);
    if (!monitorData) {
      return;
    }

    try {
      // 简单的吞吐量测试：发送小数据块并计算传输速度
      const testData = Buffer.alloc(1024); // 1KB测试数据
      const startTime = Date.now();

      const connection = monitorData.connection;

      await new Promise((resolve, reject) => {
        connection.client.exec("cat > /dev/null", (err, stream) => {
          if (err) {
            reject(err);
            return;
          }

          stream.write(testData);
          stream.end();

          stream.on("close", () => {
            const duration = (Date.now() - startTime) / 1000; // 转换为秒
            const throughput = testData.length / duration; // 字节/秒

            this.recordPerformanceMetric(
              connectionId,
              "throughput",
              throughput,
            );
            resolve();
          });

          stream.on("error", reject);
        });
      });
    } catch (error) {
      logToFile(`吞吐量测试失败: ${connectionId} - ${error.message}`, "DEBUG");
    }
  }

  // 启动质量评估
  startQualityEvaluation() {
    this.qualityTimer = setInterval(() => {
      this.evaluateConnectionQuality();
    }, this.config.quality.evaluationInterval);
  }

  // 评估连接质量
  evaluateConnectionQuality() {
    for (const [connectionId, monitorData] of this.connections) {
      const quality = this.calculateQualityScore(connectionId, monitorData);
      monitorData.quality = quality;
      this.qualityScores.set(connectionId, quality);

      this.emit("qualityEvaluated", { connectionId, quality });
    }
  }

  // 计算质量评分
  calculateQualityScore(connectionId, monitorData) {
    const metrics = this.config.quality.metrics;
    const performance = monitorData.performance;

    let totalScore = 0;
    let totalWeight = 0;
    const factors = {};

    // 延迟评分
    if (performance.latency.length > 0) {
      const avgLatency = this.calculateAverage(performance.latency);
      const latencyScore = Math.max(
        0,
        100 - (avgLatency / metrics.latency.threshold) * 50,
      );
      factors.latency = Math.round(latencyScore);
      totalScore += latencyScore * metrics.latency.weight;
      totalWeight += metrics.latency.weight;
    }

    // 吞吐量评分
    if (performance.throughput.length > 0) {
      const avgThroughput = this.calculateAverage(performance.throughput);
      const throughputScore = Math.min(
        100,
        (avgThroughput / metrics.throughput.threshold) * 100,
      );
      factors.throughput = Math.round(throughputScore);
      totalScore += throughputScore * metrics.throughput.weight;
      totalWeight += metrics.throughput.weight;
    }

    // 稳定性评分
    const stabilityRate =
      monitorData.healthCheckCount > 0
        ? (monitorData.healthCheckCount - monitorData.healthCheckFailures) /
          monitorData.healthCheckCount
        : 1;
    const stabilityScore = stabilityRate * 100;
    factors.stability = Math.round(stabilityScore);
    totalScore += stabilityScore * metrics.stability.weight;
    totalWeight += metrics.stability.weight;

    // 错误率评分
    const totalRequests = performance.successCount + performance.errorCount;
    const errorRate =
      totalRequests > 0 ? performance.errorCount / totalRequests : 0;
    const errorScore = Math.max(
      0,
      100 - (errorRate / metrics.errorRate.threshold) * 100,
    );
    factors.errorRate = Math.round(errorScore);
    totalScore += errorScore * metrics.errorRate.weight;
    totalWeight += metrics.errorRate.weight;

    // 计算最终评分
    const finalScore =
      totalWeight > 0 ? Math.round(totalScore / totalWeight) : 100;

    // 确定等级
    let grade = CONNECTION_GRADE.BAD.label;
    if (finalScore >= CONNECTION_GRADE.EXCELLENT.score) {
      grade = CONNECTION_GRADE.EXCELLENT.label;
    } else if (finalScore >= CONNECTION_GRADE.GOOD.score) {
      grade = CONNECTION_GRADE.GOOD.label;
    } else if (finalScore >= CONNECTION_GRADE.FAIR.score) {
      grade = CONNECTION_GRADE.FAIR.label;
    } else if (finalScore >= CONNECTION_GRADE.POOR.score) {
      grade = CONNECTION_GRADE.POOR.label;
    }

    return {
      score: finalScore,
      grade,
      factors,
      lastEvaluation: Date.now(),
    };
  }

  // 检查健康告警
  checkHealthAlerts(connectionId, monitorData) {
    const consecutiveFailures = monitorData.status.consecutiveFailures;

    // 预警：连续失败2次
    if (
      consecutiveFailures >= this.config.healthCheck.warningThreshold &&
      consecutiveFailures < this.config.healthCheck.criticalThreshold
    ) {
      this.createAlert(
        connectionId,
        ALERT_TYPE.HEALTH_CHECK_FAILED,
        `连续${consecutiveFailures}次健康检查失败 (预警)`,
        "WARNING",
      );
    }

    // 危急：连续失败3次及以上
    if (consecutiveFailures >= this.config.healthCheck.criticalThreshold) {
      this.createAlert(
        connectionId,
        ALERT_TYPE.HEALTH_CHECK_FAILED,
        `连续${consecutiveFailures}次健康检查失败 (危急)`,
        "CRITICAL",
      );
    }

    // 连接不稳定告警
    if (monitorData.healthCheckCount >= 10) {
      const failureRate =
        monitorData.healthCheckFailures / monitorData.healthCheckCount;
      if (failureRate > 0.3) {
        this.createAlert(
          connectionId,
          ALERT_TYPE.CONNECTION_UNSTABLE,
          `连接不稳定，失败率: ${(failureRate * 100).toFixed(1)}%`,
          "WARNING",
        );
      }
    }

    // 新增：主动预警 - 性能下降趋势检测
    if (this.config.proactive.enabled) {
      this.checkProactiveDegradation(connectionId, monitorData);
    }
  }

  // 新增：主动检测性能下降趋势
  checkProactiveDegradation(connectionId, monitorData) {
    const latencyHistory = monitorData.performance.latency;
    if (latencyHistory.length < this.config.proactive.predictiveWindow * 2) {
      return; // 数据不足
    }

    const windowSize = this.config.proactive.predictiveWindow;
    const recentLatency = latencyHistory.slice(-windowSize);
    const historicalLatency = latencyHistory.slice(
      -windowSize * 2,
      -windowSize,
    );

    const recentAvg = this.calculateAverage(recentLatency);
    const historicalAvg = this.calculateAverage(historicalLatency);

    // 检测延迟增加趋势
    if (
      historicalAvg > 0 &&
      recentAvg / historicalAvg >=
        this.config.proactive.latencyIncreaseThreshold
    ) {
      this.createAlert(
        connectionId,
        ALERT_TYPE.HIGH_LATENCY,
        `延迟显著增加 (${historicalAvg.toFixed(0)}ms → ${recentAvg.toFixed(0)}ms)，可能即将断开`,
        "WARNING",
      );
      logToFile(
        `主动预警: 连接 ${connectionId} 延迟增加趋势明显，建议提前重连`,
        "WARN",
      );
    }

    // 检测吞吐量下降趋势
    const throughputHistory = monitorData.performance.throughput;
    if (throughputHistory.length >= windowSize * 2) {
      const recentThroughput = throughputHistory.slice(-windowSize);
      const historicalThroughput = throughputHistory.slice(
        -windowSize * 2,
        -windowSize,
      );

      const recentThroughputAvg = this.calculateAverage(recentThroughput);
      const historicalThroughputAvg =
        this.calculateAverage(historicalThroughput);

      if (
        historicalThroughputAvg > 0 &&
        recentThroughputAvg / historicalThroughputAvg <=
          this.config.proactive.degradationThreshold
      ) {
        this.createAlert(
          connectionId,
          ALERT_TYPE.LOW_THROUGHPUT,
          `吞吐量显著下降 (${(historicalThroughputAvg / 1024).toFixed(1)}KB/s → ${(recentThroughputAvg / 1024).toFixed(1)}KB/s)`,
          "WARNING",
        );
      }
    }
  }

  // 检查性能告警
  checkPerformanceAlerts(connectionId, metricType, value) {
    const thresholds = this.config.performance.alertThresholds;

    switch (metricType) {
      case "latency":
        if (value > thresholds.latency) {
          this.createAlert(
            connectionId,
            ALERT_TYPE.HIGH_LATENCY,
            `延迟过高: ${value}ms`,
            "WARNING",
          );
        }
        break;

      case "throughput": {
        // 检查吞吐量下降
        const monitorData = this.connections.get(connectionId);
        if (monitorData && monitorData.performance.throughput.length > 5) {
          const recentThroughput = this.calculateAverage(
            monitorData.performance.throughput.slice(-5),
          );
          const historicalThroughput = this.calculateAverage(
            monitorData.performance.throughput.slice(0, -5),
          );

          if (historicalThroughput > 0) {
            const dropRate =
              (historicalThroughput - recentThroughput) / historicalThroughput;
            if (dropRate > thresholds.throughputDrop) {
              this.createAlert(
                connectionId,
                ALERT_TYPE.LOW_THROUGHPUT,
                `吞吐量下降${(dropRate * 100).toFixed(1)}%`,
                "WARNING",
              );
            }
          }
        }
        break;
      }
    }
  }

  // 创建告警
  createAlert(connectionId, type, message, severity = "INFO") {
    const alert = {
      id: `${connectionId}-${type}-${Date.now()}`,
      connectionId,
      type,
      message,
      severity,
      timestamp: Date.now(),
      acknowledged: false,
    };

    this.alerts.push(alert);

    // 保持告警记录数量限制
    if (this.alerts.length > 1000) {
      this.alerts = this.alerts.slice(-500);
    }

    logToFile(`连接告警 [${severity}]: ${message} (${connectionId})`, severity);
    this.emit("alertCreated", alert);

    return alert;
  }

  // 更新全局统计
  updateGlobalStats() {
    let totalChecks = 0;
    let failedChecks = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let totalThroughput = 0;
    let throughputCount = 0;

    for (const monitorData of this.connections.values()) {
      totalChecks += monitorData.healthCheckCount;
      failedChecks += monitorData.healthCheckFailures;

      // 计算平均延迟
      if (monitorData.performance.latency.length > 0) {
        const avgLatency = this.calculateAverage(
          monitorData.performance.latency,
        );
        totalLatency += avgLatency;
        latencyCount++;
      }

      // 计算平均吞吐量
      if (monitorData.performance.throughput.length > 0) {
        const avgThroughput = this.calculateAverage(
          monitorData.performance.throughput,
        );
        totalThroughput += avgThroughput;
        throughputCount++;
      }
    }

    this.globalStats = {
      totalChecks,
      failedChecks,
      averageLatency:
        latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      averageThroughput:
        throughputCount > 0 ? Math.round(totalThroughput / throughputCount) : 0,
      successRate:
        totalChecks > 0
          ? (((totalChecks - failedChecks) / totalChecks) * 100).toFixed(2)
          : 100,
      lastUpdated: Date.now(),
    };
  }

  // 计算平均值
  calculateAverage(dataPoints) {
    if (!Array.isArray(dataPoints) || dataPoints.length === 0) {
      return 0;
    }

    const sum = dataPoints.reduce((total, point) => {
      return total + (typeof point === "object" ? point.value : point);
    }, 0);

    return sum / dataPoints.length;
  }

  // 公共接口方法
  getConnectionStatus(connectionId) {
    const monitorData = this.connections.get(connectionId);
    if (!monitorData) {
      return null;
    }

    return {
      id: connectionId,
      isHealthy: monitorData.status.isHealthy,
      quality: monitorData.quality,
      lastHealthCheck: monitorData.lastHealthCheck,
      performance: {
        averageLatency: this.calculateAverage(monitorData.performance.latency),
        averageThroughput: this.calculateAverage(
          monitorData.performance.throughput,
        ),
        successRate:
          (monitorData.performance.successCount /
            (monitorData.performance.successCount +
              monitorData.performance.errorCount)) *
          100,
        uptime: monitorData.status.uptime,
      },
      alerts: this.alerts.filter(
        (alert) => alert.connectionId === connectionId && !alert.acknowledged,
      ),
    };
  }

  getAllConnectionsStatus() {
    return Array.from(this.connections.keys()).map((id) =>
      this.getConnectionStatus(id),
    );
  }

  getGlobalStats() {
    return {
      ...this.globalStats,
      totalConnections: this.connections.size,
      healthyConnections: Array.from(this.connections.values()).filter(
        (data) => data.status.isHealthy,
      ).length,
      pendingAlerts: this.alerts.filter((alert) => !alert.acknowledged).length,
    };
  }

  getAlerts(limit = 50, acknowledged = false) {
    return this.alerts
      .filter((alert) => alert.acknowledged === acknowledged)
      .slice(-limit)
      .reverse();
  }

  acknowledgeAlert(alertId) {
    const alert = this.alerts.find((a) => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = Date.now();
      this.emit("alertAcknowledged", alert);
      return true;
    }
    return false;
  }

  // 导出监控报告
  generateReport() {
    const connections = this.getAllConnectionsStatus();
    const globalStats = this.getGlobalStats();
    const recentAlerts = this.getAlerts(20);

    return {
      generatedAt: Date.now(),
      summary: globalStats,
      connections: connections.map((conn) => ({
        id: conn.id,
        isHealthy: conn.isHealthy,
        quality: conn.quality,
        performance: conn.performance,
      })),
      topIssues: recentAlerts.slice(0, 10),
      recommendations: this.generateRecommendations(connections),
    };
  }

  // 生成优化建议
  generateRecommendations(connections) {
    const recommendations = [];

    // 检查高延迟连接
    const highLatencyConnections = connections.filter(
      (conn) =>
        conn.performance.averageLatency >
        this.config.performance.alertThresholds.latency,
    );

    if (highLatencyConnections.length > 0) {
      recommendations.push({
        type: "performance",
        priority: "medium",
        message: `${highLatencyConnections.length}个连接延迟过高，建议检查网络状况`,
      });
    }

    // 检查不稳定连接
    const unstableConnections = connections.filter(
      (conn) => conn.performance.successRate < 95,
    );

    if (unstableConnections.length > 0) {
      recommendations.push({
        type: "stability",
        priority: "high",
        message: `${unstableConnections.length}个连接不稳定，建议重建连接`,
      });
    }

    // 检查低质量连接
    const lowQualityConnections = connections.filter(
      (conn) => conn.quality.score < CONNECTION_GRADE.FAIR.score,
    );

    if (lowQualityConnections.length > 0) {
      recommendations.push({
        type: "quality",
        priority: "medium",
        message: `${lowQualityConnections.length}个连接质量较差，建议优化配置`,
      });
    }

    return recommendations;
  }
}

module.exports = ConnectionMonitor;
