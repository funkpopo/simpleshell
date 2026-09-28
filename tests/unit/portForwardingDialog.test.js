// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import PortForwardingDialog from "../../src/renderer/features/connections/PortForwardingDialog.jsx";

const { t } = vi.hoisted(() => ({ t: (key) => key }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t }) }));

let root;
let host;
let api;
let notify;
const rule = {
  id: "pf-one",
  name: "Saved database tunnel",
  type: "local",
  listenHost: "localhost",
  listenPort: 15432,
  remoteHost: "database.internal",
  remotePort: 5432,
};
const snapshot = (rules = [], runtimeStatus = {}) => ({ rules, runtimeStatus });
const deferred = () => {
  let resolve;
  const promise = new Promise((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
};
const button = (label) =>
  document.querySelector(`button[aria-label="${label}"]`) ||
  [...document.querySelectorAll("button")].find(
    (node) => node.textContent === label,
  );
const click = async (label) => {
  await act(async () => {
    button(label).focus();
    button(label).click();
  });
};
const field = (label) => {
  const caption = [...document.querySelectorAll("label")].find(
    (node) => node.textContent === label,
  );
  return caption ? document.getElementById(caption.htmlFor) : null;
};
async function input(label, value) {
  const node = field(label);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function select(labelId, value) {
  const node = document.querySelector(
    `[role="combobox"][aria-labelledby~="${labelId}"]`,
  );
  await act(async () => {
    node.focus();
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await act(async () => {
    const option = document.querySelector(
      `[role="option"][data-value="${value}"]`,
    );
    option.focus();
    option.click();
  });
}
const mount = async (props = {}) => {
  await act(async () =>
    root.render(
      createElement(PortForwardingDialog, {
        open: true,
        onClose() {},
        ...props,
      }),
    ),
  );
};

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api = {
    getPortForwardRules: vi.fn(async () => snapshot()),
    getPortForwardActiveSessions: vi.fn(async () => [
      { tabId: "ssh:one", host: "host", label: "user@host", port: 22 },
    ]),
    onPortForwardStatusUpdated: vi.fn((callback) => {
      notify = callback;
      return () => {};
    }),
    savePortForwardRule: vi.fn(),
    deletePortForwardRule: vi.fn(),
    startPortForwardRule: vi.fn(async () => ({ status: "running" })),
    stopPortForwardRule: vi.fn(async () => true),
  };
  window.terminalAPI = api;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  delete window.terminalAPI;
});

it("shows a rule immediately after saving and keeps it after reopening the panel", async () => {
  await mount();
  await click("portForwarding.addRule");
  await input("portForwarding.ruleName", rule.name);
  await input("portForwarding.listenPort", "15432");
  await input("portForwarding.targetPort", "5432");
  api.savePortForwardRule.mockImplementation(async (value) => {
    expect(value.listenPort).toBe(15432);
    expect(value.remotePort).toBe(5432);
    api.getPortForwardRules.mockResolvedValue(snapshot([rule]));
    notify(snapshot([rule]));
    return rule;
  });
  await click("common.save");
  expect(
    host.querySelector(`[role="group"][aria-label="${rule.name}"]`),
  ).not.toBeNull();
  await act(async () =>
    root.render(
      createElement(PortForwardingDialog, { open: false, onClose() {} }),
    ),
  );
  await mount();
  expect(host.textContent).toContain(rule.name);
});

it("keeps the editor and user input when IPC reports a save failure", async () => {
  await mount();
  await click("portForwarding.addRule");
  await input("portForwarding.ruleName", "Do not lose this draft");
  api.savePortForwardRule.mockResolvedValue({
    success: false,
    error: "Port is already used",
  });
  await click("common.save");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[role="alert"]').textContent).toBe(
    "Port is already used",
  );
  expect(
    [...document.querySelectorAll("input")].some(
      (node) => node.value === "Do not lose this draft",
    ),
  ).toBe(true);
  expect(api.getPortForwardRules).toHaveBeenCalledTimes(1);
});

it("preserves existing rules on refresh and delete failures", async () => {
  api.getPortForwardRules.mockResolvedValue(snapshot([rule]));
  await mount();
  api.deletePortForwardRule.mockResolvedValue({
    success: false,
    error: "Cannot write configuration",
  });
  await click("portForwarding.delete");
  expect(host.textContent).toContain(rule.name);
  expect(host.querySelector('[role="alert"]').textContent).toBe(
    "Cannot write configuration",
  );
  api.getPortForwardRules.mockResolvedValue({
    success: false,
    error: "Cannot load rules",
  });
  await click("common.refresh");
  expect(host.textContent).toContain(rule.name);
  expect(host.querySelector('[role="alert"]').textContent).toBe(
    "Cannot load rules",
  );
});

it("removes a committed running rule while SSH cleanup is still pending", async () => {
  const pending = deferred();
  api.getPortForwardRules.mockResolvedValue(
    snapshot([rule], { [rule.id]: { status: "running" } }),
  );
  api.deletePortForwardRule.mockReturnValue(pending.promise);
  await mount();
  await click("portForwarding.delete");
  expect(button("portForwarding.delete").disabled).toBe(true);
  expect(
    button("portForwarding.delete").querySelector('[role="progressbar"]'),
  ).not.toBeNull();
  expect(button("portForwarding.stop").disabled).toBe(true);
  expect(
    button("portForwarding.stop").querySelector('[role="progressbar"]'),
  ).toBeNull();
  expect(button("portForwarding.edit").disabled).toBe(true);
  await click("portForwarding.delete");
  expect(api.deletePortForwardRule).toHaveBeenCalledTimes(1);
  await act(async () => notify(snapshot()));
  expect(host.querySelector('[role="group"]')).toBeNull();
  await act(async () => pending.resolve(true));
  expect(api.getPortForwardRules).toHaveBeenCalledTimes(1);
  expect(api.getPortForwardActiveSessions).toHaveBeenCalledTimes(1);
});

it("applies a confirmed delete without a status event or extra refresh and rejects an older list", async () => {
  api.getPortForwardRules.mockResolvedValue(snapshot([rule]));
  await mount();
  const oldList = deferred();
  api.getPortForwardRules.mockReturnValueOnce(oldList.promise);
  await click("common.refresh");
  api.deletePortForwardRule.mockResolvedValue(true);
  await click("portForwarding.delete");
  expect(host.querySelector('[role="group"]')).toBeNull();
  await act(async () => oldList.resolve(snapshot([rule])));
  expect(host.querySelector('[role="group"]')).toBeNull();
  expect(api.getPortForwardRules).toHaveBeenCalledTimes(2);
});

it("tracks simultaneous deletions independently when an earlier cleanup finishes", async () => {
  const secondRule = { ...rule, id: "pf-two", name: "Second rule" };
  const first = deferred();
  const second = deferred();
  api.getPortForwardRules.mockResolvedValue(snapshot([rule, secondRule]));
  api.deletePortForwardRule.mockImplementation((id) =>
    id === rule.id ? first.promise : second.promise,
  );
  await mount();
  await click("portForwarding.delete");
  await act(async () => notify(snapshot([secondRule])));
  await click("portForwarding.delete");
  expect(api.deletePortForwardRule).toHaveBeenCalledTimes(2);
  await act(async () => first.resolve(true));
  expect(button("portForwarding.delete").disabled).toBe(true);
  expect(button("portForwarding.edit").disabled).toBe(true);
  await act(async () => second.resolve(true));
  expect(host.querySelector('[role="group"]')).toBeNull();
});

it("retries an errored rule and displays a structured start error", async () => {
  api.getPortForwardRules.mockResolvedValue(
    snapshot([rule], { [rule.id]: { status: "error", error: "Disconnected" } }),
  );
  api.startPortForwardRule.mockResolvedValue({
    success: false,
    error: "Authentication rejected",
  });
  await mount();
  await click("portForwarding.start");
  expect(api.startPortForwardRule).toHaveBeenCalledWith(rule.id, "ssh:one");
  expect(api.stopPortForwardRule).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]').textContent).toBe(
    "Authentication rejected",
  );
});

