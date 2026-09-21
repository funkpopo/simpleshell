import { describe, it, expect } from "vitest";
import {
  appReducer,
  actions,
  initialState,
} from "../../src/renderer/app/state/appReducer.js";

const sshTab = (id, label = id) => ({
  id,
  label,
  type: "ssh",
  config: { host: `${id}.example.com`, port: 22, username: "root" },
});

const stateWithTabs = (...ids) => ({
  ...initialState,
  tabs: ids.map((id) => sshTab(id)),
  currentTab: 0,
});

describe("tab 管理", () => {
  it("addTab 追加标签，removeTab 按索引删除", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    expect(state.tabs.map((t) => t.id)).toEqual(["welcome", "tab-1"]);

    state = appReducer(state, actions.addTab(sshTab("tab-2")));
    state = appReducer(state, actions.removeTab(1));
    expect(state.tabs.map((t) => t.id)).toEqual(["welcome", "tab-2"]);
  });

  it("setCurrentTab 更新当前索引", () => {
    const before = stateWithTabs("tab-1", "tab-2");
    const state = appReducer(before, actions.setCurrentTab(1));
    expect(state.currentTab).toBe(1);
    expect(before.currentTab).toBe(0);
  });

  it("updateTab 按索引整体替换标签", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.updateTab(1, sshTab("tab-1", "renamed")));
    expect(state.tabs[1].label).toBe("renamed");
  });

  it("未知 action 返回原 state 引用", () => {
    expect(appReducer(initialState, { type: "NOPE" })).toBe(initialState);
  });
});

describe("分屏窗格布局", () => {
  it("addPane 在单 tab 上建立两窗格布局并聚焦新窗格", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.addPane("tab-1", "tab-1::p2", "row"));
    expect(state.splitLayouts["tab-1"]).toMatchObject({
      direction: "row",
      panes: ["tab-1", "tab-1::p2"],
      focusedPaneId: "tab-1::p2",
    });
    expect(state.panes["tab-1::p2"].parentTabId).toBe("tab-1");
  });

  it("addPane 拒绝重复窗格并受 4 窗格上限约束", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.addPane("tab-1", "tab-1::p2", "row"));
    const snapshot = state;
    expect(appReducer(state, actions.addPane("tab-1", "tab-1::p2"))).toBe(
      snapshot,
    );
    let four = appReducer(state, actions.addPane("tab-1", "tab-1::p3"));
    expect(four.splitLayouts["tab-1"].panes).toHaveLength(3);
    four = appReducer(four, actions.addPane("tab-1", "tab-1::p4"));
    expect(four.splitLayouts["tab-1"].panes).toHaveLength(4);
    // 第 5 个窗格被拒绝
    expect(appReducer(four, actions.addPane("tab-1", "tab-1::p5"))).toBe(four);
  });

  it("addPane 缺少 tabId 或 paneId 时原样返回", () => {
    expect(appReducer(initialState, actions.addPane(null, "p"))).toBe(
      initialState,
    );
    expect(appReducer(initialState, actions.addPane("tab-1", null))).toBe(
      initialState,
    );
  });

  it("removePane 移除最后一个非根窗格后恢复单标签", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.addPane("tab-1", "tab-1::p2", "row"));
    state = appReducer(state, actions.removePane("tab-1", "tab-1::p2"));
    expect(state.splitLayouts["tab-1"]).toBeUndefined();
    expect(state.panes["tab-1::p2"]).toBeUndefined();
  });

  it("关闭根窗格时首个存活窗格提升为宿主", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.addPane("tab-1", "tab-1::p2", "row"));
    state = appReducer(state, actions.removePane("tab-1", "tab-1"));
    expect(state.splitLayouts["tab-1"]).toBeUndefined();
    expect(state.tabs.map((t) => t.id)).toEqual(["welcome", "tab-1::p2"]);
    // 提升后的宿主不再是窗格注册表成员
    expect(state.panes["tab-1::p2"]).toBeUndefined();
  });

  it("focusPane 仅接受存在的窗格", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.addPane("tab-1", "tab-1::p2"));
    const before = state;
    expect(appReducer(state, actions.focusPane("tab-1", "missing"))).toBe(
      before,
    );
    state = appReducer(state, actions.focusPane("tab-1", "tab-1"));
    expect(state.splitLayouts["tab-1"].focusedPaneId).toBe("tab-1");
  });

  it("swapPanes 交换两个窗格位置", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.addPane("tab-1", "tab-1::p2"));
    state = appReducer(state, actions.swapPanes("tab-1", "tab-1", "tab-1::p2"));
    expect(state.splitLayouts["tab-1"].panes).toEqual(["tab-1::p2", "tab-1"]);
    // 相同窗格交换无效
    const snapshot = state;
    expect(
      appReducer(state, actions.swapPanes("tab-1", "tab-1", "tab-1")),
    ).toBe(snapshot);
  });

  it("resetTabLayout 清除布局与虚拟窗格，保留根会话", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.addPane("tab-1", "tab-1::p2"));
    state = appReducer(state, actions.resetTabLayout("tab-1"));
    expect(state.splitLayouts["tab-1"]).toBeUndefined();
    expect(state.panes["tab-1::p2"]).toBeUndefined();
    expect(state.tabs.some((t) => t.id === "tab-1")).toBe(true);
    // 无布局时为幂等操作
    const snapshot = state;
    expect(appReducer(state, actions.resetTabLayout("tab-1"))).toBe(snapshot);
  });

  it("setRatios 与 setLayoutDirection 更新布局且拒绝非法载荷", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.addPane("tab-1", "tab-1::p2"));
    state = appReducer(state, actions.setRatios("tab-1", [70, 30]));
    expect(state.splitLayouts["tab-1"].ratios).toEqual([70, 30]);
    state = appReducer(state, actions.setLayoutDirection("tab-1", "column"));
    expect(state.splitLayouts["tab-1"].direction).toBe("column");
    expect(appReducer(state, actions.setRatios("tab-1", "bad"))).toBe(state);
  });
});

