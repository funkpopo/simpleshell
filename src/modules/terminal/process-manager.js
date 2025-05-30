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

    return new Promise((resolve, reject) => {
      try {
        // 创建SSH2客户端连接
        const ssh = new Client();

        // 存储进程信息 - 这里保存ssh客户端实例
        this.childProcesses.set(processId, {
          process: ssh,
          listeners: new Set(),
          config: sshConfig,
          type: "ssh2",
          ready: false, // 标记SSH连接状态，默认为未就绪
          editorMode: false, // 初始化编辑器模式为false
          commandBuffer: "", // 初始化命令缓冲区
          lastOutputLines: [], // 存储最近的终端输出行，用于提取远程命令
          outputBuffer: "", // 用于存储当前未处理完的输出
          isRemote: true, // 标记为远程SSH会话
        });

        // 存储相同的SSH客户端，使用tabId（通常是形如'ssh-timestamp'的标识符）
        if (sshConfig.tabId) {
          this.childProcesses.set(sshConfig.tabId, {
            process: ssh,
            listeners: new Set(),
            config: sshConfig,
            type: "ssh2",
            ready: false, // 标记SSH连接状态，默认为未就绪
            editorMode: false, // 初始化编辑器模式为false
            commandBuffer: "", // 初始化命令缓冲区
            lastOutputLines: [], // 存储最近的终端输出行，用于提取远程命令
            outputBuffer: "", // 用于存储当前未处理完的输出
            isRemote: true, // 标记为远程SSH会话
          });
        }

        // 设置连接超时定时器
        const connectionTimeout = setTimeout(() => {
          logToFile("SSH connection timed out after 15 seconds", "ERROR");
          reject(new Error("SSH connection timeout"));
        }, 15000);

        // 监听就绪事件
        ssh.on("ready", () => {
          // 清除超时定时器
          clearTimeout(connectionTimeout);

          // 标记SSH连接为就绪状态
          const procInfo = this.childProcesses.get(processId);
          if (procInfo) {
            procInfo.ready = true;
          }

          // 同时更新tabId对应的连接状态
          if (sshConfig.tabId) {
            const tabProcInfo = this.childProcesses.get(sshConfig.tabId);
            if (tabProcInfo) {
              tabProcInfo.ready = true;
            }
          }

          logToFile(`SSH connection established for ${sshConfig.host}`, "INFO");
          resolve(processId);
        });

        // 监听错误事件
        ssh.on("error", (err) => {
          clearTimeout(connectionTimeout);
          logToFile(`SSH connection error: ${err.message}`, "ERROR");
          this.childProcesses.delete(processId);
          if (sshConfig.tabId) {
            this.childProcesses.delete(sshConfig.tabId);
          }
          reject(err);
        });

        // 监听关闭事件
        ssh.on("close", () => {
          logToFile(`SSH connection closed for ${sshConfig.host}`, "INFO");
          this.childProcesses.delete(processId);
          if (sshConfig.tabId) {
            this.childProcesses.delete(sshConfig.tabId);
          }
        });

        // 建立SSH连接
        const connectionOptions = {
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.username,
        };

        // 添加认证方式
        if (sshConfig.password) {
          connectionOptions.password = sshConfig.password;
        }

        if (sshConfig.privateKey) {
          connectionOptions.privateKey = sshConfig.privateKey;
          if (sshConfig.passphrase) {
            connectionOptions.passphrase = sshConfig.passphrase;
          }
        }

        ssh.connect(connectionOptions);
      } catch (error) {
        logToFile(`Failed to start SSH connection: ${error.message}`, "ERROR");
        reject(error);
      }
    });
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
        // SSH连接处理
        if (
          processInfo.process &&
          typeof processInfo.process.end === "function"
        ) {
          processInfo.process.end();
        }
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
