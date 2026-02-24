const { BrowserWindow } = require("electron");
const { StringDecoder } = require("string_decoder");
const { logToFile } = require("../../utils/logger");
const terminalManager = require("../../../modules/terminal");
const crypto = require("crypto");
const configService = require("../../../services/configService");

/**
 * SSH/Telnet连接相关的IPC处理器
 * 这是一个高风险模块，涉及多个全局状态的管理
 */
class SSHHandlers {
  /**
   * @param {Object} dependencies - 依赖注入
   * @param {Map} dependencies.childProcesses - 子进程映射
   * @param {Object} dependencies.connectionManager - 连接管理器
   * @param {Object} dependencies.sftpCore - SFTP核心模块
   * @param {Object} dependencies.sftpTransfer - SFTP传输模块
   * @param {Function} dependencies.getNextProcessId - 获取下一个进程ID的函数
   * @param {Function} dependencies.getLatencyHandlers - 获取延迟处理器的函数
   */
  constructor(dependencies) {
    this.childProcesses = dependencies.childProcesses;
    this.connectionManager = dependencies.connectionManager;
    this.sftpCore = dependencies.sftpCore;
    this.sftpTransfer = dependencies.sftpTransfer;
    this.getNextProcessId = dependencies.getNextProcessId;
    this.getLatencyHandlers = dependencies.getLatencyHandlers;

    // 待处理的认证请求
    this.pendingAuthRequests = new Map();

    // 已知主机指纹缓存 (host:port -> fingerprint)
    this.knownHostsCache = new Map();
    this.knownHostsLoaded = false;
    this.pendingHostVerifications = new Map();
    this.sessionTrustedHosts = new Map();
  }

  getHandlers() {
    return [
      {
        channel: "terminal:startSSH",
        category: "terminal",
        handler: this.startSSH.bind(this),
      },
      {
        channel: "terminal:startTelnet",
        category: "terminal",
        handler: this.startTelnet.bind(this),
      },
      {
        channel: "ssh:auth-response",
        category: "terminal",
        handler: this.handleAuthResponse.bind(this),
      },
      {
        channel: "terminal:updateConnectionCredentials",
        category: "terminal",
        handler: this.updateConnectionCredentials.bind(this),
      },
    ];
  }

  /**
   * 处理认证响应
   */
  async handleAuthResponse(event, response) {
    const { requestId, ...authData } = response;

    if (!requestId || !this.pendingAuthRequests.has(requestId)) {
      logToFile(`Invalid auth response: requestId=${requestId}`, "WARN");
      return { success: false, error: "Invalid request ID" };
    }

    const pendingRequest = this.pendingAuthRequests.get(requestId);
    this.pendingAuthRequests.delete(requestId);

    if (authData.cancelled) {
      pendingRequest.reject(new Error("Authentication cancelled by user"));
      return { success: false, cancelled: true };
    }

    pendingRequest.resolve(authData);
    return { success: true };
  }