describe("同步输入分组", () => {
  it("createSyncGroup 分配最小可用编号并把 tab 加入", () => {
    let state = appReducer(initialState, actions.createSyncGroup("tab-1"));
    expect(state.syncGroups).toEqual([
      { groupId: "G1", color: "#ff0000", members: ["tab-1"] },
    ]);
    // G1 被占用后下一个是 G2
    state = appReducer(state, actions.createSyncGroup("tab-2"));
    expect(state.syncGroups[1].groupId).toBe("G2");
  });

  it("joinSyncGroup 让 tab 同时只属于一个分组", () => {
    let state = appReducer(initialState, actions.createSyncGroup("tab-1"));
    state = appReducer(state, actions.joinSyncGroup("tab-1", "G1"));
    expect(state.syncGroups[0].members).toEqual(["tab-1"]);
    state = appReducer(state, actions.joinSyncGroup("tab-2", "G1"));
    expect(state.syncGroups[0].members).toEqual(["tab-1", "tab-2"]);
    state = appReducer(state, actions.createSyncGroup("tab-3"));
    state = appReducer(state, actions.joinSyncGroup("tab-1", "G2"));
    expect(state.syncGroups.find((g) => g.groupId === "G1").members).toEqual([
      "tab-2",
    ]);
    expect(state.syncGroups.find((g) => g.groupId === "G2").members).toEqual([
      "tab-3",
      "tab-1",
    ]);
  });

  it("removeTabFromSyncGroups 清理空分组", () => {
    let state = appReducer(initialState, actions.createSyncGroup("tab-1"));
    state = appReducer(state, actions.joinSyncGroup("tab-2", "G1"));
    state = appReducer(state, actions.removeTabFromSyncGroups("tab-1"));
    expect(state.syncGroups).toHaveLength(1);
    state = appReducer(state, actions.removeTabFromSyncGroups("tab-2"));
    expect(state.syncGroups).toHaveLength(0);
  });
});

