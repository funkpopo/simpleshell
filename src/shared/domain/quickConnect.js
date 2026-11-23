// @ts-check

const { generateId } = require("../common");
const { isIP } = require("./ip");

const QUICK_CONNECT_PROTOCOLS = Object.freeze(["ssh", "telnet"]);
const DEFAULT_PORT_BY_PROTOCOL = Object.freeze({
  ssh: 22,
  telnet: 23,
});

/** @typedef {"ssh" | "telnet"} QuickConnectProtocol */

/**
 * @typedef {object} ParsedQuickConnectTarget
 * @property {QuickConnectProtocol} protocol
 * @property {string} host
 * @property {number} port
 * @property {string} username
 */

/**
 * @typedef {object} TransientQuickConnectConnection
 * @property {string} id
 * @property {"connection"} type
 * @property {true} isTransient
 * @property {string} name
 * @property {string} host
 * @property {number} port
 * @property {string} username
 * @property {string} password
 * @property {"password"} authType
 * @property {string} privateKeyPath
 * @property {QuickConnectProtocol} protocol
 * @property {number} createdAt
 */

/**
 * @param {string} rawPort
 * @returns {number | null}
 */
function parseStrictPort(rawPort) {
  if (!/^\d+$/.test(rawPort)) {
    return null;
  }
  const numeric = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    return null;
  }
  return numeric;
}

/**
 * Validates IPv6 literal with optional `%zone` interface suffix.
 * @param {string} candidate
 * @returns {boolean}
 */
function isValidIpv6WithOptionalZone(candidate) {
  if (!candidate) return false;
  const zoneIndex = candidate.indexOf("%");
  if (zoneIndex === -1) {
    return isIP(candidate) === 6;
  }
  const base = candidate.slice(0, zoneIndex);
  const zone = candidate.slice(zoneIndex + 1);
  if (!base || !zone) return false;
  if (zone.includes("%")) return false;
  return isIP(base) === 6 && /^[A-Za-z0-9_.-]+$/.test(zone);
}

/**
 * Validates hostname / IPv4 / IPv6 host strings.
 * @param {string} host
 * @returns {{ ok: true } | { ok: false, errorCode: string, error: string }}
 */
function validateQuickConnectHost(host) {
  if (!host) {
    return {
      ok: false,
      errorCode: "EMPTY_HOST",
      error: "Host address is required",
    };
  }
  if (isIP(host) === 4 || isValidIpv6WithOptionalZone(host)) {
    return { ok: true };
  }
  if (/^\d+(?:\.\d+){3}$/.test(host)) {
    return {
      ok: false,
      errorCode: "INVALID_HOST",
      error: "Invalid IPv4 address",
    };
  }
  if (host.includes(":") || host.includes("..")) {
    return {
      ok: false,
      errorCode: "INVALID_HOST",
      error: "Invalid host address",
    };
  }
  if (!/^[A-Za-z0-9_](?:[A-Za-z0-9._-]*[A-Za-z0-9_])?$/.test(host)) {
    return {
      ok: false,
      errorCode: "INVALID_HOST",
      error: "Invalid host name",
    };
  }
  return { ok: true };
}

/**
 * Parses quick connect strings such as:
 * - `user@host`
 * - `user@host:2222`
 * - `ssh://user@host:port`
 * - `telnet://host:port`
 * - `192.168.1.10`, `user@192.168.1.10:2222`
 * - `[::1]:2222`, `user@[2001:db8::1]:2222`, `ssh://user@[2001:db8::1]:2222`
 *
 * @param {unknown} rawInput
 * @returns {{ ok: true, value: ParsedQuickConnectTarget } | { ok: false, errorCode: string, error: string }}
 */
