/**
 * 网络质量画像：由 RTT 历史、探测失败率、重连成功率推导等级。
 * 不宣称真实丢包；packetLossHint 为应用层失败率近似。
 */

const NETWORK_QUALITY_LEVELS = Object.freeze({
  EXCELLENT: "excellent",
  GOOD: "good",
  DEGRADED: "degraded",
  POOR: "poor",
  OFFLINE: "offline",
});

const LEVEL_RANK = Object.freeze({
  [NETWORK_QUALITY_LEVELS.EXCELLENT]: 4,
  [NETWORK_QUALITY_LEVELS.GOOD]: 3,
  [NETWORK_QUALITY_LEVELS.DEGRADED]: 2,
  [NETWORK_QUALITY_LEVELS.POOR]: 1,
  [NETWORK_QUALITY_LEVELS.OFFLINE]: 0,
});

const QUALITY_CHECK_INTERVAL_MS = Object.freeze({
  [NETWORK_QUALITY_LEVELS.EXCELLENT]: 60_000,
  [NETWORK_QUALITY_LEVELS.GOOD]: 45_000,
  [NETWORK_QUALITY_LEVELS.DEGRADED]: 25_000,
  [NETWORK_QUALITY_LEVELS.POOR]: 20_000,
  [NETWORK_QUALITY_LEVELS.OFFLINE]: 15_000,
});

const QUALITY_NETWORK_PROFILE_OVERRIDES = Object.freeze({
  [NETWORK_QUALITY_LEVELS.EXCELLENT]: Object.freeze({
    keepaliveInterval: 10_000,
    socketKeepAliveInitialDelay: 10_000,
    keepaliveCountMax: 9,
    readyTimeout: 30_000,
    outputDispatchThresholdBytes: 4096,
    outputDispatchIntervalMs: 8,
    preflightTcpTimeoutMs: 1500,
  }),
  [NETWORK_QUALITY_LEVELS.GOOD]: Object.freeze({
    keepaliveInterval: 10_000,
    socketKeepAliveInitialDelay: 10_000,
    keepaliveCountMax: 9,
    readyTimeout: 30_000,
    outputDispatchThresholdBytes: 4096,
    outputDispatchIntervalMs: 8,
    preflightTcpTimeoutMs: 2000,
  }),
  [NETWORK_QUALITY_LEVELS.DEGRADED]: Object.freeze({
    keepaliveInterval: 15_000,
    socketKeepAliveInitialDelay: 15_000,
    keepaliveCountMax: 12,
    readyTimeout: 45_000,
    outputDispatchThresholdBytes: 8192,
    outputDispatchIntervalMs: 16,
    preflightTcpTimeoutMs: 3000,
  }),
  [NETWORK_QUALITY_LEVELS.POOR]: Object.freeze({
    keepaliveInterval: 25_000,
    socketKeepAliveInitialDelay: 20_000,
    keepaliveCountMax: 15,
    readyTimeout: 75_000,
    outputDispatchThresholdBytes: 16_384,
    outputDispatchIntervalMs: 24,
    preflightTcpTimeoutMs: 5000,
  }),
  [NETWORK_QUALITY_LEVELS.OFFLINE]: Object.freeze({
    keepaliveInterval: 30_000,
    socketKeepAliveInitialDelay: 25_000,
    keepaliveCountMax: 15,
    readyTimeout: 90_000,
    outputDispatchThresholdBytes: 16_384,
    outputDispatchIntervalMs: 32,
    preflightTcpTimeoutMs: 5000,
  }),
});

const LEVEL_HYSTERESIS_MS = 30_000;

const clamp01 = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(1, Math.max(0, numeric));
};

const average = (values) => {
  if (!Array.isArray(values) || values.length === 0) {
    return null;
  }
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) {
    return null;
  }
  return finite.reduce((sum, v) => sum + v, 0) / finite.length;
};

/**
 * 仅按 RTT 映射等级（不含 offline）
 */
function levelFromLatencyMs(latencyMs) {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) {
    return null;
  }
  if (latencyMs <= 50) return NETWORK_QUALITY_LEVELS.EXCELLENT;
  if (latencyMs <= 100) return NETWORK_QUALITY_LEVELS.GOOD;
  if (latencyMs <= 200) return NETWORK_QUALITY_LEVELS.DEGRADED;
  if (latencyMs <= 500) return NETWORK_QUALITY_LEVELS.POOR;
  return NETWORK_QUALITY_LEVELS.POOR;
}

/**
 * @param {object} input
 * @param {number|null} input.latencyMs
 * @param {Array<{latency?: number}>} [input.history]
 * @param {number} [input.checkCount]
 * @param {number} [input.errorCount]
 * @param {number} [input.reconnectSuccessRate] 0..1
 * @param {boolean} [input.offline]
 * @param {string|null} [input.previousLevel]
 * @param {number|null} [input.previousLevelAt]
 * @param {number} [input.now]
 */
