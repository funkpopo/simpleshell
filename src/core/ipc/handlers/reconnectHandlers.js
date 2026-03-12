const { ipcMain } = require("electron");
const { logToFile } = require("../../utils/logger");
const { safeHandle } = require("../ipcResponse");

// 存储重连事件监听器
const reconnectListeners = new Map();
let boundConnectionPool = null;
let boundReconnectionManager = null;
const recentReconnectTerminalEvents = new Map();

const DEFAULT_RECONNECT_HINT = "请检查代理/VPN和网络后重试，可点击“手动重连”。";
const DUPLICATE_TERMINAL_EVENT_TTL_MS = 3000;

function resolveMaxAttempts(reconnectionManager, sessionId, fallback = null) {
  if (Number.isFinite(fallback)) {
    return fallback;
  }
  if (!reconnectionManager || !sessionId) {
    return null;
  }
  const status = reconnectionManager.getSessionStatus?.(sessionId);
  const maxRetries = Number(status?.maxRetries);
  return Number.isFinite(maxRetries) ? maxRetries : null;
}

function normalizeReconnectPayload(
  reconnectionManager,
  payload = {},
  options = {},
) {
  const sessionId = payload.sessionId || options.sessionId || null;
  const attemptsValue =
    payload.attempts ?? payload.retryCount ?? payload.attempt ?? 0;
  const maxAttemptsValue = payload.maxAttempts ?? payload.maxRetries ?? null;
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
  if (channel !== "reconnect-failed" && channel !== "reconnect-abandoned") {
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
  safeHandle(ipcMain, "get-reconnect-status", async (_event, { tabId }) => {
    const connectionKey = connectionPool.getConnectionKeyByTabId(tabId);
    if (!connectionKey) {
      return null;
    }

    const status = connectionPool.getConnectionStatus(connectionKey);
    return status?.reconnectStatus || null;
  });

  // 手动触发重连
  safeHandle(
    ipcMain,
    "manual-reconnect",
    async (_event, { tabId, sshConfig }) => {
      const connectionKey = connectionPool.getConnectionKeyByTabId(tabId);

      if (!connectionKey) {
        // 如果没有连接，创建新连接
        const newConnection = await connectionPool.getConnection(sshConfig);
        return { success: true, connectionKey: newConnection.key };
      }

      // 如果还未注册重连会话（比如用户在连接正常时点击“手动重连”），先注册但不自动启动
      const existingSession =
        connectionPool.reconnectionManager?.getSessionStatus(connectionKey);
      if (!existingSession) {
        const conn = connectionPool.connections?.get(connectionKey);
        if (conn && conn.client && conn.config) {
          connectionPool.reconnectionManager.registerSession(
            connectionKey,
            conn.client,
            conn.config,
            { autoStart: false, state: "connected" },
          );
        }
      }

      // 触发手动重连
      await connectionPool.reconnectionManager.manualReconnect(connectionKey);
      return { success: true, connectionKey };
    },
  );

  // 暂停重连
  safeHandle(ipcMain, "pause-reconnect", async (event, { tabId }) => {
    const connectionKey = connectionPool.getConnectionKeyByTabId(tabId);
    if (connectionKey && connectionPool.reconnectionManager) {
      connectionPool.reconnectionManager.pauseReconnection(connectionKey);
      return { success: true };
    }
    return { success: false, error: "连接未找到" };
  });

  // 恢复重连
  safeHandle(ipcMain, "resume-reconnect", async (event, { tabId }) => {
    const connectionKey = connectionPool.getConnectionKeyByTabId(tabId);
    if (connectionKey && connectionPool.reconnectionManager) {
      connectionPool.reconnectionManager.resumeReconnection(connectionKey);
      return { success: true };
    }
    return { success: false, error: "连接未找到" };
  });

  // 获取重连统计信息
  safeHandle(ipcMain, "get-reconnect-statistics", async () => {
    if (connectionPool.reconnectionManager) {
      return connectionPool.reconnectionManager.getStatistics();
    }
    return null;
  });

  // 设置重连事件转发
  if (boundReconnectionManager) {
    // 重连开始事件
    const onReconnectStarted = ({ sessionId, attempt, maxRetries }) => {
      const payload = normalizeReconnectPayload(boundReconnectionManager, {
        sessionId,
        attempts: attempt,
        maxAttempts: maxRetries,
        error: null,
      });
      broadcastToRenderer("reconnect-started", {
        ...payload,
        timestamp: Date.now(),
      });
    };
    boundReconnectionManager.on("reconnectStarted", onReconnectStarted);
    reconnectListeners.set("rm:reconnectStarted", onReconnectStarted);

    // 重连进度事件
    const onReconnectScheduled = ({
      sessionId,
      delay,
      retryCount,
      maxRetries,
    }) => {
      const payload = normalizeReconnectPayload(boundReconnectionManager, {
        sessionId,
        attempts: retryCount,
        maxAttempts: maxRetries,
        delay,
        error: null,
      });
      broadcastToRenderer("reconnect-progress", {
        ...payload,
        timestamp: Date.now(),
      });
    };
    boundReconnectionManager.on("reconnectScheduled", onReconnectScheduled);
    reconnectListeners.set("rm:reconnectScheduled", onReconnectScheduled);

    // 重连成功事件
    const onReconnectSuccess = ({ sessionId, attempts, maxRetries }) => {
      const payload = normalizeReconnectPayload(boundReconnectionManager, {
        sessionId,
        attempts,
        maxAttempts: maxRetries,
        error: null,
      });
      logToFile(
        `重连成功通知前端: tabId=${payload.tabId}, attempts=${payload.attempts}`,
        "INFO",
      );

      broadcastToRenderer("reconnect-success", {
        ...payload,
        timestamp: Date.now(),
      });
    };
    boundReconnectionManager.on("reconnectSuccess", onReconnectSuccess);
    reconnectListeners.set("rm:reconnectSuccess", onReconnectSuccess);

    // 重连失败事件
    const onReconnectFailed = ({ sessionId, error, attempts, maxRetries }) => {
      const payload = normalizeReconnectPayload(
        boundReconnectionManager,
        {
          sessionId,
          attempts,
          maxAttempts: maxRetries,
          error,
        },
        { hint: DEFAULT_RECONNECT_HINT },
      );
      if (shouldSkipDuplicateTerminalEvent("reconnect-failed", payload)) {
        logToFile(
          `跳过重复重连失败广播: tabId=${payload.tabId}, attempts=${payload.attempts}`,
          "DEBUG",
        );
        return;
      }

      logToFile(
        `重连失败通知前端: tabId=${payload.tabId}, error=${payload.error}`,
        "ERROR",
      );

      broadcastToRenderer("reconnect-failed", {
        ...payload,
        timestamp: Date.now(),
      });
    };
    boundReconnectionManager.on("reconnectFailed", onReconnectFailed);
    reconnectListeners.set("rm:reconnectFailed", onReconnectFailed);

    // 重连放弃事件
    const onReconnectAbandoned = ({
      sessionId,
      reason,
      error,
      attempts,
      maxRetries,
    }) => {
      const finalError = error || reason || "自动重连已放弃";
      const payload = normalizeReconnectPayload(
        boundReconnectionManager,
        {
          sessionId,
          attempts,
          maxAttempts: maxRetries,
          error: finalError,
          reason,
        },
        { hint: DEFAULT_RECONNECT_HINT },
      );
      if (shouldSkipDuplicateTerminalEvent("reconnect-abandoned", payload)) {
        logToFile(
          `跳过重复重连放弃广播: tabId=${payload.tabId}, attempts=${payload.attempts}`,
          "DEBUG",
        );
        return;
      }

      logToFile(
        `重连放弃通知前端: tabId=${payload.tabId}, reason=${payload.error}`,
        "WARN",
      );

      broadcastToRenderer("reconnect-abandoned", {
        ...payload,
        timestamp: Date.now(),
      });
    };
    boundReconnectionManager.on("reconnectAbandoned", onReconnectAbandoned);
    reconnectListeners.set("rm:reconnectAbandoned", onReconnectAbandoned);
  }

  // 连接丢失事件（实际由连接池发出，而非 reconnectionManager）
  const onPoolConnectionLost = ({ key }) => {
    const tabId = extractTabIdFromSessionId(key);
    broadcastToRenderer("connection-lost", {
      tabId,
      sessionId: key,
      timestamp: Date.now(),
    });
  };
  connectionPool.on("connectionLost", onPoolConnectionLost);
  reconnectListeners.set("pool:connectionLost", onPoolConnectionLost);
}

// 从sessionId提取tabId
function extractTabIdFromSessionId(sessionId) {
  // sessionId格式: "tab:tabId:host:port:username"
  if (sessionId && sessionId.startsWith("tab:")) {
    const parts = sessionId.split(":");
    if (parts.length >= 2) {
      return parts[1];
    }
  }
  return sessionId;
}

// 广播事件到渲染进程
function broadcastToRenderer(channel, data) {
  const { BrowserWindow } = require("electron");
  const windows = BrowserWindow.getAllWindows();

  windows.forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, data);
    }
  });
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
    const reconnectEventBindings = [
      ["reconnectStarted", "rm:reconnectStarted"],
      ["reconnectScheduled", "rm:reconnectScheduled"],
      ["reconnectSuccess", "rm:reconnectSuccess"],
      ["reconnectFailed", "rm:reconnectFailed"],
      ["reconnectAbandoned", "rm:reconnectAbandoned"],
    ];

    reconnectEventBindings.forEach(([eventName, listenerKey]) => {
      const listener = reconnectListeners.get(listenerKey);
      if (listener) {
        boundReconnectionManager.removeListener(eventName, listener);
      }
    });
  }

  boundConnectionPool = null;
  boundReconnectionManager = null;
  reconnectListeners.clear();
  recentReconnectTerminalEvents.clear();

  // 移除所有IPC处理器
  ipcMain.removeHandler("get-reconnect-status");
  ipcMain.removeHandler("manual-reconnect");
  ipcMain.removeHandler("pause-reconnect");
  ipcMain.removeHandler("resume-reconnect");
  ipcMain.removeHandler("get-reconnect-statistics");
}

module.exports = {
  registerReconnectHandlers,
  cleanupReconnectHandlers,
};
