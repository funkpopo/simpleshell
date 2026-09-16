import { describe, it, expect } from "vitest";
import {
  MAX_PANES,
  getParentTabId,
  getFocusedSessionKey,
  isSessionFileManagerOpen,
  getSessionDescriptor,
  getLiveSessionKeys,
  getSessionFileManagerProps,
  retainLiveSessionEntries,
  getSinglePaneLayout,
  addPaneToLayout,
  removePaneFromLayout,
  createPaneId,
  getTargetPaneCount,
  clampRatio,
} from "../../src/modules/terminal/paneLayout.js";

const makeState = (overrides = {}) => ({
  tabs: [
    { id: "tab-1", label: "Tab 1" },
    { id: "tab-2", label: "Tab 2" },
  ],
  currentTab: 0,
  splitLayouts: {},
  panes: {},
  terminalInstances: {},
  fileManagerOpenByTabId: {},
  ...overrides,
});

describe("getParentTabId", () => {
  it("独立标签的宿主就是自身 sessionKey", () => {
    expect(getParentTabId("tab-1", {})).toBe("tab-1");
  });

  it("虚拟窗格返回注册的宿主 tabId", () => {
    const panes = { "tab-1::p2": { parentTabId: "tab-1" } };
    expect(getParentTabId("tab-1::p2", panes)).toBe("tab-1");
  });
});

describe("getFocusedSessionKey", () => {
  it("欢迎页返回 null", () => {
    expect(
      getFocusedSessionKey(
        makeState({
          tabs: [{ id: "welcome" }],
          currentTab: 0,
        }),
      ),
    ).toBeNull();
  });

  it("分屏标签返回 focusedPaneId，普通标签返回 tabId", () => {
    expect(
      getFocusedSessionKey(
        makeState({
          splitLayouts: { "tab-1": { focusedPaneId: "tab-1::p3" } },
        }),
      ),
    ).toBe("tab-1::p3");
    expect(getFocusedSessionKey(makeState())).toBe("tab-1");
  });
});

describe("isSessionFileManagerOpen", () => {
  it("仅 SSH 会话且宿主标签开启时为 true", () => {
    const state = makeState({ fileManagerOpenByTabId: { "tab-1": true } });
    const sshSession = { type: "ssh", parentTabId: "tab-1" };
    expect(isSessionFileManagerOpen(state, sshSession)).toBe(true);

    const localSession = { type: "powershell", parentTabId: "tab-1" };
    expect(isSessionFileManagerOpen(state, localSession)).toBe(false);
  });
});

describe("getSessionDescriptor", () => {
  it("welcome 键与未知键返回 null", () => {
    expect(getSessionDescriptor(makeState(), "welcome")).toBeNull();
    expect(getSessionDescriptor(makeState(), "missing")).toBeNull();
  });

  it("根标签会话携带连接配置与状态", () => {
    const state = makeState({
      terminalInstances: {
        "tab-1-config": { host: "example.com", port: 22 },
        "tab-1-processId": 4321,
      },
    });
    const descriptor = getSessionDescriptor(state, "tab-1", {
      "tab-1": "connected",
    });
    expect(descriptor.sessionKey).toBe("tab-1");
    expect(descriptor.parentTabId).toBe("tab-1");
    expect(descriptor.config.host).toBe("example.com");
    expect(descriptor.status).toBe("connected");
    expect(descriptor.processId).toBe(4321);
  });

  it("虚拟窗格会话宿主归属正确", () => {
    const state = makeState({
      panes: {
        "tab-1::p2": {
          tab: { id: "tab-2", label: "Tab 2" },
          parentTabId: "tab-1",
        },
      },
    });
    const descriptor = getSessionDescriptor(state, "tab-1::p2");
    expect(descriptor.id).toBe("tab-2");
    expect(descriptor.parentTabId).toBe("tab-1");
  });
});

describe("getLiveSessionKeys", () => {
  it("聚合每个标签的窗格键并排除欢迎页", () => {
    const tabs = [{ id: "welcome" }, { id: "tab-1" }, { id: "tab-2" }];
    const layouts = {
      "tab-1": { panes: ["tab-1", "tab-1::p2"] },
      "tab-2": {},
    };
    expect(getLiveSessionKeys(tabs, layouts)).toEqual([
      "tab-1",
      "tab-1::p2",
      "tab-2",
    ]);
  });
});

describe("getSessionFileManagerProps", () => {
  it("SSH 会话透传配置、初始路径与导航历史", () => {
    const session = {
      sessionKey: "tab-1",
      label: "dev",
      type: "ssh",
      config: { host: "h" },
    };
    const props = getSessionFileManagerProps(
      session,
      { "tab-1": "/var/log" },
      { "tab-1": { stack: [] } },
    );
    expect(props).toEqual({
      tabId: "tab-1",
      tabName: "dev",
      sshConnection: { host: "h" },
      initialPath: "/var/log",
      navigationState: { stack: [] },
    });
  });

  it("空会话与缺省路径兜底", () => {
    expect(getSessionFileManagerProps(null, {}, {})).toEqual({
      tabId: null,
      tabName: null,
      sshConnection: null,
      initialPath: "/",
      navigationState: null,
    });
  });
});

