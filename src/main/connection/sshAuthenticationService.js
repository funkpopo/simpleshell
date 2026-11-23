const {
  indexConnections,
  SSH_AUTH_FIELDS,
} = require("../../shared/connectionConfigSync");
const crypto = require("crypto");
const fs = require("fs").promises;
const os = require("os");
const path = require("path");
const { generateId } = require("../../shared/common");
const { isIP } = require("../../shared/domain/ip");
const { IPC_EVENT_CHANNELS } = require("../../shared/contracts/ipc/channels");
const {
  getHostCacheKey,
  normalizeSshHostFingerprint,
  setTrustedHostFingerprint,
} = require("./sshHostKeyTrust");

const MAX_SYSTEM_KNOWN_HOSTS_BYTES = 1024 * 1024;
const MAX_SYSTEM_KNOWN_HOSTS_LINES = 5000;
const activeAuthServiceRefs = new Set();

function registerActiveAuthService(service) {
  const ref = new WeakRef(service);
  activeAuthServiceRefs.add(ref);
  return ref;
}

function forEachActiveAuthService(callback) {
  for (const ref of activeAuthServiceRefs) {
    const instance = ref.deref();
    if (!instance) {
      activeAuthServiceRefs.delete(ref);
      continue;
    }
    callback(instance);
  }
}

function parseHostAndPortFromKey(hostKey) {
  const raw = String(hostKey || "").trim();
  if (!raw) {
    return { host: "", port: 22 };
  }
  if (raw.startsWith("[")) {
    const closeIdx = raw.indexOf("]");
    if (closeIdx > 1) {
      const host = raw.slice(1, closeIdx);
      const rest = raw.slice(closeIdx + 1);
      if (rest.startsWith(":")) {
        const parsedPort = Number.parseInt(rest.slice(1), 10);
        return {
          host,
          port:
            Number.isInteger(parsedPort) &&
            parsedPort > 0 &&
            parsedPort <= 65535
              ? parsedPort
              : 22,
        };
      }
      return { host, port: 22 };
    }
  }
  if (isIP(raw) === 6) {
    return { host: raw, port: 22 };
  }
  const colonMatches = raw.match(/:/g);
  const lastColon = raw.lastIndexOf(":");
  if (lastColon > 0) {
    const hostCandidate = raw.slice(0, lastColon);
    const maybePort = raw.slice(lastColon + 1);
    const parsedPort = Number.parseInt(maybePort, 10);
    if (
      /^\d+$/.test(maybePort) &&
      parsedPort > 0 &&
      parsedPort <= 65535 &&
      ((colonMatches && colonMatches.length === 1) || isIP(hostCandidate) === 6)
    ) {
      return {
        host: hostCandidate,
        port: parsedPort,
      };
    }
  }
  return { host: raw, port: 22 };
}

function computeOpenSshSha256Fingerprint(base64Key) {
  const trimmed = String(base64Key || "").trim();
  if (!trimmed || !/^[A-Za-z0-9+/=]+$/.test(trimmed)) {
    return null;
  }
  const decoded = Buffer.from(trimmed, "base64");
  if (!decoded.length) {
    return null;
  }
  const digest = crypto
    .createHash("sha256")
    .update(decoded)
    .digest("base64")
    .replace(/=+$/, "");
  return `SHA256:${digest}`;
}

function parseSystemKnownHostToken(token) {
  const cleaned = String(token || "").trim();
  if (!cleaned || cleaned.startsWith("!")) {
    return null;
  }
  if (cleaned.startsWith("|")) {
    return {
      hostKey: cleaned,
      host: cleaned,
      port: 22,
    };
  }
  const { host, port } = parseHostAndPortFromKey(cleaned);
  if (!host) {
    return null;
  }
  return {
    hostKey: port !== 22 ? `${host}:${port}` : `${host}:22`,
    host,
    port,
  };
}

