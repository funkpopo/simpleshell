import {
  getWorkingDirectoryState,
  getTerminalLastCommand,
} from "../../../shared/state/workingDirectoryStore.js";

export const DEFAULT_MAX_LINES = 40;
export const DEFAULT_MAX_CHARS = 4000;
export const REDACTED_PLACEHOLDER = "[REDACTED]";
export const REDACTED_PRIVATE_KEY_PLACEHOLDER = "[REDACTED PRIVATE KEY]";

const MAX_WRAPPED_ROW_CHAIN = 64;

const ANSI_OSC_PATTERN = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI_STRING_TERMINATED_PATTERN = /\x1b[PX^_][\s\S]*?(?:\x07|\x1b\\)/g;
const ANSI_CSI_PATTERN = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g;
const ANSI_CHARSET_AND_TWO_BYTE_PATTERN = /\x1b(?:[()#][A-Za-z0-9]|[@-Z\\-_])/g;
const CONTROL_CHARS_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

const PEM_FULL_BLOCK_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;
const PEM_UNCLOSED_BLOCK_PATTERN =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*/g;
const PEM_END_MARKER_PATTERN = /^-----END [A-Z0-9 ]*PRIVATE KEY-----\s*$/;
const PEM_BASE64_LINE_PATTERN = /^[A-Za-z0-9+/=]{16,}$/;

const AUTH_HEADER_WITH_SCHEME_PATTERN =
  /(\b(?:Authorization|Proxy-Authorization)\s*:\s*(?:Bearer|Basic|Digest|Token|ApiKey)\s+)([^\s'"\r\n]+)/gi;
const AUTH_HEADER_RAW_PATTERN =
  /(\b(?:Authorization|Proxy-Authorization)\s*:\s*)(?!(?:Bearer|Basic|Digest|Token|ApiKey)\b|\[REDACTED\])([^\s'"\r\n]+)/gi;
const EXTRA_SECRET_HEADER_PATTERN =
  /(\b(?:X-Api-Key|X-Auth-Token|X-Access-Token|Api-Key)\s*:\s*)([^\s\r\n]+)/gi;
const BEARER_TOKEN_PATTERN = /\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi;
const URL_CREDENTIALS_PATTERN =
  /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:@'"]+):([^\s/@'"]+)@/g;
const KEY_VALUE_SECRET_PATTERN =
  /((?:["']?)\b(?:password|passwd|passphrase|secret|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|api[_-]?key|apikey|private[_-]?key|client[_-]?secret|aws_secret_access_key|pgpassword|db_password|mysql_pwd)\b(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;'"\r\n]+)/gi;
const CLI_FLAG_SECRET_PATTERN =
  /(--(?:password|passwd|token|secret|api[-_]?key|access[-_]?token)\s+)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi;
const SSHPASS_PATTERN =
  /(\bsshpass\s+-p\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/gi;
const KNOWN_TOKEN_PREFIX_PATTERN =
  /\b(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/g;

/**
 * Strip ANSI/VT escape sequences and non-printable control characters while
 * preserving newlines and tabs.
 * @param {unknown} text
 * @returns {string}
 */
export function stripAnsiSequences(text) {
  if (typeof text !== "string" || !text) {
    return "";
  }
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(ANSI_OSC_PATTERN, "")
    .replace(ANSI_STRING_TERMINATED_PATTERN, "")
    .replace(ANSI_CSI_PATTERN, "")
    .replace(ANSI_CHARSET_AND_TWO_BYTE_PATTERN, "")
    .replace(CONTROL_CHARS_PATTERN, "");
}

function redactOrphanPemEndBlocks(text) {
  if (!text.includes("PRIVATE KEY-----")) {
    return text;
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (PEM_END_MARKER_PATTERN.test(lines[i].trim())) {
      lines[i] = REDACTED_PRIVATE_KEY_PLACEHOLDER;
      let cursor = i - 1;
      while (
        cursor >= 0 &&
        PEM_BASE64_LINE_PATTERN.test(lines[cursor].trim())
      ) {
        lines[cursor] = "";
        cursor -= 1;
      }
    }
  }
  return lines
    .filter((line, index, arr) => {
      if (line !== "") return true;
      const prev = arr[index - 1];
      const next = arr[index + 1];
      return !(
        prev === REDACTED_PRIVATE_KEY_PLACEHOLDER ||
        next === REDACTED_PRIVATE_KEY_PLACEHOLDER
      );
    })
    .join("\n");
}

/**
 * Redact credentials, auth headers, tokens, and PEM private keys from terminal text.
 * @param {unknown} text
 * @returns {string}
 */
export function redactTerminalText(text) {
  if (typeof text !== "string" || !text) {
    return "";
  }

  let redacted = text
    .replace(PEM_FULL_BLOCK_PATTERN, REDACTED_PRIVATE_KEY_PLACEHOLDER)
    .replace(PEM_UNCLOSED_BLOCK_PATTERN, REDACTED_PRIVATE_KEY_PLACEHOLDER);

  redacted = redactOrphanPemEndBlocks(redacted);

  return redacted
    .replace(AUTH_HEADER_WITH_SCHEME_PATTERN, `$1${REDACTED_PLACEHOLDER}`)
    .replace(AUTH_HEADER_RAW_PATTERN, `$1${REDACTED_PLACEHOLDER}`)
    .replace(EXTRA_SECRET_HEADER_PATTERN, `$1${REDACTED_PLACEHOLDER}`)
    .replace(BEARER_TOKEN_PATTERN, `$1 ${REDACTED_PLACEHOLDER}`)
    .replace(URL_CREDENTIALS_PATTERN, `$1:${REDACTED_PLACEHOLDER}@`)
    .replace(KEY_VALUE_SECRET_PATTERN, `$1${REDACTED_PLACEHOLDER}`)
    .replace(CLI_FLAG_SECRET_PATTERN, `$1${REDACTED_PLACEHOLDER}`)
    .replace(SSHPASS_PATTERN, `$1${REDACTED_PLACEHOLDER}`)
    .replace(KNOWN_TOKEN_PREFIX_PATTERN, REDACTED_PLACEHOLDER);
}

function readLogicalLineRange(buffer, startIdx, endIdx, cols) {
  if (startIdx === endIdx) {
    return buffer.getLine(startIdx)?.translateToString?.(true) || "";
  }
  const parts = [];
  for (let i = startIdx; i <= endIdx; i += 1) {
    const line = buffer.getLine(i);
    if (!line || typeof line.translateToString !== "function") {
      continue;
    }
    const isLast = i === endIdx;
    if (
      !isLast &&
      typeof line.getCell === "function" &&
      Number.isFinite(cols)
    ) {
      let endColumn = cols;
      while (endColumn > 0 && line.getCell(endColumn - 1)?.getCode?.() === 0) {
        endColumn -= 1;
      }
      parts.push(line.translateToString(false, 0, endColumn) || "");
    } else {
      parts.push(line.translateToString(isLast) || "");
    }
  }
  return parts.join("");
}

/**
 * Extract bounded trailing logical lines from an xterm Terminal buffer.active.
 * Walks backwards from the end so 500k scrollback buffers remain O(maxLines).
 * @param {object|null} term
 * @param {{ maxLines?: number }} [options]
 * @returns {{ lines: string[], text: string, lineCount: number, truncatedByLines: boolean }}
 */
export function extractTerminalBufferLines(term, options = {}) {
  const maxLines =
    Number.isFinite(options.maxLines) && options.maxLines > 0
      ? Math.floor(options.maxLines)
      : DEFAULT_MAX_LINES;
  const buffer = term?.buffer?.active;
  if (!buffer || typeof buffer.getLine !== "function") {
    return { lines: [], text: "", lineCount: 0, truncatedByLines: false };
  }

  const totalLength = Number.isFinite(buffer.length)
    ? Math.max(0, Math.floor(buffer.length))
    : 0;
  if (totalLength === 0) {
    return { lines: [], text: "", lineCount: 0, truncatedByLines: false };
  }

  const collected = [];
  let idx = totalLength - 1;
  let seenNonEmpty = false;
  let truncatedByLines = false;

  while (idx >= 0) {
    let startIdx = idx;
    let steps = 0;
    let lineAtStart = buffer.getLine(startIdx);
    while (
      startIdx > 0 &&
      steps < MAX_WRAPPED_ROW_CHAIN &&
      lineAtStart?.isWrapped
    ) {
      startIdx -= 1;
      steps += 1;
      lineAtStart = buffer.getLine(startIdx);
    }

    const rawLogicalLine =
      startIdx === idx
        ? lineAtStart?.translateToString?.(true) || ""
        : readLogicalLineRange(buffer, startIdx, idx, term?.cols);
    const cleanedLine = stripAnsiSequences(rawLogicalLine).replace(/\s+$/g, "");

    if (!seenNonEmpty) {
      if (cleanedLine.trim() === "") {
        idx = startIdx - 1;
        continue;
      }
      seenNonEmpty = true;
    }

    if (collected.length >= maxLines) {
      truncatedByLines = true;
      break;
    }

    collected.push(cleanedLine);
    idx = startIdx - 1;
  }

  collected.reverse();
  const text = collected.join("\n");
  return {
    lines: collected,
    text,
    lineCount: collected.length,
    truncatedByLines,
  };
}

function capTrailingChars(text, maxChars) {
  if (!text) {
    return { text: "", lineCount: 0, truncatedByChars: false };
  }
  const limit =
    Number.isFinite(maxChars) && maxChars > 0
      ? Math.floor(maxChars)
      : DEFAULT_MAX_CHARS;
  if (text.length <= limit) {
    return {
      text,
      lineCount: text.split("\n").length,
      truncatedByChars: false,
    };
  }

  const tailSlice = text.slice(text.length - limit);
  const firstNewline = tailSlice.indexOf("\n");
  // Align to the start of the next complete line when possible.
  const bounded =
    firstNewline >= 0 && firstNewline < tailSlice.length - 1
      ? tailSlice.slice(firstNewline + 1)
      : tailSlice;
  return {
    text: bounded,
    lineCount: bounded ? bounded.split("\n").length : 0,
    truncatedByChars: true,
  };
}

/**
 * Extract only non-secret connection metadata.
 * @param {object|null} connectionInfo
 * @returns {{ host: string|null, username: string|null, protocol: string|null, port: number|string|null }}
 */
export function sanitizeSessionMetadata(connectionInfo) {
  if (!connectionInfo || typeof connectionInfo !== "object") {
    return { host: null, username: null, protocol: null, port: null };
  }

  const rawHost =
    typeof connectionInfo.host === "string" ? connectionInfo.host.trim() : "";
  const rawUser =
    typeof connectionInfo.username === "string"
      ? connectionInfo.username.trim()
      : "";
  const rawProtocol =
    typeof connectionInfo.protocol === "string"
      ? connectionInfo.protocol.trim()
      : typeof connectionInfo.type === "string"
        ? connectionInfo.type.trim()
        : "";
  const port =
    Number.isInteger(connectionInfo.port) && connectionInfo.port > 0
      ? connectionInfo.port
      : null;

  return {
    host: rawHost || null,
    username: rawUser || null,
    protocol: rawProtocol ? rawProtocol.toUpperCase() : null,
    port,
  };
}

/**
 * Collect read-only, ANSI-stripped, secret-redacted terminal context for AI chat.
 * @param {object} [params]
 */
export function collectTerminalContext({
  sessionKey = null,
  term = null,
  connectionInfo = null,
  cwd = undefined,
  lastCommand = undefined,
  maxLines = DEFAULT_MAX_LINES,
  maxChars = DEFAULT_MAX_CHARS,
} = {}) {
  const metadata = sanitizeSessionMetadata(connectionInfo);
  const resolvedCwdRaw =
    cwd !== undefined
      ? cwd
      : sessionKey
        ? getWorkingDirectoryState(sessionKey)?.path
        : null;
  const resolvedCwd =
    typeof resolvedCwdRaw === "string" && resolvedCwdRaw.trim()
      ? stripAnsiSequences(resolvedCwdRaw).trim()
      : null;

  const resolvedLastCommandRaw =
    lastCommand !== undefined
      ? lastCommand
      : sessionKey
        ? getTerminalLastCommand(sessionKey)
        : null;
  const resolvedLastCommand =
    typeof resolvedLastCommandRaw === "string" && resolvedLastCommandRaw.trim()
      ? redactTerminalText(stripAnsiSequences(resolvedLastCommandRaw)).trim()
      : null;

  const { text: rawText, truncatedByLines } = extractTerminalBufferLines(term, {
    maxLines,
  });
  const redactedText = redactTerminalText(rawText);
  const {
    text: recentOutput,
    lineCount,
    truncatedByChars,
  } = capTrailingChars(redactedText, maxChars);

  return {
    sessionKey: sessionKey || null,
    host: metadata.host,
    username: metadata.username,
    protocol: metadata.protocol,
    port: metadata.port,
    cwd: resolvedCwd,
    lastCommand: resolvedLastCommand,
    recentOutput,
    lineCount,
    charCount: recentOutput.length,
    truncated: Boolean(truncatedByLines || truncatedByChars),
  };
}
