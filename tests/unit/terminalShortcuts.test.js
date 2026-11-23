// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachTerminalShortcutHandlers,
  shouldXtermHandleKeyEvent,
} from "../../src/renderer/features/terminal/runtime/terminalShortcuts.js";

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
  const term = {
    element: termElement,
    options: { fontSize: 14 },
    getSelection: () => selection,
  };
  attachTerminalShortcutHandlers({
    term,
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
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    Object.defineProperty(event, "target", { value: target });
    listeners.get("keydown")(event);
    return event;
  };
  return {
    ui,
    term,
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

  it("supports Ctrl+Shift+C and Ctrl+Shift+V while keeping Ctrl+; and Ctrl+'", async () => {
    window.clipboardAPI = {
      writeText: vi.fn().mockResolvedValue(true),
      readText: vi.fn().mockResolvedValue("shift pasted"),
    };

    const active = attach({
      isActive: true,
      selection: "shift copy text",
      withDom: true,
    });

    const copyEvent = active.press(
      { key: "C", ctrlKey: true, shiftKey: true },
      active.textarea,
    );
    expect(copyEvent.defaultPrevented).toBe(true);
    expect(window.clipboardAPI.writeText).toHaveBeenCalledWith(
      "shift copy text",
    );

    const pasteEvent = active.press(
      { key: "V", ctrlKey: true, shiftKey: true },
      active.textarea,
    );
    expect(pasteEvent.defaultPrevented).toBe(true);
    await Promise.resolve();
    expect(active.handlePasteText).toHaveBeenCalledWith("shift pasted");
  });
});

describe("terminal zoom and PTY interception boundaries", () => {
  it("zooms font size cleanly with Ctrl+=, Ctrl+-, and Ctrl+0", () => {
    const events = [];
    const listener = (e) => events.push(e.detail);
    window.addEventListener("settingsChanged", listener);

    const active = attach({ isActive: true, withDom: true });
    active.press({ key: "=", ctrlKey: true }, active.textarea);
    expect(active.term.options.fontSize).toBe(15);
    active.press({ key: "+", ctrlKey: true, shiftKey: true }, active.textarea);
    expect(active.term.options.fontSize).toBe(16);
    active.press({ key: "-", ctrlKey: true }, active.textarea);
    expect(active.term.options.fontSize).toBe(15);
    active.press({ key: "0", ctrlKey: true }, active.textarea);
    expect(active.term.options.fontSize).toBe(14);

    expect(events.map((d) => d.terminalFontSize)).toEqual([15, 16, 15, 14]);
    window.removeEventListener("settingsChanged", listener);
  });

  it("intercepts Command Palette/Tab/Split/Focus chords while preserving Ctrl+K and Ctrl+C for shells", () => {
    // Ctrl+K (bash/zsh kill-line) and unshifted Ctrl+C (SIGINT) MUST reach PTY
    expect(
      shouldXtermHandleKeyEvent({
        key: "k",
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(true);
    expect(
      shouldXtermHandleKeyEvent({
        key: "c",
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
        metaKey: false,
      }),
    ).toBe(true);

    // Command Palette, splits, tab switching, copy/paste, zoom, and Alt+Arrow must be intercepted
    const intercepted = [
      { key: "P", ctrlKey: true, shiftKey: true },
      { key: "C", ctrlKey: true, shiftKey: true },
      { key: "V", ctrlKey: true, shiftKey: true },
      { key: "T", ctrlKey: true, shiftKey: true },
      { key: "E", ctrlKey: true, shiftKey: true },
      { key: "H", ctrlKey: true, shiftKey: true },
      { key: "W", ctrlKey: true, shiftKey: true },
      { key: "Tab", ctrlKey: true },
      { key: "Tab", ctrlKey: true, shiftKey: true },
      { key: "1", ctrlKey: true },
      { key: "9", ctrlKey: true },
      { key: "=", ctrlKey: true },
      { key: "-", ctrlKey: true },
      { key: "0", ctrlKey: true },
      { key: "ArrowLeft", altKey: true },
      { key: "ArrowRight", altKey: true },
      { key: "ArrowUp", altKey: true },
      { key: "ArrowDown", altKey: true },
      { key: "F1", altKey: true },
    ];
    for (const chord of intercepted) {
      expect(shouldXtermHandleKeyEvent(chord)).toBe(false);
    }
  });
});
