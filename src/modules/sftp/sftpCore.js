const SftpClient = require("ssh2-sftp-client"); // This might be used by transfer operations, ensure it's available if needed by sftpCore itself later. Or it might be passed in if only transfer uses it.
// For now, assuming ssh2.Client's sftp method is primarily used for core operations.

let logToFile = null;
let getChildProcessInfo = null; // Function to get info from main.js's childProcesses map

// SFTP 会话管理
const sftpSessions = new Map();
const sftpSessionLocks = new Map();
let pendingOperations = new Map(); // key: tabId, value: Array of pending operations

// SFTP 会话池配置 (Consider making these configurable via init or a config module later)
const SFTP_SESSION_IDLE_TIMEOUT = 600000; // 空闲超时时间（10分钟）
const MAX_SFTP_SESSIONS_PER_TAB = 1; // 每个标签页的最大会话数量
const MAX_TOTAL_SFTP_SESSIONS = 50; // 总的最大会话数量
const SFTP_HEALTH_CHECK_INTERVAL = 90000; // 健康检查间隔（毫秒）
const SFTP_OPERATION_TIMEOUT = 86400000; // 操作超时时间（毫秒），增加到24小时
const SFTP_LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 大文件阈值（100MB）
const SFTP_LARGE_FILE_TIMEOUT = 86400000; // 大文件传输超时时间（24小时）

let sftpHealthCheckTimer = null;

// 动态计算超时时间的函数
function calculateDynamicTimeout(
  fileSize,
  baseTimeout = SFTP_OPERATION_TIMEOUT,
) {
  if (!fileSize || fileSize <= 0) {
    return baseTimeout;
  }

  // 如果是大文件，使用更长的超时时间
  if (fileSize >= SFTP_LARGE_FILE_THRESHOLD) {
    return SFTP_LARGE_FILE_TIMEOUT;
  }

  // 对于中等大小文件，按文件大小动态调整超时时间
  // 假设传输速度为 1MB/s，至少给 3 倍的缓冲时间
  const estimatedTransferTime = (fileSize / (1024 * 1024)) * 1000; // 毫秒
  const dynamicTimeout = Math.max(baseTimeout, estimatedTransferTime * 3);

  // 限制最大超时时间不超过大文件超时时间
  return Math.min(dynamicTimeout, SFTP_LARGE_FILE_TIMEOUT);
}

