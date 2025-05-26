const SftpClient = require("ssh2-sftp-client"); // This might be used by transfer operations, ensure it's available if needed by sftpCore itself later. Or it might be passed in if only transfer uses it.
// For now, assuming ssh2.Client's sftp method is primarily used for core operations.

let logToFile = null;
let getChildProcessInfo = null; // Function to get info from main.js's childProcesses map

// SFTP 会话管理
const sftpSessions = new Map();
const sftpSessionLocks = new Map();
const pendingOperations = new Map(); // Operation queue per tabId

// SFTP 会话池配置 (Consider making these configurable via init or a config module later)
const SFTP_SESSION_IDLE_TIMEOUT = 120000; // 空闲超时时间（毫秒）
const MAX_SFTP_SESSIONS_PER_TAB = 1; // 每个标签页的最大会话数量
const MAX_TOTAL_SFTP_SESSIONS = 50; // 总的最大会话数量
const SFTP_HEALTH_CHECK_INTERVAL = 90000; // 健康检查间隔（毫秒）
const SFTP_OPERATION_TIMEOUT = 20000; // 操作超时时间（毫秒）

let sftpHealthCheckTimer = null;

function init(logger, getChildProcessInfoFunc) {
  if (!logger || !logger.logToFile) {
    console.error("sftpCore: Logger (logToFile) not provided during init!");
    // Fallback to console logging if logToFile is not available
    logToFile = (message, type = "INFO") => {
      const prefix = `[sftpCore-${type}]`;
      if (type === "ERROR" || type === "WARN") {
        console.error(prefix, message);
      } else {
        console.log(prefix, message);
      }
    };
  } else {
    logToFile = logger.logToFile;
  }

  if (typeof getChildProcessInfoFunc !== "function") {
    console.error(
      "sftpCore: getChildProcessInfo function not provided during init!",
    );
    // Fallback to a dummy function to prevent crashes, though functionality will be impaired.
    getChildProcessInfo = (tabId) => {
      logToFile(
        `sftpCore: getChildProcessInfo called for ${tabId} but not properly initialized. Returning null.`,
        "ERROR",
      );
      return null;
    };
  } else {
    getChildProcessInfo = getChildProcessInfoFunc;
  }
  logToFile("sftpCore initialized.", "INFO");
}

// 启动SFTP会话池健康检查
function startSftpHealthCheck() {
  if (sftpHealthCheckTimer) {
    clearInterval(sftpHealthCheckTimer);
  }
  sftpHealthCheckTimer = setInterval(() => {
    checkSftpSessionsHealth();
  }, SFTP_HEALTH_CHECK_INTERVAL);
  logToFile("sftpCore: Started SFTP session health check", "INFO");
}

// 停止SFTP会话池健康检查
function stopSftpHealthCheck() {
  if (sftpHealthCheckTimer) {
    clearInterval(sftpHealthCheckTimer);
    sftpHealthCheckTimer = null;
    logToFile("sftpCore: Stopped SFTP session health check", "INFO");
  }
}

// 检查SFTP会话健康状况
async function checkSftpSessionsHealth() {
  try {
    if (!logToFile) {
      // Ensure logToFile is available
      console.error(
        "sftpCore: logToFile not initialized in checkSftpSessionsHealth",
      );
      return;
    }
    logToFile(
      `sftpCore: Running SFTP health check, active sessions: ${sftpSessions.size}`,
      "INFO",
    );

    if (sftpSessions.size > MAX_TOTAL_SFTP_SESSIONS) {
      logToFile(
        `sftpCore: Too many SFTP sessions (${sftpSessions.size}), cleaning up oldest sessions`,
        "WARN",
      );
      let sessionsToClose = sftpSessions.size - MAX_TOTAL_SFTP_SESSIONS;
      const sessionEntries = Array.from(sftpSessions.entries());
      sessionEntries.sort((a, b) => a[1].createdAt - b[1].createdAt);
      for (let i = 0; i < sessionsToClose; i++) {
        if (i < sessionEntries.length) {
          const [tabId] = sessionEntries[i];
          logToFile(
            `sftpCore: Closing old SFTP session for tab ${tabId}`,
            "INFO",
          );
          await closeSftpSession(tabId); // Ensure close is awaited if it becomes async
        }
      }
    }

    for (const [tabId, session] of sftpSessions.entries()) {
      const idleTime = Date.now() - session.lastUsed;
      if (idleTime > SFTP_SESSION_IDLE_TIMEOUT) {
        logToFile(
          `sftpCore: SFTP session ${tabId} idle for ${idleTime}ms, closing`,
          "INFO",
        );
        await closeSftpSession(tabId);
        continue;
      }
      await checkSessionAlive(tabId, session);
    }
  } catch (error) {
    if (logToFile) {
      logToFile(
        `sftpCore: Error in SFTP health check: ${error.message}`,
        "ERROR",
      );
    } else {
      console.error(
        `sftpCore: Error in SFTP health check (logToFile not init): ${error.message}`,
      );
    }
  }
}

