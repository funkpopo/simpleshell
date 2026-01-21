const { Worker } = require("worker_threads");
const { BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { logToFile } = require("../utils/logger");
const { mainProcessResourceManager } = require("../utils/mainProcessResourceManager");

// AI Worker状态
let aiWorker = null;
let aiRequestMap = new Map();
let nextRequestId = 1;
const streamSessions = new Map();
let currentSessionId = null;

// 资源管理器注册的清理函数（用于避免资源表无限增长/误报）
let disposeWorkerResource = null;
let disposeMessageListenerResource = null;
let disposeErrorListenerResource = null;
let disposeExitListenerResource = null;
let disposeRestartTimerResource = null;

// 记录当前绑定到 worker 的 handler，便于在重建/退出时主动解绑
let currentWorkerHandlers = null;

function safeCallDisposer(disposer) {
  try {
    if (!disposer) return null;
    const result = disposer();
    // removeResource 是 async，这里允许返回 Promise
    return Promise.resolve(result);
  } catch (e) {
    return Promise.reject(e);
  }
}

async function cleanupRestartTimerRegistration() {
  if (!disposeRestartTimerResource) return;
  const disposer = disposeRestartTimerResource;
  disposeRestartTimerResource = null;
  await Promise.allSettled([safeCallDisposer(disposer)]);
}

function detachCurrentWorkerEventHandlers(worker) {
  if (!worker || !currentWorkerHandlers) return;
  try {
    if (currentWorkerHandlers.messageHandler) {
      worker.removeListener("message", currentWorkerHandlers.messageHandler);
    }
    if (currentWorkerHandlers.errorHandler) {
      worker.removeListener("error", currentWorkerHandlers.errorHandler);
    }
    if (currentWorkerHandlers.exitHandler) {
      worker.removeListener("exit", currentWorkerHandlers.exitHandler);
    }
  } catch (e) {
    // 忽略解绑异常，避免影响后续清理流程
  } finally {
    currentWorkerHandlers = null;
  }
}

async function cleanupWorkerRegistrations({ terminateWorker } = { terminateWorker: true }) {
  // 先清理 restart timer 的资源注册（如果存在）
  await cleanupRestartTimerRegistration();

  // 清理事件监听器资源注册（会触发 removeListener）
  const listenerDisposers = [
    disposeMessageListenerResource,
    disposeErrorListenerResource,
    disposeExitListenerResource,
  ].filter(Boolean);
  disposeMessageListenerResource = null;
  disposeErrorListenerResource = null;
  disposeExitListenerResource = null;
  await Promise.allSettled(listenerDisposers.map(safeCallDisposer));

  // 清理 worker 资源注册（会触发 terminate）
  if (disposeWorkerResource) {
    const disposer = disposeWorkerResource;
    disposeWorkerResource = null;
    if (terminateWorker) {
      await Promise.allSettled([safeCallDisposer(disposer)]);
    } else {
      // 当前资源管理器的 worker 清理逻辑会 terminate；这里仍然执行，
      // 但如果 worker 已退出，terminate 通常是幂等/可忽略。
      await Promise.allSettled([safeCallDisposer(disposer)]);
    }
  }
}

/**
 * 获取worker文件路径
 */
function getWorkerPath() {
  // 可能的路径列表
  const possiblePaths = [
    // webpack打包后的路径 (.webpack/main/workers/ai-worker.js)
    path.join(__dirname, "workers", "ai-worker.js"),
    // 开发环境路径 (src/workers/ai-worker.js)
    path.join(__dirname, "..", "..", "workers", "ai-worker.js"),
    // 备用路径
    path.join(__dirname, "..", "..", "..", "src", "workers", "ai-worker.js"),
  ];

  for (const workerPath of possiblePaths) {
    if (fs.existsSync(workerPath)) {
      return workerPath;
    }
  }

  throw new Error(`找不到AI worker文件，已尝试路径: ${possiblePaths.join(", ")}`);
}

/**
 * 处理Worker发送的类型化消息
 */
function handleWorkerTypeMessage(type, id, data, result, error) {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow || !mainWindow.webContents || mainWindow.webContents.isDestroyed()) {
    logToFile("无法发送Worker消息: 主窗口不可用", "ERROR");
    return;
  }

  switch (type) {
    case "init":
      logToFile(`AI Worker初始化完成: ${JSON.stringify(result)}`, "INFO");
      break;

    case "stream_chunk":
      if (data && data.sessionId) {
        streamSessions.set(data.sessionId, id);
        mainWindow.webContents.send("stream-chunk", {
          tabId: "ai",
          chunk: data.chunk,
          sessionId: data.sessionId,
        });
      }
      break;

    case "stream_end":
      if (data && data.sessionId) {
        mainWindow.webContents.send("stream-end", {
          tabId: "ai",
          sessionId: data.sessionId,
          aborted: data.aborted || false,
        });
        streamSessions.delete(data.sessionId);
      }
      break;

    case "stream_error":
      if (data && data.sessionId) {
        mainWindow.webContents.send("stream-error", {
          tabId: "ai",
          sessionId: data.sessionId,
          error: data.error || { message: "未知错误" },
        });
        streamSessions.delete(data.sessionId);
      }
      break;

    case "worker_error":
      logToFile(`AI Worker内部错误: ${error?.message || "未知错误"}`, "ERROR");
      break;

    case "worker_exit":
      logToFile(`AI Worker退出事件: ${JSON.stringify(result)}`, "INFO");
      break;

    default:
      logToFile(`未知的Worker消息类型: ${type}`, "WARN");
  }
}

