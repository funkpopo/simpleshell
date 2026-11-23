import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));

const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const stats = require(path.join(ROOT, "benchmarks/lib/stats.js"));
const reporter = require(path.join(ROOT, "benchmarks/lib/reporter.js"));
const runner = require(path.join(ROOT, "benchmarks/run.js"));

function walkJsFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".cache") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJsFiles(fullPath, files);
    } else if (/\.(?:js|jsx|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function collectModuleSpecifiers(filename) {
  const source = fs.readFileSync(filename, "utf8");
  const ast = parse(source, {
    sourceType: "unambiguous",
    plugins: ["jsx"],
  });
  const specifiers = [];
  traverse(ast, {
    ImportDeclaration({ node }) {
      if (node.source?.value) specifiers.push(node.source.value);
    },
    ExportNamedDeclaration({ node }) {
      if (node.source?.value) specifiers.push(node.source.value);
    },
    ExportAllDeclaration({ node }) {
      if (node.source?.value) specifiers.push(node.source.value);
    },
    CallExpression({ node }) {
      if (
        node.callee.name === "require" ||
        node.callee.type === "Import" ||
        (node.callee.object?.name === "require" &&
          node.callee.property?.name === "resolve")
      ) {
        const arg = node.arguments[0]?.value;
        if (typeof arg === "string") specifiers.push(arg);
      }
    },
  });
  return { source, specifiers };
}

describe("benchmark production isolation", () => {
  it("contains zero imports or references to benchmarks/ anywhere in src/", () => {
    const srcFiles = walkJsFiles(path.join(ROOT, "src"));
    expect(srcFiles.length).toBeGreaterThan(0);

    const violations = [];
    for (const file of srcFiles) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      const { specifiers } = collectModuleSpecifiers(file);
      for (const specifier of specifiers) {
        if (
          specifier === "benchmarks" ||
          specifier.startsWith("benchmarks/") ||
          specifier.includes("/benchmarks/") ||
          specifier.includes("\\benchmarks\\") ||
          specifier.endsWith("/benchmarks")
        ) {
          violations.push(`${rel}: imports ${specifier}`);
        }
        if (specifier.startsWith(".")) {
          const resolved = path.resolve(path.dirname(file), specifier);
          const resolvedRel = path.relative(ROOT, resolved).replace(/\\/g, "/");
          if (
            resolvedRel === "benchmarks" ||
            resolvedRel.startsWith("benchmarks/")
          ) {
            violations.push(`${rel}: resolves to ${resolvedRel}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("excludes benchmarks/ from forge.config.js and all webpack configs", async () => {
    const configFiles = [
      "forge.config.js",
      "webpack.main.config.js",
      "webpack.preload.config.js",
      "webpack.renderer.config.js",
      "webpack.rules.js",
    ];

    for (const rel of configFiles) {
      const fullPath = path.join(ROOT, rel);
      const { source, specifiers } = collectModuleSpecifiers(fullPath);
      expect(
        specifiers.some((s) => s.includes("benchmarks")),
        `${rel} must not import benchmarks/`,
      ).toBe(false);
      expect(
        /(?:^|['"`\\/])benchmarks(?:['"`\\/]|$)/m.test(source),
        `${rel} must not reference benchmarks/`,
      ).toBe(false);
    }

    const forgeConfig = await require(path.join(ROOT, "forge.config.js"))();
    const serializedForge = JSON.stringify(forgeConfig);
    expect(serializedForge).not.toContain("benchmarks");
  });

  it("uses only declared package.json dependencies or Node/Electron built-ins under benchmarks/", () => {
    const pkg = require(path.join(ROOT, "package.json"));
    const declared = new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      "electron",
    ]);
    const builtins = new Set(builtinModules);
    const benchFiles = walkJsFiles(path.join(ROOT, "benchmarks"));
    expect(benchFiles.length).toBeGreaterThan(0);

    const missing = [];
    for (const file of benchFiles) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      const { specifiers } = collectModuleSpecifiers(file);
      for (const specifier of specifiers) {
        if (
          specifier.startsWith(".") ||
          specifier.startsWith("/") ||
          specifier.startsWith("node:") ||
          builtins.has(specifier)
        ) {
          continue;
        }
        const pkgName = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : specifier.split("/")[0];
        if (!declared.has(pkgName)) {
          missing.push(`${rel}: undeclared dependency ${pkgName}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});

describe("benchmark stats utilities", () => {
  it("computes percentiles, summary statistics, ops/s, throughput, and memory delta accurately", async () => {
    expect(stats.percentile([], 50)).toBe(0);
    expect(stats.percentile([42], 99)).toBe(42);
    expect(stats.percentile([10, 20, 30, 40], 50)).toBe(25);
    expect(stats.percentile([10, 20, 30, 40], 95)).toBeCloseTo(38.5, 5);

    const summary = stats.summarizeSamples([100, 10, 50, 20, 40, NaN]);
    expect(summary.count).toBe(5);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(100);
    expect(summary.p50).toBe(40);
    expect(summary.mean).toBe(44);
    expect(summary.p95).toBeGreaterThanOrEqual(summary.p50);
    expect(summary.p99).toBeGreaterThanOrEqual(summary.p95);

    expect(stats.computeOpsPerSec(500, 250)).toBe(2000);
    expect(stats.computeThroughputMBps(10 * 1024 * 1024, 2000)).toBe(5);

    const memDelta = stats.computeMemoryDelta(
      { rssMB: 100, heapUsedMB: 40, heapTotalMB: 60 },
      { rssMB: 125.5, heapUsedMB: 52.25, heapTotalMB: 70 },
    );
    expect(memDelta.rssDeltaMB).toBe(25.5);
    expect(memDelta.heapUsedDeltaMB).toBe(12.25);

    const syncRes = stats.measureSync(() => {}, {
      iterations: 4,
      warmup: 1,
      opsPerIteration: 10,
    });
    expect(syncRes.stats.count).toBe(4);
    expect(syncRes.opsPerSec).toBeGreaterThanOrEqual(0);

    const asyncRes = await stats.measureAsync(async () => {}, {
      iterations: 3,
      warmup: 1,
      opsPerIteration: 5,
    });
    expect(asyncRes.stats.count).toBe(3);
  });
});

describe("benchmark reporter & CLI parser", () => {
  it("compares metrics against a baseline respecting higher/lower directions and writes JSON + Markdown reports", () => {
    const baseline = reporter.buildReport({
      mode: "full",
      suites: [
        { name: "s1", status: "passed", durationMs: 100, metricCount: 4 },
      ],
      metrics: {
        "throughput.mbps": reporter.createMetric({
          name: "throughput.mbps",
          suite: "s1",
          unit: "MB/s",
          value: 100,
          direction: "higher",
        }),
        "latency.ms": reporter.createMetric({
          name: "latency.ms",
          suite: "s1",
          unit: "ms",
          value: 20,
          direction: "lower",
        }),
        "stable.ms": reporter.createMetric({
          name: "stable.ms",
          suite: "s1",
          unit: "ms",
          value: 50,
          direction: "lower",
        }),
        "removed.ms": reporter.createMetric({
          name: "removed.ms",
          suite: "s1",
          unit: "ms",
          value: 10,
          direction: "lower",
        }),
      },
      durationMs: 100,
    });

    const current = reporter.buildReport({
      mode: "full",
      suites: [
        { name: "s1", status: "passed", durationMs: 90, metricCount: 4 },
      ],
      metrics: {
        "throughput.mbps": reporter.createMetric({
          name: "throughput.mbps",
          suite: "s1",
          unit: "MB/s",
          value: 120,
          direction: "higher",
        }),
        "latency.ms": reporter.createMetric({
          name: "latency.ms",
          suite: "s1",
          unit: "ms",
          value: 25,
          direction: "lower",
        }),
        "stable.ms": reporter.createMetric({
          name: "stable.ms",
          suite: "s1",
          unit: "ms",
          value: 51,
          direction: "lower",
        }),
        "brandNew.ops": reporter.createMetric({
          name: "brandNew.ops",
          suite: "s1",
          unit: "ops/s",
          value: 5000,
          direction: "higher",
        }),
      },
      durationMs: 90,
    });

    const comparison = reporter.compareMetrics(current.metrics, baseline, {
      thresholdPct: 5,
    });
    const byName = Object.fromEntries(
      comparison.rows.map((row) => [row.name, row]),
    );

    expect(byName["throughput.mbps"].status).toBe("improved");
    expect(byName["throughput.mbps"].deltaPct).toBe(20);
    expect(byName["latency.ms"].status).toBe("regressed");
    expect(byName["latency.ms"].deltaPct).toBe(25);
    expect(byName["stable.ms"].status).toBe("unchanged");
    expect(byName["brandNew.ops"].status).toBe("new");
    expect(comparison.missingMetrics).toEqual(["removed.ms"]);
    expect(comparison.summary).toEqual({
      improved: 1,
      regressed: 1,
      unchanged: 1,
      new: 1,
      missing: 1,
    });

    const tempOut = fs.mkdtempSync(
      path.join(os.tmpdir(), "bench-report-test-"),
    );
    try {
      const baselineTarget = path.join(tempOut, "baseline.json");
      const written = reporter.writeReportFiles(current, comparison, {
        outputDir: tempOut,
        saveBaselinePath: baselineTarget,
      });
      expect(fs.existsSync(written.latestJsonPath)).toBe(true);
      expect(fs.existsSync(written.latestMdPath)).toBe(true);
      expect(fs.existsSync(written.baselineSavedPath)).toBe(true);

      const loadedBaseline = reporter.readBaselineReport(baselineTarget);
      expect(loadedBaseline.metrics["throughput.mbps"].value).toBe(120);
      const md = fs.readFileSync(written.latestMdPath, "utf8");
      expect(md).toContain("SimpleShell Benchmark Report");
      expect(md).toContain("+20.00%");
      expect(md).toContain("improved");
      expect(md).toContain("regressed");
    } finally {
      fs.rmSync(tempOut, { recursive: true, force: true });
    }
  });

  it("parses CLI options including --suite, --save-baseline, --compare, --json, and --quick", () => {
    const parsedDefaultSave = runner.parseArgs([
      "--suite",
      "startup,sftp",
      "--save-baseline",
      "--quick",
      "--json",
    ]);
    expect(parsedDefaultSave.suites).toEqual([
      "startup-and-bundle",
      "sftp-and-ui",
    ]);
    expect(parsedDefaultSave.saveBaselinePath).toMatch(
      /[\\/]\.cache[\\/]benchmarks[\\/]baseline\.json$/,
    );
    expect(parsedDefaultSave.quick).toBe(true);
    expect(parsedDefaultSave.json).toBe(true);

    const parsedExplicit = runner.parseArgs([
      "--suite=all",
      "--compare",
      ".cache/benchmarks/custom.json",
    ]);
    expect(parsedExplicit.suites).toEqual([
      "startup-and-bundle",
      "terminal-pipeline",
      "webterminal-renderer",
      "sftp-and-ui",
    ]);
    expect(parsedExplicit.comparePath).toBe(
      path.resolve(".cache/benchmarks/custom.json"),
    );
  });
});
