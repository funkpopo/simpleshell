const assert = require("node:assert/strict");
const path = require("node:path");
const net = require("node:net");
const crypto = require("node:crypto");
const { EventEmitter, once } = require("node:events");
const { AgentProtocol } = require("ssh2/lib/agent");
const { utils } = require("ssh2");
const {
  PortForwardingService,
} = require("../src/main/services/port-forwarding-service");
const processManager = require("../src/main/process/processManager");
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
  delay,
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
const makeRule = (id, type, targetPort, listenPort = 0) => ({
  id,
  name: id,
  type,
  listenHost: HOST,
  listenPort,
  remoteHost: HOST,
  remotePort: targetPort,
  autoStart: false,
});
const pass = (name) => console.log(`PASS ${name}`);
async function echo(port, value = "native data") {
  const peer = await Peer.connect(port);
  try {
    peer.socket.write(value);
    assert.equal((await peer.read(value.length)).toString(), value);
  } finally {
    peer.close();
  }
}
async function rebind(port) {
  const server = net.createServer();
  await listen(server, port);
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  const fixture = await createFixture();
  const native = new NativePortForwardingClient({ locate: () => binary });
  const pool = new EventEmitter();
  pool.proxyManager = new EventEmitter();
  let proxy = null;
  pool.proxyManager.resolveProxyConfigAsync = async () => proxy;
  let rules = [];
  const configService = {
    loadPortForwards: () => rules,
    savePortForwards: (value) => {
      rules = value;
    },
  };
  const service = new PortForwardingService({
    processManager,
    configService,
    nativeClient: native,
    getPool: () => pool,
  });
  const tab = (id, overrides = {}, processId = id) => {
    const client = new EventEmitter();
    client._sock = { readable: true, writable: true };
    client.forwardOut = client.forwardIn = () => {
      throw new Error("Node forwarding must not be used");
    };
    const config = { ...fixture.ssh, tabId: id, ...overrides };
    delete config.expectedHostFingerprint;
    setTrustedHostFingerprint(
      config,
      fixture.ssh.expectedHostFingerprint,
      "session",
    );
    const proc = { type: "ssh2", process: client, config };
    processManager.setProcess(processId, proc);
    return proc;
  };
  const watchdog = setTimeout(() => {
    native.child?.kill();
    throw new Error("forwarding service check timeout");
  }, 60000);
  try {
    const target = await fixture.tcp((socket) => socket.pipe(socket));
    const targetPort = target.address().port;
    rules = [
      makeRule("L", "local", targetPort),
      makeRule("R", "remote", targetPort),
      makeRule("D", "dynamic"),
    ];
    const proc = tab("tab:a", {}, 41);
    processManager.setProcess("tab:a", { ...proc });
    const available = service.getActiveSessions();
    assert.equal(available.length, 1);
    assert.equal(available[0].tabId, "tab:a");
    assert.equal(available[0].host, fixture.ssh.host);
    await service.startRule("L", available[0].tabId);
    const localPort = service.getStatus().L.boundPort;
    const live = await Peer.connect(localPort);
    live.socket.write("before");
    assert.equal((await live.read(6)).toString(), "before");
    await service.startRule("R", "41");
    assert.equal(service.getStatus().R.tabId, "tab:a");
    assert.equal(service.sessions.size, 1);
    const remotePort = service.getStatus().R.boundPort;
    await echo(remotePort);
    assert.equal(fixture.clients.size, 1);
    await until(
      () => service.getStatus().L.activeConnections === 1,
      "live statistics",
    );
    await service.stopRule("R");
    await rebind(remotePort);
    live.socket.write("after");
    assert.equal((await live.read(5)).toString(), "after");
    await service.startRule("D", "tab:a");
    pass(
      "product service uses native forwarding, shares SSH within a tab, updates statistics and preserves unrelated streams on add/remove",
    );
    pass(
      "numeric process aliases are deduplicated and legacy callers share the canonical tab's SSH connection",
    );

    const occupied = await fixture.tcp((socket) => socket.destroy());
    rules.push(makeRule("bad", "local", targetPort, occupied.address().port));
    await assert.rejects(service.startRule("bad", "tab:a"), {
      code: "LOCAL_BIND_FAILED",
    });
    assert.equal(service.getStatus().bad.status, "error");
    await echo(localPort);
    await service.deleteRule("bad");
    pass(
      "one rule's listener conflict does not interrupt established rules and has a localized runtime error",
    );

    // A manual start must restore the retry budget after earlier failures.
    service.sessions.get("tab:a").attempts = 3;
    await service.startRule("R", "tab:a");
    await service.stopRule("R");
    const beforeCrash = service.sessions.get("tab:a").generation;
    native.child.kill();
    await until(
      () =>
        service.sessions.get("tab:a")?.generation > beforeCrash &&
        service.getStatus().L?.status === "running",
      "sidecar restart and rule replay",
      10000,
    );
    const restoredPort = service.getStatus().L.boundPort;
    await echo(restoredPort);
    await until(() => live.closed || live.ended, "old stream closed by crash");
    live.close();
    pass(
      "native process crash rejects old requests and restores desired rules with a fresh SSH generation",
    );

    const oldGeneration = service.sessions.get("tab:a").generation;
    proc.process._sock.readable = false;
    proc.process.emit("close");
    await until(
      () => fixture.clients.size === 0,
      "terminal disconnect closes independent SSH",
    );
    tab("tab:a");
    assert.equal(service.getActiveSessions()[0].tabId, "tab:a");
    assert.equal(service._proc("41").proc, processManager.getProcess("tab:a"));
    pool.emit("connectionReconnected", { key: "tab:tab:a" });
    await until(
      () =>
        service.sessions.get("tab:a")?.generation > oldGeneration &&
        service.getStatus().L?.status === "running",
      "terminal reconnection resumes forwards",
    );
    pass(
      "terminal reconnect replaces ownership without parsing away colons in tab IDs",
    );

    const ports = Object.values(service.getStatus())
      .filter((s) => s.status === "running")
      .map((s) => s.boundPort);
    processManager.deleteProcess("tab:a");
    await until(
      () => fixture.clients.size === 0,
      "process deletion releases native SSH",
    );
    assert.deepEqual(service.getStatus(), {});
    for (const port of ports) await rebind(port);
    assert.equal(service.sessions.size, 0);
    assert.deepEqual(service.getActiveSessions(), []);
    processManager.deleteProcess(41);
    pass(
      "actual process-manager deletion cleans tab listeners and retry state even if the pooled terminal client survives",
    );

    tab("tab:numeric", {}, 42);
    assert.equal(service.getActiveSessions()[0].tabId, "tab:numeric");
    await service.startRule("L", "tab:numeric");
    const numericPort = service.getStatus().L.boundPort;
    await echo(numericPort);
    await service.closeTab("42");
    assert.deepEqual(service.getStatus(), {});
    await rebind(numericPort);
    processManager.deleteProcess(42);

    const numericOnly = tab(43, { tabId: undefined });
    assert.equal(service.getActiveSessions()[0].tabId, "43");
    await service.startRule("L", "43");
    assert.equal(service.getStatus().L.tabId, "43");
    await echo(service.getStatus().L.boundPort);
    numericOnly.process._sock.readable = false;
    assert.deepEqual(service.getActiveSessions(), []);
    await assert.rejects(service.startRule("R", "43"), {
      code: "SESSION_UNAVAILABLE",
    });
    processManager.deleteProcess(43);
    await until(() => fixture.clients.size === 0, "numeric process cleanup");
    assert.deepEqual(service.getStatus(), {});
    assert.equal(service.sessions.size, 0);
    pass(
      "numeric-only registrations resolve from the UI, preserve readiness checks and clean up through either tab or process IDs",
    );

    fixture.state.hangAuth = true;
    tab("pending");
    const starting = service.startRule("L", "pending").then(
      () => null,
      (e) => e,
    );
    await until(() => fixture.clients.size === 1, "authentication started");
    await service.closeTab("pending");
    assert.equal((await starting).code, "CANCELLED");
    fixture.state.hangAuth = false;
    await until(() => fixture.clients.size === 0, "pending start cleanup");
    pass(
      "close tab during startup cancels authentication and cannot resurrect a forwarding listener",
    );

    let authSignal;
    let promptsSeen = 0;
    fixture.state.authenticate = (ctx) => {
      if (ctx.method !== "keyboard-interactive")
        return ctx.reject(["keyboard-interactive"]);
      ctx.prompt(
        [{ prompt: "Verification code: ", echo: false }],
        (answers) => {
          if (answers[0] === "fixture-otp") ctx.accept();
          else ctx.reject();
        },
      );
    };
    tab("otp", {
      password: undefined,
      keyboardInteractiveResponder: async ({ prompts, signal }) => {
        promptsSeen++;
        assert.equal(prompts[0].prompt, "Verification code: ");
        authSignal = signal;
        return { answers: ["fixture-otp"] };
      },
    });
    await service.startRule("L", "otp");
    assert.equal(promptsSeen, 1);
    await echo(service.getStatus().L.boundPort);
    await service.closeTab("otp");
    assert.equal(authSignal.aborted, true);
    tab("otp-cancel", {
      password: undefined,
      keyboardInteractiveResponder: async () => {
        throw new Error("cancelled by user");
      },
    });
    await assert.rejects(service.startRule("L", "otp-cancel"), {
      code: "CANCELLED",
    });
    await service.closeTab("otp-cancel");
    let passwordAccepted = false;
    fixture.state.authenticate = (ctx) => {
      if (ctx.method === "password" && ctx.password === fixture.ssh.password) {
        passwordAccepted = true;
        return ctx.reject(["keyboard-interactive"], true);
      }
      if (ctx.method === "keyboard-interactive" && passwordAccepted) {
        return ctx.prompt([{ prompt: "OTP", echo: false }], (answers) => {
          if (answers[0] === "second-factor") ctx.accept();
          else ctx.reject();
        });
      }
      ctx.reject(["password", "keyboard-interactive"]);
    };
    tab("mfa", {
      keyboardInteractiveResponder: async () => ({
        answers: ["second-factor"],
      }),
    });
    await service.startRule("L", "mfa");
    assert.equal(passwordAccepted, true);
    await service.closeTab("mfa");
    fixture.state.authenticate = null;
    pass(
      "keyboard-interactive prompts use the existing responder, and user cancellation aborts the native session",
    );

    await checkAgent(service, fixture, tab);
    pass(
      "SSH agent authentication signs through a real local agent socket/Windows named pipe",
    );

    const passphrase = "fixture-encrypted-key";
    const encryptedKey = crypto.createPrivateKey(fixture.privateKey).export({
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase,
    });
    tab("encrypted-key", {
      password: null,
      privateKey: encryptedKey,
      passphrase,
    });
    await service.startRule("L", "encrypted-key");
    await echo(service.getStatus().L.boundPort);
    await service.closeTab("encrypted-key");
    pass(
      "encrypted private keys and password plus OTP multi-factor authentication",
    );

    await checkLegacyAlgorithms();
    pass(
      "legacy group14-sha1 / AES-CBC / SSH-RSA negotiation remains available after modern algorithms",
    );

    tab("untrusted");
    const untrusted = processManager.getProcess("untrusted");
    untrusted.config = {
      ...untrusted.config,
      expectedHostFingerprint: fixture.ssh.expectedHostFingerprint,
    };
    await assert.rejects(service.startRule("L", "untrusted"), {
      code: "HOST_KEY_NOT_TRUSTED",
    });
    await service.closeTab("untrusted");
    pass(
      "serialized fingerprint fields cannot bypass the terminal's approved host trust",
    );

    tab("network", { proxy: { useDefault: true } });
    await service.startRule("L", "network");
    const networkSession = service.sessions.get("network");
    proxy = { type: "invalid", host: HOST, port: 1 };
    pool.proxyManager.emit("changed");
    await until(
      () => service.getStatus().L?.status === "error" && !networkSession.ready,
      "invalid proxy disables current native transport",
    );
    await until(
      () => fixture.clients.size === 0,
      "invalid proxy has no direct fallback",
    );
    proxy = null;
    pool.proxyManager.emit("changed");
    await until(
      () => service.getStatus().L?.status === "running" && networkSession.ready,
      "fixed default proxy restores desired rules",
    );
    await echo(service.getStatus().L.boundPort);
    await service.closeTab("network");
    pass(
      "default proxy DIRECT is accepted; invalid proxy closes the transport and fixing it restores desired rules",
    );

    rules = [{ ...makeRule("auto", "local", targetPort), autoStart: true }];
    tab("auto-tab");
    await until(
      () => service.getStatus().auto?.status === "running",
      "auto-start on process registration",
    );
    await service.stopRule("auto");
    pool.emit("connectionReconnected", { key: "tab:auto-tab" });
    await delay(400);
    assert.equal(service.getStatus().auto, undefined);
    await service.startRule("auto", "auto-tab");
    const autoPort = service.getStatus().auto.boundPort;
    await service.stopAll();
    await rebind(autoPort);
    assert.equal(native.child, null);
    assert.equal(native.pending.size, 0);
    assert.equal(service.sessions.size, 0);
    pass(
      "auto-start, explicit stop suppression, and awaited application cleanup leave no child process or pending request",
    );
  } finally {
    clearTimeout(watchdog);
    await service.stopAll();
    processManager.clearAllProcesses();
    await fixture.close();
  }
}

