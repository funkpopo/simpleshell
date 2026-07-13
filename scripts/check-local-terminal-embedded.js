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
const webpackMainSource = read("webpack.main.config.js");
const forgeConfigSource = read("forge.config.js");
const localTerminalConfigSource = read(
  "src/core/local-terminal/local-terminal-config.js",
);
const {
  SUPPORTED_LOCAL_TERMINAL_TYPES,
  normalizeLocalTerminalConfig,
} = require(path.join(ROOT, "src/core/local-terminal/local-terminal-config.js"));

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
    {
      re: /launchLocalTerminal|LOCAL_TERMINAL_LAUNCH/,
      message: "local terminal IPC must not expose legacy external launch API",
    },
  ];

  for (const { re, message } of forbiddenIpcPatterns) {
    assert.doesNotMatch(combinedIpcSource, re, message);
  }
}

function assertLocalConfigNormalizationBlocksGuiCommands() {
  assert.match(
    localTerminalConfigSource,
    /selectAllowedWindowsCommand/,
    "local terminal config must validate Windows shell commands by type",
  );

  const maliciousWslConfig = normalizeLocalTerminalConfig(
    {
      name: "Ubuntu",
      type: SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_WSL,
      command: "wt.exe",
      executablePath: "wt.exe",
      executable: "wt.exe",
      launchArgs: ["new-tab", "wsl", "-d", "Ubuntu"],
      distribution: "Ubuntu",
    },
    {
      platform: "win32",
      env: {},
      homeDirectory: "C:\\Users\\tester",
    },
  );

  assert.equal(
    maliciousWslConfig.command,
    "wsl.exe",
    "WSL local terminal must ignore GUI terminal commands such as wt.exe",
  );
  assert.deepEqual(
    maliciousWslConfig.args,
    ["-d", "Ubuntu"],
    "WSL local terminal must keep only the distribution launch args",
  );
  assert.equal(
    maliciousWslConfig.executablePath,
    "wsl.exe",
    "WSL executablePath must be normalized to wsl.exe",
  );

  const maliciousCmdConfig = normalizeLocalTerminalConfig(
    {
      type: SUPPORTED_LOCAL_TERMINAL_TYPES.WINDOWS_CMD,
      command: "wt.exe",
    },
    {
      platform: "win32",
      env: {},
      homeDirectory: "C:\\Users\\tester",
    },
  );

  assert.equal(
    maliciousCmdConfig.command,
    "cmd.exe",
    "cmd local terminal must ignore GUI terminal commands such as wt.exe",
  );
}

function assertWebpackCopiesNodePtyPrebuilds() {
  assert.match(
    webpackMainSource,
    /node_modules["'],\s*["']node-pty["'],\s*["']prebuilds["']/,
    "main webpack config must copy node-pty prebuilds",
  );
  assert.match(
    webpackMainSource,
    /\.webpack["'],\s*["']main["'],\s*["']prebuilds["']/,
    "node-pty prebuilds must be copied next to the bundled main process",
  );
  assert.match(
    webpackMainSource,
    /node_modules["'],\s*["']node-pty["'],\s*["']lib["'],\s*["']worker["']/,
    "main webpack config must copy node-pty worker helpers",
  );
  assert.match(
    webpackMainSource,
    /\.webpack["'],\s*["']main["'],\s*["']worker["']/,
    "node-pty worker helpers must be copied next to the bundled main process",
  );
  assert.match(
    webpackMainSource,
    /node_modules["'],\s*["']node-pty["'],\s*["']lib["'],\s*["']shared["']/,
    "main webpack config must copy node-pty shared helpers",
  );
  assert.match(
    webpackMainSource,
    /conpty_console_list_agent\.js/,
    "main webpack config must copy node-pty console list child-process helper",
  );
  assert.match(
    webpackMainSource,
    /copyFileIfExists[\s\S]*utils\.js/,
    "main webpack config must copy node-pty utils helper for child-process helper",
  );
  assert.match(
    webpackMainSource,
    /fs\.cpSync\([^)]*recursive:\s*true/s,
    "node-pty prebuild copy must preserve nested helper files",
  );
  assert.match(
    forgeConfigSource,
    /\.webpack\/main\/prebuilds/,
    "packaged app must unpack node-pty prebuilds from asar",
  );
  assert.match(
    forgeConfigSource,
    /\.webpack\\{2}main\\{2}prebuilds/,
    "packaged app must include Windows-style node-pty prebuild unpack path",
  );
  assert.match(
    forgeConfigSource,
    /\.webpack\/main\/worker/,
    "packaged app must unpack node-pty worker helpers from asar",
  );
  assert.match(
    forgeConfigSource,
    /\.webpack\/main\/shared/,
    "packaged app must unpack node-pty shared helpers from asar",
  );
  assert.match(
    forgeConfigSource,
    /conpty_console_list_agent\.js/,
    "packaged app must unpack node-pty console list child-process helper",
  );
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
  assertLocalConfigNormalizationBlocksGuiCommands();
  assertWebpackCopiesNodePtyPrebuilds();
  assertRendererLocalTabSupport();
  console.log("PASS local terminal embedded checks");
}

run();
