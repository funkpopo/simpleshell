const { ipcMain } = require("electron");
const { logToFile } = require("../../utils/logger");
const { safeHandle } = require("../ipcResponse");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
} = require("../schema/channels");
const { isZhLanguage } = require("../../../shared/connectionErrorAdvice");
const { extractTabIdFromSessionKey } = require("../../utils/ssh-utils");
const { broadcastToAllWindows } = require("../../window/windowManager");

// 存储重连事件监听器
const reconnectListeners = new Map();
let boundConnectionPool = null;
let boundReconnectionManager = null;
const recentReconnectTerminalEvents = new Map();

const DUPLICATE_TERMINAL_EVENT_TTL_MS = 3000;

function getSessionLanguage(reconnectionManager, sessionId) {
  if (!reconnectionManager || !sessionId) {
    return "zh-CN";
  }
  const session =
    reconnectionManager.sessions?.get?.(sessionId) ||
    reconnectionManager.getSessionStatus?.(sessionId);
  return session?.config?.language || "zh-CN";
}

function getDefaultReconnectHint(language) {
  if (!isZhLanguage(language)) {
    return "Check proxy/VPN/network and refresh or reopen the connection.";
  }
  return "请检查代理/VPN和网络后刷新或重新打开连接。";
}

function resolveMaxAttempts(reconnectionManager, sessionId, fallback = null) {
  if (Number.isFinite(fallback)) {
    return fallback;
  }
  if (!reconnectionManager || !sessionId) {
    return null;
  }
  const status = reconnectionManager.getSessionStatus?.(sessionId);
  const maxRetries = Number(status?.effectiveMaxRetries ?? status?.maxRetries);
  return Number.isFinite(maxRetries) ? maxRetries : null;
}

function normalizeReconnectPayload(
  reconnectionManager,
  payload = {},
  options = {},
) {
  const sessionId = payload.sessionId || options.sessionId || null;
  const attemptsValue =
    payload.attempts ??
    payload.completedAttempts ??
    payload.retryCount ??
    payload.attempt ??
    0;
  const maxAttemptsValue =
    payload.maxAttempts ??
    payload.effectiveMaxRetries ??
    payload.maxRetries ??
    null;
  const normalized = {
    tabId: extractTabIdFromSessionId(sessionId),
    sessionId,
    attempts: Number.isFinite(Number(attemptsValue))
      ? Number(attemptsValue)
      : 0,
    maxAttempts: resolveMaxAttempts(
      reconnectionManager,
      sessionId,
      Number(maxAttemptsValue),
    ),
    error:
      payload.error === undefined || payload.error === null
        ? null
        : String(payload.error),
  };

  if (payload.failureReason !== undefined) {
    normalized.failureReason =
      payload.failureReason === null ? null : String(payload.failureReason);
  }
  if (payload.windowExpiresAt !== undefined) {
    const windowExpiresAt = Number(payload.windowExpiresAt);
    normalized.windowExpiresAt = Number.isFinite(windowExpiresAt)
      ? windowExpiresAt
      : null;
  }
  if (payload.nextReconnectAt !== undefined) {
    const nextReconnectAt = Number(payload.nextReconnectAt);
    normalized.nextReconnectAt = Number.isFinite(nextReconnectAt)
      ? nextReconnectAt
      : null;
  }

  if (payload.reason !== undefined) {
    normalized.reason = payload.reason;
  }
  if (payload.delay !== undefined) {
    normalized.delay = payload.delay;
  }
  if (options.hint) {
    normalized.hint = options.hint;
  }

  return normalized;
}

function shouldSkipDuplicateTerminalEvent(channel, payload) {
  if (
    channel !== IPC_EVENT_CHANNELS.RECONNECT_FAILED &&
    channel !== IPC_EVENT_CHANNELS.RECONNECT_ABANDONED
  ) {
    return false;
  }

  const signature = `${channel}|${payload.sessionId}|${payload.attempts}|${payload.error}`;
  const now = Date.now();
  const lastAt = recentReconnectTerminalEvents.get(signature);
  if (lastAt && now - lastAt < DUPLICATE_TERMINAL_EVENT_TTL_MS) {
    return true;
  }

  recentReconnectTerminalEvents.set(signature, now);
  return false;
}

/**
 * 注册"暂停/恢复重连"这类同构的切换处理器
 * @param {Object} connectionPool - SSH连接池
 * @param {string} channel - IPC请求channel
 * @param {string} methodName - reconnectionManager 上调用的方法名
 * @param {string} notAppliedError - 操作未生效时的默认错误文案
 */
