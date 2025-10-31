const Telnet = require("telnet-client");
const { logToFile } = require("../../core/utils/logger");

// 连接池配置常量
const MAX_CONNECTIONS = 50; // 最大连接数
const IDLE_TIMEOUT = 30 * 60 * 1000; // 空闲超时时间（30分钟）- 延长以支持标签页切换
const HEALTH_CHECK_INTERVAL = 5 * 60 * 1000; // 健康检查间隔（5分钟）
const CONNECTION_TIMEOUT = 15 * 1000; // 连接超时时间（15秒）

class TelnetConnectionPool {
  constructor(maxConnections = MAX_CONNECTIONS) {
    this.maxConnections = maxConnections;
    this.connections = new Map(); // 存储活跃连接
    this.connectionQueue = new Map(); // 连接请求队列
    this.tabReferences = new Map(); // 存储标签页对连接的引用关系
    this.healthCheckTimer = null;
    this.isInitialized = false;
    this.connectionUsage = new Map();
    this.lastConnections = []; // 存储最近连接的ID列表（按时间顺序）
  }

  initialize() {
    if (this.isInitialized) {
      return;
    }

    this.startHealthCheck();
    this.isInitialized = true;
    logToFile("Telnet连接池已初始化", "INFO");
  }

  cleanup() {
    this.stopHealthCheck();

    // 关闭所有连接
    for (const [key, connectionInfo] of this.connections) {
      this.closeConnection(key);
    }

    this.connections.clear();
    this.connectionQueue.clear();
    this.tabReferences.clear();
    this.isInitialized = false;
    logToFile("Telnet连接池已清理", "INFO");
  }

  generateConnectionKey(config) {
    // 优先使用 tabId 来确保每个标签页都有独立的连接
    if (config.tabId) {
      return `telnet:${config.host}:${config.port || 23}:${config.tabId}`;
    }
    // 回退到旧的逻辑，以支持可能没有tabId的场景
    return `telnet:${config.host}:${config.port || 23}`;
  }

  recordConnectionUsage(connectionId) {
    if (!connectionId) return;
    const currentCount = this.connectionUsage.get(connectionId) || 0;
    this.connectionUsage.set(connectionId, currentCount + 1);

    // 同时记录到最近连接列表
    this.recordLastConnection(connectionId);
  }

  recordLastConnection(connectionId) {
    if (!connectionId) {
      if (logToFile) {
        logToFile(
          "Telnet recordLastConnection: connectionId is null or undefined, skipping",
          "WARN",
        );
      }
      return;
    }

    // 移除旧的相同连接ID（如果存在）
    const index = this.lastConnections.indexOf(connectionId);
    if (index > -1) {
      this.lastConnections.splice(index, 1);
    }

    // 添加到列表开头（最新的）
    this.lastConnections.unshift(connectionId);

    // 限制列表长度（保留最近10个）
    if (this.lastConnections.length > 10) {
      this.lastConnections = this.lastConnections.slice(0, 10);
    }

    if (logToFile) {
      logToFile(
        `Telnet recordLastConnection: Added ${connectionId}, total count: ${this.lastConnections.length}`,
        "DEBUG",
      );
    }
  }

  getLastConnections(count = 5) {
    return this.lastConnections.slice(0, count);
  }

  // 设置最近连接列表（用于从配置文件加载）
  setLastConnections(connections) {
    if (Array.isArray(connections)) {
      this.lastConnections = connections.slice(0, 10); // 限制最多10个
    }
  }

  getTopConnections(count = 5) {
    if (this.connectionUsage.size === 0) return [];

    const sorted = [...this.connectionUsage.entries()].sort(
      (a, b) => b[1] - a[1],
    );
    return sorted.slice(0, count).map((entry) => entry[0]);
  }

