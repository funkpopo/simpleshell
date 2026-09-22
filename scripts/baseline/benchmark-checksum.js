#!/usr/bin/env node
/**
 * JS 哈希性能基线（Phase 0 / P0.3）。
 *
 * 在相同机器、相同文件和缓存条件下测量 transferIntegrity.hashLocalFile 的
 * JS 基线：空文件、4 MiB、128 MiB、1 GiB 文件及非零偏移区间。
 * 小文件重复 10 次，大文件至少 3 次，分别记录首次运行与热缓存结果。
 *
 * 用法：node scripts/baseline/benchmark-checksum.js [--full]
 *   默认跳过 1 GiB（用 --full 启用）；结果写入 docs/baseline-checksum.json。
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { performance } = require("node:perf_hooks");
const crypto = require("node:crypto");

const FULL = process.argv.includes("--full");
const OUT_PATH = path.join(__dirname, "..", "docs", "baseline-checksum.json");

const CASES = [
  { name: "empty", bytes: 0, runs: 10 },
  { name: "4mib", bytes: 4 * 1024 * 1024, runs: 10 },
  { name: "128mib", bytes: 128 * 1024 * 1024, runs: 3 },
  { name: "1gib", bytes: 1024 * 1024 * 1024, runs: 3, fullOnly: true },
];
const SEGMENT_CASES = [
  {
    name: "128mib-segment-1mib@4mib",
    bytes: 128 * 1024 * 1024,
    offset: 4 * 1024 * 1024,
    length: 1024 * 1024,
    runs: 10,
  },
  {
    name: "128mib-segment-tail-zero",
    bytes: 128 * 1024 * 1024,
    offset: 128 * 1024 * 1024,
    length: 0,
    runs: 10,
  },
];

function fillRandom(filePath, bytes) {
  const fd = fs.openSync(filePath, "w");
  const chunk = crypto.randomBytes(1024 * 1024);
  let written = 0;
  while (written < bytes) {
    const n = Math.min(chunk.length, bytes - written);
    fs.writeSync(fd, chunk, 0, n);
    written += n;
  }
  fs.closeSync(fd);
}

function hashFile(filePath, { offset = 0, length } = {}) {
  const start = performance.now();
  const before = fs.statSync(filePath);
  const end = length ?? before.size - offset;
  const hash = crypto.createHash("sha256");
  if (end > 0) {
    const data = Buffer.alloc(256 * 1024);
    const fd = fs.openSync(filePath, "r");
    let pos = offset;
    let read = 0;
    while (read < end) {
      const n = fs.readSync(
        fd,
        data,
        0,
        Math.min(data.length, end - read),
        pos,
      );
      if (n === 0) throw new Error("truncated");
      hash.update(data.subarray(0, n));
      pos += n;
      read += n;
    }
    fs.closeSync(fd);
  }
  const digest = hash.digest("hex");
  return { elapsedMs: performance.now() - start, bytesHashed: end, digest };
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-baseline-"));
  const results = {
    platform: os.platform(),
    arch: os.arch(),
    node: process.version,
    timestamp: new Date().toISOString(),
    cases: {},
  };

  for (const testCase of [...CASES, ...SEGMENT_CASES]) {
    if (testCase.fullOnly && !FULL) continue;
    const filePath = path.join(dir, testCase.name);
    fillRandom(filePath, testCase.bytes);

    const runs = [];
    for (let i = 0; i < testCase.runs; i += 1) {
      const r = hashFile(filePath, {
        offset: testCase.offset,
        length: testCase.length,
      });
      runs.push(r.elapsedMs);
    }
    const throughput = runs.map(
      (ms) => (testCase.length ?? testCase.bytes) / ms / 1024,
    ); // KiB/ms == MiB/s
    results.cases[testCase.name] = {
      bytes: testCase.length ?? testCase.bytes,
      offset: testCase.offset || 0,
      runs,
      firstRunMs: runs[0],
      medianMs: runs.slice().sort((a, b) => a - b)[Math.floor(runs.length / 2)],
      throughputMiBsMedian: Number(
        throughput.slice().sort((a, b) => a - b)[Math.floor(throughput.length / 2)].toFixed(2),
      ),
    };
    fs.rmSync(filePath, { force: true });
    process.stdout.write(
      `${testCase.name}: median=${results.cases[testCase.name].medianMs.toFixed(1)}ms first=${results.cases[testCase.name].firstRunMs.toFixed(1)}ms\n`,
    );
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(results, null, 2)}\n`);
  process.stdout.write(`written: ${OUT_PATH}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
