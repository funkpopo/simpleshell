const assert = require("node:assert/strict");
const createLoader = require("./lib/load-renderer-module");
const events = [];
const load = createLoader({
  window: {
    terminalAPI: { sendToProcess() {} },
    dispatchEvent: (event) => events.push(event),
  },
  CustomEvent: class {
    constructor(type, init) {
      this.type = type;
      this.detail = init.detail;
    }
  },
});
const { appReducer, actions, initialState } = load("src/store/appReducer.js");
const {
  getParentTabId,
  getSessionDescriptor,
  getLiveSessionKeys,
  getSessionFileManagerProps,
  retainLiveSessionEntries,
  getFocusedSessionKey,
  isSessionFileManagerOpen,
} = load("src/modules/terminal/paneLayout.js");
const store = load("src/modules/terminal/controller/terminalSessionStore.js");
const { dispatchCommandToGroup } = load(
  "src/core/syncGroupCommandDispatcher.js",
);
const { sendCommandToActiveSession } = load(
  "src/modules/terminal/activeSessionActions.js",
);
const plain = (value) => JSON.parse(JSON.stringify(value));
const makeState = () => {
  let state = {
    ...initialState,
    tabs: [initialState.tabs[0]],
    terminalInstances: {},
  };
  for (const id of ["A", "B", "C", "D", "E"]) {
    state = appReducer(
      state,
      actions.addTab({ id, label: id, type: id === "A" ? "local" : "ssh" }),
    );
    state.terminalInstances[id] = true;
    state.terminalInstances[`${id}-config`] = { host: `${id}.test`, tabId: id };
    store.processCache[id] = `process-${id}`;
  }
  return state;
};
for (const zone of ["left", "right", "top", "bottom", "center"]) {
  let state = makeState();
  state = appReducer(state, actions.adoptTab("A", "B", zone));
  assert.equal(getParentTabId("B", state.panes), "A");
  assert.equal(
    state.splitLayouts.A.panes[zone === "left" || zone === "top" ? 0 : 1],
    "B",
  );
  const pairDirection = state.splitLayouts.A.direction;
  state = appReducer(state, actions.setRatios("A", [30, 60]));
  state = appReducer(state, actions.adoptTab("A", "C", "bottom"));
  state = appReducer(state, actions.adoptTab("A", "D", "right"));
  assert.equal(state.splitLayouts.A.panes.length, 4);
  assert.equal(appReducer(state, actions.adoptTab("A", "E", "center")), state);
  state = appReducer(state, actions.removePane("A", "D"));
  state = appReducer(state, actions.removePane("A", "C"));
  assert.equal(state.splitLayouts.A.direction, pairDirection);
  assert.equal(state.splitLayouts.A.ratios[0], 30);
  state = appReducer(state, actions.removePane("A", "B"));
  assert.equal(state.splitLayouts.A, undefined);
  assert.deepEqual(plain(state.panes), {});
}
let state = makeState();
state = appReducer(state, actions.adoptTab("B", "C", "right"));
assert.equal(
  appReducer(state, actions.adoptTab("A", "B", "right")),
  state,
  "reject an entire split source atomically",
);
state = appReducer(state, actions.unsplitTab("B"));
assert.deepEqual(plain(state.panes), {});
state = appReducer(state, actions.adoptTab("A", "B", "right"));
state = appReducer(state, actions.adoptTab("A", "C", "bottom"));
state = appReducer(
  state,
  actions.swapPanes(getParentTabId("B", state.panes), "B", "A"),
);
assert.equal(state.splitLayouts.A.panes[0], "B");
assert.deepEqual(
  new Set(getLiveSessionKeys(state.tabs, state.splitLayouts)),
  new Set(["A", "B", "C", "D", "E"]),
);
const status = { B: { isConnected: true } };
const focused = getSessionDescriptor(state, "B", status, store.processCache);
assert.equal(focused.type, "ssh");
assert.equal(focused.config.host, "B.test");
assert.equal(focused.processId, "process-B");
assert.equal(focused.status, status.B);
const histories = { A: { path: "/local" }, B: { path: "/remote" } };
const fileProps = getSessionFileManagerProps(
  focused,
  { A: "/local", B: "/remote" },
  histories,
);
assert.equal(fileProps.tabId, "B");
assert.equal(fileProps.sshConnection, focused.config);
assert.equal(fileProps.initialPath, "/remote");
assert.equal(fileProps.navigationState, histories.B);
assert.equal(
  getSessionFileManagerProps(getSessionDescriptor(state, "A"), {}, {})
    .sshConnection,
  null,
);
const liveKeys = new Set(getLiveSessionKeys(state.tabs, state.splitLayouts));
assert.equal(
  retainLiveSessionEntries(status, liveKeys),
  status,
  "adopted pane connection/reconnect state stays intact",
);
assert.deepEqual(
  plain(retainLiveSessionEntries({ ...status, closed: {} }, liveKeys)),
  plain(status),
);
dispatchCommandToGroup(focused.sessionKey, "hostname", [
  { groupId: "B-group", members: ["B", "C"] },
]);
assert.deepEqual(
  events.map((event) => event.detail.targetTabId),
  ["B", "C"],
);
assert.ok(events.every((event) => event.detail.sourceTabId === "B"));
state = appReducer(state, actions.removePane("A", "C"));
state = appReducer(state, actions.removePane("A", "A"));
assert.equal(
  state.tabs[1].id,
  "B",
  "closing other panes promotes the one retained session",
);
assert.equal(state.splitLayouts.A, undefined);
assert.deepEqual(plain(state.panes), {});
state = makeState();
state = appReducer(state, actions.adoptTab("A", "B", "right"));
state = appReducer(state, actions.adoptTab("A", "C", "bottom"));
state = appReducer(state, actions.removePane("A", "A"));
assert.equal(getParentTabId("C", state.panes), "B");
assert.deepEqual(plain(state.splitLayouts.B.panes), ["B", "C"]);
state = appReducer(state, actions.unsplitTab("B"));
assert.equal(state.tabs.find((tab) => tab.id === "B").type, "ssh");
assert.deepEqual(plain(state.panes), {});
state = appReducer(state, actions.forgetSessions(["B", "C"]));
for (const id of ["B", "C"])
  assert.equal(state.terminalInstances[`${id}-config`], undefined);
