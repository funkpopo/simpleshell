const sftpManager = require("./sftp-manager");
const sshManager = require("./ssh-manager");
const { logToFile } = require("../../core/utils/logger");

class ConnectionManager {
  constructor() {
    this.sftpManager = sftpManager;
    this.sshManager = sshManager;
  }

  initialize() {
    logToFile("Connection manager initialized", "INFO");
    this.sftpManager.initialize();
  }

  cleanup() {
    logToFile("Connection manager cleanup", "INFO");
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
}

// 创建单例实例
const connectionManager = new ConnectionManager();

module.exports = connectionManager;
