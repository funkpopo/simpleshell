export const terminalCache = {};
export const fitAddonCache = {};
export const processCache = {};
export const disposablesCache = {};
const terminalIOMailboxCache = {};

const disposeResource = (resource) => {
  if (!resource || typeof resource.dispose !== "function") {
    return;
  }

  try {
    resource.dispose();
  } catch {
    // Cleanup is best-effort and must remain idempotent.
  }
};

const detachWebglHandlers = (terminal) => {
  const handlers = terminal?.__webglHandlers;
  if (!handlers) {
    return;
  }

  if (handlers.restoreTimer) {
    clearTimeout(handlers.restoreTimer);
  }
  if (handlers.canvas && handlers.onContextLost) {
    handlers.canvas.removeEventListener(
      "webglcontextlost",
      handlers.onContextLost,
      false,
    );
  }
  if (handlers.canvas && handlers.onContextRestored) {
    handlers.canvas.removeEventListener(
      "webglcontextrestored",
      handlers.onContextRestored,
      false,
    );
  }

  terminal.__webglHandlers = null;
};

export const getTerminalSessionDiagnostics = () => ({
  terminalCount: Object.keys(terminalCache).length,
  fitAddonCount: Object.keys(fitAddonCache).length,
  processCount: Object.keys(processCache).length,
  disposablesCount: Object.keys(disposablesCache).length,
  mailboxCount: Object.keys(terminalIOMailboxCache).length,
  terminalIds: Object.keys(terminalCache),
});

/**
 * Release every renderer-side resource owned by a terminal tab.
 *
 * Cache entries are removed before disposal so late connection promises can
 * detect that the session is gone and cannot rebind listeners to a closed tab.
 * The function is intentionally idempotent because both the close action and
 * the React unmount cleanup call it.
 */
export const disposeTerminalSession = (tabId) => {
  if (!tabId) {
    return false;
  }

  const terminal = terminalCache[tabId];
  const fitAddon = fitAddonCache[tabId];
  const disposables = disposablesCache[tabId];
  const mailbox = terminalIOMailboxCache[tabId];
  const hadResources = Boolean(
    terminal ||
    fitAddon ||
    processCache[tabId] ||
    mailbox ||
    (Array.isArray(disposables) && disposables.length > 0),
  );

  delete terminalCache[tabId];
  delete fitAddonCache[tabId];
  delete processCache[tabId];
  delete disposablesCache[tabId];
  delete terminalIOMailboxCache[tabId];

  if (mailbox && typeof mailbox.destroy === "function") {
    try {
      mailbox.destroy();
    } catch {
      // Cleanup continues even if a mailbox implementation throws.
    }
  }

  if (Array.isArray(disposables)) {
    disposables.forEach(disposeResource);
    disposables.length = 0;
  }

  if (terminal) {
    detachWebglHandlers(terminal);
    disposeResource(terminal.__webglAddon);
    terminal.__webglAddon = null;
    terminal.__webglEnabled = false;
    disposeResource(terminal.__simpleShellOsc133Disposable);
    delete terminal.__simpleShellOsc133Disposable;
    disposeResource(terminal);
  } else {
    // Normally xterm owns and disposes FitAddon. This branch covers a partial
    // initialization where the addon reached its cache before the terminal.
    disposeResource(fitAddon);
  }

  if (process.env.NODE_ENV === "development") {
    console.assert(
      !terminalCache[tabId] &&
        !fitAddonCache[tabId] &&
        !processCache[tabId] &&
        !disposablesCache[tabId] &&
        !terminalIOMailboxCache[tabId],
      `[WebTerminal] terminal session cache cleanup failed for tabId=${tabId}`,
      getTerminalSessionDiagnostics(),
    );
  }

  return hadResources;
};

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
