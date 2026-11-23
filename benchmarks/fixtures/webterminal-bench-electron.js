const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const outputDir = process.argv[2];
app.setPath("userData", path.join(outputDir, "electron-profile"));

let mainWindow = null;

ipcMain.handle("bench-text", (_event, text) =>
  mainWindow.webContents.insertText(text),
);

ipcMain.handle("bench-memory", () => {
  const appMetrics = app.getAppMetrics();
  const totalWorkingSetKB = appMetrics.reduce(
    (sum, proc) => sum + (proc?.memory?.workingSetSize || 0),
    0,
  );
  const totalPrivateKB = appMetrics.reduce(
    (sum, proc) => sum + (proc?.memory?.privateBytes || 0),
    0,
  );
  const mainRssMB = process.memoryUsage().rss / (1024 * 1024);
  return {
    processCount: appMetrics.length,
    totalWorkingSetMB: totalWorkingSetKB / 1024,
    totalPrivateMB: totalPrivateKB / 1024,
    mainRssMB,
  };
});

ipcMain.on("bench-result", (_event, result) => {
  fs.writeFileSync(
    path.join(outputDir, "metrics.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  app.exit(result && result.success ? 0 : 1);
});

app
  .whenReady()
  .then(async () => {
    mainWindow = new BrowserWindow({
      show: false,
      width: 1080,
      height: 760,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false,
      },
    });
    await mainWindow.loadFile(path.join(outputDir, "index.html"));
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
