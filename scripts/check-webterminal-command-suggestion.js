const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const {
  IPC_REQUEST_CHANNELS,
  getChannelDefinition,
} = require(path.join(ROOT, "src/core/ipc/schema/channels.js"));
const { validateSchema } = require(path.join(
  ROOT,
  "src/core/ipc/schema/validator.js",
));
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
const commandSuggestionHookSource = readSource(
  "src/hooks/useTerminalSuggestions.js",
);
const preloadSource = readSource("src/preload.js");

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

function testSuggestionLookupUsesSynchronousTerminalStateRefs() {
  assert.match(
    webTerminalSource,
    /useTerminalSuggestions\(\{[\s\S]*inEditorModeRef,[\s\S]*isCommandExecutingRef,/,
    "WebTerminal must pass live terminal state refs into the suggestion hook.",
  );

  assert.match(
    webTerminalSource,
    /const nextIsCommandExecuting\s*=[\s\S]*state\.commandRunning && !state\.promptReady;[\s\S]*isCommandExecutingRef\.current = nextIsCommandExecuting;[\s\S]*setIsCommandExecuting\(nextIsCommandExecuting\)/,
    "Prompt tracking must update the executing ref before React state commits.",
  );

  assert.match(
    webTerminalSource,
    /const setEditorModeState = useCallback\([\s\S]*inEditorModeRef\.current = normalizedInEditorMode;[\s\S]*setInEditorMode/,
    "Editor-mode changes must update the editor-mode ref before React state commits.",
  );

  assert.doesNotMatch(
    webTerminalSource,
    /useEffect\(\(\) => \{\s*(?:inEditorModeRef|isCommandExecutingRef)\.current = (?:inEditorMode|isCommandExecuting);[\s\S]*?\}, \[(?:inEditorMode|isCommandExecuting)\]\)/,
    "Live suggestion refs must not be rewritten later from stale React state effects.",
  );

  assert.match(
    commandSuggestionHookSource,
    /inEditorModeRef\.current[\s\S]*isCommandExecutingRef\.current/,
    "Suggestion lookup must read the live editor/executing refs.",
  );

  assert.doesNotMatch(
    commandSuggestionHookSource,
    /\binEditorMode\b(?!Ref)|\bisCommandExecuting\b(?!Ref)/,
    "Suggestion hook must not gate lookups on stale React state values.",
  );
}

function testCommandSuggestionIpcOmitsUndefinedLimit() {
  const definition = getChannelDefinition(
    IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_SUGGESTIONS,
  );

  assert.equal(
    validateSchema(definition.requestSchema, ["g"]).valid,
    true,
    "Command suggestion IPC must allow omitting maxResults.",
  );
  assert.equal(
    validateSchema(definition.requestSchema, ["g", 10]).valid,
    true,
    "Command suggestion IPC must allow a numeric maxResults.",
  );
  assert.equal(
    validateSchema(definition.requestSchema, ["g", undefined]).valid,
    false,
    "Command suggestion IPC must reject an undefined maxResults argument.",
  );

  assert.match(
    preloadSource,
    /getCommandSuggestions:\s*\(input,\s*maxResults\)\s*=>\s*\{[\s\S]*if\s*\(\s*maxResults === undefined\s*\)\s*\{[\s\S]*ipcRenderer\.invoke\(\s*IPC_REQUEST_CHANNELS\.COMMAND_HISTORY_GET_SUGGESTIONS,\s*input,\s*\)/,
    "Preload must omit maxResults from the IPC argument list when it is undefined.",
  );

  assert.match(
    commandSuggestionHookSource,
    /const COMMAND_SUGGESTION_LIMIT = 10;/,
    "Command suggestion lookups must use an explicit numeric result limit.",
  );
  assert.match(
    commandSuggestionHookSource,
    /getCommandSuggestions\(\s*trimmedInput,\s*COMMAND_SUGGESTION_LIMIT,\s*\)/,
    "WebTerminal suggestion lookup must pass a numeric maxResults value.",
  );
}

function testSuggestionSuppressionFlagsUpdateRefsSynchronously() {
  assert.match(
    commandSuggestionHookSource,
    /const setSuggestionsHiddenByEsc = useCallback\([\s\S]*suggestionsHiddenByEscRef\.current = nextValue;[\s\S]*setSuggestionsHiddenByEscState\(nextValue\)/,
    "Esc-hidden suggestion state must update the live ref before React state commits.",
  );

  assert.match(
    commandSuggestionHookSource,
    /const setSuggestionsSuppressedUntilEnter = useCallback\([\s\S]*suggestionsSuppressedRef\.current = nextValue;[\s\S]*setSuggestionsSuppressedUntilEnterState\(nextValue\)/,
    "Suppressed-until-enter suggestion state must update the live ref before React state commits.",
  );

  assert.match(
    webTerminalSource,
    /setSuggestionsSuppressedUntilEnter\(false\);[\s\S]*setSuggestionsHiddenByEsc\(false\);[\s\S]*!suggestionsHiddenByEscRef\.current &&[\s\S]*!suggestionsSuppressedRef\.current/,
    "Continuing input after suppression must clear live refs before checking whether to request suggestions.",
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
      "suggestion lookup uses synchronous terminal state refs",
      testSuggestionLookupUsesSynchronousTerminalStateRefs,
    ],
    [
      "command suggestion IPC omits undefined limit",
      testCommandSuggestionIpcOmitsUndefinedLimit,
    ],
    [
      "suggestion suppression flags update refs synchronously",
      testSuggestionSuppressionFlagsUpdateRefsSynchronously,
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
    `\n${tests.length} WebTerminal command suggestion checks passed.`,
  );
}

run();
