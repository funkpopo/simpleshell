import { afterEach, describe, expect, it, vi } from "vitest";
import { ScrollbackUsageTracker } from "../../src/renderer/features/terminal/runtime/ScrollbackUsageTracker.js";
import { TerminalSearchAddon } from "../../src/renderer/features/terminal/runtime/TerminalSearchAddon.js";
import { TerminalWriteQueue } from "../../src/renderer/features/terminal/runtime/TerminalWriteQueue.js";
import { RendererTerminalIOMailbox } from "../../src/renderer/features/terminal/io/RendererTerminalIOMailbox.js";
const { Terminal } = require("@xterm/xterm");
const {
  collectTerminalSearchMatches,
} = require("../../src/renderer/features/terminal/model/searchResults.js");
const {
  getLogicalLineUntilCursor,
} = require("../../src/renderer/features/terminal/model/promptDetection.js");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function createTerminal(length = 20) {
  let selection;
  const handlers = {};
  const buffer = {
    length,
    baseY: Math.max(0, length - 5),
    cursorY: 4,
    viewportY: 0,
    getLine: vi.fn((row) => {
      if (row < 0 || row >= buffer.length) return undefined;
      const text = `row-${row} hit`;
      return {
        isWrapped: false,
        translateToString: () => text,
        getCell: (col) => ({
          getChars: () => text[col] || "",
          getWidth: () => 1,
        }),
      };
    }),
  };
  const on = (name) => (handler) => {
    handlers[name] = handler;
    return { dispose: () => delete handlers[name] };
  };
  const term = {
    rows: 5,
    cols: 80,
    buffer: { active: buffer, onBufferChange: on("buffer") },
    onWriteParsed: on("write"),
    onResize: on("resize"),
    select: (x, y, size) => {
      selection = { start: { x, y }, end: { x: x + size, y } };
    },
    getSelectionPosition: () => selection,
    clearSelection: () => {
      selection = undefined;
    },
    scrollToLine: vi.fn((row) => {
      buffer.viewportY = row;
    }),
  };
  const addon = new TerminalSearchAddon();
  addon.activate(term);
  const results = vi.fn();
  addon.onDidChangeResults(results);
  return { term, addon, buffer, handlers, results };
}

