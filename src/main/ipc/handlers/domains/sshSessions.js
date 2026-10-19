/** SshSessions: explicit dependencies supplied by the service facade. */
function createSshSessions(
  dependencies,
  {
    isAuthErrorMessage,
    checkSshPreflight,
    DEFAULT_SSH_RETRY_CONFIG,
    classifyConnectionFailure,
    logToFile,
    getTerminalText,
    indexConnections,
    configService,
    buildReconnectWaitMessage,
    getTerminalLanguage,
    buildReconnectTimeoutMessage,
  },
) {
  return new (class SshSessions {
    constructor() {
      this.dependencies = dependencies;
    }
    _isAuthenticationError(error) {
      if (this._isAuthCancelledError(error)) {
        return false;
      }

      return (
        error?.connectionFailureKind === "auth" ||
        error?.connectionFailureKind === "private-key-permission" ||
        isAuthErrorMessage(error?.message)
      );
    }
    _isAuthCancelledError(error) {
      const rawMessage = String(error?.message || "");
      const lowerMessage = rawMessage.toLowerCase();
      return (
        lowerMessage.includes("cancelled") ||
        lowerMessage.includes("canceled") ||
        rawMessage.includes("取消")
      );
    }
    _buildSSHPreAuthReachabilityError(sshConfig, preflightResult) {
      const host = sshConfig?.host || "unknown";
      const port = sshConfig?.port || 22;
      const code = String(preflightResult?.code || "").toUpperCase();
      const message = String(preflightResult?.message || "");

      if (code === "EPROXYUNAVAILABLE") {
        return new Error(`代理不可用: 无法通过当前代理连接到 ${host}:${port}`);
      }

      if (code === "ECONNREFUSED" || message.includes("ECONNREFUSED")) {
        return new Error(`连接被拒绝: 无法连接到 ${host}:${port}`);
      }

      if (
        code === "ENOTFOUND" ||
        code === "EAI_AGAIN" ||
        message.includes("getaddrinfo")
      ) {
        return new Error(`主机不存在: 无法解析主机名 ${host}`);
      }

      if (
        code === "ETIMEDOUT" ||
        code === "ETIMEOUT" ||
        message.toLowerCase().includes("timeout")
      ) {
        return new Error(`连接超时: ${host}:${port}`);
      }

      return new Error(`服务器不可连接: ${host}:${port}`);
    }
    async _assertSSHReachableBeforeAuth(sshConfig) {
      const preflightResult = await checkSshPreflight(
        sshConfig,
        DEFAULT_SSH_RETRY_CONFIG,
      );

      if (preflightResult?.ok === true) {
        return;
      }

      const error = this._buildSSHPreAuthReachabilityError(
        sshConfig,
        preflightResult,
      );
      error.code = preflightResult?.code || "ESSHPREFLIGHT";
      error.preflightResult = preflightResult;
      error.sshConfig = {
        host: sshConfig.host,
        port: sshConfig.port || 22,
        username: sshConfig.username,
        usingProxy: Boolean(sshConfig.proxy),
        authType: sshConfig.authType || null,
        privateKeyPath: sshConfig.privateKeyPath || null,
        language: sshConfig.language || null,
      };
      error.connectionFailure = classifyConnectionFailure(error, {
        ...error.sshConfig,
        protocol: "ssh",
      });
      error.connectionFailureKind = error.connectionFailure.kind;
      error.connectionAdvice = error.connectionFailure.suggestion;
      throw error;
    }
    async startSSH(event, sshConfig) {
      const key = sshConfig?.tabId;
      if (key && this.dependencies.pendingSSHStarts.has(key))
        return this.dependencies.pendingSSHStarts.get(key);
      const pending = this.dependencies._startSSH(event, sshConfig);
      if (key) this.dependencies.pendingSSHStarts.set(key, pending);
      try {
        return await pending;
      } finally {
        if (key && this.dependencies.pendingSSHStarts.get(key) === pending)
          this.dependencies.pendingSSHStarts.delete(key);
      }
    }
    async _startSSH(event, sshConfig) {
      const processId = this.dependencies.getNextProcessId();
      const mainWindow = this.dependencies._getMainWindow();

      if (!sshConfig || !sshConfig.host) {
        logToFile("Invalid SSH configuration", "ERROR");
        throw new Error("Invalid SSH configuration");
      }

      // 最大重试次数（用于认证失败后重试）
      const maxAuthRetries = 3;
      let authRetryCount = 0;
      let finalConfig = { ...sshConfig };
      let lastAuthResult = null;

      while (authRetryCount <= maxAuthRetries) {
        let connectionConfig = null;
        let configRevision = 0;
        try {
          const needsPreAuth =
            !finalConfig.username ||
            (!finalConfig.password &&
              !finalConfig.privateKeyPath &&
              finalConfig.authType !== "privateKey" &&
              finalConfig.authType !== "agent");
          // 如果需要预先认证（第一次）或者上次认证失败需要重试
          if (needsPreAuth && authRetryCount === 0) {
            logToFile(
              `SSH connection requires authentication for ${sshConfig.host}`,
              "INFO",
            );

            await this.dependencies._assertSSHReachableBeforeAuth(finalConfig);

            const authResult =
              await this.dependencies.authentication._requestCredentialsAuth(
                finalConfig,
                {
                  existingUsername: finalConfig.username || "",
                  isRetry: false,
                },
              );

            if (authResult.cancelled) {
              throw new Error("Authentication cancelled by user");
            }

            lastAuthResult = authResult;
            finalConfig = {
              ...finalConfig,
              username: authResult.username || finalConfig.username,
              password:
                authResult.authType === "password" ? authResult.password : "",
              privateKeyPath:
                authResult.authType === "privateKey"
                  ? authResult.privateKeyPath
                  : "",
              authType:
                authResult.authType || finalConfig.authType || "password",
            };
          }

          // 尝试建立SSH连接（附加主机指纹校验）
          connectionConfig =
            this.dependencies.authentication._attachHostVerificationConfig(
              finalConfig,
            );
          configRevision = connectionConfig._connectionConfigRevision || 0;
          const connectionInfo =
            await this.dependencies.connectionManager.getSSHConnection(
              connectionConfig,
            );
          this.dependencies._broadcastTopConnections();
          const ssh = connectionInfo.client;

          this.dependencies._registerConnectionProcess(
            processId,
            ssh,
            connectionInfo,
            connectionConfig,
            "ssh2",
          );
          this.dependencies._bindConnectionProcess(
            connectionInfo.key,
            processId,
            connectionConfig.tabId,
          );

          let result;
          if (connectionInfo.ready) {
            logToFile(`复用现有SSH连接: ${connectionInfo.key}`, "INFO");

            if (mainWindow && !mainWindow.isDestroyed()) {
              this.dependencies._emitProcessOutput(
                processId,
                `\r\n*** ${getTerminalText(
                  connectionConfig,
                  "sshConnectedReused",
                  { host: connectionConfig.host },
                )} ***\r\n`,
              );
            }

            result = await this.dependencies._createSSHShell(
              ssh,
              processId,
              connectionConfig,
              connectionInfo,
            );
          } else {
            result = await this._waitForSSHReady(
              ssh,
              processId,
              connectionConfig,
              connectionInfo,
            );
          }

          if (connectionConfig.tabId) {
            this.dependencies._emitSshTabConnectionStatus(
              connectionConfig.tabId,
              connectionConfig,
            );
          }

          // 连接成功，如果用户选择了"下次自动登录"，保存凭据
          if (lastAuthResult?.autoLogin && sshConfig.id) {
            await this.dependencies.updateConnectionCredentials(
              event,
              sshConfig.id,
              {
                username: connectionConfig.username,
                password: connectionConfig.password,
                privateKeyPath: connectionConfig.privateKeyPath,
                authType: connectionConfig.authType,
              },
            );
          }

          return result;
        } catch (error) {
          if (
            error?.code === "SSH_CONFIG_CHANGED" ||
            (connectionConfig &&
              configRevision !==
                (connectionConfig._connectionConfigRevision || 0))
          ) {
            const saved = indexConnections(configService.loadConnections()).get(
              sshConfig.id,
            );
            if (!saved) throw error;
            finalConfig = { ...finalConfig, ...saved };
            authRetryCount = 0;
            continue;
          }
          logToFile(
            `SSH connection attempt ${authRetryCount + 1} failed: ${error.message}`,
            "ERROR",
          );

          // 检查是否为认证错误
          if (
            this._isAuthenticationError(error) &&
            authRetryCount < maxAuthRetries
          ) {
            authRetryCount++;
            logToFile(
              `Authentication failed, prompting user for credentials (attempt ${authRetryCount}/${maxAuthRetries})`,
              "INFO",
            );

            // 清理之前的连接尝试
            this.dependencies._destroyProcessMailbox(processId);
            this.dependencies.childProcesses.delete(processId);
            if (finalConfig.tabId)
              this.dependencies.childProcesses.delete(finalConfig.tabId);
            this.dependencies._unbindConnectionProcessByProcess(
              processId,
              finalConfig.tabId,
            );

            // 显示认证对话框让用户重新输入凭据
            try {
              const authResult =
                await this.dependencies.authentication._requestCredentialsAuth(
                  finalConfig,
                  {
                    existingUsername:
                      finalConfig.username || sshConfig.username || "",
                    isRetry: true,
                    errorMessage: error.message,
                  },
                );

              if (authResult.cancelled) {
                throw new Error("Authentication cancelled by user");
              }

              lastAuthResult = authResult;
              finalConfig = {
                ...finalConfig,
                username: authResult.username || finalConfig.username,
                password: authResult.password, // 使用新密码
                privateKeyPath:
                  authResult.authType === "privateKey"
                    ? authResult.privateKeyPath
                    : "",
                authType:
                  authResult.authType || finalConfig.authType || "password",
              };

              // 继续循环重试
              continue;
            } catch (authError) {
              if (authError?.code === "SSH_CONFIG_CHANGED") {
                const saved = indexConnections(
                  configService.loadConnections(),
                ).get(sshConfig.id);
                if (!saved) throw authError;
                finalConfig = { ...finalConfig, ...saved };
                authRetryCount = 0;
                continue;
              }
              logToFile(
                `User cancelled authentication: ${authError.message}`,
                "INFO",
              );
              throw authError;
            }
          }

          // 非认证错误或已达到最大重试次数
          throw error;
        }
      }

      throw new Error("Max authentication retries exceeded");
    }
    _createSSHShell(ssh, processId, sshConfig, connectionInfo, options = {}) {
      const { isReconnectRecovery = false } = options;
      const shellCreationKey = `${connectionInfo?.key || "unknown"}:${processId}`;

      if (this.dependencies.pendingShellCreations.has(shellCreationKey)) {
        return this.dependencies.pendingShellCreations.get(shellCreationKey);
      }

      const creationPromise = new Promise((resolve, reject) => {
        const procToUpdate = this.dependencies.childProcesses.get(processId);
        const tabProcToUpdate = sshConfig?.tabId
          ? this.dependencies.childProcesses.get(sshConfig.tabId)
          : null;
        const existingStream = procToUpdate?.stream || tabProcToUpdate?.stream;

        // 幂等保护：若已有可用 stream，避免重复创建
        if (this.dependencies._isSSHStreamUsable(existingStream)) {
          resolve(processId);
          return;
        }

        ssh.shell(
          { term: "xterm-256color", cols: 120, rows: 30 },
          (err, stream) => {
            if (err) {
              logToFile(
                `SSH shell error for processId ${processId}: ${err.message}`,
                "ERROR",
              );

              if (isReconnectRecovery) {
                return reject(err);
              }

              this.dependencies.connectionManager.releaseSSHConnection(
                connectionInfo.key,
                sshConfig.tabId,
              );
              this.dependencies._destroyProcessMailbox(processId);
              this.dependencies.childProcesses.delete(processId);
              if (sshConfig.tabId)
                this.dependencies.childProcesses.delete(sshConfig.tabId);
              this.dependencies._unbindConnectionProcess(connectionInfo?.key);
              this.dependencies._unbindConnectionProcessByProcess(
                processId,
                sshConfig?.tabId,
              );
              return reject(err);
            }

            // 更新进程信息中的 stream 与最新连接对象
            const latestProc = this.dependencies.childProcesses.get(processId);
            if (latestProc) {
              latestProc.stream = stream;
              latestProc.process = ssh;
              latestProc.connectionInfo = connectionInfo;
              latestProc.ready = true;
            }

            if (sshConfig?.tabId) {
              const latestTabProc = this.dependencies.childProcesses.get(
                sshConfig.tabId,
              );
              if (latestTabProc) {
                latestTabProc.stream = stream;
                latestTabProc.process = ssh;
                latestTabProc.connectionInfo = connectionInfo;
                latestTabProc.ready = true;
              }
            }

            this.dependencies._bindConnectionProcess(
              connectionInfo?.key,
              processId,
              sshConfig?.tabId,
            );

            if (isReconnectRecovery) {
              this.dependencies._resetProcessResizeState(processId);
              // The old shell may have disconnected inside vim/less. Return to
              // the normal buffer before any output from the replacement shell.
              // Save first so an already-normal buffer keeps its current cursor.
              this.dependencies._emitProcessOutput(
                processId,
                "\x1b7\x1b[?1049l",
              );
            }

            this.dependencies._setupStreamEventListeners(
              stream,
              processId,
              sshConfig,
              connectionInfo,
            );

            // 注册延迟检测
            const latencyHandlers = this.dependencies.getLatencyHandlers();
            if (latencyHandlers && sshConfig.tabId) {
              try {
                latencyHandlers.latencyService.registerSSHConnection(
                  sshConfig.tabId,
                  ssh,
                  sshConfig.host,
                  sshConfig.port || 22,
                  sshConfig.proxy || null,
                );
                logToFile(
                  `已为SSH连接注册延迟检测: ${sshConfig.tabId}`,
                  "DEBUG",
                );
              } catch (latencyError) {
                logToFile(`延迟检测注册失败: ${latencyError.message}`, "WARN");
              }
            }

            resolve(processId);
          },
        );
      });

      this.dependencies.pendingShellCreations.set(
        shellCreationKey,
        creationPromise,
      );
      return creationPromise.finally(() => {
        if (
          this.dependencies.pendingShellCreations.get(shellCreationKey) ===
          creationPromise
        ) {
          this.dependencies.pendingShellCreations.delete(shellCreationKey);
        }
      });
    }
    _waitForSSHReady(ssh, processId, sshConfig, connectionInfo) {
      const mainWindow = this.dependencies._getMainWindow();

      return new Promise((resolve, reject) => {
        let settled = false;
        let reconnectWaitStarted = false;
        let waitForReconnectPromise = null;
        let connectionTimeout = null;

        const connectionKey = connectionInfo?.key;
        const sshPool = this.dependencies.connectionManager?.sshConnectionPool;
        const reconnectManager = sshPool?.reconnectionManager;
        const reconnectWaitTimeoutMs = Number(
          reconnectManager?.config?.totalTimeCapMs ||
            DEFAULT_SSH_RETRY_CONFIG.totalTimeCapMs,
        );

        const getLatestClient = () => {
          const latest = sshPool?.connections?.get(connectionKey);
          return latest?.client || ssh;
        };

        const cleanup = () => {
          ssh.removeListener("ready", readyHandler);
          ssh.removeListener("error", errorHandler);
          if (connectionTimeout) {
            clearTimeout(connectionTimeout);
            connectionTimeout = null;
          }
        };

        const readyHandler = (fromReconnectManager = false) => {
          if (settled) return;
          settled = true;
          cleanup();

          const clientToUse = fromReconnectManager ? getLatestClient() : ssh;
          this.dependencies
            ._createSSHShell(clientToUse, processId, sshConfig, connectionInfo)
            .then((result) => {
              const procInfo = this.dependencies.childProcesses.get(processId);
              if (procInfo) procInfo.ready = true;
              if (sshConfig.tabId) {
                const tabProcInfo = this.dependencies.childProcesses.get(
                  sshConfig.tabId,
                );
                if (tabProcInfo) tabProcInfo.ready = true;

                this.dependencies._emitSshTabConnectionStatus(
                  sshConfig.tabId,
                  sshConfig,
                );
              }

              if (mainWindow && !mainWindow.isDestroyed()) {
                this.dependencies._emitProcessOutput(
                  processId,
                  `\r\n*** ${getTerminalText(sshConfig, "sshConnected", {
                    host: sshConfig.host,
                  })} ***\r\n`,
                );
              }

              resolve(result);
            })
            .catch((error) => {
              const procInfo = this.dependencies.childProcesses.get(processId);
              if (procInfo) procInfo.ready = false;
              if (sshConfig.tabId) {
                const tabProcInfo = this.dependencies.childProcesses.get(
                  sshConfig.tabId,
                );
                if (tabProcInfo) tabProcInfo.ready = false;

                this.dependencies._emitSshTabConnectionStatus(
                  sshConfig.tabId,
                  sshConfig,
                  {
                    isConnected: false,
                    quality: "offline",
                    error: error?.message || String(error),
                  },
                );
              }

              reject(error);
            });
        };

        const startWaitForReconnect = () => {
          if (
            reconnectWaitStarted ||
            waitForReconnectPromise ||
            !reconnectManager ||
            !connectionKey
          ) {
            return;
          }
          reconnectWaitStarted = true;

          // 给用户一次性提示：正在等待代理/VPN/网络恢复并自动重试
          try {
            if (mainWindow && !mainWindow.isDestroyed()) {
              this.dependencies._emitProcessOutput(
                processId,
                `\r\n${buildReconnectWaitMessage(
                  reconnectManager?.config || DEFAULT_SSH_RETRY_CONFIG,
                  getTerminalLanguage(sshConfig),
                )}\r\n`,
              );
            }
          } catch {
            /* intentionally ignored */
          }

          waitForReconnectPromise = reconnectManager
            .waitForReconnect(connectionKey, reconnectWaitTimeoutMs)
            .then(() => {
              // 走统一成功路径
              readyHandler(true);
            })
            .catch((e) => {
              errorHandler(e, { fromReconnectWait: true });
            })
            .finally(() => {
              waitForReconnectPromise = null;
            });
        };

        const errorHandler = (err, options = {}) => {
          const fromReconnectWait = options.fromReconnectWait === true;
          if (settled) return;

          // 已进入等待重连窗口时，旧连接错误只记录不终止流程
          if (reconnectWaitStarted && !fromReconnectWait) {
            logToFile(
              `忽略等待重连期间的旧连接错误: ${processId} - ${err?.message || err}`,
              "DEBUG",
            );
            return;
          }

          // 若已进入重连状态机，则不要立刻失败，改为等待重连结果
          if (
            !fromReconnectWait &&
            !reconnectWaitStarted &&
            reconnectManager &&
            connectionKey
          ) {
            const st = reconnectManager.getSessionStatus(connectionKey);
            if (st && (st.state === "pending" || st.state === "reconnecting")) {
              startWaitForReconnect();
              return;
            }
          }

          settled = true;
          cleanup();
          logToFile(
            `SSH connection error for processId ${processId}: ${err?.message || err}`,
            "ERROR",
          );

          this.dependencies._emitSshTabConnectionStatus(
            sshConfig.tabId,
            sshConfig,
            {
              isConnected: false,
              quality: "offline",
              error: err?.message || String(err),
            },
          );

          this.dependencies.connectionManager.releaseSSHConnection(
            connectionInfo.key,
            sshConfig.tabId,
          );
          this.dependencies._destroyProcessMailbox(processId);
          this.dependencies.childProcesses.delete(processId);
          if (sshConfig.tabId)
            this.dependencies.childProcesses.delete(sshConfig.tabId);
          this.dependencies._unbindConnectionProcess(connectionInfo?.key);
          this.dependencies._unbindConnectionProcessByProcess(
            processId,
            sshConfig?.tabId,
          );
          reject(err);
        };

        connectionTimeout = setTimeout(() => {
          if (settled) return;
          logToFile(
            `SSH connection timed out after ${reconnectWaitTimeoutMs}ms`,
            "ERROR",
          );
          if (mainWindow && !mainWindow.isDestroyed()) {
            this.dependencies._emitProcessOutput(
              processId,
              `\r\n${buildReconnectTimeoutMessage(
                reconnectManager?.config || DEFAULT_SSH_RETRY_CONFIG,
                getTerminalLanguage(sshConfig),
              )}\r\n`,
            );
          }
          errorHandler(new Error("SSH connection timeout"), {
            fromReconnectWait: true,
          });
        }, reconnectWaitTimeoutMs);

        // 注册事件监听器
        ssh.on("ready", readyHandler);
        ssh.on("error", errorHandler);

        // 若创建连接时已经进入重连状态机（比如代理端口 ECONNREFUSED），主动等待
        if (reconnectManager && connectionKey) {
          const st = reconnectManager.getSessionStatus(connectionKey);
          if (st && (st.state === "pending" || st.state === "reconnecting")) {
            startWaitForReconnect();
          }
        }
      });
    }
  })();
}
module.exports = createSshSessions;
