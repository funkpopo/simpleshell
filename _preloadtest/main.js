const electron = require("electron");
console.log("ELECTRON MODULE", typeof electron, electron && electron.constructor && electron.constructor.name, electron && Object.keys(electron));
const { app, BrowserWindow } = electron;

app.whenReady().then(() => {
  const preloadPath = process.argv.find((a) => a.startsWith("--preload="))?.replace("--preload=", "") || null;
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.on("console-message", (_e, level, message) => {
    console.log(`[console:${level}] ${message}`);
  });
  win.webContents.on("preload-error", (_e, p, error) => {
    console.log(`[PRELOAD-ERROR] ${p}: ${error && error.message}`);
  });
  win.webContents.on("did-finish-load", async () => {
    await new Promise((r) => setTimeout(r, 1500));
    const result = await win.webContents.executeJavaScript(
      `JSON.stringify({ terminalAPI: typeof window.terminalAPI, fetchModels: typeof (window.terminalAPI && window.terminalAPI.fetchModels), simpleshellBoot: typeof window.simpleshellBoot, keys: Object.keys(window.terminalAPI||{}) })`,
      true,
    );
    console.log("RESULT " + result);
    app.quit();
  });
  win.loadURL("data:text/html,<html><body>test</body></html>");
});
