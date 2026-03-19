const {
  sshConnectionPool,
  telnetConnectionPool,
} = require("../../core/connection");
const { logToFile } = require("../../core/utils/logger");

class ConnectionManager {
  constructor() {
    this.sshConnectionPool = sshConnectionPool;
    this.telnetConnectionPool = telnetConnectionPool;
  }

  initialize() {
    logToFile("Connection manager initialized", "INFO");
    this.sshConnectionPool.initialize();
    this.telnetConnectionPool.initialize();
    // sftpCore is initialized separately in main.js with proper dependencies
  }

  cleanup() {
    logToFile("Connection manager cleanup", "INFO");
    this.sshConnectionPool.cleanup();
    this.telnetConnectionPool.cleanup();
  }

  async getSftpSession(tabId) {
    void tabId;
    return { success: true, native: true };
  }

  async closeSftpSession(tabId) {
    void tabId;
  }

  enqueueSftpOperation(tabId, operation, options = {}) {
    void tabId;
    void options;
    if (typeof operation === "function") {
      return Promise.resolve().then(operation);
    }
    return Promise.resolve({ success: true, queued: false, native: true });
  }

  getTopConnections(count) {
    // 合并SSH和Telnet的热门连接
    const sshTopConnections = this.sshConnectionPool.getTopConnections(count);
    const telnetTopConnections =
      this.telnetConnectionPool.getTopConnections(count);

    // 合并并按使用次数排序
    const allConnections = [...sshTopConnections, ...telnetTopConnections];
    return allConnections.slice(0, count);
  }

  getLastConnections(count) {
    // 合并SSH和Telnet的最近连接（获取连接对象,而不是连接ID）
    const sshLastConnections =
      this.sshConnectionPool.getLastConnectionsWithDetails(count);
    const telnetLastConnections =
      this.telnetConnectionPool.getLastConnectionsWithDetails(count);

    // 合并两个列表,保持时间顺序（简单合并,实际使用中可能需要更复杂的合并逻辑）
    const allConnections = [...sshLastConnections, ...telnetLastConnections];
    return allConnections.slice(0, count);
  }

  // 从配置文件加载并初始化最近连接列表
  loadLastConnectionsFromConfig(connections) {
    if (Array.isArray(connections) && connections.length > 0) {
      // 根据协议类型分别加载到对应的连接池
      const sshConnections = [];
      const telnetConnections = [];

      for (const conn of connections) {
        if (conn.protocol === "telnet") {
          telnetConnections.push(conn);
        } else {
          // 默认视为SSH连接
          sshConnections.push(conn);
        }
      }

      if (sshConnections.length > 0) {
        this.sshConnectionPool.loadLastConnectionsFromConfig(sshConnections);
      }
      if (telnetConnections.length > 0) {
        this.telnetConnectionPool.loadLastConnectionsFromConfig(
          telnetConnections,
        );
      }

      logToFile(
        `Loaded ${sshConnections.length} SSH and ${telnetConnections.length} Telnet last connections`,
        "INFO",
      );
    }
  }

  // SSH连接池相关方法
  async getSSHConnection(sshConfig) {
    return this.sshConnectionPool.getConnection(sshConfig);
  }

  releaseSSHConnection(connectionKey, tabId = null, options = {}) {
    this.sshConnectionPool.releaseConnection(connectionKey, tabId, options);
  }

  // Telnet连接池相关方法
  async getTelnetConnection(telnetConfig) {
    return this.telnetConnectionPool.getConnection(telnetConfig);
  }

  releaseTelnetConnection(connectionKey, tabId = null, options = {}) {
    this.telnetConnectionPool.releaseConnection(connectionKey, tabId, options);
  }

  // 添加标签页引用追踪
  addTabReference(tabId, connectionKey) {
    // 根据连接键前缀判断是SSH还是Telnet
    if (connectionKey.startsWith("telnet:")) {
      if (this.telnetConnectionPool.addTabReference) {
        this.telnetConnectionPool.addTabReference(tabId, connectionKey);
      }
    } else {
      if (this.sshConnectionPool.addTabReference) {
        this.sshConnectionPool.addTabReference(tabId, connectionKey);
      }
    }
  }

  getConnectionPoolStatus() {
    return {
      ssh: this.sshConnectionPool.getStatus(),
      telnet: this.telnetConnectionPool.getStatus(),
    };
  }

  getConnectionPoolStats() {
    return {
      ssh: this.sshConnectionPool.getDetailedStats(),
      telnet: this.telnetConnectionPool.getDetailedStats(),
    };
  }

  // 优雅关闭指定连接
  async closeConnection(connectionKey) {
    try {
      // 根据连接键前缀判断是SSH还是Telnet
      if (connectionKey.startsWith("telnet:")) {
        this.telnetConnectionPool.closeConnection(connectionKey, {
          reason: "user",
          intentional: true,
        });
        logToFile(`手动关闭Telnet连接: ${connectionKey}`, "INFO");
      } else {
        this.sshConnectionPool.closeConnection(connectionKey, {
          reason: "user",
          intentional: true,
        });
        logToFile(`手动关闭SSH连接: ${connectionKey}`, "INFO");
      }
    } catch (error) {
      logToFile(`关闭连接失败: ${connectionKey} - ${error.message}`, "ERROR");
      throw error;
    }
  }

  // 清理空闲连接
  cleanupIdleConnections(count = 1) {
    const sshCleaned = this.sshConnectionPool.cleanupIdleConnections(
      Math.ceil(count / 2),
    );
    const telnetCleaned = this.telnetConnectionPool.cleanupIdleConnections(
      Math.ceil(count / 2),
    );
    return sshCleaned || telnetCleaned;
  }

  // 强制健康检查
  performHealthCheck() {
    this.sshConnectionPool.performHealthCheck();
    this.telnetConnectionPool.performHealthCheck();
  }
}

// 创建单例实例
const connectionManager = new ConnectionManager();

module.exports = connectionManager;
