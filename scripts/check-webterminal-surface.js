const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const webTerminal = read("src/components/WebTerminal.jsx");
const terminalSurfaceCss = read("src/styles/terminal.css");
const themeVariables = read("src/styles/theme-variables.css");
const terminalTheme = read("src/modules/terminal/terminalTheme.js");
const searchOverlay = read(
  "src/components/web-terminal/WebTerminalSearchOverlay.jsx",
);
const searchHook = read("src/hooks/useTerminalSearch.js");
const contextMenu = read(
  "src/components/web-terminal/WebTerminalContextMenu.jsx",
);

// P0.4 — line height configurable around 1.15–1.25 (default 1.2)
assert.match(
  terminalTheme,
  /DEFAULT_TERMINAL_LINE_HEIGHT\s*=\s*1\.2/,
  "default terminal line height must be 1.2",
);
assert.match(
  webTerminal,
  /DEFAULT_TERMINAL_LINE_HEIGHT|normalizeTerminalLineHeight/,
  "WebTerminal must use shared line height helpers",
);
assert.match(
  webTerminal,
  /terminalLineHeight/,
  "WebTerminal must react to terminalLineHeight settings",
);

// P0.4 — 16-color theme aligned with UI tokens
assert.match(
  themeVariables,
  /--terminal-bg/,
  "theme-variables must define terminal surface tokens",
);
assert.match(
  themeVariables,
  /--terminal-selection/,
  "theme-variables must define terminal selection token",
);
assert.match(
  terminalTheme,
  /getTerminalTheme/,
  "terminalTheme module must export getTerminalTheme",
);
assert.match(
  webTerminal,
  /getTerminalTheme\(/,
  "WebTerminal must build theme via getTerminalTheme",
);

// P0.4 — single surface style source
assert.match(
  terminalSurfaceCss,
  /\.xterm-selection/,
  "styles/terminal.css must own selection styles",
);
assert.match(
  terminalSurfaceCss,
  /var\(--app-scrollbar-thumb\)/,
  "terminal scrollbar must use app scrollbar tokens",
);
assert.match(
  terminalSurfaceCss,
  /var\(--terminal-focus-ring\)/,
  "terminal focus ring must use theme token",
);
assert.match(
  terminalSurfaceCss,
  /var\(--terminal-selection\)/,
  "terminal selection CSS must use theme token",
);

// P0.5 — productized search overlay with case / regex / whole word
assert.match(
  searchOverlay,
  /ToggleButton/,
  "search overlay should expose MUI toggle options",
);
assert.match(
  searchOverlay,
  /caseSensitive|Aa/,
  "search overlay must support case-sensitive toggle",
);
assert.match(
  searchOverlay,
  /regex|\.\*/,
  "search overlay must support regex toggle",
);
assert.match(
  searchOverlay,
  /wholeWord/,
  "search overlay must support whole-word toggle",
);
assert.match(
  searchHook,
  /caseSensitive/,
  "useTerminalSearch must track caseSensitive",
);
assert.match(searchHook, /regex/, "useTerminalSearch must track regex");
assert.match(
  searchHook,
  /wholeWord/,
  "useTerminalSearch must track wholeWord",
);

// P0.5 — shortcut hints match bindings
assert.match(
  contextMenu,
  /Ctrl\+;/,
  "context menu must show Ctrl+; for copy",
);
assert.match(
  contextMenu,
  /Ctrl\+\//,
  "context menu must show Ctrl+/ for search",
);
assert.match(
  contextMenu,
  /Ctrl\+L/,
  "context menu must show Ctrl+L for clear",
);
assert.match(
  webTerminal,
  /e\.key\.toLowerCase\(\)\s*===\s*["']l["']/,
  "WebTerminal must bind Ctrl+L clear to match context menu",
);
assert.match(
  webTerminal,
  /e\.ctrlKey\s*&&\s*e\.key\s*===\s*["'];["']/,
  "WebTerminal must bind Ctrl+; copy",
);
assert.match(
  webTerminal,
  /e\.ctrlKey\s*&&\s*e\.key\s*===\s*["']\/["']/,
  "WebTerminal must bind Ctrl+/ search",
);

console.log("WebTerminal surface experience checks passed.");
