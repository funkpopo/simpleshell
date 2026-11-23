const sessions = new Map();
const listeners = new Map();
const lastCommands = new Map();
const contextProviders = new Map();
const contextListeners = new Map();
const pendingContextAttach = new Set();
const initialState = Object.freeze({ path: null });

// Do not trim or URL-normalize paths: spaces, percent signs and symlink/..
// components can all be meaningful to the remote filesystem.
export const isAbsoluteRemotePath = (path) =>
  typeof path === "string" &&
  path.startsWith("/") &&
  !path.startsWith("//") &&
  !/[\x00-\x1f\x7f-\x9f]/.test(path);

export const getWorkingDirectoryState = (sessionKey) =>
  sessions.get(sessionKey) || initialState;

const notifyContextListeners = (sessionKey) => {
  if (!sessionKey) return;
  contextListeners.get(sessionKey)?.forEach((listener) => listener());
};

const updateState = (sessionKey, changes) => {
  if (!sessionKey) return;
  const previous = getWorkingDirectoryState(sessionKey);
  const next = { ...previous, ...changes };
  if (next.path === previous.path) return;
  sessions.set(sessionKey, next);
  listeners.get(sessionKey)?.forEach((listener) => listener());
  notifyContextListeners(sessionKey);
};

export const setTerminalWorkingDirectory = (sessionKey, path) =>
  updateState(sessionKey, { path });

export const subscribeWorkingDirectory = (sessionKey, listener) => {
  if (!listeners.has(sessionKey)) listeners.set(sessionKey, new Set());
  const subscriptions = listeners.get(sessionKey);
  subscriptions.add(listener);
  return () => {
    subscriptions.delete(listener);
    if (!subscriptions.size) listeners.delete(sessionKey);
  };
};

export const setTerminalLastCommand = (sessionKey, command) => {
  if (!sessionKey) return;
  const normalized =
    typeof command === "string" && command.trim() ? command.trim() : null;
  const previous = lastCommands.get(sessionKey) ?? null;
  if (previous === normalized) return;
  if (normalized) {
    lastCommands.set(sessionKey, normalized);
  } else {
    lastCommands.delete(sessionKey);
  }
  notifyContextListeners(sessionKey);
};

export const getTerminalLastCommand = (sessionKey) =>
  sessionKey ? (lastCommands.get(sessionKey) ?? null) : null;

export const registerTerminalContextProvider = (sessionKey, provider) => {
  if (!sessionKey || typeof provider !== "function") {
    return () => {};
  }
  contextProviders.set(sessionKey, provider);
  notifyContextListeners(sessionKey);
  return () => {
    if (contextProviders.get(sessionKey) === provider) {
      contextProviders.delete(sessionKey);
      notifyContextListeners(sessionKey);
    }
  };
};

export const readTerminalContext = (sessionKey, options = {}) => {
  if (!sessionKey || sessionKey === "welcome") {
    return null;
  }
  const provider = contextProviders.get(sessionKey);
  if (typeof provider === "function") {
    return provider(options) || null;
  }
  const cwd = getWorkingDirectoryState(sessionKey)?.path ?? null;
  const lastCommand = getTerminalLastCommand(sessionKey);
  if (!cwd && !lastCommand) {
    return null;
  }
  return {
    sessionKey,
    cwd,
    lastCommand,
    recentOutput: "",
    lineCount: 0,
    charCount: 0,
    truncated: false,
  };
};

export const subscribeTerminalContext = (sessionKey, listener) => {
  if (!sessionKey || typeof listener !== "function") {
    return () => {};
  }
  if (!contextListeners.has(sessionKey)) {
    contextListeners.set(sessionKey, new Set());
  }
  const subscriptions = contextListeners.get(sessionKey);
  subscriptions.add(listener);
  return () => {
    subscriptions.delete(listener);
    if (!subscriptions.size) {
      contextListeners.delete(sessionKey);
    }
  };
};

export const requestTerminalContextAttach = (sessionKey) => {
  if (!sessionKey || sessionKey === "welcome") return;
  pendingContextAttach.add(sessionKey);
  notifyContextListeners(sessionKey);
};

export const consumeTerminalContextAttachRequest = (sessionKey) => {
  if (!sessionKey) return false;
  return pendingContextAttach.delete(sessionKey);
};

export const clearWorkingDirectorySession = (sessionKey) => {
  sessions.delete(sessionKey);
  lastCommands.delete(sessionKey);
  contextProviders.delete(sessionKey);
  pendingContextAttach.delete(sessionKey);
  listeners.get(sessionKey)?.forEach((listener) => listener());
  notifyContextListeners(sessionKey);
};
