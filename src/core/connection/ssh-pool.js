const { EventEmitter } = require("events");
const Client = require("ssh2").Client;
const { logToFile } = require("../utils/logger");
const { getBasicSSHAlgorithms } = require("../../constants/sshAlgorithms");

// 连接池配置
const DEFAULT_CONFIG = {
  maxConnections: 30, // 最大连接数
  minConnections: 5, // 最小连接数
  idleTimeout: 15 * 60 * 1000, // 空闲超时（15分钟）
  connectionTimeout: 10 * 1000, // 连接超时（10秒）
  healthCheckInterval: 30 * 1000, // 健康检查间隔（30秒）
  maxRetries: 3, // 最大重试次数
  retryDelay: 1000, // 重试延迟（1秒）
  connectionQuality: {
    latencyThreshold: 200, // 延迟阈值（毫秒）
    errorRateThreshold: 0.05, // 错误率阈值（5%）
    timeWindow: 60 * 1000, // 统计时间窗口（1分钟）
  },
};

// 连接状态枚举
const CONNECTION_STATE = {
  IDLE: "idle",
  ACTIVE: "active",
  BUSY: "busy",
  ERROR: "error",
  DISCONNECTED: "disconnected",
  RECONNECTING: "reconnecting",
};

// 连接质量评分
const QUALITY_SCORE = {
  EXCELLENT: 100,
  GOOD: 80,
  FAIR: 60,
  POOR: 40,
  BAD: 20,
};

