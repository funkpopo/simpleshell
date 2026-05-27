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
const {
  getErrorReportingStatus,
  saveErrorReportingSettings,
} = require("../../utils/crashReporter");
const {
  applyDesktopIntegrationSettings,
} = require("../../app/desktopIntegration");

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
          win.webContents.send("command-history:changed", payload);
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
        channel: "settings:loadUISettings",
        category: "settings",
        handler: this.loadUISettings.bind(this),
      },
      {
        channel: "settings:saveUISettings",
        category: "settings",
        handler: this.saveUISettings.bind(this),
      },
      {
        channel: "settings:loadLogSettings",
        category: "settings",
        handler: this.loadLogSettings.bind(this),
      },
      {
        channel: "settings:saveLogSettings",
        category: "settings",
        handler: this.saveLogSettings.bind(this),
      },
      {
        channel: "settings:getErrorReportingSettings",
        category: "settings",
        handler: this.getErrorReportingSettings.bind(this),
      },
      {
        channel: "settings:saveErrorReportingSettings",
        category: "settings",
        handler: this.saveErrorReportingSettings.bind(this),
      },
      {
        channel: "settings:updatePrefetchSettings",
        category: "settings",
        handler: this.updatePrefetchSettings.bind(this),
      },
      {
        channel: "settings:getCredentialSecurityStatus",
        category: "settings",
        handler: this.getCredentialSecurityStatus.bind(this),
      },
      {
        channel: "settings:updateCredentialSecurity",
        category: "settings",
        handler: this.updateCredentialSecurity.bind(this),
      },
      {
        channel: "settings:unlockCredentialStore",
        category: "settings",
        handler: this.unlockCredentialStore.bind(this),
      },
      {
        channel: "settings:lockCredentialStore",
        category: "settings",
        handler: this.lockCredentialStore.bind(this),
      },
      {
        channel: "settings:clearLocalData",
        category: "settings",
        handler: this.clearLocalData.bind(this),
      },
      {
        channel: "get-shortcut-commands",
        category: "settings",
        handler: this.getShortcutCommands.bind(this),
      },
      {
        channel: "save-shortcut-commands",
        category: "settings",
        handler: this.saveShortcutCommands.bind(this),
      },
      {
        channel: "command-history:add",
        category: "settings",
        handler: this.addCommandHistory.bind(this),
      },
      {
        channel: "command-history:getSuggestions",
        category: "settings",
        handler: this.getCommandSuggestions.bind(this),
      },
      {
        channel: "command-history:incrementUsage",
        category: "settings",
        handler: this.incrementCommandUsage.bind(this),
      },
      {
        channel: "command-history:clear",
        category: "settings",
        handler: this.clearCommandHistory.bind(this),
      },
      {
        channel: "command-history:getStatistics",
        category: "settings",
        handler: this.getCommandStatistics.bind(this),
      },
      {
        channel: "command-history:getAll",
        category: "settings",
        handler: this.getAllCommandHistory.bind(this),
      },
      {
        channel: "command-history:delete",
        category: "settings",
        handler: this.deleteCommand.bind(this),
      },
      {
        channel: "command-history:deleteBatch",
        category: "settings",
        handler: this.deleteCommandBatch.bind(this),
      },
    ];
  }

  // 实现各个处理器方法
  async loadUISettings() {
    try {
      const settings = configService.loadUISettings();
      // 直接返回设置对象,避免嵌套
      return settings;
    } catch (error) {
      logToFile(`Error loading UI settings: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async saveUISettings(event, settings) {
    try {
      const saved = configService.saveUISettings(settings);
      if (!saved) {
        throw new Error("Failed to save UI settings");
      }
      applyDesktopIntegrationSettings(settings?.desktopIntegration || {});
      return { success: true };
    } catch (error) {
      logToFile(`Error saving UI settings: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async loadLogSettings() {
    try {
      const settings = configService.loadLogSettings();
      return { success: true, settings };
    } catch (error) {
      logToFile(`Error loading log settings: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async saveLogSettings(event, settings) {
    try {
      configService.saveLogSettings(settings);
      updateLogConfig(settings);
      logToFile("Log settings updated", "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`Error saving log settings: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getErrorReportingSettings() {
    try {
      return getErrorReportingStatus(app);
    } catch (error) {
      logToFile(
        `Error loading error reporting settings: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  async saveErrorReportingSettings(event, settings) {
    try {
      void event;
      const status = saveErrorReportingSettings(settings);
      logToFile("Error reporting settings updated", "INFO");
      return status;
    } catch (error) {
      logToFile(
        `Error saving error reporting settings: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  async updatePrefetchSettings() {
    try {
      // Prefetch settings 可能需要单独的处理逻辑
      // 暂时注释掉，因为 ConfigService 中没有对应的方法
      // configService.savePrefetchSettings(settings);
      logToFile("Prefetch settings updated (not implemented)", "WARN");
      return { success: true };
    } catch (error) {
      logToFile(`Error updating prefetch settings: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getCredentialSecurityStatus() {
    try {
      const status = configService.getCredentialSecurityStatus();
      return { success: true, status };
    } catch (error) {
      logToFile(
        `Error getting credential security status: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  async updateCredentialSecurity(event, settings) {
    try {
      const status = configService.updateCredentialSecurity(settings);
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send("connections-changed");
        }
      }
      logToFile("Credential security settings updated", "INFO");
      return { success: true, status };
    } catch (error) {
      logToFile(
        `Error updating credential security settings: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  async unlockCredentialStore(event, masterPassword) {
    try {
      const result = configService.unlockCredentialStore(masterPassword);
      if (result.success) {
        logToFile("Credential store unlocked", "INFO");
      }
      return result;
    } catch (error) {
      logToFile(`Error unlocking credential store: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async lockCredentialStore() {
    try {
      const result = configService.lockCredentialStore();
      if (result.success) {
        logToFile("Credential store locked", "INFO");
      }
      return result;
    } catch (error) {
      logToFile(`Error locking credential store: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
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

    for (const win of BrowserWindow.getAllWindows()) {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send("settings:localDataCleared", payload);
        if (
          sections.some((section) =>
            ["connections", "credentials", "aiSettings"].includes(section),
          )
        ) {
          win.webContents.send("connections-changed");
        }
        if (sections.includes("commandHistory")) {
          win.webContents.send("command-history:changed", {
            reason: "clear-local-data",
            history: [],
            count: 0,
            timestamp: payload.timestamp,
          });
        }
      }
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
    try {
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
    } catch (error) {
      logToFile(`Error clearing local data: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getShortcutCommands() {
    try {
      const shortcuts = configService.loadShortcutCommands();
      return { success: true, data: shortcuts };
    } catch (error) {
      logToFile(`Error getting shortcut commands: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async saveShortcutCommands(event, data) {
    try {
      configService.saveShortcutCommands(data);
      logToFile("Shortcut commands saved", "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`Error saving shortcut commands: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async addCommandHistory(event, command) {
    try {
      const result = this.applyCommandHistoryMutation("add", () =>
        commandHistoryService.addCommand(command),
      );
      return {
        success: true,
        data: result.mutationResult,
        saved: result.changed,
        history: result.history,
      };
    } catch (error) {
      logToFile(`Error adding command to history: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getCommandSuggestions(event, input, maxResults = 10) {
    try {
      const suggestions = commandHistoryService.getSuggestions(
        input,
        maxResults,
      );
      return { success: true, suggestions };
    } catch (error) {
      logToFile(`Error getting command suggestions: ${error.message}`, "ERROR");
      return { success: false, error: error.message, suggestions: [] };
    }
  }

  async incrementCommandUsage(event, command) {
    try {
      const result = this.applyCommandHistoryMutation("increment", () =>
        commandHistoryService.incrementCommandUsage(command),
      );
      return {
        success: true,
        data: result.mutationResult,
        saved: result.changed,
        history: result.history,
      };
    } catch (error) {
      logToFile(`Error incrementing command usage: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async clearCommandHistory() {
    try {
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
    } catch (error) {
      logToFile(`Error clearing command history: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getCommandStatistics() {
    try {
      const stats = commandHistoryService.getStatistics();
      return { success: true, data: stats };
    } catch (error) {
      logToFile(`Error getting command statistics: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getAllCommandHistory() {
    try {
      const history = commandHistoryService.getAllHistory();
      return { success: true, data: history };
    } catch (error) {
      logToFile(`Error getting command history: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async deleteCommand(event, command) {
    try {
      const result = this.applyCommandHistoryMutation("delete", () =>
        commandHistoryService.deleteCommand(command),
      );
      return {
        success: result.mutationResult === true,
        data: result.mutationResult,
        saved: result.changed,
        history: result.history,
      };
    } catch (error) {
      logToFile(`Error deleting command: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async deleteCommandBatch(event, commands) {
    try {
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
    } catch (error) {
      logToFile(`Error deleting command batch: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = SettingsHandlers;
