const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const ReconnectionManager = require(
  path.join(ROOT, "src/core/connection/reconnection-manager.js"),
);
const {
  DEFAULT_SSH_RETRY_CONFIG,
  buildReconnectTimeoutMessage,
  buildReconnectWaitMessage,
  calculateRetryDelay,
  buildSshRetryConfig,
} = require(path.join(ROOT, "src/core/connection/ssh-retry-helper.js"));

function createFakeConnection() {
  const connection = new EventEmitter();
  connection.end = () => {};
  connection.destroy = () => {};
  return connection;
}

function waitForEvent(emitter, eventName, timeoutMs = 3000, predicate = null) {
  return Promise.race([
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
    new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`等待事件超时: ${eventName}`)),
        timeoutMs,
      );
    }),
  ]);
}

function testDefaultRetryPolicyIsWeakNetworkFriendly() {
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.initialDelay,
    1500,
    "默认首次重连间隔应为1.5秒（弱网友好）",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.maxDelay,
    20_000,
    "默认重连间隔上限应为20秒",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.useExponentialBackoff,
    true,
    "默认应启用指数退避",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.totalTimeCapMs,
    120_000,
    "默认自动重连总窗口应为120秒",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.fastReconnect.enabled,
    true,
    "默认应启用瞬时闪断快恢",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.smartReconnect.enabled,
    true,
    "默认应启用智能重连（自适应延迟）",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.networkProbe.tcpTimeoutMs,
    2000,
    "默认 preflight TCP 超时应为2秒",
  );
  assert.equal(
    buildReconnectWaitMessage(DEFAULT_SSH_RETRY_CONFIG),
    "正在重连，最多等待网络/VPN 2分钟...",
    "等待提示文案应同步使用2分钟窗口",
  );
  assert.equal(
    buildReconnectTimeoutMessage(DEFAULT_SSH_RETRY_CONFIG),
    "重连超时（2分钟），请检查网络/VPN后刷新或重新打开连接。",
    "超时提示文案应同步使用2分钟窗口",
  );

  const resolvedDefault = buildSshRetryConfig();
  assert.equal(
    resolvedDefault.totalTimeCapMs,
    DEFAULT_SSH_RETRY_CONFIG.totalTimeCapMs,
    "无参数 buildSshRetryConfig 应得到唯一弱网默认策略",
  );
}

function testJitterAndFastReconnectDelay() {
  const delays = [];
  for (let i = 0; i < 20; i += 1) {
    delays.push(
      calculateRetryDelay({
        retryConfig: {
          ...DEFAULT_SSH_RETRY_CONFIG,
          jitter: 400,
        },
        attempt: 3,
        lastError: null,
        successRate: 1,
      }),
    );
  }

  assert.ok(
    delays.every((d) => d >= 0),
    "延迟不可为负",
  );
  const baseWithoutJitter = calculateRetryDelay({
    retryConfig: {
      ...DEFAULT_SSH_RETRY_CONFIG,
      jitter: 0,
    },
    attempt: 3,
    lastError: null,
    successRate: 1,
  });
  assert.ok(
    delays.some((d) => d !== baseWithoutJitter) || baseWithoutJitter === 0,
    "启用 jitter 后延迟应出现波动（或基线为0）",
  );

  const fastDelay = calculateRetryDelay({
    retryConfig: DEFAULT_SSH_RETRY_CONFIG,
    attempt: 1,
    lastError: { code: "ECONNRESET" },
    successRate: 1,
  });
  assert.ok(fastDelay <= 700, `ECONNRESET 快恢延迟应较短，实际 ${fastDelay}ms`);
}

function testOnlyWeakDefaultPolicyExists() {
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.maxRetries,
    10,
    "唯一弱网策略 maxRetries 应为 10",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.useExponentialBackoff,
    true,
    "唯一弱网策略应启用指数退避",
  );
  // 确保不再存在多模式预设模块
  let presetsMissing = false;
  try {
    require(
      path.join(ROOT, "src/core/connection/network-resilience-presets.js"),
    );
  } catch {
    presetsMissing = true;
  }
  assert.equal(
    presetsMissing,
    true,
    "network-resilience-presets.js 应已移除（仅保留弱网默认）",
  );
}

