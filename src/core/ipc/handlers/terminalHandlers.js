const { dialog, BrowserWindow } = require("electron");
const { logToFile } = require("../../utils/logger");
const configService = require("../../../services/configService");

// 跟踪编辑器会话状态的正则表达式
const editorCommandRegex = /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;
const editorExitCommands = [
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
const editorExitRegex = new RegExp(
  `^(${editorExitCommands.join("|").replace(/\+/g, "\\+")}|:\\w+)$`,
  "i"
);

/**
 * 终端相关的IPC处理器
 */
class TerminalHandlers {
  constructor(options = {}) {
    this.processManager = options.processManager;
    this.connectionManager = options.connectionManager;
    this.sftpCore = options.sftpCore;
    this.getLatencyHandlers = options.getLatencyHandlers;
  }

  /**
   * 获取所有终端处理器
   */
  getHandlers() {
    return [
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
        channel: "terminal:saveConnections",
        category: "terminal",
        handler: this.saveConnections.bind(this),
      },
      {
        channel: "terminal:selectKeyFile",
        category: "terminal",
        handler: this.selectKeyFile.bind(this),
      },
      {
        channel: "terminal:command",
        category: "terminal",
        handler: this.executeCommand.bind(this),
      },
      {
        channel: "terminal:resize",
        category: "terminal",
        handler: this.resizeTerminal.bind(this),
      },
      {
        channel: "terminal:cleanupConnection",
        category: "terminal",
        handler: this.cleanupConnection.bind(this),
      },
      {
        channel: "terminal:getProcessInfo",
        category: "terminal",
        handler: this.getProcessInfo.bind(this),
      },
      {
        channel: "terminal:notifyEditorModeChange",
        category: "terminal",
        handler: this.notifyEditorModeChange.bind(this),
      },
    ];
  }

  /**
   * 获取事件类型处理器（使用ipcMain.on而非safeHandle）
   */
  getEventHandlers() {
    return [
      {
        channel: "terminal:sendInput",
        category: "terminal",
        handler: this.sendInput.bind(this),
      },
    ];
  }

  /**
   * 发送输入到进程（事件类型，无返回值）
   */
  sendInput(_event, { processId, input }) {
    const processInfo = this.processManager.getProcess(processId);
    if (!processInfo) {
      logToFile(`Process not found: ${processId}`, "ERROR");
      return;
    }

    try {
      if (processInfo.type === "node-pty") {
        processInfo.process.write(input);
      } else if (processInfo.type === "ssh2" && processInfo.stream) {
        processInfo.stream.write(input);
      } else if (processInfo.type === "telnet" && processInfo.process) {
        processInfo.process.shell((err, stream) => {
          if (err) {
            logToFile(`Error getting telnet shell: ${err.message}`, "ERROR");
            return;
          }
          stream.write(input);
        });
      } else {
        logToFile(
          `Invalid process type or stream for input: ${processId}`,
          "ERROR",
        );
      }
    } catch (error) {
      logToFile(
        `Error sending input to process ${processId}: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 发送数据到进程
   */
  async sendToProcess(event, processId, data) {
    const procInfo = this.processManager.getProcess(processId);
    if (!procInfo || !procInfo.process) {
      return false;
    }

    try {
      // 确保退格键字符正确转换
      let processedData = data;

      // 检测是否包含中文字符
      const containsChinese = /[\u4e00-\u9fa5]/.test(data);
      if (containsChinese && procInfo.type === "ssh2") {
        // 确保中文字符能够正确处理
        // 对于SSH连接，我们需要确保数据是UTF-8编码的
        try {
          // 创建Buffer时显式指定UTF-8编码
          processedData = Buffer.from(data, "utf8").toString("utf8");
        } catch (error) {
          logToFile(
            `Error encoding Chinese characters: ${error.message}`,
            "ERROR"
          );
          // 如果编码失败，使用原始数据
          processedData = data;
        }
      }

      // 检测Tab键 (ASCII 9, \t, \x09)
      if (data === "\t" || data === "\x09") {
        // 直接发送到进程
        if (procInfo.type === "ssh2") {
          if (procInfo.stream) {
            procInfo.stream.write(processedData);
            return true;
          } else {
            logToFile("SSH2 stream not available", "ERROR");
            return false;
          }
        } else if (typeof procInfo.process.write === "function") {
          procInfo.process.write(processedData);
          return true;
        } else if (procInfo.process.stdin) {
          procInfo.process.stdin.write(processedData);
          return true;
        } else {
          logToFile("Process has no valid write method", "ERROR");
          return false;
        }
      }

      // 检测回车键并提取可能的命令
      if (data === "\r" || data === "\n") {
        // 可能是一个命令的结束，尝试从缓冲区获取命令
        if (procInfo.commandBuffer && procInfo.commandBuffer.trim()) {
          const command = procInfo.commandBuffer.trim();

          // 检测是否启动了编辑器（作为备用机制，现在优先使用buffer类型检测）
          if (!procInfo.editorMode && editorCommandRegex.test(command)) {
            procInfo.editorMode = true;
            procInfo.lastEditorCommand = command;
          }
          // 检测是否可能退出了编辑器（作为备用机制，现在优先使用buffer类型检测）
          else if (procInfo.editorMode) {
            // 检查是否是退出命令
            if (editorExitRegex.test(command)) {
              // 为某些编辑器，我们可以立即确认退出（但如果前端使用buffer类型检测，这段代码会被前端通知覆盖）
              if (/^(q|quit|exit|:q|:quit|:wq)$/i.test(command)) {
                procInfo.editorMode = false;
              } else {
                // 对于其他情况，设置一个退出检测标志，下一个命令会确认是否真的退出
                procInfo.possibleEditorExit = true;
              }
            }
            // 如果上一个命令可能是退出，且这个命令不是编辑器命令，则确认已退出
            else if (
              procInfo.possibleEditorExit &&
              !editorCommandRegex.test(command)
            ) {
              procInfo.editorMode = false;
              procInfo.possibleEditorExit = false;
            }
            // 如果收到普通shell命令且不在编辑器命令中，则退出编辑器模式
            else if (
              command.startsWith("$") ||
              command.startsWith(">") ||
              (command.includes(" ") &&
                !/^\s*(w|write|q|quit|exit|ZZ|x|c|change|d|delete|y|yank|p|put|u|undo|r|redo|i|insert|a|append)\s*/.test(
                  command
                ))
            ) {
              procInfo.editorMode = false;
            }
          }
          // 只有不在编辑器模式下才添加到历史记录
          else if (!procInfo.editorMode) {
            // 修改命令记录逻辑，只记录远程命令
            // 对于SSH会话，先标记这个命令，稍后会通过输出提取确认的远程命令
            if (procInfo.isRemote) {
              // 只存储到lastLocalCommand，但不添加到历史记录
              procInfo.lastLocalCommand = command;
            }
            // 移除本地命令记录，不再记录非SSH会话的命令
          }
        }

        // 清空命令缓冲区
        procInfo.commandBuffer = "";
      } else {
        // 累积命令缓冲区
        procInfo.commandBuffer += data;
      }

      // 发送数据到进程
      if (procInfo.type === "ssh2") {
        if (procInfo.stream) {
          // 修改：对于SSH连接，确保使用UTF-8编码写入数据
          if (containsChinese) {
            // 对于包含中文字符的数据，确保使用Buffer写入
            procInfo.stream.write(Buffer.from(processedData, "utf8"));
          } else {
            procInfo.stream.write(processedData);
          }
          return true;
        } else {
          logToFile("SSH2 stream not available", "ERROR");
          return false;
        }
      } else if (typeof procInfo.process.write === "function") {
        procInfo.process.write(processedData);
        return true;
      } else if (procInfo.process.stdin) {
        procInfo.process.stdin.write(processedData);
        return true;
      } else {
        logToFile("Process has no valid write method", "ERROR");
        return false;
      }
    } catch (error) {
      logToFile(`Failed to send data to process: ${error.message}`, "ERROR");
      return false;
    }
  }

  /**
   * 终止进程
   */
  async killProcess(event, processId) {
    const proc = this.processManager.getProcess(processId);
    if (proc && proc.process) {
      try {
        // 清理与此进程相关的待处理SFTP操作
        if (
          this.sftpCore &&
          typeof this.sftpCore.clearPendingOperationsForTab === "function"
        ) {
          this.sftpCore.clearPendingOperationsForTab(processId);
          // 如果是SSH进程，它可能在childProcesses中用config.tabId也存储了
          if (
            proc.config &&
            proc.config.tabId &&
            proc.config.tabId !== processId
          ) {
            this.sftpCore.clearPendingOperationsForTab(proc.config.tabId);
          }
        }

        // 如果是SSH连接，释放连接池中的连接引用
        if (proc.type === "ssh2" && proc.connectionInfo) {
          // 标记为用户主动断开，避免自动重连误触发
          proc.connectionInfo.intentionalClose = true;
          this.connectionManager.releaseSSHConnection(
            proc.connectionInfo.key,
            proc.config?.tabId
          );
          logToFile(`释放SSH连接池引用: ${proc.connectionInfo.key}`, "INFO");

          // 注销延迟检测
          const latencyHandlers = this.getLatencyHandlers?.();
          if (latencyHandlers && proc.config?.tabId) {
            try {
              latencyHandlers.latencyService.unregisterConnection(
                proc.config.tabId
              );
              logToFile(`已注销SSH连接延迟检测: ${proc.config.tabId}`, "DEBUG");
            } catch (latencyError) {
              logToFile(`延迟检测注销失败: ${latencyError.message}`, "WARN");
            }
          }
        }

        // 移除stdout和stderr的监听器，防止在进程被kill后继续触发
        if (proc.process.stdout) {
          proc.process.stdout.removeAllListeners();
        }
        if (proc.process.stderr) {
          proc.process.stderr.removeAllListeners();
        }

        // 对于SSH连接，关闭stream而不是直接kill SSH客户端
        if (proc.type === "ssh2" && proc.stream) {
          try {
            proc.stream.close();
            logToFile(`关闭SSH stream for processId: ${processId}`, "INFO");
          } catch (error) {
            logToFile(
              `Error closing SSH stream ${processId}: ${error.message}`,
              "ERROR"
            );
          }
        } else {
          // 终止其他类型的进程
          try {
            if (typeof proc.process.kill === "function") {
              // 正常终止进程
              proc.process.kill();
            }
          } catch (error) {
            logToFile(
              `Error killing process ${processId}: ${error.message}`,
              "ERROR"
            );
          }
        }

        // 清理进程映射
        this.processManager.deleteProcess(processId);
        if (proc.config?.tabId && proc.config.tabId !== processId) {
          this.processManager.deleteProcess(proc.config.tabId);
        }
      } catch (error) {
        logToFile(`Error handling process kill: ${error.message}`, "ERROR");
      }
    }
  }

  /**
   * 保存连接配置
   */
  async saveConnections(event, connections) {
    const result = configService.saveConnections(connections);

    // 保存成功后,通知所有渲染进程连接配置已更新
    if (result) {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send("connections-changed");
        }
      }
    }

    return result;
  }

  /**
   * 选择密钥文件
   */
  async selectKeyFile() {
    const result = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "SSH Keys", extensions: ["pem", "ppk", "key", "pub", ""] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false, canceled: true };
  }

  /**
   * 执行简单命令
   */
  async executeCommand(command) {
    try {
      // 简单内部命令处理
      if (command === "date") {
        return { output: new Date().toString() };
      } else if (command.startsWith("echo ")) {
        return { output: command.substring(5) };
      } else {
        return { output: `Command not recognized: ${command}` };
      }
    } catch (error) {
      logToFile(`Command error: ${error.message}`, "ERROR");
      return { error: error.message };
    }
  }

  /**
   * 调整终端大小
   */
  async resizeTerminal(event, processId, cols, rows) {
    const procInfo = this.processManager.getProcess(processId);
    if (!procInfo) {
      return false;
    }

    try {
      // 针对不同类型的进程进行不同的处理
      if (procInfo.type === "ssh2" && procInfo.stream) {
        // SSH2连接使用stream.setWindow方法调整大小
        if (typeof procInfo.stream.setWindow === "function") {
          procInfo.stream.setWindow(rows, cols);
          return true;
        }
      } else if (typeof procInfo.process.resize === "function") {
        // node-pty进程使用resize方法
        procInfo.process.resize(cols, rows);
        return true;
      }
      return false;
    } catch (error) {
      logToFile(`Failed to resize terminal: ${error.message}`, "ERROR");
      return false;
    }
  }

  /**
   * 清理终端连接（用于连接刷新）
   */
  async cleanupConnection(event, processId) {
    try {
      if (!processId) {
        logToFile("No processId provided for cleanup", "WARN");
        return { success: false, error: "No processId provided" };
      }

      logToFile(`Cleaning up connection for process ${processId}`, "INFO");

      // 删除子进程映射
      if (this.processManager.hasProcess(processId)) {
        const processObj = this.processManager.getProcess(processId);

        // 关闭SSH连接（如果存在）
        try {
          if (processObj.connectionInfo) {
            processObj.connectionInfo.intentionalClose = true;
          }
          if (
            processObj.client &&
            typeof processObj.client.end === "function"
          ) {
            processObj.client.end();
          }
          if (
            processObj.process &&
            typeof processObj.process.kill === "function"
          ) {
            processObj.process.kill();
          }
        } catch (cleanupError) {
          logToFile(
            `Error during connection cleanup: ${cleanupError.message}`,
            "WARN"
          );
        }

        this.processManager.deleteProcess(processId);

        // 如果有tabId也清理
        if (processObj.config && processObj.config.tabId) {
          this.processManager.deleteProcess(processObj.config.tabId);
        }
      }

      return { success: true };
    } catch (error) {
      logToFile(`Failed to cleanup connection: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取进程信息
   */
  async getProcessInfo(event, processId) {
    const procInfo = this.processManager.getProcess(processId);
    if (!procInfo) {
      return null;
    }

    // 返回安全的进程信息副本，不包含敏感数据和不可序列化的对象
    return {
      type: procInfo.type || null,
      isRemote: procInfo.isRemote || false,
      editorMode: procInfo.editorMode || false,
      // 不返回process、stream等不可序列化的对象
    };
  }

  /**
   * 接收编辑器模式状态变更通知
   */
  async notifyEditorModeChange(event, processId, isEditorMode) {
    const procInfo = this.processManager.getProcess(processId);
    if (!procInfo) {
      return false;
    }

    // 记录状态变更前的值，用于调试
    const previousState = procInfo.editorMode;

    // 更新进程信息中的编辑器模式状态
    procInfo.editorMode = isEditorMode;

    // 仅当状态实际变化时记录详细日志
    if (previousState !== isEditorMode) {
      // 记录更多调试信息
      if (isEditorMode) {
        logToFile(
          `[EDITOR] 进程 ${processId} 进入编辑器模式（通过buffer类型检测）`,
          "DEBUG"
        );
      } else {
        logToFile(
          `[EDITOR] 进程 ${processId} 退出编辑器模式（通过buffer类型检测）`,
          "DEBUG"
        );
      }
    }

    // 如果退出编辑器模式，清除相关标志
    if (!isEditorMode) {
      procInfo.possibleEditorExit = false;
    }

    return true;
  }
}

module.exports = TerminalHandlers;
