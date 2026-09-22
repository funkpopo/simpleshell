#!/usr/bin/env node
/**
 * ZMODEM 检测/透传开销基线（Phase 0 / P0.4）。
 *
 * 测量普通终端连续输出经过 zmodemTransferService.feedOutput 的开销：
 * 连续输出、含相似前缀输出、跨块起始序列拆分。结果写入 docs/baseline-zmodem.json。
 */

const path = require("node:path");
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");

const OUT_PATH = path.join(__dirname, "..", "docs", "baseline-zmodem.json");

function createService() {
  const { ZmodemTransferService } = require(
    path.join(
      process.cwd(),
      "src",
      "main",
      "terminal",
      "zmodemTransferService.js",
    ),
  );
  return new ZmodemTransferService({
    emitIpc: () => {},
    getMainWindow: () => null,
  });
}

function runCase(name, feed) {
  const service = createService();
  const context = {
    stream: null,
    tabId: "tab-1",
    sshConfig: { tabId: "tab-1" },
  };
  const runs = [];
  for (let i = 0; i < 10; i += 1) {
    const start = performance.now();
    let fed = 0;
    for (const chunk of feed()) {
      service.feedOutput("bench", chunk, context);
      fed += chunk.length;
    }
    runs.push({ elapsedMs: performance.now() - start, bytes: fed });
  }
  const median = runs.map((r) => r.elapsedMs).sort((a, b) => a - b)[5];
  return {
    name,
    runs: runs.map((r) => Number(r.elapsedMs.toFixed(3))),
    medianMs: Number(median.toFixed(3)),
    bytesPerRun: runs[0].bytes,
  };
}

function normalOutputChunks() {
  const line = Buffer.from(
    "$ ls -la /tmp/example-directory\r\ntotal 42\r\n".repeat(64),
  );
  return Array.from({ length: 50 }, () => line);
}

function prefixLikeChunks() {
  const line = Buffer.from("$ echo **B0 something\r\noutput\r\n".repeat(32));
  return Array.from({ length: 50 }, () => line);
}

function splitIntroChunks() {
  // 起始序列跨块：每块之间插入普通输出，检测器需要扣留前缀
  const chunks = [];
  chunks.push(Buffer.from("$ prompt\r\n"));
  chunks.push(Buffer.from([42, 42, 24, 66]));
  return chunks;
}

async function main() {
  const results = [
    runCase("continuous-output", normalOutputChunks),
    runCase("prefix-like-output", prefixLikeChunks),
    runCase("split-intro-prefix", splitIntroChunks),
  ];
  const out = {
    platform: process.platform,
    timestamp: new Date().toISOString(),
    note: "普通终端输出经 feedOutput 检测的 JS 基线开销；p95 目标为单次新增延迟不超过 10ms",
    results,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(JSON.stringify(results, null, 2));
  process.stdout.write(`\nwritten: ${OUT_PATH}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
