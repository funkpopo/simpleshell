const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const createLoader = require("./lib/load-renderer-module");

// Run the actual hook with deterministic effects and frame/timer callbacks.
function createHarness(sessionKey = "tab::p1", initialStatus = null) {
  const ipc = new EventEmitter();
  const dom = new EventEmitter();
  const frames = new Map();
  const delayed = [];
  let frameId = 0;
  let cursor = 0;
  const slots = [];
  let effects = [];
  const sameDeps = (a, b) =>
    a &&
    b &&
    a.length === b.length &&
    a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useRef(value) {
      const i = cursor++;
      return (slots[i] ||= { current: value });
    },
    useState(value) {
      const i = cursor++;
      slots[i] ||= { value };
      return [
        slots[i].value,
        (next) => {
          slots[i].value =
            typeof next === "function" ? next(slots[i].value) : next;
        },
      ];
    },
    useCallback(fn, deps) {
      const i = cursor++;
      if (!sameDeps(slots[i]?.deps, deps)) slots[i] = { value: fn, deps };
      return slots[i].value;
    },
    useEffect(fn, deps) {
      const i = cursor++;
      if (sameDeps(slots[i]?.deps, deps)) return;
      effects.push(() => {
        slots[i]?.cleanup?.();
        slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const sent = [];
  const terminalAPI = {
    sendToProcess: (pid, input) => sent.push([pid, input]),
  };
  for (const name of [
    "onConnectionLost",
    "onReconnectStart",
    "onReconnectProgress",
    "onReconnectFailed",
    "onReconnectAbandoned",
    "onTabConnectionStatus",
    "onTerminalSessionRestored",
    "onTerminalSessionRestoreFailed",
  ]) {
    terminalAPI[name] = (callback) => {
      ipc.on(name, callback);
      return () => ipc.removeListener(name, callback);
    };
  }
  const window = {
    terminalAPI,
    addEventListener: (name, callback) => dom.on(name, callback),
    removeEventListener: (name, callback) => dom.removeListener(name, callback),
  };
  const load = createLoader(
    {
      window,
      requestAnimationFrame: (callback) => {
        const id = ++frameId;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id) => frames.delete(id),
    },
    { react },
  );
  const { useTerminalIO } = load(
    "src/renderer/features/terminal/hooks/useTerminalIO.js",
  );
  const { processCache } = load(
    "src/renderer/features/terminal/runtime/terminalSessionStore.js",
  );
  processCache[sessionKey] = "process-1";
  const props = {
    sessionKey,
    reconnectStatus: initialStatus,
    terminalIOMailboxRef: { current: null },
    eventManager: { setTimeout: (callback) => delayed.push(callback) },
    suggestionUiRef: { current: {} },
  };
  const harness = {
    ipc,
    dom,
    sent,
    props,
    delayed,
    render(overrides = {}) {
      Object.assign(props, overrides);
      cursor = 0;
      effects = [];
      harness.io = useTerminalIO(props);
      effects.forEach((run) => run());
      return harness.io;
    },
    drain() {
      while (frames.size) {
        const current = [...frames.values()];
        frames.clear();
        current.forEach((callback) => callback());
      }
    },
    dispose() {
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
  harness.render();
  return harness;
}

function testOfflineInputAndRecovery() {
  for (const mailbox of [false, true]) {
    const h = createHarness();
    if (mailbox)
      h.props.terminalIOMailboxRef.current = {
        getProcessId: () => "process-1",
        sendInput: (input) => h.sent.push(["process-1", input]),
      };
    h.io.enqueueInputToProcess("process-1", "pending paste".repeat(1000), {
      forceChunk: true,
    });
    h.ipc.emit("onConnectionLost", null, { tabId: "tab::p2" });
    assert.equal(
      h.io.isTerminalOffline(),
      false,
      "sibling pane disconnect is isolated",
    );
    h.ipc.emit("onConnectionLost", null, { tabId: "tab::p1" });
    assert.equal(h.io.isTerminalOffline(), true);
    assert.equal(h.io.inputQueueBytesRef.current, 0);
    h.io.sendInputToProcess("process-1", "\u001b[O\u001b[I\r");
    h.io.enqueueInputToProcess("process-1", "old command\r");
    assert.equal(h.io.handlePasteText("text").reason, "offline-paste-blocked");
    h.drain();
    assert.equal(
      h.sent.length,
      0,
      "keys, focus sequences and pending paste must not be retained",
    );
    h.ipc.emit("onReconnectSuccess", null, { tabId: "tab::p1" });
    assert.equal(
      h.io.isTerminalOffline(),
      true,
      "transport ready is not shell ready",
    );
    h.dom.emit("terminalSessionRestored", { detail: {} });
    assert.equal(
      h.io.isTerminalOffline(),
      true,
      "unscoped restore must not unlock every pane",
    );
    h.ipc.emit("onTerminalSessionRestored", {
      tabId: "tab::p1",
      processId: "process-1",
    });
    assert.equal(h.io.isTerminalOffline(), false);
    h.io.sendInputToProcess("process-1", "new command\r");
    h.drain();
    assert.deepEqual(h.sent, [["process-1", "new command\r"]]);
    h.render();
    assert.equal(
      h.io.inputBlocked,
      false,
      "recovery must dismiss the offline notice",
    );
    h.dispose();
    assert.equal(h.ipc.eventNames().length, 0);
    assert.equal(h.dom.eventNames().length, 0);
  }
}

function testDelayedPasteDoesNotCrossRecovery() {
  const h = createHarness();
  h.io.sendProcessedInputToProcess("process-1", {
    type: "multiline-with-comments",
    lines: ["# old comment", "old command"],
  });
  assert.equal(h.delayed.length, 1);
  h.ipc.emit("onReconnectStart", null, { tabId: "tab::p1" });
  h.ipc.emit("onTerminalSessionRestored", { tabId: "tab::p1" });
  h.delayed.forEach((callback) => callback());
  h.drain();
  assert.equal(
    h.sent.length,
    0,
    "delayed paste must not resume in a recovered shell",
  );
  h.io.handlePasteText("fresh paste");
  h.drain();
  assert.deepEqual(h.sent, [["process-1", "fresh paste"]]);
  h.dispose();
}

function testFailureRefreshAndRemount() {
  const h = createHarness("tab::p1", { state: "pending" });
  assert.equal(
    h.io.isTerminalOffline(),
    true,
    "remounted reconnecting pane blocks input",
  );
  h.ipc.emit("onTerminalSessionRestoreFailed", { tabId: "tab::p1" });
  assert.equal(
    h.io.isTerminalOffline(),
    true,
    "failed shell restoration remains blocked",
  );
  h.render({ refreshKey: 1, reconnectStatus: null });
  assert.equal(
    h.io.isTerminalOffline(),
    false,
    "manual refresh resets stale offline state",
  );
  assert.equal(
    h.ipc.listenerCount("onConnectionLost"),
    1,
    "refresh does not accumulate listeners",
  );
  h.ipc.emit("onTabConnectionStatus", {
    tabId: "tab::p1",
    connectionStatus: { isConnected: false },
  });
  h.ipc.emit("onTabConnectionStatus", {
    tabId: "tab::p1",
    connectionStatus: { isConnected: true, isConnecting: false },
  });
  assert.equal(h.io.isTerminalOffline(), false);
  h.dispose();
}

for (const test of [
  testOfflineInputAndRecovery,
  testDelayedPasteDoesNotCrossRecovery,
  testFailureRefreshAndRemount,
]) {
  test();
  console.log(`PASS ${test.name}`);
}
