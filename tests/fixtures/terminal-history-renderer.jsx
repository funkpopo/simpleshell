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
  terminalCache,
  processCache,
} from "../../src/renderer/features/terminal/runtime/terminalSessionStore.js";
import {
  getVisibleCommand,
  getLogicalLineUntilCursor,
} from "../../src/renderer/features/terminal/model/promptDetection.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (predicate, message) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await delay(20);
  }
};
const fail = (error) =>
  ipcRenderer.send("history-result", {
    success: false,
    error: String(error?.stack || error),
  });
window.addEventListener("error", (event) => fail(event.error || event.message));
window.addEventListener("unhandledrejection", (event) => fail(event.reason));

// A deterministic shell line editor behind the real terminal mailbox. Keyboard
// events, xterm parsing, prompt tracking and the suggestion UI all run unchanged.
const history = ["git status", "git log", "pwd"];
let historyIndex = history.length;
let command = "";
let output;
const sent = [];
const lookups = [];
const echo = (data) => output({ type: "output", data });
const rewrite = () => echo(`\r\x1b[2K$ ${command}`);
const input = (data) => {
  sent.push(data);
  if (data === "\x1b[A" || data === "\x1b[B") {
    historyIndex = Math.max(
      0,
      Math.min(history.length, historyIndex + (data === "\x1b[A" ? -1 : 1)),
    );
    command = history[historyIndex] || "";
    rewrite();
  } else if (data === "\r") {
    command = "";
    historyIndex = history.length;
    echo("\r\n$ ");
  } else if (data === "\x7f" || data === "\b") {
    command = command.slice(0, -1);
    rewrite();
  } else {
    command += data;
    rewrite();
  }
};
window.terminalAPI = {
  loadUISettings: async () => ({ performance: { webglEnabled: false } }),
  startLocalTerminal: async () => 901,
  killProcess: async () => {},
  sendToProcess: async (_id, data) => input(data),
  resizeTerminal: async () => {},
  onTerminalMailboxMessage: (_id, callback) => {
    output = callback;
    queueMicrotask(() => echo("\r\n$ "));
    return () => {};
  },
  postTerminalMailboxMessage: (_id, message) => {
    if (message.type === "input") input(message.data);
    return true;
  },
  getCommandSuggestions: async (value) => {
    lookups.push(value);
    return {
      success: true,
      suggestions: [{ command: `${value} --suggested`, count: 1 }],
    };
  },
  addToCommandHistory: async () => {},
  incrementCommandUsage: async () => {},
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
              tabId="history"
              terminalType="local"
              localConfig={{ name: "History fixture" }}
              allowWebgl={false}
            />
          </div>
        </AppProvider>
      </ThemeProvider>
    </I18nextProvider>,
  );
  await until(
    () =>
      processCache.history &&
      terminalCache.history &&
      getLogicalLineUntilCursor(terminalCache.history).trim() === "$",
    "terminal prompt was not ready",
  );
  const term = terminalCache.history;
  term.focus();
  const popup = () => document.querySelector("[data-suggestion-index]");
  for (const [key, expected] of [
    ["Up", "pwd"],
    ["Up", "git log"],
    ["Down", "pwd"],
  ]) {
    await ipcRenderer.invoke("history-key", key);
    await until(
      () => getVisibleCommand(term) === expected,
      `${key} did not reach the shell history`,
    );
    await delay(120);
    assert(!popup(), "history recall opened the suggestion popup");
  }
  assert(lookups.length === 0, "history recall requested suggestions");
  assert(
    sent.join("") === "\x1b[A\x1b[A\x1b[B",
    "history keys were intercepted or duplicated",
  );

  await ipcRenderer.invoke("history-key", "Backspace");
  await until(
    () => getVisibleCommand(term) === "pw" && popup(),
    "editing recalled history did not restore suggestions",
  );
  const beforeSelection = sent.length;
  await ipcRenderer.invoke("history-key", "Down");
  await until(
    () => popup()?.classList.contains("Mui-selected"),
    "suggestion keyboard selection did not activate",
  );
  assert(
    sent.length === beforeSelection,
    "suggestion selection leaked a Down key into history",
  );
  await ipcRenderer.invoke("history-key", "Return");
  await until(
    () => getVisibleCommand(term) === "pw --suggested" && !popup(),
    "Enter did not insert the selected suggestion",
  );

  await ipcRenderer.invoke("history-key", "Return");
  await until(
    () => getLogicalLineUntilCursor(term).trim() === "$",
    "Enter did not execute the selected command",
  );
  await ipcRenderer.invoke("history-text", "g");
  await until(
    () => getVisibleCommand(term) === "g" && popup(),
    "new input did not restore suggestions after Enter",
  );
  root.unmount();
  ipcRenderer.send("history-result", {
    success: true,
    historyKeys: 3,
    lookups,
  });
}
run().catch(fail);
