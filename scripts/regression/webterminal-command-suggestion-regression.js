const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const {
  isSuggestionTrackingContext,
  shouldDisplayCommandSuggestions,
  shouldRequestCommandSuggestions,
  shouldResumePromptTrackingOnInput,
} = require(path.join(ROOT, "src/modules/terminal/commandSuggestionState.js"));

function createMockTerm({ type = "normal" } = {}) {
  return {
    buffer: {
      active: {
        type,
      },
    },
  };
}

function testSingleCharacterStartsSuggestionLookup() {
  assert.equal(shouldRequestCommandSuggestions("g"), true);
  assert.equal(shouldRequestCommandSuggestions("  g  "), true);
  assert.equal(shouldRequestCommandSuggestions("   "), false);
}

function testPrintableInputRestoresPromptTrackingInNormalBuffer() {
  const normalTerm = createMockTerm();
  const alternateTerm = createMockTerm({ type: "alternate" });

  assert.equal(isSuggestionTrackingContext(normalTerm), true);
  assert.equal(isSuggestionTrackingContext(alternateTerm), false);
  assert.equal(
    shouldResumePromptTrackingOnInput({
      term: normalTerm,
      inEditorMode: false,
      data: "g",
    }),
    true,
  );
  assert.equal(
    shouldResumePromptTrackingOnInput({
      term: alternateTerm,
      inEditorMode: false,
      data: "g",
    }),
    false,
  );
  assert.equal(
    shouldResumePromptTrackingOnInput({
      term: normalTerm,
      inEditorMode: true,
      data: "g",
    }),
    false,
  );
  assert.equal(
    shouldResumePromptTrackingOnInput({
      term: normalTerm,
      inEditorMode: false,
      data: "\u0003",
    }),
    false,
  );
}

function testSuggestionWindowVisibilityTracksRealInputState() {
  assert.equal(
    shouldDisplayCommandSuggestions({
      showSuggestions: true,
      suggestions: [{ command: "git status", count: 3 }],
      currentInput: "g",
      inEditorMode: false,
      isCommandExecuting: false,
    }),
    true,
  );
  assert.equal(
    shouldDisplayCommandSuggestions({
      showSuggestions: true,
      suggestions: [{ command: "git status", count: 3 }],
      currentInput: "g",
      inEditorMode: false,
      isCommandExecuting: true,
    }),
    false,
  );
  assert.equal(
    shouldDisplayCommandSuggestions({
      showSuggestions: true,
      suggestions: [{ command: "git status", count: 3 }],
      currentInput: " ",
      inEditorMode: false,
      isCommandExecuting: false,
    }),
    false,
  );
}

function run() {
  const tests = [
    [
      "single character input starts command suggestion lookup",
      testSingleCharacterStartsSuggestionLookup,
    ],
    [
      "printable input restores prompt tracking in normal buffer only",
      testPrintableInputRestoresPromptTrackingInNormalBuffer,
    ],
    [
      "suggestion window visibility follows actual input state",
      testSuggestionWindowVisibilityTracksRealInputState,
    ],
  ];

  tests.forEach(([name, fn]) => {
    fn();
    console.log(`PASS ${name}`);
  });

  console.log(
    `\n${tests.length} WebTerminal command suggestion regression checks passed.`,
  );
}

run();
