const { spawn } = require("node:child_process");
const { BrowserWindow } = require("electron");
const { getNativeServicesHostPath } = require("../utils/nativeServices");
const { logToFile } = require("../utils/logger");
const { IPC_EVENT_CHANNELS } = require("../ipc/schema/channels");

const AI_SIDECAR_SCHEMA_VERSION = 1;
const MAX_SIDECAR_RESTART_ATTEMPTS = 3;
const SIDECAR_RESTART_BASE_DELAY_MS = 500;
let aiSidecar = null;
let stdoutBuffer = "";
let nextRequestId = 1;
let currentSessionId = null;
let restartTimer = null;
let restartAttempts = 0;
let isTerminating = false;
const requestCallbacks = new Map();

function createError(message, payload = {}) {
  const error = new Error(message);
  Object.assign(error, payload);
  return error;
}

function sendToRenderer(channel, payload) {
  const window = BrowserWindow.getAllWindows()[0];
  if (window && !window.webContents.isDestroyed()) {
    window.webContents.send(channel, payload);
  }
}

function rejectAll(error) {
  for (const callback of requestCallbacks.values()) callback.reject(error);
  requestCallbacks.clear();
}

function clearRestartTimer() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
}

function scheduleRestart() {
  if (
    isTerminating ||
    restartTimer ||
    restartAttempts >= MAX_SIDECAR_RESTART_ATTEMPTS
  ) {
    return;
  }
  const delay = SIDECAR_RESTART_BASE_DELAY_MS * 2 ** restartAttempts;
  restartAttempts += 1;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    const child = createAIWorker();
    if (!child) scheduleRestart();
  }, delay);
  if (typeof restartTimer.unref === "function") restartTimer.unref();
  logToFile(
    `Scheduling Rust AI sidecar restart ${restartAttempts}/${MAX_SIDECAR_RESTART_ATTEMPTS} in ${delay}ms`,
    "WARN",
  );
}

function handleEvent(event) {
  const callback = event.requestId
    ? requestCallbacks.get(event.requestId)
    : null;
  switch (event.kind) {
    case "ready":
      restartAttempts = 0;
      logToFile("Rust AI sidecar ready", "INFO");
      return;
    case "result":
      if (callback) {
        callback.resolve(event.result);
        requestCallbacks.delete(event.requestId);
      }
      return;
    case "streamChunk":
      sendToRenderer(IPC_EVENT_CHANNELS.AI_STREAM_CHUNK, {
        tabId: "ai",
        chunk: event.chunk,
        sessionId: event.sessionId,
      });
      return;
    case "streamEnd":
      sendToRenderer(IPC_EVENT_CHANNELS.AI_STREAM_END, {
        tabId: "ai",
        sessionId: event.sessionId,
        aborted: Boolean(event.result?.aborted),
      });
      requestCallbacks.delete(event.requestId);
      if (currentSessionId === event.sessionId) currentSessionId = null;
      return;
    case "error": {
      const error = createError(
        event.error?.message || "AI sidecar request failed",
        {
          statusCode: event.error?.statusCode,
        },
      );
      if (event.sessionId) {
        sendToRenderer(IPC_EVENT_CHANNELS.AI_STREAM_ERROR, {
          tabId: "ai",
          sessionId: event.sessionId,
          error: { message: error.message, statusCode: error.statusCode },
        });
        if (currentSessionId === event.sessionId) currentSessionId = null;
      }
      if (callback) {
        callback.reject(error);
        requestCallbacks.delete(event.requestId);
      }
    }
  }
}

function writeCommand(command) {
  if (!aiSidecar?.stdin || aiSidecar.stdin.destroyed) {
    throw createError("Rust AI sidecar is not running", {
      code: "AI_SIDECAR_UNAVAILABLE",
    });
  }
  aiSidecar.stdin.write(
    `${JSON.stringify({ schemaVersion: AI_SIDECAR_SCHEMA_VERSION, ...command })}\n`,
    "utf8",
  );
}

