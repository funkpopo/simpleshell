const configService = require("./configService");
const commandHistoryService = require("../terminal/command-history");
const connectionManager = require("../connection/connectionManager");
const { applySftpSettings } = require("../file-transfer/sftpConfig");
const fileCache = require("../storage/fileCache");
const fileSnapshotStore = require("../storage/fileSnapshotStore");
const runtimeFileLifecycle = require("../storage/runtimeFileLifecycle");
const NetworkLatencyService = require("../services/networkLatencyService");
const {
  normalizePerformanceSettings,
  normalizeStorageSettings,
  normalizeTerminalUiSettings,
} = require("../../shared/settings/uiSettingsDefaults");

/**
 * Applies runtime main-process behavior for newly loaded or saved UI settings.
 * @param {object} uiSettings
 */
function applyRuntimeUISettings(uiSettings) {
  if (!uiSettings || typeof uiSettings !== "object") {
    return;
  }

  const terminalUi = normalizeTerminalUiSettings(uiSettings);
  commandHistoryService.configure({
    maxHistorySize: terminalUi.commandHistoryMaxSize,
    minCommandLength: terminalUi.commandHistoryMinLength,
    suggestionsEnabled: terminalUi.commandSuggestionsEnabled,
    defaultSuggestionLimit: terminalUi.commandSuggestionLimit,
  });

  connectionManager.applyUiSettings?.(uiSettings);
  NetworkLatencyService.applyUiSettings?.(uiSettings);
  applySftpSettings(uiSettings);

  const performance = normalizePerformanceSettings(uiSettings);
  const storage = normalizeStorageSettings(uiSettings);

  fileCache.configure({
    enabled: performance.cacheEnabled,
    maxTotalBytes: storage.fileCacheMaxMB * 1024 * 1024,
    maxAgeMs: storage.fileCacheMaxAgeMinutes * 60 * 1000,
  });

  if (performance.cacheEnabled === false) {
    void runtimeFileLifecycle.clearResource("file-cache").catch(() => {});
  } else if (runtimeFileLifecycle.initialized) {
    void runtimeFileLifecycle.sweepResource("file-cache").catch(() => {});
  }

  fileSnapshotStore.configure({
    maxEntries: storage.snapshotMaxPerFile,
    maxAgeMs: storage.snapshotRetentionDays * 24 * 60 * 60 * 1000,
  });

  if (runtimeFileLifecycle.initialized) {
    void runtimeFileLifecycle.sweepResource("file-snapshots").catch(() => {});
  }
}

function syncRuntimeUISettingsFromConfig() {
  try {
    const uiSettings = configService.loadUISettings?.();
    if (uiSettings) {
      applyRuntimeUISettings(uiSettings);
    }
  } catch {
    /* ignore when configService is uninitialized */
  }
}

module.exports = {
  applyRuntimeUISettings,
  syncRuntimeUISettingsFromConfig,
};
