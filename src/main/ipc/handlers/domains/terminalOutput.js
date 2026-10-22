/** TerminalOutput: explicit dependencies supplied by the service facade. */
function createTerminalOutput(
  dependencies,
  {
    getTerminalProcessOutputChannel,
    IPC_EVENT_CHANNELS,
    getTerminalText,
    StringDecoder,
    createOscSafeOutputTransform,
    outputProcessor,
    logToFile,
    zmodemTransferService,
    filemanagementService,
  },
) {
  return new (class TerminalOutput {
    constructor() {
      this.dependencies = dependencies;
      this._flowControlTargets = new WeakMap();
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

      const target =
        procInfo?.stream || tabProcInfo?.stream || procInfo?.process || null;
      if (
        !target?.stderr ||
        typeof target.stderr.pause !== "function" ||
        typeof target.stderr.resume !== "function"
      )
        return target;

      // ssh2 gives stderr its own Readable. Both readers share the channel's
      // SSH window, so apply terminal backpressure to both together.
      if (!this._flowControlTargets.has(target)) {
        this._flowControlTargets.set(target, {
          pause: () => {
            target.pause();
            target.stderr.pause();
          },
          resume: () => {
            target.resume();
            target.stderr.resume();
          },
        });
      }
      return this._flowControlTargets.get(target);
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
    _configureProcessMailbox(processId, config = {}) {
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
        },
      );
    }
    _setupStreamEventListeners(stream, processId, sshConfig, connectionInfo) {
      let buffer = Buffer.alloc(0);
      const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB 缓冲区上限
      const OUTPUT_PROFILE = {
        flushIntervalMs: 8,
        flushThresholdBytes: 16 * 1024,
      };
      let flushTimer = null;
      let droppedBytes = 0;
      const stdoutDecoder = new StringDecoder("utf8");
      const transformOutput = createOscSafeOutputTransform((output) =>
        outputProcessor.processTerminalOutput(processId, output),
      );
      const stderrDecoder = new StringDecoder("utf8");
      const processMailbox = this._configureProcessMailbox(
        processId,
        sshConfig,
      );

      const getOutputProfile = () => OUTPUT_PROFILE;

      const emitOutput = (payload, options = {}) => {
        if (processMailbox) {
          processMailbox.emitOutput(payload, options);
          return;
        }

        this._emitProcessOutput(processId, payload);
      };

      // ZMODEM 会话期间向终端注入状态提示（不参与背压统计）
      const emitZmodemTerminalText = (text) => {
        emitOutput(text, { trackBackpressure: false });
      };

      // ZMODEM native 后端：sidecar 透传字节回到同一解码/输出缓冲管线（P3.5），
      // 并经独立 "zmodem" 暂停原因接入统一流控（P3.6）
      const appendRawZmodemBytes = (rawChunk) => {
        buffer = Buffer.concat([buffer, rawChunk]);
        this._setProcessBufferedBytes(processId, bufferedBytesTotal());
        scheduleFlush();
      };
      const setZmodemPaused = (paused) => {
        if (!this.dependencies.terminalIOMailboxManager) {
          return;
        }
        try {
          if (paused) {
            this.dependencies.terminalIOMailboxManager.pause(
              processId,
              "zmodem",
            );
          } else {
            this.dependencies.terminalIOMailboxManager.resume(
              processId,
              "zmodem",
            );
          }
        } catch (error) {
          logToFile(
            `ZMODEM backpressure update failed: ${error.message}`,
            "WARN",
          );
        }
      };

      // sidecar 未决字节（输入队列 + writeRemote 队列）计入缓冲统计
      const bufferedBytesTotal = () =>
        buffer.length + (zmodemTransferService.getHeldBytes?.(processId) || 0);

      // ZMODEM 检测上下文：原始字节先经 zmodemTransferService 过滤，
      // 会话活跃时协议字节被拦截，仅透传非 ZMODEM 字节
      const feedZmodem = (chunk) =>
        zmodemTransferService.feedOutput(processId, chunk, {
          stream,
          tabId: sshConfig.tabId,
          sshConfig,
          emitTerminalText: emitZmodemTerminalText,
          onRawOutput: appendRawZmodemBytes,
          onBackpressure: setZmodemPaused,
        });

      const emitDroppedBytesWarning = () => {
        if (!droppedBytes) {
          return;
        }

        const dropped = droppedBytes;
        droppedBytes = 0;
        emitOutput(
          `\r\n\x1b[33m*** ${getTerminalText(sshConfig, "droppedBytesWarning", {
            dropped,
          })} ***\x1b[0m\r\n`,
          { trackBackpressure: false },
        );
      };

      const flushBufferedOutput = ({ flushDecoderRemainder = false } = {}) => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }

        if (!buffer.length && !droppedBytes && !flushDecoderRemainder) {
          return;
        }

        const pendingBuffer = buffer;
        buffer = Buffer.alloc(0);

        try {
          let output = "";

          if (pendingBuffer.length) {
            output += stdoutDecoder.write(pendingBuffer);
          }
          if (flushDecoderRemainder) {
            output += stdoutDecoder.end();
          }

          emitDroppedBytesWarning();

          if (!output && !flushDecoderRemainder) {
            this._setProcessBufferedBytes(processId, bufferedBytesTotal());
            return;
          }

          const processedOutput = transformOutput(
            output,
            flushDecoderRemainder,
          );
          if (processedOutput) {
            emitOutput(processedOutput);
          }
        } catch (error) {
          logToFile(
            `Failed to process buffered output: ${error.message}`,
            "ERROR",
          );
        } finally {
          this._setProcessBufferedBytes(processId, bufferedBytesTotal());
        }
      };

      const scheduleFlush = () => {
        if (flushTimer) {
          return;
        }
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushBufferedOutput();
        }, getOutputProfile().flushIntervalMs);
      };

      const dataHandler = (data) => {
        try {
          let chunk = feedZmodem(
            Buffer.isBuffer(data) ? data : Buffer.from(data),
          );
          if (!chunk || !chunk.length) {
            // ZMODEM 会话拦截了全部字节，无终端输出
            this._setProcessBufferedBytes(processId, bufferedBytesTotal());
            return;
          }
          const totalLength = buffer.length + chunk.length;

          // 溢出时保留最近数据（环形缓冲思想），并累计丢弃字节用于可观测告警
          if (totalLength > MAX_BUFFER_SIZE) {
            let bytesToDrop = totalLength - MAX_BUFFER_SIZE;
            const droppedThisRound = bytesToDrop;
            droppedBytes += droppedThisRound;

            if (bytesToDrop >= buffer.length) {
              bytesToDrop -= buffer.length;
              buffer = Buffer.alloc(0);

              if (bytesToDrop >= chunk.length) {
                chunk = Buffer.alloc(0);
              } else if (bytesToDrop > 0) {
                chunk = chunk.slice(bytesToDrop);
              }
            } else if (bytesToDrop > 0) {
              buffer = buffer.slice(bytesToDrop);
            }

            logToFile(
              `Buffer overflow for processId ${processId}, dropped ${droppedThisRound} bytes`,
              "WARN",
            );
          }

          if (chunk.length === 0) {
            scheduleFlush();
            this._setProcessBufferedBytes(processId, bufferedBytesTotal());
            return;
          }

          if (buffer.length === 0) {
            // fast path：避免空缓冲区时的 Buffer.concat 拷贝
            buffer = chunk;
          } else {
            buffer = Buffer.concat(
              [buffer, chunk],
              buffer.length + chunk.length,
            );
          }

          // 达到阈值时立即 flush，其他情况用短时间窗口微批处理
          if (buffer.length >= getOutputProfile().flushThresholdBytes) {
            flushBufferedOutput();
          } else {
            scheduleFlush();
          }

          this._setProcessBufferedBytes(processId, bufferedBytesTotal());
        } catch (error) {
          logToFile(`Error handling stream data: ${error.message}`, "ERROR");
          buffer = Buffer.alloc(0); // 错误时清理缓冲区
          this._setProcessBufferedBytes(processId, 0);
        }
      };

      const extendedDataHandler = (typeOrData, maybeData) => {
        try {
          // 保证 stderr 信息顺序，先刷掉 stdout 缓冲
          flushBufferedOutput();

          const rawChunk =
            maybeData !== undefined && maybeData !== null
              ? maybeData
              : typeOrData;
          if (rawChunk === undefined || rawChunk === null) {
            return;
          }
          if (!Buffer.isBuffer(rawChunk) && typeof rawChunk !== "string") {
            return;
          }

          const stderrChunk = Buffer.isBuffer(rawChunk)
            ? rawChunk
            : Buffer.from(rawChunk);
          const stderrOutput = stderrDecoder.write(stderrChunk);
          if (stderrOutput) {
            emitOutput(`\x1b[31m${stderrOutput}\x1b[0m`);
          }
        } catch (error) {
          logToFile(`Error handling extended data: ${error.message}`, "ERROR");
        }
      };

      const closeHandler = () => {
        logToFile(`SSH stream closed for processId: ${processId}`, "INFO");

        flushBufferedOutput({ flushDecoderRemainder: true });
        const stderrTail = stderrDecoder.end();
        if (stderrTail) {
          emitOutput(`\x1b[31m${stderrTail}\x1b[0m`);
        }

        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        this._setProcessBufferedBytes(processId, 0);

        // 清理事件监听器，防止内存泄漏
        stream.removeListener("data", dataHandler);
        stream.removeListener("extended data", extendedDataHandler);
        stream.stderr?.removeListener?.("data", extendedDataHandler);
        stream.removeListener("close", closeHandler);

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
      };

      // 注册事件监听器
      stream.on("data", dataHandler);
      if (stream.stderr && typeof stream.stderr.on === "function") {
        stream.stderr.on("data", extendedDataHandler);
      } else {
        stream.on("extended data", extendedDataHandler);
      }
      stream.on("close", closeHandler);
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
        lastOutputLines: [],
        outputBuffer: "",
        isRemote: true,
      };
    }
  })();
}
module.exports = createTerminalOutput;
