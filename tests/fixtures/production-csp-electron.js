const assert = require("node:assert/strict");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const output = process.argv[2];
app.setPath("userData", path.join(output, "electron-profile"));
app
  .whenReady()
  .then(async () => {
    // Use the actual file:// page without response-header injection to ensure
    // the production HTML alone protects packaged renderer documents.
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    await win.loadFile(path.join(output, "index.html"));
    const probe = await win.webContents.executeJavaScript("window.cspProbe");
    assert.equal(probe.externalScriptLoaded, true);
    assert.equal(probe.inlineScriptRan, undefined);
    assert.equal(probe.evalBlocked, true);
    console.log(
      "PASS packaged file:// CSP permits bundled scripts and blocks inline scripts and eval",
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
