const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");

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
    this.timers.forEach((timer, tabId) => {
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
   */
  registerSSHConnection(tabId, sshConnection, host, port = 22) {
    if (!this.isRunning) {
      logToFile(`服务未启动，无法注册连接: ${tabId}`, "WARN");
      return;
    }

    if (this.timers.has(tabId)) {
      logToFile(`连接${tabId}已存在，先注销旧连接`, "DEBUG");
      this.unregisterConnection(tabId);
    }

    // 初始化延迟数据
    this.latencyData.set(tabId, {
      host,
      port,
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

    const startTime = Date.now();

    try {
      // 使用SSH连接执行简单的echo命令来测量延迟
      const latency = await this.measureLatency(sshConnection);

      // 更新延迟数据
      data.latency = latency;
      data.lastCheck = Date.now();
      data.checkCount++;
      data.status = "connected";

      // 添加到历史记录 (最多保留10条)
      data.history.push({
        latency,
        timestamp: Date.now(),
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
        timestamp: data.lastCheck,
        status: data.status,
      });

      logToFile(`SSH连接${tabId}延迟检测: ${latency}ms`, "DEBUG");
    } catch (error) {
      data.errors++;
      data.status = "error";
      data.lastCheck = Date.now();

      logToFile(`SSH连接${tabId}延迟检测失败: ${error.message}`, "WARN");

      this.emit("latency:error", {
        tabId,
        error: error.message,
        host: data.host,
        port: data.port,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 测量SSH连接延迟
   * @param {object} sshConnection SSH连接实例
   * @returns {Promise<number>} 延迟时间(毫秒)
   */
  measureLatency(sshConnection) {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      const timeout = setTimeout(() => {
        reject(new Error("延迟检测超时 (5秒)"));
      }, 5000);

      try {
        // 执行简单的echo命令
        sshConnection.exec("echo latency_test", (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            reject(err);
            return;
          }

          let dataReceived = false;

          stream.on("data", () => {
            if (!dataReceived) {
              dataReceived = true;
              clearTimeout(timeout);
              const latency = Date.now() - startTime;
              resolve(latency);
            }
          });

          stream.on("error", (streamErr) => {
            clearTimeout(timeout);
            reject(streamErr);
          });

          stream.on("close", () => {
            if (!dataReceived) {
              clearTimeout(timeout);
              reject(new Error("未收到响应数据"));
            }
          });
        });
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
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
