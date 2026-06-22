const TRUSTED_HOST_FINGERPRINT_SYMBOL = Symbol.for(
  "simpleshell.ssh.trustedHostFingerprint",
);
const TRUSTED_HOST_SCOPE_SYMBOL = Symbol.for(
  "simpleshell.ssh.trustedHostScope",
);

function normalizeSshHostFingerprint(fingerprint) {
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

function getHostCacheKey(host, port) {
  const normalizedHost = String(host || "").trim();
  if (!normalizedHost) {
    return null;
  }
  return `${normalizedHost}:${port || 22}`;
}

function setTrustedHostFingerprint(config, fingerprint, scope = "unknown") {
  if (!config || typeof config !== "object") {
    return null;
  }

  const normalizedFingerprint = normalizeSshHostFingerprint(fingerprint);
  if (!normalizedFingerprint) {
    return null;
  }

  Object.defineProperty(config, TRUSTED_HOST_FINGERPRINT_SYMBOL, {
    value: normalizedFingerprint,
    enumerable: false,
    configurable: true,
    writable: true,
  });

  Object.defineProperty(config, TRUSTED_HOST_SCOPE_SYMBOL, {
    value: scope || "unknown",
    enumerable: false,
    configurable: true,
    writable: true,
  });

  return normalizedFingerprint;
}

function getTrustedHostFingerprint(config) {
  if (!config || typeof config !== "object") {
    return null;
  }

  return normalizeSshHostFingerprint(config[TRUSTED_HOST_FINGERPRINT_SYMBOL]);
}

function getTrustedHostScope(config) {
  if (!config || typeof config !== "object") {
    return null;
  }

  return config[TRUSTED_HOST_SCOPE_SYMBOL] || null;
}

module.exports = {
  TRUSTED_HOST_FINGERPRINT_SYMBOL,
  TRUSTED_HOST_SCOPE_SYMBOL,
  normalizeSshHostFingerprint,
  getHostCacheKey,
  setTrustedHostFingerprint,
  getTrustedHostFingerprint,
  getTrustedHostScope,
};
