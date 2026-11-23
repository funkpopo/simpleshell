// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  buildTransientQuickConnectConnection,
  formatQuickConnectLabel,
  parseQuickConnectTarget,
  resolveQuickConnectDetail,
} from "../../src/shared/domain/quickConnect.js";
import {
  clearTransientQuickConnects,
  dismissTransientQuickConnect,
  getTransientQuickConnects,
  recordTransientQuickConnect,
} from "../../src/renderer/shared/lib/quickConnectSession.js";
import { buildDuplicateConnectionPayload } from "../../src/renderer/features/connections/lib/connectionForm.js";
import {
  collectAllConnectionTags,
  filterConnectionTree,
} from "../../src/renderer/features/connections/lib/connectionTree.js";
import ConnectionManager from "../../src/renderer/features/connections/ConnectionManager.jsx";
import WelcomePage from "../../src/renderer/features/welcome/WelcomePage.jsx";

const { translate, notifications } = vi.hoisted(() => ({
  translate: (key) => key,
  notifications: { showError: vi.fn(), showSuccess: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: { language: "en-US" } }),
}));
vi.mock("../../src/renderer/i18n/i18n", () => ({
  default: { t: (key) => key },
  changeLanguage: vi.fn(),
}));
vi.mock("../../src/renderer/shared/notifications/NotificationContext", () => ({
  useNotification: () => notifications,
}));

let mounted = [];

async function mount(Component, props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    root.render(createElement(Component, props));
  });
  return host;
}

function setInputValue(inputElement, value) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
    inputElement,
    value,
  );
  inputElement.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage?.clear();
  clearTransientQuickConnects();
  window.terminalAPI = {
    loadConnections: vi.fn(async () => []),
    saveConnections: vi.fn(async () => true),
  };
});

afterEach(async () => {
  while (mounted.length > 0) {
    const { root, host } = mounted.pop();
    await act(async () => root.unmount());
    host.remove();
  }
  window.sessionStorage?.clear();
  clearTransientQuickConnects();
});

describe("parseQuickConnectTarget", () => {
  it("parses ssh/telnet targets, bare hosts, IPv4, and [IPv6]:port literals", () => {
    expect(parseQuickConnectTarget("alice@prod.example.com")).toEqual({
      ok: true,
      value: {
        protocol: "ssh",
        host: "prod.example.com",
        port: 22,
        username: "alice",
      },
    });

    expect(parseQuickConnectTarget("ops@192.168.10.25:2222")).toEqual({
      ok: true,
      value: {
        protocol: "ssh",
        host: "192.168.10.25",
        port: 2222,
        username: "ops",
      },
    });

    expect(
      parseQuickConnectTarget("ssh://deploy@bastion.internal:2200"),
    ).toEqual({
      ok: true,
      value: {
        protocol: "ssh",
        host: "bastion.internal",
        port: 2200,
        username: "deploy",
      },
    });

    expect(parseQuickConnectTarget("telnet://10.0.0.2")).toEqual({
      ok: true,
      value: {
        protocol: "telnet",
        host: "10.0.0.2",
        port: 23,
        username: "",
      },
    });

    expect(parseQuickConnectTarget("telnet://switch.lab:2323")).toEqual({
      ok: true,
      value: {
        protocol: "telnet",
        host: "switch.lab",
        port: 2323,
        username: "",
      },
    });

    expect(parseQuickConnectTarget("root@[2001:db8::1]:2222")).toEqual({
      ok: true,
      value: {
        protocol: "ssh",
        host: "2001:db8::1",
        port: 2222,
        username: "root",
      },
    });

    expect(parseQuickConnectTarget("[::1]:2201")).toEqual({
      ok: true,
      value: {
        protocol: "ssh",
        host: "::1",
        port: 2201,
        username: "",
      },
    });

    expect(parseQuickConnectTarget("2001:db8::1")).toEqual({
      ok: true,
      value: {
        protocol: "ssh",
        host: "2001:db8::1",
        port: 22,
        username: "",
      },
    });

    expect(
      parseQuickConnectTarget("ssh://alice%2Bdev@[fe80::1%eth0]:2222/"),
    ).toEqual({
      ok: true,
      value: {
        protocol: "ssh",
        host: "fe80::1%eth0",
        port: 2222,
        username: "alice+dev",
      },
    });
  });

  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    [null, "EMPTY"],
    ["user@host name", "INVALID_WHITESPACE"],
    ["http://example.com", "UNSUPPORTED_SCHEME"],
    ["sftp://example.com", "UNSUPPORTED_SCHEME"],
    ["ssh://example.com/path", "INVALID_HOST"],
    ["@example.com", "EMPTY_USERNAME"],
    ["a@b@example.com", "INVALID_FORMAT"],
    ["user@host:0", "INVALID_PORT"],
    ["user@host:65536", "INVALID_PORT"],
    ["user@host:abc", "INVALID_PORT"],
    ["[not-ipv6]:22", "INVALID_IPV6"],
    ["[::1", "INVALID_IPV6"],
    ["2001:db8:1:2:3:4:5:6:2222", "INVALID_IPV6"],
    ["999.1.1.1", "INVALID_HOST"],
  ])("rejects malformed target %j with %s", (input, expectedCode) => {
    const result = parseQuickConnectTarget(input);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(expectedCode);
  });
});

