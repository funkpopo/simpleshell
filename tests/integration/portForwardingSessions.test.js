import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("port-forwarding-service", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const path = require("node:path");
    const net = require("node:net");
    const crypto = require("node:crypto");
    const { EventEmitter, once } = require("node:events");
    const { AgentProtocol } = require("ssh2/lib/agent");
    const { utils } = require("ssh2");
    const {
      PortForwardingService,
    } = require("../../src/main/services/port-forwarding-service");
    const processManager = require("../../src/main/process/processManager");
    const {
      NativePortForwardingClient,
    } = require("../../src/main/native/nativePortForwardingClient");
    const {
      setTrustedHostFingerprint,
    } = require("../../src/main/utils/sshHostKeyTrust");
    const {
      HOST,
      Peer,
      createFixture,
      until,
      delay,
      listen,
    } = require("../fixtures/port-forwarding-loopback");

    const binary =
      process.env.SIMPLESHELL_NATIVE_SERVICES_PATH ||
      _path.resolve(
        _repoRoot,
        "native-services/desktop-host/target/debug",
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
        rules.push(
          makeRule("bad", "local", targetPort, occupied.address().port),
        );
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
        await until(
          () => live.closed || live.ended,
          "old stream closed by crash",
        );
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
        assert.equal(
          service._proc("41").proc,
          processManager.getProcess("tab:a"),
        );
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
        await until(
          () => fixture.clients.size === 0,
          "numeric process cleanup",
        );
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
          if (
            ctx.method === "password" &&
            ctx.password === fixture.ssh.password
          ) {
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
        const encryptedKey = crypto
          .createPrivateKey(fixture.privateKey)
          .export({
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
          () =>
            service.getStatus().L?.status === "error" && !networkSession.ready,
          "invalid proxy disables current native transport",
        );
        await until(
          () => fixture.clients.size === 0,
          "invalid proxy has no direct fallback",
        );
        proxy = null;
        pool.proxyManager.emit("changed");
        await until(
          () =>
            service.getStatus().L?.status === "running" && networkSession.ready,
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

    await main();
  });
});

describe("port-forwarding-delete", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");

    const { EventEmitter } = require("node:events");
    const { performance } = require("node:perf_hooks");
    const net = require("node:net");
    const {
      PortForwardingService,
    } = require("../../src/main/services/port-forwarding-service");
    const {
      NativePortForwardingClient,
    } = require("../../src/main/native/nativePortForwardingClient");
    const {
      setTrustedHostFingerprint,
    } = require("../../src/main/utils/sshHostKeyTrust");
    const {
      HOST,
      Peer,
      createFixture,
      until,
      listen,
    } = require("../fixtures/port-forwarding-loopback");

    const binary =
      process.env.SIMPLESHELL_NATIVE_SERVICES_PATH ||
      _path.resolve(
        _repoRoot,
        "native-services/desktop-host/target/debug",
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
            assert.ok(
              publishedMs < cleanupMs / 2,
              "list still waits for the peer",
            );
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
        await until(
          () => fixture.clients.size === 0,
          "last local rule closes SSH",
        );
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

    await main();
  });
});

