const { AppInitializer } = require("./appInitializer");
const ipcSetup = require("./ipcSetup");
const AppCleanup = require("./appCleanup");

module.exports = {
  AppInitializer,
  AppCleanup,
  ipcSetup,
};
