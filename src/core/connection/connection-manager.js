const { EventEmitter } = require("events");
const SSHPool = require("./ssh-pool");
const { logToFile } = require("../utils/logger");

// 连接管理器配置
const MANAGER_CONFIG = {
  poolConfig: {
    maxConnections: 50, // 全局最大连接数
    defaultPoolSize: 10, // 默认服务器连接池大小
    failoverTimeout: 5000, // 故障转移超时
    healthCheckInterval: 20000, // 健康检查间隔
  },

  clustering: {
    enabled: false, // 是否启用集群模式
    nodes: [], // 集群节点列表
    loadBalanceStrategy: "roundRobin", // 负载均衡策略
  },

  monitoring: {
    metricsRetention: 3600000, // 指标保留时间（1小时）
    performanceThreshold: {
      maxLatency: 1000, // 最大延迟（毫秒）
      maxErrorRate: 0.1, // 最大错误率（10%）
      minThroughput: 1024, // 最小吞吐量（字节/秒）
    },
  },
};

// 连接池状态
const POOL_STATE = {
  INITIALIZING: "initializing",
  ACTIVE: "active",
  DEGRADED: "degraded",
  FAILING: "failing",
  SHUTDOWN: "shutdown",
};

class ConnectionManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...MANAGER_CONFIG, ...config };

    // 连接池管理
    this.pools = new Map(); // 服务器连接池
    this.poolStates = new Map(); // 连接池状态
    this.poolMetrics = new Map(); // 连接池性能指标

    // 全局连接路由
    this.connectionRouter = new Map(); // 连接ID到池的映射
    this.sessionManager = new Map(); // 会话管理

    // 故障转移和恢复
    this.failoverManager = null;
    this.recoveryStrategies = new Map();

    // 性能监控
    this.performanceMonitor = null;
    this.alertManager = null;

    // 状态管理
    this.isInitialized = false;
    this.globalState = POOL_STATE.INITIALIZING;

    this.initializeComponents();
  }

  initializeComponents() {
    // 初始化故障转移管理器
    this.failoverManager = {
      activeFailovers: new Map(),
      failoverHistory: [],

      async executeFailover(serverKey, reason) {
        const startTime = Date.now();
        logToFile(`开始故障转移: ${serverKey} - ${reason}`, "WARN");

        try {
          // 1. 标记当前池为故障状态
          this.setPoolState(serverKey, POOL_STATE.FAILING);

          // 2. 获取该池的所有活跃连接
          const pool = this.pools.get(serverKey);
          const activeConnections = pool ? pool.getConnectionDetails() : [];

          // 3. 迁移活跃连接到备用池
          await this.migrateActiveConnections(activeConnections);

          // 4. 关闭故障池
          if (pool) {
            await pool.shutdown();
            this.pools.delete(serverKey);
          }

          // 5. 记录故障转移历史
          const duration = Date.now() - startTime;
          this.failoverHistory.push({
            serverKey,
            reason,
            timestamp: startTime,
            duration,
            success: true,
          });

          logToFile(`故障转移完成: ${serverKey}, 耗时: ${duration}ms`, "INFO");
          this.emit("failoverCompleted", { serverKey, duration });
        } catch (error) {
          logToFile(`故障转移失败: ${serverKey} - ${error.message}`, "ERROR");
          this.emit("failoverFailed", { serverKey, error });
        }
      },

      async migrateActiveConnections(connections) {
        const migrationPromises = connections
          .filter((conn) => conn.activeRequests > 0)
          .map((conn) => this.createAlternativeConnection(conn));

        await Promise.allSettled(migrationPromises);
      },
    };

    // 初始化性能监控器
    this.performanceMonitor = {
      metrics: new Map(),
      alerts: [],

      collectMetrics() {
        const globalMetrics = {
          totalPools: this.pools.size,
          totalConnections: 0,
          activeConnections: 0,
          queuedRequests: 0,
          totalThroughput: 0,
          avgLatency: 0,
          errorRate: 0,
        };

        // 聚合所有池的指标
        for (const pool of this.pools.values()) {
          const status = pool.getPoolStatus();
          const details = pool.getConnectionDetails();

          globalMetrics.totalConnections += status.totalConnections;
          globalMetrics.activeConnections += status.activeConnections;
          globalMetrics.queuedRequests += status.queueLength;

          // 计算平均延迟和错误率
          const latencies = details
            .map((conn) => conn.quality?.latency)
            .filter((lat) => lat != null);

          if (latencies.length > 0) {
            const avgLatency =
              latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
            globalMetrics.avgLatency =
              (globalMetrics.avgLatency + avgLatency) / 2;
          }

          const errorRate =
            details.reduce((sum, conn) => sum + conn.errors, 0) /
            Math.max(
              details.reduce((sum, conn) => sum + conn.totalRequests, 0),
              1,
            );
          globalMetrics.errorRate = Math.max(
            globalMetrics.errorRate,
            errorRate,
          );
        }

        this.metrics.set("global", {
          ...globalMetrics,
          timestamp: Date.now(),
        });

        return globalMetrics;
      },

      checkThresholds(metrics) {
        const alerts = [];
        const thresholds = this.config.monitoring.performanceThreshold;

        if (metrics.avgLatency > thresholds.maxLatency) {
          alerts.push({
            type: "HIGH_LATENCY",
            message: `平均延迟过高: ${metrics.avgLatency}ms`,
            severity: "WARNING",
            timestamp: Date.now(),
          });
        }

        if (metrics.errorRate > thresholds.maxErrorRate) {
          alerts.push({
            type: "HIGH_ERROR_RATE",
            message: `错误率过高: ${(metrics.errorRate * 100).toFixed(2)}%`,
            severity: "CRITICAL",
            timestamp: Date.now(),
          });
        }

        return alerts;
      },
    };

    // 初始化恢复策略
    this.recoveryStrategies.set("connection_timeout", {
      name: "连接超时恢复",
      execute: async (serverKey) => {
        const pool = this.pools.get(serverKey);
        if (pool) {
          // 清理超时连接，创建新连接
          await this.recreatePool(serverKey);
        }
      },
    });

    this.recoveryStrategies.set("high_error_rate", {
      name: "高错误率恢复",
      execute: async (serverKey) => {
        // 减少并发连接数，逐步恢复
        await this.scaleDownPool(serverKey, 0.5);
        setTimeout(() => {
          this.scaleUpPool(serverKey, 1.0);
        }, 30000);
      },
    });
  }

  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      logToFile("初始化连接管理器...", "INFO");

      // 启动性能监控
      this.startPerformanceMonitoring();

      this.isInitialized = true;
      this.globalState = POOL_STATE.ACTIVE;

      this.emit("initialized");
      logToFile("连接管理器初始化完成", "INFO");
    } catch (error) {
      logToFile(`连接管理器初始化失败: ${error.message}`, "ERROR");
      this.globalState = POOL_STATE.FAILING;
      throw error;
    }
  }

  async getConnection(sshConfig, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const serverKey = this.generateServerKey(sshConfig);

    try {
      // 1. 获取或创建连接池
      let pool = await this.getOrCreatePool(serverKey);

      // 2. 检查池状态
      const poolState = this.poolStates.get(serverKey);
      if (poolState === POOL_STATE.FAILING) {
        throw new Error(`连接池故障: ${serverKey}`);
      }

      // 3. 从池中获取连接
      const connection = await pool.getConnection(sshConfig, options);

      // 4. 注册连接路由
      this.connectionRouter.set(connection.id, serverKey);

      // 5. 更新会话管理
      if (options.sessionId) {
        this.sessionManager.set(options.sessionId, connection.id);
      }

      logToFile(`分配连接: ${connection.id} -> ${serverKey}`, "DEBUG");
      return connection;
    } catch (error) {
      logToFile(`获取连接失败: ${serverKey} - ${error.message}`, "ERROR");

      // 尝试故障转移
      if (this.shouldTriggerFailover(serverKey, error)) {
        await this.failoverManager.executeFailover(serverKey, error.message);

        // 重试获取连接
        if (options.retryOnFailover !== false) {
          return await this.getConnection(sshConfig, {
            ...options,
            retryOnFailover: false,
          });
        }
      }

      throw error;
    }
  }

  async getOrCreatePool(serverKey) {
    let pool = this.pools.get(serverKey);

    if (!pool) {
      logToFile(`创建新连接池: ${serverKey}`, "INFO");

      const poolConfig = {
        ...this.config.poolConfig,
        maxConnections: this.config.poolConfig.maxConnections, // 统一使用全局maxConnections
      };

      pool = new SSHPool(poolConfig);

      // 监听池事件
      this.setupPoolEventListeners(pool, serverKey);

      await pool.initialize();

      this.pools.set(serverKey, pool);
      this.poolStates.set(serverKey, POOL_STATE.ACTIVE);
      this.poolMetrics.set(serverKey, {
        createdAt: Date.now(),
        requests: 0,
        errors: 0,
      });

      this.emit("poolCreated", { serverKey, pool });
    }

    return pool;
  }

  setupPoolEventListeners(pool, serverKey) {
    pool.on("connectionCreated", (connection) => {
      this.emit("connectionCreated", { serverKey, connection });
    });

    pool.on("connectionClosed", (connection) => {
      this.connectionRouter.delete(connection.id);
      this.emit("connectionClosed", { serverKey, connection });
    });

    pool.on("error", (error) => {
      logToFile(`连接池错误: ${serverKey} - ${error.message}`, "ERROR");
      this.handlePoolError(serverKey, error);
    });
  }

  releaseConnection(connectionId, sessionId = null) {
    const serverKey = this.connectionRouter.get(connectionId);
    if (!serverKey) {
      logToFile(`未找到连接路由: ${connectionId}`, "WARN");
      return;
    }

    const pool = this.pools.get(serverKey);
    if (pool) {
      pool.releaseConnection(connectionId);
    }

    // 清理会话管理
    if (sessionId) {
      this.sessionManager.delete(sessionId);
    }

    logToFile(`释放连接: ${connectionId} <- ${serverKey}`, "DEBUG");
  }

  async recreatePool(serverKey) {
    logToFile(`重建连接池: ${serverKey}`, "INFO");

    // 关闭旧池
    const oldPool = this.pools.get(serverKey);
    if (oldPool) {
      await oldPool.shutdown();
    }

    // 创建新池
    this.pools.delete(serverKey);
    this.poolStates.delete(serverKey);

    await this.getOrCreatePool(serverKey);
  }

  async scaleDownPool(serverKey, factor) {
    const pool = this.pools.get(serverKey);
    if (!pool) return;

    logToFile(`缩减连接池: ${serverKey}, 因子: ${factor}`, "INFO");

    // 实现连接池缩减逻辑
    const currentConfig = pool.config;
    const newMaxConnections = Math.max(
      1,
      Math.floor(currentConfig.maxConnections * factor),
    );

    // 这里需要池支持动态调整大小
    // 暂时通过关闭多余连接实现
    const status = pool.getPoolStatus();
    const excessConnections = status.totalConnections - newMaxConnections;

    if (excessConnections > 0) {
      const connections = pool
        .getConnectionDetails()
        .filter((conn) => conn.state === "idle")
        .slice(0, excessConnections);

      for (const conn of connections) {
        pool.closeConnection(conn.id);
      }
    }
  }

  async scaleUpPool(serverKey, factor) {
    logToFile(`扩展连接池: ${serverKey}, 因子: ${factor}`, "INFO");
    // 扩展逻辑 - 连接池会根据需求自动创建新连接
  }

  shouldTriggerFailover(serverKey, error) {
    // 判断是否应该触发故障转移
    const errorPatterns = [
      /connection timeout/i,
      /network unreachable/i,
      /connection refused/i,
      /host unreachable/i,
    ];

    return errorPatterns.some((pattern) => pattern.test(error.message));
  }

  async handlePoolError(serverKey, error) {
    const metrics = this.poolMetrics.get(serverKey);
    if (metrics) {
      metrics.errors++;
    }

    // 根据错误类型选择恢复策略
    let strategyKey = "connection_timeout";
    if (error.message.includes("error rate")) {
      strategyKey = "high_error_rate";
    }

    const strategy = this.recoveryStrategies.get(strategyKey);
    if (strategy) {
      logToFile(`执行恢复策略: ${strategy.name}`, "INFO");
      try {
        await strategy.execute(serverKey, { error });
      } catch (recoveryError) {
        logToFile(`恢复策略执行失败: ${recoveryError.message}`, "ERROR");
      }
    }
  }

  async createAlternativeConnection(originalConnection) {
    // 为故障转移创建替代连接
    try {
      const config = originalConnection.config;
      const newConnection = await this.getConnection(config, {
        priority: "high",
        sessionId: `failover_${originalConnection.id}`,
      });

      logToFile(
        `创建替代连接: ${originalConnection.id} -> ${newConnection.id}`,
        "INFO",
      );
      return newConnection;
    } catch (error) {
      logToFile(`创建替代连接失败: ${error.message}`, "ERROR");
      throw error;
    }
  }

  setPoolState(serverKey, state) {
    const oldState = this.poolStates.get(serverKey);
    this.poolStates.set(serverKey, state);

    if (oldState !== state) {
      logToFile(`连接池状态变更: ${serverKey} ${oldState} -> ${state}`, "INFO");
      this.emit("poolStateChanged", { serverKey, oldState, newState: state });
    }
  }

  startPerformanceMonitoring() {
    // 定期收集性能指标
    const monitoringInterval = setInterval(() => {
      try {
        const metrics = this.performanceMonitor.collectMetrics();
        const alerts = this.performanceMonitor.checkThresholds(metrics);

        if (alerts.length > 0) {
          for (const alert of alerts) {
            logToFile(`性能告警: ${alert.message}`, alert.severity);
            this.emit("performanceAlert", alert);
          }
        }

        this.emit("metricsCollected", metrics);
      } catch (error) {
        logToFile(`性能监控错误: ${error.message}`, "ERROR");
      }
    }, this.config.monitoring.metricsRetention / 60); // 每分钟收集一次

    // 清理过期指标
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      const retention = this.config.monitoring.metricsRetention;

      for (const [key, metric] of this.performanceMonitor.metrics) {
        if (now - metric.timestamp > retention) {
          this.performanceMonitor.metrics.delete(key);
        }
      }
    }, this.config.monitoring.metricsRetention);

    // 保存定时器引用以便清理
    this.monitoringTimers = { monitoringInterval, cleanupInterval };
  }

  // 公共接口方法
  getGlobalStatus() {
    const pools = Array.from(this.pools.entries()).map(([serverKey, pool]) => {
      const status = pool.getPoolStatus();
      const state = this.poolStates.get(serverKey);
      const metrics = this.poolMetrics.get(serverKey);

      return {
        serverKey,
        state,
        ...status,
        metrics,
      };
    });

    return {
      globalState: this.globalState,
      totalPools: this.pools.size,
      totalConnections: pools.reduce(
        (sum, pool) => sum + pool.totalConnections,
        0,
      ),
      activeConnections: pools.reduce(
        (sum, pool) => sum + pool.activeConnections,
        0,
      ),
      pools,
      failoverHistory: this.failoverManager.failoverHistory.slice(-10), // 最近10次故障转移
    };
  }

  getDetailedMetrics() {
    return {
      globalMetrics: this.performanceMonitor.metrics.get("global"),
      poolMetrics: Array.from(this.poolMetrics.entries()),
      connectionRoutes: this.connectionRouter.size,
      activeSessions: this.sessionManager.size,
      performanceAlerts: this.performanceMonitor.alerts.slice(-20), // 最近20个告警
    };
  }

  async shutdown() {
    logToFile("开始关闭连接管理器...", "INFO");

    this.globalState = POOL_STATE.SHUTDOWN;

    // 停止性能监控
    if (this.monitoringTimers) {
      clearInterval(this.monitoringTimers.monitoringInterval);
      clearInterval(this.monitoringTimers.cleanupInterval);
    }

    // 关闭所有连接池
    const shutdownPromises = Array.from(this.pools.values()).map((pool) =>
      pool.shutdown(),
    );
    await Promise.all(shutdownPromises);

    // 清理状态
    this.pools.clear();
    this.poolStates.clear();
    this.poolMetrics.clear();
    this.connectionRouter.clear();
    this.sessionManager.clear();

    this.isInitialized = false;
    this.emit("shutdown");
    logToFile("连接管理器已关闭", "INFO");
  }

  // 辅助方法
  generateServerKey(sshConfig) {
    return `${sshConfig.host}:${sshConfig.port || 22}:${sshConfig.username}`;
  }
}

// 导出单例实例
const connectionManager = new ConnectionManager();

module.exports = connectionManager;
