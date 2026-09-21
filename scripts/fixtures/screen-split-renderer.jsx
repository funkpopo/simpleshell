import { runSessionPanelChecks } from "./session-panels-renderer.jsx";
import { runTerminalSelectionChecks } from "./terminal-selection-renderer.js";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { ipcRenderer } from "electron";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import i18next from "i18next";
import { I18nextProvider } from "react-i18next";
import en from "../../src/shared/locales/en-US.json";
import {
  AppProvider,
  useAppState,
  useAppDispatch,
} from "../../src/renderer/store/AppContext.jsx";
import { actions } from "../../src/renderer/store/appReducer.js";
import {
  getLiveSessionKeys,
  getSessionDescriptor,
} from "../../src/renderer/modules/terminal/paneLayout.js";
import TerminalWorkspace from "../../src/renderer/components/terminal-pane/TerminalWorkspace.jsx";
import WebTerminal from "../../src/renderer/components/WebTerminal.jsx";
import {
  terminalCache,
  processCache,
  disposeTerminalSession,
  getTerminalSessionDiagnostics,
} from "../../src/renderer/modules/terminal/controller/terminalSessionStore.js";
import { dispatchCommandToGroup } from "../../src/renderer/modules/terminal/syncGroupCommandDispatcher.js";
import { useAllGlobalTransfers } from "../../src/renderer/store/globalTransferStore.js";
import useDragResize from "../../src/renderer/hooks/useDragResize.js";
import { getWorkingDirectoryState } from "../../src/renderer/modules/terminal/workingDirectoryStore.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, message, timeout = 10000) => {
  const deadline = Date.now() + timeout;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error(message);
    await delay(30);
  }
};
const onIpc = (channel, callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const transferEvents = [];
window.terminalAPI = {
  loadUISettings: async () => ({
    performance: { hardwareAcceleration: true, webglEnabled: true },
    terminalFontSize: 14,
    terminalScrollbackLines: 5000,
  }),
  startSSH: (config) => ipcRenderer.invoke("fixture-start", config),
  startLocalTerminal: (config) => ipcRenderer.invoke("fixture-start", config),
  killProcess: (id) => ipcRenderer.invoke("fixture-kill", id),
  sendToProcess: (id, data) => {
    ipcRenderer.send("fixture-mailbox", id, { type: "input", data });
    return Promise.resolve();
  },
  resizeTerminal: (id, cols, rows) => {
    ipcRenderer.send("fixture-mailbox", id, { type: "resize", cols, rows });
    return Promise.resolve();
  },
  postTerminalMailboxMessage: (id, message) => {
    ipcRenderer.send("fixture-mailbox", id, message);
    return true;
  },
  onTerminalMailboxMessage: (id, callback) =>
    onIpc(`fixture-output-${id}`, callback),
  onZmodemEvent: (callback) => onIpc("fixture-zmodem", callback),
};
onIpc("fixture-zmodem", (event) => transferEvents.push(event));
window.addEventListener("error", (event) =>
  ipcRenderer.send("fixture-result", {
    success: false,
    error: event.error?.stack ?? event.message,
  }),
);
window.addEventListener("unhandledrejection", (event) =>
  ipcRenderer.send("fixture-result", {
    success: false,
    error: String(event.reason?.stack ?? event.reason),
  }),
);

const mounts = {};
const unmounts = {};
let current;
let dispatch;
let transfers;
const TrackedTerminal = (props) => {
  useEffect(() => {
    mounts[props.sessionKey] = (mounts[props.sessionKey] || 0) + 1;
    return () => {
      unmounts[props.sessionKey] = (unmounts[props.sessionKey] || 0) + 1;
    };
  }, []);
  return <WebTerminal {...props} />;
};
const FloatResize = () => {
  const [width, setWidth] = useState(500);
  const start = useDragResize({
    getStart: () => ({ width }),
    getBounds: () => ({ minWidth: 50, maxWidth: 1000 }),
    onResize: (value) => setWidth(value.width),
  });
  return (
    <div id="float-resize" data-width={width} onMouseDown={start("width")} />
  );
};
const Fixture = () => {
  current = useAppState();
  dispatch = useAppDispatch();
  transfers = useAllGlobalTransfers();
  const sessions = getLiveSessionKeys(current.tabs, current.splitLayouts).map(
    (id) => getSessionDescriptor(current, id),
  );
  return (
    <div style={{ position: "relative", width: 1000, height: 800 }}>
      <TerminalWorkspace
        tabs={current.tabs.slice(1)}
        layouts={current.splitLayouts}
        sessions={sessions}
        activeTabId={current.tabs[current.currentTab]?.id}
        onFocusPane={(tabId, id) => dispatch(actions.focusPane(tabId, id))}
        onClosePane={() => {}}
        onSetRatios={(id, ratios) => dispatch(actions.setRatios(id, ratios))}
        renderTerminal={(session, options) => (
          <TrackedTerminal
            tabId={session.sessionKey}
            sessionKey={session.sessionKey}
            sshConfig={session.config}
            terminalType={session.type}
            {...options}
          />
        )}
      />
      <FloatResize />
    </div>
  );
};
const apply = (action) => flushSync(() => dispatch(action));
const add = (id) =>
  flushSync(() => {
    dispatch(actions.updateTerminalInstance(id, true));
    dispatch(
      actions.updateTerminalInstance(`${id}-config`, {
        host: "127.0.0.1",
        username: id,
        tabId: id,
        protocol: "ssh",
      }),
    );
    dispatch(actions.addTab({ id, label: `Host ${id}`, type: "ssh" }));
  });
const closePane = async (host, id) => {
  await window.terminalAPI.killProcess(processCache[id]);
  disposeTerminalSession(id);
  flushSync(() => {
    dispatch(actions.forgetSessions([id]));
    dispatch(actions.removePane(host, id));
  });
};
const contents = (id) => {
  const buffer = terminalCache[id].buffer.active;
  return Array.from({ length: buffer.length }, (_, index) =>
    buffer.getLine(index)?.translateToString(),
  ).join("\n");
};
const bounds = (id) =>
  document.querySelector(`[data-pane-id="${id}"]`).getBoundingClientRect();
const drag = (node, x, y) => {
  const rect = node.getBoundingClientRect();
  node.dispatchEvent(
    new MouseEvent("mousedown", {
      bubbles: true,
      clientX: rect.x + 2,
      clientY: rect.y + 2,
    }),
  );
  document.dispatchEvent(
    new MouseEvent("mousemove", {
      bubbles: true,
      clientX: rect.x + 2 + x,
      clientY: rect.y + 2 + y,
    }),
  );
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
};

async function run() {
  await i18next.init({
    lng: "en-US",
    resources: { "en-US": en },
    interpolation: { escapeValue: false },
  });
  const root = createRoot(document.getElementById("root"));
  flushSync(() =>
    root.render(
      <I18nextProvider i18n={i18next}>
        <ThemeProvider theme={createTheme({ palette: { mode: "dark" } })}>
          <AppProvider>
            <Fixture />
          </AppProvider>
        </ThemeProvider>
      </I18nextProvider>,
    ),
  );
  for (const id of ["A", "B", "C", "D"]) add(id);
  apply(actions.setCurrentTab(1));
  await until(
    () => ["A", "B", "C", "D"].every((id) => processCache[id]),
    "SSH sessions did not initialize",
  );
  await until(
    () => terminalCache.A.__webglEnabled === true,
    "foreground terminal did not enable WebGL",
  );
  assert(
    ["B", "C", "D"].every((id) => !terminalCache[id].__webglEnabled),
    "background tabs hold WebGL contexts",
  );
  const originals = { ...terminalCache };
  const originalProcesses = { ...processCache };
  for (const id of ["A", "B", "C", "D"])
    await window.terminalAPI.sendToProcess(processCache[id], `initial-${id}\r`);
  await until(
    () => contents("B").includes("B:initial-B"),
    "actual SSH output did not reach xterm",
  );
  for (const id of ["A", "B", "C", "D"]) {
    await window.terminalAPI.sendToProcess(processCache[id], "fixture-cwd\r");
  }
  await until(
    () =>
      ["A", "B", "C", "D"].every(
        (id) => getWorkingDirectoryState(id).path === `/sessions/${id}`,
      ),
    "WebTerminal did not track real SSH directory reports per session",
  );
  await runTerminalSelectionChecks(terminalCache.A);
  apply(actions.adoptTab("A", "B", "right"));
  await delay(100);
  const initialWidth = bounds("A").width;
  drag(
    document.querySelector(
      '[data-pane-grid="A"] [data-pane-divider="vertical"]',
    ),
    100,
    0,
  );
  await delay(100);
  assert(
    bounds("A").width > initialWidth + 90,
    "rightward divider drag must grow left pane",
  );
  drag(document.getElementById("float-resize"), 100, 0);
  await delay(30);
  assert(
    document.getElementById("float-resize").dataset.width === "400",
    "floating panel resize direction changed",
  );
  apply(actions.adoptTab("A", "C", "bottom"));
  apply(actions.setRatios("A", [30, 20]));
  await delay(80);
  assert(
    bounds("A").height < bounds("C").height / 3,
    "20% grid row ratio was ignored",
  );
  apply(actions.setRatios("A", [30, 80]));
  await delay(80);
  assert(
    bounds("A").height > bounds("C").height * 3,
    "80% grid row ratio was ignored",
  );
  await window.terminalAPI.sendToProcess(processCache.B, "fixture-download\r");
  await until(
    () =>
      transferEvents.some(
        (event) => event.tabId === "B" && event.type === "start",
      ),
    "ZMODEM download did not start",
  );
  apply(actions.adoptTab("A", "D", "right"));
  apply(actions.swapPanes("A", "A", "B"));
  await until(
    () =>
      transferEvents.some(
        (event) =>
          event.tabId === "B" &&
          event.type === "end" &&
          event.status === "complete",
      ),
    "ZMODEM download was interrupted by layout changes",
    20000,
  );
  assert(
    await ipcRenderer.invoke("fixture-downloads"),
    "downloaded file bytes differ",
  );
  assert(
    !Object.values(terminalCache).some((terminal) => terminal.__webglEnabled),
    "four-pane layout retained a WebGL context",
  );
  await ipcRenderer.invoke("fixture-capture", "four-panes");
  // Exercise the original 15-second cleanup failure with real elapsed time.
  await delay(15500);
  for (const id of ["A", "B", "C", "D"]) {
    assert(terminalCache[id] === originals[id], `${id} xterm was replaced`);
    assert(
      processCache[id] === originalProcesses[id],
      `${id} process identity changed`,
    );
    assert(
      mounts[id] === 1 && !unmounts[id],
      `${id} remounted during merge/swap/TTL`,
    );
  }
  const restored = await ipcRenderer.invoke(
    "fixture-reconnect",
    processCache.B,
  );
  window.dispatchEvent(
    new CustomEvent("terminalSessionRestored", { detail: restored }),
  );
  assert(
    getWorkingDirectoryState("B").path === null,
    "reconnect retained the old cwd",
  );
  assert(
    getWorkingDirectoryState("A").path === "/sessions/A",
    "reconnect reset another pane's cwd",
  );
  await window.terminalAPI.sendToProcess(processCache.B, "fixture-cwd\r");
  await until(
    () => getWorkingDirectoryState("B").path === "/sessions/B",
    "cwd tracking did not resume after reconnect",
  );
  apply(actions.focusPane("A", "B"));
  dispatchCommandToGroup("B", "after-reconnect", [], {});
  await until(
    () => contents("B").includes("B:after-reconnect"),
    "reconnected SSH shell did not receive focused command",
  );
  assert(
    !contents("A").includes("after-reconnect"),
    "focused command reached root SSH session",
  );
  await window.terminalAPI.sendToProcess(processCache.C, "fixture-upload\r");
  await until(
    () =>
      transferEvents.some(
        (event) => event.tabId === "C" && event.type === "start",
      ),
    "ZMODEM upload did not start",
  );
  apply(actions.unsplitTab("A"));
  await until(
    () =>
      transferEvents.some(
        (event) =>
          event.tabId === "C" &&
          event.type === "end" &&
          event.status === "complete",
      ),
    "ZMODEM upload interrupted by unsplit",
    20000,
  );
  await until(
    () => terminalCache.A.__webglEnabled === true,
    "WebGL did not resume after unsplit",
  );
  await ipcRenderer.invoke("fixture-capture", "single-pane");
  const stats = await ipcRenderer.invoke("fixture-stats");
  assert(
    stats.uploads === 1 && stats.downloads === 1 && stats.reconnects === 1,
    "SSH transfer/reconnect acceptance incomplete",
  );
  assert(
    mounts.C === 1 && !unmounts.C,
    "unsplit remounted an active transfer session",
  );
  for (const id of ["B", "C", "D"]) apply(actions.adoptTab("A", id, "bottom"));
  await closePane("A", "D");
  await closePane("A", "C");
  await closePane("A", "B");
  assert(
    !current.splitLayouts.A && terminalCache.A === originals.A,
    "4→3→2→1 replaced the surviving terminal",
  );
  add("E");
  await until(() => processCache.E, "replacement SSH terminal did not connect");
  apply(actions.adoptTab("A", "E", "left"));
  const retained = terminalCache.E;
  await closePane("A", "A");
  assert(
    current.tabs[1].id === "E" && terminalCache.E === retained,
    "closing root did not preserve promoted session",
  );
  await window.terminalAPI.killProcess(processCache.E);
  disposeTerminalSession("E");
  flushSync(() => {
    dispatch(actions.forgetSessions(["E"]));
    dispatch(actions.setTabs([current.tabs[0]]));
  });
  await delay(100);
  add("late");
  await delay(30);
  disposeTerminalSession("late");
  flushSync(() => {
    dispatch(actions.forgetSessions(["late"]));
    dispatch(actions.setTabs([current.tabs[0]]));
  });
  await until(
    async () => (await ipcRenderer.invoke("fixture-stats")).closes.late === 1,
    "late SSH connection leaked after its pane closed",
  );
  const diagnostics = getTerminalSessionDiagnostics();
  assert(
    ["A", "B", "C", "D"].every(
      (id) => getWorkingDirectoryState(id).path === null,
    ),
    "closed terminals retained cwd state",
  );
  assert(
    diagnostics.terminalCount === 0 &&
      diagnostics.processCount === 0 &&
      diagnostics.mailboxCount === 0 &&
      diagnostics.webTerminalRefCount === 0,
    "renderer session resources leaked after close",
  );
  assert(
    (await ipcRenderer.invoke("fixture-stats")).processCount === 0,
    "SSH shell processes leaked after close",
  );
  assert(
    Object.values(mounts).every((count) => count === 1),
    "a live terminal was remounted",
  );
  assert(
    Object.values(unmounts).every((count) => count === 1),
    "a closed terminal was not unmounted exactly once",
  );
  const sessionPanels = await runSessionPanelChecks();
  ipcRenderer.send("fixture-result", {
    success: true,
    sessionPanels,
    mounts,
    unmounts,
    diagnostics,
    transfersObserved: transferEvents.length,
    checks:
      "real xterm; loopback SSH reconnect; ZMODEM upload/download during merge/unsplit; 1-2-3-4-3-2-1; swap; 15s expiry; grid ratios; resize directions; root promotion; process cleanup",
  });
  void transfers;
}
run().catch((error) =>
  ipcRenderer.send("fixture-result", { success: false, error: error.stack }),
);
