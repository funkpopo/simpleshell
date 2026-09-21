const Module = require("node:module");
const path = require("node:path");

function loadFileService(root, config) {
  const settings = { transferIntegrity: false, language: "en-US" };
  const selections = {
    save: path.join(root, "service-download.bin"),
    open: [root],
  };
  const configPath = require.resolve("../../src/main/settings/configService");
  const connectionPath =
    require.resolve("../../src/main/connection/connectionManager");
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { loadUISettings: () => settings },
  };
  require.cache[connectionPath] = {
    id: connectionPath,
    filename: connectionPath,
    loaded: true,
    exports: {},
  };
  const originalLoad = Module._load;
  Module._load = function (name, ...args) {
    if (name === "electron")
      return {
        app: { getPath: () => root },
        dialog: {
          showSaveDialog: async () => ({
            canceled: false,
            filePath: selections.save,
          }),
          showOpenDialog: async () => ({
            canceled: false,
            filePaths: selections.open,
          }),
        },
        BrowserWindow: {
          getFocusedWindow: () => null,
          getAllWindows: () => [],
        },
      };
    return originalLoad.call(this, name, ...args);
  };
  let service;
  delete require.cache[
    require.resolve("../../src/main/file-transfer/filemanagementService")
  ];
  try {
    service = require("../../src/main/file-transfer/filemanagementService");
  } finally {
    Module._load = originalLoad;
  }
  const processManager = require("../../src/main/process/processManager");
  const {
    setTrustedHostFingerprint,
  } = require("../../src/main/utils/sshHostKeyTrust");
  setTrustedHostFingerprint(config, config.expectedHostFingerprint);
  processManager.setProcess("fixture-service", {
    config,
    ready: true,
    type: "ssh2",
    process: {},
  });
  const events = [];
  const control = { onEvent: null };
  const event = {
    sender: {
      isDestroyed: () => false,
      send: (channel, payload) => {
        events.push({ channel, ...payload });
        control.onEvent?.(channel, payload);
      },
    },
  };
  return {
    service,
    settings,
    selections,
    event,
    events,
    control,
    tabId: "fixture-service",
  };
}

module.exports = { loadFileService };
