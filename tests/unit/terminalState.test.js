import { describe, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

describe("terminal-offline-input", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const { EventEmitter } = require("node:events");
    const createLoader = require("../helpers/load-renderer-module");

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
        removeEventListener: (name, callback) =>
          dom.removeListener(name, callback),
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
        assert.equal(
          h.io.handlePasteText("text").reason,
          "offline-paste-blocked",
        );
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
  });
});

describe("terminal-working-directory", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const createLoader = require("../helpers/load-renderer-module.js");
    const load = createLoader();
    const tracking = load(
      "src/renderer/features/terminal/model/workingDirectoryTracking.js",
    );
    const store = load(
      "src/renderer/features/terminal/model/workingDirectoryStore.js",
    );
    const {
      parseWorkingDirectoryOsc: osc,
      parseWorkingDirectoryPrompt: prompt,
    } = tracking;
    const title = tracking.parseWorkingDirectoryTitle;

    assert.equal(title("alice@server:/srv/a b", "alice").path, "/srv/a b");
    assert.equal(title("alice@server:~/project", "alice").path, "~/project");
    assert.equal(
      title("alice@server:/srv/100%/$data#1", "alice").path,
      "/srv/100%/$data#1",
    );
    for (const value of [
      "vim /etc/hosts",
      "/srv/project",
      "alice@server:project",
      "alice@server:/srv/.../src",
      "alice@server:/srv/…/src",
      "alice@server:/srv/\x00",
      "root@server:~",
    ]) {
      assert.equal(title(value, "alice"), null, value);
    }

    assert.equal(
      osc(7, "file://server/home/a%20b/%E4%B8%AD%E6%96%87").path,
      "/home/a b/中文",
    );
    assert.equal(osc(7, "file:///a%2520b").path, "/a%20b");
    assert.equal(
      osc(7, "file://server/link/../folder").path,
      "/link/../folder",
    );
    assert.equal(osc(1337, "CurrentDir=/a%20b ").path, "/a%20b ");
    for (const value of [
      "https://server/etc",
      "file://server",
      "file://server/%ZZ",
      "file://server/%00",
      "file://server/%0a",
      "file://server/%C2%85",
      "file://server//etc",
    ]) {
      assert.equal(osc(7, value), null, value);
    }
    assert.equal(osc(1337, "CurrentDir=relative"), null);
    assert.equal(osc(1337, "SetMark"), null);
    assert.equal(prompt("alice@server:/srv/a b$ ", "alice").path, "/srv/a b");
    assert.equal(
      prompt("(venv) alice@server:~/project$ ", "alice").path,
      "~/project",
    );
    assert.equal(prompt("[alice@server /etc]$ ", "alice").path, "/etc");
    assert.equal(prompt("alice@server:~$ ", "alice").path, "~");
    for (const value of [
      "[alice@server src]$",
      "alice@server:/etc$ cd /tmp",
      "alice@server:/etc$ echo #",
      "alice@server:/etc$ echo $",
      "alice@server:/etc$ echo %",
      "mysql>",
      "log: /etc",
      "root@server:~# ",
      "alice@server:~/.../src$ ",
      "alice@server:/srv/…/src$ ",
    ]) {
      assert.equal(prompt(value, "alice"), null, value);
    }

    const handlers = new Map();
    const parsed = new Set();
    let line = "alice@server:/srv/first$ ";
    const term = {
      parser: {
        registerOscHandler(code, callback) {
          handlers.set(code, callback);
          return { dispose: () => handlers.delete(code) };
        },
      },
      onWriteParsed(callback) {
        parsed.add(callback);
        return { dispose: () => parsed.delete(callback) };
      },
      buffer: {
        active: {
          type: "normal",
          baseY: 100,
          cursorY: 3,
          getLine(index) {
            assert.equal(
              index,
              103,
              "cwd must read the cursor line after scrollback",
            );
            return { isWrapped: false, translateToString: () => line };
          },
        },
      },
    };
    const tracker = tracking.attachWorkingDirectoryTracking(term, "A", {
      username: "alice",
    });
    let notifications = 0;
    const unsubscribe = store.subscribeWorkingDirectory(
      "A",
      () => notifications++,
    );
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, "/srv/first");
    parsed.forEach((callback) => callback());
    assert.equal(
      notifications,
      1,
      "unchanged directories must not refresh SFTP",
    );
    line = "alice@other:/wrong$ ";
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, null);
    line = "alice@server:/srv/first$ ";
    parsed.forEach((callback) => callback());
    assert.equal(handlers.get(7)("file://server/explicit"), true);
    line = "alice@server:/abbreviated$ ";
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, "/explicit");
    handlers.get(7)("file://other/wrong");
    assert.equal(store.getWorkingDirectoryState("A").path, null);
    handlers.get(7)("file://server/explicit");
    term.buffer.active.type = "alternate";
    handlers.get(7)("file://server/editor");
    assert.equal(store.getWorkingDirectoryState("A").path, "/explicit");
    store.setTerminalWorkingDirectory("A::p1", "/pane");
    assert.equal(store.getWorkingDirectoryState("A::p1").path, "/pane");
    tracker.reset();
    assert.equal(store.getWorkingDirectoryState("A").path, null);
    term.buffer.active.type = "normal";
    line = "alice@server:/reconnected$ ";
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, "/reconnected");
    tracker.reset();
    line = "[alice@server ~]$ ";
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, "~");
    // RHEL-style prompts show only a basename; their OSC title contains the cwd.
    assert.equal(
      handlers.get(0)("alice@server:/srv/project"),
      false,
      "directory tracking must preserve xterm's title handling",
    );
    line = "[alice@server project]$ ";
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, "/srv/project");
    handlers.get(2)("alice@server:/var/log");
    line = "[alice@server log]$ ";
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, "/var/log");
    handlers.get(2)("alice@other:/wrong");
    line = "[alice@other wrong]$ ";
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, null);
    handlers.get(0)("alice@server:/returned");
    line = "[alice@server returned]$ ";
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, "/returned");
    term.buffer.active.type = "alternate";
    handlers.get(2)("alice@server:/editor");
    term.buffer.active.type = "normal";
    parsed.forEach((callback) => callback());
    assert.equal(store.getWorkingDirectoryState("A").path, "/returned");
    handlers.get(7)("file://server/explicit");
    handlers.get(0)("alice@server:/title");
    line = "[alice@server title]$ ";
    parsed.forEach((callback) => callback());
    assert.equal(
      store.getWorkingDirectoryState("A").path,
      "/explicit",
      "an explicit directory report must take precedence over a title",
    );
    tracker.reset();
    line = "[alice@server title]$ ";
    parsed.forEach((callback) => callback());
    assert.equal(
      store.getWorkingDirectoryState("A").path,
      null,
      "reconnect must discard old titles",
    );
    tracker.dispose();
    tracker.dispose();
    assert.equal(handlers.size + parsed.size, 0);
    unsubscribe();
    const before = notifications;
    store.clearWorkingDirectorySession("A");
    assert.equal(notifications, before);
    assert.equal(store.getWorkingDirectoryState("A").path, null);
    assert.equal(store.getWorkingDirectoryState("A::p1").path, "/pane");
    store.clearWorkingDirectorySession("A::p1");

    const {
      createOscSafeOutputTransform,
    } = require("../../src/main/terminal/oscSafeOutput");
    for (const terminator of ["\x07", "\x1b\\"]) {
      const report = `\x1b]1337;CurrentDir=/srv/@host-abcdef:中文 ERROR${terminator}`;
      const input = `before ${report} after`;
      for (let split = 0; split <= input.length; split++) {
        const transform = createOscSafeOutputTransform((text) =>
          text.toUpperCase(),
        );
        assert.equal(
          transform(input.slice(0, split)) +
            transform(input.slice(split), true),
          `BEFORE ${report} AFTER`,
          `OSC corrupted at split ${split}`,
        );
      }
      const transform = createOscSafeOutputTransform((text) =>
        text.toUpperCase(),
      );
      assert.equal(
        [...input].map((char) => transform(char)).join("") +
          transform("", true),
        `BEFORE ${report} AFTER`,
      );
    }
    const transform = createOscSafeOutputTransform((text) => text);
    assert.equal(
      transform("trailing\x1b") + transform("", true),
      "trailing\x1b",
    );

    const configService = require("../../src/main/settings/configService");
    const {
      createConfigValidators,
    } = require("../../src/main/settings/configSchemas");
    Object.assign(configService, createConfigValidators());
    configService._log = () => {};
    const config = {};
    configService._saveSection = (_section, { write }) =>
      write(config) !== false;
    configService._loadSection = (_section, { read, fallback }) =>
      read(config) || fallback();
    assert.equal(
      configService.loadUISettings().sftpFollowTerminalDirectory,
      true,
    );
    assert.equal(
      configService.saveUISettings({ sftpFollowTerminalDirectory: false }),
      true,
    );
    assert.equal(configService.saveUISettings({ fontSize: 16 }), true);
    assert.equal(
      configService.loadUISettings().sftpFollowTerminalDirectory,
      false,
      "partial settings save lost global opt-out",
    );
    assert.equal(
      configService.saveUISettings({ sftpFollowTerminalDirectory: "false" }),
      false,
    );
    console.log("Terminal working directory checks passed.");
  });
});

