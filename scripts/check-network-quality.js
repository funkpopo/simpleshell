const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const {
  NETWORK_QUALITY_LEVELS,
  computeNetworkQuality,
  getCheckIntervalForQuality,
  getNetworkProfileOverridesForQuality,
  levelFromLatencyMs,
} = require(path.join(ROOT, "src/core/services/networkQuality.js"));
const { resolveSshNetworkProfile } = require(
  path.join(ROOT, "src/core/utils/ssh-network-profile.js"),
);

function testLatencyBuckets() {
  assert.equal(levelFromLatencyMs(20), NETWORK_QUALITY_LEVELS.EXCELLENT);
  assert.equal(levelFromLatencyMs(80), NETWORK_QUALITY_LEVELS.GOOD);
  assert.equal(levelFromLatencyMs(150), NETWORK_QUALITY_LEVELS.DEGRADED);
  assert.equal(levelFromLatencyMs(400), NETWORK_QUALITY_LEVELS.POOR);
}

function testOfflineAndErrorRate() {
  const offline = computeNetworkQuality({ offline: true });
  assert.equal(offline.level, NETWORK_QUALITY_LEVELS.OFFLINE);
  assert.equal(offline.stability, 0);

  const flaky = computeNetworkQuality({
    latencyMs: 40,
    checkCount: 10,
    errorCount: 6,
  });
  assert.equal(flaky.level, NETWORK_QUALITY_LEVELS.POOR);
  assert.ok(flaky.packetLossHint >= 0.5);
}

function testHysteresisUpgradeCooldown() {
  const now = 1_000_000;
  const held = computeNetworkQuality({
    latencyMs: 30,
    checkCount: 5,
    errorCount: 0,
    previousLevel: NETWORK_QUALITY_LEVELS.DEGRADED,
    previousLevelAt: now - 5_000,
    now,
  });
  assert.equal(
    held.level,
    NETWORK_QUALITY_LEVELS.DEGRADED,
    "冷却期内不应快速升级质量等级",
  );

  const upgraded = computeNetworkQuality({
    latencyMs: 30,
    checkCount: 5,
    errorCount: 0,
    previousLevel: NETWORK_QUALITY_LEVELS.DEGRADED,
    previousLevelAt: now - 60_000,
    now,
  });
  assert.equal(upgraded.level, NETWORK_QUALITY_LEVELS.EXCELLENT);
}

function testProfileOverrides() {
  const poorOverrides = getNetworkProfileOverridesForQuality(
    NETWORK_QUALITY_LEVELS.POOR,
  );
  assert.ok(poorOverrides.readyTimeout >= 60_000);
  assert.ok(poorOverrides.keepaliveInterval >= 20_000);

  const profile = resolveSshNetworkProfile({
    networkQualityLevel: NETWORK_QUALITY_LEVELS.POOR,
  });
  assert.equal(profile.networkQualityLevel, NETWORK_QUALITY_LEVELS.POOR);
  assert.ok(profile.readyTimeout >= 60_000);
  assert.ok(
    getCheckIntervalForQuality(NETWORK_QUALITY_LEVELS.POOR) <
      getCheckIntervalForQuality(NETWORK_QUALITY_LEVELS.EXCELLENT),
  );
}

function run() {
  const tests = [
    ["latency buckets map to quality levels", testLatencyBuckets],
    ["offline and high error rate degrade quality", testOfflineAndErrorRate],
    ["upgrade hysteresis holds during cooldown", testHysteresisUpgradeCooldown],
    ["quality drives network profile overrides", testProfileOverrides],
  ];

  for (const [name, fn] of tests) {
    fn();
    console.log(`PASS ${name}`);
  }

  console.log(`\n${tests.length} network quality checks passed.`);
}

run();
