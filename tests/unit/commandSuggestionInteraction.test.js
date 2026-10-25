import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  isCursorAtInputEnd,
  resolveCommandSuggestionKeyAction,
} = require("../../src/renderer/features/terminal/model/commandSuggestionState.js");
const {
  CURSOR_GAP,
  getSuggestionWindowHeight,
  resolveCommandSuggestionWindowPosition,
} = require("../../src/renderer/features/terminal/model/commandSuggestionPosition.js");

const terminalRect = { left: 0, top: 0, right: 800, bottom: 600 };
const resolve = ({ cursorY, height = 200, ...rest }) =>
  resolveCommandSuggestionWindowPosition({
    position: {
      x: 120,
      y: cursorY,
      cursorHeight: 18,
      cursorBottom: cursorY + 18,
      showAbove: false,
    },
    windowDimensions: { width: 300, height },
    terminalRect,
    windowWidth: 1280,
    windowHeight: 800,
    ...rest,
  });

const overlapsCursorRow = (placement, cursorY) =>
  placement.top < cursorY + 18 && placement.top + placement.height > cursorY;

describe("command suggestion placement", () => {
  it("never covers the cursor row, wherever the cursor is", () => {
    for (let cursorY = 0; cursorY <= 582; cursorY += 6) {
      for (const height of [58, 142, 280]) {
        const placement = resolve({ cursorY, height });
        if (!placement) continue;
        expect(overlapsCursorRow(placement, cursorY)).toBe(false);
        expect(placement.top).toBeGreaterThanOrEqual(8);
        expect(placement.top + placement.height).toBeLessThanOrEqual(592);
      }
    }
  });

  it("sits directly below the cursor when there is room", () => {
    const placement = resolve({ cursorY: 100 });
    expect(placement.showAbove).toBe(false);
    expect(placement.top).toBe(118 + CURSOR_GAP);
    expect(placement.height).toBe(200);
  });

  it("keeps the side it opened on while the list size changes", () => {
    // Near the bottom: opens above for a tall list.
    const first = resolve({ cursorY: 440, height: 280 });
    expect(first.showAbove).toBe(true);
    // A shorter list would fit below, but must not jump there mid-typing.
    const shrunk = resolve({ cursorY: 440, height: 86, preferAbove: true });
    expect(shrunk.showAbove).toBe(true);
    expect(shrunk.top + shrunk.height).toBe(440 - CURSOR_GAP);
  });

  it("uses a sticky horizontal anchor when provided", () => {
    const placement = resolveCommandSuggestionWindowPosition({
      position: {
        x: 400,
        anchorX: 150,
        y: 100,
        cursorHeight: 18,
        cursorBottom: 118,
      },
      windowDimensions: { width: 300, height: 120 },
      terminalRect,
      windowWidth: 1280,
      windowHeight: 800,
    });
    expect(placement.left).toBe(150);
  });

  it("hides instead of rendering a sliver when no row fits on either side", () => {
    const placement = resolveCommandSuggestionWindowPosition({
      position: { x: 20, y: 20, cursorHeight: 18, cursorBottom: 38 },
      windowDimensions: { width: 240, height: getSuggestionWindowHeight(5) },
      terminalRect: { left: 0, top: 0, right: 400, bottom: 60 },
      windowWidth: 1280,
      windowHeight: 800,
    });
    expect(placement).toBeNull();
  });
});

describe("command suggestion keyboard rules", () => {
  const act = (key, selectedIndex = -1, extra = {}) =>
    resolveCommandSuggestionKeyAction({
      key,
      selectedIndex,
      count: 3,
      ...extra,
    });

  it("enters the list with the key pointing toward it", () => {
    expect(act("ArrowDown")).toEqual({ type: "move", index: 0 });
    expect(act("ArrowUp", -1, { showAbove: true })).toEqual({
      type: "move",
      index: 0,
    });
  });

  it("leaves shell history keys alone until the list is entered", () => {
    expect(act("ArrowUp")).toEqual({ type: "pass" });
    expect(act("ArrowDown", -1, { showAbove: true })).toEqual({
      type: "pass",
    });
  });

  it("returns to the input from the first item and stops at the last", () => {
    expect(act("ArrowUp", 0)).toEqual({ type: "move", index: -1 });
    expect(act("ArrowDown", 2)).toEqual({ type: "move", index: 2 });
  });

  it("only takes over Enter and Delete after an item is selected", () => {
    expect(act("Enter")).toEqual({ type: "pass" });
    expect(act("Delete")).toEqual({ type: "pass" });
    expect(act("Enter", 1)).toEqual({ type: "accept", index: 1 });
    expect(act("Delete", 1)).toEqual({ type: "remove", index: 1 });
  });

  it("dismisses on cursor movement and ignores modified keys", () => {
    expect(act("ArrowLeft")).toEqual({ type: "dismiss" });
    expect(act("End", 1)).toEqual({ type: "dismiss" });
    expect(act("ArrowDown", -1, { ctrlKey: true })).toEqual({ type: "pass" });
    expect(act("Enter", 1, { shiftKey: true })).toEqual({ type: "pass" });
    expect(act("Escape")).toEqual({ type: "close" });
  });
});

describe("isCursorAtInputEnd", () => {
  const createTerm = (line, cursorX, next = null) => ({
    buffer: {
      active: {
        cursorX,
        cursorY: 0,
        baseY: 0,
        getLine: (row) => {
          const text = row === 0 ? line : next;
          if (text === null) return undefined;
          return {
            isWrapped: row !== 0,
            translateToString: (trim, start = 0) => {
              const value = text.slice(start);
              return trim ? value.trimEnd() : value;
            },
          };
        },
      },
    },
  });

  it("accepts a cursor at the end of the typed command", () => {
    expect(isCursorAtInputEnd(createTerm("$ git st", 8))).toBe(true);
    expect(isCursorAtInputEnd(createTerm("$ git st   ", 8))).toBe(true);
  });

  it("rejects a cursor in the middle of the line", () => {
    expect(isCursorAtInputEnd(createTerm("$ git st", 4))).toBe(false);
  });

  it("rejects a cursor followed by a wrapped continuation", () => {
    expect(isCursorAtInputEnd(createTerm("$ git st", 8, "atus"))).toBe(false);
  });

  it("falls back to allowing suggestions when the buffer is unreadable", () => {
    expect(isCursorAtInputEnd(null)).toBe(true);
    expect(isCursorAtInputEnd({ buffer: { active: {} } })).toBe(true);
  });
});
