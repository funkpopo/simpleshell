const SUPPORTED_PROXY_TYPES = new Set(["http", "https", "socks4", "socks5"]);
let latestNativeSidecarNetworkPath = buildNetworkPath(null, false);

function getConnectionManager() {
  try {
    return require("../../modules/connection");
  } catch {
    return null;
  }
}

function normalizeProxyConfig(proxyConfig) {
  if (!proxyConfig || typeof proxyConfig !== "object") {
    return null;
  }

  const type = String(proxyConfig.type || "")
    .trim()
    .toLowerCase();
  const host = String(proxyConfig.host || "").trim();
  const port = Number(proxyConfig.port);

  if (!SUPPORTED_PROXY_TYPES.has(type) || !host || !Number.isFinite(port)) {
    return null;
  }

  return {
    type,
    host,
    port,
    username: proxyConfig.username || undefined,
    password: proxyConfig.password || undefined,
    source: proxyConfig.source || undefined,
  };
}

function sanitizeProxyConfig(proxyConfig) {
  const normalized = normalizeProxyConfig(proxyConfig);
  if (!normalized) {
    return null;
  }

  return {
    type: normalized.type,
    host: normalized.host,
    port: normalized.port,
    source: normalized.source || "connection",
    hasAuth: Boolean(proxyConfig.hasAuth || normalized.username || normalized.password),
  };
}

function buildNetworkPath(proxyConfig, proxyRequired = false) {
  const safeProxy = sanitizeProxyConfig(proxyConfig);
  if (proxyRequired && safeProxy) {
    return {
      mode: "proxy",
      proxyRequired: true,
      proxy: safeProxy,
    };
  }

  return {
    mode: "direct",
    proxyRequired: false,
    proxy: null,
  };
}

function recordNativeSidecarNetworkPath(networkPath) {
  if (!networkPath || typeof networkPath !== "object") {
    return latestNativeSidecarNetworkPath;
  }

  latestNativeSidecarNetworkPath =
    networkPath.mode === "proxy"
      ? buildNetworkPath(networkPath.proxy, true)
      : buildNetworkPath(null, false);
  return latestNativeSidecarNetworkPath;
}

function getLatestNativeSidecarNetworkPath() {
  return latestNativeSidecarNetworkPath;
}

function hasProxyIntent(rawConfig) {
  return Boolean(rawConfig && rawConfig.proxy && typeof rawConfig.proxy === "object");
}

function createProxyResolutionError(message, details = {}) {
  const error = new Error(message);
  error.code = details.code || "NATIVE_SFTP_PROXY_REQUIRED";
  error.errorCode = error.code;
  error.errorKind = "proxy";
  error.retryable = details.retryable !== false;
  error.module = details.module || "native-sftp-client";
  return error;
}

async function resolveNativeSidecarNetworkPath(rawConfig, options = {}) {
  const proxyIntent = hasProxyIntent(rawConfig);
  if (!proxyIntent) {
    return {
      proxy: null,
      proxyRequired: false,
      networkPath: buildNetworkPath(null, false),
    };
  }

  const proxyManager =
    options.proxyManager ||
    getConnectionManager()?.sshConnectionPool?.proxyManager ||
    null;

  if (!proxyManager || typeof proxyManager.resolveProxyConfigAsync !== "function") {
    throw createProxyResolutionError(
      "Native sidecar transfer requires proxy resolution, but ProxyManager is unavailable",
      { retryable: true },
    );
  }

  let resolvedProxy = null;
  try {
    resolvedProxy = await proxyManager.resolveProxyConfigAsync(rawConfig);
  } catch (error) {
    throw createProxyResolutionError(
      `Native sidecar proxy resolution failed: ${error?.message || String(error)}`,
      { retryable: true },
    );
  }

  const normalizedProxy = normalizeProxyConfig(resolvedProxy);
  if (!normalizedProxy) {
    return {
      proxy: null,
      proxyRequired: false,
      networkPath: buildNetworkPath(null, false),
    };
  }

  return {
    proxy: normalizedProxy,
    proxyRequired: true,
    networkPath: buildNetworkPath(normalizedProxy, true),
  };
}

module.exports = {
  SUPPORTED_PROXY_TYPES,
  normalizeProxyConfig,
  sanitizeProxyConfig,
  buildNetworkPath,
  recordNativeSidecarNetworkPath,
  getLatestNativeSidecarNetworkPath,
  hasProxyIntent,
  resolveNativeSidecarNetworkPath,
};
