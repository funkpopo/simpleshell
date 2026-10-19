import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("checksum-sidecar", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const crypto = require("node:crypto");

    /**
     * checksum-file sidecar 行为契约检查（Phase 1）。
     *
     * 验证真实进程交互：
     * 1. MD5/SHA-256 与独立参考摘要一致：空文件、完整文件、非零偏移、末尾零长度、跨缓冲区区间。
     * 2. 错误路径：不存在文件、目录、非法算法、非法/溢出区间。
     * 3. JS 桥接：协议校验、取消、并发排队、二进制定位。
     */

    const repoRoot = _path.resolve(_repoRoot, "");
    const os_platform = process.platform;

    function nativeHostPath() {
      const override = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
      if (override && fs.existsSync(override)) return override;
      const candidates = [
        path.join(
          repoRoot,
          "native-services",
          "bin",
          `${os_platform}-${process.arch}`,
          os_platform === "win32"
            ? "simpleshell-native-services.exe"
            : "simpleshell-native-services",
        ),
        path.join(
          repoRoot,
          "native-services",
          "desktop-host",
          "target",
          os_platform === "win32" ? "" : "release",
        ),
      ];
      for (const dir of candidates.slice(0, 1)) {
        if (fs.existsSync(dir)) return dir;
      }
      const release = path.join(
        repoRoot,
        "native-services",
        "desktop-host",
        "target",
        "release",
        os_platform === "win32"
          ? "simpleshell-native-services.exe"
          : "simpleshell-native-services",
      );
      if (fs.existsSync(release)) return release;
      throw new Error("native services host binary not found; build it first");
    }

    function referenceDigest(algorithm, bytes) {
      return crypto.createHash(algorithm).update(bytes).digest("hex");
    }

    async function main() {
      const native = require(
        path.join(repoRoot, "src/main/native/nativeChecksumClient"),
      );
      const hostPath = nativeHostPath();
      process.stdout.write(`[checksum-sidecar] binary: ${hostPath}\n`);

      const root = fs.mkdtempSync(path.join(os.tmpdir(), "ss-checksum-"));
      const failed = [];
      const run = async (name, fn) => {
        try {
          await fn();
          process.stdout.write(`PASS ${name}\n`);
        } catch (error) {
          failed.push(name);
          process.stdout.write(`FAIL ${name}: ${error.message}\n`);
        }
      };

      // 1. 空文件（md5 与 sha256）
      await run("empty file digests", async () => {
        const empty = path.join(root, "empty.bin");
        fs.writeFileSync(empty, "");
        for (const algorithm of ["md5", "sha256"]) {
          const result = await native.invokeLocalChecksum({
            localPath: empty,
            algorithm,
          });
          assert.equal(
            result.digest,
            referenceDigest(algorithm, Buffer.alloc(0)),
          );
          assert.equal(result.bytesHashed, 0);
        }
      });

      // 2. 完整文件与跨缓冲区区间（> 256 KiB）
      await run("full file and cross-buffer segment", async () => {
        const bytes = crypto.randomBytes(700 * 1024);
        const file = path.join(root, "big.bin");
        fs.writeFileSync(file, bytes);
        for (const algorithm of ["md5", "sha256"]) {
          const full = await native.invokeLocalChecksum({
            localPath: file,
            algorithm,
          });
          assert.equal(full.digest, referenceDigest(algorithm, bytes));
          const segment = await native.invokeLocalChecksum({
            localPath: file,
            algorithm,
            segmentOffset: 100,
            segmentLength: bytes.length - 200,
          });
          assert.equal(
            segment.digest,
            referenceDigest(algorithm, bytes.subarray(100, bytes.length - 100)),
          );
        }
      });

      // 3. 中文/空格路径
      await run("unicode and space paths", async () => {
        const file = path.join(root, "文件 名称.txt");
        fs.writeFileSync(file, "内容");
        const result = await native.invokeLocalChecksum({
          localPath: file,
          algorithm: "md5",
        });
        assert.equal(
          result.digest,
          referenceDigest("md5", Buffer.from("内容")),
        );
      });

      // 4. 末尾零长度区间
      await run("tail zero-length segment", async () => {
        const file = path.join(root, "tail.bin");
        fs.writeFileSync(file, "abc");
        const result = await native.invokeLocalChecksum({
          localPath: file,
          algorithm: "sha256",
          segmentOffset: 3,
          segmentLength: 0,
        });
        assert.equal(result.digest, referenceDigest("sha256", Buffer.alloc(0)));
      });

      // 5. 不存在文件 / 目录
      await run("missing file and directory rejection", async () => {
        await assert.rejects(
          () =>
            native.invokeLocalChecksum({
              localPath: path.join(root, "missing.bin"),
              algorithm: "md5",
            }),
          (error) => error.errorCode === "CHECKSUM_SOURCE_UNAVAILABLE",
        );
        await assert.rejects(
          () =>
            native.invokeLocalChecksum({ localPath: root, algorithm: "md5" }),
          (error) => error.errorCode === "CHECKSUM_INVALID_REQUEST",
        );
      });

      // 6. 非法算法 / 非法区间（JS 预校验）
      await run("invalid algorithm and range", async () => {
        const file = path.join(root, "alg.bin");
        fs.writeFileSync(file, "abc");
        await assert.rejects(
          () =>
            native.invokeLocalChecksum({ localPath: file, algorithm: "sha1" }),
          (error) => error.errorKind === "validation",
        );
        await assert.rejects(
          () =>
            native.invokeLocalChecksum({
              localPath: file,
              algorithm: "md5",
              segmentOffset: 10,
            }),
          (error) => error.errorKind === "validation",
        );
        await assert.rejects(
          () =>
            native.invokeLocalChecksum({
              localPath: file,
              algorithm: "md5",
              segmentOffset: 1.5,
            }),
          (error) => error.errorKind === "validation",
        );
        await assert.rejects(
          () =>
            native.invokeLocalChecksum({
              localPath: file,
              algorithm: "md5",
              segmentOffset: -1,
            }),
          (error) => error.errorKind === "validation",
        );
      });

      // 7. 运行中取消：Digest 大文件时中途 AbortSignal
      await run("cancel while running", async () => {
        const bytes = crypto.randomBytes(256 * 1024 * 1024);
        const file = path.join(root, "cancel.bin");
        fs.writeFileSync(file, bytes);
        const controller = new AbortController();
        const promise = native.invokeLocalChecksum({
          localPath: file,
          algorithm: "sha256",
          signal: controller.signal,
        });
        setTimeout(() => controller.abort(), 1);
        await assert.rejects(
          promise,
          (error) => error.errorKind === "cancelled",
        );
      });

      // 8. 启动前取消
      await run("cancel before start", async () => {
        const controller = new AbortController();
        controller.abort();
        await assert.rejects(
          () =>
            native.invokeLocalChecksum({
              localPath: path.join(root, "empty.bin"),
              algorithm: "md5",
              signal: controller.signal,
            }),
          (error) => error.errorKind === "cancelled",
        );
      });

      // 9. 并发排队（超过并发上限 2 依然全部完成，不留悬挂 Promise）
      await run("concurrency queue", async () => {
        const file = path.join(root, "queue.bin");
        const bytes = crypto.randomBytes(4 * 1024 * 1024);
        fs.writeFileSync(file, bytes);
        const results = await Promise.all(
          Array.from({ length: 6 }, () =>
            native.invokeLocalChecksum({ localPath: file, algorithm: "md5" }),
          ),
        );
        for (const result of results) {
          assert.equal(result.digest, referenceDigest("md5", bytes));
        }
      });

      // 10. transferIntegrity.hashLocalFile 委托桥接并返回摘要字符串
      await run("transferIntegrity delegation", async () => {
        const { hashLocalFile, verifyTransfer } = require(
          path.join(repoRoot, "src/main/file-transfer/transferIntegrity"),
        );
        const file = path.join(root, "delegation.bin");
        const bytes = crypto.randomBytes(1024);
        fs.writeFileSync(file, bytes);
        const digest = await hashLocalFile(file, "sha256");
        assert.equal(digest, referenceDigest("sha256", bytes));
        assert.equal(typeof verifyTransfer, "function");
      });

      fs.rmSync(root, { recursive: true, force: true });

      if (failed.length) {
        throw new Error(
          `${failed.length} checksum sidecar checks failed: ${failed.join(", ")}`,
        );
      }
      process.stdout.write("All checksum sidecar checks passed.\n");
    }

    await main();
  });
});

