const net = require("node:net");
const { Client } = require("ssh2");

const proxyManager = require("../proxy/proxy-manager");
const { getBasicSSHAlgorithms } = require("../../constants/sshAlgorithms");
const { processSSHPrivateKeyAsync } = require("../utils/ssh-utils");
const {
  resolveSshNetworkProfile,
  applySocketNetworkProfile,
} = require("../utils/ssh-network-profile");

const DEFAULT_SSH_RETRY_CONFIG = Object.freeze({
  maxRetries: 5,
  initialDelay: 5000,
  maxDelay: 5000,
  exponentialFactor: 1.0,
  jitter: 0,
  totalTimeCapMs: 25_000,
  networkProbe: {
    enabled: true,
    intervalMs: 1000,
    tcpTimeoutMs: 300,
  },
  useExponentialBackoff: false,
  fastReconnect: {
    enabled: false,
    maxAttempts: 0,
    delay: 5000,
    conditions: ["ECONNRESET", "EPIPE"],
  },
  smartReconnect: {
    enabled: false,
    analyzePattern: false,
    adaptiveDelay: false,
    networkQualityThreshold: 0.7,
  },
  authFailure: {
    enabled: false,
    maxRetries: 1,
  },
});

const FAILURE_REASON = Object.freeze({
  NETWORK: "network",
  AUTHENTICATION: "authentication",
  TIMEOUT: "timeout",
  RESOURCE: "resource",
  PROXY_UNAVAILABLE: "proxy-unavailable",
  CONNECTION_REFUSED: "connection-refused",
  HOST_UNRESOLVED: "host-unresolved",
  CONNECTION_RESET: "connection-reset",
  UNKNOWN: "unknown",
});

function buildSshRetryConfig(config = {}) {
  return {
    ...DEFAULT_SSH_RETRY_CONFIG,
    ...config,
    networkProbe: {
      ...DEFAULT_SSH_RETRY_CONFIG.networkProbe,
      ...(config.networkProbe || {}),
    },
    fastReconnect: {
      ...DEFAULT_SSH_RETRY_CONFIG.fastReconnect,
      ...(config.fastReconnect || {}),
    },
    smartReconnect: {
      ...DEFAULT_SSH_RETRY_CONFIG.smartReconnect,
      ...(config.smartReconnect || {}),
    },
    authFailure: {
      ...DEFAULT_SSH_RETRY_CONFIG.authFailure,
      ...(config.authFailure || {}),
    },
  };
}

function analyzeSshFailureReason(error) {
  const errorMessage = String(error?.message || "").toLowerCase();
  const errorCode = String(
    error?.code || error?.originalError?.code || "",
  ).toUpperCase();

  if (
    errorCode === "EPROXYUNAVAILABLE" ||
    error?.failureReason === FAILURE_REASON.PROXY_UNAVAILABLE
  ) {
    return FAILURE_REASON.PROXY_UNAVAILABLE;
  }

  if (errorCode === "ECONNREFUSED") {
    return FAILURE_REASON.CONNECTION_REFUSED;
  }

  if (errorCode === "ENOTFOUND") {
    return FAILURE_REASON.HOST_UNRESOLVED;
  }

  if (errorCode === "ECONNRESET" || errorCode === "EPIPE") {
    return FAILURE_REASON.CONNECTION_RESET;
  }

  if (
    errorCode === "ETIMEDOUT" ||
    errorCode === "ENETUNREACH" ||
    errorMessage.includes("socket") ||
    errorMessage.includes("network") ||
    errorMessage.includes("proxy")
  ) {
    return FAILURE_REASON.NETWORK;
  }

  if (
    errorMessage.includes("authentication") ||
    errorMessage.includes("permission") ||
    errorMessage.includes("password") ||
    errorMessage.includes("private key") ||
    errorMessage.includes("configured authentication methods failed")
  ) {
    return FAILURE_REASON.AUTHENTICATION;
  }

  if (errorMessage.includes("timeout") || errorCode === "ETIMEDOUT") {
    return FAILURE_REASON.TIMEOUT;
  }

  if (
    errorMessage.includes("too many") ||
    errorMessage.includes("limit") ||
    errorMessage.includes("quota")
  ) {
    return FAILURE_REASON.RESOURCE;
  }

  return FAILURE_REASON.UNKNOWN;
}

