#!/usr/bin/env node
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const {
  DEFAULT_BASELINE_PATH,
  DEFAULT_OUTPUT_DIR,
  getGitInfo,
} = require("./lib/env");
const {
  buildReport,
  compareMetrics,
  formatConsoleSummary,
  readBaselineReport,
  writeReportFiles,
} = require("./lib/reporter");

const SUITES = [
  {
    name: "startup-and-bundle",
    aliases: ["startup", "bundle"],
    load: () => require("./suites/startup-and-bundle.bench"),
  },
  {
    name: "terminal-pipeline",
    aliases: ["terminal", "pipeline"],
    load: () => require("./suites/terminal-pipeline.bench"),
  },
  {
    name: "webterminal-renderer",
    aliases: ["webterminal", "renderer", "xterm"],
    load: () => require("./suites/webterminal-renderer.bench"),
  },
  {
    name: "sftp-and-ui",
    aliases: ["sftp", "ui", "transfer"],
    load: () => require("./suites/sftp-and-ui.bench"),
  },
];

function resolveSuiteName(input) {
  const normalized = String(input || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === "all") return "all";
  for (const suite of SUITES) {
    if (suite.name === normalized || suite.aliases.includes(normalized)) {
      return suite.name;
    }
  }
  throw new Error(
    `Unknown benchmark suite "${input}". Available: ${SUITES.map((s) => s.name).join(", ")}, all`,
  );
}

function parseArgs(argv) {
  const options = {
    suites: [],
    saveBaselinePath: null,
    comparePath: null,
    json: false,
    quick: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--quick") {
      options.quick = true;
      continue;
    }
    if (arg === "--suite" || arg.startsWith("--suite=")) {
      const value = arg.includes("=") ? arg.split("=")[1] : argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("--suite requires a suite name or 'all'");
      }
      for (const part of value.split(",")) {
        const resolved = resolveSuiteName(part);
        if (resolved === "all") {
          options.suites = SUITES.map((s) => s.name);
        } else if (!options.suites.includes(resolved)) {
          options.suites.push(resolved);
        }
      }
      continue;
    }
    if (arg === "--save-baseline" || arg.startsWith("--save-baseline=")) {
      if (arg.includes("=")) {
        const value = arg.slice("--save-baseline=".length);
        options.saveBaselinePath = value
          ? path.resolve(value)
          : DEFAULT_BASELINE_PATH;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          options.saveBaselinePath = path.resolve(next);
          i += 1;
        } else {
          options.saveBaselinePath = DEFAULT_BASELINE_PATH;
        }
      }
      continue;
    }
    if (arg === "--compare" || arg.startsWith("--compare=")) {
      if (arg.includes("=")) {
        const value = arg.slice("--compare=".length);
        options.comparePath = value
          ? path.resolve(value)
          : DEFAULT_BASELINE_PATH;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          options.comparePath = path.resolve(next);
          i += 1;
        } else {
          options.comparePath = DEFAULT_BASELINE_PATH;
        }
      }
      continue;
    }
    if (arg === "--out" || arg.startsWith("--out=")) {
      const value = arg.includes("=") ? arg.slice("--out=".length) : argv[++i];
      if (!value || value.startsWith("-")) {
        throw new Error("--out requires a directory path");
      }
      options.outputDir = path.resolve(value);
      continue;
    }
    throw new Error(`Unknown CLI argument: ${arg}`);
  }

  if (options.suites.length === 0) {
    options.suites = SUITES.map((s) => s.name);
  }
  return options;
}

function printHelp() {
  const lines = [
    "SimpleShell Development Benchmark Runner (dev-only)",
    "",
    "Usage: node benchmarks/run.js [options]",
    "",
    "Options:",
    `  --suite <name|all>        Run specific suite(s): ${SUITES.map((s) => s.name).join(", ")}, or all (default: all)`,
    `  --save-baseline [path]    Save JSON baseline (default: ${path.relative(process.cwd(), DEFAULT_BASELINE_PATH)})`,
    "  --compare <baselinePath>  Compare results against a saved baseline JSON report",
    "  --quick                   Run reduced iteration/payload sizes for rapid local feedback",
    "  --json                    Emit structured JSON report to stdout",
    "  --out <dir>               Output directory for reports (default: .cache/benchmarks)",
    "  -h, --help                Show this help message",
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const baselineReport = options.comparePath
    ? readBaselineReport(options.comparePath)
    : null;

  const selectedSuites = options.suites.map((suiteName) => {
    const entry = SUITES.find((s) => s.name === suiteName);
    return entry.load();
  });

  const suiteSummaries = [];
  const metricsMap = {};
  const contextMap = {};
  const totalStart = performance.now();
  let failed = false;

  for (const suite of selectedSuites) {
    if (!options.json) {
      process.stderr.write(
        `[bench] Running suite "${suite.name}" (${options.quick ? "quick" : "full"})...\n`,
      );
    }
    const suiteStart = performance.now();
    try {
      const result = await suite.run({ quick: options.quick });
      const durationMs = performance.now() - suiteStart;
      for (const metric of result.metrics || []) {
        metricsMap[metric.name] = metric;
      }
      if (result.context) {
        contextMap[suite.name] = result.context;
      }
      suiteSummaries.push({
        name: suite.name,
        status: "passed",
        durationMs,
        metricCount: (result.metrics || []).length,
      });
    } catch (error) {
      failed = true;
      const durationMs = performance.now() - suiteStart;
      suiteSummaries.push({
        name: suite.name,
        status: "failed",
        durationMs,
        metricCount: 0,
        error: String(error?.stack || error),
      });
      if (!options.json) {
        process.stderr.write(
          `[bench] Suite "${suite.name}" failed: ${error?.stack || error}\n`,
        );
      }
    }
  }

  const totalDurationMs = performance.now() - totalStart;
  const gitInfo = getGitInfo();
  const report = buildReport({
    mode: options.quick ? "quick" : "full",
    suites: suiteSummaries,
    metrics: metricsMap,
    context: contextMap,
    durationMs: totalDurationMs,
    environment: {
      gitBranch: gitInfo.branch,
      gitCommit: gitInfo.commit,
    },
  });

  const comparison = baselineReport
    ? compareMetrics(report.metrics, baselineReport)
    : null;

  const written = writeReportFiles(report, comparison, {
    outputDir: options.outputDir,
    saveBaselinePath: options.saveBaselinePath,
  });

  if (options.json) {
    const payload = comparison ? { ...report, comparison } : report;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(formatConsoleSummary(report, comparison));
    process.stdout.write(
      `\nReports written:\n  JSON: ${written.latestJsonPath}\n  Markdown: ${written.latestMdPath}\n`,
    );
    if (written.baselineSavedPath) {
      process.stdout.write(`  Baseline: ${written.baselineSavedPath}\n`);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[bench] Fatal error: ${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SUITES,
  parseArgs,
  resolveSuiteName,
};
