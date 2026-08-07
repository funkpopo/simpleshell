const net = require("node:net");
const { Client } = require("ssh2");

const proxyManager = require("../proxy/proxy-manager");
const { getBasicSSHAlgorithms } = require("../../constants/sshAlgorithms");
const {
  processSSHPrivateKeyAsync,
  buildSshConnectOptions,
} = require("../utils/ssh-utils");
const {
  resolveSshNetworkProfile,
  applySocketNetworkProfile,
} = require("../utils/ssh-network-profile");
const { t: mainT, normalizeLanguage } = require("../../shared/mainI18n");
const { sleep } = require("../../shared/common");
const {
  isAuthErrorMessage,
  isTimeoutErrorMessage,
} = require("../../shared/errorClassification");

// 唯一默认策略：弱网/VPN 友好（更长总窗口、温和指数退避、瞬时闪断快恢）。
const DEFAULT_SSH_RETRY_CONFIG = Object.freeze({
  maxRetries: 10,
  initialDelay: 1500,
  maxDelay: 20_000,
  exponentialFactor: 1.6,
  jitter: 400,
  totalTimeCapMs: 120_000,
  networkProbe: {
    enabled: true,
    intervalMs: 1000,
    tcpTimeoutMs: 2000,
  },
  useExponentialBackoff: true,
  fastReconnect: {
    enabled: true,
    maxAttempts: 2,
    delay: 500,
    conditions: ["ECONNRESET", "EPIPE"],
  },
  smartReconnect: {
    enabled: true,
    analyzePattern: false,
    adaptiveDelay: true,
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

  if (isAuthErrorMessage(errorMessage)) {
    return FAILURE_REASON.AUTHENTICATION;
  }

  if (isTimeoutErrorMessage(errorMessage) || errorCode === "ETIMEDOUT") {
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

function formatRetryWindowLabel(durationMs, language = "zh-CN") {
  const lng = normalizeLanguage(language);
  const normalizedMs = Number(durationMs || 0);
  if (!Number.isFinite(normalizedMs) || normalizedMs <= 0) {
    return mainT("mainProcess.reconnect.durationZero", { lng });
  }

  if (normalizedMs < 60_000) {
    const seconds = normalizedMs / 1000;
    const rendered = Number.isInteger(seconds)
      ? String(seconds)
      : seconds.toFixed(1).replace(/\.0$/, "");
    return mainT("mainProcess.reconnect.durationSeconds", {
      lng,
      value: rendered,
    });
  }

  const minutes = normalizedMs / 60_000;
  const rendered = Number.isInteger(minutes)
    ? String(minutes)
    : minutes.toFixed(1).replace(/\.0$/, "");
  return mainT("mainProcess.reconnect.durationMinutes", {
    lng,
    value: rendered,
  });
}

function buildReconnectTimeoutMessage(retryConfig, language = "zh-CN") {
  const lng = normalizeLanguage(language);
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  const duration = formatRetryWindowLabel(
    resolvedRetryConfig.totalTimeCapMs,
    lng,
  );
  return mainT("mainProcess.reconnect.timeout", { lng, duration });
}

function buildReconnectWaitMessage(retryConfig, language = "zh-CN") {
  const lng = normalizeLanguage(language);
  const resolvedRetryConfig = buildSshRetryConfig(retryConfig);
  const duration = formatRetryWindowLabel(
    resolvedRetryConfig.totalTimeCapMs,
    lng,
  );
  return mainT("mainProcess.reconnect.waiting", { lng, duration });
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

function applyRetryJitter(baseDelay, jitterMs) {
  const delay = Math.max(0, Number(baseDelay) || 0);
  const jitter = Math.max(0, Number(jitterMs) || 0);
  if (jitter <= 0) {
    return Math.round(delay);
  }

  // 对称抖动：delay ± (0..jitter)，避免多会话同时撞车
  const offset = Math.random() * jitter * 2 - jitter;
  return Math.max(0, Math.round(delay + offset));
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
  let skipJitter = false;

  if (
    resolvedRetryConfig.fastReconnect?.enabled &&
    attemptNumber <= Number(resolvedRetryConfig.fastReconnect?.maxAttempts || 0)
  ) {
    const errorCode = String(lastError?.code || "").toUpperCase();
    const conditions = Array.isArray(
      resolvedRetryConfig.fastReconnect.conditions,
    )
      ? resolvedRetryConfig.fastReconnect.conditions
      : [];
    if (conditions.includes(errorCode)) {
      delay = Number(resolvedRetryConfig.fastReconnect.delay || 500);
      // 快恢路径仅加少量抖动，保持“瞬时恢复”体感
      skipJitter = true;
      delay = applyRetryJitter(delay, Math.min(100, delay * 0.2));
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
      delay = Math.min(
        exponentialDelay,
        Number(resolvedRetryConfig.maxDelay || 30000),
      );
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
    delay = Math.round(Number(delay) * 1.5);
  }

  if (!skipJitter) {
    delay = applyRetryJitter(delay, resolvedRetryConfig.jitter);
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
        mainT("mainProcess.reconnect.connectionTimeoutShort", {
          lng: normalizeLanguage(processedConfig?.language),
        }),
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
          mainT("mainProcess.reconnect.connectionClosedShort", {
            lng: normalizeLanguage(processedConfig?.language),
          }),
        ),
      );
    };

    ssh.on("ready", onReady);
    ssh.on("error", onError);
    ssh.on("close", onClose);

    const connectionOptions = buildSshConnectOptions(processedConfig, {
      networkProfile,
      algorithms: getBasicSSHAlgorithms(),
    });

    if (processedConfig.passphrase) {
      connectionOptions.passphrase = processedConfig.passphrase;
    }
    if (processedConfig.hostHash) {
      connectionOptions.hostHash = processedConfig.hostHash;
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
