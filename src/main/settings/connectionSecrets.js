/**
 * 连接凭据的进程边界：密码与代理密码只保留在主进程。
 *
 * - redactConnectionSecrets: 发往渲染进程前清空密钥，仅保留 hasPassword 标记与
 *   不可逆的 credentialRevision（HMAC，密钥仅存在于当前主进程内存）。
 * - hydrateConnectionSecrets: 渲染进程回传被清空的配置时，按连接 id 从已保存配置补齐。
 *
 * 与 AI 设置的 hasApiKey / hasProxyPassword 约定保持一致。
 */
const crypto = require("crypto");
const { indexConnections } = require("../../shared/connectionConfigSync");

const REVISION_KEY = crypto.randomBytes(32);
const RENDERER_ONLY_FIELDS = ["hasPassword", "credentialRevision"];

function computeCredentialRevision(connection) {
  const password = connection?.password || "";
  const proxyPassword = connection?.proxy?.password || "";
  if (!password && !proxyPassword) {
    return "";
  }
  return crypto
    .createHmac("sha256", REVISION_KEY)
    .update(password)
    .update("\0")
    .update(proxyPassword)
    .digest("hex")
    .slice(0, 16);
}

function redactProxy(proxy) {
  if (!proxy || typeof proxy !== "object") {
    return proxy;
  }
  return {
    ...proxy,
    password: "",
    hasPassword: Boolean(proxy.password),
  };
}

function redactConnection(connection) {
  return {
    ...connection,
    password: "",
    hasPassword: Boolean(connection.password),
    credentialRevision: computeCredentialRevision(connection),
    proxy: redactProxy(connection.proxy),
  };
}

function redactConnectionSecrets(items) {
  if (!Array.isArray(items)) {
    return items;
  }
  return items.map((item) => {
    if (!item || typeof item !== "object") {
      return item;
    }
    if (item.type === "group" && Array.isArray(item.items)) {
      return { ...item, items: redactConnectionSecrets(item.items) };
    }
    if (item.type === "connection") {
      return redactConnection(item);
    }
    return item;
  });
}

function stripRendererOnlyFields(config) {
  const result = { ...config };
  for (const field of RENDERER_ONLY_FIELDS) {
    delete result[field];
  }
  delete result._preservePassword;
  if (result.proxy && typeof result.proxy === "object") {
    const proxy = { ...result.proxy };
    delete proxy.hasPassword;
    result.proxy = proxy;
  }
  return result;
}

function findSavedConnection(config, sources) {
  const keys = [config.connectionId, config.id, config.serverKey].filter(
    (key) => typeof key === "string" && key,
  );
  for (const load of sources) {
    let index;
    try {
      index = indexConnections(load());
    } catch {
      continue;
    }
    for (const key of keys) {
      const saved = index.get(key);
      if (saved) {
        return saved;
      }
    }
  }
  return null;
}

/**
 * 为来自渲染进程的连接配置补齐被清空的密钥。
 * @param {object} config 渲染进程回传的连接配置
 * @param {{ loadConnections: () => any[], loadLastConnections?: () => any[] }} store
 */
function hydrateConnectionSecrets(config, store) {
  if (!config || typeof config !== "object") {
    return config;
  }

  const needsPassword =
    !config.password &&
    (config._preservePassword === true || config.hasPassword === true);
  const needsProxyPassword =
    config.proxy &&
    typeof config.proxy === "object" &&
    !config.proxy.password &&
    config.proxy.hasPassword === true;

  const result = stripRendererOnlyFields(config);
  if (!needsPassword && !needsProxyPassword) {
    return result;
  }

  const sources = [() => store.loadConnections()];
  if (typeof store.loadLastConnections === "function") {
    sources.push(() => store.loadLastConnections());
  }
  const saved = findSavedConnection(config, sources);
  if (!saved) {
    return result;
  }

  if (needsPassword && saved.password) {
    result.password = saved.password;
  }
  if (needsProxyPassword && saved.proxy?.password) {
    result.proxy = { ...result.proxy, password: saved.proxy.password };
  }
  return result;
}

module.exports = {
  computeCredentialRevision,
  hydrateConnectionSecrets,
  redactConnectionSecrets,
  redactProxy,
};
