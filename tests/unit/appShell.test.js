// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../../src/store/AppContext.jsx";
import AppShell from "../../src/components/app/AppShell.jsx";

const { translate, notifications, language } = vi.hoisted(() => ({
  translate: (key) => key,
  notifications: {
    showError: vi.fn(),
    showInfo: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
  },
  language: { language: "en" },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: translate, i18n: language }),
}));
vi.mock("../../src/i18n/i18n", () => ({ changeLanguage: vi.fn() }));
vi.mock("../../src/contexts/NotificationContext.jsx", () => ({
  useNotification: () => notifications,
}));
vi.mock("../../src/components/LazyComponents.jsx", () => ({
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
vi.mock("../../src/components/WelcomePage.jsx", () => ({
  default: () => createElement("div", { "data-testid": "welcome" }),
}));
vi.mock("../../src/components/AIChatWorkspace.jsx", () => ({
  default: () => null,
}));
vi.mock("../../src/components/terminal-pane/TerminalWorkspace.jsx", () => ({
  default: () => null,
}));
vi.mock("../../src/components/GlobalTransferFloat.jsx", () => ({
  default: () => null,
}));
vi.mock("../../src/components/GlobalTransferBar.jsx", () => ({
  default: () => null,
}));
vi.mock("../../src/components/TransferSidebar.jsx", () => ({
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
  try {
    await act(async () =>
      root.render(createElement(AppProvider, null, createElement(AppShell))),
    );
    expect(host.querySelector('[data-testid="welcome"]')).not.toBeNull();
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
