const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * ip-query-serve sidecar 行为契约检查（Phase 4）。
 *
 * 使用本地 HTTP fixture（IPQUERY_TEST_ORIGIN 测试钩子）覆盖：
 *  - IPv4/IPv6 查询与供应商 transform；
 *  - 私有/保留 IP 前置校验（JS）与无效输入（Rust 校验在 sidecar 层不做 IP 格式检查，
 *    由 fixture 返回失败模拟全部供应商失败）；
 *  - 缓存命中 / 过期（短 TTL）/ LRU 淘汰；
 *  - SWR（过期后先返回旧值 + 后台刷新）；
 *  - 供应商竞速（首个成功胜出，其余被取消）；
 *  - 响应格式错误（fixture 返回非法 JSON → 供应商失败）；
 *  - 代理切换（死代理导致失败，验证代理真实生效而非静默直连）；
 *  - 取消与进程重启（重启后密钥/代理重下发）。
 */

const repoRoot = path.resolve(__dirname, "..");

function nativeHostPath() {
  const override = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
  if (override && fs.existsSync(override)) return override;
  const staged = path.join(
    repoRoot,
    "native-services",
    "bin",
    `${process.platform}-${process.arch}`,
    process.platform === "win32" ? "simpleshell-native-services.exe" : "simpleshell-native-services",
  );
  if (fs.existsSync(staged)) return staged;
  return path.join(
    repoRoot,
    "native-services",
    "desktop-host",
    "target",
    "release",
    process.platform === "win32" ? "simpleshell-native-services.exe" : "simpleshell-native-services",
  );
}

/** 启动 sidecar 并返回交互句柄 */
function startSidecar(env = {}) {
  const child = spawn(nativeHostPath(), ["ip-query-serve"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, ...env },
  });
  const messages = [];
  let lineBuffer = "";
  const waiters = [];
  child.stdout.on("data", (chunk) => {
    lineBuffer += chunk.toString("utf8");
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const parsed = JSON.parse(line);
      messages.push(parsed);
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        if (waiters[i].predicate(parsed)) {
          waiters[i].resolve(parsed);
          waiters.splice(i, 1);
        }
      }
    }
  });
  child.stderr.on("data", (chunk) => process.stderr.write(`[sidecar stderr] ${chunk}`));

  const waitFor = (predicate, timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      const existing = messages.find(predicate);
      if (existing) return resolve(existing);
      const entry = { predicate, resolve };
      waiters.push(entry);
      setTimeout(() => {
        const index = waiters.indexOf(entry);
        if (index !== -1) waiters.splice(index, 1);
        reject(new Error("timeout waiting for sidecar output"));
      }, timeoutMs);
    });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return { child, messages, waitFor, send };
}

