const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ReconnectionManager = require(
  path.join(ROOT, "src/core/connection/reconnection-manager.js"),
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
} = require(path.join(ROOT, "src/modules/terminal/reconnectTabStatus.js"));

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

  return buildReconnectStatusPatch("reconnect-success", payload, activeStatus);
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
      hint: "Reconnect manually",
    },
    status,
  );

  assert.equal(status.state, RECONNECT_TAB_STATES.FAILED);
  assert.equal(status.phase, "terminal-session");
  assert.equal(status.error, "Unable to create shell");
  assert.equal(status.hint, "Reconnect manually");
  assert.equal(canPauseReconnectStatus(status), false);
}

function testTerminalSessionFailureRequiresExistingReconnectState() {
  const statusWithoutCurrent = buildReconnectStatusPatch(
    "terminal-session-restore-failed",
    {
      error: "Unable to create shell",
      hint: "Reconnect manually",
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
  assert.equal(
    buildReconnectStatusPatch(
      "manual-reconnect-started",
      { failureReason: "network" },
      status,
    ).state,
    RECONNECT_TAB_STATES.RECONNECTING,
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
  const statusWithoutCurrent = buildReconnectStatusPatch("reconnect-success", {
    attempts: 1,
    maxAttempts: 5,
  });

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

function run() {
  const tests = [
    [
      "transport success does not close indicator before session ready",
      testTransportSuccessDoesNotCloseIndicatorBeforeSessionReady,
    ],
    [
      "terminal session failure keeps failure indicator visible",
      testTerminalSessionFailureKeepsFailureIndicatorVisible,
    ],
    [
      "terminal session failure requires existing reconnect state",
      testTerminalSessionFailureRequiresExistingReconnectState,
    ],
    [
      "offline status during session restore becomes session failure",
      testOfflineStatusDuringSessionRestoreBecomesSessionFailure,
    ],
    [
      "paused state is explicit and not overwritten by offline status",
      testPausedStateIsExplicitAndNotOverwrittenByOfflineStatus,
    ],
    [
      "pause requires pauseable transport state",
      testPauseRequiresPauseableTransportState,
    ],
    [
      "paused state is not overwritten by late reconnect events",
      testPausedStateIsNotOverwrittenByLateReconnectEvents,
    ],
    [
      "connection lost does not rollback existing reconnect progress",
      testConnectionLostDoesNotRollbackExistingReconnectProgress,
    ],
    [
      "restoring session is not pauseable reconnect transport",
      testRestoringSessionIsNotPauseableReconnectTransport,
    ],
    [
      "transport success requires existing reconnect state",
      testTransportSuccessRequiresExistingReconnectState,
    ],
    [
      "offline status does not create indicator without existing reconnect state",
      testOfflineStatusDoesNotCreateIndicatorWithoutExistingReconnectState,
    ],
    ["resume requires paused state", testResumeRequiresPausedState],
    [
      "final status is not reactivated by late events",
      testFinalStatusIsNotReactivatedByLateEvents,
    ],
    ["state normalization is strict", testStateNormalizationIsStrict],
    [
      "backend pause/resume returns actual state changes",
      testBackendPauseResumeReturnActualStateChanges,
    ],
  ];

  tests.forEach(([name, fn]) => {
    fn();
    console.log(`PASS ${name}`);
  });

  console.log(`\n${tests.length} reconnect tab status checks passed.`);
}

run();
