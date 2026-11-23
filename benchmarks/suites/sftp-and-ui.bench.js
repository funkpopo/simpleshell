const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { JSDOM } = require("jsdom");
const React = require("react");
const { act } = require("react");
const { createRoot } = require("react-dom/client");
const { ThemeProvider, createTheme } = require("@mui/material/styles");
const {
  ROOT,
  requireNativeHost,
  stubMainRuntime,
  createRendererLoader,
} = require("../lib/env");
const { createLoopbackSftpServer } = require("../lib/loopbackSftpServer");
const {
  round,
  summarizeSamples,
  computeOpsPerSec,
  computeThroughputMBps,
  measureSync,
} = require("../lib/stats");
const { createMetric } = require("../lib/reporter");

const SUITE = "sftp-and-ui";

async function benchmarkSftp(quick) {
  requireNativeHost();

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "simpleshell-bench-sftp-"),
  );
  const remoteRoot = path.join(tempRoot, "remote");
  const localDir = path.join(tempRoot, "local");
  const downloadDir = path.join(tempRoot, "download");
  fs.mkdirSync(remoteRoot, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });
  fs.mkdirSync(downloadDir, { recursive: true });

  const sftp = await createLoopbackSftpServer(remoteRoot);
  const TransferScheduler = require(
    path.join(ROOT, "src/main/file-transfer/transferScheduler.js"),
  );
  const nativeSftp = require(
    path.join(ROOT, "src/main/native/nativeSftpClient.js"),
  );
  const fileCache = require(path.join(ROOT, "src/main/storage/fileCache.js"));
  const { shutdownCoreSupervisors } = require(
    path.join(ROOT, "src/main/native/coreSupervisor.js"),
  );

  const smallCount = quick ? 100 : 1000;
  const smallSize = 1024;
  const smallPayload = Buffer.alloc(smallSize, 0x61);
  for (let i = 0; i < smallCount; i += 1) {
    fs.writeFileSync(path.join(localDir, `f${i}.txt`), smallPayload);
  }

  const largeFileBytes = quick ? 4 * 1024 * 1024 : 32 * 1024 * 1024;
  const largeLocalUpload = path.join(tempRoot, "large-upload.bin");
  const largeLocalDownload = path.join(tempRoot, "large-download.bin");
  const largeBuf = crypto.randomBytes(largeFileBytes);
  fs.writeFileSync(largeLocalUpload, largeBuf);

  const scheduler = new TransferScheduler({ maxWorkers: 8 });
  const metrics = [];

  try {
    const runBatch = async (direction) => {
      const handshakesBefore = sftp.stats.connections;
      const started = performance.now();
      const result = await scheduler.runTasks({
        transferKey: `bench-${direction}`,
        tabId: "bench-sftp-tab",
        sshConfig: sftp.config,
        maxConcurrency: 8,
        tasks: Array.from({ length: smallCount }, (_, idx) => ({
          taskId: `${direction}-${idx}`,
          direction,
          localPath: path.join(
            direction === "upload" ? localDir : downloadDir,
            `f${idx}.txt`,
          ),
          remotePath: `/batch/f${idx}.txt`,
        })),
      });
      const elapsedMs = performance.now() - started;
      if (result.completed !== smallCount) {
        throw new Error(
          `SFTP ${direction} completed ${result.completed}/${smallCount}`,
        );
      }
      return {
        elapsedMs,
        filesPerSec: computeOpsPerSec(smallCount, elapsedMs),
        handshakes: sftp.stats.connections - handshakesBefore,
      };
    };

    const uploadBatch = await runBatch("upload");
    const downloadBatch = await runBatch("download");
    if (
      !fs.readFileSync(path.join(downloadDir, "f0.txt")).equals(smallPayload)
    ) {
      throw new Error("SFTP small-file download content mismatch");
    }

    const largeUpStart = performance.now();
    const upRes = await nativeSftp.invokeNativeRequestWithConfig(
      sftp.config,
      {
        operation: "uploadFileToRemote",
        path: "/large.bin",
        localPath: largeLocalUpload,
        ensureParentDirectories: true,
      },
      { sessionKey: "bench-large-stream" },
    );
    const largeUpMs = performance.now() - largeUpStart;
    if (!upRes?.success) {
      throw new Error(`Large upload failed: ${upRes?.error}`);
    }

    const largeDownStart = performance.now();
    const downRes = await nativeSftp.invokeNativeRequestWithConfig(
      sftp.config,
      {
        operation: "downloadFileToLocal",
        path: "/large.bin",
        localPath: largeLocalDownload,
      },
      { sessionKey: "bench-large-stream" },
    );
    const largeDownMs = performance.now() - largeDownStart;
    if (!downRes?.success) {
      throw new Error(`Large download failed: ${downRes?.error}`);
    }
    if (!fs.readFileSync(largeLocalDownload).equals(largeBuf)) {
      throw new Error("Large SFTP download integrity mismatch");
    }

    // FileCache write throughput in an isolated temp app directory
    const cacheTempAppDir = path.join(tempRoot, "app-cache");
    fs.mkdirSync(cacheTempAppDir, { recursive: true });
    const prevNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      fileCache.init(() => {}, {
        isPackaged: true,
        getPath: () => cacheTempAppDir,
      });
      const cacheCount = quick ? 16 : 40;
      const cacheChunk = Buffer.alloc(256 * 1024, 0x42);
      const cacheStart = performance.now();
      for (let i = 0; i < cacheCount; i += 1) {
        await fileCache.cacheFile(`cached-${i}.bin`, cacheChunk, "bench-tab");
      }
      const cacheMs = performance.now() - cacheStart;
      metrics.push(
        createMetric({
          name: "sftp.fileCache.writeMBps",
          suite: SUITE,
          unit: "MB/s",
          value: computeThroughputMBps(cacheCount * cacheChunk.length, cacheMs),
          direction: "higher",
        }),
        createMetric({
          name: "sftp.fileCache.opsPerSec",
          suite: SUITE,
          unit: "ops/s",
          value: computeOpsPerSec(cacheCount, cacheMs),
          direction: "higher",
        }),
      );
    } finally {
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prevNodeEnv;
    }

    metrics.push(
      createMetric({
        name: "sftp.batchUpload.ms",
        suite: SUITE,
        unit: "ms",
        value: uploadBatch.elapsedMs,
        direction: "lower",
        meta: {
          files: smallCount,
          filesPerSec: uploadBatch.filesPerSec,
          handshakes: uploadBatch.handshakes,
        },
      }),
      createMetric({
        name: "sftp.batchUpload.handshakes",
        suite: SUITE,
        unit: "handshakes",
        value: uploadBatch.handshakes,
        direction: "lower",
      }),
      createMetric({
        name: "sftp.batchDownload.ms",
        suite: SUITE,
        unit: "ms",
        value: downloadBatch.elapsedMs,
        direction: "lower",
        meta: {
          files: smallCount,
          filesPerSec: downloadBatch.filesPerSec,
          handshakes: downloadBatch.handshakes,
        },
      }),
      createMetric({
        name: "sftp.batchDownload.handshakes",
        suite: SUITE,
        unit: "handshakes",
        value: downloadBatch.handshakes,
        direction: "lower",
      }),
      createMetric({
        name: "sftp.largeUpload.throughputMBps",
        suite: SUITE,
        unit: "MB/s",
        value: computeThroughputMBps(largeFileBytes, largeUpMs),
        direction: "higher",
        meta: { bytes: largeFileBytes, elapsedMs: round(largeUpMs, 2) },
      }),
      createMetric({
        name: "sftp.largeDownload.throughputMBps",
        suite: SUITE,
        unit: "MB/s",
        value: computeThroughputMBps(largeFileBytes, largeDownMs),
        direction: "higher",
        meta: { bytes: largeFileBytes, elapsedMs: round(largeDownMs, 2) },
      }),
    );

    return metrics;
  } finally {
    nativeSftp.closeNativeSession("bench-large-stream");
    nativeSftp.closeNativeSession("bench-sftp-tab");
    await scheduler.shutdown();
    await shutdownCoreSupervisors();
    await sftp.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function buildDirectoryEntries(count) {
  const now = Date.now();
  return Array.from({ length: count }, (_, idx) => {
    const isDirectory = idx % 10 === 0;
    const prefix = isDirectory
      ? "dir"
      : idx % 3 === 0
        ? "alpha"
        : idx % 3 === 1
          ? "archive"
          : "service-log";
    return {
      name: `${prefix}-${idx}${isDirectory ? "" : ".log"}`,
      isDirectory,
      size: isDirectory ? 0 : ((idx * 4096) % (10 * 1024 * 1024)) + 128,
      mtimeMs: now - ((idx * 1733) % 1_000_000_000),
      modifyTime: new Date(now - ((idx * 1733) % 1_000_000_000)).toISOString(),
    };
  });
}

function buildConnectionTree1k(count = 1000) {
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
        name: idx % 7 === 0 ? `prod-db-${idx}` : `app-host-${idx}`,
        host:
          idx % 5 === 0
            ? `node-${idx}.internal`
            : `10.${Math.floor(idx / 250) % 250}.${idx % 250}.${(idx * 3) % 250 || 1}`,
        port: 22,
        username: "ops",
        protocol: "ssh",
      });
    }
    groups.push({
      id: `grp-${g}`,
      type: "group",
      name: `Cluster-${String(25 - g).padStart(2, "0")}`,
      expanded: g < 10,
      items,
    });
  }
  return groups;
}

