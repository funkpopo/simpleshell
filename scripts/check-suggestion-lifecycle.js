const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const source = fs
  .readFileSync(path.join(root, "src/hooks/useTerminalSuggestions.js"), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/gm, "")
  .replace(
    "export const useTerminalSuggestions",
    "const useTerminalSuggestions",
  );

function createHarness() {
  const slots = [];
  const pendingEffects = [];
  const requests = [];
  const listeners = new Map();
  let slotIndex = 0;
  let rect = {
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
  };
  let resizeCallback;
  const context = {
    ...require("../src/modules/terminal/commandSuggestionState.js"),
    ...require("../src/modules/terminal/commandSuggestionCursor.js"),
    getCharacterMetricsCss: () => null,
    useWindowEvent: () => {},
    processCache: {},
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
        dependencies.some(
          (value, offset) => value !== previous.dependencies[offset],
        )
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
        dependencies.some(
          (value, offset) => value !== previous.dependencies[offset],
        )
      ) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          slots[index] = { dependencies, cleanup: callback() };
        });
      }
    },
    ResizeObserver: class {
      constructor(callback) {
        resizeCallback = callback;
      }
      observe() {}
      disconnect() {
        resizeCallback = null;
      }
    },
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
      terminalAPI: {
        getCommandSuggestions: () =>
          new Promise((resolve, reject) => requests.push({ resolve, reject })),
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    `${source}\nthis.useTerminalSuggestions = useTerminalSuggestions;`,
    context,
  );
  const options = {
    tabId: "test",
    termRef: { current: { buffer: { active: {} } } },
    terminalRef: { current: { getBoundingClientRect: () => rect } },
    inEditorModeRef: { current: false },
    isCommandExecutingRef: { current: false },
    lastExecutedCommandRef: { current: "" },
    lastExecutedCommandTimeRef: { current: 0 },
  };
  return {
    requests,
    render() {
      slotIndex = 0;
      const result = context.useTerminalSuggestions(options);
      pendingEffects.splice(0).forEach((effect) => effect());
      return result;
    },
    resize(nextRect) {
      rect = nextRect;
      resizeCallback?.();
    },
    unmount() {
      slots.forEach((slot) => slot?.cleanup?.());
    },
    listeners,
  };
}

const response = {
  success: true,
  suggestions: [{ command: "git status", count: 1 }],
};

async function run() {
  const harness = createHarness();
  let api = harness.render();
  api.setCurrentInput("g");
  const oldRequest = api.getSuggestions("g");
  api.setCurrentInput("gi");
  const newRequest = api.getSuggestions("gi");
  harness.requests[1].resolve(response);
  await newRequest;
  harness.requests[0].reject(new Error("late IPC failure"));
  await oldRequest;
  api = harness.render();
  assert.equal(
    api.showSuggestions,
    true,
    "stale failures must not hide newer results",
  );

  const pending = api.getSuggestions("gi");
  api.setShowSuggestions(false);
  harness.requests[2].resolve(response);
  await pending;
  assert.equal(
    harness.render().showSuggestions,
    false,
    "hidden windows must not reopen from pending requests",
  );

  const changedInput = api.getSuggestions("gi");
  api.setCurrentInput("");
  harness.requests[3].resolve(response);
  await changedInput;
  assert.equal(
    harness.render().showSuggestions,
    false,
    "changed input must invalidate pending results",
  );

  api.setSuggestionsSuppressedUntilEnter(true);
  await api.getSuggestions("gi");
  assert.equal(
    harness.requests.length,
    4,
    "suppressed suggestions must not request data",
  );
  api.setSuggestionsSuppressedUntilEnter(false);
  api.setCurrentInput("gi");
  harness.resize({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
  const hiddenLayout = api.getSuggestions("gi");
  harness.requests[4].resolve(response);
  await hiddenLayout;
  api = harness.render();
  assert.equal(api.showSuggestions, true);
  assert.equal(
    api.suggestions.length,
    1,
    "temporary zero-size layout must retain results",
  );
  assert.equal(api.cursorPosition, null);
  harness.resize({
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
  });
  assert.ok(
    harness.render().cursorPosition,
    "restored layout must recover window position without input",
  );
  const unmountedRequest = api.getSuggestions("gi");
  harness.unmount();
  harness.requests[5].resolve(response);
  await unmountedRequest;
  assert.equal(harness.listeners.size, 0);
  console.log(
    "PASS suggestion request races, suppression, layout recovery and cleanup",
  );

  const listSource = fs.readFileSync(
    path.join(root, "src/components/VirtualizedConnectionList.jsx"),
    "utf8",
  );
  assert.doesNotMatch(listSource, /setExpandedGroups/);
  assert.match(listSource, /const expandedGroups = useMemo/);
  const managerSource = fs.readFileSync(
    path.join(root, "src/components/ConnectionManager.jsx"),
    "utf8",
  );
  const toggleSource = managerSource.slice(
    managerSource.indexOf("const handleToggleGroup"),
    managerSource.indexOf("const handleAddConnection"),
  );
  assert.doesNotMatch(toggleSource, /saveConnections/);
  console.log(
    "PASS folder expansion uses controlled state and avoids duplicate persistence",
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
