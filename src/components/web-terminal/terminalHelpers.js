/**
 * Pure helpers shared by WebTerminal hooks (prompt tracking, layout, input).
 */

import {
  TERMINAL_PROMPT_INPUT_PATTERNS,
  getLogicalLineUntilCursor,
} from "../../modules/terminal/promptDetection.js";

export const TERMINAL_COMMAND_LINE_REGEX =
  /(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w/.]+[$#>])\s*(.+)$/;

export const FULLSCREEN_COMMAND_REGEX =
  /\b(top|htop|vi|vim|nano|less|more|watch|tail -f)\b/;

// 服务端关闭回显后的密码/口令/密钥短语提示识别
// 匹配示例：Password: / [sudo] password for root: / Enter passphrase for key '...': / 密码: / 验证码：
export const PASSWORD_PROMPT_REGEX =
  /(?:password|passphrase|passcode|pin|verification\s*code|密码|口令|验证码)[^:：\r\n]*[:：]\s*$/i;

export const createPromptTrackingState = () => ({
  promptReady: false,
  commandRunning: false,
});

export const isCursorInsideWrappedInputBlock = (term) => {
  const buffer = term?.buffer?.active;
  if (!buffer) {
    return false;
  }

  const currentLine = buffer.getLine(buffer.cursorY);
  if (currentLine?.isWrapped) {
    return true;
  }

  if (buffer.cursorY <= 0) {
    return false;
  }

  const previousLine = buffer.getLine(buffer.cursorY - 1);
  return previousLine?.isWrapped === true;
};

export const clearPendingWrappedInputRefresh = (term) => {
  if (!term) {
    return;
  }

  term.__pendingWrappedInputRefresh = false;
};

export const extractCurrentCommandInput = (term) => {
  if (!term || term?.buffer?.active?.type === "alternate") {
    return "";
  }

  const logicalLine = getLogicalLineUntilCursor(term);
  for (const pattern of TERMINAL_PROMPT_INPUT_PATTERNS) {
    const match = logicalLine.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  const currentLine =
    term.buffer?.active
      ?.getLine(term.buffer.active.cursorY)
      ?.translateToString() || "";
  const fallbackMatch = currentLine.match(TERMINAL_COMMAND_LINE_REGEX);
  return fallbackMatch?.[1] || "";
};

export const shouldForceTerminalViewportRefresh = (
  term,
  inEditorMode = false,
) => {
  if (!term || inEditorMode || term.buffer?.active?.type === "alternate") {
    return false;
  }

  return term.__pendingWrappedInputRefresh === true;
};

export const getTerminalConfigSignature = (config) => {
  if (!config) return "__NO_CONFIG__";

  return [
    config.id || "",
    config.connectionId || "",
    config.host || "",
    config.port || "",
    config.username || "",
    config.protocol || "ssh",
    config.authType || "",
    config.privateKeyPath || "",
    config.splitReconnect ? "1" : "0",
    config.language || "",
  ].join("|");
};

export const getLocalTerminalConfigSignature = (config) => {
  if (!config) return "__NO_LOCAL_CONFIG__";

  return [
    config.id || "",
    config.tabId || "",
    config.name || "",
    config.type || "",
    config.command || "",
    config.executablePath || "",
    config.executable || "",
    Array.isArray(config.args) ? config.args.join("\u001f") : "",
    Array.isArray(config.launchArgs) ? config.launchArgs.join("\u001f") : "",
    config.cwd || "",
    config.distribution || "",
  ].join("|");
};

export const areWebTerminalPropsEqual = (prevProps, nextProps) => {
  if (prevProps.tabId !== nextProps.tabId) return false;
  if (prevProps.refreshKey !== nextProps.refreshKey) return false;
  if (prevProps.isActive !== nextProps.isActive) return false;
  if (prevProps.terminalType !== nextProps.terminalType) return false;

  return (
    getTerminalConfigSignature(prevProps.sshConfig) ===
      getTerminalConfigSignature(nextProps.sshConfig) &&
    getLocalTerminalConfigSignature(prevProps.localConfig) ===
      getLocalTerminalConfigSignature(nextProps.localConfig)
  );
};
