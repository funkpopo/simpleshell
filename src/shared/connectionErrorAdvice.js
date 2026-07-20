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
  const isZh = isZhLanguage(language || config.language);
  const endpoint = getEndpoint(config);
  const target = endpoint ? (isZh ? `（${endpoint}）` : ` (${endpoint})`) : "";

  const zh = {
    [CONNECTION_FAILURE_KINDS.DNS]: {
      title: "主机名无法解析",
      message: `主机名无法解析${target}`,
      suggestion: "检查主机名/DNS，或改用服务器 IP。",
    },
    [CONNECTION_FAILURE_KINDS.PORT]: {
      title: "端口无法连接",
      message: `端口拒绝连接${target}`,
      suggestion: "确认端口号正确，SSH/Telnet 服务已启动。",
    },
    [CONNECTION_FAILURE_KINDS.AUTH]: {
      title: "认证失败",
      message: "认证失败",
      suggestion: "检查用户名、密码/私钥和服务器允许的认证方式。",
    },
    [CONNECTION_FAILURE_KINDS.PROXY]: {
      title: "代理不可用",
      message: "代理连接失败",
      suggestion: "检查代理地址、端口、账号密码，确认代理/VPN 已连接。",
    },
    [CONNECTION_FAILURE_KINDS.HOST_KEY]: {
      title: "主机密钥已变化",
      message: "主机密钥与本地记录不一致",
      suggestion: "确认服务器身份；可信后重新信任该主机密钥。",
    },
    [CONNECTION_FAILURE_KINDS.FIREWALL]: {
      title: "网络或防火墙阻断",
      message: `连接超时或主机不可达${target}`,
      suggestion: "检查网络/VPN、防火墙、安全组和端口放行。",
    },
    [CONNECTION_FAILURE_KINDS.PRIVATE_KEY_PERMISSION]: {
      title: "私钥权限异常",
      message: "私钥文件无法读取或权限不安全",
      suggestion: "确认私钥路径可读；在类 Unix 系统将权限设为 600 或 400。",
    },
    [CONNECTION_FAILURE_KINDS.NETWORK]: {
      title: "连接中断",
      message: "连接被网络或服务器中断",
      suggestion: "检查网络稳定性、VPN/代理和服务器 SSH/Telnet 服务状态。",
    },
    [CONNECTION_FAILURE_KINDS.CANCELLED]: {
      title: "连接已取消",
      message: "连接已取消",
      suggestion: "需要连接时请重新发起。",
    },
    [CONNECTION_FAILURE_KINDS.UNKNOWN]: {
      title: "连接失败",
      message: `连接失败${target}`,
      suggestion: "检查主机、端口、认证、代理和网络策略。",
    },
  };

  const en = {
    [CONNECTION_FAILURE_KINDS.DNS]: {
      title: "Host cannot be resolved",
      message: `Host cannot be resolved${target}`,
      suggestion: "Check the hostname/DNS, or use the server IP.",
    },
    [CONNECTION_FAILURE_KINDS.PORT]: {
      title: "Port is not reachable",
      message: `Connection refused by the port${target}`,
      suggestion: "Confirm the port and that SSH/Telnet service is running.",
    },
    [CONNECTION_FAILURE_KINDS.AUTH]: {
      title: "Authentication failed",
      message: "Authentication failed",
      suggestion: "Check username, password/key, and allowed auth methods.",
    },
    [CONNECTION_FAILURE_KINDS.PROXY]: {
      title: "Proxy unavailable",
      message: "Proxy connection failed",
      suggestion: "Check proxy host, port, credentials, and VPN/proxy status.",
    },
    [CONNECTION_FAILURE_KINDS.HOST_KEY]: {
      title: "Host key changed",
      message: "Host key does not match the local record",
      suggestion: "Verify the server identity, then trust the host key again.",
    },
    [CONNECTION_FAILURE_KINDS.FIREWALL]: {
      title: "Network or firewall blocked",
      message: `Connection timed out or host is unreachable${target}`,
      suggestion: "Check network/VPN, firewall, security group, and port rules.",
    },
    [CONNECTION_FAILURE_KINDS.PRIVATE_KEY_PERMISSION]: {
      title: "Private key permission issue",
      message: "Private key cannot be read or has unsafe permissions",
      suggestion: "Confirm the key path is readable; on Unix use 600 or 400.",
    },
    [CONNECTION_FAILURE_KINDS.NETWORK]: {
      title: "Connection interrupted",
      message: "Connection was interrupted by network or server",
      suggestion: "Check network stability, VPN/proxy, and remote service status.",
    },
    [CONNECTION_FAILURE_KINDS.CANCELLED]: {
      title: "Connection cancelled",
      message: "Connection cancelled",
      suggestion: "Start the connection again when needed.",
    },
    [CONNECTION_FAILURE_KINDS.UNKNOWN]: {
      title: "Connection failed",
      message: `Connection failed${target}`,
      suggestion: "Check host, port, authentication, proxy, and network policy.",
    },
  };

  return {
    schemaVersion: 1,
    kind,
    code,
    ...(isZh ? zh[kind] : en[kind]),
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
