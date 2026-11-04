// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import CommandSuggestion from "../../src/renderer/features/terminal/CommandSuggestion.jsx";

const list = (...commands) =>
  commands.map((command) => ({ command, count: 1 }));

let host;
let root;
let terminal;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout; the component scrolls the selected item into view.
  Element.prototype.scrollIntoView ??= () => {};
  terminal = document.createElement("div");
  terminal.tabIndex = 0;
  terminal.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 1000,
    bottom: 760,
    width: 1000,
    height: 760,
    x: 0,
    y: 0,
  });
  document.body.appendChild(terminal);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  terminal.remove();
});

// Cursor on the last rows of the terminal: the popup opens above it, the
// common case for a shell prompt.
const cursorNearBottom = {
  x: 40,
  y: 720,
  cursorHeight: 18,
  cursorBottom: 738,
};

async function render(suggestions, position = cursorNearBottom) {
  await act(async () =>
    root.render(
      createElement(CommandSuggestion, {
        suggestions,
        visible: true,
        position,
        terminalElement: terminal,
        currentInput: "g",
        onSelectSuggestion: () => {},
        onClose: () => {},
      }),
    ),
  );
}

async function press(key) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  await act(async () => terminal.dispatchEvent(event));
  return event;
}

const selected = () =>
  [...document.querySelectorAll("[data-suggestion-index]")]
    .filter((item) => item.getAttribute("aria-selected") === "true")
    .map((item) => item.textContent);

describe("CommandSuggestion keyboard selection", () => {
  it("selects with ArrowDown even when the popup opens above the cursor", async () => {
    await render(list("git status", "git log", "git diff"));

    const up = await press("ArrowUp");
    expect(up.defaultPrevented).toBe(false); // shell history keeps ArrowUp
    expect(selected()).toEqual([]);

    const down = await press("ArrowDown");
    expect(down.defaultPrevented).toBe(true);
    expect(selected()).toEqual(["git status"]);
    await press("ArrowDown");
    expect(selected()).toEqual(["git log"]);
    await press("ArrowUp");
    expect(selected()).toEqual(["git status"]);
  });

  it("lists items top to bottom so ArrowDown moves the highlight down", async () => {
    await render(list("git status", "git log"));
    const listbox = document.querySelector('[role="listbox"]');
    expect(getComputedStyle(listbox).flexDirection).toBe("column");
  });

  it("keeps the selection when the list refreshes and still contains it", async () => {
    await render(list("git status", "git log", "git diff"));
    await press("ArrowDown");
    await press("ArrowDown");
    expect(selected()).toEqual(["git log"]);

    // Same input answered again (late or duplicate lookup), new array.
    await render(list("git status", "git log", "git diff"));
    expect(selected()).toEqual(["git log"]);

    // Reordered results follow the selected command.
    await render(list("git log", "git status"));
    expect(selected()).toEqual(["git log"]);

    // The selected command is gone: selection is cleared.
    await render(list("git status", "git diff"));
    expect(selected()).toEqual([]);
  });
});
