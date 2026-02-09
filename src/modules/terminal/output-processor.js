const { logToFile } = require("../../core/utils/logger");
const highlightRuleConfigs = require("../../constants/highlight-configs"); // New import

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

// 颜色名称到ANSI代码的映射 - 支持新的现代化配色
const COLOR_TO_ANSI = {
  red: ANSI_COLORS.red,
  green: ANSI_COLORS.green,
  blue: ANSI_COLORS.blue,
  yellow: ANSI_COLORS.yellow,
  orange: ANSI_COLORS.yellow,
  cyan: ANSI_COLORS.cyan,
  magenta: ANSI_COLORS.magenta,
  grey: ANSI_COLORS.brightBlack,
  lightgreen: ANSI_COLORS.brightGreen,
  lightcoral: ANSI_COLORS.brightRed,
  // 旧版本十六进制颜色映射（保留兼容性）
  "#FF6347": ANSI_COLORS.brightRed,
  "#61affe": ANSI_COLORS.brightBlue,
  "#49cc90": ANSI_COLORS.brightGreen,
  "#fca130": ANSI_COLORS.yellow,
  "#f93e3e": ANSI_COLORS.red,
  "#50e3c2": ANSI_COLORS.cyan,
  "#0d5aa7": ANSI_COLORS.blue,
  "#4682B4": ANSI_COLORS.blue,
  "#DDA0DD": ANSI_COLORS.magenta,
  "#98FB98": ANSI_COLORS.green,
  "#20B2AA": ANSI_COLORS.cyan,
  "#FF7F50": ANSI_COLORS.red,
  "#F0E68C": ANSI_COLORS.yellow,
  "#5F9EA0": ANSI_COLORS.cyan,
  "#FFD700": ANSI_COLORS.brightYellow,
  // 新的现代化配色映射
  "#ff7b72": ANSI_COLORS.brightRed, // error
  "#d29922": ANSI_COLORS.brightYellow, // warning
  "#3fb950": ANSI_COLORS.brightGreen, // success
  "#58a6ff": ANSI_COLORS.brightBlue, // info
  "#bc8cff": ANSI_COLORS.brightMagenta, // debug
  "#39c5cf": ANSI_COLORS.brightCyan, // ipAddress/envVariable
  "#ffa198": ANSI_COLORS.brightRed, // criticalKeyword
  "#79c0ff": ANSI_COLORS.brightBlue, // commandKeyword/shellCommand
  "#6e7681": ANSI_COLORS.brightBlack, // timestamp (灰色)
  "#56d364": ANSI_COLORS.brightGreen, // macAddress/uuid
  "#e3b341": ANSI_COLORS.brightYellow, // statusCode/portNumber
  "#d2a8ff": ANSI_COLORS.brightMagenta, // filePath
  "#a5d6ff": ANSI_COLORS.brightCyan, // string
};

const resolveAnsiColor = (color) => {
  if (!color) {
    return ANSI_COLORS.reset;
  }
  const normalized = String(color).trim();
  return (
    COLOR_TO_ANSI[normalized] || ANSI_COLORS[normalized] || ANSI_COLORS.reset
  );
};

const escapeRegex = (value = "") =>
  value.replace(/[-/\^$*+?.()|[\]{}]/g, "\$&");

