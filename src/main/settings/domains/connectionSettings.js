/** ConnectionSettings: explicit dependencies supplied by the service facade. */
function createConnectionSettings(dependencies) {
  return new (class ConnectionSettings {
    constructor() {
      this.dependencies = dependencies;
    }
    _countConnections(items) {
      if (!Array.isArray(items)) {
        return 0;
      }

      let count = 0;
      for (const item of items) {
        if (!item || typeof item !== "object") {
          continue;
        }
        if (item.type === "connection") {
          count += 1;
        } else if (item.type === "group") {
          count += this._countConnections(item.items);
        }
      }
      return count;
    }
    _processConnectionsForSave(items) {
      if (!this.dependencies.crypto || !this.dependencies.crypto.encryptText) {
        this.dependencies._log(
          "ConfigService: encryptText function is not available.",
          "ERROR",
        );
        return items;
      }

      return items.map((item) => {
        const result = { ...item };
        if (item.type === "connection") {
          if (item._passwordAlreadyEncrypted === true) {
            result.password = item.password || "";
          } else if (item.password) {
            result.password = this.dependencies.crypto.encryptText(
              item.password,
            );
          }
          delete result._passwordAlreadyEncrypted;
          delete result._preservePassword;
          if (item.privateKeyPath) {
            result.privateKeyPath = this.dependencies.crypto.encryptText(
              item.privateKeyPath,
            );
          }
        }
        if (item.type === "group" && Array.isArray(item.items)) {
          result.items = this._processConnectionsForSave(item.items);
        }
        return result;
      });
    }
    _processConnectionsForLoad(items) {
      if (!this.dependencies.crypto || !this.dependencies.crypto.decryptText) {
        this.dependencies._log(
          "ConfigService: decryptText function is not available.",
          "ERROR",
        );
        return items;
      }

      const storeLocked = this.dependencies._isCredentialStoreLocked();

      return items.map((item) => {
        const result = { ...item };
        if (item.type === "connection") {
          if (item.password) {
            try {
              const decryptedPassword = this.dependencies.crypto.decryptText(
                item.password,
              );
              if (decryptedPassword === null && !storeLocked) {
                this.dependencies._log(
                  "ConfigService: Failed to decrypt password.",
                  "WARN",
                );
              }
              result.password = decryptedPassword ?? "";
            } catch (error) {
              if (!storeLocked) {
                this.dependencies._log(
                  `ConfigService: Failed to decrypt password - ${error.message}`,
                  "WARN",
                );
              }
              result.password = "";
            }
          }
          if (item.privateKeyPath) {
            try {
              const decryptedPrivateKeyPath =
                this.dependencies.crypto.decryptText(item.privateKeyPath);
              if (decryptedPrivateKeyPath === null && !storeLocked) {
                this.dependencies._log(
                  "ConfigService: Failed to decrypt privateKeyPath.",
                  "WARN",
                );
              }
              result.privateKeyPath = decryptedPrivateKeyPath ?? "";
            } catch (error) {
              if (!storeLocked) {
                this.dependencies._log(
                  `ConfigService: Failed to decrypt privateKeyPath - ${error.message}`,
                  "WARN",
                );
              }
              result.privateKeyPath = "";
            }
          }
        }
        if (item.type === "group" && Array.isArray(item.items)) {
          result.items = this._processConnectionsForLoad(item.items);
        }
        return result;
      });
    }
    _mergePreservedConnectionCredentials(items, existingItems) {
      if (!Array.isArray(items)) {
        return items;
      }

      const existingById = new Map();
      const collectExisting = (entries = []) => {
        entries.forEach((entry) => {
          if (!entry || typeof entry !== "object") {
            return;
          }
          if (entry.type === "connection" && entry.id) {
            existingById.set(entry.id, entry);
            return;
          }
          if (entry.type === "group") {
            collectExisting(entry.items || []);
          }
        });
      };

      collectExisting(existingItems || []);

      const mergeItems = (entries = []) =>
        entries.map((entry) => {
          if (!entry || typeof entry !== "object") {
            return entry;
          }

          const result = { ...entry };
          if (result.type === "connection") {
            const existing = result.id ? existingById.get(result.id) : null;
            if (result._preservePassword === true && existing) {
              result.password = existing.password || "";
              result._passwordAlreadyEncrypted = true;
            }
            delete result._preservePassword;
          }

          if (result.type === "group" && Array.isArray(result.items)) {
            result.items = mergeItems(result.items);
          }

          return result;
        });

      return mergeItems(items);
    }
    loadConnections() {
      return this.dependencies._loadSection("connections", {
        fallback: () => [],
        read: (config) => {
          if (config.connections && Array.isArray(config.connections)) {
            return this._processConnectionsForLoad(config.connections);
          }
          return undefined;
        },
      });
    }
    loadPortForwards() {
      return this.dependencies._loadSection("port forwards", {
        fallback: () => [],
        read: (config) => {
          if (Array.isArray(config.portForwards)) {
            return config.portForwards;
          }
          return undefined;
        },
      });
    }
    savePortForwards(portForwards) {
      return this.dependencies._saveSection("port forwards", {
        write: (config) => {
          config.portForwards = Array.isArray(portForwards) ? portForwards : [];
        },
      });
    }
    _findConnectionById(items, connectionId) {
      if (!Array.isArray(items) || !connectionId) {
        return null;
      }

      for (const item of items) {
        if (!item || typeof item !== "object") {
          continue;
        }

        if (item.type === "connection" && item.id === connectionId) {
          return item;
        }

        if (item.type === "group") {
          const found = this._findConnectionById(
            item.items || [],
            connectionId,
          );
          if (found) {
            return found;
          }
        }
      }

      return null;
    }
    getSavedConnectionPassword(connectionId) {
      if (!this.dependencies._initialized) {
        return {
          success: false,
          error: "Config service is not initialized",
        };
      }

      const securityStatus = this.dependencies.getCredentialSecurityStatus();
      if (securityStatus.masterPasswordEnabled !== true) {
        return {
          success: false,
          error: "Master password is not configured",
          code: "MASTER_PASSWORD_NOT_CONFIGURED",
          status: securityStatus,
        };
      }

      if (securityStatus.requiresUnlock || securityStatus.unlocked === false) {
        return {
          success: false,
          error: "Credential store is locked",
          code: "CREDENTIAL_STORE_LOCKED",
          status: securityStatus,
        };
      }

      try {
        const config = this.dependencies._readConfig();
        const connection = this._findConnectionById(
          config.connections || [],
          connectionId,
        );

        if (!connection) {
          return {
            success: false,
            error: "Connection not found",
            code: "CONNECTION_NOT_FOUND",
            status: securityStatus,
          };
        }

        if (!connection.password) {
          return {
            success: true,
            password: "",
            status: securityStatus,
          };
        }

        const password = this.dependencies.crypto.decryptText(
          connection.password,
        );
        if (password === null) {
          return {
            success: false,
            error: "Failed to decrypt password",
            code: "DECRYPT_FAILED",
            status: securityStatus,
          };
        }

        return {
          success: true,
          password,
          status: securityStatus,
        };
      } catch (error) {
        this.dependencies._log(
          `ConfigService: Failed to get saved connection password - ${error.message}`,
          "ERROR",
        );
        return {
          success: false,
          error: error.message,
          code: "PASSWORD_READ_FAILED",
          status: securityStatus,
        };
      }
    }
    saveConnections(connections) {
      return this.dependencies._saveSection("connections", {
        write: (config) => {
          const mergedConnections = this._mergePreservedConnectionCredentials(
            connections,
            config.connections || [],
          );
          const processedConnections =
            this._processConnectionsForSave(mergedConnections);
          config.connections = processedConnections;
        },
      });
    }
    loadTopConnections() {
      return this.dependencies._loadSection("top connections", {
        fallback: () => [],
        read: (config) => {
          if (config.topConnections && Array.isArray(config.topConnections)) {
            return this._processConnectionsForLoad(config.topConnections);
          }
          return undefined;
        },
      });
    }
    saveTopConnections(connections) {
      return this.dependencies._saveSection("top connections", {
        write: (config) => {
          config.topConnections = this._processConnectionsForSave(connections);
        },
      });
    }
    loadLastConnections() {
      return this.dependencies._loadSection("last connections", {
        fallback: () => [],
        read: (config) => {
          if (config.lastConnections && Array.isArray(config.lastConnections)) {
            return this._processConnectionsForLoad(config.lastConnections);
          }
          return undefined;
        },
      });
    }
    saveLastConnections(connections) {
      return this.dependencies._saveSection("last connections", {
        write: (config) => {
          config.lastConnections = this._processConnectionsForSave(connections);
        },
      });
    }
  })();
}
module.exports = createConnectionSettings;
