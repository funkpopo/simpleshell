import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from "../../../../shared/domain/terminalScrollback.js";
import {
  createDefaultUISettings,
  normalizeAutoUploadDebounceMs,
  normalizeFileManagerSettings,
  normalizeLogSettings,
  normalizeNetworkLatencySettings,
  normalizeNotificationDurationMs,
  normalizePerformanceSettings,
  normalizeRecentConnectionsLimit,
  normalizeReconnectUiSettings,
  normalizeResourceMonitorSettings,
  normalizeSftpSettings,
  normalizeSshUiSettings,
  normalizeStorageSettings,
  normalizeTerminalUiSettings,
  normalizeUpdatesSettings,
} from "../../../../shared/settings/uiSettingsDefaults.js";

export default async function loadSettingsSnapshot() {
  const uiDefaults = createDefaultUISettings();
  const values = {
    language: "",
    fontSize: uiDefaults.fontSize,
    editorFont: uiDefaults.editorFont,
    terminalFont: uiDefaults.terminalFont,
    terminalFontSize: uiDefaults.terminalFontSize,
    terminalFontWeight: 500,
    terminalLineHeight: uiDefaults.terminalLineHeight,
    terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
    terminalCursorStyle: uiDefaults.terminalCursorStyle,
    terminalCursorBlink: uiDefaults.terminalCursorBlink,
    terminalLetterSpacing: uiDefaults.terminalLetterSpacing,
    terminalFontWeightBold: uiDefaults.terminalFontWeightBold,
    terminalCopyOnSelect: uiDefaults.terminalCopyOnSelect,
    terminalRightClickSelectsWord: uiDefaults.terminalRightClickSelectsWord,
    terminalMiddleClickPaste: uiDefaults.terminalMiddleClickPaste,
    terminalMacOptionIsMeta: uiDefaults.terminalMacOptionIsMeta,
    commandHistoryMaxSize: uiDefaults.commandHistoryMaxSize,
    commandHistoryMinLength: uiDefaults.commandHistoryMinLength,
    commandSuggestionsEnabled: uiDefaults.commandSuggestionsEnabled,
    commandSuggestionLimit: uiDefaults.commandSuggestionLimit,
    defaultLocalShell: uiDefaults.defaultLocalShell,
    zmodemSaveDirectory: uiDefaults.zmodem.saveDirectory,
    darkMode: uiDefaults.darkMode,
    externalEditorEnabled: uiDefaults.externalEditor.enabled,
    externalEditorCommand: uiDefaults.externalEditor.command,
    externalEditorAutoUploadDebounceMs:
      uiDefaults.externalEditor.autoUploadDebounceMs,
    updatesAutoCheckOnStartup: uiDefaults.updates.autoCheckOnStartup,
    updatesReminderIntervalHours: uiDefaults.updates.reminderIntervalHours,
    notificationDurationSeconds: uiDefaults.notificationDurationSeconds,
    recentConnectionsLimit: uiDefaults.recentConnectionsLimit,
    diskAlertEnabled: false,
    diskAlertThreshold: 90,
    diskAlertIntervalSeconds: 60,
    resourceMonitorDisplayMode: uiDefaults.resourceMonitor.displayMode,
    resourceMonitorSystemRefreshSeconds:
      uiDefaults.resourceMonitor.systemRefreshSeconds,
    resourceMonitorProcessRefreshSeconds:
      uiDefaults.resourceMonitor.processRefreshSeconds,
    resourceMonitorMaxVisibleProcesses:
      uiDefaults.resourceMonitor.maxVisibleProcesses,
    logLevel: "INFO",
    maxFileSize: 5,
    maxFiles: 5,
    compressOldLogs: true,
    cleanupIntervalDays: 7,
    backupRetentionDays: uiDefaults.backupRetentionDays,
    errorReportingEnabled: false,
    includeDiagnosticsInFeedback: false,
    crashCaptureEnabled: true,
    crashReporterStatus: null,
    masterPasswordEnabled: false,
    initialMasterPasswordEnabled: false,
    masterPassword: "",
    confirmMasterPassword: "",
    webglEnabled: uiDefaults.performance.webglEnabled,
    cacheEnabled: uiDefaults.performance.cacheEnabled,
    terminalPerfMonitor: uiDefaults.performance.terminalPerfMonitor,
    hardwareAccelerationEnabled: uiDefaults.performance.hardwareAcceleration,
    gpuInfo: null,
    gpuInfoLoading: false,
    dndEnabled: true,
    dndAutoScroll: true,
    dndCompactPreview: false,
    trayEnabled: false,
    closeToTray: false,
    transferBarMode: "bottom",
    transferIntegrity: false,
    sftpFollowTerminalDirectory: true,
    sshKeepaliveIntervalSeconds: uiDefaults.ssh.keepaliveIntervalSeconds,
    sshKeepaliveCountMax: uiDefaults.ssh.keepaliveCountMax,
    sshReadyTimeoutSeconds: uiDefaults.ssh.readyTimeoutSeconds,
    sshConnectionTimeoutSeconds: uiDefaults.ssh.connectionTimeoutSeconds,
    sshIdleTimeoutMinutes: uiDefaults.ssh.idleTimeoutMinutes,
    reconnectMaxRetries: uiDefaults.reconnect.maxRetries,
    reconnectInitialDelayMs: uiDefaults.reconnect.initialDelayMs,
    reconnectTotalTimeCapSeconds: uiDefaults.reconnect.totalTimeCapSeconds,
    reconnectFastReconnectEnabled: uiDefaults.reconnect.fastReconnectEnabled,
    networkLatencyCheckIntervalSeconds:
      uiDefaults.networkLatency.checkIntervalSeconds,
    sftpParallelUploads: uiDefaults.sftp.parallelUploads,
    sftpParallelDownloads: uiDefaults.sftp.parallelDownloads,
    sftpMaxRetries: uiDefaults.sftp.maxRetries,
    sftpSessionIdleTimeoutMinutes: uiDefaults.sftp.sessionIdleTimeoutMinutes,
    fileManagerDefaultSortMode: uiDefaults.fileManager.defaultSortMode,
    fileManagerShowHiddenFiles: uiDefaults.fileManager.showHiddenFiles,
    fileManagerDirectoryWatchIntervalMs:
      uiDefaults.fileManager.directoryWatchIntervalMs,
    fileManagerDirectoryCacheTtlSeconds:
      uiDefaults.fileManager.directoryCacheTtlSeconds,
    fileManagerMaxPreviewSizeMB: uiDefaults.fileManager.maxPreviewSizeMB,
    storageFileCacheMaxMB: uiDefaults.storage.fileCacheMaxMB,
    storageFileCacheMaxAgeMinutes: uiDefaults.storage.fileCacheMaxAgeMinutes,
    storageSnapshotMaxPerFile: uiDefaults.storage.snapshotMaxPerFile,
    storageSnapshotRetentionDays: uiDefaults.storage.snapshotRetentionDays,
    needsRestart: false,
    originalPerformanceSettings: {},
    exportPassword: "",
    exportConfirmPassword: "",
    importFilePath: "",
    importPassword: "",
    importMode: "merge",
    webdavUrl: "",
    webdavUsername: "",
    webdavPassword: "",
    webdavFileName: "",
    configTransferBusy: "",
    autoSyncEnabled: false,
    autoSyncOnStartup: true,
    autoSyncIntervalMinutes: 30,
    rememberExportPassword: false,
    autoSyncStatus: null,
  };

  try {
    // 加载UI设置
    if (window.terminalAPI?.loadUISettings) {
      const response = await window.terminalAPI.loadUISettings();
      // 检查响应结构 - IPC handler 返回 { success: true, settings: {...} }
      const settings = response?.success ? response.settings : response;
      if (settings) {
        const terminalOpts = normalizeTerminalUiSettings(settings);
        const updatesOpts = normalizeUpdatesSettings(settings);
        const resourceMonitorOpts = normalizeResourceMonitorSettings(settings);
        const perfOpts = normalizePerformanceSettings(settings);
        const sshOpts = normalizeSshUiSettings(settings);
        const reconnectOpts = normalizeReconnectUiSettings(settings);
        const latencyOpts = normalizeNetworkLatencySettings(settings);
        const sftpOpts = normalizeSftpSettings(settings);
        const fileManagerOpts = normalizeFileManagerSettings(settings);
        const storageOpts = normalizeStorageSettings(settings);

        values.language = settings.language || "zh-CN";
        values.fontSize = settings.fontSize || 14;
        values.editorFont = settings.editorFont || "system";
        values.terminalFont = settings.terminalFont || "Fira Code";
        values.terminalFontSize = settings.terminalFontSize || 14;
        values.terminalFontWeight = settings.terminalFontWeight || 500;
        const rawLineHeight = Number(settings.terminalLineHeight);
        values.terminalLineHeight = Number.isFinite(rawLineHeight)
          ? Math.min(1.4, Math.max(1.0, Math.round(rawLineHeight * 100) / 100))
          : 1.0;
        values.terminalScrollbackLines = normalizeTerminalScrollbackLines(
          settings.terminalScrollbackLines,
        );
        values.terminalCursorStyle = terminalOpts.cursorStyle;
        values.terminalCursorBlink = terminalOpts.cursorBlink;
        values.terminalLetterSpacing = terminalOpts.letterSpacing;
        values.terminalFontWeightBold = terminalOpts.fontWeightBold;
        values.terminalCopyOnSelect = terminalOpts.copyOnSelect;
        values.terminalRightClickSelectsWord =
          terminalOpts.rightClickSelectsWord;
        values.terminalMiddleClickPaste = terminalOpts.middleClickPaste;
        values.terminalMacOptionIsMeta = terminalOpts.macOptionIsMeta;
        values.commandHistoryMaxSize = terminalOpts.commandHistoryMaxSize;
        values.commandHistoryMinLength = terminalOpts.commandHistoryMinLength;
        values.commandSuggestionsEnabled =
          terminalOpts.commandSuggestionsEnabled;
        values.commandSuggestionLimit = terminalOpts.commandSuggestionLimit;
        values.defaultLocalShell = terminalOpts.defaultLocalShell;
        values.zmodemSaveDirectory = terminalOpts.zmodemSaveDirectory;
        values.darkMode =
          settings.darkMode !== undefined ? settings.darkMode : true;

        // 外部编辑器设置
        const externalEditorSettings = settings.externalEditor || {};
        values.externalEditorEnabled =
          externalEditorSettings.enabled === true ||
          settings.externalEditorEnabled === true;
        values.externalEditorCommand =
          externalEditorSettings.command ||
          settings.externalEditorCommand ||
          "";
        values.externalEditorAutoUploadDebounceMs =
          normalizeAutoUploadDebounceMs(settings);

        // 更新与通知设置
        values.updatesAutoCheckOnStartup = updatesOpts.autoCheckOnStartup;
        values.updatesReminderIntervalHours = updatesOpts.reminderIntervalHours;
        values.notificationDurationSeconds = Math.round(
          normalizeNotificationDurationMs(settings) / 1000,
        );
        values.recentConnectionsLimit =
          normalizeRecentConnectionsLimit(settings);

        // 加载磁盘空间告警设置（与主进程默认值一致：未配置时默认关闭）
        const diskAlertSettings = settings.diskAlert || {};
        values.diskAlertEnabled = diskAlertSettings.enabled === true;
        const rawThreshold = Number(diskAlertSettings.thresholdPercent);
        values.diskAlertThreshold =
          Number.isFinite(rawThreshold) &&
          rawThreshold >= 50 &&
          rawThreshold <= 99
            ? Math.floor(rawThreshold)
            : 90;
        const rawInterval = Number(diskAlertSettings.intervalSeconds);
        values.diskAlertIntervalSeconds =
          Number.isFinite(rawInterval) && rawInterval >= 30
            ? Math.floor(rawInterval)
            : 60;

        // 加载资源监控设置
        values.resourceMonitorDisplayMode =
          resourceMonitorOpts.displayMode === "trend" ? "trend" : "independent";
        values.resourceMonitorSystemRefreshSeconds =
          resourceMonitorOpts.systemRefreshSeconds;
        values.resourceMonitorProcessRefreshSeconds =
          resourceMonitorOpts.processRefreshSeconds;
        values.resourceMonitorMaxVisibleProcesses =
          resourceMonitorOpts.maxVisibleProcesses;

        // DnD settings
        const dnd = settings.dnd || {};
        values.dndEnabled = dnd.enabled !== false;
        values.dndAutoScroll = dnd.autoScroll !== false;
        values.dndCompactPreview = dnd.compactDragPreview === true;
        const desktopIntegration = settings.desktopIntegration || {};
        values.trayEnabled = desktopIntegration.trayEnabled === true;
        values.closeToTray =
          desktopIntegration.trayEnabled === true &&
          desktopIntegration.closeToTray === true;

        // 传输栏显示模式
        values.transferBarMode = settings.transferBarMode || "bottom";
        values.transferIntegrity = settings.transferIntegrity === true;
        values.sftpFollowTerminalDirectory =
          settings.sftpFollowTerminalDirectory !== false;

        // 备份保留天数
        if (settings.backupRetentionDays !== undefined) {
          values.backupRetentionDays = settings.backupRetentionDays;
        }

        // 性能设置
        values.hardwareAccelerationEnabled = perfOpts.hardwareAcceleration;
        values.webglEnabled = perfOpts.webglEnabled;
        values.cacheEnabled = perfOpts.cacheEnabled;
        values.terminalPerfMonitor = perfOpts.terminalPerfMonitor;

        // 保存原始设置用于比较（仅 hardwareAcceleration 需要重启）
        values.originalPerformanceSettings = perfOpts;

        // 连接 & SFTP 设置
        values.sshKeepaliveIntervalSeconds = sshOpts.keepaliveIntervalSeconds;
        values.sshKeepaliveCountMax = sshOpts.keepaliveCountMax;
        values.sshReadyTimeoutSeconds = sshOpts.readyTimeoutSeconds;
        values.sshConnectionTimeoutSeconds = sshOpts.connectionTimeoutSeconds;
        values.sshIdleTimeoutMinutes = sshOpts.idleTimeoutMinutes;

        values.reconnectMaxRetries = reconnectOpts.maxRetries;
        values.reconnectInitialDelayMs = reconnectOpts.initialDelayMs;
        values.reconnectTotalTimeCapSeconds = reconnectOpts.totalTimeCapSeconds;
        values.reconnectFastReconnectEnabled =
          reconnectOpts.fastReconnectEnabled;

        values.networkLatencyCheckIntervalSeconds =
          latencyOpts.checkIntervalSeconds;

        values.sftpParallelUploads = sftpOpts.parallelUploads;
        values.sftpParallelDownloads = sftpOpts.parallelDownloads;
        values.sftpMaxRetries = sftpOpts.maxRetries;
        values.sftpSessionIdleTimeoutMinutes =
          sftpOpts.sessionIdleTimeoutMinutes;

        values.fileManagerDefaultSortMode = fileManagerOpts.defaultSortMode;
        values.fileManagerShowHiddenFiles = fileManagerOpts.showHiddenFiles;
        values.fileManagerDirectoryWatchIntervalMs =
          fileManagerOpts.directoryWatchIntervalMs;
        values.fileManagerDirectoryCacheTtlSeconds =
          fileManagerOpts.directoryCacheTtlSeconds;
        values.fileManagerMaxPreviewSizeMB = fileManagerOpts.maxPreviewSizeMB;

        values.storageFileCacheMaxMB = storageOpts.fileCacheMaxMB;
        values.storageFileCacheMaxAgeMinutes =
          storageOpts.fileCacheMaxAgeMinutes;
        values.storageSnapshotMaxPerFile = storageOpts.snapshotMaxPerFile;
        values.storageSnapshotRetentionDays = storageOpts.snapshotRetentionDays;
      }
    }

    if (window.terminalAPI?.getCredentialSecurityStatus) {
      const response = await window.terminalAPI.getCredentialSecurityStatus();
      const securityStatus = response?.success ? response.status : response;
      const enabled = securityStatus?.masterPasswordEnabled === true;
      values.masterPasswordEnabled = enabled;
      values.initialMasterPasswordEnabled = enabled;
      values.masterPassword = "";
      values.confirmMasterPassword = "";
    }

    // 加载日志设置
    if (window.terminalAPI?.loadLogSettings) {
      const response = await window.terminalAPI.loadLogSettings();
      // 检查响应结构 - IPC handler 返回 { success: true, settings: {...} }
      const logSettings = response?.success ? response.settings : response;
      if (logSettings) {
        const normalizedLog = normalizeLogSettings(logSettings);
        values.logLevel = normalizedLog.level;
        values.maxFileSize = Math.max(
          1,
          Math.round(normalizedLog.maxFileSize / (1024 * 1024)),
        );
        values.maxFiles = normalizedLog.maxFiles;
        values.compressOldLogs = normalizedLog.compressOldLogs;
        values.cleanupIntervalDays = normalizedLog.cleanupIntervalDays;
      }
    }

    if (window.terminalAPI?.getErrorReportingSettings) {
      const response = await window.terminalAPI.getErrorReportingSettings();
      if (response?.success !== false) {
        const settings = response?.settings || {};
        values.errorReportingEnabled = settings.enabled === true;
        values.includeDiagnosticsInFeedback =
          settings.includeDiagnosticsInFeedback === true;
        values.crashCaptureEnabled = settings.crashCaptureEnabled !== false;
        values.crashReporterStatus = response?.crashReporter || null;
      }
    }

    // 加载 WebDAV 同步设置
    if (window.terminalAPI?.configSyncLoadSettings) {
      const response = await window.terminalAPI.configSyncLoadSettings();
      const syncSettings = response?.success ? response.settings : null;
      if (syncSettings) {
        values.webdavUrl = syncSettings.url || "";
        values.webdavUsername = syncSettings.username || "";
        values.webdavPassword = syncSettings.password || "";
        values.webdavFileName =
          syncSettings.fileName ||
          syncSettings.defaultRemoteFileName ||
          "simpleshell-config.ssx";
        values.autoSyncEnabled = syncSettings.autoSyncEnabled === true;
        values.autoSyncOnStartup = syncSettings.autoSyncOnStartup !== false;
        values.autoSyncIntervalMinutes =
          Number(syncSettings.autoSyncIntervalMinutes) || 30;
        values.rememberExportPassword =
          syncSettings.rememberExportPassword === true;
      }
    }

    // 加载自动同步运行状态
    if (window.terminalAPI?.configSyncGetStatus) {
      const response = await window.terminalAPI.configSyncGetStatus();
      if (response?.success !== false) {
        values.autoSyncStatus = response?.status || response || null;
      }
    }
  } catch {
    /* intentionally ignored */
  }

  return values;
}