// 检查会话是否存活
async function checkSessionAlive(tabId, session) {
  try {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error("SFTP health check timeout")), 5000);
    });
    const checkPromise = new Promise((resolve, reject) => {
      session.sftp.readdir("/", (err, _) => {
        // Assuming session.sftp is the ssh2.sftp instance
        if (err) reject(err);
        else resolve();
      });
    });
    await Promise.race([checkPromise, timeoutPromise]);
    session.lastChecked = Date.now();
  } catch (error) {
    logToFile(
      `sftpCore: SFTP session ${tabId} health check failed: ${error.message}, closing session`,
      "ERROR",
    );
    await closeSftpSession(tabId);
  }
}

// 获取或创建 SFTP 会话 (heavily dependent on getChildProcessInfo)
async function getSftpSession(tabId) {
  if (sftpSessionLocks.has(tabId)) {
    return new Promise((resolve, reject) => {
      const checkLock = () => {
        if (!sftpSessionLocks.has(tabId)) {
          if (sftpSessions.has(tabId)) {
            const session = sftpSessions.get(tabId);
            session.lastUsed = Date.now();
            resolve(session.sftp);
          } else {
            acquireSftpSession(tabId).then(resolve).catch(reject);
          }
        } else {
          setTimeout(checkLock, 100);
        }
      };
      checkLock();
    });
  }

  if (sftpSessions.has(tabId)) {
    const session = sftpSessions.get(tabId);
    session.lastUsed = Date.now();
    if (session.timeoutId) clearTimeout(session.timeoutId);
    session.timeoutId = setTimeout(() => {
      closeSftpSession(tabId);
    }, SFTP_SESSION_IDLE_TIMEOUT);
    return session.sftp;
  }

  if (sftpSessions.size >= MAX_TOTAL_SFTP_SESSIONS) {
    logToFile(
      `sftpCore: Maximum SFTP sessions limit reached (${MAX_TOTAL_SFTP_SESSIONS}), closing oldest session`,
      "WARN",
    );
    let oldestTabId = null;
    let oldestTime = Date.now();
    for (const [id, session] of sftpSessions.entries()) {
      if (session.createdAt < oldestTime) {
        oldestTime = session.createdAt;
        oldestTabId = id;
      }
    }
    if (oldestTabId) await closeSftpSession(oldestTabId);
  }

  // This is where the dependency on getChildProcessInfo is critical
  const processInfo = getChildProcessInfo(tabId);
  if (!processInfo || !processInfo.process || processInfo.type !== "ssh2") {
    throw new Error(
      "sftpCore: Invalid SSH connection info obtained via getChildProcessInfo.",
    );
  }
  if (!processInfo.ready) {
    logToFile(
      `sftpCore: SSH connection not ready for session ${tabId}, waiting for ready state (info from getChildProcessInfo)`,
      "INFO",
    );
    // Potentially add a waiting mechanism here if processInfo can be updated externally and re-checked.
    // For now, this might lead to issues if called before SSH is ready.
    // The original main.js had a Promise-based wait loop in acquireSftpSession.
  }
  return acquireSftpSession(tabId);
}

