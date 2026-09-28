// Independent native SSH ownership prototype; no Electron IPC or product service is replaced.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { performance } = require("node:perf_hooks");
const {
  HOST,
  Peer,
  createFixture,
  delay,
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

class Prototype {
  constructor() {
    this.pending = new Map();
    this.messages = [];
    this.nextId = 0;
    this.child = spawn(binary, ["port-forward-prototype"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.exited = new Promise((resolve) =>
      this.child.once("close", (code) => {
        this.exitCode = code;
        resolve();
      }),
    );
    this.child.once("error", (error) => this.fail(error));
    this.child.once("exit", () => this.fail(new Error("prototype exited")));
    this.child.stdin.on("error", (error) => this.fail(error));
    this.stderr = "";
    this.child.stderr.on("data", (chunk) => {
      this.stderr = (this.stderr + chunk).slice(-8192);
    });
    let buffer = "";
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => {
      try {
        buffer += chunk;
        assert.ok(buffer.length <= 256 * 1024, "stdout bound");
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const msg = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          assert.equal(msg.schemaVersion, 1);
          assert.ok(["ready", "result", "error", "event"].includes(msg.kind));
          this.messages.push(msg);
          assert.ok(this.messages.length <= 1024, "fixture output bound");
          if (msg.kind === "ready") this.ready = msg;
          else if (msg.kind !== "event") {
            const pending = this.pending.get(msg.requestId);
            assert.ok(pending, "one final response per request");
            assert.equal(msg.sessionId, pending.sessionId);
            assert.equal(msg.generation, pending.generation);
            clearTimeout(pending.timer);
            this.pending.delete(msg.requestId);
            pending.resolve(msg);
          }
        }
      } catch (error) {
        this.fail(error);
        this.child.kill();
      }
    });
  }
  fail(error) {
    this.failure = error;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  async waitReady() {
    await until(() => this.ready || this.failure, "ready handshake");
    if (this.failure) throw this.failure;
    assert.equal(this.ready.prototype, true);
    assert.ok(this.ready.capabilities.includes("socks5"));
    return this;
  }
  request(kind, sessionId, generation, extra = {}) {
    if (this.failure) return Promise.reject(this.failure);
    assert.ok(this.pending.size < 16, "fixture request bound");
    const requestId = String(++this.nextId);
    const message = {
      schemaVersion: 1,
      kind,
      requestId,
      sessionId,
      generation,
      ...extra,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.child.kill();
        reject(new Error(`request timeout: ${kind}`));
      }, 10000);
      this.pending.set(requestId, {
        resolve,
        reject,
        timer,
        sessionId,
        generation,
      });
      // Writes are bounded by the request limit and Node's writable queue; callback reports flush/error.
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) this.fail(error);
      });
    });
  }
  async start(sessionId, generation, ssh, rules) {
    const response = await this.request("start", sessionId, generation, {
      ssh,
      rules,
    });
    assert.equal(response.kind, "result", response.errorCode);
    return response.bindings;
  }
  async closeTab(sessionId, generation) {
    const response = await this.request("closeSession", sessionId, generation);
    assert.equal(response.kind, "result", response.errorCode);
  }
  async stop() {
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill(), 4000);
    await this.exited;
    clearTimeout(timer);
    assert.equal(this.exitCode, 0, this.stderr);
  }
}

function rule(id, type, port, listenPort = 0) {
  return {
    id,
    type,
    listenHost: HOST,
    listenPort,
    ...(type === "dynamic" ? {} : { targetHost: HOST, targetPort: port }),
  };
}

async function echo(port, message = "tunnel payload") {
  const peer = await Peer.connect(port);
  try {
    peer.socket.write(message);
    assert.equal(
      (await peer.read(Buffer.byteLength(message))).toString(),
      message,
    );
  } finally {
    peer.close();
  }
}

function socksRequest(port, atyp = 3) {
  const address =
    atyp === 1
      ? Buffer.from([127, 0, 0, 1])
      : atyp === 4
        ? Buffer.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1])
        : Buffer.concat([Buffer.from([9]), Buffer.from("localhost")]);
  return Buffer.concat([
    Buffer.from([5, 1, 0, atyp]),
    address,
    Buffer.from([port >> 8, port & 255]),
  ]);
}

