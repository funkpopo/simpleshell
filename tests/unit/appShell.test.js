// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  AppProvider,
  useAppStore,
  useReconnectStore,
} from "../../src/renderer/app/state/AppContext.jsx";
import { actions } from "../../src/renderer/app/state/appReducer.js";
import AppShell from "../../src/renderer/app/AppShell.jsx";
import { deferred } from "../helpers/reactHarness.js";
import { processCache } from "../../src/renderer/features/terminal/runtime/terminalSessionStore.js";
import {
  clearWorkingDirectorySession,
  setTerminalWorkingDirectory,
} from "../../src/renderer/shared/state/workingDirectoryStore.js";

const { translate, notifications, language, welcomeRender } = vi.hoisted(
  () => ({
    welcomeRender: vi.fn(),
    translate: (key) => key,
    notifications: {
      showError: vi.fn(),
      showInfo: vi.fn(),
      showSuccess: vi.fn(),
      showWarning: vi.fn(),
    },
    language: { language: "en" },
  }),
);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: language }),
}));
vi.mock("../../src/renderer/i18n/i18n", () => ({
  default: { t: (key) => key },
  changeLanguage: vi.fn(),
}));
vi.mock(
  "../../src/renderer/shared/notifications/NotificationContext.jsx",
  () => ({
    useNotification: () => notifications,
  }),
);
vi.mock("../../src/renderer/app/LazyComponents.jsx", () => ({
  AboutDialogWithSuspense: () => null,
  ConnectionManagerWithSuspense: () => null,
  FileManagerWithSuspense: () => null,
  FirstRunDialogWithSuspense: () => null,
  ResourceMonitorWithSuspense: () => null,
  IPAddressQueryWithSuspense: () => null,
  SecurityToolsWithSuspense: () => null,
  PortForwardingDialogWithSuspense: () => null,
  SettingsWithSuspense: () => null,
  CommandHistoryWithSuspense: () => null,
  ShortcutCommandsWithSuspense: () => null,
  LocalTerminalSidebarWithSuspense: () => null,
  WebTerminalWithSuspense: () => null,
  smartPreload: {
    cancelAllScheduled() {},
    scheduleComponent() {},
    cancelScheduledComponent() {},
  },
}));
vi.mock("../../src/renderer/features/welcome/WelcomePage.jsx", () => ({
  default: () => {
    welcomeRender();
    return createElement("div", { "data-testid": "welcome" });
  },
}));
vi.mock("../../src/renderer/features/ai/AIChatWorkspace.jsx", () => ({
  default: () => null,
}));
vi.mock(
  "../../src/renderer/features/terminal/components/TerminalWorkspace.jsx",
  () => ({
    default: () => null,
  }),
);
vi.mock(
  "../../src/renderer/features/transfers/GlobalTransferFloat.jsx",
  () => ({
    default: () => null,
  }),
);
vi.mock("../../src/renderer/features/transfers/GlobalTransferBar.jsx", () => ({
  default: () => null,
}));
vi.mock("../../src/renderer/features/transfers/TransferSidebar.jsx", () => ({
  default: () => null,
}));

it("subscribes to authentication during appearance loading and cleans up once", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const settings = deferred();
  const cleanup = vi.fn();
  window.terminalAPI = {
    loadUISettings: vi.fn(() => settings.promise),
    getCredentialSecurityStatus: vi.fn(async () => ({
      status: { requiresUnlock: false },
    })),
    loadConnections: vi.fn(async () => []),
    getTopConnections: vi.fn(async () => []),
    onSSHAuthRequest: vi.fn(() => cleanup),
    onSftpTransferState: vi.fn(() => () => {}),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(createElement(AppProvider, null, createElement(AppShell))),
    );
    expect(window.terminalAPI.onSSHAuthRequest).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="welcome"]')).toBeNull();
    await act(async () =>
      settings.resolve({ darkMode: false, onboarding: { completed: true } }),
    );
    expect(host.querySelector('[data-testid="welcome"]')).not.toBeNull();
    expect(window.terminalAPI.onSSHAuthRequest).toHaveBeenCalledOnce();
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
  expect(cleanup).toHaveBeenCalledOnce();
});