it("does not replace a published new rule with an older in-flight list response", async () => {
  const pending = deferred();
  api.getPortForwardRules.mockReturnValueOnce(pending.promise);
  await mount();
  await act(async () => notify(snapshot([rule])));
  await act(async () => pending.resolve(snapshot()));
  expect(host.textContent).toContain(rule.name);
  expect(host.textContent).toContain("user@host:22");
  expect(button("portForwarding.start").disabled).toBe(false);
});

it.each(["192.0.2.10", "2001:db8::10", "server.internal"])(
  "fills the local target from the structured SSH host %s and saves it",
  async (sshHost) => {
    api.getPortForwardActiveSessions.mockResolvedValue([
      {
        tabId: "ssh:one",
        host: sshHost,
        label: "Display name only",
        port: 2222,
      },
    ]);
    await mount({ sessionContext: { host: "user@display-name:2222" } });
    await click("portForwarding.addRule");
    expect(field("portForwarding.targetHost").value).toBe(sshHost);
    expect(field("portForwarding.listenHost").value).toBe("127.0.0.1");
    await input("portForwarding.listenPort", "15432");
    await input("portForwarding.targetPort", "5432");
    await click("common.save");
    expect(api.savePortForwardRule).toHaveBeenCalledWith(
      expect.objectContaining({ remoteHost: sshHost, listenHost: "127.0.0.1" }),
    );
  },
);

