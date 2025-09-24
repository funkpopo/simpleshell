const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");

// 重连策略配置
const RECONNECT_CONFIG = {
  maxRetries: 5, // 最大重试次数固定为5次
  fixedDelay: 3000, // 固定重连间隔3秒

  // 禁用其他策略，使用固定配置
  useFixedInterval: true, // 使用固定间隔

  // 保留但不使用的配置（为了兼容性）
  initialDelay: 3000,
  maxDelay: 3000,
  exponentialFactor: 1.0,
  jitter: 0,

  // 禁用快速重连
  fastReconnect: {
    enabled: false,
    maxAttempts: 0,
    delay: 3000,
    conditions: [],
  },

  // 禁用智能重连
  smartReconnect: {
    enabled: false,
    analyzePattern: false,
    adaptiveDelay: false,
    networkQualityThreshold: 0.3,
  },
};

// 重连状态
const RECONNECT_STATE = {
  IDLE: "idle",
  PENDING: "pending",
  RECONNECTING: "reconnecting",
  CONNECTED: "connected",
  FAILED: "failed",
  ABANDONED: "abandoned",
};

// 连接失败原因分类
const FAILURE_REASON = {
  NETWORK: "network",
  AUTHENTICATION: "authentication",
  TIMEOUT: "timeout",
  RESOURCE: "resource",
  UNKNOWN: "unknown",
};

class ReconnectionManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...RECONNECT_CONFIG, ...config };

    // 连接会话管理
    this.sessions = new Map();
    this.reconnectQueues = new Map();
    this.failurePatterns = new Map();

    // 统计信息
    this.statistics = {
      totalAttempts: 0,
      successfulReconnects: 0,
      failedReconnects: 0,
      averageReconnectTime: 0,
    };

    this.isInitialized = false;
  }

  initialize() {
    if (this.isInitialized) {
      return;
    }

    this.isInitialized = true;
    logToFile("重连管理器已初始化 (固定3秒间隔，最多5次重试)", "INFO");
  }

  // 注册连接会话
  registerSession(sessionId, connection, config) {
    const session = {
      id: sessionId,
      connection,
      config,
      state: RECONNECT_STATE.CONNECTED,
      retryCount: 0,
      lastAttempt: null,
      lastError: null,
      createdAt: Date.now(),
      reconnectHistory: [],
      qualityMetrics: {
        stability: 1.0,
        latency: 0,
        packetLoss: 0,
      },
    };

    this.sessions.set(sessionId, session);

    // 设置连接事件监听
    this.setupConnectionListeners(session);

    logToFile(`注册重连会话: ${sessionId}`, "DEBUG");
    this.emit("sessionRegistered", { sessionId, session });
  }

  // 设置连接监听器
  setupConnectionListeners(session) {
    const connection = session.connection;

    // 监听连接错误
    connection.on("error", (error) => {
      this.handleConnectionError(session, error);
    });

    // 监听连接关闭
    connection.on("close", () => {
      this.handleConnectionClose(session);
    });

    // 监听连接超时
    connection.on("timeout", () => {
      this.handleConnectionTimeout(session);
    });
  }

  // 处理连接错误
  async handleConnectionError(session, error) {
    logToFile(`连接错误 ${session.id}: ${error.message}`, "ERROR");

    session.lastError = error;
    session.state = RECONNECT_STATE.PENDING;

    // 分析错误原因
    const failureReason = this.analyzeFailureReason(error);

    // 记录失败模式
    this.recordFailurePattern(session.id, failureReason);

    // 决定是否需要重连
    if (this.shouldReconnect(session, failureReason)) {
      await this.scheduleReconnect(session, failureReason);
    } else {
      this.abandonReconnection(session, "不满足重连条件");
    }
  }

  // 处理连接关闭
  async handleConnectionClose(session) {
    if (session.state === RECONNECT_STATE.ABANDONED) {
      return;
    }

    logToFile(`连接关闭: ${session.id}`, "INFO");

    session.state = RECONNECT_STATE.PENDING;

    // 如果是意外断开，尝试重连
    if (!session.intentionalClose) {
      const failureReason = FAILURE_REASON.NETWORK;
      if (this.shouldReconnect(session, failureReason)) {
        await this.scheduleReconnect(session, failureReason);
      }
    }
  }

  // 处理连接超时
  async handleConnectionTimeout(session) {
    logToFile(`连接超时: ${session.id}`, "WARN");

    session.state = RECONNECT_STATE.PENDING;

    const failureReason = FAILURE_REASON.TIMEOUT;

    if (this.shouldReconnect(session, failureReason)) {
      await this.scheduleReconnect(session, failureReason);
    }
  }

  // 分析失败原因
  analyzeFailureReason(error) {
    const errorMessage = error.message || "";
    const errorCode = error.code || "";

    // 网络相关错误
    if (
      errorCode === "ECONNREFUSED" ||
      errorCode === "ECONNRESET" ||
      errorCode === "ETIMEDOUT" ||
      errorCode === "EPIPE" ||
      errorCode === "ENETUNREACH" ||
      errorMessage.includes("socket") ||
      errorMessage.includes("network")
    ) {
      return FAILURE_REASON.NETWORK;
    }

    // 认证相关错误
    if (
      errorMessage.includes("authentication") ||
      errorMessage.includes("permission") ||
      errorMessage.includes("password") ||
      errorMessage.includes("key")
    ) {
      return FAILURE_REASON.AUTHENTICATION;
    }

    // 超时相关错误
    if (errorMessage.includes("timeout") || errorCode === "ETIMEDOUT") {
      return FAILURE_REASON.TIMEOUT;
    }

    // 资源相关错误
    if (
      errorMessage.includes("too many") ||
      errorMessage.includes("limit") ||
      errorMessage.includes("quota")
    ) {
      return FAILURE_REASON.RESOURCE;
    }

    return FAILURE_REASON.UNKNOWN;
  }

  // 判断是否应该重连
  shouldReconnect(session, failureReason) {
    // 检查重试次数 - 固定为5次
    if (session.retryCount >= this.config.maxRetries) {
      logToFile(`达到最大重试次数(5次): ${session.id}`, "WARN");
      return false;
    }

    // 认证失败不重连
    if (failureReason === FAILURE_REASON.AUTHENTICATION) {
      logToFile(`认证失败，不进行重连: ${session.id}`, "WARN");
      return false;
    }

    // 资源限制不重连
    if (failureReason === FAILURE_REASON.RESOURCE) {
      logToFile(`资源限制，不进行重连: ${session.id}`, "WARN");
      return false;
    }

    return true;
  }

  // 计划重连
  async scheduleReconnect(session, failureReason) {
    session.retryCount++;

    // 使用固定的3秒延迟
    const delay = this.config.fixedDelay; // 固定3000ms

    // 加入重连队列
    const reconnectTask = {
      sessionId: session.id,
      scheduledAt: Date.now(),
      executeAt: Date.now() + delay,
      failureReason,
      retryCount: session.retryCount,
    };

    if (!this.reconnectQueues.has(session.id)) {
      this.reconnectQueues.set(session.id, []);
    }
    this.reconnectQueues.get(session.id).push(reconnectTask);

    logToFile(
      `计划重连: ${session.id}, 延迟 ${delay}ms (3秒), 第 ${session.retryCount}/${this.config.maxRetries} 次尝试`,
      "INFO",
    );

    // 执行重连
    setTimeout(() => {
      this.executeReconnect(session);
    }, delay);

    this.emit("reconnectScheduled", {
      sessionId: session.id,
      delay,
      retryCount: session.retryCount,
      maxRetries: this.config.maxRetries,
    });
  }

  // 执行重连
  async executeReconnect(session) {
    if (session.state === RECONNECT_STATE.ABANDONED) {
      return;
    }

    session.state = RECONNECT_STATE.RECONNECTING;
    session.lastAttempt = Date.now();

    logToFile(
      `开始重连: ${session.id} (第 ${session.retryCount}/${this.config.maxRetries} 次)`,
      "INFO",
    );
    this.emit("reconnectStarted", {
      sessionId: session.id,
      attempt: session.retryCount,
      maxRetries: this.config.maxRetries,
    });

    this.statistics.totalAttempts++;

    try {
      // 创建新连接
      const newConnection = await this.createNewConnection(session.config);

      // 验证连接
      const isValid = await this.validateConnection(newConnection);
      if (!isValid) {
        throw new Error("连接验证失败");
      }

      // 替换旧连接
      await this.replaceConnection(session, newConnection);

      // 重连成功
      session.state = RECONNECT_STATE.CONNECTED;
      session.retryCount = 0;
      session.lastError = null;

      // 记录成功
      session.reconnectHistory.push({
        timestamp: Date.now(),
        success: true,
        attempts: session.retryCount,
        duration: Date.now() - session.lastAttempt,
      });

      this.statistics.successfulReconnects++;

      logToFile(`重连成功: ${session.id}`, "INFO");
      this.emit("reconnectSuccess", {
        sessionId: session.id,
        attempts: session.retryCount,
      });
    } catch (error) {
      logToFile(
        `重连失败: ${session.id} - ${error.message} (第 ${session.retryCount}/${this.config.maxRetries} 次)`,
        "ERROR",
      );

      session.lastError = error;

      // 记录失败
      session.reconnectHistory.push({
        timestamp: Date.now(),
        success: false,
        attempts: session.retryCount,
        error: error.message,
      });

      this.statistics.failedReconnects++;

      // 决定是否继续重试
      const failureReason = this.analyzeFailureReason(error);
      if (this.shouldReconnect(session, failureReason)) {
        await this.scheduleReconnect(session, failureReason);
      } else {
        this.abandonReconnection(
          session,
          `达到最大重试次数(${this.config.maxRetries}次)或不满足重连条件`,
        );
      }

      this.emit("reconnectFailed", {
        sessionId: session.id,
        error: error.message,
        attempts: session.retryCount,
        maxRetries: this.config.maxRetries,
      });
    }
  }

  // 创建新连接
  async createNewConnection(config) {
    const Client = require("ssh2").Client;
    const { getBasicSSHAlgorithms } = require("../../constants/sshAlgorithms");

    return new Promise((resolve, reject) => {
      const ssh = new Client();

      const timeout = setTimeout(() => {
        ssh.end();
        reject(new Error("连接超时"));
      }, 10000);

      ssh.on("ready", () => {
        clearTimeout(timeout);
        resolve(ssh);
      });

      ssh.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      const connectionOptions = {
        host: config.host,
        port: config.port || 22,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey,
        passphrase: config.passphrase,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        readyTimeout: 10000,
        algorithms: getBasicSSHAlgorithms(),
      };

      ssh.connect(connectionOptions);
    });
  }

  // 验证连接
  async validateConnection(connection) {
    return new Promise((resolve) => {
      // 执行简单命令测试连接
      connection.exec("echo test", (err, stream) => {
        if (err) {
          resolve(false);
          return;
        }

        stream.on("data", () => {
          resolve(true);
        });

        stream.on("error", () => {
          resolve(false);
        });

        setTimeout(() => {
          resolve(false);
        }, 3000);
      });
    });
  }

  // 替换连接
  async replaceConnection(session, newConnection) {
    const oldConnection = session.connection;

    // 移除旧连接的监听器
    oldConnection.removeAllListeners();

    // 设置新连接
    session.connection = newConnection;

    // 设置新连接的监听器
    this.setupConnectionListeners(session);

    // 尝试优雅关闭旧连接
    try {
      oldConnection.end();
    } catch (error) {
      // 忽略关闭错误
    }

    this.emit("connectionReplaced", {
      sessionId: session.id,
      newConnection,
    });
  }

  // 放弃重连
  abandonReconnection(session, reason) {
    session.state = RECONNECT_STATE.ABANDONED;

    logToFile(`放弃重连 ${session.id}: ${reason}`, "WARN");

    this.emit("reconnectAbandoned", {
      sessionId: session.id,
      reason,
      attempts: session.retryCount,
      maxRetries: this.config.maxRetries,
    });

    // 清理会话
    this.cleanupSession(session.id);
  }

  // 清理会话
  cleanupSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    // 关闭连接
    try {
      session.connection.end();
    } catch (error) {
      // 忽略错误
    }

    // 移除记录
    this.sessions.delete(sessionId);
    this.reconnectQueues.delete(sessionId);
    this.failurePatterns.delete(sessionId);

    logToFile(`清理重连会话: ${sessionId}`, "DEBUG");
  }

  // 公共接口
  getSessionStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      id: session.id,
      state: session.state,
      retryCount: session.retryCount,
      maxRetries: this.config.maxRetries,
      lastAttempt: session.lastAttempt,
      lastError: session.lastError ? session.lastError.message : null,
      qualityMetrics: session.qualityMetrics,
    };
  }

  getAllSessionsStatus() {
    return Array.from(this.sessions.keys()).map((id) =>
      this.getSessionStatus(id),
    );
  }

  getStatistics() {
    return {
      ...this.statistics,
      activeSessions: this.sessions.size,
      reconnectingSessions: Array.from(this.sessions.values()).filter(
        (s) => s.state === RECONNECT_STATE.RECONNECTING,
      ).length,
      maxRetries: this.config.maxRetries,
      reconnectInterval: this.config.fixedDelay,
    };
  }

  // 手动触发重连
  async manualReconnect(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    if (session.state === RECONNECT_STATE.RECONNECTING) {
      throw new Error("正在重连中");
    }

    session.retryCount = 0; // 重置重试次数
    logToFile(`手动触发重连: ${sessionId}`, "INFO");
    await this.executeReconnect(session);
  }

  // 暂停重连
  pauseReconnection(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = RECONNECT_STATE.ABANDONED;
      logToFile(`暂停重连: ${sessionId}`, "INFO");
    }
  }

  // 恢复重连
  resumeReconnection(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session && session.state === RECONNECT_STATE.ABANDONED) {
      session.state = RECONNECT_STATE.PENDING;
      session.retryCount = 0;
      this.scheduleReconnect(session, FAILURE_REASON.NETWORK);
      logToFile(`恢复重连: ${sessionId}`, "INFO");
    }
  }

  // 关闭
  shutdown() {
    // 清理所有会话
    for (const sessionId of this.sessions.keys()) {
      this.cleanupSession(sessionId);
    }

    this.isInitialized = false;
    logToFile("重连管理器已关闭", "INFO");
  }
}

module.exports = ReconnectionManager;
