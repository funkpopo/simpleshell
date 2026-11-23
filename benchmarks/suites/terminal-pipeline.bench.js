const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { StringDecoder } = require("node:string_decoder");
const {
  ROOT,
  requireNativeHost,
  stubMainRuntime,
  startEventLoopMonitor,
  getNativeProcessesRssMB,
  waitFor,
  createRendererLoader,
} = require("../lib/env");
const { startLoopbackSshServer } = require("../lib/loopbackSshServer");
const {
  round,
  summarizeSamples,
  computeThroughputMBps,
  snapshotMemory,
} = require("../lib/stats");
const { createMetric } = require("../lib/reporter");

const SUITE = "terminal-pipeline";
const PLAIN_ANSI_REGEX = /\x1b\[[0-9;]*m/g;

function createPool(SSHPool) {
  const pool = new SSHPool();
  pool.proxyManager = { resolveProxyConfigAsync: async () => null };
  return pool;
}

function openPipeShell(client, pipeOptions) {
  const window = { term: "xterm-256color", cols: 120, rows: 30 };
  return new Promise((resolve, reject) => {
    client.shell(window, { pipe: pipeOptions }, (error, stream) =>
      error ? reject(error) : resolve(stream),
    );
  });
}

function attachPipeline(
  stream,
  processId,
  {
    TerminalIOMailboxManager,
    createTerminalOutput,
    ZmodemTransferService,
    RendererTerminalIOMailbox,
    IPC_EVENT_CHANNELS,
    getTerminalIOMailboxOutputChannel,
    writeDelayMs = 0,
  },
) {
  const channel = getTerminalIOMailboxOutputChannel(processId);
  let onOutput = null;
  let closing = false;
  let tail = "";
  let emittedBytes = 0;
  let ackBytes = 0;
  let ackCount = 0;
  let pauseCount = 0;
  let peakInFlightBytes = 0;

  const mainWindow = {
    isDestroyed: () => closing,
    webContents: {
      send: (name, payload) => {
        if (name !== channel) return;
        for (const message of Array.isArray(payload) ? payload : [payload]) {
          emittedBytes += Buffer.byteLength(message.data, "utf8");
          peakInFlightBytes = Math.max(
            peakInFlightBytes,
            emittedBytes - ackBytes,
          );
          tail = (tail + message.data).slice(-4096);
          queueMicrotask(() => onOutput?.(message));
        }
      },
    },
  };

  const manager = new TerminalIOMailboxManager({
    getMainWindow: () => mainWindow,
  });

  const previousWindow = globalThis.window;
  globalThis.window = {
    terminalAPI: {
      onTerminalMailboxMessage: (_id, callback) => {
        onOutput = callback;
        return () => {
          onOutput = null;
        };
      },
      postTerminalMailboxMessage: (id, message) => {
        if (message.type === "ack") {
          ackBytes += message.bytes;
          ackCount += 1;
        } else if (message.type === "pause") {
          pauseCount += 1;
        }
        return manager.handleRendererMessage(id, message);
      },
    },
  };

  const renderer = new RendererTerminalIOMailbox({
    term: {
      write: (_data, callback) => {
        if (writeDelayMs > 0) setTimeout(callback, writeDelayMs);
        else setImmediate(callback);
      },
    },
  });
  renderer.attachProcess(processId);

  const zmodem = new ZmodemTransferService({ emitIpc() {} });
  const deps = {
    terminalIOMailboxManager: manager,
    childProcesses: new Map([
      [processId, { stream, ready: true, type: "ssh" }],
    ]),
    _getMainWindow: () => mainWindow,
    connectionManager: { releaseSSHConnection() {} },
    _unbindConnectionProcess() {},
    _unbindConnectionProcessByProcess() {},
  };

  const output = createTerminalOutput(deps, {
    getTerminalProcessOutputChannel: () => channel,
    IPC_EVENT_CHANNELS,
    getTerminalText: (_config, key) => key,
    StringDecoder,
    logToFile() {},
    zmodemTransferService: zmodem,
    filemanagementService: { cleanupTransfersForTab() {} },
  });

  output._setupStreamEventListeners(
    stream,
    processId,
    { tabId: `bench-${processId}` },
    { key: `bench-${processId}`, ready: true, closeReason: "user" },
  );

  const mailbox = manager._getMailbox(processId);
  if (mailbox?.remoteFlow) {
    const origPause = mailbox.remoteFlow.pause;
    mailbox.remoteFlow.pause = (reason) => {
      pauseCount += 1;
      return origPause(reason);
    };
  }

  return {
    get plainTail() {
      return tail.replace(PLAIN_ANSI_REGEX, "");
    },
    get emittedBytes() {
      return emittedBytes;
    },
    get ackBytes() {
      return ackBytes;
    },
    get ackCount() {
      return ackCount;
    },
    get pauseCount() {
      return pauseCount;
    },
    get peakInFlightBytes() {
      return peakInFlightBytes;
    },
    get drained() {
      return (
        !renderer.activeWrite &&
        renderer.pendingWriteBytes === 0 &&
        renderer.writeQueue.queuedBytes === 0 &&
        ackBytes >= emittedBytes
      );
    },
    resetCounters() {
      emittedBytes = 0;
      ackBytes = 0;
      ackCount = 0;
      pauseCount = 0;
      peakInFlightBytes = 0;
    },
    dispose() {
      closing = true;
      renderer.destroy();
      manager.destroyProcess(processId);
      zmodem.destroyAll();
      if (previousWindow === undefined) delete globalThis.window;
      else globalThis.window = previousWindow;
    },
  };
}

async function runFloodWorkload({
  server,
  deps,
  processId,
  workload,
  bytes,
  pipeOptions,
  writeDelayMs = 0,
}) {
  const pool = createPool(deps.SSHPool);
  const connection = await pool.getConnection({
    ...server.config,
    tabId: `bench-${workload}-${processId}`,
  });
  const stream = await openPipeShell(connection.client, pipeOptions);
  const pipeline = attachPipeline(stream, processId, {
    ...deps,
    writeDelayMs,
  });

  try {
    await waitFor(() => pipeline.plainTail.includes("bench$"), {
      timeoutMs: 15000,
      label: `initial prompt (${workload})`,
    });
    pipeline.resetCounters();

    const stopMonitor = startEventLoopMonitor(5);
    const started = performance.now();
    stream.write(`flood ${bytes} ${workload}\n`);
    await waitFor(
      () => /BENCH-DONE \d+/.test(pipeline.plainTail) && pipeline.drained,
      { timeoutMs: 180000, label: `flood completion (${workload})` },
    );
    const elapsedMs = performance.now() - started;
    const loop = stopMonitor();

    const throughputMBps = computeThroughputMBps(bytes, elapsedMs);
    const nativeMem = getNativeProcessesRssMB();

    return {
      elapsedMs,
      throughputMBps,
      loop,
      emittedBytes: pipeline.emittedBytes,
      ackBytes: pipeline.ackBytes,
      ackCount: pipeline.ackCount,
      pauseCount: pipeline.pauseCount,
      peakInFlightBytes: pipeline.peakInFlightBytes,
      nativeRssMB: nativeMem.rssMB,
    };
  } finally {
    pipeline.dispose();
    stream.destroy?.();
    pool.cleanup();
  }
}

async function measureTimeToPrompt(server, deps, samplesCount) {
  const samples = [];
  for (let i = 0; i < samplesCount; i += 1) {
    const pool = createPool(deps.SSHPool);
    const started = performance.now();
    const connection = await pool.getConnection({
      ...server.config,
      tabId: `bench-prompt-${i}`,
    });
    const stream = await openPipeShell(connection.client, {
      rules: deps.highlightRules,
    });
    let text = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for prompt")),
        15000,
      );
      stream.on("data", (chunk) => {
        text += chunk.toString("utf8");
        if (text.includes("bench$")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    samples.push(performance.now() - started);
    stream.destroy?.();
    pool.cleanup();
  }
  return summarizeSamples(samples);
}

async function run({ quick = false } = {}) {
  requireNativeHost();
  const restoreRuntime = stubMainRuntime();

  const loadRenderer = createRendererLoader();
  const { RendererTerminalIOMailbox } = loadRenderer(
    path.join(
      ROOT,
      "src/renderer/features/terminal/io/RendererTerminalIOMailbox.js",
    ),
  );
  const SSHPool = require(path.join(ROOT, "src/main/connection/ssh-pool.js"));
  const TerminalIOMailboxManager = require(
    path.join(ROOT, "src/main/terminal/terminalIOMailboxManager.js"),
  );
  const createTerminalOutput = require(
    path.join(ROOT, "src/main/ipc/handlers/domains/terminalOutput.js"),
  );
  const { ZmodemTransferService } = require(
    path.join(ROOT, "src/main/terminal/zmodemTransferService.js"),
  );
  const highlightRules = require(
    path.join(ROOT, "src/shared/domain/highlight-configs.js"),
  );
  const { IPC_EVENT_CHANNELS } = require(
    path.join(ROOT, "src/shared/contracts/ipc/channels.js"),
  );
  const { getTerminalIOMailboxOutputChannel } = require(
    path.join(ROOT, "src/shared/contracts/terminalIOMailboxProtocol.js"),
  );
  const { shutdownCoreSupervisors } = require(
    path.join(ROOT, "src/main/native/coreSupervisor.js"),
  );

  const deps = {
    SSHPool,
    TerminalIOMailboxManager,
    createTerminalOutput,
    ZmodemTransferService,
    RendererTerminalIOMailbox,
    highlightRules,
    IPC_EVENT_CHANNELS,
    getTerminalIOMailboxOutputChannel,
  };

  const standardBytes = quick ? 2 * 1024 * 1024 : 16 * 1024 * 1024;
  const burstBytes = quick ? 512 * 1024 : 2 * 1024 * 1024;
  const backpressureBytes = quick ? 512 * 1024 : 2 * 1024 * 1024;

  const server = await startLoopbackSshServer();
  const metrics = [];
  let processSeq = 9100;

  try {
    const promptStats = await measureTimeToPrompt(server, deps, quick ? 3 : 5);
    metrics.push(
      createMetric({
        name: "terminal.timeToPromptMs",
        suite: SUITE,
        unit: "ms",
        value: promptStats.p50,
        direction: "lower",
        stats: promptStats,
      }),
    );

    const workloads = [
      { key: "logs", bytes: standardBytes },
      { key: "ansi", bytes: standardBytes },
      { key: "json", bytes: standardBytes },
      { key: "cjk_emoji", bytes: standardBytes },
      { key: "burst", bytes: burstBytes },
    ];

    let logsWithHighlight = null;
    for (const item of workloads) {
      const result = await runFloodWorkload({
        server,
        deps,
        processId: ++processSeq,
        workload: item.key,
        bytes: item.bytes,
        pipeOptions: { rules: highlightRules },
      });
      if (item.key === "logs") {
        logsWithHighlight = result;
      }
      metrics.push(
        createMetric({
          name: `terminal.workload.${item.key}.throughputMBps`,
          suite: SUITE,
          unit: "MB/s",
          value: result.throughputMBps,
          direction: "higher",
          meta: {
            bytes: item.bytes,
            elapsedMs: round(result.elapsedMs, 2),
          },
        }),
        createMetric({
          name: `terminal.workload.${item.key}.eventLoopP99Ms`,
          suite: SUITE,
          unit: "ms",
          value: result.loop.p99Ms,
          direction: "lower",
          stats: {
            count: 1,
            min: result.loop.p50Ms,
            p50: result.loop.p50Ms,
            p95: result.loop.p95Ms,
            p99: result.loop.p99Ms,
            max: result.loop.maxMs,
            mean: result.loop.meanMs,
            stdDev: 0,
          },
        }),
      );
    }

    // Highlight overhead: compare logs workload with highlight rules vs empty rules.
    const logsNoHighlight = await runFloodWorkload({
      server,
      deps,
      processId: ++processSeq,
      workload: "logs",
      bytes: standardBytes,
      pipeOptions: {},
    });

    const overheadPct =
      logsNoHighlight.throughputMBps > 0
        ? round(
            ((logsNoHighlight.throughputMBps -
              logsWithHighlight.throughputMBps) /
              logsNoHighlight.throughputMBps) *
              100,
            2,
          )
        : 0;

    metrics.push(
      createMetric({
        name: "terminal.highlight.enabledThroughputMBps",
        suite: SUITE,
        unit: "MB/s",
        value: logsWithHighlight.throughputMBps,
        direction: "higher",
      }),
      createMetric({
        name: "terminal.highlight.disabledThroughputMBps",
        suite: SUITE,
        unit: "MB/s",
        value: logsNoHighlight.throughputMBps,
        direction: "higher",
      }),
      createMetric({
        name: "terminal.highlight.overheadPct",
        suite: SUITE,
        unit: "%",
        value: overheadPct,
        direction: "lower",
      }),
    );

    // Backpressure pacing under a slower renderer write consumer.
    const backpressure = await runFloodWorkload({
      server,
      deps,
      processId: ++processSeq,
      workload: "logs",
      bytes: backpressureBytes,
      pipeOptions: {},
      writeDelayMs: 1,
    });

    const mainMem = snapshotMemory();
    metrics.push(
      createMetric({
        name: "terminal.backpressure.throughputMBps",
        suite: SUITE,
        unit: "MB/s",
        value: backpressure.throughputMBps,
        direction: "higher",
      }),
      createMetric({
        name: "terminal.backpressure.peakInFlightBytes",
        suite: SUITE,
        unit: "bytes",
        value: backpressure.peakInFlightBytes,
        direction: "lower",
        meta: {
          ackCount: backpressure.ackCount,
          pauseCount: backpressure.pauseCount,
        },
      }),
      createMetric({
        name: "terminal.backpressure.ackCount",
        suite: SUITE,
        unit: "acks",
        value: backpressure.ackCount,
        direction: "info",
      }),
      createMetric({
        name: "terminal.memory.nativeRssMB",
        suite: SUITE,
        unit: "MB",
        value: backpressure.nativeRssMB,
        direction: "lower",
      }),
      createMetric({
        name: "terminal.memory.mainRssMB",
        suite: SUITE,
        unit: "MB",
        value: mainMem.rssMB,
        direction: "lower",
      }),
    );

    return {
      name: SUITE,
      metrics,
      context: {
        quick,
        standardBytes,
        burstBytes,
        backpressureBytes,
      },
    };
  } finally {
    await shutdownCoreSupervisors();
    await server.close();
    restoreRuntime();
  }
}

module.exports = {
  name: SUITE,
  description:
    "Loopback SSH + simpleshell-core pipe throughput, event-loop delay across 5 workloads, highlight overhead, and mailbox ACK/backpressure pacing",
  run,
};
