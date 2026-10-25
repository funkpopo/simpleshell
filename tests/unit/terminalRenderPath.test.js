// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "../helpers/reactHarness.js";
import { TerminalWriteQueue } from "../../src/renderer/features/terminal/runtime/TerminalWriteQueue.js";
import { ScrollbackUsageTracker } from "../../src/renderer/features/terminal/runtime/ScrollbackUsageTracker.js";
import {
  RendererTerminalIOMailbox,
  getUtf8ByteLength,
} from "../../src/renderer/features/terminal/io/RendererTerminalIOMailbox.js";
import { useTerminalRender } from "../../src/renderer/features/terminal/hooks/useTerminalRender.js";

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("terminal output path", () => {
  it("counts UTF-8 bytes exactly like the main process", () => {
    for (const sample of [
      "",
      "plain ascii\r\n",
      "é ß ü",
      "中文输出",
      "emoji 😀👍🏽",
      "lone \ud83d high",
      "lone \ude00 low",
      "trailing \ud83d",
    ]) {
      expect(getUtf8ByteLength(sample)).toBe(Buffer.byteLength(sample));
    }
  });

  it("measures a range without slicing, keeping pairs inside the range", () => {
    const sample = "a中😀b";
    for (let start = 0; start <= sample.length; start++) {
      for (let end = start; end <= sample.length; end++) {
        expect(getUtf8ByteLength(sample, start, end)).toBe(
          Buffer.byteLength(sample.slice(start, end)),
        );
      }
    }
  });

  it("tracks diagnostic history bytes per line without re-encoding", () => {
    const tracker = new ScrollbackUsageTracker({ maxLines: 100 });
    const chunks = [
      "row 中文\r\nemoji 😀\n\ud83d",
      "\ude00 split\rtail ",
      "end",
    ];
    for (const chunk of chunks) tracker.addData(chunk);
    expect(tracker.getLineCount()).toBe(4);
    // A pair split across chunks is two lone surrogates, as when the
    // renderer previously encoded each chunk separately.
    expect(tracker.getBufferSize()).toBe(
      chunks.reduce((total, chunk) => total + Buffer.byteLength(chunk), 0),
    );
  });

  it("drains synchronous enqueues once on a microtask without timers", async () => {
    vi.useFakeTimers();
    const onDrain = vi.fn();
    const queue = new TerminalWriteQueue({ onDrain, dispatchIntervalMs: 0 });
    queue.enqueue("a");
    queue.enqueue("b");
    expect(onDrain).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await Promise.resolve();
    expect(onDrain).toHaveBeenCalledExactlyOnceWith("ab", { byteCount: 2 });

    queue.enqueue("cancelled");
    queue.destroy();
    await Promise.resolve();
    expect(onDrain).toHaveBeenCalledTimes(1);
  });

  it("writes one IPC batch to xterm in a single call", async () => {
    let deliver;
    vi.stubGlobal("window", {
      terminalAPI: {
        postTerminalMailboxMessage: vi.fn(),
        onTerminalMailboxMessage: (_id, callback) => {
          deliver = callback;
          return () => {};
        },
      },
    });
    const writes = [];
    const mailbox = new RendererTerminalIOMailbox({
      term: {
        write(data, callback) {
          writes.push(data);
          callback();
        },
      },
    });
    mailbox.attachProcess(5);
    deliver({ type: "output", data: "$ " });
    deliver({ type: "output", data: "ls" });
    await Promise.resolve();
    expect(writes).toEqual(["$ ls"]);
    mailbox.destroy();
  });
});

describe("terminal redraw scheduling", () => {
  it("keeps a pending forced refresh when a non-forced request follows", async () => {
    const frames = [];
    vi.stubGlobal("requestAnimationFrame", (cb) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const term = { rows: 24, refresh: vi.fn(), __webglEnabled: false };
    const hook = await renderHook(useTerminalRender, {
      termRef: { current: null },
      webglRendererEnabled: false,
      webglRendererEnabledRef: { current: false },
      setWebglRendererEnabled: vi.fn(),
      performanceMonitorRef: { current: null },
    });

    // Prime the throttle so a non-forced refresh would be skipped.
    await act(() => hook.current.scheduleTerminalRedraw(term, { force: true }));
    frames.shift()();
    expect(term.refresh).toHaveBeenCalledTimes(1);

    await act(() => {
      hook.current.scheduleTerminalRedraw(term, { force: true });
      hook.current.scheduleTerminalRedraw(term);
    });
    frames.at(-1)();
    expect(term.refresh).toHaveBeenCalledTimes(2);
    await hook.unmount();
  });
});