function getEffectiveMaxRetries(retryConfig, sshConfig, failureReason) {
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  const reason = failureReason || FAILURE_REASON.UNKNOWN;
  const baseMax = Number(resolvedRetryConfig.maxRetries ?? 5);

  if (!Number.isFinite(baseMax) || baseMax <= 0) {
    return 0;
  }

  if (reason === FAILURE_REASON.RESOURCE) {
    return 0;
  }

  if (reason === FAILURE_REASON.AUTHENTICATION) {
    const authRetryEnabled =
      Boolean(sshConfig?.retryOnAuthFailure) ||
      Boolean(resolvedRetryConfig?.authFailure?.enabled);
    if (!authRetryEnabled) {
      return 0;
    }

    const authMax = Number(
      sshConfig?.authFailureMaxRetries ??
        resolvedRetryConfig?.authFailure?.maxRetries ??
        1,
    );
    if (!Number.isFinite(authMax) || authMax <= 0) {
      return 0;
    }

    return Math.max(0, Math.min(baseMax, authMax));
  }

  return Math.max(0, Math.floor(baseMax));
}

function getRemainingRetryWindowMs(windowStartedAt, retryConfig) {
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  const totalTimeCapMs = Number(resolvedRetryConfig.totalTimeCapMs || 0);
  if (
    !Number.isFinite(totalTimeCapMs) ||
    totalTimeCapMs <= 0 ||
    !Number.isFinite(windowStartedAt) ||
    windowStartedAt <= 0
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, totalTimeCapMs - (Date.now() - windowStartedAt));
}

function getRetryWindowExpiresAt(windowStartedAt, retryConfig) {
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  const totalTimeCapMs = Number(resolvedRetryConfig.totalTimeCapMs || 0);
  if (
    !Number.isFinite(totalTimeCapMs) ||
    totalTimeCapMs <= 0 ||
    !Number.isFinite(windowStartedAt) ||
    windowStartedAt <= 0
  ) {
    return null;
  }

  return windowStartedAt + totalTimeCapMs;
}

function isRetryWindowExpired(windowStartedAt, retryConfig) {
  const remaining = getRemainingRetryWindowMs(windowStartedAt, retryConfig);
  return Number.isFinite(remaining) && remaining <= 0;
}

function isZhLanguage(language) {
  return String(language || "zh-CN")
    .toLowerCase()
    .startsWith("zh");
}

function formatRetryWindowLabel(durationMs, language = "zh-CN") {
  const normalizedMs = Number(durationMs || 0);
  const isZh = isZhLanguage(language);
  if (!Number.isFinite(normalizedMs) || normalizedMs <= 0) {
    return isZh ? "0秒" : "0s";
  }

  if (normalizedMs < 60_000) {
    const seconds = normalizedMs / 1000;
    const rendered = Number.isInteger(seconds)
      ? String(seconds)
      : seconds.toFixed(1).replace(/\.0$/, "");
    return isZh ? `${rendered}秒` : `${rendered}s`;
  }

  const minutes = normalizedMs / 60_000;
  const rendered = Number.isInteger(minutes)
    ? String(minutes)
    : minutes.toFixed(1).replace(/\.0$/, "");
  return isZh ? `${rendered}分钟` : `${rendered}m`;
}

function buildReconnectTimeoutMessage(retryConfig, language = "zh-CN") {
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  const duration = formatRetryWindowLabel(
    resolvedRetryConfig.totalTimeCapMs,
    language,
  );
  if (!isZhLanguage(language)) {
    return `Automatic reconnect timed out (${duration}). Check proxy/VPN/network and reconnect manually.`;
  }
  return `自动重连超时（${duration}），请检查代理/VPN/网络后手动重连。`;
}

