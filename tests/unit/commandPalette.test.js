// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import CommandPaletteDialog from "../../src/renderer/app/components/CommandPaletteDialog.jsx";
import {
  buildCommandPaletteItems,
  loadPaletteMru,
  parseQuickConnectTarget,
  rankCommandPaletteItems,
  recordPaletteMru,
} from "../../src/renderer/app/lib/commandPalette.js";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: "en-US" } }),
}));

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

describe("commandPalette pure helpers", () => {
  it("parses inline Quick Connect targets and rejects non-target strings", () => {
    expect(parseQuickConnectTarget("alice@prod-1.internal")).toEqual({
      raw: "alice@prod-1.internal",
      protocol: "ssh",
      username: "alice",
      host: "prod-1.internal",
      port: 22,
      label: "alice@prod-1.internal:22",
    });

    expect(parseQuickConnectTarget("deploy@10.0.0.5:2222")).toEqual({
      raw: "deploy@10.0.0.5:2222",
      protocol: "ssh",
      username: "deploy",
      host: "10.0.0.5",
      port: 2222,
      label: "deploy@10.0.0.5:2222",
    });

    expect(parseQuickConnectTarget("ssh://ops@[2001:db8::1]:2200")).toEqual({
      raw: "ssh://ops@[2001:db8::1]:2200",
      protocol: "ssh",
      username: "ops",
      host: "2001:db8::1",
      port: 2200,
      label: "ops@[2001:db8::1]:2200",
    });

    expect(parseQuickConnectTarget("telnet://switch.lan:2323")).toEqual({
      raw: "telnet://switch.lan:2323",
      protocol: "telnet",
      username: "",
      host: "switch.lan",
      port: 2323,
      label: "switch.lan:2323",
    });

    // Rejects plain words, invalid ports, spaces, unknown schemes
    expect(parseQuickConnectTarget("settings")).toBeNull();
    expect(parseQuickConnectTarget("alice@host:99999")).toBeNull();
    expect(parseQuickConnectTarget("alice@host:0")).toBeNull();
    expect(parseQuickConnectTarget("http://example.com")).toBeNull();
    expect(parseQuickConnectTarget("alice@host extra")).toBeNull();
  });

  it("prioritizes MRU items on empty query and ranks fuzzy matches + category filters", () => {
    const storage = createMemoryStorage();
    recordPaletteMru("panel:ai", storage);
    recordPaletteMru("action:splitRight", storage);

    const items = buildCommandPaletteItems({
      tabs: [
        { id: "welcome", label: "Welcome", type: "welcome" },
        { id: "ssh-1", label: "Web-01", type: "ssh" },
      ],
      splitLayouts: {
        "ssh-1": {
          direction: "row",
          panes: ["ssh-1", "ssh-1::p2"],
          focusedPaneId: "ssh-1",
        },
      },
      panes: {
        "ssh-1::p2": { parentTabId: "ssh-1", label: "Worker" },
      },
      connections: [
        {
          id: "g1",
          type: "group",
          name: "Prod",
          items: [
            {
              id: "c1",
              type: "connection",
              name: "API Gateway",
              host: "api.prod.internal",
              port: 22,
              username: "ubuntu",
              tags: ["critical"],
              pinned: true,
            },
          ],
        },
      ],
      shortcutCommands: [
        {
          id: "s1",
          name: "Tail Nginx",
          command: "tail -f /var/log/nginx/error.log",
        },
      ],
      activeSession: { parentTabId: "ssh-1", sessionKey: "ssh-1", type: "ssh" },
      isSshConnected: true,
      canMonitorCurrentSession: true,
    });

    // All 9 sidebar panels present
    for (const panelId of [
      "panel:connection",
      "panel:file",
      "panel:shortcut",
      "panel:history",
      "panel:resource",
      "panel:ipquery",
      "panel:password",
      "panel:forwarding",
      "panel:localTerminal",
    ]) {
      expect(items.some((item) => item.id === panelId)).toBe(true);
    }

    // Empty query orders MRU first
    const mruRanked = rankCommandPaletteItems(items, {
      query: "",
      category: "all",
      mruIds: loadPaletteMru(storage),
    });
    expect(mruRanked[0].id).toBe("action:splitRight");
    expect(mruRanked[1].id).toBe("panel:ai");

    // Category filtering
    const connOnly = rankCommandPaletteItems(items, {
      query: "",
      category: "connections",
    });
    expect(connOnly.every((item) => item.category === "connections")).toBe(
      true,
    );
    expect(connOnly[0].subtitle).toContain("Prod");
    expect(connOnly[0].subtitle).toContain("#critical");

    // Fuzzy query ranking
    const fuzzy = rankCommandPaletteItems(items, {
      query: "apigw",
      category: "all",
    });
    expect(fuzzy[0].id).toBe("conn:c1");

    // Inline Quick Connect injection
    const quick = rankCommandPaletteItems(items, {
      query: "root@10.1.2.3:2222",
      category: "all",
    });
    expect(quick[0].payload.kind).toBe("quickConnect");
    expect(quick[0].payload.parsed.port).toBe(2222);
  });
});

describe("CommandPaletteDialog UI interactions", () => {
  let host;
  let root;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    window.terminalAPI = {
      detectLocalTerminals: vi.fn().mockResolvedValue([]),
      getShortcutCommands: vi
        .fn()
        .mockResolvedValue({ success: true, data: { commands: [] } }),
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => root.unmount());
    }
    host?.remove();
    delete window.terminalAPI;
  });

  it("navigates with ArrowDown/Enter and closes cleanly with Esc", async () => {
    const onClose = vi.fn();
    const onExecuteItem = vi.fn();
    const restoreBtn = document.createElement("button");
    document.body.appendChild(restoreBtn);
    restoreBtn.focus();

    await act(async () => {
      root.render(
        createElement(CommandPaletteDialog, {
          open: true,
          onClose,
          onExecuteItem,
          tabs: [
            { id: "welcome", label: "Welcome", type: "welcome" },
            { id: "ssh-1", label: "Prod-Web", type: "ssh" },
          ],
          connections: [
            {
              id: "c-prod",
              type: "connection",
              name: "Database Host",
              host: "db.internal",
              port: 22,
              username: "postgres",
            },
          ],
          activeSession: {
            parentTabId: "ssh-1",
            sessionKey: "ssh-1",
            type: "ssh",
          },
        }),
      );
    });

    const input = document.body.querySelector(
      'input[type="text"], input:not([type])',
    );
    expect(input).toBeTruthy();

    await act(async () => {
      const ev = new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
      });
      input.dispatchEvent(ev);
    });

    await act(async () => {
      const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
      input.dispatchEvent(ev);
    });
    expect(onExecuteItem).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledWith("execute");

    // Reopen and press Esc
    onClose.mockClear();
    await act(async () => {
      const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
      input.dispatchEvent(ev);
    });
    expect(onClose).toHaveBeenCalledWith("escape");
    restoreBtn.remove();
  });
});
