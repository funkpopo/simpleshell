/** ProtocolSessions: explicit dependencies supplied by the service facade. */
function createProtocolSessions(
  dependencies,
  {
    logToFile,
    getTerminalText,
    getTerminalProcessExitChannel,
    MOSH_FAILURE_PROBE_MS,
    MOSH_FAILURE_MARKERS,
    MOSH_FAILURE_EXIT_WINDOW_MS,
    MOSH_FAILURE_PROBE_MAX_BYTES,
  },
) {
  return new (class ProtocolSessions {
    constructor() {
      this.dependencies = dependencies;
    }
    _setupTelnetEventListeners(
      telnet,
      processId,
      telnetConfig,
      connectionInfo,
    ) {
      const mainWindow = this.dependencies._getMainWindow();
      const processMailbox = this.dependencies._configureProcessMailbox(
        processId,
        telnetConfig,
      );

      telnet.on("data", (data) => {
        try {
          if (processMailbox) {
            processMailbox.emitOutput(data.toString());
          } else if (mainWindow && !mainWindow.isDestroyed()) {
            this.dependencies._emitProcessOutput(processId, data.toString());
          }
        } catch (error) {
          logToFile(`Error handling Telnet data: ${error.message}`, "ERROR");
        }
      });

      telnet.on("error", (err) => {
        logToFile(
          `Telnet error for processId ${processId}: ${err.message}`,
          "ERROR",
        );

        if (mainWindow && !mainWindow.isDestroyed()) {
          this.dependencies._emitProcessOutput(
            processId,
            `\r\n*** ${getTerminalText(telnetConfig, "telnetError", {
              message: err.message,
            })} ***\r\n`,
          );
          const exitChannel = getTerminalProcessExitChannel(processId);
          if (exitChannel) {
            mainWindow.webContents.send(exitChannel, {
              code: 1,
              signal: null,
            });
          }
        }
        this.dependencies._destroyProcessMailbox(processId);

        this.dependencies.connectionManager.releaseTelnetConnection(
          connectionInfo.key,
          telnetConfig.tabId,
        );
      });

      telnet.on("end", () => {
        logToFile(`Telnet connection ended for processId ${processId}`, "INFO");

        if (mainWindow && !mainWindow.isDestroyed()) {
          this.dependencies._emitProcessOutput(
            processId,
            `\r\n*** ${getTerminalText(telnetConfig, "telnetClosed")} ***\r\n`,
          );
          const exitChannel = getTerminalProcessExitChannel(processId);
          if (exitChannel) {
            mainWindow.webContents.send(exitChannel, {
              code: 0,
              signal: null,
            });
          }
        }
        this.dependencies._destroyProcessMailbox(processId);

        this.dependencies.connectionManager.releaseTelnetConnection(
          connectionInfo.key,
          telnetConfig.tabId,
        );
      });

      telnet.on("timeout", () => {
        logToFile(
          `Telnet connection timeout for processId ${processId}`,
          "WARN",
        );

        if (mainWindow && !mainWindow.isDestroyed()) {
          this.dependencies._emitProcessOutput(
            processId,
            `\r\n*** ${getTerminalText(telnetConfig, "telnetTimeout")} ***\r\n`,
          );
        }
      });
    }
    _setupSerialEventListeners(port, processId, serialConfig, connectionInfo) {
      const mainWindow = this.dependencies._getMainWindow();
      const processMailbox = this.dependencies._configureProcessMailbox(
        processId,
        serialConfig,
      );

      port.on("data", (data) => {
        try {
          const text = Buffer.isBuffer(data) ? data.toString() : String(data);
          if (processMailbox) {
            processMailbox.emitOutput(text);
          } else if (mainWindow && !mainWindow.isDestroyed()) {
            this.dependencies._emitProcessOutput(processId, text);
          }
        } catch (error) {
          logToFile(`Error handling Serial data: ${error.message}`, "ERROR");
        }
      });

      port.on("error", (err) => {
        logToFile(
          `Serial error for processId ${processId}: ${err?.message || err}`,
          "ERROR",
        );

        if (mainWindow && !mainWindow.isDestroyed()) {
          this.dependencies._emitProcessOutput(
            processId,
            `\r\n*** ${getTerminalText(serialConfig, "serialError", {
              message: err?.message || String(err),
            })} ***\r\n`,
          );
          const exitChannel = getTerminalProcessExitChannel(processId);
          if (exitChannel) {
            mainWindow.webContents.send(exitChannel, {
              code: 1,
              signal: null,
            });
          }
        }
        this.dependencies._destroyProcessMailbox(processId);

        this.dependencies.connectionManager.releaseSerialConnection(
          connectionInfo.key,
          serialConfig.tabId,
        );
      });

      port.on("close", () => {
        logToFile(
          `Serial connection closed for processId ${processId}`,
          "INFO",
        );

        if (mainWindow && !mainWindow.isDestroyed()) {
          this.dependencies._emitProcessOutput(
            processId,
            `\r\n*** ${getTerminalText(serialConfig, "serialClosed")} ***\r\n`,
          );
          const exitChannel = getTerminalProcessExitChannel(processId);
          if (exitChannel) {
            mainWindow.webContents.send(exitChannel, {
              code: 0,
              signal: null,
            });
          }
        }
        this.dependencies._destroyProcessMailbox(processId);

        this.dependencies.connectionManager.releaseSerialConnection(
          connectionInfo.key,
          serialConfig.tabId,
        );
      });
    }
    _setupMoshEventListeners(
      ptyProcess,
      processId,
      moshConfig,
      connectionInfo,
    ) {
      const mainWindow = this.dependencies._getMainWindow();
      const processMailbox = this.dependencies._configureProcessMailbox(
        processId,
        moshConfig,
      );
      const latencyService =
        this.dependencies.getLatencyHandlers?.()?.latencyService;

      // 启动失败探测状态：仅在最初几秒/前几 KB 输出内生效，避免误伤正常会话。
      // 特征命中只是候选，需进程在窗口内非零退出才确认（消除 MOTD 误报）
      let moshProbeBuffer = "";
      let moshProbeSettled = false;
      let pendingFailureMarker = null;
      let pendingFailureTimer = null;
      const moshProbeTimer = setTimeout(() => {
        moshProbeSettled = true;
      }, MOSH_FAILURE_PROBE_MS);
      const settleMoshProbe = () => {
        if (!moshProbeSettled) {
          moshProbeSettled = true;
          clearTimeout(moshProbeTimer);
        }
      };
      const clearPendingFailure = () => {
        pendingFailureMarker = null;
        clearTimeout(pendingFailureTimer);
      };
      const emitFailureHint = () => {
        const marker = pendingFailureMarker;
        clearPendingFailure();
        logToFile(
          `Mosh startup failure detected for processId ${processId}: "${marker}"`,
          "WARN",
        );
        const hint = `\r\n*** ${getTerminalText(moshConfig, "moshFailedHint")} ***\r\n`;
        if (processMailbox) {
          processMailbox.emitOutput(hint);
        } else if (mainWindow && !mainWindow.isDestroyed()) {
          this.dependencies._emitProcessOutput(processId, hint);
        }
      };

      // 连接池可能复用同一 pty 进程（渲染层重载/重复 startMosh），
      // 注册前先移除旧监听，避免 onData/onExit 叠加导致输出重复、退出事件重复处理
      if (connectionInfo && Array.isArray(connectionInfo.ptyListeners)) {
        const staleListeners = connectionInfo.ptyListeners.splice(0);
        for (const stale of staleListeners) {
          try {
            stale?.dispose?.();
          } catch {
            // ignore
          }
        }
      }

      latencyService?.registerMoshConnection(moshConfig.tabId, connectionInfo);

      const dataListener = ptyProcess.onData((data) => {
        try {
          const text = Buffer.isBuffer(data) ? data.toString() : String(data);

          if (!moshProbeSettled) {
            moshProbeBuffer += text;
            const lowerBuffer = moshProbeBuffer.toLowerCase();
            const marker = MOSH_FAILURE_MARKERS.find((m) =>
              lowerBuffer.includes(m),
            );
            if (marker) {
              settleMoshProbe();
              // 记录候选并在确认窗口内等待非零退出，命中才提示
              pendingFailureMarker = marker;
              clearTimeout(pendingFailureTimer);
              pendingFailureTimer = setTimeout(
                clearPendingFailure,
                MOSH_FAILURE_EXIT_WINDOW_MS,
              );
            } else if (moshProbeBuffer.length > MOSH_FAILURE_PROBE_MAX_BYTES) {
              settleMoshProbe();
            }
          }

          if (processMailbox) {
            processMailbox.emitOutput(text);
          } else if (mainWindow && !mainWindow.isDestroyed()) {
            this.dependencies._emitProcessOutput(processId, text);
          }
        } catch (error) {
          logToFile(`Error handling Mosh data: ${error.message}`, "ERROR");
        }
      });

      const exitListener = ptyProcess.onExit(({ exitCode, signal }) => {
        connectionInfo.exited = true;
        connectionInfo.ready = false;
        latencyService?.updateMoshStatus(
          moshConfig.tabId,
          connectionInfo,
          "exited",
        );
        // 进程已退出，停止失败探测并清空监听引用，避免持有 dispose 句柄
        settleMoshProbe();
        // 探测窗口内特征命中 + 非零退出 → 确认启动失败，先于关闭消息提示
        if (pendingFailureMarker && (exitCode ?? 0) !== 0) {
          emitFailureHint();
        } else {
          clearPendingFailure();
        }
        if (connectionInfo && Array.isArray(connectionInfo.ptyListeners)) {
          for (const listener of connectionInfo.ptyListeners.splice(0)) {
            listener.dispose();
          }
        }

        logToFile(
          `Mosh session exited for processId ${processId} (code=${exitCode})`,
          "INFO",
        );

        if (mainWindow && !mainWindow.isDestroyed()) {
          this.dependencies._emitProcessOutput(
            processId,
            `\r\n*** ${getTerminalText(moshConfig, "moshClosed", {
              code: exitCode ?? 0,
            })} ***\r\n`,
          );
          const exitChannel = getTerminalProcessExitChannel(processId);
          if (exitChannel) {
            mainWindow.webContents.send(exitChannel, {
              code: exitCode ?? 0,
              signal: signal || null,
            });
          }
        }
        this.dependencies._destroyProcessMailbox(processId);

        this.dependencies.connectionManager.releaseMoshConnection(
          connectionInfo.key,
          moshConfig.tabId,
        );
      });

      // 保存监听句柄，供连接复用/退出时清理
      if (connectionInfo) {
        if (!Array.isArray(connectionInfo.ptyListeners)) {
          connectionInfo.ptyListeners = [];
        }
        connectionInfo.ptyListeners.push(dataListener, exitListener, {
          dispose() {
            clearTimeout(moshProbeTimer);
            clearTimeout(pendingFailureTimer);
            if (!connectionInfo.exited) {
              latencyService?.unregisterConnection(
                moshConfig.tabId,
                connectionInfo,
              );
            }
          },
        });
      }
    }
    async startTelnet(event, telnetConfig) {
      const processId = this.dependencies.getNextProcessId();
      const mainWindow = this.dependencies._getMainWindow();

      if (!telnetConfig || !telnetConfig.host) {
        logToFile("Invalid Telnet configuration", "ERROR");
        throw new Error("Invalid Telnet configuration");
      }

      try {
        const connectionInfo =
          await this.dependencies.connectionManager.getTelnetConnection(
            telnetConfig,
          );
        this.dependencies._broadcastTopConnections();
        const telnet = connectionInfo.client;

        this.dependencies._registerConnectionProcess(
          processId,
          telnet,
          connectionInfo,
          telnetConfig,
          "telnet",
        );

        if (connectionInfo.ready) {
          logToFile(`复用现有Telnet连接: ${connectionInfo.key}`, "INFO");

          if (mainWindow && !mainWindow.isDestroyed()) {
            this.dependencies._emitProcessOutput(
              processId,
              `\r\n*** ${getTerminalText(
                telnetConfig,
                "telnetConnectedReused",
                {
                  host: telnetConfig.host,
                },
              )} ***\r\n`,
            );
          }

          this._setupTelnetEventListeners(
            telnet,
            processId,
            telnetConfig,
            connectionInfo,
          );
          return processId;
        } else {
          logToFile(`Telnet连接未就绪`, "ERROR");
          throw new Error("Telnet connection not ready");
        }
      } catch (error) {
        logToFile(
          `Failed to start Telnet connection: ${error.message}`,
          "ERROR",
        );
        throw error;
      }
    }
    async listSerialPorts() {
      try {
        const { SerialPort } = require("serialport");
        const ports = await SerialPort.list();
        return {
          success: true,
          data: ports.map((port) => ({
            path: port.path,
            friendlyName: port.friendlyName || port.friendly_name || port.path,
            manufacturer: port.manufacturer || "",
            serialNumber: port.serialNumber || "",
            vendorId: port.vendorId || "",
            productId: port.productId || "",
          })),
        };
      } catch (error) {
        logToFile(`Failed to list serial ports: ${error.message}`, "ERROR");
        return { success: false, error: error.message, data: [] };
      }
    }
    async startSerial(event, serialConfig) {
      const processId = this.dependencies.getNextProcessId();
      const mainWindow = this.dependencies._getMainWindow();

      const portPath = String(
        serialConfig?.path || serialConfig?.host || "",
      ).trim();
      if (!serialConfig || !portPath) {
        logToFile("Invalid Serial configuration", "ERROR");
        throw new Error("Invalid Serial configuration");
      }

      try {
        const connectionInfo =
          await this.dependencies.connectionManager.getSerialConnection({
            ...serialConfig,
            path: portPath,
          });
        this.dependencies._broadcastTopConnections();
        const port = connectionInfo.client;

        this.dependencies._registerConnectionProcess(
          processId,
          port,
          connectionInfo,
          connectionInfo.config,
          "serial",
        );

        if (connectionInfo.ready) {
          logToFile(`串口连接就绪: ${connectionInfo.key}`, "INFO");

          if (mainWindow && !mainWindow.isDestroyed()) {
            this.dependencies._emitProcessOutput(
              processId,
              `\r\n*** ${getTerminalText(
                connectionInfo.config,
                "serialOpened",
                {
                  path: portPath,
                  baudRate: connectionInfo.config.baudRate,
                },
              )} ***\r\n`,
            );
          }

          this._setupSerialEventListeners(
            port,
            processId,
            connectionInfo.config,
            connectionInfo,
          );
          return processId;
        } else {
          logToFile(`串口连接未就绪`, "ERROR");
          throw new Error("Serial connection not ready");
        }
      } catch (error) {
        logToFile(
          `Failed to start Serial connection: ${error.message}`,
          "ERROR",
        );
        throw error;
      }
    }
    async startMosh(event, moshConfig) {
      const processId = this.dependencies.getNextProcessId();
      const mainWindow = this.dependencies._getMainWindow();

      const host = String(moshConfig?.host || "").trim();
      if (!moshConfig || !host) {
        logToFile("Invalid Mosh configuration", "ERROR");
        throw new Error("Invalid Mosh configuration");
      }

      try {
        const connectionInfo =
          await this.dependencies.connectionManager.getMoshConnection({
            ...moshConfig,
            host,
          });
        this.dependencies._broadcastTopConnections();
        const ptyProcess = connectionInfo.client;

        this.dependencies._registerConnectionProcess(
          processId,
          ptyProcess,
          connectionInfo,
          connectionInfo.config,
          "mosh",
        );

        if (connectionInfo.ready) {
          logToFile(`Mosh会话就绪: ${connectionInfo.key}`, "INFO");

          if (mainWindow && !mainWindow.isDestroyed()) {
            this.dependencies._emitProcessOutput(
              processId,
              `\r\n*** ${getTerminalText(connectionInfo.config, "moshStarted", {
                host,
                port: connectionInfo.config.port,
              })} ***\r\n`,
            );
          }

          this._setupMoshEventListeners(
            ptyProcess,
            processId,
            connectionInfo.config,
            connectionInfo,
          );
          return processId;
        } else {
          logToFile(`Mosh会话未就绪`, "ERROR");
          throw new Error("Mosh session not ready");
        }
      } catch (error) {
        logToFile(`Failed to start Mosh session: ${error.message}`, "ERROR");
        throw error;
      }
    }
  })();
}
module.exports = createProtocolSessions;
