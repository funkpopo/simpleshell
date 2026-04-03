export const terminalCache = {};
export const fitAddonCache = {};
export const processCache = {};
export const disposablesCache = {};
export const terminalIOMailboxCache = {};
const pendingForceResizeTimers = new Map();

const getTabResizeTimerKey = (tabId) =>
  tabId !== undefined && tabId !== null && tabId !== "" ? `tab:${tabId}` : null;

const getProcessResizeTimerKey = (processId) =>
  processId !== undefined && processId !== null && processId !== ""
    ? `process:${processId}`
    : null;

const clearPendingForceResize = (...keys) => {
  keys.forEach((key) => {
    if (key === null || key === undefined || key === "") {
      return;
    }

    const timerId = pendingForceResizeTimers.get(key);
    if (timerId !== undefined) {
      clearTimeout(timerId);
      pendingForceResizeTimers.delete(key);
    }
  });
};

export const clearGeometryFor = (processId, tabId) => {
  clearPendingForceResize(
    getTabResizeTimerKey(tabId),
    getProcessResizeTimerKey(processId),
  );

  const mailbox = terminalIOMailboxCache[tabId];
  if (mailbox?.resetResizeState) {
    mailbox.resetResizeState();
  }
};

export const sendResizeIfNeeded = (processId, tabId, cols, rows) => {
  const mailbox = terminalIOMailboxCache[tabId];
  if (mailbox?.requestResize) {
    return mailbox.requestResize(cols, rows);
  }

  if (!window.terminalAPI?.resizeTerminal) {
    return Promise.resolve();
  }

  return window.terminalAPI
    .resizeTerminal(processId || tabId, cols, rows)
    .catch(() => {});
};

export const registerTerminalIOMailbox = (tabId, mailbox) => {
  if (!tabId || !mailbox) {
    return;
  }

  terminalIOMailboxCache[tabId] = mailbox;
};

export const unregisterTerminalIOMailbox = (tabId, mailbox) => {
  if (!tabId) {
    return;
  }

  if (!mailbox || terminalIOMailboxCache[tabId] === mailbox) {
    delete terminalIOMailboxCache[tabId];
  }
};

export const forceResizeTerminal = (
  term,
  container,
  processId,
  tabId,
  fitAddon,
) => {
  const resizeKey =
    getTabResizeTimerKey(tabId) || getProcessResizeTimerKey(processId) || term;

  clearPendingForceResize(resizeKey);

  const timerId = setTimeout(() => {
    pendingForceResizeTimers.delete(resizeKey);

    try {
      if (!container || !term || !fitAddon) {
        return;
      }

      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }

      if (term.element) {
        const targetWidth = `${rect.width}px`;
        const targetHeight = `${rect.height}px`;

        if (term.element.style.width !== targetWidth) {
          term.element.style.width = targetWidth;
        }
        if (term.element.style.height !== targetHeight) {
          term.element.style.height = targetHeight;
        }

        term.element.getBoundingClientRect();
      }

      fitAddon.fit();

      // 标签切换时多个终端会并发触发 resize；fit 后强制 repaint
      // 可以避免 renderer 虽已拿到正确尺寸但仍停留在空白帧。
      if (typeof term.refresh === "function") {
        term.refresh(0, Math.max(term.rows - 1, 0));
      }

      const cols = term.cols;
      const rows = term.rows;
      const resolvedProcessId = processId || processCache[tabId];

      if (resolvedProcessId) {
        sendResizeIfNeeded(resolvedProcessId, tabId, cols, rows);
      }
    } catch {
      // Error in forceResizeTerminal
    }
  }, 100);

  pendingForceResizeTimers.set(resizeKey, timerId);
};

if (typeof window !== "undefined") {
  window.processCache = processCache;
}
