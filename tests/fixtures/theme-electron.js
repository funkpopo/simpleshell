const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs/promises");
const output = process.argv[2];
app.setPath("userData", path.join(output, "electron-profile"));
let window;
ipcMain.handle("theme-capture", async (_event, name) => {
  if (!["light", "dark"].includes(name)) throw new Error("Invalid theme");
  await window.webContents.capturePage();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const screenshot = await window.webContents.capturePage();
  await fs.writeFile(
    path.join(output, `theme-${name}.png`),
    screenshot.toPNG(),
  );
});
ipcMain.on("theme-result", (_event, result) => {
  console.log("THEME", JSON.stringify(result));
  app.exit(result.success ? 0 : 1);
});
app
  .whenReady()
  .then(async () => {
    window = new BrowserWindow({
      show: false,
      width: 1200,
      height: 900,
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