function parseSystemKnownHostsContent(content, updatedAt = null) {
  if (typeof content !== "string" || !content.trim()) {
    return [];
  }
  const entries = [];
  const lines = content.split(/\r?\n/);
  const limit = Math.min(lines.length, MAX_SYSTEM_KNOWN_HOSTS_LINES);

  for (let i = 0; i < limit; i += 1) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const parts = line.split(/\s+/);
    let offset = 0;
    if (parts[0]?.startsWith("@")) {
      const marker = parts[0].toLowerCase();
      if (marker === "@revoked") {
        continue;
      }
      offset = 1;
    }

    const hostsField = parts[offset];
    const keyType = parts[offset + 1];
    const base64Key = parts[offset + 2];
    if (!hostsField || !keyType || !base64Key) {
      continue;
    }

    const fingerprint = computeOpenSshSha256Fingerprint(base64Key);
    if (!fingerprint) {
      continue;
    }

    const tokens = hostsField.split(",");
    tokens.forEach((token, tokenIndex) => {
      const parsedHost = parseSystemKnownHostToken(token);
      if (!parsedHost) {
        return;
      }
      entries.push({
        id: `system:${i + 1}:${tokenIndex}:${parsedHost.hostKey}`,
        hostKey: parsedHost.hostKey,
        host: parsedHost.host,
        port: parsedHost.port,
        fingerprint,
        keyType,
        updatedAt,
        source: "system",
        editable: false,
      });
    });
  }

  return entries;
}

async function readSystemKnownHosts(systemKnownHostsPath) {
  if (systemKnownHostsPath === null) {
    return [];
  }
  const targetPath =
    systemKnownHostsPath || path.join(os.homedir(), ".ssh", "known_hosts");

  try {
    const stats = await fs.stat(targetPath);
    if (!stats.isFile()) {
      return [];
    }

    let content = "";
    if (stats.size > MAX_SYSTEM_KNOWN_HOSTS_BYTES) {
      const handle = await fs.open(targetPath, "r");
      try {
        const buffer = Buffer.alloc(MAX_SYSTEM_KNOWN_HOSTS_BYTES);
        const { bytesRead } = await handle.read(
          buffer,
          0,
          MAX_SYSTEM_KNOWN_HOSTS_BYTES,
          0,
        );
        content = buffer.toString("utf8", 0, bytesRead);
      } finally {
        await handle.close();
      }
    } else {
      content = await fs.readFile(targetPath, "utf8");
    }

    const updatedAt = stats.mtime ? stats.mtime.toISOString() : null;
    return parseSystemKnownHostsContent(content, updatedAt);
  } catch (error) {
    if (
      error &&
      (error.code === "ENOENT" ||
        error.code === "EISDIR" ||
        error.code === "ENOTDIR" ||
        error.code === "EACCES" ||
        error.code === "EPERM")
    ) {
      return [];
    }
    throw error;
  }
}

