const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const ReconnectionManager = require(path.join(
  ROOT,
  "src/core/connection/reconnection-manager.js",
));
const SSHPool = require(path.join(ROOT, "src/core/connection/ssh-pool.js"));

function createFakeConnection() {
  const connection = new EventEmitter();
  connection.endCalls = 0;
  connection.destroyCalls = 0;
  connection.end = () => {
    connection.endCalls += 1;
  };
  connection.destroy = () => {
    connection.destroyCalls += 1;
  };
  return connection;
}

function testCancelSessionIgnoresLateClose() {
  const manager = new ReconnectionManager();
  manager.initialize();

  const connection = createFakeConnection();
  manager.registerSession(
    "tab:test-close:127.0.0.1:22:user",
    connection,
    {
      tabId: "test-close",
      host: "127.0.0.1",
      port: 22,
      username: "user",
    },
    { autoStart: false, state: "connected" },
  );

  assert.ok(
    manager.getSessionStatus("tab:test-close:127.0.0.1:22:user"),
    "会话应已注册",
  );

  const cancelled = manager.cancelSession(
    "tab:test-close:127.0.0.1:22:user",
    "user-refresh",
  );

  assert.equal(cancelled, true, "主动关闭时应成功取消重连会话");
  assert.equal(
    manager.getSessionStatus("tab:test-close:127.0.0.1:22:user"),
    null,
    "取消后不应再暴露重连状态",
  );

  connection.emit("close");

  assert.equal(
    manager.getSessionStatus("tab:test-close:127.0.0.1:22:user"),
    null,
    "晚到的 close 事件不应重新激活重连状态",
  );
}

function testSshPoolActiveCloseCancelsReconnectSession() {
  const pool = new SSHPool();
  pool.reconnectionManager.initialize();

  const connection = createFakeConnection();
  const connectionKey = "tab:test-pool:127.0.0.1:22:user";
  const sshConfig = {
    tabId: "test-pool",
    host: "127.0.0.1",
    port: 22,
    username: "user",
  };

  pool.connections.set(connectionKey, {
    client: connection,
    config: sshConfig,
    key: connectionKey,
    createdAt: Date.now(),
    lastUsed: Date.now(),
    refCount: 0,
    ready: true,
    listeners: new Set(),
    proxySocket: null,
  });

  pool.reconnectionManager.registerSession(
    connectionKey,
    connection,
    sshConfig,
    { autoStart: false, state: "connected" },
  );

  pool.closeConnection(connectionKey, { reason: "user", intentional: true });

  assert.equal(
    pool.connections.has(connectionKey),
    false,
    "主动关闭后连接池中不应再保留该连接",
  );
  assert.equal(
    pool.reconnectionManager.getSessionStatus(connectionKey),
    null,
    "主动关闭后不应残留重连会话",
  );

  connection.emit("close");

  assert.equal(
    pool.reconnectionManager.getSessionStatus(connectionKey),
    null,
    "连接对象晚到的 close 事件不应重新写回重连状态",
  );
}

function run() {
  const tests = [
    ["cancel session ignores late close", testCancelSessionIgnoresLateClose],
    [
      "ssh pool active close cancels reconnect session",
      testSshPoolActiveCloseCancelsReconnectSession,
    ],
  ];

  tests.forEach(([name, fn]) => {
    fn();
    console.log(`PASS ${name}`);
  });

  console.log(
    `\n${tests.length} reconnect intentional-close regression checks passed.`,
  );
}

run();
