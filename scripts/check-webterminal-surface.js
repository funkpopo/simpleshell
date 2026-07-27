const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  collectWebTerminalSources,
  readSource,
} = require("./lib/webterminal-sources.js");

const repoRoot = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const webTerminal = collectWebTerminalSources();
const webTerminalCss = read("src/components/WebTerminal.css");
const terminalCss = read("src/styles/terminal.css");
const terminalDom = read("src/modules/terminal/controller/terminalDom.js");
const terminalTheme = read("src/modules/terminal/terminalTheme.js");
const themeVariables = read("src/styles/theme-variables.css");
const searchOverlay = readSource(
  "src/components/web-terminal/WebTerminalSearchOverlay.jsx",
);
const searchHook = read("src/hooks/useTerminalSearch.js");
const contextMenu = readSource(
  "src/components/web-terminal/WebTerminalContextMenu.jsx",
);

// Line height remains configurable, but default stays at historical 1.0 (no visual redesign).
assert.match(
  terminalTheme,
  /DEFAULT_TERMINAL_LINE_HEIGHT\s*=\s*1\.0/,
  "default terminal line height must remain 1.0",
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

// Historical xterm theme palette (not MUI surface-token redesign).
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
assert.match(
  terminalTheme,
  /#f6f8fa/,
  "light terminal background must keep historical palette",
);
assert.match(
  terminalTheme,
  /rgba\(212,\s*253,\s*62,\s*0\.49\)/,
  "dark selection must keep historical palette",
);

// Pre-d52c38e style sources remain in place (no single-token surface redesign).
assert.match(
  webTerminalCss,
  /\.xterm-selection/,
  "WebTerminal.css must own historical selection styles",
);
assert.match(
  webTerminalCss,
  /rgba\(255,\s*223,\s*0,\s*0\.32\)/,
  "dark selection highlight must keep historical CSS",
);
assert.match(
  terminalDom,
  /export const terminalStyles\s*=\s*`[\s\S]*\.xterm-selection/,
  "terminalDom must restore injected terminalStyles",
);
assert.match(
  terminalDom,
  /export const searchBarStyles\s*=\s*`[\s\S]*\.search-bar/,
  "terminalDom must restore injected searchBarStyles",
);
assert.match(
  terminalCss,
  /\.xterm\s*::selection|\.xterm ::selection/,
  "styles/terminal.css keeps minimal global selection helper",
);
assert.doesNotMatch(
  themeVariables,
  /--terminal-selection\s*:/,
  "theme-variables must not introduce d52c38e terminal surface selection tokens",
);
assert.doesNotMatch(
  themeVariables,
  /--terminal-search-glass-bg\s*:/,
  "theme-variables must not introduce d52c38e search glass tokens",
);

// Search options remain functional without redesigned glass overlay.
assert.match(
  searchOverlay,
  /className=["']search-bar["']/,
  "search overlay must use historical search-bar markup",
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
// Closing search must clear the term and decorations so reopen starts fresh.
assert.match(
  searchHook,
  /const closeSearchBar = useCallback\(\(\) => \{[\s\S]*?setSearchTerm\(""\)[\s\S]*?clearSearchState\(\{\s*clearSelection:\s*true\s*\}\)/,
  "closeSearchBar must clear search term and decorations",
);
assert.match(
  searchHook,
  /toggleSearchBar[\s\S]*?closeSearchBar\(\)/,
  "toggleSearchBar must close via closeSearchBar so content is cleared",
);

// Shortcut hints match bindings.
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

// Command block gutter was removed; ensure no residual styles/tokens remain.
assert.doesNotMatch(
  terminalCss,
  /command-block-gutter/,
  "terminal.css must not contain command block gutter styles",
);
assert.doesNotMatch(
  themeVariables,
  /--terminal-block-/,
  "theme-variables must not contain command block tokens",
);
assert.doesNotMatch(
  webTerminal,
  /CommandBlockGutter|useCommandBlocks/,
  "WebTerminal must not wire command block gutter",
);

// Fullscreen editor mode must not leave floating search chrome over the buffer,
// and must not override xterm cell metrics via CSS font-size/line-height hacks.
assert.match(
  webTerminal,
  /terminal-container--editor/,
  "WebTerminal must mark editor/alternate-buffer containers",
);
assert.match(
  webTerminal,
  /!inEditorMode\s*\?[\s\S]*WebTerminalSearchOverlay|inEditorMode[\s\S]*WebTerminalSearchOverlay/,
  "WebTerminal must hide search overlay while in editor mode",
);
assert.match(
  webTerminalCss,
  /\.terminal-container--editor\s+\.xterm-viewport/,
  "WebTerminal.css must hide overflow in editor mode",
);
assert.doesNotMatch(
  terminalCss,
  /\.xterm-viewport\s*\{[^}]*font-size\s*:/,
  "terminal.css must not override xterm-viewport font-size",
);
assert.doesNotMatch(
  terminalCss,
  /\.xterm-viewport\s*\{[^}]*line-height\s*:/,
  "terminal.css must not override xterm-viewport line-height",
);

console.log("WebTerminal surface experience checks passed.");