function buildReconnectWaitMessage(retryConfig, language = "zh-CN") {
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  const duration = formatRetryWindowLabel(
    resolvedRetryConfig.totalTimeCapMs,
    language,
  );
  if (!isZhLanguage(language)) {
    return `Connection is not ready. Waiting for proxy/VPN/network recovery and retrying automatically (up to ${duration})...`;
  }
  return `连接未就绪，正在等待代理/VPN/网络恢复并自动重试（最多${duration}）...`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    if (!host || !port) {
      resolve({
        ok: false,
        code: "EINVAL",
        message: "invalid tcp target",
      });
      return;
    }

    const socket = net.createConnection({ host, port });
    let finished = false;

    const finish = (result) => {
      if (finished) {
        return;
      }
      finished = true;
      try {
        socket.destroy();
      } catch {
        /* intentionally ignored */
      }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () =>
      finish({ ok: true, code: null, message: null }),
    );
    socket.once("timeout", () =>
      finish({
        ok: false,
        code: "ETIMEDOUT",
        message: "tcp probe timeout",
      }),
    );
    socket.once("error", (error) =>
      finish({
        ok: false,
        code: String(error?.code || "ECONNFAILED").toUpperCase(),
        message: String(error?.message || "tcp probe failed"),
        originalError: error,
      }),
    );
  });
}

async function checkSshPreflight(sshConfig, retryConfig) {
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  if (!resolvedRetryConfig.networkProbe?.enabled) {
    return {
      ok: true,
      failureReason: null,
      code: null,
      message: null,
    };
  }

  const resolvedProxyConfig =
    await proxyManager.resolveProxyConfigAsync(sshConfig);
  const usingProxy =
    resolvedProxyConfig &&
    proxyManager.isValidProxyConfig(resolvedProxyConfig) &&
    String(resolvedProxyConfig.type || "").toLowerCase() !== "none";
  const tcpTimeoutMs = Number(
    resolvedRetryConfig.networkProbe?.tcpTimeoutMs || 1500,
  );

  if (usingProxy) {
    const proxyPort = Number(resolvedProxyConfig.port);
    const targetPort = Number(sshConfig?.port ?? 22);
    if (!Number.isFinite(proxyPort) || proxyPort <= 0) {
      return {
        ok: false,
        code: "EPROXYUNAVAILABLE",
        failureReason: FAILURE_REASON.PROXY_UNAVAILABLE,
        message: "proxy endpoint is unavailable",
      };
    }

    if (!Number.isFinite(targetPort) || targetPort <= 0) {
      return {
        ok: false,
        code: "EINVAL",
        failureReason: FAILURE_REASON.UNKNOWN,
        message: "invalid ssh target port",
      };
    }

    let tunnel = null;
    try {
      tunnel = await proxyManager.createTunnelSocket(
        resolvedProxyConfig,
        sshConfig?.host,
        targetPort,
        { timeoutMs: tcpTimeoutMs },
      );
      return {
        ok: true,
        failureReason: null,
        code: null,
        message: null,
      };
    } catch (error) {
      const probeError =
        error instanceof Error ? error : new Error(String(error));
      const code = String(
        probeError?.code ||
          probeError?.originalError?.code ||
          "EPROXYUNAVAILABLE",
      ).toUpperCase();
      return {
        ok: false,
        code,
        failureReason:
          code === "ECONNREFUSED"
            ? FAILURE_REASON.CONNECTION_REFUSED
            : analyzeSshFailureReason(probeError),
        message:
          probeError.message ||
          `ssh target ${sshConfig?.host}:${targetPort} is unavailable through proxy`,
        originalError: probeError,
      };
    } finally {
      try {
        if (tunnel) tunnel.destroy();
      } catch {
        /* intentionally ignored */
      }
    }
  }

  const targetPort = Number(sshConfig?.port ?? 22);
  if (!Number.isFinite(targetPort) || targetPort <= 0) {
    return {
      ok: false,
      code: "EINVAL",
      failureReason: FAILURE_REASON.UNKNOWN,
      message: "invalid ssh target port",
    };
  }
  const probeResult = await probeTcp(sshConfig?.host, targetPort, tcpTimeoutMs);
  if (probeResult.ok) {
    return {
      ok: true,
      failureReason: null,
      code: null,
      message: null,
    };
  }

  const probeError = new Error(probeResult.message || "tcp probe failed");
  probeError.code = probeResult.code;
  if (probeResult.originalError) {
    probeError.originalError = probeResult.originalError;
  }

  return {
    ...probeResult,
    failureReason: analyzeSshFailureReason(probeError),
    message:
      probeResult.message ||
      `ssh target ${sshConfig?.host}:${targetPort} is unavailable`,
  };
}

