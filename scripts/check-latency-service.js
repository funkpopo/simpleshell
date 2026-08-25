const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

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
    "src/core/services/networkLatencyService.js",
  );
  const proxyManagerPath = path.join(ROOT, "src/core/proxy/proxy-manager.js");
  const loggerPath = path.join(ROOT, "src/core/utils/logger.js");

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
    assert.equal(measureCalls, 1, "手动刷新遇到正在进行的探测时不应重复建连");

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
      service.registerSSHConnection(`tab-limit-${index}`, {}, "127.0.0.1", 22);
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
    const latency = await service._measureTcpLatencyDirect("127.0.0.1", port);
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