function init(logger, getChildProcessInfoFunc) {
  if (!logger || !logger.logToFile) {
    // Logger not provided during init, using fallback
    logToFile = (message, type = "INFO") => {
      // Fallback logging - could be enhanced to write to file or use alternative logging
    };
  } else {
    logToFile = logger.logToFile;
  }

  if (typeof getChildProcessInfoFunc !== "function") {
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

// 添加新方法: 确保SFTP会话有效性，如有必要则重新初始化
async function ensureSftpSession(tabId) {
  try {
    // 检查是否已有会话
    if (sftpSessions.has(tabId)) {
      const session = sftpSessions.get(tabId);

      // 重置会话超时
      if (session.timeoutId) clearTimeout(session.timeoutId);
      session.timeoutId = setTimeout(() => {
        closeSftpSession(tabId);
      }, SFTP_SESSION_IDLE_TIMEOUT);

      // 如果会话存在但不活跃，尝试重新创建
      if (!session.active) {
        logToFile(
          `sftpCore: Session for tab ${tabId} exists but inactive, recreating`,
          "INFO",
        );
        await closeSftpSession(tabId);
        return acquireSftpSession(tabId);
      }

      // 如果会话存在并活跃，进行简单验证
      try {
        // 简单操作测试会话可用性
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error("SFTP health check timeout"));
          }, 2000);

          session.sftp.stat(".", (err, stats) => {
            clearTimeout(timeoutId);
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        // 会话验证成功
        session.lastChecked = Date.now();
        session.lastUsed = Date.now();
        return session.sftp;
      } catch (healthError) {
        // 会话验证失败，关闭并重新创建
        logToFile(
          `sftpCore: Session check failed for tab ${tabId}, recreating: ${healthError.message}`,
          "WARN",
        );
        await closeSftpSession(tabId);
        return acquireSftpSession(tabId);
      }
    } else {
      // 如果会话数量已达上限，清除最旧的会话
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

      // 无会话，直接创建新的
      logToFile(`sftpCore: No session for tab ${tabId}, creating new`, "INFO");
      return acquireSftpSession(tabId);
    }
  } catch (error) {
    logToFile(
      `sftpCore: Error ensuring SFTP session for tab ${tabId}: ${error.message}`,
      "ERROR",
    );
    throw error;
  }
}

// 修改getSftpSession方法，使用ensureSftpSession
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

  // 使用确保会话有效性的方式获取会话
  try {
    return await ensureSftpSession(tabId);
  } catch (error) {
    logToFile(
      `sftpCore: Failed to get SFTP session for tab ${tabId}: ${error.message}`,
      "ERROR",
    );
    throw error;
  }
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
          if (!currentInfo) {
            reject(new Error("sftpCore: SSH connection no longer exists"));
            return;
          }

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
      // 增加更长的超时时间，以防止网络延迟导致的问题
      const timeoutId = setTimeout(() => {
        sftpSessionLocks.delete(tabId);
        reject(new Error("sftpCore: SFTP session creation timed out"));
      }, SFTP_OPERATION_TIMEOUT * 2);

      try {
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
            logToFile(
              `sftpCore: SFTP session closed by remote for ${tabId}`,
              "INFO",
            );
            closeSftpSession(tabId);
          });
          if (!sftpHealthCheckTimer) {
            startSftpHealthCheck();
          }
          resolve(sftp); // Resolve with the ssh2.sftp instance
        });
      } catch (sftpError) {
        clearTimeout(timeoutId);
        sftpSessionLocks.delete(tabId);
        logToFile(
          `sftpCore: Error creating SFTP session for ${tabId}: ${sftpError.message}`,
          "ERROR",
        );
        reject(sftpError);
      }
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

async function enqueueSftpOperation(tabId, operation, options = {}) {
  const type = options.type || "generic";
  const path = options.path || ".";
  const canMerge = Boolean(options.canMerge);
  const priority = options.priority || "normal";

  // Parse priority to numeric value
  let priorityValue;
  switch (priority) {
    case "high":
      priorityValue = 10;
      break;
    case "low":
      priorityValue = 1;
      break;
    default:
      priorityValue = 5; // normal
      break;
  }

  // Create or get queue for this tabId
  if (!pendingOperations.has(tabId)) {
    pendingOperations.set(tabId, []);
  }

  // 日志记录操作请求
  logToFile(
    `sftpCore: Enqueued SFTP ${type} operation for path ${path} on tab ${tabId} with priority ${priority}`,
    "INFO",
  );

  // Check for similar operations in queue if canMerge is true
  // This is useful for operations like directory listings that can be collapsed to the most recent one
  if (canMerge) {
    const queue = pendingOperations.get(tabId);
    let matchingOpIndex = -1;
    let matchingOp = null;

    // Only merge waiting operations, not those in progress
    for (let i = 0; i < queue.length; i++) {
      const op = queue[i];
      if (!op.inProgress && op.type === type && op.path === path) {
        matchingOpIndex = i;
        matchingOp = op;
        break;
      }
    }

    if (matchingOp) {
      logToFile(
        `sftpCore: Merging new ${type} operation for ${path} with existing queued operation.`,
        "INFO",
      );

      // Update existing operation with new priority if higher
      if (priorityValue > matchingOp.priorityValue) {
        queue[matchingOpIndex].priorityValue = priorityValue;
      }

      // Return the existing operation's promise
      return matchingOp.promise;
    }
  }

  // Create new operation
  return new Promise((resolve, reject) => {
    const operationObj = {
      tabId,
      type,
      path,
      canMerge,
      priorityValue,
      operation,
      promise: null,
      resolve,
      reject,
      inProgress: false,
      timestamp: Date.now(),
      retries: 0, // 添加重试计数
      maxRetries: 2, // 最大重试次数
    };

    // Set promise reference in operationObj for potential future merging
    operationObj.promise = new Promise((res, rej) => {
      operationObj.innerResolve = res;
      operationObj.innerReject = rej;
    });

    // Add to queue
    const queue = pendingOperations.get(tabId);
    queue.push(operationObj);

    // Start processing queue
    processSftpQueue(tabId);
  });
}

