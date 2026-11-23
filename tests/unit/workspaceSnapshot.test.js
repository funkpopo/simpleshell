// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  AppProvider,
  useAppStore,
} from "../../src/renderer/app/state/AppContext.jsx";
import {
  WORKSPACE_SNAPSHOT_STORAGE_KEY,
  clearWorkspaceSnapshot,
  createWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  resolveWorkspaceRestorePlan,
  saveWorkspaceSnapshot,
} from "../../src/renderer/app/lib/workspaceSnapshot.js";
import useWorkspaceRestore from "../../src/renderer/app/hooks/useWorkspaceRestore.js";

describe("workspaceSnapshot serialization & rehydration", () => {
  it("preserves tab order, custom titles, split layouts, and active index while strictly stripping secrets", () => {
    const state = {
      tabs: [
        { id: "welcome", label: "Welcome", type: "welcome" },
        {
          id: "ssh-1",
          label: "My Prod",
          customTitle: "My Prod",
          originalLabel: "Prod Server",
          type: "ssh",
          connectionId: "conn-1",
        },
        {
          id: "ssh-quick",
          label: "ops@jump:2222",
          type: "ssh",
        },
        {
          id: "local-1",
          label: "PowerShell",
          type: "local",
          localConfig: {
            name: "PowerShell",
            type: "powershell",
            executable: "pwsh.exe",
            env: { SECRET_TOKEN: "should-not-leak" },
          },
        },
      ],
      currentTab: 2,
      splitLayouts: {
        "ssh-1": {
          direction: "row",
          pairDirection: "row",
          ratios: [35, 65],
          focusedPaneId: "ssh-1::p2",
          panes: ["ssh-1", "ssh-1::p2"],
        },
      },
      panes: {
        "ssh-1::p2": {
          id: "ssh-1::p2",
          parentTabId: "ssh-1",
          type: "ssh",
          label: "Worker",
          tab: {
            id: "ssh-1::p2",
            type: "ssh",
            label: "Worker",
            connectionId: "conn-2",
          },
        },
      },
      terminalInstances: {
        "ssh-1-config": {
          id: "conn-1",
          connectionId: "conn-1",
          host: "prod.example.com",
          port: 22,
          username: "root",
          password: "TOP_SECRET_PASSWORD",
          passphrase: "TOP_SECRET_PASSPHRASE",
          privateKey: "-----BEGIN PRIVATE KEY-----",
          proxy: {
            enabled: true,
            type: "http",
            host: "proxy.local",
            port: 8080,
            username: "puser",
            password: "PROXY_SECRET_PASSWORD",
          },
        },
        "ssh-1::p2-config": {
          id: "conn-2",
          connectionId: "conn-2",
          host: "worker.example.com",
          port: 22,
          username: "ubuntu",
          password: "WORKER_PASSWORD",
        },
        "ssh-quick-config": {
          isTransient: true,
          host: "jump.example.com",
          port: 2222,
          username: "ops",
          protocol: "ssh",
          password: "TRANSIENT_PASSWORD",
        },
        "local-1-config": {
          name: "PowerShell",
          type: "powershell",
          executable: "pwsh.exe",
          env: { API_KEY: "do-not-store" },
        },
      },
    };

    const snapshot = createWorkspaceSnapshot(state);
    const json = JSON.stringify(snapshot);

    expect(json).not.toContain("TOP_SECRET_PASSWORD");
    expect(json).not.toContain("TOP_SECRET_PASSPHRASE");
    expect(json).not.toContain("PRIVATE KEY");
    expect(json).not.toContain("PROXY_SECRET_PASSWORD");
    expect(json).not.toContain("WORKER_PASSWORD");
    expect(json).not.toContain("TRANSIENT_PASSWORD");
    expect(json).not.toContain("do-not-store");
    expect(json).not.toContain("should-not-leak");

    expect(snapshot.activeTabIndex).toBe(2);
    expect(snapshot.tabs).toHaveLength(3);
    expect(snapshot.tabs[0].customTitle).toBe("My Prod");
    expect(snapshot.tabs[0].splitLayout.ratios).toEqual([35, 65]);
    expect(snapshot.tabs[0].splitLayout.focusedPaneIndex).toBe(1);

    // Rehydrate when conn-2 was deleted — split degrades safely to single pane
    const liveConnections = [
      {
        id: "conn-1",
        type: "connection",
        name: "Prod Server",
        host: "prod.example.com",
        port: 22,
        username: "root",
        protocol: "ssh",
      },
    ];
    const plan = resolveWorkspaceRestorePlan(snapshot, liveConnections, {
      idPrefix: "test",
    });

    expect(plan.tabs.map((t) => t.id)).toEqual([
      "welcome",
      "ssh-test-1",
      "ssh-test-2",
      "local-test-3",
    ]);
    expect(plan.tabs[1].customTitle).toBe("My Prod");
    expect(plan.splitLayouts["ssh-test-1"]).toBeUndefined();
    expect(plan.currentTab).toBe(2);
    expect(plan.terminalInstances["ssh-test-2-config"]).toMatchObject({
      isTransient: true,
      host: "jump.example.com",
      port: 2222,
    });
  });

  it("restores full multi-pane split layouts when all connections exist", () => {
    const snapshot = {
      version: 1,
      activeTabIndex: 1,
      tabs: [
        {
          type: "ssh",
          label: "Cluster",
          connectionId: "c1",
          splitLayout: {
            direction: "row",
            pairDirection: "row",
            ratios: [40, 60],
            focusedPaneIndex: 1,
            panes: [
              { type: "ssh", label: "Node 1", connectionId: "c1" },
              { type: "ssh", label: "Node 2", connectionId: "c2" },
            ],
          },
        },
      ],
    };

    const connections = [
      {
        id: "c1",
        type: "connection",
        name: "Node 1",
        host: "n1.lan",
        protocol: "ssh",
      },
      {
        id: "c2",
        type: "connection",
        name: "Node 2",
        host: "n2.lan",
        protocol: "ssh",
      },
    ];
    const plan = resolveWorkspaceRestorePlan(snapshot, connections, {
      idPrefix: "split",
    });

    expect(plan.splitLayouts["ssh-split-1"]).toEqual({
      direction: "row",
      pairDirection: "row",
      ratios: [40, 60],
      focusedPaneId: "ssh-split-1::p2",
      panes: ["ssh-split-1", "ssh-split-1::p2"],
    });
    expect(plan.panes["ssh-split-1::p2"].parentTabId).toBe("ssh-split-1");
    expect(plan.sshSessions).toHaveLength(2);
  });

  it("drops deleted connections cleanly and returns null if nothing survives", () => {
    const snapshot = {
      version: 1,
      activeTabIndex: 1,
      tabs: [{ type: "ssh", label: "Deleted", connectionId: "missing-id" }],
    };
    expect(resolveWorkspaceRestorePlan(snapshot, [])).toBeNull();
  });
});

