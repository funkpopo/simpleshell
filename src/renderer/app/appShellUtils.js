import * as React from "react";
import { mergeSavedConnectionConfig } from "../../shared/connectionConfigSync";
import { smartPreload } from "./LazyComponents.jsx";
import { SIDEBAR_WIDTHS } from "../shared/constants/layout.js";

export const SIDEBAR_TRANSITION_MS = 250;
export const SIDEBAR_UNMOUNT_DELAY_MS = SIDEBAR_TRANSITION_MS + 40;
export const DISK_ALERT_TAB_COLOR = "#e0a800";
export const UPDATE_REMINDER_STORAGE_KEY = "simpleshell.update.remindAt";
export const UPDATE_REMINDER_DELAY_MS = 4 * 60 * 60 * 1000;
export const DEFAULT_SIDEBAR_WIDTH = SIDEBAR_WIDTHS.DEFAULT;
export const intentPreloadProps = (componentName) => ({
  onMouseEnter: () => smartPreload.scheduleComponent(componentName),
  onMouseLeave: () => smartPreload.cancelScheduledComponent(componentName),
  // 键盘聚焦与鼠标悬停表达相同的打开意图，同时保留 200ms 防误触阈值。
  onFocus: () => smartPreload.scheduleComponent(componentName),
  onBlur: () => smartPreload.cancelScheduledComponent(componentName),
});
export const notifyTerminalResize = (delay = 15) => {
  setTimeout(() => {
    window.dispatchEvent(new Event("resize"));
  }, delay);
};
export function useDelayedPresence(open, delay = SIDEBAR_UNMOUNT_DELAY_MS) {
  const [present, setPresent] = React.useState(open);

  React.useEffect(() => {
    if (open) {
      setPresent(true);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      setPresent(false);
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [open, delay]);

  return open || present;
}
export const resolveConnectionPort = (connection) => {
  if (!connection) return null;
  const parsed = Number(connection.port);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  const protocol = String(connection.protocol || "ssh").toLowerCase();
  return protocol === "telnet" ? 23 : 22;
};
export const buildServerKey = (connection) => {
  if (!connection || !connection.host) return null;
  const port = resolveConnectionPort(connection);
  if (!port) return null;
  return `${connection.host}:${port}:${connection.username}`;
};
export const parseServerKey = (serverKey) => {
  if (typeof serverKey !== "string") return null;
  const parts = serverKey.split(":");
  if (parts.length < 3) return null;
  const username = parts.pop();
  const portPart = parts.pop();
  const host = parts.join(":");
  const port = Number(portPart);
  if (!host || !Number.isFinite(port)) return null;
  return {
    id: serverKey,
    serverKey,
    type: "connection",
    host,
    port,
    username,
    protocol: port === 23 ? "telnet" : "ssh",
  };
};
export const findConnectionById = (items, id) => {
  if (!id || !Array.isArray(items)) return null;
  for (const item of items) {
    if (!item) continue;
    if (item.type === "connection" && item.id === id) {
      return item;
    }
    if (item.type === "group" && Array.isArray(item.items)) {
      const found = findConnectionById(item.items, id);
      if (found) return found;
    }
  }
  return null;
};
export const findConnectionByServerKey = (items, serverKey) => {
  if (!serverKey || !Array.isArray(items)) return null;
  for (const item of items) {
    if (!item) continue;
    if (item.type === "connection") {
      const key = buildServerKey(item);
      if (key && key === serverKey) {
        return item;
      }
    }
    if (item.type === "group" && Array.isArray(item.items)) {
      const found = findConnectionByServerKey(item.items, serverKey);
      if (found) return found;
    }
  }
  return null;
};
export const resolveRecentConnection = (candidate, connections) => {
  if (!candidate) return null;
  const items = Array.isArray(connections) ? connections : [];

  const connectionId =
    typeof candidate === "string"
      ? candidate
      : candidate.connectionId || candidate.id;
  if (connectionId) {
    const byId = findConnectionById(items, connectionId);
    if (byId) return byId;
  }

  const serverKey =
    typeof candidate === "string"
      ? candidate
      : candidate.serverKey || buildServerKey(candidate);
  if (serverKey) {
    const byServerKey = findConnectionByServerKey(items, serverKey);
    if (byServerKey) return byServerKey;
  }

  if (typeof candidate === "string") {
    return parseServerKey(candidate);
  }

  if (!candidate.host && candidate.serverKey) {
    const parsed = parseServerKey(candidate.serverKey);
    if (parsed) {
      return {
        ...parsed,
        protocol: candidate.protocol || parsed.protocol,
      };
    }
  }

  if (candidate.host) {
    const serverKeyValue = candidate.serverKey || buildServerKey(candidate);
    if (candidate.type === "connection" && candidate.id) {
      return candidate;
    }
    return {
      ...candidate,
      type: "connection",
      id: candidate.id || serverKeyValue,
      serverKey: serverKeyValue || candidate.serverKey,
    };
  }

  return null;
};
export const getConnectionSyncSignature = (connection) =>
  JSON.stringify({
    id: connection?.id || "",
    connectionId: connection?.connectionId || "",
    name: connection?.name || "",
    host: connection?.host || "",
    port: Number(connection?.port) || 0,
    username: connection?.username || "",
    password: connection?.password || "",
    authType: connection?.authType || "",
    privateKeyPath: connection?.privateKeyPath || "",
    passphrase: connection?.passphrase || "",
    agentPath: connection?.agentPath || "",
    agentForward: connection?.agentForward === true,
    os: connection?.os || "",
    connectionType: connection?.connectionType || "",
    protocol: connection?.protocol || "",
    proxy: connection?.proxy || null,
  });
export const areFileManagerHistoryStatesEqual = (left, right) => {
  if (left === right) {
    return true;
  }

  const leftHistory = Array.isArray(left?.pathHistory) ? left.pathHistory : [];
  const rightHistory = Array.isArray(right?.pathHistory)
    ? right.pathHistory
    : [];

  if (leftHistory.length !== rightHistory.length) {
    return false;
  }

  for (let index = 0; index < leftHistory.length; index += 1) {
    if (leftHistory[index] !== rightHistory[index]) {
      return false;
    }
  }

  return (left?.historyIndex ?? -1) === (right?.historyIndex ?? -1);
};
export const syncTerminalInstanceConfigs = (
  terminalInstances,
  tabs,
  connections,
  previousConnections,
) => {
  if (!terminalInstances || typeof terminalInstances !== "object") {
    return terminalInstances;
  }

  const tabList = Array.isArray(tabs) ? tabs.filter(Boolean) : [];
  const tabIds = new Set(tabList.map((tab) => tab.id));
  for (const [key, config] of Object.entries(terminalInstances)) {
    if (!key.endsWith("-config") || !config?.host) continue;
    const id = key.slice(0, -"-config".length);
    if (!tabIds.has(id)) {
      tabList.push({
        id,
        type: config.protocol || "ssh",
        connectionId: config.connectionId || config.id,
      });
    }
  }
  let nextInstances = terminalInstances;

  for (const tab of tabList) {
    if (
      !tab ||
      (tab.type !== "ssh" &&
        tab.type !== "telnet" &&
        tab.type !== "serial" &&
        tab.type !== "mosh")
    ) {
      continue;
    }

    const configKey = `${tab.id}-config`;
    const currentConfig = terminalInstances[configKey];
    if (!currentConfig || typeof currentConfig !== "object") {
      continue;
    }

    const latestConnection = resolveRecentConnection(
      {
        id: tab.connectionId || currentConfig.id,
        connectionId: tab.connectionId || currentConfig.connectionId,
        serverKey: currentConfig.serverKey || buildServerKey(currentConfig),
        host: currentConfig.host,
        port: currentConfig.port,
        username: currentConfig.username,
        protocol: currentConfig.protocol || tab.type,
      },
      connections,
    );

    if (!latestConnection || latestConnection.type !== "connection") {
      continue;
    }

    const mergedConfig = mergeSavedConnectionConfig(
      currentConfig,
      findConnectionById(previousConnections, latestConnection.id),
      latestConnection,
    );

    if (
      getConnectionSyncSignature(mergedConfig) ===
      getConnectionSyncSignature(currentConfig)
    ) {
      continue;
    }

    if (nextInstances === terminalInstances) {
      nextInstances = { ...terminalInstances };
    }
    nextInstances[configKey] = mergedConfig;
  }

  return nextInstances;
};
export const normalizeRecentConnections = (recentConnections, connections) => {
  if (!Array.isArray(recentConnections)) return [];
  const seenIds = new Set();
  const seenServers = new Set();

  return recentConnections
    .map((candidate) => resolveRecentConnection(candidate, connections))
    .filter((connection) => {
      if (!connection) return false;

      const id = connection.connectionId || connection.id;
      const serverKey = JSON.stringify([
        String(connection.protocol || "ssh").toLowerCase(),
        connection.host,
        resolveConnectionPort(connection),
        connection.username || "",
      ]);
      if ((id && seenIds.has(id)) || seenServers.has(serverKey)) {
        return false;
      }

      // 最近连接已按新到旧排列，只保留同一连接第一次出现的位置。
      if (id) seenIds.add(id);
      seenServers.add(serverKey);
      return true;
    });
};
export const buildRecentConnectionsSignature = (items) => {
  if (!Array.isArray(items) || items.length === 0) return "";

  return items
    .map((item) => {
      if (!item) return "";
      const id = item.id || item.connectionId || item.serverKey || "";
      const serverKey = item.serverKey || buildServerKey(item) || "";
      const updatedAt = item.updatedAt || item.lastUsedAt || "";
      return `${id}#${serverKey}#${updatedAt}`;
    })
    .join("|");
};
export const normalizeSidebarPosition = (position) =>
  position === "left" ? "left" : "right";
export const normalizeSidebarWidth = (width) => {
  const numericWidth = Number(width);
  if (!Number.isFinite(numericWidth)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.min(
    Math.max(Math.round(numericWidth), SIDEBAR_WIDTHS.MIN),
    SIDEBAR_WIDTHS.MAX,
  );
};
export const getReconnectFailureReasonLabel = (t, failureReason) => {
  switch (String(failureReason || "").toLowerCase()) {
    case "proxy-unavailable":
      return t("tabMenu.failureReasonProxyUnavailable");
    case "connection-refused":
      return t("tabMenu.failureReasonConnectionRefused");
    case "host-unresolved":
      return t("tabMenu.failureReasonHostUnresolved");
    case "connection-reset":
      return t("tabMenu.failureReasonConnectionReset");
    case "network":
      return t("tabMenu.failureReasonNetwork");
    case "authentication":
      return t("tabMenu.failureReasonAuthentication");
    case "timeout":
      return t("tabMenu.failureReasonTimeout");
    case "resource":
      return t("tabMenu.failureReasonResource");
    case "unknown":
      return t("tabMenu.failureReasonUnknown");
    default:
      return null;
  }
};
