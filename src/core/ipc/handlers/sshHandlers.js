const { BrowserWindow } = require("electron");
const { StringDecoder } = require("string_decoder");
const { logToFile } = require("../../utils/logger");
const terminalManager = require("../../../modules/terminal");
const crypto = require("crypto");
const configService = require("../../../services/configService");
const filemanagementService = require("../../../modules/filemanagement/filemanagementService");
const {
  DEFAULT_SSH_RETRY_CONFIG,
  buildReconnectTimeoutMessage,
  buildReconnectWaitMessage,
  checkSshPreflight,
  createManagedSshConnection,
} = require("../../connection/ssh-retry-helper");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
  getTerminalProcessExitChannel,
  getTerminalProcessOutputChannel,
} = require("../schema/channels");
const {
  classifyConnectionFailure,
} = require("../../../shared/connectionErrorAdvice");

function isZhLanguage(language) {
  return String(language || "zh-CN")
    .toLowerCase()
    .startsWith("zh");
}

function getTerminalLanguage(config) {
  return config?.language || "zh-CN";
}

function getTerminalText(config, key, params = {}) {
  const isZh = isZhLanguage(getTerminalLanguage(config));
  const messages = {
    reconnectRecoveryStarted: isZh
      ? "正在恢复终端..."
      : "Restoring terminal...",
    reconnectRecoverySucceeded: isZh ? "终端已恢复" : "Terminal restored",
    reconnectRecoveryFailedDefault: isZh
      ? "终端恢复失败，请手动重连。"
      : "Terminal restore failed. Reconnect manually.",
    reconnectRecoveryFailedHint: isZh
      ? "连接已恢复，但终端恢复失败。"
      : "Connection recovered, but terminal restore failed.",
    sshDisconnected: isZh
      ? "SSH已断开，正在重连"
      : "SSH disconnected, reconnecting",
    telnetClosed: isZh ? "Telnet连接已关闭" : "Telnet connection closed",
    telnetTimeout: isZh ? "Telnet连接超时" : "Telnet connection timed out",
  };

  if (key === "reconnectRecoveryFailed") {
    return isZh
      ? `终端恢复失败: ${params.message}`
      : `Terminal restore failed: ${params.message}`;
  }

  if (key === "droppedBytesWarning") {
    return isZh
      ? `输出过快，已丢弃 ${params.dropped} 字节（请适当降低输出速率）`
      : `Output is too fast. Dropped ${params.dropped} bytes. Please reduce the output rate.`;
  }

  if (key === "sshConnected") {
    return isZh ? `${params.host} 已连接` : `${params.host} connected`;
  }

  if (key === "sshConnectedReused") {
    return isZh ? `${params.host} 已连接` : `${params.host} connected`;
  }

  if (key === "telnetError") {
    return isZh
      ? `Telnet连接错误: ${params.message}`
      : `Telnet connection error: ${params.message}`;
  }

  if (key === "telnetConnectedReused") {
    return isZh
      ? `${params.host} Telnet连接已建立（复用现有连接）`
      : `${params.host} Telnet connection established (reused existing connection)`;
  }

  return messages[key] || key;
}

/**
 * SSH/Telnet连接相关的IPC处理器
 * 这是一个高风险模块，涉及多个全局状态的管理
 */
class SSHHandlers {
  /**
   * @param {Object} dependencies - 依赖注入
   * @param {Map} dependencies.childProcesses - 子进程映射
   * @param {Object} dependencies.connectionManager - 连接管理器
   * @param {Function} dependencies.getNextProcessId - 获取下一个进程ID的函数
   * @param {Function} dependencies.getLatencyHandlers - 获取延迟处理器的函数
   */
  constructor(dependencies) {
    this.childProcesses = dependencies.childProcesses;
    this.connectionManager = dependencies.connectionManager;
    this.getNextProcessId = dependencies.getNextProcessId;
    this.getLatencyHandlers = dependencies.getLatencyHandlers;
    this.terminalIOMailboxManager = dependencies.terminalIOMailboxManager;

    // 待处理的认证请求
    this.pendingAuthRequests = new Map();

    // 已知主机指纹缓存 (host:port -> fingerprint)
    this.knownHostsCache = new Map();
    this.knownHostsLoaded = false;
    this.pendingHostVerifications = new Map();
    this.sessionTrustedHosts = new Map();

    // 连接键 -> { processId, tabId }，用于断线重连后恢复终端流
    this.connectionProcessBindings = new Map();
    // 防止同一连接并发创建 shell stream
    this.pendingShellCreations = new Map();
    // 防止同一连接并发触发恢复流程
    this.reconnectingShells = new Set();

    this.boundReconnectPool = null;
    this.onConnectionReconnected = null;
    this._ensureReconnectListener();
  }

  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_START_SSH,
        category: "terminal",
        handler: this.startSSH.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_TEST_SSH_CONNECTION,
        category: "terminal",
        handler: this.testSSHConnection.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_START_TELNET,
        category: "terminal",
        handler: this.startTelnet.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SSH_AUTH_RESPONSE,
        category: "terminal",
        handler: this.handleAuthResponse.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_UPDATE_CONNECTION_CREDENTIALS,
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

