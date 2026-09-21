/**
 * Collect WebTerminal orchestration + split module sources for static checks.
 * After the P1 architecture split, behavior lives across multiple files.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

const WEB_TERMINAL_SOURCE_FILES = [
  "src/renderer/components/WebTerminal.jsx",
  "src/renderer/components/web-terminal/terminalHelpers.js",
  "src/renderer/components/web-terminal/simulatedTerminal.js",
  "src/renderer/components/web-terminal/useTerminalIO.js",
  "src/renderer/components/web-terminal/useTerminalLayout.js",
  "src/renderer/components/web-terminal/usePromptTracking.js",
  "src/renderer/components/web-terminal/useTerminalClipboard.js",
  "src/renderer/components/web-terminal/useTerminalContextMenu.js",
  "src/renderer/components/web-terminal/useTerminalLifecycle.js",
  "src/renderer/components/web-terminal/useTerminalSessionEvents.js",
  "src/renderer/components/web-terminal/WebTerminalSearchOverlay.jsx",
  "src/renderer/components/web-terminal/WebTerminalContextMenu.jsx",
];

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function collectWebTerminalSources(extraFiles = []) {
  const files = [...WEB_TERMINAL_SOURCE_FILES, ...extraFiles];
  return files
    .filter((relativePath, index, list) => list.indexOf(relativePath) === index)
    .map((relativePath) => {
      const fullPath = path.join(ROOT, relativePath);
      if (!fs.existsSync(fullPath)) {
        return "";
      }
      return readSource(relativePath);
    })
    .join("\n\n");
}

module.exports = {
  ROOT,
  WEB_TERMINAL_SOURCE_FILES,
  readSource,
  collectWebTerminalSources,
};