const OSC_SEQUENCE_REGEX = /\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g;
const HOST_HEX_SUFFIX_REGEX = /(@[A-Za-z0-9_.-]+)-([0-9a-f]{6,16})(?=[:#\s])/gi;

const parseStyleToFormat = (style) => {
  let ansiColor = ANSI_COLORS.reset;
  let format = "";

  if (typeof style === "string") {
    const colorMatch = style.match(/color:\s*([^;]+)/i);
    if (colorMatch && colorMatch[1]) {
      ansiColor = resolveAnsiColor(colorMatch[1].trim());
    }

    if (/font-weight:\s*bold/i.test(style)) {
      format += ANSI_COLORS.bold;
    }

    if (/text-decoration:\s*underline/i.test(style)) {
      format += ANSI_COLORS.underline;
    }
  }

  return { ansiColor, format };
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
    this.highlightRules = [];
    this.compiledHighlightRules = [];
    this.updateHighlightRules(highlightRuleConfigs);
  }

  updateHighlightRules(rules = []) {
    this.highlightRules = Array.isArray(rules) ? rules : [];
    this.compiledHighlightRules = this.highlightRules
      .filter((rule) => rule && rule.enabled)
      .map((rule) => this.compileHighlightRule(rule))
      .filter(Boolean);
  }

  compileHighlightRule(rule) {
    if (!rule) {
      return null;
    }

    if (rule.type === "keyword" && rule.items) {
      const keywords = Object.keys(rule.items);
      if (!keywords.length) {
        return null;
      }

      const pattern = `\b(${keywords.map(escapeRegex).join("|")})\b`;
      const regex = new RegExp(pattern, "gi");
      const colorMap = new Map();

      keywords.forEach((keyword) => {
        const colorValue = rule.items[keyword];
        colorMap.set(keyword.toLowerCase(), resolveAnsiColor(colorValue));
      });

      return {
        id: rule.id || rule.name || "keyword-rule",
        type: "keyword",
        regex,
        colorMap,
      };
    }

    if (rule.type === "regex" && rule.pattern) {
      let regex;
      try {
        regex = new RegExp(rule.pattern, rule.flags || "g");
      } catch {
        return null;
      }

      const { ansiColor, format } = parseStyleToFormat(rule.style);

      return {
        id: rule.id || rule.name || "regex-rule",
        type: "regex",
        regex,
        ansiColor,
        format,
        groupIndex:
          Number.isInteger(rule.groupIndex) && rule.groupIndex > 0
            ? rule.groupIndex
            : null,
      };
    }

    return null;
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

    if (!this.compiledHighlightRules.length) {
      return output;
    }

    let processedOutput = output;

    const oscPlaceholders = [];
    processedOutput = processedOutput.replace(OSC_SEQUENCE_REGEX, (match) => {
      const token = `__OSC_PLACEHOLDER_${oscPlaceholders.length}__`;
      const sanitized = match.replace(HOST_HEX_SUFFIX_REGEX, "$1");
      oscPlaceholders.push({ token, value: sanitized });
      return token;
    });

    processedOutput = processedOutput.replace(HOST_HEX_SUFFIX_REGEX, "$1");

    for (const rule of this.compiledHighlightRules) {
      try {
        rule.regex.lastIndex = 0;

        if (rule.type === "keyword") {
          processedOutput = processedOutput.replace(rule.regex, (match) => {
            const color = rule.colorMap.get(match.toLowerCase());
            if (color) {
              return `${color}${match}${ANSI_COLORS.reset}`;
            }
            return match;
          });
        } else if (rule.type === "regex") {
          processedOutput = processedOutput.replace(rule.regex, (...args) => {
            const match = args[0];
            const format = rule.format || "";
            const color = rule.ansiColor || "";

            if (rule.groupIndex && rule.groupIndex > 0) {
              const capturedGroups = args.slice(1, -2);
              const target = capturedGroups[rule.groupIndex - 1];

              if (target) {
                const targetIndex = match.indexOf(target);
                if (targetIndex !== -1) {
                  const before = match.slice(0, targetIndex);
                  const after = match.slice(targetIndex + target.length);
                  return `${before}${format}${color}${target}${ANSI_COLORS.reset}${after}`;
                }
              }
            }

            return `${format}${color}${match}${ANSI_COLORS.reset}`;
          });
        }
      } catch (e) {
        logToFile(
          `Error applying compiled highlight rule '${rule.id}': ${e.message}`,
          "ERROR",
        );
      }
    }

    if (oscPlaceholders.length) {
      for (const { token, value } of oscPlaceholders) {
        processedOutput = processedOutput.replace(token, value);
      }
    }

    return processedOutput;
  }
}

// 创建单例实例
const outputProcessor = new OutputProcessor();

module.exports = outputProcessor;
