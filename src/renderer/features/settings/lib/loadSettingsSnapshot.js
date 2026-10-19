import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from "../../terminal/model/terminalScrollback.js";

export default async function loadSettingsSnapshot() {
  const values = {
    language: "",
    fontSize: 14,
    editorFont: "system",
    terminalFont: "Fira Code",
    terminalFontSize: 14,
    terminalFontWeight: 500,
    terminalLineHeight: 1.0,
    terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
    darkMode: true,
    externalEditorEnabled: false,
    externalEditorCommand: "",
    diskAlertEnabled: false,
    diskAlertThreshold: 90,
    diskAlertIntervalSeconds: 60,
    resourceMonitorDisplayMode: "independent",
    logLevel: "WARN",
    maxFileSize: 5,
    cleanupIntervalDays: 7,
    backupRetentionDays: 30,
    errorReportingEnabled: false,
    includeDiagnosticsInFeedback: false,
    crashCaptureEnabled: true,
    crashReporterStatus: null,
    masterPasswordEnabled: false,
    initialMasterPasswordEnabled: false,
    masterPassword: "",
    confirmMasterPassword: "",
    imageSupported: true,
    cacheEnabled: true,
    prefetchEnabled: true,
    hardwareAccelerationEnabled: true,
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
        values.darkMode =
          settings.darkMode !== undefined ? settings.darkMode : true;

        // 加载性能设置
        const externalEditorSettings = settings.externalEditor || {};
        values.externalEditorEnabled =
          externalEditorSettings.enabled === true ||
          settings.externalEditorEnabled === true;
        values.externalEditorCommand =
          externalEditorSettings.command ||
          settings.externalEditorCommand ||
          "";

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

        // 加载资源监控显示模式
        const resourceMonitorSettings = settings.resourceMonitor || {};
        values.resourceMonitorDisplayMode =
          resourceMonitorSettings.displayMode === "trend"
            ? "trend"
            : "independent";

        const performanceSettings = settings.performance || {
          imageSupported: true,
          cacheEnabled: true,
          prefetchEnabled: true,
          webglEnabled: true,
          hardwareAcceleration: true,
        };
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

        values.imageSupported = performanceSettings.imageSupported !== false;
        values.cacheEnabled = performanceSettings.cacheEnabled !== false;
        values.prefetchEnabled = performanceSettings.prefetchEnabled !== false;
        const hardwareAcceleration =
          performanceSettings.hardwareAcceleration !== false;
        values.hardwareAccelerationEnabled = hardwareAcceleration;

        // 保存原始设置用于比较
        values.originalPerformanceSettings = performanceSettings;
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
        values.logLevel = logSettings.level || "WARN";
        // 将字节转换为MB
        values.maxFileSize = logSettings.maxFileSize
          ? Math.round(logSettings.maxFileSize / (1024 * 1024))
          : 5;
        values.cleanupIntervalDays = logSettings.cleanupIntervalDays || 7;
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
