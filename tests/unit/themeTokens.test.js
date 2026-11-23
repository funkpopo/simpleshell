// @vitest-environment jsdom
import { afterEach, beforeAll, describe, it, expect, vi } from "vitest";
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import Tabs from "@mui/material/Tabs";
import { ThemeProvider } from "@mui/material/styles";
import { createUnifiedTheme } from "../../src/renderer/theme/index.js";
import {
  getThemeTokens,
  buildThemeCss,
  installThemeVariables,
} from "../../src/shared/themeTokens.js";
import {
  getStartupBackgroundColor,
  applyStartupThemeToDocument,
  clearStartupThemeBootstrap,
} from "../../src/shared/startupTheme.js";
import { Z_INDEX } from "../../src/shared/constants/zIndex.js";
import {
  DEFAULT_TERMINAL_THEME,
  TERMINAL_THEME_OPTIONS,
  TERMINAL_THEME_PRESETS,
  getTerminalTheme,
  getTerminalThemePreset,
  normalizeTerminalThemeId,
} from "../../src/renderer/features/terminal/model/terminalTheme.js";
import {
  createDefaultUISettings,
  normalizeTerminalUiSettings,
} from "../../src/shared/settings/uiSettingsDefaults.js";
import configSchemas from "../../src/main/settings/configSchemas.js";
import createApplicationSettings from "../../src/main/settings/domains/applicationSettings.js";
import loadSettingsSnapshot from "../../src/renderer/features/settings/lib/loadSettingsSnapshot.js";
import TerminalSettings from "../../src/renderer/features/settings/sections/TerminalSettings.jsx";
import { NotificationProvider } from "../../src/renderer/shared/notifications/NotificationContext.jsx";
import CustomTab, {
  resolveConnectionColorTag,
} from "../../src/renderer/app/components/CustomTab.jsx";
import SessionTab from "../../src/renderer/app/SessionTab.jsx";
import { useTerminalSettingsSync } from "../../src/renderer/features/terminal/hooks/useTerminalSettingsSync.js";
import { terminalCache } from "../../src/renderer/features/terminal/runtime/terminalSessionStore.js";

const mockTerminalInstances = {};

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    }),
  };
});

vi.mock("../../src/renderer/app/state/AppContext.jsx", () => ({
  useTerminalSelector: (selector) => selector(mockTerminalInstances),
  useReconnectSelector: (selector) => selector({ reconnectStateByTabId: {} }),
  useDragSelector: (selector) =>
    selector({
      draggedTabIndex: null,
      dragOverTabIndex: null,
      dragInsertPosition: null,
    }),
}));

const ANSI_16_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

function parseHexChannel(hex, start) {
  const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
  return value <= 0.03928
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const r = parseHexChannel(hex, 1);
  const g = parseHexChannel(hex, 3);
  const b = parseHexChannel(hex, 5);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA, hexB) {
  const l1 = relativeLuminance(hexA);
  const l2 = relativeLuminance(hexB);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

let mountedRoot = null;
let mountedHost = null;

async function mountIntoDocument(element) {
  if (!mountedHost) {
    mountedHost = document.createElement("div");
    document.body.appendChild(mountedHost);
    mountedRoot = createRoot(mountedHost);
  }
  await act(async () => {
    mountedRoot.render(element);
  });
  return mountedHost;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (mountedRoot) {
    await act(async () => mountedRoot.unmount());
    mountedRoot = null;
  }
  mountedHost?.remove();
  mountedHost = null;
  for (const key of Object.keys(mockTerminalInstances)) {
    delete mockTerminalInstances[key];
  }
});

describe("shared visual tokens", () => {
  it("retains distinct light and dark surfaces", () => {
    expect(getThemeTokens(false)["--color-bg-default"]).not.toBe(
      getThemeTokens(true)["--color-bg-default"],
    );
    expect(getThemeTokens(false)["--color-text-primary"]).not.toBe(
      getThemeTokens(true)["--color-text-primary"],
    );
  });
  it.each([false, true])(
    "keeps CSS, MUI and the first frame aligned in dark mode %s",
    (dark) => {
      const tokens = getThemeTokens(dark);
      const theme = createUnifiedTheme(dark);
      expect(theme.palette.background.default).toBe(
        tokens["--color-bg-default"],
      );
      expect(theme.palette.primary.main).toBe(tokens["--color-primary-main"]);
      expect(theme.palette.success.main).toBe(tokens["--color-success"]);
      expect(getStartupBackgroundColor(dark)).toBe(
        theme.palette.background.default,
      );
      expect(theme.zIndex.modal).toBe(Z_INDEX.modal);
      expect(buildThemeCss()).toContain(
        `--color-bg-default:${theme.palette.background.default};`,
      );
    },
  );
  it("installs one token sheet and keeps it after startup cleanup", () => {
    installThemeVariables(document);
    applyStartupThemeToDocument(
      { darkMode: true, backgroundColor: getStartupBackgroundColor(true) },
      document,
    );
    installThemeVariables(document);
    clearStartupThemeBootstrap(document);
    expect(document.querySelectorAll("#ss-theme-tokens")).toHaveLength(1);
    expect(document.getElementById("ss-theme-tokens").textContent).toContain(
      `--z-lockscreen:${Z_INDEX.lockscreen};`,
    );
    expect(Z_INDEX.dragGhost).toBeLessThan(Z_INDEX.modal);
    expect(Z_INDEX.paneDropOverlay).toBeLessThan(Z_INDEX.floatWindow);
  });
});

