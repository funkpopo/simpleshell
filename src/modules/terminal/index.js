const processManager = require("./process-manager");
const outputProcessor = require("./output-processor");
const { logToFile } = require("../../core/utils/logger");

/**
 * 终端管理模块
 * 负责终端进程管理和输出处理
 */
class TerminalManager {
  constructor() {
    this.processManager = processManager;
    this.outputProcessor = outputProcessor;
  }

  /**
   * 初始化终端管理器
   */
  initialize() {
    logToFile("Terminal manager initialized", "INFO");
    this.processManager.initialize();
  }

  /**
   * 清理终端管理器
   */
  cleanup() {
    logToFile("Terminal manager cleanup", "INFO");
    this.processManager.cleanup();
  }

  /**
   * 启动PowerShell进程
   * @returns {Promise<number>} 进程ID
   */
  async startPowerShell() {
    return this.processManager.startPowerShell();
  }

  /**
   * 启动SSH连接
   * @param {Object} sshConfig - SSH配置
   * @returns {Promise<number>} 进程ID
   */
  async startSSH(sshConfig) {
    return this.processManager.startSSH(sshConfig);
  }

  /**
   * 向进程发送输入
   * @param {number} processId - 进程ID
   * @param {string} input - 输入内容
   */
  sendInput(processId, input) {
    this.processManager.sendInput(processId, input);
  }

  /**
   * 终止进程
   * @param {number} processId - 进程ID
   */
  killProcess(processId) {
    this.processManager.killProcess(processId);
  }

  /**
   * 调整终端大小
   * @param {number} processId - 进程ID
   * @param {number} cols - 列数
   * @param {number} rows - 行数
   */
  resizeTerminal(processId, cols, rows) {
    this.processManager.resizeTerminal(processId, cols, rows);
  }

  /**
   * 获取进程信息
   * @param {number} processId - 进程ID
   * @returns {Object} 进程信息
   */
  getProcessInfo(processId) {
    return this.processManager.getProcessInfo(processId);
  }

  /**
   * 处理终端输出
   * @param {number} processId - 进程ID
   * @param {string} output - 输出内容
   * @returns {string} 处理后的输出
   */
  processOutput(processId, output) {
    return this.outputProcessor.processTerminalOutput(processId, output);
  }

  /**
   * 获取所有活动进程
   * @returns {Map} 进程映射
   */
  getAllProcesses() {
    return this.processManager.getAllProcesses();
  }
}

// 创建单例实例
const terminalManager = new TerminalManager();

module.exports = terminalManager;
