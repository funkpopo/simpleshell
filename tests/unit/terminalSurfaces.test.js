import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("background-session", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");

    const repoRoot = _path.resolve(_repoRoot, "");
    const windowManagerSource = fs.readFileSync(
      path.join(repoRoot, "src/main/window/windowManager.js"),
      "utf8",
    );

    assert.match(
      windowManagerSource,
      /backgroundThrottling:\s*false/,
      "Main BrowserWindow must keep backgroundThrottling disabled for live terminal sessions.",
    );

    assert.match(
      windowManagerSource,
      /show:\s*false/,
      "Main BrowserWindow should stay hidden until first paint to avoid startup flicker.",
    );

    assert.match(
      windowManagerSource,
      /ready-to-show/,
      "Main BrowserWindow should wait for ready-to-show before becoming visible.",
    );

    assert.match(
      windowManagerSource,
      /notifyPrimaryWindowRendererReady|rendererReady/,
      "Main BrowserWindow should also wait for renderer-ready before show to avoid theme flash.",
    );

    console.log("Background session checks passed.");
  });
});

describe("ssh-connection-stability", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");

    const repoRoot = _path.resolve(_repoRoot, "");
    const sshPoolSource = fs.readFileSync(
      path.join(repoRoot, "src/main/connection/ssh-pool.js"),
      "utf8",
    );

    const performHealthCheckMatch = sshPoolSource.match(
      /async performHealthCheck\(\) \{([\s\S]*?)\n {2}\}/,
    );

    assert.ok(performHealthCheckMatch, "SSHPool.performHealthCheck must exist");

    const performHealthCheckBody = performHealthCheckMatch[1];

    const forbiddenIntrusiveProbePatterns = [
      [/client\.exec\(\s*["']true["']/, "remote exec health probe"],
    ];

    for (const [pattern, label] of forbiddenIntrusiveProbePatterns) {
      assert.equal(
        pattern.test(sshPoolSource),
        false,
        `SSH pool source must not contain ${label}`,
      );
    }

    assert.match(
      performHealthCheckBody,
      /super\.performHealthCheck\(\);/,
      "SSHPool.performHealthCheck must retain base pool cleanup",
    );

    console.log("SSH connection stability checks passed.");
  });
});

describe("terminal-session-cleanup", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");

    const repoRoot = _path.resolve(_repoRoot, "");
    const read = (relativePath) =>
      fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

    const store = read(
      "src/renderer/features/terminal/runtime/terminalSessionStore.js",
    );
    const lifecycle = read(
      "src/renderer/features/terminal/hooks/useTerminalLifecycle.js",
    );
    const app = require("../helpers/renderer-sources.js").collectAppSources();

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
      /useEffect\([\s\S]*?\(\) => \(\) => \{[\s\S]*?disposeTerminalSession\((sessionKey|tabId)\)/,
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
  });
});

describe("webterminal-selection-stability", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const {
      collectWebTerminalSources,
    } = require("../helpers/webterminal-sources.js");

    const repoRoot = _path.resolve(_repoRoot, "");
    const read = (relativePath) =>
      fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

    const webTerminal = collectWebTerminalSources();
    const webTerminalCss = read(
      "src/renderer/features/terminal/WebTerminal.css",
    );
    const terminalSurfaceCss = read("src/renderer/styles/terminal.css");
    const terminalDom = read(
      "src/renderer/features/terminal/runtime/terminalDom.js",
    );

    const forbiddenWebTerminalPatterns = [
      [
        /querySelector(All)?\(\s*["']\.xterm-selection/,
        "selection DOM queries",
      ],
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
      Array.from(
        content.matchAll(/[^{}]*\.xterm-selection[^{}]*\{[^{}]*\}/g),
      ).map(([rule]) => rule);

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
  });
});

describe("webterminal-surface", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const {
      collectWebTerminalSources,
      readSource,
    } = require("../helpers/webterminal-sources.js");

    const repoRoot = _path.resolve(_repoRoot, "");
    const read = (relativePath) =>
      fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

    const webTerminal = collectWebTerminalSources();
    const webTerminalCss = read(
      "src/renderer/features/terminal/WebTerminal.css",
    );
    const terminalCss = read("src/renderer/styles/terminal.css");
    const terminalDom = read(
      "src/renderer/features/terminal/runtime/terminalDom.js",
    );
    const terminalTheme = read(
      "src/renderer/features/terminal/model/terminalTheme.js",
    );
    const themeVariables = read("src/renderer/styles/theme-variables.css");
    const searchOverlay = readSource(
      "src/renderer/features/terminal/components/WebTerminalSearchOverlay.jsx",
    );
    const searchHook = read(
      "src/renderer/features/terminal/hooks/useTerminalSearch.js",
    );
    const contextMenu = readSource(
      "src/renderer/features/terminal/components/WebTerminalContextMenu.jsx",
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
      /export const terminalStyles\s*=\s*`[\s\S]*\.xterm-find-result-decoration/,
      "terminalDom must inject search highlights while common selection rules stay in WebTerminal.css",
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
  });
});
