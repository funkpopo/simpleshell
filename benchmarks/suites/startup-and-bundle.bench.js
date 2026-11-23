const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const webpack = require("webpack");
const { ROOT, DEFAULT_OUTPUT_DIR, stubMainRuntime } = require("../lib/env");
const {
  round,
  summarizeSamples,
  computeOpsPerSec,
  measureSync,
} = require("../lib/stats");
const { createMetric } = require("../lib/reporter");

const SUITE = "startup-and-bundle";

function runWebpackCompiler(config) {
  return new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => {
      const finish = () => {
        if (error) {
          reject(error);
          return;
        }
        if (stats?.hasErrors()) {
          reject(new Error(stats.toString({ all: false, errors: true })));
          return;
        }
        resolve(stats);
      };
      if (typeof compiler.close === "function") {
        compiler.close(() => finish());
      } else {
        finish();
      }
    });
  });
}

async function auditBundles(quick) {
  const auditDir = path.join(DEFAULT_OUTPUT_DIR, "webpack-audit");
  const rendererOutDir = path.join(auditDir, "renderer");
  const mainOutDir = path.join(auditDir, "main");
  fs.rmSync(auditDir, { recursive: true, force: true });
  fs.mkdirSync(rendererOutDir, { recursive: true });
  fs.mkdirSync(mainOutDir, { recursive: true });

  const rendererFactory = require(
    path.join(ROOT, "webpack.renderer.config.js"),
  );
  const mainFactory = require(path.join(ROOT, "webpack.main.config.js"));

  const baseRenderer = rendererFactory({}, { mode: "production" });
  const rendererStart = performance.now();
  const rendererStats = await runWebpackCompiler({
    ...baseRenderer,
    mode: "production",
    target: "electron-renderer",
    devtool: false,
    entry: path.join(ROOT, "src/renderer/main.jsx"),
    output: {
      path: rendererOutDir,
      filename: "[name].js",
      chunkFilename: "[name].[contenthash].js",
      publicPath: "",
    },
    cache: quick
      ? {
          type: "filesystem",
          cacheDirectory: path.join(
            DEFAULT_OUTPUT_DIR,
            "webpack-cache-renderer",
          ),
        }
      : false,
    performance: { hints: false },
  });
  const rendererBuildMs = performance.now() - rendererStart;

  const chunkBreakdown = [];
  let initialJsBytes = 0;
  let asyncJsBytes = 0;
  for (const chunk of rendererStats.compilation.chunks) {
    const isInitial = chunk.canBeInitial();
    for (const file of chunk.files) {
      if (!file.endsWith(".js")) continue;
      const asset = rendererStats.compilation.getAsset(file);
      const bytes = asset ? asset.source.size() : 0;
      if (isInitial) initialJsBytes += bytes;
      else asyncJsBytes += bytes;
      chunkBreakdown.push({ file, initial: isInitial, bytes });
    }
  }
  let rendererTotalAssetBytes = 0;
  for (const asset of rendererStats.compilation.getAssets()) {
    rendererTotalAssetBytes += asset.source.size();
  }

  const baseMain = mainFactory({}, { mode: "production" });
  const mainStart = performance.now();
  const mainStats = await runWebpackCompiler({
    ...baseMain,
    mode: "production",
    target: "electron-main",
    devtool: false,
    output: {
      ...(baseMain.output || {}),
      path: mainOutDir,
      filename: "[name].cjs",
    },
    // Skip CopyAssets afterEmit plugin so benchmark never writes into .webpack/main.
    plugins: [],
    cache: quick
      ? {
          type: "filesystem",
          cacheDirectory: path.join(DEFAULT_OUTPUT_DIR, "webpack-cache-main"),
        }
      : false,
    performance: { hints: false },
  });
  const mainBuildMs = performance.now() - mainStart;

  let mainBundleBytes = 0;
  let mainTotalAssetBytes = 0;
  for (const asset of mainStats.compilation.getAssets()) {
    const size = asset.source.size();
    mainTotalAssetBytes += size;
    if (asset.name === "index.cjs") {
      mainBundleBytes = size;
    }
  }

  fs.rmSync(auditDir, { recursive: true, force: true });

  return [
    createMetric({
      name: "startup.bundle.rendererBuildMs",
      suite: SUITE,
      unit: "ms",
      value: rendererBuildMs,
      direction: "lower",
    }),
    createMetric({
      name: "startup.bundle.rendererInitialJsBytes",
      suite: SUITE,
      unit: "bytes",
      value: initialJsBytes,
      direction: "lower",
      meta: {
        initialChunks: chunkBreakdown.filter((item) => item.initial),
      },
    }),
    createMetric({
      name: "startup.bundle.rendererAsyncJsBytes",
      suite: SUITE,
      unit: "bytes",
      value: asyncJsBytes,
      direction: "lower",
      meta: {
        asyncChunkCount: chunkBreakdown.filter((item) => !item.initial).length,
      },
    }),
    createMetric({
      name: "startup.bundle.rendererTotalJsBytes",
      suite: SUITE,
      unit: "bytes",
      value: initialJsBytes + asyncJsBytes,
      direction: "lower",
    }),
    createMetric({
      name: "startup.bundle.rendererTotalAssetBytes",
      suite: SUITE,
      unit: "bytes",
      value: rendererTotalAssetBytes,
      direction: "lower",
    }),
    createMetric({
      name: "startup.bundle.rendererChunkCount",
      suite: SUITE,
      unit: "chunks",
      value: chunkBreakdown.length,
      direction: "info",
    }),
    createMetric({
      name: "startup.bundle.mainBuildMs",
      suite: SUITE,
      unit: "ms",
      value: mainBuildMs,
      direction: "lower",
    }),
    createMetric({
      name: "startup.bundle.mainBundleBytes",
      suite: SUITE,
      unit: "bytes",
      value: mainBundleBytes || mainTotalAssetBytes,
      direction: "lower",
    }),
  ];
}

