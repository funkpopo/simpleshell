/** SshRecovery: explicit dependencies supplied by the service facade. */
function createSshRecovery(
  dependencies,
  {
    isSshStreamUsable,
    extractTabIdFromConnectionKey,
    getTerminalText,
    logToFile,
  },
) {
  return new (class SshRecovery {
    constructor() {
      this.dependencies = dependencies;
    }
    _ensureReconnectListener() {
      const sshPool = this.dependencies.connectionManager?.sshConnectionPool;
      if (!sshPool) {
        return;
      }

      if (
        this.dependencies.boundReconnectPool === sshPool &&
        this.dependencies.onConnectionReconnected
      ) {
        return;
      }

      if (
        this.dependencies.boundReconnectPool &&
        this.dependencies.onConnectionReconnected
      ) {
        this.dependencies.boundReconnectPool.removeListener(
          "connectionReconnected",
          this.dependencies.onConnectionReconnected,
        );
        this.dependencies.boundReconnectPool.removeListener(
          "savedConnectionsChanged",
          this.dependencies.onSavedConnectionsChanged,
        );
      }

      this.dependencies.boundReconnectPool = sshPool;
      this.dependencies.onConnectionReconnected = ({ key, connection }) => {
        void this._handleConnectionReconnected(key, connection);
      };
      sshPool.on(
        "connectionReconnected",
        this.dependencies.onConnectionReconnected,
      );
      this.dependencies.onSavedConnectionsChanged = ({
        previousConnections,
        connections,
      }) => {
        this.dependencies.authentication.cancelForChangedConnections(
          previousConnections,
          connections,
        );
      };
      sshPool.on(
        "savedConnectionsChanged",
        this.dependencies.onSavedConnectionsChanged,
      );
    }
    _bindConnectionProcess(connectionKey, processId, tabId = null) {
      if (!connectionKey || processId === undefined || processId === null)
        return;
      this.dependencies.connectionProcessBindings.set(connectionKey, {
        processId,
        tabId: tabId || null,
      });
    }
    _unbindConnectionProcess(connectionKey) {
      if (!connectionKey) return;
      this.dependencies.connectionProcessBindings.delete(connectionKey);
    }
    _unbindConnectionProcessByProcess(processId, tabId = null) {
      for (const [connectionKey, binding] of this.dependencies
        .connectionProcessBindings) {
        if (
          String(binding.processId) === String(processId) ||
          (tabId && String(binding.tabId) === String(tabId))
        ) {
          this.dependencies.connectionProcessBindings.delete(connectionKey);
        }
      }
    }
    _resolveProcessBinding(connectionKey) {
      const binding =
        this.dependencies.connectionProcessBindings.get(connectionKey);
      if (!binding) {
        return null;
      }

      const hasProcess = this.dependencies.childProcesses.has(
        binding.processId,
      );
      const hasTab = binding.tabId
        ? this.dependencies.childProcesses.has(binding.tabId)
        : false;
      if (hasProcess || hasTab) {
        return binding;
      }

      this.dependencies.connectionProcessBindings.delete(connectionKey);
      return null;
    }
    _isSSHStreamUsable(stream) {
      return isSshStreamUsable(stream);
    }
    _isStreamBoundToClient(stream, client) {
      if (!stream || !client) {
        return false;
      }
      // ssh2 Channel 内部持有 _client 引用，可直接比对归属
      if (stream._client) {
        return stream._client === client;
      }
      // 无法判断归属时保守起见视为不可用，触发重建 shell
      return false;
    }
    async _handleConnectionReconnected(connectionKey, connectionInfoFromPool) {
      if (!connectionKey) return;

      const tabIdFromConnectionKey =
        extractTabIdFromConnectionKey(connectionKey);
      const binding = this._resolveProcessBinding(connectionKey);
      if (!binding) {
        const sshConfig = connectionInfoFromPool?.config || null;
        const message = getTerminalText(
          sshConfig,
          "reconnectRecoveryFailedDefault",
        );
        logToFile(
          `自动恢复终端会话失败: connection=${connectionKey}, error=no terminal binding`,
          "ERROR",
        );
        this.dependencies._emitTerminalSessionRestoreFailed({
          tabId: tabIdFromConnectionKey,
          connectionKey,
          sshConfig,
          error: message,
        });
        return;
      }

      const { processId, tabId } = binding;
      const procInfo = this.dependencies.childProcesses.get(processId);
      const tabProcInfo = tabId
        ? this.dependencies.childProcesses.get(tabId)
        : null;
      if (!procInfo && !tabProcInfo) {
        this._unbindConnectionProcess(connectionKey);
        const sshConfig = connectionInfoFromPool?.config || null;
        const message = getTerminalText(
          sshConfig,
          "reconnectRecoveryFailedDefault",
        );
        logToFile(
          `自动恢复终端会话失败: connection=${connectionKey}, process=${processId}, error=bound terminal process missing`,
          "ERROR",
        );
        this.dependencies._emitTerminalSessionRestoreFailed({
          processId,
          tabId: tabId || tabIdFromConnectionKey,
          connectionKey,
          sshConfig,
          error: message,
        });
        return;
      }

      const activeProc = procInfo || tabProcInfo;
      if (!activeProc || activeProc.type !== "ssh2") {
        const sshConfig =
          activeProc?.config || connectionInfoFromPool?.config || null;
        const message = getTerminalText(
          sshConfig,
          "reconnectRecoveryFailedDefault",
        );
        logToFile(
          `自动恢复终端会话失败: connection=${connectionKey}, process=${processId}, error=bound process is not ssh2`,
          "ERROR",
        );
        this.dependencies._emitTerminalSessionRestoreFailed({
          processId,
          tabId: tabId || tabIdFromConnectionKey,
          connectionKey,
          sshConfig,
          error: message,
        });
        return;
      }

      const latestConnInfo =
        this.dependencies.connectionManager?.sshConnectionPool?.connections?.get(
          connectionKey,
        ) || connectionInfoFromPool;
      const sshConfig = activeProc.config || latestConnInfo?.config;
      if (!sshConfig) {
        const message = getTerminalText(null, "reconnectRecoveryFailedDefault");
        logToFile(
          `自动恢复终端会话失败: connection=${connectionKey}, process=${processId}, error=missing ssh config`,
          "ERROR",
        );
        this.dependencies._emitTerminalSessionRestoreFailed({
          processId,
          tabId: tabId || tabIdFromConnectionKey,
          connectionKey,
          sshConfig: null,
          error: message,
        });
        return;
      }

      const existingStream = procInfo?.stream || tabProcInfo?.stream;
      if (
        this._isSSHStreamUsable(existingStream) &&
        this._isStreamBoundToClient(existingStream, latestConnInfo.client)
      ) {
        this.dependencies._emitTerminalSessionRestored({
          processId,
          tabId,
          connectionKey,
          sshConfig,
        });
        return;
      }

      if (this.dependencies.reconnectingShells.has(connectionKey)) {
        return;
      }

      if (!latestConnInfo?.client) {
        const message = getTerminalText(
          sshConfig,
          "reconnectRecoveryFailedDefault",
        );
        logToFile(
          `自动恢复终端会话失败: connection=${connectionKey}, process=${processId}, error=missing recovered ssh client`,
          "ERROR",
        );
        this.dependencies._emitTerminalSessionRestoreFailed({
          processId,
          tabId: tabId || tabIdFromConnectionKey,
          connectionKey,
          sshConfig,
          error: message,
        });
        return;
      }

      this.dependencies.reconnectingShells.add(connectionKey);
      this.dependencies._emitProcessOutput(
        processId,
        `\r\n\x1b[36m*** ${getTerminalText(sshConfig, "reconnectRecoveryStarted")} ***\x1b[0m\r\n`,
      );

      try {
        await this.dependencies._createSSHShell(
          latestConnInfo.client,
          processId,
          sshConfig,
          latestConnInfo,
          { isReconnectRecovery: true },
        );

        this.dependencies._emitProcessOutput(
          processId,
          `\r\n\x1b[32m*** ${getTerminalText(sshConfig, "reconnectRecoverySucceeded")} ***\x1b[0m\r\n`,
        );

        this.dependencies._emitTerminalSessionRestored({
          processId,
          tabId,
          connectionKey,
          sshConfig,
        });
      } catch (error) {
        const message =
          error?.message ||
          getTerminalText(sshConfig, "reconnectRecoveryFailedDefault");
        this.dependencies._emitSshTabConnectionStatus(tabId, sshConfig, {
          isConnected: false,
          quality: "offline",
          error: message,
        });

        logToFile(
          `自动恢复终端会话失败: connection=${connectionKey}, process=${processId}, error=${message}`,
          "ERROR",
        );
        this.dependencies._emitProcessOutput(
          processId,
          `\r\n\x1b[31m*** ${getTerminalText(
            sshConfig,
            "reconnectRecoveryFailed",
            {
              message,
            },
          )} ***\x1b[0m\r\n`,
        );

        this.dependencies._emitTerminalSessionRestoreFailed({
          processId,
          tabId,
          connectionKey,
          sshConfig,
          error: message,
        });
      } finally {
        this.dependencies.reconnectingShells.delete(connectionKey);
      }
    }
  })();
}
module.exports = createSshRecovery;
