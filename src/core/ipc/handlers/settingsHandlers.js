const { BrowserWindow, app } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const configService = require("../../../services/configService");
const commandHistoryService = require("../../../modules/terminal/command-history");
const {
  getLogDirectoryPath,
  getLogFilePath,
  logToFile,
  updateLogConfig,
} = require("../../utils/logger");
const { getTempDirectory } = require("../../utils/appPaths");
const runtimeFileLifecycle = require("../../utils/runtimeFileLifecycle");
const { broadcastToAllWindows } = require("../../window/windowManager");
const {
  getErrorReportingStatus,
  saveErrorReportingSettings,
} = require("../../utils/crashReporter");
const {
  applyDesktopIntegrationSettings,
} = require("../../app/desktopIntegration");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
} = require("../schema/channels");

const LOCAL_DATA_SECTIONS = new Set([
  "connections",
  "credentials",
  "commandHistory",
  "shortcutCommands",
  "uiSettings",
  "aiSettings",
  "cache",
  "snapshots",
  "externalEditorTemp",
  "logs",
  "aiMemory",
]);

/**
 * 设置相关的IPC处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
 */
class SettingsHandlers {
  notifyCommandHistoryChanged(reason, history) {
    const payload = {
      reason,
      history,
      count: Array.isArray(history) ? history.length : 0,
      timestamp: Date.now(),
    };

    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (
        win &&
        !win.isDestroyed() &&
        win.webContents &&
        !win.webContents.isDestroyed?.()
      ) {
        try {
          win.webContents.send(IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED, payload);
        } catch (error) {
          logToFile(
            `Error broadcasting command history change: ${error.message}`,
            "WARN",
          );
        }
      }
    }
  }

  persistCommandHistoryChange(reason) {
    const historyToSave = commandHistoryService.exportHistory();
    const saved = configService.saveCommandHistory(historyToSave);
    if (!saved) {
      throw new Error("Failed to persist command history");
    }

    const history = commandHistoryService.getAllHistory();
    this.notifyCommandHistoryChanged(reason, history);
    return history;
  }

  applyCommandHistoryMutation(reason, mutate) {
    const previousHistory = commandHistoryService.exportHistory();
    const mutationResult = mutate();
    const changed =
      typeof mutationResult === "object" && mutationResult !== null
        ? mutationResult.changed === true
        : mutationResult === true;

    if (!changed) {
      return {
        changed: false,
        mutationResult,
        history: commandHistoryService.getAllHistory(),
      };
    }

    try {
      const history = this.persistCommandHistoryChange(reason);
      return {
        changed: true,
        mutationResult,
        history,
      };
    } catch (error) {
      commandHistoryService.initialize(previousHistory);
      throw error;
    }
  }

  /**
   * 获取所有设置处理器
   */
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_LOAD_UI,
        category: "settings",
        handler: this.loadUISettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_SAVE_UI,
        category: "settings",
        handler: this.saveUISettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_LOAD_LOG,
        category: "settings",
        handler: this.loadLogSettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_SAVE_LOG,
        category: "settings",
        handler: this.saveLogSettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_GET_ERROR_REPORTING,
        category: "settings",
        handler: this.getErrorReportingSettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_SAVE_ERROR_REPORTING,
        category: "settings",
        handler: this.saveErrorReportingSettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_PREFETCH,
        category: "settings",
        handler: this.updatePrefetchSettings.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_GET_CREDENTIAL_SECURITY_STATUS,
        category: "settings",
        handler: this.getCredentialSecurityStatus.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_CREDENTIAL_SECURITY,
        category: "settings",
        handler: this.updateCredentialSecurity.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_UNLOCK_CREDENTIAL_STORE,
        category: "settings",
        handler: this.unlockCredentialStore.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_LOCK_CREDENTIAL_STORE,
        category: "settings",
        handler: this.lockCredentialStore.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SETTINGS_CLEAR_LOCAL_DATA,
        category: "settings",
        handler: this.clearLocalData.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_GET,
        category: "settings",
        handler: this.getShortcutCommands.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_SAVE,
        category: "settings",
        handler: this.saveShortcutCommands.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.COMMAND_HISTORY_ADD,
        category: "settings",
        handler: this.addCommandHistory.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_SUGGESTIONS,
        category: "settings",
        handler: this.getCommandSuggestions.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.COMMAND_HISTORY_INCREMENT_USAGE,
        category: "settings",
        handler: this.incrementCommandUsage.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.COMMAND_HISTORY_CLEAR,
        category: "settings",
        handler: this.clearCommandHistory.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_STATISTICS,
        category: "settings",
        handler: this.getCommandStatistics.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_ALL,
        category: "settings",
        handler: this.getAllCommandHistory.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE,
        category: "settings",
        handler: this.deleteCommand.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE_BATCH,
        category: "settings",
        handler: this.deleteCommandBatch.bind(this),
      },
    ];
  }

  // 实现各个处理器方法
  async loadUISettings() {
    // 直接返回设置对象,避免嵌套
    return configService.loadUISettings();
  }

  async saveUISettings(event, settings) {
    const saved = configService.saveUISettings(settings);
    if (!saved) {
      throw new Error("Failed to save UI settings");
    }
    applyDesktopIntegrationSettings(settings?.desktopIntegration || {});
    return { success: true };
  }

  async loadLogSettings() {
    const settings = configService.loadLogSettings();
    return { success: true, settings };
  }

  async saveLogSettings(event, settings) {
    configService.saveLogSettings(settings);
    updateLogConfig(settings);
    logToFile("Log settings updated", "INFO");
    return { success: true };
  }

  async getErrorReportingSettings() {
    return getErrorReportingStatus(app);
  }

  async saveErrorReportingSettings(event, settings) {
    void event;
    const status = saveErrorReportingSettings(settings);
    logToFile("Error reporting settings updated", "INFO");
    return status;
  }

  async updatePrefetchSettings() {
    // Prefetch settings 可能需要单独的处理逻辑
    // 暂时注释掉，因为 ConfigService 中没有对应的方法
    // configService.savePrefetchSettings(settings);
    logToFile("Prefetch settings updated (not implemented)", "WARN");
    return { success: true };
  }

  async getCredentialSecurityStatus() {
    const status = configService.getCredentialSecurityStatus();
    return { success: true, status };
  }

  async updateCredentialSecurity(event, settings) {
    const status = configService.updateCredentialSecurity(settings);
    broadcastToAllWindows(IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED);
    logToFile("Credential security settings updated", "INFO");
    return { success: true, status };
  }

  async unlockCredentialStore(event, masterPassword) {
    const result = configService.unlockCredentialStore(masterPassword);
    if (result.success) {
      logToFile("Credential store unlocked", "INFO");
    }
    return result;
  }

  async lockCredentialStore() {
    const result = configService.lockCredentialStore();
    if (result.success) {
      logToFile("Credential store locked", "INFO");
    }
    return result;
  }

  normalizeLocalDataSections(sections) {
    if (!Array.isArray(sections)) {
      throw new Error("Local data sections must be an array");
    }

    const uniqueSections = [];
    for (const rawSection of sections) {
      const section = String(rawSection || "").trim();
      if (!LOCAL_DATA_SECTIONS.has(section)) {
        throw new Error(`Unsupported local data section: ${section}`);
      }
      if (!uniqueSections.includes(section)) {
        uniqueSections.push(section);
      }
    }

    if (uniqueSections.length === 0) {
      throw new Error("No local data section selected");
    }

    return uniqueSections;
  }

  notifyLocalDataChanged(sections) {
    const payload = {
      sections,
      timestamp: Date.now(),
    };

    broadcastToAllWindows(
      IPC_EVENT_CHANNELS.SETTINGS_LOCAL_DATA_CLEARED,
      payload,
    );
    if (
      sections.some((section) =>
        ["connections", "credentials", "aiSettings"].includes(section),
      )
    ) {
      broadcastToAllWindows(IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED);
    }
    if (sections.includes("commandHistory")) {
      broadcastToAllWindows(IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED, {
        reason: "clear-local-data",
        history: [],
        count: 0,
        timestamp: payload.timestamp,
      });
    }
  }

  async clearLogFiles() {
    const logDir = getLogDirectoryPath();
    const activeLogFile = getLogFilePath();
    if (!logDir) {
      throw new Error("Log directory is not initialized");
    }

    const entries = await fs.readdir(logDir, { withFileTypes: true });
    let clearedCount = 0;
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const filePath = path.join(logDir, entry.name);
      if (activeLogFile && filePath === activeLogFile) {
        await fs.truncate(filePath, 0);
      } else {
        await fs.rm(filePath, { force: true });
      }
      clearedCount += 1;
    }

    return clearedCount;
  }

  async clearAIMemoryFile() {
    const tempDir = getTempDirectory(app);
    const memoryFilePath = path.join(tempDir, "mem.json");

    try {
      await fs.unlink(memoryFilePath);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async clearRuntimeFileResource(resourceName) {
    return runtimeFileLifecycle.clearResource(resourceName, {
      recreate: true,
      includeActive: true,
      reason: "clear-local-data",
    });
  }

  async clearLocalData(event, options = {}) {
    void event;
    const sections = this.normalizeLocalDataSections(options?.sections);
    const configSections = sections.filter((section) =>
      [
        "connections",
        "credentials",
        "commandHistory",
        "shortcutCommands",
        "uiSettings",
        "aiSettings",
      ].includes(section),
    );

    const runtime = {};
    if (configSections.length > 0) {
      configService.clearLocalConfigData({ sections: configSections });
    }

    if (sections.includes("commandHistory")) {
      commandHistoryService.initialize([]);
    }

    if (sections.includes("cache")) {
      runtime.cacheCleared =
        await this.clearRuntimeFileResource("file-cache");
    }

    if (sections.includes("snapshots")) {
      runtime.snapshotsCleared =
        await this.clearRuntimeFileResource("file-snapshots");
    }

    if (sections.includes("externalEditorTemp")) {
      runtime.externalEditorTempCleared = await this.clearRuntimeFileResource(
        "external-editor-temp",
      );
    }

    if (sections.includes("logs")) {
      runtime.logFilesCleared = await this.clearLogFiles();
    }

    if (sections.includes("aiMemory")) {
      runtime.aiMemoryCleared = await this.clearAIMemoryFile();
    }

    this.notifyLocalDataChanged(sections);
    logToFile(`Local data cleared: ${sections.join(", ")}`, "WARN");

    return {
      success: true,
      sections,
      runtime,
    };
  }

  async getShortcutCommands() {
    const shortcuts = configService.loadShortcutCommands();
    return { success: true, data: shortcuts };
  }

  async saveShortcutCommands(event, data) {
    configService.saveShortcutCommands(data);
    logToFile("Shortcut commands saved", "INFO");
    return { success: true };
  }

  async addCommandHistory(event, command) {
    const result = this.applyCommandHistoryMutation("add", () =>
      commandHistoryService.addCommand(command),
    );
    return {
      success: true,
      data: result.mutationResult,
      saved: result.changed,
      history: result.history,
    };
  }

  async getCommandSuggestions(event, input, maxResults = 10) {
    const suggestions = commandHistoryService.getSuggestions(
      input,
      maxResults,
    );
    return { success: true, suggestions };
  }

  async incrementCommandUsage(event, command) {
    const result = this.applyCommandHistoryMutation("increment", () =>
      commandHistoryService.incrementCommandUsage(command),
    );
    return {
      success: true,
      data: result.mutationResult,
      saved: result.changed,
      history: result.history,
    };
  }

  async clearCommandHistory() {
    const result = this.applyCommandHistoryMutation("clear", () =>
      commandHistoryService.clearHistory(),
    );
    if (result.changed) {
      logToFile("Command history cleared", "INFO");
    }
    return {
      success: true,
      data: result.mutationResult,
      saved: result.changed,
      history: result.history,
    };
  }

  async getCommandStatistics() {
    const stats = commandHistoryService.getStatistics();
    return { success: true, data: stats };
  }

  async getAllCommandHistory() {
    const history = commandHistoryService.getAllHistory();
    return { success: true, data: history };
  }

  async deleteCommand(event, command) {
    const result = this.applyCommandHistoryMutation("delete", () =>
      commandHistoryService.deleteCommand(command),
    );
    return {
      success: result.mutationResult === true,
      data: result.mutationResult,
      saved: result.changed,
      history: result.history,
    };
  }

  async deleteCommandBatch(event, commands) {
    let deletedCount = 0;
    const result = this.applyCommandHistoryMutation("deleteBatch", () => {
      for (const command of commands) {
        if (commandHistoryService.deleteCommand(command)) {
          deletedCount++;
        }
      }
      return {
        changed: deletedCount > 0,
        deletedCount,
      };
    });
    if (deletedCount > 0) {
      logToFile(`Deleted ${deletedCount} commands from history`, "INFO");
    }
    return {
      success: true,
      deletedCount,
      saved: result.changed,
      history: result.history,
    };
  }
}

module.exports = SettingsHandlers;
