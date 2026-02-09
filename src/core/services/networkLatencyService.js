const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");
const net = require("node:net");
const proxyManager = require("../proxy/proxy-manager");

function nowMs() {
  return Date.now();
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

    // 检测定时器
    this.timers = new Map();

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

    // 清除所有定时器
    this.timers.forEach((timer) => {
      clearInterval(timer);
    });
    this.timers.clear();

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
  registerSSHConnection(tabId, sshConnection, host, port = 22, proxyConfig = null) {
    if (!this.isRunning) {
      logToFile(`服务未启动，无法注册连接: ${tabId}`, "WARN");
      return;
    }

    if (this.timers.has(tabId)) {
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
    });

    // 立即执行一次检测
    this.checkLatency(tabId, sshConnection).then(() => {
      // 然后启动定时检测
      const timer = setInterval(() => {
        this.checkLatency(tabId, sshConnection);
      }, this.checkInterval);

      this.timers.set(tabId, timer);
    });

    logToFile(`已注册SSH连接延迟检测: ${tabId} -> ${host}:${port}`, "INFO");
  }

  /**
   * 注销连接的延迟检测
   * @param {string} tabId 标签页ID
   */
  unregisterConnection(tabId) {
    const timer = this.timers.get(tabId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(tabId);
    }

    this.latencyData.delete(tabId);

    logToFile(`已注销SSH连接延迟检测: ${tabId}`, "INFO");
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
      return;
    }

    try {
      // 关键：延迟测试应走“连接项对应的代理配置”
      // - 若连接项配置了代理：通过代理 CONNECT 建 TCP 隧道测量建连耗时（更贴近真实路径）
      // - 否则：直连 TCP connect 测量建连耗时
      // - 若上述失败：回退到 SSH exec echo 测量往返耗时
      const latency = await this.measureLatency(sshConnection, {
        host: data.host,
        port: data.port,
        proxyConfig: data.proxyConfig,
      });

      // 更新延迟数据
      data.latency = latency;
      data.lastCheck = nowMs();
      data.checkCount++;
      data.status = "connected";

      // 添加到历史记录 (最多保留10条)
      data.history.push({
        latency,
        timestamp: nowMs(),
      });

      if (data.history.length > 10) {
        data.history.shift();
      }

      // 发送延迟更新事件
      this.emit("latency:updated", {
        tabId,
        latency,
        host: data.host,
        port: data.port,
        // 统一字段：lastCheck 用于 UI 展示；timestamp 保留向后兼容
        lastCheck: data.lastCheck,
        timestamp: data.lastCheck,
        status: data.status,
      });

      logToFile(`SSH连接${tabId}延迟检测: ${latency}ms`, "DEBUG");
    } catch (error) {
      data.errors++;
      data.status = "error";
      data.lastCheck = nowMs();

      logToFile(`SSH连接${tabId}延迟检测失败: ${error.message}`, "WARN");

      this.emit("latency:error", {
        tabId,
        error: error.message,
        host: data.host,
        port: data.port,
        lastCheck: data.lastCheck,
        timestamp: data.lastCheck,
      });
    }
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
          return await this._measureTcpLatencyViaProxy(resolvedProxy, host, port);
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
      const startTime = nowMs();
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
        } catch {}
      };

      const onError = (e) => {
        cleanup();
        reject(e);
      };

      // 更贴近真实：等待 SSH 服务端 banner（"SSH-"）返回的耗时，而非仅 TCP connect 耗时
      socket.setTimeout(timeoutMs, () => onError(new Error("延迟检测超时 (5秒)")));
      socket.once("error", onError);

      // 一旦收到任何数据（SSH banner），就认为链路可达并计算耗时
      socket.once("data", () => {
        const latency = nowMs() - startTime;
        cleanup();
        resolve(latency);
      });

      // 某些极端情况下可能收不到 banner，但 connect 已完成；
      // 为避免永远等待，这里用一个更短的兜底窗口返回 connect 耗时。
      socket.once("connect", () => {
        fallbackTimer = setTimeout(() => {
          const latency = nowMs() - startTime;
          cleanup();
          resolve(latency);
        }, Math.min(300, timeoutMs));
      });
    });
  }

  async _measureTcpLatencyViaProxy(resolvedProxyConfig, host, port, timeoutMs = 5000) {
    const startTime = nowMs();
    const sock = await proxyManager.createTunnelSocket(resolvedProxyConfig, host, port, {
      timeoutMs,
    });

    // 关键修复：仅测“隧道建立/CONNECT 成功”在本地代理场景可能几乎恒定很小（比如 1ms）。
    // 为更贴近实际体验，这里等待目标 SSH 服务端 banner 返回，用首包耗时作为延迟指标。
    const latency = await new Promise((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        sock.removeAllListeners();
        try {
          sock.destroy();
        } catch {}
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
        const ms = nowMs() - startTime;
        cleanup();
        resolve(ms);
      };

      sock.setTimeout(timeoutMs, () => onError(new Error("延迟检测超时 (5秒)")));
      sock.once("error", onError);
      sock.once("close", () => onError(new Error("Proxy tunnel socket closed")));
      sock.once("data", onData);
    });

    return latency;
  }

  _measureLatencyViaSshExec(sshConnection) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let timeoutId = null;
      let resolved = false;

      const cleanup = (error = null) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        if (error && !resolved) {
          resolved = true;
          reject(error);
        }
      };

      timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error("延迟检测超时 (5秒)"));
        }
      }, 5000);

      try {
        // 执行简单的echo命令
        sshConnection.exec("echo latency_test", (err, stream) => {
          if (err) {
            if (!resolved) {
              resolved = true;
              cleanup();
              reject(err);
            }
            return;
          }

          let dataReceived = false;

          // 处理数据接收
          stream.on("data", () => {
            if (!dataReceived && !resolved) {
              dataReceived = true;
              resolved = true;
              const latency = Date.now() - startTime;

              // 显式关闭流以释放通道
              try {
                if (typeof stream.close === 'function') {
                  stream.close();
                } else if (typeof stream.destroy === 'function') {
                  stream.destroy();
                }
              } catch {
                // 忽略关闭错误
              }

              cleanup();
              resolve(latency);
            }
          });

          // 处理流错误
          stream.on("error", (streamErr) => {
            if (!resolved) {
              resolved = true;
              try {
                if (typeof stream.close === 'function') {
                  stream.close();
                }
              } catch {
                // 忽略关闭错误
              }
              cleanup(streamErr);
            }
          });

          // 处理流关闭
          stream.on("close", () => {
            if (!dataReceived && !resolved) {
              resolved = true;
              cleanup(new Error("未收到响应数据"));
            }
          });

          // 处理流退出
          stream.on("exit", () => {
            if (!resolved) {
              // 尝试优雅关闭
              try {
                if (typeof stream.close === 'function') {
                  stream.close();
                }
              } catch {
                // 忽略关闭错误
              }
            }
          });
        });
      } catch (error) {
        if (!resolved) {
          resolved = true;
          cleanup(error);
        }
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
      connections: this.getAllLatencyInfo(),
    };
  }
}

module.exports = NetworkLatencyService;
