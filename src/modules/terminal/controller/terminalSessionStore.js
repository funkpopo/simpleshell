import { debounce } from "../../../core/utils/performance.js";

export const terminalCache = {};
export const fitAddonCache = {};
export const processCache = {};
export const disposablesCache = {};
export const terminalIOMailboxCache = {};

export const clearGeometryFor = (processId, tabId) => {
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

export const forceResizeTerminal = debounce(
  (term, container, processId, tabId, fitAddon) => {
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

      if (!term.__webglEnabled && typeof term.refresh === "function") {
        term.refresh(0, term.rows - 1);
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
  },
  100,
);

if (typeof window !== "undefined") {
  window.processCache = processCache;
}
