// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { deferred, renderHook } from "../helpers/reactHarness.js";
import { AppProvider } from "../../src/store/AppContext.jsx";
import useAppTheme from "../../src/components/app/hooks/useAppTheme.js";
import useCredentialSecurity from "../../src/components/app/hooks/useCredentialSecurity.js";
import useReconnect from "../../src/components/app/hooks/useReconnect.js";

const { translate, notify, changeLanguage } = vi.hoisted(() => ({
  translate: (key) => key,
  notify: vi.fn(),
  changeLanguage: vi.fn(),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../src/i18n/i18n", () => ({ changeLanguage }));
vi.mock("../../src/contexts/NotificationContext.jsx", () => ({
  useNotification: () => ({ showError: notify, showInfo: notify }),
}));

let hooks = [];
const mount = async (...args) => {
  const hook = await renderHook(...args);
  hooks.push(hook);
  return hook;
};
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.terminalAPI = {};
});
afterEach(async () => {
  for (const hook of hooks.reverse()) await hook.unmount();
  hooks = [];
  vi.useRealTimers();
});

it("loads appearance once and applies settings events without reading stale settings again", async () => {
  const loaded = deferred();
  window.terminalAPI.loadUISettings = vi.fn(() => loaded.promise);
  const hook = await mount(useAppTheme, {}, AppProvider);
  await act(() =>
    window.dispatchEvent(
      new CustomEvent("settingsChanged", {
        detail: {
          darkMode: true,
          performance: { hardwareAcceleration: false },
        },
      }),
    ),
  );
  await act(async () => {
    loaded.resolve({
      darkMode: false,
      fontSize: 16,
      language: "en",
      sidebarPosition: "left",
      sidebarWidth: 340,
    });
    await loaded.promise;
  });
  expect(hook.current.darkMode).toBe(true);
  expect(hook.current.themeLoading).toBe(false);
  expect(hook.current.uiSettingsLoaded).toBe(true);
  expect(hook.current.sidebarPosition).toBe("left");
  expect(document.documentElement.style.fontSize).toBe("16px");
  expect(window.__hardwareAccelerationEnabled).toBe(false);
  await act(() =>
    window.dispatchEvent(
      new CustomEvent("settingsChanged", { detail: { darkMode: false } }),
    ),
  );
  expect(hook.current.theme.palette.mode).toBe("light");
  expect(document.body.getAttribute("data-mui-color-scheme")).toBe("light");
  expect(window.terminalAPI.loadUISettings).toHaveBeenCalledOnce();
});

it("does not apply an unfinished appearance load after unmount", async () => {
  const loaded = deferred();
  window.terminalAPI.loadUISettings = () => loaded.promise;
  const hook = await mount(useAppTheme, {}, AppProvider);
  await hook.unmount();
  hooks.pop();
  document.documentElement.style.fontSize = "17px";
  await act(async () => {
    loaded.resolve({ fontSize: 25 });
    await loaded.promise;
  });
  expect(document.documentElement.style.fontSize).toBe("17px");
});

it("keeps newer lock status when an earlier credential status request finishes", async () => {
  const loaded = deferred();
  window.terminalAPI.getCredentialSecurityStatus = () => loaded.promise;
  const hook = await mount(useCredentialSecurity);
  await act(() =>
    window.dispatchEvent(
      new CustomEvent("credentialSecurityChanged", {
        detail: {
          status: {
            masterPasswordEnabled: true,
            unlocked: false,
            requiresUnlock: true,
          },
        },
      }),
    ),
  );
  await act(async () => {
    loaded.resolve({
      success: true,
      status: { unlocked: true, requiresUnlock: false },
    });
    await loaded.promise;
  });
  expect(hook.current.credentialSecurityStatus.requiresUnlock).toBe(true);
  window.terminalAPI.unlockCredentialStore = vi
    .fn()
    .mockResolvedValueOnce({ success: false, error: "Invalid master password" })
    .mockResolvedValueOnce({ success: true });
  await act(() => hook.current.handleUnlockCredentialStore("incorrect"));
  expect(hook.current.masterPasswordError).toBe(
    "masterPassword.invalidPassword",
  );
  expect(hook.current.credentialSecurityStatus.requiresUnlock).toBe(true);
  await act(() => hook.current.handleUnlockCredentialStore("correct"));
  expect(hook.current.credentialSecurityStatus.requiresUnlock).toBe(false);
  expect(hook.current.unlockingCredentialStore).toBe(false);
});

it("ignores closed sessions and releases reconnect listeners and countdown timers", async () => {
  vi.useFakeTimers();
  const listeners = {};
  const cleanups = [];
  for (const name of [
    "onReconnectStart",
    "onReconnectProgress",
    "onTabConnectionStatus",
  ]) {
    window.terminalAPI[name] = (listener) => {
      listeners[name] = listener;
      const cleanup = vi.fn();
      cleanups.push(cleanup);
      return cleanup;
    };
  }
  const props = {
    tabs: [{ id: "ssh-a", type: "ssh" }],
    splitLayouts: {},
    tabContextMenu: { tabId: "ssh-a", mouseY: 12 },
  };
  const hook = await mount(useReconnect, props);
  await act(() =>
    listeners.onReconnectStart(null, {
      tabId: "ssh-a",
      attempts: 1,
      nextRetryAt: Date.now() + 5000,
    }),
  );
  expect(hook.current.reconnectStateByTabId["ssh-a"].state).toBe(
    "reconnecting",
  );
  await act(() =>
    listeners.onReconnectProgress(null, { tabId: "ssh-a", delay: 5000 }),
  );
  expect(vi.getTimerCount()).toBe(1);
  const before = hook.current.reconnectNow;
  await act(() => vi.advanceTimersByTime(1000));
  expect(hook.current.reconnectNow).toBeGreaterThan(before);
  await act(() =>
    listeners.onTabConnectionStatus({
      tabId: "ssh-a",
      connectionStatus: { isConnected: true, connectionType: "SSH" },
    }),
  );
  expect(hook.current.reconnectStateByTabId["ssh-a"]).toBeUndefined();
  expect(hook.current.connectionStatusByTabId["ssh-a"].isConnected).toBe(true);
  await hook.rerender({ ...props, tabs: [] });
  await act(() => listeners.onReconnectStart(null, { tabId: "ssh-a" }));
  expect(hook.current.reconnectStateByTabId).toEqual({});
  expect(hook.current.connectionStatusByTabId).toEqual({});
  await hook.unmount();
  hooks.pop();
  expect(cleanups.every((cleanup) => cleanup.mock.calls.length === 1)).toBe(
    true,
  );
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps a newer lock event when an earlier unlock command completes", async () => {
  const unlock = deferred();
  window.terminalAPI.unlockCredentialStore = () => unlock.promise;
  const hook = await mount(useCredentialSecurity);
  let request;
  await act(() => {
    request = hook.current.handleUnlockCredentialStore("password");
  });
  await act(() =>
    window.dispatchEvent(
      new CustomEvent("credentialSecurityChanged", {
        detail: {
          status: {
            masterPasswordEnabled: true,
            unlocked: false,
            requiresUnlock: true,
          },
        },
      }),
    ),
  );
  await act(async () => {
    unlock.resolve({
      success: true,
      status: {
        masterPasswordEnabled: true,
        unlocked: true,
        requiresUnlock: false,
      },
    });
    await request;
  });
  expect(hook.current.credentialSecurityStatus.requiresUnlock).toBe(true);
  expect(hook.current.unlockingCredentialStore).toBe(false);
});

it("invalidates an older status read as soon as a lock command starts", async () => {
  const status = deferred();
  const lock = deferred();
  window.terminalAPI.getCredentialSecurityStatus = () => status.promise;
  window.terminalAPI.lockCredentialStore = () => lock.promise;
  const hook = await mount(useCredentialSecurity);
  let request;
  await act(() => {
    request = hook.current.handleLockApp();
  });
  await act(async () => {
    lock.resolve({ success: true });
    await request;
    status.resolve({
      success: true,
      status: { unlocked: true, requiresUnlock: false },
    });
    await status.promise;
  });
  expect(hook.current.credentialSecurityStatus.requiresUnlock).toBe(true);
});
