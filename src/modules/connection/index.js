const sftpManager = require("./sftp-manager");
const sshConnectionPool = require("./ssh-connection-pool");
const { logToFile } = require("../../core/utils/logger");

class ConnectionManager {
  constructor() {
    this.sftpManager = sftpManager;
    this.sshConnectionPool = sshConnectionPool;
  }

  initialize() {
    logToFile("Connection manager initialized", "INFO");
    this.sshConnectionPool.initialize();
    this.sftpManager.initialize();
  }

  cleanup() {
    logToFile("Connection manager cleanup", "INFO");
    this.sshConnectionPool.cleanup();
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

  // 连接池相关方法
  async getSSHConnection(sshConfig) {
    return this.sshConnectionPool.getConnection(sshConfig);
  }

  releaseSSHConnection(connectionKey, tabId = null) {
    this.sshConnectionPool.releaseConnection(connectionKey, tabId);
  }

  // 添加标签页引用追踪
  addTabReference(tabId, connectionKey) {
    if (this.sshConnectionPool.addTabReference) {
      this.sshConnectionPool.addTabReference(tabId, connectionKey);
    }
  }

  getConnectionPoolStatus() {
    return this.sshConnectionPool.getStatus();
  }

  getConnectionPoolStats() {
    return this.sshConnectionPool.getDetailedStats();
  }

  // 优雅关闭指定连接
  async closeSSHConnection(connectionKey) {
    try {
      this.sshConnectionPool.closeConnection(connectionKey);
      logToFile(`手动关闭SSH连接: ${connectionKey}`, "INFO");
    } catch (error) {
      logToFile(
        `关闭SSH连接失败: ${connectionKey} - ${error.message}`,
        "ERROR",
      );
      throw error;
    }
  }

  // 清理空闲连接
  cleanupIdleConnections(count = 1) {
    return this.sshConnectionPool.cleanupIdleConnections(count);
  }

  // 强制健康检查
  performHealthCheck() {
    this.sshConnectionPool.performHealthCheck();
  }
}

// 创建单例实例
const connectionManager = new ConnectionManager();

module.exports = connectionManager;