it("uses the focused SSH tab, preserves explicit session selection on refresh, and follows new focus", async () => {
  api.getPortForwardActiveSessions.mockResolvedValue([
    { tabId: "ssh:one", host: "one.internal", label: "First", port: 22 },
    { tabId: "ssh:two", host: "two.internal", label: "Second", port: 22 },
    { tabId: "ssh:three", host: "three.internal", label: "Third", port: 22 },
  ]);
  api.getPortForwardRules.mockResolvedValue(snapshot([rule]));
  await mount({ activeTabId: "ssh:two" });
  await click("portForwarding.start");
  expect(api.startPortForwardRule).toHaveBeenLastCalledWith(rule.id, "ssh:two");
  await click("portForwarding.addRule");
  expect(field("portForwarding.targetHost").value).toBe("two.internal");
  await click("common.cancel");
  await select("pf-session-select-label", "ssh:one");
  await click("common.refresh");
  await click("portForwarding.start");
  expect(api.startPortForwardRule).toHaveBeenLastCalledWith(rule.id, "ssh:one");
  await click("portForwarding.addRule");
  expect(field("portForwarding.targetHost").value).toBe("one.internal");
  await mount({ activeTabId: "ssh:three" });
  expect(field("portForwarding.targetHost").value).toBe("three.internal");
  await click("common.cancel");
});

it.each([false, true])(
  "handles sessions arriving after the form opens, with manual override: %s",
  async (edited) => {
    const pending = deferred();
    api.getPortForwardActiveSessions.mockReturnValueOnce(pending.promise);
    await mount({ activeTabId: "ssh:late" });
    await click("portForwarding.addRule");
    expect(field("portForwarding.targetHost").value).toBe("127.0.0.1");
    if (edited) await input("portForwarding.targetHost", "custom.internal");
    await act(async () =>
      pending.resolve([
        { tabId: "ssh:late", host: "late.internal", label: "Late", port: 22 },
      ]),
    );
    expect(field("portForwarding.targetHost").value).toBe(
      edited ? "custom.internal" : "late.internal",
    );
    await click("common.cancel");
  },
);

it("uses directional defaults for local, remote and SOCKS5 rules", async () => {
  await mount();
  await click("portForwarding.addRule");
  expect(field("portForwarding.targetHost").value).toBe("host");
  await select("pf-type-label", "remote");
  expect(field("portForwarding.targetHost").value).toBe("127.0.0.1");
  await select("pf-type-label", "dynamic");
  expect(field("portForwarding.targetHost")).toBeNull();
  await select("pf-type-label", "local");
  expect(field("portForwarding.targetHost").value).toBe("host");
  expect(field("portForwarding.listenHost").value).toBe("127.0.0.1");
  await click("common.cancel");
});

it.each(["focus", "connected"])(
  "refreshes sessions when %s changes while the panel is already open",
  async (change) => {
    api.getPortForwardActiveSessions.mockResolvedValue([]);
    await mount({ activeTabId: "ssh:one" });
    await click("portForwarding.addRule");
    api.getPortForwardActiveSessions.mockResolvedValue([
      { tabId: "ssh:one", host: "one.internal", label: "First", port: 22 },
      { tabId: "ssh:two", host: "two.internal", label: "Second", port: 22 },
    ]);
    await mount(
      change === "focus"
        ? { activeTabId: "ssh:two" }
        : { activeTabId: "ssh:one", activeSessionConnected: true },
    );
    expect(field("portForwarding.targetHost").value).toBe(
      change === "focus" ? "two.internal" : "one.internal",
    );
    await click("common.cancel");
  },
);

it("preserves manually entered addresses across type, focus and session updates", async () => {
  api.getPortForwardActiveSessions.mockResolvedValue([
    { tabId: "ssh:one", host: "one.internal", label: "First", port: 22 },
    { tabId: "ssh:two", host: "two.internal", label: "Second", port: 22 },
  ]);
  await mount({ activeTabId: "ssh:one" });
  await click("portForwarding.addRule");
  await input("portForwarding.targetHost", "custom.internal");
  await input("portForwarding.listenHost", "localhost");
  await select("pf-type-label", "remote");
  await select("pf-type-label", "local");
  await mount({ activeTabId: "ssh:two" });
  expect(field("portForwarding.targetHost").value).toBe("custom.internal");
  expect(field("portForwarding.listenHost").value).toBe("localhost");
  await click("common.save");
  expect(api.savePortForwardRule).toHaveBeenCalledWith(
    expect.objectContaining({
      remoteHost: "custom.internal",
      listenHost: "localhost",
    }),
  );
  await click("portForwarding.addRule");
  expect(field("portForwarding.targetHost").value).toBe("two.internal");
  await click("common.cancel");
});

it.each(["127.0.0.1", "saved.internal"])(
  "preserves the saved target %s while editing",
  async (remoteHost) => {
    api.getPortForwardRules.mockResolvedValue(
      snapshot([{ ...rule, remoteHost }]),
    );
    await mount();
    await click("portForwarding.edit");
    expect(field("portForwarding.targetHost").value).toBe(remoteHost);
    await select("pf-type-label", "remote");
    expect(field("portForwarding.targetHost").value).toBe(remoteHost);
    await click("common.save");
    expect(api.savePortForwardRule).toHaveBeenCalledWith(
      expect.objectContaining({ id: rule.id, remoteHost }),
    );
  },
);