describe("retainLiveSessionEntries", () => {
  it("过滤已销毁会话的条目", () => {
    const entries = { "tab-1": 1, "tab-1::p2": 2, stale: 3 };
    expect(
      retainLiveSessionEntries(entries, new Set(["tab-1", "tab-1::p2"])),
    ).toEqual({ "tab-1": 1, "tab-1::p2": 2 });
  });

  it("无变化时返回原引用（避免无谓渲染）", () => {
    const entries = { a: 1 };
    expect(retainLiveSessionEntries(entries, new Set(["a"]))).toBe(entries);
  });
});

describe("getSinglePaneLayout", () => {
  it("生成单窗格布局并聚焦自身", () => {
    expect(getSinglePaneLayout("tab-1")).toEqual({
      direction: "row",
      panes: ["tab-1"],
      ratios: [50, 50],
      focusedPaneId: "tab-1",
    });
  });
});

describe("addPaneToLayout", () => {
  const single = getSinglePaneLayout("tab-1");

  it("左右分屏为 row，上下分屏为 column", () => {
    expect(addPaneToLayout(single, "tab-1::p2", "right").pairDirection).toBe(
      "row",
    );
    expect(addPaneToLayout(single, "tab-1::p2", "bottom").pairDirection).toBe(
      "column",
    );
  });

  it("left/right 区分插入位置且新窗格获得焦点", () => {
    const left = addPaneToLayout(single, "tab-1::p2", "left");
    expect(left.panes).toEqual(["tab-1::p2", "tab-1"]);
    expect(left.focusedPaneId).toBe("tab-1::p2");

    const right = addPaneToLayout(single, "tab-1::p2", "right");
    expect(right.panes).toEqual(["tab-1", "tab-1::p2"]);
  });

  it("超过两窗格后升级为 grid 布局", () => {
    const two = addPaneToLayout(single, "tab-1::p2", "right");
    const three = addPaneToLayout(two, "tab-1::p3", "bottom");
    expect(three.direction).toBe("grid");
    expect(three.panes).toHaveLength(3);
  });

  it("column 分屏插入时保留既有比例数组", () => {
    const columnLayout = {
      ...single,
      direction: "column",
      pairDirection: "column",
      ratios: [70],
    };
    const result = addPaneToLayout(columnLayout, "tab-1::p2", "bottom");
    expect(result.ratios).toEqual([70]);
  });
});

describe("removePaneFromLayout", () => {
  it("移除聚焦窗格后焦点回落到首个剩余窗格", () => {
    const two = addPaneToLayout(
      getSinglePaneLayout("tab-1"),
      "tab-1::p2",
      "right",
    );
    const after = removePaneFromLayout(two, "tab-1::p2");
    expect(after.panes).toEqual(["tab-1"]);
    expect(after.focusedPaneId).toBe("tab-1");
  });

  it("从 grid 退回两窗格时按方向索引恢复比例", () => {
    const grid = {
      panes: ["a", "b", "c"],
      direction: "grid",
      pairDirection: "column",
      ratios: [30, 40, 30],
      focusedPaneId: "c",
    };
    const after = removePaneFromLayout(grid, "c");
    expect(after.direction).toBe("column");
    expect(after.ratios).toEqual([40, 50]);
  });
});

describe("createPaneId", () => {
  it("从 2 号开始编号并跳过已占用编号", () => {
    expect(createPaneId("tab-1")).toBe("tab-1::p2");
    expect(createPaneId("tab-1", ["tab-1::p2"])).toBe("tab-1::p3");
    expect(createPaneId("tab-1", ["tab-1::p2", "tab-1::p3", "tab-1::p5"])).toBe(
      "tab-1::p4",
    );
  });

  it("忽略非法窗格键", () => {
    expect(createPaneId("tab-1", ["tab-1", "not-a-pane", null])).toBe(
      "tab-1::p2",
    );
  });
});

describe("getTargetPaneCount / clampRatio / MAX_PANES", () => {
  it("row/column 目标 2 窗格，grid 目标 4 窗格", () => {
    expect(getTargetPaneCount("row")).toBe(2);
    expect(getTargetPaneCount("column")).toBe(2);
    expect(getTargetPaneCount("grid")).toBe(MAX_PANES);
    expect(MAX_PANES).toBe(4);
  });

  it("clampRatio 限制在安全范围内", () => {
    expect(clampRatio(5)).toBe(15);
    expect(clampRatio(50)).toBe(50);
    expect(clampRatio(95)).toBe(85);
    expect(clampRatio(10, 20, 80)).toBe(20);
  });
});
