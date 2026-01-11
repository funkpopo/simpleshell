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

/**
 * 获取worker文件路径
 */
function getWorkerPath() {
  let workerPath = path.join(__dirname, "..", "..", "workers", "ai-worker.js");
  if (fs.existsSync(workerPath)) {
    return workerPath;
  }

  workerPath = path.join(__dirname, "..", "..", "..", "src", "workers", "ai-worker.js");
  if (fs.existsSync(workerPath)) {
    return workerPath;
  }

  throw new Error("找不到AI worker文件");
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
    aiWorker.terminate();
  }

  try {
    const workerPath = getWorkerPath();
    logToFile(`创建AI Worker: ${workerPath}`, "INFO");

    aiWorker = new Worker(workerPath);
    mainProcessResourceManager.addWorker(aiWorker, 'AI Worker');

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
    mainProcessResourceManager.addEventListener(aiWorker, 'message', messageHandler, 'AI Worker message handler');

    const errorHandler = (error) => {
      logToFile(`AI Worker错误: ${error.message}`, "ERROR");
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(new Error("AI Worker encountered an error: " + error.message));
        aiRequestMap.delete(id);
      }
      streamSessions.clear();
    };

    aiWorker.on("error", errorHandler);
    mainProcessResourceManager.addEventListener(aiWorker, 'error', errorHandler, 'AI Worker error handler');

    const exitHandler = (code) => {
      logToFile(`AI Worker退出，代码: ${code}`, "WARN");
      if (code !== 0) {
        const timerId = setTimeout(() => {
          logToFile("尝试重启AI Worker", "INFO");
          createAIWorker();
        }, 1000);
        mainProcessResourceManager.addTimer(timerId, 'timeout', 'AI Worker restart timer');
      }
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(new Error(`AI Worker stopped unexpectedly with code ${code}`));
        aiRequestMap.delete(id);
      }
      streamSessions.clear();
    };

    aiWorker.on("exit", exitHandler);
    mainProcessResourceManager.addEventListener(aiWorker, 'exit', exitHandler, 'AI Worker exit handler');

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
      await aiWorker.terminate();
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
