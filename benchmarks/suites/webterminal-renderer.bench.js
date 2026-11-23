const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { ROOT, DEFAULT_OUTPUT_DIR } = require("../lib/env");
const { round } = require("../lib/stats");
const { createMetric } = require("../lib/reporter");

const SUITE = "webterminal-renderer";

async function compileRendererFixture(outputDir) {
  await fsp.mkdir(outputDir, { recursive: true });
  const baseFactory = require(path.join(ROOT, "webpack.renderer.config.js"));
  const base = baseFactory({}, { mode: "production" });

  const compiler = webpack({
    ...base,
    mode: "production",
    devtool: false,
    target: "electron-renderer",
    entry: {
      bench: path.join(
        ROOT,
        "benchmarks/fixtures/webterminal-bench-renderer.jsx",
      ),
    },
    output: {
      path: outputDir,
      filename: "[name].js",
      publicPath: "",
    },
    cache: {
      type: "filesystem",
      cacheDirectory: path.join(DEFAULT_OUTPUT_DIR, "webpack-cache-fixture"),
    },
    optimization: { ...base.optimization, minimize: true },
    plugins: [
      new HtmlWebpackPlugin({
        templateContent:
          '<!doctype html><html><head><meta charset="UTF-8"></head><body style="margin:0;overflow:hidden"><div id="root"></div></body></html>',
      }),
    ],
    performance: { hints: false },
  });

  await new Promise((resolve, reject) => {
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats?.hasErrors()) {
        reject(
          error || new Error(stats.toString({ all: false, errors: true })),
        );
        return;
      }
      resolve();
    });
  });

  // Append query string support via a small redirect or load directly; electron loads index.html cleanly.
}

