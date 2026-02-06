const { dialog, BrowserWindow } = require("electron");
const configService = require("../../../services/configService");
const commandHistoryService = require("../../../modules/terminal/command-history");
const { logToFile, updateLogConfig } = require("../../utils/logger");
const fileCache = require("../../utils/fileCache");

class SettingsHandlers {
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
        channel: "settings:updateCacheSettings",
        category: "settings",
        handler: this.updateCacheSettings.bind(this),
      },
      {
        channel: "settings:updatePrefetchSettings",
        category: "settings",
        handler: this.updatePrefetchSettings.bind(this),
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
      {
        channel: "settings:exportSyncPackage",
        category: "settings",
        handler: this.exportSyncPackage.bind(this),
      },
      {
        channel: "settings:importSyncPackage",
        category: "settings",
        handler: this.importSyncPackage.bind(this),
      },
    ];
  }

  _getMainWindow() {
    const windows = BrowserWindow.getAllWindows();
    return windows.length > 0 ? windows[0] : null;
  }

  _notifySyncDataChanged() {
    const lastConnections = configService.loadLastConnections();
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (win && !win.isDestroyed() && win.webContents) {
        win.webContents.send("connections-changed");
        win.webContents.send("top-connections-changed", lastConnections);
      }
    }
  }

  async loadUISettings() {
    try {
      return configService.loadUISettings();
    } catch (error) {
      logToFile(`Error loading UI settings: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async saveUISettings(_event, settings) {
    try {
      configService.saveUISettings(settings);
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

  async saveLogSettings(_event, settings) {
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

  async updateCacheSettings(_event, settings) {
    try {
      if (fileCache && fileCache.updateSettings) {
        fileCache.updateSettings(settings);
        logToFile("Cache settings updated", "INFO");
      }
      return { success: true };
    } catch (error) {
      logToFile(`Error updating cache settings: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async updatePrefetchSettings() {
    logToFile("Prefetch settings updated (not implemented)", "WARN");
    return { success: true };
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

  async saveShortcutCommands(_event, data) {
    try {
      configService.saveShortcutCommands(data);
      logToFile("Shortcut commands saved", "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`Error saving shortcut commands: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async addCommandHistory(_event, command) {
    try {
      const history = commandHistoryService.addCommand(command);
      configService.saveCommandHistory(commandHistoryService.exportHistory());
      return { success: true, data: history };
    } catch (error) {
      logToFile(`Error adding command to history: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getCommandSuggestions(_event, input, maxResults = 10) {
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

  async incrementCommandUsage(_event, command) {
    try {
      commandHistoryService.incrementCommandUsage(command);
      configService.saveCommandHistory(commandHistoryService.exportHistory());
      return { success: true };
    } catch (error) {
      logToFile(`Error incrementing command usage: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async clearCommandHistory() {
    try {
      commandHistoryService.clearHistory();
      configService.saveCommandHistory([]);
      logToFile("Command history cleared", "INFO");
      return { success: true };
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

  async deleteCommand(_event, command) {
    try {
      const result = commandHistoryService.deleteCommand(command);
      if (result) {
        configService.saveCommandHistory(commandHistoryService.exportHistory());
      }
      return { success: result };
    } catch (error) {
      logToFile(`Error deleting command: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async deleteCommandBatch(_event, commands) {
    try {
      let deletedCount = 0;
      for (const command of commands) {
        if (commandHistoryService.deleteCommand(command)) {
          deletedCount += 1;
        }
      }
      if (deletedCount > 0) {
        configService.saveCommandHistory(commandHistoryService.exportHistory());
      }
      logToFile(`Deleted ${deletedCount} commands from history`, "INFO");
      return { success: true, deletedCount };
    } catch (error) {
      logToFile(`Error deleting command batch: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async exportSyncPackage() {
    try {
      const mainWindow = this._getMainWindow();
      const now = new Date();
      const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const defaultFileName = `simpleshell-sync-${stamp}.ssdb`;

      const saveResult = await dialog.showSaveDialog(mainWindow, {
        title: "导出同步包",
        defaultPath: defaultFileName,
        filters: [{ name: "SimpleShell Sync DB", extensions: ["ssdb"] }],
        properties: ["showOverwriteConfirmation", "createDirectory"],
      });

      if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
      }

      await configService.exportSyncPackage(saveResult.filePath);
      logToFile(`Sync package exported: ${saveResult.filePath}`, "INFO");
      return { success: true, filePath: saveResult.filePath };
    } catch (error) {
      logToFile(`Error exporting sync package: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async importSyncPackage() {
    try {
      const mainWindow = this._getMainWindow();
      const openResult = await dialog.showOpenDialog(mainWindow, {
        title: "导入同步包（覆盖当前数据）",
        properties: ["openFile"],
        filters: [
          { name: "SimpleShell Sync DB", extensions: ["ssdb", "db", "sqlite"] },
        ],
      });

      if (openResult.canceled || !openResult.filePaths?.[0]) {
        return { success: false, canceled: true };
      }

      const sourcePath = openResult.filePaths[0];
      const backupPath = await configService.importSyncPackage(sourcePath);
      commandHistoryService.initialize(configService.loadCommandHistory());
      this._notifySyncDataChanged();

      logToFile(
        `Sync package imported: ${sourcePath}, local backup: ${backupPath}`,
        "INFO",
      );
      return { success: true, sourcePath, backupPath };
    } catch (error) {
      logToFile(`Error importing sync package: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = SettingsHandlers;
