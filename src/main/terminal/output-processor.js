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
const STYLE_CLEAR_CODES = new Set([0, 22, 23, 24, 25, 27, 28, 29, 39, 49, 59]);
const SAFE_DIGIT_ACCUMULATION = 15;

/**
 * 解析 SGR 序列（ESC [ 数字/分号 m）后的样式状态，不分配中间数组。
 * 语义与 split(";").map(Number).filter(isFinite) 一致：空字段为 0，溢出字段忽略；
 * 任一有效参数不属于清除类即视为样式生效。非 SGR 序列返回 null（状态不变）。
 * @param {string} sequence
 * @returns {boolean|null}
 */
const resolveSgrStyleActive = (sequence) => {
  const lastIndex = sequence.length - 1;
  if (
    lastIndex < 2 ||
    sequence.charCodeAt(1) !== 91 ||
    sequence.charCodeAt(lastIndex) !== 109
  ) {
    return null;
  }

  let active = false;
  let value = 0;
  let fieldStart = 2;
  for (let index = 2; index <= lastIndex; index += 1) {
    // 结尾的 "m" 视为最后一个字段的分隔符
    const code = index === lastIndex ? 59 : sequence.charCodeAt(index);
    if (code >= 48 && code <= 57) {
      value = value * 10 + (code - 48);
      continue;
    }
    if (code !== 59) {
      return null;
    }
    if (index - fieldStart > SAFE_DIGIT_ACCUMULATION) {
      // 超长字段按 Number() 取值，保证与原实现的溢出判定完全一致
      value = Number(sequence.slice(fieldStart, index));
    }
    if (Number.isFinite(value) && !STYLE_CLEAR_CODES.has(value)) {
      active = true;
    }
    value = 0;
    fieldStart = index + 1;
  }
  return active;
};
const HOST_HEX_SUFFIX_REGEX = /(@[A-Za-z0-9_.-]+)-([0-9a-f]{6,16})(?=[:#\s])/gi;

// 规则预筛（requires）：多数规则在普通输出中很少命中，却要在每个位置尝试匹配；
// ANSI 序列之间的大量短片段也会让每条规则都执行一次。单次字符扫描计算各规则的
// 必要条件（十六进制串形态、是否出现某些字符），不满足时跳过正则，结果与直接匹配一致。
// 预筛可引用的字符；不在表内的字符会让该条件失效（规则照常执行），保证安全
const TRACKED_CHARS = '.:-"~/\\=$';
const CHAR_BIT = new Uint16Array(128);
for (let index = 0; index < TRACKED_CHARS.length; index += 1) {
  CHAR_BIT[TRACKED_CHARS.charCodeAt(index)] = 1 << index;
}
const DIGIT_BIT = 1 << TRACKED_CHARS.length;
const NON_WHITESPACE_REGEX = /\S/;

// 字符分类表：一次查表决定分支，普通字母/空白走最短路径
const CLASS_OTHER = 0;
const CLASS_HEX_LETTER = 1;
const CLASS_DIGIT = 2;
const CLASS_COLON = 3;
const CLASS_DASH = 4;
const CLASS_TRACKED = 5;
const CHAR_CLASS = new Uint8Array(128);
for (const ch of "abcdefABCDEF") {
  CHAR_CLASS[ch.charCodeAt(0)] = CLASS_HEX_LETTER;
}
for (const ch of "0123456789") {
  CHAR_CLASS[ch.charCodeAt(0)] = CLASS_DIGIT;
}
for (let index = 0; index < TRACKED_CHARS.length; index += 1) {
  CHAR_CLASS[TRACKED_CHARS.charCodeAt(index)] = CLASS_TRACKED;
}
CHAR_CLASS[58] = CLASS_COLON;
CHAR_CLASS[45] = CLASS_DASH;
const EQUALS = 61;
const UNDERSCORE = 95;

const scanRuleFeatures = (text) => {
  let run = 0;
  let maxHexRun = 0;
  let maxHexRunBeforeDash = 0;
  let charMask = 0;
  // 连续 "h{1,4}:" 组数；首组的十六进制可以是更长串的后缀
  let groupChain = 0;
  let maxGroupChain = 0;
  // 连续 "hh[:-]" 组数（MAC 地址）；首组同样可以是更长串的后缀
  let macChain = 0;
  let maxMacChain = 0;
  let hasDoubleColon = false;
  let hasUpperAssign = false;
  let previousWasColon = false;
  const length = text.length;

  for (let index = 0; index < length; index += 1) {
    const code = text.charCodeAt(index);
    const charClass = code < 128 ? CHAR_CLASS[code] : CLASS_OTHER;
    if (charClass === CLASS_HEX_LETTER) {
      run += 1;
      previousWasColon = false;
      continue;
    }
    if (charClass === CLASS_DIGIT) {
      charMask |= DIGIT_BIT;
      run += 1;
      previousWasColon = false;
      continue;
    }

    if (run > maxHexRun) {
      maxHexRun = run;
    }

    if (charClass === CLASS_COLON || charClass === CLASS_DASH) {
      charMask |= CHAR_BIT[code];
      if (run >= 2) {
        macChain = run === 2 && macChain > 0 ? macChain + 1 : 1;
        if (macChain > maxMacChain) {
          maxMacChain = macChain;
        }
      } else {
        macChain = 0;
      }

      if (charClass === CLASS_COLON) {
        if (previousWasColon) {
          hasDoubleColon = true;
        }
        if (run > 0) {
          groupChain = run <= 4 && groupChain > 0 ? groupChain + 1 : 1;
          if (groupChain > maxGroupChain) {
            maxGroupChain = groupChain;
          }
        } else {
          groupChain = 0;
        }
        previousWasColon = true;
      } else {
        if (run > maxHexRunBeforeDash) {
          maxHexRunBeforeDash = run;
        }
        groupChain = 0;
        previousWasColon = false;
      }
    } else {
      if (charClass === CLASS_TRACKED) {
        charMask |= CHAR_BIT[code];
        if (code === EQUALS && !hasUpperAssign && index > 0) {
          // 环境变量赋值 [A-Z_][A-Z0-9_]*= ：只在遇到 "=" 时回看一个字符
          const previous = text.charCodeAt(index - 1);
          hasUpperAssign =
            (previous >= 65 && previous <= 90) ||
            (previous >= 48 && previous <= 57) ||
            previous === UNDERSCORE;
        }
      }
      macChain = 0;
      groupChain = 0;
      previousWasColon = false;
    }
    run = 0;
  }

  if (run > maxHexRun) {
    maxHexRun = run;
  }

  return {
    maxHexRun,
    maxHexRunBeforeDash,
    charMask,
    ipv6Shape: hasDoubleColon || maxGroupChain >= 6,
    macShape: maxMacChain >= 5,
    upperAssign: hasUpperAssign,
  };
};

const toCharMask = (chars) => {
  if (typeof chars !== "string" || !chars) {
    return 0;
  }
  let mask = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const code = chars.charCodeAt(index);
    const bit = code < 128 ? CHAR_BIT[code] : 0;
    if (!bit) {
      // 未跟踪的字符无法判断，放弃此条件
      return 0;
    }
    mask |= bit;
  }
  return mask;
};

/**
 * 预编译 requires：
 * - hexRun / hexRunBeforeDash：最长十六进制串（其后紧跟 "-"）长度下限
 * - ipv6Shape / macShape：地址形态
 * - upperAssign：出现 "=" 且其前一字符为 [A-Z0-9_]（区分大小写的环境变量赋值）
 * - anyChar：至少出现其中一个字符；digit：至少出现一个数字
 */
const compileRuleRequirements = (requires) => {
  if (!requires || typeof requires !== "object") {
    return null;
  }
  const compiled = {
    hexRun: Number(requires.hexRun) || 0,
    hexRunBeforeDash: Number(requires.hexRunBeforeDash) || 0,
    ipv6Shape: requires.ipv6Shape === true,
    macShape: requires.macShape === true,
    upperAssign: requires.upperAssign === true,
    anyCharMask: toCharMask(requires.anyChar),
    digit: requires.digit === true,
  };
  const hasCondition =
    compiled.hexRun ||
    compiled.hexRunBeforeDash ||
    compiled.ipv6Shape ||
    compiled.macShape ||
    compiled.upperAssign ||
    compiled.anyCharMask ||
    compiled.digit;
  return hasCondition ? compiled : null;
};

const meetsRuleRequirements = (requires, features) =>
  features.maxHexRun >= requires.hexRun &&
  features.maxHexRunBeforeDash >= requires.hexRunBeforeDash &&
  (!requires.ipv6Shape || features.ipv6Shape) &&
  (!requires.macShape || features.macShape) &&
  (!requires.upperAssign || features.upperAssign) &&
  (!requires.anyCharMask || (features.charMask & requires.anyCharMask) !== 0) &&
  (!requires.digit || (features.charMask & DIGIT_BIT) !== 0);

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
        requires: compileRuleRequirements(rule.requires),
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
    let features = null;

    for (const rule of this.compiledHighlightRules) {
      if (rule.requires) {
        features ??= scanRuleFeatures(text);
        if (!meetsRuleRequirements(rule.requires, features)) {
          continue;
        }
      }
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

    // 只有相互重叠的候选才需要按优先级取舍；互不重叠的区间簇彼此独立。
    // 候选按规则依次收集、规则内按起点有序，TimSort 按起点排序接近线性；
    // 孤立候选直接保留，只对重叠簇执行优先级贪心，结果与全局贪心一致。
    const byStart = [...candidates].sort((a, b) => a.start - b.start);
    const selected = [];
    let cluster = [byStart[0]];
    let clusterEnd = byStart[0].end;
    const flushCluster = () => {
      if (cluster.length === 1) {
        selected.push(cluster[0]);
        return;
      }
      for (const range of this.selectGreedyHighlightRanges(cluster)) {
        selected.push(range);
      }
    };

    for (let index = 1; index < byStart.length; index += 1) {
      const candidate = byStart[index];
      if (candidate.start < clusterEnd) {
        cluster.push(candidate);
        if (candidate.end > clusterEnd) {
          clusterEnd = candidate.end;
        }
        continue;
      }
      flushCluster();
      cluster = [candidate];
      clusterEnd = candidate.end;
    }
    flushCluster();

    return selected;
  }

  selectGreedyHighlightRanges(candidates) {
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
    // 纯空白片段（ANSI 序列之间的空格、换行）不可能命中任何规则
    if (!text || !NON_WHITESPACE_REGEX.test(text)) {
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

      const sgrStyleActive = resolveSgrStyleActive(ansiSequence);
      if (sgrStyleActive !== null) {
        ansiStyleActive = sgrStyleActive;
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
