// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import Settings from "../../src/renderer/features/settings/Settings.jsx";
import ConnectionManager from "../../src/renderer/features/connections/ConnectionManager.jsx";
import { deferred } from "../helpers/reactHarness.js";

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

let root, host;
async function mount(Component, props) {
  host = document.createElement("div");
  host.tabIndex = -1;
  document.body.appendChild(host);
  root = createRoot(host);
  host.focus();
  await act(async () => root.render(createElement(Component, props)));
}
async function click(label) {
  const button = [...document.querySelectorAll('button,[role="button"]')].find(
    (element) => element.textContent === label,
  );
  expect(button, label).toBeTruthy();
  await act(async () => button.click());
}
function input(label) {
  const field = [...document.querySelectorAll("label")].find(
    (element) => element.textContent.replace(/\s*\*$/, "") === label,
  );
  expect(field, label).toBeTruthy();
  return field.htmlFor
    ? document.getElementById(field.htmlFor)
    : field.querySelector("input");
}
async function type(label, value) {
  const element = input(label);
  await act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.terminalAPI = {
    loadUISettings: vi.fn(async () => ({
      language: "en-US",
      editorFont: "consolas",
    })),
    loadLogSettings: vi.fn(async () => ({
      level: "WARN",
      maxFileSize: 5 * 1024 * 1024,
    })),
    saveUISettings: vi.fn(async () => ({ success: true })),
    saveLogSettings: vi.fn(async () => ({ success: true })),
    saveErrorReportingSettings: vi.fn(async () => ({ success: true })),
    getCredentialSecurityStatus: vi.fn(async () => ({
      success: true,
      status: { masterPasswordEnabled: false },
    })),
    loadConnections: vi.fn(async () => []),
    saveConnections: vi.fn(async () => true),
  };
});
afterEach(async () => {
  if (root) await act(() => root.unmount());
  host?.remove();
  root = null;
});

it("keeps drafts across tabs and commits settings from every section", async () => {
  await mount(Settings, { open: true, onClose: vi.fn() });
  await click("settings.terminalAndLogs");
  await type("settings.logFileSizeLimitLabel", "12");
  await type("settings.backupRetentionLabel", "45");
  await click("settings.general");
  await act(() => input("settings.transferIntegrity").click());
  await click("settings.terminalAndLogs");
  expect(input("settings.logFileSizeLimitLabel").value).toBe("12");
  await click("settings.save");
  expect(window.terminalAPI.saveUISettings).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      editorFont: "consolas",
      backupRetentionDays: 45,
      transferIntegrity: true,
      performance: expect.objectContaining({ imageSupported: true }),
    }),
  );
  expect(window.terminalAPI.saveLogSettings).toHaveBeenCalledWith(
    expect.objectContaining({ maxFileSize: 12 * 1024 * 1024 }),
  );
  expect(notifications.showSuccess).toHaveBeenCalledWith(
    "settings.saveSuccess",
  );
});

it("validates the security tab before saving any other section", async () => {
  await mount(Settings, { open: true, onClose: vi.fn() });
  await click("settings.security.title");
  await act(() => input("settings.security.enable").click());
  await click("settings.general");
  await click("settings.save");
  expect(notifications.showError).toHaveBeenCalledWith(
    "settings.security.passwordRequired",
  );
  expect(window.terminalAPI.saveUISettings).not.toHaveBeenCalled();
});

it("ignores an obsolete settings load after closing and reopening", async () => {
  const pending = deferred();
  window.terminalAPI.loadUISettings.mockReturnValueOnce(pending.promise);
  const props = { open: true, onClose: vi.fn() };
  await mount(Settings, props);
  await act(() =>
    root.render(createElement(Settings, { ...props, open: false })),
  );
  window.terminalAPI.loadUISettings.mockResolvedValue({
    language: "en-US",
    backupRetentionDays: 77,
  });
  await act(async () => root.render(createElement(Settings, props)));
  await act(async () =>
    pending.resolve({ language: "en-US", backupRetentionDays: 2 }),
  );
  await click("settings.save");
  expect(window.terminalAPI.saveUISettings).toHaveBeenCalledWith(
    expect.objectContaining({ backupRetentionDays: 77 }),
  );
});

it("keeps a reopened settings dialog open when an earlier save completes", async () => {
  const pending = deferred();
  const onClose = vi.fn();
  window.terminalAPI.saveUISettings.mockReturnValue(pending.promise);
  await mount(Settings, { open: true, onClose });
  await click("settings.save");
  await click("settings.save");
  expect(window.terminalAPI.saveUISettings).toHaveBeenCalledOnce();
  await act(() =>
    root.render(createElement(Settings, { open: false, onClose })),
  );
  await act(async () =>
    root.render(createElement(Settings, { open: true, onClose })),
  );
  await act(async () => pending.resolve({ success: true }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 550)));
  expect(onClose).not.toHaveBeenCalled();
  expect(notifications.showError).not.toHaveBeenCalled();
});

it("opens an add request and saves through the extracted connection editor", async () => {
  const onConnectionsUpdate = vi.fn();
  await mount(ConnectionManager, {
    open: true,
    onClose: vi.fn(),
    initialConnections: [],
    onConnectionsUpdate,
    createConnectionSignal: 1,
  });
  await type("common.name", "Production");
  await type("connectionManager.hostAddress", "example.test");
  await type("connectionManager.username", "admin");
  await click("common.save");
  expect(window.terminalAPI.saveConnections).toHaveBeenCalledWith([
    expect.objectContaining({
      name: "Production",
      host: "example.test",
      username: "admin",
      protocol: "ssh",
      port: 22,
    }),
  ]);
  expect(onConnectionsUpdate).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ name: "Production" })]),
  );
});

it("keeps an edited group when a new group is saved", async () => {
  const initialConnections = [
    { id: "old", type: "group", name: "Existing", expanded: true, items: [] },
  ];
  await mount(ConnectionManager, {
    open: true,
    onClose: vi.fn(),
    initialConnections,
  });
  await click("connectionManager.newGroup");
  await type("common.name", "New group");
  await click("common.save");
  expect(window.terminalAPI.saveConnections).toHaveBeenCalledWith([
    initialConnections[0],
    expect.objectContaining({ name: "New group", type: "group", items: [] }),
  ]);
});
