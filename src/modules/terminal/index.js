const processManager = require("./process-manager");
const outputProcessor = require("./output-processor");
const { logToFile } = require("../../core/utils/logger");

class TerminalManager {
  constructor() {
    this.processManager = processManager;
    this.outputProcessor = outputProcessor;
  }

  initialize() {
    logToFile("Terminal manager initialized", "INFO");
    this.processManager.initialize();
  }

  cleanup() {
    logToFile("Terminal manager cleanup", "INFO");
    this.processManager.cleanup();
  }

  async createSSHTerminal(sshConfig) {
    return this.processManager.startSSH(sshConfig);
  }

  async createTelnetTerminal() {
    // Implement Telnet terminal creation
    return { success: false, error: "Telnet not implemented" };
  }

  async terminateTerminal(processId) {
    return this.processManager.killProcess(processId);
  }

  async resizeTerminal(processId, cols, rows) {
    return this.processManager.resizeTerminal(processId, cols, rows);
  }

  async getSystemInfo(processId) {
    return this.processManager.getSystemInfo(processId);
  }

  async getProcessList(processId) {
    return this.processManager.getProcessList(processId);
  }

  async loadSavedConnections() {
    return this.processManager.loadSavedConnections();
  }

  async saveConnections(connections) {
    return this.processManager.saveConnections(connections);
  }

  async getTopConnections() {
    return this.processManager.getTopConnections();
  }

  async startSSH(sshConfig) {
    return this.processManager.startSSH(sshConfig);
  }

  sendInput(processId, input) {
    this.processManager.sendInput(processId, input);
  }

  killProcess(processId) {
    this.processManager.killProcess(processId);
  }


  getProcessInfo(processId) {
    return this.processManager.getProcessInfo(processId);
  }

  processOutput(processId, output) {
    return this.outputProcessor.processTerminalOutput(processId, output);
  }

  getAllProcesses() {
    return this.processManager.getAllProcesses();
  }
}

// 创建单例实例
const terminalManager = new TerminalManager();

module.exports = terminalManager;
