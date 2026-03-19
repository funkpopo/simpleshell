const PASSIVE_PROMPT_PATTERNS = Object.freeze([
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[\w.-]+@[\w.-]+(?::[^\r\n#$%>]*)?)[#$%]\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[~./][^\r\n#$%>]*)[#$%]\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[\w.-]+)[#$%]\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*[#$%]\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*PS [^\r\n>]+>\s*$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*[A-Za-z]:\\[^\r\n>]*>\s*$/,
]);

const PASSIVE_PROMPT_INPUT_PATTERNS = Object.freeze([
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[\w.-]+@[\w.-]+(?::[^\r\n#$%>]*)?)[#$%]\s+.+$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*(?:[~./][^\r\n#$%>]*)[#$%]\s+.+$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*[#$%]\s+.+$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*PS [^\r\n>]+>\s+.+$/,
  /^(?:\([^()\r\n]*\)\s*)*(?:\[[^\]\r\n]*\]\s*)*[A-Za-z]:\\[^\r\n>]*>\s+.+$/,
]);

const CONTINUATION_PROMPT_PATTERNS = Object.freeze([
  /^>\s*$/,
  /^quote>\s*$/i,
  /^dquote>\s*$/i,
  /^heredoc>\s*$/i,
  /^\.\.\.\s*$/,
]);

const normalizePromptLine = (value = "") =>
  String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\s+$/g, "");

export const getLogicalLineUntilCursor = (term) => {
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

export const isLikelyPromptLine = (line) => {
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
    PASSIVE_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    PASSIVE_PROMPT_INPUT_PATTERNS.some((pattern) => pattern.test(normalized))
  );
};

export const isPromptReadyFromTerminal = (term) => {
  if (term?.buffer?.active?.type === "alternate") {
    return false;
  }

  const currentLine = getLogicalLineUntilCursor(term);
  return isLikelyPromptLine(currentLine);
};

export default {
  getLogicalLineUntilCursor,
  isLikelyPromptLine,
  isPromptReadyFromTerminal,
};
