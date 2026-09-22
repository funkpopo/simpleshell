const { spawn } = require("child_process");
const { logToFile } = require("../utils/logger");
const { getNativeServicesHostPath } = require("./nativeServices");

/**
 * `ip-query-serve` sidecar 客户端（Phase 4 P4.2）。
 *
 * 单个长驻 sidecar 进程承载 IP 归属查询的供应商竞速与内存缓存：
 *  - NDJSON 协议（camelCase）：query/updateProxy/updateKeys/cancel/close；
 *  - 响应以 requestId 关联 Promise（请求表）；
 *  - 进程异常退出统一拒绝在途请求，下次调用按有限退避重启；
 *  - 密钥经 stdin `updateKeys` 下发，不落盘不记录。
 */
const RESTART_BACKOFF_BASE_MS = 500;
const RESTART_BACKOFF_MAX_MS = 5000;
const READY_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 15000;

class NativeIpQueryClient {
  constructor(options = {}) {
    this._options = options;
    this._process = null;
    this._ready = false;
    this._readyPromise = null;
    this._requestIdCounter = 0;
    this._pending = new Map(); // requestId -> { resolve, reject, timer }
    this._lineBuffer = "";
    this._destroyed = false;
    this._lastExitAt = 0;
    this._failures = 0;
    this._keys = new Map(); // 供应商名 -> 密钥（重启后重下发）
    this._keysRevision = 0;
    this._proxy = null; // 最新代理快照（重启后重下发）
    this._proxyRevision = 0;
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
        child = spawn(hostPath, ["ip-query-serve"], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch (error) {
        logToFile(`nativeIpQueryClient spawn failed: ${error.message}`, "WARN");
        resolve(false);
        return;
      }

      this._process = child;
      this._lineBuffer = "";

      const readyTimer = setTimeout(() => {
        if (!this._ready) {
          logToFile("nativeIpQueryClient ready timeout", "WARN");
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
            this._onReady();
            resolve(true);
            continue;
          }
          this._handleMessage(message);
        }
      });

      child.stderr.on("data", () => {});

      child.on("error", (error) => {
        clearTimeout(readyTimer);
        if (!this._ready) {
          logToFile(
            `nativeIpQueryClient process error: ${error.message}`,
            "WARN",
          );
          resolve(false);
        }
        this._teardown(false);
      });

      child.on("exit", () => {
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
        // 进程异常退出：统一拒绝在途请求
        this._rejectAllPending("ip query sidecar exited");
      });
    });
  }

  /** ready 后恢复会话状态：重下发密钥与代理快照（不重放旧查询） */
  _onReady() {
    this._failures = 0;
    if (this._keys.size) {
      this._send({
        type: "updateKeys",
        keys: Object.fromEntries(this._keys),
        revision: ++this._keysRevision,
      });
    }
    if (this._proxy) {
      this._send({
        type: "updateProxy",
        proxy: this._proxy,
        revision: ++this._proxyRevision,
      });
    }
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
      this._rejectAllPending("ip query sidecar exited");
    }
  }

  _handleMessage(message) {
    const requestId = message.requestId;
    if (message.type === "event" && message.kind === "error") {
      // 协议/校验错误：拒绝所有在途请求（无 requestId 归属）
      this._rejectAllPending(message.error || "ip query sidecar error");
      return;
    }
    if (!requestId || !this._pending.has(requestId)) {
      return;
    }
    const entry = this._pending.get(requestId);
    // 查询结果以事件（kind=result，带 meta）返回；更新类以确认返回
    const isQueryResult = message.type === "event" && message.kind === "result";
    const isAck = message.type === "result";
    if (!isQueryResult && !isAck) {
      return;
    }
    this._pending.delete(requestId);
    if (entry.timer) {
      clearTimeout(entry.timer);
    }
    entry.resolve(message);
  }

  _rejectAllPending(reason) {
    for (const [, entry] of this._pending) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
      entry.reject(new Error(reason));
    }
    this._pending.clear();
  }

  _send(message) {
    if (!this._process || !this._ready) {
      return false;
    }
    try {
      this._process.stdin.write(`${JSON.stringify(message)}\n`);
      return true;
    } catch (error) {
      logToFile(`nativeIpQueryClient write failed: ${error.message}`, "WARN");
      return false;
    }
  }

  _nextRequestId() {
    this._requestIdCounter += 1;
    return `ipq-${Date.now()}-${this._requestIdCounter}`;
  }

  /**
   * 发起 IP 查询。
   * @param {string} ip 查询 IP（空串表示本机出口）
   * @param {object|null} proxyConfig { type, host, port, username, password }
   * @returns {Promise<{ type:"result", result:{ret,data|msg}, cached, provider? }>}
   */
  async query(ip, proxyConfig = null) {
    const available = await this.ensureReady();
    if (!available) {
      throw new Error("ip query sidecar unavailable");
    }
    // 代理快照与查询原子生效：请求内携带代理
    const requestId = this._nextRequestId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(requestId);
        reject(new Error("ip query sidecar request timeout"));
      }, REQUEST_TIMEOUT_MS);
      this._pending.set(requestId, { resolve, reject, timer });
      const message = { type: "query", requestId, ip: ip || "" };
      if (proxyConfig && proxyConfig.host && proxyConfig.port) {
        message.proxy = {
          type: proxyConfig.type || "http",
          host: proxyConfig.host,
          port: proxyConfig.port,
          username: proxyConfig.username || null,
          password: proxyConfig.password || null,
        };
        this._proxy = message.proxy;
        this._proxyRevision += 1;
      }
      if (!this._send(message)) {
        clearTimeout(timer);
        this._pending.delete(requestId);
        reject(new Error("ip query sidecar unavailable"));
      }
    });
  }

  /** 更新供应商密钥（经 stdin，不记录内容） */
  updateKeys(keys) {
    this._keys = new Map(Object.entries(keys || {}));
    return this._send({
      type: "updateKeys",
      keys: Object.fromEntries(this._keys),
      revision: ++this._keysRevision,
    });
  }

  cancelAll() {
    return this._send({ type: "cancel" });
  }

  isRunning() {
    return Boolean(this._process && this._ready);
  }

  destroy() {
    this._destroyed = true;
    this._rejectAllPending("ip query sidecar destroyed");
    this._teardown(true);
  }
}

const sharedClient = new NativeIpQueryClient({});

module.exports = {
  NativeIpQueryClient,
  nativeIpQueryClient: sharedClient,
  RESTART_BACKOFF_BASE_MS,
  RESTART_BACKOFF_MAX_MS,
};
