const { ipcMain } = require("electron");
const { logToFile } = require("../../utils/logger");
const { safeHandle } = require("../ipcResponse");

// 存储重连事件监听器
const reconnectListeners = new Map();
let boundConnectionPool = null;

// 注册重连相关的IPC处理器
function registerReconnectHandlers(connectionPool) {
  boundConnectionPool = connectionPool;

  // 监听重连状态请求
  safeHandle(
    ipcMain,
    "get-reconnect-status",
    async (event, { tabId, processId }) => {
      const connectionKey = connectionPool.getConnectionKeyByTabId(tabId);
      if (!connectionKey) {
        return null;
      }

      const status = connectionPool.getConnectionStatus(connectionKey);
      return status?.reconnectStatus || null;
    },
  );

  // 手动触发重连
  safeHandle(
    ipcMain,
    "manual-reconnect",
    async (event, { tabId, processId, sshConfig }) => {
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
  safeHandle(ipcMain, "get-reconnect-statistics", async (event) => {
    if (connectionPool.reconnectionManager) {
      return connectionPool.reconnectionManager.getStatistics();
    }
    return null;
  });

  // 设置重连事件转发
  if (connectionPool.reconnectionManager) {
    // 重连开始事件
    connectionPool.reconnectionManager.on(
      "reconnectStarted",
      ({ sessionId }) => {
        const tabId = extractTabIdFromSessionId(sessionId);
        broadcastToRenderer("reconnect-started", {
          tabId,
          sessionId,
          timestamp: Date.now(),
        });
      },
    );

    // 重连进度事件
    connectionPool.reconnectionManager.on(
      "reconnectScheduled",
      ({ sessionId, delay, retryCount }) => {
        const tabId = extractTabIdFromSessionId(sessionId);
        broadcastToRenderer("reconnect-progress", {
          tabId,
          sessionId,
          attempts: retryCount,
          maxAttempts: 5,
          delay,
          timestamp: Date.now(),
        });
      },
    );

    // 重连成功事件
    connectionPool.reconnectionManager.on(
      "reconnectSuccess",
      ({ sessionId, attempts }) => {
        const tabId = extractTabIdFromSessionId(sessionId);
        logToFile(
          `重连成功通知前端: tabId=${tabId}, attempts=${attempts}`,
          "INFO",
        );

        broadcastToRenderer("reconnect-success", {
          tabId,
          sessionId,
          attempts,
          timestamp: Date.now(),
        });
      },
    );

    // 重连失败事件
    connectionPool.reconnectionManager.on(
      "reconnectFailed",
      ({ sessionId, error, attempts }) => {
        const tabId = extractTabIdFromSessionId(sessionId);
        logToFile(`重连失败通知前端: tabId=${tabId}, error=${error}`, "ERROR");

        broadcastToRenderer("reconnect-failed", {
          tabId,
          sessionId,
          error,
          attempts,
          timestamp: Date.now(),
        });
      },
    );

    // 重连放弃事件
    connectionPool.reconnectionManager.on(
      "reconnectAbandoned",
      ({ sessionId, reason, attempts }) => {
        const tabId = extractTabIdFromSessionId(sessionId);
        logToFile(`重连放弃通知前端: tabId=${tabId}, reason=${reason}`, "WARN");

        broadcastToRenderer("reconnect-abandoned", {
          tabId,
          sessionId,
          reason,
          attempts,
          timestamp: Date.now(),
        });
      },
    );
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
      boundConnectionPool.removeListener("connectionLost", onPoolConnectionLost);
    }
  }
  boundConnectionPool = null;
  reconnectListeners.clear();

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
