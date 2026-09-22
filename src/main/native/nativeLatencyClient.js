const { spawn } = require("child_process");
const { getNativeServicesHostPath } = require("./nativeServices");

/**
 * 延迟探测长驻 sidecar 桥接（Phase 2）。
 *
 * 按需启动 `latency-serve`，等待 ready 后发请求；以请求表关联 Promise。
 * 生命周期：启动/请求超时、异常退出统一拒绝、有限退避重启、退出清理。
 * 重启后重新下发仍有效会话的代理快照，不重放旧探测。
 */

const LATENCY_SCHEMA_VERSION = 1;
const REQUEST_TIMEOUT_MARGIN_MS = 2000;
const START_TIMEOUT_MS = 10000;
const RESTART_BACKOFF_MS = 500;
const MAX_RESTART_ATTEMPTS = 5;
const STDERR_LIMIT_BYTES = 64 * 1024;

function createLatencyError(message, details = {}) {
  const error = new Error(message);
  error.errorCode = details.errorCode || "LATENCY_SIDECAR_ERROR";
  error.errorKind = details.errorKind || "sidecar";
  error.retryable = details.retryable !== false;
  error.module = details.module || "native-latency-client";
  return error;
}

function normalizeErrorMessage(error) {
  if (!error) return "unknown error";
  return error.message || String(error);
}

let requestCounter = 0;
function nextRequestId() {
  requestCounter += 1;
  return `lat-${process.pid}-${requestCounter}`;
}

class NativeLatencyClient {
  constructor() {
    this.child = null;
    this.ready = false;
    this.readyPromise = null;
    this.capabilities = [];
    this.maxConcurrentProbes = 0;
    this.requests = new Map(); // requestId -> { resolve, reject, timer }
    this.sessionProxies = new Map(); // sessionId -> { proxyRevision, proxy, proxyRequired }
    this.stderrData = "";
    this.restartAttempts = 0;
    this.stopping = false;
    this.restartTimer = null;
    this.starting = false;
  }

  _spawn() {
    const hostPath = getNativeServicesHostPath();
    if (!hostPath) {
      return Promise.reject(
        createLatencyError(
          "Native services host is not available; prepare or update native services",
          {
            errorCode: "LATENCY_SIDECAR_MISSING",
            errorKind: "sidecar",
            retryable: false,
          },
        ),
      );
    }

    const child = spawn(hostPath, ["latency-serve"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.child = child;
    this.ready = false;
    this.stderrData = "";

    child.stderr.on("data", (chunk) => {
      this.stderrData += chunk.toString("utf8");
      if (this.stderrData.length > STDERR_LIMIT_BYTES) {
        this.stderrData = `${this.stderrData.slice(0, STDERR_LIMIT_BYTES)}...`;
        try {
          child.stderr.destroy();
        } catch {
          /* intentionally ignored */
        }
      }
    });

    child.on("error", (error) => {
      this._handleExit(
        createLatencyError(
          `Failed to start native latency sidecar: ${normalizeErrorMessage(error)}`,
          {
            errorCode: "LATENCY_SIDECAR_START_FAILED",
            errorKind: "sidecar",
            retryable: false,
          },
        ),
      );
    });

    child.on("close", (code, signal) => {
      this._handleExit(
        createLatencyError(
          `Native latency sidecar exited unexpectedly (code ${code ?? signal})`,
          {
            errorCode: "LATENCY_SIDECAR_EXITED",
            errorKind: "sidecar",
            retryable: true,
          },
        ),
      );
    });

    this.readyPromise = this._awaitReady();
    return this.readyPromise;
  }

  _awaitReady() {
    return new Promise((resolve, reject) => {
      let lineBuffer = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(
          createLatencyError("Native latency sidecar did not become ready", {
            errorCode: "LATENCY_SIDECAR_START_TIMEOUT",
            errorKind: "sidecar",
            retryable: true,
          }),
        );
      }, START_TIMEOUT_MS);
      if (typeof timer.unref === "function") timer.unref();

      const onLine = (line) => {
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          return; // 忽略非协议输出
        }
        if (parsed.type !== "ready" || settled) {
          return;
        }
        if (parsed.schemaVersion !== LATENCY_SCHEMA_VERSION) {
          settled = true;
          clearTimeout(timer);
          this.child.stdout.removeListener("data", onData);
          reject(
            createLatencyError(
              `Unsupported native latency schema version: ${parsed.schemaVersion}`,
              {
                errorCode: "LATENCY_PROTOCOL_VERSION",
                errorKind: "protocol",
                retryable: false,
              },
            ),
          );
          return;
        }
        this.ready = true;
        this.capabilities = Array.isArray(parsed.capabilities)
          ? parsed.capabilities
          : [];
        this.maxConcurrentProbes = parsed.maxConcurrentProbes || 0;
        settled = true;
        clearTimeout(timer);
        this.child.stdout.removeListener("data", onData);
        resolve();
      };

      const onData = (chunk) => {
        lineBuffer += chunk.toString("utf8");
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) onLine(line.trim());
        }
      };

