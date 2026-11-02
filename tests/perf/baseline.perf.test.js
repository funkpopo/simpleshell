import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { StringDecoder } from "node:string_decoder";
import { RendererTerminalIOMailbox } from "../../src/renderer/features/terminal/io/RendererTerminalIOMailbox.js";

const require = createRequire(import.meta.url);
const helpers = require("./helpers");
helpers.stubMainRuntime();

const SSHPool = require("../../src/main/connection/ssh-pool");
const SshTransportHealth = require("../../src/main/connection/ssh-transport-health");
const TerminalIOMailboxManager = require("../../src/main/terminal/terminalIOMailboxManager");
const createTerminalOutput = require("../../src/main/ipc/handlers/domains/terminalOutput");
const outputProcessor = require("../../src/main/terminal/output-processor");
const {
  createOscSafeOutputTransform,
} = require("../../src/main/terminal/oscSafeOutput");
const {
  ZmodemTransferService,
} = require("../../src/main/terminal/zmodemTransferService");
const {
  NativeZmodemClient,
} = require("../../src/main/native/nativeZmodemClient");
const nativeSftp = require("../../src/main/native/nativeSftpClient");
const TransferScheduler = require("../../src/main/file-transfer/transferScheduler");
const {
  IPC_EVENT_CHANNELS,
} = require("../../src/shared/contracts/ipc/channels");
const {
  getTerminalIOMailboxOutputChannel,
} = require("../../src/shared/contracts/terminalIOMailboxProtocol");
const { createSftpLoopback } = require("../fixtures/sftp-loopback");

// SIMPLESHELL_PERF_DIAG=1 attributes synchronous time to the main hot paths.
const diag = {};
if (process.env.SIMPLESHELL_PERF_DIAG === "1") {
  const instrument = (target, name, label) => {
    const original = target[name];
    target[name] = function instrumented(...args) {
      const started = performance.now();
      try {
        return original.apply(this, args);
      } finally {
        const elapsed = performance.now() - started;
        const entry = (diag[label] ||= {
          calls: 0,
          totalMs: 0,
          maxMs: 0,
          over50: 0,
        });
        entry.calls += 1;
        entry.totalMs += elapsed;
        entry.maxMs = Math.max(entry.maxMs, elapsed);
        if (elapsed > 50) entry.over50 += 1;
      }
    };
  };
  instrument(
    require("../../src/main/native/coreSupervisor").CoreSupervisor.prototype,
    "_onFrames",
    "core.onFrames",
  );
  instrument(
    require("../../src/main/native/coreSupervisor").CoreSupervisor.prototype,
    "_drainInbox",
    "core.drainInbox",
  );
  instrument(outputProcessor, "processTerminalOutput", "output.highlight");
  instrument(
    ZmodemTransferService.prototype,
    "_handleNativeMessage",
    "zmodem.message",
  );
  instrument(
    ZmodemTransferService.prototype,
    "feedOutput",
    "zmodem.feedOutput",
  );
  instrument(
    TerminalIOMailboxManager.prototype,
    "handleRendererMessage",
    "mailbox.rendererMessage",
  );
  const { PerformanceObserver } = require("node:perf_hooks");
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const gc = (diag[`gc.kind${entry.detail?.kind ?? "?"}`] ||= {
        count: 0,
        totalMs: 0,
        maxMs: 0,
      });
      gc.count += 1;
      gc.totalMs += entry.duration;
      gc.maxMs = Math.max(gc.maxMs, entry.duration);
    }
  }).observe({ entryTypes: ["gc"] });
}

// SIMPLESHELL_PERF_PROFILE=1 writes a CPU profile of the flood to .cache/perf.
async function profileWhile(label, run) {
  if (process.env.SIMPLESHELL_PERF_PROFILE !== "1") return run();
  const inspector = require("node:inspector");
  const session = new inspector.Session();
  session.connect();
  const post = (method, params) =>
    new Promise((resolve, reject) =>
      session.post(method, params, (error, result) =>
        error ? reject(error) : resolve(result),
      ),
    );
  await post("Profiler.enable");
  await post("Profiler.start");
  try {
    return await run();
  } finally {
    const { profile } = await post("Profiler.stop");
    const directory = path.join(helpers.ROOT, ".cache", "perf");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, `${label}.cpuprofile`),
      JSON.stringify(profile),
    );
    session.disconnect();
  }
}

