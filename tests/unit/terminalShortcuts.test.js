// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachTerminalShortcutHandlers } from "../../src/renderer/features/terminal/runtime/terminalShortcuts.js";

function attach({
  isActive = true,
  selection = "selected text",
  withDom = false,
} = {}) {
  const listeners = new Map();
  const container = withDom ? document.createElement("div") : null;
  const termElement = withDom ? document.createElement("div") : null;
  const textarea = withDom ? document.createElement("textarea") : null;
  if (withDom) {
    textarea.className = "xterm-helper-textarea";
    termElement.appendChild(textarea);
    container.appendChild(termElement);
    document.body.appendChild(container);
  }

  const handlePasteText = vi.fn();
  const markPasteIfAllowed = vi.fn(() => true);
  const ui = {
    searchTerm: "needle",
    handleSearch: vi.fn(),
    handleSearchPrevious: vi.fn(),
  };
  attachTerminalShortcutHandlers({
    term: {
      element: termElement,
      getSelection: () => selection,
    },
    terminalRef: { current: container },
    lifecycleManager: {
      addEventListener: (target, type, handler) => {
        if (target === document) listeners.set(type, handler);
      },
      setTimeout: () => {},
    },
    isActiveRef: { current: isActive },
    searchAddonRef: { current: {} },
    shortcutUiRef: { current: ui },
    pendingSystemShortcutRecoveryRef: { current: false },
    recoverTerminalInteractionStateRef: { current: () => {} },
    recoverTerminalAfterActivation: () => {},
    imeCompositionActiveRef: { current: false },
    markPasteIfAllowedRef: { current: markPasteIfAllowed },
    handlePasteTextRef: { current: handlePasteText },
    clearTerminalRef: { current: () => {} },
  });
  const press = (init, target = document.body) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
    Object.defineProperty(event, "target", { value: target });
    listeners.get("keydown")(event);
    return event;
  };
  return {
    ui,
    press,
    textarea,
    container,
    handlePasteText,
    markPasteIfAllowed,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  delete window.clipboardAPI;
});

describe("terminal search shortcuts", () => {
  it("F3 finds the next match and Shift+F3 the previous one", () => {
    const { ui, press } = attach();
    press({ key: "F3" });
    expect(ui.handleSearch).toHaveBeenCalledTimes(1);
    expect(ui.handleSearchPrevious).not.toHaveBeenCalled();

    press({ key: "F3", shiftKey: true });
    expect(ui.handleSearchPrevious).toHaveBeenCalledTimes(1);
    expect(ui.handleSearch).toHaveBeenCalledTimes(1);
  });
});

describe("terminal clipboard shortcuts isolation", () => {
  it("copies and pastes only for the active terminal and ignores other inputs", async () => {
    window.clipboardAPI = {
      writeText: vi.fn().mockResolvedValue(true),
      readText: vi.fn().mockResolvedValue("pasted payload"),
    };

    const active = attach({
      isActive: true,
      selection: "active selection",
      withDom: true,
    });
    const inactive = attach({
      isActive: false,
      selection: "stale selection",
      withDom: true,
    });

    // Pressing Ctrl+; / Ctrl+' inside active terminal only triggers active instance
    active.press({ key: ";", ctrlKey: true }, active.textarea);
    inactive.press({ key: ";", ctrlKey: true }, active.textarea);
    expect(window.clipboardAPI.writeText).toHaveBeenCalledTimes(1);
    expect(window.clipboardAPI.writeText).toHaveBeenCalledWith(
      "active selection",
    );

    active.press({ key: "'", ctrlKey: true }, active.textarea);
    inactive.press({ key: "'", ctrlKey: true }, active.textarea);
    await Promise.resolve();
    expect(window.clipboardAPI.readText).toHaveBeenCalledTimes(1);
    expect(active.handlePasteText).toHaveBeenCalledWith("pasted payload");
    expect(inactive.handlePasteText).not.toHaveBeenCalled();

    // Pressing Ctrl+; / Ctrl+' in an unrelated input (e.g. AI chat or search box) must not trigger terminal clipboard
    const externalInput = document.createElement("input");
    document.body.appendChild(externalInput);
    active.press({ key: ";", ctrlKey: true }, externalInput);
    active.press({ key: "'", ctrlKey: true }, externalInput);
    await Promise.resolve();
    expect(window.clipboardAPI.writeText).toHaveBeenCalledTimes(1);
    expect(window.clipboardAPI.readText).toHaveBeenCalledTimes(1);
  });
});
