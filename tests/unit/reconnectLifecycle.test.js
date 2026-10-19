import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("reconnect-intentional-close", () => {
  const assert = require("node:assert/strict");
  const { EventEmitter } = require("node:events");
  const path = require("node:path");

  const ROOT = _path.resolve(_repoRoot, "");

  const ReconnectionManager = require(
    path.join(ROOT, "src/main/connection/reconnection-manager.js"),
  );
  const SSHPool = require(path.join(ROOT, "src/main/connection/ssh-pool.js"));

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

  it("cancel session ignores late close", testCancelSessionIgnoresLateClose);
  it(
    "ssh pool active close cancels reconnect session",
    testSshPoolActiveCloseCancelsReconnectSession,
  );
});

describe("reconnect-retry-policy", () => {
  const assert = require("node:assert/strict");
  const { EventEmitter } = require("node:events");
  const path = require("node:path");

  const ROOT = _path.resolve(_repoRoot, "");

  const ReconnectionManager = require(
    path.join(ROOT, "src/main/connection/reconnection-manager.js"),
  );
  const {
    DEFAULT_SSH_RETRY_CONFIG,
    buildReconnectTimeoutMessage,
    buildReconnectWaitMessage,
    calculateRetryDelay,
    buildSshRetryConfig,
  } = require(path.join(ROOT, "src/main/connection/ssh-retry-helper.js"));

  function createFakeConnection() {
    const connection = new EventEmitter();
    connection.end = () => {};
    connection.destroy = () => {};
    return connection;
  }

  function waitForEvent(
    emitter,
    eventName,
    timeoutMs = 3000,
    predicate = null,
  ) {
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
    assert.ok(
      fastDelay <= 700,
      `ECONNRESET 快恢延迟应较短，实际 ${fastDelay}ms`,
    );
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
        path.join(ROOT, "src/main/connection/network-resilience-presets.js"),
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
    assert.equal(
      reconnectStartedCount,
      5,
      "预检连续失败时也应记为5次已执行重试",
    );
    assert.equal(failurePayload.attempts, 5, "最终失败时应显示已重试5次");
    assert.equal(
      failurePayload.failureReason,
      "proxy-unavailable",
      "预检失败应暴露更细的失败原因",
    );

    manager.shutdown();
  }

  it(
    "default retry policy is weak-network friendly (120s window)",
    testDefaultRetryPolicyIsWeakNetworkFriendly,
  );
  it(
    "jitter and fast reconnect delay behave as expected",
    testJitterAndFastReconnectDelay,
  );
  it("only weak default policy exists", testOnlyWeakDefaultPolicyExists);
  it(
    "reconnect runs configured retries after failures",
    testReconnectRunsConfiguredRetriesAfterFailures,
  );
  it(
    "preflight failures also count retries",
    testPreflightFailuresAlsoCountRetries,
  );
});

