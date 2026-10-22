const {
  isSensitiveCommand,
} = require("../../../../shared/security/commandPrivacy");

const PASSWORD_PROMPT_REGEX =
  /(?:password|passphrase|passcode|pin|verification\s*code|密码|口令|验证码)[^\r\n]*[:：?？]\s*$/i;

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
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[\w.-]+)[#$%]\s+(.+)$/,
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

// Prompt recognition is an input aid, not a history reader. A program can
// produce a single logical line spanning the entire scrollback (base64, JSON,
// progress output). Never walk that history on every write, key or repaint.
const MAX_PROMPT_ROWS = 32;
const MAX_PROMPT_CHARS = 4096;

const getLogicalLineUntilCursor = (term) => {
  const buffer = term?.buffer?.active;
  if (!buffer) {
    return "";
  }

  // cursorY is viewport-relative; getLine expects an absolute buffer index.
  const cursorY =
    Math.max(0, Number(buffer.baseY) || 0) +
    Math.max(0, Number(buffer.cursorY) || 0);
  let startY = cursorY;

  while (startY > 0) {
    const currentLine = buffer.getLine(startY);
    if (!currentLine?.isWrapped) {
      break;
    }
    if (cursorY - startY >= MAX_PROMPT_ROWS - 1) return "";
    startY -= 1;
  }

  const parts = [];
  let length = 0;
  for (let lineIndex = startY; lineIndex <= cursorY; lineIndex += 1) {
    const line = buffer.getLine(lineIndex);
    if (!line) {
      continue;
    }
    const text = line.translateToString(true);
    length += text.length;
    if (length > MAX_PROMPT_CHARS) return "";
    parts.push(text);
  }

  return normalizePromptLine(parts.join(""));
};

const isLikelyPromptLine = (line) => {
  const normalized = normalizePromptLine(line);
  if (!normalized || PASSWORD_PROMPT_REGEX.test(normalized)) {
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

// Only server-echoed text after a recognized prompt can become history.
// SSH does not report subsequent remote termios ECHO changes to the client.
// Unknown/custom prompts therefore fail closed instead of using keystrokes.
const getVisibleCommand = (term) => {
  if (term?.buffer?.active?.type === "alternate") return "";
  const line = getLogicalLineUntilCursor(term);
  if (PASSWORD_PROMPT_REGEX.test(line)) return "";
  for (const pattern of TERMINAL_PROMPT_INPUT_PATTERNS) {
    const command = line.match(pattern)?.[1] || "";
    if (command) return isSensitiveCommand(command) ? "" : command;
  }
  return "";
};

module.exports = {
  PASSWORD_PROMPT_REGEX,
  getVisibleCommand,
  TERMINAL_PROMPT_INPUT_PATTERNS,
  getLogicalLineUntilCursor,
  isLikelyPromptLine,
  isPromptReadyFromTerminal,
};