function computeNetworkQuality(input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const offline = input.offline === true;

  if (offline) {
    return {
      level: NETWORK_QUALITY_LEVELS.OFFLINE,
      stability: 0,
      latencyMs: null,
      packetLossHint: 1,
      updatedAt: now,
    };
  }

  const historyLatencies = Array.isArray(input.history)
    ? input.history
        .map((item) => Number(item?.latency))
        .filter((v) => Number.isFinite(v) && v >= 0)
    : [];

  const latencyMs = Number.isFinite(input.latencyMs)
    ? Math.max(0, Math.round(input.latencyMs))
    : historyLatencies.length > 0
      ? Math.round(average(historyLatencies))
      : null;

  const checkCount = Math.max(0, Math.floor(Number(input.checkCount) || 0));
  const errorCount = Math.max(0, Math.floor(Number(input.errorCount) || 0));
  const sampleCount = Math.max(checkCount, historyLatencies.length, 1);
  const packetLossHint = clamp01(errorCount / sampleCount);

  const reconnectSuccessRate = Number.isFinite(input.reconnectSuccessRate)
    ? clamp01(input.reconnectSuccessRate)
    : 1;

  let level = levelFromLatencyMs(latencyMs) || NETWORK_QUALITY_LEVELS.GOOD;

  // 探测失败率抬升差网等级
  if (packetLossHint >= 0.5) {
    level = NETWORK_QUALITY_LEVELS.POOR;
  } else if (packetLossHint >= 0.25) {
    level =
      LEVEL_RANK[level] > LEVEL_RANK[NETWORK_QUALITY_LEVELS.DEGRADED]
        ? NETWORK_QUALITY_LEVELS.DEGRADED
        : level;
  }

  // 重连成功率低也降级
  if (reconnectSuccessRate < 0.4) {
    level = NETWORK_QUALITY_LEVELS.POOR;
  } else if (reconnectSuccessRate < 0.7) {
    if (LEVEL_RANK[level] > LEVEL_RANK[NETWORK_QUALITY_LEVELS.DEGRADED]) {
      level = NETWORK_QUALITY_LEVELS.DEGRADED;
    }
  }

  // 滞回：短时间内避免频繁升降（升慢：需要更高 rank 且冷却；降快：立即）
  const previousLevel = input.previousLevel;
  const previousLevelAt = Number(input.previousLevelAt);
  if (
    previousLevel &&
    LEVEL_RANK[previousLevel] !== undefined &&
    previousLevel !== level &&
    Number.isFinite(previousLevelAt) &&
    now - previousLevelAt < LEVEL_HYSTERESIS_MS
  ) {
    const prevRank = LEVEL_RANK[previousLevel];
    const nextRank = LEVEL_RANK[level];
    // 升级（质量变好）在冷却期内保持旧等级
    if (nextRank > prevRank) {
      level = previousLevel;
    }
  }

  const latencyScore =
    latencyMs === null
      ? 0.6
      : latencyMs <= 50
        ? 1
        : latencyMs <= 100
          ? 0.85
          : latencyMs <= 200
            ? 0.65
            : latencyMs <= 500
              ? 0.4
              : 0.2;

  const stability = clamp01(
    latencyScore * 0.55 +
      (1 - packetLossHint) * 0.25 +
      reconnectSuccessRate * 0.2,
  );

  return {
    level,
    stability: Math.round(stability * 1000) / 1000,
    latencyMs,
    packetLossHint: Math.round(packetLossHint * 1000) / 1000,
    updatedAt: now,
  };
}

function getCheckIntervalForQuality(level) {
  return (
    QUALITY_CHECK_INTERVAL_MS[level] ||
    QUALITY_CHECK_INTERVAL_MS[NETWORK_QUALITY_LEVELS.GOOD]
  );
}

function getNetworkProfileOverridesForQuality(level) {
  return (
    QUALITY_NETWORK_PROFILE_OVERRIDES[level] ||
    QUALITY_NETWORK_PROFILE_OVERRIDES[NETWORK_QUALITY_LEVELS.GOOD]
  );
}

module.exports = {
  NETWORK_QUALITY_LEVELS,
  LEVEL_RANK,
  QUALITY_CHECK_INTERVAL_MS,
  QUALITY_NETWORK_PROFILE_OVERRIDES,
  LEVEL_HYSTERESIS_MS,
  levelFromLatencyMs,
  computeNetworkQuality,
  getCheckIntervalForQuality,
  getNetworkProfileOverridesForQuality,
};
