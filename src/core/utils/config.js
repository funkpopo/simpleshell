// Single source of truth: delegate to core/configManager
const configManager = require("../configManager");

module.exports = {
  // connections
  loadConnectionsConfig: () => configManager.loadConnections(),
  saveConnectionsConfig: (connections) => configManager.saveConnections(connections),

  // UI settings
  loadUISettings: () => configManager.loadUISettings(),
  saveUISettings: (settings) => configManager.saveUISettings(settings),

  // Log settings
  loadLogSettings: () => configManager.loadLogSettings(),
  saveLogSettings: (settings) => configManager.saveLogSettings(settings),

  // initialize main config
  initializeConfig: () => configManager.initializeMainConfig(),

  // Expose generic get/set for callers previously depending on file-level access
  get: (key) => configManager.get(key),
  set: (key, value) => configManager.set(key, value),
};
