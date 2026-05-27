const { AppInitializer } = require("./appInitializer");
const ipcSetup = require("./ipcSetup");
const AppCleanup = require("./appCleanup");
const {
  bootstrapHardwareAcceleration,
} = require("./hardwareAccelerationBootstrap");
const { installSystemMenu } = require("./systemMenu");

module.exports = {
  AppInitializer,
  AppCleanup,
  ipcSetup,
  bootstrapHardwareAcceleration,
  installSystemMenu,
};