it("renders AppShell across startup, theme changes and credential lock events", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.terminalAPI = {
    loadUISettings: vi.fn(async () => ({
      darkMode: false,
      onboarding: { completed: true },
    })),
    getCredentialSecurityStatus: vi.fn(async () => ({
      success: true,
      status: { requiresUnlock: false },
    })),
    loadConnections: vi.fn(async () => []),
    getTopConnections: vi.fn(async () => []),
    onSftpTransferState: vi.fn(() => () => {}),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let store;
  let reconnect;
  function Commands() {
    store = useAppStore();
    reconnect = useReconnectStore();
    return null;
  }
  try {
    await act(async () =>
      root.render(
        createElement(
          AppProvider,
          null,
          createElement(Commands),
          createElement(AppShell),
        ),
      ),
    );
    expect(host.querySelector('[data-testid="welcome"]')).not.toBeNull();
    const initialRenders = welcomeRender.mock.calls.length;
    // Dialogs and sidebar composition subscribe at their own boundaries.
    await act(() => {
      store.dispatch(actions.setAboutDialogOpen(true));
      store.dispatch(actions.setSettingsDialogOpen(true));
      store.dispatch(actions.setConnectionManagerOpen(true));
      store.dispatch(actions.setResourceMonitorOpen(true));
    });
    expect(welcomeRender).toHaveBeenCalledTimes(initialRenders);
    await act(() => {
      store.dispatch(actions.setAboutDialogOpen(false));
      store.dispatch(actions.setSettingsDialogOpen(false));
      store.dispatch(actions.setConnectionManagerOpen(false));
      store.dispatch(actions.setResourceMonitorOpen(false));
    });
    expect(welcomeRender).toHaveBeenCalledTimes(initialRenders);
    for (let index = 0; index < 5; index++) {
      await act(() => {
        store.dispatch(actions.setDraggedTab(1));
        store.dispatch(actions.setDragOverTab(index));
        store.dispatch(actions.setDragInsertPosition("before"));
        store.dispatch(actions.setPaneDropZone("left"));
        store.dispatch(actions.setPaneDragId("ssh-a"));
        store.dispatch(actions.setPaneDragOverId("ssh-b"));
        store.dispatch(
          actions.setTerminalInstances({ "ssh-a-refresh": index }),
        );
        reconnect.setReconnectStateByTabId({
          "ssh-a": { state: "pending", attempts: index },
        });
      });
    }
    expect(welcomeRender).toHaveBeenCalledTimes(initialRenders);
    await act(() => store.dispatch(actions.resetDragState()));
    // Reordering must read the latest drag snapshot even though the shell did
    // not render when the drag source and insertion point changed.
    await act(() =>
      store.dispatch(
        actions.setTabs([
          store.getState().tabs[0],
          { id: "ssh-a", type: "ssh", label: "A" },
          { id: "ssh-b", type: "ssh", label: "B" },
        ]),
      ),
    );
    const beforeDrag = welcomeRender.mock.calls.length;
    await act(() => {
      store.dispatch(actions.setDraggedTab(1));
      store.dispatch(actions.setDragOverTab(2));
      store.dispatch(actions.setDragInsertPosition("after"));
    });
    expect(welcomeRender).toHaveBeenCalledTimes(beforeDrag);
    const target = host.querySelectorAll('[role="tab"]')[2];
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: { getData: () => "" },
    });
    await act(() => target.dispatchEvent(drop));
    expect(store.getState().tabs.map((tab) => tab.id)).toEqual([
      "welcome",
      "ssh-b",
      "ssh-a",
    ]);
    expect(store.getState().draggedTabIndex).toBeNull();
    expect(store.getState().dragInsertPosition).toBeNull();
    await act(() =>
      window.dispatchEvent(
        new CustomEvent("settingsChanged", { detail: { darkMode: true } }),
      ),
    );
    expect(document.body.getAttribute("data-mui-color-scheme")).toBe("dark");
    await act(() =>
      window.dispatchEvent(
        new CustomEvent("credentialSecurityChanged", {
          detail: {
            status: {
              masterPasswordEnabled: true,
              requiresUnlock: true,
              unlocked: false,
            },
          },
        }),
      ),
    );
    expect(document.body.textContent).toContain("masterPassword");
  } finally {
    await act(() => root.unmount());
    host.remove();
  }
});