class SSHPool extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 连接存储
    this.connections = new Map(); // 所有连接
    this.activeConnections = new Map(); // 活跃连接
    this.idleConnections = new Set(); // 空闲连接
    this.busyConnections = new Set(); // 繁忙连接

    // 路由和负载均衡
    this.serverPools = new Map(); // 按服务器分组的连接池
    this.connectionRoutes = new Map(); // 连接路由表
    this.loadBalancer = null;

    // 性能监控
    this.healthMonitor = null;
    this.performanceMetrics = new Map();
    this.connectionQuality = new Map();

    // 队列管理
    this.requestQueue = []; // 连接请求队列
    this.isProcessingQueue = false;

    // 定时器
    this.healthCheckTimer = null;
    this.cleanupTimer = null;

    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // 初始化负载均衡器
      this.initializeLoadBalancer();

      // 初始化健康监控
      this.initializeHealthMonitor();

      // 启动定时任务
      this.startTimers();

      this.isInitialized = true;
      this.emit("initialized");
      logToFile("高级SSH连接池已初始化", "INFO");
    } catch (error) {
      logToFile(`SSH连接池初始化失败: ${error.message}`, "ERROR");
      throw error;
    }
  }

  initializeLoadBalancer() {
    this.loadBalancer = {
      // 轮询算法
      roundRobin: (connections) => {
        if (connections.length === 0) return null;
        const sorted = [...connections].sort((a, b) => a.lastUsed - b.lastUsed);
        return sorted[0];
      },

      // 最少连接算法
      leastConnections: (connections) => {
        if (connections.length === 0) return null;
        return [...connections].reduce((min, conn) =>
          conn.activeRequests < min.activeRequests ? conn : min,
        );
      },

      // 响应时间加权算法
      responseTimeWeighted: (connections) => {
        if (connections.length === 0) return null;

        const scored = connections.map((conn) => {
          const quality = this.connectionQuality.get(conn.id) || {};
          const score = this.calculateQualityScore(quality);
          return { connection: conn, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored[0]?.connection || null;
      },
    };
  }

  initializeHealthMonitor() {
    this.healthMonitor = {
      // 连接延迟测试
      pingConnection: async (connection) => {
        const startTime = Date.now();
        try {
          await new Promise((resolve, reject) => {
            connection.client.exec("echo ping", (err, stream) => {
              if (err) return reject(err);

              stream
                .on("data", () => {
                  resolve();
                })
                .on("error", reject)
                .on("close", resolve);
            });
          });

          const latency = Date.now() - startTime;
          this.updateConnectionQuality(connection.id, { latency });
          return latency;
        } catch (error) {
          this.updateConnectionQuality(connection.id, { error: true });
          throw error;
        }
      },

      // 连接吞吐量测试
      throughputTest: async (connection) => {
        const testData = Buffer.alloc(1024); // 1KB测试数据
        const startTime = Date.now();

        try {
          await new Promise((resolve, reject) => {
            connection.client.exec(`cat > /dev/null`, (err, stream) => {
              if (err) return reject(err);

              stream.write(testData);
              stream.end();
              stream.on("close", resolve).on("error", reject);
            });
          });

          const duration = Date.now() - startTime;
          const throughput = testData.length / (duration / 1000); // 字节/秒

          this.updateConnectionQuality(connection.id, { throughput });
          return throughput;
        } catch (error) {
          this.updateConnectionQuality(connection.id, { error: true });
          throw error;
        }
      },
    };
  }

  async getConnection(sshConfig, options = {}) {
    const serverKey = this.generateServerKey(sshConfig);
    const strategy = options.strategy || "responseTimeWeighted";

    try {
      // 1. 尝试获取现有空闲连接
      const availableConnection = await this.findAvailableConnection(
        serverKey,
        strategy,
      );
      if (availableConnection) {
        return this.assignConnection(availableConnection);
      }

      // 2. 检查是否可以创建新连接
      if (this.canCreateNewConnection(serverKey)) {
        return await this.createNewConnection(sshConfig, serverKey);
      }

      // 3. 加入等待队列
      return await this.queueConnectionRequest(sshConfig, serverKey, options);
    } catch (error) {
      logToFile(`获取连接失败: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async findAvailableConnection(serverKey, strategy) {
    const serverPool = this.serverPools.get(serverKey);
    if (!serverPool || serverPool.size === 0) {
      return null;
    }

    // 过滤出可用连接
    const availableConnections = Array.from(serverPool)
      .map((id) => this.connections.get(id))
      .filter(
        (conn) =>
          conn &&
          conn.state === CONNECTION_STATE.IDLE &&
          this.isConnectionHealthy(conn),
      );

    if (availableConnections.length === 0) {
      return null;
    }

    // 使用负载均衡策略选择连接
    return this.loadBalancer[strategy](availableConnections);
  }

  canCreateNewConnection(serverKey) {
    const totalConnections = this.connections.size;
    const serverPool = this.serverPools.get(serverKey);
    const serverConnections = serverPool ? serverPool.size : 0;

    // 检查全局和服务器级别的连接限制
    return (
      totalConnections < this.config.maxConnections &&
      serverConnections < Math.ceil(this.config.maxConnections / 2)
    );
  }

  async createNewConnection(sshConfig, serverKey) {
    const connectionId = this.generateConnectionId(sshConfig);

    logToFile(`创建新连接: ${connectionId}`, "INFO");

    const connection = {
      id: connectionId,
      serverKey,
      client: null,
      config: sshConfig,
      state: CONNECTION_STATE.DISCONNECTED,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      activeRequests: 0,
      totalRequests: 0,
      errors: 0,
      retryCount: 0,
    };

    try {
      await this.establishConnection(connection);
      this.registerConnection(connection);
      return this.assignConnection(connection);
    } catch (error) {
      logToFile(`连接建立失败: ${connectionId} - ${error.message}`, "ERROR");

      // 重试逻辑
      if (connection.retryCount < this.config.maxRetries) {
        connection.retryCount++;
        setTimeout(() => {
          this.createNewConnection(sshConfig, serverKey);
        }, this.config.retryDelay * connection.retryCount);
      }

      throw error;
    }
  }

  async establishConnection(connection) {
    return new Promise((resolve, reject) => {
      const ssh = new Client();
      connection.client = ssh;
      connection.state = CONNECTION_STATE.RECONNECTING;

      const timeout = setTimeout(() => {
        connection.state = CONNECTION_STATE.ERROR;
        reject(new Error("连接超时"));
      }, this.config.connectionTimeout);

      ssh.on("ready", () => {
        clearTimeout(timeout);
        connection.state = CONNECTION_STATE.IDLE;
        logToFile(`SSH连接建立成功: ${connection.id}`, "INFO");
        resolve(connection);
      });

      ssh.on("error", (err) => {
        clearTimeout(timeout);
        connection.state = CONNECTION_STATE.ERROR;
        connection.errors++;

        // 增强错误信息
        let errorMessage = err.message;
        if (
          err.message.includes("All configured authentication methods failed")
        ) {
          errorMessage = `SSH认证失败: ${err.message}. 请检查用户名、密码或私钥文件是否正确`;

          // 如果配置了私钥路径但没有私钥内容，提供具体提示
          if (
            connection.config.privateKeyPath &&
            !connection.config.privateKey
          ) {
            errorMessage += `. 私钥文件路径: ${connection.config.privateKeyPath} 可能无法读取`;
          }
        } else if (err.message.includes("connect ECONNREFUSED")) {
          errorMessage = `连接被拒绝: 无法连接到 ${connection.config.host}:${connection.config.port || 22}`;
        } else if (err.message.includes("getaddrinfo ENOTFOUND")) {
          errorMessage = `主机不存在: 无法解析主机名 ${connection.config.host}`;
        }

        logToFile(`SSH连接错误: ${connection.id} - ${errorMessage}`, "ERROR");

        // 创建增强的错误对象
        const enhancedError = new Error(errorMessage);
        enhancedError.originalError = err;
        enhancedError.connectionId = connection.id;
        enhancedError.sshConfig = {
          host: connection.config.host,
          port: connection.config.port || 22,
          username: connection.config.username,
          hasPassword: !!connection.config.password,
          hasPrivateKey: !!connection.config.privateKey,
          hasPrivateKeyPath: !!connection.config.privateKeyPath,
        };

        reject(enhancedError);
      });

      ssh.on("close", () => {
        connection.state = CONNECTION_STATE.DISCONNECTED;
        this.handleConnectionClosed(connection);
      });

      // 建立连接
      const connectionOptions = this.buildConnectionOptions(connection.config);
      ssh.connect(connectionOptions);
    });
  }

  buildConnectionOptions(sshConfig) {
    const { processSSHPrivateKey } = require("../utils/ssh-utils");

    // 处理私钥文件路径，转换为私钥内容
    const processedConfig = processSSHPrivateKey(sshConfig);

    const options = {
      host: processedConfig.host,
      port: processedConfig.port || 22,
      username: processedConfig.username,
      keepaliveInterval: 30000,
      keepaliveCountMax: 3,
      readyTimeout: this.config.connectionTimeout,
      algorithms: getBasicSSHAlgorithms(),
    };

    if (processedConfig.password) {
      options.password = processedConfig.password;
    }

    if (processedConfig.privateKey) {
      options.privateKey = processedConfig.privateKey;
      if (processedConfig.passphrase) {
        options.passphrase = processedConfig.passphrase;
      }
    }

    return options;
  }

  registerConnection(connection) {
    this.connections.set(connection.id, connection);

    // 添加到服务器池
    if (!this.serverPools.has(connection.serverKey)) {
      this.serverPools.set(connection.serverKey, new Set());
    }
    this.serverPools.get(connection.serverKey).add(connection.id);

    // 添加到空闲连接集合
    this.idleConnections.add(connection.id);

    // 初始化性能指标
    this.initializeConnectionMetrics(connection.id);

    this.emit("connectionCreated", connection);
  }

  assignConnection(connection) {
    // 从空闲状态转为活跃状态
    this.idleConnections.delete(connection.id);
    this.activeConnections.set(connection.id, connection);

    connection.state = CONNECTION_STATE.ACTIVE;
    connection.lastUsed = Date.now();
    connection.activeRequests++;
    connection.totalRequests++;

    this.emit("connectionAssigned", connection);
    return connection;
  }

  releaseConnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    connection.activeRequests = Math.max(0, connection.activeRequests - 1);

    // 如果没有活跃请求，转为空闲状态
    if (connection.activeRequests === 0) {
      this.activeConnections.delete(connectionId);
      this.idleConnections.add(connectionId);
      connection.state = CONNECTION_STATE.IDLE;
      connection.lastUsed = Date.now();

      this.emit("connectionReleased", connection);

      // 处理等待队列
      this.processRequestQueue();
    }
  }

  async queueConnectionRequest(sshConfig, serverKey, options) {
    return new Promise((resolve, reject) => {
      const request = {
        sshConfig,
        serverKey,
        options,
        resolve,
        reject,
        timestamp: Date.now(),
      };

      this.requestQueue.push(request);
      this.processRequestQueue();
    });
  }

  async processRequestQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.requestQueue.length > 0) {
        const request = this.requestQueue.shift();

        try {
          const connection = await this.getConnection(
            request.sshConfig,
            request.options,
          );
          request.resolve(connection);
        } catch (error) {
          request.reject(error);
        }

        // 避免阻塞事件循环
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  startTimers() {
    // 健康检查定时器
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);

    // 清理定时器
    this.cleanupTimer = setInterval(() => {
      this.performCleanup();
    }, this.config.idleTimeout / 2);
  }

  async performHealthCheck() {
    const connections = Array.from(this.connections.values());

    for (const connection of connections) {
      if (connection.state === CONNECTION_STATE.IDLE) {
        try {
          await this.healthMonitor.pingConnection(connection);
        } catch (error) {
          logToFile(`连接健康检查失败: ${connection.id}`, "WARN");
          this.handleUnhealthyConnection(connection);
        }
      }
    }
  }

  performCleanup() {
    const now = Date.now();
    const idleConnections = Array.from(this.idleConnections)
      .map((id) => this.connections.get(id))
      .filter(
        (conn) =>
          conn &&
          conn.state === CONNECTION_STATE.IDLE &&
          now - conn.lastUsed > this.config.idleTimeout,
      );

    // 保持最小连接数
    const activeServers = new Set(
      Array.from(this.activeConnections.values()).map((conn) => conn.serverKey),
    );

    for (const connection of idleConnections) {
      const serverPool = this.serverPools.get(connection.serverKey);
      const minRequired = activeServers.has(connection.serverKey)
        ? Math.max(
            1,
            Math.floor(this.config.minConnections / activeServers.size),
          )
        : 0;

      if (serverPool && serverPool.size > minRequired) {
        this.closeConnection(connection.id);
      }
    }
  }

  closeConnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    try {
      if (connection.client && typeof connection.client.end === "function") {
        connection.client.end();
      }
    } catch (error) {
      logToFile(`关闭连接时出错: ${connectionId} - ${error.message}`, "ERROR");
    }

    this.unregisterConnection(connectionId);
    this.emit("connectionClosed", connection);
  }

  unregisterConnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    // 从各种集合中移除
    this.connections.delete(connectionId);
    this.activeConnections.delete(connectionId);
    this.idleConnections.delete(connectionId);
    this.busyConnections.delete(connectionId);

    // 从服务器池中移除
    const serverPool = this.serverPools.get(connection.serverKey);
    if (serverPool) {
      serverPool.delete(connectionId);
      if (serverPool.size === 0) {
        this.serverPools.delete(connection.serverKey);
      }
    }

    // 清理性能指标
    this.performanceMetrics.delete(connectionId);
    this.connectionQuality.delete(connectionId);

    logToFile(`连接已移除: ${connectionId}`, "INFO");
  }

  // 辅助方法
  generateServerKey(sshConfig) {
    return `${sshConfig.host}:${sshConfig.port || 22}:${sshConfig.username}`;
  }

  generateConnectionId(sshConfig) {
    const serverKey = this.generateServerKey(sshConfig);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 5);
    return `${serverKey}-${timestamp}-${random}`;
  }

  isConnectionHealthy(connection) {
    return (
      connection &&
      connection.client &&
      !connection.client.destroyed &&
      connection.state !== CONNECTION_STATE.ERROR &&
      connection.state !== CONNECTION_STATE.DISCONNECTED
    );
  }

  updateConnectionQuality(connectionId, metrics) {
    const existing = this.connectionQuality.get(connectionId) || {};
    const updated = { ...existing, ...metrics, timestamp: Date.now() };
    this.connectionQuality.set(connectionId, updated);
  }

  calculateQualityScore(quality) {
    if (!quality.latency && !quality.throughput) {
      return QUALITY_SCORE.FAIR;
    }

    let score = QUALITY_SCORE.EXCELLENT;

    // 延迟评分
    if (quality.latency) {
      if (
        quality.latency >
        this.config.connectionQuality.latencyThreshold * 2
      ) {
        score -= 30;
      } else if (
        quality.latency > this.config.connectionQuality.latencyThreshold
      ) {
        score -= 15;
      }
    }

    // 错误率评分
    if (quality.error) {
      score -= 40;
    }

    return Math.max(score, QUALITY_SCORE.BAD);
  }

  initializeConnectionMetrics(connectionId) {
    this.performanceMetrics.set(connectionId, {
      requests: 0,
      errors: 0,
      totalTime: 0,
      avgResponseTime: 0,
      throughput: 0,
      lastUpdated: Date.now(),
    });
  }

  handleConnectionClosed(connection) {
    logToFile(`连接已关闭: ${connection.id}`, "INFO");

    // 如果是意外关闭且仍有活跃请求，尝试重连
    if (
      connection.activeRequests > 0 &&
      connection.retryCount < this.config.maxRetries
    ) {
      setTimeout(
        () => {
          this.attemptReconnection(connection);
        },
        this.config.retryDelay * (connection.retryCount + 1),
      );
    } else {
      this.unregisterConnection(connection.id);
    }
  }

  async attemptReconnection(connection) {
    connection.retryCount++;
    connection.state = CONNECTION_STATE.RECONNECTING;

    try {
      await this.establishConnection(connection);
      logToFile(`连接重建成功: ${connection.id}`, "INFO");
    } catch (error) {
      logToFile(`连接重建失败: ${connection.id} - ${error.message}`, "ERROR");

      if (connection.retryCount >= this.config.maxRetries) {
        this.unregisterConnection(connection.id);
      } else {
        setTimeout(() => {
          this.attemptReconnection(connection);
        }, this.config.retryDelay * connection.retryCount);
      }
    }
  }

  handleUnhealthyConnection(connection) {
    logToFile(`检测到不健康连接: ${connection.id}`, "WARN");

    connection.state = CONNECTION_STATE.ERROR;

    // 如果连接有活跃请求，尝试重建
    if (connection.activeRequests > 0) {
      this.attemptReconnection(connection);
    } else {
      this.closeConnection(connection.id);
    }
  }

  // 公共接口方法
  getPoolStatus() {
    const totalConnections = this.connections.size;
    const activeConnections = this.activeConnections.size;
    const idleConnections = this.idleConnections.size;
    const serverCount = this.serverPools.size;
    const queueLength = this.requestQueue.length;

    return {
      totalConnections,
      activeConnections,
      idleConnections,
      serverCount,
      queueLength,
      maxConnections: this.config.maxConnections,
      utilization:
        ((activeConnections / this.config.maxConnections) * 100).toFixed(2) +
        "%",
    };
  }

  getConnectionDetails() {
    return Array.from(this.connections.values()).map((conn) => ({
      id: conn.id,
      serverKey: conn.serverKey,
      state: conn.state,
      activeRequests: conn.activeRequests,
      totalRequests: conn.totalRequests,
      errors: conn.errors,
      createdAt: new Date(conn.createdAt).toISOString(),
      lastUsed: new Date(conn.lastUsed).toISOString(),
      quality: this.connectionQuality.get(conn.id),
    }));
  }

  async shutdown() {
    logToFile("开始关闭SSH连接池...", "INFO");

    // 停止定时器
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // 拒绝所有等待中的请求
    while (this.requestQueue.length > 0) {
      const request = this.requestQueue.shift();
      request.reject(new Error("连接池正在关闭"));
    }

    // 关闭所有连接
    const closePromises = Array.from(this.connections.keys()).map((id) => {
      return new Promise((resolve) => {
        this.closeConnection(id);
        resolve();
      });
    });

    await Promise.all(closePromises);

    this.isInitialized = false;
    this.emit("shutdown");
    logToFile("SSH连接池已关闭", "INFO");
  }
}

module.exports = SSHPool;
