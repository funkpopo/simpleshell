// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import Settings from "../../src/renderer/features/settings/Settings.jsx";
import ConnectionManager from "../../src/renderer/features/connections/ConnectionManager.jsx";
import OpenSSHImportDialog from "../../src/renderer/features/connections/components/OpenSSHImportDialog.jsx";
import { deferred } from "../helpers/reactHarness.js";

const { translate, notifications } = vi.hoisted(() => ({
  translate: (key, options) =>
    options?.count === undefined ? key : `${key}:${options.count}`,
  notifications: { showError: vi.fn(), showSuccess: vi.fn() },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: { language: "en-US" } }),
}));
vi.mock("../../src/renderer/i18n/i18n", () => ({ changeLanguage: vi.fn() }));
vi.mock("../../src/renderer/shared/notifications/NotificationContext", () => ({
  useNotification: () => notifications,
}));

let mounted = [];
async function mount(Component, props) {
  const host = document.createElement("div");
  host.tabIndex = -1;
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => {
    // Give the modal a real focus origin, as a user opening it from a button has.
    host.focus();
    root.render(createElement(Component, props));
  });
  return host;
}
const button = (label) => {
  const found = [...document.querySelectorAll('button, [role="button"]')].find(
    (element) => element.textContent === label,
  );
  expect(found, `Missing button ${label}`).toBeTruthy();
  return found;
};
const click = async (label) => {
  await act(async () => {
    button(label).focus();
    button(label).click();
  });
};
const hostEntry = (alias, options = {}) => ({
  alias,
  host: `${alias}.example.test`,
  username: "user",
  port: 22,
  ...options,
});
const config = (hosts) => ({
  success: true,
  exists: true,
  path: "/home/user/.ssh/config",
  hosts,
  warnings: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.terminalAPI = {
    loadUISettings: vi.fn(async () => ({ language: "en-US" })),
    loadConnections: vi.fn(async () => []),
    saveConnections: vi.fn(async () => true),
    parseOpenSSHConfig: vi.fn(async () => config([hostEntry("server")])),
  };
});
afterEach(async () => {
  for (const { root, host } of mounted.reverse()) {
    await act(() => root.unmount());
    host.remove();
  }
  mounted = [];
});

it("opens the import from Settings and saves against the latest connections with group-aware deduplication", async () => {
  const existing = [
    {
      id: "group",
      type: "group",
      name: "Servers",
      items: [
        {
          id: "existing",
          type: "connection",
          name: "DUPLICATE",
          host: "old.example.test",
        },
      ],
    },
    {
      id: "recent",
      type: "connection",
      name: "Created while import was open",
      host: "recent.example.test",
    },
  ];
  window.terminalAPI.parseOpenSSHConfig.mockResolvedValue(
    config([
      hostEntry("duplicate"),
      hostEntry("new-host", {
        privateKeyPath: "/home/user/.ssh/id_ed25519",
        agentForward: true,
      }),
      hostEntry("deselected"),
      hostEntry("jump-host", { proxyJump: "bastion" }),
    ]),
  );
  await mount(Settings, { open: true, onClose: vi.fn() });
  expect(window.terminalAPI.parseOpenSSHConfig).not.toHaveBeenCalled();
  await click("settings.dataSync.title");
  await click("connectionManager.sshImport");
  expect(
    window.terminalAPI.parseOpenSSHConfig,
  ).toHaveBeenCalledExactlyOnceWith();

  const checkboxes = [
    ...document.querySelectorAll('input[type="checkbox"]'),
  ].filter((element) =>
    element.closest('[aria-labelledby="openssh-import-dialog-title"]'),
  );
  expect(checkboxes).toHaveLength(4);
  expect(checkboxes[3].disabled).toBe(true);
  await act(() => checkboxes[2].click());
  window.terminalAPI.loadConnections.mockResolvedValue(existing);
  const pendingSave = deferred();
  window.terminalAPI.saveConnections.mockReturnValue(pendingSave.promise);
  await click("connectionManager.sshImportConfirm:2");
  expect(window.terminalAPI.loadConnections).toHaveBeenCalledOnce();
  const saved = window.terminalAPI.saveConnections.mock.calls[0][0];
  expect(saved.slice(0, 2)).toEqual(existing);
  expect(saved).toHaveLength(3);
  expect(saved[2]).toMatchObject({
    name: "new-host",
    host: "new-host.example.test",
    protocol: "ssh",
    authType: "privateKey",
    privateKeyPath: "/home/user/.ssh/id_ed25519",
    agentForward: true,
  });
  expect(notifications.showSuccess).not.toHaveBeenCalled();
  expect(button("connectionManager.sshImportConfirm:2").disabled).toBe(true);
  await act(async () => pendingSave.resolve(true));
  expect(notifications.showSuccess).toHaveBeenCalledWith(
    "connectionManager.sshImportSuccessWithSkipped:1",
  );
  expect(document.getElementById("openssh-import-dialog-title")).toBeNull();
});

it("keeps the dialog available for retry when saving fails", async () => {
  const onClose = vi.fn();
  window.terminalAPI.saveConnections.mockResolvedValueOnce({ success: false });
  await mount(OpenSSHImportDialog, { onClose });
  await click("connectionManager.sshImportConfirm:1");
  expect(notifications.showError).toHaveBeenCalledWith(
    "connectionManager.saveFailed",
  );
  expect(notifications.showSuccess).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(button("connectionManager.sshImportConfirm:1").disabled).toBe(false);
  await click("connectionManager.sshImportConfirm:1");
  expect(window.terminalAPI.saveConnections).toHaveBeenCalledTimes(2);
  expect(onClose).toHaveBeenCalledOnce();
});

it("ignores an obsolete parse failure after the settings import dialog closes", async () => {
  const pending = deferred();
  window.terminalAPI.parseOpenSSHConfig.mockReturnValue(pending.promise);
  await mount(Settings, { open: true, onClose: vi.fn() });
  await click("settings.dataSync.title");
  await click("connectionManager.sshImport");
  await click("common.cancel");
  await act(async () => pending.reject(new Error("late read failure")));
  expect(notifications.showError).not.toHaveBeenCalled();
  expect(document.getElementById("openssh-import-dialog-title")).toBeNull();
  expect(window.terminalAPI.saveConnections).not.toHaveBeenCalled();
});

it("leaves the connection manager toolbar with create actions and no OpenSSH import entry", async () => {
  const host = await mount(ConnectionManager, {
    open: true,
    initialConnections: [],
    onClose: vi.fn(),
  });
  expect(host.textContent).toContain("connectionManager.newConnection");
  expect(host.textContent).toContain("connectionManager.newGroup");
  expect(host.textContent).not.toContain("connectionManager.sshImport");
  expect(window.terminalAPI.parseOpenSSHConfig).not.toHaveBeenCalled();
});