/**
 * 创建AI Worker线程
 */
function createAIWorker() {
  if (aiWorker) {
    // 先解绑监听器，避免旧 worker / handler 残留
    detachCurrentWorkerEventHandlers(aiWorker);
    // 尽量从资源管理器中移除旧注册，避免资源表增长
    void cleanupWorkerRegistrations({ terminateWorker: true });
    // 如果未通过资源管理器登记 worker，则直接终止旧 worker（不等待）
    if (!disposeWorkerResource) {
      try {
        aiWorker.terminate();
      } catch (e) {
        // ignore
      }
    }
    aiWorker = null;
  }

  try {
    const workerPath = getWorkerPath();
    logToFile(`创建AI Worker: ${workerPath}`, "INFO");

    aiWorker = new Worker(workerPath);
    // AI Worker 属于预期长生命周期资源，避免被 30 分钟阈值误判为泄漏
    disposeWorkerResource = mainProcessResourceManager.addWorker(aiWorker, "AI Worker", {
      skipLeakCheck: true,
    });

    const messageHandler = (message) => {
      const { id, type, result, error, data } = message;

      if (type) {
        handleWorkerTypeMessage(type, id, data, result, error);
        return;
      }

      const callback = aiRequestMap.get(id);
      if (callback) {
        if (error) {
          const errorMessage = error.message || 'Unknown error';
          callback.reject(new Error(errorMessage));
        } else {
          callback.resolve(result);
        }
        aiRequestMap.delete(id);
      } else {
        logToFile(`收到未知请求ID的响应: ${id}`, "WARN");
      }
    };

    aiWorker.on("message", messageHandler);
    disposeMessageListenerResource = mainProcessResourceManager.addEventListener(
      aiWorker,
      "message",
      messageHandler,
      "AI Worker message handler",
      { skipLeakCheck: true }
    );

    const errorHandler = (error) => {
      logToFile(`AI Worker错误: ${error.message}`, "ERROR");
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(new Error("AI Worker encountered an error: " + error.message));
        aiRequestMap.delete(id);
      }
      streamSessions.clear();
    };

    aiWorker.on("error", errorHandler);
    disposeErrorListenerResource = mainProcessResourceManager.addEventListener(
      aiWorker,
      "error",
      errorHandler,
      "AI Worker error handler",
      { skipLeakCheck: true }
    );

    const exitHandler = (code) => {
      logToFile(`AI Worker退出，代码: ${code}`, "WARN");
      if (code !== 0) {
        const timerId = setTimeout(() => {
          logToFile("尝试重启AI Worker", "INFO");
          // timer 已触发，移除其资源注册（避免资源管理器长期保留一次性 timer）
          void cleanupRestartTimerRegistration();
          createAIWorker();
        }, 1000);
        // timer 是一次性的，但仍登记以便应用退出时统一清理
        disposeRestartTimerResource = mainProcessResourceManager.addTimer(
          timerId,
          "timeout",
          "AI Worker restart timer"
        );
      }
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(new Error(`AI Worker stopped unexpectedly with code ${code}`));
        aiRequestMap.delete(id);
      }
      streamSessions.clear();

      // worker 已退出，清理当前注册（不阻塞 exit 回调）
      detachCurrentWorkerEventHandlers(aiWorker);
      void cleanupWorkerRegistrations({ terminateWorker: false });
      aiWorker = null;
    };

    aiWorker.on("exit", exitHandler);
    disposeExitListenerResource = mainProcessResourceManager.addEventListener(
      aiWorker,
      "exit",
      exitHandler,
      "AI Worker exit handler",
      { skipLeakCheck: true }
    );

    currentWorkerHandlers = { messageHandler, errorHandler, exitHandler };

    // 初始化系统代理配置
    try {
      const proxyManager = require("../proxy/proxy-manager");
      const proxyConfig = proxyManager.getDefaultProxyConfig() || proxyManager.getSystemProxyConfig();
      if (proxyConfig) {
        aiWorker.postMessage({
          type: "update_proxy",
          id: `proxy_init_${Date.now()}`,
          data: proxyConfig,
        });
        logToFile(`AI Worker 代理已配置: ${proxyConfig.host}:${proxyConfig.port}`, "INFO");
      }
    } catch (proxyError) {
      logToFile(`AI Worker 代理配置失败: ${proxyError.message}`, "WARN");
    }

    return aiWorker;
  } catch (error) {
    logToFile(`创建AI Worker失败: ${error.message}`, "ERROR");
    return null;
  }
}

