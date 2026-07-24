const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const webTerminal = read("src/components/WebTerminal.jsx");
const webTerminalCss = read("src/components/WebTerminal.css");
const terminalSurfaceCss = read("src/styles/terminal.css");
const terminalDom = read("src/modules/terminal/controller/terminalDom.js");

const forbiddenWebTerminalPatterns = [
  [/querySelector(All)?\(\s*["']\.xterm-selection/, "selection DOM queries"],
  [/xterm-selection-duplicate/, "duplicate selection marker"],
  [/handleSelectionChange/, "document selectionchange adjustment"],
  [/adjustSelectionElements/, "manual selection adjustment"],
  [/scheduleSelectionAdjustment/, "selection adjustment scheduler"],
  [/forceResizeTerminal/, "legacy force resize path"],
  [/MutationObserver/, "mutation observer layout path"],
  [/xterm-search-selection-hidden/, "search selection hiding class"],
];

for (const [pattern, label] of forbiddenWebTerminalPatterns) {
  assert.equal(
    pattern.test(webTerminal),
    false,
    `WebTerminal must not contain ${label}`,
  );
}

const collectSelectionCssRules = (content) =>
  Array.from(content.matchAll(/[^{}]*\.xterm-selection[^{}]*\{[^{}]*\}/g)).map(
    ([rule]) => rule,
  );

const forbiddenSelectionCss = [
  [/transition\s*:/, "selection transition"],
  [/transform\s*:/, "selection transform"],
  [/box-shadow\s*:/, "selection shadow"],
  [/linear-gradient/, "selection gradient"],
  [/z-index\s*:/, "selection z-index"],
  [/xterm-selection-duplicate/, "duplicate selection CSS"],
  [/xterm-search-selection-hidden/, "search selection hiding CSS"],
];

for (const source of [
  ["WebTerminal.css", webTerminalCss],
  ["styles/terminal.css", terminalSurfaceCss],
  ["terminalDom.js", terminalDom],
]) {
  const [name, content] = source;
  const selectionRules = collectSelectionCssRules(content).join("\n");
  for (const [pattern, label] of forbiddenSelectionCss) {
    assert.equal(
      pattern.test(selectionRules),
      false,
      `${name} must not contain ${label}`,
    );
  }
}

assert.match(
  webTerminal,
  /const scheduleTerminalLayoutSync = useCallback/,
  "WebTerminal must expose a single scheduled layout sync entry point",
);

assert.equal(
  (webTerminal.match(/fitAddon\.fit\(\)/g) || []).length,
  1,
  "fitAddon.fit() should only be called inside the unified layout sync",
);

assert.equal(
  /letterSpacing:\s*0\b/.test(webTerminal),
  true,
  "terminal letter spacing must remain zero for stable cell geometry",
);

console.log("WebTerminal selection stability checks passed.");
