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

  async startSSH(sshConfig) {
    return this.processManager.startSSH(sshConfig);
  }

  sendInput(processId, input) {
    this.processManager.sendInput(processId, input);
  }

  killProcess(processId) {
    this.processManager.killProcess(processId);
  }

  resizeTerminal(processId, cols, rows) {
    this.processManager.resizeTerminal(processId, cols, rows);
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
