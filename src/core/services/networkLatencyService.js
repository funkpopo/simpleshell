const { EventEmitter } = require("events");
const { performance } = require("node:perf_hooks");
const { logToFile } = require("../utils/logger");
const net = require("node:net");
const proxyManager = require("../proxy/proxy-manager");

function nowMs() {
  return Date.now();
}

function monotonicNow() {
  return performance.now();
}

function elapsedMs(startTime) {
  return Math.max(0, Math.round(performance.now() - startTime));
}

/**
 * 网络延迟检测服务
 * 负责检测SSH连接的网络延迟，每分钟更新一次
 */
class NetworkLatencyService extends EventEmitter {
  constructor() {
    super();

    // 存储各个连接的延迟数据
    this.latencyData = new Map();

    // 检测间隔 (60秒 = 1分钟)
    this.checkInterval = 60 * 1000;

    // 调度器每秒检查一次是否有到期任务，避免为每个连接各自维护定时器
    this.schedulerIntervalMs = 1000;
    this.schedulerTimer = null;
    this.schedulerBusy = false;

    // 限制并发探测数，避免大量连接时同时建连造成瞬时压力
    this.maxConcurrentChecks = 4;
    this.activeCheckCount = 0;
    this.serviceGeneration = 0;

    // 是否正在运行
    this.isRunning = false;

    // 确保代理管理器就绪：延迟测试需要按连接项代理配置建隧道
    try {
      proxyManager.initialize();
    } catch {
      // ignore
    }

    logToFile("网络延迟检测服务已初始化", "INFO");
  }

  /**
   * 启动服务
   */
  start() {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.serviceGeneration += 1;
    this.schedulerTimer = setInterval(() => {
      void this._runDueChecks();
    }, this.schedulerIntervalMs);
    if (typeof this.schedulerTimer.unref === "function") {
      this.schedulerTimer.unref();
    }

    logToFile("网络延迟检测服务已启动", "INFO");
    this.emit("service:started");
  }

  /**
   * 停止服务
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.schedulerBusy = false;
    this.activeCheckCount = 0;
    this.serviceGeneration += 1;

    // 清除延迟数据
    this.latencyData.clear();

    this.isRunning = false;
    logToFile("网络延迟检测服务已停止", "INFO");
    this.emit("service:stopped");
  }

  /**
   * 注册SSH连接的延迟检测
   * @param {string} tabId 标签页ID
   * @param {object} sshConnection SSH连接实例
   * @param {string} host 主机地址
   * @param {number} port 端口号
   * @param {object|null} proxyConfig 代理配置（连接项的 proxy 字段，支持 useDefault）
   */
  registerSSHConnection(
    tabId,
    sshConnection,
    host,
    port = 22,
    proxyConfig = null,
  ) {
    if (!this.isRunning) {
      logToFile(`服务未启动，无法注册连接: ${tabId}`, "WARN");
      return;
    }

    if (this.latencyData.has(tabId)) {
      logToFile(`连接${tabId}已存在，先注销旧连接`, "DEBUG");
      this.unregisterConnection(tabId);
    }

    // 初始化延迟数据，存储SSH连接实例
    this.latencyData.set(tabId, {
      host,
      port,
      sshConnection, // 保存SSH连接实例以便后续使用
      proxyConfig: proxyConfig || null,
      latency: null,
      lastCheck: null,
      checkCount: 0,
      errors: 0,
      status: "checking",
      history: [], // 保存最近10次的延迟记录
      lastError: null,
      checkPromise: null,
      nextCheckAt: nowMs(),
    });

    void this._runDueChecks();

    logToFile(`已注册SSH连接延迟检测: ${tabId} -> ${host}:${port}`, "INFO");
  }

  /**
   * 注销连接的延迟检测
   * @param {string} tabId 标签页ID
   */
  unregisterConnection(tabId) {
    const hadConnection = this.latencyData.delete(tabId);

    if (hadConnection) {
      logToFile(`已注销SSH连接延迟检测: ${tabId}`, "INFO");
    }
    this.emit("latency:disconnected", { tabId });
  }

