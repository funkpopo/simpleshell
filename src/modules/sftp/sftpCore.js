// For now, assuming ssh2.Client's sftp method is primarily used for core operations.

// Import centralized configuration
const {
  SESSION_CONFIG,
  TIMEOUT_CONFIG,
  RETRY_CONFIG,
  QUEUE_CONFIG,
  calculateDynamicTimeout: configCalculateDynamicTimeout,
  isRetryableError: configIsRetryableError,
  parsePriority,
} = require("./sftpConfig");

let logToFile = null;
let getChildProcessInfo = null; // Function to get info from main.js's childProcesses map

// SFTP 会话管理（支持每个标签页维护会话池）
// 结构: sftpPools: Map<tabId, { sessions: Map<sessionId, Session>, primaryId: string|null }>
const sftpPools = new Map();
const sftpSessionLocks = new Map(); // 按tabId加锁，避免并发创建
let pendingOperations = new Map(); // key: tabId, value: Array of pending operations

let sftpHealthCheckTimer = null;

// 内部工具: 获取或创建某个tab的会话池
function getOrCreatePool(tabId) {
  if (!sftpPools.has(tabId)) {
    sftpPools.set(tabId, { sessions: new Map(), primaryId: null });
  }
  return sftpPools.get(tabId);
}

// 内部工具: 统计所有会话总数
function getTotalSessionCount() {
  let total = 0;
  for (const pool of sftpPools.values()) {
    total += pool.sessions.size;
  }
  return total;
}

