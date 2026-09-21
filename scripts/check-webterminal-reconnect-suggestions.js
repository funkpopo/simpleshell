const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Terminal } = require("@xterm/xterm");
const createLoader = require("./lib/load-renderer-module.js");

const root = path.resolve(__dirname, "..");
const load = createLoader();
const suggestionState = require("../src/renderer/features/terminal/model/commandSuggestionState.js");

function createHarness() {
  const slots = [];
  const effects = [];
  const timers = new Map();
  const listeners = new Map();
  const terminalListeners = new Map();
  const requests = [];
  const sent = [];
  const disposables = [];
  let slotIndex = 0;
  let timerId = 0;
  let line = "$ ";
  const on = (registry, name, callback) => {
    if (!registry.has(name)) registry.set(name, new Set());
    registry.get(name).add(callback);
    return () => registry.get(name).delete(callback);
  };
  const emit = (registry, name, data) => {
    registry.get(name)?.forEach((callback) => callback(data));
  };
  const term = {
    buffer: {
      active: {
        type: "normal",
        cursorX: 2,
        cursorY: 0,
        length: 1,
        getLine: () => ({ translateToString: () => line }),
      },
      onBufferChange: (callback) => ({
        dispose: on(terminalListeners, "buffer", callback),
      }),
    },
  };
  for (const name of ["Data", "LineFeed", "Render", "WriteParsed"]) {
    term[`on${name}`] = (callback) => ({
      dispose: on(terminalListeners, name, callback),
    });
  }
  const noop = () => {};
  const context = {
    ...suggestionState,
    ...require("../src/renderer/features/terminal/model/commandSuggestionCursor.js"),
    ...require("../src/renderer/features/terminal/model/promptDetection.js"),
    ...require("../src/renderer/features/terminal/model/sessionRestoreUI.js"),
    ...load(
      path.join(root, "src/renderer/features/terminal/lib/terminalHelpers.js"),
    ),
    shouldChunkInputPayload: () => false,
    getCharacterMetricsCss: () => null,
    clearGeometryFor: noop,
    processCache: { test: "pid" },
    console: { debug: noop },
    useWindowEvent: noop,
    useState(initial) {
      const index = slotIndex++;
      if (!(index in slots)) slots[index] = initial;
      return [
        slots[index],
        (value) => {
          slots[index] =
            typeof value === "function" ? value(slots[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const index = slotIndex++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback(callback, dependencies) {
      const index = slotIndex++;
      const previous = slots[index];
      if (
        !previous ||
        dependencies.some((value, i) => value !== previous.dependencies[i])
      ) {
        slots[index] = { callback, dependencies };
      }
      return slots[index].callback;
    },
    useEffect(callback, dependencies) {
      const index = slotIndex++;
      const previous = slots[index];
      if (
        !previous ||
        dependencies.some((value, i) => value !== previous.dependencies[i])
      ) {
        effects.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: callback() };
        });
      }
    },
    setTimeout(callback) {
      timers.set(++timerId, callback);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
    window: {
      addEventListener: (name, callback) => on(listeners, name, callback),
      removeEventListener: (name, callback) =>
        listeners.get(name)?.delete(callback),
      terminalAPI: {
        getCommandSuggestions: (input) =>
          new Promise((resolve) => requests.push({ input, resolve })),
        addToCommandHistory: noop,
      },
    },
  };
  context.window.setTimeout = context.setTimeout;
  context.window.clearTimeout = context.clearTimeout;
  vm.createContext(context);
  for (const [filename, name] of [
    [
      "src/renderer/features/terminal/hooks/useTerminalSuggestions.js",
      "useTerminalSuggestions",
    ],
    [
      "src/renderer/features/terminal/hooks/usePromptTracking.js",
      "usePromptTracking",
    ],
    [
      "src/renderer/features/terminal/hooks/useTerminalSessionEvents.js",
      "useTerminalSessionEvents",
    ],
  ]) {
    const source = fs
      .readFileSync(path.join(root, filename), "utf8")
      .replace(/^import[\s\S]*?;\r?\n/gm, "")
      .replace(/\bexport /g, "");
    vm.runInContext(`${source}\nthis.${name} = ${name};`, context);
  }
  const options = {
    sessionKey: "test",
    termRef: { current: term },
    terminalRef: {
      current: {
        offsetWidth: 800,
        offsetHeight: 600,
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
        }),
      },
    },
    inEditorModeRef: { current: false },
    isCommandExecutingRef: { current: false },
    lastExecutedCommandRef: { current: "" },
    lastExecutedCommandTimeRef: { current: 0 },
    scheduleTerminalLayoutSyncRef: { current: noop },
    scheduleTerminalRedrawRef: { current: noop },
    scheduleTerminalRedraw: noop,
    sendInputToProcess: (pid, data) => sent.push({ pid, data }),
    broadcastInputToGroup: noop,
    fitAddonRef: { current: {} },
    isActiveRef: { current: false },
    terminalIOMailboxRef: { current: null },
    eventManager: {
      addEventListener: (_target, name, callback) =>
        on(listeners, name, callback),
      setTimeout: context.setTimeout,
    },
    setContentUpdated: noop,
  };
  let tracking;
  const render = () => {
    slotIndex = 0;
    const api = context.useTerminalSuggestions(options);
    tracking = context.usePromptTracking({ ...options, suggestionApi: api });
    context.useTerminalSessionEvents({ ...options, ...api, ...tracking });
    effects.splice(0).forEach((effect) => effect());
    return api;
  };
  render();
  const attach = () =>
    tracking.setupCommandDetection(term, "pid", false, disposables);
  attach();
  return {
    term,
    options,
    requests,
    sent,
    render,
    attach,
    dispose: () => disposables.splice(0).forEach((item) => item.dispose()),
    input: (data) => emit(terminalListeners, "Data", data),
    setLine: (text) => {
      line = text;
    },
    parseOutput: () => emit(terminalListeners, "WriteParsed"),
    changeBuffer: (type) => {
      term.buffer.active.type = type;
      emit(terminalListeners, "buffer");
    },
    restore: (detail = { tabId: "test", processId: "pid" }) =>
      emit(listeners, "terminalSessionRestored", { detail }),
    async flush() {
      const pending = Array.from(timers.values());
      timers.clear();
      pending.forEach((callback) => callback());
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

async function expectSuggestions(harness, input = "g") {
  harness.input(input);
  await harness.flush();
  const request = harness.requests.at(-1);
  assert.equal(
    request?.input,
    input,
    "lookup must use only the new shell input",
  );
  request.resolve({
    success: true,
    suggestions: [{ command: "git status", count: 1 }],
  });
  await harness.flush();
  const api = harness.render();
  assert.equal(api.currentInput, input);
  assert.equal(
    suggestionState.shouldDisplayCommandSuggestions({
      ...api,
      inEditorMode: harness.options.inEditorModeRef.current,
      isCommandExecuting: harness.options.isCommandExecutingRef.current,
    }),
    true,
    "the floating suggestion window must become visible after reconnect",
  );
  assert.ok(api.cursorPosition, "the suggestion window must have an anchor");
}

async function testReplacementShellBufferReset() {
  const source = fs.readFileSync(
    path.join(root, "src/main/ipc/handlers/sshHandlers.js"),
    "utf8",
  );
  const method = source.match(/^ {2}_createSSHShell\([\s\S]*?^ {2}}/m);
  assert.ok(method, "SSH shell creation method must exist");
  const { _createSSHShell } = vm.runInNewContext(`({${method[0]}})`);
  for (const [isReconnectRecovery, inAlternateBuffer] of [
    [true, true],
    [true, false],
    [false, true],
  ]) {
    const term = new Terminal({ allowProposedApi: true });
    const write = (text) => new Promise((resolve) => term.write(text, resolve));
    try {
      await write("\x1b7previous shell output\r\n");
      if (inAlternateBuffer) {
        await write("\x1b[?1049hfull screen app");
      }
      assert.equal(
        term.buffer.active.type,
        inAlternateBuffer ? "alternate" : "normal",
      );
      const output = [];
      const binding = {};
      const handler = {
        pendingShellCreations: new Map(),
        childProcesses: new Map([["pid", binding]]),
        _isSSHStreamUsable: () => false,
        _bindConnectionProcess() {},
        _resetProcessResizeState() {},
        _emitProcessOutput: (_pid, text) => output.push(text),
        _setupStreamEventListeners: () => output.push("new shell prompt$ "),
        getLatencyHandlers: () => null,
      };
      await _createSSHShell.call(
        handler,
        { shell: (_options, callback) => callback(null, {}) },
        "pid",
        {},
        { key: "connection" },
        { isReconnectRecovery },
      );
      await write(output.join(""));
      assert.equal(
        term.buffer.active.type,
        isReconnectRecovery ? "normal" : "alternate",
      );
      if (isReconnectRecovery) {
        assert.match(
          term.buffer.normal.getLine(0).translateToString(),
          /previous shell output/,
          "reconnect must preserve existing terminal output",
        );
        assert.match(
          term.buffer.normal.getLine(1).translateToString(),
          /new shell prompt\$/,
          "the new prompt must reach the normal buffer",
        );
      }
    } finally {
      term.dispose();
    }
  }
  console.log(
    "PASS replacement SSH shell exits the old alternate buffer before output",
  );
}

async function run() {
  for (const oldInput of ["old", "\x1b", "\t"]) {
    const harness = createHarness();
    harness.input(oldInput);
    harness.restore();
    await expectSuggestions(harness);
    assert.equal(harness.sent.at(-1).data, "g");
    harness.dispose();
  }
  console.log("PASS reconnect clears old input, escape and Tab tracking");

  const pending = createHarness();
  pending.input("old");
  pending.restore();
  await pending.flush();
  assert.equal(
    pending.requests.length,
    0,
    "old refresh timers must be cancelled",
  );
  pending.dispose();

  const stale = createHarness();
  stale.input("old");
  await stale.flush();
  stale.restore();
  stale.requests[0].resolve({
    success: true,
    suggestions: [{ command: "old command" }],
  });
  await stale.flush();
  assert.equal(stale.render().showSuggestions, false);
  await expectSuggestions(stale);
  stale.dispose();
  console.log(
    "PASS reconnect cancels scheduled refreshes and stale IPC results",
  );

  const editor = createHarness();
  // Legacy terminals can enter editor mode without a buffer-change observer.
  delete editor.term.buffer.onBufferChange;
  editor.setLine("$ vim file");
  editor.input("\r");
  assert.equal(editor.options.inEditorModeRef.current, true);
  editor.setLine("$ ");
  editor.restore();
  assert.equal(editor.options.inEditorModeRef.current, false);
  await expectSuggestions(editor);
  editor.dispose();

  const alternate = createHarness();
  alternate.changeBuffer("alternate");
  alternate.restore();
  alternate.input("g");
  await alternate.flush();
  assert.equal(
    alternate.requests.length,
    0,
    "active editors must keep hints hidden",
  );
  alternate.changeBuffer("normal");
  alternate.parseOutput();
  await expectSuggestions(alternate);
  alternate.dispose();
  console.log("PASS editor state follows the restored terminal buffer");

  const isolated = createHarness();
  isolated.input("g");
  isolated.restore({ tabId: "other", processId: "other-pid" });
  await isolated.flush();
  assert.equal(isolated.requests.at(-1).input, "g");
  isolated.dispose();
  isolated.attach();
  isolated.input("old");
  isolated.restore();
  await expectSuggestions(isolated);
  isolated.dispose();
  console.log(
    "PASS restore stays scoped to its session and survives listener rebinding",
  );

  await testReplacementShellBufferReset();
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
