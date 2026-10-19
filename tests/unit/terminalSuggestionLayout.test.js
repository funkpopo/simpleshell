import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("suggestion-lifecycle", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const vm = require("node:vm");

    const root = _path.resolve(_repoRoot, "");
    const source = fs
      .readFileSync(
        path.join(
          root,
          "src/renderer/features/terminal/hooks/useTerminalSuggestions.js",
        ),
        "utf8",
      )
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
        ...require("../../src/renderer/features/terminal/model/commandSuggestionState.js"),
        ...require("../../src/renderer/features/terminal/model/commandSuggestionCursor.js"),
        ...require("../../src/renderer/features/terminal/model/commandSuggestionPosition.js"),
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
              new Promise((resolve, reject) =>
                requests.push({ resolve, reject }),
              ),
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
      harness.resize({
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
      });
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
        path.join(
          root,
          "src/renderer/features/connections/VirtualizedConnectionList.jsx",
        ),
        "utf8",
      );
      assert.doesNotMatch(listSource, /setExpandedGroups/);
      assert.match(listSource, /const expandedGroups = useMemo/);
      const toggleSource =
        require("../helpers/renderer-sources.js").readRendererCallback(
          "src/renderer/features/connections/ConnectionManager.jsx",
          "handleToggleGroup",
        );
      assert.doesNotMatch(toggleSource, /saveConnections/);
      console.log(
        "PASS folder expansion uses controlled state and avoids duplicate persistence",
      );
    }

    await run();
  });
});

