const terminalManager = require("../../../modules/terminal");
const commandHistoryService = require("../../../modules/terminal/command-history");
const { logToFile } = require("../../utils/logger");
const { dialog } = require("electron");
const path = require("path");
const { spawn } = require("child_process");

/**
 * 终端相关的IPC处理器
 */
class TerminalHandlers {
  constructor(childProcesses, terminalProcesses) {
    this.childProcesses = childProcesses;
    this.terminalProcesses = terminalProcesses;
    this.nextProcessId = 1;

    // 编辑器相关的正则表达式
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

  /**
   * 获取所有终端处理器
   */
  getHandlers() {
    return [
      {
        channel: "terminal:startSSH",
        category: "terminal",
        handler: this.startSSH.bind(this),
      },
      {
        channel: "terminal:startTelnet",
        category: "terminal",
        handler: this.startTelnet.bind(this),
      },
      {
        channel: "terminal:sendToProcess",
        category: "terminal",
        handler: this.sendToProcess.bind(this),
      },
      {
        channel: "terminal:killProcess",
        category: "terminal",
        handler: this.killProcess.bind(this),
      },
      {
        channel: "terminal:resize",
        category: "terminal",
        handler: this.resizeTerminal.bind(this),
      },
      {
        channel: "terminal:command",
        category: "terminal",
        handler: this.executeCommand.bind(this),
      },
      {
        channel: "terminal:getSystemInfo",
        category: "terminal",
        handler: this.getSystemInfo.bind(this),
      },
      {
        channel: "terminal:getProcessList",
        category: "terminal",
        handler: this.getProcessList.bind(this),
      },
      {
        channel: "terminal:getProcessInfo",
        category: "terminal",
        handler: this.getProcessInfo.bind(this),
      },
      {
        channel: "terminal:loadConnections",
        category: "terminal",
        handler: this.loadConnections.bind(this),
      },
      {
        channel: "terminal:saveConnections",
        category: "terminal",
        handler: this.saveConnections.bind(this),
      },
      {
        channel: "terminal:loadTopConnections",
        category: "terminal",
        handler: this.loadTopConnections.bind(this),
      },
      {
        channel: "terminal:selectKeyFile",
        category: "terminal",
        handler: this.selectKeyFile.bind(this),
      },
    ];
  }

  /**
   * 获取单向监听器
   */
  getListeners() {
    return [
      {
        channel: "terminal:sendInput",
        category: "terminal",
        handler: this.handleTerminalInput.bind(this),
      },
    ];
  }

  // 实现各个处理器方法
  async startSSH(event, sshConfig) {
    // 实现SSH连接逻辑
    const processId = this.nextProcessId++;
    try {
      const mainWindow = event.sender.getOwnerBrowserWindow();
      const result = await terminalManager.createSSHTerminal(
        processId,
        sshConfig,
        mainWindow,
      );

      if (result.success) {
        this.childProcesses.set(processId, result.connection);
        this.terminalProcesses.set(processId, {
          type: "ssh",
          connection: result.connection,
        });
        logToFile(`SSH terminal created with ID: ${processId}`, "INFO");
      }

      return result;
    } catch (error) {
      logToFile(`Error starting SSH: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async startTelnet(event, telnetConfig) {
    // 实现Telnet连接逻辑
    const processId = this.nextProcessId++;
    try {
      const mainWindow = event.sender.getOwnerBrowserWindow();
      const result = await terminalManager.createTelnetTerminal(
        processId,
        telnetConfig,
        mainWindow,
      );

      if (result.success) {
        this.childProcesses.set(processId, result.connection);
        this.terminalProcesses.set(processId, {
          type: "telnet",
          connection: result.connection,
        });
        logToFile(`Telnet terminal created with ID: ${processId}`, "INFO");
      }

      return result;
    } catch (error) {
      logToFile(`Error starting Telnet: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async sendToProcess(event, processId, data) {
    const process = this.childProcesses.get(processId);
    if (process && process.stdin) {
      process.stdin.write(data);
      return { success: true };
    }
    return { success: false, error: "Process not found" };
  }

  async killProcess(event, processId) {
    try {
      await terminalManager.terminateTerminal(processId);
      this.childProcesses.delete(processId);
      this.terminalProcesses.delete(processId);
      logToFile(`Process ${processId} terminated`, "INFO");
      return { success: true };
    } catch (error) {
      logToFile(
        `Error killing process ${processId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  async resizeTerminal(event, processId, cols, rows) {
    try {
      await terminalManager.resizeTerminal(processId, cols, rows);
      return { success: true };
    } catch (error) {
      logToFile(
        `Error resizing terminal ${processId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  async executeCommand(event, command) {
    // 实现命令执行逻辑
    return { success: true, result: "Command executed" };
  }

  async getSystemInfo(event, processId) {
    try {
      const info = await terminalManager.getSystemInfo(processId);
      return { success: true, data: info };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getProcessList(event, processId) {
    try {
      const processes = await terminalManager.getProcessList(processId);
      return { success: true, data: processes };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getProcessInfo(event, processId) {
    const process = this.terminalProcesses.get(processId);
    if (process) {
      return {
        success: true,
        info: {
          id: processId,
          type: process.type,
          isAlive: !!process.process || !!process.connection,
        },
      };
    }
    return { success: false, error: "Process not found" };
  }

  async loadConnections(event) {
    try {
      const connections = await terminalManager.loadSavedConnections();
      return { success: true, connections };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async saveConnections(event, connections) {
    try {
      await terminalManager.saveConnections(connections);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async loadTopConnections(event) {
    try {
      const connections = await terminalManager.getTopConnections();
      return { success: true, connections };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async selectKeyFile(event) {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "SSH Keys", extensions: ["pem", "ppk", "key", "pub"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false, canceled: true };
  }

  // 单向监听器处理方法
  handleTerminalInput(event, { processId, input }) {
    try {
      const terminalProcess = this.terminalProcesses.get(processId);
      if (!terminalProcess) {
        logToFile(`Process not found: ${processId}`, "ERROR");
        return;
      }

      // 根据终端类型处理输入
      switch (terminalProcess.type) {
        case "local":
          if (terminalProcess.process && terminalProcess.process.stdin) {
            terminalProcess.process.stdin.write(input);
          }
          break;

        case "ssh":
          if (terminalProcess.connection && terminalProcess.connection.stream) {
            terminalProcess.connection.stream.write(input);
          }
          break;

        case "telnet":
          if (terminalProcess.connection) {
            terminalProcess.connection.getSocket((err, stream) => {
              if (!err && stream) {
                stream.write(input);
              }
            });
          }
          break;

        default:
          logToFile(`Unknown terminal type: ${terminalProcess.type}`, "ERROR");
      }
    } catch (error) {
      logToFile(`Error handling terminal input: ${error.message}`, "ERROR");
    }
  }

  /**
   * 清理所有终端进程
   */
  cleanup() {
    for (const [processId] of this.childProcesses) {
      try {
        terminalManager.terminateTerminal(processId);
      } catch (error) {
        logToFile(
          `Error cleaning up process ${processId}: ${error.message}`,
          "ERROR",
        );
      }
    }

    this.childProcesses.clear();
    this.terminalProcesses.clear();
    logToFile("All terminal processes cleaned up", "INFO");
  }
}

module.exports = TerminalHandlers;
