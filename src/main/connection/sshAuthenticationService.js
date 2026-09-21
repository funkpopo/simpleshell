const {
  indexConnections,
  SSH_AUTH_FIELDS,
} = require("../../shared/connectionConfigSync");
const crypto = require("crypto");
const { generateId } = require("../../shared/common");
const { IPC_EVENT_CHANNELS } = require("../../shared/contracts/ipc/channels");
const {
  getHostCacheKey,
  normalizeSshHostFingerprint,
  setTrustedHostFingerprint,
} = require("../utils/sshHostKeyTrust");

// Owns authentication queues and host trust independently of IPC/session routing.
class SSHAuthenticationService {
  constructor({ getMainWindow, configService, log }) {
    this.getMainWindow = getMainWindow;
    this.configService = configService;
    this.log = log;
    this.pendingAuthRequests = new Map();
    this.activeAuthRequestId = null;
    this.knownHostsCache = new Map();
    this.knownHostsLoaded = false;
    this.pendingHostVerifications = new Map();
    this.sessionTrustedHosts = new Map();
  }
  /** 连接凭据发生变化时取消对应的待处理认证。 */
  cancelForChangedConnections(previousConnections, connections) {
    const previous = indexConnections(previousConnections);
    const saved = indexConnections(connections);
    for (const pending of [...this.pendingAuthRequests.values()]) {
      const id = pending.authData.connectionId;
      const before = previous.get(id);
      const after = saved.get(id);
      if (!before || !after) continue;
      if (
        SSH_AUTH_FIELDS.some(
          (field) =>
            JSON.stringify(before[field] ?? null) !==
            JSON.stringify(after[field] ?? null),
        )
      ) {
        const error = new Error("SSH configuration changed");
        error.code = "SSH_CONFIG_CHANGED";
        pending.reject(error);
      }
    }
  }

