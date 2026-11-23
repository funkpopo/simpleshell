const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { round } = require("./stats");

const REPORT_SCHEMA_VERSION = 1;

function createMetric({
  name,
  suite,
  unit = "",
  value,
  direction = "lower",
  stats = null,
  meta = null,
}) {
  if (!name || typeof name !== "string") {
    throw new Error("Metric name must be a non-empty string");
  }
  if (!Number.isFinite(value)) {
    throw new Error(`Metric ${name} has non-finite value: ${value}`);
  }
  return {
    name,
    suite: suite || "general",
    unit,
    value: round(value, 3),
    direction,
    ...(stats ? { stats } : {}),
    ...(meta ? { meta } : {}),
  };
}

function readBaselineReport(baselinePath) {
  if (!baselinePath) return null;
  const resolved = path.resolve(baselinePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Baseline file not found: ${resolved}`);
  }
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function normalizeMetricsMap(metrics) {
  if (!metrics) return {};
  if (Array.isArray(metrics)) {
    const map = {};
    for (const entry of metrics) {
      if (entry && entry.name) map[entry.name] = entry;
    }
    return map;
  }
  return metrics;
}

function compareMetrics(currentMetrics, baselineReport, options = {}) {
  const thresholdPct =
    Number.isFinite(options.thresholdPct) && options.thresholdPct >= 0
      ? options.thresholdPct
      : 5;
  const currentMap = normalizeMetricsMap(currentMetrics);
  const baselineMap = normalizeMetricsMap(baselineReport?.metrics);
  const rows = [];
  const counts = {
    improved: 0,
    regressed: 0,
    unchanged: 0,
    new: 0,
    missing: 0,
  };

  for (const [name, current] of Object.entries(currentMap)) {
    const base = baselineMap[name];
    const currentValue = Number(current?.value);
    const baseValue = base !== undefined ? Number(base?.value) : NaN;

    if (!base || !Number.isFinite(baseValue)) {
      counts.new += 1;
      rows.push({
        name,
        suite: current.suite || "general",
        unit: current.unit || "",
        direction: current.direction || "lower",
        baseline: null,
        current: currentValue,
        delta: null,
        deltaPct: null,
        status: "new",
      });
      continue;
    }

    const delta = round(currentValue - baseValue, 3);
    const deltaPct =
      baseValue !== 0
        ? round(((currentValue - baseValue) / Math.abs(baseValue)) * 100, 2)
        : currentValue === 0
          ? 0
          : null;

    const direction = current.direction || base.direction || "lower";
    let status = "unchanged";

    if (
      direction !== "info" &&
      deltaPct !== null &&
      Math.abs(deltaPct) >= thresholdPct
    ) {
      if (direction === "higher") {
        status = delta > 0 ? "improved" : "regressed";
      } else {
        status = delta < 0 ? "improved" : "regressed";
      }
    }

    counts[status] += 1;
    rows.push({
      name,
      suite: current.suite || base.suite || "general",
      unit: current.unit || base.unit || "",
      direction,
      baseline: baseValue,
      current: currentValue,
      delta,
      deltaPct,
      status,
    });
  }

  const missingMetrics = Object.keys(baselineMap).filter(
    (name) => !Object.prototype.hasOwnProperty.call(currentMap, name),
  );
  counts.missing = missingMetrics.length;

  return {
    baselineGeneratedAt: baselineReport?.generatedAt || null,
    baselineMode: baselineReport?.mode || null,
    thresholdPct,
    rows,
    missingMetrics,
    summary: counts,
  };
}

function collectEnvironmentMetadata(extra = {}) {
  const cpus = os.cpus() || [];
  return {
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model ? cpus[0].model.trim() : "unknown",
    totalMemMB: round(os.totalmem() / (1024 * 1024), 0),
    ...extra,
  };
}

function buildReport({
  mode = "full",
  suites = [],
  metrics = {},
  context = {},
  durationMs = 0,
  environment = {},
}) {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    mode,
    durationMs: round(durationMs, 1),
    environment: collectEnvironmentMetadata(environment),
    context,
    suites,
    metrics: normalizeMetricsMap(metrics),
  };
}

function formatValueWithUnit(value, unit) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return unit ? `${value} ${unit}` : String(value);
}

function formatDeltaPct(deltaPct) {
  if (
    deltaPct === null ||
    deltaPct === undefined ||
    !Number.isFinite(deltaPct)
  ) {
    return "-";
  }
  const sign = deltaPct > 0 ? "+" : "";
  return `${sign}${deltaPct.toFixed(2)}%`;
}

function formatPercentiles(stats) {
  if (!stats || typeof stats !== "object" || !stats.count) {
    return "-";
  }
  return `p50=${stats.p50} p95=${stats.p95} p99=${stats.p99} (min=${stats.min}, max=${stats.max})`;
}

function formatMarkdownReport(report, comparison = null) {
  const lines = [];
  lines.push("# SimpleShell Benchmark Report");
  lines.push("");
  lines.push(`- **Generated**: ${report.generatedAt}`);
  lines.push(`- **Mode**: ${report.mode}`);
  lines.push(`- **Duration**: ${round(report.durationMs / 1000, 2)} s`);
  lines.push(
    `- **Environment**: ${report.environment.platform} | Node ${report.environment.node} | ${report.environment.cpuModel} (${report.environment.cpuCount} cores, ${report.environment.totalMemMB} MB RAM)`,
  );
  if (report.environment.gitBranch || report.environment.gitCommit) {
    lines.push(
      `- **Git**: ${report.environment.gitBranch || "unknown"} @ ${report.environment.gitCommit || "unknown"}`,
    );
  }
  lines.push("");

  if (Array.isArray(report.suites) && report.suites.length > 0) {
    lines.push("## Suites");
    lines.push("");
    lines.push("| Suite | Status | Duration (ms) | Metrics |");
    lines.push("| --- | --- | ---: | ---: |");
    for (const suite of report.suites) {
      lines.push(
        `| ${suite.name} | ${suite.status} | ${round(suite.durationMs, 1)} | ${suite.metricCount} |`,
      );
    }
    lines.push("");
  }

  const compByName = {};
  if (comparison && Array.isArray(comparison.rows)) {
    for (const row of comparison.rows) {
      compByName[row.name] = row;
    }
  }

  lines.push("## Metrics");
  lines.push("");
  if (comparison) {
    lines.push(
      `Baseline comparison (threshold ±${comparison.thresholdPct}%): **${comparison.summary.improved} improved**, **${comparison.summary.regressed} regressed**, ${comparison.summary.unchanged} unchanged, ${comparison.summary.new} new.`,
    );
    lines.push("");
    lines.push(
      "| Suite | Metric | Current | Baseline | Delta % | Status | Percentiles / Notes |",
    );
    lines.push("| --- | --- | ---: | ---: | ---: | --- | --- |");
  } else {
    lines.push("| Suite | Metric | Value | Percentiles / Notes |");
    lines.push("| --- | --- | ---: | --- |");
  }

  for (const metric of Object.values(report.metrics || {})) {
    const valStr = formatValueWithUnit(metric.value, metric.unit);
    const pctStr = formatPercentiles(metric.stats);
    if (comparison) {
      const comp = compByName[metric.name];
      const baseStr = comp
        ? formatValueWithUnit(comp.baseline, metric.unit)
        : "-";
      const deltaStr = comp ? formatDeltaPct(comp.deltaPct) : "-";
      const statusStr = comp ? comp.status : "-";
      lines.push(
        `| ${metric.suite} | \`${metric.name}\` | ${valStr} | ${baseStr} | ${deltaStr} | ${statusStr} | ${pctStr} |`,
      );
    } else {
      lines.push(
        `| ${metric.suite} | \`${metric.name}\` | ${valStr} | ${pctStr} |`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function formatConsoleSummary(report, comparison = null) {
  const lines = [];
  lines.push(
    `SimpleShell Benchmarks (${report.mode}) — ${report.environment.platform}, Node ${report.environment.node}, ${round(report.durationMs / 1000, 2)}s`,
  );
  lines.push("=".repeat(88));

  const compByName = {};
  if (comparison && Array.isArray(comparison.rows)) {
    for (const row of comparison.rows) {
      compByName[row.name] = row;
    }
  }

  let activeSuite = null;
  for (const metric of Object.values(report.metrics || {})) {
    if (metric.suite !== activeSuite) {
      activeSuite = metric.suite;
      lines.push(`\n[${activeSuite}]`);
    }
    const valStr = formatValueWithUnit(metric.value, metric.unit);
    const statsPart = metric.stats?.count
      ? `  [${formatPercentiles(metric.stats)}]`
      : "";
    let compPart = "";
    if (comparison) {
      const comp = compByName[metric.name];
      if (comp && comp.baseline !== null) {
        compPart = `  | base=${formatValueWithUnit(comp.baseline, metric.unit)} (${formatDeltaPct(comp.deltaPct)}, ${comp.status})`;
      } else if (comp) {
        compPart = "  | new";
      }
    }
    lines.push(
      `  ${metric.name.padEnd(44)} ${valStr.padStart(14)}${compPart}${statsPart}`,
    );
  }

  if (comparison) {
    lines.push("");
    lines.push(
      `Comparison summary: ${comparison.summary.improved} improved, ${comparison.summary.regressed} regressed, ${comparison.summary.unchanged} unchanged, ${comparison.summary.new} new, ${comparison.summary.missing} missing`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function writeReportFiles(
  report,
  comparison = null,
  { outputDir, saveBaselinePath = null } = {},
) {
  const resolvedOutDir = path.resolve(outputDir);
  fs.mkdirSync(resolvedOutDir, { recursive: true });

  const jsonPayload = comparison ? { ...report, comparison } : report;
  const serializedJson = `${JSON.stringify(jsonPayload, null, 2)}\n`;
  const markdown = formatMarkdownReport(report, comparison);

  const safeStamp = report.generatedAt.replace(/[:.]/g, "-");
  const latestJsonPath = path.join(resolvedOutDir, "latest.json");
  const latestMdPath = path.join(resolvedOutDir, "latest.md");
  const runJsonPath = path.join(resolvedOutDir, `run-${safeStamp}.json`);
  const runMdPath = path.join(resolvedOutDir, `run-${safeStamp}.md`);

  fs.writeFileSync(latestJsonPath, serializedJson, "utf8");
  fs.writeFileSync(latestMdPath, markdown, "utf8");
  fs.writeFileSync(runJsonPath, serializedJson, "utf8");
  fs.writeFileSync(runMdPath, markdown, "utf8");

  let baselineSavedPath = null;
  if (saveBaselinePath) {
    baselineSavedPath = path.resolve(saveBaselinePath);
    fs.mkdirSync(path.dirname(baselineSavedPath), { recursive: true });
    fs.writeFileSync(
      baselineSavedPath,
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    );
    if (baselineSavedPath.startsWith(resolvedOutDir + path.sep)) {
      const mdCompanion = baselineSavedPath.replace(/\.json$/i, ".md");
      if (mdCompanion !== baselineSavedPath) {
        fs.writeFileSync(mdCompanion, markdown, "utf8");
      }
    }
  }

  return {
    latestJsonPath,
    latestMdPath,
    runJsonPath,
    runMdPath,
    baselineSavedPath,
  };
}

module.exports = {
  REPORT_SCHEMA_VERSION,
  createMetric,
  readBaselineReport,
  compareMetrics,
  collectEnvironmentMetadata,
  buildReport,
  formatMarkdownReport,
  formatConsoleSummary,
  writeReportFiles,
};