describe("transient Quick Connect models & session tracking", () => {
  it("builds transient connections and resolves CustomEvent detail payloads", () => {
    const conn = buildTransientQuickConnectConnection("ops@[2001:db8::1]:2222");
    expect(conn).toMatchObject({
      type: "connection",
      isTransient: true,
      host: "2001:db8::1",
      port: 2222,
      username: "ops",
      protocol: "ssh",
      authType: "password",
      password: "",
      name: "ops@[2001:db8::1]:2222",
    });
    expect(conn.id.startsWith("quick_")).toBe(true);
    expect(
      formatQuickConnectLabel({
        protocol: "telnet",
        host: "10.0.0.5",
        port: 23,
        username: "",
      }),
    ).toBe("telnet://10.0.0.5");

    const fromEventObj = resolveQuickConnectDetail({
      host: "db.internal",
      port: "2222",
      username: "dba",
      protocol: "ssh",
    });
    expect(fromEventObj.ok).toBe(true);
    expect(fromEventObj.connection).toMatchObject({
      isTransient: true,
      host: "db.internal",
      port: 2222,
      username: "dba",
    });

    const fromTargetString = resolveQuickConnectDetail({
      target: "telnet://switch.local:2323",
    });
    expect(fromTargetString.ok).toBe(true);
    expect(fromTargetString.connection.protocol).toBe("telnet");
    expect(fromTargetString.connection.port).toBe(2323);
  });

  it("tracks transient quick-connects and hides targets already saved in groups", () => {
    const first = buildTransientQuickConnectConnection("root@10.0.0.1:22");
    const second = buildTransientQuickConnectConnection("ops@10.0.0.2:2222");
    recordTransientQuickConnect(first);
    recordTransientQuickConnect(second);

    expect(getTransientQuickConnects([])).toHaveLength(2);

    const saved = [
      {
        id: "grp-1",
        type: "group",
        name: "Prod",
        items: [
          {
            id: "conn-1",
            type: "connection",
            host: "10.0.0.1",
            port: 22,
            username: "root",
            protocol: "ssh",
          },
        ],
      },
    ];
    expect(getTransientQuickConnects(saved).map((x) => x.host)).toEqual([
      "10.0.0.2",
    ]);

    dismissTransientQuickConnect(second);
    expect(getTransientQuickConnects(saved)).toEqual([]);
  });
});

describe("connection metadata filters & Duplicate Connection", () => {
  it("duplicates connection with unique ID/name while stripping secrets and virtual runtime fields", () => {
    const existing = [
      { id: "c1", type: "connection", name: "Web Prod", host: "10.0.0.1" },
      {
        id: "g1",
        type: "group",
        name: "Servers",
        items: [
          {
            id: "c2",
            type: "connection",
            name: "Web Prod (Copy)",
            host: "10.0.0.1",
          },
        ],
      },
    ];
    const source = {
      id: "c1",
      type: "connection",
      name: "Web Prod",
      host: "10.0.0.1",
      port: 2222,
      username: "deploy",
      password: "secret",
      hasPassword: true,
      credentialRevision: "rev-3",
      pinned: true,
      tags: ["prod", "nginx", "prod"],
      colorTag: "#ef4444",
      depth: 1,
      parentGroup: existing[1],
      proxy: {
        type: "socks5",
        host: "127.0.0.1",
        port: 1080,
        password: "p",
        hasPassword: true,
      },
    };

    const dup = buildDuplicateConnectionPayload(source, existing, "Copy");
    expect(dup.id).not.toBe("c1");
    expect(dup.name).toBe("Web Prod (Copy 2)");
    expect(dup.password).toBe("");
    expect(dup.hasPassword).toBe(false);
    expect(dup.credentialRevision).toBe("");
    expect(dup._preservePassword).toBe(false);
    expect(dup.proxy).toEqual({
      type: "socks5",
      host: "127.0.0.1",
      port: 1080,
      password: "",
      hasPassword: false,
    });
    expect(dup.pinned).toBe(true);
    expect(dup.tags).toEqual(["prod", "nginx"]);
    expect(dup.colorTag).toBe("#ef4444");
    expect("depth" in dup).toBe(false);
    expect("parentGroup" in dup).toBe(false);
  });

  it("collects tags and filters connections by pinned, tag, and query across groups", () => {
    const tree = [
      {
        id: "g1",
        type: "group",
        name: "Core",
        expanded: false,
        items: [
          {
            id: "c1",
            type: "connection",
            name: "API",
            host: "10.0.1.5",
            username: "ubuntu",
            pinned: true,
            tags: ["prod", "api"],
          },
          {
            id: "c2",
            type: "connection",
            name: "Staging",
            host: "10.0.2.5",
            username: "ubuntu",
            pinned: false,
            tags: ["stage"],
          },
        ],
      },
    ];

    expect(collectAllConnectionTags(tree)).toEqual(["api", "prod", "stage"]);

    const pinnedOnly = filterConnectionTree(tree, { onlyPinned: true });
    expect(pinnedOnly).toHaveLength(1);
    expect(pinnedOnly[0].expanded).toBe(true);
    expect(pinnedOnly[0].items.map((c) => c.id)).toEqual(["c1"]);

    const byTag = filterConnectionTree(tree, { selectedTag: "stage" });
    expect(byTag[0].items.map((c) => c.id)).toEqual(["c2"]);
  });
});

