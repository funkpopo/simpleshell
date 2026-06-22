const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const { EventEmitter } = require("node:events");
const { generateKeyPairSync } = require("node:crypto");
const { Server } = require("ssh2");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

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

function installElectronMock(options = {}) {
  const electronPath = require.resolve("electron");
  const previous = require.cache[electronPath];
  const mockApp = options.app || {
    isPackaged: false,
    getPath() {
      return ROOT;
    },
    getAppPath() {
      return ROOT;
    },
  };

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
      app: mockApp,
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

function injectMock(modulePath, exportsValue, mockedModules) {
  const id = require.resolve(modulePath);
  mockedModules.push({ id, previous: require.cache[id] });
  require.cache[id] = {
    id,
    filename: id,
    loaded: true,
    exports: exportsValue,
  };
}

function restoreMockedModules(mockedModules) {
  for (const { id, previous } of mockedModules) {
    if (previous) {
      require.cache[id] = previous;
    } else {
      delete require.cache[id];
    }
  }
}

async function testAandProxyRecovery() {
  const SSHPool = require(path.join(ROOT, "src/core/connection/ssh-pool"));
  const sshServer = await startSshServer();
  let proxyServer = null;
  let proxyStartTimer = null;
  let pendingProxyStart = null;
  const pool = new SSHPool({
    connectionTimeout: 5000,
    healthCheckInterval: 120000,
    idleTimeout: 1000,
  });
  pool.initialize();

  // 加快自动重连节奏，避免脚本等待过久
  pool.reconnectionManager.config.maxRetries = 10;
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
    proxyStartTimer = setTimeout(() => {
      proxyStartTimer = null;
      pendingProxyStart = startHttpConnectProxy(unavailableProxyPort).then(
        (srv) => {
          pendingProxyStart = null;
          proxyServer = srv;
          return srv;
        },
      );
      pendingProxyStart.catch(() => {
        pendingProxyStart = null;
      });
    }, 300);

    await withTimeout(
      pool.reconnectionManager.waitForReconnect(unstableConn.key, 10000),
      12000,
      "代理恢复后自动重连超时",
    );

    if (pendingProxyStart) {
      await pendingProxyStart;
    }

    const recovered = pool.connections.get(unstableConn.key);
    assert.ok(recovered, "自动重连后连接应仍在池中");
    assert.equal(recovered.ready, true, "自动重连成功后连接应 ready");

    pool.closeConnection(unstableConn.key);
    await delay(100);

    return true;
  } finally {
    if (proxyStartTimer) {
      clearTimeout(proxyStartTimer);
      proxyStartTimer = null;
    }
    if (pendingProxyStart) {
      try {
        const srv = await pendingProxyStart;
        await srv.close();
      } catch {
        // ignore
      }
      pendingProxyStart = null;
    }
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

    let resetResizeCalls = 0;
    const resetResizeTargets = [];
    const terminalIOMailboxManager = {
      emitOutput(processId, payload) {
        electronMock.sentMessages.push({
          channel: `process:output:${processId}`,
          payload,
        });
        return true;
      },
      createMailbox(processId) {
        return {
          emitOutput(payload) {
            electronMock.sentMessages.push({
              channel: `process:output:${processId}`,
              payload,
            });
            return true;
          },
          setBufferedBytes() {
            return true;
          },
          requestResize() {
            return true;
          },
          pause() {
            return true;
          },
          resume() {
            return true;
          },
          destroy() {
            return true;
          },
        };
      },
      setBufferedBytes() {
        return true;
      },
      resetResizeState(processId) {
        resetResizeCalls += 1;
        resetResizeTargets.push(processId);
        return true;
      },
      destroyProcess() {
        return true;
      },
    };

    const handler = new SSHHandlers({
      childProcesses,
      connectionManager,
      sftpCore: {},
      sftpTransfer: {},
      getNextProcessId: () => 1001,
      getLatencyHandlers: () => null,
      terminalIOMailboxManager,
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
    assert.ok(
      resetResizeCalls >= 1 && resetResizeTargets.includes(processId),
      "重连恢复时应重置终端尺寸状态",
    );
    const restoredEvent = electronMock.sentMessages.find(
      ({ channel, payload }) =>
        channel === "terminal:session-restored" &&
        payload?.tabId === tabId &&
        payload?.processId === processId,
    );
    assert.ok(restoredEvent, "重连恢复后应广播终端会话恢复事件");

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

    // C2.1: shell 恢复失败时应明确广播失败事件，避免前端停留在“已恢复”假象
    const failedConnectionKey = "ck-recover-fail";
    const failedProcessId = 1002;
    const failedTabId = "tab-recover-fail";
    const failedConfig = {
      host: "127.0.0.1",
      port: 22,
      username: "u",
      tabId: failedTabId,
    };
    const failedClient = {
      shell(_opts, cb) {
        cb(new Error("restore shell failed"));
      },
    };
    const failedProcessInfo = {
      ...processInfo,
      stream: null,
      ready: false,
      connectionInfo: { key: failedConnectionKey },
      config: failedConfig,
    };
    childProcesses.set(failedProcessId, failedProcessInfo);
    childProcesses.set(failedTabId, { ...failedProcessInfo });
    handler._bindConnectionProcess(
      failedConnectionKey,
      failedProcessId,
      failedTabId,
    );

    sshPoolEmitter.connections.set(failedConnectionKey, {
      key: failedConnectionKey,
      client: failedClient,
      config: failedConfig,
      intentionalClose: false,
    });
    sshPoolEmitter.emit("connectionReconnected", {
      key: failedConnectionKey,
      connection: sshPoolEmitter.connections.get(failedConnectionKey),
    });
    await delay(80);

    const restoreFailedEvent = electronMock.sentMessages.find(
      ({ channel, payload }) =>
        channel === "terminal:session-restore-failed" &&
        payload?.tabId === failedTabId &&
        String(payload?.error || "").includes("restore shell failed"),
    );
    assert.ok(restoreFailedEvent, "shell 恢复失败时应广播失败事件");

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

async function testD2AppQuitReleasesAllResources() {
  const appCleanupPath = path.join(ROOT, "src/core/app/appCleanup");
  const loggerPath = path.join(ROOT, "src/core/utils/logger");
  const resourceManagerPath = path.join(
    ROOT,
    "src/core/utils/mainProcessResourceManager",
  );
  const processManagerPath = path.join(ROOT, "src/core/process/processManager");
  const connectionManagerPath = path.join(ROOT, "src/modules/connection");
  const runtimeFileLifecyclePath = path.join(
    ROOT,
    "src/core/utils/runtimeFileLifecycle",
  );
  const configServicePath = path.join(ROOT, "src/services/configService");
  const commandHistoryPath = path.join(
    ROOT,
    "src/modules/terminal/command-history",
  );
  const filemanagementServicePath = path.join(
    ROOT,
    "src/modules/filemanagement/filemanagementService",
  );

  const mockedModules = [];
  const resolveId = (p) => require.resolve(p);
  const injectMock = (modulePath, exportsValue) => {
    const id = resolveId(modulePath);
    mockedModules.push({ id, previous: require.cache[id] });
    require.cache[id] = {
      id,
      filename: id,
      loaded: true,
      exports: exportsValue,
    };
  };
  const restoreMocks = () => {
    for (const { id, previous } of mockedModules) {
      if (previous) {
        require.cache[id] = previous;
      } else {
        delete require.cache[id];
      }
    }
  };

  let perTabTransferCleanupCalls = [];
  let filemanagementCleanupCount = 0;
  let connectionCleanupCount = 0;
  let releasedSshCount = 0;
  let runtimeStopCount = 0;
  const runtimeClearCalls = [];

  const processMap = new Map([
    [
      "tab-d2",
      {
        type: "ssh2",
        process: {
          stdout: { removeAllListeners() {} },
          stderr: { removeAllListeners() {} },
          kill() {},
        },
        stream: {
          close() {},
        },
        connectionInfo: {
          key: "ssh:d2",
        },
        config: {
          tabId: "tab-d2",
        },
      },
    ],
  ]);

  const reconnectTimer = setTimeout(() => {}, 10_000);
  const sshHealthTimer = setInterval(() => {}, 10_000);
  const telnetHealthTimer = setInterval(() => {}, 10_000);

  let filemanagementStats = {
    transferEngineMode: "native-sidecar-transfer-v1",
    activeTransferCount: 2,
    throughputBytesPerSec: 1024,
    latestTransferThroughput: 512,
    failureRate: 0,
    avgCancelLatencyMs: 10,
    eventLoopLag: {
      latestMs: 2,
      maxMs: 5,
      avgMs: 3,
      samples: 4,
    },
    pool: {
      workerCount: 1,
      targetWorkerCount: 2,
      maxWorkers: 4,
      queuedTasks: 1,
      pendingTasks: 2,
      pendingInits: 0,
      activeTransfers: 2,
      cancelledTransfers: 0,
      maxQueueSize: 32,
      shutdown: false,
    },
    poolIdleShutdownScheduled: true,
  };

  const connectionManagerMock = {
    sshConnectionPool: {
      connections: new Map([["ssh:d2", { key: "ssh:d2" }]]),
      tabReferences: new Map([["tab-d2", "ssh:d2"]]),
      healthCheckTimer: sshHealthTimer,
      reconnectTimerRef: reconnectTimer,
      reconnectionManager: {
        sessions: new Map([["ssh:d2", { id: "ssh:d2" }]]),
        reconnectTimers: new Map([["ssh:d2", reconnectTimer]]),
      },
      removeTabReference(tabId) {
        this.tabReferences.delete(tabId);
      },
    },
    telnetConnectionPool: {
      connections: new Map([["telnet:d2", { key: "telnet:d2" }]]),
      tabReferences: new Map([["tab-d2-telnet", "telnet:d2"]]),
      healthCheckTimer: telnetHealthTimer,
    },
    releaseSSHConnection() {
      releasedSshCount += 1;
    },
    cleanup() {
      connectionCleanupCount += 1;

      this.sshConnectionPool.connections.clear();
      this.sshConnectionPool.tabReferences.clear();
      if (this.sshConnectionPool.healthCheckTimer) {
        clearInterval(this.sshConnectionPool.healthCheckTimer);
        this.sshConnectionPool.healthCheckTimer = null;
      }

      const reconnectTimers =
        this.sshConnectionPool.reconnectionManager.reconnectTimers;
      reconnectTimers.forEach((timer) => clearTimeout(timer));
      reconnectTimers.clear();
      this.sshConnectionPool.reconnectionManager.sessions.clear();

      this.telnetConnectionPool.connections.clear();
      this.telnetConnectionPool.tabReferences.clear();
      if (this.telnetConnectionPool.healthCheckTimer) {
        clearInterval(this.telnetConnectionPool.healthCheckTimer);
        this.telnetConnectionPool.healthCheckTimer = null;
      }
    },
    getLastConnections() {
      return [];
    },
  };

  const filemanagementServiceMock = {
    cleanupTransfersForTab(tabId) {
      perTabTransferCleanupCalls.push(tabId);
      return {
        cleanedCount: tabId === "tab-d2" ? 1 : 0,
        remainingTransfers: Math.max(
          0,
          filemanagementStats.activeTransferCount - 1,
        ),
      };
    },
    cleanup() {
      filemanagementCleanupCount += 1;
      filemanagementStats = {
        ...filemanagementStats,
        activeTransferCount: 0,
        throughputBytesPerSec: 0,
        latestTransferThroughput: 0,
        pool: {
          ...filemanagementStats.pool,
          workerCount: 0,
          queuedTasks: 0,
          pendingTasks: 0,
          pendingInits: 0,
          activeTransfers: 0,
          shutdown: true,
        },
        poolIdleShutdownScheduled: false,
      };
    },
    getTransferRuntimeStats() {
      return {
        ...filemanagementStats,
        eventLoopLag: { ...filemanagementStats.eventLoopLag },
        pool: { ...filemanagementStats.pool },
      };
    },
  };

  injectMock(loggerPath, { logToFile() {} });
  injectMock(resourceManagerPath, {
    mainProcessResourceManager: {
      async cleanup() {},
    },
  });
  injectMock(processManagerPath, {
    getAllProcesses() {
      return processMap.entries();
    },
    clearAllProcesses() {
      processMap.clear();
    },
  });
  injectMock(connectionManagerPath, connectionManagerMock);
  injectMock(runtimeFileLifecyclePath, {
    async clearResource(resourceName, options) {
      runtimeClearCalls.push({
        resourceName,
        options: { ...(options || {}) },
      });
      return true;
    },
    stopPeriodicCleanup() {
      runtimeStopCount += 1;
      return true;
    },
  });
  injectMock(configServicePath, {
    saveCommandHistory() {},
    saveLastConnections() {
      return true;
    },
  });
  injectMock(commandHistoryPath, {
    exportHistory() {
      return [];
    },
  });
  injectMock(filemanagementServicePath, filemanagementServiceMock);

  clearRequire(appCleanupPath);

  try {
    const AppCleanup = require(appCleanupPath);
    const cleaner = new AppCleanup({
      isPackaged: false,
      getPath() {
        return ROOT;
      },
      getAppPath() {
        return ROOT;
      },
      quit() {},
    });

    await cleaner.performCleanup({
      async cleanup() {},
    });

    assert.deepEqual(
      perTabTransferCleanupCalls,
      ["tab-d2"],
      "退出时应先按 tab 清理对应文件传输任务",
    );
    assert.equal(
      filemanagementCleanupCount,
      1,
      "退出时应执行 Filemanagement 传输全量清理",
    );
    assert.equal(connectionCleanupCount, 1, "退出时应清理连接管理器");
    assert.ok(releasedSshCount >= 1, "退出时应释放SSH连接引用");
    assert.deepEqual(
      runtimeClearCalls.map((call) => call.resourceName),
      ["file-cache", "file-snapshots", "external-editor-temp"],
      "退出时应通过统一生命周期清理所有运行时文件资源",
    );
    assert.deepEqual(
      runtimeClearCalls.map((call) => call.options),
      [
        { includeActive: true, reason: "app-quit" },
        { includeActive: true, reason: "app-quit" },
        { includeActive: true, reason: "app-quit" },
      ],
      "退出清理应包含活跃运行时文件并标记 app-quit 原因",
    );
    assert.equal(runtimeStopCount, 1, "退出时应停止统一周期清理定时器");
    assert.equal(processMap.size, 0, "退出后进程表应清空");

    const finalFilemanagementStats =
      filemanagementServiceMock.getTransferRuntimeStats();
    assert.equal(
      finalFilemanagementStats.activeTransferCount,
      0,
      "退出后活跃文件传输应为0",
    );
    assert.equal(
      finalFilemanagementStats.pool.pendingTasks,
      0,
      "退出后文件传输待处理任务应为0",
    );
    assert.equal(
      finalFilemanagementStats.pool.shutdown,
      true,
      "退出后文件传输进程池应进入 shutdown 状态",
    );

    assert.equal(
      connectionManagerMock.sshConnectionPool.connections.size,
      0,
      "退出后SSH连接应为0",
    );
    assert.equal(
      connectionManagerMock.sshConnectionPool.reconnectionManager.sessions.size,
      0,
      "退出后重连会话应为0",
    );
    assert.equal(
      connectionManagerMock.sshConnectionPool.reconnectionManager
        .reconnectTimers.size,
      0,
      "退出后重连定时器应为0",
    );
    assert.equal(
      connectionManagerMock.telnetConnectionPool.connections.size,
      0,
      "退出后Telnet连接应为0",
    );

    return true;
  } finally {
    clearTimeout(reconnectTimer);
    clearInterval(sshHealthTimer);
    clearInterval(telnetHealthTimer);
    clearRequire(appCleanupPath);
    restoreMocks();
  }
}

async function testEConfigBackedLocalDataClearKeepsAIMemoryOutOfConfig() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "simpleshell-todo-"));
  const runtimeDir = path.join(tempRoot, "runtime");
  const logDir = path.join(runtimeDir, "log");
  const tempDir = path.join(runtimeDir, "temp");
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const activeLogFile = path.join(logDir, "app.log");
  const oldLogFile = path.join(logDir, "old.log");
  const memoryFile = path.join(tempDir, "mem.json");
  fs.writeFileSync(activeLogFile, "active log content", "utf8");
  fs.writeFileSync(oldLogFile, "old log content", "utf8");
  fs.writeFileSync(
    memoryFile,
    JSON.stringify({ summary: "keep-in-temp" }),
    "utf8",
  );

  const settingsHandlersPath = path.join(
    ROOT,
    "src/core/ipc/handlers/settingsHandlers",
  );
  const configServicePath = path.join(ROOT, "src/services/configService");
  const commandHistoryPath = path.join(
    ROOT,
    "src/modules/terminal/command-history",
  );
  const loggerPath = path.join(ROOT, "src/core/utils/logger");
  const runtimeFileLifecyclePath = path.join(
    ROOT,
    "src/core/utils/runtimeFileLifecycle",
  );

  const electronMock = installElectronMock({
    app: {
      isPackaged: true,
      getPath(name) {
        assert.equal(name, "exe", "生产路径解析只应读取 exe 路径");
        return path.join(runtimeDir, "SimpleShell.exe");
      },
      getAppPath() {
        return runtimeDir;
      },
    },
  });
  const mockedModules = [];

  let configClearSections = null;
  let commandHistoryInitialized = null;
  const runtimeClearCalls = [];
  const logMessages = [];

  injectMock(
    configServicePath,
    {
      clearLocalConfigData(options) {
        configClearSections = [...(options?.sections || [])];
        assert.equal(
          configClearSections.includes("aiMemory"),
          false,
          "AI 记忆不应作为 config.json 分项写入或清理",
        );
        assert.equal(
          configClearSections.includes("externalEditorTemp"),
          false,
          "外部编辑临时文件不应作为 config.json 分项写入或清理",
        );
        return { success: true, sections: configClearSections };
      },
    },
    mockedModules,
  );
  injectMock(
    commandHistoryPath,
    {
      initialize(history) {
        commandHistoryInitialized = history;
      },
    },
    mockedModules,
  );
  injectMock(
    loggerPath,
    {
      getLogDirectoryPath() {
        return logDir;
      },
      getLogFilePath() {
        return activeLogFile;
      },
      logToFile(message, level) {
        logMessages.push({ message, level });
      },
      updateLogConfig() {},
    },
    mockedModules,
  );
  injectMock(
    runtimeFileLifecyclePath,
    {
      async clearResource(resourceName, options) {
        runtimeClearCalls.push({
          resourceName,
          options: { ...(options || {}) },
        });
        return true;
      },
    },
    mockedModules,
  );

  clearRequire(settingsHandlersPath);

  try {
    const SettingsHandlers = require(settingsHandlersPath);
    const handlers = new SettingsHandlers();
    const result = await handlers.clearLocalData(null, {
      sections: [
        "connections",
        "credentials",
        "commandHistory",
        "shortcutCommands",
        "uiSettings",
        "aiSettings",
        "cache",
        "snapshots",
        "externalEditorTemp",
        "logs",
        "aiMemory",
      ],
    });

    assert.equal(result.success, true, "清除本机数据应成功");
    assert.deepEqual(
      configClearSections,
      [
        "connections",
        "credentials",
        "commandHistory",
        "shortcutCommands",
        "uiSettings",
        "aiSettings",
      ],
      "只有配置类分项应写入 configService.clearLocalConfigData",
    );
    assert.deepEqual(commandHistoryInitialized, [], "命令历史运行时状态应清空");
    assert.deepEqual(
      runtimeClearCalls,
      [
        {
          resourceName: "file-cache",
          options: {
            recreate: true,
            includeActive: true,
            reason: "clear-local-data",
          },
        },
        {
          resourceName: "file-snapshots",
          options: {
            recreate: true,
            includeActive: true,
            reason: "clear-local-data",
          },
        },
        {
          resourceName: "external-editor-temp",
          options: {
            recreate: true,
            includeActive: true,
            reason: "clear-local-data",
          },
        },
      ],
      "运行时文件应统一通过 lifecycle 清理并重建",
    );
    assert.equal(
      fs.existsSync(memoryFile),
      false,
      "AI 记忆应删除 temp/mem.json",
    );
    assert.equal(
      fs.readFileSync(activeLogFile, "utf8"),
      "",
      "当前日志文件应被截断",
    );
    assert.equal(fs.existsSync(oldLogFile), false, "旧日志文件应被删除");
    assert.equal(result.runtime.aiMemoryCleared, true);
    assert.equal(result.runtime.cacheCleared, true);
    assert.equal(result.runtime.snapshotsCleared, true);
    assert.equal(result.runtime.externalEditorTempCleared, true);
    assert.ok(
      result.runtime.logFilesCleared >= 2,
      "日志清理应覆盖当前日志和历史日志",
    );
    assert.ok(
      electronMock.sentMessages.some(
        ({ channel, payload }) =>
          channel === "settings:localDataCleared" &&
          payload?.sections?.includes("aiMemory"),
      ),
      "清理完成后应广播 settings:localDataCleared",
    );
    assert.ok(
      electronMock.sentMessages.some(
        ({ channel }) => channel === "connections-changed",
      ),
      "清理连接/凭据/AI 设置后应广播 connections-changed",
    );
    assert.ok(
      electronMock.sentMessages.some(
        ({ channel, payload }) =>
          channel === "command-history:changed" &&
          payload?.reason === "clear-local-data",
      ),
      "清理命令历史后应广播 command-history:changed",
    );
    assert.ok(
      logMessages.some(({ message }) => message.includes("Local data cleared")),
      "清理操作应写入审计日志",
    );

    return true;
  } finally {
    clearRequire(settingsHandlersPath);
    restoreMockedModules(mockedModules);
    electronMock.restore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testFUnifiedRuntimeFileLifecyclePolicy() {
  const runtimeFileLifecyclePath = path.join(
    ROOT,
    "src/core/utils/runtimeFileLifecycle",
  );
  clearRequire(runtimeFileLifecyclePath);

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "simpleshell-lifecycle-"),
  );
  const startupRoot = path.join(tempRoot, "startup");
  const sweepRoot = path.join(tempRoot, "sweep");
  fs.mkdirSync(startupRoot, { recursive: true });
  fs.mkdirSync(sweepRoot, { recursive: true });

  try {
    const runtimeFileLifecycle = require(runtimeFileLifecyclePath);
    runtimeFileLifecycle.init(() => {});

    const startupFile = path.join(startupRoot, "previous-exit.tmp");
    fs.writeFileSync(startupFile, "stale", "utf8");
    let beforeClearCount = 0;
    let afterClearCount = 0;

    runtimeFileLifecycle.registerResource("test-startup-clear", {
      rootPath: startupRoot,
      policy: {
        maxAgeMs: 60_000,
        maxTotalBytes: 1024 * 1024,
        cleanupIntervalMs: 60_000,
        startupCleanup: "clear",
        protectActive: false,
      },
      onBeforeClear() {
        beforeClearCount += 1;
      },
      onClear() {
        afterClearCount += 1;
      },
    });

    const recovery = await runtimeFileLifecycle.recoverFromPreviousExit({
      recreate: true,
    });
    assert.deepEqual(
      recovery["test-startup-clear"],
      { cleared: true },
      "启动恢复应清理上次退出遗留的运行时目录",
    );
    assert.equal(fs.existsSync(startupRoot), true, "启动恢复后应重建目录");
    assert.equal(fs.existsSync(startupFile), false, "启动恢复应删除旧文件");
    assert.equal(beforeClearCount, 1, "清理前回调应执行一次");
    assert.equal(afterClearCount, 1, "清理后回调应执行一次");

    runtimeFileLifecycle.unregisterResource("test-startup-clear");

    const now = Date.now();
    const trackedEntries = new Map();
    const writeTrackedFile = (name, bytes, ageMs, active = false) => {
      const filePath = path.resolve(path.join(sweepRoot, name));
      fs.writeFileSync(filePath, Buffer.alloc(bytes, "x"));
      const timestamp = now - ageMs;
      trackedEntries.set(filePath, {
        path: filePath,
        type: "file",
        bytes,
        createdAtMs: timestamp,
        mtimeMs: timestamp,
        active,
      });
      return filePath;
    };

    const activeOldFile = writeTrackedFile("active-old.tmp", 80, 10_000, true);
    const expiredFile = writeTrackedFile("expired.tmp", 30, 10_000);
    const sizeOldFile = writeTrackedFile("size-old.tmp", 70, 100);
    const sizeNewFile = writeTrackedFile("size-new.tmp", 10, 10);

    runtimeFileLifecycle.registerResource("test-sweep-policy", {
      rootPath: sweepRoot,
      policy: {
        maxAgeMs: 1000,
        maxTotalBytes: 100,
        cleanupIntervalMs: 60_000,
        startupCleanup: "sweep",
        protectActive: true,
      },
      collectEntries() {
        return Array.from(trackedEntries.values()).filter((entry) =>
          fs.existsSync(entry.path),
        );
      },
      onEntryRemoved(entry) {
        trackedEntries.delete(entry.path);
      },
    });

    const sweepResult = await runtimeFileLifecycle.sweepResource(
      "test-sweep-policy",
      { reason: "check" },
    );
    assert.equal(sweepResult.removedExpired, 1, "过期文件应被清理");
    assert.equal(sweepResult.removedForSize, 1, "超出大小上限时应清理旧文件");
    assert.equal(sweepResult.totalBytesBefore, 190, "清理前总大小应按条目统计");
    assert.equal(sweepResult.totalBytesAfter, 90, "清理后总大小应降到上限以下");
    assert.equal(
      fs.existsSync(activeOldFile),
      true,
      "活跃文件应受 protectActive 保护",
    );
    assert.equal(fs.existsSync(expiredFile), false, "过期文件应删除");
    assert.equal(fs.existsSync(sizeOldFile), false, "大小清理应删除较旧文件");
    assert.equal(fs.existsSync(sizeNewFile), true, "大小达标后应保留新文件");

    const partialCleared = await runtimeFileLifecycle.clearResource(
      "test-sweep-policy",
      {
        includeActive: false,
        recreate: true,
        reason: "manual-partial",
      },
    );
    assert.equal(partialCleared, true, "手动清理应删除非活跃文件");
    assert.equal(
      fs.existsSync(activeOldFile),
      true,
      "不包含活跃文件的手动清理应保留活跃文件",
    );
    assert.equal(fs.existsSync(sizeNewFile), false, "非活跃文件应被手动清理");
    assert.equal(fs.existsSync(sweepRoot), true, "手动清理后目录应存在");

    const fullCleared = await runtimeFileLifecycle.clearResource(
      "test-sweep-policy",
      {
        includeActive: true,
        recreate: true,
        reason: "manual-full",
      },
    );
    assert.equal(fullCleared, true, "包含活跃文件的手动清理应成功");
    assert.equal(
      fs.existsSync(activeOldFile),
      false,
      "包含活跃文件时应删除活跃文件",
    );
    assert.equal(fs.existsSync(sweepRoot), true, "完整清理后应重建目录");

    assert.equal(
      runtimeFileLifecycle.startPeriodicCleanup(),
      true,
      "注册资源后应可启动统一周期清理",
    );
    assert.equal(
      runtimeFileLifecycle.stopPeriodicCleanup(),
      true,
      "统一周期清理应可停止",
    );

    return true;
  } finally {
    try {
      const runtimeFileLifecycle = require(runtimeFileLifecyclePath);
      runtimeFileLifecycle.stopPeriodicCleanup();
    } catch {
      // ignore cleanup failure in test teardown
    }
    clearRequire(runtimeFileLifecyclePath);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function testGNativeSidecarHostKeyVerification() {
  const sidecarSource = fs.readFileSync(
    path.join(ROOT, "transfernative", "transfer-sidecar", "src", "main.rs"),
    "utf8",
  );
  const nativeClientSource = fs.readFileSync(
    path.join(ROOT, "src", "core", "utils", "nativeSftpClient.js"),
    "utf8",
  );
  const sshHandlersSource = fs.readFileSync(
    path.join(ROOT, "src", "core", "ipc", "handlers", "sshHandlers.js"),
    "utf8",
  );
  const filemanagementSource = fs.readFileSync(
    path.join(
      ROOT,
      "src",
      "modules",
      "filemanagement",
      "filemanagementService.js",
    ),
    "utf8",
  );

  assert.equal(
    sidecarSource.includes("AcceptAnyServerKey"),
    false,
    "Rust sidecar must not accept arbitrary SSH server keys",
  );
  assert.match(
    sidecarSource,
    /expected_host_fingerprint:\s*Option<String>/,
    "Rust sidecar config must accept the trusted host fingerprint",
  );
  assert.match(
    sidecarSource,
    /compute_sha256_host_fingerprint/,
    "Rust sidecar must compute the server host key SHA256 fingerprint",
  );
  assert.match(
    sidecarSource,
    /SSH host key verification failed/,
    "Rust sidecar must reject host key mismatches with an explicit error",
  );
  assert.match(
    sidecarSource,
    /NATIVE_SFTP_HOST_KEY_VERIFICATION_FAILED/,
    "Rust sidecar must classify host key failures separately",
  );

  assert.match(
    sshHandlersSource,
    /setTrustedHostFingerprint\(/,
    "Main SSH host verifier must mark the verified fingerprint on the saved connection config",
  );
  assert.match(
    sshHandlersSource,
    /connectionConfig\.hostVerifier\s*=\s*this\._createHostVerifier\(connectionConfig\)/,
    "Host verifier must close over the same config object saved for the terminal process",
  );
  assert.match(
    nativeClientSource,
    /expectedHostFingerprint/,
    "Native SFTP wrapper must pass expectedHostFingerprint to the sidecar",
  );
  assert.match(
    nativeClientSource,
    /NATIVE_SFTP_HOST_KEY_NOT_TRUSTED/,
    "Native SFTP wrapper must fail before spawning sidecar when no trusted fingerprint exists",
  );
  assert.match(
    filemanagementSource,
    /expectedHostFingerprint/,
    "Transfer process pool SSH configs must include the trusted host fingerprint",
  );

  const nativeSftpClientPath = path.join(
    ROOT,
    "src",
    "core",
    "utils",
    "nativeSftpClient.js",
  );
  const nativeSftpClient = require(nativeSftpClientPath);
  await assert.rejects(
    nativeSftpClient.invokeNativeRequestWithConfig(
      {
        host: "127.0.0.1",
        port: 22,
        username: "user",
        password: "pass",
      },
      { operation: "listFiles", path: "." },
    ),
    (error) =>
      error?.errorCode === "NATIVE_SFTP_HOST_KEY_NOT_TRUSTED" ||
      error?.code === "NATIVE_SFTP_HOST_KEY_NOT_TRUSTED",
    "Native SFTP must reject configs that were not trusted by the main SSH verifier",
  );

  return true;
}

async function testHNativeSidecarProxyPathConsistency() {
  const sidecarSource = fs.readFileSync(
    path.join(ROOT, "transfernative", "transfer-sidecar", "src", "main.rs"),
    "utf8",
  );
  const nativeClientSource = fs.readFileSync(
    path.join(ROOT, "src", "core", "utils", "nativeSftpClient.js"),
    "utf8",
  );
  const networkPathSource = fs.readFileSync(
    path.join(ROOT, "src", "core", "utils", "nativeSidecarNetworkPath.js"),
    "utf8",
  );
  const filemanagementSource = fs.readFileSync(
    path.join(
      ROOT,
      "src",
      "modules",
      "filemanagement",
      "filemanagementService.js",
    ),
    "utf8",
  );
  const diagnosticsSource = fs.readFileSync(
    path.join(ROOT, "src", "core", "utils", "diagnostics.js"),
    "utf8",
  );

  assert.match(
    nativeClientSource,
    /proxyRequired/,
    "Native SFTP wrapper must pass proxyRequired to the sidecar",
  );
  assert.match(
    nativeClientSource,
    /networkPath/,
    "Native SFTP wrapper must pass/record networkPath metadata",
  );
  assert.match(
    nativeClientSource,
    /NATIVE_SFTP_PROXY_REQUIRED/,
    "Native SFTP wrapper must reject proxy-required requests with no resolved proxy",
  );
  assert.match(
    networkPathSource,
    /resolveNativeSidecarNetworkPath/,
    "Native sidecar network path must be resolved through the JS proxy manager",
  );
  assert.match(
    networkPathSource,
    /hasAuth/,
    "Diagnostic network path must expose only hasAuth, not proxy credentials",
  );
  assert.doesNotMatch(
    networkPathSource,
    /password:\s*normalized\.password/,
    "Sanitized network path must not include proxy password",
  );
  assert.match(
    filemanagementSource,
    /resolveNativeSidecarNetworkPath/,
    "Transfer process pool SSH configs must use the same proxy resolution path",
  );
  assert.doesNotMatch(
    filemanagementSource,
    /Resolve proxy for transfer[\s\S]*failed[\s\S]*WARN/,
    "Transfer proxy resolution failures must not warn and continue direct",
  );
  assert.match(
    sidecarSource,
    /struct ProxyConfig/,
    "Rust sidecar config must accept structured proxy settings",
  );
  assert.match(
    sidecarSource,
    /connect_via_http_proxy/,
    "Rust sidecar must implement HTTP CONNECT proxy support",
  );
  assert.match(
    sidecarSource,
    /connect_via_socks5_proxy/,
    "Rust sidecar must implement SOCKS5 proxy support",
  );
  assert.match(
    sidecarSource,
    /connect_via_socks4_proxy/,
    "Rust sidecar must implement SOCKS4 proxy support",
  );
  assert.match(
    sidecarSource,
    /client::connect_stream/,
    "Rust sidecar must pass the established direct/proxy stream to russh",
  );
  assert.match(
    sidecarSource,
    /proxy_required[\s\S]*no supported proxy was provided/,
    "Rust sidecar must fail proxyRequired requests instead of silently connecting direct",
  );
  assert.match(
    sidecarSource,
    /NATIVE_SFTP_PROXY/,
    "Rust sidecar must classify proxy failures separately",
  );
  assert.match(
    sidecarSource,
    /networkPath/,
    "Rust sidecar results must include the network path used by transfer requests",
  );
  assert.match(
    diagnosticsSource,
    /transferNetworkPath/,
    "Diagnostics package must include sidecar transfer network path",
  );

  const nativeSftpClientPath = path.join(
    ROOT,
    "src",
    "core",
    "utils",
    "nativeSftpClient.js",
  );
  const nativeSftpClient = require(nativeSftpClientPath);
  await assert.rejects(
    nativeSftpClient.invokeNativeRequestWithConfig(
      {
        host: "127.0.0.1",
        port: 22,
        username: "user",
        password: "pass",
        expectedHostFingerprint: "SHA256:test",
        proxyRequired: true,
      },
      { operation: "listFiles", path: "." },
    ),
    (error) =>
      error?.errorCode === "NATIVE_SFTP_PROXY_REQUIRED" ||
      error?.code === "NATIVE_SFTP_PROXY_REQUIRED",
    "Native SFTP must reject proxyRequired configs without a resolved proxy before spawning sidecar",
  );

  return true;
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
    {
      id: "D2",
      name: "D. app quit 后连接、SFTP会话、定时器全部释放",
      fn: testD2AppQuitReleasesAllResources,
    },
    {
      id: "E1",
      name: "E. 清除本机数据覆盖 config.json 分项、运行时目录和 temp/mem.json AI 记忆",
      fn: testEConfigBackedLocalDataClearKeepsAIMemoryOutOfConfig,
    },
    {
      id: "F1",
      name: "F. 统一运行时文件生命周期覆盖启动恢复、过期、大小上限、手动清理和活跃保护",
      fn: testFUnifiedRuntimeFileLifecyclePolicy,
    },
    {
      id: "G1",
      name: "G. Rust sidecar SFTP 继承主 SSH 主机指纹校验",
      fn: testGNativeSidecarHostKeyVerification,
    },
    {
      id: "H1",
      name: "H. Rust sidecar SFTP 继承主 SSH 代理/VPN 路径",
      fn: testHNativeSidecarProxyPathConsistency,
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