async function runElectronFixture(outputDir, quick) {
  const electronBinary = require("electron");
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  // Inject quick flag into index.html query or global variable when quick mode is enabled.
  const indexPath = path.join(outputDir, "index.html");
  const originalHtml = await fsp.readFile(indexPath, "utf8");
  if (quick && !originalHtml.includes("?quick=1")) {
    await fsp.writeFile(
      indexPath,
      originalHtml.replace(
        "<head>",
        '<head><script>if(!location.search.includes("quick=1"))history.replaceState(null,"","?quick=1");</script>',
      ),
      "utf8",
    );
  }

  await new Promise((resolve, reject) => {
    const child = spawn(
      electronBinary,
      [
        path.join(ROOT, "benchmarks/fixtures/webterminal-bench-electron.js"),
        outputDir,
      ],
      {
        cwd: ROOT,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let log = "";
    child.stdout.on("data", (chunk) => {
      log += chunk;
    });
    child.stderr.on("data", (chunk) => {
      log += chunk;
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Electron WebTerminal benchmark timed out\n${log}`));
    }, 180000);

    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on("exit", async (code) => {
      clearTimeout(timeout);
      await fsp.writeFile(path.join(outputDir, "electron.log"), log, "utf8");
      const metricsPath = path.join(outputDir, "metrics.json");
      if (fs.existsSync(metricsPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
          if (parsed && parsed.success === false && parsed.error) {
            reject(new Error(`WebTerminal renderer failed: ${parsed.error}`));
            return;
          }
        } catch {
          // Fall through to generic exit error below
        }
      }
      if (code === 0) resolve();
      else
        reject(
          new Error(`Electron WebTerminal benchmark exited ${code}\n${log}`),
        );
    });
  });

  const metricsPath = path.join(outputDir, "metrics.json");
  const result = JSON.parse(fs.readFileSync(metricsPath, "utf8"));
  if (!result.success) {
    throw new Error(`WebTerminal renderer failed: ${result.error}`);
  }
  return result.metrics;
}

function toMetricStats(summary) {
  if (!summary) return null;
  return {
    count: summary.count,
    min: round(summary.min),
    p50: round(summary.p50),
    p95: round(summary.p95),
    p99: round(summary.p99),
    max: round(summary.max),
    mean: round(summary.mean),
    stdDev: 0,
  };
}

async function run({ quick = false } = {}) {
  const fixtureDir = path.join(DEFAULT_OUTPUT_DIR, "electron-renderer");
  fs.rmSync(fixtureDir, { recursive: true, force: true });
  await compileRendererFixture(fixtureDir);
  const raw = await runElectronFixture(fixtureDir, quick);

  const metrics = [
    createMetric({
      name: "renderer.stream50k.domMBps",
      suite: SUITE,
      unit: "MB/s",
      value: raw.stream50kDom.throughputMBps,
      direction: "higher",
      meta: { maxGapMs: round(raw.stream50kDom.maxGapMs) },
    }),
    createMetric({
      name: "renderer.stream500k.domMBps",
      suite: SUITE,
      unit: "MB/s",
      value: raw.stream500kDom.throughputMBps,
      direction: "higher",
      meta: { maxGapMs: round(raw.stream500kDom.maxGapMs) },
    }),
    createMetric({
      name: "renderer.scrollback500k.fillMs",
      suite: SUITE,
      unit: "ms",
      value: raw.fillTo500kMs,
      direction: "lower",
    }),
    createMetric({
      name: "renderer.search50k.scanMs",
      suite: SUITE,
      unit: "ms",
      value: raw.search50k.scanMs,
      direction: "lower",
      meta: { lineReads: raw.search50k.scanLineReads },
    }),
    createMetric({
      name: "renderer.search50k.maxHeartbeatGapMs",
      suite: SUITE,
      unit: "ms",
      value: raw.search50k.maxGapMs,
      direction: "lower",
    }),
    createMetric({
      name: "renderer.search50k.cachedJumpMs",
      suite: SUITE,
      unit: "ms",
      value: raw.search50k.jumpStats.p50,
      direction: "lower",
      stats: toMetricStats(raw.search50k.jumpStats),
      meta: { lineReads: raw.search50k.jumpLineReads },
    }),
    createMetric({
      name: "renderer.search500k.scanMs",
      suite: SUITE,
      unit: "ms",
      value: raw.search500k.scanMs,
      direction: "lower",
      meta: { lineReads: raw.search500k.scanLineReads },
    }),
    createMetric({
      name: "renderer.search500k.maxHeartbeatGapMs",
      suite: SUITE,
      unit: "ms",
      value: raw.search500k.maxGapMs,
      direction: "lower",
    }),
    createMetric({
      name: "renderer.search500k.cachedJumpMs",
      suite: SUITE,
      unit: "ms",
      value: raw.search500k.jumpStats.p50,
      direction: "lower",
      stats: toMetricStats(raw.search500k.jumpStats),
      meta: { lineReads: raw.search500k.jumpLineReads },
    }),
    createMetric({
      name: "renderer.prompt.detectMs",
      suite: SUITE,
      unit: "ms",
      value: raw.promptAndLink.promptStats.p50,
      direction: "lower",
      stats: toMetricStats(raw.promptAndLink.promptStats),
      meta: {
        wrappedPromptMs: round(raw.promptAndLink.wrappedPromptMs),
        wrappedPromptReads: raw.promptAndLink.wrappedPromptReads,
      },
    }),
    createMetric({
      name: "renderer.link.detectMs",
      suite: SUITE,
      unit: "ms",
      value: raw.promptAndLink.linkStats.p50,
      direction: "lower",
      stats: toMetricStats(raw.promptAndLink.linkStats),
      meta: {
        wrappedLinkMs: round(raw.promptAndLink.wrappedLinkMs),
        wrappedLinkReads: raw.promptAndLink.wrappedLinkReads,
      },
    }),
    createMetric({
      name: "renderer.input50k.echoMs",
      suite: SUITE,
      unit: "ms",
      value: raw.input50k.p50,
      direction: "lower",
      stats: toMetricStats(raw.input50k),
    }),
    createMetric({
      name: "renderer.input500k.echoMs",
      suite: SUITE,
      unit: "ms",
      value: raw.input500k.p50,
      direction: "lower",
      stats: toMetricStats(raw.input500k),
    }),
    createMetric({
      name: "renderer.resize50k.reflowMs",
      suite: SUITE,
      unit: "ms",
      value: raw.resize50k.stats.p50,
      direction: "lower",
      stats: toMetricStats(raw.resize50k.stats),
    }),
    createMetric({
      name: "renderer.resize500k.reflowMs",
      suite: SUITE,
      unit: "ms",
      value: raw.resize500k.stats.p50,
      direction: "lower",
      stats: toMetricStats(raw.resize500k.stats),
    }),
    createMetric({
      name: "renderer.memory.rssMB",
      suite: SUITE,
      unit: "MB",
      value: raw.memory.rendererRssMB,
      direction: "lower",
      meta: {
        history500kCellMB: round(raw.memory.history500kCellMB, 2),
        electronTotalWorkingSetMB: round(
          raw.memory.electronTotalWorkingSetMB,
          2,
        ),
        electronTotalPrivateMB: round(raw.memory.electronTotalPrivateMB, 2),
      },
    }),
    createMetric({
      name: "renderer.memory.electronWorkingSetMB",
      suite: SUITE,
      unit: "MB",
      value: raw.memory.electronTotalWorkingSetMB,
      direction: "lower",
    }),
  ];

  if (raw.webgl?.supported && raw.stream500kWebgl) {
    metrics.push(
      createMetric({
        name: "renderer.stream500k.webglMBps",
        suite: SUITE,
        unit: "MB/s",
        value: raw.stream500kWebgl.throughputMBps,
        direction: "higher",
        meta: {
          maxGapMs: round(raw.stream500kWebgl.maxGapMs),
          switchMs: round(raw.webgl.switchMs),
        },
      }),
    );
  }

  return {
    name: SUITE,
    metrics,
    context: {
      quick,
      webglSupported: Boolean(raw.webgl?.supported),
      scrollbackDefault: 50000,
      scrollbackMax: 500000,
    },
  };
}

module.exports = {
  name: SUITE,
  description:
    "Real Electron WebTerminal/xterm.js benchmark: 50k/500k scrollback throughput (zero truncation), search scan+jump+heartbeat, prompt/link overhead, input echo p50/p95/p99, resize reflow, and RSS",
  run,
};
