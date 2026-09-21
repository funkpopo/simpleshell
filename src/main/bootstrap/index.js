const { AppInitializer } = require("./appInitializer");
const ipcSetup = require("./ipcSetup");
const AppCleanup = require("./appCleanup");
const {
  bootstrapHardwareAcceleration,
} = require("./hardwareAccelerationBootstrap");
const {
  attachDesktopWindowIntegration,
  applyDesktopIntegrationSettings,
  extractLocalOpenFilePaths,
  flushPendingOpenFiles,
  handleSecondInstance,
  handleSystemOpenFiles,
  installDesktopIntegration,
  showPrimaryWindow,
} = require("./desktopIntegration");
const { installSystemMenu } = require("./systemMenu");

module.exports = {
  AppInitializer,
  AppCleanup,
  ipcSetup,
  attachDesktopWindowIntegration,
  applyDesktopIntegrationSettings,
  bootstrapHardwareAcceleration,
  extractLocalOpenFilePaths,
  flushPendingOpenFiles,
  handleSecondInstance,
  handleSystemOpenFiles,
  installDesktopIntegration,
  installSystemMenu,
  showPrimaryWindow,
};
