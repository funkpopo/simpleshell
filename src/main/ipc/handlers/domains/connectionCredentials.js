/** ConnectionCredentials: explicit dependencies supplied by the service facade. */
function createConnectionCredentials(
  dependencies,
  {
    createManagedSshConnection,
    classifyConnectionFailure,
    logToFile,
    configService,
    broadcastToAllWindows,
    IPC_EVENT_CHANNELS,
  },
) {
  return new (class ConnectionCredentials {
    constructor() {
      this.dependencies = dependencies;
    }
    _normalizeTestSSHConfig(sshConfig = {}) {
      const port = Number.parseInt(sshConfig.port, 10);
      return {
        ...sshConfig,
        protocol: "ssh",
        host: String(sshConfig.host || "").trim(),
        port: Number.isFinite(port) && port > 0 ? port : 22,
        username: String(sshConfig.username || "").trim(),
        password: sshConfig.password || "",
        authType: sshConfig.authType || "password",
        privateKeyPath:
          typeof sshConfig.privateKeyPath === "string"
            ? sshConfig.privateKeyPath.trim()
            : "",
        tabId: sshConfig.tabId || `connection-test-${Date.now()}`,
        autoReconnect: false,
        retryOnAuthFailure: false,
      };
    }
    _validateTestSSHConfig(sshConfig) {
      if (!sshConfig.host) {
        throw new Error("Host is required");
      }

      if (
        !Number.isFinite(Number(sshConfig.port)) ||
        Number(sshConfig.port) < 1 ||
        Number(sshConfig.port) > 65535
      ) {
        throw new Error("Port must be between 1 and 65535");
      }

      if (!sshConfig.username) {
        throw new Error("Username is required");
      }

      if (sshConfig.authType === "privateKey" && !sshConfig.privateKeyPath) {
        throw new Error("Private key path is required");
      }
    }
    async testSSHConnection(event, rawConfig) {
      void event;
      const startedAt = Date.now();
      const sshConfig = this._normalizeTestSSHConfig(rawConfig);

      try {
        this._validateTestSSHConfig(sshConfig);

        await this.dependencies._assertSSHReachableBeforeAuth(sshConfig);

        let connectionHandle = null;
        try {
          connectionHandle = await createManagedSshConnection(
            this.dependencies.authentication._attachHostVerificationConfig(
              sshConfig,
            ),
            {
              connectionTimeoutMs: 30000,
            },
          );

          return {
            success: true,
            durationMs: Date.now() - startedAt,
            host: sshConfig.host,
            port: sshConfig.port,
            username: sshConfig.username,
          };
        } finally {
          try {
            connectionHandle?.cleanup?.();
          } catch {
            // Best-effort cleanup for the temporary test socket.
          }
        }
      } catch (error) {
        const classified = classifyConnectionFailure(error, {
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
          authType: sshConfig.authType,
          privateKeyPath: sshConfig.privateKeyPath,
          usingProxy: Boolean(sshConfig.proxy),
          protocol: "ssh",
        });

        logToFile(
          `SSH connection test failed: ${sshConfig.host}:${sshConfig.port} - ${error.message}`,
          "WARN",
        );

        return {
          success: false,
          error: error.message,
          code: error.code || error.originalError?.code || null,
          failureKind: classified.kind,
          advice: classified.suggestion,
          durationMs: Date.now() - startedAt,
        };
      }
    }
    async updateConnectionCredentials(event, connectionId, credentials) {
      void event;
      if (!connectionId || !credentials) {
        throw new Error("Invalid parameters");
      }

      // 加载现有连接配置
      const connections = configService.loadConnections();
      const previousConnections = structuredClone(connections);

      // 递归查找并更新连接
      const updateConnection = (items) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type === "connection" && item.id === connectionId) {
            // 更新凭据
            if (credentials.username) {
              items[i].username = credentials.username;
            }
            if (credentials.password !== undefined) {
              items[i].password = credentials.password;
            }
            if (credentials.privateKeyPath !== undefined) {
              items[i].privateKeyPath = credentials.privateKeyPath;
            }
            if (credentials.authType) {
              items[i].authType = credentials.authType;
            }
            return true;
          }
          if (item.type === "group" && Array.isArray(item.items)) {
            if (updateConnection(item.items)) {
              return true;
            }
          }
        }
        return false;
      };

      const updated = updateConnection(connections);

      if (!updated) {
        throw new Error("Connection not found");
      }

      if (!configService.saveConnections(connections)) {
        throw new Error("Failed to save connection credentials");
      }
      this.dependencies.connectionManager.syncConnectionConfigs(
        previousConnections,
        configService.loadConnections(),
        this.dependencies.childProcesses,
      );
      logToFile(`Updated credentials for connection: ${connectionId}`, "INFO");

      // 通知前端连接配置已更改
      broadcastToAllWindows(IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED);

      return { success: true };
    }
  })();
}
module.exports = createConnectionCredentials;