describe("Quick Connect UI integration", () => {
  it("launches transient session from ConnectionManager and handles simpleshell:quickConnect", async () => {
    const onOpenConnection = vi.fn();
    await mount(ConnectionManager, {
      open: true,
      onClose: vi.fn(),
      initialConnections: [],
      onOpenConnection,
    });

    const qcInput = document.querySelector(
      'input[aria-label="connections.quickConnect.inputLabel"]',
    );
    expect(qcInput).toBeTruthy();

    await act(async () => {
      setInputValue(qcInput, "alice@10.0.0.9:2222");
    });

    const connectBtn = [...document.querySelectorAll("button")].find(
      (btn) => btn.textContent === "connections.quickConnect.connect",
    );
    expect(connectBtn).toBeTruthy();
    await act(async () => {
      connectBtn.click();
    });

    expect(onOpenConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        isTransient: true,
        host: "10.0.0.9",
        port: 2222,
        username: "alice",
        protocol: "ssh",
      }),
    );
    expect(window.terminalAPI.saveConnections).not.toHaveBeenCalled();

    const customEvent = new CustomEvent("simpleshell:quickConnect", {
      cancelable: true,
      detail: { target: "bob@example.test:2202" },
    });
    await act(async () => {
      window.dispatchEvent(customEvent);
    });

    expect(customEvent.defaultPrevented).toBe(true);
    expect(onOpenConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isTransient: true,
        host: "example.test",
        port: 2202,
        username: "bob",
      }),
    );
  });

  it("supports Quick Connect, Local Terminal CTA, and Save as Connection on WelcomePage", async () => {
    const onOpenConnection = vi.fn();
    const onConnectionsUpdate = vi.fn();
    const onOpenLocalTerminal = vi.fn();
    await mount(WelcomePage, {
      connections: [],
      topConnections: [],
      onOpenConnection,
      onCreateConnection: vi.fn(),
      onConnectionsUpdate,
      onOpenLocalTerminal,
    });

    const localBtn = [...document.querySelectorAll("button")].find((btn) =>
      btn.textContent.includes("welcome.localTerminal"),
    );
    expect(localBtn).toBeTruthy();
    await act(async () => {
      localBtn.click();
    });
    expect(onOpenLocalTerminal).toHaveBeenCalledOnce();

    const qcInput = document.querySelector(
      'input[aria-label="connections.quickConnect.inputLabel"]',
    );
    await act(async () => {
      setInputValue(qcInput, "deploy@192.168.50.10:2222");
    });
    const connectBtn = [...document.querySelectorAll("button")].find((btn) =>
      btn.textContent.includes("connections.quickConnect.connect"),
    );
    await act(async () => {
      connectBtn.click();
    });

    expect(onOpenConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        isTransient: true,
        host: "192.168.50.10",
        port: 2222,
        username: "deploy",
      }),
    );

    const saveChip = [...document.querySelectorAll('[role="button"]')].find(
      (el) =>
        el.textContent.includes("connections.quickConnect.saveAsConnection"),
    );
    expect(saveChip).toBeTruthy();
    await act(async () => {
      saveChip.click();
    });

    const saveBtn = [...document.querySelectorAll("button")].find(
      (btn) => btn.textContent === "common.save",
    );
    expect(saveBtn).toBeTruthy();
    await act(async () => {
      saveBtn.click();
    });

    expect(onConnectionsUpdate).toHaveBeenCalledWith([
      expect.objectContaining({
        type: "connection",
        host: "192.168.50.10",
        port: 2222,
        username: "deploy",
        protocol: "ssh",
      }),
    ]);
  });
});
