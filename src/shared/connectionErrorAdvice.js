const CONNECTION_FAILURE_KINDS = Object.freeze({
  DNS: "dns",
  PORT: "port",
  AUTH: "auth",
  PROXY: "proxy",
  HOST_KEY: "host-key",
  FIREWALL: "firewall",
  PRIVATE_KEY_PERMISSION: "private-key-permission",
  NETWORK: "network",
  CANCELLED: "cancelled",
  UNKNOWN: "unknown",
});

function isZhLanguage(language) {
  return String(language || "zh-CN")
    .toLowerCase()
    .startsWith("zh");
}

function normalizeText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  return String(
    value.message ||
      value.error ||
      value.reason ||
      value.statusText ||
      value.type ||
      "",
  );
}

function normalizeCode(error) {
  if (!error || typeof error !== "object") {
    return "";
  }
  return String(
    error.errorCode ||
      error.code ||
      error.originalError?.code ||
      error.raw?.errorCode ||
      error.raw?.code ||
      "",
  ).toUpperCase();
}

function hasPrivateKeyContext(config, message) {
  return (
    config?.authType === "privateKey" ||
    Boolean(config?.privateKeyPath) ||
    /private key|publickey|identity file|密钥|私钥/i.test(message)
  );
}

function detectConnectionFailureKind(error, config = {}) {
  const message = normalizeText(error);
  const lower = message.toLowerCase();
  const code = normalizeCode(error);
  const usingProxy =
    config?.usingProxy === true ||
    config?.proxy ||
    error?.sshConfig?.usingProxy === true ||
    error?.telnetConfig?.usingProxy === true;

  if (/cancel(l)?ed/i.test(message) || message.includes("取消")) {
    return CONNECTION_FAILURE_KINDS.CANCELLED;
  }

  if (
    lower.includes("host verification failed") ||
    lower.includes("host key verification") ||
    lower.includes("fingerprint") ||
    lower.includes("host fingerprint") ||
    lower.includes("主机指纹") ||
    lower.includes("主机密钥")
  ) {
    return CONNECTION_FAILURE_KINDS.HOST_KEY;
  }

  if (
    usingProxy &&
    (code === "EPROXYUNAVAILABLE" ||
      lower.includes("proxy") ||
      lower.includes("代理") ||
      lower.includes("socks"))
  ) {
    return CONNECTION_FAILURE_KINDS.PROXY;
  }

  if (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    lower.includes("getaddrinfo") ||
    lower.includes("dns") ||
    lower.includes("hostname") ||
    lower.includes("主机不存在") ||
    lower.includes("无法解析")
  ) {
    return CONNECTION_FAILURE_KINDS.DNS;
  }

  if (
    code === "ECONNREFUSED" ||
    lower.includes("connection refused") ||
    lower.includes("econnrefused") ||
    lower.includes("连接被拒绝")
  ) {
    return CONNECTION_FAILURE_KINDS.PORT;
  }

  if (
    code === "EACCES" ||
    code === "EPERM" ||
    lower.includes("bad permissions") ||
    lower.includes("unprotected private key") ||
    (lower.includes("private key") && lower.includes("permission")) ||
    lower.includes("私钥权限")
  ) {
    return hasPrivateKeyContext(config, message)
      ? CONNECTION_FAILURE_KINDS.PRIVATE_KEY_PERMISSION
      : CONNECTION_FAILURE_KINDS.AUTH;
  }

  if (
    lower.includes("authentication") ||
    lower.includes("auth fail") ||
    lower.includes("configured authentication methods failed") ||
    lower.includes("permission denied") ||
    lower.includes("publickey") ||
    lower.includes("password") ||
    lower.includes("认证失败") ||
    lower.includes("身份验证")
  ) {
    return CONNECTION_FAILURE_KINDS.AUTH;
  }

  if (
    code === "ETIMEDOUT" ||
    code === "ETIMEOUT" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("host unreachable") ||
    lower.includes("network unreachable") ||
    lower.includes("连接超时") ||
    lower.includes("网络不可达") ||
    lower.includes("主机不可达")
  ) {
    return CONNECTION_FAILURE_KINDS.FIREWALL;
  }

  if (
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    lower.includes("connection reset") ||
    lower.includes("socket hang up") ||
    lower.includes("连接被重置")
  ) {
    return CONNECTION_FAILURE_KINDS.NETWORK;
  }

  if (usingProxy) {
    return CONNECTION_FAILURE_KINDS.PROXY;
  }

  return CONNECTION_FAILURE_KINDS.UNKNOWN;
}

