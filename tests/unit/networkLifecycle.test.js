import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("network-quality", () => {
  const assert = require("node:assert/strict");
  const path = require("node:path");

  const ROOT = _path.resolve(_repoRoot, "");
  const {
    NETWORK_QUALITY_LEVELS,
    computeNetworkQuality,
    getCheckIntervalForQuality,
    getNetworkProfileOverridesForQuality,
    levelFromLatencyMs,
  } = require(path.join(ROOT, "src/main/services/networkQuality.js"));
  const { resolveSshNetworkProfile } = require(
    path.join(ROOT, "src/main/utils/ssh-network-profile.js"),
  );

  function testLatencyBuckets() {
    assert.equal(levelFromLatencyMs(20), NETWORK_QUALITY_LEVELS.EXCELLENT);
    assert.equal(levelFromLatencyMs(80), NETWORK_QUALITY_LEVELS.GOOD);
    assert.equal(levelFromLatencyMs(150), NETWORK_QUALITY_LEVELS.DEGRADED);
    assert.equal(levelFromLatencyMs(400), NETWORK_QUALITY_LEVELS.POOR);
  }

  function testOfflineAndErrorRate() {
    const offline = computeNetworkQuality({ offline: true });
    assert.equal(offline.level, NETWORK_QUALITY_LEVELS.OFFLINE);
    assert.equal(offline.stability, 0);

    const flaky = computeNetworkQuality({
      latencyMs: 40,
      checkCount: 10,
      errorCount: 6,
    });
    assert.equal(flaky.level, NETWORK_QUALITY_LEVELS.POOR);
    assert.ok(flaky.packetLossHint >= 0.5);
  }

  function testHysteresisUpgradeCooldown() {
    const now = 1_000_000;
    const held = computeNetworkQuality({
      latencyMs: 30,
      checkCount: 5,
      errorCount: 0,
      previousLevel: NETWORK_QUALITY_LEVELS.DEGRADED,
      previousLevelAt: now - 5_000,
      now,
    });
    assert.equal(
      held.level,
      NETWORK_QUALITY_LEVELS.DEGRADED,
      "冷却期内不应快速升级质量等级",
    );

    const upgraded = computeNetworkQuality({
      latencyMs: 30,
      checkCount: 5,
      errorCount: 0,
      previousLevel: NETWORK_QUALITY_LEVELS.DEGRADED,
      previousLevelAt: now - 60_000,
      now,
    });
    assert.equal(upgraded.level, NETWORK_QUALITY_LEVELS.EXCELLENT);
  }

  function testProfileOverrides() {
    const poorOverrides = getNetworkProfileOverridesForQuality(
      NETWORK_QUALITY_LEVELS.POOR,
    );
    assert.ok(poorOverrides.readyTimeout >= 60_000);
    assert.ok(poorOverrides.keepaliveInterval >= 20_000);

    const profile = resolveSshNetworkProfile({
      networkQualityLevel: NETWORK_QUALITY_LEVELS.POOR,
    });
    assert.equal(profile.networkQualityLevel, NETWORK_QUALITY_LEVELS.POOR);
    assert.ok(profile.readyTimeout >= 60_000);
    assert.ok(
      getCheckIntervalForQuality(NETWORK_QUALITY_LEVELS.POOR) <
        getCheckIntervalForQuality(NETWORK_QUALITY_LEVELS.EXCELLENT),
    );
  }

  it("latency buckets map to quality levels", testLatencyBuckets);
  it("offline and high error rate degrade quality", testOfflineAndErrorRate);
  it("upgrade hysteresis holds during cooldown", testHysteresisUpgradeCooldown);
  it("quality drives network profile overrides", testProfileOverrides);
});