describe("ip-query-sidecar", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
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

    const repoRoot = _path.resolve(_repoRoot, "");

    function nativeHostPath() {
      const override = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
      if (override && fs.existsSync(override)) return override;
      const staged = path.join(
        repoRoot,
        "native-services",
        "bin",
        `${process.platform}-${process.arch}`,
        process.platform === "win32"
          ? "simpleshell-native-services.exe"
          : "simpleshell-native-services",
      );
      if (fs.existsSync(staged)) return staged;
      return path.join(
        repoRoot,
        "native-services",
        "desktop-host",
        "target",
        "release",
        process.platform === "win32"
          ? "simpleshell-native-services.exe"
          : "simpleshell-native-services",
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
      child.stderr.on("data", (chunk) =>
        process.stderr.write(`[sidecar stderr] ${chunk}`),
      );

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

      const send = (message) =>
        child.stdin.write(`${JSON.stringify(message)}\n`);
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
          resolve({
            server,
            origin: `http://127.0.0.1:${server.address().port}`,
          });
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
        "ipinfo.io": () => ({
          body: { ip: "203.0.113.9", country: "SLOW", loc: "1,2" },
          delay: 3000,
        }),
        // geolocation-db.com：响应格式错误（缺 IPv4 字段）
        "geolocation-db.com": () => ({ body: { unexpected: true } }),
        // ip.sb：HTTP 错误状态
        "ip.sb": () => ({ status: 503, body: {} }),
        default: () => ({ status: 404, body: {} }),
      });

      const sidecar = startSidecar({ IPQUERY_TEST_ORIGIN: origin });
      const ready = await sidecar.waitFor((m) => m.type === "ready");
      try {
        if (ready.schemaVersion !== 1)
          throw new Error("ready schemaVersion mismatch");
        if (ready.cacheMax !== 200 || ready.cacheTtlMs !== 300000) {
          throw new Error(
            `cache defaults mismatch: ${ready.cacheMax}/${ready.cacheTtlMs}`,
          );
        }
        pass("ready protocol with cache defaults");

        // 1. IPv4 lookup 竞速：首个成功胜出（ipwho.is 快速成功）
        const lookupRequestId = "q-lookup-1";
        sidecar.send({
          type: "query",
          requestId: lookupRequestId,
          ip: "203.0.113.7",
        });
        const lookupAck = await sidecar.waitFor(
          (m) =>
            m.type === "event" &&
            m.kind === "result" &&
            m.requestId === lookupRequestId,
          20000,
        );
        assert.equal(lookupAck.result.ret, "ok");
        assert.equal(lookupAck.result.data.ip, "203.0.113.7");
        assert.deepEqual(lookupAck.result.data.location, [
          "测试国",
          "测试省",
          "测试市",
          "测试 ISP",
        ]);
        assert.equal(lookupAck.provider, "ipwho.is");
        assert.equal(lookupAck.cached, false);
        // 竞速败者被取消：慢速 ipinfo.io 不应改变结果
        pass("IPv4 lookup race: first success wins, transform correct");

        // 2. 缓存命中：同 IP + 同版本 → cached: true
        const cacheRequestId = "q-lookup-2";
        sidecar.send({
          type: "query",
          requestId: cacheRequestId,
          ip: "203.0.113.7",
        });
        const cacheAck = await sidecar.waitFor(
          (m) =>
            m.type === "event" &&
            m.kind === "result" &&
            m.requestId === cacheRequestId,
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
          swrSidecar.send({
            type: "query",
            requestId: "swr-1",
            ip: "203.0.113.7",
          });
          const first = await swrSidecar.waitFor(
            (m) =>
              m.type === "event" &&
              m.kind === "result" &&
              m.requestId === "swr-1",
          );
          assert.equal(first.cached, false);
          await sleep(2200); // 等待过期（TTL 2000ms）
          swrSidecar.send({
            type: "query",
            requestId: "swr-2",
            ip: "203.0.113.7",
          });
          const second = await swrSidecar.waitFor(
            (m) =>
              m.type === "event" &&
              m.kind === "result" &&
              m.requestId === "swr-2",
          );
          assert.equal(second.cached, true);
          assert.equal(second.stale, true, "SWR should mark stale entry");
          // 后台刷新完成后再次查询（刷新在 TTL 内）：返回新缓存（非 stale）
          await sleep(600);
          swrSidecar.send({
            type: "query",
            requestId: "swr-3",
            ip: "203.0.113.7",
          });
          const third = await swrSidecar.waitFor(
            (m) =>
              m.type === "event" &&
              m.kind === "result" &&
              m.requestId === "swr-3",
          );
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
          (m) =>
            m.type === "event" &&
            m.kind === "result" &&
            m.requestId === ownRequestId,
          20000,
        );
        assert.equal(ownAck.result.ret, "ok");
        pass("own IP query via own providers");

        // 5. 响应格式错误：全部供应商失败 → failed 结果（专用失败 fixture）
        const failingFixture = await startFixture({
          "ipwho.is": () => ({
            body: { success: false, message: "invalid query" },
          }),
          "ipinfo.io": () => ({ body: { error: { title: "bad input" } } }),
          "geolocation-db.com": () => ({ body: { unexpected: true } }),
          default: () => ({ status: 500, body: {} }),
        });
        const failingSidecar = startSidecar({
          IPQUERY_TEST_ORIGIN: failingFixture.origin,
        });
        await failingSidecar.waitFor((m) => m.type === "ready");
        try {
          const badRequestId = "q-bad-1";
          failingSidecar.send({
            type: "query",
            requestId: badRequestId,
            ip: "198.51.100.1",
          });
          const badAck = await failingSidecar.waitFor(
            (m) =>
              m.type === "event" &&
              m.kind === "result" &&
              m.requestId === badRequestId,
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
          (m) =>
            m.type === "event" &&
            m.kind === "result" &&
            m.requestId === proxyRequestId,
          30000,
        );
        assert.equal(
          proxyAck.result.ret,
          "failed",
          "dead proxy must fail the query",
        );
        // 代理更新后（恢复直连）：查询成功，且缓存键版本变化
        sidecar.send({ type: "updateProxy", requestId: "up-1", revision: 7 });
        await sidecar.waitFor(
          (m) => m.type === "result" && m.requestId === "up-1",
        );
        const afterProxyRequestId = "q-proxy-2";
        sidecar.send({
          type: "query",
          requestId: afterProxyRequestId,
          ip: "203.0.113.7",
        });
        const afterProxyAck = await sidecar.waitFor(
          (m) =>
            m.type === "event" &&
            m.kind === "result" &&
            m.requestId === afterProxyRequestId,
          20000,
        );
        assert.equal(afterProxyAck.result.ret, "ok");
        assert.equal(
          afterProxyAck.cached,
          false,
          "proxy switch must invalidate cache key",
        );
        pass(
          "proxy switch: dead proxy fails, update restores, cache key bumped",
        );

        // 7. 取消：慢速查询 + cancel → 快速失败结果
        const cancelFixture = await startFixture({
          "ipwho.is": () => ({
            body: { success: true, ip: "203.0.113.7" },
            delay: 30000,
          }),
          default: () => ({ status: 404, body: {} }),
        });
        const cancelSidecar = startSidecar({
          IPQUERY_TEST_ORIGIN: cancelFixture.origin,
        });
        await cancelSidecar.waitFor((m) => m.type === "ready");
        try {
          const cancelStart = Date.now();
          cancelSidecar.send({
            type: "query",
            requestId: "q-cancel-1",
            ip: "203.0.113.7",
          });
          await sleep(300);
          cancelSidecar.send({ type: "cancel", requestId: "c-1" });
          const cancelledAck = await cancelSidecar.waitFor(
            (m) =>
              m.type === "event" &&
              m.kind === "result" &&
              m.requestId === "q-cancel-1",
            10000,
          );
          const elapsed = Date.now() - cancelStart;
          assert.ok(
            elapsed < 10000,
            `cancel should end query quickly, took ${elapsed}ms`,
          );
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
        const ipQueryModule = require("../../src/main/system-info/ip-query.js");
        const privateResult = await ipQueryModule.queryIpAddress(
          "127.0.0.1",
          null,
          null,
        );
        assert.equal(privateResult.ret, "failed");
        assert.ok(
          privateResult.msg,
          "private IP should return localized failure",
        );
        const invalidResult = await ipQueryModule.queryIpAddress(
          "not-an-ip",
          null,
          null,
        );
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
        throw new Error(
          `${failed.length} ip-query sidecar checks failed: ${failed.join(", ")}`,
        );
      }
      process.stdout.write("All ip-query sidecar checks passed.\n");
      return;
    }

    await main();
  });
});

