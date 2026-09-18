// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import MenuList from "@mui/material/MenuList";
import {
  AppProvider,
  useAppStore,
  useReconnectStore,
} from "../../src/store/AppContext.jsx";
import { actions } from "../../src/store/appReducer.js";
import { SessionWorkspace } from "../../src/components/app/SessionWorkspace.jsx";
import SessionTab from "../../src/components/app/SessionTab.jsx";
import ReconnectMenuSection from "../../src/components/app/ReconnectMenuSection.jsx";

const { terminalRender, tabRender, workspaceRender, translate } = vi.hoisted(
  () => ({
    terminalRender: vi.fn(),
    tabRender: vi.fn(),
    workspaceRender: vi.fn(),
    translate: (key, params) =>
      params?.seconds ? `${key}:${params.seconds}` : key,
  }),
);
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));
vi.mock("../../src/components/CustomTab.jsx", () => ({
  default: (props) => {
    tabRender(props);
    return null;
  },
}));
vi.mock("../../src/components/AIChatWorkspace.jsx", () => ({
  default: () => null,
}));
vi.mock("../../src/components/LazyComponents.jsx", () => ({
  WebTerminalWithSuspense: (props) => {
    terminalRender(props);
    return null;
  },
}));
vi.mock("../../src/components/terminal-pane/TerminalWorkspace.jsx", () => ({
  default: ({ sessions, renderTerminal }) => {
    workspaceRender();
    return sessions.map((session) =>
      createElement(
        "div",
        { key: session.sessionKey },
        renderTerminal(session, { isActive: true, allowWebgl: true }),
      ),
    );
  },
}));

let root;
let host;
let store;
let reconnect;
const tabs = [
  { id: "a", type: "ssh", label: "A" },
  { id: "b", type: "local", label: "B" },
];
const layouts = {};
const panes = {};
function Commands() {
  store = useAppStore();
  reconnect = useReconnectStore();
  return null;
}
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("renders only the affected session for reconnect, config and refresh updates", async () => {
  await act(() =>
    root.render(
      createElement(
        AppProvider,
        null,
        createElement(Commands),
        createElement(SessionWorkspace, { tabs, layouts }),
        ...tabs.map((tab, index) =>
          createElement(SessionTab, {
            key: tab.id,
            tab,
            index: index + 1,
            splitLayouts: layouts,
            paneRegistry: panes,
          }),
        ),
      ),
    ),
  );
  await act(() => {
    store.dispatch(actions.setTabs(tabs));
    store.dispatch(
      actions.setTerminalInstances({
        a: true,
        b: true,
        "a-config": { host: "a" },
        "b-config": { executable: "pwsh" },
      }),
    );
  });
  expect(
    terminalRender.mock.calls.map(([props]) => ({
      sessionKey: props.sessionKey,
      sshConfig: props.sshConfig,
      localConfig: props.localConfig,
    })),
  ).toEqual([
    { sessionKey: "a", sshConfig: { host: "a" }, localConfig: null },
    { sessionKey: "b", sshConfig: null, localConfig: { executable: "pwsh" } },
  ]);
  vi.clearAllMocks();
  await act(() =>
    reconnect.setReconnectStateByTabId({ a: { state: "pending" } }),
  );
  expect(terminalRender).toHaveBeenCalledTimes(1);
  expect(terminalRender.mock.calls[0][0].sessionKey).toBe("a");
  expect(tabRender).toHaveBeenCalledTimes(1);
  expect(tabRender.mock.calls[0][0].tabId).toBe("a");
  expect(workspaceRender).not.toHaveBeenCalled();
  vi.clearAllMocks();
  await act(() =>
    store.dispatch(
      actions.setTerminalInstances({
        ...store.getState().terminalInstances,
        "a-refresh": 2,
      }),
    ),
  );
  expect(terminalRender).toHaveBeenCalledTimes(1);
  expect(terminalRender.mock.calls[0][0]).toMatchObject({
    sessionKey: "a",
    refreshKey: 2,
  });
  expect(tabRender).not.toHaveBeenCalled();
  expect(workspaceRender).not.toHaveBeenCalled();
  vi.clearAllMocks();
  await act(() =>
    store.dispatch(
      actions.setTerminalInstances({
        ...store.getState().terminalInstances,
        "a-config": { host: "new-a" },
      }),
    ),
  );
  expect(terminalRender).toHaveBeenCalledTimes(1);
  expect(terminalRender.mock.calls[0][0].sshConfig.host).toBe("new-a");
  expect(tabRender).toHaveBeenCalledTimes(1);
  expect(workspaceRender).not.toHaveBeenCalled();
  await act(() => store.dispatch(actions.setDraggedTab(1)));
  vi.clearAllMocks();
  await act(() => {
    store.dispatch(actions.setDragOverTab(2));
    store.dispatch(actions.setDragInsertPosition("merge"));
  });
  expect(tabRender).toHaveBeenCalledTimes(1);
  expect(tabRender.mock.calls[0][0]).toMatchObject({
    tabId: "b",
    isDraggedOver: true,
    dragInsertPosition: "merge",
  });
  expect(terminalRender).not.toHaveBeenCalled();
  expect(workspaceRender).not.toHaveBeenCalled();
  vi.clearAllMocks();
  await act(() => store.dispatch(actions.setPaneDragOverId("b")));
  expect(workspaceRender).toHaveBeenCalledTimes(1);
  expect(terminalRender).not.toHaveBeenCalled();
});

it("ticks only the open reconnect menu and cleans up the clock on close", async () => {
  vi.useFakeTimers();
  const render = (open) =>
    act(() =>
      root.render(
        createElement(
          AppProvider,
          null,
          createElement(Commands),
          createElement(
            MenuList,
            null,
            createElement(ReconnectMenuSection, { tabId: "a", open }),
          ),
          createElement(SessionTab, {
            tab: tabs[0],
            index: 1,
            splitLayouts: layouts,
            paneRegistry: panes,
          }),
        ),
      ),
    );
  await render(true);
  await act(() =>
    reconnect.setReconnectStateByTabId({
      a: { state: "pending", nextRetryAt: Date.now() + 5000 },
    }),
  );
  expect(host.textContent).toContain("tabMenu.reconnectWaitingRetry:5");
  vi.clearAllMocks();
  await act(() => vi.advanceTimersByTime(1000));
  expect(host.textContent).toContain("tabMenu.reconnectWaitingRetry:4");
  expect(tabRender).not.toHaveBeenCalled();
  await render(false);
  expect(vi.getTimerCount()).toBe(0);
});