function parseQuickConnectTarget(rawInput) {
  if (typeof rawInput !== "string") {
    return {
      ok: false,
      errorCode: "EMPTY",
      error: "Quick connect target is required",
    };
  }

  const trimmed = rawInput.trim();
  if (!trimmed) {
    return {
      ok: false,
      errorCode: "EMPTY",
      error: "Quick connect target is required",
    };
  }

  if (/\s/.test(trimmed)) {
    return {
      ok: false,
      errorCode: "INVALID_WHITESPACE",
      error: "Quick connect target cannot contain whitespace",
    };
  }

  /** @type {QuickConnectProtocol} */
  let protocol = "ssh";
  let hasScheme = false;
  let rest = trimmed;

  const schemeMatch = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== "ssh" && scheme !== "telnet") {
      return {
        ok: false,
        errorCode: "UNSUPPORTED_SCHEME",
        error: "Only ssh:// and telnet:// schemes are supported",
      };
    }
    protocol = scheme;
    hasScheme = true;
    rest = schemeMatch[2];
  }

  if (rest.endsWith("/")) {
    rest = rest.slice(0, -1);
  }
  if (/[/?#]/.test(rest)) {
    return {
      ok: false,
      errorCode: "INVALID_HOST",
      error: "Quick connect target cannot include path or query parameters",
    };
  }

  const defaultPort = DEFAULT_PORT_BY_PROTOCOL[protocol];
  let username = "";
  let hostPart = rest;

  const atIndex = rest.lastIndexOf("@");
  if (atIndex !== -1) {
    if (rest.indexOf("@") !== atIndex) {
      return {
        ok: false,
        errorCode: "INVALID_FORMAT",
        error: "Malformed user@host target",
      };
    }
    const rawUser = rest.slice(0, atIndex);
    hostPart = rest.slice(atIndex + 1);
    if (!rawUser) {
      return {
        ok: false,
        errorCode: "EMPTY_USERNAME",
        error: "Username before @ cannot be empty",
      };
    }
    let decodedUser = rawUser;
    if (hasScheme) {
      try {
        decodedUser = decodeURIComponent(rawUser);
      } catch {
        return {
          ok: false,
          errorCode: "INVALID_USERNAME",
          error: "Invalid username encoding",
        };
      }
    }
    if (!decodedUser || /\s/.test(decodedUser) || decodedUser.includes(":")) {
      return {
        ok: false,
        errorCode: "INVALID_USERNAME",
        error: "Invalid username in quick connect target",
      };
    }
    username = decodedUser;
  }

  if (!hostPart) {
    return {
      ok: false,
      errorCode: "EMPTY_HOST",
      error: "Host address is required",
    };
  }

  let host = "";
  /** @type {number} */
  let port = defaultPort;

  if (hostPart.startsWith("[")) {
    const closeBracketIndex = hostPart.indexOf("]");
    if (closeBracketIndex <= 1) {
      return {
        ok: false,
        errorCode: "INVALID_IPV6",
        error: "Malformed IPv6 bracket notation",
      };
    }
    host = hostPart.slice(1, closeBracketIndex);
    if (!isValidIpv6WithOptionalZone(host)) {
      return {
        ok: false,
        errorCode: "INVALID_IPV6",
        error: "Invalid IPv6 address",
      };
    }
    const afterBracket = hostPart.slice(closeBracketIndex + 1);
    if (afterBracket) {
      if (!afterBracket.startsWith(":")) {
        return {
          ok: false,
          errorCode: "INVALID_HOST",
          error: "Unexpected characters after IPv6 address",
        };
      }
      const parsedPort = parseStrictPort(afterBracket.slice(1));
      if (parsedPort === null) {
        return {
          ok: false,
          errorCode: "INVALID_PORT",
          error: "Port must be an integer between 1 and 65535",
        };
      }
      port = parsedPort;
    }
  } else {
    if (hostPart.includes("[") || hostPart.includes("]")) {
      return {
        ok: false,
        errorCode: "INVALID_IPV6",
        error: "Malformed IPv6 address",
      };
    }
    const firstColon = hostPart.indexOf(":");
    const lastColon = hostPart.lastIndexOf(":");
    if (firstColon === -1) {
      host = hostPart;
    } else if (firstColon === lastColon) {
      host = hostPart.slice(0, firstColon);
      const rawPort = hostPart.slice(firstColon + 1);
      if (!host) {
        return {
          ok: false,
          errorCode: "EMPTY_HOST",
          error: "Host address is required",
        };
      }
      const parsedPort = parseStrictPort(rawPort);
      if (parsedPort === null) {
        return {
          ok: false,
          errorCode: "INVALID_PORT",
          error: "Port must be an integer between 1 and 65535",
        };
      }
      port = parsedPort;
    } else if (isValidIpv6WithOptionalZone(hostPart)) {
      host = hostPart;
    } else {
      return {
        ok: false,
        errorCode: "INVALID_IPV6",
        error: "Invalid IPv6 address; use [ipv6]:port when specifying a port",
      };
    }
  }

  const hostValidation = validateQuickConnectHost(host);
  if (!hostValidation.ok) {
    return hostValidation;
  }

  return {
    ok: true,
    value: {
      protocol,
      host,
      port,
      username,
    },
  };
}

/**
 * Formats a concise human-readable tab/display label for a parsed target.
 * @param {ParsedQuickConnectTarget} target
 * @returns {string}
 */
function formatQuickConnectLabel(target) {
  const protocol = target.protocol === "telnet" ? "telnet" : "ssh";
  const defaultPort = DEFAULT_PORT_BY_PROTOCOL[protocol];
  const formattedHost = target.host.includes(":")
    ? `[${target.host}]`
    : target.host;
  const userPrefix = target.username ? `${target.username}@` : "";
  const portSuffix = target.port !== defaultPort ? `:${target.port}` : "";
  const schemePrefix = protocol === "telnet" ? "telnet://" : "";
  return `${schemePrefix}${userPrefix}${formattedHost}${portSuffix}`;
}

/**
 * Builds a transient session connection object from a raw string or parsed target.
 * Never mutates saved connections.
 *
 * @param {string | ParsedQuickConnectTarget} input
 * @returns {TransientQuickConnectConnection}
 */