function listStoredKnownHosts(configService) {
  const storedHosts = configService?.get?.("sshKnownHosts");
  if (!storedHosts || typeof storedHosts !== "object") {
    return [];
  }

  return Object.entries(storedHosts)
    .map(([hostKey, entry]) => {
      const rawFingerprint =
        typeof entry === "string" ? entry : entry?.fingerprint;
      const fingerprint = normalizeSshHostFingerprint(rawFingerprint);
      if (!fingerprint) {
        return null;
      }
      const { host, port } = parseHostAndPortFromKey(hostKey);
      const updatedAt =
        typeof entry === "object" && entry?.updatedAt ? entry.updatedAt : null;
      return {
        id: `simpleshell:${hostKey}`,
        hostKey,
        host: host || hostKey,
        port,
        fingerprint,
        updatedAt,
        source: "simpleshell",
        editable: true,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const timeA = a.updatedAt ? Date.parse(a.updatedAt) || 0 : 0;
      const timeB = b.updatedAt ? Date.parse(b.updatedAt) || 0 : 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return a.hostKey.localeCompare(b.hostKey);
    });
}

async function listKnownHosts({ configService, systemKnownHostsPath } = {}) {
  const stored = listStoredKnownHosts(configService);
  const system = await readSystemKnownHosts(systemKnownHostsPath);
  return {
    success: true,
    hosts: [...stored, ...system],
    systemHostsCount: system.length,
  };
}

function removeStoredKnownHost({ configService, hostKey } = {}) {
  const normalizedKey = String(hostKey || "").trim();
  if (!normalizedKey) {
    throw new Error("Host key is required");
  }

  const parsed = parseHostAndPortFromKey(normalizedKey);
  const canonicalKey = parsed.host
    ? getHostCacheKey(parsed.host, parsed.port)
    : normalizedKey;

  const currentStored = configService?.get?.("sshKnownHosts");
  const nextHosts =
    currentStored && typeof currentStored === "object"
      ? { ...currentStored }
      : {};

  let removed = false;
  if (Object.prototype.hasOwnProperty.call(nextHosts, normalizedKey)) {
    delete nextHosts[normalizedKey];
    removed = true;
  }
  if (
    canonicalKey !== normalizedKey &&
    Object.prototype.hasOwnProperty.call(nextHosts, canonicalKey)
  ) {
    delete nextHosts[canonicalKey];
    removed = true;
  }

  if (removed && typeof configService?.set === "function") {
    const saved = configService.set("sshKnownHosts", nextHosts);
    if (saved === false) {
      throw new Error("Failed to persist known SSH hosts");
    }
  }

  forEachActiveAuthService((service) => {
    service.evictKnownHost(normalizedKey);
  });

  return {
    success: true,
    removed,
  };
}

function clearStoredKnownHosts({ configService } = {}) {
  const currentStored = configService?.get?.("sshKnownHosts");
  const existingKeys =
    currentStored && typeof currentStored === "object"
      ? Object.keys(currentStored)
      : [];

  if (typeof configService?.set === "function") {
    const saved = configService.set("sshKnownHosts", {});
    if (saved === false) {
      throw new Error("Failed to clear known SSH hosts");
    }
  }

  forEachActiveAuthService((service) => {
    service.clearKnownHostsMemory(existingKeys);
  });

  return {
    success: true,
    clearedCount: existingKeys.length,
  };
}

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
    this._instanceRef = registerActiveAuthService(this);
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
   * 创建 hostVerifier 回调（NativeSshClient 的 connect 选项）
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

  /**
   * 仅从内存缓存（knownHostsCache 与 sessionTrustedHosts）驱逐指定主机指纹，
   * 用于撤销信任后立即失效当前会话信任。
   */
  evictKnownHost(hostKey) {
    const normalizedKey = String(hostKey || "").trim();
    if (!normalizedKey) {
      return false;
    }

    const parsed = parseHostAndPortFromKey(normalizedKey);
    const canonicalKey = parsed.host
      ? this._getHostCacheKey(parsed.host, parsed.port)
      : normalizedKey;

    const deletedKnown =
      this.knownHostsCache.delete(normalizedKey) ||
      this.knownHostsCache.delete(canonicalKey);
    const deletedSession =
      this.sessionTrustedHosts.delete(normalizedKey) ||
      this.sessionTrustedHosts.delete(canonicalKey);
    return Boolean(deletedKnown || deletedSession);
  }

  /**
   * 清空持久化已知主机在内存中的缓存（保留纯临时 session scope 信任，同时确保任何已清除条目失效）
   */
  clearKnownHostsMemory(clearedKeys = []) {
    this.knownHostsCache.clear();
    if (Array.isArray(clearedKeys)) {
      clearedKeys.forEach((hostKey) => {
        const normalizedKey = String(hostKey || "").trim();
        if (!normalizedKey) {
          return;
        }
        const parsed = parseHostAndPortFromKey(normalizedKey);
        const canonicalKey = parsed.host
          ? this._getHostCacheKey(parsed.host, parsed.port)
          : normalizedKey;
        this.sessionTrustedHosts.delete(normalizedKey);
        this.sessionTrustedHosts.delete(canonicalKey);
      });
    }
    for (const [key, entry] of this.sessionTrustedHosts.entries()) {
      if (typeof entry === "string" || entry?.scope !== "session") {
        this.sessionTrustedHosts.delete(key);
      }
    }
  }

  async listKnownHosts(options = {}) {
    return listKnownHosts({
      configService: this.configService,
      systemKnownHostsPath: options.systemKnownHostsPath,
    });
  }

  removeKnownHost(hostKey) {
    return removeStoredKnownHost({
      configService: this.configService,
      hostKey,
    });
  }

  clearKnownHosts() {
    return clearStoredKnownHosts({
      configService: this.configService,
    });
  }
}

SSHAuthenticationService.parseHostAndPortFromKey = parseHostAndPortFromKey;
SSHAuthenticationService.computeOpenSshSha256Fingerprint =
  computeOpenSshSha256Fingerprint;
SSHAuthenticationService.parseSystemKnownHostsContent =
  parseSystemKnownHostsContent;
SSHAuthenticationService.listKnownHosts = listKnownHosts;
SSHAuthenticationService.removeStoredKnownHost = removeStoredKnownHost;
SSHAuthenticationService.clearStoredKnownHosts = clearStoredKnownHosts;

module.exports = SSHAuthenticationService;