  /**
   * 检测SSH连接的延迟
   * @param {string} tabId 标签页ID
   * @param {object} sshConnection SSH连接实例
   */
  async checkLatency(tabId, sshConnection) {
    const data = this.latencyData.get(tabId);
    if (!data) {
      return null;
    }

    if (sshConnection) {
      data.sshConnection = sshConnection;
    }

    return this._startLatencyCheck(tabId, data, { force: true });
  }

  /**
   * 立即测试指定连接的延迟（不等待定时器）
   * @param {string} tabId 标签页ID
   * @returns {Promise<void>}
   */
  async testLatencyNow(tabId) {
    if (!this.isRunning) {
      throw new Error("服务未启动");
    }

    const data = this.latencyData.get(tabId);
    if (!data) {
      throw new Error(`连接${tabId}未注册`);
    }

    if (!data.sshConnection) {
      throw new Error(`连接${tabId}的SSH实例不存在`);
    }

    // 立即执行延迟检测，使用存储的SSH连接实例
    await this.checkLatency(tabId, data.sshConnection);
    logToFile(`已触发连接${tabId}的立即延迟测试`, "INFO");
  }

  async _runDueChecks() {
    if (!this.isRunning || this.schedulerBusy) {
      return;
    }

    this.schedulerBusy = true;

    try {
      const now = nowMs();
      const dueEntries = [];

      for (const [tabId, data] of this.latencyData.entries()) {
        if (data.checkPromise) {
          continue;
        }
        if (typeof data.nextCheckAt !== "number" || data.nextCheckAt > now) {
          continue;
        }
        dueEntries.push({ tabId, data });
      }

      dueEntries.sort((a, b) => a.data.nextCheckAt - b.data.nextCheckAt);

      for (const entry of dueEntries) {
        if (this.activeCheckCount >= this.maxConcurrentChecks) {
          break;
        }
        this._startLatencyCheck(entry.tabId, entry.data);
      }
    } finally {
      this.schedulerBusy = false;
    }
  }

  _startLatencyCheck(tabId, data, { force = false } = {}) {
    if (!this.isRunning) {
      return Promise.resolve(null);
    }

    const currentData = this.latencyData.get(tabId);
    if (!currentData || currentData !== data) {
      return Promise.resolve(null);
    }

    if (currentData.checkPromise) {
      return currentData.checkPromise;
    }

    if (
      !force &&
      typeof currentData.nextCheckAt === "number" &&
      currentData.nextCheckAt > nowMs()
    ) {
      return Promise.resolve(null);
    }

    this.activeCheckCount += 1;
    const checkGeneration = this.serviceGeneration;
    currentData.nextCheckAt = null;

    const checkPromise = (async () => {
      try {
        // 关键：延迟测试应走“连接项对应的代理配置”
        // - 若连接项配置了代理：通过代理 CONNECT 建 TCP 隧道测量建连耗时（更贴近真实路径）
        // - 否则：直连 TCP connect 测量建连耗时
        // - 若上述失败：回退到 SSH exec echo 测量往返耗时
        const measuredLatency = await this.measureLatency(
          currentData.sshConnection,
          {
            host: currentData.host,
            port: currentData.port,
            proxyConfig: currentData.proxyConfig,
          },
        );
        const latency = Number.isFinite(measuredLatency)
          ? Math.max(0, Math.round(measuredLatency))
          : null;

        if (latency === null) {
          throw new Error("延迟检测结果无效");
        }

        if (
          !this.isRunning ||
          this.serviceGeneration !== checkGeneration ||
          this.latencyData.get(tabId) !== currentData
        ) {
          return null;
        }

        currentData.latency = latency;
        currentData.lastCheck = nowMs();
        currentData.checkCount++;
        currentData.status = "connected";
        currentData.lastError = null;

        currentData.history.push({
          latency,
          timestamp: currentData.lastCheck,
        });

        if (currentData.history.length > 10) {
          currentData.history.shift();
        }

        this.emit("latency:updated", {
          tabId,
          latency,
          host: currentData.host,
          port: currentData.port,
          lastCheck: currentData.lastCheck,
          timestamp: currentData.lastCheck,
          status: currentData.status,
        });

        logToFile(`SSH连接${tabId}延迟检测: ${latency}ms`, "DEBUG");
        return latency;
      } catch (error) {
        if (
          !this.isRunning ||
          this.serviceGeneration !== checkGeneration ||
          this.latencyData.get(tabId) !== currentData
        ) {
          return null;
        }

        currentData.latency = null;
        currentData.errors++;
        currentData.status = "error";
        currentData.lastCheck = nowMs();
        const errorMessage = error?.message || String(error);
        currentData.lastError = errorMessage;

        logToFile(`SSH连接${tabId}延迟检测失败: ${errorMessage}`, "WARN");

        this.emit("latency:error", {
          tabId,
          error: errorMessage,
          host: currentData.host,
          port: currentData.port,
          lastCheck: currentData.lastCheck,
          timestamp: currentData.lastCheck,
        });

        return null;
      } finally {
        if (this.serviceGeneration !== checkGeneration) {
          return;
        }

        if (this.latencyData.get(tabId) === currentData) {
          currentData.checkPromise = null;
          currentData.nextCheckAt = nowMs() + this.checkInterval;
        }

        this.activeCheckCount = Math.max(0, this.activeCheckCount - 1);
        if (this.isRunning) {
          void this._runDueChecks();
        }
      }
    })();

    currentData.checkPromise = checkPromise;
    return checkPromise;
  }