  /**
   * 更新连接凭据（用于保存自动登录信息）
   */
  async updateConnectionCredentials(event, connectionId, credentials) {
    try {
      if (!connectionId || !credentials) {
        return { success: false, error: "Invalid parameters" };
      }

      // 加载现有连接配置
      const connections = configService.loadConnections();

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

      if (updated) {
        configService.saveConnections(connections);
        logToFile(
          `Updated credentials for connection: ${connectionId}`,
          "INFO",
        );

        // 通知前端连接配置已更改
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (win && !win.isDestroyed() && win.webContents) {
            win.webContents.send("connections-changed");
          }
        }

        return { success: true };
      } else {
        return { success: false, error: "Connection not found" };
      }
    } catch (error) {
      logToFile(
        `Failed to update connection credentials: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  }

  /**
   * 计算主机密钥指纹（fallback）
   */
  _computeFingerprint(key) {
    try {
      const hash = crypto.createHash("sha1");
      hash.update(key);
      const fingerprint = hash.digest("hex");
      // 格式化为 xx:xx:xx:xx... 形式
      return fingerprint.match(/.{2}/g).join(":");
    } catch (error) {
      logToFile(`Failed to compute fingerprint: ${error.message}`, "ERROR");
      return null;
    }
  }

  /**
   * 获取主机缓存键
   */
  _getHostCacheKey(host, port) {
    return `${host}:${port || 22}`;
  }

  /**
   * 规范化主机指纹
   */
  _normalizeFingerprint(fingerprint) {
    if (typeof fingerprint !== "string") {
      return null;
    }

    const trimmed = fingerprint.trim();
    if (!trimmed) {
      return null;
    }

    if (trimmed.toUpperCase().startsWith("SHA256:")) {
      return `SHA256:${trimmed.slice(7)}`;
    }

    return `SHA256:${trimmed}`;
  }

  /**
   * 从配置中加载已知主机指纹
   */
  _ensureKnownHostsLoaded() {
    if (this.knownHostsLoaded) {
      return;
    }

    this.knownHostsLoaded = true;
    this.knownHostsCache.clear();

    try {
      const storedHosts = configService.get("sshKnownHosts");
      if (!storedHosts || typeof storedHosts !== "object") {
        return;
      }

      Object.entries(storedHosts).forEach(([hostKey, entry]) => {
        const fingerprint =
          typeof entry === "string" ? entry : entry?.fingerprint;
        const normalizedFingerprint = this._normalizeFingerprint(fingerprint);
        if (!normalizedFingerprint) {
          return;
        }

        this.knownHostsCache.set(hostKey, {
          fingerprint: normalizedFingerprint,
          updatedAt:
            typeof entry === "object" && entry?.updatedAt
              ? entry.updatedAt
              : new Date().toISOString(),
        });
      });
    } catch (error) {
      logToFile(`Failed to load known SSH hosts: ${error.message}`, "WARN");
    }
  }

  /**
   * 持久化已知主机指纹到配置文件
   */
  _persistKnownHosts() {
    try {
      const serializedHosts = {};
      for (const [hostKey, entry] of this.knownHostsCache.entries()) {
        serializedHosts[hostKey] = {
          fingerprint: entry.fingerprint,
          updatedAt: entry.updatedAt || new Date().toISOString(),
        };
      }

      const saved = configService.set("sshKnownHosts", serializedHosts);
      if (!saved) {
        logToFile("Failed to persist known SSH hosts", "WARN");
      }
    } catch (error) {
      logToFile(`Failed to persist known SSH hosts: ${error.message}`, "WARN");
    }
  }

  /**
   * 检查主机密钥是否已知且匹配
   */
  _checkHostKey(host, port, fingerprint) {
    this._ensureKnownHostsLoaded();
    const hostKey = this._getHostCacheKey(host, port);
    const normalizedFingerprint = this._normalizeFingerprint(fingerprint);
    if (!normalizedFingerprint) {
      return { known: false, changed: false };
    }

    const sessionEntry = this.sessionTrustedHosts.get(hostKey);
    const sessionFingerprint =
      typeof sessionEntry === "string"
        ? sessionEntry
        : sessionEntry?.fingerprint;

    if (sessionFingerprint) {
      if (sessionFingerprint === normalizedFingerprint) {
        return { known: true, changed: false, trustScope: "session" };
      }

      return {
        known: true,
        changed: true,
        previousFingerprint: sessionFingerprint,
        trustScope: "session",
      };
    }

    const knownEntry = this.knownHostsCache.get(hostKey);
    const knownFingerprint =
      typeof knownEntry === "string" ? knownEntry : knownEntry?.fingerprint;

    if (!knownFingerprint) {
      return { known: false, changed: false };
    }

    if (knownFingerprint !== normalizedFingerprint) {
      return {
        known: true,
        changed: true,
        previousFingerprint: knownFingerprint,
        trustScope: "permanent",
      };
    }

    return { known: true, changed: false, trustScope: "permanent" };
  }

  /**
   * 保存主机密钥
   */
  _saveHostKey(host, port, fingerprint, options = {}) {
    this._ensureKnownHostsLoaded();
    const hostKey = this._getHostCacheKey(host, port);
    const normalizedFingerprint = this._normalizeFingerprint(fingerprint);
    if (!normalizedFingerprint) {
      return;
    }

    const shouldPersist = options.persist !== false;

    this.sessionTrustedHosts.set(hostKey, {
      fingerprint: normalizedFingerprint,
      updatedAt: new Date().toISOString(),
      scope: shouldPersist ? "permanent" : "session",
    });

    if (!shouldPersist) {
      return;
    }

    this.knownHostsCache.set(hostKey, {
      fingerprint: normalizedFingerprint,
      updatedAt: new Date().toISOString(),
    });
    this._persistKnownHosts();
  }

  /**
   * 请求用户认证（发送请求到渲染进程并等待响应）
   */
  async _requestUserAuth(tabId, authData) {
    const mainWindow = this._getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("No main window available for authentication");
    }

    const requestId = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return new Promise((resolve, reject) => {
      // 设置超时（5分钟）
      const timeout = setTimeout(
        () => {
          if (this.pendingAuthRequests.has(requestId)) {
            this.pendingAuthRequests.delete(requestId);
            reject(new Error("Authentication timeout"));
          }
        },
        5 * 60 * 1000,
      );

      // 存储待处理请求
      this.pendingAuthRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        tabId,
        authData,
      });

      // 发送认证请求到渲染进程
      mainWindow.webContents.send("ssh:auth-request", {
        requestId,
        tabId,
        ...authData,
      });

      logToFile(`Sent auth request: ${requestId} for tab ${tabId}`, "INFO");
    });
  }

  /**
   * 请求用户确认主机指纹
   */
  async _requestHostFingerprintApproval(sshConfig, fingerprint) {
    const host = sshConfig.host;
    const port = sshConfig.port || 22;
    const normalizedFingerprint = this._normalizeFingerprint(fingerprint);
    if (!normalizedFingerprint) {
      return false;
    }

    const hostKeyStatus = this._checkHostKey(host, port, normalizedFingerprint);
    if (hostKeyStatus.known && !hostKeyStatus.changed) {
      return true;
    }
    const isFirstConnection = !hostKeyStatus.known;

    const pendingKey = `${host}:${port}:${normalizedFingerprint}`;
    if (this.pendingHostVerifications.has(pendingKey)) {
      return this.pendingHostVerifications.get(pendingKey);
    }

    const verificationPromise = (async () => {
      const authResult = await this._requestUserAuth(sshConfig.tabId, {
        step: "hostVerify",
        host,
        port,
        serverVersion: null,
        fingerprint: normalizedFingerprint,
        previousFingerprint: hostKeyStatus.previousFingerprint || null,
        fingerprintChanged: hostKeyStatus.changed,
        isFirstConnection,
        requireCredentials: false,
        connectionId: sshConfig.id,
        username: sshConfig.username || "",
        existingUsername: sshConfig.username || "",
        isRetry: false,
      });

      if (!authResult || authResult.cancelled || !authResult.acceptHostKey) {
        return false;
      }

      const hostTrustMode =
        authResult.hostTrustMode === "session" ? "session" : "permanent";
      this._saveHostKey(host, port, normalizedFingerprint, {
        persist: hostTrustMode === "permanent",
      });
      return true;
    })();

    this.pendingHostVerifications.set(pendingKey, verificationPromise);

    try {
      return await verificationPromise;
    } finally {
      this.pendingHostVerifications.delete(pendingKey);
    }
  }

  /**
   * 创建 ssh2 hostVerifier 回调
   */
  _createHostVerifier(sshConfig) {
    return (fingerprint, callback) => {
      if (typeof callback !== "function") {
        return false;
      }

      void this._requestHostFingerprintApproval(sshConfig, fingerprint)
        .then((approved) => {
          callback(Boolean(approved));
        })
        .catch((error) => {
          logToFile(
            `Host fingerprint verification failed: ${error.message}`,
            "WARN",
          );
          callback(false);
        });
      return undefined;
    };
  }

  /**
   * 为 SSH 配置附加主机指纹校验能力
   */
  _attachHostVerificationConfig(sshConfig) {
    return {
      ...sshConfig,
      hostHash: "sha256",
      hostVerifier: this._createHostVerifier(sshConfig),
    };
  }

  _getMainWindow() {
    const windows = BrowserWindow.getAllWindows();
    if (!windows || windows.length === 0) return null;
    const mainWindow = windows[0];
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    return mainWindow;
  }

  _broadcastTopConnections() {
    try {
      const lastConnections = this.connectionManager.getLastConnections(5);
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send("top-connections-changed", lastConnections);
        }
      }
    } catch {
      // ignore broadcast errors
    }
  }

  _setupStreamEventListeners(stream, processId, sshConfig, connectionInfo) {
    let buffer = Buffer.alloc(0);
    const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB 缓冲区上限
    const FLUSH_INTERVAL_MS = 24; // 约 1~2 帧内合并，控制在 <50ms 延迟
    const FLUSH_THRESHOLD_BYTES = 64 * 1024;
    const BACKPRESSURE_PAUSE_THRESHOLD = 1024 * 1024;
    const BACKPRESSURE_RESUME_THRESHOLD = Math.floor(
      BACKPRESSURE_PAUSE_THRESHOLD / 2,
    );
    const BACKPRESSURE_RECOVERY_INTERVAL_MS = 100;

    let isPaused = false;
    let flushTimer = null;
    let backpressureRecoveryTimer = null;
    let pendingAckBytes = 0;
    let droppedBytes = 0;
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");

    const getPayloadByteLength = (payload) => {
      if (Buffer.isBuffer(payload)) {
        return payload.length;
      }
      if (typeof payload === "string") {
        return Buffer.byteLength(payload, "utf8");
      }
      return 0;
    };

    const clearBackpressureRecoveryTimer = () => {
      if (backpressureRecoveryTimer) {
        clearTimeout(backpressureRecoveryTimer);
        backpressureRecoveryTimer = null;
      }
    };

    const updateBackpressure = () => {
      if (stream.destroyed) {
        clearBackpressureRecoveryTimer();
        return;
      }

      const totalPendingBytes = pendingAckBytes + buffer.length;

      if (!isPaused && totalPendingBytes >= BACKPRESSURE_PAUSE_THRESHOLD) {
        stream.pause();
        isPaused = true;
        logToFile(
          `Stream paused for processId ${processId}: pendingAck=${pendingAckBytes}, buffer=${buffer.length}`,
          "DEBUG",
        );
      } else if (
        isPaused &&
        totalPendingBytes <= BACKPRESSURE_RESUME_THRESHOLD
      ) {
        stream.resume();
        isPaused = false;
        logToFile(
          `Stream resumed for processId ${processId}: pendingAck=${pendingAckBytes}, buffer=${buffer.length}`,
          "DEBUG",
        );
      }

      if (isPaused) {
        if (!backpressureRecoveryTimer) {
          backpressureRecoveryTimer = setTimeout(() => {
            backpressureRecoveryTimer = null;
            updateBackpressure();
          }, BACKPRESSURE_RECOVERY_INTERVAL_MS);
        }
      } else {
        clearBackpressureRecoveryTimer();
      }
    };

    const outputAckHandler = (bytes) => {
      const ackBytes = Math.floor(Number(bytes));
      if (!Number.isFinite(ackBytes) || ackBytes <= 0) {
        return;
      }

      pendingAckBytes = Math.max(0, pendingAckBytes - ackBytes);
      updateBackpressure();
    };

    const bindOutputAckHandlers = () => {
      const processIds = [processId];
      if (sshConfig.tabId && sshConfig.tabId !== processId) {
        processIds.push(sshConfig.tabId);
      }

      processIds.forEach((id) => {
        const procInfo = this.childProcesses.get(id);
        if (procInfo) {
          procInfo.outputAckHandler = outputAckHandler;
        }
      });
    };

    const unbindOutputAckHandlers = () => {
      const processIds = [processId];
      if (sshConfig.tabId && sshConfig.tabId !== processId) {
        processIds.push(sshConfig.tabId);
      }

      processIds.forEach((id) => {
        const procInfo = this.childProcesses.get(id);
        if (procInfo && procInfo.outputAckHandler === outputAckHandler) {
          delete procInfo.outputAckHandler;
        }
      });
    };

    bindOutputAckHandlers();

    const emitOutput = (payload, options = {}) => {
      const { trackBackpressure = true } = options;
      const mainWindow = this._getMainWindow();
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send(`process:output:${processId}`, payload);

      if (trackBackpressure) {
        const payloadBytes = getPayloadByteLength(payload);
        if (payloadBytes > 0) {
          pendingAckBytes += payloadBytes;
          updateBackpressure();
        }
      }
    };

    const emitDroppedBytesWarning = () => {
      if (!droppedBytes) {
        return;
      }

      const dropped = droppedBytes;
      droppedBytes = 0;
      emitOutput(
        `\r\n\x1b[33m*** 输出过快，已丢弃 ${dropped} 字节（请适当降低输出速率） ***\x1b[0m\r\n`,
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

        if (!output) {
          updateBackpressure();
          return;
        }

        const processedOutput = terminalManager.processOutput(
          processId,
          output,
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
        updateBackpressure();
      }
    };

    const scheduleFlush = () => {
      if (flushTimer) {
        return;
      }
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushBufferedOutput();
      }, FLUSH_INTERVAL_MS);
    };

    const dataHandler = (data) => {
      try {
        let chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
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
          updateBackpressure();
          return;
        }

        if (buffer.length === 0) {
          // fast path：避免空缓冲区时的 Buffer.concat 拷贝
          buffer = chunk;
        } else {
          buffer = Buffer.concat([buffer, chunk], buffer.length + chunk.length);
        }

        // 达到阈值时立即 flush，其他情况用短时间窗口微批处理
        if (buffer.length >= FLUSH_THRESHOLD_BYTES) {
          flushBufferedOutput();
        } else {
          scheduleFlush();
        }

        updateBackpressure();
      } catch (error) {
        logToFile(`Error handling stream data: ${error.message}`, "ERROR");
        buffer = Buffer.alloc(0); // 错误时清理缓冲区
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
      clearBackpressureRecoveryTimer();
      unbindOutputAckHandlers();

      // 清理事件监听器，防止内存泄漏
      stream.removeListener("data", dataHandler);
      stream.removeListener("extended data", extendedDataHandler);
      stream.removeListener("close", closeHandler);

      const mainWindow = this._getMainWindow();

      if (sshConfig.tabId && mainWindow && !mainWindow.isDestroyed()) {
        const connectionStatus = {
          isConnected: false,
          isConnecting: false,
          quality: "offline",
          lastUpdate: Date.now(),
          connectionType: "SSH",
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
        };
        mainWindow.webContents.send("tab-connection-status", {
          tabId: sshConfig.tabId,
          connectionStatus,
        });
      }

      const procInfo = this.childProcesses.get(processId);
      if (
        procInfo &&
        procInfo.ready &&
        mainWindow &&
        !mainWindow.isDestroyed()
      ) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n\x1b[33m*** SSH连接已断开 ***\x1b[0m\r\n`,
        );
      }

      // 清理SFTP传输
      if (this.sftpTransfer?.cleanupActiveTransfersForTab) {
        this.sftpTransfer
          .cleanupActiveTransfersForTab(processId)
          .catch((err) => {
            logToFile(
              `Error cleaning up SFTP transfers: ${err.message}`,
              "ERROR",
            );
          });
        if (sshConfig.tabId && sshConfig.tabId !== processId) {
          this.sftpTransfer
            .cleanupActiveTransfersForTab(sshConfig.tabId)
            .catch((err) => {
              logToFile(
                `Error cleaning up SFTP transfers for tabId: ${err.message}`,
                "ERROR",
              );
            });
        }
      }

      // 清理SFTP操作
      if (this.sftpCore?.clearPendingOperationsForTab) {
        this.sftpCore.clearPendingOperationsForTab(processId);
        if (sshConfig.tabId)
          this.sftpCore.clearPendingOperationsForTab(sshConfig.tabId);
      }

      // 清理SFTP会话池
      try {
        if (this.sftpCore?.closeAllSftpSessionsForTab) {
          this.sftpCore.closeAllSftpSessionsForTab(processId);
          if (sshConfig.tabId)
            this.sftpCore.closeAllSftpSessionsForTab(sshConfig.tabId);
        }
      } catch (err) {
        logToFile(
          `Error closing SFTP sessions on SSH close: ${err.message}`,
          "ERROR",
        );
      }

      const shouldReleaseConnection = Boolean(connectionInfo?.intentionalClose);
      if (shouldReleaseConnection) {
        // 仅在用户主动关闭时释放连接引用，避免阻断自动重连
        this.connectionManager.releaseSSHConnection(
          connectionInfo.key,
          sshConfig.tabId,
        );
      } else {
        logToFile(
          `SSH stream closed without intentional flag, keeping connection for auto-reconnect: ${connectionInfo.key}`,
          "DEBUG",
        );
      }

      // 清理进程信息
      this.childProcesses.delete(processId);
      if (sshConfig.tabId) this.childProcesses.delete(sshConfig.tabId);
    };

    // 注册事件监听器
    stream.on("data", dataHandler);
    stream.on("extended data", extendedDataHandler);
    stream.on("close", closeHandler);
  }

