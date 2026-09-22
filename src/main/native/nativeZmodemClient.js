const { spawn } = require("child_process");
const { logToFile } = require("../utils/logger");
const { getNativeServicesHostPath } = require("./nativeServices");

/**
 * `zmodem-serve` sidecar 客户端（Phase 3 P3.5）。
 *
 * 单个长驻 sidecar 进程承载所有终端会话的 ZMODEM 协议状态机：
 *  - NDJSON 控制消息 + Base64 字节载荷（见 sidecars/zmodem/README.md）；
 *  - 输入：open/input/acceptFile/sendFiles/cancel/close；
 *  - 输出：passthrough（交给终端的原始字节）、writeRemote（写回 SSH 流的
 *    协议字节）、event（intro/offer/progress/fileDone/done/cancelled/error）。
 *
 * 生命周期：按需启动、等待 ready 后发消息；进程异常退出时通知监听方
 * （进行中的会话由编排器终结），下次调用按有限退避重启；重启只服务新会话。
 */
const RESTART_BACKOFF_BASE_MS = 500;
const RESTART_BACKOFF_MAX_MS = 5000;
const READY_TIMEOUT_MS = 10000;

class NativeZmodemClient {
  constructor(options = {}) {
    this._options = options;
    this._process = null;
    this._ready = false;
    this._readyPromise = null;
    this._messageHandler = null;
    this._exitHandler = null;
    this._lineBuffer = "";
    this._destroyed = false;
    this._restarts = 0;
    this._lastExitAt = 0;
    this._sessions = new Set();
  }

  /** 注册消息监听（编排器）：(type, sessionId, payload) */
  setMessageHandler(handler) {
    this._messageHandler = handler;
  }

  /** 注册进程退出监听：(exitedCleanly) */
  setExitHandler(handler) {
    this._exitHandler = handler;
  }

  _emit(type, sessionId, payload = {}) {
    if (typeof this._messageHandler === "function") {
      try {
        this._messageHandler(type, sessionId, payload);
      } catch (error) {
        logToFile(`nativeZmodemClient handler error: ${error.message}`, "WARN");
      }
    }
  }

  _hasHostPath() {
    if (typeof this._options.hasHostPath === "function") {
      return this._options.hasHostPath();
    }
    try {
      return Boolean(getNativeServicesHostPath());
    } catch {
      return false;
    }
  }

  /**
   * 按需启动 sidecar 并等待 ready。
   * @returns {Promise<boolean>} 进程是否可用
   */
  async ensureReady() {
    if (this._destroyed) {
      return false;
    }
    if (this._process && this._ready) {
      return true;
    }
    if (this._readyPromise) {
      return this._readyPromise;
    }
    this._readyPromise = this._start().finally(() => {
      this._readyPromise = null;
    });
    return this._readyPromise;
  }

  _start() {
    return new Promise((resolve) => {
      if (!this._hasHostPath()) {
        resolve(false);
        return;
      }
      let child;
      try {
        const hostPath =
          typeof this._options.getHostPath === "function"
            ? this._options.getHostPath()
            : getNativeServicesHostPath();
        child = spawn(hostPath, ["zmodem-serve"], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        logToFile(`nativeZmodemClient spawn failed: ${error.message}`, "WARN");
        resolve(false);
        return;
      }

      this._process = child;
      this._lineBuffer = "";

      // 启动超时：视为不可用
      const readyTimer = setTimeout(() => {
        if (!this._ready) {
          logToFile("nativeZmodemClient ready timeout", "WARN");
          this._teardown(false);
          resolve(false);
        }
      }, READY_TIMEOUT_MS);

      child.stdout.on("data", (chunk) => {
        this._lineBuffer += chunk.toString("utf8");
        const lines = this._lineBuffer.split(/\r?\n/);
        this._lineBuffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          let message;
          try {
            message = JSON.parse(line);
          } catch {
            continue;
          }
          if (message.type === "ready") {
            this._ready = true;
            clearTimeout(readyTimer);
            resolve(true);
            continue;
          }
          this._emit(message.type, message.sessionId, message);
        }
      });

      child.stderr.on("data", () => {});

      child.on("error", (error) => {
        clearTimeout(readyTimer);
        if (!this._ready) {
          logToFile(
            `nativeZmodemClient process error: ${error.message}`,
            "WARN",
          );
          resolve(false);
        }
        this._teardown(false);
      });

      child.on("exit", (code) => {
        clearTimeout(readyTimer);
        const wasReady = this._ready;
        this._lastExitAt = Date.now();
        this._ready = false;
        this._process = null;
        if (!wasReady) {
          resolve(false);
        }
        if (this._destroyed) {
          return;
        }
        // 通知编排器：进行中的会话需终结；重启只服务新会话
        this._emit("process-exit", null, { code, clean: code === 0 });
        if (typeof this._exitHandler === "function") {
          try {
            this._exitHandler(code === 0);
          } catch {
            /* ignore */
          }
        }
        this._sessions.clear();
      });
    });
  }

  _teardown(clean) {
    this._ready = false;
    if (this._process) {
      const child = this._process;
      this._process = null;
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
    if (!clean && !this._destroyed) {
      this._emit("process-exit", null, { clean: false });
    }
  }

  /** 发送原始控制消息（内部） */
  _send(message) {
    if (!this._process || !this._ready) {
      return false;
    }
    try {
      this._process.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch (error) {
      logToFile(`nativeZmodemClient write failed: ${error.message}`, "WARN");
      return false;
    }
  }

  open(sessionId) {
    this._sessions.add(String(sessionId));
    return this._send({ type: "open", sessionId: String(sessionId) });
  }

  input(sessionId, chunk) {
    if (!chunk || !chunk.length) {
      return true;
    }
    return this._send({
      type: "input",
      sessionId: String(sessionId),
      dataBase64: Buffer.from(chunk).toString("base64"),
    });
  }

  acceptFile(sessionId, targetPath) {
    return this._send({
      type: "acceptFile",
      sessionId: String(sessionId),
      path: targetPath,
    });
  }

  sendFiles(sessionId, files) {
    return this._send({
      type: "sendFiles",
      sessionId: String(sessionId),
      files: files.map((file) => ({
        path: file.path,
        name: file.name,
        size: file.size,
        mtimeMs: file.mtimeMs,
      })),
    });
  }

  cancel(sessionId) {
    this._sessions.delete(String(sessionId));
    return this._send({ type: "cancel", sessionId: String(sessionId) });
  }

  close(sessionId) {
    this._sessions.delete(String(sessionId));
    return this._send({ type: "close", sessionId: String(sessionId) });
  }

  /** 是否有存活的 sidecar 进程 */
  isRunning() {
    return Boolean(this._process && this._ready);
  }

  destroy() {
    this._destroyed = true;
    this._sessions.clear();
    this._teardown(true);
  }
}

const sharedClient = new NativeZmodemClient({});

module.exports = {
  NativeZmodemClient,
  nativeZmodemClient: sharedClient,
  RESTART_BACKOFF_BASE_MS,
  RESTART_BACKOFF_MAX_MS,
};
