import * as React from "react";
import { useCallback } from "react";
import { useAppStore, useAppDispatch } from "../state/AppContext.jsx";
import { actions } from "../state/appReducer.js";
import {
  syncTerminalInstanceConfigs,
  normalizeRecentConnections,
  buildRecentConnectionsSignature,
} from "../appShellUtils.js";

export default function useShellConnections({
  connections,
  topConnections,
  credentialSecurityStatus,
  tabs,
}) {
  const dispatch = useAppDispatch();
  const appStore = useAppStore();
  const [connectionsLoaded, setConnectionsLoaded] = React.useState(false);
  const connectionsRef = React.useRef(connections);
  const topConnectionsRef = React.useRef(topConnections);
  React.useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);
  React.useEffect(() => {
    topConnectionsRef.current = topConnections;
  }, [topConnections]);
  const refreshConnectionState = useCallback(async () => {
    if (!window.terminalAPI?.loadConnections) {
      setConnectionsLoaded(true);
      return;
    }
    try {
      const loadedConnections =
        (await window.terminalAPI.loadConnections()) || [];
      // IPC 失败时可能返回 { success: false, error } 而非数组
      if (!Array.isArray(loadedConnections)) {
        console.warn(
          "loadConnections returned non-array payload; keeping previous connections",
          loadedConnections,
        );
        return;
      }
      dispatch(actions.setConnections(loadedConnections));
      try {
        const topConnectionCandidates =
          (await window.terminalAPI.loadTopConnections?.()) || [];
        const normalizedRecent = normalizeRecentConnections(
          Array.isArray(topConnectionCandidates) ? topConnectionCandidates : [],
          loadedConnections,
        );
        dispatch(actions.setTopConnections(normalizedRecent));
      } catch {
        dispatch(actions.setTopConnections([]));
      }
    } finally {
      setConnectionsLoaded(true);
    }
  }, [dispatch]);
  React.useEffect(() => {
    // 仅在主密码锁定或安全状态仍在加载时推迟；无主密码时必须立即加载 config 中的连接
    if (
      credentialSecurityStatus.loading ||
      credentialSecurityStatus.requiresUnlock ||
      !window.terminalAPI
    ) {
      return undefined;
    }
    let cancelled = false;
    const loadData = async () => {
      try {
        if (!cancelled) {
          await refreshConnectionState();
        }
      } catch {
        // 连接加载失败，应用仍可正常启动
      }
    };
    loadData();
    return () => {
      cancelled = true;
    };
  }, [
    credentialSecurityStatus.loading,
    credentialSecurityStatus.requiresUnlock,
    refreshConnectionState,
  ]);
  React.useEffect(() => {
    if (!window.terminalAPI?.onConnectionsChanged) {
      return undefined;
    }
    const handleConnectionsChanged = () => {
      if (
        credentialSecurityStatus.loading ||
        credentialSecurityStatus.requiresUnlock
      ) {
        return;
      }
      void refreshConnectionState();
    };
    const unsubscribe = window.terminalAPI.onConnectionsChanged(
      handleConnectionsChanged,
    );
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      } else {
        window.terminalAPI?.offConnectionsChanged?.(handleConnectionsChanged);
      }
    };
  }, [
    credentialSecurityStatus.loading,
    credentialSecurityStatus.requiresUnlock,
    refreshConnectionState,
  ]);
  const previousSyncedConnectionsRef = React.useRef(connections);
  React.useEffect(() => {
    if (previousSyncedConnectionsRef.current === connections) return;
    const terminalInstances = appStore.getState().terminalInstances;
    const syncedInstances = syncTerminalInstanceConfigs(
      terminalInstances,
      tabs,
      connections,
      previousSyncedConnectionsRef.current,
    );
    previousSyncedConnectionsRef.current = connections;
    if (syncedInstances !== terminalInstances) {
      dispatch(actions.setTerminalInstances(syncedInstances));
    }
  }, [connections, dispatch, tabs, appStore]);
  React.useEffect(() => {
    if (!Array.isArray(topConnections) || topConnections.length === 0) {
      return;
    }
    const normalizedRecent = normalizeRecentConnections(
      topConnections,
      connections,
    );
    const nextSignature = buildRecentConnectionsSignature(normalizedRecent);
    const currentSignature = buildRecentConnectionsSignature(topConnections);
    if (nextSignature !== currentSignature) {
      dispatch(actions.setTopConnections(normalizedRecent));
    }
  }, [connections, topConnections, dispatch]);
  React.useEffect(() => {
    if (!window.terminalAPI?.onTopConnectionsChanged) return undefined;
    const handleTopChanged = async (lastConnectionObjs) => {
      try {
        // lastConnectionObjs 现在是完整的连接对象数组，不再是ID数组
        const recentConnections = Array.isArray(lastConnectionObjs)
          ? lastConnectionObjs
          : await window.terminalAPI.loadTopConnections();
        const normalizedRecent = normalizeRecentConnections(
          recentConnections,
          connectionsRef.current,
        );
        const nextSignature = buildRecentConnectionsSignature(normalizedRecent);
        const currentSignature = buildRecentConnectionsSignature(
          topConnectionsRef.current,
        );
        if (nextSignature !== currentSignature) {
          dispatch(actions.setTopConnections(normalizedRecent));
        }
      } catch {
        // 忽略错误
      }
    };
    const unsubscribe =
      window.terminalAPI.onTopConnectionsChanged(handleTopChanged);
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [dispatch]);
  const handleConnectionsUpdate = useCallback(
    (updatedConnections) => {
      dispatch(actions.setConnections(updatedConnections));
      if (window.terminalAPI?.saveConnections) {
        window.terminalAPI
          .saveConnections(updatedConnections)
          .catch((error) => {
            console.error("Failed to save connections:", error);
          });
      }
    },
    [dispatch],
  );
  return { handleConnectionsUpdate, connectionsRef, connectionsLoaded };
}