function measureColdRequires(quick) {
  const runs = quick ? 2 : 5;
  const targets = [
    { key: "configService", rel: "src/main/settings/configService.js" },
    {
      key: "mailboxManager",
      rel: "src/main/terminal/terminalIOMailboxManager.js",
    },
    { key: "sshPool", rel: "src/main/connection/ssh-pool.js" },
    {
      key: "transferScheduler",
      rel: "src/main/file-transfer/transferScheduler.js",
    },
    { key: "bootstrap", rel: "src/main/bootstrap/index.js" },
  ];

  const probeScript = `
    const path = require("node:path");
    const { performance } = require("node:perf_hooks");
    const targets = JSON.parse(process.argv[1]);
    const root = process.argv[2];

    const electronId = require.resolve("electron");
    const stubFn = () => {};
    const eventStub = { on: stubFn, once: stubFn, removeListener: stubFn };
    require.cache[electronId] = {
      id: electronId,
      filename: electronId,
      loaded: true,
      exports: {
        app: {
          ...eventStub,
          isPackaged: false,
          getName: () => "SimpleShell",
          getVersion: () => "0.0.0-bench",
          getPath: () => process.cwd(),
          getAppPath: () => root,
          whenReady: () => new Promise(() => {}),
        },
        ipcMain: { handle: stubFn, on: stubFn, removeHandler: stubFn },
        BrowserWindow: Object.assign(function BrowserWindow() {}, {
          getAllWindows: () => [],
        }),
        dialog: { showMessageBox: async () => ({ response: 0 }) },
        shell: { openExternal: async () => {}, showItemInFolder: stubFn },
        net: { request: () => { throw new Error("unexpected net.request"); } },
        session: { defaultSession: { setProxy: async () => {}, resolveProxy: async () => "DIRECT" } },
        nativeTheme: { ...eventStub, shouldUseDarkColors: true },
        Menu: { buildFromTemplate: () => ({}), setApplicationMenu: stubFn },
        Tray: function Tray() {},
        screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
        safeStorage: { isEncryptionAvailable: () => false },
      },
    };

    for (const mod of [
      path.join(root, "src/main/utils/logger.js"),
      path.join(root, "src/main/diagnostics/crashReporter.js"),
    ]) {
      const id = require.resolve(mod);
      require.cache[id] = {
        id,
        filename: id,
        loaded: true,
        exports: {
          logToFile: stubFn,
          initLogger: stubFn,
          logError: stubFn,
          updateLogConfig: () => true,
          getLogDirectoryPath: () => null,
          getLogFilePath: () => null,
          initializeCrashReporter: stubFn,
          recordCrashMarker: stubFn,
        },
      };
    }

    const rssBefore = process.memoryUsage().rss;
    const timings = {};
    const totalStart = performance.now();
    for (const target of targets) {
      const t0 = performance.now();
      require(path.join(root, target.rel));
      timings[target.key] = performance.now() - t0;
    }
    const totalMs = performance.now() - totalStart;
    const rssDeltaMB = (process.memoryUsage().rss - rssBefore) / (1024 * 1024);
    process.stdout.write(JSON.stringify({ timings, totalMs, rssDeltaMB }));
  `;

  const perTargetSamples = Object.fromEntries(targets.map((t) => [t.key, []]));
  const totalSamples = [];
  const rssSamples = [];

  for (let i = 0; i < runs; i += 1) {
    const res = spawnSync(
      process.execPath,
      ["-e", probeScript, JSON.stringify(targets), ROOT],
      {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    if (res.status !== 0) {
      throw new Error(
        `Cold require probe failed (exit=${res.status}): ${res.stderr || res.stdout}`,
      );
    }
    const parsed = JSON.parse(res.stdout.trim());
    for (const target of targets) {
      perTargetSamples[target.key].push(parsed.timings[target.key]);
    }
    totalSamples.push(parsed.totalMs);
    rssSamples.push(parsed.rssDeltaMB);
  }

  const metrics = [];
  for (const target of targets) {
    const stats = summarizeSamples(perTargetSamples[target.key]);
    metrics.push(
      createMetric({
        name: `startup.coldRequire.${target.key}Ms`,
        suite: SUITE,
        unit: "ms",
        value: stats.p50,
        direction: "lower",
        stats,
      }),
    );
  }

  const totalStats = summarizeSamples(totalSamples);
  const rssStats = summarizeSamples(rssSamples);
  metrics.push(
    createMetric({
      name: "startup.coldRequire.totalMs",
      suite: SUITE,
      unit: "ms",
      value: totalStats.p50,
      direction: "lower",
      stats: totalStats,
    }),
    createMetric({
      name: "startup.coldRequire.rssDeltaMB",
      suite: SUITE,
      unit: "MB",
      value: rssStats.p50,
      direction: "lower",
      stats: rssStats,
    }),
  );

  return metrics;
}

function buildSyntheticConnections(count) {
  const groupCount = 25;
  const perGroup = Math.ceil(count / groupCount);
  const groups = [];
  let created = 0;

  for (let g = 0; g < groupCount && created < count; g += 1) {
    const items = [];
    for (let i = 0; i < perGroup && created < count; i += 1) {
      const idx = created;
      created += 1;
      items.push({
        id: `conn-${idx}`,
        type: "connection",
        name: `prod-node-${String(idx).padStart(4, "0")}`,
        protocol: "ssh",
        host: `10.${Math.floor(idx / 256) % 256}.${idx % 250}.${(idx * 7) % 250 || 1}`,
        port: 22,
        username: `deploy-${idx % 10}`,
        authType: "password",
        password: `secret-pass-${idx}-!@#`,
        privateKeyPath: `/home/user/.ssh/id_ed25519_${idx % 5}`,
        proxy:
          idx % 4 === 0
            ? {
                type: "socks5",
                host: "127.0.0.1",
                port: 1080,
                username: "proxyuser",
                password: `proxy-secret-${idx}`,
              }
            : undefined,
      });
    }
    groups.push({
      id: `group-${g}`,
      type: "group",
      name: `Cluster-${String(g).padStart(2, "0")}`,
      expanded: g < 5,
      items,
    });
  }
  return groups;
}

function benchmarkConfigAndCrypto(quick) {
  const prevNodeEnv = process.env.NODE_ENV;
  // appPaths treats NODE_ENV === "development" as dev cwd; force packaged path in temp dir.
  process.env.NODE_ENV = "production";
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "simpleshell-bench-cfg-"),
  );
  const connectionCount = 500;
  const iterations = quick ? 2 : 5;
  const cryptoIterations = quick ? 3 : 8;

  const configServicePath = path.join(
    ROOT,
    "src/main/settings/configService.js",
  );
  const cryptoPath = path.join(ROOT, "src/main/utils/crypto.js");
  delete require.cache[require.resolve(configServicePath)];
  delete require.cache[require.resolve(cryptoPath)];

  const restoreRuntime = stubMainRuntime();
  try {
    const cryptoMod = require(cryptoPath);
    const configService = require(configServicePath);

    const securityConfig = cryptoMod.createSecurityConfig({
      masterPasswordEnabled: true,
      masterPassword: "bench-master-password",
    });
    cryptoMod.configureSecurity(securityConfig);
    const unlock = cryptoMod.unlockWithMasterPassword("bench-master-password");
    if (!unlock.success) {
      throw new Error("Failed to unlock crypto store in benchmark");
    }

    const secrets = Array.from(
      { length: connectionCount },
      (_, idx) => `P@ssw0rd-${idx}-${"x".repeat(24)}`,
    );
    let encryptedSamples = [];

    const encryptBench = measureSync(
      () => {
        const out = new Array(connectionCount);
        for (let i = 0; i < connectionCount; i += 1) {
          out[i] = cryptoMod.encryptText(secrets[i]);
        }
        encryptedSamples = out;
      },
      {
        iterations: cryptoIterations,
        warmup: 1,
        opsPerIteration: connectionCount,
      },
    );

    const decryptBench = measureSync(
      () => {
        for (let i = 0; i < connectionCount; i += 1) {
          const plain = cryptoMod.decryptText(encryptedSamples[i]);
          if (plain !== secrets[i]) {
            throw new Error("Crypto roundtrip mismatch");
          }
        }
      },
      {
        iterations: cryptoIterations,
        warmup: 1,
        opsPerIteration: connectionCount,
      },
    );

    const mockApp = {
      isPackaged: true,
      getPath: () => tempDir,
      getName: () => "SimpleShell",
      getVersion: () => "0.0.0-bench",
    };
    const initialized = configService.init(
      mockApp,
      { logToFile: () => {} },
      cryptoMod,
    );
    if (!initialized) {
      throw new Error("ConfigService init failed");
    }
    configService.initializeMainConfig();

    const baseConnections = buildSyntheticConnections(connectionCount);
    const saveBench = measureSync(
      (iter) => {
        // Mutate one field so ConfigService does not short-circuit on _lastSerializedConfig.
        baseConnections[0].items[0].password = `secret-pass-iter-${iter}`;
        const ok = configService.saveConnections(baseConnections);
        if (!ok) throw new Error("saveConnections failed");
      },
      { iterations, warmup: 1, opsPerIteration: 1 },
    );

    const loadBench = measureSync(
      () => {
        // Clear in-memory cache so each sample exercises disk read + JSON parse + AES decrypt.
        configService._configCache = null;
        const loaded = configService.loadConnections();
        if (!Array.isArray(loaded) || loaded.length === 0) {
          throw new Error("loadConnections returned empty");
        }
      },
      { iterations, warmup: 1, opsPerIteration: 1 },
    );

    return [
      createMetric({
        name: "startup.crypto.encrypt500Ms",
        suite: SUITE,
        unit: "ms",
        value: encryptBench.stats.p50,
        direction: "lower",
        stats: encryptBench.stats,
      }),
      createMetric({
        name: "startup.crypto.encryptOpsPerSec",
        suite: SUITE,
        unit: "ops/s",
        value: encryptBench.opsPerSec,
        direction: "higher",
      }),
      createMetric({
        name: "startup.crypto.decrypt500Ms",
        suite: SUITE,
        unit: "ms",
        value: decryptBench.stats.p50,
        direction: "lower",
        stats: decryptBench.stats,
      }),
      createMetric({
        name: "startup.crypto.decryptOpsPerSec",
        suite: SUITE,
        unit: "ops/s",
        value: decryptBench.opsPerSec,
        direction: "higher",
      }),
      createMetric({
        name: "startup.config.save500ConnectionsMs",
        suite: SUITE,
        unit: "ms",
        value: saveBench.stats.p50,
        direction: "lower",
        stats: saveBench.stats,
      }),
      createMetric({
        name: "startup.config.load500ConnectionsMs",
        suite: SUITE,
        unit: "ms",
        value: loadBench.stats.p50,
        direction: "lower",
        stats: loadBench.stats,
      }),
    ];
  } finally {
    delete require.cache[require.resolve(configServicePath)];
    delete require.cache[require.resolve(cryptoPath)];
    restoreRuntime();
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function buildCommandHistoryDataset(count) {
  const prefixes = [
    "git checkout -b feature/perf-",
    "git commit -am 'fix: benchmark-",
    "docker logs --tail 200 worker-",
    "docker exec -it container-",
    "kubectl get pods -n prod-",
    "kubectl logs -f deploy/api-",
    "ssh deploy@10.0.1.",
    "systemctl restart simpleshell-",
    "journalctl -u nginx -n 100 --no-pager --since ",
    "npm run test -- --filter=",
  ];
  const baseTime = Date.now() - count * 1000;
  return Array.from({ length: count }, (_, idx) => ({
    command: `${prefixes[idx % prefixes.length]}${idx}`,
    timestamp: baseTime + idx * 1000,
    count: (idx % 25) + 1,
  }));
}

function benchmarkCommandHistory(quick) {
  const { compressCommandHistory, decompressCommandHistory } = require(
    path.join(ROOT, "src/main/settings/commandHistoryCodec.js"),
  );
  const historyServicePath = path.join(
    ROOT,
    "src/main/terminal/command-history.js",
  );
  delete require.cache[require.resolve(historyServicePath)];
  const commandHistoryService = require(historyServicePath);

  const entryCount = 10000;
  const dataset = buildCommandHistoryDataset(entryCount);
  const codecIterations = quick ? 3 : 8;
  const queryIterations = quick ? 50 : 200;
  const queries = [
    "git ",
    "docker logs",
    "kubectl get pods",
    "ssh",
    "systemctl restart",
    "npm run",
  ];

  let compressedBlob = null;
  const compressBench = measureSync(
    () => {
      compressedBlob = compressCommandHistory(dataset, () => {});
    },
    { iterations: codecIterations, warmup: 1, opsPerIteration: 1 },
  );

  const decompressBench = measureSync(
    () => {
      const out = decompressCommandHistory(compressedBlob, () => {});
      if (out.length !== entryCount) {
        throw new Error(
          `Expected ${entryCount} decompressed history items, got ${out.length}`,
        );
      }
    },
    { iterations: codecIterations, warmup: 1, opsPerIteration: 1 },
  );

  commandHistoryService.initialize(dataset);
  const suggestBench = measureSync(
    (iter) => {
      const query = queries[iter % queries.length];
      commandHistoryService.getSuggestions(query, 10);
    },
    { iterations: queryIterations, warmup: 10, opsPerIteration: 1 },
  );
  commandHistoryService.clearHistory();

  const ratioPct = compressedBlob?.originalSize
    ? round(
        (compressedBlob.compressedSize / compressedBlob.originalSize) * 100,
        2,
      )
    : 0;

  return [
    createMetric({
      name: "startup.history.compress10kMs",
      suite: SUITE,
      unit: "ms",
      value: compressBench.stats.p50,
      direction: "lower",
      stats: compressBench.stats,
      meta: {
        originalSize: compressedBlob?.originalSize,
        compressedSize: compressedBlob?.compressedSize,
        ratioPct,
      },
    }),
    createMetric({
      name: "startup.history.compressed10kBytes",
      suite: SUITE,
      unit: "bytes",
      value: compressedBlob?.compressedSize || 0,
      direction: "lower",
      meta: { ratioPct },
    }),
    createMetric({
      name: "startup.history.decompress10kMs",
      suite: SUITE,
      unit: "ms",
      value: decompressBench.stats.p50,
      direction: "lower",
      stats: decompressBench.stats,
    }),
    createMetric({
      name: "startup.history.suggest10kOpsPerSec",
      suite: SUITE,
      unit: "ops/s",
      value: computeOpsPerSec(queryIterations, suggestBench.totalMs),
      direction: "higher",
    }),
    createMetric({
      name: "startup.history.suggest10kP95Ms",
      suite: SUITE,
      unit: "ms",
      value: suggestBench.stats.p95,
      direction: "lower",
      stats: suggestBench.stats,
    }),
  ];
}

async function run({ quick = false } = {}) {
  const metrics = [];
  metrics.push(...(await auditBundles(quick)));
  metrics.push(...measureColdRequires(quick));
  metrics.push(...benchmarkConfigAndCrypto(quick));
  metrics.push(...benchmarkCommandHistory(quick));
  return {
    name: SUITE,
    metrics,
    context: {
      quick,
      connectionCount: 500,
      commandHistoryCount: 10000,
    },
  };
}

module.exports = {
  name: SUITE,
  description:
    "Webpack bundle audit, cold-require latency, config+crypto (500 connections), and command history codec/ranking (10k entries)",
  run,
};