describe("webterminal-reconnect-ui", () => {
  const assert = require("node:assert/strict");
  const path = require("node:path");

  const ROOT = _path.resolve(_repoRoot, "");

  const {
    createSuggestionSuppressionContext,
    resetSessionRestoreInteractionState,
  } = require(
    path.join(ROOT, "src/renderer/features/terminal/model/sessionRestoreUI.js"),
  );
  const { resolveCommandSuggestionWindowPosition } = require(
    path.join(
      ROOT,
      "src/renderer/features/terminal/model/commandSuggestionPosition.js",
    ),
  );

  function testSessionRestoreInteractionReset() {
    const calls = [];
    const selectedRef = { current: true };
    const previousContext = { input: "git", timestamp: 12345 };
    const suppressionContextRef = { current: previousContext };

    resetSessionRestoreInteractionState({
      setShowSuggestions: (value) => calls.push(["showSuggestions", value]),
      setSuggestions: (value) => calls.push(["suggestions", value]),
      setCurrentInput: (value) => calls.push(["currentInput", value]),
      setSuggestionsHiddenByEsc: (value) => calls.push(["hiddenByEsc", value]),
      setSuggestionsSuppressedUntilEnter: (value) =>
        calls.push(["suppressedUntilEnter", value]),
      suggestionSelectedRef: selectedRef,
      suppressionContextRef,
    });

    assert.deepEqual(calls, [
      ["showSuggestions", false],
      ["suggestions", []],
      ["currentInput", ""],
      ["hiddenByEsc", false],
      ["suppressedUntilEnter", false],
    ]);
    assert.equal(selectedRef.current, false, "恢复后不应保留旧的建议选中状态");
    assert.notStrictEqual(
      suppressionContextRef.current,
      previousContext,
      "恢复后应创建新的抑制上下文，避免沿用旧引用",
    );
    assert.deepEqual(
      suppressionContextRef.current,
      createSuggestionSuppressionContext(),
      "恢复后应清空旧的建议抑制输入上下文",
    );
  }

  function testSuggestionWindowFlipsAboveNearBottom() {
    const position = resolveCommandSuggestionWindowPosition({
      position: {
        x: 360,
        y: 280,
        cursorHeight: 18,
        cursorBottom: 298,
        showAbove: false,
      },
      windowDimensions: {
        width: 240,
        height: 180,
      },
      terminalRect: {
        left: 100,
        top: 100,
        right: 520,
        bottom: 320,
      },
      windowWidth: 1440,
      windowHeight: 900,
    });

    assert.equal(
      position.showAbove,
      true,
      "当光标下方空间不足时，建议窗口应翻转到上方",
    );
    assert.ok(
      position.top >= 108 &&
        position.top + position.height <= 312 &&
        position.left >= 108 &&
        position.left + position.width <= 512,
      "翻转后的建议窗口应仍被限制在 terminal 容器内",
    );
  }

  function testSuggestionWindowShrinksAndClampsInsideContainer() {
    const position = resolveCommandSuggestionWindowPosition({
      position: {
        x: 430,
        y: 140,
        cursorHeight: 18,
        cursorBottom: 158,
        showAbove: false,
      },
      windowDimensions: {
        width: 320,
        height: 260,
      },
      terminalRect: {
        left: 200,
        top: 60,
        right: 460,
        bottom: 240,
      },
      windowWidth: 1440,
      windowHeight: 900,
    });

    assert.ok(
      position.width <= 244,
      "容器较窄时，建议窗口宽度应收缩到可用区域内",
    );
    assert.ok(
      position.height <= 164,
      "容器较矮时，建议窗口高度应收缩到可用区域内",
    );
    assert.ok(
      position.left >= 208 && position.left + position.width <= 452,
      "横向位置应被钳制在 terminal 容器内",
    );
    assert.ok(
      position.top >= 68 && position.top + position.height <= 232,
      "纵向位置应被钳制在 terminal 容器内",
    );
  }

  function createValidSuggestionPositionInput(overrides = {}) {
    const hasOverride = (key) =>
      Object.prototype.hasOwnProperty.call(overrides, key);

    return {
      position: hasOverride("position")
        ? overrides.position && {
            x: 260,
            y: 140,
            cursorHeight: 18,
            cursorBottom: 158,
            showAbove: false,
            ...overrides.position,
          }
        : {
            x: 260,
            y: 140,
            cursorHeight: 18,
            cursorBottom: 158,
            showAbove: false,
          },
      windowDimensions: hasOverride("windowDimensions")
        ? overrides.windowDimensions && {
            width: 260,
            height: 180,
            ...overrides.windowDimensions,
          }
        : {
            width: 260,
            height: 180,
          },
      terminalRect: hasOverride("terminalRect")
        ? overrides.terminalRect && {
            left: 100,
            top: 80,
            right: 620,
            bottom: 420,
            ...overrides.terminalRect,
          }
        : {
            left: 100,
            top: 80,
            right: 620,
            bottom: 420,
          },
      windowWidth: 1440,
      windowHeight: 900,
      ...Object.fromEntries(
        Object.entries(overrides).filter(
          ([key]) =>
            key !== "position" &&
            key !== "windowDimensions" &&
            key !== "terminalRect",
        ),
      ),
    };
  }

  function testSuggestionWindowRejectsIncompletePositionContext() {
    const invalidInputs = [
      {},
      createValidSuggestionPositionInput({ position: null }),
      createValidSuggestionPositionInput({ terminalRect: null }),
      createValidSuggestionPositionInput({ windowDimensions: null }),
      createValidSuggestionPositionInput({ position: { x: NaN } }),
      createValidSuggestionPositionInput({ position: { y: undefined } }),
      createValidSuggestionPositionInput({
        position: { cursorHeight: undefined },
      }),
      createValidSuggestionPositionInput({
        position: { cursorBottom: undefined },
      }),
      createValidSuggestionPositionInput({ terminalRect: { right: 100 } }),
      createValidSuggestionPositionInput({ terminalRect: { bottom: 80 } }),
      createValidSuggestionPositionInput({ windowWidth: 0 }),
      createValidSuggestionPositionInput({ windowHeight: 0 }),
      createValidSuggestionPositionInput({ windowDimensions: { width: 0 } }),
      createValidSuggestionPositionInput({ windowDimensions: { height: 0 } }),
    ];

    invalidInputs.forEach((input, index) => {
      assert.equal(
        resolveCommandSuggestionWindowPosition(input),
        null,
        `invalid command suggestion position context should not produce fallback coordinates: ${index}`,
      );
    });
  }

  it("session restore interaction reset", testSessionRestoreInteractionReset);
  it("suggestion window flips above", testSuggestionWindowFlipsAboveNearBottom);
  it(
    "suggestion window shrinks and clamps inside container",
    testSuggestionWindowShrinksAndClampsInsideContainer,
  );
  it(
    "suggestion window rejects incomplete position context",
    testSuggestionWindowRejectsIncompletePositionContext,
  );
});