async function socksEcho(port, targetPort, atyp) {
  const peer = await Peer.connect(port);
  try {
    peer.socket.write(Buffer.from([5]));
    await delay(5);
    peer.socket.write(Buffer.from([1, 0]));
    assert.deepEqual(await peer.read(2), Buffer.from([5, 0]));
    const request = socksRequest(targetPort, atyp);
    peer.socket.write(request.subarray(0, 3));
    await delay(5);
    peer.socket.write(
      Buffer.concat([request.subarray(3), Buffer.from("coalesced")]),
    );
    const response = await peer.read(10);
    assert.equal(response[1], 0);
    assert.equal(response[3], 1);
    assert.equal((await peer.read(9)).toString(), "coalesced");
    peer.socket.end();
    await until(() => peer.ended, "SOCKS EOF");
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
  assert.ok(
    fs.existsSync(binary),
    "Build the debug native host first, or set SIMPLESHELL_NATIVE_SERVICES_PATH",
  );
  console.log(`[port-forwarding-sidecar] ${binary}`);
  const fixture = await createFixture();
  const native = new Prototype();
  const pass = (message) => console.log(`PASS ${message}`);
  const watchdog = setTimeout(() => {
    native.child.kill();
    throw new Error("suite timeout");
  }, 90000);
  try {
    await native.waitReady();
    const echoServer = await fixture.tcp((socket) => socket.pipe(socket));
    const targetPort = echoServer.address().port;
    const rules = [
      rule("L", "local", targetPort),
      rule("R", "remote", targetPort),
      rule("D", "dynamic"),
    ];
    let bindings = await native.start("tab-a", 1, fixture.ssh, rules);
    const port = (id) => bindings.find((b) => b.id === id).port;
    await echo(port("L"));
    await echo(port("R"));
    assert.equal(
      fixture.clients.size,
      1,
      "three rules share one independent SSH transport",
    );
    pass("-L / -R bidirectional payloads and allocated remote port");
    await socksEcho(port("D"), targetPort, 1);
    await socksEcho(port("D"), targetPort, 3);
    const ipv6 = await fixture.tcp((socket) => socket.pipe(socket), "::1");
    await socksEcho(port("D"), ipv6.address().port, 4);
    pass("SOCKS5 IPv4/domain/IPv6, fragmented handshake and coalesced payload");

    for (const [request, expected] of [
      [Buffer.from([5, 1, 2]), [5, 255]],
      [Buffer.from([5, 1, 0, 5, 2, 0, 1]), [5, 0, 5, 7]],
      [Buffer.from([5, 1, 0, 5, 1, 0, 9]), [5, 0, 5, 8]],
    ]) {
      const peer = await Peer.connect(port("D"));
      try {
        peer.socket.write(request);
        assert.deepEqual(
          await peer.read(expected.length),
          Buffer.from(expected),
        );
      } finally {
        peer.close();
      }
    }
    const unavailable = net.createServer();
    const unavailablePort = await listen(unavailable);
    await new Promise((resolve) => unavailable.close(resolve));
    const rejected = await Peer.connect(port("D"));
    rejected.socket.write(
      Buffer.concat([Buffer.from([5, 1, 0]), socksRequest(unavailablePort, 1)]),
    );
    assert.equal((await rejected.read(12))[3], 5);
    rejected.close();
    pass(
      "SOCKS5 unsupported auth/command/address and destination refusal replies",
    );

    const afterEof = await fixture.tcp((socket) => {
      const chunks = [];
      socket.on("data", (chunk) => chunks.push(chunk));
      socket.on("end", () =>
        setTimeout(
          () =>
            socket.end(Buffer.concat([Buffer.from("after-fin:"), ...chunks])),
          25,
        ),
      );
    });
    const half = await native.start("half", 1, fixture.ssh, [
      rule("L", "local", afterEof.address().port),
      rule("R", "remote", afterEof.address().port),
    ]);
    for (const binding of half) {
      const peer = await Peer.connect(binding.port);
      try {
        peer.socket.end("request");
        assert.equal((await peer.read(17)).toString(), "after-fin:request");
        await until(() => peer.ended, "half-close response drained");
      } finally {
        peer.close();
      }
    }
    await native.closeTab("half", 1);
    let reverseReceived = "";
    const reverse = await fixture.tcp((socket) => {
      socket.end("early-fin");
      socket.on("data", (chunk) => {
        reverseReceived += chunk;
      });
    });
    const reverseBindings = await native.start("reverse", 1, fixture.ssh, [
      rule("L", "local", reverse.address().port),
      rule("R", "remote", reverse.address().port),
    ]);
    for (const binding of reverseBindings) {
      reverseReceived = "";
      const peer = await Peer.connect(binding.port);
      try {
        assert.equal((await peer.read(9)).toString(), "early-fin");
        await until(() => peer.ended, "target half close");
        peer.socket.end("still-writable");
        await until(
          () => reverseReceived === "still-writable",
          "write after remote FIN",
        );
      } finally {
        peer.close();
      }
    }
    await native.closeTab("reverse", 1);
    pass("-L / -R half-close in both directions, delayed response after FIN");

    const occupied = await fixture.tcp((socket) => socket.destroy());
    for (const mode of ["local", "remote"]) {
      const failed = await native.request("start", `conflict-${mode}`, 1, {
        ssh: fixture.ssh,
        rules: [
          rule("temporary", "remote", targetPort),
          rule("conflict", mode, targetPort, occupied.address().port),
        ],
      });
      assert.equal(
        failed.errorCode,
        mode === "local" ? "LOCAL_BIND_FAILED" : "REMOTE_BIND_FAILED",
      );
      await until(
        () => fixture.forwards.size === 1,
        "rollback remote bind after partial setup",
      );
    }
    pass("local / remote listener conflicts and atomic partial-start rollback");

    const attempts = fixture.state.authAttempts;
    const mismatch = await native.request("start", "untrusted", 1, {
      ssh: {
        ...fixture.ssh,
        expectedHostFingerprint: `SHA256:${"00".repeat(32)}`,
      },
      rules,
    });
    assert.equal(mismatch.errorCode, "HOST_KEY_MISMATCH");
    assert.equal(
      fixture.state.authAttempts,
      attempts,
      "host trust checked before authentication",
    );
    const missingProxy = await native.request("start", "proxy-required", 1, {
      ssh: { ...fixture.ssh, proxyRequired: true },
      rules,
    });
    assert.equal(missingProxy.errorCode, "INVALID_CONFIG");
    const wrongAuth = await native.request("start", "wrong-auth", 1, {
      ssh: { ...fixture.ssh, password: "wrong" },
      rules,
    });
    assert.equal(wrongAuth.errorCode, "AUTH_FAILED");
    const keySsh = { ...fixture.ssh };
    delete keySsh.password;
    await native.start(
      "key",
      1,
      { ...keySsh, privateKey: fixture.privateKey },
      [rule("L", "local", targetPort)],
    );
    await native.closeTab("key", 1);
    pass(
      "pinned host key before auth, password/key auth and required proxy fail-closed",
    );

    let proxyHits = 0;
    let proxyAllowed = true;
    const proxy = await fixture.tcp((socket) => {
      let header = "";
      socket.on("data", function onHeader(chunk) {
        header += chunk.toString("latin1");
        if (!header.includes("\r\n\r\n")) return;
        socket.removeListener("data", onHeader);
        proxyHits++;
        if (
          !proxyAllowed ||
          !header.includes(
            `Proxy-Authorization: Basic ${Buffer.from("proxy-user:proxy-test").toString("base64")}`,
          )
        ) {
          socket.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
          return;
        }
        const upstream = net.connect(fixture.ssh.port, HOST, () => {
          socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
          socket.pipe(upstream);
          upstream.pipe(socket);
        });
        upstream.on("error", () => socket.destroy());
        socket.on("close", () => upstream.destroy());
        upstream.on("close", () => socket.destroy());
      });
    });
    const proxiedSsh = {
      ...fixture.ssh,
      proxyRequired: true,
      proxy: {
        type: "http",
        host: HOST,
        port: proxy.address().port,
        username: "proxy-user",
        password: "proxy-test",
      },
    };
    const [proxied] = await native.start("proxied", 1, proxiedSsh, [
      rule("L", "local", targetPort),
    ]);
    await echo(proxied.port);
    await native.closeTab("proxied", 1);
    const authBeforeProxyFailure = fixture.state.authAttempts;
    proxyAllowed = false;
    const deniedProxy = await native.request("start", "proxy-denied", 1, {
      ssh: proxiedSsh,
      rules,
    });
    assert.equal(deniedProxy.errorCode, "CONNECT_FAILED");
    assert.equal(
      fixture.state.authAttempts,
      authBeforeProxyFailure,
      "no direct SSH fallback after proxy refusal",
    );
    assert.equal(proxyHits, 2);
    pass(
      "authenticated HTTP CONNECT transport and proxy refusal without direct fallback",
    );

    const [isolated] = await native.start("tab-b", 1, fixture.ssh, [
      rule("L", "local", targetPort),
    ]);
    await native.closeTab("tab-b", 1);
    await rebind(isolated.port);
    await echo(port("L"));
    pass(
      "identical SSH credentials in two tabs have isolated ownership and cleanup",
    );

    // Force transport loss. Reconnect restores listeners with a NEW generation, never old byte streams.
    const oldPorts = bindings.map((b) => b.port);
    const live = await Peer.connect(port("L"));
    const liveRemote = await Peer.connect(port("R"));
    await until(
      () => fixture.clients.size === 1,
      "other transports cleaned up",
    );
    for (const client of fixture.clients) client._sock.destroy();
    await until(
      () =>
        native.messages.some(
          (m) => m.state === "disconnected" && m.sessionId === "tab-a",
        ),
      "disconnect event",
    );
    await until(
      () =>
        (live.closed || live.ended) && (liveRemote.closed || liveRemote.ended),
      "old streams closed",
    );
    live.close();
    liveRemote.close();
    for (const p of oldPorts) await rebind(p);
    bindings = await native.start(
      "tab-a",
      2,
      fixture.ssh,
      rules.map((r, i) => ({ ...r, listenPort: oldPorts[i] })),
    );
    await echo(port("L"), "after reconnect");
    await echo(port("R"), "after reconnect");
    await socksEcho(port("D"), targetPort, 1);
    assert.equal(
      (await native.request("closeSession", "tab-a", 1)).errorCode,
      "STALE_GENERATION",
    );
    await echo(port("L"));
    pass(
      "disconnect releases streams/listeners; explicit reconnect restores -L/-R/SOCKS; stale close rejected",
    );

    await checkBackpressure(native, fixture, pass);

    const active = await Peer.connect(port("L"));
    const activeRemote = await Peer.connect(port("R"));
    const handshaking = await Peer.connect(port("D"));
    handshaking.socket.write(Buffer.from([5]));
    await native.closeTab("tab-a", 2);
    await until(
      () =>
        [active, activeRemote, handshaking].every((p) => p.closed || p.ended),
      "tab closes every socket",
    );
    for (const peer of [active, activeRemote, handshaking]) peer.close();
    for (const b of bindings) await rebind(b.port);
    assert.equal(
      (await native.request("start", "tab-a", 2, { ssh: fixture.ssh, rules }))
        .errorCode,
      "STALE_GENERATION",
    );
    await native.closeTab("tab-a", 2);
    pass(
      "close tab drains active tunnels/SOCKS handshake, releases ports, prevents stale resurrection, is idempotent",
    );

    fixture.state.hangAuth = true;
    const starting = native.request("start", "cancel-start", 1, {
      ssh: fixture.ssh,
      rules,
    });
    await delay(40);
    await native.closeTab("cancel-start", 1);
    assert.equal((await starting).errorCode, "CANCELLED");
    fixture.state.hangAuth = false;
    await until(
      () => fixture.clients.size === 0,
      "cancelled authentication transport cleaned up",
    );
    pass("close tab cancels a pending SSH authentication exactly once");

    const limited = [];
    for (let index = 0; index < 4; index++) {
      limited.push(
        await native.start(`limit-${index}`, 1, fixture.ssh, [
          rule("L", "local", targetPort),
        ]),
      );
    }
    assert.equal(
      (
        await native.request("start", "over-limit", 1, {
          ssh: fixture.ssh,
          rules,
        })
      ).errorCode,
      "BUSY",
    );
    const [replacement] = await native.start("limit-0", 2, fixture.ssh, [
      rule("L", "local", targetPort, limited[0][0].port),
    ]);
    await echo(replacement.port);
    for (let index = 0; index < 4; index++)
      await native.closeTab(`limit-${index}`, index === 0 ? 2 : 1);
    pass(
      "four-session limit and generation replacement release the old listener before rebinding",
    );

    const eofBindings = await native.start("eof", 1, fixture.ssh, rules);
    const eofPeer = await Peer.connect(eofBindings[0].port);
    await native.stop();
    await until(
      () => eofPeer.ended || eofPeer.closed,
      "EOF closes active TCP stream",
    );
    eofPeer.close();
    await until(
      () => fixture.clients.size === 0 && fixture.forwards.size === 0,
      "EOF shutdown",
    );
    for (const b of eofBindings) await rebind(b.port);
    assert.ok(
      fixture.state.remoteCancels >= 4,
      "remote cancel-tcpip-forward sent",
    );
    assert.ok(
      !native.stderr.includes(fixture.ssh.password),
      "credentials absent from stderr",
    );
    assert.ok(
      !JSON.stringify(native.messages).includes(fixture.ssh.password),
      "credentials absent from protocol output",
    );
    pass(
      "stdin EOF exits successfully, closes SSH and releases remote/local listeners; credentials never echoed",
    );
    await checkInvalidInput(fixture, rules);
    pass(
      "oversized / truncated / malformed input exits with bounded resource cleanup",
    );
  } finally {
    clearTimeout(watchdog);
    if (native.exitCode === undefined) {
      native.child.kill();
      await native.exited;
    }
    await fixture.close();
  }
}

async function checkInvalidInput(fixture, rules) {
  for (const input of ["x".repeat(256 * 1024 + 1), "{", "{bad}\n"]) {
    const process = new Prototype();
    try {
      await process.waitReady();
      const bindings = await process.start(
        "invalid-input",
        1,
        fixture.ssh,
        rules,
      );
      process.child.stdin.end(input);
      await until(
        () => process.exitCode !== undefined,
        "invalid input rejected",
      );
      assert.equal(process.exitCode, 1);
      await until(
        () => fixture.clients.size === 0 && fixture.forwards.size === 0,
        "invalid input closes SSH transport",
      );
      for (const binding of bindings) await rebind(binding.port);
    } finally {
      if (process.exitCode === undefined) process.child.kill();
      await process.exited;
    }
  }
}

async function checkBackpressure(native, fixture, pass) {
  const size = 16 * 1024 * 1024;
  const block = crypto.randomBytes(64 * 1024);
  const reference = crypto.createHash("sha256");
  for (let n = 0; n < size; n += block.length) reference.update(block);
  const expected = reference.digest("hex");
  for (const mode of ["local", "remote"]) {
    let sink;
    let bytes = 0;
    const digest = crypto.createHash("sha256");
    let complete = false;
    const slow = await fixture.tcp((socket) => {
      sink = socket;
      socket.pause();
      socket.on("data", (chunk) => {
        bytes += chunk.length;
        digest.update(chunk);
      });
      socket.on("end", () => {
        complete = true;
        socket.end();
      });
    });
    const [binding] = await native.start(`pressure-${mode}`, 1, fixture.ssh, [
      rule("pressure", mode, slow.address().port),
    ]);
    const socket = net.connect({ host: HOST, port: binding.port });
    socket.on("error", () => {});
    await once(socket, "connect");
    await until(() => sink, "slow consumer connected");
    let produced = 0;
    let blocked = 0;
    const start = performance.now();
    const writing = (async () => {
      while (produced < size) {
        produced += block.length;
        if (!socket.write(block)) {
          blocked++;
          await once(socket, "drain");
        }
      }
      socket.end();
    })();
    await delay(200);
    assert.ok(
      produced < size,
      "producer stalls before enqueuing all data while consumer paused",
    );
    const stalledAt = produced;
    sink.resume();
    await writing;
    await until(() => complete, "slow transfer completes", 15000);
    assert.equal(bytes, size);
    assert.equal(digest.digest("hex"), expected);
    assert.ok(blocked > 0);
    socket.destroy();
    await native.closeTab(`pressure-${mode}`, 1);
    pass(
      `${mode} backpressure: ${size} bytes verified, stalled at ${stalledAt} bytes, ${Math.round(performance.now() - start)} ms incl. 200 ms pause`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
