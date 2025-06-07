const { logToFile } = require("../../core/utils/logger");
const highlightRules = require("../../constants/highlight-configs"); // New import

// 添加ANSI颜色代码
const ANSI_COLORS = {
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
  // 亮色系列
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
  // 特殊格式
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
};

// 颜色名称到ANSI代码的映射
const COLOR_TO_ANSI = {
  red: ANSI_COLORS.red,
  green: ANSI_COLORS.green,
  blue: ANSI_COLORS.blue,
  yellow: ANSI_COLORS.yellow,
  orange: ANSI_COLORS.yellow,
  cyan: ANSI_COLORS.cyan,
  grey: ANSI_COLORS.brightBlack,
  lightgreen: ANSI_COLORS.brightGreen,
  lightcoral: ANSI_COLORS.brightRed,
  // 处理十六进制颜色，简化为基础ANSI颜色
  "#FF6347": ANSI_COLORS.brightRed, // Tomato
  "#61affe": ANSI_COLORS.brightBlue, // 浅蓝色
  "#49cc90": ANSI_COLORS.brightGreen, // 浅绿色
  "#fca130": ANSI_COLORS.yellow, // 橙色
  "#f93e3e": ANSI_COLORS.red, // 红色
  "#50e3c2": ANSI_COLORS.cyan, // 青色
  "#0d5aa7": ANSI_COLORS.blue, // 深蓝色
  "#A9A9A9": ANSI_COLORS.brightBlack, // 暗灰色
  "#4682B4": ANSI_COLORS.blue, // 钢蓝色 (超链接)
  "#DDA0DD": ANSI_COLORS.magenta, // 梅红色 (文件路径)
  "#98FB98": ANSI_COLORS.green, // 浅绿色 (MAC地址)
  "#20B2AA": ANSI_COLORS.cyan, // 浅海绿色 (环境变量)
  "#FF7F50": ANSI_COLORS.red, // 珊瑚色 (状态码)
  "#F0E68C": ANSI_COLORS.yellow, // 卡其色 (JSON键)
  "#5F9EA0": ANSI_COLORS.cyan, // 军蓝色 (Docker ID)
};

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

  processTerminalOutput(processId, output) {
    try {
      // 获取进程管理器实例
      const processManager = require("./process-manager");
      const procInfo = processManager.getProcessInfo(processId);

      if (!procInfo) {
        return this.applySyntaxHighlighting(output); // 如果没有进程信息，也尝试高亮
      }

      let processedOutput = output;

      // 检测编辑器命令 - 这部分逻辑应该在原始输出上执行，而不是高亮后的输出
      if (this.editorCommandRegex.test(output)) {
        // 使用原始 output
        procInfo.editorMode = true;
        logToFile(`Editor mode activated for process ${processId}`, "INFO");
      }

      // 检测编辑器退出 - 这部分逻辑也应该在原始输出上执行
      if (procInfo.editorMode && this.editorExitRegex.test(output.trim())) {
        // 使用原始 output
        procInfo.editorMode = false;
        logToFile(`Editor mode deactivated for process ${processId}`, "INFO");
      }

      if (procInfo.isRemote) {
        // 对于远程输出，高亮应该在 processRemoteOutput 内部或之后完成
        // 但 processRemoteOutput 返回的是原始 output，并且在内部处理 buffer
        // 为了简化，我们先在高亮前获取远程处理结果
        // 注意：processRemoteOutput 修改 procInfo.outputBuffer 并返回原始 output，
        // 这意味着它主要用于副作用（如命令提取）。实际发送到前端的内容仍是原始 output。
        // 因此，对 `output` 进行高亮是正确的。
        this.processRemoteOutput(processId, output, procInfo); // 这个方法主要更新procInfo, 返回值是原始output
        processedOutput = this.applySyntaxHighlighting(output); // 所以我们高亮原始output
      } else {
        // 对于本地输出，直接高亮
        processedOutput = this.applySyntaxHighlighting(output);
      }

      return processedOutput;
    } catch (error) {
      logToFile(
        `Error processing terminal output for process ${processId}: ${error.message}`,
        "ERROR",
      );
      // 即使发生错误，也尝试高亮原始输出
      return this.applySyntaxHighlighting(output);
    }
  }

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
                // 只有当命令不同且不重复时才记录
                if (command !== procInfo.lastExtractedCommand) {
                  // 添加时间戳记录，用于防止短时间内重复触发
                  const now = Date.now();
                  if (
                    !procInfo.lastExtractedTime ||
                    now - procInfo.lastExtractedTime > 500
                  ) {
                    procInfo.lastExtractedCommand = command;
                    procInfo.lastExtractedTime = now;
                    logToFile(`Extracted remote command: ${command}`, "INFO");
                  }
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

  isEditorMode(processId) {
    const processManager = require("./process-manager");
    const procInfo = processManager.getProcessInfo(processId);
    return procInfo ? procInfo.editorMode : false;
  }

  getLastExtractedCommand(processId) {
    const processManager = require("./process-manager");
    const procInfo = processManager.getProcessInfo(processId);
    return procInfo ? procInfo.lastExtractedCommand : null;
  }

  applySyntaxHighlighting(output) {
    if (!output || typeof output !== "string") {
      return output;
    }
    if (!highlightRules || highlightRules.length === 0) {
      return output;
    }

    let processedOutput = output;

    for (const rule of highlightRules) {
      if (!rule.enabled) {
        continue;
      }

      try {
        if (rule.type === "keyword" && rule.items) {
          const keywords = Object.keys(rule.items);
          if (keywords.length === 0) {
            continue;
          }
          const keywordRegex = new RegExp(
            `\\b(${keywords.join("|")})\\b`,
            "gi",
          );
          processedOutput = processedOutput.replace(keywordRegex, (match) => {
            const lowerMatch = match.toLowerCase();
            if (rule.items.hasOwnProperty(lowerMatch)) {
              const color = rule.items[lowerMatch];
              const ansiColor = COLOR_TO_ANSI[color] || ANSI_COLORS.reset;
              return `${ansiColor}${match}${ANSI_COLORS.reset}`;
            }
            return match;
          });
        } else if (rule.type === "regex" && rule.pattern) {
          const customRegex = new RegExp(rule.pattern, rule.flags || "g");
          if (rule.style) {
            // 从样式中提取颜色
            let ansiColor = ANSI_COLORS.reset;
            let boldFormat = "";

            // 解析样式字符串，提取颜色值
            if (
              typeof rule.style === "string" &&
              rule.style.includes("color:")
            ) {
              const colorMatch = rule.style.match(/color:\s*([^;]+)/);
              if (colorMatch && colorMatch[1]) {
                const cssColor = colorMatch[1].trim();
                ansiColor = COLOR_TO_ANSI[cssColor] || ANSI_COLORS.reset;
              }
            }

            // 检查是否包含font-weight: bold
            if (
              typeof rule.style === "string" &&
              rule.style.includes("font-weight: bold")
            ) {
              boldFormat = ANSI_COLORS.bold;
            }

            // 检查是否包含text-decoration: underline
            if (
              typeof rule.style === "string" &&
              rule.style.includes("text-decoration: underline")
            ) {
              boldFormat += ANSI_COLORS.underline;
            }

            processedOutput = processedOutput.replace(customRegex, (match) => {
              return `${boldFormat}${ansiColor}${match}${ANSI_COLORS.reset}`;
            });
          }
        }
      } catch (e) {
        logToFile(
          `Error applying highlight rule '${rule.id || rule.name || "unknown"}': ${e.message}`,
          "ERROR",
        );
      }
    }
    return processedOutput;
  }
}

// 创建单例实例
const outputProcessor = new OutputProcessor();

module.exports = outputProcessor;
