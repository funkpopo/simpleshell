const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const { isLikelyPromptLine, isPromptReadyFromTerminal } = require(
  path.join(ROOT, "src/modules/terminal/promptDetection.js"),
);
const {
  isSystemShortcutRecoveryKey,
  shouldArmSystemShortcutRecovery,
} = require(path.join(ROOT, "src/modules/terminal/systemShortcutRecovery.js"));

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

function run() {
  const tests = [
    [
      "database cli prompts are recognized",
      testDatabaseCliPromptsAreRecognized,
    ],
    [
      "continuation prompts stay suppressed",
      testContinuationPromptsStaySuppressed,
    ],
    [
      "alternate buffer does not count as prompt ready",
      testPromptReadyIgnoresAlternateBuffer,
    ],
    [
      "shortcut recovery arming is limited to modifier shortcuts",
      testShortcutRecoveryArming,
    ],
  ];

  tests.forEach(([name, fn]) => {
    fn();
    console.log(`PASS ${name}`);
  });

  console.log(
    `\n${tests.length} WebTerminal prompt/shortcut regression checks passed.`,
  );
}

run();
