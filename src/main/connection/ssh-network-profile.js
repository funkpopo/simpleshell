const {
  getNetworkProfileOverridesForQuality,
  NETWORK_QUALITY_LEVELS,
} = require("../services/networkQuality");
const configService = require("../settings/configService");
const {
  normalizeSshUiSettings,
} = require("../../shared/settings/uiSettingsDefaults");

const DEFAULT_SSH_NETWORK_PROFILE = Object.freeze({
  keepaliveInterval: 10000,
  keepaliveCountMax: 9,
  readyTimeout: 30000,
});

function getGlobalSshNetworkProfileDefaults() {
  try {
    const uiSettings = configService.loadUISettings?.();
    if (uiSettings && uiSettings.ssh) {
      const sshSettings = normalizeSshUiSettings(uiSettings);
      return {
        keepaliveInterval: sshSettings.keepaliveIntervalSeconds * 1000,
        keepaliveCountMax: sshSettings.keepaliveCountMax,
        readyTimeout: sshSettings.readyTimeoutSeconds * 1000,
      };
    }
  } catch {
    /* ignore when configService is uninitialized */
  }
  return DEFAULT_SSH_NETWORK_PROFILE;
}

const toBoundedInt = (value, min, max, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const intValue = Math.floor(parsed);
  if (intValue < min || intValue > max) {
    return fallback;
  }

  return intValue;
};

const getNetworkProfileSource = (config = {}) => {
  if (config && typeof config.networkProfile === "object") {
    return config.networkProfile;
  }
  if (config && typeof config.networkTuning === "object") {
    return config.networkTuning;
  }
  return config || {};
};

const readProfileValue = (config, profileSource, key) => {
  if (profileSource && profileSource[key] !== undefined) {
    return profileSource[key];
  }
  if (config && config[key] !== undefined) {
    return config[key];
  }
  return undefined;
};

const resolveSshNetworkProfile = (config = {}, defaults) => {
  const baseDefaults = defaults || getGlobalSshNetworkProfileDefaults();
  const profileSource = getNetworkProfileSource(config);
  const qualityLevel =
    config?.networkQualityLevel ||
    profileSource?.networkQualityLevel ||
    config?.qualityLevel ||
    null;
  const qualityOverrides = qualityLevel
    ? getNetworkProfileOverridesForQuality(qualityLevel)
    : null;

  const effectiveDefaults = qualityOverrides
    ? {
        ...baseDefaults,
        keepaliveInterval:
          qualityOverrides.keepaliveInterval ?? baseDefaults.keepaliveInterval,
        keepaliveCountMax:
          qualityOverrides.keepaliveCountMax ?? baseDefaults.keepaliveCountMax,
        readyTimeout:
          qualityOverrides.readyTimeout ?? baseDefaults.readyTimeout,
      }
    : baseDefaults;

  const keepaliveInterval = toBoundedInt(
    readProfileValue(config, profileSource, "keepaliveInterval"),
    5000,
    120000,
    effectiveDefaults.keepaliveInterval,
  );
  const keepaliveCountMax = toBoundedInt(
    readProfileValue(config, profileSource, "keepaliveCountMax"),
    3,
    30,
    effectiveDefaults.keepaliveCountMax,
  );
  const readyTimeout = toBoundedInt(
    readProfileValue(config, profileSource, "readyTimeout"),
    10000,
    180000,
    effectiveDefaults.readyTimeout,
  );

  return {
    keepaliveInterval,
    keepaliveCountMax,
    readyTimeout,
    networkQualityLevel: qualityLevel || NETWORK_QUALITY_LEVELS.GOOD,
    outputDispatchThresholdBytes:
      qualityOverrides?.outputDispatchThresholdBytes ?? 4096,
    outputDispatchIntervalMs: qualityOverrides?.outputDispatchIntervalMs ?? 8,
    preflightTcpTimeoutMs: qualityOverrides?.preflightTcpTimeoutMs ?? 2000,
  };
};

module.exports = {
  DEFAULT_SSH_NETWORK_PROFILE,
  resolveSshNetworkProfile,
};