describe("latency-service", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const path = require("node:path");

    const ROOT = _path.resolve(_repoRoot, "");

    function deferred() {
      let resolve;
      let reject;
      const promise = new Promise((innerResolve, innerReject) => {
        resolve = innerResolve;
        reject = innerReject;
      });
      return { promise, resolve, reject };
    }

    function delay(ms = 0) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function loadNetworkLatencyService() {
      const servicePath = path.join(
        ROOT,
        "src/main/services/networkLatencyService.js",
      );
      const proxyManagerPath = path.join(
        ROOT,
        "src/main/proxy/proxy-manager.js",
      );
      const loggerPath = path.join(ROOT, "src/main/utils/logger.js");

      const mockedModules = [];
      const injectMock = (modulePath, exportsValue) => {
        const id = require.resolve(modulePath);
        mockedModules.push({ id, previous: require.cache[id] });
        require.cache[id] = {
          id,
          filename: id,
          loaded: true,
          exports: exportsValue,
        };
      };

      injectMock(proxyManagerPath, {
        initialize() {},
        resolveProxyConfigAsync: async () => null,
        isValidProxyConfig: () => false,
        createTunnelSocket: async () => {
          throw new Error("proxy tunnel should not be used by latency checks");
        },
      });
      injectMock(loggerPath, {
        logToFile() {},
      });

      const serviceId = require.resolve(servicePath);
      const previousService = require.cache[serviceId];
      delete require.cache[serviceId];

      const NetworkLatencyService = require(servicePath);

      const restore = () => {
        if (previousService) {
          require.cache[serviceId] = previousService;
        } else {
          delete require.cache[serviceId];
        }

        for (const { id, previous } of mockedModules.reverse()) {
          if (previous) {
            require.cache[id] = previous;
          } else {
            delete require.cache[id];
          }
        }
      };

      return { NetworkLatencyService, restore };
    }

    function createService(NetworkLatencyService) {
      const service = new NetworkLatencyService();
      service.schedulerIntervalMs = 10;
      service.checkInterval = 10_000;
      return service;
    }

    async function testUnregisterSuppressesInFlightResult() {
      const { NetworkLatencyService, restore } = loadNetworkLatencyService();
      const service = createService(NetworkLatencyService);

      try {
        const pending = deferred();
        const events = [];
        let measureCalls = 0;

        service.measureLatency = () => {
          measureCalls += 1;
          return pending.promise;
        };
        service.on("latency:updated", (data) => events.push(data));
        service.on("latency:error", (data) => events.push(data));

        service.start();
        service.registerSSHConnection("tab-unregister", {}, "127.0.0.1", 22);

        assert.equal(measureCalls, 1, "注册后应立即启动首次探测");

        service.unregisterConnection("tab-unregister");
        pending.resolve(33);
        await pending.promise;
        await delay();

        assert.equal(
          service.getLatencyInfo("tab-unregister"),
          null,
          "注销后的连接不应再有延迟数据",
        );
        assert.deepEqual(events, [], "注销期间完成的旧探测不应广播结果");
        assert.equal(service.activeCheckCount, 0, "旧探测结束后并发计数应归零");
      } finally {
        service.stop();
        restore();
      }
    }

    async function testManualRefreshReusesInFlightProbe() {
      const { NetworkLatencyService, restore } = loadNetworkLatencyService();
      const service = createService(NetworkLatencyService);

      try {
        const pending = deferred();
        let measureCalls = 0;

        service.measureLatency = () => {
          measureCalls += 1;
          return pending.promise;
        };

        service.start();
        service.registerSSHConnection("tab-dedupe", {}, "127.0.0.1", 22);

        const manualRefresh = service.testLatencyNow("tab-dedupe");
        assert.equal(
          measureCalls,
          1,
          "手动刷新遇到正在进行的探测时不应重复建连",
        );

        pending.resolve(48);
        await manualRefresh;

        const info = service.getLatencyInfo("tab-dedupe");
        assert.equal(info.latency, 48);
        assert.equal(info.checkCount, 1);
        assert.equal(info.status, "connected");
      } finally {
        service.stop();
        restore();
      }
    }

    async function testErrorClearsStaleLatency() {
      const { NetworkLatencyService, restore } = loadNetworkLatencyService();
      const service = createService(NetworkLatencyService);

      try {
        const results = [
          () => Promise.resolve(52),
          () => Promise.reject(new Error("probe failed")),
        ];

        service.measureLatency = () => results.shift()();

        service.start();
        service.registerSSHConnection("tab-error", {}, "127.0.0.1", 22);
        await service.latencyData.get("tab-error").checkPromise;

        let info = service.getLatencyInfo("tab-error");
        assert.equal(info.latency, 52);
        assert.equal(info.status, "connected");

        await service.testLatencyNow("tab-error");
        info = service.getLatencyInfo("tab-error");

        assert.equal(info.latency, null, "错误状态不应保留上一次成功延迟");
        assert.equal(info.status, "error");
        assert.equal(info.lastError, "probe failed");
        assert.equal(info.errors, 1);
      } finally {
        service.stop();
        restore();
      }
    }

    async function testSchedulerRespectsConcurrencyLimit() {
      const { NetworkLatencyService, restore } = loadNetworkLatencyService();
      const service = createService(NetworkLatencyService);

      try {
        const pending = [];

        service.maxConcurrentChecks = 2;
        service.measureLatency = () => {
          const item = deferred();
          pending.push(item);
          return item.promise;
        };

        service.start();
        for (let index = 0; index < 5; index += 1) {
          service.registerSSHConnection(
            `tab-limit-${index}`,
            {},
            "127.0.0.1",
            22,
          );
        }

        assert.equal(pending.length, 2, "首次批量注册最多只应启动2个探测");
        assert.equal(service.activeCheckCount, 2);

        pending[0].resolve(20);
        await pending[0].promise;
        await delay();

        assert.equal(
          pending.length,
          3,
          "有探测完成后调度器应继续补充下一个到期任务",
        );
        assert.equal(service.activeCheckCount, 2);

        pending.forEach((item, index) => item.resolve(30 + index));
        await delay();
      } finally {
        service.stop();
        restore();
      }
    }

    async function testDirectTcpUsesConnectRttNotBanner() {
      const net = require("node:net");
      const { NetworkLatencyService, restore } = loadNetworkLatencyService();
      const service = createService(NetworkLatencyService);

      let server = null;
      try {
        // 服务端故意延迟发送 banner，模拟 UseDNS / 限速等场景
        server = net.createServer((socket) => {
          setTimeout(() => {
            try {
              socket.write("SSH-2.0-TestBanner\r\n");
            } catch {
              /* ignore */
            }
          }, 350);
        });

        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });

        const { port } = server.address();
        const started = Date.now();
        const latency = await service._measureTcpLatencyDirect(
          "127.0.0.1",
          port,
        );
        const elapsed = Date.now() - started;

        assert.ok(
          Number.isFinite(latency) && latency >= 0,
          "直连探测应返回有效延迟",
        );
        assert.ok(
          latency < 150,
          `TCP 建连 RTT 应接近本地回环（实际 ${latency}ms），不应等待 banner`,
        );
        assert.ok(
          elapsed < 250,
          `探测应在 connect 后立即返回（实际耗时 ${elapsed}ms），不应卡满 300ms 兜底`,
        );
      } finally {
        if (server) {
          await new Promise((resolve) => server.close(resolve));
        }
        service.stop();
        restore();
      }
    }

    async function testDirectTcpReportsConnectTimeWhenNoBanner() {
      const net = require("node:net");
      const { NetworkLatencyService, restore } = loadNetworkLatencyService();
      const service = createService(NetworkLatencyService);

      let server = null;
      try {
        // 只 accept，永不发送 banner
        server = net.createServer(() => {
          /* hold connection open without writing */
        });

        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });

        const { port } = server.address();
        const started = Date.now();
        const latency = await service._measureTcpLatencyDirect(
          "127.0.0.1",
          port,
          2000,
        );
        const elapsed = Date.now() - started;

        assert.ok(
          Number.isFinite(latency) && latency < 150,
          `无 banner 时也应返回 connect RTT（实际 ${latency}ms），不应变成 ~300ms`,
        );
        assert.ok(
          elapsed < 250,
          `无 banner 时不应等待兜底窗口（实际耗时 ${elapsed}ms）`,
        );
      } finally {
        if (server) {
          await new Promise((resolve) => server.close(resolve));
        }
        service.stop();
        restore();
      }
    }

    async function main() {
      const tests = [
        testUnregisterSuppressesInFlightResult,
        testManualRefreshReusesInFlightProbe,
        testErrorClearsStaleLatency,
        testSchedulerRespectsConcurrencyLimit,
        testDirectTcpUsesConnectRttNotBanner,
        testDirectTcpReportsConnectTimeWhenNoBanner,
      ];

      for (const test of tests) {
        await test();
        console.log(`✓ ${test.name}`);
      }
    }

    await main();
  });
});

describe("ssh-transport-health", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const { EventEmitter, once } = require("node:events");
    const { generateKeyPairSync } = require("node:crypto");
    const { Client, Server } = require("ssh2");
    const SSHPool = require("../../src/main/connection/ssh-pool");
    const SshTransportHealth = require("../../src/main/connection/ssh-transport-health");

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
      assert.equal(
        health.pending.size,
        1,
        "unrelated reply cannot finish ping",
      );
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
      assert.equal(
        otherReplies,
        1,
        "cancelled ping retains its FIFO reply slot",
      );
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
        assert.equal(
          probes,
          0,
          "initial authentication is not a dead connection",
        );
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
      const { privateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
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

    await (async () => {
      for (const test of [
        testPingOrderingAndCancellation,
        testPoolRecoveryGuards,
        testRealSshHalfOpenTransport,
      ]) {
        await test();
        console.log(`PASS ${test.name}`);
      }
    })();
  });
});
