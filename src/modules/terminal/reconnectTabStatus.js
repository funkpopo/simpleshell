const RECONNECT_TAB_STATES = Object.freeze({
  PENDING: "pending",
  RECONNECTING: "reconnecting",
  RESTORING: "restoring",
  FAILED: "failed",
  ABANDONED: "abandoned",
  PAUSED: "paused",
});

const RECONNECT_STATE_COLORS = Object.freeze({
  [RECONNECT_TAB_STATES.PENDING]: "#ed6c02",
  [RECONNECT_TAB_STATES.RECONNECTING]: "#0288d1",
  [RECONNECT_TAB_STATES.RESTORING]: "#00897b",
  [RECONNECT_TAB_STATES.FAILED]: "#d32f2f",
  [RECONNECT_TAB_STATES.ABANDONED]: "#d32f2f",
  [RECONNECT_TAB_STATES.PAUSED]: "#9e9e9e",
});

const normalizeReconnectUiState = (state) => {
  switch (String(state || "").toLowerCase()) {
    case RECONNECT_TAB_STATES.PENDING:
    case RECONNECT_TAB_STATES.RECONNECTING:
    case RECONNECT_TAB_STATES.RESTORING:
    case RECONNECT_TAB_STATES.FAILED:
    case RECONNECT_TAB_STATES.ABANDONED:
    case RECONNECT_TAB_STATES.PAUSED:
      return String(state).toLowerCase();
    default:
      return null;
  }
};

const getReconnectStatusColor = (state) =>
  RECONNECT_STATE_COLORS[normalizeReconnectUiState(state)] || null;

const getReconnectCountdownSeconds = (nextReconnectAt, now = Date.now()) => {
  const target = Number(nextReconnectAt);
  if (!Number.isFinite(target) || target <= 0) {
    return null;
  }
  return Math.max(0, Math.ceil((target - now) / 1000));
};

const getReconnectNextAt = (status) =>
  status?.nextRetryAt ?? status?.nextReconnectAt ?? null;

const shouldClearOnTabConnectionStatus = (connectionStatus) =>
  connectionStatus?.isConnected === true &&
  connectionStatus?.isConnecting !== true &&
  String(connectionStatus?.connectionType || "").toLowerCase() === "ssh";

const shouldMarkPendingOnTabConnectionStatus = (connectionStatus) =>
  connectionStatus?.isConnected === false &&
  connectionStatus?.isConnecting !== true &&
  String(connectionStatus?.connectionType || "").toLowerCase() === "ssh";

const isPausedReconnectStatus = (status) =>
  normalizeReconnectUiState(status?.state) === RECONNECT_TAB_STATES.PAUSED;

const isActiveReconnectStatus = (status) => {
  const state = normalizeReconnectUiState(status?.state);
  return (
    state === RECONNECT_TAB_STATES.PENDING ||
    state === RECONNECT_TAB_STATES.RECONNECTING ||
    state === RECONNECT_TAB_STATES.RESTORING
  );
};

const isFinalReconnectStatus = (status) => {
  const state = normalizeReconnectUiState(status?.state);
  return (
    state === RECONNECT_TAB_STATES.FAILED ||
    state === RECONNECT_TAB_STATES.ABANDONED
  );
};

const preservePausedReconnectStatus = (current = {}, payload = {}) => ({
  ...current,
  error: payload?.error || current?.error || null,
  hint: payload?.hint || current?.hint || null,
});

const preserveActiveReconnectStatus = (current = {}, payload = {}) => ({
  ...current,
  phase: current?.phase || "transport",
  windowExpiresAt:
    Number(payload?.windowExpiresAt || current?.windowExpiresAt || 0) || null,
  failureReason:
    payload?.failureReason ||
    payload?.reason ||
    current?.failureReason ||
    "network",
  error: payload?.error || null,
  hint: payload?.hint || current?.hint || null,
});

