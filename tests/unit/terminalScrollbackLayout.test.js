// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act } from "react";
import { renderHook } from "../helpers/reactHarness.js";
import { useTerminalLayout } from "../../src/renderer/features/terminal/hooks/useTerminalLayout.js";

let hook;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
});
afterEach(async () => {
  await hook?.unmount();
  hook = null;
  vi.useRealTimers();
});

it("coalesces continuous geometry changes for a large history and applies forced layouts immediately", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  container.getBoundingClientRect = () => ({ width: 900, height: 600 });
  const term = {
    element: document.createElement("div"),
    cols: 100,
    rows: 30,
    buffer: { normal: { length: 500000 } },
    refresh: vi.fn(),
  };
  const fit = vi.fn();
  hook = await renderHook(useTerminalLayout, {
    sessionKey: "resize-scrollback",
    terminalRef: { current: container },
    termRef: { current: term },
    fitAddonRef: { current: { fit } },
    isActiveRef: { current: true },
    scheduleTerminalRedrawRef: { current: vi.fn() },
  });
  for (let i = 0; i < 10; i++) {
    await act(() =>
      hook.current.scheduleTerminalLayoutSyncRef.current("container-resize"),
    );
    await act(() => vi.advanceTimersByTimeAsync(20));
  }
  expect(fit).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(120));
  expect(fit).toHaveBeenCalledTimes(1);
  await act(() => {
    hook.current.scheduleTerminalLayoutSyncRef.current("resize");
    hook.current.scheduleTerminalLayoutSyncRef.current(
      "session-restored-force",
      { immediate: true },
    );
  });
  expect(fit).toHaveBeenCalledTimes(2);
  await act(() => vi.runAllTimersAsync());
  expect(fit).toHaveBeenCalledTimes(2);
  await act(() => {
    hook.current.scheduleTerminalLayoutSyncRef.current("resize");
    hook.current.cancelLayoutSync();
  });
  expect(vi.getTimerCount()).toBe(0);
  container.remove();
});
