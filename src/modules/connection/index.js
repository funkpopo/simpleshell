const sftpManager = require("./sftp-manager");
const sshConnectionPool = require("./ssh-connection-pool");
const telnetConnectionPool = require("./telnet-connection-pool");
const { logToFile } = require("../../core/utils/logger");

class ConnectionManager {
  constructor() {
    this.sftpManager = sftpManager;
    this.sshConnectionPool = sshConnectionPool;
    this.telnetConnectionPool = telnetConnectionPool;
  }

  initialize() {
    logToFile("Connection manager initialized", "INFO");
    this.sshConnectionPool.initialize();
    this.telnetConnectionPool.initialize();
    this.sftpManager.initialize();
  }

  cleanup() {
    logToFile("Connection manager cleanup", "INFO");
    this.sshConnectionPool.cleanup();
    this.telnetConnectionPool.cleanup();
    this.sftpManager.cleanup();
  }

  async getSftpSession(tabId) {
    try {
      // 确保SSH连接已正确关联到此标签页
      const processInfo =
        this.sshConnectionPool.getConnectionByTabId &&
        this.sshConnectionPool.getConnectionByTabId(tabId);

      if (!processInfo) {
        logToFile(
          `Connection manager: No SSH connection found for tab ${tabId}`,
          "WARN",
        );
      }

      // 对SFTP会话管理器的调用添加额外的错误处理
      try {
        return await this.sftpManager.getSftpSession(tabId);
      } catch (error) {
        // 如果获取SFTP会话失败，但我们知道有有效的SSH连接，尝试清理并重试
        if (
          processInfo &&
          error.message.includes("Invalid SSH connection info")
        ) {
          logToFile(
            `Connection manager: SFTP session error, cleaning up and retrying for tab ${tabId}`,
            "WARN",
          );

          // 先关闭可能存在的问题会话
          this.sftpManager.closeSftpSession(tabId);

          // 短暂延迟
          await new Promise((resolve) => setTimeout(resolve, 300));

          // 重试获取SFTP会话
          return await this.sftpManager.getSftpSession(tabId);
        }

        // 其他错误直接抛出
        throw error;
      }
    } catch (error) {
      logToFile(
        `Connection manager: Failed to get SFTP session for tab ${tabId}: ${error.message}`,
        "ERROR",
      );
      throw error;
    }
  }

  closeSftpSession(tabId) {
    this.sftpManager.closeSftpSession(tabId);
  }

  enqueueSftpOperation(tabId, operation, options = {}) {
    return this.sftpManager.enqueueSftpOperation(tabId, operation, options);
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
    // 合并SSH和Telnet的最近连接
    const sshLastConnections = this.sshConnectionPool.getLastConnections(count);
    const telnetLastConnections =
      this.telnetConnectionPool.getLastConnections(count);

    // 合并两个列表，保持时间顺序（简单合并，实际使用中可能需要更复杂的合并逻辑）
    const allConnections = [...sshLastConnections, ...telnetLastConnections];
    return allConnections.slice(0, count);
  }

  // 从配置文件加载并初始化最近连接列表
  loadLastConnectionsFromConfig(connections) {
    if (Array.isArray(connections) && connections.length > 0) {
      // 简单处理：将所有连接ID都加载到SSH连接池
      // 实际使用中可能需要区分SSH和Telnet
      this.sshConnectionPool.setLastConnections(connections);
      logToFile(
        `Loaded ${connections.length} last connections into connection pools`,
        "INFO",
      );
    }
  }

  // SSH连接池相关方法
  async getSSHConnection(sshConfig) {
    return this.sshConnectionPool.getConnection(sshConfig);
  }

  releaseSSHConnection(connectionKey, tabId = null) {
    this.sshConnectionPool.releaseConnection(connectionKey, tabId);
  }

  // Telnet连接池相关方法
  async getTelnetConnection(telnetConfig) {
    return this.telnetConnectionPool.getConnection(telnetConfig);
  }

  releaseTelnetConnection(connectionKey, tabId = null) {
    this.telnetConnectionPool.releaseConnection(connectionKey, tabId);
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
        this.telnetConnectionPool.closeConnection(connectionKey);
        logToFile(`手动关闭Telnet连接: ${connectionKey}`, "INFO");
      } else {
        this.sshConnectionPool.closeConnection(connectionKey);
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
