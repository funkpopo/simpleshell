const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { monitorEventLoopDelay } = require("node:perf_hooks");

const ROOT = path.resolve(__dirname, "../..");
const RESULTS_DIR = path.join(ROOT, ".cache", "perf");
const BASELINE_FILE = path.join(ROOT, "docs", "perf", "baseline.json");

// Keep the measured process free of file logging and crash-marker IO. The
// production modules otherwise run unchanged.
function stubMainRuntime() {
  for (const [name, exports] of [
    ["logger", { logToFile: () => {}, initLogger: () => {} }],
    ["crashReporter", { recordCrashMarker: () => {} }],
  ]) {
    const filename = require.resolve(`../../src/main/utils/${name}`);
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
  }
}

async function startShellServer() {
  const child = spawn(
    process.execPath,
    [path.join(__dirname, "shellServerProcess.js")],
    { stdio: ["pipe", "pipe", "inherit"], cwd: ROOT },
  );
  const lines = [];
  const waiters = [];
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(message);
      else lines.push(message);
    }
  });
  const next = () =>
    lines.length
      ? Promise.resolve(lines.shift())
      : new Promise((resolve) => waiters.push(resolve));
  const { port } = await next();
  return {
    port,
    config: {
      host: "127.0.0.1",
      port,
      username: "perf",
      password: "perf",
    },
    async stats() {
      child.stdin.write("stats\n");
      return (await next()).stats;
    },
    async close() {
      child.stdin.end();
      await new Promise((resolve) => {
        if (child.exitCode !== null) resolve();
        else child.once("exit", resolve);
      });
    },
  };
}

function startEventLoopMonitor() {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  return () => {
    histogram.disable();
    return {
      p50Ms: histogram.percentile(50) / 1e6,
      p99Ms: histogram.percentile(99) / 1e6,
      maxMs: histogram.max / 1e6,
    };
  };
}

// Native host processes (any image name) and their resident memory.
function listProcesses(imageName) {
  if (!imageName) return [];
  try {
    if (process.platform === "win32") {
      const output = execFileSync(
        "tasklist",
        ["/FO", "CSV", "/NH", "/FI", `IMAGENAME eq ${imageName}`],
        { encoding: "utf8", windowsHide: true },
      );
      return output
        .split(/\r?\n/)
        .filter((line) => line.startsWith('"'))
        .map((line) => {
          const cells = line.split('","').map((cell) => cell.replace(/"/g, ""));
          return {
            pid: Number(cells[1]),
            rssBytes: Number(cells[4].replace(/[^\d]/g, "")) * 1024,
          };
        })
        .filter((entry) => Number.isFinite(entry.pid));
    }
    const output = execFileSync("ps", ["-A", "-o", "pid=,rss=,comm="], {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter(
        (cells) => cells.length >= 3 && path.basename(cells[2]) === imageName,
      )
      .map((cells) => ({
        pid: Number(cells[0]),
        rssBytes: Number(cells[1]) * 1024,
      }));
  } catch {
    return [];
  }
}

function nativeImageName() {
  const binary = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
  return binary ? path.basename(binary) : null;
}

async function waitFor(
  predicate,
  { timeoutMs = 30000, label = "condition" } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function readBaseline() {
  try {
    return JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function formatComparison(metrics, baseline) {
  const rows = [];
  for (const [name, entry] of Object.entries(metrics)) {
    const base = baseline?.metrics?.[name];
    const value = entry.value;
    let delta = "";
    if (base && Number.isFinite(base.value) && base.value !== 0) {
      const ratio = value / base.value;
      delta = ` (baseline ${base.value}${entry.unit}, x${ratio.toFixed(2)})`;
    }
    rows.push(`  ${name}: ${value}${entry.unit}${delta}`);
  }
  return rows.join("\n");
}

function writeResults(metrics, context) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const label = process.env.SIMPLESHELL_PERF_LABEL || "latest";
  const report = {
    schemaVersion: 1,
    label,
    generatedAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    context,
    metrics,
  };
  const file = path.join(RESULTS_DIR, `${label}.json`);
  fs.writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.SIMPLESHELL_PERF_WRITE_BASELINE === "1") {
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify({ ...report, label: "baseline" }, null, 2)}\n`,
    );
  }
  return { file, report };
}

const round = (value, digits = 2) => Number(value.toFixed(digits));

module.exports = {
  ROOT,
  stubMainRuntime,
  startShellServer,
  startEventLoopMonitor,
  listProcesses,
  nativeImageName,
  waitFor,
  readBaseline,
  formatComparison,
  writeResults,
  round,
};
