const { spawn } = require("child_process");
const Client = require("ssh2").Client;
const { logToFile } = require("../../core/utils/logger");
const coreProcessManager = require("../../core/process/processManager");

class ProcessManager {
  constructor() {
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

  // 代理到核心进程管理器
  get childProcesses() {
    return {
      get: (id) => coreProcessManager.getProcess(id),
      set: (id, info) => coreProcessManager.setProcess(id, info),
      has: (id) => coreProcessManager.hasProcess(id),
      delete: (id) => coreProcessManager.deleteProcess(id),
      clear: () => coreProcessManager.clearAllProcesses(),
      entries: () => coreProcessManager.getAllProcesses(),
      [Symbol.iterator]: function* () {
        for (const entry of coreProcessManager.getAllProcesses()) {
          yield entry;
        }
      },
    };
  }

  get terminalProcesses() {
    return {
      get: (id) => coreProcessManager.getTerminalProcess(id),
      set: (id, info) => coreProcessManager.setTerminalProcess(id, info),
      has: (id) => coreProcessManager.hasTerminalProcess(id),
      delete: (id) => coreProcessManager.deleteTerminalProcess(id),
      clear: () => {},
    };
  }

  get nextProcessId() {
    return coreProcessManager.getNextProcessId();
  }

  initialize() {
    logToFile("Process manager initialized", "INFO");
  }

  cleanup() {
    // 终止所有活动进程
    for (const [processId, processInfo] of this.childProcesses) {
      try {
        // 对于SSH连接，优先使用 end() 发送正确的断开信号
        if (
          processInfo.process &&
          typeof processInfo.process.end === "function"
        ) {
          processInfo.process.end();
        } else if (
          processInfo.process &&
          typeof processInfo.process.kill === "function"
        ) {
          processInfo.process.kill();
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
    const processId = this.nextProcessId;

    if (!sshConfig || !sshConfig.host) {
      const error = new Error("Invalid SSH configuration");
      logToFile(`SSH start failed: ${error.message}`, "ERROR");
      throw error;
    }

    try {
      // 使用连接池获取SSH连接
      const connectionManager = require("../connection");
      const connectionInfo =
        await connectionManager.getSSHConnection(sshConfig);

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
        connectionInfo: connectionInfo, // 存储完整连接信息
        tabId: sshConfig.tabId, // 存储标签页ID
        keepAlive: true, // 标记为需要保活的连接
      };

      this.childProcesses.set(processId, processInfo);

      // 存储相同的SSH客户端，使用tabId
      if (sshConfig.tabId) {
        this.childProcesses.set(sshConfig.tabId, {
          ...processInfo,
          listeners: new Set(), // 为tabId创建独立的监听器集合
        });

        // 在连接池中添加标签页引用
        const connectionManager = require("../connection");
        if (connectionManager.addTabReference) {
          connectionManager.addTabReference(
            sshConfig.tabId,
            connectionInfo.key,
          );
        }
      }

      logToFile(`SSH连接已从连接池获取: ${sshConfig.host}`, "INFO");
      return processId;
    } catch (error) {
      logToFile(
        `Failed to get SSH connection from pool: ${error.message}`,
        "ERROR",
      );
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
        // 本地终端进程处理
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
          // 传递tabId以便连接池正确管理标签页引用
          connectionManager.releaseSSHConnection(
            processInfo.connectionKey,
            processInfo.tabId,
          );
          logToFile(
            `释放连接池连接: ${processInfo.connectionKey}, 标签页: ${processInfo.tabId}`,
            "INFO",
          );
        }

        // 注意：不直接关闭SSH连接，由连接池管理
      } else {
        // 本地终端进程处理
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
      // 本地终端进程通常不需要手动调整大小
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
    return coreProcessManager.getAllProcesses();
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

module.exports = processManager;