describe("tabHistoryStack 快照与回滚", () => {
  it("pushTabOrderSnapshot 压栈且上限 20", () => {
    let state = initialState;
    for (let i = 0; i < 25; i += 1) {
      state = appReducer(
        state,
        actions.pushTabOrderSnapshot({
          tabs: [sshTab(`t${i}`)],
          currentTab: 0,
        }),
      );
    }
    expect(state.tabHistoryStack).toHaveLength(20);
    expect(state.tabHistoryStack[0].tabs[0].id).toBe("t24");
  });

  it("undoLastTabChange 恢复最近一次快照并弹出", () => {
    let state = appReducer(
      initialState,
      actions.pushTabOrderSnapshot({ tabs: [sshTab("old")], currentTab: 0 }),
    );
    state = appReducer(state, actions.addTab(sshTab("new")));
    state = appReducer(state, actions.undoLastTabChange());
    expect(state.tabs.map((t) => t.id)).toEqual(["old"]);
    expect(state.tabHistoryStack).toHaveLength(0);
    // 空栈时原样返回
    const snapshot = state;
    expect(appReducer(state, actions.undoLastTabChange())).toBe(snapshot);
  });
});

describe("侧边栏与文件管理开关", () => {
  it("sidebar 开关逐一更新", () => {
    let state = appReducer(
      initialState,
      actions.setConnectionManagerOpen(true),
    );
    expect(state.connectionManagerOpen).toBe(true);
    state = appReducer(state, actions.setResourceMonitorOpen(true));
    expect(state.resourceMonitorOpen).toBe(true);
    state = appReducer(state, actions.setSecurityToolsOpen(true));
    expect(state.securityToolsOpen).toBe(true);
    state = appReducer(state, actions.setPortForwardingOpen(true));
    expect(state.portForwardingOpen).toBe(true);
    state = appReducer(state, actions.setCommandHistoryOpen(true));
    expect(state.commandHistoryOpen).toBe(true);
    state = appReducer(state, actions.setActiveSidebarMargin(48));
    expect(state.activeSidebarMargin).toBe(48);
    state = appReducer(state, actions.setLastOpenedSidebar("files"));
    expect(state.lastOpenedSidebar).toBe("files");
  });

  it("文件管理开关按 tab 独立记忆且幂等", () => {
    let state = appReducer(
      initialState,
      actions.setFileManagerOpenForTab("tab-1", true),
    );
    expect(state.fileManagerOpenByTabId["tab-1"]).toBe(true);
    const snapshot = state;
    // 相同状态再设置返回原引用（避免无谓渲染）
    state = appReducer(state, actions.setFileManagerOpenForTab("tab-1", true));
    expect(state).toBe(snapshot);
    state = appReducer(state, actions.setFileManagerOpenForTab("tab-2", true));
    expect(state.fileManagerOpenByTabId["tab-1"]).toBe(true);
    expect(state.fileManagerOpenByTabId["tab-2"]).toBe(true);
  });
});

describe("会话遗忘与终端实例", () => {
  it("forgetSessions 清空实例/路径/开关与分组关联", () => {
    let state = appReducer(initialState, actions.addTab(sshTab("tab-1")));
    state = appReducer(state, actions.addPane("tab-1", "tab-1::p2"));
    state = appReducer(state, actions.createSyncGroup("tab-1"));
    state = appReducer(
      state,
      actions.updateTerminalInstance("tab-1", { connected: true }),
    );
    state = appReducer(state, actions.updateFileManagerPath("tab-1", "/root"));
    state = appReducer(state, actions.setFileManagerOpenForTab("tab-1", true));

    state = appReducer(state, actions.forgetSessions(["tab-1"]));
    expect(state.terminalInstances["tab-1"]).toBeUndefined();
    expect(state.terminalInstances["tab-1-config"]).toBeUndefined();
    expect(state.terminalInstances["tab-1-processId"]).toBeUndefined();
    expect(state.fileManagerPaths["tab-1"]).toBeUndefined();
    expect(state.fileManagerOpenByTabId["tab-1"]).toBeUndefined();
    expect(state.syncGroups).toHaveLength(0);
    expect(state.tabHistoryStack).toHaveLength(0);
  });

  it("updateTerminalInstance 支持布尔与对象合并两种形态", () => {
    let state = appReducer(
      initialState,
      actions.updateTerminalInstance("tab-1", { connected: true, rows: 30 }),
    );
    expect(state.terminalInstances["tab-1"]).toEqual({
      connected: true,
      rows: 30,
    });
    state = appReducer(
      state,
      actions.updateTerminalInstance("tab-1", { rows: 40 }),
    );
    expect(state.terminalInstances["tab-1"]).toEqual({
      connected: true,
      rows: 40,
    });
    state = appReducer(state, actions.updateTerminalInstance("tab-1", true));
    expect(state.terminalInstances["tab-1"]).toBe(true);
  });
});