const buildReconnectStatusPatch = (eventType, payload = {}, current = {}) => {
  switch (eventType) {
    case "connection-lost":
      if (isPausedReconnectStatus(current)) {
        return preservePausedReconnectStatus(current, payload);
      }

      if (isFinalReconnectStatus(current)) {
        return current;
      }

      if (
        normalizeReconnectUiState(current?.state) ===
          RECONNECT_TAB_STATES.PENDING ||
        normalizeReconnectUiState(current?.state) ===
          RECONNECT_TAB_STATES.RECONNECTING
      ) {
        return preserveActiveReconnectStatus(current, payload);
      }

      return {
        ...current,
        state: RECONNECT_TAB_STATES.PENDING,
        phase: "transport",
        nextRetryAt: null,
        windowExpiresAt:
          Number(payload?.windowExpiresAt || current?.windowExpiresAt || 0) ||
          null,
        failureReason: payload?.failureReason || payload?.reason || "network",
        error: null,
        hint: payload?.hint || null,
      };

    case "reconnect-started":
      if (isPausedReconnectStatus(current)) {
        return preservePausedReconnectStatus(current, payload);
      }

      if (isFinalReconnectStatus(current)) {
        return current;
      }

      return {
        state: RECONNECT_TAB_STATES.RECONNECTING,
        attempts: Number(payload?.attempts || 0),
        maxAttempts: Number(payload?.maxAttempts || 0),
        phase: "transport",
        nextRetryAt: null,
        windowExpiresAt: Number(payload?.windowExpiresAt || 0) || null,
        failureReason: payload?.failureReason || null,
        error: null,
        hint: payload?.hint || null,
      };

    case "reconnect-progress": {
      if (isPausedReconnectStatus(current)) {
        return preservePausedReconnectStatus(current, payload);
      }

      if (isFinalReconnectStatus(current)) {
        return current;
      }

      const delay = Number(payload?.delay || 0);
      const baseTimestamp = Number(payload?.timestamp || Date.now());
      return {
        state: RECONNECT_TAB_STATES.PENDING,
        attempts: Number(payload?.attempts || 0),
        maxAttempts: Number(payload?.maxAttempts || 0),
        phase: "transport",
        nextRetryAt:
          Number.isFinite(delay) && delay > 0 ? baseTimestamp + delay : null,
        windowExpiresAt: Number(payload?.windowExpiresAt || 0) || null,
        failureReason: payload?.failureReason || null,
        error: null,
        hint: payload?.hint || null,
      };
    }

    case "reconnect-success":
      if (isPausedReconnectStatus(current)) {
        return preservePausedReconnectStatus(current, payload);
      }

      if (
        isFinalReconnectStatus(current) ||
        !isActiveReconnectStatus(current)
      ) {
        return current;
      }

      return {
        ...current,
        state: RECONNECT_TAB_STATES.RESTORING,
        attempts: Number(payload?.attempts ?? current?.attempts ?? 0),
        maxAttempts: Number(payload?.maxAttempts ?? current?.maxAttempts ?? 0),
        phase: "terminal-session",
        nextRetryAt: null,
        windowExpiresAt: Number(payload?.windowExpiresAt || 0) || null,
        failureReason: payload?.failureReason || current?.failureReason || null,
        error: null,
        hint: payload?.hint || null,
      };

    case "reconnect-failed":
      if (isPausedReconnectStatus(current)) {
        return preservePausedReconnectStatus(current, payload);
      }

      if (isFinalReconnectStatus(current)) {
        return current;
      }

      return {
        state: RECONNECT_TAB_STATES.FAILED,
        attempts: Number(payload?.attempts || 0),
        maxAttempts: Number(payload?.maxAttempts || 0),
        phase: "transport",
        nextRetryAt: null,
        windowExpiresAt: Number(payload?.windowExpiresAt || 0) || null,
        failureReason: payload?.failureReason || null,
        error: payload?.error || null,
        hint: payload?.hint || null,
      };

    case "reconnect-abandoned":
      if (isPausedReconnectStatus(current)) {
        return preservePausedReconnectStatus(current, payload);
      }

      if (isFinalReconnectStatus(current)) {
        return current;
      }

      return {
        state: RECONNECT_TAB_STATES.ABANDONED,
        attempts: Number(payload?.attempts || 0),
        maxAttempts: Number(payload?.maxAttempts || 0),
        phase: "transport",
        nextRetryAt: null,
        windowExpiresAt: Number(payload?.windowExpiresAt || 0) || null,
        failureReason: payload?.failureReason || null,
        error: payload?.error || null,
        hint: payload?.hint || null,
      };

    case "reconnect-paused":
      if (!canPauseReconnectStatus(current)) {
        return current;
      }

      return {
        ...current,
        state: RECONNECT_TAB_STATES.PAUSED,
        phase: "transport",
        nextRetryAt: null,
        windowExpiresAt: Number(payload?.windowExpiresAt || 0) || null,
        failureReason: payload?.failureReason || current?.failureReason || null,
        error: payload?.error || null,
        hint: payload?.hint || current?.hint || null,
      };

    case "reconnect-resumed":
      if (!isPausedReconnectStatus(current)) {
        return current;
      }

      return {
        ...current,
        state: RECONNECT_TAB_STATES.PENDING,
        phase: "transport",
        nextRetryAt: null,
        windowExpiresAt:
          Number(payload?.windowExpiresAt || current?.windowExpiresAt || 0) ||
          null,
        failureReason:
          payload?.failureReason || current?.failureReason || "network",
        error: null,
        hint: payload?.hint || current?.hint || null,
      };

    case "terminal-session-restore-failed":
      if (isPausedReconnectStatus(current)) {
        return preservePausedReconnectStatus(current, payload);
      }

      if (
        isFinalReconnectStatus(current) ||
        !isActiveReconnectStatus(current)
      ) {
        return current;
      }

      return {
        state: RECONNECT_TAB_STATES.FAILED,
        phase: "terminal-session",
        attempts: Number(payload?.attempts || current?.attempts || 0),
        maxAttempts: Number(payload?.maxAttempts || current?.maxAttempts || 0),
        nextRetryAt: null,
        windowExpiresAt:
          Number(payload?.windowExpiresAt || current?.windowExpiresAt || 0) ||
          null,
        failureReason: payload?.failureReason || "network",
        error: payload?.error || null,
        hint: payload?.hint || current?.hint || null,
      };

    case "tab-connection-offline":
      if (isPausedReconnectStatus(current)) {
        return preservePausedReconnectStatus(current, payload);
      }

      if (isFinalReconnectStatus(current)) {
        return current;
      }

      if (
        normalizeReconnectUiState(current?.state) ===
          RECONNECT_TAB_STATES.RESTORING ||
        current?.phase === "terminal-session"
      ) {
        return {
          ...current,
          state: RECONNECT_TAB_STATES.FAILED,
          phase: "terminal-session",
          nextRetryAt: null,
          windowExpiresAt: current?.windowExpiresAt || null,
          failureReason:
            payload?.failureReason || current?.failureReason || "network",
          error: payload?.error || null,
          hint: payload?.hint || current?.hint || null,
        };
      }

      if (!isActiveReconnectStatus(current)) {
        return current;
      }

      return {
        ...current,
        state: RECONNECT_TAB_STATES.PENDING,
        phase: "transport",
        nextRetryAt: null,
        windowExpiresAt: current?.windowExpiresAt || null,
        failureReason: payload?.failureReason || "network",
        error: payload?.error || null,
        hint: payload?.hint || current?.hint || null,
      };

    default:
      return current || null;
  }
};

