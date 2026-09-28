const { createHash } = require("node:crypto");
const {
  processSSHPrivateKeyAsync,
  resolveSshAgentPath,
} = require("../utils/ssh-utils");
const { getTrustedHostFingerprint } = require("../utils/sshHostKeyTrust");
const {
  resolveKeyboardInteractiveAnswers,
} = require("../connection/ssh-interactive-auth");
const {
  resolveNativeSidecarNetworkPath,
  normalizeProxyConfig,
} = require("./nativeSidecarNetworkPath");
const { forwardingError } = require("./nativePortForwardingClient");

async function networkSnapshot(raw, proxyManager) {
  if (!raw.proxy) return { proxy: undefined, proxyRequired: false };
  if (!proxyManager?.resolveProxyConfigAsync)
    throw forwardingError("PROXY_REQUIRED", raw.language);
  const resolved = await proxyManager.resolveProxyConfigAsync(raw);
  // useDefault may resolve a deliberate PAC DIRECT/no configured proxy. An invalid
  // object or a missing explicit proxy must never silently turn into direct TCP.
  if (
    (resolved != null && !normalizeProxyConfig(resolved)) ||
    (resolved == null && !raw.proxy.useDefault)
  )
    throw forwardingError("PROXY_INVALID", raw.language);
  const path = await resolveNativeSidecarNetworkPath(raw, {
    proxyManager: { resolveProxyConfigAsync: async () => resolved },
    strictProxy: resolved != null,
  });
  if (
    path.proxy &&
    (!Number.isInteger(path.proxy.port) ||
      path.proxy.port < 1 ||
      path.proxy.port > 65535)
  )
    throw forwardingError("PROXY_INVALID", raw.language);
  return { proxy: path.proxy || undefined, proxyRequired: path.proxyRequired };
}

const revisionOf = (network) =>
  createHash("sha256").update(JSON.stringify(network)).digest("hex");

async function resolveForwardingConfig(proc, proxyManager) {
  const raw = proc?.config;
  if (!raw?.host || !raw.username)
    throw forwardingError("SESSION_UNAVAILABLE", raw?.language);
  // Trust comes exclusively from the approved terminal connection's in-memory Symbol.
  const pooled = proc.connectionInfo?.config;
  const expectedHostFingerprint =
    getTrustedHostFingerprint(raw) ||
    (pooled?.host === raw.host &&
    Number(pooled.port || 22) === Number(raw.port || 22)
      ? getTrustedHostFingerprint(pooled)
      : null);
  if (!expectedHostFingerprint)
    throw forwardingError("HOST_KEY_NOT_TRUSTED", raw.language);
  const config = await processSSHPrivateKeyAsync(raw);
  if (raw.privateKeyPath && !config.privateKey)
    throw forwardingError("INVALID_KEY", raw.language);
  const network = await networkSnapshot(raw, proxyManager);
  const agentPath =
    String(raw.authType || "").toLowerCase() === "agent"
      ? resolveSshAgentPath(raw)
      : undefined;
  if (String(raw.authType || "").toLowerCase() === "agent" && !agentPath)
    throw forwardingError("AGENT_UNAVAILABLE", raw.language);
  const authConfig = {
    ...raw,
    keyboardInteractiveResponder:
      raw.keyboardInteractiveResponder ||
      proc.connectionInfo?.config?.keyboardInteractiveResponder,
  };
  return {
    ssh: {
      host: raw.host,
      port: Number(raw.port || 22),
      username: raw.username,
      password: config.password || undefined,
      privateKey: Buffer.isBuffer(config.privateKey)
        ? config.privateKey.toString("utf8")
        : config.privateKey || undefined,
      passphrase: config.passphrase || undefined,
      agentPath,
      keyboardInteractive: true,
      expectedHostFingerprint,
      ...network,
    },
    revision: revisionOf(network),
    onAuth: (challenge) =>
      resolveKeyboardInteractiveAnswers({
        ...challenge,
        sshConfig: authConfig,
      }),
  };
}

module.exports = { resolveForwardingConfig, networkSnapshot, revisionOf };