// 内部工具: 生成唯一会话ID
function genSessionId(tabId) {
  return `${tabId}-sftp-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

// 使用配置模块的动态超时计算函数
const calculateDynamicTimeout = configCalculateDynamicTimeout;

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
  }, SESSION_CONFIG.HEALTH_CHECK_INTERVAL);
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
    const totalCount = getTotalSessionCount();
    logToFile(
      `sftpCore: Running SFTP health check, total sessions: ${totalCount}`,
      "INFO",
    );

    // 超过全局限制时，按最早创建时间全局回收
    if (totalCount > SESSION_CONFIG.MAX_TOTAL_SESSIONS) {
      const toClose = totalCount - SESSION_CONFIG.MAX_TOTAL_SESSIONS;
      const allSessions = [];
      for (const [tabId, pool] of sftpPools.entries()) {
        for (const session of pool.sessions.values()) {
          allSessions.push({ tabId, session });
        }
      }
      allSessions.sort((a, b) => a.session.createdAt - b.session.createdAt);
      for (let i = 0; i < toClose && i < allSessions.length; i++) {
        const { tabId, session } = allSessions[i];
        logToFile(
          `sftpCore: Closing old SFTP session ${session.id} for tab ${tabId}`,
          "INFO",
        );
        await closeSftpSession(tabId, session.id);
      }
    }

    // 遍历所有会话进行空闲和健康检查
    for (const [tabId, pool] of sftpPools.entries()) {
      for (const session of pool.sessions.values()) {
        const idleTime = Date.now() - session.lastUsed;
        if (idleTime > SESSION_CONFIG.SESSION_IDLE_TIMEOUT && session.busyCount === 0) {
          logToFile(
            `sftpCore: SFTP session ${session.id} (tab ${tabId}) idle for ${idleTime}ms, closing`,
            "INFO",
          );
          await closeSftpSession(tabId, session.id);
          continue;
        }
        await checkSessionAlive(tabId, session);
      }
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
      setTimeout(() => reject(new Error("SFTP health check timeout")), SESSION_CONFIG.HEALTH_CHECK_TIMEOUT);
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
      `sftpCore: SFTP session ${session.id} (tab ${tabId}) health check failed: ${error.message}, closing session`,
      "ERROR",
    );
    await closeSftpSession(tabId, session.id);
  }
}

// 添加新方法: 确保至少有一个SFTP会话，如果没有则创建，并返回"主"会话的sftp对象
async function ensureSftpSession(tabId) {
  try {
    const pool = getOrCreatePool(tabId);

    // 若已有主会话，快速健康检查并返回
    if (pool.primaryId && pool.sessions.has(pool.primaryId)) {
      const session = pool.sessions.get(pool.primaryId);
      // 重置空闲计时器
      if (session.timeoutId) clearTimeout(session.timeoutId);
      session.timeoutId = setTimeout(() => {
        closeSftpSession(tabId, session.id);
      }, SESSION_CONFIG.SESSION_IDLE_TIMEOUT);

      if (!session.active) {
        await closeSftpSession(tabId, session.id);
        const newSession = await acquireSftpSession(tabId);
        return newSession.sftp;
      }

      try {
        await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error("SFTP health check timeout"));
          }, SESSION_CONFIG.QUICK_HEALTH_CHECK_TIMEOUT);
          session.sftp.stat(".", (err) => {
            clearTimeout(timeoutId);
            if (err) reject(err);
            else resolve();
          });
        });
        session.lastChecked = Date.now();
        session.lastUsed = Date.now();
        return session.sftp;
      } catch (e) {
        logToFile(
          `sftpCore: Primary session check failed for tab ${tabId}, recreating: ${e.message}`,
          "WARN",
        );
        await closeSftpSession(tabId, session.id);
        const newSession = await acquireSftpSession(tabId);
        return newSession.sftp;
      }
    }

    // 没有主会话，则创建
    logToFile(
      `sftpCore: No primary session for tab ${tabId}, creating`,
      "INFO",
    );
    const created = await acquireSftpSession(tabId);
    return created.sftp;
  } catch (error) {
    logToFile(
      `sftpCore: Error ensuring SFTP session for tab ${tabId}: ${error.message}`,
      "ERROR",
    );
    throw error;
  }
}

// 修改getSftpSession方法，使用ensureSftpSession并支持重连
async function getSftpSession(tabId) {
  if (sftpSessionLocks.has(tabId)) {
    return new Promise((resolve, reject) => {
      const checkLock = () => {
        if (!sftpSessionLocks.has(tabId)) {
          const pool = sftpPools.get(tabId);
          if (pool && pool.primaryId && pool.sessions.has(pool.primaryId)) {
            const session = pool.sessions.get(pool.primaryId);
            // 检查会话健康状态
            checkSessionHealth(session)
              .then((isHealthy) => {
                if (isHealthy) {
                  session.lastUsed = Date.now();
                  resolve(session.sftp);
                } else {
                  // 会话不健康，触发重连
                  handleUnhealthySession(tabId, session)
                    .then(resolve)
                    .catch(reject);
                }
              })
              .catch(reject);
          } else {
            acquireSftpSession(tabId)
              .then((session) => resolve(session.sftp))
              .catch(reject);
          }
        } else {
          setTimeout(checkLock, SESSION_CONFIG.SSH_READY_CHECK_INTERVAL);
        }
      };
      checkLock();
    });
  }

  // 使用确保会话有效性的方式获取会话，先检查健康状态
  try {
    const pool = sftpPools.get(tabId);
    if (pool && pool.primaryId && pool.sessions.has(pool.primaryId)) {
      const session = pool.sessions.get(pool.primaryId);
      const isHealthy = await checkSessionHealth(session);
      if (isHealthy) {
        session.lastUsed = Date.now();
        return session.sftp;
      } else {
        logToFile(`sftpCore: SFTP会话不健康，尝试重建: tabId=${tabId}`, "WARN");
        return await handleUnhealthySession(tabId, session);
      }
    }
    return await ensureSftpSession(tabId);
  } catch (error) {
    logToFile(
      `sftpCore: Failed to get SFTP session for tab ${tabId}: ${error.message}`,
      "ERROR",
    );
    throw error;
  }
}

// 处理不健康的SFTP会话
async function handleUnhealthySession(tabId, session) {
  try {
    // 关闭旧会话
    if (session && session.sftp) {
      try {
        session.sftp.end();
      } catch (error) {
        // 忽略关闭错误
      }
    }

    // 从会话池中移除
    const pool = sftpPools.get(tabId);
    if (pool && session) {
      pool.sessions.delete(session.id);
      if (pool.primaryId === session.id) {
        pool.primaryId = null;
      }
    }

    // 检查SSH连接状态
    const processInfo = getChildProcessInfo(tabId);
    if (!processInfo || !processInfo.process) {
      throw new Error(`找不到tabId ${tabId} 对应的SSH连接`);
    }

    // 检查SSH连接是否健康
    if (processInfo.process.destroyed || !processInfo.process._channel) {
      logToFile(
        `sftpCore: SSH连接不健康，需要重新建立SSH连接: tabId=${tabId}`,
        "ERROR",
      );
      throw new Error("SSH连接已断开，请重新连接");
    }

    // 重试创建新的SFTP会话
    logToFile(`sftpCore: 重新创建SFTP会话: tabId=${tabId}`, "INFO");
    return await ensureSftpSession(tabId);
  } catch (error) {
    logToFile(`sftpCore: 处理不健康会话失败: ${error.message}`, "ERROR");
    throw error;
  }
}

// 检查会话健康状态
async function checkSessionHealth(session) {
  if (!session || !session.sftp) {
    return false;
  }

  // 检查是否已经销毁
  if (session.sftp.destroyed) {
    return false;
  }

  // 尝试执行简单的SFTP操作来检查连接
  try {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, SESSION_CONFIG.QUICK_HEALTH_CHECK_TIMEOUT);

      session.sftp.readdir(".", (err) => {
        clearTimeout(timeout);
        resolve(!err);
      });
    });
  } catch (error) {
    return false;
  }
}

// 创建新的 SFTP 会话 (heavily dependent on getChildProcessInfo)
async function acquireSftpSession(tabId) {
  sftpSessionLocks.set(tabId, true);
  try {
    const pool = getOrCreatePool(tabId);
    const perTabCount = pool.sessions.size;
    if (perTabCount >= SESSION_CONFIG.MAX_SESSIONS_PER_TAB) {
      logToFile(
        `sftpCore: Maximum SFTP sessions per tab reached (${SESSION_CONFIG.MAX_SESSIONS_PER_TAB}) for tab ${tabId}`,
        "WARN",
      );
      throw new Error(
        `已达到每个标签页的最大SFTP会话数限制(${SESSION_CONFIG.MAX_SESSIONS_PER_TAB})`,
      );
    }

    // 增强获取SSH连接的逻辑
    const processInfo = getChildProcessInfo(tabId); // Critical dependency

    // 更详细的SSH连接验证
    if (!processInfo) {
      sftpSessionLocks.delete(tabId);
      logToFile(
        `sftpCore: No SSH process info found for tab ${tabId}`,
        "ERROR",
      );
      throw new Error(
        `sftpCore: No SSH connection info found for tab ${tabId}`,
      );
    }

    if (!processInfo.process) {
      sftpSessionLocks.delete(tabId);
      logToFile(
        `sftpCore: SSH process exists but no client instance for tab ${tabId}`,
        "ERROR",
      );
      throw new Error(
        `sftpCore: SSH client instance not found for tab ${tabId}`,
      );
    }

    if (processInfo.type !== "ssh2") {
      sftpSessionLocks.delete(tabId);
      logToFile(
        `sftpCore: Connection type is not SSH for tab ${tabId}, got ${processInfo.type}`,
        "ERROR",
      );
      throw new Error(
        `sftpCore: Invalid connection type (${processInfo.type}) for SFTP session, must be SSH.`,
      );
    }

    const sshClient = processInfo.process; // This is ssh2.Client instance

    // 验证SSH客户端实例的有效性
    if (!sshClient || typeof sshClient.sftp !== "function") {
      sftpSessionLocks.delete(tabId);
      logToFile(
        `sftpCore: Invalid SSH client instance for tab ${tabId}`,
        "ERROR",
      );
      throw new Error(
        "sftpCore: Invalid SSH connection info in acquireSftpSession.",
      );
    }

    // Re-implementing the wait for SSH ready logic from main.js
    if (!processInfo.ready) {
      logToFile(
        `sftpCore: Waiting for SSH connection to be ready for session ${tabId}`,
        "INFO",
      );
      const maxWaitTime = SESSION_CONFIG.SSH_READY_WAIT_TIMEOUT;
      const startTime = Date.now();
      const checkInterval = SESSION_CONFIG.SSH_READY_CHECK_INTERVAL;

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
      }, TIMEOUT_CONFIG.BASE_OPERATION_TIMEOUT * 2);

      try {
        // 确保每次调用返回一个新的SFTP会话
        sshClient.sftp((err, sftp) => {
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

          // 创建一个全新的会话对象
          const now = Date.now();
          const session = {
            id: genSessionId(tabId),
            sftp, // This is the ssh2.sftp instance
            timeoutId: setTimeout(() => {
              closeSftpSession(tabId, undefined);
            }, SESSION_CONFIG.SESSION_IDLE_TIMEOUT),
            active: true,
            createdAt: now,
            lastUsed: now,
            lastChecked: now,
            busyCount: 0,
            sshClient: sshClient, // 存储SSH客户端引用，便于追踪
          };

          // 将会话加入池
          const poolRef = getOrCreatePool(tabId);
          poolRef.sessions.set(session.id, session);
          if (!poolRef.primaryId) poolRef.primaryId = session.id;
          sftpSessionLocks.delete(tabId);

          // 监听SFTP会话事件
          sftp.on("error", (sftpErr) => {
            logToFile(
              `sftpCore: SFTP session error for ${tabId} (${session.id}): ${sftpErr.message}`,
              "ERROR",
            );
            closeSftpSession(tabId, session.id);
          });
          sftp.on("close", () => {
            logToFile(
              `sftpCore: SFTP session closed by remote for ${tabId} (${session.id})`,
              "INFO",
            );
            closeSftpSession(tabId, session.id);
          });
          if (!sftpHealthCheckTimer) {
            startSftpHealthCheck();
          }
          resolve(session); // Resolve with the session object
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
// 如果提供sessionId，则仅关闭该会话；否则关闭该tab的所有会话
async function closeSftpSession(tabId, sessionId = undefined) {
  const pool = sftpPools.get(tabId);
  if (!pool) return;

  const closeOne = (sess) => {
    if (!sess) return;
    if (sess.timeoutId) clearTimeout(sess.timeoutId);
    sess.active = false;
    try {
      if (sess.sftp && typeof sess.sftp.end === "function") {
        sess.sftp.end();
      }
    } catch (error) {
      logToFile(
        `sftpCore: Error closing SFTP session (sftp.end()) for ${tabId} (${sess.id}): ${error.message}`,
        "ERROR",
      );
    }
    pool.sessions.delete(sess.id);
    if (pool.primaryId === sess.id) {
      pool.primaryId =
        pool.sessions.size > 0 ? [...pool.sessions.keys()][0] : null;
    }
    logToFile(
      `sftpCore: Closed SFTP session for ${tabId} (${sess.id})`,
      "INFO",
    );
  };

  if (sessionId) {
    const sess = pool.sessions.get(sessionId);
    closeOne(sess);
  } else {
    for (const sess of [...pool.sessions.values()]) {
      closeOne(sess);
    }
  }

  // 若全局已无会话，停止健康检查
  if (getTotalSessionCount() === 0 && sftpHealthCheckTimer) {
    stopSftpHealthCheck();
  }
}

// 关闭指定tab的所有会话（语义化API）
async function closeAllSftpSessionsForTab(tabId) {
  return closeSftpSession(tabId, undefined);
}

// 借出一个SFTP会话（尽量创建新的，或选择最空闲的）
async function borrowSftpSession(tabId) {
  const pool = getOrCreatePool(tabId);

  // 优先创建新会话（未达到上限）
  if (pool.sessions.size < SESSION_CONFIG.MAX_SESSIONS_PER_TAB) {
    try {
      const session = await acquireSftpSession(tabId);
      session.busyCount = 1;
      return { sftp: session.sftp, sessionId: session.id };
    } catch (e) {
      // 回退到已有会话
      logToFile(
        `sftpCore: Failed to create new session on borrow, fallback to existing: ${e.message}`,
        "WARN",
      );
    }
  }

  // 从现有会话中选择busyCount最小的
  let target = null;
  for (const sess of pool.sessions.values()) {
    if (!target || sess.busyCount < target.busyCount) target = sess;
  }
  if (!target) {
    // 无可用会话，则强制创建一个
    const session = await acquireSftpSession(tabId);
    session.busyCount = 1;
    return { sftp: session.sftp, sessionId: session.id };
  }
  target.busyCount++;
  target.lastUsed = Date.now();
  return { sftp: target.sftp, sessionId: target.id };
}

// 归还一个SFTP会话
function releaseSftpSession(tabId, sessionId) {
  const pool = sftpPools.get(tabId);
  if (!pool) return;
  const session = pool.sessions.get(sessionId);
  if (!session) return;
  session.busyCount = Math.max(0, (session.busyCount || 0) - 1);
  session.lastUsed = Date.now();
}

async function enqueueSftpOperation(tabId, operation, options = {}) {
  const type = options.type || "generic";
  const path = options.path || ".";
  const canMerge = Boolean(options.canMerge);
  const priority = options.priority || "normal";

  // Parse priority to numeric value using parsePriority function
  const priorityValue = parsePriority(priority);

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
    let timeoutMs = TIMEOUT_CONFIG.BASE_OPERATION_TIMEOUT;

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
        timeoutMs = TIMEOUT_CONFIG.LARGE_FILE_TIMEOUT;
      } else {
        // 单文件操作，使用大文件超时
        timeoutMs = TIMEOUT_CONFIG.LARGE_FILE_TIMEOUT;
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
    if (nextOp.retries < nextOp.maxRetries && configIsRetryableError(error)) {
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
    // 直接返回主会话的原生ssh2 SFTP对象，供传输模块使用
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
  const pool = sftpPools.get(tabId);
  if (!pool || !pool.primaryId || !pool.sessions.has(pool.primaryId))
    return null;
  const session = pool.sessions.get(pool.primaryId);
  return {
    active: session.active,
    createdAt: session.createdAt,
    lastUsed: session.lastUsed,
    lastChecked: session.lastChecked,
    sessionId: session.id,
    sessionCount: pool.sessions.size,
  };
}

// 批量清理会话，用于性能优化
async function optimizeSftpSessions() {
  try {
    const total = getTotalSessionCount();
    logToFile(
      `sftpCore: Starting SFTP session optimization, current sessions: ${total}`,
      "INFO",
    );

    const now = Date.now();
    let optimizedCount = 0;

    for (const [tabId, pool] of sftpPools.entries()) {
      for (const session of pool.sessions.values()) {
        const idleTime = now - session.lastUsed;
        if (idleTime > SESSION_CONFIG.SESSION_IDLE_TIMEOUT / 2) {
          try {
            await checkSessionAlive(tabId, session);
            optimizedCount++;
          } catch (error) {
            logToFile(
              `sftpCore: Session optimization failed for ${tabId} (${session.id}), will be closed: ${error.message}`,
              "WARN",
            );
          }
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
      remainingSessions: getTotalSessionCount(),
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
  closeAllSftpSessionsForTab,
  enqueueSftpOperation,
  clearPendingOperationsForTab, // 导出新函数
  ensureSftpSession, // 导出新方法
  calculateDynamicTimeout, // 导出动态超时计算函数
  borrowSftpSession,
  releaseSftpSession,
  // processSftpQueue is internal, not exported
  // checkSftpSessionsHealth and checkSessionAlive are also internal after startSftpHealthCheck is called
};
