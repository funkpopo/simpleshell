export const terminalCache = {};
export const fitAddonCache = {};
export const processCache = {};
export const disposablesCache = {};
// xterm 实例注册表：同步输入分组等模块用于向目标终端打输入通道标记。
// 单一来源，不再暴露到 window（原 window.webTerminalRefs 已移除）。
export const webTerminalRefs = {};
const terminalIOMailboxCache = {};

/**
 * 注册 tab 对应的 xterm 实例（WebTerminal 挂载时调用）。
 */
export const registerTerminalRef = (tabId, term) => {
  if (!tabId || !term) {
    return;
  }
  webTerminalRefs[tabId] = term;
};

/**
 * 注销 tab 对应的 xterm 实例；传入 term 时仅在与当前注册一致时删除，
 * 避免误删后来者（如快速重开同名 tab）。
 */
export const unregisterTerminalRef = (tabId, term) => {
  if (!tabId) {
    return;
  }
  if (!term || webTerminalRefs[tabId] === term) {
    delete webTerminalRefs[tabId];
  }
};

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
  webTerminalRefCount: Object.keys(webTerminalRefs).length,
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

// ------------------ 分屏会话保留（merge / unsplit 不清屏） ------------------
// 合并（标签拖入分屏）与拆分恢复（窗格还原为标签）都会经历
// "旧挂载点卸载 → 新挂载点用同一 sessionKey 重新挂载"。
// 卸载清理默认销毁 xterm/进程缓存，会导致新挂载点重建终端并重连。
// 这里用带 TTL 的保留标记：卸载时若命中标记则跳过销毁，缓存直通新挂载点；
// 若新挂载点最终未出现（异常路径），到期的会话仍会被正常回收。
const PRESERVED_SESSION_TTL_MS = 15000;
const preservedSessionExpiries = new Map();
let preservedSessionSweepTimer = null;

const sweepPreservedSessions = () => {
  const now = Date.now();
  for (const [sessionKey, expiry] of preservedSessionExpiries) {
    if (now >= expiry) {
      preservedSessionExpiries.delete(sessionKey);
      disposeTerminalSession(sessionKey);
    }
  }
  if (preservedSessionExpiries.size > 0) {
    preservedSessionSweepTimer = setTimeout(sweepPreservedSessions, 1000);
  } else {
    preservedSessionSweepTimer = null;
  }
};

/**
 * 标记一组 sessionKey 的会话将被同键重挂载（分屏合并 / 拆分恢复），
 * 卸载清理跳过 dispose；超过 TTL 未被消费则自动释放，避免泄漏。
 */
export const preserveTerminalSessions = (
  sessionKeys,
  ttlMs = PRESERVED_SESSION_TTL_MS,
) => {
  const keys = Array.isArray(sessionKeys) ? sessionKeys : [sessionKeys];
  const now = Date.now();
  let marked = false;
  keys.forEach((key) => {
    if (!key) return;
    preservedSessionExpiries.set(String(key), now + ttlMs);
    marked = true;
  });
  if (marked && !preservedSessionSweepTimer) {
    preservedSessionSweepTimer = setTimeout(sweepPreservedSessions, 1000);
  }
};

/**
 * 消费保留标记：命中返回 true 并移除标记（后续真实卸载仍会正常清理）。
 */
export const consumePreservedSession = (sessionKey) => {
  if (!sessionKey) {
    return false;
  }
  const key = String(sessionKey);
  if (!preservedSessionExpiries.has(key)) {
    return false;
  }
  preservedSessionExpiries.delete(key);
  return true;
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
