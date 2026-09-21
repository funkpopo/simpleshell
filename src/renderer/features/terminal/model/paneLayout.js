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
 * 通过窗格注册表查找宿主；独立标签的 sessionKey 就是其宿主 ID。
 */
export const getParentTabId = (sessionKey, panes) =>
  panes[sessionKey]?.parentTabId ?? sessionKey;

export const getFocusedSessionKey = (state) => {
  const tab = state.tabs[state.currentTab];
  if (!tab || tab.id === "welcome") return null;
  return state.splitLayouts[tab.id]?.focusedPaneId ?? tab.id;
};

// 面板是否展开属于宿主标签；面板内容、路径和操作目标属于聚焦会话。
export const isSessionFileManagerOpen = (state, session) =>
  session?.type === "ssh" &&
  Boolean(state.fileManagerOpenByTabId[session.parentTabId]);

export const getSessionConnectionInfo = (session) =>
  session
    ? {
        sessionKey: session.sessionKey,
        host: session.config?.host ?? session.label,
        port: session.config?.port,
        username: session.config?.username,
        type: session.type.toUpperCase(),
      }
    : null;

// 所有会话入口共享此描述；配置、协议和进程绝不借用宿主会话。
export const getSessionDescriptor = (
  state,
  sessionKey,
  statuses = {},
  processes = {},
) => {
  if (!sessionKey || sessionKey === "welcome") return null;
  const pane = state.panes[sessionKey];
  const tab = pane?.tab ?? state.tabs.find((item) => item.id === sessionKey);
  if (!tab) return null;
  return {
    ...tab,
    sessionKey,
    parentTabId: getParentTabId(sessionKey, state.panes),
    config: state.terminalInstances[`${sessionKey}-config`],
    status: statuses[sessionKey],
    processId:
      processes[sessionKey] ??
      state.terminalInstances[`${sessionKey}-processId`] ??
      null,
  };
};

export const getLiveSessionKeys = (tabs, layouts) =>
  tabs.flatMap((tab) =>
    tab.id === "welcome" ? [] : (layouts[tab.id]?.panes ?? [tab.id]),
  );

export const getSessionFileManagerProps = (session, paths, histories) => ({
  tabId: session?.sessionKey ?? null,
  tabName: session?.label ?? null,
  sshConnection: session?.type === "ssh" ? session.config : null,
  initialPath: paths[session?.sessionKey] ?? "/",
  navigationState: histories[session?.sessionKey] ?? null,
});

export const retainLiveSessionEntries = (entries, liveKeys) => {
  const remaining = Object.entries(entries).filter(([key]) =>
    liveKeys.has(key),
  );
  return remaining.length === Object.keys(entries).length
    ? entries
    : Object.fromEntries(remaining);
};

export const getSinglePaneLayout = (sessionKey) => ({
  direction: "row",
  panes: [sessionKey],
  ratios: [50, 50],
  focusedPaneId: sessionKey,
});

export const addPaneToLayout = (layout, paneId, zone) => {
  const panes = [...layout.panes];
  const pairDirection =
    panes.length === 1
      ? zone === "top" || zone === "bottom"
        ? "column"
        : "row"
      : (layout.pairDirection ?? layout.direction);
  if (zone === "left" || zone === "top") panes.unshift(paneId);
  else if (zone === "right" && panes.length >= 2) panes.splice(1, 0, paneId);
  else panes.push(paneId);
  return {
    ...layout,
    panes,
    pairDirection,
    direction: panes.length > 2 ? "grid" : pairDirection,
    ratios:
      layout.panes.length === 2 && pairDirection === "column"
        ? [50, layout.ratios[0]]
        : [...layout.ratios],
    focusedPaneId: paneId,
  };
};

export const removePaneFromLayout = (layout, paneId) => {
  const panes = layout.panes.filter((id) => id !== paneId);
  const pairDirection = layout.pairDirection ?? layout.direction;
  return {
    ...layout,
    panes,
    direction: panes.length > 2 ? "grid" : pairDirection,
    ratios:
      panes.length === 2 && layout.direction === "grid"
        ? [layout.ratios[pairDirection === "column" ? 1 : 0], 50]
        : layout.ratios,
    focusedPaneId:
      layout.focusedPaneId === paneId ? panes[0] : layout.focusedPaneId,
  };
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
