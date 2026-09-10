/**
 * 分屏终端（PaneGrid）共享工具。
 *
 * 会话键约定（见 docs/split-terminal-phase0-audit.md）：
 * - 根窗格沿用 tabId 作为 sessionKey（拆分时无需迁移既有进程/缓存）；
 * - 新建窗格使用 `${tabId}::p{n}` 虚拟会话键；
 * - 从其他标签页拖入的窗格沿用其原 tabId（adoptedFromTab），
 *   避免触碰主进程的连接别名（childProcesses / 连接池 tab 引用）。
 */

export const MAX_PANES = 4;

/**
 * 从 sessionKey 解析宿主 tabId（窗格键格式 `${tabId}::p{n}`；普通 tabId 原样返回）。
 */
export const getParentTabId = (sessionKey) => {
  const value = String(sessionKey ?? "");
  const separatorIndex = value.indexOf("::");
  return separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
};

/**
 * 为指定 tab 生成下一个可用的虚拟窗格键（跳过已占用编号）。
 */
export const createPaneId = (tabId, existingPaneIds = []) => {
  const used = new Set(
    (Array.isArray(existingPaneIds) ? existingPaneIds : []).map((id) => {
      const value = String(id);
      const separatorIndex = value.indexOf("::p");
      if (separatorIndex < 0) return -1;
      const parsed = Number.parseInt(value.slice(separatorIndex + 3), 10);
      return Number.isFinite(parsed) ? parsed : -1;
    }),
  );
  let next = 2;
  while (used.has(next)) {
    next += 1;
  }
  return `${tabId}::p${next}`;
};

/**
 * 布局方向对应的窗格数量目标（row/column = 2 窗格，grid = 4 窗格）。
 */
export const getTargetPaneCount = (direction) =>
  direction === "grid" ? MAX_PANES : 2;

/**
 * clamp 百分比，保证分隔条拖拽不会把窗格挤没。
 */
export const clampRatio = (value, min = 15, max = 85) =>
  Math.min(max, Math.max(min, value));