function buildTransientQuickConnectConnection(input) {
  /** @type {ParsedQuickConnectTarget} */
  let parsed;
  if (typeof input === "string") {
    const result = parseQuickConnectTarget(input);
    if (!result.ok) {
      const err = new Error(result.error);
      /** @type {Error & { errorCode?: string }} */ (err).errorCode =
        result.errorCode;
      throw err;
    }
    parsed = result.value;
  } else if (input && typeof input === "object" && input.host) {
    const protocol = input.protocol === "telnet" ? "telnet" : "ssh";
    const defaultPort = DEFAULT_PORT_BY_PROTOCOL[protocol];
    const port =
      typeof input.port === "number" &&
      Number.isInteger(input.port) &&
      input.port >= 1 &&
      input.port <= 65535
        ? input.port
        : defaultPort;
    const host = String(input.host).trim();
    const hostValidation = validateQuickConnectHost(host);
    if (!hostValidation.ok) {
      const err = new Error(hostValidation.error);
      /** @type {Error & { errorCode?: string }} */ (err).errorCode =
        hostValidation.errorCode;
      throw err;
    }
    parsed = {
      protocol,
      host,
      port,
      username: typeof input.username === "string" ? input.username.trim() : "",
    };
  } else {
    throw new Error("Quick connect target is required");
  }

  return {
    id: generateId("quick"),
    type: "connection",
    isTransient: true,
    name: formatQuickConnectLabel(parsed),
    host: parsed.host,
    port: parsed.port,
    username: parsed.username || "",
    password: "",
    authType: "password",
    privateKeyPath: "",
    protocol: parsed.protocol,
    createdAt: Date.now(),
  };
}

/**
 * Resolves quick connect payload from a CustomEvent detail or raw string.
 * @param {unknown} detail
 * @returns {{ ok: true, connection: TransientQuickConnectConnection } | { ok: false, errorCode: string, error: string }}
 */
function resolveQuickConnectDetail(detail) {
  try {
    if (typeof detail === "string") {
      return {
        ok: true,
        connection: buildTransientQuickConnectConnection(detail),
      };
    }
    if (detail && typeof detail === "object") {
      const record = /** @type {Record<string, unknown>} */ (detail);
      if (typeof record.host === "string" && record.host.trim()) {
        const protocol = record.protocol === "telnet" ? "telnet" : "ssh";
        const defaultPort = DEFAULT_PORT_BY_PROTOCOL[protocol];
        const port =
          typeof record.port === "number"
            ? record.port
            : typeof record.port === "string" && record.port.trim()
              ? Number.parseInt(record.port, 10)
              : defaultPort;
        return {
          ok: true,
          connection: buildTransientQuickConnectConnection({
            protocol,
            host: record.host.trim(),
            port,
            username:
              typeof record.username === "string" ? record.username.trim() : "",
          }),
        };
      }
      if (typeof record.target === "string") {
        return {
          ok: true,
          connection: buildTransientQuickConnectConnection(record.target),
        };
      }
    }
    return {
      ok: false,
      errorCode: "EMPTY",
      error: "Quick connect target is required",
    };
  } catch (error) {
    const err = /** @type {Error & { errorCode?: string }} */ (error);
    return {
      ok: false,
      errorCode: err.errorCode || "INVALID_FORMAT",
      error: err.message || "Invalid quick connect target",
    };
  }
}

/**
 * @param {Partial<TransientQuickConnectConnection>} item
 * @returns {string}
 */
function buildQuickConnectIdentityKey(item) {
  const protocol = item.protocol === "telnet" ? "telnet" : "ssh";
  const defaultPort = DEFAULT_PORT_BY_PROTOCOL[protocol];
  const port = Number(item.port) || defaultPort;
  const host = String(item.host || "")
    .trim()
    .toLowerCase();
  const username = String(item.username || "").trim();
  return `${protocol}|${username}|${host}|${port}`;
}

/**
 * @param {readonly Record<string, unknown>[] | null | undefined} items
 * @param {Set<string>} [keys]
 * @returns {Set<string>}
 */
function collectSavedConnectionKeys(items, keys = new Set()) {
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "group") {
      collectSavedConnectionKeys(
        /** @type {readonly Record<string, unknown>[]} */ (item.items),
        keys,
      );
      continue;
    }
    if (item.type === "connection" && item.host) {
      keys.add(
        buildQuickConnectIdentityKey(
          /** @type {Partial<TransientQuickConnectConnection>} */ (item),
        ),
      );
    }
  }
  return keys;
}

module.exports = {
  QUICK_CONNECT_PROTOCOLS,
  DEFAULT_PORT_BY_PROTOCOL,
  parseQuickConnectTarget,
  formatQuickConnectLabel,
  buildTransientQuickConnectConnection,
  resolveQuickConnectDetail,
  buildQuickConnectIdentityKey,
  collectSavedConnectionKeys,
};