describe("adoptTab 跨标签页吸纳", () => {
  it("把源 tab 变为目标 tab 的窗格", () => {
    let state = stateWithTabs("tab-1", "tab-2");
    state = appReducer(state, actions.adoptTab("tab-1", "tab-2", "right"));
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-1"]);
    expect(state.splitLayouts["tab-1"].panes).toEqual(["tab-1", "tab-2"]);
    expect(state.panes["tab-2"].adoptedFromTab).toBe(true);
    expect(state.panes["tab-2"].parentTabId).toBe("tab-1");
  });

  it("拒绝自我采纳、welcome 参与及已分屏源", () => {
    let state = stateWithTabs("welcome", "tab-1", "tab-2");
    const snapshot = state;
    expect(appReducer(state, actions.adoptTab("tab-1", "tab-1"))).toBe(
      snapshot,
    );
    expect(appReducer(state, actions.adoptTab("welcome", "tab-2"))).toBe(
      snapshot,
    );
    expect(appReducer(state, actions.adoptTab("tab-1", "welcome"))).toBe(
      snapshot,
    );
    expect(appReducer(state, actions.adoptTab("missing", "tab-2"))).toBe(
      snapshot,
    );
    state = appReducer(state, actions.addPane("tab-2", "tab-2::p2", "row"));
    expect(state.splitLayouts["tab-2"].panes).toHaveLength(2);
    expect(appReducer(state, actions.adoptTab("tab-1", "tab-2"))).toBe(state);
  });
});

describe("unsplitTab 拆分还原", () => {
  it("把窗格还原为独立标签并保留会话", () => {
    let state = stateWithTabs("tab-1", "tab-2");
    state = appReducer(state, actions.adoptTab("tab-1", "tab-2", "right"));
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-1"]);
    state = appReducer(state, actions.unsplitTab("tab-1"));
    expect(state.tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2"]);
    expect(state.splitLayouts["tab-1"]).toBeUndefined();
  });

  it("对未分屏 tab 为幂等操作", () => {
    const state = stateWithTabs("tab-1");
    const snapshot = state;
    expect(appReducer(state, actions.unsplitTab("tab-1"))).toBe(snapshot);
  });
});

describe("AI 与连接状态", () => {
  it("aiChatStatus 与 aiInputPreset 透传", () => {
    let state = appReducer(initialState, actions.setAiChatStatus("open"));
    expect(state.aiChatStatus).toBe("open");
    state = appReducer(state, actions.setAiInputPreset("ls -la"));
    expect(state.aiInputPreset).toBe("ls -la");
  });

  it("connections 与 fileManagerPaths 更新", () => {
    let state = appReducer(
      initialState,
      actions.setConnections([{ name: "a" }]),
    );
    expect(state.connections).toEqual([{ name: "a" }]);
    state = appReducer(
      state,
      actions.updateFileManagerPath("tab-1", "/var/log"),
    );
    expect(state.fileManagerPaths["tab-1"]).toBe("/var/log");
  });

  it("主题与对话框开关", () => {
    let state = appReducer(initialState, actions.setDarkMode(false));
    expect(state.darkMode).toBe(false);
    state = appReducer(state, actions.setThemeLoading(false));
    expect(state.themeLoading).toBe(false);
    state = appReducer(state, actions.setAboutDialogOpen(true));
    expect(state.aboutDialogOpen).toBe(true);
    state = appReducer(state, actions.setSettingsDialogOpen(true));
    expect(state.settingsDialogOpen).toBe(true);
  });
});