describe("useWorkspaceRestore gating", () => {
  let host;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
    }
    host?.remove();
    clearWorkspaceSnapshot();
    localStorage.clear();
  });

  it("defers restoration while Master Password is locked and restores after unlock", async () => {
    saveWorkspaceSnapshot({
      version: 1,
      activeTabIndex: 1,
      tabs: [{ type: "ssh", label: "Prod", connectionId: "c1" }],
    });

    const markSessionConnecting = vi.fn();
    let store;

    function Harness({
      connectionsLoaded,
      uiSettingsLoaded,
      requiresUnlock,
      restoreSessionOnStartup = true,
      connections = [],
    }) {
      store = useAppStore();
      useWorkspaceRestore({
        tabs: store.getState().tabs,
        currentTab: 0,
        splitLayouts: {},
        panes: {},
        connections,
        connectionsLoaded,
        uiSettingsLoaded,
        uiSettingsSnapshot: { restoreSessionOnStartup },
        credentialSecurityStatus: { loading: false, requiresUnlock },
        markSessionConnecting,
      });
      return null;
    }

    // Locked: must NOT restore yet
    await act(async () => {
      root.render(
        createElement(
          AppProvider,
          null,
          createElement(Harness, {
            connectionsLoaded: false,
            uiSettingsLoaded: true,
            requiresUnlock: true,
          }),
        ),
      );
    });
    expect(store.getState().tabs).toHaveLength(1);
    expect(loadWorkspaceSnapshot()).not.toBeNull();

    // Unlocked & connections loaded: restores cleanly
    await act(async () => {
      root.render(
        createElement(
          AppProvider,
          null,
          createElement(Harness, {
            connectionsLoaded: true,
            uiSettingsLoaded: true,
            requiresUnlock: false,
            connections: [
              {
                id: "c1",
                type: "connection",
                name: "Prod",
                host: "prod.lan",
                protocol: "ssh",
              },
            ],
          }),
        ),
      );
    });
    expect(store.getState().tabs).toHaveLength(2);
    expect(store.getState().tabs[1].label).toBe("Prod");
    expect(markSessionConnecting).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(WORKSPACE_SNAPSHOT_STORAGE_KEY)).toBeTruthy();
  });

  it("skips startup restore when uiSettings.restoreSessionOnStartup is false", async () => {
    saveWorkspaceSnapshot({
      version: 1,
      activeTabIndex: 1,
      tabs: [
        {
          type: "local",
          label: "Shell",
          localConfig: { useDefaultShell: true },
        },
      ],
    });

    let store;
    function Harness() {
      store = useAppStore();
      useWorkspaceRestore({
        tabs: store.getState().tabs,
        currentTab: 0,
        splitLayouts: {},
        panes: {},
        connections: [],
        connectionsLoaded: true,
        uiSettingsLoaded: true,
        uiSettingsSnapshot: { restoreSessionOnStartup: false },
        credentialSecurityStatus: { loading: false, requiresUnlock: false },
        markSessionConnecting: vi.fn(),
      });
      return null;
    }

    await act(async () => {
      root.render(createElement(AppProvider, null, createElement(Harness)));
    });
    expect(store.getState().tabs).toHaveLength(1);
  });
});
