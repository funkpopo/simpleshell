export const terminalCache = {};
export const fitAddonCache = {};
export const processCache = {};
export const disposablesCache = {};
export const terminalIOMailboxCache = {};

export const clearGeometryFor = (processId, tabId) => {
  void processId;

  const mailbox = terminalIOMailboxCache[tabId];
  if (mailbox?.resetResizeState) {
    mailbox.resetResizeState();
  }
};

export const sendResizeIfNeeded = (
  processId,
  tabId,
  cols,
  rows,
  options = {},
) => {
  const mailbox = terminalIOMailboxCache[tabId];
  if (mailbox?.requestResize) {
    return mailbox.requestResize(cols, rows, options);
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

if (typeof window !== "undefined") {
  window.processCache = processCache;
}
