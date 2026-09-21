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
vi.mock("../../src/renderer/i18n/i18n", () => ({ changeLanguage: vi.fn() }));
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
