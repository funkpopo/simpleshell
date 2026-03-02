const highlightRuleConfigs = require("../constants/highlight-configs");

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
  brightBlack: "\x1b[90m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightMagenta: "\x1b[95m",
  brightCyan: "\x1b[96m",
  brightWhite: "\x1b[97m",
  bold: "\x1b[1m",
  underline: "\x1b[4m",
};

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
};

const ensureGlobalRegexFlags = (flags = "") => {
  const normalized = typeof flags === "string" ? flags : "";
  return normalized.includes("g") ? normalized : `${normalized}g`;
};

const ANSI_SEQUENCE_REGEX = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const PROMPT_LINE_REGEX =
  /^(.*?(?:[>$#][>$#]?|[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+:[~A-Za-z0-9_./-]*[$#>])\s*)(.*)$/;

const resolveAnsiColor = (color) => {
  if (!color) {
    return ANSI_COLORS.reset;
  }

  const normalized = String(color).trim();
  return (
    COLOR_TO_ANSI[normalized] || ANSI_COLORS[normalized] || ANSI_COLORS.reset
  );
};

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

const compileRule = (rule, order) => {
  if (!rule || rule.enabled !== true) {
    return null;
  }

  const priority = Number.isFinite(Number(rule.priority))
    ? Number(rule.priority)
    : 0;

  if (rule.type === "keyword" && rule.items) {
    const keywords = Object.keys(rule.items);
    if (!keywords.length) {
      return null;
    }

    const escaped = keywords.map((keyword) =>
      String(keyword).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    const regex = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
    const colorMap = new Map();

    keywords.forEach((keyword) => {
      colorMap.set(
        keyword.toLowerCase(),
        resolveAnsiColor(rule.items[keyword]),
      );
    });

    return {
      id: rule.id || `keyword-rule-${order}`,
      type: "keyword",
      regex,
      colorMap,
      format: "",
      ansiColor: "",
      groupIndex: null,
      priority,
      order,
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
      id: rule.id || `regex-rule-${order}`,
      type: "regex",
      regex,
      ansiColor,
      format,
      groupIndex:
        Number.isInteger(rule.groupIndex) && rule.groupIndex > 0
          ? rule.groupIndex
          : null,
      priority,
      order,
    };
  }

  return null;
};

const COMPILED_RULES = (
  Array.isArray(highlightRuleConfigs) ? highlightRuleConfigs : []
)
  .map((rule, index) => compileRule(rule, index))
  .filter(Boolean);

const collectCandidates = (text) => {
  const candidates = [];

  COMPILED_RULES.forEach((rule) => {
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
            continue;
          }
          ansiColor = keywordColor;
        } else if (rule.groupIndex) {
          const targetGroup = match[rule.groupIndex];
          if (!targetGroup) {
            continue;
          }

          const relativeIndex = matchedText.indexOf(targetGroup);
          if (relativeIndex < 0) {
            continue;
          }

          start = match.index + relativeIndex;
          end = start + targetGroup.length;
        }

        if (start < 0 || end <= start || end > text.length) {
          continue;
        }

        const format = rule.format || "";
        if (!format && !ansiColor) {
          continue;
        }

        candidates.push({
          start,
          end,
          priority: rule.priority,
          order: rule.order,
          format,
          ansiColor,
        });
      }
    } catch {
      // ignore single-rule errors in renderer realtime highlighting
    }
  });

  return candidates;
};

const selectRanges = (candidates) => {
  if (!candidates.length) {
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

  const selected = [];
  sorted.forEach((candidate) => {
    const hasOverlap = selected.some(
      (existing) =>
        candidate.start < existing.end && existing.start < candidate.end,
    );

    if (!hasOverlap) {
      selected.push(candidate);
    }
  });

  selected.sort((a, b) => a.start - b.start);
  return selected;
};

const applyRanges = (text, ranges) => {
  if (!ranges.length) {
    return text;
  }

  let cursor = 0;
  let result = "";

  ranges.forEach((range) => {
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
  });

  if (cursor < text.length) {
    result += text.slice(cursor);
  }

  return result;
};

const highlightText = (text) => {
  if (!text) {
    return text;
  }

  const candidates = collectCandidates(text);
  if (!candidates.length) {
    return text;
  }

  const ranges = selectRanges(candidates);
  return applyRanges(text, ranges);
};

const stripAnsi = (text = "") => text.replace(ANSI_SEQUENCE_REGEX, "");

export const highlightPromptInputLine = (lineText) => {
  if (!lineText || typeof lineText !== "string") {
    return null;
  }

  const plainLine = stripAnsi(lineText);
  const promptMatch = plainLine.match(PROMPT_LINE_REGEX);
  if (!promptMatch) {
    return null;
  }

  const promptPart = promptMatch[1] || "";
  const inputPart = promptMatch[2] || "";
  if (!inputPart) {
    return null;
  }

  const highlightedInput = highlightText(inputPart);
  if (highlightedInput === inputPart) {
    return null;
  }

  return {
    plainLine,
    promptPart,
    inputPart,
    highlightedInput,
    renderedLine: `${promptPart}${highlightedInput}`,
  };
};

export default {
  highlightPromptInputLine,
};
