import { setTerminalWorkingDirectory } from "./workingDirectoryStore.js";

// Do not trim or URL-normalize paths: spaces, percent signs and symlink/..
// components can all be meaningful to the remote filesystem.
export const isAbsoluteRemotePath = (path) =>
  typeof path === "string" &&
  path.startsWith("/") &&
  !path.startsWith("//") &&
  !/[\x00-\x1f\x7f-\x9f]/.test(path);

export const parseWorkingDirectoryOsc = (code, data) => {
  if (typeof data !== "string") return null;
  let path;
  let host = null;
  if (code === 7) {
    const match = /^file:\/\/([^/]*)(\/.*)$/.exec(data);
    if (!match || /[\s@?#\\]/.test(match[1])) return null;
    host = match[1];
    try {
      path = decodeURIComponent(match[2]);
    } catch {
      return null;
    }
  } else if (code === 1337 && data.startsWith("CurrentDir=")) {
    path = data.slice("CurrentDir=".length);
  } else {
    return null;
  }
  return isAbsoluteRemotePath(path) ? { path, host } : null;
};

// Only complete, idle prompts with a full path are usable. In particular,
// `[user@host src]$` cannot tell us which "src" directory is current.
export const parseWorkingDirectoryPrompt = (line, username) => {
  if (typeof line !== "string") return null;
  const plain = line.replace(/^(?:\([^()\r\n]*\)\s*)+/, "");
  const match =
    /^([\w.-]+)@([\w.-]+):((?:\/|~(?:\/|(?=[#$%])))[^\r\n#$%]*?)[#$%]\s*$/.exec(
      plain,
    ) ||
    /^\[([\w.-]+)@([\w.-]+) ((?:\/|~(?:\/|(?=\])))[^\r\n#$%]*?)\][#$%]\s*$/.exec(
      plain,
    );
  if (!match) return null;
  const [, user, host, path] = match;
  // SFTP's home is the login user's home, not the home of a su/sudo user.
  if (path.startsWith("~") && (!username || user !== username)) return null;
  if (!path.startsWith("~") && !isAbsoluteRemotePath(path)) return null;
  if (/[\x00-\x1f\x7f-\x9f]/.test(path)) return null;
  // Bash PROMPT_DIRTRIM and themes may show an abbreviated absolute path.
  if (path.includes("…") || /(?:^|\/)\.\.\.(?:\/|$)/.test(path)) return null;
  return { path, host };
};

const readPromptAtCursor = (term) => {
  const buffer = term.buffer?.active;
  if (!buffer || buffer.type === "alternate") return "";
  const end = (buffer.baseY || 0) + buffer.cursorY;
  let start = end;
  // Bound work even when a program writes an exceptionally long logical line.
  while (start > 0 && end - start < 16 && buffer.getLine(start)?.isWrapped) {
    start -= 1;
  }
  if (buffer.getLine(start)?.isWrapped) return "";
  const parts = [];
  for (let index = start; index <= end; index += 1) {
    const line = buffer.getLine(index);
    // Wide characters can wrap before the last column, leaving a null cell.
    // Trim unused cells without removing real spaces in the directory name.
    let endColumn = term.cols;
    if (index < end && line?.getCell && Number.isFinite(endColumn)) {
      while (endColumn > 0 && line.getCell(endColumn - 1)?.getCode() === 0)
        endColumn -= 1;
    }
    parts.push(line?.translateToString(index === end, 0, endColumn) || "");
  }
  return parts.join("");
};

export const attachWorkingDirectoryTracking = (
  term,
  sessionKey,
  config = {},
) => {
  const disposables = [];
  let hasExplicitDirectory = false;
  let reportedSinceWrite = false;
  let explicitPromptLine = "";
  let foreignHost = false;
  let promptHost = null;
  let oscHost = null;

  const acceptHost = (previous, next) =>
    !previous ||
    !next ||
    previous.toLowerCase() === next.toLowerCase() ||
    (!previous.includes(".") &&
      next.toLowerCase().startsWith(`${previous.toLowerCase()}.`)) ||
    (!next.includes(".") &&
      previous.toLowerCase().startsWith(`${next.toLowerCase()}.`));

  for (const code of [7, 1337]) {
    if (!term.parser?.registerOscHandler) continue;
    disposables.push(
      term.parser.registerOscHandler(code, (data) => {
        const directory = parseWorkingDirectoryOsc(code, data);
        if (!directory || term.buffer?.active?.type === "alternate")
          return false;
        if (
          !acceptHost(oscHost || promptHost, directory.host) ||
          (!directory.host && foreignHost)
        ) {
          foreignHost = true;
          hasExplicitDirectory = false;
          setTerminalWorkingDirectory(sessionKey, null);
          return false;
        }
        foreignHost = false;
        if (directory.host) oscHost = directory.host;
        hasExplicitDirectory = true;
        reportedSinceWrite = true;
        setTerminalWorkingDirectory(sessionKey, directory.path);
        return true;
      }),
    );
  }

  const readPrompt = () => {
    const line = readPromptAtCursor(term);
    const contextHost = line.match(
      /^(?:\([^()\r\n]*\)\s*)*\[?[\w.-]+@([\w.-]+)/,
    )?.[1];
    if (contextHost && !acceptHost(promptHost || oscHost, contextHost)) {
      foreignHost = true;
      hasExplicitDirectory = false;
      reportedSinceWrite = false;
      setTerminalWorkingDirectory(sessionKey, null);
      return;
    }
    if (contextHost) {
      promptHost = contextHost;
      foreignHost = false;
    }
    if (reportedSinceWrite) {
      reportedSinceWrite = false;
      explicitPromptLine = line;
      return;
    }
    if (hasExplicitDirectory && line === explicitPromptLine) return;
    const directory = parseWorkingDirectoryPrompt(line, config.username);
    if (!directory || !acceptHost(promptHost, directory.host)) return;
    hasExplicitDirectory = false;
    promptHost = directory.host;
    setTerminalWorkingDirectory(sessionKey, directory.path);
  };
  if (term.onWriteParsed) disposables.push(term.onWriteParsed(readPrompt));

  return {
    reset() {
      hasExplicitDirectory = false;
      reportedSinceWrite = false;
      explicitPromptLine = "";
      foreignHost = false;
      promptHost = null;
      oscHost = null;
      setTerminalWorkingDirectory(sessionKey, null);
    },
    dispose() {
      disposables.splice(0).forEach((disposable) => disposable?.dispose());
    },
  };
};