      await this._assertSSHReachableBeforeAuth(sshConfig);

      let connectionHandle = null;
      try {
        connectionHandle = await createManagedSshConnection(
          this._attachHostVerificationConfig(sshConfig),
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
            win.webContents.send(IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED);
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
      mainWindow.webContents.send(IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST, {
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

  _emitProcessOutput(processId, output) {
    if (this.terminalIOMailboxManager) {
      const emitted = this.terminalIOMailboxManager.emitOutput(
        processId,
        output,
      );
      if (emitted) {
        return;
      }
    }

    const mainWindow = this._getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    const channel = getTerminalProcessOutputChannel(processId);
    if (channel) {
      mainWindow.webContents.send(channel, output);
    }
  }

  _emitTerminalSessionEvent(channel, payload = {}) {
    const mainWindow = this._getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    mainWindow.webContents.send(channel, {
      ...payload,
      timestamp: Date.now(),
    });
  }

  _setProcessBufferedBytes(processId, bytes) {
    if (!this.terminalIOMailboxManager) {
      return;
    }

    this.terminalIOMailboxManager.setBufferedBytes(processId, bytes);
  }

  _resetProcessResizeState(processId) {
    if (!this.terminalIOMailboxManager) {
      return;
    }

    this.terminalIOMailboxManager.resetResizeState(processId);
  }

  _destroyProcessMailbox(processId) {
    if (!this.terminalIOMailboxManager) {
      return;
    }

    this.terminalIOMailboxManager.destroyProcess(processId);
  }

  _getFlowControlTarget(processId, tabId = null) {
    const procInfo = this.childProcesses.get(processId);
    const tabProcInfo = tabId ? this.childProcesses.get(tabId) : null;

    return procInfo?.stream || tabProcInfo?.stream || procInfo?.process || null;
  }

  _applyMailboxResize(processId, tabId, cols, rows) {
    const procInfo = this.childProcesses.get(processId);
    const tabProcInfo = tabId ? this.childProcesses.get(tabId) : null;
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

    return false;
  }

  _configureProcessMailbox(processId, config = {}) {
    if (!this.terminalIOMailboxManager) {
      return null;
    }

    return this.terminalIOMailboxManager.createMailbox(processId, {
      aliases: config.tabId ? [config.tabId] : [],
      getFlowControlTarget: () =>
        this._getFlowControlTarget(processId, config.tabId),
      applyResize: (cols, rows) =>
        this._applyMailboxResize(processId, config.tabId, cols, rows),
    });
  }

  _ensureReconnectListener() {
    const sshPool = this.connectionManager?.sshConnectionPool;
    if (!sshPool) {
      return;
    }

    if (this.boundReconnectPool === sshPool && this.onConnectionReconnected) {
      return;
    }

    if (this.boundReconnectPool && this.onConnectionReconnected) {
      this.boundReconnectPool.removeListener(
        "connectionReconnected",
        this.onConnectionReconnected,
      );
    }

    this.boundReconnectPool = sshPool;
    this.onConnectionReconnected = ({ key, connection }) => {
      void this._handleConnectionReconnected(key, connection);
    };
    sshPool.on("connectionReconnected", this.onConnectionReconnected);
  }

  _bindConnectionProcess(connectionKey, processId, tabId = null) {
    if (!connectionKey || processId === undefined || processId === null) return;
    this.connectionProcessBindings.set(connectionKey, {
      processId,
      tabId: tabId || null,
    });
  }

  _unbindConnectionProcess(connectionKey) {
    if (!connectionKey) return;
    this.connectionProcessBindings.delete(connectionKey);
  }

  _unbindConnectionProcessByProcess(processId, tabId = null) {
    for (const [connectionKey, binding] of this.connectionProcessBindings) {
      if (
        String(binding.processId) === String(processId) ||
        (tabId && String(binding.tabId) === String(tabId))
      ) {
        this.connectionProcessBindings.delete(connectionKey);
      }
    }
  }

  _resolveProcessBinding(connectionKey) {
    const binding = this.connectionProcessBindings.get(connectionKey);
    if (binding) {
      const hasProcess = this.childProcesses.has(binding.processId);
      const hasTab = binding.tabId
        ? this.childProcesses.has(binding.tabId)
        : false;
      if (hasProcess || hasTab) {
        return binding;
      }
      this.connectionProcessBindings.delete(connectionKey);
    }

    let fallback = null;
    for (const [
      candidateProcessId,
      procInfo,
    ] of this.childProcesses.entries()) {
      if (
        procInfo?.type === "ssh2" &&
        procInfo?.connectionInfo?.key === connectionKey
      ) {
        const candidateTabId = procInfo?.config?.tabId || null;
        const candidate = {
          processId: candidateProcessId,
          tabId: candidateTabId,
        };
        if (
          candidateTabId &&
          String(candidateProcessId) !== String(candidateTabId)
        ) {
          this.connectionProcessBindings.set(connectionKey, candidate);
          return candidate;
        }
        if (!fallback) {
          fallback = candidate;
        }
      }
    }

    if (fallback) {
      this.connectionProcessBindings.set(connectionKey, fallback);
    }
    return fallback;
  }

  _isSSHStreamUsable(stream) {
    if (!stream || typeof stream.write !== "function") return false;
    if (stream.destroyed === true) return false;
    if (stream.closed === true || stream._closed === true) return false;
    if (stream.writable === false) return false;
    return true;
  }

  async _handleConnectionReconnected(connectionKey, connectionInfoFromPool) {
    if (!connectionKey) return;

    const binding = this._resolveProcessBinding(connectionKey);
    if (!binding) {
      return;
    }

    const { processId, tabId } = binding;
    const procInfo = this.childProcesses.get(processId);
    const tabProcInfo = tabId ? this.childProcesses.get(tabId) : null;
    if (!procInfo && !tabProcInfo) {
      this._unbindConnectionProcess(connectionKey);
      return;
    }

    const activeProc = procInfo || tabProcInfo;
    if (!activeProc || activeProc.type !== "ssh2") {
      return;
    }

    const existingStream = procInfo?.stream || tabProcInfo?.stream;
    if (this._isSSHStreamUsable(existingStream)) {
      return;
    }

    if (this.reconnectingShells.has(connectionKey)) {
      return;
    }

    const latestConnInfo =
      this.connectionManager?.sshConnectionPool?.connections?.get(
        connectionKey,
      ) || connectionInfoFromPool;
    if (!latestConnInfo?.client) {
      return;
    }

    const sshConfig = activeProc.config || latestConnInfo.config;
    if (!sshConfig) {
      return;
    }

    this.reconnectingShells.add(connectionKey);
    this._emitProcessOutput(
      processId,
      `\r\n\x1b[36m*** ${getTerminalText(sshConfig, "reconnectRecoveryStarted")} ***\x1b[0m\r\n`,
    );

    try {
      await this._createSSHShell(
        latestConnInfo.client,
        processId,
        sshConfig,
        latestConnInfo,
        { isReconnectRecovery: true },
      );

      const mainWindow = this._getMainWindow();
      if (tabId && mainWindow && !mainWindow.isDestroyed()) {
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
        mainWindow.webContents.send(IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS, {
          tabId,
          connectionStatus,
        });
      }

      this._emitProcessOutput(
        processId,
        `\r\n\x1b[32m*** ${getTerminalText(sshConfig, "reconnectRecoverySucceeded")} ***\x1b[0m\r\n`,
      );

      this._emitTerminalSessionEvent(IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORED, {
        processId,
        tabId,
        connectionKey,
        host: sshConfig.host,
        port: sshConfig.port || 22,
        username: sshConfig.username,
      });
    } catch (error) {
      const message =
        error?.message ||
        getTerminalText(sshConfig, "reconnectRecoveryFailedDefault");
      const mainWindow = this._getMainWindow();
      if (tabId && mainWindow && !mainWindow.isDestroyed()) {
        const connectionStatus = {
          isConnected: false,
          isConnecting: false,
          quality: "offline",
          lastUpdate: Date.now(),
          connectionType: "SSH",
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
          error: message,
        };
        mainWindow.webContents.send(IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS, {
          tabId,
          connectionStatus,
        });
      }

      logToFile(
        `自动恢复终端会话失败: connection=${connectionKey}, process=${processId}, error=${message}`,
        "ERROR",
      );
      this._emitProcessOutput(
        processId,
        `\r\n\x1b[31m*** ${getTerminalText(
          sshConfig,
          "reconnectRecoveryFailed",
          {
            message,
          },
        )} ***\x1b[0m\r\n`,
      );

      this._emitTerminalSessionEvent(IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORE_FAILED, {
        processId,
        tabId,
        connectionKey,
        host: sshConfig.host,
        port: sshConfig.port || 22,
        username: sshConfig.username,
        error: message,
        hint: getTerminalText(sshConfig, "reconnectRecoveryFailedHint"),
      });
    } finally {
      this.reconnectingShells.delete(connectionKey);
    }
  }

  _broadcastTopConnections() {
    try {
      const lastConnections = this.connectionManager.getLastConnections(5);
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send(IPC_EVENT_CHANNELS.TOP_CONNECTIONS_CHANGED, lastConnections);
        }
      }
    } catch {
      // ignore broadcast errors
    }
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
    const stderrDecoder = new StringDecoder("utf8");
    const processMailbox = this._configureProcessMailbox(processId, sshConfig);

    const getOutputProfile = () => OUTPUT_PROFILE;

    const emitOutput = (payload, options = {}) => {
      if (processMailbox) {
        processMailbox.emitOutput(payload, options);
        return;
      }

      this._emitProcessOutput(processId, payload);
    };

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

        if (!output) {
          this._setProcessBufferedBytes(processId, buffer.length);
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
        this._setProcessBufferedBytes(processId, buffer.length);
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
          this._setProcessBufferedBytes(processId, buffer.length);
          return;
        }

        if (buffer.length === 0) {
          // fast path：避免空缓冲区时的 Buffer.concat 拷贝
          buffer = chunk;
        } else {
          buffer = Buffer.concat([buffer, chunk], buffer.length + chunk.length);
        }

        // 达到阈值时立即 flush，其他情况用短时间窗口微批处理
        if (buffer.length >= getOutputProfile().flushThresholdBytes) {
          flushBufferedOutput();
        } else {
          scheduleFlush();
        }

        this._setProcessBufferedBytes(processId, buffer.length);
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
        mainWindow.webContents.send(IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS, {
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
        emitOutput(
          `\r\n\x1b[33m*** ${getTerminalText(sshConfig, "sshDisconnected")} ***\x1b[0m\r\n`,
        );
      }

      // 清理SFTP传输
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

      const closeReason =
        connectionInfo?.closeReason ||
        (connectionInfo?.intentionalClose ? "user" : "network");
      const shouldReleaseConnection =
        closeReason === "user" || closeReason === "system";
      if (shouldReleaseConnection) {
        // 用户/系统主动关闭时释放连接引用；网络断线路径保留以便自动重连
        this.connectionManager.releaseSSHConnection(
          connectionInfo.key,
          sshConfig.tabId,
          {
            reason: closeReason,
            intentional: closeReason === "user",
          },
        );
        if (
          sshConfig?.tabId &&
          this.connectionManager?.sshConnectionPool?.removeTabReference
        ) {
          this.connectionManager.sshConnectionPool.removeTabReference(
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
        this._unbindConnectionProcess(connectionInfo?.key);
        this._unbindConnectionProcessByProcess(processId, sshConfig?.tabId);
      } else {
        logToFile(
          `SSH stream closed without intentional flag, keeping connection for auto-reconnect: ${connectionInfo.key}`,
          "DEBUG",
        );
        const processInfo = this.childProcesses.get(processId);
        if (processInfo) {
          processInfo.stream = null;
          processInfo.ready = false;
        }
        if (sshConfig.tabId) {
          const tabProcessInfo = this.childProcesses.get(sshConfig.tabId);
          if (tabProcessInfo) {
            tabProcessInfo.stream = null;
            tabProcessInfo.ready = false;
          }
        }
      }

      // 仅主动关闭时清理进程映射；意外断线时保留以便自动恢复 shell
      if (shouldReleaseConnection) {
        this._destroyProcessMailbox(processId);
        this.childProcesses.delete(processId);
        if (sshConfig.tabId) this.childProcesses.delete(sshConfig.tabId);
      }
    };

    // 注册事件监听器
    stream.on("data", dataHandler);
    stream.on("extended data", extendedDataHandler);
    stream.on("close", closeHandler);
  }

  _setupTelnetEventListeners(telnet, processId, telnetConfig, connectionInfo) {
    const mainWindow = this._getMainWindow();
    const processMailbox = this._configureProcessMailbox(
      processId,
      telnetConfig,
    );

    telnet.on("data", (data) => {
      try {
        if (processMailbox) {
          processMailbox.emitOutput(data.toString());
        } else if (mainWindow && !mainWindow.isDestroyed()) {
          this._emitProcessOutput(processId, data.toString());
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
        this._emitProcessOutput(
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
      this._destroyProcessMailbox(processId);

      this.connectionManager.releaseTelnetConnection(
        connectionInfo.key,
        telnetConfig.tabId,
      );
    });

    telnet.on("end", () => {
      logToFile(`Telnet connection ended for processId ${processId}`, "INFO");

      if (mainWindow && !mainWindow.isDestroyed()) {
        this._emitProcessOutput(
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
      this._destroyProcessMailbox(processId);

      this.connectionManager.releaseTelnetConnection(
        connectionInfo.key,
        telnetConfig.tabId,
      );
    });

    telnet.on("timeout", () => {
      logToFile(`Telnet connection timeout for processId ${processId}`, "WARN");

      if (mainWindow && !mainWindow.isDestroyed()) {
        this._emitProcessOutput(
          processId,
          `\r\n*** ${getTerminalText(telnetConfig, "telnetTimeout")} ***\r\n`,
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
      error?.connectionFailureKind === "auth" ||
      error?.connectionFailureKind === "private-key-permission" ||
      msg.includes("authentication") ||
      msg.includes("auth fail") ||
      msg.includes("all configured authentication methods failed") ||
      msg.includes("permission denied") ||
      msg.includes("publickey") ||
      msg.includes("password") ||
      msg.includes("keyboard-interactive") ||
      msg.includes("认证失败") ||
      msg.includes("身份验证") ||
      msg.includes("密码") ||
      msg.includes("私钥")
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

  _buildSSHPreAuthReachabilityError(sshConfig, preflightResult) {
    const host = sshConfig?.host || "unknown";
    const port = sshConfig?.port || 22;
    const code = String(preflightResult?.code || "").toUpperCase();
    const message = String(preflightResult?.message || "");

    if (code === "EPROXYUNAVAILABLE") {
      return new Error(
        `代理不可用: 无法通过当前代理连接到 ${host}:${port}`,
      );
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

          await this._assertSSHReachableBeforeAuth(sshConfig);

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
        this._configureProcessMailbox(processId, connectionConfig);
        this._bindConnectionProcess(
          connectionInfo.key,
          processId,
          connectionConfig.tabId,
        );

        let result;
        if (connectionInfo.ready) {
          logToFile(`复用现有SSH连接: ${connectionInfo.key}`, "INFO");

          if (mainWindow && !mainWindow.isDestroyed()) {
            this._emitProcessOutput(
              processId,
              `\r\n*** ${getTerminalText(
                connectionConfig,
                "sshConnectedReused",
                { host: connectionConfig.host },
              )} ***\r\n`,
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
          this._destroyProcessMailbox(processId);
          this.childProcesses.delete(processId);
          if (finalConfig.tabId) this.childProcesses.delete(finalConfig.tabId);
          this._unbindConnectionProcessByProcess(processId, finalConfig.tabId);

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

  _createSSHShell(ssh, processId, sshConfig, connectionInfo, options = {}) {
    const { isReconnectRecovery = false } = options;
    const shellCreationKey = `${connectionInfo?.key || "unknown"}:${processId}`;

    if (this.pendingShellCreations.has(shellCreationKey)) {
      return this.pendingShellCreations.get(shellCreationKey);
    }

    const creationPromise = new Promise((resolve, reject) => {
      const procToUpdate = this.childProcesses.get(processId);
      const tabProcToUpdate = sshConfig?.tabId
        ? this.childProcesses.get(sshConfig.tabId)
        : null;
      const existingStream = procToUpdate?.stream || tabProcToUpdate?.stream;

      // 幂等保护：若已有可用 stream，避免重复创建
      if (this._isSSHStreamUsable(existingStream)) {
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

            this.connectionManager.releaseSSHConnection(
              connectionInfo.key,
              sshConfig.tabId,
            );
            this._destroyProcessMailbox(processId);
            this.childProcesses.delete(processId);
            if (sshConfig.tabId) this.childProcesses.delete(sshConfig.tabId);
            this._unbindConnectionProcess(connectionInfo?.key);
            this._unbindConnectionProcessByProcess(processId, sshConfig?.tabId);
            return reject(err);
          }

          // 更新进程信息中的 stream 与最新连接对象
          const latestProc = this.childProcesses.get(processId);
          if (latestProc) {
            latestProc.stream = stream;
            latestProc.process = ssh;
            latestProc.connectionInfo = connectionInfo;
            latestProc.ready = true;
          }

          if (sshConfig?.tabId) {
            const latestTabProc = this.childProcesses.get(sshConfig.tabId);
            if (latestTabProc) {
              latestTabProc.stream = stream;
              latestTabProc.process = ssh;
              latestTabProc.connectionInfo = connectionInfo;
              latestTabProc.ready = true;
            }
          }

          this._bindConnectionProcess(
            connectionInfo?.key,
            processId,
            sshConfig?.tabId,
          );

          if (isReconnectRecovery) {
            this._resetProcessResizeState(processId);
          }

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

    this.pendingShellCreations.set(shellCreationKey, creationPromise);
    return creationPromise.finally(() => {
      if (
        this.pendingShellCreations.get(shellCreationKey) === creationPromise
      ) {
        this.pendingShellCreations.delete(shellCreationKey);
      }
    });
  }

  _waitForSSHReady(ssh, processId, sshConfig, connectionInfo) {
    const mainWindow = this._getMainWindow();

    return new Promise((resolve, reject) => {
      let settled = false;
      let reconnectWaitStarted = false;
      let waitForReconnectPromise = null;
      let connectionTimeout = null;

      const connectionKey = connectionInfo?.key;
      const sshPool = this.connectionManager?.sshConnectionPool;
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
            mainWindow.webContents.send(IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS, {
              tabId: sshConfig.tabId,
              connectionStatus,
            });
          }
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          this._emitProcessOutput(
            processId,
            `\r\n*** ${getTerminalText(sshConfig, "sshConnected", {
              host: sshConfig.host,
            })} ***\r\n`,
          );
        }

        const clientToUse = fromReconnectManager ? getLatestClient() : ssh;
        this._createSSHShell(clientToUse, processId, sshConfig, connectionInfo)
          .then(resolve)
          .catch(reject);
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
            this._emitProcessOutput(
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
          mainWindow.webContents.send(IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS, {
            tabId: sshConfig.tabId,
            connectionStatus,
          });
        }

        this.connectionManager.releaseSSHConnection(
          connectionInfo.key,
          sshConfig.tabId,
        );
        this._destroyProcessMailbox(processId);
        this.childProcesses.delete(processId);
        if (sshConfig.tabId) this.childProcesses.delete(sshConfig.tabId);
        this._unbindConnectionProcess(connectionInfo?.key);
        this._unbindConnectionProcessByProcess(processId, sshConfig?.tabId);
        reject(err);
      };

      connectionTimeout = setTimeout(() => {
        if (settled) return;
        logToFile(
          `SSH connection timed out after ${reconnectWaitTimeoutMs}ms`,
          "ERROR",
        );
        if (mainWindow && !mainWindow.isDestroyed()) {
          this._emitProcessOutput(
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
      this._configureProcessMailbox(processId, telnetConfig);

      if (connectionInfo.ready) {
        logToFile(`复用现有Telnet连接: ${connectionInfo.key}`, "INFO");

        if (mainWindow && !mainWindow.isDestroyed()) {
          this._emitProcessOutput(
            processId,
            `\r\n*** ${getTerminalText(telnetConfig, "telnetConnectedReused", {
              host: telnetConfig.host,
            })} ***\r\n`,
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