// 内部函数：处理 SFTP 操作队列
async function processSftpQueue(tabId) {
  // Check if queue exists
  if (!pendingOperations.has(tabId)) {
    return;
  }

  const queue = pendingOperations.get(tabId);

  // Check if queue is empty or already being processed
  if (queue.length === 0) {
    return;
  }

  // Find the highest priority waiting operation
  let highestPriority = -1;
  let nextOpIndex = -1;

  for (let i = 0; i < queue.length; i++) {
    const op = queue[i];
    if (!op.inProgress && op.priorityValue > highestPriority) {
      highestPriority = op.priorityValue;
      nextOpIndex = i;
    }
  }

  // If no waiting operation (all in progress), return
  if (nextOpIndex === -1) {
    return;
  }

  const nextOp = queue[nextOpIndex];
  nextOp.inProgress = true;

  // Track operation initiation time, helps with debugging hangs
  nextOp.startTime = Date.now();

  try {
    // 计算动态超时时间
    let timeoutMs = SFTP_OPERATION_TIMEOUT;

    // 检查操作类型和路径，尝试估算文件大小以动态调整超时
    if (
      nextOp.type === "upload" ||
      nextOp.type === "download" ||
      nextOp.type === "upload-multifile" ||
      nextOp.type === "upload-folder" ||
      nextOp.type === "download-folder"
    ) {
      // 对于传输操作，使用较长的超时时间
      if (
        nextOp.type === "upload-multifile" ||
        nextOp.type === "upload-folder" ||
        nextOp.type === "download-folder"
      ) {
        // 文件夹或多文件操作，使用最长超时
        timeoutMs = SFTP_LARGE_FILE_TIMEOUT;
      } else {
        // 单文件操作，使用大文件超时
        timeoutMs = SFTP_LARGE_FILE_TIMEOUT;
      }
    }

    // Execute the operation
    const result = await Promise.race([
      nextOp.operation(),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("Operation timed out")), timeoutMs),
      ),
    ]);

    // Operation completed successfully
    nextOp.resolve(result);
    nextOp.innerResolve(result);

    // Remove operation from queue
    queue.splice(nextOpIndex, 1);
  } catch (error) {
    // 操作失败，考虑是否重试
    if (nextOp.retries < nextOp.maxRetries && isRetryableError(error)) {
      nextOp.retries++;
      nextOp.inProgress = false;

      logToFile(
        `sftpCore: Operation ${nextOp.type} failed on tab ${tabId}, retrying (${nextOp.retries}/${nextOp.maxRetries}): ${error.message}`,
        "WARN",
      );

      // 添加重试延迟，防止立即失败的循环
      setTimeout(() => {
        processSftpQueue(tabId); // 再次尝试处理队列
      }, 1000 * nextOp.retries); // 随重试次数增加延迟

      return; // 不删除操作，不解析promise
    }

    // 超过重试次数或不可重试的错误
    nextOp.reject(error);
    nextOp.innerReject(error);

    // Remove failed operation from queue
    queue.splice(nextOpIndex, 1);

    logToFile(
      `sftpCore: Operation ${nextOp.type} failed on tab ${tabId} after ${nextOp.retries} retries: ${error.message}`,
      "ERROR",
    );
  }

  // Process next operation in queue
  processSftpQueue(tabId);
}

// 判断是否为可重试的错误类型
function isRetryableError(error) {
  // 网络超时、连接重置、连接中断等类型错误可以重试
  const retryableMessages = [
    "timeout",
    "timed out",
    "disconnected",
    "reset",
    "ECONNRESET",
    "EOF",
    "socket hang up",
    "无法连接到远程主机",
    "SSH连接已关闭",
    "operation has been aborted",
  ];

  if (!error || !error.message) return false;

  const message = error.message.toLowerCase();
  return retryableMessages.some((msg) => message.includes(msg.toLowerCase()));
}