describe("port-forwarding-algorithms", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const crypto = require("node:crypto");

    const { Ber } = require("asn1");
    const { utils } = require("ssh2");
    const {
      NativePortForwardingClient,
    } = require("../../src/main/native/nativePortForwardingClient");
    const {
      HOST,
      Peer,
      createFixture,
      until,
    } = require("../fixtures/port-forwarding-loopback");

    const binary =
      process.env.SIMPLESHELL_NATIVE_SERVICES_PATH ||
      _path.resolve(
        _repoRoot,
        "native-services/desktop-host/target/debug",
        process.platform === "win32"
          ? "simpleshell-native-services.exe"
          : "simpleshell-native-services",
      );

    // Node exports DSA as PKCS8; ssh2 expects the traditional six-integer PEM.
    // Both keys are generated for this test, with no persistent private-key fixture.
    function dsaKey() {
      const keys = crypto.generateKeyPairSync("dsa", {
        modulusLength: 1024,
        divisorLength: 160,
      });
      const secret = new Ber.Reader(
        keys.privateKey.export({ type: "pkcs8", format: "der" }),
      );
      secret.readSequence();
      secret.readInt();
      secret.readSequence();
      secret.readOID();
      secret.readSequence();
      const params = Array.from({ length: 3 }, () =>
        secret.readString(Ber.Integer, true),
      );
      const x = new Ber.Reader(
        secret.readString(Ber.OctetString, true),
      ).readString(Ber.Integer, true);
      const pub = new Ber.Reader(
        keys.publicKey.export({ type: "spki", format: "der" }),
      );
      pub.readSequence();
      pub.readSequence();
      pub.readOID();
      pub.readSequence();
      for (let n = 0; n < 3; n++) pub.readString(Ber.Integer, true);
      const y = new Ber.Reader(
        pub.readString(Ber.BitString, true).subarray(1),
      ).readString(Ber.Integer, true);
      const writer = new Ber.Writer();
      writer.startSequence();
      writer.writeInt(0);
      for (const value of [...params, y, x])
        writer.writeBuffer(value, Ber.Integer);
      writer.endSequence();
      const pem = `-----BEGIN DSA PRIVATE KEY-----\n${writer.buffer
        .toString("base64")
        .match(/.{1,64}/g)
        .join("\n")}\n-----END DSA PRIVATE KEY-----\n`;
      assert.equal(utils.parseKey(pem).type, "ssh-dss");
      const string = (value) => {
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(bytes.length);
        return Buffer.concat([length, bytes]);
      };
      // Wrap these integers in the OpenSSH private-key format supported by both libraries.
      const check = crypto.randomBytes(4);
      let body = Buffer.concat([
        check,
        check,
        string("ssh-dss"),
        ...[...params, y, x].map(string),
        string(""),
      ]);
      const pad = (8 - (body.length % 8)) % 8;
      body = Buffer.concat([
        body,
        Buffer.from(Array.from({ length: pad }, (_, n) => n + 1)),
      ]);
      const blob = Buffer.concat([
        Buffer.from("openssh-key-v1\0"),
        string("none"),
        string("none"),
        string(""),
        Buffer.from([0, 0, 0, 1]),
        string(utils.parseKey(pem).getPublicSSH()),
        string(body),
      ]);
      return `-----BEGIN OPENSSH PRIVATE KEY-----\n${blob
        .toString("base64")
        .match(/.{1,70}/g)
        .join("\n")}\n-----END OPENSSH PRIVATE KEY-----\n`;
    }

    async function main() {
      const native = new NativePortForwardingClient({ locate: () => binary });
      const rsa = utils.generateKeyPairSync("rsa", { bits: 2048 }).private;
      const base = {
        kex: ["curve25519-sha256"],
        cipher: ["aes128-ctr"],
        hmac: ["hmac-sha2-256"],
        serverHostKey: ["rsa-sha2-256"],
        compress: ["none"],
      };
      let count = 0;
      async function check(
        label,
        algorithms,
        privateKey = rsa,
        rekey = false,
        publicKeyAuth = false,
      ) {
        const fixture = await createFixture({
          privateKey,
          algorithms: { ...base, ...algorithms },
        });
        const id = `alg-${++count}`;
        try {
          const target = await fixture.tcp((socket) => socket.pipe(socket));
          const ssh = publicKeyAuth
            ? { ...fixture.ssh, password: undefined, privateKey }
            : fixture.ssh;
          const result = await native.start(id, 1, ssh, [
            {
              id: "L",
              type: "local",
              listenHost: HOST,
              listenPort: 0,
              targetHost: HOST,
              targetPort: target.address().port,
            },
          ]);
          const negotiated = fixture.state.handshakes[0];
          for (const [field, names] of Object.entries({
            ...base,
            ...algorithms,
          })) {
            if (field === "kex")
              assert.ok(names.includes(negotiated.kex), label);
            else if (field === "serverHostKey")
              assert.ok(names.includes(negotiated.serverHostKey), label);
            else
              for (const direction of ["cs", "sc"]) {
                const key = field === "hmac" ? "mac" : field;
                if (key === "mac" && !negotiated[direction].mac) continue; // AEAD owns integrity.
                assert.ok(
                  names.includes(negotiated[direction][key]),
                  `${label}: ${direction} ${key}`,
                );
              }
          }
          const peer = await Peer.connect(result.bindings[0].port);
          try {
            const payload = crypto.randomBytes(48 * 1024 + 17);
            peer.socket.write(payload);
            assert.deepEqual(await peer.read(payload.length), payload);
            if (rekey) {
              [...fixture.clients][0].rekey();
              await until(
                () => fixture.state.handshakes.length === 2,
                `${label} rekey`,
                10000,
              );
              peer.socket.write(payload);
              assert.deepEqual(await peer.read(payload.length), payload);
            }
          } finally {
            peer.close();
          }
          console.log(
            `PASS ${label}${rekey ? " + rekey" : ""}${publicKeyAuth ? " + public-key login" : ""}`,
          );
          return negotiated;
        } finally {
          await native.closeSession(id, 1);
          await fixture.close();
        }
      }
      try {
        for (const mac of [
          "hmac-sha2-256",
          "hmac-sha2-512",
          "hmac-sha1",
          "hmac-sha2-256-etm@openssh.com",
          "hmac-sha2-512-etm@openssh.com",
          "hmac-sha1-etm@openssh.com",
          "hmac-sha1-96",
          "hmac-md5",
          "hmac-md5-96",
          "hmac-sha2-256-96",
          "hmac-sha2-512-96",
        ])
          await check(mac, { hmac: [mac] }, rsa, mac.endsWith("-96"));
        for (const cipher of [
          "aes128-ctr",
          "aes192-ctr",
          "aes256-ctr",
          "aes128-cbc",
          "aes192-cbc",
          "aes256-cbc",
          "3des-cbc",
          "aes128-gcm",
          "aes256-gcm",
          "aes128-gcm@openssh.com",
          "aes256-gcm@openssh.com",
          "chacha20-poly1305@openssh.com",
        ])
          await check(cipher, { cipher: [cipher] });
        // ssh2 implements GEX only as a client. The OpenSSH runner covers GEX servers.
        for (const kex of [
          "curve25519-sha256@libssh.org",
          "ecdh-sha2-nistp256",
          "ecdh-sha2-nistp384",
          "ecdh-sha2-nistp521",
          "diffie-hellman-group1-sha1",
          "diffie-hellman-group14-sha1",
          "diffie-hellman-group14-sha256",
          "diffie-hellman-group15-sha512",
          "diffie-hellman-group16-sha512",
          "diffie-hellman-group17-sha512",
          "diffie-hellman-group18-sha512",
        ])
          await check(kex, { kex: [kex] });
        for (const hostKey of ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"])
          await check(hostKey, { serverHostKey: [hostKey] }, rsa, false, true);
        await check(
          "ssh-ed25519",
          { serverHostKey: ["ssh-ed25519"] },
          utils.generateKeyPairSync("ed25519").private,
          false,
          true,
        );
        for (const bits of [256, 384, 521]) {
          const name = `ecdsa-sha2-nistp${bits}`;
          await check(
            name,
            { serverHostKey: [name] },
            utils.generateKeyPairSync("ecdsa", { bits }).private,
            false,
            true,
          );
        }
        await check(
          "ssh-dss / group1 / 3DES / MD5",
          {
            serverHostKey: ["ssh-dss"],
            kex: ["diffie-hellman-group1-sha1"],
            cipher: ["3des-cbc"],
            hmac: ["hmac-md5"],
          },
          dsaKey(),
          true,
          true,
        );
        const preferred = await check(
          "modern algorithms win over legacy-first server offers",
          {
            kex: ["diffie-hellman-group1-sha1", "curve25519-sha256"],
            cipher: ["3des-cbc", "aes256-ctr"],
            hmac: ["hmac-md5", "hmac-sha2-256-etm@openssh.com"],
            serverHostKey: ["ssh-rsa", "rsa-sha2-512"],
          },
        );
        assert.equal(preferred.kex, "curve25519-sha256");
        assert.equal(preferred.cs.cipher, "aes256-ctr");
        assert.equal(preferred.cs.mac, "hmac-sha2-256-etm@openssh.com");
        assert.equal(preferred.serverHostKey, "rsa-sha2-512");
        console.log(
          `All ${count} native SSH algorithm interoperability cases passed.`,
        );
      } finally {
        await native.stop();
      }
    }
    await main();
  });
});