function registerReconnectToggleHandler(
  connectionPool,
  channel,
  methodName,
  notAppliedError,
) {
  safeHandle(
    ipcMain,
    channel,
    async (event, { tabId }) => {
      const connectionKey = connectionPool.getConnectionKeyByTabId(tabId);
      if (!connectionKey || !connectionPool.reconnectionManager) {
        throw new Error("连接未找到");
      }
      const result =
        connectionPool.reconnectionManager[methodName](connectionKey);
      if (result?.success !== true) {
        throw new Error(result?.error || notAppliedError);
      }
      return {
        success: true,
        connectionKey,
        state: result?.state || null,
        previousState: result?.previousState || null,
        error: null,
      };
    },
    { category: "reconnect" },
  );
}

/**
 * 重连事件转发表
 * mapPayload: 由事件数据构造广播载荷
 * dedupe: 是否跳过重复的终端事件
 * skipLog: 跳过重复事件时的DEBUG日志
 * emitLog: 广播前的日志（{ message, level }），可选
 */
const RECONNECT_EVENT_FORWARDERS = [
  {
    event: "reconnectStarted",
    channel: IPC_EVENT_CHANNELS.RECONNECT_STARTED,
    mapPayload: ({
      sessionId,
      attempt,
      maxRetries,
      failureReason,
      effectiveMaxRetries,
      windowExpiresAt,
    }) =>
      normalizeReconnectPayload(boundReconnectionManager, {
        sessionId,
        attempts: attempt,
        failureReason,
        effectiveMaxRetries,
        windowExpiresAt,
        maxAttempts: maxRetries,
        error: null,
      }),
  },
  {
    event: "reconnectScheduled",
    channel: IPC_EVENT_CHANNELS.RECONNECT_PROGRESS,
    mapPayload: ({
      sessionId,
      delay,
      retryCount,
      maxRetries,
      failureReason,
      effectiveMaxRetries,
      windowExpiresAt,
    }) =>
      normalizeReconnectPayload(boundReconnectionManager, {
        sessionId,
        attempts: retryCount,
        failureReason,
        effectiveMaxRetries,
        windowExpiresAt,
        maxAttempts: maxRetries,
        delay,
        error: null,
      }),
  },
  {
    event: "reconnectSuccess",
    channel: IPC_EVENT_CHANNELS.RECONNECT_SUCCESS,
    mapPayload: ({
      sessionId,
      attempts,
      maxRetries,
      failureReason,
      effectiveMaxRetries,
      windowExpiresAt,
    }) =>
      normalizeReconnectPayload(boundReconnectionManager, {
        sessionId,
        attempts,
        failureReason,
        effectiveMaxRetries,
        windowExpiresAt,
        maxAttempts: maxRetries,
        error: null,
      }),
    emitLog: (payload) => ({
      message: `重连成功通知前端: tabId=${payload.tabId}, attempts=${payload.attempts}`,
      level: "INFO",
    }),
  },
  {
    event: "reconnectFailed",
    channel: IPC_EVENT_CHANNELS.RECONNECT_FAILED,
    mapPayload: ({
      sessionId,
      error,
      attempts,
      maxRetries,
      failureReason,
      effectiveMaxRetries,
      windowExpiresAt,
    }) =>
      normalizeReconnectPayload(
        boundReconnectionManager,
        {
          sessionId,
          attempts,
          failureReason,
          effectiveMaxRetries,
          windowExpiresAt,
          maxAttempts: maxRetries,
          error,
        },
        {
          hint: getDefaultReconnectHint(
            getSessionLanguage(boundReconnectionManager, sessionId),
          ),
        },
      ),
    dedupe: true,
    skipLog: (payload) =>
      `跳过重复重连失败广播: tabId=${payload.tabId}, attempts=${payload.attempts}`,
    emitLog: (payload) => ({
      message: `重连失败通知前端: tabId=${payload.tabId}, error=${payload.error}`,
      level: "ERROR",
    }),
  },
  {
    event: "reconnectAbandoned",
    channel: IPC_EVENT_CHANNELS.RECONNECT_ABANDONED,
    mapPayload: ({
      sessionId,
      reason,
      error,
      attempts,
      maxRetries,
      failureReason,
      effectiveMaxRetries,
      windowExpiresAt,
    }) => {
      const language = getSessionLanguage(boundReconnectionManager, sessionId);
      const finalError =
        error ||
        reason ||
        (isZhLanguage(language)
          ? "自动重连已放弃"
          : "Automatic reconnect abandoned");
      return normalizeReconnectPayload(
        boundReconnectionManager,
        {
          sessionId,
          attempts,
          failureReason,
          effectiveMaxRetries,
          windowExpiresAt,
          maxAttempts: maxRetries,
          error: finalError,
          reason,
        },
        { hint: getDefaultReconnectHint(language) },
      );
    },
    dedupe: true,
    skipLog: (payload) =>
      `跳过重复重连放弃广播: tabId=${payload.tabId}, attempts=${payload.attempts}`,
    emitLog: (payload) => ({
      message: `重连放弃通知前端: tabId=${payload.tabId}, reason=${payload.error}`,
      level: "WARN",
    }),
  },
];