  async getConnection(telnetConfig) {
    const connectionKey = this.generateConnectionKey(telnetConfig);

    // 调试日志：检查 telnetConfig.id 是否存在
    if (logToFile) {
      logToFile(
        `Telnet getConnection: connectionKey=${connectionKey}, telnetConfig.id=${telnetConfig.id || "undefined"}`,
        "DEBUG",
      );
    }

    this.recordConnectionUsage(telnetConfig.id);

    // 检查是否已有可用连接
    if (this.connections.has(connectionKey)) {
      const connectionInfo = this.connections.get(connectionKey);

      // 检查连接是否健康
      if (this.isConnectionHealthy(connectionInfo)) {
        connectionInfo.lastUsed = Date.now();
        connectionInfo.refCount++;
        logToFile(`复用现有Telnet连接: ${connectionKey}`, "INFO");
        return connectionInfo;
      } else {
        // 连接不健康，移除并重新创建
        this.closeConnection(connectionKey);
      }
    }

    // 检查连接数限制
    if (this.connections.size >= this.maxConnections) {
      // 尝试清理最旧的空闲连接
      const cleaned = this.cleanupIdleConnections(1);
      if (!cleaned) {
        throw new Error(`连接池已满，最大连接数: ${this.maxConnections}`);
      }
    }

    // 创建新连接
    return await this.createConnection(telnetConfig, connectionKey);
  }

  async createConnection(telnetConfig, connectionKey) {
    logToFile(`创建新Telnet连接: ${connectionKey}`, "INFO");

    return new Promise((resolve, reject) => {
      const telnet = new Telnet();
      const connectionInfo = {
        client: telnet,
        config: telnetConfig,
        key: connectionKey,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        refCount: 1,
        ready: false,
        stream: null,
        listeners: new Set(),
      };

      const params = {
        host: telnetConfig.host,
        port: telnetConfig.port || 23,
        negotiationMandatory: false,
        timeout: CONNECTION_TIMEOUT,
        username: telnetConfig.username,
        password: telnetConfig.password,
        passwordPrompt: /Password:|密码:/i,
        loginPrompt: /login:|用户名:/i,
        shellPrompt: /#|\$|>|\%/,
      };

      // 监听错误事件
      telnet.on("error", (err) => {
        logToFile(`Telnet连接错误: ${connectionKey} - ${err.message}`, "ERROR");
        this.connections.delete(connectionKey);

        // 创建增强的错误对象
        const enhancedError = new Error(`Telnet连接错误: ${err.message}`);
        enhancedError.originalError = err;
        enhancedError.connectionKey = connectionKey;
        enhancedError.telnetConfig = {
          host: telnetConfig.host,
          port: telnetConfig.port || 23,
          username: telnetConfig.username,
          hasPassword: !!telnetConfig.password,
        };

        reject(enhancedError);
      });

      // 连接Telnet服务器
      telnet
        .connect(params)
        .then(() => {
          connectionInfo.ready = true;
          this.connections.set(connectionKey, connectionInfo);
          logToFile(`Telnet连接建立成功: ${connectionKey}`, "INFO");
          resolve(connectionInfo);
        })
        .catch((err) => {
          logToFile(
            `Telnet连接失败: ${connectionKey} - ${err.message}`,
            "ERROR",
          );

          // 创建增强的错误对象
          const enhancedError = new Error(`Telnet连接失败: ${err.message}`);
          enhancedError.originalError = err;
          enhancedError.connectionKey = connectionKey;
          enhancedError.telnetConfig = {
            host: telnetConfig.host,
            port: telnetConfig.port || 23,
            username: telnetConfig.username,
            hasPassword: !!telnetConfig.password,
          };

          reject(enhancedError);
        });
    });
  }

  releaseConnection(connectionKey, tabId = null) {
    if (!this.connections.has(connectionKey)) {
      return;
    }

    const connectionInfo = this.connections.get(connectionKey);
    connectionInfo.refCount--;
    logToFile(
      `释放Telnet连接引用: ${connectionKey}, 剩余引用: ${connectionInfo.refCount}`,
      "INFO",
    );

    // 如果有tabId，从标签页引用中移除
    if (tabId && this.tabReferences.has(tabId)) {
      this.tabReferences.delete(tabId);
      logToFile(`移除标签页 ${tabId} 对连接 ${connectionKey} 的引用`, "INFO");
    }

    // 如果没有引用并且没有标签页引用，关闭连接
    if (
      connectionInfo.refCount <= 0 &&
      !this.isConnectionReferencedByTabs(connectionKey)
    ) {
      this.closeConnection(connectionKey);
    }
  }

