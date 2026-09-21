const sessions = new Map();
const listeners = new Map();
const initialState = Object.freeze({ path: null });

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