  _setupTelnetEventListeners(telnet, processId, telnetConfig, connectionInfo) {
    const mainWindow = this._getMainWindow();

    telnet.on("data", (data) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            data.toString(),
          );
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
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n*** Telnet连接错误: ${err.message} ***\r\n`,
        );
        mainWindow.webContents.send(`process:exit:${processId}`, {
          code: 1,
          signal: null,
        });
      }

      this.connectionManager.releaseTelnetConnection(
        connectionInfo.key,
        telnetConfig.tabId,
      );
    });

    telnet.on("end", () => {
      logToFile(`Telnet connection ended for processId ${processId}`, "INFO");

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n*** Telnet连接已关闭 ***\r\n`,
        );
        mainWindow.webContents.send(`process:exit:${processId}`, {
          code: 0,
          signal: null,
        });
      }

      this.connectionManager.releaseTelnetConnection(
        connectionInfo.key,
        telnetConfig.tabId,
      );
    });

    telnet.on("timeout", () => {
      logToFile(`Telnet connection timeout for processId ${processId}`, "WARN");

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n*** Telnet连接超时 ***\r\n`,
        );
      }
    });
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

  /**
   * 检查错误是否为认证失败
   */
  _isAuthenticationError(error) {
    if (this._isAuthCancelledError(error)) {
      return false;
    }

    const msg = String(error?.message || "").toLowerCase();
    return (
      msg.includes("authentication") ||
      msg.includes("auth fail") ||
      msg.includes("all configured authentication methods failed") ||
      msg.includes("permission denied") ||
      msg.includes("publickey") ||
      msg.includes("password") ||
      msg.includes("keyboard-interactive")
    );
  }

  /**
   * 检查错误是否为用户取消认证
   */
  _isAuthCancelledError(error) {
    const rawMessage = String(error?.message || "");
    const lowerMessage = rawMessage.toLowerCase();
    return (
      lowerMessage.includes("cancelled") ||
      lowerMessage.includes("canceled") ||
      rawMessage.includes("取消")
    );
  }

  async startSSH(event, sshConfig) {
    const processId = this.getNextProcessId();
    const mainWindow = this._getMainWindow();

    if (!sshConfig || !sshConfig.host) {
      logToFile("Invalid SSH configuration", "ERROR");
      throw new Error("Invalid SSH configuration");
    }

    // 最大重试次数（用于认证失败后重试）
    const maxAuthRetries = 3;
    let authRetryCount = 0;
    let finalConfig = { ...sshConfig };
    let lastAuthResult = null;

    // 检查是否需要预先认证（没有用户名或密码/密钥）
    const needsPreAuth =
      !sshConfig.username ||
      (!sshConfig.password &&
        !sshConfig.privateKeyPath &&
        sshConfig.authType !== "privateKey");

    while (authRetryCount <= maxAuthRetries) {
      try {
        // 如果需要预先认证（第一次）或者上次认证失败需要重试
        if (needsPreAuth && authRetryCount === 0) {
          logToFile(
            `SSH connection requires authentication for ${sshConfig.host}`,
            "INFO",
          );

          const authResult = await this._requestUserAuth(sshConfig.tabId, {
            step: "hostVerify",
            host: sshConfig.host,
            port: sshConfig.port || 22,
            serverVersion: null,
            fingerprint: null,
            fingerprintChanged: false,
            requireCredentials: true,
            connectionId: sshConfig.id,
            existingUsername: sshConfig.username || "",
            isRetry: false,
          });

          if (authResult.cancelled) {
            throw new Error("Authentication cancelled by user");
          }

          lastAuthResult = authResult;
          finalConfig = {
            ...sshConfig,
            username: authResult.username || sshConfig.username,
            password: authResult.password || sshConfig.password,
            privateKeyPath:
              authResult.privateKeyPath || sshConfig.privateKeyPath,
            authType: authResult.authType || sshConfig.authType || "password",
          };
        }

        // 尝试建立SSH连接（附加主机指纹校验）
        const connectionConfig =
          this._attachHostVerificationConfig(finalConfig);
        const connectionInfo =
          await this.connectionManager.getSSHConnection(connectionConfig);
        this._broadcastTopConnections();
        const ssh = connectionInfo.client;

        if (connectionConfig.tabId) {
          this.connectionManager.addTabReference(
            connectionConfig.tabId,
            connectionInfo.key,
          );
        }

        // 存储进程信息
        const procInfo = this._createProcessInfo(
          ssh,
          connectionInfo,
          connectionConfig,
          "ssh2",
        );
        this.childProcesses.set(processId, procInfo);
        if (connectionConfig.tabId) {
          this.childProcesses.set(connectionConfig.tabId, { ...procInfo });
        }

        let result;
        if (connectionInfo.ready) {
          logToFile(`复用现有SSH连接: ${connectionInfo.key}`, "INFO");

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n*** ${connectionConfig.host} SSH连接已建立（复用现有连接） ***\r\n`,
            );
          }

          result = await this._createSSHShell(
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

        // 连接成功，如果用户选择了"下次自动登录"，保存凭据
        if (lastAuthResult?.autoLogin && sshConfig.id) {
          await this.updateConnectionCredentials(event, sshConfig.id, {
            username: finalConfig.username,
            password: finalConfig.password,
            privateKeyPath: finalConfig.privateKeyPath,
            authType: finalConfig.authType,
          });
        }

        return result;
      } catch (error) {
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
          this.childProcesses.delete(processId);
          if (finalConfig.tabId) this.childProcesses.delete(finalConfig.tabId);

          // 显示认证对话框让用户重新输入凭据
          try {
            const authResult = await this._requestUserAuth(sshConfig.tabId, {
              step: "hostVerify",
              host: sshConfig.host,
              port: sshConfig.port || 22,
              serverVersion: null,
              fingerprint: null,
              fingerprintChanged: false,
              requireCredentials: true,
              connectionId: sshConfig.id,
              existingUsername:
                finalConfig.username || sshConfig.username || "",
              isRetry: true,
              errorMessage: error.message,
            });

            if (authResult.cancelled) {
              throw new Error("Authentication cancelled by user");
            }

            lastAuthResult = authResult;
            finalConfig = {
              ...sshConfig,
              username: authResult.username || finalConfig.username,
              password: authResult.password, // 使用新密码
              privateKeyPath:
                authResult.privateKeyPath || finalConfig.privateKeyPath,
              authType:
                authResult.authType || finalConfig.authType || "password",
            };

            // 继续循环重试
            continue;
          } catch (authError) {
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

  _createSSHShell(ssh, processId, sshConfig, connectionInfo) {
    return new Promise((resolve, reject) => {
      ssh.shell(
        { term: "xterm-256color", cols: 120, rows: 30 },
        (err, stream) => {
          if (err) {
            logToFile(
              `SSH shell error for processId ${processId}: ${err.message}`,
              "ERROR",
            );
            this.connectionManager.releaseSSHConnection(
              connectionInfo.key,
              sshConfig.tabId,
            );
            this.childProcesses.delete(processId);
            if (sshConfig.tabId) this.childProcesses.delete(sshConfig.tabId);
            return reject(err);
          }

          // 更新进程信息中的stream
          const procToUpdate = this.childProcesses.get(processId);
          if (procToUpdate) procToUpdate.stream = stream;
          const tabProcToUpdate = this.childProcesses.get(sshConfig.tabId);
          if (tabProcToUpdate) tabProcToUpdate.stream = stream;

          this._setupStreamEventListeners(
            stream,
            processId,
            sshConfig,
            connectionInfo,
          );

          // 注册延迟检测
          const latencyHandlers = this.getLatencyHandlers();
          if (latencyHandlers && sshConfig.tabId) {
            try {
              latencyHandlers.latencyService.registerSSHConnection(
                sshConfig.tabId,
                ssh,
                sshConfig.host,
                sshConfig.port || 22,
                sshConfig.proxy || null,
              );
              logToFile(`已为SSH连接注册延迟检测: ${sshConfig.tabId}`, "DEBUG");
            } catch (latencyError) {
              logToFile(`延迟检测注册失败: ${latencyError.message}`, "WARN");
            }
          }

          resolve(processId);
        },
      );
    });
  }

  _waitForSSHReady(ssh, processId, sshConfig, connectionInfo) {
    const mainWindow = this._getMainWindow();

    return new Promise((resolve, reject) => {
      let settled = false;
      let reconnectWaitStarted = false;
      let reconnectTimeoutId = null;

      const connectionKey = connectionInfo?.key;
      const sshPool = this.connectionManager?.sshConnectionPool;
      const reconnectManager = sshPool?.reconnectionManager;

      const getLatestClient = () => {
        const latest = sshPool?.connections?.get(connectionKey);
        return latest?.client || ssh;
      };

      const startWaitForReconnect = () => {
        if (reconnectWaitStarted || !reconnectManager || !connectionKey) return;
        reconnectWaitStarted = true;

        // 给用户一次性提示：正在等待代理/VPN/网络恢复并自动重试
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n连接未就绪，正在等待代理/VPN/网络恢复并自动重试（最多1分钟）...\r\n`,
            );
          }
        } catch {
          /* intentionally ignored */
        }

        reconnectManager
          .waitForReconnect(connectionKey, 60_000)
          .then(() => {
            // 走统一成功路径
            readyHandler(true);
          })
          .catch((e) => {
            errorHandler(e);
          });
      };

      const cleanup = () => {
        ssh.removeListener("ready", readyHandler);
        ssh.removeListener("error", errorHandler);
        if (reconnectTimeoutId) {
          clearTimeout(reconnectTimeoutId);
          reconnectTimeoutId = null;
        }
      };

      const connectionTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        logToFile("SSH connection timed out after 60 seconds", "ERROR");
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n自动重连超时（1分钟），请检查代理/VPN/网络后手动重连\r\n`,
          );
        }
        this.connectionManager.releaseSSHConnection(
          connectionInfo.key,
          sshConfig.tabId,
        );
        reject(new Error("SSH connection timeout"));
      }, 60_000);

      const readyHandler = (fromReconnectManager = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimeout);
        cleanup();

        // 更新进程状态
        const procInfo = this.childProcesses.get(processId);
        if (procInfo) procInfo.ready = true;
        if (sshConfig.tabId) {
          const tabProcInfo = this.childProcesses.get(sshConfig.tabId);
          if (tabProcInfo) tabProcInfo.ready = true;

          if (mainWindow && !mainWindow.isDestroyed()) {
            const connectionStatus = {
              isConnected: true,
              isConnecting: false,
              quality: "excellent",
              lastUpdate: Date.now(),
              connectionType: "SSH",
              host: sshConfig.host,
              port: sshConfig.port,
              username: sshConfig.username,
            };
            mainWindow.webContents.send("tab-connection-status", {
              tabId: sshConfig.tabId,
              connectionStatus,
            });
          }
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n*** ${sshConfig.host} SSH连接已建立 ***\r\n`,
          );
        }

        const clientToUse = fromReconnectManager ? getLatestClient() : ssh;
        this._createSSHShell(clientToUse, processId, sshConfig, connectionInfo)
          .then(resolve)
          .catch(reject);
      };

      const errorHandler = (err) => {
        if (settled) return;
        // 若已进入重连状态机，则不要立刻失败，改为等待重连结果
        if (!reconnectWaitStarted && reconnectManager && connectionKey) {
          const st = reconnectManager.getSessionStatus(connectionKey);
          if (st && (st.state === "pending" || st.state === "reconnecting")) {
            startWaitForReconnect();
            return;
          }
        }

        settled = true;
        clearTimeout(connectionTimeout);
        cleanup();
        logToFile(
          `SSH connection error for processId ${processId}: ${err?.message || err}`,
          "ERROR",
        );

        if (sshConfig.tabId && mainWindow && !mainWindow.isDestroyed()) {
          const connectionStatus = {
            isConnected: false,
            isConnecting: false,
            quality: "offline",
            lastUpdate: Date.now(),
            connectionType: "SSH",
            host: sshConfig.host,
            port: sshConfig.port,
            username: sshConfig.username,
            error: err?.message || String(err),
          };
          mainWindow.webContents.send("tab-connection-status", {
            tabId: sshConfig.tabId,
            connectionStatus,
          });
        }

        this.connectionManager.releaseSSHConnection(
          connectionInfo.key,
          sshConfig.tabId,
        );
        this.childProcesses.delete(processId);
        if (sshConfig.tabId) this.childProcesses.delete(sshConfig.tabId);
        reject(err);
      };

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

  async startTelnet(event, telnetConfig) {
    const processId = this.getNextProcessId();
    const mainWindow = this._getMainWindow();

    if (!telnetConfig || !telnetConfig.host) {
      logToFile("Invalid Telnet configuration", "ERROR");
      throw new Error("Invalid Telnet configuration");
    }

    try {
      const connectionInfo =
        await this.connectionManager.getTelnetConnection(telnetConfig);
      this._broadcastTopConnections();
      const telnet = connectionInfo.client;

      if (telnetConfig.tabId) {
        this.connectionManager.addTabReference(
          telnetConfig.tabId,
          connectionInfo.key,
        );
      }

      // 存储进程信息
      const procInfo = this._createProcessInfo(
        telnet,
        connectionInfo,
        telnetConfig,
        "telnet",
      );
      this.childProcesses.set(processId, procInfo);
      if (telnetConfig.tabId) {
        this.childProcesses.set(telnetConfig.tabId, { ...procInfo });
      }

      if (connectionInfo.ready) {
        logToFile(`复用现有Telnet连接: ${connectionInfo.key}`, "INFO");

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n*** ${telnetConfig.host} Telnet连接已建立（复用现有连接） ***\r\n`,
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
      logToFile(`Failed to start Telnet connection: ${error.message}`, "ERROR");
      throw error;
    }
  }
}

module.exports = SSHHandlers;