  addTabReference(tabId, connectionKey) {
    if (!tabId || !connectionKey) return;
    this.tabReferences.set(tabId, connectionKey);
    logToFile(`添加标签页 ${tabId} 对连接 ${connectionKey} 的引用`, "INFO");
  }

  isConnectionReferencedByTabs(connectionKey) {
    for (const [_, connKey] of this.tabReferences) {
      if (connKey === connectionKey) {
        return true;
      }
    }
    return false;
  }

  closeConnection(connectionKey) {
    if (!this.connections.has(connectionKey)) {
      return;
    }

    const connectionInfo = this.connections.get(connectionKey);
    try {
      if (connectionInfo.client) {
        connectionInfo.client.end();
        logToFile(`关闭Telnet连接: ${connectionKey}`, "INFO");
      }
    } catch (error) {
      logToFile(
        `关闭Telnet连接时出错: ${connectionKey} - ${error.message}`,
        "ERROR",
      );
    }

    this.connections.delete(connectionKey);
  }

  isConnectionHealthy(connectionInfo) {
    if (!connectionInfo || !connectionInfo.client || !connectionInfo.ready) {
      return false;
    }
    return true;
  }

  cleanupIdleConnections(count = 1) {
    if (this.connections.size === 0) {
      return false;
    }

    // 按最后使用时间排序
    const sortedConnections = [...this.connections.entries()].sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    );

    let cleanedCount = 0;
    for (const [key, info] of sortedConnections) {
      // 只清理没有引用的连接
      if (info.refCount <= 0 && !this.isConnectionReferencedByTabs(key)) {
        this.closeConnection(key);
        cleanedCount++;
        if (cleanedCount >= count) {
          break;
        }
      }
    }

    return cleanedCount > 0;
  }

  startHealthCheck() {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, HEALTH_CHECK_INTERVAL);
  }

  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  performHealthCheck() {
    if (this.connections.size === 0) {
      return;
    }

    logToFile(
      `执行Telnet连接健康检查，当前连接数: ${this.connections.size}`,
      "INFO",
    );

    // 检查每个连接的健康状态
    for (const [key, info] of this.connections) {
      if (!this.isConnectionHealthy(info)) {
        logToFile(`检测到不健康的Telnet连接: ${key}，准备关闭`, "INFO");
        this.closeConnection(key);
      } else if (
        Date.now() - info.lastUsed > IDLE_TIMEOUT &&
        info.refCount <= 0 &&
        !this.isConnectionReferencedByTabs(key)
      ) {
        logToFile(
          `关闭空闲Telnet连接: ${key}, 空闲时间: ${(Date.now() - info.lastUsed) / 1000}秒`,
          "INFO",
        );
        this.closeConnection(key);
      }
    }
  }

  getStatus() {
    return {
      active: this.connections.size,
      max: this.maxConnections,
      tabReferences: this.tabReferences.size,
    };
  }

  getDetailedStats() {
    const connections = [];
    for (const [key, info] of this.connections) {
      connections.push({
        key,
        host: info.config.host,
        port: info.config.port || 23,
        username: info.config.username,
        createdAt: info.createdAt,
        lastUsed: info.lastUsed,
        refCount: info.refCount,
        ready: info.ready,
        idleTime: Date.now() - info.lastUsed,
      });
    }

    const tabRefs = [];
    for (const [tabId, connKey] of this.tabReferences) {
      tabRefs.push({
        tabId,
        connectionKey: connKey,
      });
    }

    return {
      active: this.connections.size,
      max: this.maxConnections,
      connections,
      tabReferences: tabRefs,
    };
  }
}

// 创建单例实例
const telnetConnectionPool = new TelnetConnectionPool();

module.exports = telnetConnectionPool;
