const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const { IPC_EVENT_CHANNELS } = require("../src/shared/contracts/ipc/channels");

const filename = path.resolve(
  __dirname,
  "../src/main/native/aiWorkerManager.js",
);
const children = [];
const events = [];
const commands = [];
const timers = new Set();
const moduleScope = { exports: {} };
vm.runInNewContext(
  fs.readFileSync(filename, "utf8"),
  {
    module: moduleScope,
    setTimeout: (callback) => {
      const timer = { callback };
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => timers.delete(timer),
    require: (name) => {
      if (name === "node:child_process")
        return {
          spawn: () => {
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.stderr = new EventEmitter();
            child.stdin = { write: (line) => commands.push(JSON.parse(line)) };
            child.kill = () => child.emit("exit", 0);
            children.push(child);
            return child;
          },
        };
      if (name === "electron")
        return {
          BrowserWindow: {
            getAllWindows: () => [
              {
                webContents: {
                  isDestroyed: () => false,
                  send: (channel, payload) =>
                    events.push({ channel, ...payload }),
                },
              },
            ],
          },
        };
      if (name.endsWith("nativeServices"))
        return { getNativeServicesHostPath: () => "fixture-sidecar" };
      if (name.endsWith("utils/logger")) return { logToFile: () => {} };
      if (name.endsWith("contracts/ipc/channels"))
        return { IPC_EVENT_CHANNELS };
      if (name.endsWith("proxy/proxy-manager"))
        return {
          getDefaultProxyConfig: () => null,
          getSystemProxyConfig: () => null,
        };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  },
  { filename },
);

const manager = moduleScope.exports;
const settled = [];
const send = (sessionId) => {
  const requestId = manager.getNextRequestId();
  manager.setRequestCallback(requestId, {
    resolve: () => settled.push({ sessionId, kind: "resolved" }),
    reject: () => settled.push({ sessionId, kind: "rejected" }),
  });
  manager.postMessage({
    kind: "request",
    requestId,
    payload: { sessionId, isStream: true },
  });
  return requestId;
};
const emit = (event) =>
  children
    .at(-1)
    .stdout.emit("data", Buffer.from(JSON.stringify(event) + "\n"));

manager.createAIWorker();
const a = send("A");
send("B");
assert.equal(manager.getDiagnostics().streamSessions, 2);
emit({ kind: "streamEnd", requestId: a, sessionId: "A" });
assert.deepEqual(
  settled,
  [{ sessionId: "A", kind: "resolved" }],
  "stream end must settle its callback and release its timeout",
);
assert.equal(manager.getDiagnostics().streamSessions, 1);
send("C");
manager.postMessage({ kind: "cancel", requestId: "cancel-B", sessionId: "B" });
assert.equal(commands.at(-1).sessionId, "B");
children.at(-1).emit("exit", 1);
assert.deepEqual(
  events
    .filter((entry) => entry.channel === IPC_EVENT_CHANNELS.AI_STREAM_ERROR)
    .map((entry) => entry.sessionId),
  ["B", "C"],
  "sidecar exit must finish every live conversation, excluding completed A",
);
assert.equal(manager.getDiagnostics().pendingRequests, 0);
assert.equal(manager.getDiagnostics().streamSessions, 0);
assert.equal(timers.size, 1);

manager.createAIWorker();
assert.equal(timers.size, 0);
send("D");
send("E");
const beforeError = events.length;
children.at(-1).emit("error", new Error("fixture process error"));
assert.deepEqual(
  events.slice(beforeError).map((entry) => entry.sessionId),
  ["D", "E"],
);
children.at(-1).emit("exit", 1);
assert.equal(
  events.length,
  beforeError + 2,
  "process error followed by exit must not duplicate stream errors",
);
manager.terminateAIWorker();
assert.equal(timers.size, 0);
assert.equal(manager.getDiagnostics().hasWorker, false);
console.log("PASS check-ai-worker-sessions");