it("persists Command Palette terminal themes, resolves snippet templates, and guards workspace shortcuts in inputs", async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const saveUISettings = vi.fn(async () => ({ success: true }));
  const sendToProcess = vi.fn();
  const themeEvents = [];
  const syncCommandEvents = [];
  const onThemeEvent = (e) => themeEvents.push(e.detail);
  const onSyncCommand = (e) => syncCommandEvents.push(e.detail);
  window.addEventListener("simpleshell:setTerminalTheme", onThemeEvent);
  window.addEventListener("syncTerminalCommand", onSyncCommand);

  window.terminalAPI = {
    loadUISettings: vi.fn(async () => ({
      darkMode: true,
      onboarding: { completed: true },
    })),
    saveUISettings,
    getCredentialSecurityStatus: vi.fn(async () => ({
      success: true,
      status: { requiresUnlock: false },
    })),
    loadConnections: vi.fn(async () => []),
    getTopConnections: vi.fn(async () => []),
    detectLocalTerminals: vi.fn(async () => []),
    getShortcutCommands: vi.fn(async () => ({
      success: true,
      data: {
        commands: [
          {
            id: "snip-builtin",
            name: "Inspect CWD",
            command: "cd {{cwd}} && echo {{host}}:{{port}} {{user}}",
          },
          {
            id: "snip-param",
            name: "Restart Service",
            command: "systemctl restart {{service}}",
          },
        ],
      },
    })),
    sendToProcess,
    onSftpTransferState: vi.fn(() => () => {}),
  };

  processCache["ssh-1"] = 101;
  setTerminalWorkingDirectory("ssh-1", "/srv/app");

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let store;
  function Commands() {
    store = useAppStore();
    return null;
  }

  try {
    await act(async () =>
      root.render(
        createElement(
          AppProvider,
          null,
          createElement(Commands),
          createElement(AppShell),
        ),
      ),
    );

    await act(() => {
      store.dispatch(
        actions.setTabs([
          store.getState().tabs[0],
          { id: "ssh-1", type: "ssh", label: "Prod-1" },
          { id: "ssh-2", type: "ssh", label: "Prod-2" },
        ]),
      );
      store.dispatch(
        actions.setTerminalInstances({
          "ssh-1-config": {
            host: "prod-1.internal",
            username: "ops",
            port: 2222,
          },
          "ssh-1-processId": 101,
        }),
      );
      store.dispatch(actions.setCurrentTab(1));
    });

    // Workspace Ctrl+2 and Alt+ArrowRight must be ignored inside external inputs
    const externalInput = document.createElement("input");
    document.body.appendChild(externalInput);
    const ctrl2Event = new KeyboardEvent("keydown", {
      key: "2",
      code: "Digit2",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(ctrl2Event, "target", { value: externalInput });
    await act(async () => {
      window.dispatchEvent(ctrl2Event);
    });
    expect(ctrl2Event.defaultPrevented).toBe(false);
    expect(store.getState().currentTab).toBe(1);

    const altArrowEvent = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(altArrowEvent, "target", { value: externalInput });
    await act(async () => {
      window.dispatchEvent(altArrowEvent);
    });
    expect(altArrowEvent.defaultPrevented).toBe(false);
    externalInput.remove();

    // Ctrl+2 on .xterm-helper-textarea still switches tabs
    const xtermHelper = document.createElement("textarea");
    xtermHelper.className = "xterm-helper-textarea";
    document.body.appendChild(xtermHelper);
    const xtermCtrl2 = new KeyboardEvent("keydown", {
      key: "2",
      code: "Digit2",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(xtermCtrl2, "target", { value: xtermHelper });
    await act(async () => {
      window.dispatchEvent(xtermCtrl2);
    });
    expect(xtermCtrl2.defaultPrevented).toBe(true);
    expect(store.getState().currentTab).toBe(1);
    xtermHelper.remove();

    // Open Command Palette via Ctrl+Shift+P and switch terminal theme to Nord
    const openPalette = async () => {
      host.querySelector("button")?.focus();
      await act(async () => {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "P",
            ctrlKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      await act(async () => {
        await import("../../src/renderer/app/components/CommandPaletteDialog.jsx");
        await new Promise((resolve) => setTimeout(resolve, 25));
      });
    };

    const setPaletteQuery = async (value) => {
      const input = document.body.querySelector(
        'input[placeholder="commandPalette.placeholder"]',
      );
      expect(input).toBeTruthy();
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        ).set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return input;
    };

    await openPalette();
    const themeInput = await setPaletteQuery("nord");
    await act(async () => {
      themeInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(saveUISettings).toHaveBeenCalledWith({ terminalTheme: "nord" });
    expect(themeEvents).toContainEqual({
      themeId: "nord",
      terminalTheme: "nord",
    });

    // Execute snippet with only built-in session vars -> substitutes & sends immediately
    await openPalette();
    const builtinInput = await setPaletteQuery("Inspect CWD");
    await act(async () => {
      builtinInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(syncCommandEvents).toContainEqual(
      expect.objectContaining({
        targetTabId: "ssh-1",
        command: "cd /srv/app && echo prod-1.internal:2222 ops",
        execute: true,
      }),
    );

    // Execute snippet with custom {{service}} -> opens CommandTemplateParamDialog
    await openPalette();
    const paramPaletteInput = await setPaletteQuery("Restart Service");
    await act(async () => {
      paramPaletteInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await act(async () => {
      await import("../../src/renderer/features/terminal/components/CommandTemplateParamDialog.jsx");
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const serviceInput = [...document.querySelectorAll("input")].find((input) =>
      input
        .closest(".MuiFormControl-root")
        ?.querySelector("label")
        ?.textContent?.includes("service"),
    );
    expect(serviceInput).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(serviceInput, "nginx");
      serviceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const confirmRunBtn = [...document.querySelectorAll("button")].find(
      (btn) => btn.textContent === "shortcutCommands.templateConfirmRun",
    );
    expect(confirmRunBtn).toBeTruthy();
    await act(async () => {
      confirmRunBtn.click();
    });
    expect(syncCommandEvents).toContainEqual(
      expect.objectContaining({
        targetTabId: "ssh-1",
        command: "systemctl restart nginx",
        execute: true,
      }),
    );
  } finally {
    window.removeEventListener("simpleshell:setTerminalTheme", onThemeEvent);
    window.removeEventListener("syncTerminalCommand", onSyncCommand);
    delete processCache["ssh-1"];
    clearWorkingDirectorySession("ssh-1");
    await act(() => root.unmount());
    host.remove();
  }
});
