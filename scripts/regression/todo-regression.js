/* eslint-disable no-console */
const assert = require("node:assert/strict");
const net = require("node:net");
const { EventEmitter } = require("node:events");
const { generateKeyPairSync } = require("node:crypto");
const { Server } = require("ssh2");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message || "Timeout")), timeoutMs),
    ),
  ]);
}

function waitForEvent(emitter, eventName, timeoutMs = 3000, predicate = null) {
  return withTimeout(
    new Promise((resolve) => {
      const handler = (...args) => {
        if (predicate && !predicate(...args)) {
          return;
        }
        emitter.removeListener(eventName, handler);
        resolve(args);
      };
      emitter.on(eventName, handler);
    }),
    timeoutMs,
    `等待事件超时: ${eventName}`,
  );
}

function createTestStream() {
  const stream = new EventEmitter();
  stream.writable = true;
  stream.destroyed = false;
  stream.closed = false;
  stream.writes = [];
  stream.pause = () => {};
  stream.resume = () => {};
  stream.setWindow = () => {};
  stream.write = (chunk) => {
    stream.writes.push(chunk);
    return true;
  };
  stream.close = () => {
    stream.closed = true;
    stream.emit("close");
  };
  return stream;
}

function createFakeConn() {
  const conn = new EventEmitter();
  conn.end = () => {};
  conn.destroy = () => {};
  return conn;
}