const buildReconnectStatusTitle = (t, status, now = Date.now()) => {
  const state = normalizeReconnectUiState(status?.state);
  const seconds = getReconnectCountdownSeconds(getReconnectNextAt(status), now);

  switch (state) {
    case RECONNECT_TAB_STATES.PENDING:
      return Number.isFinite(seconds) && seconds > 0
        ? t("tabMenu.reconnectWaitingRetry", { seconds })
        : t("tabMenu.reconnectPending");
    case RECONNECT_TAB_STATES.RECONNECTING:
      return t("tabMenu.reconnecting");
    case RECONNECT_TAB_STATES.RESTORING:
      return t("tabMenu.reconnectRestoringSession");
    case RECONNECT_TAB_STATES.FAILED:
      return t("tabMenu.reconnectFailed");
    case RECONNECT_TAB_STATES.ABANDONED:
      return t("tabMenu.reconnectStopped");
    case RECONNECT_TAB_STATES.PAUSED:
      return t("tabMenu.reconnectPaused");
    default:
      return null;
  }
};

const buildReconnectBadgeTooltip = (t, status, now = Date.now()) => {
  const title = buildReconnectStatusTitle(t, status, now);
  if (!title) {
    return null;
  }

  const attempts = Number(status?.attempts);
  const maxAttempts = Number(status?.maxAttempts);
  if (
    Number.isFinite(attempts) &&
    Number.isFinite(maxAttempts) &&
    maxAttempts
  ) {
    return `${title} (${attempts}/${maxAttempts})`;
  }

  return title;
};

const canPauseReconnectStatus = (status) => {
  const state = normalizeReconnectUiState(status?.state);
  return (
    state === RECONNECT_TAB_STATES.PENDING ||
    state === RECONNECT_TAB_STATES.RECONNECTING
  );
};

module.exports = {
  RECONNECT_TAB_STATES,
  buildReconnectBadgeTooltip,
  buildReconnectStatusPatch,
  buildReconnectStatusTitle,
  canPauseReconnectStatus,
  getReconnectNextAt,
  getReconnectStatusColor,
  isPausedReconnectStatus,
  normalizeReconnectUiState,
  shouldClearOnTabConnectionStatus,
  shouldMarkPendingOnTabConnectionStatus,
};
