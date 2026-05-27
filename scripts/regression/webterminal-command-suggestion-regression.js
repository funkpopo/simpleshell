const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const {
  isSuggestionTrackingContext,
  shouldDisplayCommandSuggestions,
  shouldIgnoreCommandSuggestionKeyEvent,
  shouldRequestCommandSuggestions,
  shouldResumePromptTrackingOnInput,
} = require(path.join(ROOT, "src/modules/terminal/commandSuggestionState.js"));

const webTerminalSource = readSource("src/components/WebTerminal.jsx");
const commandSuggestionSource = readSource(
  "src/components/CommandSuggestion.jsx",
);

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

function testImeAndSystemKeysDoNotDriveSuggestionWindow() {
  const ignoredEvents = [
    { key: "a", isComposing: true },
    { key: "Process", keyCode: 229 },
    { key: "Unidentified" },
    { key: "Dead" },
    { key: "Shift" },
    { key: "AltGraph" },
    { key: "ModeChange" },
    { key: "Convert" },
    { key: "NonConvert" },
    { key: "HangulMode" },
    { key: "HanjaMode" },
    { key: "KanaMode" },
    { key: "KanjiMode" },
  ];

  for (const event of ignoredEvents) {
    assert.equal(
      shouldIgnoreCommandSuggestionKeyEvent(event),
      true,
      `IME/system key event should not affect command suggestions: ${event.key}`,
    );
  }

  assert.equal(
    shouldIgnoreCommandSuggestionKeyEvent({ key: "ArrowDown" }),
    false,
  );
  assert.equal(shouldIgnoreCommandSuggestionKeyEvent({ key: "Enter" }), false);
  assert.equal(shouldIgnoreCommandSuggestionKeyEvent({ key: "Delete" }), false);
}

function testImeAndSystemKeysAreWiredIntoSuggestionSurfaces() {
  assert.match(
    webTerminalSource,
    /shouldIgnoreCommandSuggestionKeyEvent/,
    "WebTerminal must import and use the IME/system key guard.",
  );

  assert.match(
    webTerminalSource,
    /const imeCompositionActiveRef = useRef\(false\)/,
    "WebTerminal must track active IME composition state.",
  );

  assert.match(
    webTerminalSource,
    /"compositionstart"[\s\S]*imeCompositionActiveRef\.current = true/,
    "IME composition start must mark command suggestions as composition-active.",
  );

  assert.match(
    webTerminalSource,
    /"compositionend"[\s\S]*imeCompositionActiveRef\.current = false/,
    "IME composition end must clear command suggestion composition state.",
  );

  assert.match(
    webTerminalSource,
    /"compositioncancel"[\s\S]*imeCompositionActiveRef\.current = false/,
    "IME composition cancellation must clear command suggestion composition state.",
  );

  assert.match(
    webTerminalSource,
    /recoverTerminalAfterActivation[\s\S]*refreshSuggestions = false/,
    "Window activation recovery must not refresh the suggestion window by default.",
  );

  assert.match(
    webTerminalSource,
    /recoverTerminalInteractionState[\s\S]*refreshSuggestions = false/,
    "Terminal interaction recovery must not refresh the suggestion window by default.",
  );

  assert.doesNotMatch(
    webTerminalSource,
    /refreshSuggestions:\s*true|refreshSuggestions\s*=\s*true/,
    "System focus and shortcut recovery paths must not force command suggestion refresh.",
  );

  assert.match(
    commandSuggestionSource,
    /shouldIgnoreCommandSuggestionKeyEvent/,
    "CommandSuggestion must ignore IME/system key events in its global key handler.",
  );

  assert.doesNotMatch(
    commandSuggestionSource,
    /behavior:\s*"smooth"/,
    "CommandSuggestion must not use smooth scrolling for selection visibility.",
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
    [
      "IME and system keys do not drive command suggestion window logic",
      testImeAndSystemKeysDoNotDriveSuggestionWindow,
    ],
    [
      "IME and system keys are wired into suggestion surfaces",
      testImeAndSystemKeysAreWiredIntoSuggestionSurfaces,
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
