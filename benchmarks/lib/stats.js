const { performance } = require("node:perf_hooks");

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return 0;
  }
  if (sortedValues.length === 1 || p <= 0) {
    return sortedValues[0];
  }
  if (p >= 100) {
    return sortedValues[sortedValues.length - 1];
  }

  const index = (p / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const fraction = index - lower;
  return (
    sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * fraction
  );
}

function summarizeSamples(samples) {
  const valid = Array.isArray(samples)
    ? samples.filter((value) => Number.isFinite(value))
    : [];
  if (valid.length === 0) {
    return {
      count: 0,
      min: 0,
      p50: 0,
      p95: 0,
      p99: 0,
      max: 0,
      mean: 0,
      stdDev: 0,
    };
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const total = sorted.reduce((acc, value) => acc + value, 0);
  const mean = total / sorted.length;
  const variance =
    sorted.reduce((acc, value) => acc + (value - mean) ** 2, 0) / sorted.length;

  return {
    count: sorted.length,
    min: round(sorted[0]),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]),
    mean: round(mean),
    stdDev: round(Math.sqrt(variance)),
  };
}

function computeOpsPerSec(operations, elapsedMs) {
  if (!Number.isFinite(operations) || !Number.isFinite(elapsedMs)) return 0;
  if (operations <= 0 || elapsedMs <= 0) return 0;
  return round((operations / elapsedMs) * 1000, 2);
}

function computeThroughputMBps(bytes, elapsedMs) {
  if (!Number.isFinite(bytes) || !Number.isFinite(elapsedMs)) return 0;
  if (bytes <= 0 || elapsedMs <= 0) return 0;
  return round(bytes / (1024 * 1024) / (elapsedMs / 1000), 2);
}

function snapshotMemory() {
  const usage = process.memoryUsage();
  const toMB = (bytes) => round(bytes / (1024 * 1024), 2);
  return {
    rssMB: toMB(usage.rss),
    heapUsedMB: toMB(usage.heapUsed),
    heapTotalMB: toMB(usage.heapTotal),
    externalMB: toMB(usage.external),
    arrayBuffersMB: toMB(usage.arrayBuffers || 0),
  };
}

function computeMemoryDelta(before, after) {
  const safeBefore = before || snapshotMemory();
  const safeAfter = after || snapshotMemory();
  return {
    rssBeforeMB: safeBefore.rssMB,
    rssAfterMB: safeAfter.rssMB,
    rssDeltaMB: round(safeAfter.rssMB - safeBefore.rssMB, 2),
    heapUsedBeforeMB: safeBefore.heapUsedMB,
    heapUsedAfterMB: safeAfter.heapUsedMB,
    heapUsedDeltaMB: round(safeAfter.heapUsedMB - safeBefore.heapUsedMB, 2),
    heapTotalDeltaMB: round(safeAfter.heapTotalMB - safeBefore.heapTotalMB, 2),
  };
}

function measureSync(
  fn,
  { iterations = 10, warmup = 2, opsPerIteration = 1, trackMemory = true } = {},
) {
  const safeWarmup = Math.max(0, Math.floor(warmup));
  const safeIterations = Math.max(1, Math.floor(iterations));

  for (let i = 0; i < safeWarmup; i += 1) {
    fn(i);
  }

  const memBefore = trackMemory ? snapshotMemory() : null;
  const samples = new Array(safeIterations);
  const suiteStart = performance.now();

  for (let i = 0; i < safeIterations; i += 1) {
    const start = performance.now();
    fn(i);
    samples[i] = performance.now() - start;
  }

  const totalMs = performance.now() - suiteStart;
  const memAfter = trackMemory ? snapshotMemory() : null;
  const stats = summarizeSamples(samples);
  const totalOps = safeIterations * opsPerIteration;

  return {
    samples,
    stats,
    totalMs: round(totalMs),
    opsPerSec: computeOpsPerSec(totalOps, totalMs),
    memory: trackMemory ? computeMemoryDelta(memBefore, memAfter) : null,
  };
}

async function measureAsync(
  fn,
  { iterations = 5, warmup = 1, opsPerIteration = 1, trackMemory = true } = {},
) {
  const safeWarmup = Math.max(0, Math.floor(warmup));
  const safeIterations = Math.max(1, Math.floor(iterations));

  for (let i = 0; i < safeWarmup; i += 1) {
    await fn(i);
  }

  const memBefore = trackMemory ? snapshotMemory() : null;
  const samples = new Array(safeIterations);
  const suiteStart = performance.now();

  for (let i = 0; i < safeIterations; i += 1) {
    const start = performance.now();
    await fn(i);
    samples[i] = performance.now() - start;
  }

  const totalMs = performance.now() - suiteStart;
  const memAfter = trackMemory ? snapshotMemory() : null;
  const stats = summarizeSamples(samples);
  const totalOps = safeIterations * opsPerIteration;

  return {
    samples,
    stats,
    totalMs: round(totalMs),
    opsPerSec: computeOpsPerSec(totalOps, totalMs),
    memory: trackMemory ? computeMemoryDelta(memBefore, memAfter) : null,
  };
}

module.exports = {
  round,
  percentile,
  summarizeSamples,
  computeOpsPerSec,
  computeThroughputMBps,
  snapshotMemory,
  computeMemoryDelta,
  measureSync,
  measureAsync,
};
