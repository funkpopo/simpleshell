const { logToFile } = require("../../core/utils/logger");

/**
 * 输出处理器类
 * 负责处理终端输出，包括编辑器检测和命令提取
 */
class OutputProcessor {
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

  /**
   * 处理终端输出
   * @param {number} processId - 进程ID
   * @param {string} output - 原始输出
   * @returns {string} 处理后的输出
   */
  processTerminalOutput(processId, output) {
    try {
      // 获取进程管理器实例
      const processManager = require("./process-manager");
      const procInfo = processManager.getProcessInfo(processId);

      if (!procInfo) {
        return output;
      }

      // 检测编辑器命令
      if (this.editorCommandRegex.test(output)) {
        procInfo.editorMode = true;
        logToFile(`Editor mode activated for process ${processId}`, "INFO");
      }

      // 检测编辑器退出
      if (procInfo.editorMode && this.editorExitRegex.test(output.trim())) {
        procInfo.editorMode = false;
        logToFile(`Editor mode deactivated for process ${processId}`, "INFO");
      }

      // 处理远程SSH会话的命令提取
      if (procInfo.isRemote) {
        return this.processRemoteOutput(processId, output, procInfo);
      }

      return output;
    } catch (error) {
      logToFile(
        `Error processing terminal output for process ${processId}: ${error.message}`,
        "ERROR",
      );
      return output;
    }
  }

  /**
   * 处理远程SSH会话输出
   * @param {number} processId - 进程ID
   * @param {string} output - 原始输出
   * @param {Object} procInfo - 进程信息
   * @returns {string} 处理后的输出
   */
  processRemoteOutput(processId, output, procInfo) {
    // 将当前输出追加到输出缓冲区
    procInfo.outputBuffer += output;

    // 按行分割输出
    const lines = procInfo.outputBuffer.split(/\r?\n/);

    // 保留最后一行（可能不完整）为新的输出缓冲区
    procInfo.outputBuffer = lines.pop() || "";

    // 将完整的行添加到最近输出行
    procInfo.lastOutputLines = [...procInfo.lastOutputLines, ...lines];

    // 限制保存的行数，防止内存过度使用
    if (procInfo.lastOutputLines.length > 50) {
      procInfo.lastOutputLines = procInfo.lastOutputLines.slice(-50);
    }

    // 远程命令提取逻辑
    this.extractRemoteCommands(processId, procInfo);

    return output;
  }

  /**
   * 提取远程命令
   * @param {number} processId - 进程ID
   * @param {Object} procInfo - 进程信息
   */
  extractRemoteCommands(processId, procInfo) {
    // 寻找命令提示符模式，然后提取命令
    const commandPromptRegex = [
      /^.*?[$#>]\s+([^$#>\r\n]+)$/, // 通用提示符后跟命令
      /^.*?@.*?:.*?[$#>]\s+([^$#>\r\n]+)$/, // 带用户名和主机名的提示符后跟命令
      /^.*?:.*?[$#>]\s+([^$#>\r\n]+)$/, // 路径提示符后跟命令
    ];

    // 检查最近几行是否存在命令执行模式
    // 1. 一行是命令输入 (提示符 + 命令)
    // 2. 下面几行是命令输出
    // 3. 最后一行是新的提示符
    if (procInfo.lastOutputLines.length >= 2) {
      for (let i = 0; i < procInfo.lastOutputLines.length - 1; i++) {
        const currentLine = procInfo.lastOutputLines[i];

        // 尝试每个正则表达式来匹配命令
        for (const regex of commandPromptRegex) {
          const match = currentLine.match(regex);
          if (match && match[1] && match[1].trim() !== "") {
            const command = match[1].trim();

            // 跳过明显不是命令的情况
            if (command.startsWith("\x1b") || command.length < 2) {
              continue;
            }

            // 检测下一行是否是新的提示符，表示命令已执行完毕
            let nextLineIsPrompt = false;
            for (let j = i + 1; j < procInfo.lastOutputLines.length; j++) {
              const nextLine = procInfo.lastOutputLines[j];
              if (commandPromptRegex.some((r) => r.test(nextLine))) {
                nextLineIsPrompt = true;
                if (command !== procInfo.lastExtractedCommand) {
                  procInfo.lastExtractedCommand = command;
                  logToFile(`Extracted remote command: ${command}`, "INFO");
                }

                // 清理已处理的行
                procInfo.lastOutputLines.splice(0, i + 1);
                break;
              }
            }

            if (nextLineIsPrompt) break;
          }
        }
      }
    }
  }

  /**
   * 检查是否为编辑器模式
   * @param {number} processId - 进程ID
   * @returns {boolean} 是否为编辑器模式
   */
  isEditorMode(processId) {
    const processManager = require("./process-manager");
    const procInfo = processManager.getProcessInfo(processId);
    return procInfo ? procInfo.editorMode : false;
  }

  /**
   * 获取最后提取的命令
   * @param {number} processId - 进程ID
   * @returns {string} 最后提取的命令
   */
  getLastExtractedCommand(processId) {
    const processManager = require("./process-manager");
    const procInfo = processManager.getProcessInfo(processId);
    return procInfo ? procInfo.lastExtractedCommand : null;
  }
}

// 创建单例实例
const outputProcessor = new OutputProcessor();

module.exports = outputProcessor;
