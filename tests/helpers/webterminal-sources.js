/**
 * Collect WebTerminal orchestration + split module sources for static checks.
 * After the P1 architecture split, behavior lives across multiple files.
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

const WEB_TERMINAL_SOURCE_FILES = [
  "src/renderer/features/terminal/WebTerminal.jsx",
  "src/renderer/features/terminal/lib/terminalHelpers.js",
  "src/renderer/features/terminal/lib/simulatedTerminal.js",
  "src/renderer/features/terminal/hooks/useTerminalIO.js",
  "src/renderer/features/terminal/hooks/useTerminalLayout.js",
  "src/renderer/features/terminal/hooks/usePromptTracking.js",
  "src/renderer/features/terminal/hooks/useTerminalClipboard.js",
  "src/renderer/features/terminal/hooks/useTerminalContextMenu.js",
  "src/renderer/features/terminal/hooks/useTerminalLifecycle.js",
  "src/renderer/features/terminal/hooks/useTerminalSessionEvents.js",
  "src/renderer/features/terminal/components/WebTerminalSearchOverlay.jsx",
  "src/renderer/features/terminal/components/WebTerminalContextMenu.jsx",
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
