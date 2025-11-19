const configService = require("../../../services/configService");
const commandHistoryService = require("../../../modules/terminal/command-history");
const { logToFile, updateLogConfig } = require("../../utils/logger");
const fileCache = require("../../utils/fileCache");

/**
 * 设置相关的IPC处理器
 */
class SettingsHandlers {
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
    ];
  }

  // 实现各个处理器方法
  async loadUISettings(event) {
    try {
      const settings = configService.loadUISettings();
      return { success: true, settings };
    } catch (error) {
      logToFile(`Error loading UI settings: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async saveUISettings(event, settings) {
    try {
      configService.saveUISettings(settings);
      return { success: true };
    } catch (error) {
      logToFile(`Error saving UI settings: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async loadLogSettings(event) {
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

  async updateCacheSettings(event, settings) {
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

  async updatePrefetchSettings(event, settings) {
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

  async getShortcutCommands(event) {
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
      const history = commandHistoryService.addCommand(command);
      return { success: true, data: history };
    } catch (error) {
      logToFile(`Error adding command to history: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getCommandSuggestions(event, input, maxResults = 10) {
    try {
      const suggestions = commandHistoryService.getSuggestions(input, maxResults);
      return { success: true, suggestions };
    } catch (error) {
      logToFile(`Error getting command suggestions: ${error.message}`, "ERROR");
      return { success: false, error: error.message, suggestions: [] };
    }
  }

  async incrementCommandUsage(event, command) {
    try {
      commandHistoryService.incrementCommandUsage(command);
      return { success: true };
    } catch (error) {
      logToFile(`Error incrementing command usage: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async clearCommandHistory(event) {
    try {
      commandHistoryService.clearHistory();
      logToFile("Command history cleared", "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`Error clearing command history: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getCommandStatistics(event) {
    try {
      const stats = commandHistoryService.getStatistics();
      return { success: true, data: stats };
    } catch (error) {
      logToFile(`Error getting command statistics: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getAllCommandHistory(event) {
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
      const result = commandHistoryService.deleteCommand(command);
      return { success: result };
    } catch (error) {
      logToFile(`Error deleting command: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async deleteCommandBatch(event, commands) {
    try {
      let deletedCount = 0;
      for (const command of commands) {
        if (commandHistoryService.deleteCommand(command)) {
          deletedCount++;
        }
      }
      logToFile(`Deleted ${deletedCount} commands from history`, "INFO");
      return { success: true, deletedCount };
    } catch (error) {
      logToFile(`Error deleting command batch: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = SettingsHandlers;
