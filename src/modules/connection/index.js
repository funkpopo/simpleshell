const sftpManager = require("./sftp-manager");
const sshManager = require("./ssh-manager");
const { logToFile } = require("../../core/utils/logger");

/**
 * 连接管理模块
 * 负责SSH和SFTP连接的管理
 */
class ConnectionManager {
  constructor() {
    this.sftpManager = sftpManager;
    this.sshManager = sshManager;
  }

  /**
   * 初始化连接管理器
   */
  initialize() {
    logToFile("Connection manager initialized", "INFO");
    this.sftpManager.initialize();
  }

  /**
   * 清理连接管理器
   */
  cleanup() {
    logToFile("Connection manager cleanup", "INFO");
    this.sftpManager.cleanup();
  }

  /**
   * 获取SFTP会话
   * @param {string} tabId - 标签页ID
   * @returns {Promise} SFTP会话
   */
  async getSftpSession(tabId) {
    return this.sftpManager.getSftpSession(tabId);
  }

  /**
   * 关闭SFTP会话
   * @param {string} tabId - 标签页ID
   */
  closeSftpSession(tabId) {
    this.sftpManager.closeSftpSession(tabId);
  }

  /**
   * 将SFTP操作加入队列
   * @param {string} tabId - 标签页ID
   * @param {Function} operation - 操作函数
   * @param {Object} options - 选项
   */
  enqueueSftpOperation(tabId, operation, options = {}) {
    return this.sftpManager.enqueueSftpOperation(tabId, operation, options);
  }

  /**
   * 启动SSH连接
   * @param {Object} sshConfig - SSH配置
   * @returns {Promise<number>} 进程ID
   */
  async startSSH(sshConfig) {
    return this.sshManager.startSSH(sshConfig);
  }

  /**
   * 启动PowerShell进程
   * @returns {Promise<number>} 进程ID
   */
  async startPowerShell() {
    return this.sshManager.startPowerShell();
  }

  /**
   * 向进程发送输入
   * @param {number} processId - 进程ID
   * @param {string} input - 输入内容
   */
  sendInput(processId, input) {
    this.sshManager.sendInput(processId, input);
  }

  /**
   * 终止进程
   * @param {number} processId - 进程ID
   */
  killProcess(processId) {
    this.sshManager.killProcess(processId);
  }

  /**
   * 调整终端大小
   * @param {number} processId - 进程ID
   * @param {number} cols - 列数
   * @param {number} rows - 行数
   */
  resizeTerminal(processId, cols, rows) {
    this.sshManager.resizeTerminal(processId, cols, rows);
  }
}

// 创建单例实例
const connectionManager = new ConnectionManager();

module.exports = connectionManager;