describe("reconnect-tab-status", () => {
  const assert = require("node:assert/strict");
  const { EventEmitter } = require("node:events");
  const path = require("node:path");

  const ROOT = _path.resolve(_repoRoot, "");
  const ReconnectionManager = require(
    path.join(ROOT, "src/main/connection/reconnection-manager.js"),
  );

  const {
    RECONNECT_TAB_STATES,
    buildReconnectBadgeTooltip,
    buildReconnectStatusPatch,
    buildReconnectStatusTitle,
    canPauseReconnectStatus,
    getReconnectStatusColor,
    normalizeReconnectUiState,
    shouldClearOnTabConnectionStatus,
    shouldMarkPendingOnTabConnectionStatus,
  } = require(
    path.join(
      ROOT,
      "src/renderer/features/terminal/model/reconnectTabStatus.js",
    ),
  );

  const t = (key, params = {}) => {
    const messages = {
      "tabMenu.reconnectPending": "pending",
      "tabMenu.reconnectWaitingRetry": `retry in ${params.seconds}`,
      "tabMenu.reconnecting": "reconnecting",
      "tabMenu.reconnectRestoringSession": "restoring session",
      "tabMenu.reconnectFailed": "failed",
      "tabMenu.reconnectStopped": "stopped",
      "tabMenu.reconnectPaused": "paused",
    };
    return messages[key] || key;
  };

  function applyReconnectStatus(previous, tabId, updater, options = {}) {
    if (!tabId) return previous;
    if (options.requireExisting && !previous[tabId]) return previous;

    const current = previous[tabId] || { tabId };
    const draft =
      typeof updater === "function"
        ? updater(current)
        : { ...current, ...updater };
    const normalizedState = normalizeReconnectUiState(draft?.state);

    if (!normalizedState) {
      if (!previous[tabId]) return previous;

      const next = { ...previous };
      delete next[tabId];
      return next;
    }

    return {
      ...previous,
      [tabId]: {
        ...current,
        ...draft,
        tabId,
        state: normalizedState,
        updatedAt: 1,
      },
    };
  }

  function buildActiveReconnectStatus(payload = {}) {
    return buildReconnectStatusPatch("reconnect-progress", {
      attempts: 1,
      maxAttempts: 5,
      failureReason: "network",
      ...payload,
    });
  }

  function buildRestoringStatus(payload = {}) {
    const activeStatus = buildActiveReconnectStatus({
      attempts: payload.attempts ?? 1,
      maxAttempts: payload.maxAttempts ?? 5,
      failureReason: payload.failureReason || "network",
    });

    return buildReconnectStatusPatch(
      "reconnect-success",
      payload,
      activeStatus,
    );
  }

  function testTransportSuccessDoesNotCloseIndicatorBeforeSessionReady() {
    const now = 1_000;
    let status = buildReconnectStatusPatch("connection-lost", {
      reason: "network",
    });

    assert.equal(status.state, RECONNECT_TAB_STATES.PENDING);
    assert.equal(status.phase, "transport");
    assert.equal(Boolean(getReconnectStatusColor(status.state)), true);

    status = buildReconnectStatusPatch("reconnect-started", {
      attempts: 1,
      maxAttempts: 5,
      failureReason: "network",
    });
    assert.equal(status.state, RECONNECT_TAB_STATES.RECONNECTING);
    assert.equal(status.attempts, 1);

    status = buildReconnectStatusPatch("reconnect-progress", {
      attempts: 1,
      maxAttempts: 5,
      delay: 5_000,
      timestamp: now,
      failureReason: "network",
    });
    assert.equal(status.state, RECONNECT_TAB_STATES.PENDING);
    assert.equal(status.nextRetryAt, 6_000);
    assert.equal(buildReconnectStatusTitle(t, status, now), "retry in 5");

    status = buildReconnectStatusPatch(
      "reconnect-success",
      {
        attempts: 2,
        maxAttempts: 5,
      },
      status,
    );
    assert.equal(status.state, RECONNECT_TAB_STATES.RESTORING);
    assert.equal(status.phase, "terminal-session");
    assert.equal(
      buildReconnectBadgeTooltip(t, status),
      "restoring session (2/5)",
    );
    assert.equal(
      shouldClearOnTabConnectionStatus({
        isConnected: true,
        isConnecting: false,
        connectionType: "SSH",
      }),
      true,
      "explicit tab connected status is the terminal-ready completion signal",
    );
    assert.equal(
      shouldClearOnTabConnectionStatus({
        isConnected: true,
        isConnecting: false,
        connectionType: "Local",
      }),
      false,
      "non-SSH connected status must not clear SSH reconnect indicators",
    );
  }

  function testTerminalSessionFailureKeepsFailureIndicatorVisible() {
    let status = buildRestoringStatus({
      attempts: 1,
      maxAttempts: 5,
    });

    status = buildReconnectStatusPatch(
      "terminal-session-restore-failed",
      {
        error: "Unable to create shell",
        hint: "Refresh the connection",
      },
      status,
    );

    assert.equal(status.state, RECONNECT_TAB_STATES.FAILED);
    assert.equal(status.phase, "terminal-session");
    assert.equal(status.error, "Unable to create shell");
    assert.equal(status.hint, "Refresh the connection");
    assert.equal(canPauseReconnectStatus(status), false);
  }

  function testTerminalSessionFailureRequiresExistingReconnectState() {
    const statusWithoutCurrent = buildReconnectStatusPatch(
      "terminal-session-restore-failed",
      {
        error: "Unable to create shell",
        hint: "Refresh the connection",
      },
    );

    assert.equal(normalizeReconnectUiState(statusWithoutCurrent?.state), null);

    const paused = buildReconnectStatusPatch(
      "terminal-session-restore-failed",
      {
        error: "late restore failure",
      },
      {
        state: RECONNECT_TAB_STATES.PAUSED,
        error: "paused by user",
      },
    );
    assert.equal(paused.state, RECONNECT_TAB_STATES.PAUSED);
    assert.equal(paused.error, "late restore failure");

    const failed = buildReconnectStatusPatch(
      "terminal-session-restore-failed",
      {
        error: "late restore failure",
      },
      {
        state: RECONNECT_TAB_STATES.FAILED,
        error: "original failure",
      },
    );
    assert.equal(failed.state, RECONNECT_TAB_STATES.FAILED);
    assert.equal(failed.error, "original failure");
  }

  function testOfflineStatusDuringSessionRestoreBecomesSessionFailure() {
    let status = buildRestoringStatus({
      attempts: 1,
      maxAttempts: 5,
    });

    assert.equal(
      shouldMarkPendingOnTabConnectionStatus({
        isConnected: false,
        isConnecting: false,
        connectionType: "SSH",
      }),
      true,
    );

    status = buildReconnectStatusPatch(
      "tab-connection-offline",
      {
        error: "Shell rejected",
      },
      status,
    );

    assert.equal(status.state, RECONNECT_TAB_STATES.FAILED);
    assert.equal(status.phase, "terminal-session");
    assert.equal(status.error, "Shell rejected");
  }

  function testPausedStateIsExplicitAndNotOverwrittenByOfflineStatus() {
    let status = buildReconnectStatusPatch("reconnect-progress", {
      attempts: 2,
      maxAttempts: 5,
      failureReason: "network",
    });

    assert.equal(canPauseReconnectStatus(status), true);

    status = buildReconnectStatusPatch("reconnect-paused", {}, status);
    assert.equal(status.state, RECONNECT_TAB_STATES.PAUSED);
    assert.equal(buildReconnectStatusTitle(t, status), "paused");
    assert.equal(canPauseReconnectStatus(status), false);

    status = buildReconnectStatusPatch(
      "tab-connection-offline",
      {
        error: "late close",
      },
      status,
    );

    assert.equal(status.state, RECONNECT_TAB_STATES.PAUSED);
    assert.equal(status.error, "late close");
  }

  function testPauseRequiresPauseableTransportState() {
    const statusWithoutCurrent = buildReconnectStatusPatch("reconnect-paused");
    assert.equal(normalizeReconnectUiState(statusWithoutCurrent?.state), null);

    const restoring = buildRestoringStatus({
      attempts: 1,
      maxAttempts: 5,
    });
    const stillRestoring = buildReconnectStatusPatch(
      "reconnect-paused",
      {},
      restoring,
    );
    assert.equal(stillRestoring.state, RECONNECT_TAB_STATES.RESTORING);
    assert.equal(stillRestoring.phase, "terminal-session");

    const failed = buildReconnectStatusPatch(
      "reconnect-paused",
      {},
      {
        state: RECONNECT_TAB_STATES.FAILED,
        error: "original failure",
      },
    );
    assert.equal(failed.state, RECONNECT_TAB_STATES.FAILED);
    assert.equal(failed.error, "original failure");
  }

  function testPausedStateIsNotOverwrittenByLateReconnectEvents() {
    let status = buildActiveReconnectStatus({
      attempts: 2,
      maxAttempts: 5,
    });

    status = buildReconnectStatusPatch("reconnect-paused", {}, status);
    assert.equal(status.state, RECONNECT_TAB_STATES.PAUSED);

    const lateEvents = [
      ["connection-lost", { error: "late connection lost" }],
      ["reconnect-started", { attempts: 3, maxAttempts: 5 }],
      ["reconnect-progress", { attempts: 3, maxAttempts: 5, delay: 1_000 }],
      ["reconnect-success", { attempts: 3, maxAttempts: 5 }],
      ["reconnect-failed", { error: "late failed" }],
      ["reconnect-abandoned", { error: "late abandoned" }],
    ];

    for (const [eventType, payload] of lateEvents) {
      status = buildReconnectStatusPatch(eventType, payload, status);
      assert.equal(
        status.state,
        RECONNECT_TAB_STATES.PAUSED,
        `${eventType} must not overwrite paused state`,
      );
    }

    assert.equal(
      buildReconnectStatusPatch(
        "reconnect-resumed",
        { failureReason: "network" },
        status,
      ).state,
      RECONNECT_TAB_STATES.PENDING,
    );
  }

  function testConnectionLostDoesNotRollbackExistingReconnectProgress() {
    let status = buildActiveReconnectStatus({
      attempts: 2,
      maxAttempts: 5,
      delay: 5_000,
      timestamp: 10_000,
      failureReason: "network",
      windowExpiresAt: 60_000,
    });

    status = buildReconnectStatusPatch(
      "connection-lost",
      { failureReason: "network" },
      status,
    );

    assert.equal(status.state, RECONNECT_TAB_STATES.PENDING);
    assert.equal(status.attempts, 2);
    assert.equal(status.maxAttempts, 5);
    assert.equal(status.nextRetryAt, 15_000);
    assert.equal(status.windowExpiresAt, 60_000);
  }

  function testRestoringSessionIsNotPauseableReconnectTransport() {
    const status = buildRestoringStatus({
      attempts: 1,
      maxAttempts: 5,
    });

    assert.equal(status.state, RECONNECT_TAB_STATES.RESTORING);
    assert.equal(status.phase, "terminal-session");
    assert.equal(canPauseReconnectStatus(status), false);
  }

  function testTransportSuccessRequiresExistingReconnectState() {
    const statusWithoutCurrent = buildReconnectStatusPatch(
      "reconnect-success",
      {
        attempts: 1,
        maxAttempts: 5,
      },
    );

    assert.equal(normalizeReconnectUiState(statusWithoutCurrent?.state), null);

    let stateByTabId = {};
    stateByTabId = applyReconnectStatus(stateByTabId, "tab-1", (current) =>
      buildReconnectStatusPatch(
        "reconnect-success",
        { attempts: 1, maxAttempts: 5 },
        current,
      ),
    );

    assert.deepEqual(
      stateByTabId,
      {},
      "transport success must not create a reconnect indicator without active reconnect state",
    );
  }

  function testOfflineStatusDoesNotCreateIndicatorWithoutExistingReconnectState() {
    let stateByTabId = {};

    stateByTabId = applyReconnectStatus(
      stateByTabId,
      "tab-1",
      (current) =>
        buildReconnectStatusPatch(
          "tab-connection-offline",
          { error: "offline before reconnect" },
          current,
        ),
      { requireExisting: true },
    );

    assert.deepEqual(
      stateByTabId,
      {},
      "offline tab status must not create a reconnect indicator by itself",
    );

    stateByTabId = applyReconnectStatus(stateByTabId, "tab-1", (current) =>
      buildReconnectStatusPatch(
        "connection-lost",
        { failureReason: "network" },
        current,
      ),
    );
    stateByTabId = applyReconnectStatus(
      stateByTabId,
      "tab-1",
      (current) =>
        buildReconnectStatusPatch(
          "tab-connection-offline",
          { error: "offline after reconnect" },
          current,
        ),
      { requireExisting: true },
    );

    assert.equal(stateByTabId["tab-1"].state, RECONNECT_TAB_STATES.PENDING);
    assert.equal(stateByTabId["tab-1"].error, "offline after reconnect");
  }

  function testResumeRequiresPausedState() {
    const pending = buildReconnectStatusPatch("connection-lost", {
      failureReason: "network",
    });
    const stillPending = buildReconnectStatusPatch(
      "reconnect-resumed",
      { failureReason: "network" },
      pending,
    );

    assert.deepEqual(stillPending, pending);

    let paused = buildReconnectStatusPatch("reconnect-paused", {}, pending);
    paused = buildReconnectStatusPatch(
      "reconnect-resumed",
      { failureReason: "network" },
      paused,
    );

    assert.equal(paused.state, RECONNECT_TAB_STATES.PENDING);
  }

  function testFinalStatusIsNotReactivatedByLateEvents() {
    let status = buildReconnectStatusPatch("reconnect-failed", {
      attempts: 5,
      maxAttempts: 5,
      error: "max retries reached",
    });

    status = buildReconnectStatusPatch(
      "connection-lost",
      { error: "late stream close" },
      status,
    );
    assert.equal(status.state, RECONNECT_TAB_STATES.FAILED);
    assert.equal(status.error, "max retries reached");

    status = buildReconnectStatusPatch(
      "tab-connection-offline",
      { error: "late offline status" },
      status,
    );
    assert.equal(status.state, RECONNECT_TAB_STATES.FAILED);
    assert.equal(status.error, "max retries reached");

    status = buildReconnectStatusPatch(
      "reconnect-success",
      { attempts: 6, maxAttempts: 5 },
      status,
    );
    assert.equal(status.state, RECONNECT_TAB_STATES.FAILED);
    assert.equal(status.error, "max retries reached");

    status = buildReconnectStatusPatch(
      "reconnect-resumed",
      { failureReason: "network" },
      status,
    );
    assert.equal(status.state, RECONNECT_TAB_STATES.FAILED);
    assert.equal(status.error, "max retries reached");

    status = buildReconnectStatusPatch(
      "terminal-session-restore-failed",
      { error: "late session failure" },
      status,
    );
    assert.equal(status.state, RECONNECT_TAB_STATES.FAILED);
    assert.equal(status.error, "max retries reached");

    status = buildReconnectStatusPatch("reconnect-abandoned", {
      attempts: 5,
      maxAttempts: 5,
      error: "automatic reconnect stopped",
    });
    status = buildReconnectStatusPatch(
      "tab-connection-offline",
      { error: "late offline status" },
      status,
    );
    assert.equal(status.state, RECONNECT_TAB_STATES.ABANDONED);
    assert.equal(status.error, "automatic reconnect stopped");
  }

  function testStateNormalizationIsStrict() {
    assert.equal(normalizeReconnectUiState("connected"), null);
    assert.equal(normalizeReconnectUiState("idle"), null);
    assert.equal(normalizeReconnectUiState("restoring"), "restoring");
  }

  function testBackendPauseResumeReturnActualStateChanges() {
    const manager = new ReconnectionManager({
      initialDelay: 60_000,
      maxRetries: 3,
    });
    const connection = new EventEmitter();
    const sessionId = "tab:tab-1:example.com:22:root";

    manager.registerSession(
      sessionId,
      connection,
      {
        host: "example.com",
        port: 22,
        username: "root",
      },
      {
        autoStart: false,
        state: "connected",
      },
    );

    let result = manager.pauseReconnection(sessionId);
    assert.equal(result.success, false);
    assert.equal(result.state, "connected");
    assert.equal(manager.getSessionStatus(sessionId).state, "connected");

    result = manager.resumeReconnection(sessionId);
    assert.equal(result.success, false);
    assert.equal(result.state, "connected");

    const session = manager.sessions.get(sessionId);
    session.state = "pending";
    result = manager.pauseReconnection(sessionId);
    assert.equal(result.success, true);
    assert.equal(result.previousState, "pending");
    assert.equal(result.state, "paused");
    assert.equal(manager.getSessionStatus(sessionId).state, "paused");

    result = manager.pauseReconnection(sessionId);
    assert.equal(result.success, false);
    assert.equal(result.state, "paused");

    result = manager.resumeReconnection(sessionId);
    assert.equal(result.success, true);
    assert.equal(result.previousState, "paused");
    assert.equal(result.state, "pending");
    assert.equal(manager.getSessionStatus(sessionId).state, "pending");

    result = manager.resumeReconnection(sessionId);
    assert.equal(result.success, false);
    assert.equal(result.state, "pending");

    manager.cancelSession(sessionId, "check-cleanup");
  }

  it(
    "transport success does not close indicator before session ready",
    testTransportSuccessDoesNotCloseIndicatorBeforeSessionReady,
  );
  it(
    "terminal session failure keeps failure indicator visible",
    testTerminalSessionFailureKeepsFailureIndicatorVisible,
  );
  it(
    "terminal session failure requires existing reconnect state",
    testTerminalSessionFailureRequiresExistingReconnectState,
  );
  it(
    "offline status during session restore becomes session failure",
    testOfflineStatusDuringSessionRestoreBecomesSessionFailure,
  );
  it(
    "paused state is explicit and not overwritten by offline status",
    testPausedStateIsExplicitAndNotOverwrittenByOfflineStatus,
  );
  it(
    "pause requires pauseable transport state",
    testPauseRequiresPauseableTransportState,
  );
  it(
    "paused state is not overwritten by late reconnect events",
    testPausedStateIsNotOverwrittenByLateReconnectEvents,
  );
  it(
    "connection lost does not rollback existing reconnect progress",
    testConnectionLostDoesNotRollbackExistingReconnectProgress,
  );
  it(
    "restoring session is not pauseable reconnect transport",
    testRestoringSessionIsNotPauseableReconnectTransport,
  );
  it(
    "transport success requires existing reconnect state",
    testTransportSuccessRequiresExistingReconnectState,
  );
  it(
    "offline status does not create indicator without existing reconnect state",
    testOfflineStatusDoesNotCreateIndicatorWithoutExistingReconnectState,
  );
  it("resume requires paused state", testResumeRequiresPausedState);
  it(
    "final status is not reactivated by late events",
    testFinalStatusIsNotReactivatedByLateEvents,
  );
  it("state normalization is strict", testStateNormalizationIsStrict);
  it(
    "backend pause/resume returns actual state changes",
    testBackendPauseResumeReturnActualStateChanges,
  );
});