// 新增：清理指定tabId的待处理操作队列
function clearPendingOperationsForTab(tabId, options = {}) {
  const { userCancelled = false } = options;

  if (pendingOperations.has(tabId)) {
    const queue = pendingOperations.get(tabId);
    if (queue && queue.length > 0) {
      logToFile(
        `sftpCore: Clearing ${queue.length} pending SFTP operations for tab ${tabId} due to ${userCancelled ? "user cancellation" : "connection closure"}.`,
        userCancelled ? "INFO" : "WARN",
      );
      for (const op of queue) {
        if (op.reject && typeof op.reject === "function") {
          // 创建一个带有特殊标记的错误对象
          const error = new Error(
            userCancelled ? "用户已取消操作" : "操作已取消：SSH连接已关闭。",
          );
          error.userCancelled = userCancelled;
          op.reject(error);
        }
        // 如果有合并的订阅者，也需要拒绝它们
        if (op.subscribers && op.subscribers.length > 0) {
          for (const subscriber of op.subscribers) {
            if (subscriber.reject && typeof subscriber.reject === "function") {
              // 同样添加特殊标记
              const error = new Error(
                userCancelled
                  ? "用户已取消操作"
                  : "操作已取消：SSH连接已关闭。",
              );
              error.userCancelled = userCancelled;
              subscriber.reject(error);
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

// 添加获取原生SFTP会话的方法，用于传输模块直接使用
async function getRawSftpSession(tabId) {
  try {
    // 直接返回原生ssh2 SFTP对象，供传输模块使用
    return await getSftpSession(tabId);
  } catch (error) {
    logToFile(
      `sftpCore: Error getting raw SFTP session for tab ${tabId}: ${error.message}`,
      "ERROR",
    );
    throw error;
  }
}

// 获取SFTP会话的连接配置信息
function getSftpSessionInfo(tabId) {
  if (!sftpSessions.has(tabId)) {
    return null;
  }

  const session = sftpSessions.get(tabId);
  return {
    active: session.active,
    createdAt: session.createdAt,
    lastUsed: session.lastUsed,
    lastChecked: session.lastChecked,
  };
}

// 批量清理会话，用于性能优化
async function optimizeSftpSessions() {
  try {
    logToFile(
      `sftpCore: Starting SFTP session optimization, current sessions: ${sftpSessions.size}`,
      "INFO",
    );

    const now = Date.now();
    let optimizedCount = 0;

    for (const [tabId, session] of sftpSessions.entries()) {
      const idleTime = now - session.lastUsed;

      // 如果会话空闲时间超过一半的超时时间，进行健康检查
      if (idleTime > SFTP_SESSION_IDLE_TIMEOUT / 2) {
        try {
          await checkSessionAlive(tabId, session);
          optimizedCount++;
        } catch (error) {
          logToFile(
            `sftpCore: Session optimization failed for ${tabId}, will be closed: ${error.message}`,
            "WARN",
          );
          // checkSessionAlive内部会处理关闭
        }
      }
    }

    logToFile(
      `sftpCore: SFTP session optimization completed, checked ${optimizedCount} sessions`,
      "INFO",
    );
    return {
      success: true,
      optimizedCount,
      remainingSessions: sftpSessions.size,
    };
  } catch (error) {
    logToFile(
      `sftpCore: Error during SFTP session optimization: ${error.message}`,
      "ERROR",
    );
    return { success: false, error: error.message };
  }
}

module.exports = {
  init,
  startSftpHealthCheck,
  stopSftpHealthCheck,
  getSftpSession,
  getRawSftpSession, // 新增：直接获取原生SFTP会话
  getSftpSessionInfo, // 新增：获取会话信息
  optimizeSftpSessions, // 新增：会话优化
  closeSftpSession,
  enqueueSftpOperation,
  clearPendingOperationsForTab, // 导出新函数
  ensureSftpSession, // 导出新方法
  calculateDynamicTimeout, // 导出动态超时计算函数
  // processSftpQueue is internal, not exported
  // checkSftpSessionsHealth and checkSessionAlive are also internal after startSftpHealthCheck is called
};
