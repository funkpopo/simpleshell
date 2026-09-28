const assert = require("node:assert/strict");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { performance } = require("node:perf_hooks");
const net = require("node:net");
const {
  PortForwardingService,
} = require("../src/main/services/port-forwarding-service");
const {
  NativePortForwardingClient,
} = require("../src/main/native/nativePortForwardingClient");
const {
  setTrustedHostFingerprint,
} = require("../src/main/utils/sshHostKeyTrust");
const {
  HOST,
  Peer,
  createFixture,
  until,
  listen,
} = require("./fixtures/port-forwarding-loopback");

const binary =
  process.env.SIMPLESHELL_NATIVE_SERVICES_PATH ||
  path.resolve(
    __dirname,
    "../native-services/desktop-host/target/debug",
    process.platform === "win32"
      ? "simpleshell-native-services.exe"
      : "simpleshell-native-services",
  );

async function rebind(port) {
  const listener = net.createServer();
  await listen(listener, port);
  await new Promise((resolve) => listener.close(resolve));
}

async function main() {
  const fixture = await createFixture();
  const native = new NativePortForwardingClient({ locate: () => binary });
  const client = new EventEmitter();
  client._sock = { readable: true, writable: true };
  const config = { ...fixture.ssh, tabId: "delete-tab" };
  delete config.expectedHostFingerprint;
  setTrustedHostFingerprint(
    config,
    fixture.ssh.expectedHostFingerprint,
    "session",
  );
  const proc = { type: "ssh2", process: client, config };
  const processes = new Map([[config.tabId, proc]]);
  let rules = [];
  let writeFails = false;
  const service = new PortForwardingService({
    processManager: {
      getProcess: (id) => processes.get(id),
      getAllProcesses: () => processes.entries(),
    },
    configService: {
      loadPortForwards: () => rules,
      savePortForwards: (next) => {
        if (writeFails) return false;
        rules = next;
        return true;
      },
    },
    nativeClient: native,
    getPool: () => null,
  });
  const watchdog = setTimeout(() => {
    native.child?.kill();
    throw new Error("delete forwarding check timeout");
  }, 20000);
  const peers = [];
  const timings = [];
  const deleteWithTiming = async (id, expectNetworkWait = false) => {
    const started = performance.now();
    let publishedMs;
    const published = (payload) => {
      if (
        publishedMs === undefined &&
        !payload.rules.some((rule) => rule.id === id)
      )
        publishedMs = performance.now() - started;
    };
    service.on("statusUpdated", published);
    try {
      const deleting = service.deleteRule(id);
      // The list should reflect the committed deletion before network cleanup
      // resolves, even with a slow SSH server. The API still awaits cleanup.
      const publishedBeforeCleanup = publishedMs !== undefined;
      await deleting;
      const cleanupMs = performance.now() - started;
      timings.push({ id, publishedMs, cleanupMs });
      console.log(
        `DELETE ${id}: list ${publishedMs?.toFixed(1)} ms, cleanup ${cleanupMs.toFixed(1)} ms`,
      );
      assert.equal(
        publishedBeforeCleanup,
        true,
        "list update waited for SSH cleanup",
      );
      if (expectNetworkWait) {
        assert.ok(
          cleanupMs >= 200,
          "fixture did not exercise delayed SSH cleanup",
        );
        assert.ok(publishedMs < cleanupMs / 2, "list still waits for the peer");
      }
      assert.equal(
        service.loadRules().some((rule) => rule.id === id),
        false,
      );
      assert.equal(service.getStatus()[id], undefined);
    } finally {
      service.removeListener("statusUpdated", published);
    }
  };
  try {
    const target = await fixture.tcp((socket) => socket.pipe(socket));
    const makeRule = (id, type) => ({
      id,
      type,
      listenHost: HOST,
      listenPort: 0,
      remoteHost: HOST,
      remotePort: target.address().port,
      autoStart: false,
    });
    rules = [makeRule("keep", "local"), makeRule("slow-remote", "remote")];
    await service.startRule("keep", config.tabId);
    await service.startRule("slow-remote", config.tabId);
    const kept = await Peer.connect(service.getStatus().keep.boundPort);
    peers.push(kept);
    kept.socket.write("before");
    assert.equal((await kept.read(6)).toString(), "before");
    const remotePort = service.getStatus()["slow-remote"].boundPort;
    const remote = await Peer.connect(remotePort);
    peers.push(remote);
    remote.socket.write("live");
    assert.equal((await remote.read(4)).toString(), "live");
    fixture.state.cancelReplyDelay = 300;

    await deleteWithTiming("slow-remote", true);
    await rebind(remotePort);
    await until(
      () => remote.ended || remote.closed,
      "deleted remote stream closed",
    );
    kept.socket.write("after");
    assert.equal((await kept.read(5)).toString(), "after");
    assert.equal(service.getStatus().keep.status, "running");
    assert.equal(fixture.clients.size, 1);
    console.log(
      "PASS delayed remote deletion frees its port without disturbing another rule's stream",
    );

    writeFails = true;
    await assert.rejects(service.deleteRule("keep"));
    assert.equal(service.getStatus().keep?.status, "running");
    assert.equal(
      service.loadRules().some((rule) => rule.id === "keep"),
      true,
    );
    kept.socket.write("still-running");
    assert.equal((await kept.read(13)).toString(), "still-running");
    writeFails = false;
    console.log(
      "PASS persistence failure keeps the running rule and its connection",
    );

    const keepPort = service.getStatus().keep.boundPort;
    await deleteWithTiming("keep");
    await rebind(keepPort);
    await until(() => fixture.clients.size === 0, "last local rule closes SSH");
    assert.equal(service.sessions.size, 0);

    rules = [makeRule("last-remote", "remote")];
    await service.startRule("last-remote", config.tabId);
    const lastPort = service.getStatus()["last-remote"].boundPort;
    await deleteWithTiming("last-remote", true);
    await rebind(lastPort);
    await until(
      () => fixture.clients.size === 0,
      "last remote rule closes SSH",
    );
    assert.equal(service.sessions.size, 0);
    assert.equal(native.pending.size, 0);
    console.log(
      "PASS deleting the last running rule updates the list before SSH disconnect and still awaits resource cleanup",
    );

    console.log(JSON.stringify({ deletionTimings: timings }));
  } finally {
    clearTimeout(watchdog);
    for (const peer of peers) peer.close();
    await service.stopAll();
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
