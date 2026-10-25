import React from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { ipcRenderer } from "electron";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import en from "../../src/shared/locales/en-US.json";
import { AppProvider } from "../../src/renderer/app/state/AppContext.jsx";
import WebTerminal from "../../src/renderer/features/terminal/WebTerminal.jsx";
import { terminalCache } from "../../src/renderer/features/terminal/runtime/terminalSessionStore.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, message) => {
  const deadline = Date.now() + 30000;
  while (!predicate()) {
    if (Date.now() > deadline)
      throw new Error(typeof message === "function" ? message() : message);
    await delay(10);
  }
};
const fail = (error) =>
  ipcRenderer.send("history-result", {
    success: false,
    error: String(error?.stack || error),
  });
window.addEventListener("error", (event) => fail(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => fail(event.reason));
let output;
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
  startLocalTerminal: async () => 902,
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

async function run() {
  await i18next.init({ lng: "en-US", resources: { "en-US": en } });
  const root = createRoot(document.getElementById("root"));
  root.render(
    <I18nextProvider i18n={i18next}>
      <ThemeProvider theme={createTheme()}>
        <AppProvider>
          <div style={{ width: 960, height: 640 }}>
            <WebTerminal
              tabId="scrollback"
              terminalType="local"
              localConfig={{ name: "Scrollback fixture" }}
            />
          </div>
        </AppProvider>
      </ThemeProvider>
    </I18nextProvider>,
  );
  await until(
    () => output && terminalCache.scrollback,
    "terminal did not start",
  );
  await delay(300);
  const term = terminalCache.scrollback;
  const write = async (data) => {
    echo(data);
    await until(() => ackBytes === outputBytes, "output did not drain");
  };
  const metrics = {};
  // Sustained output paced like the main mailbox: ~16 KiB messages, paused
  // while 512 KiB are unacknowledged. `write()` waits for each batch's ACK, so
  // it measures latency; this measures parse/render throughput. Frame rate is
  // not measured: the fixture window is hidden and its frames are throttled.
  const streamOutput = async (mode, totalBytes) => {
    const lines = [];
    for (let i = 0; i < 128; i++) {
      lines.push(
        `\r\n\x1b[90m2026-10-25 12:00:${String(i % 60).padStart(2, "0")}\x1b[0m INFO [worker-${i % 8}] GET /api/v1/items/${i} from \x1b[96m192.168.1.${i}:5${i}\x1b[0m status=\x1b[93m200\x1b[0m 中文 payload`,
      );
    }
    const chunk = lines.join("");
    const chunkBytes = new TextEncoder().encode(chunk).length;
    let lastTick = performance.now();
    let maxGap = 0;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - lastTick);
      lastTick = now;
    }, 8);
    await ipcRenderer.invoke("scrollback-profile-start");
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
    await ipcRenderer.invoke("scrollback-profile-stop", `${mode}-stream`);
    metrics[`${mode}StreamMBps`] = totalBytes / 1048576 / seconds;
    metrics[`${mode}StreamMaxGapMs`] = maxGap;
    assert(maxGap < 250, `${mode}: output stream stalled for ${maxGap}ms`);
  };
  // Runs before the 50,000-line fill so later history assertions still see
  // only the deterministic rows.
  await streamOutput("dom", 32 * 1048576);
  metrics.resizes = [];
  const resize = term.resize.bind(term);
  term.resize = (cols, rows) => {
    const startedAt = performance.now();
    const before = { cols: term.cols, rows: term.rows };
    resize(cols, rows);
    metrics.resizes.push({
      before,
      cols,
      rows,
      duration: performance.now() - startedAt,
      at: startedAt,
    });
  };
  let reads = 0;
  const buffer = term.buffer.active;
  const getLine = buffer.getLine.bind(buffer);
  buffer.getLine = (index) => {
    reads++;
    return getLine(index);
  };
  const append = async (start, count) => {
    for (let i = start; i < start + count; i += 1000) {
      await write(
        Array.from(
          { length: Math.min(1000, start + count - i) },
          (_, n) =>
            `\r\nrow-${String(i + n).padStart(6, "0")} \x1b[32m中文 history payload\x1b[0m`,
        ).join(""),
      );
    }
  };
  let started = performance.now();
  await append(0, 50000);
  metrics.fillMs = performance.now() - started;
  metrics.fillLineReads = reads;
  started = performance.now();
  await append(50000, 10000);
  metrics.fullBufferAppendMs = performance.now() - started;
  term.focus();
  await ipcRenderer.invoke("history-text", "x");
  await delay(50);
  term.scrollToTop();
  await delay(50);
  assert(buffer.viewportY === 0, "cannot scroll to retained history");
  assert(buffer.length === 50000 + term.rows, "history capacity changed");
  metrics.firstLine = buffer.getLine(0).translateToString(true);
  document.querySelector(".search-icon-btn").click();
  await delay(30);
  document.querySelector(".search-input").focus();
  started = performance.now();
  reads = 0;
  await ipcRenderer.invoke("history-text", "row-");
  await until(
    () => /\d+\/\d+/.test(document.querySelector(".search-bar").textContent),
    "search did not finish",
  );
  metrics.searchMs = performance.now() - started;
  metrics.searchLineReads = reads;
  metrics.searchText = document.querySelector(".search-bar").textContent;
  const button = (key) =>
    document.querySelector(
      `button[aria-label="${i18next.t(`webTerminal.search.${key}`)}"]`,
    );
  const selectedBefore = term.getSelectionPosition().start.y;
  button("next").click();
  await delay(50);
  assert(
    term.getSelectionPosition().start.y !== selectedBefore,
    "initial search navigation failed",
  );
  button("close").click();
  await delay(30);

  scrollbackCapacity = 500000;
  window.dispatchEvent(
    new CustomEvent("settingsChanged", {
      detail: { terminalScrollbackLines: scrollbackCapacity },
    }),
  );
  assert(
    term.options.scrollback === 500000,
    "large scrollback preference was not applied",
  );
  started = performance.now();
  await append(60000, 450000);
  metrics.fillTo500kMs = performance.now() - started;
  assert(
    buffer.length === scrollbackCapacity + term.rows,
    "500k history was truncated",
  );
  const firstRetained = `row-${String(510000 - buffer.length).padStart(6, "0")}`;
  assert(
    buffer.getLine(0).translateToString(true).startsWith(firstRetained),
    "old retained history was lost",
  );
  assert(
    buffer
      .getLine(buffer.length - 1)
      .translateToString(true)
      .startsWith("row-509999"),
    "latest history was lost",
  );
  // xterm keeps every retained row as a cols-wide typed array, so history
  // memory scales with capacity × columns rather than with the text written.
  let historyCellBytes = 0;
  const historyLines = term._core.buffer.lines;
  for (let i = 0; i < historyLines.length; i++) {
    historyCellBytes += historyLines.get(i)._data.byteLength;
  }
  metrics.history500kCellMB = historyCellBytes / 1048576;
  metrics.history500kCols = term.cols;

  const checkInteractions = async (mode) => {
    await ipcRenderer.invoke("scrollback-profile-start");
    term.scrollToTop();
    await delay(30);
    assert(buffer.viewportY === 0, `${mode}: history top is unreachable`);
    term.select(0, 0, term.cols * 3);
    assert(
      term.getSelection().includes(`${firstRetained} 中文`),
      `${mode}: history selection/copy lost Unicode text`,
    );
    term.clearSelection();
    assert(
      document.querySelectorAll(".xterm-rows > div").length <= term.rows,
      "historical rows leaked into DOM rendering",
    );
    document.querySelector(".search-icon-btn").click();
    await delay(30);
    const searchInput = document.querySelector(".search-input");
    let lastTick = performance.now();
    let maxGap = 0;
    let ticks = 0;
    const heartbeat = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - lastTick);
      lastTick = now;
      ticks++;
    }, 8);
    try {
      searchInput.focus();
      reads = 0;
      const searchStarted = performance.now();
      await ipcRenderer.invoke("history-text", "row-");
      await until(
        () =>
          document
            .querySelector(".search-bar")
            .textContent.includes(`/${buffer.length}`),
        `${mode}: exact full-history match count was not returned`,
      );
      metrics[`${mode}Search500kMs`] = performance.now() - searchStarted;
      metrics[`${mode}SearchLineReads`] = reads;
      assert(ticks > 2, `${mode}: search blocked the event loop`);
      assert(maxGap < 250, `${mode}: search stalled input for ${maxGap}ms`);
      const beforeNext = reads;
      for (let i = 0; i < 3; i++) {
        const selectedRow = term.getSelectionPosition().start.y;
        button("next").click();
        await until(
          () => term.getSelectionPosition()?.start.y !== selectedRow,
          () =>
            `cached search navigation failed: ${JSON.stringify({ selectedRow, current: term.getSelectionPosition(), text: document.querySelector(".search-bar").textContent, query: searchInput.value })}`,
        );
      }
      metrics[`${mode}NavigationLineReads`] = reads - beforeNext;
      assert(reads - beforeNext < 1000, "search navigation rescanned history");
      searchInput.focus();
      searchInput.select();
      await ipcRenderer.invoke("history-text", "row-509999");
      await until(
        () => document.querySelector(".search-bar").textContent.includes("1/1"),
        "search did not reach the end of the full history",
      );
      assert(
        term.getSelection() === "row-509999",
        "deep history search selected the wrong text",
      );
      metrics[`${mode}MaxSearchHeartbeatGapMs`] = maxGap;
    } finally {
      clearInterval(heartbeat);
      button("close").click();
    }
    await delay(30);
    term.scrollToBottom();
    term.focus();
    const previousText = buffer
      .getLine(buffer.length - 1)
      .translateToString(true);
    const inputStarted = performance.now();
    await ipcRenderer.invoke("history-text", "x");
    await until(
      () =>
        buffer.getLine(buffer.length - 1).translateToString(true) ===
        `${previousText}x`,
      "typing stopped working with a large history",
    );
    metrics[`${mode}InputMs`] = performance.now() - inputStarted;
    await ipcRenderer.invoke("scrollback-profile-stop", mode);
    assert(
      metrics[`${mode}InputMs`] < 250,
      `${mode}: slow input ${JSON.stringify(metrics)}`,
    );
  };
  await checkInteractions("dom");
  const switchStarted = performance.now();
  window.dispatchEvent(
    new CustomEvent("settingsChanged", {
      detail: { performance: { webglEnabled: true } },
    }),
  );
  // Renderer changes can change measured cell widths. Wait for their queued
  // fit/reflow before measuring search responsiveness in the new renderer.
  await delay(200);
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
  metrics.rendererSwitchMs = performance.now() - switchStarted;
  assert(term.__webglEnabled, "WebGL did not initialize");
  await checkInteractions("webgl");
  await streamOutput("webgl", 32 * 1048576);

  started = performance.now();
  await append(510000, 10000);
  metrics.full500kAppendMs = performance.now() - started;
  assert(
    buffer.length === scrollbackCapacity + term.rows,
    "full history did not retain configured capacity",
  );
  // A logical line can span thousands of screen rows; it must stay visible
  // without turning prompt recognition or mouse hover into a history scan.
  reads = 0;
  await write(`\r\n${"A".repeat(term.cols * 2000)}`);
  metrics.longLineReads = reads;
  assert(reads < 2000, "prompt detection walked the entire wrapped output");
  assert(
    buffer.getLine(buffer.length - 1500).translateToString(true) ===
      "A".repeat(term.cols),
    "long wrapped history was truncated",
  );
  reads = 0;
  const links = await new Promise((resolve) =>
    term._core._linkProviderService.linkProviders[0].provideLinks(
      buffer.length,
      resolve,
    ),
  );
  assert(
    links.length === 0 && reads < 300,
    "link hover scanned a scrollback-sized logical line",
  );
  term.scrollToBottom();
  await write("\r\n$ ");
  root.unmount();
  await delay(50);
  assert(!terminalCache.scrollback, "terminal session was not disposed");
  ipcRenderer.send("history-result", { success: true, metrics });
}
run().catch(fail);
