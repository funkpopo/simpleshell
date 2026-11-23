const {
  resolveSshNetworkProfile,
} = require("../../connection/ssh-network-profile");

/** SSH config, host-key trust, proxy/network path, and core binary validation for native SFTP. */
function createSftpConfigResolver({
  processManager,
  getNativeServicesHostPath,
  processSSHPrivateKeyAsync,
  getTrustedHostFingerprint,
  logToFile,
  normalizeProxyConfig,
  buildNetworkPath,
  resolveNativeSidecarNetworkPath,
  protocol,
}) {
  function resolveExpectedHostFingerprint(rawConfig, fallbackConfigs = []) {
    const configs = [rawConfig, ...fallbackConfigs];
    const fingerprint = configs
      .filter(Boolean)
      .map(
        (config) =>
          config?.expectedHostFingerprint || getTrustedHostFingerprint(config),
      )
      .find(Boolean);
    if (fingerprint) {
      return fingerprint;
    }

    throw protocol.createNativeSidecarError(
      "SSH host key has not been trusted by the main connection",
      {
        errorCode: "NATIVE_SFTP_HOST_KEY_NOT_TRUSTED",
        errorKind: "hostKey",
        retryable: false,
        module: "native-sftp-client",
      },
    );
  }

  function prepareNativeSshConfig(config) {
    const expectedHostFingerprint = resolveExpectedHostFingerprint(config);
    const proxy = normalizeProxyConfig(config?.proxy);
    const proxyRequired =
      config?.proxyRequired === true ||
      config?.networkPath?.proxyRequired === true ||
      config?.networkPath?.mode === "proxy" ||
      Boolean(proxy);

    if (proxyRequired && !proxy) {
      throw protocol.createNativeSidecarError(
        "Native sidecar transfer requires a proxy, but no supported proxy was resolved",
        {
          errorCode: "NATIVE_SFTP_PROXY_REQUIRED",
          errorKind: "proxy",
          retryable: true,
          module: "native-sftp-client",
        },
      );
    }

    const networkPath =
      config?.networkPath && typeof config.networkPath === "object"
        ? config.networkPath
        : buildNetworkPath(proxy, proxyRequired);

    return {
      ...config,
      proxy: proxy || undefined,
      proxyRequired,
      networkPath,
      expectedHostFingerprint,
    };
  }

  async function resolveSshConfig(tabId, options = {}) {
    const {
      includeTimeouts = false,
      plainErrors = false,
      proxyManager = undefined,
    } = options;

    const processInfo = processManager.getProcess(tabId);
    const rawConfig = processInfo?.config;
    if (!rawConfig?.host || !rawConfig?.username) {
      if (plainErrors) {
        throw new Error("SSH connection config is unavailable");
      }
      logToFile(`Native SFTP: missing SSH config for tab ${tabId}`, "WARN");
      throw protocol.createNativeSidecarError(
        "SSH connection config is unavailable",
        {
          errorCode: "NATIVE_SFTP_MISSING_CONFIG",
          errorKind: "validation",
          retryable: false,
          module: "native-sftp-client",
        },
      );
    }

    let expectedHostFingerprint;
    if (plainErrors) {
      expectedHostFingerprint =
        getTrustedHostFingerprint(rawConfig) ||
        getTrustedHostFingerprint(processInfo?.connectionInfo?.config);
      if (!expectedHostFingerprint) {
        throw new Error(
          "SSH host key has not been trusted by the main connection",
        );
      }
    } else {
      expectedHostFingerprint = resolveExpectedHostFingerprint(rawConfig, [
        processInfo?.connectionInfo?.config,
      ]);
    }

    const networkProfile = includeTimeouts
      ? resolveSshNetworkProfile(rawConfig)
      : null;

    const sshConfig = await processSSHPrivateKeyAsync({
      host: rawConfig.host,
      port: rawConfig.port || 22,
      username: rawConfig.username,
      password: rawConfig.password || undefined,
      privateKey: rawConfig.privateKey || undefined,
      privateKeyPath: rawConfig.privateKeyPath || undefined,
      passphrase: rawConfig.passphrase || undefined,
      enableCompression: rawConfig.enableCompression === true || undefined,
      ...(includeTimeouts
        ? {
            readyTimeout:
              rawConfig.readyTimeout || networkProfile?.readyTimeout,
            keepaliveInterval:
              rawConfig.keepaliveInterval || networkProfile?.keepaliveInterval,
            keepaliveCountMax:
              rawConfig.keepaliveCountMax || networkProfile?.keepaliveCountMax,
            expectedHostFingerprint,
          }
        : {}),
    });

    const networkPath = await resolveNativeSidecarNetworkPath(
      rawConfig,
      proxyManager !== undefined ? { proxyManager } : {},
    );

    if (includeTimeouts) {
      if (sshConfig?.privateKeyPath && sshConfig.privateKey) {
        delete sshConfig.privateKeyPath;
      }
      sshConfig.proxy = networkPath.proxy || undefined;
      sshConfig.proxyRequired = networkPath.proxyRequired;
      sshConfig.networkPath = networkPath.networkPath;
      return sshConfig;
    }

    return {
      host: sshConfig.host,
      port: sshConfig.port || 22,
      username: sshConfig.username,
      password: sshConfig.password || undefined,
      privateKey: sshConfig.privateKey || undefined,
      passphrase: sshConfig.passphrase || undefined,
      proxy: networkPath.proxy || undefined,
      proxyRequired: networkPath.proxyRequired,
      networkPath: networkPath.networkPath,
      expectedHostFingerprint,
      enableCompression: sshConfig.enableCompression,
    };
  }

  /** Rejection for a missing `simpleshell-core`, or null when it is available. */
  function missingHostError(operation) {
    if (getNativeServicesHostPath()) return null;
    logToFile(
      `Native SFTP: simpleshell-core not found for ${operation || "unknown-operation"}`,
      "ERROR",
    );
    return protocol.createNativeSidecarError(
      "Native services host was not found",
      {
        errorCode: "NATIVE_SFTP_SIDECAR_MISSING",
        errorKind: "sidecar",
        retryable: false,
        operation: operation || null,
      },
    );
  }

  return {
    resolveExpectedHostFingerprint,
    prepareNativeSshConfig,
    resolveSshConfig,
    missingHostError,
  };
}

module.exports = createSftpConfigResolver;