  /** 处理渲染进程返回的认证结果。 */
  async respond(response) {
    const { requestId, ...authData } = response;

    if (!requestId || !this.pendingAuthRequests.has(requestId)) {
      this.log(`Invalid auth response: requestId=${requestId}`, "WARN");
      throw new Error("Invalid request ID");
    }

    const pendingRequest = this.pendingAuthRequests.get(requestId);

    if (authData.cancelled) {
      pendingRequest.reject(new Error("Authentication cancelled by user"));
      // 用户取消认证：业务取消态，不走异常通道
      return { success: false, cancelled: true };
    }

    pendingRequest.resolve(authData);
    return { success: true };
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
      this.log(`Failed to compute fingerprint: ${error.message}`, "ERROR");
      return null;
    }
  }

  /**
   * 获取主机缓存键
   */
  _getHostCacheKey(host, port) {
    return getHostCacheKey(host, port);
  }

  /**
   * 规范化主机指纹
   */
  _normalizeFingerprint(fingerprint) {
    return normalizeSshHostFingerprint(fingerprint);
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
      const storedHosts = this.configService.get("sshKnownHosts");
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
      this.log(`Failed to load known SSH hosts: ${error.message}`, "WARN");
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

      const saved = this.configService.set("sshKnownHosts", serializedHosts);
      if (!saved) {
        this.log("Failed to persist known SSH hosts", "WARN");
      }
    } catch (error) {
      this.log(`Failed to persist known SSH hosts: ${error.message}`, "WARN");
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
  async _requestUserAuth(tabId, authData, signal) {
    if (signal?.aborted)
      throw new Error("SSH authentication connection closed");
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("No main window available for authentication");
    }

    const requestId = generateId("auth");

    return new Promise((resolve, reject) => {
      const onAbort = () =>
        this.pendingAuthRequests
          .get(requestId)
          ?.reject(new Error("SSH authentication connection closed"));
      // 设置超时（5分钟）
      const timeout = setTimeout(
        () => {
          this.pendingAuthRequests
            .get(requestId)
            ?.reject(new Error("Authentication timeout"));
        },
        5 * 60 * 1000,
      );

      // 存储待处理请求
      this.pendingAuthRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          this.pendingAuthRequests.delete(requestId);
          if (this.activeAuthRequestId === requestId) {
            this.activeAuthRequestId = null;
          }
          resolve(data);
          this._showNextAuthRequest();
        },
        reject: (error) => {
          clearTimeout(timeout);
          signal?.removeEventListener("abort", onAbort);
          this.pendingAuthRequests.delete(requestId);
          if (this.activeAuthRequestId === requestId) {
            this.activeAuthRequestId = null;
            if (!mainWindow.isDestroyed())
              mainWindow.webContents.send(IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST, {
                requestId,
                cancelled: true,
              });
          }
          reject(error);
          this._showNextAuthRequest();
        },
        tabId,
        authData,
      });

      signal?.addEventListener("abort", onAbort, { once: true });
      this._showNextAuthRequest();
    });
  }

  _showNextAuthRequest() {
    if (this.activeAuthRequestId) return;
    const next = this.pendingAuthRequests.entries().next().value;
    if (!next) return;
    const [requestId, { tabId, authData }] = next;
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    this.activeAuthRequestId = requestId;
    mainWindow.webContents.send(IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST, {
      ...authData,
      requestId,
      tabId,
    });
  }

  /**
   * 请求用户输入连接凭据（认证对话框，首次与重试共用）
   */
  _requestCredentialsAuth(
    sshConfig,
    { existingUsername, isRetry, errorMessage } = {},
  ) {
    const authData = {
      step: "hostVerify",
      host: sshConfig.host,
      port: sshConfig.port || 22,
      serverVersion: null,
      fingerprint: null,
      fingerprintChanged: false,
      requireCredentials: true,
      connectionId: sshConfig.id,
      existingUsername,
      isRetry,
    };
    if (errorMessage !== undefined) {
      authData.errorMessage = errorMessage;
    }
    return this._requestUserAuth(sshConfig.tabId, authData);
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
      setTrustedHostFingerprint(
        sshConfig,
        normalizedFingerprint,
        hostKeyStatus.trustScope || "known",
      );
      return true;
    }
    const isFirstConnection = !hostKeyStatus.known;

    const pendingKey = `${host}:${port}:${normalizedFingerprint}`;
    if (this.pendingHostVerifications.has(pendingKey)) {
      const approved = await this.pendingHostVerifications.get(pendingKey);
      if (approved)
        setTrustedHostFingerprint(sshConfig, normalizedFingerprint, "session");
      return approved;
    }

    const verificationPromise = (async () => {
      const authResult = await this._requestUserAuth(
        sshConfig.tabId,
        {
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
        },
        sshConfig._authSignal,
      );

      if (!authResult || authResult.cancelled || !authResult.acceptHostKey) {
        return false;
      }

      const hostTrustMode =
        authResult.hostTrustMode === "session" ? "session" : "permanent";
      this._saveHostKey(host, port, normalizedFingerprint, {
        persist: hostTrustMode === "permanent",
      });
      setTrustedHostFingerprint(
        sshConfig,
        normalizedFingerprint,
        hostTrustMode,
      );
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
          sshConfig._interactiveAuthError = error;
          this.log(
            `Host fingerprint verification failed: ${error.message}`,
            "WARN",
          );
          callback(false);
        });
      return undefined;
    };
  }

  /**
   * 创建 keyboard-interactive（2FA/OTP）应答器
   * 将服务器提示转发到渲染层对话框，等待用户输入后返回答案数组
   */
  _createKeyboardInteractiveResponder(sshConfig) {
    return async ({ name, instructions, prompts, prefill, signal }) => {
      const authData = {
        step: "keyboardInteractive",
        host: sshConfig.host,
        port: sshConfig.port || 22,
        requireCredentials: false,
        connectionId: sshConfig.id,
        username: sshConfig.username || "",
        existingUsername: sshConfig.username || "",
        kbdName: name || null,
        instructions: instructions || null,
        prompts: (Array.isArray(prompts) ? prompts : []).map((p) => ({
          prompt: String(p?.prompt || ""),
          echo: p?.echo === true,
        })),
        prefill: (Array.isArray(prefill) ? prefill : []).map((v) =>
          typeof v === "string" ? v : null,
        ),
        isRetry: false,
      };

      const result = await this._requestUserAuth(
        sshConfig.tabId,
        authData,
        signal,
      );
      if (!result || result.cancelled) {
        throw new Error("Authentication cancelled by user");
      }

      const answers = (
        Array.isArray(authData.prompts) ? authData.prompts : []
      ).map((_, index) => {
        const userAnswer = Array.isArray(result.answers)
          ? result.answers[index]
          : undefined;
        if (typeof userAnswer === "string") {
          return userAnswer;
        }
        const prefilled = Array.isArray(authData.prefill)
          ? authData.prefill[index]
          : null;
        return typeof prefilled === "string" ? prefilled : "";
      });
      return { answers };
    };
  }

  /**
   * 为 SSH 配置附加主机指纹校验能力
   */
  _attachHostVerificationConfig(sshConfig) {
    const connectionConfig = {
      ...sshConfig,
      hostHash: "sha256",
    };
    delete connectionConfig._interactiveAuthError;
    connectionConfig.hostVerifier = this._createHostVerifier(connectionConfig);
    // keyboard-interactive / 2FA：注入用户应答器（连接建立与断线重连共用）
    connectionConfig.keyboardInteractiveResponder =
      this._createKeyboardInteractiveResponder(connectionConfig);
    return connectionConfig;
  }
}
module.exports = SSHAuthenticationService;
