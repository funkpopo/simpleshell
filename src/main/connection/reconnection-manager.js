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
const {
  t: mainT,
  normalizeLanguage,
  getUiLanguage,
} = require("../../shared/mainI18n");
const configService = require("../settings/configService");
const createFailurePolicyMethods = require("./reconnect/failurePolicy");
const createReconnectExecutionMethods = require("./reconnect/reconnectExecution");
const createSessionControlsMethods = require("./reconnect/sessionControls");

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
  return mainT("mainProcess.reconnect.maxRetries", {
    lng: normalizeLanguage(language),
    maxRetries,
  });
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
      ? `exponential backoff: ${this.config.initialDelay}ms → ${Math.round(maxDelay)}ms`
      : `fixed interval: ${this.config.initialDelay}ms`;
    logToFile(
      `Reconnect manager initialized (${strategyLabel}, max ${this.config.maxRetries} retries, window ${this.config.totalTimeCapMs}ms)`,
      "INFO",
    );
  }

  // 注册连接会话
  registerSession(sessionId, connection, config, options = {}) {
    if (!sessionId || !connection) {
      throw new Error(
        mainT("mainProcess.reconnect.registerFailed", {
          lng: getUiLanguage(configService),
        }),
      );
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

      logToFile(`Reusing reconnect session: ${sessionId}`, "DEBUG");
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

    logToFile(`Registered reconnect session: ${sessionId}`, "DEBUG");
    this.emit("sessionRegistered", { sessionId, session });

    // 关键：很多场景（例如旧连接的 close 已经触发后才注册）不会再收到旧连接事件，
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
      logToFile(
        `Skip reconnect listeners (connection not observable): ${session.id}`,
        "WARN",
      );
      return;
    }

    // 监听connection error
    connection.on("error", (error) => {
      this.handleConnectionError(session, error, connection);
    });

    // 监听connection close
    connection.on("close", () => {
      this.handleConnectionClose(session, connection);
    });

    // 监听connection timeout
    connection.on("timeout", () => {
      this.handleConnectionTimeout(session, connection);
    });
  }

  /**
   * 运行时更新重连策略配置（设置页网络模式切换）
   */
  updateConfig(config = {}) {
    this.config = buildSshRetryConfig({
      ...this.config,
      ...config,
    });
    logToFile(
      `Reconnect manager config updated (window ${this.config.totalTimeCapMs}ms, max ${this.config.maxRetries}, backoff=${this.config.useExponentialBackoff})`,
      "INFO",
    );
    return this.config;
  }

  // 关闭
  shutdown() {
    // 清理所有会话
    for (const sessionId of this.sessions.keys()) {
      this.cleanupSession(sessionId);
    }

    this.isInitialized = false;
    logToFile("Reconnect manager closed", "INFO");
  }
}

Object.assign(
  ReconnectionManager.prototype,
  createFailurePolicyMethods({
    RECONNECT_STATE,
    FAILURE_REASON,
    FAILURE_PATTERN_GUARD,
    buildMaxRetriesMessage,
    analyzeSshFailureReason,
    buildReconnectTimeoutMessage,
    checkSshPreflight,
    getEffectiveMaxRetries,
    getRemainingRetryWindowMs,
    getRetryWindowExpiresAt,
    isRetryWindowExpired,
    calculateRetryDelay,
    mainT,
    normalizeLanguage,
    logToFile,
  }),
  createReconnectExecutionMethods({
    RECONNECT_STATE,
    FAILURE_REASON,
    createManagedSshConnection,
    mainT,
    normalizeLanguage,
    logToFile,
  }),
  createSessionControlsMethods({
    RECONNECT_STATE,
    FAILURE_REASON,
    buildReconnectTimeoutMessage,
    mainT,
    normalizeLanguage,
    getUiLanguage,
    configService,
    logToFile,
  }),
);

module.exports = ReconnectionManager;
