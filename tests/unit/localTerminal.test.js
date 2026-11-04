import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("local-terminal-embedded", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");

    const ROOT = _path.resolve(_repoRoot, "");
    const read = (relativePath) =>
      fs.readFileSync(path.join(ROOT, relativePath), "utf8");

    const managerSource = read(
      "src/main/local-terminal/local-terminal-manager.js",
    );
    const handlerSource = read(
      "src/main/ipc/handlers/localTerminalHandlers.js",
    );
    // The registry is split into per-domain modules; check all of it.
    const ipcContractDir = "src/shared/contracts/ipc";
    const channelSource = [
      `${ipcContractDir}/channels.js`,
      ...fs
        .readdirSync(path.join(ROOT, ipcContractDir, "domains"))
        .filter((name) => name.endsWith(".js"))
        .map((name) => `${ipcContractDir}/domains/${name}`),
    ]
      .map(read)
      .join("\n");
    const preloadSource =
      require("../helpers/preload-sources").collectPreloadSources();
    const appSource =
      require("../helpers/renderer-sources.js").collectAppSources();
    const {
      collectWebTerminalSources,
    } = require("../helpers/webterminal-sources.js");
    const webTerminalSource = collectWebTerminalSources();
    const sidebarSource = read(
      "src/renderer/features/terminal/LocalTerminalSidebar.jsx",
    );
    const localTerminalConfigSource = read(
      "src/main/local-terminal/local-terminal-config.js",
    );
    const {
      SUPPORTED_LOCAL_TERMINAL_TYPES,
      normalizeLocalTerminalConfig,
    } = require(
      path.join(ROOT, "src/main/local-terminal/local-terminal-config.js"),
    );

    function assertEmbeddedPtyManager() {
      assert.match(
        managerSource,
        /require\(["']\.\.\/native\/nativePty["']\)/,
        "local terminal manager must use the core's pty service",
      );
      assert.match(
        managerSource,
        /startEmbeddedTerminal/,
        "local terminal manager must expose startEmbeddedTerminal",
      );
      assert.match(
        managerSource,
        /await spawnPty\(/,
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
          message:
            "local terminal IPC must not expose legacy external launch API",
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
        /terminalType=\{session\.type\}/,
        "app must pass the session's own terminalType to WebTerminal, including adopted local panes",
      );
      assert.match(
        appSource,
        /localConfig=\{session\.type === "local" \? config : null\}/,
        "local configuration must belong to the rendered session",
      );
      assert.match(
        appSource,
        /config:\s*instances\[`\$\{session\.sessionKey\}-config`\]/,
        "the terminal selector must read configuration by session key",
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
      assertRendererLocalTabSupport();
      console.log("PASS local terminal embedded checks");
    }

    await run();
  });
});