      this.child.stdout.on("data", onData);
    });
  }

  async ensureStarted() {
    if (this.ready && this.child) {
      return;
    }
    if (this.readyPromise && this.starting) {
      return this.readyPromise;
    }
    this.starting = true;
    try {
      await this._spawn();
    } finally {
      this.starting = false;
    }
  }

  _handleExit(error) {
    const wasReady = this.ready;
    this.ready = false;
    this.readyPromise = null;

    // 统一拒绝所有待处理请求；重启后不重放旧探测
    for (const [, pending] of this.requests) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.requests.clear();

    if (this.stopping || !this.child) {
      return;
    }
    this.child = null;

    // 有限退避重启（仅在之前已就绪、非主动停止时）
    if (wasReady && this.restartAttempts < MAX_RESTART_ATTEMPTS) {
      this.restartAttempts += 1;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.ensureStarted()
          .then(() => {
            this.restartAttempts = 0;
            // 重启成功后重新下发仍有效会话的代理快照
            for (const [sessionId, snapshot] of this.sessionProxies) {
              this._sendProxyUpdate(sessionId, snapshot);
            }
          })
          .catch(() => {
            /* 重启失败；下次请求时再次尝试 */
          });
      }, RESTART_BACKOFF_MS);
      if (typeof this.restartTimer.unref === "function")
        this.restartTimer.unref();
    }
  }

  _send(sessionId, message, { timeoutMs, signal } = {}) {
    return new Promise((resolve, reject) => {
      const requestId = message.requestId;
      const pending = {
        resolve: null,
        reject: null,
        timer: null,
      };
      pending.resolve = (value) => {
        clearTimeout(pending.timer);
        this.requests.delete(requestId);
        removeAbortListener();
        resolve(value);
      };
      pending.reject = (error) => {
        clearTimeout(pending.timer);
        this.requests.delete(requestId);
        removeAbortListener();
        reject(error);
      };
      pending.timer = setTimeout(() => {
        this.requests.delete(requestId);
        removeAbortListener();
        reject(
          createLatencyError("Native latency request timed out", {
            errorCode: "LATENCY_REQUEST_TIMEOUT",
            errorKind: "timeout",
            retryable: true,
          }),
        );
      }, timeoutMs);
      if (typeof pending.timer.unref === "function") pending.timer.unref();

      const onAbort = () => {
        // 取消：终止子进程中的目标请求并本地拒绝
        this._sendControl({
          type: "cancel",
          requestId: nextRequestId(),
          targetRequestId: requestId,
        });
        pending.reject(
          createLatencyError("Native latency probe was cancelled", {
            errorCode: "LATENCY_CANCELLED",
            errorKind: "cancelled",
            retryable: false,
          }),
        );
      };
      const removeAbortListener = () => {
        if (signal) signal.removeEventListener("abort", onAbort);
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });

      this.requests.set(requestId, pending);
      pending.sessionId = sessionId;
      try {
        this.child.stdin.write(`${JSON.stringify(message)}\n`);
      } catch (error) {
        pending.reject(
          createLatencyError(
            `Failed to write native latency request: ${normalizeErrorMessage(error)}`,
            {
              errorCode: "LATENCY_SIDECAR_ERROR",
              errorKind: "sidecar",
              retryable: true,
            },
          ),
        );
      }
    });
  }

  _sendControl(message) {
    try {
      this.child?.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      /* intentionally ignored */
    }
  }

  _handleProtocolLine(line) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return; // 损坏 JSON 不当作成功；仅忽略无法解析的行
    }
    if (parsed.type === "result" || parsed.type === "error") {
      const pending = this.requests.get(parsed.requestId);
      if (!pending) return; // 迟到的旧请求结果被丢弃
      if (parsed.type === "error") {
        pending.reject(
          createLatencyError(parsed.error || "Native latency probe failed", {
            errorCode: parsed.errorCode || "LATENCY_SIDECAR_ERROR",
            errorKind: parsed.errorKind || "sidecar",
            retryable: parsed.retryable !== false,
          }),
        );
        return;
      }
      pending.resolve(parsed);
    }
  }

  _startReading() {
    let lineBuffer = "";
    this.child.stdout.on("data", (chunk) => {
      lineBuffer += chunk.toString("utf8");
      const lines = lineBuffer.split(/\r?\n/);
      lineBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) this._handleProtocolLine(line.trim());
      }
    });
  }

  _sendProxyUpdate(sessionId, snapshot) {
    this._sendControl({
      type: "proxyUpdate",
      requestId: nextRequestId(),
      sessionId,
      proxyRevision: snapshot.proxyRevision,
      proxy: snapshot.proxy || null,
      proxyRequired: snapshot.proxyRequired || false,
    });
  }

  /**
   * 发起一次探测。
   *
   * @param {object} options { sessionId, generation, host, port, timeoutMs,
   *   proxyRevision, proxy, proxyRequired, signal }
   * @returns {Promise<{latencyMs, method, generation, proxyRevision}>}
   */
  async probe(options) {
    const {
      sessionId,
      generation,
      host,
      port,
      timeoutMs = 5000,
      proxyRevision,
      proxy,
      proxyRequired,
      signal,
    } = options || {};
    if (!sessionId || !host || !port) {
      throw createLatencyError(
        "Latency probe requires sessionId, host and port",
        {
          errorCode: "LATENCY_INVALID_REQUEST",
          errorKind: "validation",
          retryable: false,
        },
      );
    }
    signal?.throwIfAborted();
    await this.ensureStarted();
    this._startReadingOnce();

    const snapshot = {
      proxyRevision,
      proxy,
      proxyRequired: Boolean(proxyRequired),
    };
    const previous = this.sessionProxies.get(sessionId);
    if (!previous || previous.proxyRevision !== proxyRevision) {
      this.sessionProxies.set(sessionId, snapshot);
      this._sendProxyUpdate(sessionId, snapshot);
    }

    const result = await this._send(
      sessionId,
      {
        type: "probe",
        requestId: nextRequestId(),
        sessionId,
        generation,
        host,
        port,
        timeoutMs,
        proxyRevision,
      },
      { timeoutMs: timeoutMs + REQUEST_TIMEOUT_MARGIN_MS, signal },
    );
    return result;
  }

  _startReadingOnce() {
    if (this._reading) return;
    this._reading = true;
    this._startReading();
  }

  /** 会话代理变更时更新快照并下发 */
  updateSessionProxy(sessionId, snapshot) {
    this.sessionProxies.set(sessionId, snapshot);
    if (this.ready) {
      this._sendProxyUpdate(sessionId, snapshot);
    }
  }

  /** 会话注销时取消关联请求并移除快照 */
  cancelSession(sessionId) {
    const targets = [];
    for (const [requestId, pending] of this.requests) {
      targets.push({ requestId, pending, sessionId: pending.sessionId });
    }
    for (const { requestId, pending } of targets) {
      if (sessionId && pending.sessionId && pending.sessionId !== sessionId) {
        continue;
      }
      clearTimeout(pending.timer);
      pending.reject(
        createLatencyError("Native latency probe was cancelled", {
          errorCode: "LATENCY_CANCELLED",
          errorKind: "cancelled",
          retryable: false,
        }),
      );
      this.requests.delete(requestId);
    }
    if (sessionId) {
      this.sessionProxies.delete(sessionId);
    }
  }

  /** 清理：关闭子进程，等待退出并提供有界超时后的强制终止 */
  close(timeoutMs = 2000) {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    for (const [, pending] of this.requests) {
      clearTimeout(pending.timer);
      pending.reject(
        createLatencyError("Native latency client is closing", {
          errorCode: "LATENCY_CANCELLED",
          errorKind: "cancelled",
          retryable: false,
        }),
      );
    }
    this.requests.clear();
    this.sessionProxies.clear();
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      this.child = null;
      this.ready = false;
      return;
    }
    try {
      child.stdin.end();
    } catch {
      /* intentionally ignored */
    }
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* intentionally ignored */
      }
    }, timeoutMs);
    child.once("close", () => clearTimeout(killTimer));
    this.child = null;
    this.ready = false;
    this.readyPromise = null;
  }
}

const sharedClient = new NativeLatencyClient();

module.exports = {
  NativeLatencyClient,
  nativeLatencyClient: sharedClient,
  createLatencyError,
};
