#!/usr/bin/env node
/**
 * 延迟服务基线（Phase 0 / P0.4）。
 *
 * 使用本地 TCP 测试服务测量 networkLatencyService 在 1、4、20 个连接、
 * 主进程空闲/忙碌时的探测耗时与调度延迟。耗时从调用端（data.nextCheckAt 到期）
 * 开始统计，覆盖调度与测量两个独立指标。
 *
 * 用法：node scripts/baseline/benchmark-latency.js
 * 结果写入 docs/baseline-latency.json。
 */

const net = require("node:net");
const path = require("node:path");
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");

const OUT_PATH = path.join(__dirname, "..", "docs", "baseline-latency.json");

async function measureWithConnections(count, busy) {
  const service = new (require(
    path.join(
      process.cwd(),
      "src",
      "main",
      "services",
      "networkLatencyService.js",
    ),
  ))();
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const completions = new Map();
  service.on("latency:updated", (info) =>
    completions.set(info.tabId, performance.now()),
  );

  service.start();
  const scheduleStart = performance.now();
  for (let i = 0; i < count; i += 1) {
    service.registerSSHConnection(`tab-${i}`, null, "127.0.0.1", port, null);
  }

  const busyTimer = busy
    ? setInterval(() => {
        // 模拟主进程忙碌：同步阻塞 20ms
        const start = Date.now();
        while (Date.now() - start < 20) {
          /* spin */
        }
      }, 25)
    : null;

  const deadline = performance.now() + 30000;
  while (completions.size < count && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (busyTimer) clearInterval(busyTimer);

  const latencies = [];
  for (const [, data] of service.latencyData) {
    if (data.latency !== null) latencies.push(data.latency);
  }
  const scheduledDelays = [];
  for (const tabId of service.latencyData.keys()) {
    if (completions.has(tabId)) {
      // 调度延迟 = 到完成时刻 - 到期时刻；基线用注册后到完成的墙钟差近似
      scheduledDelays.push(completions.get(tabId) - scheduleStart);
    }
  }
  service.stop();
  server.close();

  const median = (arr) =>
    arr.length
      ? arr.slice().sort((a, b) => a - b)[Math.floor(arr.length / 2)]
      : null;
  return {
    connections: count,
    busy,
    measured: latencies.length,
    medianProbeMs: median(latencies),
    medianCompletionMs:
      median(scheduledDelays) !== null
        ? Math.round(median(scheduledDelays))
        : null,
  };
}

async function main() {
  const results = [];
  for (const count of [1, 4, 20]) {
    results.push(await measureWithConnections(count, false));
    results.push(await measureWithConnections(count, true));
  }
  const out = {
    platform: process.platform,
    timestamp: new Date().toISOString(),
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
