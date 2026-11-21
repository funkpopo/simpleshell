const sessions = new Map();
const listeners = new Map();
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

const updateState = (sessionKey, changes) => {
  if (!sessionKey) return;
  const previous = getWorkingDirectoryState(sessionKey);
  const next = { ...previous, ...changes };
  if (next.path === previous.path) return;
  sessions.set(sessionKey, next);
  listeners.get(sessionKey)?.forEach((listener) => listener());
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

export const clearWorkingDirectorySession = (sessionKey) => {
  sessions.delete(sessionKey);
  listeners.get(sessionKey)?.forEach((listener) => listener());
};