describe("webterminal-prompt-shortcut", () => {
  const assert = require("node:assert/strict");
  const path = require("node:path");

  const ROOT = _path.resolve(_repoRoot, "");

  const { isLikelyPromptLine, isPromptReadyFromTerminal } = require(
    path.join(ROOT, "src/renderer/features/terminal/model/promptDetection.js"),
  );
  const {
    isSystemShortcutRecoveryKey,
    shouldArmSystemShortcutRecovery,
  } = require(
    path.join(
      ROOT,
      "src/renderer/features/terminal/model/systemShortcutRecovery.js",
    ),
  );

  function createMockTerm({
    line = "",
    type = "normal",
    cursorY = 0,
    wrapped = false,
  } = {}) {
    return {
      buffer: {
        active: {
          type,
          cursorY,
          getLine(index) {
            if (index !== cursorY) {
              return null;
            }

            return {
              isWrapped: wrapped,
              translateToString() {
                return line;
              },
            };
          },
        },
      },
    };
  }

  function testDatabaseCliPromptsAreRecognized() {
    assert.equal(isLikelyPromptLine("mysql> "), true);
    assert.equal(isLikelyPromptLine("mysql> select 1;"), true);
    assert.equal(isLikelyPromptLine("MariaDB [test]> "), true);
    assert.equal(isLikelyPromptLine("sqlite> .tables"), true);
    assert.equal(isLikelyPromptLine("postgres=> "), true);
    assert.equal(isLikelyPromptLine("postgres=# select now();"), true);
  }

  function testContinuationPromptsStaySuppressed() {
    assert.equal(isLikelyPromptLine("-> "), false);
    assert.equal(isLikelyPromptLine("'> "), false);
    assert.equal(isLikelyPromptLine("postgres-> "), false);
  }

  function testPromptReadyIgnoresAlternateBuffer() {
    const normalTerm = createMockTerm({ line: "mysql> " });
    const alternateTerm = createMockTerm({
      line: "mysql> ",
      type: "alternate",
    });

    assert.equal(isPromptReadyFromTerminal(normalTerm), true);
    assert.equal(isPromptReadyFromTerminal(alternateTerm), false);
  }

  function testShortcutRecoveryArming() {
    assert.equal(isSystemShortcutRecoveryKey("Shift"), true);
    assert.equal(isSystemShortcutRecoveryKey("Alt"), true);
    assert.equal(
      shouldArmSystemShortcutRecovery(
        { key: "Shift", ctrlKey: false, metaKey: false, repeat: false },
        { terminalFocused: true },
      ),
      true,
    );
    assert.equal(
      shouldArmSystemShortcutRecovery(
        { key: "Alt", ctrlKey: false, metaKey: false, repeat: false },
        { terminalFocused: true },
      ),
      true,
    );
    assert.equal(
      shouldArmSystemShortcutRecovery(
        { key: "Shift", ctrlKey: false, metaKey: false, repeat: false },
        { terminalFocused: false },
      ),
      false,
    );
    assert.equal(
      shouldArmSystemShortcutRecovery(
        { key: ";", ctrlKey: true, metaKey: false, repeat: false },
        { terminalFocused: true },
      ),
      false,
    );
  }

  it(
    "database cli prompts are recognized",
    testDatabaseCliPromptsAreRecognized,
  );
  it(
    "continuation prompts stay suppressed",
    testContinuationPromptsStaySuppressed,
  );
  it(
    "alternate buffer does not count as prompt ready",
    testPromptReadyIgnoresAlternateBuffer,
  );
  it(
    "shortcut recovery arming is limited to modifier shortcuts",
    testShortcutRecoveryArming,
  );
});
