/** ConfigMaintenance: explicit dependencies supplied by the service facade. */
function createConfigMaintenance(dependencies, { compressCommandHistory }) {
  return new (class ConfigMaintenance {
    constructor() {
      this.dependencies = dependencies;
    }
    _stripSensitiveConnectionFields(items) {
      if (!Array.isArray(items)) {
        return [];
      }

      return items.map((item) => {
        const result = { ...item };
        if (result.type === "connection") {
          delete result.password;
          delete result.passphrase;
          delete result.privateKey;
          delete result.privateKeyPath;
          if (result.proxy && typeof result.proxy === "object") {
            result.proxy = { ...result.proxy };
            delete result.proxy.password;
          }
        }
        if (result.type === "group") {
          result.items = this._stripSensitiveConnectionFields(
            result.items || [],
          );
        }
        return result;
      });
    }
    _stripSensitiveAIFields(settings) {
      const result =
        settings && typeof settings === "object" ? { ...settings } : {};

      if (Array.isArray(result.configs)) {
        result.configs = result.configs.map((cfg) => ({
          ...cfg,
          apiKey: "",
        }));
      }

      if (result.current && typeof result.current === "object") {
        result.current = {
          ...result.current,
          apiKey: "",
        };
      }

      if (result.proxyConfig && typeof result.proxyConfig === "object") {
        result.proxyConfig = {
          ...result.proxyConfig,
          password: "",
        };
      }

      return result;
    }
    clearLocalConfigData(options = {}) {
      if (!this.dependencies._initialized) {
        throw new Error("Config service is not initialized");
      }

      const sections = Array.isArray(options?.sections) ? options.sections : [];
      const sectionSet = new Set(sections);
      const config = this.dependencies._readConfig(true);
      const nextConfig = this.dependencies._cloneConfig(config);

      this.dependencies._createConfigBackup("before-clear");

      if (sectionSet.has("connections")) {
        nextConfig.connections = [];
        nextConfig.topConnections = [];
        nextConfig.lastConnections = [];
      }

      if (sectionSet.has("credentials")) {
        nextConfig.connections = this._stripSensitiveConnectionFields(
          nextConfig.connections || [],
        );
        nextConfig.topConnections = this._stripSensitiveConnectionFields(
          nextConfig.topConnections || [],
        );
        nextConfig.lastConnections = this._stripSensitiveConnectionFields(
          nextConfig.lastConnections || [],
        );
        nextConfig.aiSettings = this._stripSensitiveAIFields(
          nextConfig.aiSettings || {},
        );
      }

      if (sectionSet.has("commandHistory")) {
        nextConfig.commandHistory = compressCommandHistory(
          [],
          this.dependencies._log.bind(this),
        );
      }

      if (sectionSet.has("shortcutCommands")) {
        nextConfig.shortcutCommands = "{}";
      }

      if (sectionSet.has("uiSettings")) {
        nextConfig.uiSettings = this.dependencies._getDefaultUISettings();
      }

      if (sectionSet.has("aiSettings")) {
        nextConfig.aiSettings = {
          configs: [],
          current: null,
        };
      }

      if (!this.dependencies._writeConfig(nextConfig)) {
        throw new Error("Failed to clear local config data");
      }

      return {
        success: true,
        sections,
      };
    }
  })();
}
module.exports = createConfigMaintenance;