function getEndpoint(config = {}) {
  const host = config.host || config.sshConfig?.host || config.telnetConfig?.host;
  const port =
    config.port ||
    config.sshConfig?.port ||
    config.telnetConfig?.port ||
    (config.protocol === "telnet" ? 23 : 22);
  if (!host) {
    return "";
  }
  return `${host}:${port}`;
}

function buildAdvice(kind, { language, config = {}, code = null } = {}) {
  // Lazy require avoids circular init with mainI18n → locales.
  const { t: mainT, normalizeLanguage } = require("./mainI18n");
  const lng = normalizeLanguage(language || config.language);
  const endpoint = getEndpoint(config);
  const target = endpoint
    ? mainT("connectionAdvice.targetPrefix", { lng, endpoint })
    : "";

  // Static keys keep check-i18n coverage accurate.
  let title;
  let message;
  let suggestion;
  switch (kind) {
    case CONNECTION_FAILURE_KINDS.DNS:
      title = mainT("connectionAdvice.dns.title", { lng });
      message = mainT("connectionAdvice.dns.message", { lng, target });
      suggestion = mainT("connectionAdvice.dns.suggestion", { lng });
      break;
    case CONNECTION_FAILURE_KINDS.PORT:
      title = mainT("connectionAdvice.port.title", { lng });
      message = mainT("connectionAdvice.port.message", { lng, target });
      suggestion = mainT("connectionAdvice.port.suggestion", { lng });
      break;
    case CONNECTION_FAILURE_KINDS.AUTH:
      title = mainT("connectionAdvice.auth.title", { lng });
      message = mainT("connectionAdvice.auth.message", { lng, target });
      suggestion = mainT("connectionAdvice.auth.suggestion", { lng });
      break;
    case CONNECTION_FAILURE_KINDS.PROXY:
      title = mainT("connectionAdvice.proxy.title", { lng });
      message = mainT("connectionAdvice.proxy.message", { lng, target });
      suggestion = mainT("connectionAdvice.proxy.suggestion", { lng });
      break;
    case CONNECTION_FAILURE_KINDS.HOST_KEY:
      title = mainT("connectionAdvice.host-key.title", { lng });
      message = mainT("connectionAdvice.host-key.message", { lng, target });
      suggestion = mainT("connectionAdvice.host-key.suggestion", { lng });
      break;
    case CONNECTION_FAILURE_KINDS.FIREWALL:
      title = mainT("connectionAdvice.firewall.title", { lng });
      message = mainT("connectionAdvice.firewall.message", { lng, target });
      suggestion = mainT("connectionAdvice.firewall.suggestion", { lng });
      break;
    case CONNECTION_FAILURE_KINDS.PRIVATE_KEY_PERMISSION:
      title = mainT("connectionAdvice.private-key-permission.title", { lng });
      message = mainT("connectionAdvice.private-key-permission.message", {
        lng,
        target,
      });
      suggestion = mainT("connectionAdvice.private-key-permission.suggestion", {
        lng,
      });
      break;
    case CONNECTION_FAILURE_KINDS.NETWORK:
      title = mainT("connectionAdvice.network.title", { lng });
      message = mainT("connectionAdvice.network.message", { lng, target });
      suggestion = mainT("connectionAdvice.network.suggestion", { lng });
      break;
    case CONNECTION_FAILURE_KINDS.CANCELLED:
      title = mainT("connectionAdvice.cancelled.title", { lng });
      message = mainT("connectionAdvice.cancelled.message", { lng, target });
      suggestion = mainT("connectionAdvice.cancelled.suggestion", { lng });
      break;
    case CONNECTION_FAILURE_KINDS.UNKNOWN:
    default:
      title = mainT("connectionAdvice.unknown.title", { lng });
      message = mainT("connectionAdvice.unknown.message", { lng, target });
      suggestion = mainT("connectionAdvice.unknown.suggestion", { lng });
      break;
  }

  return {
    schemaVersion: 1,
    kind,
    code,
    title,
    message,
    suggestion,
  };
}

function classifyConnectionFailure(error, config = {}) {
  const kind = detectConnectionFailureKind(error, config);
  const code = normalizeCode(error) || null;
  return buildAdvice(kind, {
    language: config.language || error?.sshConfig?.language,
    config,
    code,
  });
}

module.exports = {
  CONNECTION_FAILURE_KINDS,
  classifyConnectionFailure,
  detectConnectionFailureKind,
  isZhLanguage,
};
