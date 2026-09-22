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

const repoRoot = path.resolve(__dirname, "..");

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

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
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
      proxy: { type: "http", host: "127.0.0.1", port: proxy.address().port },
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
      throw new Error(`proxy tunnel probe failed: ${JSON.stringify(tunnel)}`);
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
    send({ type: "cancel", requestId: "c3", targetRequestId: "unknown-req" });
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
    process.exitCode = 1;
    throw new Error(
      `${failed.length} latency sidecar checks failed: ${failed.join(", ")}`,
    );
  }
  process.stdout.write("All latency sidecar checks passed.\n");
  // 本地 mock 服务的挂起 socket 不阻塞退出
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
