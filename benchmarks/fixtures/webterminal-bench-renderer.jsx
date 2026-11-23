/* global window, document, requestAnimationFrame */
import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { ipcRenderer } from "electron";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import en from "../../src/shared/locales/en-US.json";
import { AppProvider } from "../../src/renderer/app/state/AppContext.jsx";
import WebTerminal from "../../src/renderer/features/terminal/WebTerminal.jsx";
import {
  fitAddonCache,
  terminalCache,
} from "../../src/renderer/features/terminal/runtime/terminalSessionStore.js";
import {
  getLogicalLineUntilCursor,
  isPromptReadyFromTerminal,
} from "../../src/renderer/features/terminal/model/promptDetection.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, message, timeoutMs = 45000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error(typeof message === "function" ? message() : message);
    }
    await delay(5);
  }
};

const fail = (error) =>
  ipcRenderer.send("bench-result", {
    success: false,
    error: String(error?.stack || error),
  });

window.addEventListener("error", (event) => fail(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => fail(event.reason));

const isQuick = window.location.search.includes("quick=1");
let output = null;
let outputBytes = 0;
let ackBytes = 0;
let scrollbackCapacity = 50000;

const echo = (data) => {
  outputBytes += new TextEncoder().encode(data).length;
  output({ type: "output", data });
};

window.terminalAPI = {
  loadUISettings: async () => ({
    terminalScrollbackLines: scrollbackCapacity,
    performance: { webglEnabled: false },
  }),
  startLocalTerminal: async () => 950,
  killProcess: async () => {},
  resizeTerminal: async () => {},
  onTerminalMailboxMessage: (_id, callback) => {
    output = callback;
    queueMicrotask(() => echo("\r\n$ "));
    return () => {};
  },
  postTerminalMailboxMessage: (_id, message) => {
    if (message.type === "input") echo(message.data);
    if (message.type === "ack") ackBytes += message.bytes;
    return true;
  },
  getCommandSuggestions: async () => ({ success: true, suggestions: [] }),
};

const summarize = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p) => {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  };
  const mean = sorted.reduce((acc, v) => acc + v, 0) / (sorted.length || 1);
  return {
    count: sorted.length,
    min: sorted[0] || 0,
    p50: pick(50),
    p95: pick(95),
    p99: pick(99),
    max: sorted[sorted.length - 1] || 0,
    mean,
  };
};

