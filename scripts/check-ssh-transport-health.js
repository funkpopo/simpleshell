const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const { generateKeyPairSync } = require("node:crypto");
const { Client, Server } = require("ssh2");
const SSHPool = require("../src/core/connection/ssh-pool");
const SshTransportHealth = require("../src/core/connection/ssh-transport-health");

function fakeClient() {
  const client = new EventEmitter();
  client._callbacks = [];
  client._sock = { destroyed: false };
  client.pings = 0;
  client._protocol = { ping: () => client.pings++ };
  client.destroy = () => {
    client.destroyed = true;
    client.emit("close");
  };
  return client;
}

async function testPingOrderingAndCancellation() {
  const health = new SshTransportHealth({ timeoutMs: 20 });
  const client = fakeClient();
  let otherReplies = 0;
  client._callbacks.push(() => otherReplies++);
  const first = health.check(client);
  assert.strictEqual(
    health.check(client),
    first,
    "overlapping checks share one ping",
  );
  assert.equal(client.pings, 1);
  client._callbacks.shift()(false);
  assert.equal(otherReplies, 1);
  assert.equal(health.pending.size, 1, "unrelated reply cannot finish ping");
  client._callbacks.shift()(true);
  assert.equal(
    await first,
    true,
    "REQUEST_FAILURE still proves the SSH transport is alive",
  );

  const cancelled = health.check(client);
  health.cancel(client);
  assert.equal(await cancelled, null);
  client._callbacks.push(() => otherReplies++);
  client._callbacks.shift()(true);
  assert.equal(otherReplies, 1, "cancelled ping retains its FIFO reply slot");
  client._callbacks.shift()(false);
  assert.equal(otherReplies, 2);
  assert.equal(client.listenerCount("close"), 0);

  const timeout = health.check(client);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await timeout, false);
  client._callbacks.shift()(true);
  assert.equal(health.pending.size, 0);
  const disposed = health.check(client);
  health.dispose();
  assert.equal(await disposed, null);
  assert.equal(client.listenerCount("close"), 0);
  assert.equal(
    await health.check({}),
    null,
    "unknown ssh2 implementations use native keepalive",
  );
}

function setupPool(client) {
  const pool = new SSHPool();
  const key = "tab:vpn-test:localhost:22:user";
  const conn = {
    key,
    client,
    ready: true,
    connecting: false,
    refCount: 1,
    lastUsed: Date.now(),
    config: { tabId: "vpn-test", host: "localhost" },
  };
  pool.connections.set(key, conn);
  pool.addTabReference("vpn-test", key);
  const lost = [];
  const scheduled = [];
  pool.on("connectionLost", (event) => lost.push(event));
  pool.reconnectionManager.on("reconnectScheduled", (event) =>
    scheduled.push(event),
  );
  return { pool, key, conn, lost, scheduled };
}

async function testPoolRecoveryGuards() {
  const client = fakeClient();
  const { pool, key, conn, lost, scheduled } = setupPool(client);
  try {
    pool.transportHealth.check = async () => false;
    await pool.performHealthCheck();
    assert.equal(conn.ready, false);
    assert.equal(
      client.destroyed,
      true,
      "failed transport send queue must be dropped",
    );
    assert.equal(
      pool.reconnectionManager.getSessionStatus(key).state,
      "pending",
    );
    assert.equal(
      lost.length,
      1,
      "silent transport failure must reach the UI event path",
    );
    assert.equal(scheduled.length, 1);
    await pool.performHealthCheck();
    assert.equal(
      scheduled.length,
      1,
      "health checks must not multiply retries",
    );
  } finally {
    pool.cleanup();
  }

  for (const mutation of ["replace", "close", "unreference"]) {
    const fixture = setupPool(fakeClient());
    const { pool, conn, key, lost } = fixture;
    let complete;
    pool.transportHealth.check = () =>
      new Promise((resolve) => {
        complete = resolve;
      });
    try {
      const check = pool.performHealthCheck();
      if (mutation === "replace") conn.client = fakeClient();
      if (mutation === "close") pool.connections.delete(key);
      if (mutation === "unreference") {
        conn.refCount = 0;
        pool.tabReferences.clear();
      }
      complete(false);
      await check;
      assert.equal(lost.length, 0, `late ping must ignore ${mutation}`);
      assert.equal(conn.ready, true);
    } finally {
      pool.cleanup();
    }
  }

  const initial = setupPool(fakeClient());
  try {
    initial.conn.connecting = true;
    initial.conn.ready = false;
    let probes = 0;
    initial.pool.transportHealth.check = async () => {
      probes++;
      return false;
    };
    await initial.pool.performHealthCheck();
    assert.equal(probes, 0, "initial authentication is not a dead connection");
    assert.equal(initial.lost.length, 0);
    for (const code of [
      "EHOSTUNREACH",
      "ENETDOWN",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ETIMEDOUT",
    ]) {
      assert.equal(
        initial.pool._shouldAutoReconnectOnInitialFailure(
          { code },
          initial.conn.config,
          false,
        ),
        true,
        code,
      );
    }
    assert.equal(
      initial.pool._shouldAutoReconnectOnInitialFailure(
        new Error("All configured authentication methods failed"),
        initial.conn.config,
        false,
      ),
      false,
    );
    assert.equal(
      initial.pool._shouldAutoReconnectOnInitialFailure(
        { code: "ENOTFOUND" },
        {},
        false,
      ),
      false,
    );
  } finally {
    initial.pool.cleanup();
  }
}

async function testRealSshHalfOpenTransport() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const server = new Server({
    hostKeys: [privateKey.export({ type: "pkcs1", format: "pem" })],
  });
  const client = new Client();
  let serverClient;
  let sessionRequests = 0;
  server.on("connection", (connection) => {
    serverClient = connection;
    connection.on("error", () => {});
    connection.on("authentication", (auth) => auth.accept());
    connection.on("session", (_accept, reject) => {
      sessionRequests++;
      reject();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { pool, conn, lost, scheduled } = setupPool(client);
  pool.transportHealth.timeoutMs = 250;
  try {
    const ready = once(client, "ready");
    client.connect({
      host: "127.0.0.1",
      port: server.address().port,
      username: "test",
      keepaliveInterval: 0,
    });
    await ready;
    await pool.performHealthCheck();
    assert.equal(
      conn.ready,
      true,
      "live ssh2 ping must succeed without opening channels",
    );
    assert.equal(lost.length, 0);
    assert.equal(
      sessionRequests,
      0,
      "health checks must not run remote commands or open shells",
    );

    // Keep TCP open but stop reading SSH requests, as when a VPN route vanishes.
    serverClient._sock.pause();
    assert.equal(client._sock.destroyed, false);
    await pool.performHealthCheck();
    assert.equal(conn.ready, false);
    assert.equal(lost.length, 1);
    assert.equal(scheduled.length, 1);
  } finally {
    pool.cleanup();
    client.destroy();
    serverClient?._sock.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

(async () => {
  for (const test of [
    testPingOrderingAndCancellation,
    testPoolRecoveryGuards,
    testRealSshHalfOpenTransport,
  ]) {
    await test();
    console.log(`PASS ${test.name}`);
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