async function startSshServer({ username = "u", password = "p" } = {}) {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "pkcs1", format: "pem" },
  });

  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    client
      .on("authentication", (ctx) => {
        if (
          ctx.method === "password" &&
          ctx.username === username &&
          ctx.password === password
        ) {
          ctx.accept();
          return;
        }
        ctx.reject();
      })
      .on("ready", () => {
        client.on("session", (accept) => {
          const session = accept();
          session.on("pty", (acceptPty) => {
            if (acceptPty) acceptPty();
          });
          session.on("shell", (acceptShell) => {
            const stream = acceptShell();
            stream.write("welcome\n");
            stream.on("data", (data) => {
              stream.write(data);
            });
          });
          session.on("exec", (acceptExec, _rejectExec, info) => {
            const stream = acceptExec();
            const command = String(info?.command || "");
            if (command.includes("echo test")) {
              stream.write("test\n");
            } else {
              stream.write("ok\n");
            }
            stream.exit(0);
            stream.end();
          });
          session.on("sftp", (acceptSftp) => {
            const sftpStream = acceptSftp();
            // 这里不实现完整 SFTP，仅满足 validateConnection 的回调可成功
            sftpStream.on("REALPATH", (reqid) => {
              sftpStream.name(reqid, [
                { filename: "/", longname: "/", attrs: {} },
              ]);
            });
          });
        });
      });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = Number(address.port);

  return {
    port,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function startHttpConnectProxy(port = 0) {
  const server = net.createServer((clientSocket) => {
    let headerBuffer = Buffer.alloc(0);
    let connected = false;

    const onData = (chunk) => {
      if (connected) return;
      headerBuffer = Buffer.concat([headerBuffer, chunk]);
      const headerEnd = headerBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      connected = true;
      const headerText = headerBuffer.slice(0, headerEnd).toString("utf8");
      const firstLine = (headerText.split("\r\n")[0] || "").trim();
      const match = firstLine.match(/^CONNECT\s+([^\s]+)\s+HTTP\/1\.[01]$/i);
      if (!match) {
        clientSocket.end("HTTP/1.1 405 Method Not Allowed\r\n\r\n");
        return;
      }

      const target = match[1];
      const [targetHost, targetPortRaw] = target.split(":");
      const targetPort = Number(targetPortRaw);
      if (!targetHost || !Number.isFinite(targetPort)) {
        clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        return;
      }

      const upstream = net.connect(targetPort, targetHost);
      upstream.once("connect", () => {
        clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        const rest = headerBuffer.slice(headerEnd + 4);
        if (rest.length > 0) {
          upstream.write(rest);
        }
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      });

      upstream.once("error", () => {
        try {
          clientSocket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        } catch {
          // ignore
        }
      });
    };

    clientSocket.on("data", onData);
    clientSocket.on("error", () => {});
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actualPort = Number(server.address().port);
  return {
    port: actualPort,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function installElectronMock() {
  const electronPath = require.resolve("electron");
  const previous = require.cache[electronPath];

  const sentMessages = [];
  const mockWindow = {
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => {
        sentMessages.push({ channel, payload });
      },
    },
  };

  const ipcMain = {
    handlers: new Map(),
    handle(channel, handler) {
      this.handlers.set(channel, handler);
    },
    removeHandler(channel) {
      this.handlers.delete(channel);
    },
    on() {},
  };

  require.cache[electronPath] = {
    id: electronPath,
    filename: electronPath,
    loaded: true,
    exports: {
      BrowserWindow: {
        getAllWindows: () => [mockWindow],
      },
      ipcMain,
    },
  };

  return {
    sentMessages,
    ipcMain,
    restore() {
      if (previous) {
        require.cache[electronPath] = previous;
      } else {
        delete require.cache[electronPath];
      }
    },
  };
}

function clearRequire(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
}

async function testAandProxyRecovery() {
  const SSHPool = require(path.join(ROOT, "src/core/connection/ssh-pool"));
  const sshServer = await startSshServer();
  let proxyServer = null;
  const pool = new SSHPool({
    connectionTimeout: 5000,
    healthCheckInterval: 120000,
    idleTimeout: 1000,
  });
  pool.initialize();

  // 加快自动重连节奏，避免脚本等待过久
  pool.reconnectionManager.config.initialDelay = 50;
  pool.reconnectionManager.config.maxDelay = 200;
  pool.reconnectionManager.config.jitter = 0;
  pool.reconnectionManager.config.totalTimeCapMs = 10000;
  pool.reconnectionManager.config.networkProbe.intervalMs = 150;
  pool.reconnectionManager.config.networkProbe.tcpTimeoutMs = 120;
  pool.reconnectionManager.config.fastReconnect.delay = 20;
  pool.reconnectionManager.config.fastReconnect.maxAttempts = 2;
  pool.reconnectionManager.config.smartReconnect.enabled = false;

  try {
    // A1: SSH 正常连接、复用、关闭 tab、手动断开
    const cfg = {
      host: "127.0.0.1",
      port: sshServer.port,
      username: "u",
      password: "p",
      tabId: "reg-a-1",
    };

    const conn1 = await pool.getConnection(cfg);
    assert.equal(conn1.ready, true, "SSH 初始连接应成功");

    const conn2 = await pool.getConnection(cfg);
    assert.equal(conn1, conn2, "同一 tab 配置应复用连接");
    assert.equal(conn2.refCount, 2, "复用后引用计数应递增");

    // 关闭 tab：释放引用
    pool.releaseConnection(conn2.key, cfg.tabId);
    assert.equal(
      pool.connections.get(conn2.key)?.refCount,
      1,
      "释放一次后 refCount 应为 1",
    );

    // 手动断开
    pool.closeConnection(conn2.key);
    await delay(100);
    assert.equal(
      pool.connections.has(conn2.key),
      false,
      "手动断开后连接应被移除",
    );

    // A2(前半): 代理开启/关闭场景均可连接
    proxyServer = await startHttpConnectProxy(0);

    const proxyCfg = {
      host: "127.0.0.1",
      port: sshServer.port,
      username: "u",
      password: "p",
      tabId: "reg-a-2",
      proxy: {
        type: "http",
        host: "127.0.0.1",
        port: proxyServer.port,
      },
    };

    const proxyConn = await pool.getConnection(proxyCfg);
    assert.equal(proxyConn.ready, true, "代理模式连接应成功");
    assert.equal(proxyConn.usingProxy, true, "代理模式应标记 usingProxy=true");

    pool.closeConnection(proxyConn.key);
    await delay(100);

    // A2(后半): 代理短时不可用后自动恢复
    await proxyServer.close();
    proxyServer = null;

    const recoverProxy = await startHttpConnectProxy(0);
    const unavailableProxyPort = recoverProxy.port;
    await recoverProxy.close();

    const unstableProxyCfg = {
      host: "127.0.0.1",
      port: sshServer.port,
      username: "u",
      password: "p",
      tabId: "reg-a-3",
      proxy: {
        type: "http",
        host: "127.0.0.1",
        port: unavailableProxyPort,
      },
    };

    const unstableConn = await pool.getConnection(unstableProxyCfg);
    assert.equal(
      unstableConn.ready,
      false,
      "代理不可用时应进入待重连状态而非立即 ready",
    );

    // 延迟启动代理，验证自动恢复
    setTimeout(() => {
      void startHttpConnectProxy(unavailableProxyPort).then((srv) => {
        proxyServer = srv;
      });
    }, 300);

    await withTimeout(
      pool.reconnectionManager.waitForReconnect(unstableConn.key, 10000),
      12000,
      "代理恢复后自动重连超时",
    );

    const recovered = pool.connections.get(unstableConn.key);
    assert.ok(recovered, "自动重连后连接应仍在池中");
    assert.equal(recovered.ready, true, "自动重连成功后连接应 ready");

    pool.closeConnection(unstableConn.key);
    await delay(100);

    return true;
  } finally {
    try {
      await pool.shutdown();
    } catch {
      // ignore
    }
    if (proxyServer) {
      try {
        await proxyServer.close();
      } catch {
        // ignore
      }
    }
    await sshServer.close();
  }
}

async function testBReconnectNetworkJitter() {
  const ReconnectionManager = require(
    path.join(ROOT, "src/core/connection/reconnection-manager"),
  );

  const manager = new ReconnectionManager({
    maxRetries: 3,
    initialDelay: 20,
    maxDelay: 40,
    jitter: 0,
    totalTimeCapMs: 3000,
    networkProbe: {
      enabled: false,
      intervalMs: 10,
      tcpTimeoutMs: 10,
    },
    smartReconnect: {
      enabled: false,
      analyzePattern: false,
      adaptiveDelay: false,
      networkQualityThreshold: 0.7,
    },
    fastReconnect: {
      enabled: true,
      maxAttempts: 2,
      delay: 5,
      conditions: ["ECONNRESET", "EPIPE"],
    },
  });
  manager.initialize();

  const jitterCases = [
    { code: "ECONNRESET", message: "socket hang up ECONNRESET" },
    { code: "EPIPE", message: "write EPIPE" },
    { code: "ETIMEDOUT", message: "connect ETIMEDOUT" },
  ];

  for (const jitter of jitterCases) {
    const sessionId = `sess-net-${jitter.code}`;
    const oldConn = createFakeConn();
    const newConn = createFakeConn();
    manager.createNewConnection = async () => newConn;
    manager.validateConnection = async () => true;

    manager.registerSession(
      sessionId,
      oldConn,
      { host: "127.0.0.1", port: 22, username: "u" },
      { autoStart: false, state: "connected" },
    );

    const successEvent = waitForEvent(
      manager,
      "reconnectSuccess",
      3000,
      ({ sessionId: sid }) => sid === sessionId,
    );

    oldConn.emit(
      "error",
      Object.assign(new Error(jitter.message), {
        code: jitter.code,
      }),
    );

    await successEvent;
    const status = manager.getSessionStatus(sessionId);
    assert.ok(status, `重连成功后会话应保留: ${jitter.code}`);
    assert.equal(
      status.state,
      "connected",
      `网络抖动后应恢复到 connected: ${jitter.code}`,
    );
  }

  manager.shutdown();
  return true;
}

async function testBAuthFailureNoInfiniteRetry() {
  const ReconnectionManager = require(
    path.join(ROOT, "src/core/connection/reconnection-manager"),
  );

  const manager = new ReconnectionManager({
    maxRetries: 5,
    initialDelay: 20,
    maxDelay: 40,
    jitter: 0,
    totalTimeCapMs: 2000,
    networkProbe: {
      enabled: false,
      intervalMs: 10,
      tcpTimeoutMs: 10,
    },
    smartReconnect: {
      enabled: false,
      analyzePattern: false,
      adaptiveDelay: false,
      networkQualityThreshold: 0.7,
    },
    fastReconnect: {
      enabled: false,
      maxAttempts: 0,
      delay: 0,
      conditions: [],
    },
  });
  manager.initialize();

  const conn = createFakeConn();
  manager.registerSession(
    "sess-auth",
    conn,
    { host: "127.0.0.1", port: 22, username: "u" },
    { autoStart: false, state: "connected" },
  );

  let scheduledCount = 0;
  manager.on("reconnectScheduled", ({ sessionId }) => {
    if (sessionId === "sess-auth") {
      scheduledCount += 1;
    }
  });

  const abandoned = waitForEvent(
    manager,
    "reconnectAbandoned",
    2000,
    ({ sessionId }) => sessionId === "sess-auth",
  );

  conn.emit("error", new Error("All configured authentication methods failed"));

  await abandoned;
  assert.equal(scheduledCount, 0, "认证失败（未显式开启）不应进入重连调度");
  assert.equal(
    manager.getSessionStatus("sess-auth"),
    null,
    "放弃后会话应被清理，避免无限重试",
  );
  manager.shutdown();
  return true;
}

async function testBHealthCheckKeepsActiveSession() {
  const SSHPool = require(path.join(ROOT, "src/core/connection/ssh-pool"));
  const pool = new SSHPool({
    connectionTimeout: 2000,
    healthCheckInterval: 120000,
    idleTimeout: 1000,
  });

  // 使用可控 mock，避免真实重连行为
  let requestAutoReconnectCalls = 0;
  let registerSessionCalls = 0;
  pool.reconnectionManager = {
    getSessionStatus() {
      return null;
    },
    async requestAutoReconnect() {
      requestAutoReconnectCalls += 1;
    },
    registerSession() {
      registerSessionCalls += 1;
    },
  };

  const activeKey = "active-unhealthy";
  const idleKey = "idle-unhealthy";
  pool.connections.set(activeKey, {
    key: activeKey,
    ready: false,
    refCount: 1,
    lastUsed: Date.now(),
    client: createFakeConn(),
    config: { host: "127.0.0.1", port: 22, username: "u" },
  });
  pool.connections.set(idleKey, {
    key: idleKey,
    ready: false,
    refCount: 0,
    lastUsed: Date.now() - 60_000,
    client: createFakeConn(),
    config: { host: "127.0.0.1", port: 22, username: "u" },
  });

  const closedKeys = [];
  pool.closeConnection = (key) => {
    closedKeys.push(key);
    pool.connections.delete(key);
  };

  const summaryPromise = waitForEvent(
    pool,
    "healthCheckCompleted",
    1000,
    () => true,
  );
  pool.performHealthCheck();
  const [finalSummary] = await summaryPromise;

  assert.equal(
    closedKeys.includes(activeKey),
    false,
    "活跃不健康连接不应被健康检查直接关闭",
  );
  assert.equal(
    closedKeys.includes(idleKey),
    true,
    "空闲无引用不健康连接应被关闭",
  );
  assert.ok(
    registerSessionCalls + requestAutoReconnectCalls >= 1,
    "活跃不健康连接应进入重连流程",
  );
  assert.ok(
    Number(finalSummary.redirectedToRecovery) >= 1,
    "健康检查摘要应记录转入重连数量",
  );
  return true;
}

async function testCSessionRecoveryAndWaitProtection() {
  const electronMock = installElectronMock();
  try {
    clearRequire(path.join(ROOT, "src/core/ipc/handlers/sshHandlers.js"));

    const SSHHandlers = require(
      path.join(ROOT, "src/core/ipc/handlers/sshHandlers"),
    );
    const childProcesses = new Map();

    const sshPoolEmitter = new EventEmitter();
    sshPoolEmitter.connections = new Map();
    sshPoolEmitter.reconnectionManager = null;

    const connectionManager = {
      sshConnectionPool: sshPoolEmitter,
      releaseSSHConnection() {},
      addTabReference() {},
      getLastConnections() {
        return [];
      },
    };

    const handler = new SSHHandlers({
      childProcesses,
      connectionManager,
      sftpCore: {},
      sftpTransfer: {},
      getNextProcessId: () => 1001,
      getLatencyHandlers: () => null,
    });

    // C1/C2: 重连成功后自动恢复 shell，且可继续输出
    let shellCreateCount = 0;
    const restoredStream = createTestStream();
    const restoredClient = {
      shell(_opts, cb) {
        shellCreateCount += 1;
        cb(null, restoredStream);
      },
    };

    const connectionKey = "ck-recover-1";
    const processId = 1001;
    const tabId = "tab-recover-1";
    const config = {
      host: "127.0.0.1",
      port: 22,
      username: "u",
      tabId,
    };

    const processInfo = {
      type: "ssh2",
      process: null,
      stream: null,
      connectionInfo: { key: connectionKey },
      config,
      ready: false,
      listeners: new Set(),
      editorMode: false,
      commandBuffer: "",
      lastOutputLines: [],
      outputBuffer: "",
      isRemote: true,
    };
    childProcesses.set(processId, processInfo);
    childProcesses.set(tabId, { ...processInfo });
    handler._bindConnectionProcess(connectionKey, processId, tabId);

    const latestConnectionInfo = {
      key: connectionKey,
      client: restoredClient,
      config,
      intentionalClose: false,
    };
    sshPoolEmitter.connections.set(connectionKey, latestConnectionInfo);

    sshPoolEmitter.emit("connectionReconnected", {
      key: connectionKey,
      connection: latestConnectionInfo,
    });
    await delay(80);

    const updatedProcess = childProcesses.get(processId);
    assert.ok(updatedProcess?.stream, "重连后应恢复 stream");
    assert.equal(shellCreateCount, 1, "重连恢复时仅应创建一次 shell");

    restoredStream.emit("data", Buffer.from("hello-after-reconnect"));
    await delay(40);
    const hasRecoveredOutput = electronMock.sentMessages.some(
      ({ channel, payload }) =>
        channel === `process:output:${processId}` &&
        String(payload).includes("hello-after"),
    );
    assert.equal(hasRecoveredOutput, true, "恢复后应可继续输出");

    // 恢复后可继续输入（write 路径可用）
    const restored = childProcesses.get(processId);
    assert.ok(restored?.stream, "恢复后应存在可写 stream");
    const beforeWriteCount = restored.stream.writes.length;
    const writeResult = restored.stream.write("input-after-reconnect\n");
    assert.equal(writeResult, true, "恢复后 stream.write 应可成功");
    assert.equal(
      restored.stream.writes.length,
      beforeWriteCount + 1,
      "恢复后输入应写入 stream",
    );

    // 再次触发同一连接恢复，不应重复创建 stream（幂等）
    sshPoolEmitter.emit("connectionReconnected", {
      key: connectionKey,
      connection: latestConnectionInfo,
    });
    await delay(40);
    assert.equal(shellCreateCount, 1, "已有可用 stream 时不应重复建流");

    // C3: 等待重连阶段旧 error 不应提前失败
    const waitProcessId = 2001;
    const waitTabId = "tab-wait-1";
    const waitConnectionKey = "ck-wait-1";
    const waitConfig = {
      host: "127.0.0.1",
      port: 22,
      username: "u",
      tabId: waitTabId,
    };
    const waitSsh = new EventEmitter();
    const waitClient = {
      shell(_opts, cb) {
        cb(null, createTestStream());
      },
    };
    sshPoolEmitter.connections.set(waitConnectionKey, {
      key: waitConnectionKey,
      client: waitClient,
      config: waitConfig,
      intentionalClose: false,
    });
    sshPoolEmitter.reconnectionManager = {
      getSessionStatus(key) {
        if (key === waitConnectionKey) {
          return { state: "pending" };
        }
        return null;
      },
      waitForReconnect(key) {
        if (key !== waitConnectionKey) {
          return Promise.reject(new Error("unexpected key"));
        }
        return delay(60).then(() => true);
      },
    };

    const waitProcessInfo = {
      ...processInfo,
      stream: null,
      ready: false,
      connectionInfo: { key: waitConnectionKey },
      config: waitConfig,
    };
    childProcesses.set(waitProcessId, waitProcessInfo);
    childProcesses.set(waitTabId, { ...waitProcessInfo });

    const waitPromise = handler._waitForSSHReady(
      waitSsh,
      waitProcessId,
      waitConfig,
      { key: waitConnectionKey },
    );

    // 模拟旧连接 error 回流，应被忽略
    waitSsh.emit("error", new Error("stale old-socket error"));
    waitSsh.emit("error", new Error("stale old-socket error 2"));

    const waitResult = await withTimeout(
      waitPromise,
      3000,
      "等待重连保护验证超时",
    );
    assert.equal(waitResult, waitProcessId, "等待重连成功后应返回 processId");

    return true;
  } finally {
    electronMock.restore();
  }
}

async function testDReconnectHandlersNoLeak() {
  const electronMock = installElectronMock();
  try {
    clearRequire(path.join(ROOT, "src/core/ipc/ipcResponse.js"));
    clearRequire(path.join(ROOT, "src/core/ipc/handlers/reconnectHandlers.js"));

    const { registerReconnectHandlers, cleanupReconnectHandlers } = require(
      path.join(ROOT, "src/core/ipc/handlers/reconnectHandlers"),
    );

    const pool = new EventEmitter();
    pool.getConnectionKeyByTabId = () => null;
    pool.getConnectionStatus = () => null;
    pool.reconnectionManager = new EventEmitter();

    registerReconnectHandlers(pool);

    const eventNames = [
      "reconnectStarted",
      "reconnectScheduled",
      "reconnectSuccess",
      "reconnectFailed",
      "reconnectAbandoned",
    ];
    eventNames.forEach((eventName) => {
      assert.equal(
        pool.reconnectionManager.listenerCount(eventName),
        1,
        `首次注册后监听器数量应为1: ${eventName}`,
      );
    });

    // 重复注册后仍应维持单监听（内部先 cleanup）
    registerReconnectHandlers(pool);
    eventNames.forEach((eventName) => {
      assert.equal(
        pool.reconnectionManager.listenerCount(eventName),
        1,
        `重复注册后监听器数量仍应为1: ${eventName}`,
      );
    });

    pool.reconnectionManager.emit("reconnectSuccess", {
      sessionId: "tab:tab-leak-check:127.0.0.1:22:u",
      attempts: 1,
    });
    const successEvents = electronMock.sentMessages.filter(
      ({ channel }) => channel === "reconnect-success",
    );
    assert.equal(successEvents.length, 1, "重连成功广播不应重复");

    cleanupReconnectHandlers();
    eventNames.forEach((eventName) => {
      assert.equal(
        pool.reconnectionManager.listenerCount(eventName),
        0,
        `cleanup 后监听器应清零: ${eventName}`,
      );
    });
    assert.equal(
      pool.listenerCount("connectionLost"),
      0,
      "cleanup 后 connectionLost 监听器应清零",
    );

    return true;
  } finally {
    electronMock.restore();
  }
}

async function run() {
  const results = [];
  const tasks = [
    {
      id: "A1_A2",
      name: "A. SSH 正常连接/复用/关闭/手动断开 + 代理开启关闭与短时不可用自动恢复",
      fn: testAandProxyRecovery,
    },
    {
      id: "B1",
      name: "B. 网络抖动(ECONNRESET/EPIPE/ETIMEDOUT)自动重连",
      fn: testBReconnectNetworkJitter,
    },
    {
      id: "B2",
      name: "B. 认证失败不会无限重试（默认不开启）",
      fn: testBAuthFailureNoInfiniteRetry,
    },
    {
      id: "B3",
      name: "B. 健康检查不误杀活跃连接",
      fn: testBHealthCheckKeepsActiveSession,
    },
    {
      id: "C1_C2_C3",
      name: "C. 自动恢复后终端可继续交互 + 避免已恢复但终端仍死 + 等待重连期间旧错误不打断",
      fn: testCSessionRecoveryAndWaitProtection,
    },
    {
      id: "D1",
      name: "D. 重复初始化/清理后监听器数量稳定（无泄漏）",
      fn: testDReconnectHandlersNoLeak,
    },
  ];

  for (const task of tasks) {
    const start = Date.now();
    try {
      await task.fn();
      results.push({
        id: task.id,
        name: task.name,
        status: "passed",
        durationMs: Date.now() - start,
      });
      console.log(`PASS ${task.id} - ${task.name}`);
    } catch (error) {
      results.push({
        id: task.id,
        name: task.name,
        status: "failed",
        durationMs: Date.now() - start,
        error: error?.stack || error?.message || String(error),
      });
      console.error(`FAIL ${task.id} - ${task.name}`);
      console.error(error?.stack || error);
    }
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.length - passed;
  const summary = { passed, failed, results };

  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(summary, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

void run();