async function testReconnectRunsConfiguredRetriesAfterFailures() {
  const manager = new ReconnectionManager({
    maxRetries: 5,
    initialDelay: 10,
    maxDelay: 10,
    exponentialFactor: 1,
    jitter: 0,
    totalTimeCapMs: 1000,
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

  const sessionId = "sess-retry-policy";
  const initialConnection = createFakeConnection();
  let reconnectStartedCount = 0;
  let reconnectScheduledCount = 0;
  const scheduledAttempts = [];

  manager.createNewConnection = async () => {
    throw Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
  };

  manager.on("reconnectStarted", ({ sessionId: currentId }) => {
    if (currentId === sessionId) {
      reconnectStartedCount += 1;
    }
  });

  manager.on("reconnectScheduled", ({ sessionId: currentId, retryCount }) => {
    if (currentId === sessionId) {
      reconnectScheduledCount += 1;
      scheduledAttempts.push(retryCount);
    }
  });

  manager.registerSession(
    sessionId,
    initialConnection,
    { host: "127.0.0.1", port: 22, username: "u" },
    { autoStart: false, state: "connected" },
  );

  const failureEvent = waitForEvent(
    manager,
    "reconnectFailed",
    3000,
    ({ sessionId: currentId }) => currentId === sessionId,
  );

  initialConnection.emit(
    "error",
    Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    }),
  );

  await failureEvent;

  assert.equal(reconnectScheduledCount, 5, "连续失败时应完整调度5次自动重连");
  assert.deepEqual(
    scheduledAttempts,
    [0, 1, 2, 3, 4],
    "等待下一次自动重试时应显示已执行的重试次数，而不是下一次计划编号",
  );
  assert.equal(
    reconnectStartedCount,
    5,
    "连续失败时应实际执行5次自动重连，而不是只执行一次",
  );
  assert.equal(
    manager.getSessionStatus(sessionId),
    null,
    "达到上限后会话应被清理",
  );

  manager.shutdown();
}

async function testPreflightFailuresAlsoCountRetries() {
  const manager = new ReconnectionManager({
    maxRetries: 5,
    initialDelay: 10,
    maxDelay: 10,
    exponentialFactor: 1,
    jitter: 0,
    totalTimeCapMs: 1000,
    networkProbe: {
      enabled: true,
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

  const sessionId = "sess-preflight-retry-policy";
  const initialConnection = createFakeConnection();
  const scheduledAttempts = [];
  let reconnectStartedCount = 0;

  manager._checkPreflight = async () => ({
    ok: false,
    code: "EPROXYUNAVAILABLE",
    failureReason: "proxy-unavailable",
    message: "proxy endpoint is unavailable",
  });

  manager.on("reconnectStarted", ({ sessionId: currentId }) => {
    if (currentId === sessionId) {
      reconnectStartedCount += 1;
    }
  });

  manager.on("reconnectScheduled", ({ sessionId: currentId, retryCount }) => {
    if (currentId === sessionId) {
      scheduledAttempts.push(retryCount);
    }
  });

  manager.registerSession(
    sessionId,
    initialConnection,
    { host: "127.0.0.1", port: 22, username: "u" },
    { autoStart: false, state: "connected" },
  );

  const failureEvent = waitForEvent(
    manager,
    "reconnectFailed",
    3000,
    ({ sessionId: currentId, attempts, failureReason }) =>
      currentId === sessionId &&
      attempts === 5 &&
      failureReason === "proxy-unavailable",
  );

  initialConnection.emit(
    "error",
    Object.assign(new Error("proxy endpoint is unavailable"), {
      code: "EPROXYUNAVAILABLE",
      failureReason: "proxy-unavailable",
    }),
  );

  const [failurePayload] = await failureEvent;

  assert.deepEqual(
    scheduledAttempts,
    [0, 1, 2, 3, 4],
    "预检连续失败时，等待中的已重试次数也应逐步累积",
  );
  assert.equal(reconnectStartedCount, 5, "预检连续失败时也应记为5次已执行重试");
  assert.equal(failurePayload.attempts, 5, "最终失败时应显示已重试5次");
  assert.equal(
    failurePayload.failureReason,
    "proxy-unavailable",
    "预检失败应暴露更细的失败原因",
  );

  manager.shutdown();
}

async function run() {
  const tests = [
    [
      "default retry policy is weak-network friendly (120s window)",
      testDefaultRetryPolicyIsWeakNetworkFriendly,
    ],
    [
      "jitter and fast reconnect delay behave as expected",
      testJitterAndFastReconnectDelay,
    ],
    ["only weak default policy exists", testOnlyWeakDefaultPolicyExists],
    [
      "reconnect runs configured retries after failures",
      testReconnectRunsConfiguredRetriesAfterFailures,
    ],
    [
      "preflight failures also count retries",
      testPreflightFailuresAlsoCountRetries,
    ],
  ];

  for (const [name, fn] of tests) {
    await fn();
    console.log(`PASS ${name}`);
  }

  console.log(`\n${tests.length} reconnect retry policy checks passed.`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
