const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function assertContains(source, pattern, message) {
  assert.match(source, pattern, message);
}

function assertNotContains(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message);
}

function run() {
  const windowManagerSource = readSource("src/core/window/windowManager.js");
  const preloadSource = readSource("src/preload.js");
  const channelsSource = readSource("src/core/ipc/schema/channels.js");
  const appHandlersSource = readSource("src/core/ipc/handlers/appHandlers.js");
  const rendererWebpackSource = readSource("webpack.renderer.config.js");
  const docsSource = readSource("preload-sandbox.md");

  assertContains(
    windowManagerSource,
    /sandbox:\s*true/,
    "Main BrowserWindow preload sandbox must be enabled.",
  );
  assertNotContains(
    windowManagerSource,
    /sandbox:\s*false/,
    "Main BrowserWindow must not disable the preload sandbox.",
  );

  assertContains(
    rendererWebpackSource,
    /baseRules\.filter/,
    "Renderer webpack config must keep a rule filter for preload safety.",
  );
  assertContains(
    rendererWebpackSource,
    /@vercel\/webpack-asset-relocator-loader/,
    "Renderer webpack config must explicitly exclude asset-relocator runtime.",
  );

  assertNotContains(
    preloadSource,
    /\bclipboard\s*[,.}]/,
    "Sandboxed preload must not import Electron clipboard directly.",
  );
  assertNotContains(
    preloadSource,
    /\bclipboard\./,
    "Sandboxed preload must not call Electron clipboard directly.",
  );
  assertContains(
    preloadSource,
    /CLIPBOARD_READ_TEXT/,
    "Preload clipboard read API must call the declared IPC channel.",
  );
  assertContains(
    preloadSource,
    /CLIPBOARD_WRITE_TEXT/,
    "Preload clipboard write API must call the declared IPC channel.",
  );

  assertContains(
    channelsSource,
    /"CLIPBOARD_READ_TEXT"[\s\S]*"clipboard:readText"[\s\S]*permission:\s*"clipboard"/,
    "Clipboard read IPC must be declared with a clipboard permission level.",
  );
  assertContains(
    channelsSource,
    /"CLIPBOARD_WRITE_TEXT"[\s\S]*"clipboard:writeText"[\s\S]*permission:\s*"clipboard"/,
    "Clipboard write IPC must be declared with a clipboard permission level.",
  );
  assertContains(
    appHandlersSource,
    /CLIPBOARD_READ_TEXT[\s\S]*readClipboardText/,
    "Main process must register clipboard read handler.",
  );
  assertContains(
    appHandlersSource,
    /CLIPBOARD_WRITE_TEXT[\s\S]*writeClipboardText/,
    "Main process must register clipboard write handler.",
  );
  assertContains(
    appHandlersSource,
    /clipboard\.readText\(\)/,
    "Clipboard read must execute in the main process.",
  );
  assertContains(
    appHandlersSource,
    /clipboard\.writeText\(String\(text \?\? ""\)\)/,
    "Clipboard write must execute in the main process.",
  );

  assertContains(
    docsSource,
    /Risk Record[\s\S]*Alternatives[\s\S]*Guardrails/,
    "Preload sandbox documentation must record risks, alternatives, and guardrails.",
  );
  console.log("PASS check-preload-sandbox");
}

run();
