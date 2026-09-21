import { expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const preloadRoot = path.resolve("src/preload");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
} = require("../../src/shared/contracts/ipc/channels");
const {
  getTerminalIOMailboxOutputChannel,
} = require("../../src/shared/contracts/terminalIOMailboxProtocol");

// Run the real entry and factories in one isolated preload context. Only the
// Electron transport is replaced, so subscriptions cross the actual modules.
function loadBridge() {
  const exposed = {};
  const ipcRenderer = new EventEmitter();
  ipcRenderer.invoke = vi.fn().mockResolvedValue({ success: true });
  ipcRenderer.send = vi.fn();
  const electron = {
    ipcRenderer,
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        exposed[name] = api;
      },
    },
    webUtils: { getPathForFile: vi.fn() },
    crashReporter: { addExtraParameter: vi.fn() },
  };
  const context = vm.createContext({
    process,
    console,
    URL,
    setTimeout,
    clearTimeout,
  });
  const modules = new Map();
  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const localRequire = createRequire(filename);
    const resolve = (specifier) => {
      if (specifier === "electron") return electron;
      const resolved = localRequire.resolve(specifier);
      return resolved.startsWith(preloadRoot + path.sep)
        ? load(resolved)
        : localRequire(specifier);
    };
    const run = vm.runInContext(
      `(function(require, module, exports) {\n${readFileSync(filename, "utf8")}\n})`,
      context,
      { filename },
    );
    run(resolve, module, module.exports);
    return module.exports;
  }
  load(path.join(preloadRoot, "index.js"));
  return { api: exposed.terminalAPI, ipcRenderer, exposed };
}

it("assembles the public APIs and isolates batched terminal output by session", () => {
  const { api, ipcRenderer, exposed } = loadBridge();
  expect(Object.keys(exposed).sort()).toEqual([
    "appErrorAPI",
    "clipboardAPI",
    "dialogAPI",
    "electronAPI",
    "simpleshellBoot",
    "terminalAPI",
  ]);
  expect(
    Object.values(exposed).reduce(
      (sum, api) =>
        sum +
        Object.values(api).filter((value) => typeof value === "function")
          .length,
      0,
    ),
  ).toBe(235);
  const first = vi.fn();
  const second = vi.fn();
  const observer = vi.fn();
  const channel = getTerminalIOMailboxOutputChannel(101);
  ipcRenderer.on(channel, observer);
  const stop = api.onTerminalMailboxMessage(101, first);
  api.onTerminalMailboxMessage(202, second);
  const messages = [
    { type: "output", data: "one" },
    { type: "output", data: "two" },
  ];
  ipcRenderer.emit(channel, {}, messages);
  expect(first.mock.calls).toEqual(messages.map((message) => [message]));
  expect(second).not.toHaveBeenCalled();
  stop();
  api.onTerminalMailboxMessage(101, first);
  api.removeTerminalMailboxListener(101);
  expect(ipcRenderer.listeners(channel)).toEqual([observer]);
  ipcRenderer.emit(getTerminalIOMailboxOutputChannel(202), {}, messages[0]);
  expect(second).toHaveBeenCalledWith(messages[0]);
  api.removeTerminalMailboxListener(202, second);
  expect(
    ipcRenderer.listenerCount(getTerminalIOMailboxOutputChannel(202)),
  ).toBe(0);
});

it("keeps reconnect callbacks compatible and removes only their own listeners", () => {
  const { api, ipcRenderer } = loadBridge();
  const first = vi.fn();
  const second = vi.fn();
  const stop = api.onReconnectStart(first);
  const stopSecond = api.onReconnectStart(second);
  const payload = { tabId: "session-a", attempt: 2 };
  ipcRenderer.emit(
    IPC_EVENT_CHANNELS.RECONNECT_STARTED,
    { sender: "private" },
    payload,
  );
  expect(first).toHaveBeenCalledWith(null, payload);
  stop();
  ipcRenderer.emit(IPC_EVENT_CHANNELS.RECONNECT_STARTED, {}, payload);
  expect(first).toHaveBeenCalledOnce();
  expect(second).toHaveBeenCalledTimes(2);
  stopSecond();
  expect(ipcRenderer.listenerCount(IPC_EVENT_CHANNELS.RECONNECT_STARTED)).toBe(
    0,
  );
});

it.each(["rejected", "cancelled"])(
  "cleans upload listeners when a transfer is %s",
  async (outcome) => {
    const { api, ipcRenderer } = loadBridge();
    let resolve;
    let reject;
    ipcRenderer.invoke.mockImplementationOnce(
      () =>
        new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        }),
    );
    const progress = vi.fn();
    const result = api.uploadFile("session-a", "/remote", progress);
    await Promise.resolve();
    const [request, tabId, destination, channel] =
      ipcRenderer.invoke.mock.calls[0];
    expect([request, tabId, destination]).toEqual([
      IPC_REQUEST_CHANNELS.FILE_UPLOAD,
      "session-a",
      "/remote",
    ]);
    ipcRenderer.emit(
      channel,
      {},
      {
        progress: 50,
        fileName: "file.txt",
        transferredBytes: 5,
        totalBytes: 10,
      },
    );
    expect(progress.mock.calls[0].slice(0, 4)).toEqual([50, "file.txt", 5, 10]);
    if (outcome === "rejected") {
      const assertion = expect(result).rejects.toThrow("connection lost");
      reject(new Error("connection lost"));
      await assertion;
    } else {
      ipcRenderer.emit(channel, {}, { cancelled: true });
      expect(ipcRenderer.listenerCount(channel)).toBe(0);
      resolve({ cancelled: true });
      await expect(result).resolves.toEqual({ cancelled: true });
    }
    expect(ipcRenderer.listenerCount(channel)).toBe(0);
    const count = progress.mock.calls.length;
    ipcRenderer.emit(channel, {}, { progress: 99 });
    expect(progress).toHaveBeenCalledTimes(count);
  },
);
