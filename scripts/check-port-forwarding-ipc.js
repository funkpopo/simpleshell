const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const service = require("../src/main/services/port-forwarding-service");
const PortForwardingHandlers = require("../src/main/ipc/handlers/portForwardingHandlers");
const { safeHandle } = require("../src/main/ipc/ipcResponse");
const channels = require("../src/shared/contracts/ipc/channels");
const { createConnectionsAPI } = require("../src/preload/api/connections");

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

    const invalid = await api.savePortForwardRule({ ...rule, listenPort: 0 });
    assert.equal(invalid.success, false);
    assert.ok(invalid.error);
    writeFails = true;
    const failed = await api.savePortForwardRule({
      ...rule,
      listenPort: 49124,
    });
    assert.equal(failed.success, false);
    assert.equal((await api.getPortForwardRules()).rules.length, 1);
    assert.equal((await api.deletePortForwardRule(saved.id)).success, false);
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
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
