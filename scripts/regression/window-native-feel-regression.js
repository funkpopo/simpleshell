const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const windowManagerSource = fs.readFileSync(
  path.join(repoRoot, "src/core/window/windowManager.js"),
  "utf8",
);
const appSource = fs.readFileSync(path.join(repoRoot, "src/app.jsx"), "utf8");

assert.match(
  windowManagerSource,
  /show:\s*false/,
  "Main BrowserWindow must start hidden to avoid empty-frame startup flicker.",
);

assert.match(
  windowManagerSource,
  /backgroundColor/,
  "Main BrowserWindow must set a startup background color that matches the saved theme.",
);

assert.match(
  windowManagerSource,
  /ready-to-show/,
  "Main BrowserWindow must wait for ready-to-show before becoming visible.",
);

assert.match(
  windowManagerSource,
  /windowBounds/,
  "Main BrowserWindow must persist and restore window bounds.",
);

assert.match(
  appSource,
  /event\.detail\s*===\s*2/,
  "Top bar should handle double-click maximize/restore for frameless Windows behavior.",
);

console.log("Window native-feel regression checks passed.");
