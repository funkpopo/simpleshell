// @ts-check
// Public API names and method contracts remain stable; context owns subscriptions.
const { contextBridge } = require("electron");
const { createBridgeContext } = require("./bridgeContext");
const { createTerminalAPI } = require("./api/terminal");
const { createConnectionsAPI } = require("./api/connections");
const { createSystemAPI } = require("./api/system");
const { createAiAPI } = require("./api/ai");
const { createFilesAPI } = require("./api/files");
const { createSettingsAPI } = require("./api/settings");
const { createElectronAPI } = require("./api/electron");
const { createDialogAPI } = require("./api/dialog");
const { createAppErrorAPI } = require("./api/appError");
const { createClipboardAPI } = require("./api/clipboard");

const bridge = createBridgeContext();

contextBridge.exposeInMainWorld("terminalAPI", {
  ...createTerminalAPI(bridge),
  ...createConnectionsAPI(bridge),
  ...createSystemAPI(bridge),
  ...createAiAPI(bridge),
  ...createFilesAPI(bridge),
  ...createSettingsAPI(bridge),
});

contextBridge.exposeInMainWorld("electronAPI", {
  ...createElectronAPI(bridge),
});

contextBridge.exposeInMainWorld("dialogAPI", {
  ...createDialogAPI(bridge),
});

contextBridge.exposeInMainWorld("appErrorAPI", {
  ...createAppErrorAPI(bridge),
});

contextBridge.exposeInMainWorld("clipboardAPI", {
  ...createClipboardAPI(bridge),
});