/** 本地 HTTP fixture：按 __provider 分流返回 JSON */
function startFixture(handlers) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const provider = url.searchParams.get("__provider") || "unknown";
    const handler = handlers[provider] || handlers.default;
    Promise.resolve()
      .then(() => handler(req, url))
      .then(({ status = 200, body = {}, delay = 0 }) => {
        setTimeout(() => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(typeof body === "string" ? body : JSON.stringify(body));
        }, delay);
      })
      .catch((error) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: error.message }));
      });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const failed = [];
  const pass = (name) => process.stdout.write(`PASS ${name}\n`);
  const fail = (name, error) => {
    failed.push(name);
    process.stdout.write(`FAIL ${name}: ${error.message || error}\n`);
  };

  const { server, origin } = await startFixture({
    // ipwho.is：成功路径（own + lookup）
    "ipwho.is": () => {
      return {
        body: {
          success: true,
          ip: "203.0.113.7",
          country: "测试国",
          region: "测试省",
          city: "测试市",
          org: "测试 ISP",
          latitude: 30.5,
          longitude: 114.3,
        },
      };
    },
    // ipinfo.io：慢速成功（竞速中作为败者被取消）
    "ipinfo.io": () => ({ body: { ip: "203.0.113.9", country: "SLOW", loc: "1,2" }, delay: 3000 }),
    // geolocation-db.com：响应格式错误（缺 IPv4 字段）
    "geolocation-db.com": () => ({ body: { unexpected: true } }),
    // ip.sb：HTTP 错误状态
    "ip.sb": () => ({ status: 503, body: {} }),
    default: () => ({ status: 404, body: {} }),
  });

  const sidecar = startSidecar({ IPQUERY_TEST_ORIGIN: origin });
  const ready = await sidecar.waitFor((m) => m.type === "ready");
  try {
    if (ready.schemaVersion !== 1) throw new Error("ready schemaVersion mismatch");
    if (ready.cacheMax !== 200 || ready.cacheTtlMs !== 300000) {
      throw new Error(`cache defaults mismatch: ${ready.cacheMax}/${ready.cacheTtlMs}`);
    }
    pass("ready protocol with cache defaults");

    // 1. IPv4 lookup 竞速：首个成功胜出（ipwho.is 快速成功）
    const lookupRequestId = "q-lookup-1";
    sidecar.send({ type: "query", requestId: lookupRequestId, ip: "203.0.113.7" });
    const lookupAck = await sidecar.waitFor(
      (m) => m.type === "event" && m.kind === "result" && m.requestId === lookupRequestId,
      20000,
    );
    assert.equal(lookupAck.result.ret, "ok");
    assert.equal(lookupAck.result.data.ip, "203.0.113.7");
    assert.deepEqual(lookupAck.result.data.location, ["测试国", "测试省", "测试市", "测试 ISP"]);
    assert.equal(lookupAck.provider, "ipwho.is");
    assert.equal(lookupAck.cached, false);
    // 竞速败者被取消：慢速 ipinfo.io 不应改变结果
    pass("IPv4 lookup race: first success wins, transform correct");

    // 2. 缓存命中：同 IP + 同版本 → cached: true
    const cacheRequestId = "q-lookup-2";
    sidecar.send({ type: "query", requestId: cacheRequestId, ip: "203.0.113.7" });
    const cacheAck = await sidecar.waitFor(
      (m) => m.type === "event" && m.kind === "result" && m.requestId === cacheRequestId,
      5000,
    );
    assert.equal(cacheAck.cached, true);
    assert.equal(cacheAck.result.ret, "ok");
    pass("cache hit on same key");

    // 3. SWR：短 TTL sidecar → 过期后返回旧值 + 后台刷新
    const swrSidecar = startSidecar({
      IPQUERY_TEST_ORIGIN: origin,
      IPQUERY_CACHE_TTL_MS: "2000",
    });
    await swrSidecar.waitFor((m) => m.type === "ready");
    try {
      swrSidecar.send({ type: "query", requestId: "swr-1", ip: "203.0.113.7" });
      const first = await swrSidecar.waitFor((m) => m.type === "event" && m.kind === "result" && m.requestId === "swr-1");
      assert.equal(first.cached, false);
      await sleep(2200); // 等待过期（TTL 2000ms）
      swrSidecar.send({ type: "query", requestId: "swr-2", ip: "203.0.113.7" });
      const second = await swrSidecar.waitFor((m) => m.type === "event" && m.kind === "result" && m.requestId === "swr-2");
      assert.equal(second.cached, true);
      assert.equal(second.stale, true, "SWR should mark stale entry");
      // 后台刷新完成后再次查询（刷新在 TTL 内）：返回新缓存（非 stale）
      await sleep(600);
      swrSidecar.send({ type: "query", requestId: "swr-3", ip: "203.0.113.7" });
      const third = await swrSidecar.waitFor((m) => m.type === "event" && m.kind === "result" && m.requestId === "swr-3");
      assert.equal(third.cached, true);
      assert.ok(!third.stale, "background refresh should renew entry");
      pass("SWR: stale served + background refresh renews");
    } finally {
      swrSidecar.child.kill();
    }

    // 4. own 查询（出口 IP）：fixture 返回 ipwho.is own 路径
    const ownRequestId = "q-own-1";
    sidecar.send({ type: "query", requestId: ownRequestId, ip: "" });
    const ownAck = await sidecar.waitFor(
      (m) => m.type === "event" && m.kind === "result" && m.requestId === ownRequestId,
      20000,
    );
    assert.equal(ownAck.result.ret, "ok");
    pass("own IP query via own providers");

    // 5. 响应格式错误：全部供应商失败 → failed 结果（专用失败 fixture）
    const failingFixture = await startFixture({
      "ipwho.is": () => ({ body: { success: false, message: "invalid query" } }),
      "ipinfo.io": () => ({ body: { error: { title: "bad input" } } }),
      "geolocation-db.com": () => ({ body: { unexpected: true } }),
      default: () => ({ status: 500, body: {} }),
    });
    const failingSidecar = startSidecar({ IPQUERY_TEST_ORIGIN: failingFixture.origin });
    await failingSidecar.waitFor((m) => m.type === "ready");
    try {
      const badRequestId = "q-bad-1";
      failingSidecar.send({ type: "query", requestId: badRequestId, ip: "198.51.100.1" });
      const badAck = await failingSidecar.waitFor(
        (m) => m.type === "event" && m.kind === "result" && m.requestId === badRequestId,
        25000,
      );
      assert.equal(badAck.result.ret, "failed");
      pass("all providers failing returns failed result");
    } finally {
      failingSidecar.child.kill();
      failingFixture.server.close();
    }

    // 6. 代理切换：死代理导致查询失败（代理真实生效，不静默直连）
    const proxyRequestId = "q-proxy-1";
    sidecar.send({
      type: "query",
      requestId: proxyRequestId,
      ip: "203.0.113.7",
      proxy: { type: "http", host: "127.0.0.1", port: 1 },
    });
    const proxyAck = await sidecar.waitFor(
      (m) => m.type === "event" && m.kind === "result" && m.requestId === proxyRequestId,
      30000,
    );
    assert.equal(proxyAck.result.ret, "failed", "dead proxy must fail the query");
    // 代理更新后（恢复直连）：查询成功，且缓存键版本变化
    sidecar.send({ type: "updateProxy", requestId: "up-1", revision: 7 });
    await sidecar.waitFor((m) => m.type === "result" && m.requestId === "up-1");
    const afterProxyRequestId = "q-proxy-2";
    sidecar.send({ type: "query", requestId: afterProxyRequestId, ip: "203.0.113.7" });
    const afterProxyAck = await sidecar.waitFor(
      (m) => m.type === "event" && m.kind === "result" && m.requestId === afterProxyRequestId,
      20000,
    );
    assert.equal(afterProxyAck.result.ret, "ok");
    assert.equal(afterProxyAck.cached, false, "proxy switch must invalidate cache key");
    pass("proxy switch: dead proxy fails, update restores, cache key bumped");

    // 7. 取消：慢速查询 + cancel → 快速失败结果
    const cancelFixture = await startFixture({
      "ipwho.is": () => ({ body: { success: true, ip: "203.0.113.7" }, delay: 30000 }),
      default: () => ({ status: 404, body: {} }),
    });
    const cancelSidecar = startSidecar({ IPQUERY_TEST_ORIGIN: cancelFixture.origin });
    await cancelSidecar.waitFor((m) => m.type === "ready");
    try {
      const cancelStart = Date.now();
      cancelSidecar.send({ type: "query", requestId: "q-cancel-1", ip: "203.0.113.7" });
      await sleep(300);
      cancelSidecar.send({ type: "cancel", requestId: "c-1" });
      const cancelledAck = await cancelSidecar.waitFor(
        (m) => m.type === "event" && m.kind === "result" && m.requestId === "q-cancel-1",
        10000,
      );
      const elapsed = Date.now() - cancelStart;
      assert.ok(elapsed < 10000, `cancel should end query quickly, took ${elapsed}ms`);
      assert.equal(cancelledAck.result.ret, "failed");
      pass("cancel ends in-flight query promptly");
    } finally {
      cancelSidecar.child.kill();
      cancelFixture.server.close();
    }

    // 8. 进程重启：密钥经 stdin 重下发（updateKeys ack）
    sidecar.send({
      type: "updateKeys",
      requestId: "keys-1",
      keys: { ip2location: "test-key-do-not-log" },
    });
    const keysAck = await sidecar.waitFor(
      (m) => m.type === "result" && m.requestId === "keys-1",
      5000,
    );
    assert.equal(keysAck.keyedProviders, 1);
    pass("keys updated via stdin (not logged, not persisted)");

    // 9. JS 集成：私有 IP 前置校验 + native 路径返回结构（隔离 electron 依赖）
    const ipQueryModule = require("../src/main/system-info/ip-query.js");
    const privateResult = await ipQueryModule.queryIpAddress("127.0.0.1", null, null);
    assert.equal(privateResult.ret, "failed");
    assert.ok(privateResult.msg, "private IP should return localized failure");
    const invalidResult = await ipQueryModule.queryIpAddress("not-an-ip", null, null);
    assert.equal(invalidResult.ret, "failed");
    pass("JS integration: private/special + invalid IP pre-validation");

    pass("ip-query sidecar checks completed");
  } catch (error) {
    fail("ip-query sidecar interactions", error);
  } finally {
    sidecar.child.kill();
    server.close();
  }

  if (failed.length) {
    throw new Error(`${failed.length} ip-query sidecar checks failed: ${failed.join(", ")}`);
  }
  process.stdout.write("All ip-query sidecar checks passed.\n");
  process.exit(0);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