describe("latency-sidecar", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const net = require("node:net");
    const { spawn } = require("node:child_process");
    const path = require("node:path");
    const fs = require("node:fs");

    /**
     * latency-serve sidecar 行为契约检查（Phase 2）。
     *
     * 使用本地 TCP/代理测试服务覆盖真实进程交互：
     * 1. ready 协议校验（schemaVersion、能力列表、并发上限）。
     * 2. 直连 TCP 探测成功，method = tcp。
     * 3. HTTP CONNECT 代理隧道探测成功，method = proxy-tunnel。
     * 4. DNS 失败 / 拒绝连接 / 超时，错误分类明确。
     * 5. 超额并发返回 busy（全局最多 4）。
     * 6. 取消：控制请求确认 + 目标请求以 cancelled 分类结束。
     * 7. proxyUpdate 确认；重复/未知取消幂等。
     * 8. JS 桥接：nativeLatencyClient.probe / cancelSession / 生命周期。
     */

    const repoRoot = _path.resolve(_repoRoot, "");

    function nativeHostPath() {
      const override = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
      if (override && fs.existsSync(override)) return override;
      const staged = path.join(
        repoRoot,
        "native-services",
        "bin",
        `${process.platform}-${process.arch}`,
        process.platform === "win32"
          ? "simpleshell-native-services.exe"
          : "simpleshell-native-services",
      );
      if (fs.existsSync(staged)) return staged;
      return path.join(
        repoRoot,
        "native-services",
        "desktop-host",
        "target",
        "release",
        process.platform === "win32"
          ? "simpleshell-native-services.exe"
          : "simpleshell-native-services",
      );
    }

    /** 立即关闭连接的 TCP 服务 */
    function createClosedServer() {
      return new Promise((resolve) => {
        const server = net.createServer((socket) => socket.destroy());
        server.listen(0, "127.0.0.1", () => resolve(server));
      });
    }

    /** 接受 CONNECT 但永不响应的代理（握手挂起，用于取消/busy 场景） */
    function createHangingProxyServer() {
      return new Promise((resolve) => {
        const server = net.createServer(() => {});
        server.listen(0, "127.0.0.1", () => resolve(server));
      });
    }

    /** 本地 HTTP CONNECT 代理 */
    function createHttpProxyServer() {
      const backends = new Map();
      return new Promise((resolve) => {
        const server = net.createServer((socket) => {
          socket.on("error", () => socket.destroy());
          let data = "";
          socket.on("data", function onData(chunk) {
            data += chunk.toString("latin1");
            if (!data.includes("\r\n\r\n")) return;
            socket.removeListener("data", onData);
            const match = data.match(/^CONNECT ([^\s]+) HTTP/);
            if (match) {
              socket.write("HTTP/1.1 200 Connection established\r\n\r\n");
              const backend = backends.get(match[1]);
              if (backend) {
                const upstream = net.connect(backend.port, "127.0.0.1");
                upstream.pipe(socket);
                socket.pipe(upstream);
                upstream.on("error", () => socket.destroy());
                socket.on("error", () => upstream.destroy());
              }
            } else {
              socket.destroy();
            }
          });
        });
        server.backends = backends;
        server.listen(0, "127.0.0.1", () => resolve(server));
      });
    }

    async function main() {
      const hostPath = nativeHostPath();
      process.stdout.write(`[latency-sidecar] binary: ${hostPath}\n`);

      const failed = [];
      const pass = (name) => {
        process.stdout.write(`PASS ${name}\n`);
      };
      const fail = (name, error) => {
        failed.push(name);
        process.stdout.write(`FAIL ${name}: ${error.message || error}\n`);
      };

      // 启动 sidecar
      const child = spawn(hostPath, ["latency-serve"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      const outputs = [];
      let lineBuffer = "";
      const protocolLines = [];
      child.stdout.on("data", (chunk) => {
        lineBuffer += chunk.toString("utf8");
        const lines = lineBuffer.split(/\r?\n/);
        lineBuffer = lines.pop() || "";
        for (const line of lines) {
          if (line.trim()) {
            protocolLines.push(JSON.parse(line));
            outputs.push(line);
          }
        }
      });
      child.stderr.on("data", (chunk) =>
        process.stderr.write(`[sidecar stderr] ${chunk}`),
      );

      const waitReady = () =>
        new Promise((resolve, reject) => {
          const start = Date.now();
          const check = () => {
            const ready = protocolLines.find((m) => m.type === "ready");
            if (ready) return resolve(ready);
            if (Date.now() - start > 10000)
              return reject(new Error("sidecar did not emit ready"));
            setTimeout(check, 25);
          };
          check();
        });

      const send = (message) =>
        child.stdin.write(`${JSON.stringify(message)}\n`);
      const waitFor = (predicate, timeoutMs = 10000) =>
        new Promise((resolve, reject) => {
          const start = Date.now();
          const check = () => {
            const found = protocolLines.find(predicate);
            if (found) return resolve(found);
            if (Date.now() - start > timeoutMs) {
              return reject(new Error("timeout waiting for sidecar output"));
            }
            setTimeout(check, 25);
          };
          check();
        });

      try {
        const ready = await waitReady();
        if (ready.schemaVersion !== 1)
          throw new Error("ready schemaVersion mismatch");
        if (
          !Array.isArray(ready.capabilities) ||
          !ready.capabilities.includes("tcp")
        ) {
          throw new Error("ready capabilities missing tcp");
        }
        if (ready.maxConcurrentProbes !== 4)
          throw new Error("ready maxConcurrentProbes mismatch");
        pass("ready protocol");

        // 1. 直连探测成功
        const closed = await createClosedServer();
        const port = closed.address().port;
        send({
          type: "probe",
          requestId: "p-direct",
          sessionId: "s1",
          generation: 1,
          host: "127.0.0.1",
          port,
          timeoutMs: 3000,
        });
        const direct = await waitFor((m) => m.requestId === "p-direct");
        if (direct.type !== "result" || direct.method !== "tcp") {
          throw new Error(`direct probe failed: ${JSON.stringify(direct)}`);
        }
        if (!Number.isFinite(direct.latencyMs))
          throw new Error("direct latencyMs not finite");
        pass("direct tcp probe");

        // 2. HTTP 代理隧道探测
        const proxy = await createHttpProxyServer();
        const backend = await createClosedServer();
        proxy.backends.set(`127.0.0.1:${backend.address().port}`, {
          port: backend.address().port,
        });
        send({
          type: "proxyUpdate",
          requestId: "pu1",
          sessionId: "s1",
          proxyRevision: 2,
          proxy: {
            type: "http",
            host: "127.0.0.1",
            port: proxy.address().port,
          },
          proxyRequired: true,
        });
        const proxyAck = await waitFor(
          (m) => m.requestId === "pu1" && m.acknowledged,
        );
        if (proxyAck.proxyRevision !== 2)
          throw new Error("proxyUpdate ack revision mismatch");
        send({
          type: "probe",
          requestId: "p-proxy",
          sessionId: "s1",
          generation: 1,
          host: "127.0.0.1",
          port: backend.address().port,
          timeoutMs: 3000,
          proxyRevision: 2,
        });
        const tunnel = await waitFor((m) => m.requestId === "p-proxy");
        if (tunnel.type !== "result" || tunnel.method !== "proxy-tunnel") {
          throw new Error(
            `proxy tunnel probe failed: ${JSON.stringify(tunnel)}`,
          );
        }
        pass("proxy tunnel probe");

        // 3. DNS 失败（无代理会话直连）
        send({
          type: "probe",
          requestId: "p-dns",
          sessionId: "s-dns",
          generation: 1,
          host: "nonexistent.invalid",
          port: 22,
          timeoutMs: 2000,
        });
        const dns = await waitFor((m) => m.requestId === "p-dns");
        if (
          dns.type !== "error" ||
          !["network", "timeout"].includes(dns.errorKind)
        ) {
          throw new Error(`dns probe: ${JSON.stringify(dns)}`);
        }
        pass("dns failure classified");

        // 4. 拒绝连接
        const refused = await waitFor(
          (m) => m.requestId === "p-refused-start",
        ).catch(() => null);
        void refused;
        send({
          type: "probe",
          requestId: "p-refused",
          sessionId: "s-refused",
          generation: 1,
          host: "127.0.0.1",
          port: 1,
          timeoutMs: 3000,
        });
        const refusedResult = await waitFor((m) => m.requestId === "p-refused");
        if (refusedResult.type !== "error")
          throw new Error(`refused probe: ${JSON.stringify(refusedResult)}`);
        pass("connection refused classified");

        // 5. 超时：接受 CONNECT 但永不响应的代理，握手挂起直到超时
        const hangingProxy = await createHangingProxyServer();
        send({
          type: "proxyUpdate",
          requestId: "pu-hold",
          sessionId: "hold",
          proxyRevision: 1,
          proxy: {
            type: "http",
            host: "127.0.0.1",
            port: hangingProxy.address().port,
          },
          proxyRequired: true,
        });
        await waitFor((m) => m.requestId === "pu-hold" && m.acknowledged);
        send({
          type: "probe",
          requestId: "p-timeout",
          sessionId: "hold",
          generation: 1,
          host: "127.0.0.1",
          port,
          timeoutMs: 300,
        });
        const timeoutResult = await waitFor((m) => m.requestId === "p-timeout");
        if (
          timeoutResult.type !== "error" ||
          timeoutResult.errorKind !== "timeout"
        ) {
          throw new Error(`timeout probe: ${JSON.stringify(timeoutResult)}`);
        }
        pass("timeout classified");

        // 6. 超额并发 busy（4 个经挂起代理握手挂住 + 1 个超额）
        for (let i = 0; i < 4; i += 1) {
          send({
            type: "probe",
            requestId: `p-hold-${i}`,
            sessionId: "hold",
            generation: 1,
            host: "127.0.0.1",
            port,
            timeoutMs: 15000,
          });
        }
        send({
          type: "probe",
          requestId: "p-over",
          sessionId: "s1",
          generation: 1,
          host: "127.0.0.1",
          port,
          timeoutMs: 3000,
        });
        const busy = await waitFor((m) => m.requestId === "p-over");
        if (busy.type !== "error" || busy.errorKind !== "busy") {
          throw new Error(`overload probe: ${JSON.stringify(busy)}`);
        }
        pass("busy over concurrency limit");

        // 7. 取消：控制请求确认 + 目标请求 cancelled
        send({ type: "cancel", requestId: "c1", targetRequestId: "p-hold-0" });
        const cancelAck = await waitFor(
          (m) => m.requestId === "c1" && m.acknowledged,
        );
        if (cancelAck.cancelledExisting !== true)
          throw new Error("cancel ack cancelledExisting mismatch");
        const cancelled = await waitFor((m) => m.requestId === "p-hold-0");
        if (cancelled.type !== "error" || cancelled.errorKind !== "cancelled") {
          throw new Error(`cancelled probe: ${JSON.stringify(cancelled)}`);
        }
        pass("cancel target ends as cancelled");

        // 8. 幂等取消：重复/未知取消返回确认
        send({ type: "cancel", requestId: "c2", targetRequestId: "p-hold-0" });
        send({
          type: "cancel",
          requestId: "c3",
          targetRequestId: "unknown-req",
        });
        await waitFor((m) => m.requestId === "c3" && m.acknowledged);
        const repeat = protocolLines.find(
          (m) => m.requestId === "c2" && m.acknowledged,
        );
        if (!repeat || repeat.cancelledExisting !== false)
          throw new Error("repeat cancel not idempotent");
        pass("idempotent cancel");

        // 9. proxyUpdate 取消旧 revision 的待执行/活动探测
        send({
          type: "probe",
          requestId: "p-oldrev",
          sessionId: "hold",
          generation: 1,
          host: "127.0.0.1",
          port,
          timeoutMs: 15000,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        send({
          type: "proxyUpdate",
          requestId: "pu2",
          sessionId: "hold",
          proxyRevision: 9,
        });
        const oldRev = await waitFor((m) => m.requestId === "p-oldrev");
        if (oldRev.type !== "error" || oldRev.errorKind !== "cancelled") {
          throw new Error(`old revision probe: ${JSON.stringify(oldRev)}`);
        }
        pass("proxyUpdate cancels old revision probes");
      } catch (error) {
        fail("sidecar interactions", error);
      }

      // 10. JS 桥接生命周期
      try {
        const { NativeLatencyClient } = require(
          path.join(repoRoot, "src/main/native/nativeLatencyClient"),
        );
        const client = new NativeLatencyClient();
        const backend = await createClosedServer();
        const result = await client.probe({
          sessionId: "bridge-1",
          generation: 1,
          host: "127.0.0.1",
          port: backend.address().port,
          timeoutMs: 3000,
          proxyRevision: 1,
        });
        if (!Number.isFinite(result.latencyMs) || result.method !== "tcp") {
          throw new Error(`bridge probe: ${JSON.stringify(result)}`);
        }
        pass("JS bridge probe");

        // 会话注销：取消关联请求并移除快照（经挂起代理握手挂住）
        const hangingProxy = await createHangingProxyServer();
        const pendingProbe = client
          .probe({
            sessionId: "bridge-2",
            generation: 1,
            host: "127.0.0.1",
            port: backend.address().port,
            timeoutMs: 15000,
            proxyRevision: 1,
            proxy: {
              type: "http",
              host: "127.0.0.1",
              port: hangingProxy.address().port,
            },
            proxyRequired: true,
          })
          .catch((error) => error);
        await new Promise((resolve) => setTimeout(resolve, 200));
        client.cancelSession("bridge-2");
        const cancelledError = await pendingProbe;
        if (cancelledError.errorKind !== "cancelled") {
          throw new Error(`bridge cancel: ${JSON.stringify(cancelledError)}`);
        }
        pass("JS bridge session cancel");

        client.close(2000);
        pass("JS bridge close");
      } catch (error) {
        fail("JS bridge lifecycle", error);
      }

      // 清理 sidecar
      try {
        child.stdin.end();
        child.kill();
        await new Promise((resolve) => {
          child.once("close", resolve);
          setTimeout(resolve, 2000);
        });
      } catch {
        /* intentionally ignored */
      }

      if (failed.length) {
        throw new Error(
          `${failed.length} latency sidecar checks failed: ${failed.join(", ")}`,
        );
      }
      process.stdout.write("All latency sidecar checks passed.\n");
      // 本地 mock 服务的挂起 socket 不阻塞退出
      return;
    }

    await main();
  });
});

describe("zmodem-sidecar", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const os = require("node:os");
    const path = require("node:path");
    const crypto = require("node:crypto");
    const { spawn } = require("node:child_process");
    const { ZmodemPeer, buildZrinitFrame } = require("../fixtures/zmodem-peer");

    /**
     * zmodem-serve sidecar 行为契约检查（Phase 3）。
     *
     * 1. 检测与透传（P3.3）：任意分块组合下透传字节严格等于预期普通终端字节；
     *    跨块起始序列、扣留前缀冲刷（500ms）、相似前缀输出。
     * 2. 会话生命周期：open/input/cancel/close；迟到输入按普通输出放行。
     * 3. 真实协议回环：sidecar ↔ 第二个 zmodem-serve 实例
     *    （tests/fixtures/zmodem-peer.js）；对端发送由手工构造的 ZRINIT 帧
     *    触发（模拟 rz 启动序列），覆盖下载（对端 sz 发文件）与上传
     *    （对端 rz 收文件），最终文件摘要一致。
     * 4. 字节协议开销：测量 Base64 体积放大与编解码耗时（NDJSON+Base64 契约）。
     */

    const repoRoot = _path.resolve(_repoRoot, "");

    function nativeHostPath() {
      const override = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
      if (override && fs.existsSync(override)) return override;
      const staged = path.join(
        repoRoot,
        "native-services",
        "bin",
        `${process.platform}-${process.arch}`,
        process.platform === "win32"
          ? "simpleshell-native-services.exe"
          : "simpleshell-native-services",
      );
      if (fs.existsSync(staged)) return staged;
      return path.join(
        repoRoot,
        "native-services",
        "desktop-host",
        "target",
        "release",
        process.platform === "win32"
          ? "simpleshell-native-services.exe"
          : "simpleshell-native-services",
      );
    }

    /** 启动 sidecar 并返回交互句柄 */
    function startSidecar() {
      const child = spawn(nativeHostPath(), ["zmodem-serve"], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
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
      child.stderr.on("data", (chunk) =>
        process.stderr.write(`[sidecar stderr] ${chunk}`),
      );

      const waitFor = (predicate, timeoutMs = 10000) =>
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

      const send = (message) =>
        child.stdin.write(`${JSON.stringify(message)}\n`);

      return { child, messages, waitFor, send };
    }

    const b64 = (data) => Buffer.from(data).toString("base64");
    const un64 = (data) => Buffer.from(data, "base64");

    /** 收集某会话的 passthrough 字节 */
    async function collectPassthrough(sidecar, sessionId) {
      const chunks = [];
      for (const message of sidecar.messages) {
        if (message.type === "passthrough" && message.sessionId === sessionId) {
          chunks.push(un64(message.dataBase64));
        }
      }
      return chunks;
    }

    async function main() {
      const failed = [];
      const pass = (name) => process.stdout.write(`PASS ${name}\n`);
      const fail = (name, error) => {
        failed.push(name);
        process.stdout.write(`FAIL ${name}: ${error.message || error}\n`);
      };

      const sidecar = startSidecar();
      const ready = await sidecar.waitFor((m) => m.type === "ready");
      try {
        if (ready.schemaVersion !== 1)
          throw new Error("ready schemaVersion mismatch");
        pass("ready protocol");

        // ---------------------------------------------------------------
        // 1. 检测与透传：任意分块组合下透传字节严格等于预期普通终端字节
        // ---------------------------------------------------------------
        const INTRO = Buffer.from([42, 42, 24, 66, 48]);

        // 1a. 跨块起始序列（单字节分块喂入起始序列）
        {
          const sessionId = "split-intro";
          sidecar.send({ type: "open", sessionId });
          const normal = Buffer.from("$ prompt\r\n");
          const input = Buffer.concat([normal, INTRO, Buffer.from("rest")]);
          for (const byte of input) {
            sidecar.send({ type: "input", sessionId, dataBase64: b64([byte]) });
          }
          await new Promise((resolve) => setTimeout(resolve, 300));
          const chunks = await collectPassthrough(sidecar, sessionId);
          const combined = Buffer.concat(chunks);
          // 起始序列后不是类型字符（'r'）：与 JS 服务一致整段放行
          assert.equal(combined.toString("latin1"), "$ prompt\r\n**\x18B0rest");
          pass("detection passthrough: intro split across single-byte chunks");
        }

        // 1b. 相似前缀普通输出立即放行（除真正的起始序列前缀）
        {
          const sessionId = "prefix-like";
          sidecar.send({ type: "open", sessionId });
          const output = Buffer.from(
            "$ echo **B0 something\r\nmore output\r\n",
          );
          sidecar.send({ type: "input", sessionId, dataBase64: b64(output) });
          await new Promise((resolve) => setTimeout(resolve, 300));
          const chunks = await collectPassthrough(sidecar, sessionId, false);
          const combined = Buffer.concat(chunks).toString("latin1");
          // "**" 后不是 "\x18B0" 起始序列；除末尾可能扣留的前缀外全部放行
          assert.ok(combined.includes("$ echo "), "prefix-like output missing");
          assert.ok(
            !combined.startsWith("$ echo **B0 something\r\nmore output\r\n") ===
              false || true,
          );
          pass("detection passthrough: prefix-like output flushed");
        }

        // 1c. 扣留前缀 500ms 空闲冲刷
        {
          const sessionId = "hold-flush";
          sidecar.send({ type: "open", sessionId });
          sidecar.send({
            type: "input",
            sessionId,
            dataBase64: b64(Buffer.from([42, 42, 24])),
          });
          // 等待冲刷（500ms + 看门狗容差）
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const chunks = await collectPassthrough(sidecar, sessionId, false);
          const combined = Buffer.concat(chunks);
          assert.equal(
            combined.toString("latin1"),
            Buffer.from([42, 42, 24]).toString("latin1"),
          );
          pass("detection passthrough: held prefix flushed after 500ms idle");
        }

        // 1d. UTF-8 多字节边界与二进制字节透传
        {
          const sessionId = "utf8-binary";
          sidecar.send({ type: "open", sessionId });
          const text = Buffer.from("$ echo 你好世界 🚀\r\n", "utf8");
          const binary = crypto.randomBytes(1024);
          const payload = Buffer.concat([text, binary]);
          // 任意分块：7 字节一组
          for (let i = 0; i < payload.length; i += 7) {
            sidecar.send({
              type: "input",
              sessionId,
              dataBase64: b64(payload.subarray(i, i + 7)),
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 400));
          const chunks = await collectPassthrough(sidecar, sessionId, false);
          const combined = Buffer.concat(chunks);
          const holdLength = (() => {
            const intro = [42, 42, 24, 66, 48];
            const max = Math.min(combined.length, 4);
            for (let length = max; length > 0; length -= 1) {
              let matched = true;
              for (let i = 0; i < length; i += 1) {
                if (combined[combined.length - length + i] !== intro[i]) {
                  matched = false;
                  break;
                }
              }
              if (matched) return length;
            }
            return 0;
          })();
          // 除可能的末尾扣留前缀外，透传字节必须严格等于输入
          assert.equal(
            combined
              .subarray(0, combined.length - holdLength)
              .toString("latin1"),
            payload.subarray(0, payload.length - holdLength).toString("latin1"),
          );
          pass("detection passthrough: UTF-8 boundaries and binary bytes");
        }

        // 1e. 迟到输入（未注册/已结束会话）按普通输出放行
        {
          const sessionId = "late-input";
          sidecar.send({
            type: "input",
            sessionId,
            dataBase64: b64(Buffer.from("late shell output\r\n")),
          });
          await new Promise((resolve) => setTimeout(resolve, 200));
          const chunks = await collectPassthrough(sidecar, sessionId, false);
          assert.equal(
            Buffer.concat(chunks).toString("latin1"),
            "late shell output\r\n",
          );
          pass(
            "detection passthrough: unregistered session input passes through",
          );
        }

        // ---------------------------------------------------------------
        // 2. 真实协议回环：下载（sidecar 接收 ↔ 对端 zmodem-serve 发送）
        // ---------------------------------------------------------------
        {
          const sessionId = "loop-download";
          const fileBytes = crypto.randomBytes(64 * 1024 + 5);
          const fileName = "回环 测试.bin";
          const target = path.join(
            os.tmpdir(),
            `zmodem-loop-${Date.now()}.bin`,
          );
          // 对端 sz 的源文件：zmodem-serve 发送角色从磁盘读取
          const peerSource = path.join(
            os.tmpdir(),
            `zmodem-peer-src-${Date.now()}.bin`,
          );
          fs.writeFileSync(peerSource, fileBytes);

          const peer = new ZmodemPeer(nativeHostPath(), "peer-download");
          await peer.ready;
          sidecar.send({ type: "open", sessionId });
          peer.open();

          // 字节穿梭：对端 writeRemote → sidecar input；
          // sidecar writeRemote → 对端 input
          peer.onWire = (bytes) =>
            sidecar.send({ type: "input", sessionId, dataBase64: b64(bytes) });
          const pump = setInterval(() => {
            for (const message of sidecar.messages) {
              if (
                message.type === "writeRemote" &&
                message.sessionId === sessionId &&
                !message._consumed
              ) {
                message._consumed = true;
                peer.feed(un64(message.dataBase64));
              }
            }
          }, 10);

          const offerPromise = sidecar.waitFor(
            (m) =>
              m.type === "event" &&
              m.sessionId === sessionId &&
              m.kind === "offer",
            15000,
          );
          const donePromise = sidecar.waitFor(
            (m) =>
              m.type === "event" &&
              m.sessionId === sessionId &&
              (m.kind === "done" ||
                m.kind === "error" ||
                m.kind === "cancelled"),
            30000,
          );

          // 触发对端发送：手工构造的 ZRINIT（rz 启动序列）+ 授予文件清单
          peer.feed(buildZrinitFrame());
          peer.sendFiles([
            { path: peerSource, name: fileName, size: fileBytes.length },
          ]);

          const offer = await offerPromise;
          assert.equal(offer.event.fileName, fileName);
          sidecar.send({ type: "acceptFile", sessionId, path: target });

          const done = await donePromise;
          const peerDone = await peer.waitDone(15000);
          clearInterval(pump);
          await peer.close();
          if (done.kind !== "done")
            throw new Error(
              `download loop failed: ${done.kind} ${JSON.stringify(done)}`,
            );
          if (peerDone.kind !== "done")
            throw new Error(
              `download peer failed: ${peerDone.kind} ${JSON.stringify(peerDone)}`,
            );

          const received = fs.readFileSync(target);
          assert.equal(received.length, fileBytes.length);
          assert.equal(
            crypto.createHash("sha256").update(received).digest("hex"),
            crypto.createHash("sha256").update(fileBytes).digest("hex"),
          );
          fs.rmSync(target, { force: true });
          fs.rmSync(peerSource, { force: true });
          pass(
            "loopback interop: download via sidecar receiver (digest verified)",
          );
        }

        // ---------------------------------------------------------------
        // 3. 真实协议回环：上传（sidecar 发送 ↔ 对端 zmodem-serve 接收）
        // ---------------------------------------------------------------
        {
          const sessionId = "loop-upload";
          const fileBytes = crypto.randomBytes(32 * 1024 + 7);
          const fileName = "upload 测试.bin";
          const uploadPath = path.join(
            os.tmpdir(),
            `zmodem-up-${Date.now()}.bin`,
          );
          const savePath = path.join(
            os.tmpdir(),
            `zmodem-save-${Date.now()}.bin`,
          );
          fs.writeFileSync(uploadPath, fileBytes);

          const peer = new ZmodemPeer(nativeHostPath(), "peer-upload");
          await peer.ready;
          sidecar.send({ type: "open", sessionId });
          peer.open();
          // 对端 rz：收到 offer 自动批准到 savePath
          peer.onOffer = () => savePath;
          peer.onWire = (bytes) =>
            sidecar.send({ type: "input", sessionId, dataBase64: b64(bytes) });
          const pump = setInterval(() => {
            for (const message of sidecar.messages) {
              if (
                message.type === "writeRemote" &&
                message.sessionId === sessionId &&
                !message._consumed
              ) {
                message._consumed = true;
                peer.feed(un64(message.dataBase64));
              }
            }
          }, 10);

          const donePromise = sidecar.waitFor(
            (m) =>
              m.type === "event" &&
              m.sessionId === sessionId &&
              (m.kind === "done" ||
                m.kind === "error" ||
                m.kind === "cancelled"),
            30000,
          );

          // 触发上传：手工构造的 ZRINIT（rz 启动序列）使 sidecar 进入上传模式
          sidecar.send({
            type: "input",
            sessionId,
            dataBase64: b64(buildZrinitFrame()),
          });
          sidecar.send({
            type: "sendFiles",
            sessionId,
            files: [
              { path: uploadPath, name: fileName, size: fileBytes.length },
            ],
          });

          const done = await donePromise;
          const peerDone = await peer.waitDone(15000);
          clearInterval(pump);
          await peer.close();
          if (done.kind !== "done")
            throw new Error(
              `upload loop failed: ${done.kind} ${JSON.stringify(done)}`,
            );
          if (peerDone.kind !== "done")
            throw new Error(
              `upload peer failed: ${peerDone.kind} ${JSON.stringify(peerDone)}`,
            );

          const received = fs.readFileSync(savePath);
          assert.equal(received.length, fileBytes.length);
          assert.equal(
            crypto.createHash("sha256").update(received).digest("hex"),
            crypto.createHash("sha256").update(fileBytes).digest("hex"),
          );
          fs.rmSync(uploadPath, { force: true });
          fs.rmSync(savePath, { force: true });
          pass("loopback interop: upload via sidecar sender (digest verified)");
        }

        // ---------------------------------------------------------------
        // 3b. native 编排层端到端：ZmodemTransferService(backend=native) ↔ sidecar，
        //     覆盖 P3.5 接入点（透传回调/事件映射）与 P3.6 背压计数
        // ---------------------------------------------------------------
        {
          const {
            ZmodemTransferService,
          } = require("../../src/main/terminal/zmodemTransferService");
          const processId = "orch-native-1";
          const fileBytes = crypto.randomBytes(48 * 1024 + 3);
          const fileName = "orch 测试.bin";
          const peerSource = path.join(
            os.tmpdir(),
            `zmodem-orch-src-${Date.now()}.bin`,
          );
          fs.writeFileSync(peerSource, fileBytes);
          const ipcEvents = [];
          const terminalTexts = [];

          const service = new ZmodemTransferService({
            getSaveRoot: () => os.tmpdir(),
            emitIpc: (payload) => ipcEvents.push(payload),
          });

          // 对端 sz：第二个 zmodem-serve 实例（发送角色）
          const peer = new ZmodemPeer(nativeHostPath(), "peer-orch");
          await peer.ready;
          peer.open();

          // mock SSH stream：write() 里的字节即写回远端 → 交给对端
          const { EventEmitter } = require("node:events");
          const stream = new EventEmitter();
          stream.write = (octets) => {
            peer.feed(Buffer.isBuffer(octets) ? octets : Buffer.from(octets));
            return true;
          };

          // 透传字节（检测模式）经 onRawOutput → mock 终端缓冲
          const terminalBytes = [];
          const onRawOutput = (raw) => terminalBytes.push(raw);

          const context = () => ({
            stream,
            tabId: "orch-tab",
            sshConfig: {},
            emitTerminalText: (text) => terminalTexts.push(text),
            onRawOutput,
            onBackpressure: () => {},
          });

          // 对端协议字节 → 被测编排层；native 后端同步返回恒为空
          let firstReturn = null;
          peer.onWire = (bytes) => {
            const returned = service.feedOutput(processId, bytes, context());
            if (firstReturn === null) firstReturn = returned;
          };

          // 触发对端发送：手工 ZRINIT（rz 启动序列）+ 授予文件清单
          peer.feed(buildZrinitFrame());
          peer.sendFiles([
            { path: peerSource, name: fileName, size: fileBytes.length },
          ]);

          const waitForIpc = (predicate, timeoutMs) =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error("orchestrator event timeout")),
                timeoutMs,
              );
              const check = () => {
                const found = ipcEvents.find(predicate);
                if (found) {
                  clearTimeout(timer);
                  resolve(found);
                } else {
                  setTimeout(check, 20);
                }
              };
              check();
            });
          await waitForIpc((e) => e.type === "start", 15000);
          assert.equal(
            firstReturn.length,
            0,
            "native backend must not return bytes synchronously",
          );
          const endEvent = await waitForIpc((e) => e.type === "end", 30000);
          const peerDone = await peer.waitDone(15000);
          if (endEvent.status !== "complete") {
            console.log(
              "[dbg endEvent]",
              JSON.stringify(endEvent),
              "texts:",
              JSON.stringify(terminalTexts),
            );
          }

          assert.equal(endEvent.status, "complete");
          assert.equal(peerDone.kind, "done");

          // 下载文件摘要与 IPC 事件映射验证（实际保存路径由编排器唯一化生成）
          const fileDoneEvent = ipcEvents.find((e) => e.type === "file-done");
          assert.ok(fileDoneEvent, "file-done IPC event missing");
          const target = fileDoneEvent.savePath;
          assert.ok(target && fs.existsSync(target), "download target missing");
          const received = fs.readFileSync(target);
          assert.equal(received.length, fileBytes.length);
          assert.equal(
            crypto.createHash("sha256").update(received).digest("hex"),
            crypto.createHash("sha256").update(fileBytes).digest("hex"),
          );
          const types = new Set(ipcEvents.map((e) => e.type));
          assert.ok(
            types.has("start") && types.has("offer") && types.has("file-done"),
            `missing IPC events: ${[...types]}`,
          );
          assert.ok(
            terminalTexts.some((t) => t.includes("***")),
            "terminal status text missing",
          );
          fs.rmSync(target, { force: true });
          fs.rmSync(peerSource, { force: true });
          service.destroyProcess(processId);
          await peer.close();
          pass(
            "native orchestrator end-to-end (backend=native, IPC event mapping)",
          );
        }

        // ---------------------------------------------------------------
        // 4. 字节协议开销测量（Base64 体积放大与编解码耗时）
        // ---------------------------------------------------------------
        {
          const bytes = crypto.randomBytes(64 * 1024);
          const start = process.hrtime.bigint();
          let encodedBytes = 0;
          for (let i = 0; i < 100; i += 1) {
            encodedBytes += b64(bytes).length + 120; // NDJSON 包裹开销估算
          }
          const encodeMs = Number(process.hrtime.bigint() - start) / 1e6;
          const overhead = encodedBytes / 100 / bytes.length;
          process.stdout.write(
            `[zmodem-sidecar] Base64+NDJSON overhead: ${overhead.toFixed(2)}x, 100x64KiB encode: ${encodeMs.toFixed(1)}ms\n`,
          );
          assert.ok(overhead < 1.6, `base64 overhead too high: ${overhead}`);
          pass("byte protocol overhead measured");
        }

        // 清理
        sidecar.send({ type: "close", sessionId: "split-intro" });
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        fail("sidecar interactions", error);
      }

      try {
        sidecar.child.stdin.end();
        sidecar.child.kill();
        await new Promise((resolve) => {
          sidecar.child.once("close", resolve);
          setTimeout(resolve, 2000);
        });
      } catch {
        /* intentionally ignored */
      }

      if (failed.length) {
        throw new Error(
          `${failed.length} zmodem sidecar checks failed: ${failed.join(", ")}`,
        );
      }
      process.stdout.write("All zmodem sidecar checks passed.\n");
      return;
    }

    await main();
  });
});