async function isSshPreflightReady(sshConfig, retryConfig) {
  const result = await checkSshPreflight(sshConfig, retryConfig);
  return result.ok === true;
}

async function waitForSshPreflight(
  sshConfig,
  retryConfig,
  { windowStartedAt = null, shouldAbort = null } = {},
) {
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  const intervalMs = Number(
    resolvedRetryConfig.networkProbe?.intervalMs || 3000,
  );
  const abortCheck =
    typeof shouldAbort === "function" ? shouldAbort : () => false;

  while (true) {
    if (abortCheck()) {
      return false;
    }

    if (isRetryWindowExpired(windowStartedAt, resolvedRetryConfig)) {
      return false;
    }

    try {
      if (await isSshPreflightReady(sshConfig, resolvedRetryConfig)) {
        return true;
      }
    } catch {
      // 预检失败视为暂不可用，继续等待重试窗口
    }

    const remainingMs = getRemainingRetryWindowMs(
      windowStartedAt,
      resolvedRetryConfig,
    );
    if (Number.isFinite(remainingMs) && remainingMs <= 0) {
      return false;
    }

    const sleepMs = Number.isFinite(remainingMs)
      ? Math.max(1, Math.min(intervalMs, remainingMs))
      : intervalMs;
    await sleep(sleepMs);
  }
}

function calculateRetryDelay({
  retryConfig,
  attempt,
  lastError,
  successRate = 1,
}) {
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  const attemptNumber = Math.max(1, Math.floor(attempt || 1));
  let delay;

  if (
    resolvedRetryConfig.fastReconnect?.enabled &&
    attemptNumber <= Number(resolvedRetryConfig.fastReconnect?.maxAttempts || 0)
  ) {
    const errorCode = String(lastError?.code || "").toUpperCase();
    if (resolvedRetryConfig.fastReconnect.conditions.includes(errorCode)) {
      delay = Number(resolvedRetryConfig.fastReconnect.delay || 500);
    }
  }

  if (delay === undefined) {
    if (resolvedRetryConfig.useExponentialBackoff) {
      const exponentialDelay =
        Number(resolvedRetryConfig.initialDelay || 1000) *
        Math.pow(
          Number(resolvedRetryConfig.exponentialFactor || 2),
          attemptNumber - 1,
        );
      const cappedDelay = Math.min(
        exponentialDelay,
        Number(resolvedRetryConfig.maxDelay || 30000),
      );
      const jitter = Math.random() * Number(resolvedRetryConfig.jitter || 0);
      delay = Math.round(cappedDelay + jitter);
    } else {
      delay = Number(resolvedRetryConfig.initialDelay || 1000);
    }
  }

  if (
    resolvedRetryConfig.smartReconnect?.enabled &&
    resolvedRetryConfig.smartReconnect?.adaptiveDelay &&
    Number(successRate) <
      Number(resolvedRetryConfig.smartReconnect?.networkQualityThreshold || 0)
  ) {
    delay = Math.round(delay * 1.5);
  }

  return Math.max(0, Math.floor(delay || 0));
}

