/** ApplicationSettings: explicit dependencies supplied by the service facade. */
function createApplicationSettings(
  dependencies,
  { filterCommandHistory, decompressCommandHistory, compressCommandHistory },
) {
  return new (class ApplicationSettings {
    constructor() {
      this.dependencies = dependencies;
    }
    loadUISettings() {
      return this.dependencies._loadSection("UI settings", {
        fallback: () => this._getDefaultUISettings(),
        read: (config) => {
          if (config.uiSettings) {
            const settings = {
              ...this._getDefaultUISettings(),
              ...config.uiSettings,
            };
            this.dependencies._validate("uiSettings", settings);
            return settings;
          }
          return undefined;
        },
      });
    }
    _getDefaultUISettings() {
      return {
        transferIntegrity: false,
        sftpFollowTerminalDirectory: true,
        language: "zh-CN",
        fontSize: 14,
        editorFont: "system",
        darkMode: true,
        sidebarPosition: "right",
        terminalFont: "Fira Code",
        terminalFontSize: 14,
        terminalLineHeight: 1.0,
        performance: {},
        externalEditor: {},
        resourceMonitor: {
          displayMode: "independent",
        },
        desktopIntegration: {
          trayEnabled: false,
          closeToTray: false,
        },
        onboarding: {
          completed: false,
          completedAt: null,
          version: 1,
        },
        ipQueryHistory: [],
        windowBounds: {},
        backupRetentionDays: 30,
      };
    }
    saveUISettings(settings) {
      return this.dependencies._saveSection("UI settings", {
        write: (config) => {
          const mergedSettings = {
            ...this._getDefaultUISettings(),
            ...(config.uiSettings || {}),
            ...settings,
          };

          delete mergedSettings.networkResilience;
          delete mergedSettings.networkResilienceMode;

          // 验证数据
          if (!this.dependencies._validate("uiSettings", mergedSettings)) {
            return false;
          }

          config.uiSettings = mergedSettings;
        },
      });
    }
    loadLogSettings() {
      return this.dependencies._loadSection("log settings", {
        fallback: () => this._getDefaultLogSettings(),
        read: (config) => {
          if (config.logSettings) {
            const settings = {
              ...this._getDefaultLogSettings(),
              ...config.logSettings,
            };
            this.dependencies._validate("logSettings", settings);
            return settings;
          }
          return undefined;
        },
      });
    }
    _getDefaultLogSettings() {
      return {
        level: "INFO",
        maxFileSize: 5242880,
        maxFiles: 5,
        compressOldLogs: true,
        cleanupInterval: 24,
      };
    }
    saveLogSettings(settings) {
      return this.dependencies._saveSection("log settings", {
        // 验证数据（原实现在读取配置前校验）
        preValidate: () => this.dependencies._validate("logSettings", settings),
        write: (config) => {
          config.logSettings = settings;
        },
      });
    }
    loadShortcutCommands() {
      return this.dependencies._loadSection("shortcut commands", {
        fallback: () => ({}),
        read: (config) => {
          if (config.shortcutCommands) {
            if (typeof config.shortcutCommands === "string") {
              return JSON.parse(config.shortcutCommands);
            }
            return config.shortcutCommands;
          }
          return undefined;
        },
      });
    }
    saveShortcutCommands(commands) {
      return this.dependencies._saveSection("shortcut commands", {
        write: (config) => {
          config.shortcutCommands = JSON.stringify(commands);
        },
      });
    }
    loadCommandHistory() {
      return this.dependencies._loadSection("command history", {
        fallback: () => [],
        read: (config) => {
          if (config.commandHistory) {
            // 支持旧格式（未压缩的数组）
            if (Array.isArray(config.commandHistory)) {
              this.dependencies._log(
                "ConfigService: Migrating old command history format to compressed format.",
                "INFO",
              );
              return filterCommandHistory(config.commandHistory);
            }
            // 新格式（压缩对象）
            return decompressCommandHistory(
              config.commandHistory,
              this.dependencies._log.bind(this),
            );
          }
          return undefined;
        },
      });
    }
    saveCommandHistory(history) {
      return this.dependencies._saveSection("command history", {
        write: (config) => {
          config.commandHistory = compressCommandHistory(
            history,
            this.dependencies._log.bind(this),
          );
        },
      });
    }
  })();
}
module.exports = createApplicationSettings;
