const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

const output = process.argv[2];
app.setPath("userData", path.join(output, "electron-profile"));
let window;
ipcMain.handle("history-key", async (_event, key) => {
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: key });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: key });
});
ipcMain.handle("history-text", (_event, text) =>
  window.webContents.insertText(text),
);
ipcMain.on("history-result", (_event, result) => {
  console.log("TERMINAL_HISTORY", JSON.stringify(result));
  app.exit(result.success ? 0 : 1);
});
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      show: false,
      width: 1000,
      height: 700,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
      },
    });
    await window.loadFile(path.join(output, "index.html"));
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