async function createManagedSshConnection(sshConfig, options = {}) {
  const ClientCtor = options.ClientCtor || Client;
  const processedConfig = await processSSHPrivateKeyAsync(sshConfig);
  const networkProfile = resolveSshNetworkProfile(processedConfig);
  const baseTimeout = Math.max(15000, networkProfile.readyTimeout + 5000);
  const connectionTimeoutMs = Number.isFinite(options.connectionTimeoutMs)
    ? Math.max(1000, Math.floor(options.connectionTimeoutMs))
    : typeof processedConfig.hostVerifier === "function"
      ? Math.max(baseTimeout, 5 * 60 * 1000)
      : baseTimeout;

  return new Promise((resolve, reject) => {
    const ssh = new ClientCtor();
    let proxySocket = null;
    let settled = false;
    let cleanedUp = false;
    let timeoutId = null;

    const removeSetupListeners = () => {
      ssh.removeListener("ready", onReady);
      ssh.removeListener("error", onError);
      ssh.removeListener("close", onClose);
    };

    const cleanup = () => {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;

      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      try {
        removeSetupListeners();
      } catch {
        /* intentionally ignored */
      }

      try {
        if (proxySocket && typeof proxySocket.destroy === "function") {
          proxySocket.destroy();
        }
      } catch {
        /* intentionally ignored */
      }

      try {
        if (
          ssh._sock &&
          ssh._sock !== proxySocket &&
          typeof ssh._sock.destroy === "function"
        ) {
          ssh._sock.destroy();
        }
      } catch {
        /* intentionally ignored */
      }

      try {
        if (typeof ssh.end === "function") {
          ssh.end();
        }
      } catch {
        /* intentionally ignored */
      }
    };

    const detach = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }

      try {
        removeSetupListeners();
      } catch {
        /* intentionally ignored */
      }
    };

    const finishResolve = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const finishReject = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };

    const connectionHandle = {
      client: ssh,
      proxySocket: null,
      processedConfig,
      networkProfile,
      connectionTimeoutMs,
      cleanup,
      detach,
      isClosed: () => cleanedUp,
    };

    timeoutId = setTimeout(() => {
      const error = new Error(
        isZhLanguage(processedConfig?.language)
          ? "连接超时"
          : "Connection timed out",
      );
      error.code = "ETIMEDOUT";
      cleanup();
      finishReject(error);
    }, connectionTimeoutMs);

    const onReady = () => {
      applySocketNetworkProfile(ssh._sock, networkProfile);
      detach();
      finishResolve(connectionHandle);
    };

    const onError = (error) => {
      if (cleanedUp) {
        return;
      }
      cleanup();
      finishReject(error);
    };

    const onClose = () => {
      if (cleanedUp) {
        return;
      }
      cleanup();
      finishReject(
        new Error(
          isZhLanguage(processedConfig?.language)
            ? "连接已关闭"
            : "Connection closed",
        ),
      );
    };

    ssh.on("ready", onReady);
    ssh.on("error", onError);
    ssh.on("close", onClose);

    const connectionOptions = {
      host: processedConfig.host,
      port: processedConfig.port || 22,
      username: processedConfig.username,
      algorithms: getBasicSSHAlgorithms(),
      keepaliveInterval: networkProfile.keepaliveInterval,
      keepaliveCountMax: networkProfile.keepaliveCountMax,
      readyTimeout: networkProfile.readyTimeout,
    };

    if (processedConfig.password) {
      connectionOptions.password = processedConfig.password;
    }
    if (processedConfig.privateKey) {
      connectionOptions.privateKey = processedConfig.privateKey;
    }
    if (processedConfig.passphrase) {
      connectionOptions.passphrase = processedConfig.passphrase;
    }
    if (processedConfig.hostHash) {
      connectionOptions.hostHash = processedConfig.hostHash;
    }
    if (typeof processedConfig.hostVerifier === "function") {
      connectionOptions.hostVerifier = processedConfig.hostVerifier;
    }

    (async () => {
      try {
        const resolvedProxyConfig =
          await proxyManager.resolveProxyConfigAsync(processedConfig);
        const usingProxy =
          resolvedProxyConfig &&
          proxyManager.isValidProxyConfig(resolvedProxyConfig) &&
          String(resolvedProxyConfig.type || "").toLowerCase() !== "none";

        if (usingProxy) {
          const sock = await proxyManager.createTunnelSocket(
            resolvedProxyConfig,
            processedConfig.host,
            processedConfig.port || 22,
            { timeoutMs: connectionTimeoutMs },
          );
          applySocketNetworkProfile(sock, networkProfile);
          proxySocket = sock;
          connectionHandle.proxySocket = sock;
          connectionOptions.sock = sock;
        }

        ssh.connect(connectionOptions);
      } catch (error) {
        cleanup();
        finishReject(error);
      }
    })();
  });
}

module.exports = {
  DEFAULT_SSH_RETRY_CONFIG,
  FAILURE_REASON,
  buildSshRetryConfig,
  analyzeSshFailureReason,
  getEffectiveMaxRetries,
  getRemainingRetryWindowMs,
  getRetryWindowExpiresAt,
  isRetryWindowExpired,
  formatRetryWindowLabel,
  buildReconnectTimeoutMessage,
  buildReconnectWaitMessage,
  checkSshPreflight,
  waitForSshPreflight,
  calculateRetryDelay,
  createManagedSshConnection,
  sleep,
};