describe("large terminal scrollback", () => {
  it("acknowledges exact UTF-8 bytes when a write boundary falls inside an emoji", () => {
    const postTerminalMailboxMessage = vi.fn();
    vi.stubGlobal("window", { terminalAPI: { postTerminalMailboxMessage } });
    const writes = [];
    const mailbox = new RendererTerminalIOMailbox({
      term: {
        write(data, callback) {
          writes.push(data);
          callback();
        },
      },
    });
    mailbox.attachProcess(77);
    const data = `${"a".repeat(32767)}😀b`;
    mailbox.handleDrain(data);
    mailbox.flushOutputAck();
    expect(writes.join("")).toBe(data);
    expect(postTerminalMailboxMessage).toHaveBeenLastCalledWith(77, {
      type: "ack",
      bytes: Buffer.byteLength(data),
    });
    mailbox.destroy();
  });
  it("drains small output even when Chromium does not deliver animation frames", async () => {
    vi.useFakeTimers();
    const animationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", animationFrame);
    const onDrain = vi.fn();
    const queue = new TerminalWriteQueue({ onDrain, dispatchIntervalMs: 8 });
    queue.enqueue("echo ");
    queue.enqueue("中文");
    await vi.advanceTimersByTimeAsync(8);
    expect(onDrain).toHaveBeenCalledExactlyOnceWith("echo 中文", {
      byteCount: 7,
    });
    expect(animationFrame).not.toHaveBeenCalled();
    queue.enqueue("cancelled");
    queue.destroy();
    await vi.runAllTimersAsync();
    expect(onDrain).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("keeps byte totals correct as a full ring wraps and its capacity changes", () => {
    const tracker = new ScrollbackUsageTracker({ maxLines: 3 });
    tracker.addData("a\nbb\n中文\ncccc\nx");
    expect(tracker.getBufferSize()).toBe(3 + 7 + 5 + 1);
    tracker.maxLines = 2;
    expect(tracker.getBufferSize()).toBe(7 + 5 + 1);
    tracker.maxLines = 4;
    tracker.addData("z\nq\nr\n");
    expect(tracker.getBufferSize()).toBe(5 + 3 + 2 + 2);
    expect(tracker.getLineCount()).toBe(4);
    tracker.clear();
    expect(tracker.getBufferSize()).toBe(0);
    tracker.addData("ok\n");
    expect(tracker.getBufferSize()).toBe(3);
    tracker.destroy();
  });

  it("does not shift a 500,000-line array for each new diagnostic line", () => {
    const tracker = new ScrollbackUsageTracker({ maxLines: 500000 });
    for (let i = 0; i < 500000; i++) tracker.pushLine(1);
    const shift = vi.spyOn(tracker.lineByteQueue, "shift");
    for (let i = 0; i < 10000; i++) tracker.pushLine(2);
    expect(shift).not.toHaveBeenCalled();
    expect(tracker.getLineCount()).toBe(500000);
    expect(tracker.getBufferSize()).toBe(510000);
    tracker.maxLines = 1000;
    expect(tracker.getBufferSize()).toBe(2000);
  });

  it("bounds prompt reads on scrollback-sized wrapped output and resumes at a prompt", () => {
    let wrapped = true;
    const getLine = vi.fn(() => ({
      isWrapped: wrapped,
      translateToString: () => "$ git status",
    }));
    const term = {
      buffer: { active: { baseY: 500000, cursorY: 10, getLine } },
    };
    expect(getLogicalLineUntilCursor(term)).toBe("");
    expect(getLine.mock.calls.length).toBeLessThanOrEqual(32);
    wrapped = false;
    expect(getLogicalLineUntilCursor(term)).toBe("$ git status");
    expect(getLine).toHaveBeenLastCalledWith(500010);
  });

  it("maps Unicode and wrapped search positions using real xterm cells", async () => {
    const term = new Terminal({ cols: 10, rows: 5, scrollback: 1000 });
    try {
      await new Promise((resolve) =>
        term.write("abc中文😀hello\r\nHELLO hello\r\nhelloworld", resolve),
      );
      const matches = collectTerminalSearchMatches(term, "hello");
      expect(matches).toHaveLength(4);
      expect(matches[0]).toMatchObject({ row: 0, col: 8, size: 5 });
      expect(
        collectTerminalSearchMatches(term, "hello", { wholeWord: true }),
      ).toHaveLength(3);
      expect(
        collectTerminalSearchMatches(term, "hello", { caseSensitive: true }),
      ).toHaveLength(3);
      expect(
        collectTerminalSearchMatches(term, "h.llo", { regex: true }),
      ).toHaveLength(4);
      expect(
        collectTerminalSearchMatches(term, "[", { regex: true }),
      ).toHaveLength(0);
    } finally {
      term.dispose();
    }
  });

  it("reuses the complete match index for next, previous and wraparound navigation", async () => {
    vi.useFakeTimers();
    const h = createTerminal(2000);
    const first = h.addon.findNext("hit");
    await vi.runAllTimersAsync();
    expect(await first).toBe(true);
    expect(h.results).toHaveBeenLastCalledWith({
      resultCount: 2000,
      resultIndex: 0,
    });
    const reads = h.buffer.getLine.mock.calls.length;
    await h.addon.findNext("hit");
    expect(h.term.getSelectionPosition().start.y).toBe(1);
    await h.addon.findPrevious("hit");
    expect(h.term.getSelectionPosition().start.y).toBe(0);
    await h.addon.findPrevious("hit");
    expect(h.term.getSelectionPosition().start.y).toBe(1999);
    expect(h.buffer.getLine.mock.calls.length).toBe(reads);
    h.addon.dispose();
    expect(Object.keys(h.handlers)).toHaveLength(0);
  });

  it("yields, cancels stale scans, and refreshes after output or resize", async () => {
    vi.useFakeTimers();
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ++now);
    const h = createTerminal(500000);
    const stale = h.addon.findNext("absent");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.buffer.getLine.mock.calls.length).toBeLessThan(500000);
    const replacement = h.addon.findNext("row-499999");
    expect(await stale).toBe(false);
    h.addon.clearDecorations();
    expect(await replacement).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    h.buffer.length = 3;
    const search = h.addon.findNext("hit");
    await vi.runAllTimersAsync();
    await search;
    h.buffer.length = 4;
    h.handlers.write();
    await vi.runAllTimersAsync();
    expect(h.results.mock.lastCall[0].resultCount).toBe(4);
    h.handlers.resize();
    h.addon.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles a failed scheduled scan and permits a later search", async () => {
    vi.useFakeTimers();
    const h = createTerminal(3);
    h.buffer.getLine.mockImplementationOnce(() => {
      throw new Error("buffer unavailable");
    });
    const failed = h.addon.findNext("hit").catch((error) => error.message);
    await vi.runAllTimersAsync();
    expect(await failed).toBe("buffer unavailable");
    const retry = h.addon.findNext("hit");
    await vi.runAllTimersAsync();
    expect(await retry).toBe(true);
    h.addon.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
