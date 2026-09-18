// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  AppProvider,
  useAppDispatch,
  useAppStore,
  useAppSelector,
  useShellState,
  useDragSelector,
  useTerminalSelector,
  useTheme,
  useReconnectStore,
  useReconnectSelector,
} from "../../src/store/AppContext.jsx";
import { actions } from "../../src/store/appReducer.js";
import { createAppStore } from "../../src/store/appStore.js";
import { shallowEqual } from "../../src/store/subscriptionStore.js";

let root;
let host;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
});

it("isolates drag, terminal, reconnect, theme and dispatch subscribers in StrictMode", async () => {
  const counts = {};
  const values = {};
  let store;
  let reconnect;
  function Commands() {
    store = useAppStore();
    reconnect = useReconnectStore();
    values.dispatch = useAppDispatch();
    counts.commands = (counts.commands || 0) + 1;
    return null;
  }
  function Probe({ name, read }) {
    values[name] = read();
    counts[name] = (counts[name] || 0) + 1;
    return null;
  }
  const readers = {
    shell: useShellState,
    theme: useTheme,
    tabs: () => useAppSelector((state) => state.tabs),
    drag: () => useDragSelector((state) => state.dragOverTabIndex),
    terminalA: () => useTerminalSelector((instances) => instances["a-refresh"]),
    terminalB: () => useTerminalSelector((instances) => instances["b-refresh"]),
    reconnectA: () =>
      useReconnectSelector((state) => state.reconnectStateByTabId.a),
    reconnectB: () =>
      useReconnectSelector((state) => state.reconnectStateByTabId.b),
  };
  await act(() =>
    root.render(
      createElement(
        StrictMode,
        null,
        createElement(
          AppProvider,
          null,
          createElement(Commands),
          ...Object.entries(readers).map(([name, read]) =>
            createElement(Probe, { key: name, name, read }),
          ),
        ),
      ),
    ),
  );
  const initialCounts = { ...counts };
  const dispatch = values.dispatch;
  for (let index = 0; index < 12; index++) {
    await act(() => dispatch(actions.setDragOverTab(index)));
  }
  expect(counts.drag).toBeGreaterThan(initialCounts.drag);
  for (const key of Object.keys(readers).filter((key) => key !== "drag")) {
    expect(counts[key], key).toBe(initialCounts[key]);
  }
  await act(() => dispatch(actions.setTerminalInstances({ "a-refresh": 1 })));
  expect(values.terminalA).toBe(1);
  expect(counts.terminalB).toBe(initialCounts.terminalB);
  expect(counts.shell).toBe(initialCounts.shell);
  expect(counts.theme).toBe(initialCounts.theme);
  const beforeReconnect = { ...counts };
  await act(() =>
    reconnect.setReconnectStateByTabId({ a: { state: "pending" } }),
  );
  expect(values.reconnectA.state).toBe("pending");
  for (const key of Object.keys(counts).filter((key) => key !== "reconnectA")) {
    expect(counts[key], key).toBe(beforeReconnect[key]);
  }
  await act(() => dispatch(actions.setDarkMode(false)));
  expect(values.theme.darkMode).toBe(false);
  expect(values.dispatch).toBe(dispatch);
  expect(counts.commands).toBe(initialCounts.commands);
  expect(store.getState().dragOverTabIndex).toBe(11);
});

it("supports object selectors, selector changes and equality changes without stale results", async () => {
  let store;
  let selection;
  let renders = 0;
  function Probe({ sessionKey, equality }) {
    store = useAppStore();
    selection = useAppSelector(
      (state) => ({ config: state.terminalInstances[sessionKey] }),
      equality,
    );
    renders++;
    return null;
  }
  const render = (sessionKey, equality) =>
    act(() =>
      root.render(
        createElement(
          AppProvider,
          null,
          createElement(Probe, { sessionKey, equality }),
        ),
      ),
    );
  await render("a", shallowEqual);
  await act(() => store.dispatch(actions.setTerminalInstances({ a: 1, b: 2 })));
  expect(selection).toEqual({ config: 1 });
  const before = renders;
  await act(() => store.dispatch(actions.setDraggedTab(1)));
  expect(renders).toBe(before);
  await render("b", shallowEqual);
  expect(selection).toEqual({ config: 2 });
  await render("b", () => true);
  await act(() => store.dispatch(actions.setTerminalInstances({ a: 3, b: 4 })));
  expect(selection).toEqual({ config: 2 });
  await render("b", shallowEqual);
  expect(selection).toEqual({ config: 4 });
});

it("publishes coherent cross-domain snapshots and unsubscribes domain listeners", () => {
  const store = createAppStore();
  store.dispatch(
    actions.setTerminalInstances({ a: true, "a-config": { host: "a" } }),
  );
  store.dispatch(actions.setFileManagerPaths({ a: "/tmp" }));
  const observe = vi.fn(() => {
    expect(store.terminal.getSnapshot().a).toBeUndefined();
    expect(store.shell.getSnapshot().fileManagerPaths.a).toBeUndefined();
    expect(store.getState().terminalInstances.a).toBeUndefined();
  });
  const stopShell = store.shell.subscribe(observe);
  const stopTerminal = store.terminal.subscribe(observe);
  store.dispatch(actions.forgetSessions(["a"]));
  expect(observe).toHaveBeenCalledTimes(2);
  stopShell();
  stopTerminal();
  store.dispatch(actions.setCurrentTab(1));
  expect(observe).toHaveBeenCalledTimes(2);
});

it("keeps providers isolated and initializes each from the boot theme", async () => {
  const stores = [];
  const themes = [];
  window.simpleshellBoot = { darkMode: false };
  function Probe({ index }) {
    stores[index] = useAppStore();
    themes[index] = useTheme();
    return null;
  }
  try {
    await act(() =>
      root.render(
        createElement(
          "div",
          null,
          ...[0, 1].map((index) =>
            createElement(
              AppProvider,
              { key: index },
              createElement(Probe, { index }),
            ),
          ),
        ),
      ),
    );
    expect(themes.map((theme) => theme.darkMode)).toEqual([false, false]);
    await act(() => stores[0].dispatch(actions.setDarkMode(true)));
    expect(themes.map((theme) => theme.darkMode)).toEqual([true, false]);
  } finally {
    delete window.simpleshellBoot;
  }
});