async function benchmarkUiHotPaths(quick) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  const savedGlobals = new Map();
  const assignGlobal = (key, value) => {
    savedGlobals.set(key, [key in globalThis, globalThis[key]]);
    globalThis[key] = value;
  };

  assignGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  assignGlobal("window", dom.window);
  assignGlobal("document", dom.window.document);
  assignGlobal("Element", dom.window.Element);
  assignGlobal("HTMLElement", dom.window.HTMLElement);
  assignGlobal("Node", dom.window.Node);
  assignGlobal(
    "getComputedStyle",
    dom.window.getComputedStyle.bind(dom.window),
  );
  assignGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0));
  assignGlobal("cancelAnimationFrame", (id) => clearTimeout(id));
  assignGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  if (!("navigator" in globalThis)) {
    assignGlobal("navigator", dom.window.navigator);
  }

  const metrics = [];
  try {
    const loadRenderer = createRendererLoader(
      {},
      {
        "react-i18next": {
          useTranslation: () => ({ t: (k) => k, i18n: { language: "en-US" } }),
        },
        "react-window": {
          List: ({ rowCount, rowProps, rowComponent: Row }) =>
            React.createElement(
              "div",
              { "data-testid": "virtual-list" },
              Array.from({ length: Math.min(rowCount, 20) }, (_, index) =>
                React.createElement(Row, {
                  key: index,
                  index,
                  style: {},
                  ...rowProps,
                }),
              ),
            ),
        },
      },
    );

    const directoryListing = loadRenderer(
      path.join(
        ROOT,
        "src/renderer/features/file-manager/lib/directoryListing.js",
      ),
    );
    const useFileSelection = loadRenderer(
      path.join(
        ROOT,
        "src/renderer/features/file-manager/hooks/useFileSelection.js",
      ),
    ).default;
    const connectionTree = loadRenderer(
      path.join(
        ROOT,
        "src/renderer/features/connections/lib/connectionTree.js",
      ),
    );
    const ConnectionList = loadRenderer(
      path.join(
        ROOT,
        "src/renderer/features/connections/components/ConnectionList.jsx",
      ),
    ).default;

    // 1. Large directory (10,000 entries) sort/filter/search & cache
    const entries10k = buildDirectoryEntries(10000);
    const hookHost = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(hookHost);
    const hookRoot = createRoot(hookHost);
    let selectionApi = null;
    let selectionProps = {
      files: entries10k,
      isChunking: false,
      selectionResetKey: 0,
    };

    function SelectionProbe({ files, isChunking, selectionResetKey }) {
      selectionApi = useFileSelection({
        files,
        isChunking,
        selectionResetKey,
      });
      return null;
    }

    const mountStart = performance.now();
    await act(async () => {
      hookRoot.render(React.createElement(SelectionProbe, selectionProps));
    });
    const sortNameInitialMs = performance.now() - mountStart;

    const dirIterations = quick ? 3 : 8;
    const sortNameSamples = [sortNameInitialMs];
    for (let i = 0; i < dirIterations; i += 1) {
      const shuffled = [...entries10k];
      if (i % 2 === 0) shuffled.reverse();
      const t0 = performance.now();
      await act(async () => {
        hookRoot.render(
          React.createElement(SelectionProbe, {
            ...selectionProps,
            files: shuffled,
          }),
        );
      });
      sortNameSamples.push(performance.now() - t0);
    }

    const sortTimeSamples = [];
    for (let i = 0; i < dirIterations; i += 1) {
      const targetMode = i % 2 === 0 ? "time" : "name";
      const t0 = performance.now();
      await act(async () => {
        selectionApi.setSortMode(targetMode);
      });
      if (targetMode === "time") {
        sortTimeSamples.push(performance.now() - t0);
      }
    }

    const searchSamples = [];
    for (let i = 0; i < dirIterations; i += 1) {
      const term = i % 2 === 0 ? "alpha-9" : "";
      const t0 = performance.now();
      await act(async () => {
        selectionApi.setSearchTerm(term);
      });
      if (term) {
        searchSamples.push(performance.now() - t0);
      }
    }

    await act(async () => hookRoot.unmount());
    hookHost.remove();

    const sigBench = measureSync(
      () => directoryListing.computeFileListSignature(entries10k),
      { iterations: quick ? 5 : 15, warmup: 2 },
    );

    const dirCache = new Map();
    const cacheOps = 500;
    const cacheBench = measureSync(
      () => {
        for (let i = 0; i < cacheOps; i += 1) {
          directoryListing.storeCachedDirectory(
            dirCache,
            `/dir/${i}`,
            entries10k.slice(0, 20),
          );
        }
        for (let i = 0; i < cacheOps; i += 1) {
          directoryListing.getCachedDirectory(dirCache, `/dir/${i}`);
        }
      },
      { iterations: quick ? 5 : 15, warmup: 2, opsPerIteration: cacheOps * 2 },
    );

    const sortNameStats = summarizeSamples(sortNameSamples);
    const sortTimeStats = summarizeSamples(sortTimeSamples);
    const dirSearchStats = summarizeSamples(searchSamples);

    metrics.push(
      createMetric({
        name: "ui.fileManager.sortName10kMs",
        suite: SUITE,
        unit: "ms",
        value: sortNameStats.p50,
        direction: "lower",
        stats: sortNameStats,
      }),
      createMetric({
        name: "ui.fileManager.sortTime10kMs",
        suite: SUITE,
        unit: "ms",
        value: sortTimeStats.p50,
        direction: "lower",
        stats: sortTimeStats,
      }),
      createMetric({
        name: "ui.fileManager.search10kMs",
        suite: SUITE,
        unit: "ms",
        value: dirSearchStats.p50,
        direction: "lower",
        stats: dirSearchStats,
      }),
      createMetric({
        name: "ui.fileManager.signature10kMs",
        suite: SUITE,
        unit: "ms",
        value: sigBench.stats.p50,
        direction: "lower",
        stats: sigBench.stats,
      }),
      createMetric({
        name: "ui.fileManager.dirCacheOpsPerSec",
        suite: SUITE,
        unit: "ops/s",
        value: cacheBench.opsPerSec,
        direction: "higher",
      }),
    );

    // 2. Connection tree flatten/filter/search (1,000 entries)
    const connections1k = buildConnectionTree1k(1000);
    const stabilizer = connectionTree.createConnectionStabilizer();
    const connIterations = quick ? 10 : 30;

    const dedupeSortBench = measureSync(
      () => {
        const deduped = connectionTree.dedupeConnectionsById(connections1k);
        const sorted = connectionTree
          .sortConnectionsByIp(deduped)
          .map((item) =>
            item.type === "group" && item.items
              ? {
                  ...item,
                  items: connectionTree.sortConnectionsByIp(item.items),
                }
              : item,
          );
        stabilizer(sorted);
        connectionTree.countVisibleItems(sorted);
      },
      { iterations: connIterations, warmup: 3 },
    );

    const connHost = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(connHost);
    const connRoot = createRoot(connHost);
    const theme = createTheme();
    const noop = () => {};

    const renderConnectionList = async (searchQuery) => {
      await act(async () => {
        connRoot.render(
          React.createElement(
            ThemeProvider,
            { theme },
            React.createElement(ConnectionList, {
              searchQuery,
              connections: connections1k,
              setConnections: noop,
              isSavingRef: { current: false },
              handleToggleGroup: noop,
              openGroupContextMenuFromEvent: noop,
              openConnectionContextMenuFromEvent: noop,
              handleOpenConnection: noop,
              connectionListContextMenu: null,
              connectionManagerListRootRef: { current: null },
              handleBlankContextMenu: noop,
              isLoading: false,
              handleVirtualizedItemContextMenu: noop,
            }),
          ),
        );
      });
    };

    const connRenderSamples = [];
    const connSearchSamples = [];
    for (let i = 0; i < (quick ? 3 : 6); i += 1) {
      const t0 = performance.now();
      await renderConnectionList("");
      connRenderSamples.push(performance.now() - t0);

      const t1 = performance.now();
      await renderConnectionList("prod-db");
      connSearchSamples.push(performance.now() - t1);
    }

    await act(async () => connRoot.unmount());
    connHost.remove();

    const connRenderStats = summarizeSamples(connRenderSamples);
    const connSearchStats = summarizeSamples(connSearchSamples);

    metrics.push(
      createMetric({
        name: "ui.connectionTree.dedupeSortStabilize1kMs",
        suite: SUITE,
        unit: "ms",
        value: dedupeSortBench.stats.p50,
        direction: "lower",
        stats: dedupeSortBench.stats,
      }),
      createMetric({
        name: "ui.connectionTree.render1kMs",
        suite: SUITE,
        unit: "ms",
        value: connRenderStats.p50,
        direction: "lower",
        stats: connRenderStats,
      }),
      createMetric({
        name: "ui.connectionTree.search1kMs",
        suite: SUITE,
        unit: "ms",
        value: connSearchStats.p50,
        direction: "lower",
        stats: connSearchStats,
      }),
    );

    return metrics;
  } finally {
    dom.window.close();
    for (const [key, [hadKey, oldVal]] of savedGlobals.entries()) {
      if (hadKey) globalThis[key] = oldVal;
      else delete globalThis[key];
    }
  }
}

