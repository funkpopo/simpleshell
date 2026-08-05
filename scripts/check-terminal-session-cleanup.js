const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const store = read("src/modules/terminal/controller/terminalSessionStore.js");
const lifecycle = read("src/components/web-terminal/useTerminalLifecycle.js");
const app = read("src/app.jsx");

assert.match(
  store,
  /export const disposeTerminalSession = \(tabId\) =>/,
  "terminal session store must expose one centralized cleanup entry point",
);
for (const cacheName of [
  "terminalCache",
  "fitAddonCache",
  "processCache",
  "disposablesCache",
  "terminalIOMailboxCache",
]) {
  assert.match(
    store,
    new RegExp(`delete ${cacheName}\\[tabId\\]`),
    `terminal cleanup must remove ${cacheName}`,
  );
}
assert.match(
  store,
  /detachWebglHandlers\(terminal\)[\s\S]*?terminal\.__webglAddon[\s\S]*?disposeResource\(terminal\)/,
  "terminal cleanup must release WebGL before disposing xterm",
);
assert.match(
  lifecycle,
  /useEffect\([\s\S]*?\(\) => \(\) => \{[\s\S]*?disposeTerminalSession\(tabId\)/,
  "WebTerminal unmount must dispose its cached session",
);
assert.match(
  app,
  /const handleCloseTab = \(index\) => \{[\s\S]*?disposeTerminalSession\(tabToRemove\.id\)/,
  "the explicit close action must use the same session cleanup path",
);
assert.match(
  store,
  /getTerminalSessionDiagnostics[\s\S]*?console\.assert/,
  "development cleanup must expose diagnostics and assert cache removal",
);

console.log("Terminal session cleanup checks passed.");
