import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("port-forwarding-client", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");

    const { spawn } = require("node:child_process");
    const {
      NativePortForwardingClient,
    } = require("../../src/main/native/nativePortForwardingClient");
    const { until } = require("../fixtures/port-forwarding-loopback");

    function client(mode) {
      return new NativePortForwardingClient({
        locate: () => process.execPath,
        startTimeout: 1000,
        requestTimeout: 100,
        spawn: (_binary, _args, options) =>
          spawn(
            process.execPath,
            [
              _path.join(
                _repoRoot,
                "tests/fixtures/port-forwarding-protocol.js",
              ),
              mode,
            ],
            options,
          ),
      });
    }
    async function main() {
      for (const [mode, code] of [
        ["old", "SIDECAR_VERSION"],
        ["exit", "SIDECAR_VERSION"],
        ["broken", "PROTOCOL_ERROR"],
      ]) {
        const native = client(mode);
        try {
          await assert.rejects(native.ensureReady(), { code });
        } finally {
          await native.stop();
        }
        assert.equal(native.pending.size, 0);
      }
      console.log(
        "PASS old host, unsupported command/early exit and malformed ready reject startup and reap the process",
      );
      for (const [mode, code] of [
        ["stale", "PROTOCOL_ERROR"],
        ["oversize", "PROTOCOL_ERROR"],
        ["hang", "CONNECT_TIMEOUT"],
      ]) {
        const native = client(mode);
        try {
          await assert.rejects(
            native.request("removeRule", "tab", 1, { ruleId: "rule" }),
            { code },
          );
        } finally {
          await native.stop();
        }
        assert.equal(native.pending.size, 0);
      }
      console.log(
        "PASS response generation validation, stdout bound and request timeout terminate the transport",
      );
      const native = client("good");
      try {
        const response = await native.request("addRules", "tab", 1, {
          rules: [
            {
              id: "rule",
              type: "local",
              listenHost: "localhost",
              listenPort: 0,
            },
          ],
        });
        assert.equal(response.bindings[0].port, 32123);
        await assert.rejects(
          native.request("authResponse", "tab", 1, {
            answers: ["x".repeat(256 * 1024)],
          }),
          { code: "INVALID_CONFIG" },
        );
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
          native.request("start", "tab", 1, {}, { signal: controller.signal }),
          { code: "CANCELLED" },
        );
        await until(
          () => native.pending.size === 0,
          "all request entries settled",
        );
      } finally {
        await native.stop();
      }
      console.log(
        "PASS fragmented NDJSON ready/results, oversized stdin rejection and cancellation before send",
      );
      const missing = new NativePortForwardingClient({ locate: () => null });
      await assert.rejects(missing.ensureReady(), { code: "SIDECAR_MISSING" });
      await missing.stop();
      console.log(
        "PASS missing native host fails explicitly without invoking Node forwarding",
      );
    }
    await main();
  });
});

describe("port-forwarding-ipc", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const { EventEmitter } = require("node:events");
    const service = require("../../src/main/services/port-forwarding-service");
    const PortForwardingHandlers = require("../../src/main/ipc/handlers/portForwardingHandlers");
    const { safeHandle } = require("../../src/main/ipc/ipcResponse");
    const channels = require("../../src/shared/contracts/ipc/channels");
    const {
      createConnectionsAPI,
    } = require("../../src/preload/api/connections");

    async function main() {
      let savedRules = [];
      let writeFails = false;
      service.configService = {
        loadPortForwards: () => savedRules,
        savePortForwards: (rules) => {
          if (writeFails) return false;
          savedRules = structuredClone(rules);
          return true;
        },
      };
      service.processManager = {
        events: new EventEmitter(),
        getAllProcesses: () => [],
      };
      service.getPool = () => null;
      const registered = new Map();
      const ipcMain = {
        handle: (channel, handler) => registered.set(channel, handler),
      };
      const event = { sender: { id: 1 } };
      const ipcRenderer = new EventEmitter();
      ipcRenderer.invoke = (channel, ...args) =>
        registered.get(channel)(event, ...args);
      const api = createConnectionsAPI({ ipcRenderer, ...channels });
      const handlers = new PortForwardingHandlers();
      for (const { channel, category, handler } of handlers.getHandlers())
        safeHandle(ipcMain, channel, handler, { category });
      const notify = (payload) =>
        ipcRenderer.emit(
          channels.IPC_EVENT_CHANNELS.PF_STATUS_UPDATED,
          event,
          payload,
        );
      service.on("statusUpdated", notify);
      let published;
      const unsubscribe = api.onPortForwardStatusUpdated((value) => {
        published = value;
      });
      try {
        const rule = {
          name: "IPC saved rule",
          type: "local",
          listenHost: "localhost",
          listenPort: 49123,
          remoteHost: "localhost",
          remotePort: 8080,
        };
        const saved = await api.savePortForwardRule(rule);
        assert.ok(saved.id, JSON.stringify(saved));
        assert.equal(saved.name, rule.name);
        assert.equal((await api.getPortForwardRules()).rules[0].id, saved.id);
        assert.equal(published.rules[0].id, saved.id);
        assert.deepEqual(await api.getPortForwardActiveSessions(), []);
        const updated = await api.savePortForwardRule({
          ...saved,
          name: "Edited rule",
        });
        assert.equal(updated.id, saved.id);
        assert.equal((await api.getPortForwardRules()).rules.length, 1);
        assert.equal(
          (await api.getPortForwardRules()).rules[0].name,
          "Edited rule",
        );
        console.log(
          "PASS actual preload → safeHandle → service save/edit/list and status publication preserve payloads",
        );

        const invalid = await api.savePortForwardRule({
          ...rule,
          listenPort: 0,
        });
        assert.equal(invalid.success, false);
        assert.ok(invalid.error);
        writeFails = true;
        const failed = await api.savePortForwardRule({
          ...rule,
          listenPort: 49124,
        });
        assert.equal(failed.success, false);
        assert.equal((await api.getPortForwardRules()).rules.length, 1);
        assert.equal(
          (await api.deletePortForwardRule(saved.id)).success,
          false,
        );
        assert.equal((await api.getPortForwardRules()).rules.length, 1);
        writeFails = false;
        console.log(
          "PASS invalid rules and persistence failures remain errors without publishing phantom rules",
        );

        service.startRule = async (id, tabId) => ({ ruleId: id, tabId });
        service.stopRule = async (id) => ({ ruleId: id });
        assert.deepEqual(await api.startPortForwardRule(saved.id, "tab:one"), {
          ruleId: saved.id,
          tabId: "tab:one",
        });
        assert.deepEqual(await api.stopPortForwardRule(saved.id), {
          ruleId: saved.id,
        });
        assert.equal(await api.deletePortForwardRule(saved.id), true);
        assert.deepEqual((await api.getPortForwardRules()).rules, []);
        console.log(
          "PASS start/stop/delete IPC arguments do not consume the Electron event as data",
        );
      } finally {
        unsubscribe();
        service.removeListener("statusUpdated", notify);
        await handlers.cleanup();
      }
    }
    await main();
  });
});
