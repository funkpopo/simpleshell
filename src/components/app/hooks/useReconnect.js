import * as React from "react";
import { useCallback, useMemo, useRef } from "react";
import {
  retainLiveSessionEntries,
  getLiveSessionKeys,
} from "../../../modules/terminal/paneLayout.js";
// Import i18n configuration
import { useTranslation } from "react-i18next";
import { useNotification } from "../../../contexts/NotificationContext.jsx";
import {
  buildReconnectStatusPatch,
  normalizeReconnectUiState,
  shouldClearOnTabConnectionStatus,
  shouldMarkPendingOnTabConnectionStatus,
} from "../../../modules/terminal/reconnectTabStatus.js";

export default function useReconnect({ tabs, splitLayouts, tabContextMenu }) {
  const { showError, showInfo } = useNotification();
  const { t } = useTranslation();
  const [connectionStatusByTabId, setConnectionStatusByTabId] = React.useState(
    {},
  );

  const liveSessionKeys = useMemo(
    () => getLiveSessionKeys(tabs, splitLayouts),
    [tabs, splitLayouts],
  );

  const liveSessionKeysRef = useRef(new Set());

  liveSessionKeysRef.current = new Set(liveSessionKeys);

  const [reconnectStateByTabId, setReconnectStateByTabId] = React.useState({});

  const [reconnectActionTabId, setReconnectActionTabId] = React.useState(null);

  const [reconnectNow, setReconnectNow] = React.useState(Date.now());

  const updateReconnectStatus = useCallback((tabId, updater, options = {}) => {
    if (!tabId || !liveSessionKeysRef.current.has(tabId)) {
      return;
    }

    setReconnectStateByTabId((previous) => {
      if (options.requireExisting && !previous[tabId]) {
        return previous;
      }

      const current = previous[tabId] || { tabId };
      const draft =
        typeof updater === "function"
          ? updater(current)
          : { ...current, ...updater };
      const normalizedState = normalizeReconnectUiState(draft?.state);

      if (!normalizedState) {
        if (!previous[tabId]) {
          return previous;
        }

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
          updatedAt: Date.now(),
        },
      };
    });
  }, []);

  const clearReconnectStatus = useCallback((tabId) => {
    if (!tabId) {
      return;
    }

    setReconnectStateByTabId((previous) => {
      if (!previous[tabId]) {
        return previous;
      }

      const next = { ...previous };
      delete next[tabId];
      return next;
    });
  }, []);

  const loadTabConnectionStatus = useCallback(async (tabId) => {
    if (!tabId || !window.terminalAPI?.getTabConnectionStatus) {
      return;
    }

    try {
      const response = await window.terminalAPI.getTabConnectionStatus(tabId);
      if (!liveSessionKeysRef.current.has(tabId)) return;
      const status = response?.success ? response.data : null;
      setConnectionStatusByTabId((previous) => {
        if (!status) {
          if (!previous[tabId]) {
            return previous;
          }
          const next = { ...previous };
          delete next[tabId];
          return next;
        }

        return {
          ...previous,
          [tabId]: {
            ...(previous[tabId] || {}),
            ...status,
            lastUpdate: status.lastUpdate || Date.now(),
          },
        };
      });
    } catch (error) {
      console.warn("Failed to load tab connection status:", error);
    }
  }, []);

  const loadReconnectStatus = useCallback(
    async (tabId) => {
      if (!tabId || !window.terminalAPI?.getReconnectStatus) {
        return;
      }

      try {
        const status = await window.terminalAPI.getReconnectStatus({ tabId });
        if (!liveSessionKeysRef.current.has(tabId)) return;
        const normalizedState = normalizeReconnectUiState(status?.state);
        if (!normalizedState) {
          return;
        }

        updateReconnectStatus(tabId, {
          state: normalizedState,
          attempts: Number(status?.retryCount || 0),
          maxAttempts: Number(
            status?.effectiveMaxRetries ?? status?.maxRetries ?? 0,
          ),
          phase: null,
          nextRetryAt: Number(status?.nextReconnectAt || 0) || null,
          windowExpiresAt: Number(status?.windowExpiresAt || 0) || null,
          failureReason: status?.failureReason || null,
          error: status?.lastError || null,
          hint: null,
        });
      } catch (error) {
        console.warn("Failed to load reconnect status:", error);
      }
    },
    [updateReconnectStatus],
  );

  React.useEffect(() => {
    const activeTabIds = new Set(liveSessionKeys);
    const retain = (previous) =>
      retainLiveSessionEntries(previous, activeTabIds);
    setReconnectStateByTabId(retain);
    setConnectionStatusByTabId(retain);
  }, [liveSessionKeys]);

  React.useEffect(() => {
    if (!window.terminalAPI) {
      return undefined;
    }

    const handleConnectionLost = (_event, payload) => {
      if (!payload?.tabId) {
        return;
      }

      updateReconnectStatus(payload.tabId, (current) =>
        buildReconnectStatusPatch("connection-lost", payload, current),
      );
    };

    const handleReconnectStarted = (_event, payload) => {
      if (!payload?.tabId) {
        return;
      }

      updateReconnectStatus(payload.tabId, (current) =>
        buildReconnectStatusPatch("reconnect-started", payload, current),
      );
      setReconnectActionTabId((current) =>
        current === payload.tabId ? null : current,
      );
    };

    const handleReconnectProgress = (_event, payload) => {
      if (!payload?.tabId) {
        return;
      }

      updateReconnectStatus(payload.tabId, (current) =>
        buildReconnectStatusPatch("reconnect-progress", payload, current),
      );
      setReconnectActionTabId((current) =>
        current === payload.tabId ? null : current,
      );
    };

    const handleReconnectSuccess = (_event, payload) => {
      if (!payload?.tabId) {
        return;
      }

      updateReconnectStatus(payload.tabId, (current) =>
        buildReconnectStatusPatch("reconnect-success", payload, current),
      );
      setReconnectActionTabId((current) =>
        current === payload.tabId ? null : current,
      );
    };

    const handleReconnectFailed = (_event, payload) => {
      if (!payload?.tabId) {
        return;
      }

      updateReconnectStatus(payload.tabId, (current) =>
        buildReconnectStatusPatch("reconnect-failed", payload, current),
      );
      setReconnectActionTabId((current) =>
        current === payload.tabId ? null : current,
      );
    };

    const handleReconnectAbandoned = (_event, payload) => {
      if (!payload?.tabId) {
        return;
      }

      updateReconnectStatus(payload.tabId, (current) =>
        buildReconnectStatusPatch("reconnect-abandoned", payload, current),
      );
      setReconnectActionTabId((current) =>
        current === payload.tabId ? null : current,
      );
    };

    const handleTerminalSessionRestored = (payload) => {
      window.dispatchEvent(
        new CustomEvent("terminalSessionRestored", {
          detail: payload || {},
        }),
      );

      if (!payload?.tabId) {
        return;
      }

      clearReconnectStatus(payload.tabId);
      setReconnectActionTabId((current) =>
        current === payload.tabId ? null : current,
      );
    };

    const handleTerminalSessionRestoreFailed = (payload) => {
      window.dispatchEvent(
        new CustomEvent("terminalSessionRestoreFailed", {
          detail: payload || {},
        }),
      );

      if (!payload?.tabId) {
        return;
      }

      updateReconnectStatus(payload.tabId, (current) =>
        buildReconnectStatusPatch(
          "terminal-session-restore-failed",
          {
            ...payload,
            hint:
              payload?.hint || t("tabMenu.reconnectSessionRestoreFailedHint"),
          },
          current,
        ),
      );
      setReconnectActionTabId((current) =>
        current === payload.tabId ? null : current,
      );
    };

    const handleTabConnectionStatus = (payload) => {
      if (!payload?.tabId) {
        return;
      }

      if (!liveSessionKeysRef.current.has(payload.tabId)) return;

      setConnectionStatusByTabId((previous) => ({
        ...previous,
        [payload.tabId]: {
          ...(previous[payload.tabId] || {}),
          ...(payload.connectionStatus || {}),
          lastUpdate:
            payload.connectionStatus?.lastUpdate ||
            payload.timestamp ||
            Date.now(),
        },
      }));

      if (shouldClearOnTabConnectionStatus(payload.connectionStatus)) {
        clearReconnectStatus(payload.tabId);
        setReconnectActionTabId((current) =>
          current === payload.tabId ? null : current,
        );

        // 连接成功时强制刷新终端内容
        if (payload.connectionStatus?.isConnected === true) {
          window.dispatchEvent(
            new CustomEvent("terminalForceRefresh", {
              detail: { tabId: payload.tabId, layoutType: "default" },
            }),
          );
        }
        return;
      }

      if (shouldMarkPendingOnTabConnectionStatus(payload.connectionStatus)) {
        updateReconnectStatus(
          payload.tabId,
          (current) =>
            buildReconnectStatusPatch(
              "tab-connection-offline",
              {
                failureReason: payload?.connectionStatus?.failureReason,
                error: payload?.connectionStatus?.error,
              },
              current,
            ),
          { requireExisting: true },
        );
      }
    };

    const reconnectCleanups = [
      window.terminalAPI.onConnectionLost?.(handleConnectionLost),
      window.terminalAPI.onReconnectStart?.(handleReconnectStarted),
      window.terminalAPI.onReconnectProgress?.(handleReconnectProgress),
      window.terminalAPI.onReconnectSuccess?.(handleReconnectSuccess),
      window.terminalAPI.onReconnectFailed?.(handleReconnectFailed),
      window.terminalAPI.onReconnectAbandoned?.(handleReconnectAbandoned),
    ];
    const cleanupTabConnectionStatus =
      window.terminalAPI.onTabConnectionStatus?.(handleTabConnectionStatus);
    const cleanupTerminalSessionRestored =
      window.terminalAPI.onTerminalSessionRestored?.(
        handleTerminalSessionRestored,
      );
    const cleanupTerminalSessionRestoreFailed =
      window.terminalAPI.onTerminalSessionRestoreFailed?.(
        handleTerminalSessionRestoreFailed,
      );

    return () => {
      if (typeof cleanupTabConnectionStatus === "function") {
        cleanupTabConnectionStatus();
      }
      if (typeof cleanupTerminalSessionRestored === "function") {
        cleanupTerminalSessionRestored();
      }
      if (typeof cleanupTerminalSessionRestoreFailed === "function") {
        cleanupTerminalSessionRestoreFailed();
      }
      reconnectCleanups.forEach((cleanup) => {
        if (typeof cleanup === "function") cleanup();
      });
    };
  }, [clearReconnectStatus, t, updateReconnectStatus]);

  const handlePauseReconnect = useCallback(
    async (tabId) => {
      if (!tabId) {
        return;
      }

      if (!window.terminalAPI?.pauseReconnect) {
        showError(t("app.apiNotFound"));
        return;
      }

      setReconnectActionTabId(tabId);

      try {
        const result = await window.terminalAPI.pauseReconnect({ tabId });
        if (result && result.success === false) {
          throw new Error(result.error || t("tabMenu.pauseReconnect"));
        }

        updateReconnectStatus(tabId, (current) =>
          buildReconnectStatusPatch("reconnect-paused", {}, current),
        );
        setReconnectActionTabId(null);
        showInfo(t("tabMenu.pauseReconnectDone"));
        return true;
      } catch (error) {
        setReconnectActionTabId(null);
        showError(error?.message || t("tabMenu.pauseReconnect"));
      }
    },
    [showError, showInfo, t, updateReconnectStatus],
  );

  const handleResumeReconnect = useCallback(
    async (tabId) => {
      if (!tabId) {
        return;
      }

      if (!window.terminalAPI?.resumeReconnect) {
        showError(t("app.apiNotFound"));
        return;
      }

      setReconnectActionTabId(tabId);

      try {
        const result = await window.terminalAPI.resumeReconnect({ tabId });
        if (result && result.success === false) {
          throw new Error(result.error || t("tabMenu.resumeReconnect"));
        }

        updateReconnectStatus(tabId, (current) =>
          buildReconnectStatusPatch(
            "reconnect-resumed",
            {
              failureReason: current?.failureReason || "network",
              windowExpiresAt: current?.windowExpiresAt || null,
            },
            current,
          ),
        );
        setReconnectActionTabId(null);
        showInfo(t("tabMenu.resumeReconnectDone"));
        return true;
      } catch (error) {
        setReconnectActionTabId(null);
        showError(error?.message || t("tabMenu.resumeReconnect"));
      }
    },
    [showError, showInfo, t, updateReconnectStatus],
  );
  const countdownStatus = reconnectStateByTabId[tabContextMenu.tabId];
  React.useEffect(() => {
    if (
      tabContextMenu.mouseY === null ||
      (!countdownStatus?.nextRetryAt && !countdownStatus?.windowExpiresAt) ||
      !["pending", "reconnecting"].includes(countdownStatus.state)
    ) {
      return undefined;
    }
    setReconnectNow(Date.now());
    const timerId = setInterval(() => {
      setReconnectNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timerId);
    };
  }, [
    countdownStatus?.nextRetryAt,
    countdownStatus?.windowExpiresAt,
    countdownStatus?.state,
    tabContextMenu.mouseY,
  ]);
  const clearReconnectAction = useCallback((tabId) => {
    setReconnectActionTabId((current) => (current === tabId ? null : current));
  }, []);
  const markSessionConnecting = useCallback((tabId, connection) => {
    setConnectionStatusByTabId((previous) => ({
      ...previous,
      [tabId]: {
        isConnected: false,
        isConnecting: true,
        quality: "connecting",
        lastUpdate: Date.now(),
        connectionType: "SSH",
        host: connection.host,
        port: connection.port,
        username: connection.username,
      },
    }));
  }, []);
  return {
    connectionStatusByTabId,
    markSessionConnecting,
    liveSessionKeys,
    liveSessionKeysRef,
    reconnectStateByTabId,
    reconnectActionTabId,
    clearReconnectAction,
    reconnectNow,
    clearReconnectStatus,
    loadTabConnectionStatus,
    loadReconnectStatus,
    handlePauseReconnect,
    handleResumeReconnect,
  };
}