function benchmarkIpcValidateSchema(quick) {
  const { validateSchema } = require(
    path.join(ROOT, "src/main/ipc/schema/validator.js"),
  );
  const { getChannelDefinition } = require(
    path.join(ROOT, "src/shared/contracts/ipc/channels.js"),
  );

  const fileListDef = getChannelDefinition("FILE_LIST");
  const pfStartDef = getChannelDefinition("PF_START_RULE");
  const saveConnectionsDef = getChannelDefinition("TERMINAL_SAVE_CONNECTIONS");

  const smallArgs = ["tab-1", "/var/log/nginx", { streamList: true }];
  const mediumArgs = [{ ruleId: "rule-1", tabId: "tab-1" }];
  const largeConnections = Array.from({ length: 500 }, (_, idx) => ({
    id: `conn-${idx}`,
    type: "connection",
    name: `host-${idx}`,
    host: `10.0.${idx % 250}.${(idx * 3) % 250}`,
    port: 22,
    username: "deploy",
  }));
  const largeArgs = [largeConnections];

  // Warmup & compile schemas once before measuring validation ops/sec.
  validateSchema(fileListDef.requestSchema, smallArgs);
  validateSchema(pfStartDef.requestSchema, mediumArgs);
  validateSchema(saveConnectionsDef.requestSchema, largeArgs);

  const smallBatch = quick ? 2000 : 10000;
  const mediumBatch = quick ? 2000 : 10000;
  const largeBatch = quick ? 200 : 1000;

  const smallStart = performance.now();
  for (let i = 0; i < smallBatch; i += 1) {
    const res = validateSchema(fileListDef.requestSchema, smallArgs);
    if (!res.valid) throw new Error(res.error);
  }
  const smallMs = performance.now() - smallStart;

  const mediumStart = performance.now();
  for (let i = 0; i < mediumBatch; i += 1) {
    const res = validateSchema(pfStartDef.requestSchema, mediumArgs);
    if (!res.valid) throw new Error(res.error);
  }
  const mediumMs = performance.now() - mediumStart;

  const largeSamples = [];
  const largeStart = performance.now();
  for (let i = 0; i < largeBatch; i += 1) {
    const t0 = performance.now();
    const res = validateSchema(saveConnectionsDef.requestSchema, largeArgs);
    largeSamples.push(performance.now() - t0);
    if (!res.valid) throw new Error(res.error);
  }
  const largeMs = performance.now() - largeStart;

  return [
    createMetric({
      name: "ipc.validateSchema.smallOpsPerSec",
      suite: SUITE,
      unit: "ops/s",
      value: computeOpsPerSec(smallBatch, smallMs),
      direction: "higher",
    }),
    createMetric({
      name: "ipc.validateSchema.mediumOpsPerSec",
      suite: SUITE,
      unit: "ops/s",
      value: computeOpsPerSec(mediumBatch, mediumMs),
      direction: "higher",
    }),
    createMetric({
      name: "ipc.validateSchema.large500OpsPerSec",
      suite: SUITE,
      unit: "ops/s",
      value: computeOpsPerSec(largeBatch, largeMs),
      direction: "higher",
      stats: summarizeSamples(largeSamples),
    }),
  ];
}

async function run({ quick = false } = {}) {
  const restoreRuntime = stubMainRuntime();
  try {
    const metrics = [];
    metrics.push(...(await benchmarkSftp(quick)));
    metrics.push(...(await benchmarkUiHotPaths(quick)));
    metrics.push(...benchmarkIpcValidateSchema(quick));
    return {
      name: SUITE,
      metrics,
      context: {
        quick,
        smallFileCount: quick ? 100 : 1000,
        largeFileBytes: quick ? 4 * 1024 * 1024 : 32 * 1024 * 1024,
        directoryEntries: 10000,
        connectionTreeEntries: 1000,
      },
    };
  } finally {
    restoreRuntime();
  }
}

module.exports = {
  name: SUITE,
  description:
    "Loopback SFTP batch/streaming + FileCache, 10k directory sort/filter/search, 1k connection tree flatten/filter/search, and IPC validateSchema ops/s",
  run,
};
