// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { attachTerminalShortcutHandlers } from "../../src/renderer/features/terminal/runtime/terminalShortcuts.js";

function attach() {
  const listeners = new Map();
  const ui = {
    searchTerm: "needle",
    handleSearch: vi.fn(),
    handleSearchPrevious: vi.fn(),
  };
  attachTerminalShortcutHandlers({
    term: { element: null },
    terminalRef: { current: null },
    lifecycleManager: {
      addEventListener: (target, type, handler) => {
        if (target === document) listeners.set(type, handler);
      },
      setTimeout: () => {},
    },
    isActiveRef: { current: true },
    searchAddonRef: { current: {} },
    shortcutUiRef: { current: ui },
    pendingSystemShortcutRecoveryRef: { current: false },
    recoverTerminalInteractionStateRef: { current: () => {} },
    recoverTerminalAfterActivation: () => {},
    imeCompositionActiveRef: { current: false },
    markPasteIfAllowedRef: { current: () => false },
    handlePasteTextRef: { current: () => {} },
    clearTerminalRef: { current: () => {} },
  });
  const press = (init) =>
    listeners.get("keydown")(
      new KeyboardEvent("keydown", { bubbles: true, ...init }),
    );
  return { ui, press };
}

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