// 注册重连相关的IPC处理器
function registerReconnectHandlers(connectionPool) {
  if (!connectionPool) {
    logToFile("registerReconnectHandlers: connectionPool 不可用", "WARN");
    return;
  }

  // 防止重复注册导致事件重复广播
  if (
    boundConnectionPool ||
    boundReconnectionManager ||
    reconnectListeners.size > 0
  ) {
    logToFile("检测到重复注册重连处理器，先执行清理", "WARN");
    cleanupReconnectHandlers();
  }

  boundConnectionPool = connectionPool;
  boundReconnectionManager = connectionPool.reconnectionManager || null;

  // 监听重连状态请求
  safeHandle(
    ipcMain,
    IPC_REQUEST_CHANNELS.RECONNECT_GET_STATUS,
    async (_event, { tabId }) => {
      const connectionKey = connectionPool.getConnectionKeyByTabId(tabId);
      if (!connectionKey) {
        return null;
      }

      const status = connectionPool.getConnectionStatus(connectionKey);
      return status?.reconnectStatus || null;
    },
    { category: "reconnect" },
  );

  // 暂停重连
  registerReconnectToggleHandler(
    connectionPool,
    IPC_REQUEST_CHANNELS.RECONNECT_PAUSE,
    "pauseReconnection",
    "重连未暂停",
  );

  // 恢复重连
  registerReconnectToggleHandler(
    connectionPool,
    IPC_REQUEST_CHANNELS.RECONNECT_RESUME,
    "resumeReconnection",
    "重连未恢复",
  );

  // 获取重连统计信息
  safeHandle(
    ipcMain,
    IPC_REQUEST_CHANNELS.RECONNECT_GET_STATISTICS,
    async () => {
      if (connectionPool.reconnectionManager) {
        return connectionPool.reconnectionManager.getStatistics();
      }
      return null;
    },
    { category: "reconnect" },
  );

  // 设置重连事件转发（表驱动）
  if (boundReconnectionManager) {
    RECONNECT_EVENT_FORWARDERS.forEach(
      ({ event, channel, mapPayload, dedupe, skipLog, emitLog }) => {
        const listener = (data) => {
          const payload = mapPayload(data);
          if (dedupe && shouldSkipDuplicateTerminalEvent(channel, payload)) {
            logToFile(skipLog(payload), "DEBUG");
            return;
          }
          if (emitLog) {
            const { message, level } = emitLog(payload);
            logToFile(message, level);
          }
          broadcastToRenderer(channel, {
            ...payload,
            timestamp: Date.now(),
          });
        };
        boundReconnectionManager.on(event, listener);
        reconnectListeners.set(`rm:${event}`, listener);
      },
    );
  }

  // 连接丢失事件（实际由连接池发出，而非 reconnectionManager）
  const onPoolConnectionLost = ({ key }) => {
    const tabId = extractTabIdFromSessionId(key);
    broadcastToRenderer(IPC_EVENT_CHANNELS.CONNECTION_LOST, {
      tabId,
      sessionId: key,
      timestamp: Date.now(),
    });
  };
  connectionPool.on("connectionLost", onPoolConnectionLost);
  reconnectListeners.set("pool:connectionLost", onPoolConnectionLost);
}

// 从sessionId提取tabId（无法解析时回退为原始sessionId）
function extractTabIdFromSessionId(sessionId) {
  // sessionId格式: "tab:tabId:host:port:username"
  return extractTabIdFromSessionKey(sessionId) ?? sessionId;
}

// 广播事件到渲染进程
function broadcastToRenderer(channel, data) {
  broadcastToAllWindows(channel, data);
}

// 清理函数
function cleanupReconnectHandlers() {
  // 移除连接池事件监听器
  if (boundConnectionPool) {
    const onPoolConnectionLost = reconnectListeners.get("pool:connectionLost");
    if (onPoolConnectionLost) {
      boundConnectionPool.removeListener(
        "connectionLost",
        onPoolConnectionLost,
      );
    }
  }

  // 移除重连管理器事件监听器
  if (boundReconnectionManager) {
    RECONNECT_EVENT_FORWARDERS.forEach(({ event }) => {
      const listener = reconnectListeners.get(`rm:${event}`);
      if (listener) {
        boundReconnectionManager.removeListener(event, listener);
      }
    });
  }

  boundConnectionPool = null;
  boundReconnectionManager = null;
  reconnectListeners.clear();
  recentReconnectTerminalEvents.clear();

  // 移除所有IPC处理器
  ipcMain.removeHandler(IPC_REQUEST_CHANNELS.RECONNECT_GET_STATUS);
  ipcMain.removeHandler(IPC_REQUEST_CHANNELS.RECONNECT_PAUSE);
  ipcMain.removeHandler(IPC_REQUEST_CHANNELS.RECONNECT_RESUME);
  ipcMain.removeHandler(IPC_REQUEST_CHANNELS.RECONNECT_GET_STATISTICS);
}

module.exports = {
  registerReconnectHandlers,
  cleanupReconnectHandlers,
};