describe("screen-split-state", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const createLoader = require("../helpers/load-renderer-module");
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
    const { appReducer, actions, initialState } = load(
      "src/renderer/app/state/appReducer.js",
    );
    const {
      getParentTabId,
      getSessionDescriptor,
      getLiveSessionKeys,
      getSessionFileManagerProps,
      retainLiveSessionEntries,
      getFocusedSessionKey,
      isSessionFileManagerOpen,
    } = load("src/renderer/features/terminal/model/paneLayout.js");
    const store = load(
      "src/renderer/features/terminal/runtime/terminalSessionStore.js",
    );
    const { dispatchCommandToGroup } = load(
      "src/renderer/features/terminal/model/syncGroupCommandDispatcher.js",
    );
    const { sendCommandToActiveSession } = load(
      "src/renderer/features/terminal/model/activeSessionActions.js",
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
        state.terminalInstances[`${id}-config`] = {
          host: `${id}.test`,
          tabId: id,
        };
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
      assert.equal(
        appReducer(state, actions.adoptTab("A", "E", "center")),
        state,
      );
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
    const focused = getSessionDescriptor(
      state,
      "B",
      status,
      store.processCache,
    );
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
    const liveKeys = new Set(
      getLiveSessionKeys(state.tabs, state.splitLayouts),
    );
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
  });
});