async function checkAgent(service, fixture, tab) {
  const agentPath =
    process.platform === "win32"
      ? `\\\\.\\pipe\\simpleshell-forward-test-${process.pid}`
      : path.join(
          require("node:os").tmpdir(),
          `simpleshell-forward-test-${process.pid}.sock`,
        );
  const key = utils.parseKey(fixture.privateKey);
  const connections = new Set();
  let signatures = 0;
  const agent = net.createServer((socket) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    const protocol = new AgentProtocol(false);
    socket.pipe(protocol).pipe(socket);
    protocol.on("error", () => socket.destroy());
    socket.on("error", () => protocol.destroy());
    protocol.on("identities", (request) =>
      protocol.getIdentitiesReply(request, [key]),
    );
    protocol.on("sign", (request, _pub, data, flags) => {
      signatures++;
      protocol.signReply(request, key.sign(data, flags.hash));
    });
  });
  agent.listen(agentPath);
  await once(agent, "listening");
  try {
    tab("agent", { password: undefined, authType: "agent", agentPath });
    await service.startRule("L", "agent");
    await echo(service.getStatus().L.boundPort);
    assert.ok(signatures > 0);
    await service.closeTab("agent");
  } finally {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve) => agent.close(resolve));
  }
}

async function checkLegacyAlgorithms() {
  const fixture = await createFixture({
    algorithms: {
      kex: ["diffie-hellman-group14-sha1"],
      cipher: ["aes128-cbc"],
      hmac: ["hmac-sha1"],
      serverHostKey: ["ssh-rsa"],
    },
  });
  const native = new NativePortForwardingClient({ locate: () => binary });
  try {
    const target = await fixture.tcp((socket) => socket.pipe(socket));
    const result = await native.start("legacy", 1, fixture.ssh, [
      {
        id: "L",
        type: "local",
        listenHost: HOST,
        listenPort: 0,
        targetHost: HOST,
        targetPort: target.address().port,
      },
    ]);
    await echo(result.bindings[0].port);
  } finally {
    await native.stop();
    await fixture.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
