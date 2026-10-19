/** AiSettings: explicit dependencies supplied by the service facade. */
function createAiSettings(dependencies) {
  return new (class AiSettings {
    constructor() {
      this.dependencies = dependencies;
    }
    _decryptAISecret(value, label) {
      if (typeof value !== "string" || value.length === 0) {
        return "";
      }

      const decrypted = this.dependencies.crypto.decryptText(value);
      if (decrypted !== null && decrypted !== undefined) {
        return decrypted;
      }

      if (!this.dependencies._isCredentialStoreLocked()) {
        this.dependencies._log(
          `ConfigService: Failed to decrypt ${label}.`,
          "WARN",
        );
      }
      return "";
    }
    _encryptAISecret(value, label) {
      if (typeof value !== "string" || value.length === 0) {
        return "";
      }

      const encrypted = this.dependencies.crypto.encryptText(value);
      if (typeof encrypted !== "string" || encrypted.length === 0) {
        throw new Error(`Failed to encrypt ${label}`);
      }
      return encrypted;
    }
    _processAISettingsForLoad(settings) {
      const result =
        settings && typeof settings === "object" ? { ...settings } : {};
      const storeLocked = this.dependencies._isCredentialStoreLocked();

      if (Array.isArray(result.configs)) {
        result.configs = result.configs.map((cfg) => {
          if (cfg.apiKey && this.dependencies.crypto.decryptText) {
            try {
              const decryptedApiKey = this.dependencies.crypto.decryptText(
                cfg.apiKey,
              );
              if (decryptedApiKey === null && !storeLocked) {
                this.dependencies._log(
                  `ConfigService: Failed to decrypt API key for config ${cfg.name || cfg.id}.`,
                  "WARN",
                );
              }
              return { ...cfg, apiKey: decryptedApiKey ?? "" };
            } catch (error) {
              if (!storeLocked) {
                this.dependencies._log(
                  `ConfigService: Failed to decrypt API key for config ${cfg.name || cfg.id} - ${error.message}`,
                  "WARN",
                );
              }
              return { ...cfg, apiKey: "" };
            }
          }
          return cfg;
        });
      }

      if (
        result.current &&
        result.current.apiKey &&
        this.dependencies.crypto.decryptText
      ) {
        try {
          const decryptedCurrentApiKey = this.dependencies.crypto.decryptText(
            result.current.apiKey,
          );
          if (decryptedCurrentApiKey === null && !storeLocked) {
            this.dependencies._log(
              "ConfigService: Failed to decrypt current API key.",
              "WARN",
            );
          }
          result.current = {
            ...result.current,
            apiKey: decryptedCurrentApiKey ?? "",
          };
        } catch (error) {
          if (!storeLocked) {
            this.dependencies._log(
              `ConfigService: Failed to decrypt current API key - ${error.message}`,
              "WARN",
            );
          }
          result.current = {
            ...result.current,
            apiKey: "",
          };
        }
      }

      if (result.proxyConfig && typeof result.proxyConfig === "object") {
        result.proxyConfig = {
          ...result.proxyConfig,
          password: this._decryptAISecret(
            result.proxyConfig.password,
            "AI proxy password",
          ),
        };
      }

      return result;
    }
    _processAISettingsForSave(settings) {
      const settingsToSave =
        settings && typeof settings === "object" ? { ...settings } : {};
      const normalizeApiConfig = (cfg) => {
        if (!cfg || typeof cfg !== "object") {
          return cfg;
        }

        const { maxTokens, temperature, ...normalized } = cfg;
        void maxTokens;
        void temperature;

        if (typeof normalized.model === "string") {
          normalized.model = normalized.model.trim();
          if (normalized.model) {
            normalized.name = normalized.model;
          }
        }

        return normalized;
      };

      if (Array.isArray(settingsToSave.configs)) {
        settingsToSave.configs = settingsToSave.configs.map(normalizeApiConfig);
      }

      if (settingsToSave.current) {
        settingsToSave.current = normalizeApiConfig(settingsToSave.current);
      }

      if (
        settingsToSave.proxyConfig &&
        typeof settingsToSave.proxyConfig === "object"
      ) {
        const proxyConfig = { ...settingsToSave.proxyConfig };
        delete proxyConfig.hasProxyPassword;
        if (proxyConfig.password) {
          proxyConfig.password = this._encryptAISecret(
            proxyConfig.password,
            "AI proxy password",
          );
        }
        settingsToSave.proxyConfig = proxyConfig;
      }

      if (
        Array.isArray(settingsToSave.configs) &&
        this.dependencies.crypto.encryptText
      ) {
        settingsToSave.configs = settingsToSave.configs.map((cfg) => {
          if (cfg.apiKey) {
            try {
              const encryptedKey = this.dependencies.crypto.encryptText(
                cfg.apiKey,
              );
              return { ...cfg, apiKey: encryptedKey };
            } catch (error) {
              this.dependencies._log(
                `ConfigService: Failed to encrypt API key for config ${cfg.name || cfg.id} - ${error.message}`,
                "WARN",
              );
              return { ...cfg, apiKey: "" };
            }
          }
          return cfg;
        });
      }

      if (
        settingsToSave.current &&
        settingsToSave.current.apiKey &&
        this.dependencies.crypto.encryptText
      ) {
        try {
          settingsToSave.current = {
            ...settingsToSave.current,
            apiKey: this.dependencies.crypto.encryptText(
              settingsToSave.current.apiKey,
            ),
          };
        } catch (error) {
          this.dependencies._log(
            `ConfigService: Failed to encrypt current API key - ${error.message}`,
            "WARN",
          );
          settingsToSave.current = {
            ...settingsToSave.current,
            apiKey: "",
          };
        }
      }

      return settingsToSave;
    }
    loadAISettings() {
      const fallback = () => ({
        configs: [],
        current: { apiUrl: "", apiKey: "", model: "", streamEnabled: true },
      });

      return this.dependencies._loadSection("AI settings", {
        fallback,
        onStart: () => {
          this.dependencies._log(
            `ConfigService: Loading AI settings from ${this.dependencies.mainConfigPath}`,
            "INFO",
          );
        },
        read: (config) => {
          if (config.aiSettings) {
            const settings = this._processAISettingsForLoad(config.aiSettings);

            // 验证加载的数据
            this.dependencies._validate("aiSettings", settings);

            this.dependencies._log(
              `ConfigService: Loaded ${settings.configs?.length || 0} AI configurations.`,
              "INFO",
            );
            return settings;
          }
          return undefined;
        },
      });
    }
    saveAISettings(settings) {
      return this.dependencies._saveSection("AI settings", {
        onStart: () => {
          this.dependencies._log(
            `ConfigService: Saving AI settings to ${this.dependencies.mainConfigPath}`,
            "INFO",
          );
        },
        write: (config) => {
          config.aiSettings = this._processAISettingsForSave(settings);
        },
      });
    }
  })();
}
module.exports = createAiSettings;
