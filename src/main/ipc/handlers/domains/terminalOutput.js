/** TerminalOutput: explicit dependencies supplied by the service facade. */
function createTerminalOutput(
  dependencies,
  {
    getTerminalProcessOutputChannel,
    IPC_EVENT_CHANNELS,
    getTerminalText,
    StringDecoder,
    logToFile,
    zmodemTransferService,
    filemanagementService,
  },
) {
  return new (class TerminalOutput {
    constructor() {
      this.dependencies = dependencies;
    }
    _emitProcessOutput(processId, output) {
      if (this.dependencies.terminalIOMailboxManager) {
        const emitted = this.dependencies.terminalIOMailboxManager.emitOutput(
          processId,
          output,
        );
        if (emitted) {
          return;
        }
      }

      const mainWindow = this.dependencies._getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      const channel = getTerminalProcessOutputChannel(processId);
      if (channel) {
        mainWindow.webContents.send(channel, output);
      }
    }
    _emitTerminalSessionEvent(channel, payload = {}) {
      const mainWindow = this.dependencies._getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      mainWindow.webContents.send(channel, {
        ...payload,
        timestamp: Date.now(),
      });
    }
    _emitSshTabConnectionStatus(tabId, sshConfig, overrides = {}) {
      const mainWindow = this.dependencies._getMainWindow();
      if (!tabId || !mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      const connectionStatus = {
        isConnected: true,
        isConnecting: false,
        quality: "excellent",
        lastUpdate: Date.now(),
        connectionType: "SSH",
        host: sshConfig?.host,
        port: sshConfig?.port,
        username: sshConfig?.username,
        ...overrides,
      };

      mainWindow.webContents.send(IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS, {
        tabId,
        connectionStatus,
      });
    }
    _emitTerminalSessionRestored({
      processId,
      tabId,
      connectionKey,
      sshConfig,
    }) {
      this._emitSshTabConnectionStatus(tabId, sshConfig);
      this._emitTerminalSessionEvent(
        IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORED,
        {
          processId,
          tabId,
          connectionKey,
          host: sshConfig?.host,
          port: sshConfig?.port || 22,
          username: sshConfig?.username,
        },
      );
    }
    _emitTerminalSessionRestoreFailed({
      processId = null,
      tabId,
      connectionKey,
      sshConfig,
      error,
      hint,
    }) {
      this._emitTerminalSessionEvent(
        IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORE_FAILED,
        {
          processId,
          tabId,
          connectionKey,
          host: sshConfig?.host,
          port: sshConfig?.port || 22,
          username: sshConfig?.username,
          error:
            error ||
            getTerminalText(sshConfig, "reconnectRecoveryFailedDefault"),
          hint:
            hint || getTerminalText(sshConfig, "reconnectRecoveryFailedHint"),
        },
      );
    }
    _setProcessBufferedBytes(processId, bytes) {
      if (!this.dependencies.terminalIOMailboxManager) {
        return;
      }

      this.dependencies.terminalIOMailboxManager.setBufferedBytes(
        processId,
        bytes,
      );
    }
    _resetProcessResizeState(processId) {
      if (!this.dependencies.terminalIOMailboxManager) {
        return;
      }

      this.dependencies.terminalIOMailboxManager.resetResizeState(processId);
    }
    _destroyProcessMailbox(processId) {
      if (!this.dependencies.terminalIOMailboxManager) {
        return;
      }

      this.dependencies.terminalIOMailboxManager.destroyProcess(processId);
    }
    _getFlowControlTarget(processId, tabId = null) {
      const procInfo = this.dependencies.childProcesses.get(processId);
      const tabProcInfo = tabId
        ? this.dependencies.childProcesses.get(tabId)
        : null;

      // SSH terminals pass flow control to the core (`remoteFlow`); this
      // target serves Telnet, serial and Mosh sessions.
      return (
        procInfo?.stream || tabProcInfo?.stream || procInfo?.process || null
      );
    }
    _applyMailboxResize(processId, tabId, cols, rows) {
      const procInfo = this.dependencies.childProcesses.get(processId);
      const tabProcInfo = tabId
        ? this.dependencies.childProcesses.get(tabId)
        : null;
      const activeProc = procInfo || tabProcInfo;

      if (!activeProc) {
        return false;
      }

      if (
        activeProc.type === "ssh2" &&
        activeProc.stream &&
        typeof activeProc.stream.setWindow === "function"
      ) {
        activeProc.stream.setWindow(rows, cols);
        return true;
      }

      if (
        activeProc.type === "telnet" &&
        activeProc.process &&
        typeof activeProc.process.setWindow === "function"
      ) {
        activeProc.process.setWindow(rows, cols);
        return true;
      }

      if (
        activeProc.type === "mosh" &&
        activeProc.process &&
        typeof activeProc.process.resize === "function"
      ) {
        activeProc.process.resize(cols, rows);
        return true;
      }

      return false;
    }
    _configureProcessMailbox(processId, config = {}, remoteFlow = null) {
      if (!this.dependencies.terminalIOMailboxManager) {
        return null;
      }

      return this.dependencies.terminalIOMailboxManager.createMailbox(
        processId,
        {
          aliases: config.tabId ? [config.tabId] : [],
          getFlowControlTarget: () =>
            this._getFlowControlTarget(processId, config.tabId),
          applyResize: (cols, rows) =>
            this._applyMailboxResize(processId, config.tabId, cols, rows),
          remoteFlow,
        },
      );
    }
    /**
     * SSH terminals run as pipe channels: the core already decoded, filtered
     * and highlighted the output, merged stderr and runs ZMODEM; the mailbox
     * passes renderer ACKs and pause reasons back to it.
     */
    _setupStreamEventListeners(stream, processId, sshConfig, connectionInfo) {
      const decoder = new StringDecoder("utf8");
      const processMailbox = this._configureProcessMailbox(
        processId,
        sshConfig,
        {
          ack: (bytes) => stream.grantCredit(bytes),
          pause: (reason) => stream.pauseFor(reason),
          resume: (reason) => stream.resumeFor(reason),
        },
      );
      const emitOutput = (payload, options = {}) => {
        if (processMailbox) {
          processMailbox.emitOutput(payload, options);
          return;
        }
        this._emitProcessOutput(processId, payload);
        // Nobody acknowledges direct output: return the credit at once.
        if (options.trackBackpressure !== false) {
          stream.grantCredit(Buffer.byteLength(payload, "utf8"));
        }
      };
      const detachZmodem = zmodemTransferService.attachChannel(
        processId,
        stream,
        {
          tabId: sshConfig.tabId,
          sshConfig,
          emitTerminalText: (text) =>
            emitOutput(text, { trackBackpressure: false }),
        },
      );

      const dataHandler = (chunk) => {
        const text = decoder.write(chunk);
        if (text) emitOutput(text);
      };
      const editorModeHandler = (active) => {
        for (const id of [processId, sshConfig.tabId]) {
          const procInfo = id ? this.dependencies.childProcesses.get(id) : null;
          if (procInfo) procInfo.editorMode = active;
        }
      };
      const closeHandler = () => {
        logToFile(`SSH stream closed for processId: ${processId}`, "INFO");
        const tail = decoder.end();
        if (tail) emitOutput(tail);
        stream.removeListener("data", dataHandler);
        stream.removeListener("editorMode", editorModeHandler);
        stream.removeListener("close", closeHandler);
        detachZmodem();
        this._handleSshStreamClosed(
          processId,
          sshConfig,
          connectionInfo,
          emitOutput,
        );
      };

      stream.on("data", dataHandler);
      stream.on("editorMode", editorModeHandler);
      stream.on("close", closeHandler);
    }
    /** Common teardown when a terminal's SSH stream closes. */
    _handleSshStreamClosed(processId, sshConfig, connectionInfo, emitOutput) {
      const mainWindow = this.dependencies._getMainWindow();

      this._emitSshTabConnectionStatus(sshConfig.tabId, sshConfig, {
        isConnected: false,
        quality: "offline",
      });

      const procInfo = this.dependencies.childProcesses.get(processId);
      if (
        procInfo &&
        procInfo.ready &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        emitOutput(
          `\r\n\x1b[33m*** ${getTerminalText(sshConfig, "sshDisconnected")} ***\x1b[0m\r\n`,
        );
      }

      // 清理SFTP传输与 ZMODEM 会话
      try {
        filemanagementService.cleanupTransfersForTab(processId);
        if (sshConfig.tabId && sshConfig.tabId !== processId) {
          filemanagementService.cleanupTransfersForTab(sshConfig.tabId);
        }
      } catch (err) {
        logToFile(
          `Error cleaning up native transfers on SSH close: ${err.message}`,
          "ERROR",
        );
      }
      try {
        zmodemTransferService.destroyProcess(processId);
      } catch (err) {
        logToFile(
          `Error cleaning up ZMODEM session on SSH close: ${err.message}`,
          "ERROR",
        );
      }

      const closeReason =
        connectionInfo?.closeReason ||
        (connectionInfo?.intentionalClose ? "user" : "network");
      const shouldReleaseConnection =
        closeReason === "user" || closeReason === "system";
      if (shouldReleaseConnection) {
        // 用户/系统主动关闭时释放连接引用；网络断线路径保留以便自动重连
        this.dependencies.connectionManager.releaseSSHConnection(
          connectionInfo.key,
          sshConfig.tabId,
          {
            reason: closeReason,
            intentional: closeReason === "user",
          },
        );
        if (
          sshConfig?.tabId &&
          this.dependencies.connectionManager?.sshConnectionPool
            ?.removeTabReference
        ) {
          this.dependencies.connectionManager.sshConnectionPool.removeTabReference(
            String(sshConfig.tabId),
            {
              closeIfIdle: false,
              closeOptions: {
                reason: closeReason,
                intentional: closeReason === "user",
              },
            },
          );
        }
        this.dependencies._unbindConnectionProcess(connectionInfo?.key);
        this.dependencies._unbindConnectionProcessByProcess(
          processId,
          sshConfig?.tabId,
        );
      } else {
        logToFile(
          `SSH stream closed without intentional flag, keeping connection for auto-reconnect: ${connectionInfo.key}`,
          "DEBUG",
        );
        const processInfo = this.dependencies.childProcesses.get(processId);
        if (processInfo) {
          processInfo.stream = null;
          processInfo.ready = false;
        }
        if (sshConfig.tabId) {
          const tabProcessInfo = this.dependencies.childProcesses.get(
            sshConfig.tabId,
          );
          if (tabProcessInfo) {
            tabProcessInfo.stream = null;
            tabProcessInfo.ready = false;
          }
        }
      }

      // 仅主动关闭时清理进程映射；意外断线时保留以便自动恢复 shell
      if (shouldReleaseConnection) {
        this._destroyProcessMailbox(processId);
        this.dependencies.childProcesses.delete(processId);
        if (sshConfig.tabId)
          this.dependencies.childProcesses.delete(sshConfig.tabId);
      }
    }
    _createProcessInfo(client, connectionInfo, config, type) {
      return {
        process: client,
        connectionInfo,
        listeners: new Set(),
        config,
        type,
        ready: connectionInfo.ready,
        editorMode: false,
        commandBuffer: "",
        isRemote: true,
      };
    }
  })();
}
module.exports = createTerminalOutput;
