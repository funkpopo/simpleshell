const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const {
  createSuggestionSuppressionContext,
  resetSessionRestoreInteractionState,
} = require(path.join(ROOT, "src/modules/terminal/sessionRestoreUI.js"));
const {
  resolveCommandSuggestionWindowPosition,
} = require(path.join(
  ROOT,
  "src/modules/terminal/commandSuggestionPosition.js",
));

function testSessionRestoreInteractionReset() {
  const calls = [];
  const selectedRef = { current: true };
  const previousContext = { input: "git", timestamp: 12345 };
  const suppressionContextRef = { current: previousContext };

  resetSessionRestoreInteractionState({
    setShowSuggestions: (value) => calls.push(["showSuggestions", value]),
    setSuggestions: (value) => calls.push(["suggestions", value]),
    setCurrentInput: (value) => calls.push(["currentInput", value]),
    setSuggestionsHiddenByEsc: (value) =>
      calls.push(["hiddenByEsc", value]),
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
  assert.equal(
    selectedRef.current,
    false,
    "恢复后不应保留旧的建议选中状态",
  );
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

function run() {
  const tests = [
    ["session restore interaction reset", testSessionRestoreInteractionReset],
    ["suggestion window flips above", testSuggestionWindowFlipsAboveNearBottom],
    [
      "suggestion window shrinks and clamps inside container",
      testSuggestionWindowShrinksAndClampsInsideContainer,
    ],
  ];

  tests.forEach(([name, fn]) => {
    fn();
    console.log(`PASS ${name}`);
  });

  console.log(`\n${tests.length} UI reconnect regression checks passed.`);
}

run();
