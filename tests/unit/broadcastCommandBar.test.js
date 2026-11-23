// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import BroadcastCommandBar from "../../src/renderer/app/components/BroadcastCommandBar.jsx";
import {
  dispatchBroadcastCommand,
  resolveBroadcastTargets,
} from "../../src/renderer/features/terminal/model/syncGroupCommandDispatcher.js";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key, opts) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
  }),
}));

describe("syncGroupCommandDispatcher broadcast helpers", () => {
  it("resolves connected targets while excluding welcome and disconnected sessions", () => {
    const state = {
      tabs: [
        { id: "welcome", label: "Welcome", type: "welcome" },
        { id: "ssh-1", label: "Web 1", type: "ssh" },
        { id: "ssh-2", label: "Web 2", type: "ssh" },
        { id: "ssh-offline", label: "Offline Box", type: "ssh" },
        { id: "local-1", label: "PowerShell", type: "local" },
      ],
      splitLayouts: {
        "ssh-1": { panes: ["ssh-1", "ssh-1::p2"], focusedPaneId: "ssh-1" },
      },
      panes: {
        "ssh-1::p2": { parentTabId: "ssh-1", type: "ssh", label: "Worker" },
      },
      syncGroups: [
        {
          groupId: "G1",
          color: "#ff0000",
          members: ["ssh-1", "ssh-2", "ssh-offline"],
        },
      ],
      terminalInstances: {
        "ssh-1-config": { host: "10.0.0.1", username: "root" },
        "ssh-1::p2-config": { host: "10.0.0.2", username: "deploy" },
        "ssh-2-config": { host: "10.0.0.3", username: "ubuntu" },
        "ssh-offline-config": { host: "10.0.0.4", username: "root" },
      },
      connectionStatusByTabId: {
        "ssh-1": { isConnected: true },
        "ssh-1::p2": { isConnected: true },
        "ssh-2": { isConnected: true },
        "ssh-offline": { isConnected: false, isConnecting: false },
      },
      processRegistry: {
        "ssh-1": "pid-1",
        "ssh-1::p2": "pid-2",
        "ssh-2": "pid-3",
        "ssh-offline": "pid-4",
        "local-1": "pid-5",
      },
    };

    const allRes = resolveBroadcastTargets({ mode: "all", ...state });
    expect(allRes.targets.map((t) => t.sessionKey)).toEqual([
      "ssh-1",
      "ssh-1::p2",
      "ssh-2",
      "local-1",
    ]);
    expect(allRes.excludedCount).toBe(1);

    const groupRes = resolveBroadcastTargets({
      mode: "group",
      groupId: "G1",
      ...state,
    });
    expect(groupRes.targets.map((t) => t.sessionKey)).toEqual([
      "ssh-1",
      "ssh-2",
    ]);
    expect(groupRes.excludedCount).toBe(1);
  });

  it("dispatches syncTerminalCommand with trailing newline toggle and broadcast flag", () => {
    const received = [];
    const listener = (e) => received.push(e.detail);
    window.addEventListener("syncTerminalCommand", listener);

    const processRegistry = { "ssh-1": "p1", "ssh-2": "p2" };
    const result = dispatchBroadcastCommand({
      command: "uname -a",
      targetSessionKeys: ["ssh-1", "ssh-2", "ssh-missing"],
      appendNewline: false,
      sourceTabId: "ssh-1",
      groupId: "G1",
      processRegistry,
    });

    expect(result).toEqual({
      sentCount: 2,
      sentSessionKeys: ["ssh-1", "ssh-2"],
      unreachableSessionKeys: ["ssh-missing"],
    });
    expect(received).toEqual([
      {
        sourceTabId: "ssh-1",
        targetTabId: "ssh-1",
        groupId: "G1",
        command: "uname -a",
        execute: false,
        broadcast: true,
      },
      {
        sourceTabId: "ssh-1",
        targetTabId: "ssh-2",
        groupId: "G1",
        command: "uname -a",
        execute: false,
        broadcast: true,
      },
    ]);

    window.removeEventListener("syncTerminalCommand", listener);
  });
});

describe("BroadcastCommandBar UI behavior", () => {
  let host;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
    }
    host?.remove();
  });

  it("shows live target counts, sends via Ctrl+Enter, navigates history, and updates on tab close", async () => {
    const sentEvents = [];
    const listener = (e) => sentEvents.push(e.detail);
    window.addEventListener("syncTerminalCommand", listener);

    const baseProps = {
      open: true,
      onClose: vi.fn(),
      activeSessionKey: "ssh-1",
      tabs: [
        { id: "welcome", label: "Welcome", type: "welcome" },
        { id: "ssh-1", label: "Web-A", type: "ssh" },
        { id: "ssh-2", label: "Web-B", type: "ssh" },
      ],
      panes: {},
      splitLayouts: {},
      syncGroups: [
        { groupId: "G1", color: "#ff0000", members: ["ssh-1", "ssh-2"] },
      ],
      terminalInstances: {
        "ssh-1-config": { host: "web-a.local", username: "root" },
        "ssh-2-config": { host: "web-b.local", username: "root" },
      },
      connectionStatusByTabId: {
        "ssh-1": { isConnected: true },
        "ssh-2": { isConnected: true },
      },
      processRegistry: { "ssh-1": "p1", "ssh-2": "p2" },
    };

    await act(async () => {
      root.render(createElement(BroadcastCommandBar, baseProps));
    });

    expect(host.textContent).toContain('"count":2');
    expect(host.textContent).toContain("root@web-a.local");
    expect(host.textContent).toContain("root@web-b.local");

    const textarea = host.querySelector("textarea");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(textarea, "uptime");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(sentEvents).toHaveLength(2);
    expect(sentEvents[0].command).toBe("uptime");
    expect(sentEvents[0].execute).toBe(true);

    // ArrowUp recalls sent command from history
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
    });
    expect(textarea.value).toBe("uptime");

    // Closing a tab updates live target count to 1
    await act(async () => {
      root.render(
        createElement(BroadcastCommandBar, {
          ...baseProps,
          tabs: baseProps.tabs.slice(0, 2),
          syncGroups: [],
          processRegistry: { "ssh-1": "p1" },
        }),
      );
    });
    expect(host.textContent).toContain('"count":1');

    // Closing all session tabs leaves 0 targets and disables Send button
    await act(async () => {
      root.render(
        createElement(BroadcastCommandBar, {
          ...baseProps,
          tabs: baseProps.tabs.slice(0, 1),
          syncGroups: [],
          processRegistry: {},
        }),
      );
    });
    expect(host.textContent).toContain('"count":0');
    const sendButton = [...host.querySelectorAll("button")].find((b) =>
      b.textContent.includes("broadcastBar.send"),
    );
    expect(sendButton.disabled).toBe(true);

    window.removeEventListener("syncTerminalCommand", listener);
  });
});