  /**
   * 测量SSH连接延迟
   * @param {object} sshConnection SSH连接实例
   * @returns {Promise<number>} 延迟时间(毫秒)
   */
  async measureLatency(sshConnection, { host, port, proxyConfig } = {}) {
    // 优先使用 TCP connect 测量（可通过代理建隧道）
    if (host && port) {
      try {
        const resolvedProxy = await proxyManager.resolveProxyConfigAsync({
          host,
          port,
          proxy: proxyConfig || null,
        });

        if (resolvedProxy && proxyManager.isValidProxyConfig(resolvedProxy)) {
          return await this._measureTcpLatencyViaProxy(
            resolvedProxy,
            host,
            port,
          );
        }

        return await this._measureTcpLatencyDirect(host, port);
      } catch {
        // 回退到 SSH exec（例如代理握手失败、DNS/路由异常等）
      }
    }

    // 回退：使用SSH连接执行简单的echo命令来测量延迟（兼容旧逻辑）
    return await this._measureLatencyViaSshExec(sshConnection);
  }

  _measureTcpLatencyDirect(host, port, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const startTime = monotonicNow();
      const socket = net.connect({ host, port });
      let fallbackTimer = null;

      const cleanup = () => {
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        socket.removeAllListeners();
        try {
          socket.destroy();
        } catch {
          /* intentionally ignored */
        }
      };

      const onError = (e) => {
        cleanup();
        reject(e);
      };

      // 更贴近真实：等待 SSH 服务端 banner（"SSH-"）返回的耗时，而非仅 TCP connect 耗时
      socket.setTimeout(timeoutMs, () =>
        onError(new Error("延迟检测超时 (5秒)")),
      );
      socket.once("error", onError);
      socket.once("close", () =>
        onError(
          new Error("Socket closed before latency measurement completed"),
        ),
      );

      // 一旦收到任何数据（SSH banner），就认为链路可达并计算耗时
      socket.once("data", () => {
        const latency = elapsedMs(startTime);
        cleanup();
        resolve(latency);
      });

      // 某些极端情况下可能收不到 banner，但 connect 已完成；
      // 为避免永远等待，这里用一个更短的兜底窗口返回 connect 耗时。
      socket.once("connect", () => {
        fallbackTimer = setTimeout(
          () => {
            const latency = elapsedMs(startTime);
            cleanup();
            resolve(latency);
          },
          Math.min(300, timeoutMs),
        );
      });
    });
  }

  async _measureTcpLatencyViaProxy(
    resolvedProxyConfig,
    host,
    port,
    timeoutMs = 5000,
  ) {
    const startTime = monotonicNow();
    const sock = await proxyManager.createTunnelSocket(
      resolvedProxyConfig,
      host,
      port,
      {
        timeoutMs,
      },
    );

    // 关键修复：仅测“隧道建立/CONNECT 成功”在本地代理场景可能几乎恒定很小（比如 1ms）。
    // 为更贴近实际体验，这里等待目标 SSH 服务端 banner 返回，用首包耗时作为延迟指标。
    const latency = await new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        sock.removeAllListeners();
        try {
          sock.destroy();
        } catch {
          /* intentionally ignored */
        }
      };

      const onError = (e) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(e);
      };

      const onData = () => {
        if (settled) return;
        settled = true;
        const ms = elapsedMs(startTime);
        cleanup();
        resolve(ms);
      };

      sock.setTimeout(timeoutMs, () =>
        onError(new Error("延迟检测超时 (5秒)")),
      );
      sock.once("error", onError);
      sock.once("close", () =>
        onError(new Error("Proxy tunnel socket closed")),
      );
      sock.once("data", onData);
    });

    return latency;
  }

  _measureLatencyViaSshExec(sshConnection) {
    return new Promise((resolve, reject) => {
      if (!sshConnection || typeof sshConnection.exec !== "function") {
        reject(new Error("SSH实例不可用"));
        return;
      }

      const startTime = monotonicNow();
      let timeoutId = null;
      let settled = false;
      let streamRef = null;

      const closeStream = () => {
        if (!streamRef) {
          return;
        }

        try {
          if (typeof streamRef.close === "function") {
            streamRef.close();
          } else if (typeof streamRef.destroy === "function") {
            streamRef.destroy();
          }
        } catch {
          // 忽略关闭错误
        }
      };

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        if (streamRef) {
          streamRef.removeListener("data", onData);
          streamRef.removeListener("error", onStreamError);
          streamRef.removeListener("close", onStreamClose);
          streamRef.removeListener("exit", onStreamExit);
        }
      };

      const finish = (error = null, latency = null) => {
        if (settled) {
          return;
        }

        settled = true;
        cleanup();
        closeStream();

        if (error) {
          reject(error);
          return;
        }

        resolve(latency);
      };

      function onData() {
        finish(null, elapsedMs(startTime));
      }

      function onStreamError(streamErr) {
        finish(streamErr);
      }

      function onStreamClose() {
        finish(new Error("未收到响应数据"));
      }

      function onStreamExit() {
        closeStream();
      }

      timeoutId = setTimeout(() => {
        finish(new Error("延迟检测超时 (5秒)"));
      }, 5000);

      try {
        // 执行简单的echo命令
        sshConnection.exec("echo latency_test", (err, stream) => {
          if (err) {
            finish(err);
            return;
          }

          streamRef = stream;

          if (settled) {
            closeStream();
            return;
          }

          stream.once("data", onData);
          stream.once("error", onStreamError);
          stream.once("close", onStreamClose);
          stream.once("exit", onStreamExit);
        });
      } catch (error) {
        finish(error);
      }
    });
  }

  /**
   * 获取指定连接的延迟信息
   * @param {string} tabId 标签页ID
   * @returns {object|null} 延迟信息
   */
  getLatencyInfo(tabId) {
    const data = this.latencyData.get(tabId);
    if (!data) {
      return null;
    }

    return {
      tabId,
      host: data.host,
      port: data.port,
      latency: data.latency,
      lastCheck: data.lastCheck,
      checkCount: data.checkCount,
      errors: data.errors,
      status: data.status,
      lastError: data.lastError,
      isChecking: Boolean(data.checkPromise),
      history: [...data.history], // 返回历史记录副本
    };
  }

  /**
   * 获取所有连接的延迟信息
   * @returns {Array} 所有连接的延迟信息
   */
  getAllLatencyInfo() {
    const result = [];
    for (const tabId of this.latencyData.keys()) {
      const info = this.getLatencyInfo(tabId);
      if (info) {
        result.push(info);
      }
    }
    return result;
  }

  /**
   * 获取连接的平均延迟
   * @param {string} tabId 标签页ID
   * @returns {number|null} 平均延迟(毫秒)
   */
  getAverageLatency(tabId) {
    const data = this.latencyData.get(tabId);
    if (!data || data.history.length === 0) {
      return null;
    }

    const sum = data.history.reduce(
      (total, record) => total + record.latency,
      0,
    );
    return Math.round(sum / data.history.length);
  }

  /**
   * 获取服务状态
   * @returns {object} 服务状态信息
   */
  getServiceStatus() {
    return {
      isRunning: this.isRunning,
      monitoredConnections: this.latencyData.size,
      checkInterval: this.checkInterval,
      schedulerIntervalMs: this.schedulerIntervalMs,
      activeChecks: this.activeCheckCount,
      connections: this.getAllLatencyInfo(),
    };
  }
}

module.exports = NetworkLatencyService;
