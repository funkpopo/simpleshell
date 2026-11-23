/**
 * 分屏终端（PaneGrid）共享工具。
 *
 * 会话键约定（见 docs/split-terminal-phase0-audit.md）：
 * - 根窗格沿用 tabId 作为 sessionKey（拆分时无需迁移既有进程/缓存）；
 * - 新建窗格使用 `${tabId}::p{n}` 虚拟会话键；
 * - 从其他标签页拖入的窗格沿用其原 tabId（adoptedFromTab），
 *   避免触碰主进程的连接别名（childProcesses / 连接池 tab 引用）。
 */

import { getSessionConnectionInfo } from "../../../shared/lib/sessionConnectionInfo.js";

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

export { getSessionConnectionInfo };

// 所有会话入口共享此描述；配置、协议和进程绝不借用宿主会话。
export const getSessionDescriptor = (
  state,
  sessionKey,
  statuses = {},
  processes = {},
) => {
  if (!sessionKey || sessionKey === "welcome") return null;
  const pane = state.panes[sessionKey];
  const tab =
    pane?.tab ??
    (pane
      ? {
          id: sessionKey,
          type: pane.type || "ssh",
          label: pane.label || sessionKey,
        }
      : state.tabs.find((item) => item.id === sessionKey));
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
 * 窗格比例下限/上限（百分比）。拖拽另受 MIN_PANE_SIZE_PX 像素下限约束
 * （见 PaneGrid.jsx），小容器下以像素下限换算的百分比为准。
 */
export const MIN_PANE_RATIO = 15;
export const MAX_PANE_RATIO = 85;

/**
 * clamp 百分比，保证分隔条拖拽不会把窗格挤没。
 */
export const clampRatio = (value, min = MIN_PANE_RATIO, max = MAX_PANE_RATIO) =>
  Math.min(max, Math.max(min, value));

const SPLIT_DIRECTION_TO_ZONE = {
  row: "right",
  horizontal: "right",
  right: "right",
  left: "left",
  column: "bottom",
  vertical: "bottom",
  bottom: "bottom",
  top: "top",
};

const FOCUS_DIRECTION_MAP = {
  left: "left",
  arrowleft: "left",
  right: "right",
  arrowright: "right",
  up: "up",
  arrowup: "up",
  down: "down",
  arrowdown: "down",
};

export const normalizeSplitZone = (direction = "right") => {
  const key = String(direction || "right")
    .trim()
    .toLowerCase();
  return SPLIT_DIRECTION_TO_ZONE[key] || "right";
};

export const normalizeFocusDirection = (direction) => {
  const key = String(direction || "")
    .trim()
    .toLowerCase();
  return FOCUS_DIRECTION_MAP[key] || null;
};

export const canSplitLayout = (layout) =>
  (layout?.panes?.length ?? 1) < MAX_PANES;

/**
 * 在现有布局或单窗格基础上按方向拆分新窗格，严格受 MAX_PANES=4 约束。
 */
export const splitPaneInLayout = (
  layout,
  tabId,
  newPaneId,
  direction = "right",
) => {
  if (!tabId || !newPaneId) return layout;
  const base = layout?.panes?.length ? layout : getSinglePaneLayout(tabId);
  if (base.panes.length >= MAX_PANES || base.panes.includes(newPaneId)) {
    return base;
  }
  const zone = normalizeSplitZone(direction);
  return addPaneToLayout(base, newPaneId, zone);
};

/**
 * 计算与 PaneGrid.jsx 一致的归一化矩形几何（0..100 坐标系）。
 */
export const getPaneGeometries = (layout) => {
  const panes = Array.isArray(layout?.panes) ? layout.panes : [];
  if (panes.length === 0) return [];
  if (panes.length === 1) {
    return [
      {
        paneId: panes[0],
        index: 0,
        x0: 0,
        x1: 100,
        y0: 0,
        y1: 100,
        cx: 50,
        cy: 50,
      },
    ];
  }

  const ratios = Array.isArray(layout.ratios) ? layout.ratios : [50, 50];
  const colSplit = clampRatio(Number.isFinite(ratios[0]) ? ratios[0] : 50);
  const grid = layout.direction === "grid";
  const rowSplit = clampRatio(
    Number.isFinite(ratios[grid ? 1 : 0]) ? ratios[grid ? 1 : 0] : 50,
  );

  if (layout.direction === "row" && panes.length === 2) {
    return [
      {
        paneId: panes[0],
        index: 0,
        x0: 0,
        x1: colSplit,
        y0: 0,
        y1: 100,
        cx: colSplit / 2,
        cy: 50,
      },
      {
        paneId: panes[1],
        index: 1,
        x0: colSplit,
        x1: 100,
        y0: 0,
        y1: 100,
        cx: (colSplit + 100) / 2,
        cy: 50,
      },
    ];
  }

  if (layout.direction === "column" && panes.length === 2) {
    return [
      {
        paneId: panes[0],
        index: 0,
        x0: 0,
        x1: 100,
        y0: 0,
        y1: rowSplit,
        cx: 50,
        cy: rowSplit / 2,
      },
      {
        paneId: panes[1],
        index: 1,
        x0: 0,
        x1: 100,
        y0: rowSplit,
        y1: 100,
        cx: 50,
        cy: (rowSplit + 100) / 2,
      },
    ];
  }

  // grid (3 or 4 panes) — mirrors PaneGrid.jsx placement
  return panes.map((paneId, index) => {
    const isBottomFull = panes.length === 3 && index === 2;
    const x0 = isBottomFull ? 0 : index % 2 === 0 ? 0 : colSplit;
    const x1 = isBottomFull ? 100 : index % 2 === 0 ? colSplit : 100;
    const y0 = index < 2 ? 0 : rowSplit;
    const y1 = index < 2 ? rowSplit : 100;
    return {
      paneId,
      index,
      x0,
      x1,
      y0,
      y1,
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
    };
  });
};

/**
 * 基于几何重叠和最近边界查找指定方向上的相邻窗格 ID。
 */
export const getAdjacentPaneId = (layout, direction) => {
  const dir = normalizeFocusDirection(direction);
  if (!dir || !layout?.panes || layout.panes.length <= 1) {
    return null;
  }
  const geometries = getPaneGeometries(layout);
  const focusedId = layout.focusedPaneId || layout.panes[0];
  const current =
    geometries.find((item) => item.paneId === focusedId) || geometries[0];
  if (!current) return null;

  const EPS = 0.001;
  const candidates = [];

  for (const cand of geometries) {
    if (cand.paneId === current.paneId) continue;

    if (dir === "right" || dir === "left") {
      const overlap =
        Math.min(current.y1, cand.y1) - Math.max(current.y0, cand.y0);
      if (overlap <= EPS) continue;
      const gap = dir === "right" ? cand.x0 - current.x1 : current.x0 - cand.x1;
      if (gap < -EPS) continue;
      candidates.push({
        paneId: cand.paneId,
        index: cand.index,
        primaryDist: Math.max(0, gap),
        secondaryDist: Math.abs(cand.cy - current.cy),
      });
    } else {
      const overlap =
        Math.min(current.x1, cand.x1) - Math.max(current.x0, cand.x0);
      if (overlap <= EPS) continue;
      const gap = dir === "down" ? cand.y0 - current.y1 : current.y0 - cand.y1;
      if (gap < -EPS) continue;
      candidates.push({
        paneId: cand.paneId,
        index: cand.index,
        primaryDist: Math.max(0, gap),
        secondaryDist: Math.abs(cand.cx - current.cx),
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      a.primaryDist - b.primaryDist ||
      a.secondaryDist - b.secondaryDist ||
      a.index - b.index,
  );
  return candidates[0].paneId;
};

/**
 * 返回切换焦点到相邻几何窗格后的新布局对象；若无相邻窗格则原样返回。
 */
export const focusAdjacentPane = (layout, direction) => {
  const nextPaneId = getAdjacentPaneId(layout, direction);
  if (!nextPaneId || nextPaneId === layout?.focusedPaneId) {
    return layout;
  }
  return {
    ...layout,
    focusedPaneId: nextPaneId,
  };
};