/**
 * 获取当前AI Worker实例
 */
function getAIWorker() {
  return aiWorker;
}

/**
 * 确保AI Worker已创建
 */
function ensureAIWorker() {
  if (!aiWorker) {
    logToFile("AI Worker未初始化，尝试创建", "WARN");
    aiWorker = createAIWorker();
  }
  return aiWorker;
}

/**
 * 终止AI Worker
 */
async function terminateAIWorker() {
  if (aiWorker) {
    try {
      detachCurrentWorkerEventHandlers(aiWorker);
      await cleanupWorkerRegistrations({ terminateWorker: true });
    } catch (err) {
      logToFile(`Error terminating AI worker: ${err.message}`, "ERROR");
    }
    aiWorker = null;
  }
}

/**
 * 生成下一个请求ID
 */
function getNextRequestId() {
  return `req_${nextRequestId++}`;
}

/**
 * 设置请求回调
 */
function setRequestCallback(requestId, callback) {
  aiRequestMap.set(requestId, callback);
}

/**
 * 删除请求回调
 */
function deleteRequestCallback(requestId) {
  aiRequestMap.delete(requestId);
}

/**
 * 检查请求是否存在
 */
function hasRequest(requestId) {
  return aiRequestMap.has(requestId);
}

/**
 * 设置当前会话ID
 */
function setCurrentSessionId(sessionId) {
  currentSessionId = sessionId;
}

/**
 * 获取当前会话ID
 */
function getCurrentSessionId() {
  return currentSessionId;
}

/**
 * 清除当前会话ID
 */
function clearCurrentSessionId() {
  currentSessionId = null;
}

/**
 * 删除流式会话
 */
function deleteStreamSession(sessionId) {
  streamSessions.delete(sessionId);
}

module.exports = {
  createAIWorker,
  getAIWorker,
  ensureAIWorker,
  terminateAIWorker,
  getNextRequestId,
  setRequestCallback,
  deleteRequestCallback,
  hasRequest,
  setCurrentSessionId,
  getCurrentSessionId,
  clearCurrentSessionId,
  deleteStreamSession,
};
