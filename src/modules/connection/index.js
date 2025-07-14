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
    return this.sftpManager.getSftpSession(tabId);
  }

  closeSftpSession(tabId) {
    this.sftpManager.closeSftpSession(tabId);
  }

  enqueueSftpOperation(tabId, operation, options = {}) {
    return this.sftpManager.enqueueSftpOperation(tabId, operation, options);
  }

  async startSSH(sshConfig) {
    return this.sshManager.startSSH(sshConfig);
  }

  async startPowerShell() {
    return this.sshManager.startPowerShell();
  }

  sendInput(processId, input) {
    this.sshManager.sendInput(processId, input);
  }

  killProcess(processId) {
    this.sshManager.killProcess(processId);
  }

  resizeTerminal(processId, cols, rows) {
    this.sshManager.resizeTerminal(processId, cols, rows);
  }

  getTopConnections(count) {
    // 合并SSH和Telnet的热门连接
    const sshTopConnections = this.sshConnectionPool.getTopConnections(count);
    const telnetTopConnections = this.telnetConnectionPool.getTopConnections(count);
    
    // 合并并按使用次数排序
    const allConnections = [...sshTopConnections, ...telnetTopConnections];
    return allConnections.slice(0, count);
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
    if (connectionKey.startsWith('telnet:')) {
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
      telnet: this.telnetConnectionPool.getStatus()
    };
  }

  getConnectionPoolStats() {
    return {
      ssh: this.sshConnectionPool.getDetailedStats(),
      telnet: this.telnetConnectionPool.getDetailedStats()
    };
  }

  // 优雅关闭指定连接
  async closeConnection(connectionKey) {
    try {
      // 根据连接键前缀判断是SSH还是Telnet
      if (connectionKey.startsWith('telnet:')) {
        this.telnetConnectionPool.closeConnection(connectionKey);
        logToFile(`手动关闭Telnet连接: ${connectionKey}`, "INFO");
      } else {
        this.sshConnectionPool.closeConnection(connectionKey);
        logToFile(`手动关闭SSH连接: ${connectionKey}`, "INFO");
      }
    } catch (error) {
      logToFile(
        `关闭连接失败: ${connectionKey} - ${error.message}`,
        "ERROR",
      );
      throw error;
    }
  }

  // 清理空闲连接
  cleanupIdleConnections(count = 1) {
    const sshCleaned = this.sshConnectionPool.cleanupIdleConnections(Math.ceil(count / 2));
    const telnetCleaned = this.telnetConnectionPool.cleanupIdleConnections(Math.ceil(count / 2));
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