// 创建新的 SFTP 会话 (heavily dependent on getChildProcessInfo)
async function acquireSftpSession(tabId) {
  sftpSessionLocks.set(tabId, true);
  try {
    let sessionCount = 0;
    for (const [id] of sftpSessions.entries()) {
      if (id === tabId) sessionCount++;
    }
    if (sessionCount >= MAX_SFTP_SESSIONS_PER_TAB) {
      logToFile(
        `sftpCore: Maximum SFTP sessions per tab reached (${MAX_SFTP_SESSIONS_PER_TAB}) for tab ${tabId}`,
        "WARN",
      );
      throw new Error(
        `已达到每个标签页的最大SFTP会话数限制(${MAX_SFTP_SESSIONS_PER_TAB})`,
      );
    }

    const processInfo = getChildProcessInfo(tabId); // Critical dependency
    if (!processInfo || !processInfo.process || processInfo.type !== "ssh2") {
      sftpSessionLocks.delete(tabId);
      throw new Error(
        "sftpCore: Invalid SSH connection info in acquireSftpSession.",
      );
    }
    const sshClient = processInfo.process; // This is ssh2.Client instance

    // Re-implementing the wait for SSH ready logic from main.js
    if (!processInfo.ready) {
      logToFile(
        `sftpCore: Waiting for SSH connection to be ready for session ${tabId}`,
        "INFO",
      );
      const maxWaitTime = 10000;
      const startTime = Date.now();
      const checkInterval = 100;

      await new Promise((resolve, reject) => {
        const checkReady = () => {
          const currentInfo = getChildProcessInfo(tabId); // Re-fetch, might be updated
          if (currentInfo && currentInfo.ready) {
            resolve();
            return;
          }
          if (Date.now() - startTime > maxWaitTime) {
            reject(
              new Error(
                "sftpCore: Waiting for SSH connection to be ready timed out",
              ),
            );
            return;
          }
          setTimeout(checkReady, checkInterval);
        };
        checkReady();
      });
      logToFile(
        `sftpCore: SSH connection is now ready for session ${tabId}`,
        "INFO",
      );
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        sftpSessionLocks.delete(tabId);
        reject(new Error("sftpCore: SFTP session creation timed out"));
      }, SFTP_OPERATION_TIMEOUT);

      sshClient.sftp((err, sftp) => {
        // sshClient here is from processInfo.process
        clearTimeout(timeoutId);
        if (err) {
          sftpSessionLocks.delete(tabId);
          logToFile(
            `sftpCore: SFTP session creation error for session ${tabId}: ${err.message}`,
            "ERROR",
          );
          reject(new Error(`sftpCore: SFTP error: ${err.message}`));
          return;
        }
        const now = Date.now();
        const session = {
          sftp, // This is the ssh2.sftp instance
          timeoutId: setTimeout(() => {
            closeSftpSession(tabId);
          }, SFTP_SESSION_IDLE_TIMEOUT),
          active: true,
          createdAt: now,
          lastUsed: now,
          lastChecked: now,
        };
        sftpSessions.set(tabId, session);
        sftpSessionLocks.delete(tabId);
        sftp.on("error", (sftpErr) => {
          logToFile(
            `sftpCore: SFTP session error for ${tabId}: ${sftpErr.message}`,
            "ERROR",
          );
          closeSftpSession(tabId);
        });
        sftp.on("close", () => {
          closeSftpSession(tabId);
        });
        if (!sftpHealthCheckTimer) {
          startSftpHealthCheck();
        }
        resolve(sftp); // Resolve with the ssh2.sftp instance
      });
    });
  } catch (error) {
    sftpSessionLocks.delete(tabId);
    logToFile(
      `sftpCore: Error in acquireSftpSession for ${tabId}: ${error.message}`,
      "ERROR",
    );
    throw error;
  }
}

// 关闭SFTP会话
async function closeSftpSession(tabId) {
  // Made async to align with potential async operations within
  if (sftpSessions.has(tabId)) {
    const session = sftpSessions.get(tabId);
    if (session.timeoutId) clearTimeout(session.timeoutId);
    session.active = false;
    try {
      session.sftp.end(); // End the ssh2.sftp instance
    } catch (error) {
      logToFile(
        `sftpCore: Error closing SFTP session (sftp.end()) for ${tabId}: ${error.message}`,
        "ERROR",
      );
    }
    sftpSessions.delete(tabId);
    logToFile(`sftpCore: Closed SFTP session for ${tabId}`, "INFO");
    if (sftpSessions.size === 0 && sftpHealthCheckTimer) {
      stopSftpHealthCheck();
    }
  }
}

// 处理 SFTP 操作队列
function enqueueSftpOperation(tabId, operationFunction, options = {}) {
  if (!pendingOperations.has(tabId)) {
    pendingOperations.set(tabId, []);
  }
  const queue = pendingOperations.get(tabId);
  const {
    priority = "normal",
    type = "other", // e.g., "readdir", "upload", "download"
    path = null, // For mergeable operations
    canMerge = false, // Specific for readdir for now
  } = options;

  if (canMerge && path && type === "readdir") {
    const existingOpIndex = queue.findIndex(
      (item) => item.type === "readdir" && item.path === path,
    );
    if (existingOpIndex !== -1) {
      return new Promise((resolve, reject) => {
        const existingOp = queue[existingOpIndex];
        existingOp.subscribers = existingOp.subscribers || [];
        existingOp.subscribers.push({ resolve, reject });
        logToFile(
          `sftpCore: Merged SFTP ${type} operation for path ${path} on tab ${tabId}`,
          "INFO",
        );
      });
    }
  }

  return new Promise((resolve, reject) => {
    const operationObj = {
      operationFunction, // The actual async function to execute
      resolve,
      reject,
      priority,
      type,
      path,
      canMerge,
      enqueuedAt: Date.now(),
      subscribers: [],
    };
    if (priority === "high") {
      if (queue.length > 0) queue.splice(1, 0, operationObj);
      else queue.push(operationObj);
    } else {
      queue.push(operationObj);
    }
    if (path) {
      logToFile(
        `sftpCore: Enqueued SFTP ${type} operation for path ${path} on tab ${tabId} with priority ${priority}`,
        "INFO",
      );
    } else {
      logToFile(
        `sftpCore: Enqueued SFTP ${type} operation on tab ${tabId} with priority ${priority}`,
        "INFO",
      );
    }
    if (queue.length === 1) {
      processSftpQueue(tabId);
    }
  });
}

