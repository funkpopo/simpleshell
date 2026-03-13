import { debounce } from "../../../core/utils/performance.js";

export const terminalCache = {};
export const fitAddonCache = {};
export const processCache = {};
export const disposablesCache = {};

const terminalGeometryCache = new Map();

const getGeometryKey = (processId, tabId) => {
  if (processId) return `process:${processId}`;
  if (tabId) return `tab:${tabId}`;
  return null;
};

const normalizeGeometry = (cols = 0, rows = 0) => ({
  cols: Math.max(Math.floor(cols) || 1, 1),
  rows: Math.max(Math.floor(rows) || 1, 1),
});

const shouldTransmitGeometry = (processId, tabId, cols, rows) => {
  const key = getGeometryKey(processId, tabId);
  if (!key) {
    return { key: null, cols, rows, changed: false };
  }

  const { cols: normalizedCols, rows: normalizedRows } = normalizeGeometry(
    cols,
    rows,
  );
  const cached = terminalGeometryCache.get(key);
  if (
    cached &&
    cached.cols === normalizedCols &&
    cached.rows === normalizedRows
  ) {
    return { key, cols: normalizedCols, rows: normalizedRows, changed: false };
  }

  terminalGeometryCache.set(key, {
    cols: normalizedCols,
    rows: normalizedRows,
  });
  return { key, cols: normalizedCols, rows: normalizedRows, changed: true };
};

export const clearGeometryFor = (processId, tabId) => {
  const key = getGeometryKey(processId, tabId);
  if (key) {
    terminalGeometryCache.delete(key);
  }
};

export const sendResizeIfNeeded = (processId, tabId, cols, rows) => {
  const {
    key,
    cols: nextCols,
    rows: nextRows,
    changed,
  } = shouldTransmitGeometry(processId, tabId, cols, rows);

  if (!changed || !window.terminalAPI?.resizeTerminal) {
    return Promise.resolve();
  }

  return window.terminalAPI
    .resizeTerminal(processId || tabId, nextCols, nextRows)
    .catch(() => {
      if (key) {
        terminalGeometryCache.delete(key);
      }
    });
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
