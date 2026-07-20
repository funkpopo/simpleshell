const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");
const {
  FAILURE_REASON,
  buildSshRetryConfig,
  analyzeSshFailureReason,
  buildReconnectTimeoutMessage,
  checkSshPreflight,
  getEffectiveMaxRetries,
  getRemainingRetryWindowMs,
  getRetryWindowExpiresAt,
  isRetryWindowExpired,
  calculateRetryDelay,
  createManagedSshConnection,
} = require("./ssh-retry-helper");
const { isZhLanguage } = require("../../shared/connectionErrorAdvice");

// 重连状态
const RECONNECT_STATE = {
  IDLE: "idle",
  PENDING: "pending",
  RECONNECTING: "reconnecting",
  CONNECTED: "connected",
  FAILED: "failed",
  ABANDONED: "abandoned",
  PAUSED: "paused",
};

const FAILURE_PATTERN_GUARD = {
  windowMs: 2 * 60 * 1000, // 2分钟窗口
  maxConsecutive: 3, // 同类连续失败达到3次则停止自动重连
};

function buildMaxRetriesMessage(maxRetries, language) {
  if (!isZhLanguage(language)) {
    return `Reached the maximum retry count (${maxRetries}). Check proxy/VPN/network and refresh or reopen the connection.`;
  }
  return `达到最大重试次数（${maxRetries}次），请检查代理/VPN/网络后刷新或重新打开连接。`;
}

class ReconnectionManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = buildSshRetryConfig(config);

    // 连接会话管理
    this.sessions = new Map();
    this.reconnectQueues = new Map();
    this.failurePatterns = new Map();
    this.reconnectTimers = new Map(); // 保存定时器引用，用于取消待执行的重连
    this.replacingSessions = new Set(); // 防止同一 session 并发替换连接对象

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
    const maxDelay = Math.min(
      Number(this.config.initialDelay || 0) *
        Math.pow(
          Number(this.config.exponentialFactor || 2),
          Math.max(Number(this.config.maxRetries || 1) - 1, 0),
        ),
      Number(this.config.maxDelay || 0),
    );
    const strategyLabel = this.config.useExponentialBackoff
      ? `指数退避: ${this.config.initialDelay}ms → ${Math.round(maxDelay)}ms`
      : `固定间隔: ${this.config.initialDelay}ms`;
    logToFile(
      `重连管理器已初始化 (${strategyLabel}, 最多${this.config.maxRetries}次重试, 总窗口${this.config.totalTimeCapMs}ms)`,
      "INFO",
    );
  }

  // 注册连接会话
  registerSession(sessionId, connection, config, options = {}) {
    if (!sessionId || !connection) {
      throw new Error("注册重连会话失败: sessionId 或 connection 不可用");
    }

    const {
      // 断线场景默认应进入 pending 并启动重连；恢复现有会话时可关闭 autoStart
      autoStart = true,
      state,
      failureReason = FAILURE_REASON.NETWORK,
      intentionalClose = false,
      replaceConnection = true,
    } = options || {};

    const existingSession = this.sessions.get(sessionId);
    if (existingSession) {
      const shouldReplaceConnection =
        replaceConnection &&
        connection &&
        existingSession.connection !== connection;

      if (shouldReplaceConnection) {
        const oldConnection = existingSession.connection;
        try {
          if (
            oldConnection &&
            typeof oldConnection.removeAllListeners === "function"
          ) {
            oldConnection.removeAllListeners();
          }
        } catch {
          // 忽略旧连接清理异常
        }

        existingSession.connection = connection;
        this.setupConnectionListeners(existingSession);
      }

      if (config) {
        existingSession.config = config;
      }
      existingSession.intentionalClose = intentionalClose;
      existingSession.failureReason = failureReason;

      if (state && existingSession.state !== RECONNECT_STATE.RECONNECTING) {
        existingSession.state = state;
      } else if (
        autoStart &&
        existingSession.state === RECONNECT_STATE.CONNECTED
      ) {
        existingSession.state = RECONNECT_STATE.PENDING;
      }

      logToFile(`复用重连会话: ${sessionId}`, "DEBUG");
      this.emit("sessionRegistered", {
        sessionId,
        session: existingSession,
        reused: true,
      });

      if (autoStart && existingSession.state === RECONNECT_STATE.PENDING) {
        const hasPendingTimer = this.reconnectTimers.has(sessionId);
        if (
          !hasPendingTimer &&
          existingSession.state !== RECONNECT_STATE.RECONNECTING
        ) {
          this._ensureReconnectWindowStarted(existingSession);
          void this.scheduleReconnect(existingSession, failureReason);
        }
      }

      return existingSession;
    }

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
      failureReason,
      reconnectWindowStartedAt: null, // 首次进入自动重连窗口的时间（用于总耗时封顶）
      createdAt: Date.now(),
      reconnectHistory: [],
      nextReconnectAt: null,
      pendingReconnectConnection: null,
      disposed: false,
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
      this._ensureReconnectWindowStarted(session);
      void this.scheduleReconnect(session, failureReason);
    }

    return session;
  }

  // 设置连接监听器
  setupConnectionListeners(session) {
    const connection = session.connection;
    if (!connection || typeof connection.on !== "function") {
      logToFile(`跳过注册重连监听(连接对象不可监听): ${session.id}`, "WARN");
      return;
    }

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

  /**
   * 统一处理连接中断事件（error/close/timeout 三类事件的共享守卫与调度序列）
   * @private
   */
  async _handleConnectionInterruption(session, sourceConnection, options) {
    const {
      eventLabel,
      error = null,
      failureReason = null,
      mainLogLevel,
      onIntentionalClose,
      recordPattern = false,
      abandonWhenNotReconnectable = false,
    } = options;

    // 仅处理“当前连接对象”的事件，避免旧连接残留事件干扰
    if (session.connection !== sourceConnection) {
      return;
    }

    if (session.disposed) {
      return;
    }

    if (session.intentionalClose) {
      onIntentionalClose();
      return;
    }

    // 如果已经处于重连中或已放弃，忽略
    if (
      session.state === RECONNECT_STATE.RECONNECTING ||
      session.state === RECONNECT_STATE.ABANDONED ||
      session.state === RECONNECT_STATE.PAUSED
    ) {
      logToFile(
        `忽略${eventLabel}(状态: ${session.state}): ${session.id}${error ? ` - ${error.message}` : ""}`,
        "DEBUG",
      );
      return;
    }

    logToFile(
      error
        ? `${eventLabel} ${session.id}: ${error.message}`
        : `${eventLabel}: ${session.id}`,
      mainLogLevel,
    );

    if (error) {
      session.lastError = error;
    }
    session.state = RECONNECT_STATE.PENDING;

    // 分析/确定错误原因
    const resolvedFailureReason =
      failureReason || this.analyzeFailureReason(error);
    session.failureReason = resolvedFailureReason;

    if (recordPattern) {
      this._ensureReconnectWindowStarted(session);

      // 记录失败模式
      try {
        this.recordFailurePattern(session.id, resolvedFailureReason);
      } catch (patternErr) {
        // 失败模式统计不应影响断线/重连主流程
        logToFile(
          `记录失败模式异常(已忽略): ${session.id} - ${patternErr?.message || patternErr}`,
          "WARN",
        );
      }
    }

    // 决定是否需要重连
    if (this.shouldReconnect(session, resolvedFailureReason)) {
      this._ensureReconnectWindowStarted(session);
      await this.scheduleReconnect(session, resolvedFailureReason);
    } else if (abandonWhenNotReconnectable) {
      this.abandonReconnection(session, "不满足重连条件");
    }
  }

  // 处理连接错误
  async handleConnectionError(session, error, sourceConnection) {
    return this._handleConnectionInterruption(session, sourceConnection, {
      eventLabel: "连接错误",
      error,
      mainLogLevel: "ERROR",
      onIntentionalClose: () => {
        logToFile(`忽略主动关闭连接错误: ${session.id}`, "DEBUG");
      },
      recordPattern: true,
      abandonWhenNotReconnectable: true,
    });
  }

  // 处理连接关闭
  async handleConnectionClose(session, sourceConnection) {
    return this._handleConnectionInterruption(session, sourceConnection, {
      eventLabel: "连接关闭",
      failureReason: FAILURE_REASON.NETWORK,
      mainLogLevel: "INFO",
      onIntentionalClose: () => {
        logToFile(`检测到主动关闭连接，清理重连会话: ${session.id}`, "DEBUG");
        this.cancelSession(session.id, "intentional-close");
      },
    });
  }

  // 处理连接超时
  async handleConnectionTimeout(session, sourceConnection) {
    return this._handleConnectionInterruption(session, sourceConnection, {
      eventLabel: "连接超时",
      failureReason: FAILURE_REASON.TIMEOUT,
      mainLogLevel: "WARN",
      onIntentionalClose: () => {
        logToFile(`忽略主动关闭连接超时: ${session.id}`, "DEBUG");
      },
    });
  }

  // 分析失败原因
  analyzeFailureReason(error) {
    return analyzeSshFailureReason(error);
  }

  _ensureReconnectWindowStarted(session) {
    if (!session) return;
    if (!session.reconnectWindowStartedAt) {
      session.reconnectWindowStartedAt = Date.now();
    }
  }

  _getRemainingReconnectWindowMs(session) {
    return getRemainingRetryWindowMs(
      session?.reconnectWindowStartedAt,
      this.config,
    );
  }

  _isReconnectWindowExpired(session) {
    return isRetryWindowExpired(session?.reconnectWindowStartedAt, this.config);
  }

  _getReconnectWindowExpiresAt(session) {
    return getRetryWindowExpiresAt(
      session?.reconnectWindowStartedAt,
      this.config,
    );
  }

  async _checkPreflight(session) {
    return checkSshPreflight(session?.config, this.config);
  }

  _getRetryStrategyFields(session, failureReason = session?.failureReason) {
    const resolvedFailureReason = failureReason || FAILURE_REASON.UNKNOWN;
    const effectiveMaxRetries = this._getMaxRetriesForSession(
      session,
      resolvedFailureReason,
    );

    return {
      failureReason: resolvedFailureReason,
      effectiveMaxRetries,
      windowExpiresAt: this._getReconnectWindowExpiresAt(session),
    };
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
      recentFailures: [],
    };

    existing.total += 1;
    existing.reasons[reason] = (existing.reasons[reason] || 0) + 1;

    // 连续失败统计：同类原因、且时间间隔不太长则计为连续
    const isSameReason = existing.lastReason === reason;
    const isCloseInTime = now - (existing.lastAt || 0) < 5 * 60 * 1000; // 5分钟窗口
    existing.consecutive =
      isSameReason && isCloseInTime ? existing.consecutive + 1 : 1;

    existing.lastReason = reason;
    existing.lastAt = now;

    const recentFailures = Array.isArray(existing.recentFailures)
      ? existing.recentFailures
      : [];
    recentFailures.push({ reason, timestamp: now });
    existing.recentFailures = recentFailures.filter(
      (item) =>
        now - Number(item?.timestamp || 0) <= FAILURE_PATTERN_GUARD.windowMs,
    );

    this.failurePatterns.set(sessionId, existing);
    return existing;
  }

  // 将底层错误映射为用户可理解的提示（详细信息写日志）
  formatReconnectErrorForUser(error, config) {
    const msg = String(error?.message || "");
    const code = String(error?.code || "");
    const isZh = isZhLanguage(config?.language);
    const host = config?.host || (isZh ? "目标主机" : "target host");
    const port = config?.port || 22;

    // 这一类属于开发/内部异常，不应直接暴露给用户
    if (msg.includes("is not a function") || msg.includes("undefined")) {
      return isZh
        ? "连接发生异常并已断开，自动重连失败。请重试连接，或查看日志获取详细信息。"
        : "The connection failed due to an internal error and automatic reconnect failed. Retry the connection or check logs for details.";
    }

    // SSH2 常见错误映射
    if (msg.includes("All configured authentication methods failed")) {
      return isZh
        ? "SSH 认证失败：请检查用户名/密码/私钥与权限设置。"
        : "SSH authentication failed. Check username, password, private key, and permission settings.";
    }
    if (code === "EPROXYUNAVAILABLE" || msg.includes("proxy")) {
      return isZh
        ? "代理不可用：请检查本地代理/VPN是否已启动，并确认代理地址与端口可访问。"
        : "Proxy unavailable. Check whether the local proxy/VPN is running and whether the proxy address and port are reachable.";
    }
    if (code === "ECONNREFUSED" || msg.includes("connect ECONNREFUSED")) {
      return isZh
        ? `连接被拒绝：无法连接到 ${host}:${port}。请检查端口、服务状态与防火墙。`
        : `Connection refused: cannot connect to ${host}:${port}. Check the port, service status, and firewall.`;
    }
    if (code === "ENOTFOUND" || msg.includes("getaddrinfo ENOTFOUND")) {
      return isZh
        ? `主机名无法解析：${host}。请检查主机名/DNS/网络。`
        : `Hostname could not be resolved: ${host}. Check hostname, DNS, and network.`;
    }
    if (code === "ETIMEDOUT" || msg.toLowerCase().includes("timeout")) {
      return isZh
        ? `连接超时：${host}:${port}。请检查网络质量或服务器负载。`
        : `Connection timed out: ${host}:${port}. Check network quality or server load.`;
    }
    if (code === "ECONNRESET" || msg.includes("ECONNRESET")) {
      return isZh
        ? "连接被远端重置：网络不稳定或服务器主动断开。"
        : "Connection reset by remote host. The network may be unstable or the server disconnected.";
    }
    if (code === "EPIPE" || msg.includes("EPIPE")) {
      return isZh
        ? "连接管道已关闭：网络不稳定或会话被中止。"
        : "Connection pipe closed. The network may be unstable or the session was interrupted.";
    }

    return isZh
      ? "连接已断开，自动重连失败，请重新连接。"
      : "Connection disconnected and automatic reconnect failed. Please reconnect.";
  }

  _shouldStopReconnectByFailurePattern(session, failureReason, maxRetries = 0) {
    const pattern = this.failurePatterns.get(session?.id);
    if (!pattern) {
      return false;
    }

    const now = Date.now();
    const reason = failureReason || FAILURE_REASON.UNKNOWN;
    const recentFailures = Array.isArray(pattern.recentFailures)
      ? pattern.recentFailures.filter(
          (item) =>
            now - Number(item?.timestamp || 0) <=
            FAILURE_PATTERN_GUARD.windowMs,
        )
      : [];

    pattern.recentFailures = recentFailures;
    this.failurePatterns.set(session.id, pattern);

    let sameReasonConsecutive = 0;
    for (let i = recentFailures.length - 1; i >= 0; i -= 1) {
      if (recentFailures[i].reason !== reason) {
        break;
      }
      sameReasonConsecutive += 1;
    }

    const guardThreshold = Math.max(
      FAILURE_PATTERN_GUARD.maxConsecutive,
      Number.isFinite(maxRetries) && maxRetries > 0 ? maxRetries + 1 : 0,
    );

    if (sameReasonConsecutive >= guardThreshold) {
      logToFile(
        `停止自动重连(短时同类连续失败): ${session.id}, 原因=${reason}, 2分钟内连续 ${sameReasonConsecutive} 次(阈值 ${guardThreshold} 次)`,
        "WARN",
      );
      return true;
    }

    return false;
  }

  // 判断是否应该重连
  shouldReconnect(session, failureReason) {
    // 认证失败默认不重连（除非会话/全局显式开启）
    if (failureReason === FAILURE_REASON.AUTHENTICATION) {
      const enabled =
        Boolean(session?.config?.retryOnAuthFailure) ||
        Boolean(this.config?.authFailure?.enabled);
      if (!enabled) {
        logToFile(`认证失败，不进行重连: ${session.id}`, "WARN");
        return false;
      }
    }

    // 资源限制不重连
    if (failureReason === FAILURE_REASON.RESOURCE) {
      logToFile(`资源限制，不进行重连: ${session.id}`, "WARN");
      return false;
    }

    const maxRetries = this._getMaxRetriesForSession(session, failureReason);

    // maxRetries <= 0 表示该原因不允许重连
    if (maxRetries <= 0) {
      logToFile(`不满足重连条件(禁止该原因重连): ${session.id}`, "WARN");
      return false;
    }

    // 检查重试次数
    if (session.retryCount >= maxRetries) {
      logToFile(`达到最大重试次数(${maxRetries}次): ${session.id}`, "WARN");
      return false;
    }

    if (
      this._shouldStopReconnectByFailurePattern(
        session,
        failureReason,
        maxRetries,
      )
    ) {
      return false;
    }

    return true;
  }

  _getMaxRetriesForSession(session, failureReason) {
    return getEffectiveMaxRetries(this.config, session?.config, failureReason);
  }

  /**
   * 窗口过期或超过最大重试次数时终止重连（abandon + emit reconnectFailed）
   * @returns {boolean} 是否已终止
   * @private
   */
  _abandonIfExpired(session, maxRetries, strategyFields) {
    // 总耗时封顶：到期则停止自动重连
    if (this._isReconnectWindowExpired(session)) {
      session.isReconnecting = false;
      this.abandonReconnection(
        session,
        `自动重连超时(>${this.config.totalTimeCapMs}ms)`,
      );
      this.emit("reconnectFailed", {
        sessionId: session.id,
        error: buildReconnectTimeoutMessage(
          this.config,
          session?.config?.language,
        ),
        attempts: session.retryCount,
        maxRetries,
        ...strategyFields,
      });
      return true;
    }

    if (session.retryCount + 1 > maxRetries) {
      session.isReconnecting = false;
      this.abandonReconnection(session, `达到最大重试次数(${maxRetries}次)`);
      this.emit("reconnectFailed", {
        sessionId: session.id,
        error: buildMaxRetriesMessage(maxRetries, session?.config?.language),
        attempts: session.retryCount,
        maxRetries,
        ...strategyFields,
      });
      return true;
    }

    return false;
  }

  // 计划重连 - 使用指数退避算法
  async scheduleReconnect(session, failureReason) {
    this._ensureReconnectWindowStarted(session);
    session.failureReason = failureReason;
    const maxRetries = this._getMaxRetriesForSession(session, failureReason);
    const strategyFields = this._getRetryStrategyFields(session, failureReason);

    if (this._abandonIfExpired(session, maxRetries, strategyFields)) {
      return;
    }

    const nextAttempt = session.retryCount + 1;

    // 计算延迟时间
    let delay = calculateRetryDelay({
      retryConfig: this.config,
      attempt: nextAttempt,
      lastError: session.lastError,
      successRate: this.calculateSuccessRate(session),
    });

    // 总耗时封顶：确保延迟不会把执行时间推到窗口之外
    const remainingMs = this._getRemainingReconnectWindowMs(session);
    if (Number.isFinite(remainingMs)) {
      delay = Math.min(delay, remainingMs);
    }

    // 加入重连队列
    const reconnectTask = {
      sessionId: session.id,
      scheduledAt: Date.now(),
      executeAt: Date.now() + delay,
      failureReason,
      retryCount: nextAttempt,
      delay,
    };

    if (!this.reconnectQueues.has(session.id)) {
      this.reconnectQueues.set(session.id, []);
    }
    this.reconnectQueues.get(session.id).push(reconnectTask);

    logToFile(
      `计划重连: ${session.id}, 延迟 ${delay}ms (指数退避), 第 ${nextAttempt}/${maxRetries} 次尝试`,
      "INFO",
    );

    session.state = RECONNECT_STATE.PENDING;
    session.isReconnecting = false;

    // 取消之前的定时器（如果存在）
    this.cancelPendingReconnect(session.id);

    // 执行重连，保存定时器引用以便后续取消
    const timerId = setTimeout(() => {
      this.reconnectTimers.delete(session.id);
      this.executeReconnect(session, failureReason);
    }, delay);
    this.reconnectTimers.set(session.id, timerId);
    session.nextReconnectAt = reconnectTask.executeAt;

    this.emit("reconnectScheduled", {
      sessionId: session.id,
      delay,
      retryCount: session.retryCount,
      completedAttempts: session.retryCount,
      nextAttempt,
      maxRetries,
      ...strategyFields,
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

    const session = this.sessions.get(sessionId);
    if (session) {
      session.nextReconnectAt = null;
    }
  }

  _shouldAbortReconnect(session) {
    return (
      !session ||
      session.disposed === true ||
      session.intentionalClose === true ||
      session.state === RECONNECT_STATE.ABANDONED ||
      session.state === RECONNECT_STATE.PAUSED ||
      !this.sessions.has(session.id) ||
      this.sessions.get(session.id) !== session
    );
  }

  _cleanupReconnectConnection(handle, reason = "unknown") {
    if (!handle || typeof handle.cleanup !== "function") {
      return;
    }

    try {
      handle.cleanup(reason);
    } catch (error) {
      logToFile(
        `清理重连临时连接异常(已忽略): ${reason} - ${error?.message || error}`,
        "WARN",
      );
    }
  }

  _clearPendingReconnectConnection(session, reason = "unknown") {
    if (!session?.pendingReconnectConnection) {
      return;
    }

    const pendingConnection = session.pendingReconnectConnection;
    session.pendingReconnectConnection = null;
    this._cleanupReconnectConnection(pendingConnection, reason);
  }

  // 执行重连
  async executeReconnect(session, failureReason = FAILURE_REASON.NETWORK) {
    this._ensureReconnectWindowStarted(session);
    session.failureReason = failureReason;
    const maxRetries = this._getMaxRetriesForSession(session, failureReason);
    const strategyFields = this._getRetryStrategyFields(session, failureReason);

    // 检查是否应该跳过本次重连（已放弃/已暂停）
    if (
      session.state === RECONNECT_STATE.ABANDONED ||
      session.state === RECONNECT_STATE.PAUSED
    ) {
      logToFile(`跳过重连(状态=${session.state}): ${session.id}`, "DEBUG");
      return;
    }

    // 检查是否正在重连中（防止并发重连）
    if (session.state === RECONNECT_STATE.RECONNECTING) {
      logToFile(`跳过重连(正在重连中): ${session.id}`, "DEBUG");
      return;
    }

    if (this._abandonIfExpired(session, maxRetries, strategyFields)) {
      return;
    }

    const attemptNumber = session.retryCount + 1;
    session.retryCount = attemptNumber;
    session.lastAttempt = Date.now();
    session.state = RECONNECT_STATE.RECONNECTING;
    session.isReconnecting = true; // 标记正在重连
    session.nextReconnectAt = null;

    logToFile(
      `开始重连: ${session.id} (第 ${session.retryCount}/${maxRetries} 次)`,
      "INFO",
    );
    this.emit("reconnectStarted", {
      sessionId: session.id,
      attempt: session.retryCount,
      maxRetries,
      ...strategyFields,
    });

    this.statistics.totalAttempts++;

    let newConnection = null;
    let newConnectionAdopted = false;

    try {
      const attemptNumber = session.retryCount;
      const preflight = await this._checkPreflight(session);
      if (!preflight?.ok) {
        const preflightError = new Error(preflight?.message || "连接预检失败");
        if (preflight?.code) {
          preflightError.code = preflight.code;
        }
        if (preflight?.failureReason) {
          preflightError.failureReason = preflight.failureReason;
        }
        throw preflightError;
      }

      // 创建新连接
      newConnection = await this.createNewConnection(session.config);
      session.pendingReconnectConnection = newConnection;

      if (this._shouldAbortReconnect(session)) {
        session.isReconnecting = false;
        this._clearPendingReconnectConnection(
          session,
          "reconnect-aborted-before-validate",
        );
        return;
      }

      // 验证连接
      const isValid = await this.validateConnection(newConnection);
      if (!isValid) {
        throw new Error("连接验证失败");
      }

      if (this._shouldAbortReconnect(session)) {
        session.isReconnecting = false;
        this._clearPendingReconnectConnection(
          session,
          "reconnect-aborted-before-replace",
        );
        return;
      }

      // 替换旧连接
      await this.replaceConnection(session, newConnection);
      newConnectionAdopted = true;
      session.pendingReconnectConnection = null;

      // 重连成功 - 取消所有待执行的重连任务
      this.cancelPendingReconnect(session.id);

      // 重连成功
      session.state = RECONNECT_STATE.CONNECTED;
      session.retryCount = 0;
      session.lastError = null;
      session.failureReason = null;
      session.isReconnecting = false; // 清除重连标记
      session.reconnectWindowStartedAt = null; // 成功后清空窗口，下次断线重新计时

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
      const successPayload = {
        sessionId: session.id,
        attempts: attemptNumber,
        ...strategyFields,
      };
      this.emit("reconnectSuccess", successPayload);
      this.emit("reconnectSessionRestoreReady", successPayload);
    } catch (error) {
      if (newConnection && !newConnectionAdopted) {
        if (session?.pendingReconnectConnection === newConnection) {
          session.pendingReconnectConnection = null;
        }
        this._cleanupReconnectConnection(
          newConnection,
          `reconnect-attempt-failed:${error?.message || error}`,
        );
      }

      // 重连过程中再次检查状态，避免在连接已成功时报告错误
      if (session.state === RECONNECT_STATE.CONNECTED) {
        logToFile(`重连异常被忽略(连接已成功): ${session.id}`, "DEBUG");
        return;
      }

      if (this._shouldAbortReconnect(session)) {
        session.isReconnecting = false;
        return;
      }

      logToFile(
        `重连失败: ${session.id} - ${error.message} (第 ${session.retryCount}/${maxRetries} 次)`,
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
      const nextFailureReason = this.analyzeFailureReason(error);
      session.failureReason = nextFailureReason;
      try {
        this.recordFailurePattern(session.id, nextFailureReason);
      } catch (patternErr) {
        logToFile(
          `记录失败模式异常(已忽略): ${session.id} - ${patternErr?.message || patternErr}`,
          "WARN",
        );
      }

      if (this.shouldReconnect(session, nextFailureReason)) {
        // 继续重试，不发送失败事件（避免触发错误通知）
        await this.scheduleReconnect(session, nextFailureReason);
      } else {
        // 达到最大重试次数，清除重连标记并发送失败事件
        session.isReconnecting = false;

        this.abandonReconnection(
          session,
          `达到最大重试次数(${maxRetries}次)或不满足重连条件`,
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
          maxRetries,
          ...this._getRetryStrategyFields(session, nextFailureReason),
        });
      }
    }
  }

  // 创建新连接
  async createNewConnection(config) {
    return createManagedSshConnection(config);
  }

  /**
   * 带超时的连接探测包装：runner 收到 finish(ok) 回调，超时或同步异常均视为失败
   * @private
   */
  _probeWithTimeout(runner, timeoutMs) {
    return new Promise((resolve) => {
      let finished = false;
      let timeoutId = null;
      const finish = (ok) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeoutId);
        resolve(ok);
      };
      timeoutId = setTimeout(() => finish(false), timeoutMs);

      try {
        runner(finish);
      } catch {
        finish(false);
      }
    });
  }

  // 验证连接
  async validateConnection(connection) {
    const client = connection?.client || connection;
    const timeoutMs = 3000;

    const tryExec = () =>
      this._probeWithTimeout((finish) => {
        // 执行简单命令测试连接
        client.exec("echo test", (err, stream) => {
          if (err) {
            finish(false);
            return;
          }

          stream.on("data", () => finish(true));
          stream.on("error", () => finish(false));
          stream.on("close", () => finish(false));
        });
      }, timeoutMs);

    const trySftp = () =>
      this._probeWithTimeout((finish) => {
        client.sftp((err, sftp) => {
          if (err) {
            finish(false);
            return;
          }

          try {
            if (sftp && typeof sftp.end === "function") {
              sftp.end();
            }
          } catch {
            /* intentionally ignored */
          }

          finish(true);
        });
      }, timeoutMs);

    const tryShell = () =>
      this._probeWithTimeout((finish) => {
        client.shell((err, stream) => {
          if (err) {
            finish(false);
            return;
          }

          try {
            if (stream && typeof stream.close === "function") {
              stream.close();
            }
          } catch {
            /* intentionally ignored */
          }

          finish(true);
        });
      }, timeoutMs);

    if (await tryExec()) return true;
    if (await trySftp()) return true;
    return await tryShell();
  }

  // 替换连接
  async replaceConnection(session, newConnection) {
    if (!session || !newConnection) {
      return;
    }

    const nextConnection = newConnection.client || newConnection;
    if (
      typeof newConnection.isClosed === "function" &&
      newConnection.isClosed()
    ) {
      throw new Error("重连连接在接管前已关闭");
    }

    if (this.replacingSessions.has(session.id)) {
      logToFile(`跳过并发连接替换: ${session.id}`, "DEBUG");
      return;
    }

    this.replacingSessions.add(session.id);
    const oldConnection = session.connection;

    if (oldConnection === nextConnection) {
      this.replacingSessions.delete(session.id);
      return;
    }

    try {
      // 移除旧连接的监听器
      if (
        oldConnection &&
        typeof oldConnection.removeAllListeners === "function"
      ) {
        oldConnection.removeAllListeners();
      }

      if (typeof newConnection.claim === "function") {
        newConnection.claim();
      }

      // 设置新连接
      session.connection = nextConnection;

      // 设置新连接的监听器
      this.setupConnectionListeners(session);

      if (typeof newConnection.adopt === "function") {
        newConnection.adopt();
      }

      // 尝试优雅关闭旧连接
      try {
        if (oldConnection && typeof oldConnection.end === "function") {
          oldConnection.end();
        }
      } catch {
        // 忽略关闭错误
      }

      this.emit("connectionReplaced", {
        sessionId: session.id,
        newConnection: nextConnection,
      });
    } finally {
      this.replacingSessions.delete(session.id);
    }
  }

  // 放弃重连
  abandonReconnection(session, reason) {
    // 先取消待执行的重连任务
    this.cancelPendingReconnect(session.id);

    session.state = RECONNECT_STATE.ABANDONED;
    const strategyFields = this._getRetryStrategyFields(
      session,
      session.failureReason,
    );

    logToFile(`放弃重连 ${session.id}: ${reason}`, "WARN");

    this.emit("reconnectAbandoned", {
      sessionId: session.id,
      reason,
      attempts: session.retryCount,
      maxRetries: this.config.maxRetries,
      ...strategyFields,
    });

    // 清理会话
    this.cleanupSession(session.id);
  }

  /**
   * 会话销毁的公共清理序列（差异动作：日志、连接关闭等留在调用方）
   * @private
   */
  _teardownSession(session, reason) {
    session.disposed = true;
    session.isReconnecting = false;
    session.nextReconnectAt = null;

    // 取消待执行的重连任务
    this.cancelPendingReconnect(session.id);

    // 清理重连阶段新建但尚未接管的连接
    this._clearPendingReconnectConnection(session, reason);

    // 移除记录
    this.sessions.delete(session.id);
    this.reconnectQueues.delete(session.id);
    this.failurePatterns.delete(session.id);
    this.replacingSessions.delete(session.id);
  }

  // 清理会话
  cleanupSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    this._teardownSession(session, "cleanup-session");

    // 关闭连接
    try {
      session.connection.end();
    } catch {
      // 忽略错误
    }

    logToFile(`清理重连会话: ${sessionId}`, "DEBUG");
  }

  cancelSession(sessionId, reason = "cancel-session") {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.intentionalClose = true;
    session.state = RECONNECT_STATE.IDLE;
    session.lastError = null;
    session.failureReason = null;

    this._teardownSession(session, reason);

    logToFile(`取消重连会话: ${sessionId}, reason=${reason}`, "DEBUG");
    return true;
  }

  // 公共接口
  getSessionStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }

    const strategyFields = this._getRetryStrategyFields(
      session,
      session.failureReason,
    );

    return {
      id: session.id,
      state: session.state,
      retryCount: session.retryCount,
      maxRetries: this.config.maxRetries,
      ...strategyFields,
      nextReconnectAt: session.nextReconnectAt,
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
      totalTimeCapMs: this.config.totalTimeCapMs,
      reconnectStrategy: this.config.useExponentialBackoff
        ? "exponential_backoff"
        : "fixed",
      reconnectDelayRange: this.config.useExponentialBackoff
        ? `${this.config.initialDelay}ms - ${this.config.maxDelay}ms`
        : `${this.config.initialDelay}ms`,
    };
  }

  /**
   * 请求自动重连（与状态机合并，避免重复触发）
   * - 若当前会话已在 pending/reconnecting，则不会重复安排
   * - 若当前会话处于 connected，但上层判断连接不健康，可调用此方法触发一次自动重连
   */
  async requestAutoReconnect(
    sessionId,
    failureReason = FAILURE_REASON.NETWORK,
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${sessionId}`);
    }

    this._ensureReconnectWindowStarted(session);
    session.failureReason = failureReason;

    if (
      session.state === RECONNECT_STATE.RECONNECTING ||
      session.state === RECONNECT_STATE.PENDING ||
      session.state === RECONNECT_STATE.PAUSED
    ) {
      return;
    }

    session.intentionalClose = false;
    session.state = RECONNECT_STATE.PENDING;
    await this.scheduleReconnect(session, failureReason);
  }

  /**
   * 等待一次重连结果（成功/失败/放弃/超时）
   * 供 SFTP 等模块复用 SSH 的重连状态机，避免各自重复重试与刷屏提示。
   */
  waitForReconnect(sessionId, timeoutMs = this.config.totalTimeCapMs) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return Promise.reject(new Error(`会话不存在: ${sessionId}`));
    }

    if (session.state === RECONNECT_STATE.CONNECTED) {
      return Promise.resolve(true);
    }

    const remainingWindow = this._getRemainingReconnectWindowMs(session);
    const effectiveTimeout = Math.min(
      Number(timeoutMs || 0) || remainingWindow,
      remainingWindow,
    );

    return new Promise((resolve, reject) => {
      let finished = false;
      let timeoutId = null;

      const cleanup = () => {
        this.removeListener("reconnectSuccess", onSuccess);
        this.removeListener("reconnectFailed", onFailed);
        this.removeListener("reconnectAbandoned", onAbandoned);
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const finishResolve = () => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(true);
      };

      const finishReject = (err) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(err);
      };

      const onSuccess = ({ sessionId: sid }) => {
        if (sid === sessionId) finishResolve();
      };

      const onFailed = ({ sessionId: sid, error }) => {
        if (sid === sessionId) {
          finishReject(
            new Error(
              error ||
                (isZhLanguage(session?.config?.language)
                  ? "自动重连失败"
                  : "Automatic reconnect failed"),
            ),
          );
        }
      };

      const onAbandoned = ({ sessionId: sid, reason }) => {
        if (sid === sessionId)
          finishReject(
            new Error(
              reason ||
                (isZhLanguage(session?.config?.language)
                  ? "自动重连已放弃"
                  : "Automatic reconnect abandoned"),
            ),
          );
      };

      this.on("reconnectSuccess", onSuccess);
      this.on("reconnectFailed", onFailed);
      this.on("reconnectAbandoned", onAbandoned);

      if (Number.isFinite(effectiveTimeout) && effectiveTimeout > 0) {
        timeoutId = setTimeout(() => {
          finishReject(
            new Error(
              buildReconnectTimeoutMessage(
                this.config,
                session?.config?.language,
              ),
            ),
          );
        }, effectiveTimeout);
      }
    });
  }

  // 暂停重连
  pauseReconnection(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        sessionId,
        state: null,
        error: `会话不存在: ${sessionId}`,
      };
    }

    const previousState = session.state;
    if (
      previousState !== RECONNECT_STATE.PENDING &&
      previousState !== RECONNECT_STATE.RECONNECTING
    ) {
      return {
        success: false,
        sessionId,
        state: previousState,
        error: `当前状态不可暂停: ${previousState}`,
      };
    }

    this.cancelPendingReconnect(sessionId);
    this._clearPendingReconnectConnection(session, "pause-reconnect");
    session.state = RECONNECT_STATE.PAUSED;
    session.isReconnecting = false;
    session.failureReason = session.failureReason || FAILURE_REASON.NETWORK;
    logToFile(`暂停重连: ${sessionId}`, "INFO");

    return {
      success: true,
      sessionId,
      previousState,
      state: session.state,
    };
  }

  // 恢复重连
  resumeReconnection(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        sessionId,
        state: null,
        error: `会话不存在: ${sessionId}`,
      };
    }

    const previousState = session.state;
    if (previousState !== RECONNECT_STATE.PAUSED) {
      return {
        success: false,
        sessionId,
        state: previousState,
        error: `当前状态不可恢复: ${previousState}`,
      };
    }

    session.state = RECONNECT_STATE.PENDING;
    session.retryCount = 0;
    session.reconnectWindowStartedAt = Date.now();
    session.failureReason = FAILURE_REASON.NETWORK;
    void this.scheduleReconnect(session, FAILURE_REASON.NETWORK);
    logToFile(`恢复重连: ${sessionId}`, "INFO");

    return {
      success: true,
      sessionId,
      previousState,
      state: session.state,
    };
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
