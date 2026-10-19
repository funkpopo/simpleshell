import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("ai-handlers", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const Module = require("node:module");
    const path = require("node:path");

    const ROOT = _path.resolve(_repoRoot, "");
    const HANDLER_PATH = path.join(ROOT, "src/main/ipc/handlers/aiHandlers.js");
    const CONFIG_SERVICE_PATH = path.join(
      ROOT,
      "src/main/settings/configService.js",
    );

    const clone = (value) => JSON.parse(JSON.stringify(value));

    function createHandler(initialSettings) {
      let settings = clone(initialSettings);
      const savedSettings = [];
      const appliedProxies = [];
      const configService = {
        loadAISettings: () => clone(settings),
        saveAISettings: (nextSettings) => {
          settings = clone(nextSettings);
          savedSettings.push(clone(nextSettings));
          return true;
        },
      };
      const cancellations = [];
      const workerManager = {
        getAIWorker: () => ({}),
        getCurrentSessionId: () => "unrelated-session-B",
        postMessage: (message) => cancellations.push(message),
        updateAIProxy: (proxy) => appliedProxies.push(clone(proxy)),
      };
      const logger = { logToFile: () => {} };
      const mainI18n = {
        t: (key) => key,
        getUiLanguage: () => "en-US",
      };
      const originalLoad = Module._load;
      const normalizeRequest = (request) => request.replaceAll("\\", "/");

      Module._load = function load(request, parent, isMain) {
        const normalizedRequest = normalizeRequest(request);
        if (normalizedRequest.endsWith("settings/configService")) {
          return configService;
        }
        if (normalizedRequest.endsWith("utils/logger")) {
          return logger;
        }
        if (normalizedRequest.endsWith("native/aiWorkerManager")) {
          return workerManager;
        }
        if (normalizedRequest.endsWith("shared/mainI18n")) {
          return mainI18n;
        }
        return originalLoad.call(this, request, parent, isMain);
      };

      delete require.cache[require.resolve(HANDLER_PATH)];
      try {
        const AIHandlers = require(HANDLER_PATH);
        return {
          handler: new AIHandlers(),
          getSettings: () => clone(settings),
          savedSettings,
          appliedProxies,
          cancellations,
        };
      } finally {
        Module._load = originalLoad;
        delete require.cache[require.resolve(HANDLER_PATH)];
      }
    }

    async function run() {
      const ConfigService = require(CONFIG_SERVICE_PATH);
      const configService = ConfigService;
      configService.crypto = {
        encryptText: (value) => `enc:${value}`,
        decryptText: (value) =>
          value.startsWith("enc:") ? value.slice("enc:".length) : null,
      };
      configService._isCredentialStoreLocked = () => false;
      configService._log = () => {};

      const encryptedSettings = configService._processAISettingsForSave({
        proxyConfig: {
          enabled: true,
          host: "proxy",
          port: 8080,
          password: "secret",
        },
      });
      assert.equal(encryptedSettings.proxyConfig.password, "enc:secret");
      assert.equal(
        configService._processAISettingsForLoad(encryptedSettings).proxyConfig
          .password,
        "secret",
      );
      assert.equal(
        configService._processAISettingsForLoad({
          proxyConfig: {
            enabled: true,
            host: "proxy",
            port: 8080,
            password: "legacy-secret",
          },
        }).proxyConfig.password,
        "",
        "plaintext proxy credentials must not be accepted",
      );

      const harness = createHandler({
        configs: [],
        current: null,
        proxyConfig: {
          enabled: true,
          type: "http",
          host: "127.0.0.1",
          port: 7890,
          username: "proxy-user",
          password: "stored-password",
        },
      });
      const { handler } = harness;

      const safeSettings = handler._toRendererSafeSettings(
        harness.getSettings(),
      );
      assert.equal(safeSettings.proxyConfig.password, "");
      assert.equal(safeSettings.proxyConfig.hasProxyPassword, true);

      await handler.saveSettings(null, {
        ...safeSettings,
        windowSize: { width: 600, height: 700 },
      });
      assert.equal(
        harness.getSettings().proxyConfig.password,
        "stored-password",
        "generic AI settings saves must preserve masked proxy passwords",
      );

      const directSave = await handler.saveProxyConfig(null, {
        enabled: true,
        type: "http",
        host: "127.0.0.1",
        port: 7891,
        username: "proxy-user",
        password: "",
        hasProxyPassword: true,
      });
      assert.equal(directSave, true);
      assert.equal(harness.getSettings().proxyConfig.port, 7891);
      assert.equal(
        harness.getSettings().proxyConfig.password,
        "stored-password",
      );
      assert.deepEqual(harness.appliedProxies.at(-1), {
        type: "http",
        host: "127.0.0.1",
        port: 7891,
        username: "proxy-user",
        password: "stored-password",
      });

      await handler.saveProxyConfig(null, {
        enabled: true,
        type: "https",
        host: "proxy.example.test",
        port: 8443,
        username: "proxy-user",
        password: " pass with spaces ",
      });
      assert.equal(
        harness.getSettings().proxyConfig.password,
        " pass with spaces ",
        "proxy passwords must not be trimmed",
      );
      assert.equal(harness.getSettings().proxyConfig.type, "https");

      const beforeInvalidSave = harness.getSettings();
      assert.equal(
        await handler.saveProxyConfig(null, {
          enabled: true,
          type: "http",
          host: "",
          port: 7890,
        }),
        false,
      );
      assert.deepEqual(
        harness.getSettings(),
        beforeInvalidSave,
        "invalid proxy configuration must not be persisted",
      );

      assert.equal(
        await handler.saveProxyConfig(null, {
          enabled: true,
          type: "http",
          host: "127.0.0.1",
          port: 65536,
        }),
        false,
      );
      assert.deepEqual(harness.getSettings(), beforeInvalidSave);

      assert.equal(
        await handler.saveProxyConfig(null, {
          enabled: false,
          type: "http",
          host: "",
          port: 0,
          password: "",
        }),
        true,
      );
      assert.equal(harness.getSettings().proxyConfig.enabled, false);
      assert.equal(harness.getSettings().proxyConfig.password, "");
      assert.equal(harness.appliedProxies.at(-1), null);

      assert.ok(harness.savedSettings.length >= 4);
      await handler.abortAPIRequest(null, "session-A");
      assert.equal(
        harness.cancellations.at(-1).sessionId,
        "session-A",
        "cancelling A must not cancel the most recent request B",
      );
      console.log("PASS check-ai-handlers");
    }

    await run();
  });
});

describe("ai-worker-sessions", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");

    const vm = require("node:vm");
    const { EventEmitter } = require("node:events");
    const {
      IPC_EVENT_CHANNELS,
    } = require("../../src/shared/contracts/ipc/channels");

    const filename = _path.resolve(
      _repoRoot,
      "src/main/native/aiWorkerManager.js",
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
                child.stdin = {
                  write: (line) => commands.push(JSON.parse(line)),
                };
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
    manager.postMessage({
      kind: "cancel",
      requestId: "cancel-B",
      sessionId: "B",
    });
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
  });
});
