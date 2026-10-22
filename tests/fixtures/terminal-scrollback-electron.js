const { ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
ipcMain.on("history-result", (_event, result) => {
  fs.writeFileSync(
    path.join(process.argv[2], "metrics.json"),
    JSON.stringify(result, null, 2),
  );
});

ipcMain.handle("scrollback-profile-start", async ({ sender }) => {
  if (!sender.debugger.isAttached()) sender.debugger.attach("1.3");
  await sender.debugger.sendCommand("Profiler.enable");
  await sender.debugger.sendCommand("Profiler.start");
});
ipcMain.handle("scrollback-profile-stop", async ({ sender }, name) => {
  const { profile } = await sender.debugger.sendCommand("Profiler.stop");
  fs.writeFileSync(
    path.join(process.argv[2], `${name}.cpuprofile`),
    JSON.stringify(profile),
  );
  sender.debugger.detach();
});
require("./terminal-history-electron.js");
