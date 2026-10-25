const { logToFile } = require("../utils/logger");
const processManager = require("../process/processManager");
const highlightRuleConfigs = require("../../shared/domain/highlight-configs"); // New import

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
  purple: ANSI_COLORS.magenta,
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

const { escapeRegExp: escapeRegex } = require("../utils/textUtils");

const ensureGlobalRegexFlags = (flags = "") => {
  const normalized = typeof flags === "string" ? flags : "";
  return normalized.includes("g") ? normalized : `${normalized}g`;
};

const OSC_SEQUENCE_REGEX = /\u001b\][^]*?(?:\u0007|\u001b\\)/g;
const ANSI_SEQUENCE_REGEX = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const ANSI_SGR_SEQUENCE_REGEX = /^\u001b\[([0-9;]*)m$/;
const STYLE_CLEAR_CODES = new Set([0, 22, 23, 24, 25, 27, 28, 29, 39, 49, 59]);
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
      .map((rule, index) => this.compileHighlightRule(rule, index))
      .filter(Boolean);
  }

  compileHighlightRule(rule, index = 0) {
    if (!rule) {
      return null;
    }

    const priority = Number.isFinite(Number(rule.priority))
      ? Number(rule.priority)
      : this.highlightRules.length - index;

    if (rule.type === "keyword" && rule.items) {
      const keywords = Object.keys(rule.items);
      if (!keywords.length) {
        return null;
      }

      const pattern = `\\b(${keywords.map(escapeRegex).join("|")})\\b`;
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
        format: "",
        ansiColor: "",
        priority,
        order: index,
      };
    }

    if (rule.type === "regex" && rule.pattern) {
      let regex;
      try {
        regex = new RegExp(rule.pattern, ensureGlobalRegexFlags(rule.flags));
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
        priority,
        order: index,
      };
    }

    return null;
  }

  processTerminalOutput(processId, output) {
    try {
      const procInfo = processManager.getProcess(processId);

      if (procInfo) {
        // 编辑器检测在原始输出上执行，而不是高亮后的输出。
        // 仅在状态变化时记录日志：输出中常见 more/cat 等词，大量输出时
        // 每段都写日志会持续占用主进程。
        const wasEditorMode = procInfo.editorMode;
        if (this.editorCommandRegex.test(output)) {
          procInfo.editorMode = true;
        }
        if (procInfo.editorMode && this.editorExitRegex.test(output.trim())) {
          procInfo.editorMode = false;
        }
        if (procInfo.editorMode !== wasEditorMode) {
          logToFile(
            `Editor mode ${procInfo.editorMode ? "activated" : "deactivated"} for process ${processId}`,
            "INFO",
          );
        }
      }

      return this.applySyntaxHighlighting(output);
    } catch (error) {
      logToFile(
        `Error processing terminal output for process ${processId}: ${error.message}`,
        "ERROR",
      );
      // 即使发生错误，也尝试高亮原始输出
      return this.applySyntaxHighlighting(output);
    }
  }

  isEditorMode(processId) {
    const procInfo = processManager.getProcess(processId);
    return procInfo ? procInfo.editorMode : false;
  }

  collectHighlightCandidates(text) {
    if (!text) {
      return [];
    }

    const candidates = [];

    for (const rule of this.compiledHighlightRules) {
      try {
        rule.regex.lastIndex = 0;

        let match = null;
        while ((match = rule.regex.exec(text)) !== null) {
          const matchedText = match[0];

          if (!matchedText) {
            rule.regex.lastIndex += 1;
            continue;
          }

          let start = match.index;
          let end = start + matchedText.length;
          let ansiColor = rule.ansiColor || "";

          if (rule.type === "keyword") {
            const keywordColor = rule.colorMap.get(matchedText.toLowerCase());
            if (!keywordColor) {
              if (!rule.regex.global) {
                break;
              }
              continue;
            }
            ansiColor = keywordColor;
          } else if (rule.groupIndex) {
            const targetGroup = match[rule.groupIndex];
            if (!targetGroup) {
              if (!rule.regex.global) {
                break;
              }
              continue;
            }

            const relativeIndex = matchedText.indexOf(targetGroup);
            if (relativeIndex < 0) {
              if (!rule.regex.global) {
                break;
              }
              continue;
            }

            start = match.index + relativeIndex;
            end = start + targetGroup.length;
          }

          if (start < 0 || end <= start || end > text.length) {
            if (!rule.regex.global) {
              break;
            }
            continue;
          }

          const format = rule.format || "";
          if (!format && !ansiColor) {
            if (!rule.regex.global) {
              break;
            }
            continue;
          }

          candidates.push({
            start,
            end,
            priority: rule.priority || 0,
            order: rule.order || 0,
            format,
            ansiColor,
          });

          if (!rule.regex.global) {
            break;
          }
        }
      } catch (e) {
        logToFile(
          `Error collecting highlight matches for rule '${rule.id}': ${e.message}`,
          "ERROR",
        );
      }
    }

    return candidates;
  }

  selectStableHighlightRanges(candidates) {
    if (!Array.isArray(candidates) || !candidates.length) {
      return [];
    }

    const sorted = [...candidates].sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }

      const aLength = a.end - a.start;
      const bLength = b.end - b.start;
      if (aLength !== bLength) {
        return bLength - aLength;
      }

      if (a.order !== b.order) {
        return a.order - b.order;
      }

      return a.start - b.start;
    });

    // selected 始终按 start 有序且互不重叠，二分定位后只需检查相邻两个区间。
    // 日志类输出每段可有上千个候选，逐个比较全部已选区间是 O(n²)，
    // 会在主进程上阻塞大量输出。
    const selected = [];

    for (const candidate of sorted) {
      let low = 0;
      let high = selected.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (selected[mid].start < candidate.start) {
          low = mid + 1;
        } else {
          high = mid;
        }
      }

      const previous = selected[low - 1];
      const next = selected[low];
      if (
        (previous && previous.end > candidate.start) ||
        (next && next.start < candidate.end)
      ) {
        continue;
      }

      selected.splice(low, 0, candidate);
    }

    return selected;
  }

  applyHighlightRanges(text, ranges) {
    if (!text || !Array.isArray(ranges) || !ranges.length) {
      return text;
    }

    let result = "";
    let cursor = 0;

    for (const range of ranges) {
      if (range.start > cursor) {
        result += text.slice(cursor, range.start);
      }

      const prefix = `${range.format || ""}${range.ansiColor || ""}`;
      if (!prefix) {
        result += text.slice(range.start, range.end);
      } else {
        result += `${prefix}${text.slice(range.start, range.end)}${ANSI_COLORS.reset}`;
      }

      cursor = range.end;
    }

    if (cursor < text.length) {
      result += text.slice(cursor);
    }

    return result;
  }

  highlightPlainTextSegment(text) {
    if (!text) {
      return text;
    }

    const candidates = this.collectHighlightCandidates(text);
    if (!candidates.length) {
      return text;
    }

    const ranges = this.selectStableHighlightRanges(candidates);
    if (!ranges.length) {
      return text;
    }

    return this.applyHighlightRanges(text, ranges);
  }

  applyHighlightWithAnsiIsolation(output) {
    if (!output) {
      return output;
    }

    const segments = [];
    let lastIndex = 0;
    let ansiStyleActive = false;

    ANSI_SEQUENCE_REGEX.lastIndex = 0;
    let match = null;
    while ((match = ANSI_SEQUENCE_REGEX.exec(output)) !== null) {
      if (match.index > lastIndex) {
        const textSegment = output.slice(lastIndex, match.index);
        segments.push(
          ansiStyleActive
            ? textSegment
            : this.highlightPlainTextSegment(textSegment),
        );
      }

      const ansiSequence = match[0];
      segments.push(ansiSequence);

      const sgrMatch = ansiSequence.match(ANSI_SGR_SEQUENCE_REGEX);
      if (sgrMatch) {
        const rawCodes = sgrMatch[1];
        if (!rawCodes) {
          ansiStyleActive = false;
        } else {
          const codes = rawCodes
            .split(";")
            .map((code) => Number(code))
            .filter(Number.isFinite);

          if (
            !codes.length ||
            codes.every((code) => STYLE_CLEAR_CODES.has(code))
          ) {
            ansiStyleActive = false;
          } else {
            ansiStyleActive = true;
          }
        }
      }

      lastIndex = ANSI_SEQUENCE_REGEX.lastIndex;
    }

    if (lastIndex < output.length) {
      const remainingSegment = output.slice(lastIndex);
      segments.push(
        ansiStyleActive
          ? remainingSegment
          : this.highlightPlainTextSegment(remainingSegment),
      );
    }

    return segments.join("");
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
    processedOutput = this.applyHighlightWithAnsiIsolation(processedOutput);

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