function createAIWorker() {
  if (aiSidecar) return aiSidecar;
  isTerminating = false;
  clearRestartTimer();
  const sidecarPath = getNativeServicesHostPath();
  if (!sidecarPath) {
    logToFile("Rust AI sidecar binary was not found", "ERROR");
    return null;
  }
  const child = spawn(sidecarPath, ["ai-serve"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  aiSidecar = child;
  stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        handleEvent(JSON.parse(line));
      } catch {
        logToFile("Rust AI sidecar returned invalid JSON", "ERROR");
      }
    }
  });
  child.stderr.on("data", () => {});
  child.on("error", (error) => {
    logToFile(`Rust AI sidecar process error: ${error.message}`, "ERROR");
    rejectAll(createError(`Rust AI sidecar process error: ${error.message}`));
  });
  child.on("exit", (code, signal) => {
    if (aiSidecar === child) aiSidecar = null;
    const error = createError(
      `Rust AI sidecar stopped unexpectedly (${code ?? signal ?? "unknown"})`,
    );
    rejectAll(error);
    if (currentSessionId) {
      sendToRenderer(IPC_EVENT_CHANNELS.AI_STREAM_ERROR, {
        tabId: "ai",
        sessionId: currentSessionId,
        error: { message: error.message },
      });
    }
    currentSessionId = null;
    logToFile(`Rust AI sidecar exited: code=${code}, signal=${signal}`, "WARN");
    scheduleRestart();
  });
  try {
    const proxyManager = require("../proxy/proxy-manager");
    const proxy =
      proxyManager.getDefaultProxyConfig() ||
      proxyManager.getSystemProxyConfig();
    if (proxy)
      writeCommand({
        kind: "proxyUpdate",
        requestId: `proxy-${Date.now()}`,
        proxy,
      });
  } catch (error) {
    logToFile(
      `Unable to configure Rust AI sidecar proxy: ${error.message}`,
      "WARN",
    );
  }
  return child;
}

function getAIWorker() {
  return aiSidecar;
}
function ensureAIWorker() {
  return aiSidecar || createAIWorker();
}
async function terminateAIWorker() {
  isTerminating = true;
  clearRestartTimer();
  const child = aiSidecar;
  aiSidecar = null;
  currentSessionId = null;
  rejectAll(createError("Rust AI sidecar terminated"));
  if (child) child.kill();
}
function getNextRequestId() {
  return `req_${nextRequestId++}`;
}

/**
 * 更新 Rust AI sidecar 使用的代理（proxyUpdate）。
 * 传入 null 时回退到默认代理/系统代理（与创建时的行为一致）。
 * @param {object|null} proxy - 代理配置（{type, host, port, username?, password?}）
 */
function updateAIProxy(proxy) {
  if (!aiSidecar) return;
  try {
    const proxyManager = require("../proxy/proxy-manager");
    const effective =
      proxy ||
      proxyManager.getDefaultProxyConfig() ||
      proxyManager.getSystemProxyConfig();
    writeCommand({
      kind: "proxyUpdate",
      requestId: `proxy-${Date.now()}`,
      proxy: effective || null,
    });
  } catch (error) {
    logToFile(`Failed to update AI sidecar proxy: ${error.message}`, "WARN");
  }
}
function setRequestCallback(requestId, callback) {
  requestCallbacks.set(requestId, callback);
}
function deleteRequestCallback(requestId) {
  requestCallbacks.delete(requestId);
}
function hasRequest(requestId) {
  return requestCallbacks.has(requestId);
}
function setCurrentSessionId(value) {
  currentSessionId = value;
}
function getCurrentSessionId() {
  return currentSessionId;
}
function clearCurrentSessionId() {
  currentSessionId = null;
}
function deleteStreamSession() {}
function postMessage(message) {
  writeCommand(message);
}
function getDiagnostics() {
  return {
    hasWorker: Boolean(aiSidecar),
    pendingRequests: requestCallbacks.size,
    streamSessions: currentSessionId ? 1 : 0,
    hasCurrentSession: Boolean(currentSessionId),
    transport: "rust-sidecar",
    restartAttempts,
    restartScheduled: Boolean(restartTimer),
  };
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
  postMessage,
  updateAIProxy,
  getDiagnostics,
};