const FLOOD_BYTES =
  Number(process.env.SIMPLESHELL_PERF_FLOOD_BYTES) || 48 * 1024 * 1024;
const SMALL_FILE_COUNT =
  Number(process.env.SIMPLESHELL_PERF_FILE_COUNT) || 1000;
const TAB_COUNT = 4;
const PROMPT_SAMPLES = 5;

const metrics = {};
const record = (name, value, unit, extra = {}) => {
  metrics[name] = { value: helpers.round(value), unit, ...extra };
};

function createPool() {
  const pool = new SSHPool();
  pool.proxyManager = { resolveProxyConfigAsync: async () => null };
  return pool;
}

function openShell(client) {
  return new Promise((resolve, reject) =>
    client.shell(
      { term: "xterm-256color", cols: 120, rows: 30 },
      (error, stream) => (error ? reject(error) : resolve(stream)),
    ),
  );
}

// Runs the production main-process output path (decode, OSC filter, highlight,
// mailbox flow control) against a renderer mailbox that ACKs like xterm.
function attachTerminalPipeline(stream, processId) {
  const channel = getTerminalIOMailboxOutputChannel(processId);
  let onOutput;
  let closing = false;
  let tail = "";
  let emittedBytes = 0;
  let ackBytes = 0;
  const mainWindow = {
    isDestroyed: () => closing,
    webContents: {
      send: (name, payload) => {
        if (name !== channel) return;
        for (const message of Array.isArray(payload) ? payload : [payload]) {
          emittedBytes += Buffer.byteLength(message.data);
          tail = (tail + message.data).slice(-4096);
          queueMicrotask(() => onOutput?.(message));
        }
      },
    },
  };
  const manager = new TerminalIOMailboxManager({
    getMainWindow: () => mainWindow,
  });
  vi.stubGlobal("window", {
    terminalAPI: {
      onTerminalMailboxMessage: (_id, callback) => {
        onOutput = callback;
        return () => {
          onOutput = null;
        };
      },
      postTerminalMailboxMessage: (id, message) => {
        if (message.type === "ack") ackBytes += message.bytes;
        return manager.handleRendererMessage(id, message);
      },
    },
  });
  const renderer = new RendererTerminalIOMailbox({
    term: { write: (_data, callback) => setImmediate(callback) },
  });
  renderer.attachProcess(processId);
  const zmodem = new ZmodemTransferService({ emitIpc() {} });
  const native = new NativeZmodemClient();
  zmodem._client = native;
  native.setMessageHandler((type, id, message) =>
    zmodem._handleNativeMessage(type, id, message),
  );
  native.setExitHandler(() => zmodem._handleNativeProcessExit());
  const deps = {
    terminalIOMailboxManager: manager,
    childProcesses: new Map([
      [processId, { stream, ready: true, type: "ssh2" }],
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
    createOscSafeOutputTransform,
    outputProcessor,
    logToFile() {},
    zmodemTransferService: zmodem,
    filemanagementService: { cleanupTransfersForTab() {} },
  });
  output._setupStreamEventListeners(
    stream,
    processId,
    { tabId: `perf-${processId}` },
    {
      key: `perf-${processId}`,
      ready: true,
      closeReason: "user",
    },
  );
  return {
    get plainTail() {
      return tail.replace(/\x1b\[[0-9;]*m/g, "");
    },
    get emittedBytes() {
      return emittedBytes;
    },
    get ackBytes() {
      return ackBytes;
    },
    get drained() {
      return (
        !renderer.activeWrite &&
        renderer.pendingWriteBytes === 0 &&
        ackBytes >= emittedBytes
      );
    },
    dispose() {
      closing = true;
      renderer.destroy();
      manager.destroyProcess(processId);
      zmodem.destroyAll();
      clearInterval(zmodem._watchdog);
      native.destroy();
      vi.unstubAllGlobals();
    },
  };
}

describe("performance baseline", () => {
  let shellServer;
  let sftpRoot;
  let sftp;

  beforeAll(async () => {
    expect(
      process.env.SIMPLESHELL_NATIVE_SERVICES_PATH,
      "native host must be built",
    ).toBeTruthy();
    shellServer = await helpers.startShellServer();
    sftpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "simpleshell-perf-"));
    fs.mkdirSync(path.join(sftpRoot, "remote"));
    sftp = await createSftpLoopback(path.join(sftpRoot, "remote"));
  });

  afterAll(async () => {
    await shellServer?.close();
    await sftp?.close();
    if (sftpRoot) fs.rmSync(sftpRoot, { recursive: true, force: true });
    const { file, report } = helpers.writeResults(metrics, {
      floodBytes: FLOOD_BYTES,
      smallFileCount: SMALL_FILE_COUNT,
      tabCount: TAB_COUNT,
    });
    if (Object.keys(diag).length)
      console.log("PERF diag", JSON.stringify(diag, null, 1));
    console.log(
      `PERF results (${report.label}) -> ${file}\n${helpers.formatComparison(metrics, helpers.readBaseline())}`,
    );
  });

  it("measures large terminal output throughput, event-loop delay and health-check false positives", async () => {
    const pool = createPool();
    const connection = await pool.getConnection({
      ...shellServer.config,
      tabId: "perf-output",
    });
    const stream = await openShell(connection.client);
    const pipeline = attachTerminalPipeline(stream, 9001);
    await helpers.waitFor(() => pipeline.plainTail.includes("perf$"), {
      label: "prompt",
    });

    const health = new SshTransportHealth({ timeoutMs: 1000 });
    const healthStats = { checks: 0, falsePositives: 0 };
    const healthTimer = setInterval(() => {
      healthStats.checks += 1;
      void health.check(connection.client).then((healthy) => {
        if (healthy === false) healthStats.falsePositives += 1;
      });
    }, 100);
    const stopMonitor = helpers.startEventLoopMonitor();
    const started = performance.now();
    try {
      stream.write(`flood ${FLOOD_BYTES}\n`);
      await profileWhile("terminal-flood", () =>
        helpers.waitFor(
          () => /PERF-DONE \d+/.test(pipeline.plainTail) && pipeline.drained,
          { timeoutMs: 300000, label: "flood completion" },
        ),
      );
      const elapsedMs = performance.now() - started;
      const loop = stopMonitor();
      record(
        "terminal.throughputMBps",
        FLOOD_BYTES / 1024 / 1024 / (elapsedMs / 1000),
        "MB/s",
      );
      record("terminal.eventLoopP99Ms", loop.p99Ms, "ms", {
        p50Ms: helpers.round(loop.p50Ms),
        maxMs: helpers.round(loop.maxMs),
      });
      record(
        "terminal.healthFalsePositiveRate",
        healthStats.checks
          ? healthStats.falsePositives / healthStats.checks
          : 0,
        "",
        {
          checks: healthStats.checks,
          falsePositives: healthStats.falsePositives,
        },
      );
      expect(pipeline.emittedBytes).toBeGreaterThanOrEqual(FLOOD_BYTES);
    } finally {
      clearInterval(healthTimer);
      health.dispose();
      pipeline.dispose();
      stream.destroy?.();
      pool.cleanup();
    }
  });

  it("measures time from opening a tab to the first prompt", async () => {
    const samples = [];
    for (let index = 0; index < PROMPT_SAMPLES; index += 1) {
      const pool = createPool();
      const started = performance.now();
      const connection = await pool.getConnection({
        ...shellServer.config,
        tabId: `perf-prompt-${index}`,
      });
      const stream = await openShell(connection.client);
      let text = "";
      await new Promise((resolve) => {
        stream.on("data", (chunk) => {
          text += chunk.toString("utf8");
          if (text.includes("perf$")) resolve();
        });
      });
      samples.push(performance.now() - started);
      stream.destroy?.();
      pool.cleanup();
    }
    samples.sort((a, b) => a - b);
    record(
      "terminal.timeToPromptMs",
      samples[Math.floor(samples.length / 2)],
      "ms",
      {
        samples: samples.map((value) => helpers.round(value)),
      },
    );
  });

  it("measures native processes per tab and total RSS", async () => {
    const image = helpers.nativeImageName();
    const pool = createPool();
    const streams = [];
    const zmodem = new NativeZmodemClient();
    try {
      expect(await zmodem.ensureReady()).toBe(true);
      for (let tab = 0; tab < TAB_COUNT; tab += 1) {
        const connection = await pool.getConnection({
          ...shellServer.config,
          tabId: `perf-tab-${tab}`,
        });
        streams.push(await openShell(connection.client));
        const listed = await nativeSftp.invokeNativeRequestWithConfig(
          sftp.config,
          { operation: "listFiles", path: "/" },
          { sessionKey: `perf-tab-${tab}` },
        );
        expect(listed.success).toBe(true);
      }
      const processes = helpers.listProcesses(image);
      // Absolute count: the resident core is shared by every tab.
      const nativeCount = processes.length;
      const nativeRss = processes.reduce(
        (sum, entry) => sum + entry.rssBytes,
        0,
      );
      record("tabs.nativeProcessesPerTab", nativeCount / TAB_COUNT, "", {
        nativeProcesses: nativeCount,
      });
      record(
        "tabs.totalRssMB",
        (process.memoryUsage().rss + nativeRss) / 1024 / 1024,
        "MB",
        {
          nativeRssMB: helpers.round(nativeRss / 1024 / 1024),
        },
      );
    } finally {
      for (let tab = 0; tab < TAB_COUNT; tab += 1)
        nativeSftp.closeNativeSession(`perf-tab-${tab}`);
      for (const stream of streams) stream.destroy?.();
      zmodem.destroy();
      pool.cleanup();
    }
  });

  it(`measures ${SMALL_FILE_COUNT} small-file uploads and downloads with handshake counts`, async () => {
    const localDir = path.join(sftpRoot, "local");
    const downloadDir = path.join(sftpRoot, "download");
    fs.mkdirSync(localDir);
    fs.mkdirSync(downloadDir);
    const payload = Buffer.alloc(1024, 0x61);
    for (let index = 0; index < SMALL_FILE_COUNT; index += 1) {
      fs.writeFileSync(path.join(localDir, `f${index}.txt`), payload);
    }
    const transferPool = new TransferScheduler({ maxWorkers: 8 });
    const run = async (direction) => {
      const handshakesBefore = sftp.stats.connections;
      const started = performance.now();
      const result = await transferPool.runTasks({
        transferKey: `perf-${direction}`,
        tabId: "perf-transfer",
        sshConfig: sftp.config,
        maxConcurrency: 8,
        tasks: Array.from({ length: SMALL_FILE_COUNT }, (_, index) => ({
          taskId: `${direction}-${index}`,
          direction,
          localPath: path.join(
            direction === "upload" ? localDir : downloadDir,
            `f${index}.txt`,
          ),
          remotePath: `/batch/f${index}.txt`,
        })),
      });
      expect(result.completed).toBe(SMALL_FILE_COUNT);
      record(
        `transfer.${direction}${SMALL_FILE_COUNT}.ms`,
        performance.now() - started,
        "ms",
      );
      record(
        `transfer.${direction}${SMALL_FILE_COUNT}.handshakes`,
        sftp.stats.connections - handshakesBefore,
        "",
      );
    };
    try {
      await run("upload");
      await run("download");
      expect(
        fs.readFileSync(path.join(downloadDir, "f0.txt")).equals(payload),
      ).toBe(true);
    } finally {
      await transferPool.shutdown();
    }
  });
});
