const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const managerSource = read("src/core/local-terminal/local-terminal-manager.js");
const handlerSource = read("src/core/ipc/handlers/localTerminalHandlers.js");
const channelSource = read("src/core/ipc/schema/channels.js");
const preloadSource = read("src/preload.js");
const appSource = read("src/app.jsx");
const webTerminalSource = read("src/components/WebTerminal.jsx");
const sidebarSource = read("src/components/LocalTerminalSidebar.jsx");

function assertEmbeddedPtyManager() {
  assert.match(
    managerSource,
    /require\(["']node-pty["']\)/,
    "local terminal manager must use node-pty",
  );
  assert.match(
    managerSource,
    /startEmbeddedTerminal/,
    "local terminal manager must expose startEmbeddedTerminal",
  );
  assert.match(
    managerSource,
    /pty\.spawn/,
    "local terminal manager must spawn a PTY",
  );
  assert.match(
    managerSource,
    /type:\s*["']local-pty["']/,
    "local PTY must be registered as type local-pty",
  );
  assert.match(
    managerSource,
    /createMailbox/,
    "local PTY output must use TerminalIOMailboxManager",
  );
  assert.match(
    managerSource,
    /applyResize/,
    "local PTY must configure mailbox resize handling",
  );

  const forbiddenManagerPatterns = [
    {
      re: /require\(["']child_process["']\)/,
      message: "local terminal manager must not import child_process",
    },
    {
      re: /(^|[^\w.])spawn\s*\(/m,
      message: "local terminal manager must not use child_process.spawn",
    },
    {
      re: /launchWindowsTerminal|launchMacOSTerminal|launchLinuxTerminal/,
      message: "external GUI terminal launch helpers must not exist",
    },
    {
      re: /wt\.exe|gnome-terminal|konsole|xfce4-terminal|terminator|open\s+-a\s+Terminal/,
      message: "local terminal manager must not launch GUI terminal apps",
    },
    {
      re: /fallback-external|launchExternalTerminal/,
      message: "local terminal manager must not provide external fallback",
    },
  ];

  for (const { re, message } of forbiddenManagerPatterns) {
    assert.doesNotMatch(managerSource, re, message);
  }
}

function assertIpcAndPreloadSurface() {
  assert.match(
    channelSource,
    /LOCAL_TERMINAL_START_EMBEDDED/,
    "IPC schema must define LOCAL_TERMINAL_START_EMBEDDED",
  );
  assert.match(
    handlerSource,
    /startEmbeddedLocalTerminal/,
    "local terminal handler must register embedded start handler",
  );
  assert.match(
    preloadSource,
    /startLocalTerminal/,
    "preload must expose startLocalTerminal",
  );

  const combinedIpcSource = `${handlerSource}\n${channelSource}\n${preloadSource}`;
  const forbiddenIpcPatterns = [
    {
      re: /WindowEmbedder/,
      message: "local terminal IPC must not depend on WindowEmbedder",
    },
    {
      re: /resizeEmbeddedTerminal|LOCAL_TERMINAL_RESIZE_EMBEDDED/,
      message: "embedded-window resize IPC must not be exposed",
    },
    {
      re: /fallback-external/,
      message: "local terminal IPC must not expose external fallback state",
    },
  ];

  for (const { re, message } of forbiddenIpcPatterns) {
    assert.doesNotMatch(combinedIpcSource, re, message);
  }
}

function assertRendererLocalTabSupport() {
  assert.match(
    webTerminalSource,
    /terminalType\s*=\s*["']ssh["']/,
    "WebTerminal must accept terminalType",
  );
  assert.match(
    webTerminalSource,
    /localConfig\s*=\s*null/,
    "WebTerminal must accept localConfig",
  );
  assert.match(
    webTerminalSource,
    /startLocalTerminal/,
    "WebTerminal must call startLocalTerminal for local tabs",
  );
  assert.match(
    webTerminalSource,
    /protocol:\s*isLocalTerminal\s*\?\s*["']local["']/,
    "WebTerminal process event must identify local protocol",
  );
  assert.match(
    appSource,
    /type:\s*["']local["']/,
    "app must create local terminal tabs",
  );
  assert.match(
    appSource,
    /terminalType=\{tab\.type === ["']local["'] \? ["']local["'] : tab\.type\}/,
    "app must pass local terminalType to WebTerminal",
  );
  assert.match(
    appSource,
    /closeLocalTerminal/,
    "app must close local terminals by tab id if no process id is cached",
  );
  assert.match(
    sidebarSource,
    /["']starting["']/,
    "local terminal sidebar must observe new starting status",
  );
  assert.doesNotMatch(
    sidebarSource,
    /已在外部终端打开|外部打开|external fallback/i,
    "local terminal sidebar must not mention external terminal fallback",
  );
}

function run() {
  assertEmbeddedPtyManager();
  assertIpcAndPreloadSurface();
  assertRendererLocalTabSupport();
  console.log("PASS local terminal embedded checks");
}

run();
