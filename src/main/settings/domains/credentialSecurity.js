/** CredentialSecurity: explicit dependencies supplied by the service facade. */
function createCredentialSecurity(dependencies) {
  return new (class CredentialSecurity {
    constructor() {
      this.dependencies = dependencies;
    }
    _getDefaultSecuritySettings(existingSecurity = {}) {
      const masterPasswordEnabled =
        existingSecurity?.masterPasswordEnabled === true &&
        typeof existingSecurity?.masterPasswordVerifier === "string" &&
        existingSecurity.masterPasswordVerifier.trim() !== "";

      return this.dependencies.crypto.createSecurityConfig({
        currentSecurity: existingSecurity,
        masterPasswordEnabled,
        masterPassword: "",
      });
    }
    _ensureSecurityConfig(config) {
      const normalizedConfig =
        config && typeof config === "object" ? { ...config } : {};
      const existingSecurity =
        normalizedConfig.security &&
        typeof normalizedConfig.security === "object"
          ? normalizedConfig.security
          : {};
      const existingMode =
        typeof existingSecurity.mode === "string" ? existingSecurity.mode : "";
      const randomKey =
        typeof existingSecurity.randomKey === "string"
          ? existingSecurity.randomKey.trim()
          : "";
      const masterPasswordEnabled =
        existingSecurity.masterPasswordEnabled === true;
      const masterPasswordVerifier =
        masterPasswordEnabled &&
        typeof existingSecurity.masterPasswordVerifier === "string"
          ? existingSecurity.masterPasswordVerifier.trim()
          : "";

      let nextSecurity = null;
      if (masterPasswordEnabled && randomKey && masterPasswordVerifier) {
        nextSecurity = {
          mode: this.dependencies.crypto.SECURITY_MODE_MASTER_PASSWORD,
          randomKey,
          masterPasswordEnabled: true,
          masterPasswordVerifier,
          kdf:
            existingSecurity.kdf && typeof existingSecurity.kdf === "object"
              ? existingSecurity.kdf
              : {
                  algorithm: "scrypt",
                  version: this.dependencies.crypto.KDF_VERSION,
                  ...this.dependencies.crypto.SCRYPT_PARAMS,
                },
        };
      } else if (
        existingMode ===
          this.dependencies.crypto.SECURITY_MODE_LEGACY_RANDOM_KEY ||
        randomKey
      ) {
        nextSecurity = {
          mode: this.dependencies.crypto.SECURITY_MODE_LEGACY_RANDOM_KEY,
          randomKey,
          masterPasswordEnabled: false,
          masterPasswordVerifier: "",
          kdf: null,
        };
      } else {
        nextSecurity = this.dependencies.crypto.createSecurityConfig({
          currentSecurity: existingSecurity,
          masterPasswordEnabled: false,
        });
      }

      normalizedConfig.security = nextSecurity;

      return {
        config: normalizedConfig,
        changed:
          JSON.stringify(existingSecurity || {}) !==
          JSON.stringify(nextSecurity),
      };
    }
    _applySecuritySettings(security) {
      this.dependencies.crypto.configureSecurity(security);
    }
    _reEncryptSensitiveDataWithSecurity(config, nextSecurity) {
      this._applySecuritySettings(nextSecurity);
      const nextConfig = {
        ...config,
        security: nextSecurity,
        connections: this.dependencies._processConnectionsForSave(
          config.connections || [],
        ),
        topConnections: this.dependencies._processConnectionsForSave(
          config.topConnections || [],
        ),
        lastConnections: this.dependencies._processConnectionsForSave(
          config.lastConnections || [],
        ),
        aiSettings: this.dependencies._processAISettingsForSave(
          config.aiSettings || {},
        ),
      };
      return nextConfig;
    }
    _upgradeLegacyCredentialSecurity(config) {
      const security = config?.security || {};
      if (
        security.mode !==
        this.dependencies.crypto.SECURITY_MODE_LEGACY_RANDOM_KEY
      ) {
        return { config, changed: false };
      }

      this._applySecuritySettings(security);
      const decryptedConfig = {
        ...config,
        connections: this.dependencies._processConnectionsForLoad(
          config.connections || [],
        ),
        topConnections: this.dependencies._processConnectionsForLoad(
          config.topConnections || [],
        ),
        lastConnections: this.dependencies._processConnectionsForLoad(
          config.lastConnections || [],
        ),
        aiSettings: this.dependencies._processAISettingsForLoad(
          config.aiSettings || {},
        ),
      };
      const nextSecurity = this.dependencies.crypto.createSecurityConfig();
      const nextConfig = this._reEncryptSensitiveDataWithSecurity(
        decryptedConfig,
        nextSecurity,
      );
      this.dependencies._log(
        "ConfigService: Upgraded legacy randomKey credential storage to safeStorage.",
        "INFO",
      );
      return { config: nextConfig, changed: true };
    }
    _isCredentialStoreLocked() {
      const status =
        this.dependencies.crypto &&
        typeof this.dependencies.crypto.getSecurityStatus === "function"
          ? this.dependencies.crypto.getSecurityStatus()
          : null;
      return Boolean(status?.requiresUnlock);
    }
    getCredentialSecurityStatus() {
      if (!this.dependencies._initialized) {
        return {
          randomKeyConfigured: false,
          masterPasswordEnabled: false,
          unlocked: true,
          requiresUnlock: false,
        };
      }

      try {
        const config = this.dependencies._readConfig();
        const { config: normalizedConfig } = this._ensureSecurityConfig(config);
        let runtimeStatus = this.dependencies.crypto.getSecurityStatus();

        // 自愈：若运行时尚未 configureSecurity（unlocked 默认 false），
        // 在无主密码模式下补一次，避免渲染进程因 !unlocked 永久不加载连接。
        const masterPasswordEnabled =
          normalizedConfig?.security?.masterPasswordEnabled === true;
        if (
          !masterPasswordEnabled &&
          runtimeStatus?.unlocked === false &&
          typeof this.dependencies.crypto.configureSecurity === "function"
        ) {
          try {
            this._applySecuritySettings(normalizedConfig.security);
            runtimeStatus = this.dependencies.crypto.getSecurityStatus();
          } catch (applyError) {
            this.dependencies._log(
              `ConfigService: Failed to re-apply security settings for status - ${applyError.message}`,
              "WARN",
            );
          }
        }

        const requiresUnlock = Boolean(
          masterPasswordEnabled && runtimeStatus?.unlocked === false,
        );

        return {
          randomKeyConfigured: Boolean(normalizedConfig?.security?.randomKey),
          masterPasswordEnabled,
          // 无主密码时始终视为已解锁，避免启动门闩误拦连接加载
          unlocked: masterPasswordEnabled
            ? runtimeStatus?.unlocked === true
            : true,
          requiresUnlock,
        };
      } catch (error) {
        this.dependencies._log(
          `ConfigService: Failed to get credential security status - ${error.message}`,
          "ERROR",
        );
        return {
          randomKeyConfigured: false,
          masterPasswordEnabled: false,
          unlocked: true,
          requiresUnlock: false,
        };
      }
    }
    unlockCredentialStore(masterPassword) {
      if (!this.dependencies._initialized) {
        return {
          success: false,
          error: "Config service is not initialized",
        };
      }

      try {
        const config = this.dependencies._readConfig();
        const { config: normalizedConfig } = this._ensureSecurityConfig(config);
        this._applySecuritySettings(normalizedConfig.security);
        const result =
          this.dependencies.crypto.unlockWithMasterPassword(masterPassword);

        if (!result.success) {
          return result;
        }

        return {
          success: true,
          status: this.getCredentialSecurityStatus(),
        };
      } catch (error) {
        this.dependencies._log(
          `ConfigService: Failed to unlock credential store - ${error.message}`,
          "ERROR",
        );
        return {
          success: false,
          error: error.message,
        };
      }
    }
    lockCredentialStore() {
      if (!this.dependencies._initialized) {
        return {
          success: false,
          error: "Config service is not initialized",
        };
      }

      try {
        const config = this.dependencies._readConfig();
        const { config: normalizedConfig } = this._ensureSecurityConfig(config);
        this._applySecuritySettings(normalizedConfig.security);
        const status = this.dependencies.crypto.lockCredentialStore();
        return {
          success: true,
          status: {
            randomKeyConfigured: Boolean(normalizedConfig?.security?.randomKey),
            masterPasswordEnabled:
              normalizedConfig?.security?.masterPasswordEnabled === true,
            unlocked: status?.unlocked !== false,
            requiresUnlock: Boolean(status?.requiresUnlock),
          },
        };
      } catch (error) {
        this.dependencies._log(
          `ConfigService: Failed to lock credential store - ${error.message}`,
          "ERROR",
        );
        return {
          success: false,
          error: error.message,
        };
      }
    }
    updateCredentialSecurity(options = {}) {
      if (!this.dependencies._initialized) {
        throw new Error("Config service is not initialized");
      }

      const masterPasswordEnabled = options?.masterPasswordEnabled === true;
      const masterPassword =
        typeof options?.masterPassword === "string"
          ? options.masterPassword
          : "";

      if (masterPasswordEnabled && !masterPassword) {
        throw new Error("Master password is required");
      }

      const decryptedConnections = this.dependencies.loadConnections();
      const decryptedTopConnections = this.dependencies.loadTopConnections();
      const decryptedLastConnections = this.dependencies.loadLastConnections();
      const decryptedAISettings = this.dependencies.loadAISettings();

      const config = this.dependencies._readConfig(true);
      const { config: normalizedConfig } = this._ensureSecurityConfig(config);
      const nextSecurity = masterPasswordEnabled
        ? this.dependencies.crypto.createSecurityConfig({
            currentSecurity: normalizedConfig.security,
            masterPasswordEnabled: true,
            masterPassword,
          })
        : this.dependencies.crypto.createSecurityConfig({
            currentSecurity: normalizedConfig.security,
            masterPasswordEnabled: false,
          });

      normalizedConfig.security = nextSecurity;
      this._applySecuritySettings(nextSecurity);

      if (masterPasswordEnabled) {
        const unlockResult =
          this.dependencies.crypto.unlockWithMasterPassword(masterPassword);
        if (!unlockResult.success) {
          throw new Error(unlockResult.error || "Invalid master password");
        }
      }

      normalizedConfig.connections =
        this.dependencies._processConnectionsForSave(decryptedConnections);
      normalizedConfig.topConnections =
        this.dependencies._processConnectionsForSave(decryptedTopConnections);
      normalizedConfig.lastConnections =
        this.dependencies._processConnectionsForSave(decryptedLastConnections);
      normalizedConfig.aiSettings =
        this.dependencies._processAISettingsForSave(decryptedAISettings);

      if (!this.dependencies._writeConfig(normalizedConfig)) {
        throw new Error("Failed to persist security settings");
      }

      return this.getCredentialSecurityStatus();
    }
  })();
}
module.exports = createCredentialSecurity;
