/* eslint-disable no-console */
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const ReconnectionManager = require(
  path.join(ROOT, "src/core/connection/reconnection-manager.js"),
);
const {
  DEFAULT_SSH_RETRY_CONFIG,
  buildReconnectTimeoutMessage,
  buildReconnectWaitMessage,
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

function testDefaultRetryPolicyIsFiveSecondsForTwentyFiveSecondsWindow() {
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.initialDelay,
    5000,
    "默认每次自动重连间隔应为5秒",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.maxDelay,
    5000,
    "默认自动重连间隔上限应固定为5秒",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.useExponentialBackoff,
    false,
    "默认自动重连不应再使用指数退避",
  );
  assert.equal(
    DEFAULT_SSH_RETRY_CONFIG.totalTimeCapMs,
    25_000,
    "默认自动重连总窗口应放宽为25秒",
  );
  assert.equal(
    buildReconnectWaitMessage(DEFAULT_SSH_RETRY_CONFIG),
    "正在重连，最多等待网络/VPN 25秒...",
    "等待提示文案应保持简洁并同步使用25秒窗口",
  );
  assert.equal(
    buildReconnectTimeoutMessage(DEFAULT_SSH_RETRY_CONFIG),
    "重连超时（25秒），请检查网络/VPN后手动重连。",
    "超时提示文案应保持简洁并同步使用25秒窗口",
  );
}

async function testReconnectRunsFiveRetriesAfterFailures() {
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
      "default retry policy is five seconds for twenty five seconds window",
      testDefaultRetryPolicyIsFiveSecondsForTwentyFiveSecondsWindow,
    ],
    [
      "reconnect runs five retries after failures",
      testReconnectRunsFiveRetriesAfterFailures,
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

  console.log(
    `\n${tests.length} reconnect retry policy regression checks passed.`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