let disposals = 0;
store.terminalCache.A = { dispose: () => disposals++ };
store.registerTerminalRef("A", store.terminalCache.A);
assert.equal(store.disposeTerminalSession("A"), true);
assert.equal(store.disposeTerminalSession("A"), false);
assert.equal(disposals, 1);
assert.equal(store.webTerminalRefs.A, undefined);
state = makeState();
state = appReducer(state, actions.adoptTab("A", "B", "right"));
state = appReducer(state, actions.adoptTab("A", "C", "bottom"));
state = appReducer(state, actions.setFileManagerOpenForTab("A", true));
state = appReducer(state, actions.focusPane("A", "B"));
assert.equal(getFocusedSessionKey(state), "B");
assert.equal(
  isSessionFileManagerOpen(state, getSessionDescriptor(state, "B")),
  true,
);
state = appReducer(state, actions.focusPane("A", "C"));
assert.equal(
  isSessionFileManagerOpen(state, getSessionDescriptor(state, "C")),
  true,
  "open panel follows another SSH pane without closing",
);
events.length = 0;
const sendUsingCurrentState = (command, options) =>
  sendCommandToActiveSession(state, command, options);
assert.equal(sendUsingCurrentState("pwd").sessionKey, "C");
state = appReducer(state, actions.focusPane("A", "B"));
assert.equal(
  sendUsingCurrentState("pwd").sessionKey,
  "B",
  "existing callback reads current focus",
);
assert.equal(
  sendUsingCurrentState("pwd", { expectedSessionKey: "C" }).reason,
  "sessionChanged",
);
assert.deepEqual(
  events.map((event) => event.detail.targetTabId),
  ["C", "B"],
);
delete store.processCache.B;
assert.equal(sendUsingCurrentState("pwd").reason, "noProcess");
state = appReducer(state, actions.removePane("A", "A"));
state = appReducer(state, actions.forgetSessions(["A"]));
assert.equal(
  state.fileManagerOpenByTabId.B,
  true,
  "panel stays open after host promotion",
);
assert.equal(
  isSessionFileManagerOpen(state, getSessionDescriptor(state, "C")),
  true,
);
console.log(
  "Screen split state/ownership/command/cleanup behavior checks passed.",
);
