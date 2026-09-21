const SHELL_PROMPT_PATTERNS = Object.freeze([
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[\w.-]+@[\w.-]+(?::[^\r\n#$%>]*)?)[#$%]\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[~./][^\r\n#$%>]*)[#$%]\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[\w.-]+)[#$%]\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*[#$%]\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*PS [^\r\n>]+>\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*[A-Za-z]:\\[^\r\n>]*>\s*$/,
]);

// 输入行模式统一带捕获组：WebTerminal 通过 match[1] 提取当前命令输入，
// 本模块自身仅用 .test() 判定，捕获组不影响判定结果。
const SHELL_PROMPT_INPUT_PATTERNS = Object.freeze([
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[\w.-]+@[\w.-]+(?::[^\r\n#$%>]*)?)[#$%]\s+(.+)$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[~./][^\r\n#$%>]*)[#$%]\s+(.+)$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*[#$%]\s+(.+)$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*PS [^\r\n>]+>\s+(.+)$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*[A-Za-z]:\\[^\r\n>]*>\s+(.+)$/,
]);

const DATABASE_PROMPT_PATTERNS = Object.freeze([
  /^(?:mysql|sqlite|duckdb)>\s*$/i,
  /^MariaDB \[[^\]\r\n]*\]>\s*$/i,
  /^[^\s\r\n]+(?:=>|=#)\s*$/,
]);

const DATABASE_PROMPT_INPUT_PATTERNS = Object.freeze([
  /^(?:mysql|sqlite|duckdb)>\s+(.+)$/i,
  /^MariaDB \[[^\]\r\n]*\]>\s+(.+)$/i,
  /^[^\s\r\n]+(?:=>|=#)\s+(.+)$/,
]);

// 供 WebTerminal 等消费方使用的完整"提示符 + 输入"模式列表（shell 在前、数据库在后）
const TERMINAL_PROMPT_INPUT_PATTERNS = Object.freeze([
  ...SHELL_PROMPT_INPUT_PATTERNS,
  ...DATABASE_PROMPT_INPUT_PATTERNS,
]);

const CONTINUATION_PROMPT_PATTERNS = Object.freeze([
  /^>\s*$/,
  /^quote>\s*$/i,
  /^dquote>\s*$/i,
  /^heredoc>\s*$/i,
  /^\.\.\.\s*$/,
  /^->\s*$/,
  /^'>\s*$/,
  /^">\s*$/,
  /^`>\s*$/,
  /^[^\s\r\n]+(?:->|-#|'>|">|`>|#>|~>)\s*$/,
]);

const normalizePromptLine = (value = "") =>
  String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+$/g, "");

const getLogicalLineUntilCursor = (term) => {
  const buffer = term?.buffer?.active;
  if (!buffer) {
    return "";
  }

  const cursorY = Math.max(0, Number(buffer.cursorY) || 0);
  let startY = cursorY;

  while (startY > 0) {
    const currentLine = buffer.getLine(startY);
    if (!currentLine?.isWrapped) {
      break;
    }
    startY -= 1;
  }

  const parts = [];
  for (let lineIndex = startY; lineIndex <= cursorY; lineIndex += 1) {
    const line = buffer.getLine(lineIndex);
    if (!line) {
      continue;
    }
    parts.push(line.translateToString(true));
  }

  return normalizePromptLine(parts.join(""));
};

const isLikelyPromptLine = (line) => {
  const normalized = normalizePromptLine(line);
  if (!normalized) {
    return false;
  }

  if (
    CONTINUATION_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized))
  ) {
    return false;
  }

  return (
    SHELL_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    SHELL_PROMPT_INPUT_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    DATABASE_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    DATABASE_PROMPT_INPUT_PATTERNS.some((pattern) => pattern.test(normalized))
  );
};

const isPromptReadyFromTerminal = (term) => {
  if (term?.buffer?.active?.type === "alternate") {
    return false;
  }

  const currentLine = getLogicalLineUntilCursor(term);
  return isLikelyPromptLine(currentLine);
};

module.exports = {
  TERMINAL_PROMPT_INPUT_PATTERNS,
  getLogicalLineUntilCursor,
  isLikelyPromptLine,
  isPromptReadyFromTerminal,
};
