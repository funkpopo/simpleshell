const { spawn } = require("child_process");
const Client = require("ssh2").Client;
const { logToFile } = require("../../core/utils/logger");

class ProcessManager {
  constructor() {
    // 应用设置和状态管理
    this.childProcesses = new Map();
    this.nextProcessId = 1;

    // 全局变量
    this.terminalProcesses = new Map(); // 存储终端进程ID映射

    // 跟踪编辑器会话状态的正则表达式
    this.editorCommandRegex =
      /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;
    this.editorExitCommands = [
      "q",
      "quit",
      "exit",
      "wq",
      "ZZ",
      "x",
      ":q",
      ":wq",
      ":x",
      "Ctrl+X",
    ];
    this.editorExitRegex = new RegExp(
      `^(${this.editorExitCommands.join("|").replace(/\+/g, "\\+")}|:\\w+)$`,
      "i",
    );
  }

  initialize() {
    logToFile("Process manager initialized", "INFO");
  }

  cleanup() {
    // 终止所有活动进程
    for (const [processId, processInfo] of this.childProcesses) {
      try {
        if (
          processInfo.process &&
          typeof processInfo.process.kill === "function"
        ) {
          processInfo.process.kill();
        } else if (
          processInfo.process &&
          typeof processInfo.process.end === "function"
        ) {
          processInfo.process.end();
        }
      } catch (error) {
        logToFile(
          `Error killing process ${processId}: ${error.message}`,
          "ERROR",
        );
      }
    }
    this.childProcesses.clear();
    this.terminalProcesses.clear();
    logToFile("Process manager cleanup completed", "INFO");
  }

  async startSSH(sshConfig) {
    const processId = this.nextProcessId++;

    if (!sshConfig || !sshConfig.host) {
      const error = new Error("Invalid SSH configuration");
      logToFile(`SSH start failed: ${error.message}`, "ERROR");
      throw error;
    }

    try {
      // 使用连接池获取SSH连接
      const connectionManager = require("../connection");
      const connectionInfo = await connectionManager.getSSHConnection(sshConfig);

      // 存储进程信息 - 使用连接池中的连接
      const processInfo = {
        process: connectionInfo.client,
        listeners: new Set(),
        config: sshConfig,
        type: "ssh2",
        ready: connectionInfo.ready,
        editorMode: false,
        commandBuffer: "",
        lastOutputLines: [],
        outputBuffer: "",
        isRemote: true,
        connectionKey: connectionInfo.key, // 存储连接键用于释放
        connectionInfo: connectionInfo // 存储完整连接信息
      };

      this.childProcesses.set(processId, processInfo);

      // 存储相同的SSH客户端，使用tabId
      if (sshConfig.tabId) {
        this.childProcesses.set(sshConfig.tabId, {
          ...processInfo,
          listeners: new Set() // 为tabId创建独立的监听器集合
        });
      }

      logToFile(`SSH连接已从连接池获取: ${sshConfig.host}`, "INFO");
      return processId;
    } catch (error) {
      logToFile(`Failed to get SSH connection from pool: ${error.message}`, "ERROR");
      throw error;
    }
  }

  sendInput(processId, input) {
    const processInfo = this.childProcesses.get(processId);
    if (!processInfo) {
      return;
    }

    try {
      if (processInfo.type === "ssh2") {
        // SSH连接处理
        if (processInfo.stream) {
          processInfo.stream.write(input);
        }
      } else {
        // PowerShell进程处理
        if (processInfo.process && processInfo.process.stdin) {
          processInfo.process.stdin.write(input);
        }
      }
    } catch (error) {
      logToFile(
        `Error sending input to process ${processId}: ${error.message}`,
        "ERROR",
      );
    }
  }

  killProcess(processId) {
    const processInfo = this.childProcesses.get(processId);
    if (!processInfo) {
      return;
    }

    try {
      if (processInfo.type === "ssh2") {
        // SSH连接处理 - 释放连接池中的连接引用
        if (processInfo.connectionKey) {
          const connectionManager = require("../connection");
          connectionManager.releaseSSHConnection(processInfo.connectionKey);
          logToFile(`释放连接池连接: ${processInfo.connectionKey}`, "INFO");
        }

        // 注意：不直接关闭SSH连接，由连接池管理
      } else {
        // PowerShell进程处理
        if (
          processInfo.process &&
          typeof processInfo.process.kill === "function"
        ) {
          processInfo.process.kill();
        }
      }

      this.childProcesses.delete(processId);
      logToFile(`Process ${processId} terminated`, "INFO");
    } catch (error) {
      logToFile(
        `Error killing process ${processId}: ${error.message}`,
        "ERROR",
      );
    }
  }

  resizeTerminal(processId, cols, rows) {
    const processInfo = this.childProcesses.get(processId);
    if (!processInfo) {
      return;
    }

    try {
      if (processInfo.type === "ssh2" && processInfo.stream) {
        // SSH连接的终端大小调整
        if (typeof processInfo.stream.setWindow === "function") {
          processInfo.stream.setWindow(rows, cols);
        }
      }
      // PowerShell进程通常不需要手动调整大小
    } catch (error) {
      logToFile(
        `Error resizing terminal ${processId}: ${error.message}`,
        "ERROR",
      );
    }
  }

  getProcessInfo(processId) {
    return this.childProcesses.get(processId);
  }

  getAllProcesses() {
    return this.childProcesses;
  }

  setProcessStream(processId, stream) {
    const processInfo = this.childProcesses.get(processId);
    if (processInfo) {
      processInfo.stream = stream;
    }
  }
}

// 创建单例实例
const processManager = new ProcessManager();

// 导出childProcesses以供其他模块使用（向后兼容）
module.exports = processManager;
module.exports.childProcesses = processManager.childProcesses;