describe("terminal color theme presets", () => {
  it("defines 10 curated high-contrast ANSI 16-color presets", () => {
    expect(TERMINAL_THEME_OPTIONS).toHaveLength(10);
    expect(TERMINAL_THEME_PRESETS.map((preset) => preset.id)).toEqual(
      TERMINAL_THEME_OPTIONS,
    );

    for (const preset of TERMINAL_THEME_PRESETS) {
      expect(preset.swatch.ansi).toHaveLength(6);
      const modes =
        preset.id === DEFAULT_TERMINAL_THEME ? ["dark", "light"] : ["dark"];
      for (const mode of modes) {
        const theme = getTerminalTheme(mode, preset.id);
        expect(theme.background).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(theme.foreground).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(theme.cursor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(theme.selectionBackground).toBeTruthy();
        expect(theme.scrollbarSliderBackground).toBeTruthy();
        for (const ansiKey of ANSI_16_KEYS) {
          expect(theme[ansiKey]).toMatch(/^#[0-9a-fA-F]{6}$/);
        }
        expect(
          contrastRatio(theme.foreground, theme.background),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("preserves historical default-auto colors and falls back safely on unknown IDs", () => {
    expect(getTerminalTheme("light", DEFAULT_TERMINAL_THEME).background).toBe(
      "#f6f8fa",
    );
    const defaultDark = getTerminalTheme("dark", DEFAULT_TERMINAL_THEME);
    expect(defaultDark.background).toBe("#1e1e1e");
    expect(defaultDark.selectionBackground).toBe("rgba(212, 253, 62, 0.49)");

    expect(normalizeTerminalThemeId("non-existent-theme")).toBe(
      DEFAULT_TERMINAL_THEME,
    );
    expect(getTerminalThemePreset("non-existent-theme").id).toBe(
      DEFAULT_TERMINAL_THEME,
    );
    expect(getTerminalTheme("dark", "non-existent-theme")).toEqual(defaultDark);
    expect(getTerminalTheme("dracula")).toEqual(
      getTerminalTheme("dark", "dracula"),
    );
  });
});

describe("terminal theme persistence and live switching", () => {
  it("validates terminalTheme in uiSettings schema and normalizes corrupted disk values", () => {
    const { validators } = configSchemas.createConfigValidators();
    const validSettings = {
      ...createDefaultUISettings(),
      terminalTheme: "tokyo-night",
    };
    expect(validators.uiSettings(validSettings)).toBe(true);
    expect(
      validators.uiSettings({
        ...createDefaultUISettings(),
        terminalTheme: "unknown-theme",
      }),
    ).toBe(false);

    expect(
      normalizeTerminalUiSettings({ terminalTheme: "catppuccin-latte" })
        .terminalTheme,
    ).toBe("catppuccin-latte");
    expect(
      normalizeTerminalUiSettings({ terminalTheme: "invalid" }).terminalTheme,
    ).toBe(DEFAULT_TERMINAL_THEME);

    const diskConfig = {
      uiSettings: {
        terminalTheme: "corrupted-legacy-value",
      },
    };
    const appSettings = createApplicationSettings(
      {
        _loadSection: (_label, { read }) => read(diskConfig),
        _saveSection: (_label, { write }) => write(diskConfig),
        _validate: (key, data) => validators[key](data),
      },
      {
        filterCommandHistory: (list) => list,
        decompressCommandHistory: (list) => list,
        compressCommandHistory: (list) => list,
      },
    );

    const loaded = appSettings.loadUISettings();
    expect(loaded.terminalTheme).toBe(DEFAULT_TERMINAL_THEME);
    expect(
      appSettings.saveUISettings({ terminalTheme: "gruvbox-dark" }),
    ).not.toBe(false);
    expect(diskConfig.uiSettings.terminalTheme).toBe("gruvbox-dark");
    expect(appSettings.saveUISettings({ terminalTheme: "bogus" })).toBe(false);
  });

  it("renders visual swatches in TerminalSettings and exposes chosen preset", async () => {
    const snapshot = await loadSettingsSnapshot();
    const initialValues = {
      ...snapshot,
      terminalTheme: "dracula",
    };
    const settingsRef = createRef();

    const container = await mountIntoDocument(
      createElement(
        ThemeProvider,
        { theme: createUnifiedTheme(true) },
        createElement(
          NotificationProvider,
          null,
          createElement(TerminalSettings, {
            ref: settingsRef,
            open: false,
            initialValues,
          }),
        ),
      ),
    );

    const radios = [...container.querySelectorAll('[role="radio"]')];
    expect(radios).toHaveLength(10);
    expect(settingsRef.current.getUISettings().terminalTheme).toBe("dracula");

    const nordOption = radios.find((el) =>
      el.textContent?.includes("settings.terminalThemePresets.nord"),
    );
    expect(nordOption).toBeTruthy();
    expect(nordOption.getAttribute("aria-checked")).toBe("false");

    await act(async () => {
      nordOption.click();
    });
    expect(nordOption.getAttribute("aria-checked")).toBe("true");
    expect(settingsRef.current.getUISettings().terminalTheme).toBe("nord");
  });

  it("updates cached xterm options.theme on settingsChanged and simpleshell:setTerminalTheme", async () => {
    const sessionKey = "theme-sync-test-session";
    terminalCache[sessionKey] = {
      options: {
        cursorStyle: "block",
        cursorBlink: true,
        letterSpacing: 0,
        fontWeightBold: 700,
        copyOnSelect: false,
        rightClickSelectsWord: false,
        macOptionIsMeta: false,
        theme: getTerminalTheme("dark", DEFAULT_TERMINAL_THEME),
      },
      __simpleShellMiddleClickPaste: true,
    };

    const eventManager = {
      addEventListener(target, type, handler) {
        target.addEventListener(type, handler);
        return () => target.removeEventListener(type, handler);
      },
      setTimeout: vi.fn(),
    };
    const themeModeRef = { current: "dark" };
    const terminalThemeRef = { current: DEFAULT_TERMINAL_THEME };

    function SyncHarness() {
      useTerminalSettingsSync({
        sessionKey,
        terminalRef: { current: null },
        termRef: { current: null },
        fitAddonRef: { current: null },
        scrollbackUsageTrackerRef: { current: null },
        performanceMonitorRef: { current: null },
        webglRendererEnabledRef: { current: false },
        setWebglRendererEnabled: vi.fn(),
        tryEnableWebglRenderer: vi.fn(),
        disableWebglRenderer: vi.fn(),
        eventManager,
        scheduleTerminalLayoutSyncRef: { current: vi.fn() },
        themeModeRef,
        terminalThemeRef,
      });
      return null;
    }

    try {
      await mountIntoDocument(createElement(SyncHarness));

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("settingsChanged", {
            detail: { terminalTheme: "dracula" },
          }),
        );
      });
      expect(terminalThemeRef.current).toBe("dracula");
      expect(terminalCache[sessionKey].options.theme).toEqual(
        getTerminalTheme("dark", "dracula"),
      );

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("simpleshell:setTerminalTheme", {
            detail: { themeId: "solarized-light" },
          }),
        );
      });
      expect(terminalThemeRef.current).toBe("solarized-light");
      expect(terminalCache[sessionKey].options.theme).toEqual(
        getTerminalTheme("dark", "solarized-light"),
      );
    } finally {
      delete terminalCache[sessionKey];
    }
  });
});

describe("per-connection colorTag tab badges", () => {
  it("resolves named and hex color tags and renders badges on non-welcome tabs", async () => {
    expect(resolveConnectionColorTag("emerald")).toBe("#10b981");
    expect(resolveConnectionColorTag("  #22c55e  ")).toBe("#22c55e");
    expect(resolveConnectionColorTag("not-a-color")).toBeNull();

    const theme = createUnifiedTheme(false);
    const container = await mountIntoDocument(
      createElement(
        ThemeProvider,
        { theme },
        createElement(
          Tabs,
          { value: 1 },
          createElement(CustomTab, {
            label: "Prod",
            value: 1,
            index: 1,
            tabId: "tab-1",
            colorTag: "red",
          }),
        ),
      ),
    );
    expect(
      container.querySelector('[data-connection-color-tag="#ef4444"]'),
    ).not.toBeNull();

    await mountIntoDocument(
      createElement(
        ThemeProvider,
        { theme },
        createElement(
          Tabs,
          { value: 1 },
          createElement(CustomTab, {
            label: "NoTag",
            value: 1,
            index: 1,
            tabId: "tab-1",
          }),
        ),
      ),
    );
    expect(container.querySelector("[data-connection-color-tag]")).toBeNull();

    mockTerminalInstances["tab-ssh-config"] = {
      name: "Staging",
      colorTag: "cyan",
    };

    await mountIntoDocument(
      createElement(
        ThemeProvider,
        { theme },
        createElement(
          Tabs,
          { value: 1 },
          createElement(SessionTab, {
            value: 1,
            index: 1,
            tab: { id: "tab-ssh", label: "Staging" },
            splitLayouts: {},
            paneRegistry: {},
            diskAlert: null,
          }),
        ),
      ),
    );
    expect(
      container.querySelector('[data-connection-color-tag="#06b6d4"]'),
    ).not.toBeNull();

    await mountIntoDocument(
      createElement(
        ThemeProvider,
        { theme },
        createElement(
          Tabs,
          { value: 0 },
          createElement(SessionTab, {
            value: 0,
            index: 0,
            tab: { id: "welcome", label: "Welcome", colorTag: "red" },
            splitLayouts: {},
            paneRegistry: {},
            diskAlert: null,
          }),
        ),
      ),
    );
    expect(container.querySelector("[data-connection-color-tag]")).toBeNull();
  });
});