async function run() {
  await i18next.init({ lng: "en-US", resources: { "en-US": en } });
  const root = createRoot(document.getElementById("root"));
  root.render(
    <I18nextProvider i18n={i18next}>
      <ThemeProvider theme={createTheme()}>
        <AppProvider>
          <div
            id="bench-term-box"
            style={{ width: 960, height: 640, overflow: "hidden" }}
          >
            <WebTerminal
              tabId="bench"
              terminalType="local"
              localConfig={{ name: "Bench fixture" }}
            />
          </div>
        </AppProvider>
      </ThemeProvider>
    </I18nextProvider>,
  );

  await until(
    () => output && terminalCache.bench && fitAddonCache.bench,
    "WebTerminal did not start",
  );
  await delay(300);

  const term = terminalCache.bench;
  const fitAddon = fitAddonCache.bench;
  const box = document.getElementById("bench-term-box");
  const buffer = term.buffer.active;
  let reads = 0;
  const origGetLine = buffer.getLine.bind(buffer);
  buffer.getLine = (index) => {
    reads += 1;
    return origGetLine(index);
  };

  const writeAndDrain = async (data) => {
    echo(data);
    await until(() => ackBytes === outputBytes, "terminal write did not drain");
  };

  const appendDeterministicRows = async (count) => {
    for (let i = 0; i < count; i += 1000) {
      const batchLen = Math.min(1000, count - i);
      const chunk = Array.from({ length: batchLen }, (_, n) => {
        const idx = i + n;
        const prefix = idx === 0 ? "" : "\r\n";
        return `${prefix}row-${String(idx).padStart(6, "0")} \x1b[32m中文 bench payload\x1b[0m`;
      }).join("");
      await writeAndDrain(chunk);
    }
  };

  const streamOutput = async (totalBytes) => {
    const lines = [];
    for (let i = 0; i < 128; i += 1) {
      lines.push(
        `\r\n\x1b[90m2026-11-23 12:00:${String(i % 60).padStart(2, "0")}\x1b[0m INFO [worker-${i % 8}] GET https://api.example.internal/v1/items/${i} from \x1b[96m192.168.1.${i}:5${i}\x1b[0m status=\x1b[93m200\x1b[0m 中文 payload`,
      );
    }
    const chunk = lines.join("");
    const chunkBytes = new TextEncoder().encode(chunk).length;
    let lastTick = performance.now();
    let maxGapMs = 0;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      maxGapMs = Math.max(maxGapMs, now - lastTick);
      lastTick = now;
    }, 8);

    const startedAt = performance.now();
    try {
      for (let sent = 0; sent < totalBytes;) {
        while (outputBytes - ackBytes < 512 * 1024 && sent < totalBytes) {
          outputBytes += chunkBytes;
          output({ type: "output", data: chunk });
          sent += chunkBytes;
        }
        await delay(1);
      }
      await until(() => ackBytes === outputBytes, "stream did not drain");
    } finally {
      clearInterval(heartbeat);
    }

    const seconds = (performance.now() - startedAt) / 1000;
    return {
      throughputMBps: totalBytes / 1048576 / seconds,
      maxGapMs,
      elapsedMs: seconds * 1000,
    };
  };

  const button = (key) =>
    document.querySelector(
      `button[aria-label="${i18next.t(`webTerminal.search.${key}`)}"]`,
    );

  const measureSearchAndJumps = async (expectedTotalMatches) => {
    document.querySelector(".search-icon-btn").click();
    await delay(20);
    const searchInput = document.querySelector(".search-input");
    searchInput.focus();

    let lastTick = performance.now();
    let maxGapMs = 0;
    let ticks = 0;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      maxGapMs = Math.max(maxGapMs, now - lastTick);
      lastTick = now;
      ticks += 1;
    }, 8);

    const jumpSamples = [];
    let jumpLineReads = 0;
    let scanMs = 0;
    let scanLineReads = 0;

    try {
      reads = 0;
      const scanStarted = performance.now();
      await ipcRenderer.invoke("bench-text", "row-");
      await until(
        () =>
          document
            .querySelector(".search-bar")
            ?.textContent.includes(`/${expectedTotalMatches}`),
        () =>
          `search did not reach /${expectedTotalMatches}; got: ${document.querySelector(".search-bar")?.textContent}`,
      );
      scanMs = performance.now() - scanStarted;
      scanLineReads = reads;
      assert(ticks > 0, "search heartbeat did not fire");

      const jumpCount = isQuick ? 5 : 10;
      const readsBeforeJumps = reads;
      for (let j = 0; j < jumpCount; j += 1) {
        const prevY = term.getSelectionPosition()?.start?.y;
        const jumpStart = performance.now();
        button("next").click();
        await until(
          () => term.getSelectionPosition()?.start?.y !== prevY,
          "cached search jump failed",
        );
        jumpSamples.push(performance.now() - jumpStart);
      }
      jumpLineReads = reads - readsBeforeJumps;
      assert(
        jumpLineReads < 1000,
        `cached search jump rescanned history (${jumpLineReads} reads)`,
      );
    } finally {
      clearInterval(heartbeat);
      button("close").click();
      await delay(20);
    }

    return {
      scanMs,
      scanLineReads,
      maxGapMs,
      jumpStats: summarize(jumpSamples),
      jumpLineReads,
    };
  };

  const measureInputEcho = async (count) => {
    term.scrollToBottom();
    term.focus();
    await writeAndDrain("\r\n$ ");
    const samples = [];
    const chars = "abcdefghijklmnopqrstuvwxyz";
    for (let i = 0; i < count; i += 1) {
      const ch = chars[i % chars.length];
      const absCursorRow = buffer.baseY + buffer.cursorY;
      const beforeText = buffer.getLine(absCursorRow).translateToString(true);
      const started = performance.now();
      await ipcRenderer.invoke("bench-text", ch);
      await until(
        () =>
          buffer.getLine(absCursorRow).translateToString(true) ===
          `${beforeText}${ch}`,
        "input echo did not appear",
      );
      samples.push(performance.now() - started);
    }
    return summarize(samples);
  };

  const measureResizeReflow = () => {
    const widths = [720, 1120, 840, 1040, 680, 960];
    const samples = [];
    const transitions = [];
    for (const width of widths) {
      const before = { cols: term.cols, rows: term.rows };
      box.style.width = `${width}px`;
      const started = performance.now();
      fitAddon.fit();
      const durationMs = performance.now() - started;
      const after = { cols: term.cols, rows: term.rows };
      samples.push(durationMs);
      transitions.push({ width, before, after, durationMs });
    }
    return { stats: summarize(samples), transitions };
  };

  const metrics = {};
  const streamBytes = (isQuick ? 4 : 16) * 1048576;
  const echoCount = isQuick ? 6 : 15;

  // Phase A: 50,000 default scrollback
  assert(
    term.options.scrollback === 50000,
    `Expected default 50000 scrollback, got ${term.options.scrollback}`,
  );
  metrics.stream50kDom = await streamOutput(streamBytes);

  term.reset();
  await delay(50);
  const rows50k = 50000 + term.rows;
  await appendDeterministicRows(rows50k);
  assert(
    buffer.length === rows50k,
    `50k buffer length mismatch: ${buffer.length} vs ${rows50k}`,
  );
  assert(
    buffer.getLine(0).translateToString(true).startsWith("row-000000"),
    `50k oldest retained line mismatch: got ${buffer.getLine(0).translateToString(true)}`,
  );

  metrics.search50k = await measureSearchAndJumps(rows50k);
  metrics.input50k = await measureInputEcho(echoCount);
  metrics.resize50k = measureResizeReflow();

  // Phase B: 500,000 max scrollback (full content retained, zero truncation)
  scrollbackCapacity = 500000;
  window.dispatchEvent(
    new CustomEvent("settingsChanged", {
      detail: { terminalScrollbackLines: scrollbackCapacity },
    }),
  );
  assert(
    term.options.scrollback === 500000,
    "500k scrollback preference was not applied",
  );

  term.reset();
  await delay(50);
  const rows500k = 500000 + term.rows;
  const append500kStart = performance.now();
  await appendDeterministicRows(rows500k);
  metrics.fillTo500kMs = performance.now() - append500kStart;

  assert(
    buffer.length === rows500k,
    `500k history was truncated: got ${buffer.length}, expected ${rows500k}`,
  );
  assert(
    buffer.getLine(0).translateToString(true).startsWith("row-000000"),
    `500k oldest retained history lost: got ${buffer.getLine(0).translateToString(true)}`,
  );
  const lastRowPrefix = `row-${String(rows500k - 1).padStart(6, "0")}`;
  assert(
    buffer
      .getLine(buffer.length - 1)
      .translateToString(true)
      .startsWith(lastRowPrefix),
    `500k latest line mismatch: expected ${lastRowPrefix}, got ${buffer.getLine(buffer.length - 1).translateToString(true)}`,
  );

  // Measure search, echo, and resize while all 500,000 rows are retained.
  metrics.search500k = await measureSearchAndJumps(rows500k);
  metrics.input500k = await measureInputEcho(echoCount);
  metrics.resize500k = measureResizeReflow();

  // Measure prompt tracking & link detection overhead on normal + 2000-row wrapped line.
  await writeAndDrain("\r\nuser@host:~/app$ https://example.com/docs?id=42");
  const promptSamples = [];
  for (let i = 0; i < 100; i += 1) {
    const t0 = performance.now();
    isPromptReadyFromTerminal(term);
    getLogicalLineUntilCursor(term);
    promptSamples.push(performance.now() - t0);
  }
  const linkProviders = term._core._linkProviderService.linkProviders || [];
  const linkRow = buffer.baseY + buffer.cursorY + 1;
  let linkProvider = null;
  for (const candidate of linkProviders) {
    // @xterm/xterm may include a built-in provider (e.g., OSC 8) ahead of custom providers.
    const matched = await new Promise((resolve) => {
      candidate.provideLinks(linkRow, (found) =>
        resolve(Array.isArray(found) ? found : []),
      );
    });
    if (matched.length > 0) {
      linkProvider = candidate;
      break;
    }
  }
  assert(
    Boolean(linkProvider),
    `expected link detection to match URL (providers=${linkProviders.length}, linkRow=${linkRow}, length=${buffer.length}, line="${buffer.getLine(linkRow - 1)?.translateToString(true)}")`,
  );
  const linkSamples = [];
  let lastLinkCount = 0;
  for (let i = 0; i < 100; i += 1) {
    const t0 = performance.now();
    await new Promise((resolve) => {
      linkProvider.provideLinks(linkRow, (found) => {
        lastLinkCount = found ? found.length : 0;
        resolve();
      });
    });
    linkSamples.push(performance.now() - t0);
  }
  assert(lastLinkCount >= 1, "expected selected link provider to match URL");

  // Long wrapped logical line test (bounds check without scanning 500k history)
  await writeAndDrain(`\r\n${"A".repeat(term.cols * 2000)}`);
  assert(
    buffer.getLine(buffer.length - 1500).translateToString(true) ===
      "A".repeat(term.cols),
    "long wrapped line was truncated",
  );
  reads = 0;
  const wrappedPromptStart = performance.now();
  isPromptReadyFromTerminal(term);
  const wrappedPromptMs = performance.now() - wrappedPromptStart;
  const wrappedPromptReads = reads;
  assert(
    wrappedPromptReads < 2000,
    `prompt detection walked wrapped output (${wrappedPromptReads} reads)`,
  );

  reads = 0;
  const wrappedLinkStart = performance.now();
  await new Promise((resolve) =>
    linkProvider.provideLinks(buffer.length, resolve),
  );
  const wrappedLinkMs = performance.now() - wrappedLinkStart;
  const wrappedLinkReads = reads;
  assert(
    wrappedLinkReads < 300,
    `link provider walked wrapped output (${wrappedLinkReads} reads)`,
  );

  metrics.promptAndLink = {
    promptStats: summarize(promptSamples),
    linkStats: summarize(linkSamples),
    wrappedPromptMs,
    wrappedPromptReads,
    wrappedLinkMs,
    wrappedLinkReads,
  };

  // Sustained streaming throughput at 500k scrollback (DOM)
  metrics.stream500kDom = await streamOutput(streamBytes);
  assert(
    buffer.length === 500000 + term.rows,
    "500k buffer capacity shrank after streaming",
  );

  // Optional WebGL renderer measurement if WebGL context is supported in this environment
  let webglSupported = false;
  const switchStart = performance.now();
  window.dispatchEvent(
    new CustomEvent("settingsChanged", {
      detail: { performance: { webglEnabled: true } },
    }),
  );
  await delay(200);
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  const webglSwitchMs = performance.now() - switchStart;
  if (term.__webglEnabled) {
    webglSupported = true;
    metrics.stream500kWebgl = await streamOutput(streamBytes);
    metrics.input500kWebgl = await measureInputEcho(Math.min(echoCount, 6));
  }
  metrics.webgl = {
    supported: webglSupported,
    switchMs: webglSwitchMs,
  };

  let historyCellBytes = 0;
  const historyLines = term._core.buffer.lines;
  for (let i = 0; i < historyLines.length; i += 1) {
    historyCellBytes += historyLines.get(i)._data.byteLength;
  }

  const electronMem = await ipcRenderer.invoke("bench-memory");
  metrics.memory = {
    rendererRssMB: process.memoryUsage().rss / 1048576,
    history500kCellMB: historyCellBytes / 1048576,
    electronTotalWorkingSetMB: electronMem.totalWorkingSetMB,
    electronTotalPrivateMB: electronMem.totalPrivateMB,
    electronMainRssMB: electronMem.mainRssMB,
    electronProcessCount: electronMem.processCount,
  };

  root.unmount();
  await delay(50);
  assert(!terminalCache.bench, "terminal session was not disposed");

  ipcRenderer.send("bench-result", { success: true, metrics });
}

run().catch(fail);
