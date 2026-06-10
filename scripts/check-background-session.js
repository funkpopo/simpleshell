const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const windowManagerSource = fs.readFileSync(
  path.join(repoRoot, "src/core/window/windowManager.js"),
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
  "Main BrowserWindow should show after ready-to-show.",
);

console.log("Background session checks passed.");
