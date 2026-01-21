const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");
const proxyManager = require("../proxy/proxy-manager");

// 重连策略配置 - 使用指数退避算法
const RECONNECT_CONFIG = {
  maxRetries: 5, // 最大重试次数
  initialDelay: 1000, // 初始延迟 1 秒
  maxDelay: 16000, // 最大延迟 16 秒
  exponentialFactor: 2.0, // 指数因子 (每次翻倍)
  jitter: 1000, // 随机抖动 0-1000ms，避免雷鸣效应

  // 启用指数退避策略
  useExponentialBackoff: true,

  // 快速重连：对于明显的网络抖动，快速尝试
  fastReconnect: {
    enabled: true,
    maxAttempts: 2, // 前2次快速重连
    delay: 500, // 500ms 快速重连
    conditions: ["ECONNRESET", "EPIPE"], // 适用条件
  },

  // 智能重连：根据历史成功率调整策略
  smartReconnect: {
    enabled: true,
    analyzePattern: true, // 分析失败模式
    adaptiveDelay: true, // 自适应延迟
    networkQualityThreshold: 0.7, // 网络质量阈值
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
    this.reconnectTimers = new Map(); // 保存定时器引用，用于取消待执行的重连

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
    logToFile(
      "重连管理器已初始化 (指数退避: 1s → 2s → 4s → 8s → 16s, 最多5次重试)",
      "INFO",
    );
  }

  // 注册连接会话
  registerSession(sessionId, connection, config, options = {}) {
    const {
      // 断线场景默认应进入 pending 并启动重连；手动注册（例如用户点“手动重连”）可关闭 autoStart
      autoStart = true,
      state,
      failureReason = FAILURE_REASON.NETWORK,
      intentionalClose = false,
    } = options || {};

    const session = {
      id: sessionId,
      connection,
      config,
      state:
        state ??
        (autoStart ? RECONNECT_STATE.PENDING : RECONNECT_STATE.CONNECTED),
      retryCount: 0,
      lastAttempt: null,
      lastError: null,
      intentionalClose,
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

    // 关键：很多场景（例如 ssh2 的 close 已经触发后才注册）不会再收到旧连接事件，
    // 因此需要在注册时就直接安排一次重连。
    if (autoStart && session.state === RECONNECT_STATE.PENDING) {
      void this.scheduleReconnect(session, failureReason);
    }
  }

  // 设置连接监听器
  setupConnectionListeners(session) {
    const connection = session.connection;

    // 监听连接错误
    connection.on("error", (error) => {
      this.handleConnectionError(session, error, connection);
    });

    // 监听连接关闭
    connection.on("close", () => {
      this.handleConnectionClose(session, connection);
    });

    // 监听连接超时
    connection.on("timeout", () => {
      this.handleConnectionTimeout(session, connection);
    });
  }

  // 处理连接错误
  async handleConnectionError(session, error, sourceConnection) {
    // 仅处理“当前连接对象”的事件，避免旧连接残留事件干扰
    if (session.connection !== sourceConnection) {
      return;
    }

    // 如果已经处于重连中或已放弃，忽略
    if (
      session.state === RECONNECT_STATE.RECONNECTING ||
      session.state === RECONNECT_STATE.ABANDONED
    ) {
      logToFile(
        `忽略连接错误(状态: ${session.state}): ${session.id} - ${error.message}`,
        "DEBUG",
      );
      return;
    }

    logToFile(`连接错误 ${session.id}: ${error.message}`, "ERROR");

    session.lastError = error;
    session.state = RECONNECT_STATE.PENDING;

    // 分析错误原因
    const failureReason = this.analyzeFailureReason(error);

    // 记录失败模式
    try {
      this.recordFailurePattern(session.id, failureReason);
    } catch (patternErr) {
      // 失败模式统计不应影响断线/重连主流程
      logToFile(
        `记录失败模式异常(已忽略): ${session.id} - ${patternErr?.message || patternErr}`,
        "WARN",
      );
    }

    // 决定是否需要重连
    if (this.shouldReconnect(session, failureReason)) {
      await this.scheduleReconnect(session, failureReason);
    } else {
      this.abandonReconnection(session, "不满足重连条件");
    }
  }

  // 处理连接关闭
  async handleConnectionClose(session, sourceConnection) {
    // 仅处理“当前连接对象”的事件，避免旧连接残留事件干扰
    if (session.connection !== sourceConnection) {
      return;
    }

    // 如果已经处于重连中或已放弃，忽略
    if (
      session.state === RECONNECT_STATE.RECONNECTING ||
      session.state === RECONNECT_STATE.ABANDONED
    ) {
      logToFile(`忽略连接关闭(状态: ${session.state}): ${session.id}`, "DEBUG");
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
  async handleConnectionTimeout(session, sourceConnection) {
    // 仅处理“当前连接对象”的事件，避免旧连接残留事件干扰
    if (session.connection !== sourceConnection) {
      return;
    }

    // 如果已经处于重连中或已放弃，忽略
    if (
      session.state === RECONNECT_STATE.RECONNECTING ||
      session.state === RECONNECT_STATE.ABANDONED
    ) {
      logToFile(`忽略连接超时(状态: ${session.state}): ${session.id}`, "DEBUG");
      return;
    }

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

  /**
   * 记录失败模式（用于后续智能重连策略分析）
   * 注意：该统计逻辑不应影响主流程，调用方应自行 try/catch。
   */
  recordFailurePattern(sessionId, failureReason) {
    const now = Date.now();
    const reason = failureReason || FAILURE_REASON.UNKNOWN;

    const existing = this.failurePatterns.get(sessionId) || {
      total: 0,
      reasons: Object.create(null),
      lastReason: null,
      lastAt: 0,
      consecutive: 0,
    };

    existing.total += 1;
    existing.reasons[reason] = (existing.reasons[reason] || 0) + 1;

    // 连续失败统计：同类原因、且时间间隔不太长则计为连续
    const isSameReason = existing.lastReason === reason;
    const isCloseInTime = now - (existing.lastAt || 0) < 5 * 60 * 1000; // 5分钟窗口
    existing.consecutive = isSameReason && isCloseInTime ? existing.consecutive + 1 : 1;

    existing.lastReason = reason;
    existing.lastAt = now;

    this.failurePatterns.set(sessionId, existing);
    return existing;
  }

  // 将底层错误映射为用户可理解的提示（详细信息写日志）
  formatReconnectErrorForUser(error, config) {
    const msg = String(error?.message || "");
    const code = String(error?.code || "");
    const host = config?.host || "目标主机";
    const port = config?.port || 22;

    // 这一类属于开发/内部异常，不应直接暴露给用户
    if (msg.includes("is not a function") || msg.includes("undefined")) {
      return "连接发生异常并已断开，自动重连失败。请重试连接，或查看日志获取详细信息。";
    }

    // SSH2 常见错误映射
    if (msg.includes("All configured authentication methods failed")) {
      return "SSH 认证失败：请检查用户名/密码/私钥与权限设置。";
    }
    if (code === "ECONNREFUSED" || msg.includes("connect ECONNREFUSED")) {
      return `连接被拒绝：无法连接到 ${host}:${port}。请检查端口、服务状态与防火墙。`;
    }
    if (code === "ENOTFOUND" || msg.includes("getaddrinfo ENOTFOUND")) {
      return `主机名无法解析：${host}。请检查主机名/DNS/网络。`;
    }
    if (code === "ETIMEDOUT" || msg.toLowerCase().includes("timeout")) {
      return `连接超时：${host}:${port}。请检查网络质量或服务器负载。`;
    }
    if (code === "ECONNRESET" || msg.includes("ECONNRESET")) {
      return "连接被远端重置：网络不稳定或服务器主动断开。";
    }
    if (code === "EPIPE" || msg.includes("EPIPE")) {
      return "连接管道已关闭：网络不稳定或会话被中止。";
    }

    return "连接已断开，自动重连失败，请重新连接。";
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

  // 计划重连 - 使用指数退避算法
  async scheduleReconnect(session, failureReason) {
    session.retryCount++;

    // 计算延迟时间
    let delay;

    // 1. 检查是否满足快速重连条件
    if (
      this.config.fastReconnect.enabled &&
      session.retryCount <= this.config.fastReconnect.maxAttempts
    ) {
      const errorCode = session.lastError?.code || "";
      if (this.config.fastReconnect.conditions.includes(errorCode)) {
        delay = this.config.fastReconnect.delay;
        logToFile(
          `使用快速重连策略: ${session.id}, 延迟 ${delay}ms`,
          "DEBUG",
        );
      }
    }

    // 2. 使用指数退避算法
    if (delay === undefined) {
      if (this.config.useExponentialBackoff) {
        // 指数退避: base * (factor ^ retries) + jitter
        const exponentialDelay =
          this.config.initialDelay *
          Math.pow(this.config.exponentialFactor, session.retryCount - 1);
        const cappedDelay = Math.min(exponentialDelay, this.config.maxDelay);
        const jitter = Math.random() * this.config.jitter;
        delay = Math.round(cappedDelay + jitter);
      } else {
        // 降级到固定延迟
        delay = this.config.initialDelay;
      }
    }

    // 3. 智能调整：根据历史成功率
    if (
      this.config.smartReconnect.enabled &&
      this.config.smartReconnect.adaptiveDelay
    ) {
      const successRate = this.calculateSuccessRate(session);
      if (successRate < this.config.smartReconnect.networkQualityThreshold) {
        // 网络质量差，增加延迟
        delay = Math.round(delay * 1.5);
        logToFile(
          `网络质量差 (成功率 ${(successRate * 100).toFixed(1)}%), 延长重连时间至 ${delay}ms`,
          "DEBUG",
        );
      }
    }

    // 加入重连队列
    const reconnectTask = {
      sessionId: session.id,
      scheduledAt: Date.now(),
      executeAt: Date.now() + delay,
      failureReason,
      retryCount: session.retryCount,
      delay,
    };

    if (!this.reconnectQueues.has(session.id)) {
      this.reconnectQueues.set(session.id, []);
    }
    this.reconnectQueues.get(session.id).push(reconnectTask);

    logToFile(
      `计划重连: ${session.id}, 延迟 ${delay}ms (指数退避), 第 ${session.retryCount}/${this.config.maxRetries} 次尝试`,
      "INFO",
    );

    // 取消之前的定时器（如果存在）
    this.cancelPendingReconnect(session.id);

    // 执行重连，保存定时器引用以便后续取消
    const timerId = setTimeout(() => {
      this.reconnectTimers.delete(session.id);
      this.executeReconnect(session);
    }, delay);
    this.reconnectTimers.set(session.id, timerId);

    this.emit("reconnectScheduled", {
      sessionId: session.id,
      delay,
      retryCount: session.retryCount,
      maxRetries: this.config.maxRetries,
    });
  }

  // 计算会话的历史成功率
  calculateSuccessRate(session) {
    const history = session.reconnectHistory || [];
    if (history.length === 0) return 1.0;

    const recentHistory = history.slice(-10); // 最近10次
    const successCount = recentHistory.filter((h) => h.success).length;
    return successCount / recentHistory.length;
  }

  // 取消待执行的重连任务
  cancelPendingReconnect(sessionId) {
    const timerId = this.reconnectTimers.get(sessionId);
    if (timerId) {
      clearTimeout(timerId);
      this.reconnectTimers.delete(sessionId);
      logToFile(`取消待执行的重连任务: ${sessionId}`, "DEBUG");
    }
  }

  // 执行重连
  async executeReconnect(session) {
    // 检查是否应该跳过本次重连（已放弃或已连接）
    if (session.state === RECONNECT_STATE.ABANDONED) {
      logToFile(`跳过重连(已放弃): ${session.id}`, "DEBUG");
      return;
    }

    // 检查是否正在重连中（防止并发重连）
    if (session.state === RECONNECT_STATE.RECONNECTING) {
      logToFile(`跳过重连(正在重连中): ${session.id}`, "DEBUG");
      return;
    }

    session.state = RECONNECT_STATE.RECONNECTING;
    session.lastAttempt = Date.now();
    session.isReconnecting = true; // 标记正在重连

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
      const attemptNumber = session.retryCount;
      // 创建新连接
      const newConnection = await this.createNewConnection(session.config);

      // 验证连接
      const isValid = await this.validateConnection(newConnection);
      if (!isValid) {
        throw new Error("连接验证失败");
      }

      // 替换旧连接
      await this.replaceConnection(session, newConnection);

      // 重连成功 - 取消所有待执行的重连任务
      this.cancelPendingReconnect(session.id);

      // 重连成功
      session.state = RECONNECT_STATE.CONNECTED;
      session.retryCount = 0;
      session.lastError = null;
      session.isReconnecting = false; // 清除重连标记

      // 清空重连队列
      this.reconnectQueues.delete(session.id);

      // 记录成功
      session.reconnectHistory.push({
        timestamp: Date.now(),
        success: true,
        attempts: attemptNumber,
        duration: Date.now() - session.lastAttempt,
      });

      this.statistics.successfulReconnects++;

      logToFile(`重连成功: ${session.id}`, "INFO");
      this.emit("reconnectSuccess", {
        sessionId: session.id,
        attempts: session.retryCount,
      });
    } catch (error) {
      // 重连过程中再次检查状态，避免在连接已成功时报告错误
      if (session.state === RECONNECT_STATE.CONNECTED) {
        logToFile(`重连异常被忽略(连接已成功): ${session.id}`, "DEBUG");
        return;
      }

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
        // 继续重试，不发送失败事件（避免触发错误通知）
        await this.scheduleReconnect(session, failureReason);
      } else {
        // 达到最大重试次数，清除重连标记并发送失败事件
        session.isReconnecting = false;

        this.abandonReconnection(
          session,
          `达到最大重试次数(${this.config.maxRetries}次)或不满足重连条件`,
        );

        const userFacingError = this.formatReconnectErrorForUser(
          error,
          session?.config,
        );
        if (userFacingError !== error.message) {
          logToFile(
            `重连失败(用户提示): ${session.id} - ${userFacingError}`,
            "WARN",
          );
        }

        this.emit("reconnectFailed", {
          sessionId: session.id,
          error: userFacingError,
          attempts: session.retryCount,
          maxRetries: this.config.maxRetries,
        });
      }
    }
  }

  // 创建新连接
  async createNewConnection(config) {
    const Client = require("ssh2").Client;
    const { getBasicSSHAlgorithms } = require("../../constants/sshAlgorithms");
    const { processSSHPrivateKey } = require("../utils/ssh-utils");

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

      const processedConfig = processSSHPrivateKey(config);

      const connectionOptions = {
        host: processedConfig.host,
        port: processedConfig.port || 22,
        username: processedConfig.username,
        algorithms: getBasicSSHAlgorithms(),
        keepaliveInterval: 30000,
        keepaliveCountMax: 3,
        readyTimeout: 10000,
      };

      if (processedConfig.password) connectionOptions.password = processedConfig.password;
      if (processedConfig.privateKey) connectionOptions.privateKey = processedConfig.privateKey;
      if (processedConfig.passphrase) connectionOptions.passphrase = processedConfig.passphrase;

      (async () => {
        try {
          // 重连也必须走同一套代理逻辑（否则会退化为直连）
          const resolvedProxyConfig = await proxyManager.resolveProxyConfigAsync(processedConfig);
          const usingProxy =
            resolvedProxyConfig &&
            proxyManager.isValidProxyConfig(resolvedProxyConfig) &&
            String(resolvedProxyConfig.type || "").toLowerCase() !== "none";

          if (usingProxy) {
            const sock = await proxyManager.createTunnelSocket(
              resolvedProxyConfig,
              processedConfig.host,
              processedConfig.port || 22,
              { timeoutMs: 10000 },
            );
            connectionOptions.sock = sock;
          }

          ssh.connect(connectionOptions);
        } catch (e) {
          clearTimeout(timeout);
          try {
            ssh.end();
          } catch (_) {}
          reject(e);
        }
      })();
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
    // 先取消待执行的重连任务
    this.cancelPendingReconnect(session.id);

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

    // 取消待执行的重连任务
    this.cancelPendingReconnect(sessionId);

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
      reconnectStrategy: this.config.useExponentialBackoff
        ? "exponential_backoff"
        : "fixed",
      reconnectDelayRange: this.config.useExponentialBackoff
        ? `${this.config.initialDelay}ms - ${this.config.maxDelay}ms`
        : `${this.config.initialDelay}ms`,
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

    // 取消任何待执行的重连任务，避免并发
    this.cancelPendingReconnect(sessionId);

    session.retryCount = 0; // 重置重试次数
    session.intentionalClose = false;
    session.state = RECONNECT_STATE.PENDING;
    logToFile(`手动触发重连: ${sessionId}`, "INFO");
    await this.executeReconnect(session);
  }

  // 暂停重连
  pauseReconnection(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.cancelPendingReconnect(sessionId);
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
      void this.scheduleReconnect(session, FAILURE_REASON.NETWORK);
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