// 处理队列中的 SFTP 操作
async function processSftpQueue(tabId) {
  const queue = pendingOperations.get(tabId);
  if (!queue || queue.length === 0) return;

  const op = queue[0];
  try {
    const processInfo = getChildProcessInfo(tabId); // Dependency
    if (!processInfo || !processInfo.process || processInfo.type !== "ssh2") {
      throw new Error(
        "sftpCore: Invalid SSH connection for queued SFTP operation.",
      );
    }
    const result = await op.operationFunction(); // Execute the function passed to enqueueSftpOperation
    op.resolve(result);
    if (op.subscribers && op.subscribers.length > 0) {
      for (const subscriber of op.subscribers) subscriber.resolve(result);
      logToFile(
        `sftpCore: Resolved ${op.subscribers.length} merged subscribers for SFTP ${op.type} operation on tab ${tabId}`,
        "INFO",
      );
    }
  } catch (error) {
    let errorMessage = error.message;
    if (errorMessage.includes("等待SSH连接就绪超时")) {
      // This specific error was from main.js
      errorMessage = "sftpCore: SSH连接尚未就绪，请稍后重试";
      logToFile(
        `sftpCore: SSH connection not ready for SFTP operation on tab ${tabId}: ${error.message}`,
        "ERROR",
      );
    } else if (
      errorMessage.includes("ECONNRESET") ||
      errorMessage.includes("Channel open failure")
    ) {
      errorMessage = "sftpCore: SSH连接被重置，请检查网络连接并重试";
      logToFile(
        `sftpCore: SSH connection reset for SFTP operation on tab ${tabId}: ${error.message}`,
        "ERROR",
      );
    }
    op.reject(new Error(errorMessage));
    if (op.subscribers && op.subscribers.length > 0) {
      for (const subscriber of op.subscribers)
        subscriber.reject(new Error(errorMessage));
      logToFile(
        `sftpCore: Rejected ${op.subscribers.length} merged subscribers for SFTP ${op.type} operation on tab ${tabId}: ${error.message}`,
        "ERROR",
      );
    }
  } finally {
    queue.shift();
    if (queue.length > 0) {
      const nextOp = queue[0];
      const delay = nextOp.type === "readdir" ? 50 : 100; // Keep this delay logic
      setTimeout(() => processSftpQueue(tabId), delay);
    }
  }
}

// 新增：清理指定tabId的待处理操作队列
function clearPendingOperationsForTab(tabId) {
  if (pendingOperations.has(tabId)) {
    const queue = pendingOperations.get(tabId);
    if (queue && queue.length > 0) {
      logToFile(
        `sftpCore: Clearing ${queue.length} pending SFTP operations for tab ${tabId} due to connection closure.`,
        "INFO",
      );
      for (const op of queue) {
        if (op.reject && typeof op.reject === "function") {
          op.reject(new Error("操作已取消：SSH连接已关闭。"));
        }
        // 如果有合并的订阅者，也需要拒绝它们
        if (op.subscribers && op.subscribers.length > 0) {
          for (const subscriber of op.subscribers) {
            if (subscriber.reject && typeof subscriber.reject === "function") {
              subscriber.reject(new Error("操作已取消：SSH连接已关闭。"));
            }
          }
        }
      }
      pendingOperations.set(tabId, []); // Clear the queue for this tabId
    } else {
      logToFile(
        `sftpCore: No pending operations to clear for tab ${tabId}.`,
        "INFO",
      );
    }
  } else {
    logToFile(
      `sftpCore: No pending operations queue found for tab ${tabId} to clear.`,
      "INFO",
    );
  }
}

module.exports = {
  init,
  startSftpHealthCheck,
  stopSftpHealthCheck,
  getSftpSession,
  closeSftpSession,
  enqueueSftpOperation,
  clearPendingOperationsForTab, // 导出新函数
  // processSftpQueue is internal, not exported
  // checkSftpSessionsHealth and checkSessionAlive are also internal after startSftpHealthCheck is called
};
