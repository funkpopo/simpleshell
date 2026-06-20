import * as React from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { createUnifiedTheme } from "./theme";
import CssBaseline from "@mui/material/CssBaseline";
import { GlobalErrorBoundary } from "./components/ErrorBoundary.jsx";
import {
  AppProvider,
  useAppState,
  useAppDispatch,
} from "./store/AppContext.jsx";
import { NotificationProvider } from "./contexts/NotificationContext.jsx";
import { actions } from "./store/appReducer.js";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Typography from "@mui/material/Typography";
import AppsIcon from "@mui/icons-material/Apps";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import LinkIcon from "@mui/icons-material/Link";
import RefreshIcon from "@mui/icons-material/Refresh";
import PowerOffIcon from "@mui/icons-material/PowerOff";
import FolderIcon from "@mui/icons-material/Folder";
import SettingsIcon from "@mui/icons-material/Settings";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import AIIcon from "./components/AIIcon.jsx";
import Tooltip from "@mui/material/Tooltip";
import SidebarTooltip from "./components/SidebarTooltip.jsx";
import Paper from "@mui/material/Paper";
import HistoryIcon from "@mui/icons-material/History";
import InfoIcon from "@mui/icons-material/Info";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import BugReportIcon from "@mui/icons-material/BugReport";
import FeedbackIcon from "@mui/icons-material/Feedback";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import PublicIcon from "@mui/icons-material/Public";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import ComputerIcon from "@mui/icons-material/Computer";
import WebTerminal from "./components/WebTerminal.jsx";
import WelcomePage from "./components/WelcomePage.jsx";
import FirstRunDialog from "./components/FirstRunDialog.jsx";
import ConnectionManager from "./components/ConnectionManager.jsx";
import FileManager from "./components/FileManager.jsx";
import {
  ResourceMonitorWithSuspense as ResourceMonitor,
  IPAddressQueryWithSuspense as IPAddressQuery,
  SettingsWithSuspense as Settings,
  CommandHistoryWithSuspense as CommandHistory,
  ShortcutCommandsWithSuspense as ShortcutCommands,
  LocalTerminalSidebarWithSuspense as LocalTerminalSidebar,
  preloadComponents,
  smartPreload,
} from "./components/LazyComponents.jsx";

import SecurityTools from "./components/SecurityTools.jsx";
import TerminalIcon from "@mui/icons-material/Terminal";
import FirstPageIcon from "@mui/icons-material/FirstPage";
import LastPageIcon from "@mui/icons-material/LastPage";
import AIChatWindow from "./components/AIChatWindow.jsx";
import CustomTab from "./components/CustomTab.jsx";
import NetworkLatencyIndicator from "./components/NetworkLatencyIndicator.jsx";
import WindowControls from "./components/WindowControls.jsx";
import AboutDialog from "./components/AboutDialog.jsx";
import SSHAuthDialog from "./components/SSHAuthDialog.jsx";
import MasterPasswordOverlay from "./components/MasterPasswordOverlay.jsx";
// Import i18n configuration
import { useTranslation } from "react-i18next";
import "./i18n/i18n";
import { changeLanguage } from "./i18n/i18n";
import "./styles/index.css";
import "./styles/theme-switch-animation.css";
import { SIDEBAR_WIDTHS } from "./constants/layout.js";
import "flag-icons/css/flag-icons.min.css";
import {
  findGroupByTab,
  getGroups,
  addGroup,
  addTabToGroup,
  removeTabFromGroup,
} from "./core/syncInputGroups";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import AddIcon from "@mui/icons-material/Add";
import PauseCircleOutlinedIcon from "@mui/icons-material/PauseCircleOutlined";
import PlayCircleOutlinedIcon from "@mui/icons-material/PlayCircleOutlined";
import { dispatchCommandToGroup } from "./core/syncGroupCommandDispatcher";
import { useEventManager } from "./core/utils/eventManager.js";
import ErrorNotification from "./components/ErrorNotification.jsx";
import GlobalTransferBar from "./components/GlobalTransferBar.jsx";
import GlobalTransferFloat from "./components/GlobalTransferFloat.jsx";
import TransferSidebar from "./components/TransferSidebar.jsx";
import TransferSidebarButton from "./components/TransferSidebarButton.jsx";
import { useNotification } from "./contexts/NotificationContext.jsx";
import {
  buildReconnectBadgeTooltip,
  buildReconnectStatusPatch,
  buildReconnectStatusTitle,
  canPauseReconnectStatus,
  getReconnectStatusColor,
  normalizeReconnectUiState,
  shouldClearOnTabConnectionStatus,
  shouldMarkPendingOnTabConnectionStatus,
} from "./modules/terminal/reconnectTabStatus.js";

const SIDEBAR_TRANSITION_MS = 250;
const SIDEBAR_UNMOUNT_DELAY_MS = SIDEBAR_TRANSITION_MS + 40;
const UPDATE_REMINDER_STORAGE_KEY = "simpleshell.update.remindAt";
const UPDATE_REMINDER_DELAY_MS = 4 * 60 * 60 * 1000;

function useDelayedPresence(open, delay = SIDEBAR_UNMOUNT_DELAY_MS) {
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

const resolveConnectionPort = (connection) => {
  if (!connection) return null;
  const parsed = Number(connection.port);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  const protocol = String(connection.protocol || "ssh").toLowerCase();
  return protocol === "telnet" ? 23 : 22;
};

const buildServerKey = (connection) => {
  if (!connection || !connection.host) return null;
  const port = resolveConnectionPort(connection);
  if (!port) return null;
  return `${connection.host}:${port}:${connection.username}`;
};

const parseServerKey = (serverKey) => {
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

const findConnectionById = (items, id) => {
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

const findConnectionByServerKey = (items, serverKey) => {
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

const resolveRecentConnection = (candidate, connections) => {
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

const getConnectionSyncSignature = (connection) =>
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
    country: connection?.country || "",
    os: connection?.os || "",
    connectionType: connection?.connectionType || "",
    protocol: connection?.protocol || "",
    proxy: connection?.proxy || null,
  });

const areFileManagerHistoryStatesEqual = (left, right) => {
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

const syncTerminalInstanceConfigs = (terminalInstances, tabs, connections) => {
  if (!terminalInstances || typeof terminalInstances !== "object") {
    return terminalInstances;
  }

  const tabList = Array.isArray(tabs) ? tabs : [];
  let nextInstances = terminalInstances;

  for (const tab of tabList) {
    if (!tab || (tab.type !== "ssh" && tab.type !== "telnet")) {
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

    const mergedConfig = {
      ...currentConfig,
      ...latestConnection,
      tabId: currentConfig.tabId || tab.id,
    };

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

const normalizeRecentConnections = (recentConnections, connections) => {
  if (!Array.isArray(recentConnections)) return [];
  return recentConnections
    .map((candidate) => resolveRecentConnection(candidate, connections))
    .filter(Boolean);
};

const buildRecentConnectionsSignature = (items) => {
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

const normalizeSidebarPosition = (position) =>
  position === "left" ? "left" : "right";

const getReconnectFailureReasonLabel = (t, failureReason) => {
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

function AppContent() {
  const LATENCY_INFO_MIN_WIDTH = 150;
  const { t, i18n } = useTranslation();
  const eventManager = useEventManager(); // 使用统一的事件管理器
  const { showError, showInfo, showSuccess } = useNotification();

  // 使用全局状态和 dispatch
  const state = useAppState();
  const dispatch = useAppDispatch();

  // 错误处理状态（保持本地，因为不需要全局共享）
  const [appError, setAppError] = React.useState(null);
  const [errorNotificationOpen, setErrorNotificationOpen] =
    React.useState(false);
  const [credentialSecurityStatus, setCredentialSecurityStatus] =
    React.useState({
      loading: true,
      masterPasswordEnabled: false,
      unlocked: true,
      requiresUnlock: false,
    });
  const [uiSettingsSnapshot, setUiSettingsSnapshot] = React.useState(null);
  const [uiSettingsLoaded, setUiSettingsLoaded] = React.useState(false);
  const [connectionsLoaded, setConnectionsLoaded] = React.useState(false);
  const [firstRunDialogOpen, setFirstRunDialogOpen] = React.useState(false);
  const [createConnectionSignal, setCreateConnectionSignal] = React.useState(0);
  const [masterPasswordError, setMasterPasswordError] = React.useState("");
  const [unlockingCredentialStore, setUnlockingCredentialStore] =
    React.useState(false);
  const copySuccessNotificationAtRef = React.useRef(0);

  // SSH 认证对话框状态
  const [sshAuthDialogOpen, setSshAuthDialogOpen] = React.useState(false);
  const [sshAuthData, setSshAuthData] = React.useState(null);
  const [sshAuthConnectionConfig, setSshAuthConnectionConfig] =
    React.useState(null);
  const sshAuthRequestIdRef = React.useRef(null);
  const [aboutUpdateCheckSignal, setAboutUpdateCheckSignal] = React.useState(0);
  const [updateReminderAt, setUpdateReminderAt] = React.useState(() => {
    try {
      const storedValue = Number(
        window.localStorage?.getItem(UPDATE_REMINDER_STORAGE_KEY),
      );
      return Number.isFinite(storedValue) && storedValue > 0 ? storedValue : 0;
    } catch {
      return 0;
    }
  });

  // 监听主进程的错误事件
  React.useEffect(() => {
    const handleAppError = (event, error) => {
      console.error("Application error:", error);
      setAppError(error);
      setErrorNotificationOpen(true);
    };

    if (window.appErrorAPI) {
      window.appErrorAPI.onError(handleAppError);
    }

    return () => {
      if (window.appErrorAPI) {
        window.appErrorAPI.removeErrorListener();
      }
    };
  }, []);

  React.useEffect(() => {
    const showCopySuccess = () => {
      copySuccessNotificationAtRef.current = Date.now();
      showSuccess(t("common.copiedToClipboard"), {
        autoHideDuration: 1800,
      });
    };

    const handleClipboardWriteSuccess = () => {
      showCopySuccess();
    };

    const handleNativeCopy = () => {
      if (Date.now() - copySuccessNotificationAtRef.current < 500) {
        return;
      }
      showCopySuccess();
    };

    const unsubscribe = window.clipboardAPI?.onWriteSuccess?.(
      handleClipboardWriteSuccess,
    );

    document.addEventListener("copy", handleNativeCopy);

    if (typeof unsubscribe !== "function") {
      window.addEventListener(
        "simpleshell:clipboard-write-success",
        handleClipboardWriteSuccess,
      );
    }

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      } else {
        window.removeEventListener(
          "simpleshell:clipboard-write-success",
          handleClipboardWriteSuccess,
        );
      }
      document.removeEventListener("copy", handleNativeCopy);
    };
  }, [showSuccess, t]);

  const handleCloseErrorNotification = () => {
    setErrorNotificationOpen(false);
  };

  const refreshCredentialSecurityStatus = useCallback(async () => {
    if (!window.terminalAPI?.getCredentialSecurityStatus) {
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: false,
        unlocked: true,
        requiresUnlock: false,
      });
      return;
    }

    try {
      const response = await window.terminalAPI.getCredentialSecurityStatus();
      const status = response?.success ? response.status : response;
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: status?.masterPasswordEnabled === true,
        unlocked: status?.unlocked !== false,
        requiresUnlock: status?.requiresUnlock === true,
      });
    } catch {
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: false,
        unlocked: true,
        requiresUnlock: false,
      });
    }
  }, []);

  React.useEffect(() => {
    refreshCredentialSecurityStatus();
  }, [refreshCredentialSecurityStatus]);

  React.useEffect(() => {
    const handleCredentialSecurityChanged = (event) => {
      const status = event?.detail?.status;
      if (!status) {
        refreshCredentialSecurityStatus();
        return;
      }

      setMasterPasswordError("");
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: status?.masterPasswordEnabled === true,
        unlocked: status?.unlocked !== false,
        requiresUnlock: status?.requiresUnlock === true,
      });
    };

    const removeListener = eventManager.addEventListener(
      window,
      "credentialSecurityChanged",
      handleCredentialSecurityChanged,
    );

    return () => {
      removeListener();
    };
  }, [eventManager, refreshCredentialSecurityStatus]);

  const handleUnlockCredentialStore = useCallback(
    async (masterPassword) => {
      if (!window.terminalAPI?.unlockCredentialStore) {
        return;
      }

      setUnlockingCredentialStore(true);
      setMasterPasswordError("");

      try {
        const response =
          await window.terminalAPI.unlockCredentialStore(masterPassword);
        if (response?.success === false) {
          setMasterPasswordError(
            response.error === "Invalid master password"
              ? t("masterPassword.invalidPassword")
              : response.error || t("masterPassword.unlockFailed"),
          );
          return;
        }

        const nextStatus = response?.status || {
          masterPasswordEnabled: true,
          unlocked: true,
          requiresUnlock: false,
        };

        setCredentialSecurityStatus({
          loading: false,
          masterPasswordEnabled: nextStatus?.masterPasswordEnabled === true,
          unlocked: nextStatus?.unlocked !== false,
          requiresUnlock: nextStatus?.requiresUnlock === true,
        });
      } catch {
        setMasterPasswordError(t("masterPassword.unlockFailed"));
      } finally {
        setUnlockingCredentialStore(false);
      }
    },
    [t],
  );

  // Update the tabs when language changes
  React.useEffect(() => {
    // Update welcome tab label when language changes
    // 只在语言改变时更新，不依赖 tabs
    if (tabs.length > 0 && tabs[0].id === "welcome") {
      const newLabel = t("terminal.welcome");
      if (tabs[0].label !== newLabel) {
        dispatch(
          actions.setTabs([{ ...tabs[0], label: newLabel }, ...tabs.slice(1)]),
        );
      }
    }
  }, [i18n.language, t, dispatch]); // 移除 state.tabs 依赖

  // 加载主题设置
  React.useEffect(() => {
    const loadThemeSettings = async () => {
      try {
        dispatch(actions.setThemeLoading(true));
        if (window.terminalAPI?.loadUISettings) {
          const settings = await window.terminalAPI.loadUISettings();
          setUiSettingsSnapshot(settings || null);
          if (settings && settings.darkMode !== undefined) {
            dispatch(actions.setDarkMode(settings.darkMode));
          }
          if (settings?.sidebarPosition) {
            setSidebarPosition(
              normalizeSidebarPosition(settings.sidebarPosition),
            );
          }
          // 暴露硬件加速标志给 globalTransferStore 等高频更新模块
          window.__hardwareAccelerationEnabled =
            settings?.performance?.hardwareAcceleration !== false;
        }
      } catch {
        window.__hardwareAccelerationEnabled = true;
      } finally {
        setUiSettingsLoaded(true);
        dispatch(actions.setThemeLoading(false));
      }
    };

    loadThemeSettings();
  }, [dispatch]);

  // ============ 从全局状态读取 ============
  const tabs = state.tabs;
  const latestTabsForActionsRef = useRef(tabs);
  latestTabsForActionsRef.current = tabs;
  const currentTab = state.currentTab;
  const connectionManagerOpen = state.connectionManagerOpen;
  const resourceMonitorOpen = state.resourceMonitorOpen;
  const fileManagerOpen = state.fileManagerOpen;
  const ipAddressQueryOpen = state.ipAddressQueryOpen;
  const securityToolsOpen = state.securityToolsOpen;
  const shortcutCommandsOpen = state.shortcutCommandsOpen;
  const commandHistoryOpen = state.commandHistoryOpen;
  const activeSidebarMargin = state.activeSidebarMargin;
  const lastOpenedSidebar = state.lastOpenedSidebar;
  const aboutDialogOpen = state.aboutDialogOpen;
  const settingsDialogOpen = state.settingsDialogOpen;
  const tabContextMenu = state.tabContextMenu;
  const darkMode = state.darkMode;
  const themeLoading = state.themeLoading;
  const terminalInstances = state.terminalInstances;
  const connections = state.connections;
  const topConnections = state.topConnections;
  const fileManagerPaths = state.fileManagerPaths;
  const processCache = state.processCache;
  const aiChatStatus = state.aiChatStatus;
  const aiInputPreset = state.aiInputPreset;
  const draggedTabIndex = state.draggedTabIndex;
  const dragOverTabIndex = state.dragOverTabIndex;
  const dragInsertPosition = state.dragInsertPosition;
  const anchorEl = state.anchorEl;
  const open = Boolean(anchorEl);
  const connectionsRef = React.useRef(connections);
  const topConnectionsRef = React.useRef(topConnections);
  const terminalInstancesRef = React.useRef(terminalInstances);
  const processCacheRef = React.useRef(processCache);
  const [connectionStatusByTabId, setConnectionStatusByTabId] =
    React.useState({});

  React.useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  React.useEffect(() => {
    topConnectionsRef.current = topConnections;
  }, [topConnections]);

  React.useEffect(() => {
    terminalInstancesRef.current = terminalInstances;
  }, [terminalInstances]);

  React.useEffect(() => {
    processCacheRef.current = processCache;
  }, [processCache]);

  React.useEffect(() => {
    if (!uiSettingsLoaded || !connectionsLoaded) {
      return;
    }

    const onboardingCompleted =
      uiSettingsSnapshot?.onboarding?.completed === true;
    const hasExistingConnections =
      Array.isArray(connections) && connections.length > 0;

    if (!onboardingCompleted && !hasExistingConnections) {
      setFirstRunDialogOpen(true);
    }
  }, [connections, connectionsLoaded, uiSettingsLoaded, uiSettingsSnapshot]);

  const handleFirstRunComplete = useCallback((settings) => {
    setUiSettingsSnapshot(settings || null);
    setFirstRunDialogOpen(false);
  }, []);

  const refreshConnectionState = useCallback(async () => {
    if (!window.terminalAPI?.loadConnections) {
      setConnectionsLoaded(true);
      return;
    }

    try {
      const loadedConnections =
        (await window.terminalAPI.loadConnections()) || [];
      if (!Array.isArray(loadedConnections)) {
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

  // 锁定的文件管理器tabId（在打开时不随标签页切换而变化）
  const [lockedFileManagerTabId, setLockedFileManagerTabId] = useState(null);
  const [fileManagerHistoryByTabId, setFileManagerHistoryByTabId] = useState(
    {},
  );
  const [reconnectStateByTabId, setReconnectStateByTabId] = React.useState({});
  const [reconnectActionTabId, setReconnectActionTabId] = React.useState(null);
  const [reconnectNow, setReconnectNow] = React.useState(Date.now());

  const updateReconnectStatus = useCallback((tabId, updater, options = {}) => {
    if (!tabId) {
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
    const activeTabIds = new Set(tabs.map((tab) => tab.id));
    setReconnectStateByTabId((previous) => {
      let changed = false;
      const next = {};

      Object.entries(previous).forEach(([tabId, value]) => {
        if (activeTabIds.has(tabId)) {
          next[tabId] = value;
        } else {
          changed = true;
        }
      });

      return changed ? next : previous;
    });
    setConnectionStatusByTabId((previous) => {
      let changed = false;
      const next = {};

      Object.entries(previous).forEach(([tabId, value]) => {
        if (activeTabIds.has(tabId)) {
          next[tabId] = value;
        } else {
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [tabs]);

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

    window.terminalAPI.onConnectionLost?.(handleConnectionLost);
    window.terminalAPI.onReconnectStart?.(handleReconnectStarted);
    window.terminalAPI.onReconnectProgress?.(handleReconnectProgress);
    window.terminalAPI.onReconnectSuccess?.(handleReconnectSuccess);
    window.terminalAPI.onReconnectFailed?.(handleReconnectFailed);
    window.terminalAPI.onReconnectAbandoned?.(handleReconnectAbandoned);
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
      window.terminalAPI?.removeReconnectListeners?.();
    };
  }, [clearReconnectStatus, t, updateReconnectStatus]);

  // 监听 SSH 认证请求
  React.useEffect(() => {
    if (!window.terminalAPI?.onSSHAuthRequest) return;

    const handleSSHAuthRequest = (data) => {
      console.log("SSH Auth request received:", data);
      sshAuthRequestIdRef.current = data.requestId;

      // 查找对应的连接配置
      let connectionConfig = null;
      if (data.connectionId) {
        // 递归查找连接配置
        const findConnection = (items) => {
          for (const item of items) {
            if (item.type === "connection" && item.id === data.connectionId) {
              return item;
            }
            if (item.type === "group" && Array.isArray(item.items)) {
              const found = findConnection(item.items);
              if (found) return found;
            }
          }
          return null;
        };
        connectionConfig = findConnection(connections);
      }

      // 也可以从 tabId 获取配置
      if (
        !connectionConfig &&
        data.tabId &&
        terminalInstances[`${data.tabId}-config`]
      ) {
        connectionConfig = terminalInstances[`${data.tabId}-config`];
      }

      setSshAuthConnectionConfig(connectionConfig);
      setSshAuthData(data);
      setSshAuthDialogOpen(true);
    };

    const cleanup = window.terminalAPI.onSSHAuthRequest(handleSSHAuthRequest);

    return () => {
      if (cleanup) cleanup();
      if (window.terminalAPI?.offSSHAuthRequest) {
        window.terminalAPI.offSSHAuthRequest();
      }
    };
  }, [connections, terminalInstances]);

  // 处理 SSH 认证对话框确认
  const handleSSHAuthConfirm = React.useCallback(
    async (authResult) => {
      if (!sshAuthRequestIdRef.current) return;

      try {
        await window.terminalAPI.respondSSHAuth({
          requestId: sshAuthRequestIdRef.current,
          ...authResult,
        });
      } catch (error) {
        console.error("Failed to respond SSH auth:", error);
      }

      const targetTabId =
        sshAuthData?.tabId || sshAuthConnectionConfig?.tabId || null;
      if (targetTabId) {
        const configKey = `${targetTabId}-config`;
        const currentConfig =
          terminalInstancesRef.current?.[configKey] || sshAuthConnectionConfig;

        if (currentConfig) {
          dispatch(
            actions.setTerminalInstances({
              ...terminalInstancesRef.current,
              [configKey]: {
                ...currentConfig,
                username:
                  authResult?.username !== undefined
                    ? authResult.username
                    : currentConfig.username,
                password:
                  authResult?.password !== undefined
                    ? authResult.password
                    : currentConfig.password,
                privateKeyPath:
                  authResult?.privateKeyPath !== undefined
                    ? authResult.privateKeyPath
                    : currentConfig.privateKeyPath,
                authType:
                  authResult?.authType || currentConfig.authType || "password",
              },
            }),
          );
        }
      }

      setSshAuthDialogOpen(false);
      setSshAuthData(null);
      setSshAuthConnectionConfig(null);
      sshAuthRequestIdRef.current = null;
    },
    [dispatch, sshAuthConnectionConfig, sshAuthData],
  );

  // 处理 SSH 认证对话框关闭/取消
  const handleSSHAuthClose = React.useCallback(async () => {
    if (sshAuthRequestIdRef.current) {
      try {
        await window.terminalAPI.respondSSHAuth({
          requestId: sshAuthRequestIdRef.current,
          cancelled: true,
        });
      } catch (error) {
        console.error("Failed to cancel SSH auth:", error);
      }
    }

    setSshAuthDialogOpen(false);
    setSshAuthData(null);
    setSshAuthConnectionConfig(null);
    sshAuthRequestIdRef.current = null;
  }, []);

  // 根据主题模式更新 body 类名
  React.useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-theme");
      document.body.classList.remove("light-theme");
    } else {
      document.body.classList.add("light-theme");
      document.body.classList.remove("dark-theme");
    }
  }, [darkMode]);

  // ============ 保持本地状态(不在 reducer 中)============
  const [localTerminalSidebarOpen, setLocalTerminalSidebarOpen] =
    React.useState(false);
  const resourceMonitorPresent = useDelayedPresence(resourceMonitorOpen);
  const connectionManagerPresent = useDelayedPresence(connectionManagerOpen);
  const fileManagerPresent = useDelayedPresence(fileManagerOpen);
  const shortcutCommandsPresent = useDelayedPresence(shortcutCommandsOpen);
  const commandHistoryPresent = useDelayedPresence(commandHistoryOpen);
  const ipAddressQueryPresent = useDelayedPresence(ipAddressQueryOpen);
  const securityToolsPresent = useDelayedPresence(securityToolsOpen);
  const localTerminalSidebarPresent = useDelayedPresence(
    localTerminalSidebarOpen,
  );
  const [prevTabsLength, setPrevTabsLength] = React.useState(tabs.length);
  const [transferFloatOpen, setTransferFloatOpen] = React.useState(false);
  const [transferFloatInitialTransfer, setTransferFloatInitialTransfer] =
    React.useState(null);
  const [dndEnabled, setDndEnabled] = React.useState(true);
  // 传输栏显示模式: "bottom" | "sidebar"
  const [transferBarMode, setTransferBarMode] = React.useState("bottom");
  // 侧边栏位置: "left" | "right"
  const [sidebarPosition, setSidebarPosition] = React.useState("right");
  // 传输侧边栏状态
  const [transferSidebarOpen, setTransferSidebarOpen] = React.useState(false);
  // 最后激活的浮动窗口（用于控制z-index层叠顺序）: "ai" | "transfer"
  const [lastActiveFloatWindow, setLastActiveFloatWindow] =
    React.useState("ai");
  /** AI 当前 API 是否可达（false 包含未配置/不可达） */
  const [aiApiReachable, setAiApiReachable] = React.useState(false);
  const aiApiProbeTokenRef = React.useRef(0);
  const aiPanelOpen =
    aiChatStatus === "minimized" || aiChatStatus === "visible";

  const tabsRef = useRef(null);
  const [hasTabOverflow, setHasTabOverflow] = React.useState(false);
  const dragRafRef = React.useRef(null);
  const pendingDragStateRef = React.useRef(null);
  const sidebarTooltipPlacement = "top";
  const transferSidebarButtonRef = useRef(null);
  const aiChatButtonRef = useRef(null);
  const findFallbackSidebar = React.useCallback(
    (closingSidebar) => {
      const openSidebars = [
        ["localTerminal", localTerminalSidebarOpen],
        ["password", securityToolsOpen],
        ["ipquery", ipAddressQueryOpen],
        ["history", commandHistoryOpen],
        ["shortcut", shortcutCommandsOpen],
        ["file", fileManagerOpen],
        ["connection", connectionManagerOpen],
        ["resource", resourceMonitorOpen],
      ];

      return (
        openSidebars.find(
          ([sidebar, isOpen]) => sidebar !== closingSidebar && isOpen,
        )?.[0] || null
      );
    },
    [
      commandHistoryOpen,
      connectionManagerOpen,
      fileManagerOpen,
      ipAddressQueryOpen,
      localTerminalSidebarOpen,
      resourceMonitorOpen,
      securityToolsOpen,
      shortcutCommandsOpen,
    ],
  );
  const setFallbackSidebarAfterClose = React.useCallback(
    (closingSidebar) => {
      if (lastOpenedSidebar === closingSidebar) {
        dispatch(
          actions.setLastOpenedSidebar(findFallbackSidebar(closingSidebar)),
        );
      }
    },
    [dispatch, findFallbackSidebar, lastOpenedSidebar],
  );
  const contextMenuTab =
    tabContextMenu.tabIndex !== null &&
    tabContextMenu.tabIndex >= 0 &&
    tabContextMenu.tabIndex < tabs.length
      ? tabs[tabContextMenu.tabIndex]
      : null;
  const contextMenuReconnectStatus = contextMenuTab
    ? reconnectStateByTabId[contextMenuTab.id] || null
    : null;
  const isContextMenuSshTab = contextMenuTab?.type === "ssh";
  const reconnectStatusTitle = buildReconnectStatusTitle(
    t,
    contextMenuReconnectStatus,
    reconnectNow,
  );
  const reconnectStatusColor = getReconnectStatusColor(
    contextMenuReconnectStatus?.state,
  );
  const reconnectFailureReasonLabel = getReconnectFailureReasonLabel(
    t,
    contextMenuReconnectStatus?.failureReason,
  );
  const isReconnectActionPending =
    Boolean(contextMenuTab?.id) && reconnectActionTabId === contextMenuTab.id;

  React.useEffect(() => {
    if (
      tabContextMenu.mouseY === null ||
      (!contextMenuReconnectStatus?.nextRetryAt &&
        !contextMenuReconnectStatus?.windowExpiresAt) ||
      !["pending", "reconnecting"].includes(contextMenuReconnectStatus.state)
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
    contextMenuReconnectStatus?.nextRetryAt,
    contextMenuReconnectStatus?.windowExpiresAt,
    contextMenuReconnectStatus?.state,
    tabContextMenu.mouseY,
  ]);

  const handleTabsWheel = useCallback((event) => {
    const scroller = event.currentTarget;
    if (!scroller) {
      return;
    }

    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    if (maxScrollLeft <= 0) {
      return;
    }

    const dominantDelta =
      Math.abs(event.deltaY) > Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;

    if (dominantDelta === 0) {
      return;
    }

    scroller.scrollLeft = Math.min(
      Math.max(scroller.scrollLeft + dominantDelta, 0),
      maxScrollLeft,
    );
    event.preventDefault();
  }, []);

  // 监听 tabs 滚轮事件（需要在 scroller 元素上监听）
  React.useEffect(() => {
    const tabsRoot = tabsRef.current;
    if (!tabsRoot) {
      return undefined;
    }

    const scroller = tabsRoot.querySelector(".MuiTabs-scroller");
    if (!scroller) {
      return undefined;
    }

    // 使用 eventManager 统一管理事件监听
    const removeListener = eventManager.addEventListener(
      scroller,
      "wheel",
      handleTabsWheel,
      { passive: false },
    );

    return removeListener;
  }, [handleTabsWheel, eventManager]);

  React.useEffect(() => {
    const tabsRoot = tabsRef.current;
    if (!tabsRoot) {
      return undefined;
    }

    const scroller = tabsRoot.querySelector(".MuiTabs-scroller");
    if (!scroller) {
      return undefined;
    }

    const checkOverflow = () => {
      const nextHasOverflow = scroller.scrollWidth - scroller.clientWidth > 1;
      setHasTabOverflow((prev) =>
        prev === nextHasOverflow ? prev : nextHasOverflow,
      );
    };

    checkOverflow();

    const rafId = requestAnimationFrame(checkOverflow);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(checkOverflow)
        : null;

    resizeObserver?.observe(scroller);
    window.addEventListener("resize", checkOverflow);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", checkOverflow);
    };
  }, [tabs.length]);

  const scrollActiveTabIntoView = useCallback(() => {
    const tabsRoot = tabsRef.current;
    if (!tabsRoot) {
      return;
    }

    const scroller = tabsRoot.querySelector(".MuiTabs-scroller");
    const selectedTab = tabsRoot.querySelector(
      'button[role="tab"][aria-selected="true"]',
    );

    if (!scroller || !selectedTab) {
      return;
    }

    const scrollerRect = scroller.getBoundingClientRect();
    const tabRect = selectedTab.getBoundingClientRect();
    const EXTRA_PADDING = 16;

    if (tabRect.left < scrollerRect.left) {
      scroller.scrollLeft -= scrollerRect.left - tabRect.left + EXTRA_PADDING;
    } else if (tabRect.right > scrollerRect.right) {
      scroller.scrollLeft += tabRect.right - scrollerRect.right + EXTRA_PADDING;
    }
  }, []);

  React.useEffect(() => {
    scrollActiveTabIntoView();
  }, [scrollActiveTabIntoView, currentTab, tabs.length]);

  // 注意: 移除了自动切换到新标签页的useEffect
  // 新标签页的切换现在在 handleCreateSSHConnection 中直接处理
  // 以避免竞态条件导致的重复标签页问题
  React.useEffect(() => {
    // 仅处理SFTP面板锁定更新，不再自动切换标签页
    if (tabs.length > prevTabsLength) {
      const newTab = tabs[tabs.length - 1];
      if (newTab && newTab.type === "ssh") {
        setLockedFileManagerTabId((prevLockedId) => {
          return prevLockedId !== null ? newTab.id : prevLockedId;
        });
      }
    }
    setPrevTabsLength(tabs.length);
  }, [tabs.length, prevTabsLength]);

  React.useEffect(() => {
    const getSidebarWidth = () => {
      const isSidebarOpen = {
        resource: resourceMonitorOpen,
        connection: connectionManagerOpen,
        file: fileManagerOpen,
        shortcut: shortcutCommandsOpen,
        history: commandHistoryOpen,
        ipquery: ipAddressQueryOpen,
        password: securityToolsOpen,
        localTerminal: localTerminalSidebarOpen,
      };
      const activeSidebar = isSidebarOpen[lastOpenedSidebar]
        ? lastOpenedSidebar
        : findFallbackSidebar(null);

      if (resourceMonitorOpen && activeSidebar === "resource") {
        return SIDEBAR_WIDTHS.RESOURCE_MONITOR;
      } else if (connectionManagerOpen && activeSidebar === "connection") {
        return SIDEBAR_WIDTHS.CONNECTION_MANAGER;
      } else if (fileManagerOpen && activeSidebar === "file") {
        return SIDEBAR_WIDTHS.FILE_MANAGER;
      } else if (shortcutCommandsOpen && activeSidebar === "shortcut") {
        return SIDEBAR_WIDTHS.SHORTCUT_COMMANDS;
      } else if (commandHistoryOpen && activeSidebar === "history") {
        return SIDEBAR_WIDTHS.COMMAND_HISTORY;
      } else if (ipAddressQueryOpen && activeSidebar === "ipquery") {
        return SIDEBAR_WIDTHS.IP_ADDRESS_QUERY;
      } else if (securityToolsOpen && activeSidebar === "password") {
        return SIDEBAR_WIDTHS.SECURITY_TOOLS;
      } else if (
        localTerminalSidebarOpen &&
        activeSidebar === "localTerminal"
      ) {
        return SIDEBAR_WIDTHS.LOCAL_TERMINAL_SIDEBAR;
      }
      return 0;
    };

    const sidebarWidth = getSidebarWidth();
    let calculatedMargin;
    // 始终为右侧按钮栏预留空间，即使没有侧边栏开启
    calculatedMargin = SIDEBAR_WIDTHS.SIDEBAR_BUTTONS_WIDTH;

    if (sidebarWidth > 0) {
      calculatedMargin =
        sidebarWidth +
        SIDEBAR_WIDTHS.SIDEBAR_BUTTONS_WIDTH +
        SIDEBAR_WIDTHS.SAFETY_MARGIN;
    }

    dispatch(actions.setActiveSidebarMargin(calculatedMargin));

    // 触发自定义事件，通知WebTerminal组件进行侧边栏变化适配
    // 使用多次触发机制，确保在CSS过渡期间和完成后都能正确调整终端大小
    const triggerDelays = [10, 100, 280]; // 在过渡期间、中期和完成后触发

    triggerDelays.forEach((delay) => {
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("sidebarChanged", {
            detail: {
              margin: calculatedMargin,
              sidebarWidth: sidebarWidth,
              timestamp: Date.now(),
            },
          }),
        );
      }, delay);
    });
  }, [
    resourceMonitorOpen,
    connectionManagerOpen,
    fileManagerOpen,
    shortcutCommandsOpen,
    commandHistoryOpen,
    ipAddressQueryOpen,
    securityToolsOpen,
    localTerminalSidebarOpen,
    lastOpenedSidebar,
    sidebarPosition,
    SIDEBAR_WIDTHS,
    findFallbackSidebar,
  ]);

  React.useEffect(() => {
    if (
      credentialSecurityStatus.loading ||
      !credentialSecurityStatus.unlocked ||
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
    credentialSecurityStatus.masterPasswordEnabled,
    credentialSecurityStatus.unlocked,
    refreshConnectionState,
  ]);

  React.useEffect(() => {
    if (!window.terminalAPI?.onConnectionsChanged) {
      return undefined;
    }

    const handleConnectionsChanged = () => {
      if (
        credentialSecurityStatus.loading ||
        !credentialSecurityStatus.unlocked
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
    credentialSecurityStatus.unlocked,
    refreshConnectionState,
  ]);

  React.useEffect(() => {
    const syncedInstances = syncTerminalInstanceConfigs(
      terminalInstances,
      tabs,
      connections,
    );

    if (syncedInstances !== terminalInstances) {
      dispatch(actions.setTerminalInstances(syncedInstances));
    }
  }, [connections, dispatch, tabs, terminalInstances]);

  // 应用启动时注册预加载和事件监听
  React.useEffect(() => {
    const preloadTimer = setTimeout(() => {
      // 再延迟一点预加载其他组件
      setTimeout(() => {
        preloadComponents.resourceMonitor().catch(() => {});
        preloadComponents.ipAddressQuery().catch(() => {});
      }, 2000);
    }, 3000);

    // 添加监听器，接收SSH进程ID更新事件
    const handleSshProcessIdUpdate = (event) => {
      const { terminalId, processId } = event.detail;
      if (terminalId && processId) {
        // 更新终端实例中的进程ID
        dispatch(
          actions.setTerminalInstances({
            ...terminalInstancesRef.current,
            [`${terminalId}-processId`]: processId,
          }),
        );

        // 更新进程缓存
        dispatch(
          actions.setProcessCache({
            ...processCacheRef.current,
            [terminalId]: processId,
          }),
        );
      }
    };

    const removeSshListener = eventManager.addEventListener(
      window,
      "sshProcessIdUpdated",
      handleSshProcessIdUpdate,
    );

    return () => {
      // 清理预加载定时器
      clearTimeout(preloadTimer);

      removeSshListener();
    };
  }, [dispatch, eventManager]);

  // 当连接列表更新时，同步更新置顶连接列表
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

  // 热门连接实时更新订阅（无需重启）
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

  // 保存更新后的连接配置
  const handleConnectionsUpdate = useCallback(
    (updatedConnections) => {
      dispatch(actions.setConnections(updatedConnections));
      if (window.terminalAPI && window.terminalAPI.saveConnections) {
        window.terminalAPI.saveConnections(updatedConnections);
      }
    },
    [dispatch],
  );

  // 创建动态主题
  const theme = React.useMemo(() => createUnifiedTheme(darkMode), [darkMode]);

  // 处理菜单打开
  const handleMenu = useCallback(
    (event) => {
      dispatch(actions.setAnchorEl(event.currentTarget));
    },
    [dispatch],
  );

  // 处理菜单关闭
  const handleClose = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
  }, [dispatch]);

  const handleTopBarInteraction = useCallback(
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const isInteractiveTarget = Boolean(
        target.closest(
          'button,[role="button"],input,textarea,select,a,[contenteditable="true"],.MuiTabs-root,.MuiMenu-root,#menu-appbar',
        ),
      );

      if (
        event.button === 0 &&
        event.detail === 2 &&
        !isInteractiveTarget &&
        window.terminalAPI?.toggleMaximizeWindow
      ) {
        window.terminalAPI.toggleMaximizeWindow();
        return;
      }

      if (!open) {
        return;
      }
      if (target.closest("#menu-appbar")) {
        return;
      }
      if (target.closest('[data-main-menu-button="true"]')) {
        return;
      }
      handleClose();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    [open, handleClose],
  );

  const handleLockApp = useCallback(async () => {
    if (!window.terminalAPI?.lockCredentialStore) {
      return;
    }
    try {
      const response = await window.terminalAPI.lockCredentialStore();
      if (response?.success === false) {
        showError(response.error || t("masterPassword.unlockFailed"));
        return;
      }
      const nextStatus = response?.status || {
        masterPasswordEnabled: true,
        unlocked: false,
        requiresUnlock: true,
      };
      setMasterPasswordError("");
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: nextStatus?.masterPasswordEnabled === true,
        unlocked: nextStatus?.unlocked !== false,
        requiresUnlock: nextStatus?.requiresUnlock === true,
      });
      showInfo(t("menu.lockAppSuccess"));
    } catch {
      showError(t("masterPassword.unlockFailed"));
    }
  }, [showError, showInfo, t]);

  // 打开关于对话框
  const handleOpenAbout = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
    dispatch(actions.setAboutDialogOpen(true));
  }, [dispatch]);

  // 关闭关于对话框
  const handleCloseAbout = useCallback(() => {
    dispatch(actions.setAboutDialogOpen(false));
  }, [dispatch]);

  // 打开设置对话框
  const handleOpenSettings = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
    dispatch(actions.setSettingsDialogOpen(true));
  }, [dispatch]);

  // 关闭设置对话框
  const handleCloseSettings = useCallback(() => {
    dispatch(actions.setSettingsDialogOpen(false));
  }, [dispatch]);

  const handleCheckForUpdates = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
    dispatch(actions.setAboutDialogOpen(true));
    setAboutUpdateCheckSignal((value) => value + 1);
  }, [dispatch]);

  const handleRemindUpdateLater = useCallback(() => {
    const reminderAt = Date.now() + UPDATE_REMINDER_DELAY_MS;

    try {
      window.localStorage?.setItem(
        UPDATE_REMINDER_STORAGE_KEY,
        String(reminderAt),
      );
    } catch {
      // Local reminder persistence is best-effort.
    }

    setUpdateReminderAt(reminderAt);
    dispatch(actions.setAboutDialogOpen(false));
    showInfo(
      t("update.reminderScheduled", {
        hours: Math.round(UPDATE_REMINDER_DELAY_MS / 60 / 60 / 1000),
      }),
    );
  }, [dispatch, showInfo, t]);

  React.useEffect(() => {
    if (!updateReminderAt) {
      return undefined;
    }

    const delay = Math.max(updateReminderAt - Date.now(), 0);
    const timer = window.setTimeout(() => {
      try {
        window.localStorage?.removeItem(UPDATE_REMINDER_STORAGE_KEY);
      } catch {
        // Ignore reminder persistence cleanup failures.
      }

      setUpdateReminderAt(0);
      showInfo(t("update.reminderDue"));
      handleCheckForUpdates();
    }, delay);

    return () => {
      window.clearTimeout(timer);
    };
  }, [handleCheckForUpdates, showInfo, t, updateReminderAt]);

  const handleOpenLogDirectory = useCallback(async () => {
    dispatch(actions.setAnchorEl(null));
    try {
      const result = await window.terminalAPI?.openLogDirectory?.();
      if (result?.success === false) {
        throw new Error(result.error || t("settings.openLogDirectoryFailed"));
      }
      showSuccess(t("settings.logDirectoryOpened"));
    } catch (error) {
      showError(error?.message || t("settings.openLogDirectoryFailed"));
    }
  }, [dispatch, showError, showSuccess, t]);

  const handleExportDiagnostics = useCallback(async () => {
    dispatch(actions.setAnchorEl(null));
    try {
      const result = await window.terminalAPI?.exportDiagnostics?.();
      if (result?.success === false) {
        throw new Error(result.error || t("settings.exportDiagnosticsFailed"));
      }
      showSuccess(
        t("settings.diagnosticsExported", {
          path: result?.filePath || "",
        }),
      );
    } catch (error) {
      showError(error?.message || t("settings.exportDiagnosticsFailed"));
    }
  }, [dispatch, showError, showSuccess, t]);

  const handleOpenFeedbackIssue = useCallback(async () => {
    dispatch(actions.setAnchorEl(null));
    try {
      if (!window.dialogAPI?.showMessageBox) {
        throw new Error(t("settings.feedback.dialogUnavailable"));
      }

      const confirmation = await window.dialogAPI.showMessageBox({
        type: "info",
        buttons: [t("settings.feedback.cancel"), t("menu.feedback")],
        defaultId: 1,
        cancelId: 0,
        title: t("settings.feedback.confirmTitle"),
        message: t("settings.feedback.confirmMessage"),
        detail: t("settings.feedback.confirmDetail"),
        noLink: true,
      });
      if (confirmation?.response !== 1) {
        return;
      }

      const result = await window.terminalAPI?.openFeedbackIssue?.({
        source: "main-menu",
        title: t("settings.feedback.defaultTitle"),
      });
      if (result?.success === false) {
        throw new Error(result.error || t("settings.feedback.openIssueFailed"));
      }
      showSuccess(t("settings.feedback.issueOpened"));
    } catch (error) {
      showError(error?.message || t("settings.feedback.openIssueFailed"));
    }
  }, [dispatch, showError, showSuccess, t]);

  const handleSystemMenuAction = useCallback(
    (payload) => {
      const action = payload?.action;
      if (action === "about") {
        handleOpenAbout();
        return;
      }
      if (action === "settings") {
        handleOpenSettings();
        return;
      }
      if (action === "check-for-updates") {
        handleCheckForUpdates();
        return;
      }
      if (action === "open-log-directory") {
        void handleOpenLogDirectory();
        return;
      }
      if (action === "export-diagnostics") {
        void handleExportDiagnostics();
        return;
      }
      if (action === "feedback-issue") {
        void handleOpenFeedbackIssue();
      }
    },
    [
      handleCheckForUpdates,
      handleExportDiagnostics,
      handleOpenFeedbackIssue,
      handleOpenAbout,
      handleOpenLogDirectory,
      handleOpenSettings,
    ],
  );

  React.useEffect(() => {
    if (!window.terminalAPI?.onMenuAction) {
      return undefined;
    }
    return window.terminalAPI.onMenuAction(handleSystemMenuAction);
  }, [handleSystemMenuAction]);

  const handleDesktopOpenFiles = useCallback(
    (payload) => {
      const filePaths = Array.isArray(payload?.filePaths)
        ? payload.filePaths
            .map((filePath) =>
              typeof filePath === "string" ? filePath.trim() : "",
            )
            .filter(Boolean)
        : [];

      if (filePaths.length === 0) {
        return;
      }

      showInfo(
        t("app.openFilesReceived", {
          count: filePaths.length,
          firstPath: filePaths[0],
        }),
      );
    },
    [showInfo, t],
  );

  React.useEffect(() => {
    if (!window.terminalAPI?.onOpenFiles) {
      return undefined;
    }
    return window.terminalAPI.onOpenFiles(handleDesktopOpenFiles);
  }, [handleDesktopOpenFiles]);

  // 处理应用退出
  const handleExit = useCallback(() => {
    if (window.terminalAPI && window.terminalAPI.closeApp) {
      window.terminalAPI.closeApp();
    }
    dispatch(actions.setAnchorEl(null));
  }, [dispatch]);

  // React 19: 利用自动批处理和 startTransition 优化主题切换
  const toggleTheme = useCallback(
    async (event) => {
      try {
        const newDarkMode = !darkMode;

        // 保存按钮引用，避免在 setTimeout 中访问已失效的 event
        const button = event?.currentTarget;

        // 添加按钮点击动画
        if (button) {
          button.classList.add("theme-button-pulse");
          setTimeout(() => {
            if (button) {
              button.classList.remove("theme-button-pulse");
            }
          }, 300);
        }

        // 创建动画遮罩层
        const overlay = document.createElement("div");
        overlay.className = `theme-switch-overlay ${newDarkMode ? "dark" : "light"}`;
        document.body.appendChild(overlay);

        // 添加主题切换标记，启用过渡效果
        document.body.classList.add("theme-switching");

        // 启动动画
        requestAnimationFrame(() => {
          overlay.classList.add("animating");
        });

        // 立即切换主题状态，使用 startTransition 避免阻塞
        React.startTransition(() => {
          dispatch(actions.setDarkMode(newDarkMode));
        });

        // 动画结束后清理（0.5s 动画时长）
        setTimeout(() => {
          document.body.classList.remove("theme-switching");
          overlay.remove();
        }, 500);

        // 保存主题设置到配置文件
        if (window.terminalAPI?.saveUISettings) {
          // 先获取当前设置，然后更新主题设置
          let currentSettings = { language: "zh-CN", fontSize: 14 };
          try {
            if (window.terminalAPI?.loadUISettings) {
              const loadedSettings = await window.terminalAPI.loadUISettings();
              if (loadedSettings) {
                currentSettings = loadedSettings;
              }
            }
          } catch {
            // 获取当前设置失败，使用默认值
          }

          // 更新主题设置并保存
          const updatedSettings = {
            ...currentSettings,
            darkMode: newDarkMode,
          };

          await window.terminalAPI.saveUISettings(updatedSettings);
        }
      } catch (error) {
        showError(error?.message || t("settings.saveError"));
      }
    },
    [darkMode, dispatch, showError, t],
  );

  const handleToggleSidebarPosition = useCallback(async () => {
    const nextPosition = sidebarPosition === "left" ? "right" : "left";
    setSidebarPosition(nextPosition);

    if (!window.terminalAPI?.saveUISettings) {
      return;
    }

    try {
      let currentSettings = { language: "zh-CN", fontSize: 14 };
      if (window.terminalAPI?.loadUISettings) {
        const loadedSettings = await window.terminalAPI.loadUISettings();
        if (loadedSettings) {
          currentSettings = loadedSettings;
        }
      }

      await window.terminalAPI.saveUISettings({
        ...currentSettings,
        sidebarPosition: nextPosition,
      });
    } catch (error) {
      console.error("Failed to save sidebar position:", error);
    }
  }, [sidebarPosition]);

  // 标签页相关函数
  const handleTabChange = useCallback(
    (event, newValue) => {
      dispatch(actions.setCurrentTab(newValue));

      // 如果切换到SSH标签页，检查SFTP面板是否已打开，如果是则更新锁定的tabId
      if (newValue < tabs.length) {
        const newTab = tabs[newValue];
        if (newTab && newTab.type === "ssh") {
          setLockedFileManagerTabId((prevLockedId) => {
            // 只有在之前有锁定的情况下才更新（即SFTP面板已打开）
            return prevLockedId !== null ? newTab.id : prevLockedId;
          });
        }
      }

      // 触发自定义事件，通知WebTerminal组件进行大小调整
      if (newValue < tabs.length) {
        const currentTabId = tabs[newValue]?.id;
        if (currentTabId) {
          // 使用自定义事件通知特定标签页的WebTerminal组件
          window.dispatchEvent(
            new CustomEvent("tabChanged", {
              detail: { tabId: currentTabId, index: newValue },
            }),
          );

          // 触发窗口resize事件，作为备用机制确保布局更新
          setTimeout(() => {
            window.dispatchEvent(new Event("resize"));
          }, 100);
        }
      }
    },
    [tabs, dispatch],
  );

  // 标签页右键菜单打开
  const handleTabContextMenu = useCallback(
    (event, index, tabId) => {
      event.preventDefault();
      // 欢迎页不显示右键菜单
      if (tabs[index].id === "welcome") return;

      dispatch(
        actions.setTabContextMenu({
          mouseX: event.clientX - 2,
          mouseY: event.clientY - 4,
          tabIndex: index,
          tabId: tabId,
        }),
      );

      if (tabs[index]?.type === "ssh") {
        void loadReconnectStatus(tabId);
      }
    },
    [tabs, dispatch, loadReconnectStatus],
  );

  const handleTabContextMenuRef = useRef(handleTabContextMenu);
  handleTabContextMenuRef.current = handleTabContextMenu;

  const handleTabContextMenuFromTab = useCallback((event, tabId, index) => {
    handleTabContextMenuRef.current(event, index, tabId);
  }, []);

  // 标签页右键菜单关闭
  const handleTabContextMenuClose = useCallback(() => {
    dispatch(
      actions.setTabContextMenu({
        mouseX: null,
        mouseY: null,
        tabIndex: null,
        tabId: null,
      }),
    );
  }, [dispatch]);

  // 刷新终端连接
  const handleRefreshTerminal = async () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null && tabIndex < tabs.length) {
      const currentTabInfo = tabs[tabIndex];
      const tabId = currentTabInfo.id;

      if (currentTabInfo.type === "ssh") {
        clearReconnectStatus(tabId);
        setReconnectActionTabId((current) =>
          current === tabId ? null : current,
        );
      }

      // 先关闭所有侧边栏以避免连接错误
      dispatch(actions.setResourceMonitorOpen(false));
      dispatch(actions.setFileManagerOpen(false));
      dispatch(actions.setIpAddressQueryOpen(false));

      // 获取当前连接的processId并清理连接
      try {
        // 从全局processCache获取processId（WebTerminal组件设置的）
        const processId = window.processCache && window.processCache[tabId];
        if (
          processId &&
          window.terminalAPI &&
          window.terminalAPI.cleanupConnection
        ) {
          await window.terminalAPI.cleanupConnection(processId);
        }
      } catch (cleanupError) {
        console.warn("Connection cleanup failed:", cleanupError);
      }

      // 从缓存中先移除旧实例
      dispatch(
        actions.setTerminalInstances({
          ...terminalInstances,
          [tabId]: undefined,
        }),
      );

      // 添加新实例标记，触发WebTerminal重新创建
      setTimeout(() => {
        dispatch(
          actions.setTerminalInstances({
            ...terminalInstances,
            [tabId]: true,
            [`${tabId}-refresh`]: Date.now(), // 添加时间戳确保组件被重新渲染
          }),
        );
      }, 100);
    }

    handleTabContextMenuClose();
  };

  // 切换连接管理侧边栏
  const toggleConnectionManager = useCallback(() => {
    const willOpen = !connectionManagerOpen;
    dispatch(actions.setConnectionManagerOpen(willOpen));
    // 如果要打开连接管理侧边栏，确保它显示在上层
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("connection"));
      // 资源监控保持不变
    } else {
      setFallbackSidebarAfterClose("connection");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  }, [connectionManagerOpen, dispatch, setFallbackSidebarAfterClose]);

  // 关闭连接管理侧边栏
  const handleCloseConnectionManager = useCallback(() => {
    dispatch(actions.setConnectionManagerOpen(false));
    setFallbackSidebarAfterClose("connection");
  }, [dispatch, setFallbackSidebarAfterClose]);

  const handleRequestCreateConnection = useCallback(() => {
    dispatch(actions.setConnectionManagerOpen(true));
    dispatch(actions.setLastOpenedSidebar("connection"));
    setCreateConnectionSignal(Date.now());

    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  }, [dispatch]);

  // 关闭终端连接
  const handleCloseConnection = () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null) {
      handleCloseTab(tabIndex);
    }
    handleTabContextMenuClose();
  };

  const handlePauseReconnect = useCallback(async () => {
    const tabId = tabContextMenu.tabId;
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
      handleTabContextMenuClose();
    } catch (error) {
      setReconnectActionTabId(null);
      showError(error?.message || t("tabMenu.pauseReconnect"));
    }
  }, [
    handleTabContextMenuClose,
    showError,
    showInfo,
    t,
    tabContextMenu.tabId,
    updateReconnectStatus,
  ]);

  const handleResumeReconnect = useCallback(async () => {
    const tabId = tabContextMenu.tabId;
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
      handleTabContextMenuClose();
    } catch (error) {
      setReconnectActionTabId(null);
      showError(error?.message || t("tabMenu.resumeReconnect"));
    }
  }, [
    handleTabContextMenuClose,
    showError,
    showInfo,
    t,
    tabContextMenu.tabId,
    updateReconnectStatus,
  ]);

  // 创建远程连接（SSH或Telnet）
  const handleCreateSSHConnection = useCallback(
    (connection) => {
      // 创建唯一的标签页ID
      const terminalId = `${connection.protocol || "ssh"}-${Date.now()}`;

      // 创建标签名（使用连接配置中的名称）
      const protocol = connection.protocol === "telnet" ? "Telnet" : "SSH";
      const tabName = connection.name || `${protocol}: ${connection.host}`;

      // 创建新标签页
      const newTab = {
        id: terminalId,
        label: tabName,
        type: connection.protocol || "ssh",
        connectionId: connection.id, // 存储连接ID以便后续使用
      };

      // 为连接添加tabId以便在main进程中识别
      const connectionConfigWithTabId = {
        ...connection,
        tabId: terminalId,
      };

      // 为新标签页创建终端实例缓存，并包含连接配置
      dispatch(
        actions.setTerminalInstances({
          ...terminalInstances,
          [terminalId]: true,
          [`${terminalId}-config`]: connectionConfigWithTabId, // 将完整的连接配置存储在缓存中
          [`${terminalId}-processId`]: null, // 预留存储进程ID的位置
        }),
      );

      // 添加标签并立即切换到新标签（使用当前tabs长度作为新索引）
      const newTabs = [...tabs, newTab];
      dispatch(actions.setTabs(newTabs));
      dispatch(actions.setCurrentTab(newTabs.length - 1));

      if ((connection.protocol || "ssh") === "ssh") {
        setConnectionStatusByTabId((previous) => ({
          ...previous,
          [terminalId]: {
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
      }
    },
    [tabs, terminalInstances, dispatch],
  );

  // 处理从连接管理器或欢迎页打开连接
  const handleOpenConnection = useCallback(
    (connection) => {
      const resolvedConnection = resolveRecentConnection(
        connection,
        connections,
      );
      if (!resolvedConnection || resolvedConnection.type !== "connection") {
        return;
      }

      handleCreateSSHConnection(resolvedConnection);
    },
    [connections, handleCreateSSHConnection],
  );

  // 关闭标签页
  const handleCloseTab = (index) => {
    // 不能关闭欢迎页
    if (tabs[index].id === "welcome") return;

    const tabToRemove = tabs[index];

    // 关闭SSH/Telnet连接 - 在清理缓存之前先断开连接
    const processId = processCache[tabToRemove.id];
    if (
      processId &&
      (tabToRemove.type === "ssh" || tabToRemove.type === "telnet")
    ) {
      window.terminalAPI.killProcess(processId).catch((err) => {
        console.warn(`关闭连接时出错: ${err.message}`);
      });
    }

    // 检查文件管理器是否为该标签页打开，如果是则关闭它
    if (
      fileManagerOpen &&
      (fileManagerProps.tabId === tabToRemove.id ||
        lockedFileManagerTabId === tabToRemove.id)
    ) {
      dispatch(actions.setFileManagerOpen(false));
      setLockedFileManagerTabId(null);
    }

    // 检查资源监控是否为该标签页打开，如果是则关闭它
    if (
      resourceMonitorOpen &&
      currentPanelTab &&
      currentPanelTab.id === tabToRemove.id
    ) {
      dispatch(actions.setResourceMonitorOpen(false));
    }

    // 从缓存中移除对应的终端实例
    const newInstances = { ...terminalInstances };
    delete newInstances[tabToRemove.id];
    delete newInstances[`${tabToRemove.id}-config`];
    delete newInstances[`${tabToRemove.id}-processId`];
    delete newInstances[`${tabToRemove.id}-refresh`];
    dispatch(actions.setTerminalInstances(newInstances));

    // 清理进程缓存
    const newCache = { ...processCache };
    delete newCache[tabToRemove.id];
    dispatch(actions.setProcessCache(newCache));

    // 清理文件管理路径记忆
    const newPaths = { ...fileManagerPaths };
    delete newPaths[tabToRemove.id];
    dispatch(actions.setFileManagerPaths(newPaths));
    setFileManagerHistoryByTabId((previous) => {
      if (!previous[tabToRemove.id]) {
        return previous;
      }

      const next = { ...previous };
      delete next[tabToRemove.id];
      return next;
    });

    clearReconnectStatus(tabToRemove.id);
    setReconnectActionTabId((current) =>
      current === tabToRemove.id ? null : current,
    );

    const newTabs = tabs.filter((_, i) => i !== index);
    dispatch(actions.setTabs(newTabs));

    // 如果关闭的是当前标签页，则选择相邻的非欢迎页标签（若存在）
    if (currentTab === index) {
      // newTabs 始终包含欢迎页（索引0）。当 newTabs.length > 1 时，说明仍有其他标签。
      if (newTabs.length > 1) {
        // 选择同位置的标签（若存在），否则选择前一个，但最小为1，避免退回欢迎页
        const target = Math.min(index, newTabs.length - 1);
        dispatch(actions.setCurrentTab(Math.max(1, target)));
      } else {
        // 仅剩欢迎页
        dispatch(actions.setCurrentTab(0));
      }
    } else if (currentTab > index) {
      // 如果关闭的标签在当前标签之前，当前标签索引需要减1
      const nextIndex = currentTab - 1;
      // 若仍存在其他标签，则避免落到0（欢迎页）
      if (newTabs.length > 1) {
        dispatch(actions.setCurrentTab(Math.max(1, nextIndex)));
      } else {
        dispatch(actions.setCurrentTab(0));
      }
    }
  };

  const handleCloseTabRef = useRef(handleCloseTab);
  handleCloseTabRef.current = handleCloseTab;

  const handleTabCloseRequest = useCallback((tabId) => {
    if (!tabId || tabId === "welcome") {
      return;
    }
    const index = latestTabsForActionsRef.current.findIndex(
      (t) => t.id === tabId,
    );
    if (index >= 0) {
      handleCloseTabRef.current(index);
    }
  }, []);

  // 优化的拖动开始处理函数 - 使用useCallback减少重建
  const handleDragStart = useCallback(
    (e, index) => {
      // 不允许拖动欢迎标签
      if (tabs[index].id === "welcome") {
        e.preventDefault();
        return;
      }

      dispatch(actions.setDraggedTab(index));
      // 设置一些拖动时的数据
      e.dataTransfer.effectAllowed = "move";
    },
    [tabs, dispatch],
  );

  // 处理拖动中 - 仅用于排序提示（节流至每帧一次，避免频繁重排导致闪烁）
  const handleDragOver = useCallback(
    (e, index) => {
      e.preventDefault();
      // 不允许放置到欢迎页
      if (index === 0) return;
      // 忽略无效拖拽或拖拽到自身
      if (draggedTabIndex === null || draggedTabIndex === index) {
        // 清除悬停状态
        if (dragOverTabIndex !== null) {
          dispatch(actions.setDragOverTab(null));
          dispatch(actions.setDragInsertPosition(null));
        }
        return;
      }

      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const tabWidth = rect.width;
      // 使用45%阈值，减少位置在中线附近反复切换
      const threshold = tabWidth * 0.45;
      const position = mouseX <= threshold ? "before" : "after";

      e.dataTransfer.dropEffect = "move";

      // 记录待更新状态
      pendingDragStateRef.current = { index, position };

      if (!dragRafRef.current) {
        dragRafRef.current = requestAnimationFrame(() => {
          const pending = pendingDragStateRef.current;
          dragRafRef.current = null;
          if (!pending) return;
          if (
            pending.index !== dragOverTabIndex ||
            pending.position !== dragInsertPosition
          ) {
            dispatch(actions.setDragOverTab(pending.index));
            dispatch(actions.setDragInsertPosition(pending.position));
          }
        });
      }
    },
    [draggedTabIndex, dragOverTabIndex, dragInsertPosition, dispatch],
  );

  // 处理拖动离开
  const handleDragLeave = useCallback(
    (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        dispatch(actions.setDragOverTab(null));
        dispatch(actions.setDragInsertPosition(null));
      }
    },
    [dispatch],
  );

  // 清理拖拽状态的辅助函数
  const cleanupDragState = useCallback(() => {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    pendingDragStateRef.current = null;
    dispatch(actions.setDraggedTab(null));
    dispatch(actions.setDragOverTab(null));
    dispatch(actions.setDragInsertPosition(null));
  }, [dispatch]);

  // 标签排序功能 - 核心排序逻辑
  // sourceIndex: 源标签当前索引
  // targetIndex: 目标位置索引（放置后应该在的位置）
  // position: 'before' 或 'after' - 相对于目标标签的位置
  const reorderTab = useCallback(
    (sourceIndex, targetIndex, position) => {
      // 验证参数
      if (sourceIndex === null || targetIndex === null) return;
      if (!tabs[sourceIndex]) return;
      if (tabs[sourceIndex].id === "welcome") return;
      if (targetIndex === 0) return; // 不能放到欢迎页之前

      // 计算最终插入位置
      // 如果位置是 "after"，最终位置应该是 targetIndex + 1
      // 如果位置是 "before"，最终位置就是 targetIndex
      let finalInsertIndex =
        position === "after" ? targetIndex + 1 : targetIndex;

      // 确保不会插入到欢迎页之前
      if (finalInsertIndex < 1) finalInsertIndex = 1;

      // 如果源标签在目标位置之前，移除源标签后，后面的索引都会减1
      // 所以需要调整最终插入位置
      const adjustedInsertIndex =
        sourceIndex < finalInsertIndex
          ? finalInsertIndex - 1
          : finalInsertIndex;

      // 如果调整后的插入位置等于源位置，不需要移动
      if (adjustedInsertIndex === sourceIndex) return;

      // 执行排序
      const newTabs = [...tabs];
      const [draggedTab] = newTabs.splice(sourceIndex, 1);
      newTabs.splice(adjustedInsertIndex, 0, draggedTab);

      dispatch(actions.setTabs(newTabs));

      // 更新当前选中标签页的索引
      let newCurrentTab = currentTab;
      if (currentTab === sourceIndex) {
        // 被拖拽的标签是当前选中的标签
        newCurrentTab = adjustedInsertIndex;
      } else if (
        sourceIndex < currentTab &&
        adjustedInsertIndex >= currentTab
      ) {
        // 源在当前之前，目标在当前或之后 -> 当前标签索引减1
        newCurrentTab = currentTab - 1;
      } else if (
        sourceIndex > currentTab &&
        adjustedInsertIndex <= currentTab
      ) {
        // 源在当前之后，目标在当前或之前 -> 当前标签索引加1
        newCurrentTab = currentTab + 1;
      }

      if (newCurrentTab !== currentTab) {
        dispatch(actions.setCurrentTab(newCurrentTab));
      }
    },
    [tabs, currentTab, dispatch],
  );

  // 处理放置 - 仅支持排序
  const handleDrop = useCallback(
    (e, targetIndex) => {
      e.preventDefault();
      e.stopPropagation();

      // 不允许放置到欢迎页
      if (targetIndex === 0) {
        cleanupDragState();
        return;
      }

      let sourceIndex = draggedTabIndex;

      // 如果状态中没有源索引，尝试从 dataTransfer 获取
      if (sourceIndex === null) {
        try {
          const raw = e.dataTransfer?.getData("application/json");
          if (raw) {
            const payload = JSON.parse(raw);
            if (
              payload?.type === "tab" &&
              typeof payload.tabIndex === "number"
            ) {
              sourceIndex = payload.tabIndex;
            }
          }
        } catch (error) {
          console.warn("Failed to parse drag payload", error);
        }
      }

      // 验证源索引
      if (sourceIndex === null || sourceIndex === targetIndex) {
        cleanupDragState();
        return;
      }

      // 确定放置位置
      const rect = e.currentTarget?.getBoundingClientRect();
      let position = dragInsertPosition;
      if (!position && rect) {
        position = e.clientX - rect.left <= rect.width / 2 ? "before" : "after";
      }
      if (!position) {
        position = "after";
      }

      // 执行排序
      reorderTab(sourceIndex, targetIndex, position);
      cleanupDragState();
    },
    [draggedTabIndex, dragInsertPosition, cleanupDragState, reorderTab],
  );

  // 处理拖动结束（无论是否成功放置）
  const handleDragEnd = useCallback(() => {
    cleanupDragState();
  }, [cleanupDragState]);

  // 切换资源监控侧边栏
  const toggleResourceMonitor = useCallback(() => {
    const willOpen = !resourceMonitorOpen;
    dispatch(actions.setResourceMonitorOpen(willOpen));
    // 如果要打开资源监控侧边栏，确保它显示在上层
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("resource"));
      // 连接管理保持不变
    } else {
      setFallbackSidebarAfterClose("resource");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  }, [resourceMonitorOpen, dispatch, setFallbackSidebarAfterClose]);

  // 关闭资源监控侧边栏
  const handleCloseResourceMonitor = useCallback(() => {
    dispatch(actions.setResourceMonitorOpen(false));
    setFallbackSidebarAfterClose("resource");
  }, [dispatch, setFallbackSidebarAfterClose]);

  // 切换文件管理侧边栏
  const toggleFileManager = () => {
    const currentPanelTab = getCurrentPanelTab();
    if (!fileManagerOpen && !isCurrentPanelSshConnected) {
      if (currentPanelTab?.type === "ssh") {
        void loadTabConnectionStatus(currentPanelTab.id);
      }
      return;
    }

    const willOpen = !fileManagerOpen;
    dispatch(actions.setFileManagerOpen(willOpen));

    // 如果要打开文件管理侧边栏，锁定当前标签页的tabId
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("file"));
      const currentPanelTab = getCurrentPanelTab();
      if (currentPanelTab) {
        setLockedFileManagerTabId(currentPanelTab.id);
      }
    } else {
      setFallbackSidebarAfterClose("file");
      // 关闭时清除锁定
      setLockedFileManagerTabId(null);
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 关闭文件管理侧边栏
  const handleCloseFileManager = () => {
    dispatch(actions.setFileManagerOpen(false));
    setFallbackSidebarAfterClose("file");
    // 清除锁定的tabId
    setLockedFileManagerTabId(null);

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 更新文件管理路径记忆
  const updateFileManagerPath = (tabId, path) => {
    if (tabId && path) {
      dispatch(
        actions.setFileManagerPaths({
          ...fileManagerPaths,
          [tabId]: path,
        }),
      );
    }
  };

  // 获取文件管理记忆路径
  const getFileManagerPath = (tabId) => {
    return fileManagerPaths[tabId] || "/";
  };

  const updateFileManagerHistory = useCallback((tabId, navigationState) => {
    if (!tabId || !navigationState) {
      return;
    }

    const nextHistoryState = {
      pathHistory: Array.isArray(navigationState.pathHistory)
        ? navigationState.pathHistory
        : [],
      historyIndex: Number.isInteger(navigationState.historyIndex)
        ? navigationState.historyIndex
        : -1,
    };

    setFileManagerHistoryByTabId((previous) => {
      const current = previous[tabId];
      if (areFileManagerHistoryStatesEqual(current, nextHistoryState)) {
        return previous;
      }

      return {
        ...previous,
        [tabId]: nextHistoryState,
      };
    });
  }, []);

  // 添加切换快捷命令侧边栏的函数
  const toggleShortcutCommands = () => {
    const willOpen = !shortcutCommandsOpen;
    dispatch(actions.setShortcutCommandsOpen(willOpen));
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("shortcut"));
    } else {
      setFallbackSidebarAfterClose("shortcut");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  const handleCloseShortcutCommands = () => {
    dispatch(actions.setShortcutCommandsOpen(false));
    setFallbackSidebarAfterClose("shortcut");

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 添加切换历史命令侧边栏的函数
  const toggleCommandHistory = () => {
    const willOpen = !commandHistoryOpen;
    dispatch(actions.setCommandHistoryOpen(willOpen));
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("history"));
    } else {
      setFallbackSidebarAfterClose("history");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  const handleCloseCommandHistory = () => {
    dispatch(actions.setCommandHistoryOpen(false));
    setFallbackSidebarAfterClose("history");

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  const probeAiApiStatus = useCallback(async () => {
    if (
      !window.terminalAPI?.fetchModels ||
      !window.terminalAPI?.loadAISettings
    ) {
      return;
    }
    const probeToken = ++aiApiProbeTokenRef.current;

    try {
      const settings = await window.terminalAPI.loadAISettings();
      const current = settings?.current;
      if (
        !current?.apiUrl?.trim() ||
        !current?.model?.trim() ||
        !current?.hasApiKey
      ) {
        if (probeToken !== aiApiProbeTokenRef.current) return;
        setAiApiReachable(false);
        return;
      }
      const result = await window.terminalAPI.fetchModels({
        apiConfigId: current.id || undefined,
        url: current.apiUrl,
        provider: current.provider || "openai",
      });
      if (probeToken !== aiApiProbeTokenRef.current) return;
      if (result && Array.isArray(result.models)) {
        setAiApiReachable(true);
      } else {
        setAiApiReachable(false);
      }
    } catch {
      if (probeToken !== aiApiProbeTokenRef.current) return;
      setAiApiReachable(false);
    }
  }, []);

  // 全局AI聊天窗口处理函数
  const handleToggleGlobalAiChatWindow = () => {
    if (aiChatStatus === "visible") {
      dispatch(actions.setAiChatStatus("minimized"));
    } else {
      dispatch(actions.setAiChatStatus("visible"));
      setLastActiveFloatWindow("ai");
      probeAiApiStatus();
    }
  };

  // 最小化AI聊天窗口（保持对话内容）
  const handleMinimizeGlobalAiChatWindow = () => {
    dispatch(actions.setAiChatStatus("minimized"));
  };

  // 关闭AI聊天窗口（清空对话内容）
  const handleCloseGlobalAiChatWindow = () => {
    dispatch(actions.setAiChatStatus("closed"));
  };

  React.useEffect(() => {
    if (aiChatStatus === "closed") {
      aiApiProbeTokenRef.current += 1;
      setAiApiReachable(false);
    }
  }, [aiChatStatus]);

  React.useEffect(() => {
    if (
      !aiPanelOpen ||
      !window.terminalAPI?.fetchModels ||
      !window.terminalAPI?.loadAISettings
    ) {
      return undefined;
    }

    const safeProbe = async () => {
      await probeAiApiStatus();
    };

    safeProbe();
    const intervalId = window.setInterval(safeProbe, 30000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") safeProbe();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [aiChatStatus, probeAiApiStatus]);

  // 打开全局传输浮动窗口
  const handleOpenTransferFloat = (transfer) => {
    setTransferFloatInitialTransfer(transfer);
    setTransferFloatOpen(true);
  };

  // 关闭全局传输浮动窗口
  const handleCloseTransferFloat = () => {
    setTransferFloatOpen(false);
    setTransferFloatInitialTransfer(null);
  };

  // 切换全局传输浮动窗口
  const handleToggleTransferFloat = (transfer) => {
    if (transferFloatOpen) {
      // 如果已经打开，则关闭
      handleCloseTransferFloat();
    } else {
      // 如果关闭，则打开
      handleOpenTransferFloat(transfer);
    }
  };

  // 发送文本到AI助手
  const handleSendToAI = (text) => {
    dispatch(actions.setAiInputPreset(text));
    dispatch(actions.setAiChatStatus("visible"));
  };

  // 切换IP地址查询侧边栏
  const toggleIpAddressQuery = () => {
    const willOpen = !ipAddressQueryOpen;
    dispatch(actions.setIpAddressQueryOpen(willOpen));
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("ipquery"));
    } else {
      setFallbackSidebarAfterClose("ipquery");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 关闭IP地址查询侧边栏
  const handleCloseIpAddressQuery = () => {
    dispatch(actions.setIpAddressQueryOpen(false));
    setFallbackSidebarAfterClose("ipquery");

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 切换随机密码生成器侧边栏
  const toggleSecurityTools = () => {
    const willOpen = !securityToolsOpen;
    dispatch(actions.setSecurityToolsOpen(willOpen));
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("password"));
    } else {
      setFallbackSidebarAfterClose("password");
    }
  };

  // 切换本地终端侧边栏
  const toggleLocalTerminalSidebar = () => {
    const willOpen = !localTerminalSidebarOpen;
    setLocalTerminalSidebarOpen(willOpen);
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("localTerminal"));
    } else {
      setFallbackSidebarAfterClose("localTerminal");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 关闭本地终端侧边栏
  const handleCloseLocalTerminalSidebar = () => {
    setLocalTerminalSidebarOpen(false);
    setFallbackSidebarAfterClose("localTerminal");

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 启动本地终端的处理函数（仅启动外部终端，不在应用中创建标签页）
  const handleLaunchLocalTerminal = useCallback(async (terminalConfig) => {
    try {
      if (window.terminalAPI?.launchLocalTerminal) {
        const terminalId = `local-${Date.now()}`;

        // 确保传递完整的终端配置
        const completeConfig = {
          name: terminalConfig.name,
          type: terminalConfig.type,
          executablePath: terminalConfig.executablePath,
          executable: terminalConfig.executable,
          availableDistributions: terminalConfig.availableDistributions || [],
          launchArgs: terminalConfig.launchArgs || [],
        };

        const result = await window.terminalAPI.launchLocalTerminal(
          completeConfig,
          terminalId,
        );

        // 检查API调用是否成功
        if (!result.success) {
          throw new Error(result.error || "Launch failed");
        }

        // 不创建标签页，只启动外部终端
        // 终端将在系统中独立运行，不显示在应用界面中

        return result;
      }
      throw new Error("Local terminal API not available");
    } catch (error) {
      if (!error) {
        throw new Error("Local terminal launch failed");
      }
      throw error;
    }
  }, []);

  // 获取右侧面板应该使用的当前标签页信息
  const getCurrentPanelTab = useCallback(() => {
    if (currentTab > 0 && tabs[currentTab]) {
      return tabs[currentTab];
    }
    return null;
  }, [tabs, currentTab]);

  // 添加发送快捷命令到终端的函数
  const handleSendCommand = useCallback(
    (command, options = {}) => {
      const panelTab = getCurrentPanelTab();

      if (panelTab && panelTab.type === "ssh") {
        dispatchCommandToGroup(panelTab.id, command, options);
        return { success: true };
      } else if (panelTab) {
        console.warn("Current tab is not SSH:", panelTab.type);
        return { success: false, error: t("commandHistory.notSshTab") };
      } else {
        console.warn("No panel tab found");
        return { success: false, error: t("commandHistory.noSshConnection") };
      }
    },
    [getCurrentPanelTab, t],
  );

  // 计算右侧面板的当前标签页信息
  const currentPanelTab = getCurrentPanelTab();
  const currentPanelConnectionStatus = currentPanelTab
    ? connectionStatusByTabId[currentPanelTab.id]
    : null;
  const isCurrentPanelSshTab = currentPanelTab?.type === "ssh";
  const isCurrentPanelSshConnected =
    isCurrentPanelSshTab &&
    currentPanelConnectionStatus?.isConnected === true &&
    currentPanelConnectionStatus?.isConnecting !== true;

  React.useEffect(() => {
    if (!currentPanelTab || currentPanelTab.type !== "ssh") {
      return;
    }

    loadTabConnectionStatus(currentPanelTab.id);
  }, [currentPanelTab, loadTabConnectionStatus]);

  React.useEffect(() => {
    if (!fileManagerOpen) {
      return;
    }

    const targetTabId = lockedFileManagerTabId || currentPanelTab?.id || null;
    const targetTab = targetTabId
      ? tabs.find((tab) => tab.id === targetTabId)
      : null;
    const targetStatus = targetTabId
      ? connectionStatusByTabId[targetTabId]
      : null;
    const targetConnected =
      targetTab?.type === "ssh" &&
      targetStatus?.isConnected === true &&
      targetStatus?.isConnecting !== true;

    if (!targetConnected) {
      dispatch(actions.setFileManagerOpen(false));
      setFallbackSidebarAfterClose("file");
      setLockedFileManagerTabId(null);
      setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 15);
    }
  }, [
    connectionStatusByTabId,
    currentPanelTab,
    dispatch,
    fileManagerOpen,
    lockedFileManagerTabId,
    tabs,
    setFallbackSidebarAfterClose,
  ]);

  // 计算资源监控的currentTabId
  const resourceMonitorTabId = useMemo(() => {
    if (
      !resourceMonitorOpen ||
      !currentPanelTab ||
      currentPanelTab.type !== "ssh"
    ) {
      return null;
    }
    return (
      terminalInstances[`${currentPanelTab.id}-processId`] || currentPanelTab.id
    );
  }, [resourceMonitorOpen, currentPanelTab, terminalInstances]);

  // 计算文件管理器的props（使用锁定的tabId）
  const fileManagerProps = useMemo(() => {
    // 如果没有锁定的tabId，则使用当前激活的标签页
    const targetTabId =
      lockedFileManagerTabId || (currentPanelTab ? currentPanelTab.id : null);

    if (!targetTabId) {
      return {
        tabId: null,
        tabName: null,
        sshConnection: null,
        initialPath: "/",
        navigationState: null,
      };
    }

    // 查找对应的tab
    const targetTab = tabs.find((tab) => tab.id === targetTabId);
    if (!targetTab) {
      return {
        tabId: null,
        tabName: null,
        sshConnection: null,
        initialPath: "/",
        navigationState: null,
      };
    }

    return {
      tabId: targetTab.id,
      tabName: targetTab.label,
      sshConnection:
        targetTab.type === "ssh"
          ? terminalInstances[`${targetTab.id}-config`]
          : null,
      initialPath: getFileManagerPath(targetTab.id),
      navigationState: fileManagerHistoryByTabId[targetTab.id] || null,
    };
  }, [
    fileManagerHistoryByTabId,
    lockedFileManagerTabId,
    currentPanelTab,
    tabs,
    terminalInstances,
    fileManagerPaths,
  ]);

  // 计算AI聊天窗口的连接信息
  const aiChatConnectionInfo = useMemo(() => {
    if (
      !currentPanelTab ||
      (currentPanelTab.type !== "ssh" && currentPanelTab.type !== "telnet")
    ) {
      return null;
    }

    const config = terminalInstances[`${currentPanelTab.id}-config`];
    if (!config) {
      return {
        host: currentPanelTab.label,
        type: currentPanelTab.type?.toUpperCase() || "SSH",
      };
    }

    return {
      host: config.host || currentPanelTab.label,
      port: config.port,
      username: config.username,
      type: currentPanelTab.type?.toUpperCase() || "SSH",
    };
  }, [currentPanelTab, terminalInstances]);

  // 计算按钮禁用状态
  const isSSHButtonDisabled = useMemo(() => {
    return !currentPanelTab || currentPanelTab.type !== "ssh";
  }, [currentPanelTab]);
  const isFileManagerButtonDisabled = !isCurrentPanelSshConnected;

  // React 19: 利用自动批处理特性优化设置变更处理
  React.useEffect(() => {
    const handleSettingsChanged = (event) => {
      const {
        language,
        fontSize,
        darkMode: newDarkMode,
        dnd,
        transferBarMode: newTransferBarMode,
        sidebarPosition: newSidebarPosition,
        performance: perf,
      } = event.detail;

      // 同步硬件加速标志到 globalTransferStore（不需重启即可影响 RAF 节流路径）
      if (perf && perf.hardwareAcceleration !== undefined) {
        window.__hardwareAccelerationEnabled =
          perf.hardwareAcceleration !== false;
      }

      // React 19: 所有状态更新会自动批处理，提高性能
      // 应用主题设置
      if (newDarkMode !== undefined && newDarkMode !== darkMode) {
        dispatch(actions.setDarkMode(newDarkMode));
      }

      // 应用字号设置
      if (fontSize) {
        document.documentElement.style.fontSize = `${fontSize}px`;
      }

      // 应用语言设置
      if (language) {
        // 通过i18n.js中的changeLanguage函数来改变语言
        changeLanguage(language);

        // 基本的HTML语言设置
        document.documentElement.lang = language;
      }

      // 应用 DnD 设置
      if (dnd?.enabled !== undefined) {
        setDndEnabled(dnd.enabled);
      }

      // 应用传输栏模式设置
      if (newTransferBarMode) {
        setTransferBarMode(newTransferBarMode);
      }

      // 应用侧边栏位置设置
      if (newSidebarPosition) {
        setSidebarPosition(normalizeSidebarPosition(newSidebarPosition));
      }
    };

    // 处理欢迎页AI按钮点击事件
    const handleToggleGlobalAI = () => {
      handleToggleGlobalAiChatWindow();
    };

    // 监听发送到AI助手事件
    const handleSendToAIEvent = (event) => {
      handleSendToAI(event.detail.text);
    };

    // Alt+F1 全局快捷键唤醒AI助手
    const handleGlobalKeyDown = (event) => {
      if (event.altKey && event.key === "F1") {
        event.preventDefault();
        handleToggleGlobalAiChatWindow();
      }
    };

    // 使用 useWindowEvents Hook 统一管理多个 window 事件监听
    // 注意：为了避免在 useEffect 中再使用 Hook，我们继续使用 eventManager
    const removeSettingsListener = eventManager.addEventListener(
      window,
      "settingsChanged",
      handleSettingsChanged,
    );
    const removeToggleListener = eventManager.addEventListener(
      window,
      "toggleGlobalAI",
      handleToggleGlobalAI,
    );
    const removeSendToAIListener = eventManager.addEventListener(
      window,
      "sendToAI",
      handleSendToAIEvent,
    );
    const removeKeyDownListener = eventManager.addEventListener(
      window,
      "keydown",
      handleGlobalKeyDown,
    );

    // 初始化应用设置
    const loadInitialSettings = async () => {
      try {
        if (window.terminalAPI?.loadUISettings) {
          const settings = await window.terminalAPI.loadUISettings();
          if (settings) {
            // 应用主题设置
            if (settings.darkMode !== undefined) {
              dispatch(actions.setDarkMode(settings.darkMode));
            }

            // 应用字号设置
            document.documentElement.style.fontSize = `${settings.fontSize || 14}px`;

            // 应用初始语言设置
            if (settings.language) {
              changeLanguage(settings.language);
              document.documentElement.lang = settings.language;
            }

            // 应用 DnD 设置
            if (settings.dnd?.enabled !== undefined) {
              setDndEnabled(settings.dnd.enabled);
            }

            // 应用传输栏模式设置
            if (settings.transferBarMode) {
              setTransferBarMode(settings.transferBarMode);
            }

            // 应用侧边栏位置设置
            if (settings.sidebarPosition) {
              setSidebarPosition(
                normalizeSidebarPosition(settings.sidebarPosition),
              );
            }

            // 暴露硬件加速标志给 globalTransferStore 等高频更新模块
            window.__hardwareAccelerationEnabled =
              settings?.performance?.hardwareAcceleration !== false;
          }
        }
      } catch {
        // 使用默认字体大小
        document.documentElement.style.fontSize = "14px";
      }
    };

    loadInitialSettings();

    // 智能预加载侧边栏组件，提升用户体验
    smartPreload.preloadSidebarComponents();

    return () => {
      removeSettingsListener();
      removeToggleListener();
      removeSendToAIListener();
      removeKeyDownListener();
    };
  }, [darkMode, dispatch, aiChatStatus]); // 添加 aiChatStatus 依赖以确保快捷键能正确切换状态

  // 分组操作回调
  const handleJoinGroup = (tabId, groupId) => {
    addTabToGroup(tabId, groupId);
    dispatch(actions.setTabs([...tabs])); // 触发刷新
    handleTabContextMenuClose();
  };
  const handleRemoveFromGroup = (tabId) => {
    removeTabFromGroup(tabId);
    dispatch(actions.setTabs([...tabs]));
    handleTabContextMenuClose();
  };
  const handleCreateGroup = (tabId) => {
    const newGroup = addGroup();
    addTabToGroup(tabId, newGroup.groupId);
    dispatch(actions.setTabs([...tabs]));
    handleTabContextMenuClose();
  };

  // 在主题加载完成前显示加载状态，避免闪烁
  if (themeLoading) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            width: "100vw",
            height: "100vh",
            bgcolor: "background.default",
          }}
        >
          {/* 简单加载提示，不显示任何文本避免复杂化 */}
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          width: "100vw",
          height: "100vh",
          overflow: "hidden",
        }}
      >
        <AppBar
          position="static"
          sx={{
            width: "100%",
            left: 0,
            right: 0,
            top: 0,
            bgcolor: (theme) =>
              theme.palette.mode === "light" ? "#f3f4f6" : "background.paper",
            color: (theme) =>
              theme.palette.mode === "light" ? "text.primary" : "inherit",
            boxShadow: (theme) =>
              theme.palette.mode === "light"
                ? "0 1px 3px rgba(0,0,0,0.1)"
                : "inherit",
            borderBottom: (theme) =>
              theme.palette.mode === "light"
                ? "1px solid rgba(0,0,0,0.08)"
                : "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              WebkitAppRegion: "drag",
            }}
          >
            <Toolbar
              variant="dense"
              onMouseDownCapture={handleTopBarInteraction}
              sx={{
                px: 1,
                minHeight: "30px",
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                // 菜单展开时临时关闭拖拽区，确保点击空白顶部栏可触发收起
                WebkitAppRegion: open ? "no-drag" : "drag",
              }}
            >
              <Tooltip title={t("menu.mainMenu")}>
                <IconButton
                  edge="start"
                  color="inherit"
                  aria-label={t("menu.mainMenu")}
                  data-main-menu-button="true"
                  sx={{ mr: 1, WebkitAppRegion: "no-drag" }}
                  onClick={handleMenu}
                >
                  <AppsIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("menu.lockApp")}>
                <IconButton
                  color="inherit"
                  size="small"
                  aria-label={t("menu.lockApp")}
                  sx={{ mr: 1, WebkitAppRegion: "no-drag" }}
                  onClick={handleLockApp}
                >
                  <LockOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Menu
                id="menu-appbar"
                anchorEl={anchorEl}
                anchorOrigin={{
                  vertical: "bottom",
                  horizontal: "left",
                }}
                keepMounted
                transformOrigin={{
                  vertical: "top",
                  horizontal: "left",
                }}
                open={open}
                onClose={handleClose}
              >
                <MenuItem onClick={handleOpenSettings}>
                  <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
                  {t("menu.settings")}
                </MenuItem>
                <MenuItem onClick={handleCheckForUpdates}>
                  <RefreshIcon fontSize="small" sx={{ mr: 1 }} />
                  {t("menu.checkForUpdates")}
                </MenuItem>
                <MenuItem onClick={handleOpenLogDirectory}>
                  <FolderOpenIcon fontSize="small" sx={{ mr: 1 }} />
                  {t("menu.openLogs")}
                </MenuItem>
                <MenuItem onClick={handleExportDiagnostics}>
                  <BugReportIcon fontSize="small" sx={{ mr: 1 }} />
                  {t("menu.exportDiagnostics")}
                </MenuItem>
                <MenuItem onClick={handleOpenFeedbackIssue}>
                  <FeedbackIcon fontSize="small" sx={{ mr: 1 }} />
                  {t("menu.feedback")}
                </MenuItem>
                <MenuItem onClick={handleOpenAbout}>
                  <InfoIcon fontSize="small" sx={{ mr: 1 }} />
                  {t("menu.about")}
                </MenuItem>
                <MenuItem onClick={handleExit}>
                  <ExitToAppIcon fontSize="small" sx={{ mr: 1 }} />
                  {t("menu.exit")}
                </MenuItem>
              </Menu>
              <Box sx={{ flexGrow: 1 }} />
              <WindowControls />
            </Toolbar>

            <Box
              onMouseDownCapture={handleTopBarInteraction}
              sx={{
                display: "flex",
                alignItems: "center",
                minHeight: "30px",
                px: 1,
                pb: 0,
                gap: 0.5,
                WebkitAppRegion: "drag",
                borderTop: (theme) =>
                  theme.palette.mode === "light"
                    ? "1px solid rgba(0,0,0,0.06)"
                    : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <Box
                sx={{
                  flexGrow: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  WebkitAppRegion: "no-drag",
                  maxWidth: `calc(100% - ${LATENCY_INFO_MIN_WIDTH}px)`,
                  pr: 0.5,
                }}
              >
                {/* 标签页 */}
                <Tabs
                  ref={tabsRef}
                  value={currentTab}
                  onChange={handleTabChange}
                  variant="scrollable"
                  scrollButtons={hasTabOverflow ? "auto" : false}
                  sx={{
                    flexGrow: 1,
                    minWidth: 0,
                    minHeight: 30,
                    "& .MuiTabs-scroller": {
                      px: 0.5,
                    },
                    "& .MuiTabs-flexContainer": {
                      gap: 0.5,
                    },
                    "& .MuiTabs-indicator": {
                      height: 2,
                      background:
                        "linear-gradient(90deg, rgba(66,165,245,0.85), rgba(124,77,255,0.85))",
                      borderRadius: "999px",
                      bottom: 0,
                    },
                    "& .MuiTabs-scrollButtons": {
                      width: 24,
                      color: "text.secondary",
                      transition: "opacity 0.2s ease",
                    },
                    "& .MuiTabs-scrollButtons.Mui-disabled": {
                      opacity: 0,
                      width: 0,
                      minWidth: 0,
                      overflow: "hidden",
                    },
                  }}
                >
                  {tabs.map((tab, index) => {
                    const label =
                      index === 0
                        ? t("terminal.welcome")
                        : tab.label || tab.title || "";
                    const tabReconnectStatus = reconnectStateByTabId[tab.id];
                    const tabReconnectColor = getReconnectStatusColor(
                      tabReconnectStatus?.state,
                    );
                    const tabReconnectTooltip = buildReconnectBadgeTooltip(
                      t,
                      tabReconnectStatus,
                    );

                    return (
                      <CustomTab
                        key={tab.id}
                        label={label}
                        statusColor={tabReconnectColor}
                        statusTooltip={tabReconnectTooltip}
                        onClose={
                          tab.id !== "welcome" ? handleTabCloseRequest : null
                        }
                        onContextMenu={handleTabContextMenuFromTab}
                        draggable={dndEnabled && tab.id !== "welcome"}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                        value={index}
                        selected={currentTab === index}
                        index={index}
                        tabId={tab.id}
                        isDragSource={
                          draggedTabIndex !== null && draggedTabIndex === index
                        }
                        dragSessionActive={draggedTabIndex !== null}
                        isDraggedOver={
                          draggedTabIndex !== null &&
                          dragOverTabIndex === index &&
                          draggedTabIndex !== index
                        }
                        dragInsertPosition={
                          draggedTabIndex !== null && dragOverTabIndex === index
                            ? dragInsertPosition
                            : null
                        }
                      />
                    );
                  })}
                </Tabs>
              </Box>

              {/* 网络延迟指示器 */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  flexShrink: 0,
                  minWidth: LATENCY_INFO_MIN_WIDTH,
                  WebkitAppRegion: "no-drag",
                  ml: 0.5,
                }}
              >
                <NetworkLatencyIndicator
                  currentTab={currentTab}
                  tabs={tabs}
                  placement="inline"
                />
              </Box>
            </Box>
          </Box>

          {/* 标签页右键菜单 */}
          <Menu
            keepMounted
            open={tabContextMenu.mouseY !== null}
            onClose={handleTabContextMenuClose}
            anchorReference="anchorPosition"
            anchorPosition={
              tabContextMenu.mouseY !== null && tabContextMenu.mouseX !== null
                ? { top: tabContextMenu.mouseY, left: tabContextMenu.mouseX }
                : undefined
            }
            PaperProps={{
              style: {
                minWidth: "200px",
              },
            }}
          >
            <MenuItem onClick={handleRefreshTerminal}>
              <RefreshIcon fontSize="small" sx={{ mr: 1 }} />
              {t("tabMenu.refresh")}
            </MenuItem>

            <MenuItem onClick={handleCloseConnection}>
              <PowerOffIcon fontSize="small" sx={{ mr: 1 }} />
              {t("tabMenu.close")}
            </MenuItem>

            {isContextMenuSshTab && contextMenuReconnectStatus && <Divider />}

            {isContextMenuSshTab && contextMenuReconnectStatus && (
              <Box
                sx={{
                  px: 2,
                  py: 1.25,
                  maxWidth: 320,
                  WebkitAppRegion: "no-drag",
                }}
              >
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", display: "block", mb: 0.75 }}
                >
                  {t("tabMenu.reconnectStatus")}
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 0.75,
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: reconnectStatusColor || "text.disabled",
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body2">
                    {reconnectStatusTitle}
                  </Typography>
                </Box>
                {Number.isFinite(
                  Number(contextMenuReconnectStatus?.attempts),
                ) &&
                  Number.isFinite(
                    Number(contextMenuReconnectStatus?.maxAttempts),
                  ) &&
                  Number(contextMenuReconnectStatus?.maxAttempts) > 0 && (
                    <Typography
                      variant="caption"
                      sx={{ color: "text.secondary", display: "block" }}
                    >
                      {t("tabMenu.retryAttempts", {
                        attempts: Number(contextMenuReconnectStatus.attempts),
                        maxAttempts: Number(
                          contextMenuReconnectStatus.maxAttempts,
                        ),
                      })}
                    </Typography>
                  )}
                {reconnectFailureReasonLabel && (
                  <Typography
                    variant="caption"
                    sx={{ color: "text.secondary", display: "block" }}
                  >
                    {t("tabMenu.failureReasonLabel", {
                      reason: reconnectFailureReasonLabel,
                    })}
                  </Typography>
                )}
                {contextMenuReconnectStatus?.error && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: "error.main",
                      display: "block",
                      mt: 0.75,
                      wordBreak: "break-word",
                    }}
                  >
                    {t("tabMenu.lastError", {
                      error: contextMenuReconnectStatus.error,
                    })}
                  </Typography>
                )}
              </Box>
            )}

            {isContextMenuSshTab &&
              canPauseReconnectStatus(contextMenuReconnectStatus) && (
                <MenuItem
                  onClick={handlePauseReconnect}
                  disabled={isReconnectActionPending}
                >
                  <PauseCircleOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
                  {t("tabMenu.pauseReconnect")}
                </MenuItem>
              )}

            {isContextMenuSshTab &&
              contextMenuReconnectStatus?.state === "paused" && (
                <MenuItem
                  onClick={handleResumeReconnect}
                  disabled={isReconnectActionPending}
                >
                  <PlayCircleOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
                  {t("tabMenu.resumeReconnect")}
                </MenuItem>
              )}
            {/* 分组相关菜单项 */}
            {(() => {
              const tabId = tabContextMenu.tabId;
              if (!tabId) return null;
              const group = findGroupByTab(tabId);
              const groups = getGroups();
              const groupMenuItems = [];
              if (group) {
                groupMenuItems.push(
                  <MenuItem
                    key="remove-from-group"
                    onClick={() => handleRemoveFromGroup(tabId)}
                  >
                    <PowerOffIcon
                      fontSize="small"
                      sx={{ color: group.color, mr: 1 }}
                    />
                    <ListItemText>{`${t("tabMenu.removeFromGroup")} ${group.groupId.replace("G", "")}`}</ListItemText>
                  </MenuItem>,
                );
              } else {
                groups.forEach((g) => {
                  groupMenuItems.push(
                    <MenuItem
                      key={g.groupId}
                      onClick={() => handleJoinGroup(tabId, g.groupId)}
                    >
                      <AddIcon fontSize="small" sx={{ mr: 1 }} />
                      <ListItemText>
                        {t("tabMenu.joinGroup")} {g.groupId.replace("G", "")}
                      </ListItemText>
                    </MenuItem>,
                  );
                });
                groupMenuItems.push(
                  <MenuItem
                    key="create-group"
                    onClick={() => handleCreateGroup(tabId)}
                  >
                    <AddCircleOutlinedIcon fontSize="small" sx={{ mr: 1 }} />
                    <ListItemText>{t("tabMenu.createGroup")}</ListItemText>
                  </MenuItem>,
                );
              }
              if (groupMenuItems.length > 0) {
                return [<Divider key="group-divider-top" />, ...groupMenuItems];
              }
              return [];
            })()}
          </Menu>
        </AppBar>
        <Box
          sx={{
            display: "flex",
            flexGrow: 1,
            overflow: "hidden",
            position: "relative",
            flexDirection: "column",
          }}
        >
          {/* 主内容和侧边栏容器 */}
          <Box
            sx={{
              display: "flex",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
              position: "relative",
              flexDirection: sidebarPosition === "left" ? "row-reverse" : "row",
            }}
          >
            {/* 主内容区域 */}
            <Box
              sx={{
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                p: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              {/* 标签页内容 */}
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                  width: "100%",
                  bgcolor: "background.paper",
                  borderRadius: 0,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  padding: 0,
                  margin: 0,
                  boxShadow: "none",
                  position: "relative",
                }}
              >
                {/* 欢迎页 - 使用条件渲染优化性能 */}
                {currentTab === 0 && (
                  <Box
                    sx={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      zIndex: 1,
                    }}
                  >
                    <WelcomePage
                      connections={connections}
                      topConnections={topConnections}
                      onOpenConnection={handleOpenConnection}
                      onCreateConnection={handleRequestCreateConnection}
                      onConnectionsUpdate={handleConnectionsUpdate}
                    />
                  </Box>
                )}

                {/* 终端标签页 - 保持所有标签页DOM以维持连接状态 */}
                {tabs.slice(1).map((tab, index) => {
                  const isActive = currentTab === index + 1;

                  return (
                    <Box
                      key={tab.id}
                      sx={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        height: "100%",
                        zIndex: isActive ? 1 : 0,
                        backgroundColor: "inherit",
                        visibility: isActive ? "visible" : "hidden",
                        opacity: isActive ? 1 : 0,
                        pointerEvents: isActive ? "auto" : "none",
                        transition: isActive
                          ? "opacity 0.2s ease-in-out"
                          : "none",
                      }}
                    >
                      {terminalInstances[tab.id] && (
                        <WebTerminal
                          tabId={tab.id}
                          refreshKey={terminalInstances[`${tab.id}-refresh`]}
                          sshConfig={
                            tab.type === "ssh"
                              ? terminalInstances[`${tab.id}-config`]
                              : null
                          }
                          isActive={isActive}
                        />
                      )}
                    </Box>
                  );
                })}
              </Box>
            </Box>

            {/* 可切换位置的侧边栏容器 */}
            <Box
              sx={{
                position: "relative",
                height: "100%",
                display: "flex",
                flexShrink: 0,
                flexDirection:
                  sidebarPosition === "left" ? "row-reverse" : "row",
                zIndex: 90,
              }}
            >
              {/* 侧边栏内容区域 - 根据是否有侧边栏打开来显示 */}
              <Box
                sx={{
                  width: `${
                    activeSidebarMargin > SIDEBAR_WIDTHS.SIDEBAR_BUTTONS_WIDTH
                      ? activeSidebarMargin -
                        SIDEBAR_WIDTHS.SIDEBAR_BUTTONS_WIDTH
                      : 0
                  }px`,
                  height: "100%",
                  position: "relative",
                  willChange: "width",
                  transition: (theme) =>
                    theme.transitions.create("width", {
                      easing: theme.transitions.easing.sharp,
                      duration: theme.transitions.duration.enteringScreen,
                    }),
                  overflow: "hidden",
                }}
              >
                {/* 资源监控侧边栏 */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "resource" ? 101 : 98,
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {resourceMonitorPresent && (
                    <ResourceMonitor
                      open={resourceMonitorOpen}
                      onClose={handleCloseResourceMonitor}
                      currentTabId={resourceMonitorTabId}
                    />
                  )}
                </Box>

                {/* 连接管理侧边栏 */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "connection" ? 101 : 99,
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {connectionManagerPresent && (
                    <ConnectionManager
                      open={connectionManagerOpen}
                      onClose={handleCloseConnectionManager}
                      initialConnections={connections}
                      onConnectionsUpdate={handleConnectionsUpdate}
                      onOpenConnection={handleOpenConnection}
                      createConnectionSignal={createConnectionSignal}
                      onCreateConnectionSignalConsumed={() =>
                        setCreateConnectionSignal(0)
                      }
                    />
                  )}
                </Box>

                {/* 文件管理侧边栏 */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "file" ? 103 : 96,
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {fileManagerPresent && (
                    <FileManager
                      key={fileManagerProps.tabId || "file-manager-empty"}
                      open={fileManagerOpen}
                      onClose={handleCloseFileManager}
                      tabId={fileManagerProps.tabId}
                      tabName={fileManagerProps.tabName}
                      sshConnection={fileManagerProps.sshConnection}
                      initialPath={fileManagerProps.initialPath}
                      navigationState={fileManagerProps.navigationState}
                      onPathChange={updateFileManagerPath}
                      onNavigationStateChange={updateFileManagerHistory}
                    />
                  )}
                </Box>

                {/* 添加快捷命令侧边栏 */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "shortcut" ? 104 : 95,
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {shortcutCommandsPresent && (
                    <ShortcutCommands
                      open={shortcutCommandsOpen}
                      onClose={handleCloseShortcutCommands}
                      onSendCommand={handleSendCommand}
                    />
                  )}
                </Box>

                {/* 添加历史命令侧边栏 */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "history" ? 105 : 94,
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {commandHistoryPresent && (
                    <CommandHistory
                      open={commandHistoryOpen}
                      onClose={handleCloseCommandHistory}
                      onSendCommand={handleSendCommand}
                    />
                  )}
                </Box>

                {/* 传输侧边栏已改为浮动窗口，移至底部与AI助手窗口同级 */}

                {/* IP地址查询侧边栏 */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "ipquery" ? 106 : 93,
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {ipAddressQueryPresent && (
                    <IPAddressQuery
                      open={ipAddressQueryOpen}
                      onClose={handleCloseIpAddressQuery}
                    />
                  )}
                </Box>

                {/* 随机密码生成器侧边栏 */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "password" ? 107 : 92,
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {securityToolsPresent && (
                    <SecurityTools
                      open={securityToolsOpen}
                      onClose={() => {
                        dispatch(actions.setSecurityToolsOpen(false));
                        setFallbackSidebarAfterClose("password");
                      }}
                    />
                  )}
                </Box>

                {/* 本地终端侧边栏 */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "localTerminal" ? 108 : 91,
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {localTerminalSidebarPresent && (
                    <LocalTerminalSidebar
                      open={localTerminalSidebarOpen}
                      onClose={handleCloseLocalTerminalSidebar}
                      onLaunchTerminal={handleLaunchLocalTerminal}
                    />
                  )}
                </Box>
              </Box>

              {/* 侧边栏按钮栏 */}
              <Paper
                elevation={3}
                square={true}
                sx={{
                  width: "48px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  py: 2,
                  gap: 2,
                  borderRadius: 0,
                  zIndex: 110,
                  flexShrink: 0,
                }}
              >
                {/* 主题切换按钮 */}
                <SidebarTooltip
                  title={t("sidebar.theme")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton onClick={toggleTheme} color="primary"
                    aria-label={t("sidebar.theme")}>
                    {darkMode ? <DarkModeIcon /> : <LightModeIcon />}
                  </IconButton>
                </SidebarTooltip>

                {/* 资源监控按钮 */}
                <SidebarTooltip
                  title={t("sidebar.monitor")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    color="primary"
                    onClick={toggleResourceMonitor}
                    sx={{
                      bgcolor: resourceMonitorOpen
                        ? "action.selected"
                        : "transparent",
                      "&:hover": {
                        bgcolor: resourceMonitorOpen
                          ? "action.selected"
                          : "action.hover",
                      },
                    }}
                  
                    aria-label={t("sidebar.monitor")}>
                    <MonitorHeartIcon />
                  </IconButton>
                </SidebarTooltip>

                {/* 连接管理按钮 */}
                <SidebarTooltip
                  title={t("sidebar.connections")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    color="primary"
                    onClick={toggleConnectionManager}
                    sx={{
                      bgcolor: connectionManagerOpen
                        ? "action.selected"
                        : "transparent",
                      "&:hover": {
                        bgcolor: connectionManagerOpen
                          ? "action.selected"
                          : "action.hover",
                      },
                    }}
                  
                    aria-label={t("sidebar.connections")}>
                    <LinkIcon />
                  </IconButton>
                </SidebarTooltip>

                {/* 文件管理按钮 */}
                <SidebarTooltip
                  title={
                    isFileManagerButtonDisabled
                      ? t("fileManager.errors.connectionNotReady")
                      : t("sidebar.files")
                  }
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    color="primary"
                    onClick={toggleFileManager}
                    sx={{
                      bgcolor: fileManagerOpen
                        ? "action.selected"
                        : "transparent",
                      "&:hover": {
                        bgcolor: fileManagerOpen
                          ? "action.selected"
                          : "action.hover",
                      },
                    }}
                    disabled={isFileManagerButtonDisabled}
                  
                    aria-label={t("sidebar.files")}>
                    <FolderIcon />
                  </IconButton>
                </SidebarTooltip>

                {/* 快捷命令按钮 - 应该放在文件按钮的后面 */}
                <SidebarTooltip
                  title={t("sidebar.shortcutCommands")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    color="primary"
                    onClick={toggleShortcutCommands}
                    sx={{
                      bgcolor: shortcutCommandsOpen
                        ? "action.selected"
                        : "transparent",
                      "&:hover": {
                        bgcolor: shortcutCommandsOpen
                          ? "action.selected"
                          : "action.hover",
                      },
                    }}
                    disabled={isSSHButtonDisabled}
                  
                    aria-label={t("sidebar.shortcutCommands")}>
                    <TerminalIcon />
                  </IconButton>
                </SidebarTooltip>

                {/* 历史命令按钮 */}
                <SidebarTooltip
                  title={t("sidebar.history")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    color="primary"
                    onClick={toggleCommandHistory}
                    sx={{
                      bgcolor: commandHistoryOpen
                        ? "action.selected"
                        : "transparent",
                      "&:hover": {
                        bgcolor: commandHistoryOpen
                          ? "action.selected"
                          : "action.hover",
                      },
                    }}
                  
                    aria-label={t("sidebar.history")}>
                    <HistoryIcon />
                  </IconButton>
                </SidebarTooltip>

                {/* IP地址查询按钮 */}
                <SidebarTooltip
                  title={t("sidebar.ipQuery")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    color="primary"
                    onClick={toggleIpAddressQuery}
                    sx={{
                      bgcolor: ipAddressQueryOpen
                        ? "action.selected"
                        : "transparent",
                      "&:hover": {
                        bgcolor: ipAddressQueryOpen
                          ? "action.selected"
                          : "action.hover",
                      },
                    }}
                  
                    aria-label={t("sidebar.ipQuery")}>
                    <PublicIcon />
                  </IconButton>
                </SidebarTooltip>

                {/* 安全工具按钮 */}
                <SidebarTooltip
                  title={t("sidebar.securityTool")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    color="primary"
                    onClick={toggleSecurityTools}
                    sx={{
                      bgcolor: securityToolsOpen
                        ? "action.selected"
                        : "transparent",
                      "&:hover": {
                        bgcolor: securityToolsOpen
                          ? "action.selected"
                          : "action.hover",
                      },
                    }}
                  
                    aria-label={t("sidebar.securityTool")}>
                    <VpnKeyIcon />
                  </IconButton>
                </SidebarTooltip>

                {/* 分隔符 */}
                <Box
                  sx={{
                    height: "1px",
                    width: "30px",
                    bgcolor: "divider",
                    my: 1,
                  }}
                />

                {/* 本地终端按钮 */}
                <SidebarTooltip
                  title={t("sidebar.localTerminal")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    color="primary"
                    onClick={toggleLocalTerminalSidebar}
                    sx={{
                      bgcolor: localTerminalSidebarOpen
                        ? "action.selected"
                        : "transparent",
                      "&:hover": {
                        bgcolor: localTerminalSidebarOpen
                          ? "action.selected"
                          : "action.hover",
                      },
                    }}
                  
                    aria-label={t("sidebar.localTerminal")}>
                    <ComputerIcon />
                  </IconButton>
                </SidebarTooltip>

                {/* 传输侧边栏按钮 - 仅在sidebar模式下显示 */}
                {transferBarMode === "sidebar" && (
                  <TransferSidebarButton
                    ref={transferSidebarButtonRef}
                    isOpen={transferSidebarOpen}
                    onClick={() => {
                      const newState = !transferSidebarOpen;
                      setTransferSidebarOpen(newState);
                      if (newState) {
                        setLastActiveFloatWindow("transfer");
                      }
                    }}
                    tooltipPlacement={sidebarTooltipPlacement}
                  />
                )}

                {/* AI助手按钮 */}
                <SidebarTooltip
                  title={
                    aiPanelOpen && aiApiReachable === false
                      ? t("sidebar.aiApiUnreachable")
                      : t("sidebar.ai")
                  }
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    ref={aiChatButtonRef}
                    color="primary"
                    onClick={handleToggleGlobalAiChatWindow}
                    sx={{
                      position: "relative",
                      bgcolor:
                        aiChatStatus === "visible"
                          ? "action.selected"
                          : "transparent",
                      "&:hover": {
                        bgcolor:
                          aiChatStatus === "visible"
                            ? "action.selected"
                            : "action.hover",
                      },
                    }}
                  
                    aria-label={aiPanelOpen && aiApiReachable === false
                      ? t("sidebar.aiApiUnreachable")
                      : t("sidebar.ai")}>
                    <AIIcon />
                    {aiPanelOpen && (
                      <Box
                        sx={{
                          position: "absolute",
                          top: 4,
                          right: 4,
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          bgcolor:
                            aiApiReachable === false ? "#f44336" : "#4caf50",
                          boxShadow:
                            aiApiReachable === false
                              ? "0 0 4px #f44336"
                              : "0 0 4px #4caf50",
                        }}
                      />
                    )}
                  </IconButton>
                </SidebarTooltip>

                <Box sx={{ flexGrow: 1 }} />

                {/* 侧边栏左右切换按钮 */}
                <SidebarTooltip
                  title={
                    sidebarPosition === "left"
                      ? t("sidebar.moveToRight")
                      : t("sidebar.moveToLeft")
                  }
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    color="primary"
                    onClick={handleToggleSidebarPosition}
                  
                    aria-label={sidebarPosition === "left"
                      ? t("sidebar.moveToRight")
                      : t("sidebar.moveToLeft")}>
                    {sidebarPosition === "left" ? (
                      <LastPageIcon />
                    ) : (
                      <FirstPageIcon />
                    )}
                  </IconButton>
                </SidebarTooltip>
              </Paper>
            </Box>
          </Box>

          {/* 全局传输底部栏 - 仅在bottom模式下显示 */}
          {transferBarMode === "bottom" && (
            <GlobalTransferBar
              onOpenFloat={handleOpenTransferFloat}
              onToggleFloat={handleToggleTransferFloat}
              isFloatOpen={transferFloatOpen}
            />
          )}
        </Box>
      </Box>

      {/* 全局AI聊天窗口 */}
      <AIChatWindow
        windowState={aiChatStatus}
        onClose={handleCloseGlobalAiChatWindow}
        onMinimize={handleMinimizeGlobalAiChatWindow}
        presetInput={aiInputPreset}
        onInputPresetUsed={() => dispatch(actions.setAiInputPreset(""))}
        connectionInfo={aiChatConnectionInfo}
        onExecuteCommand={handleSendCommand}
        zIndex={lastActiveFloatWindow === "ai" ? 1310 : 1300}
        onFocus={() => setLastActiveFloatWindow("ai")}
        anchorEl={aiChatButtonRef.current}
      />

      {/* 文件传输浮动窗口 - 仅在sidebar模式下显示 */}
      {transferBarMode === "sidebar" && (
        <TransferSidebar
          open={transferSidebarOpen}
          onClose={() => setTransferSidebarOpen(false)}
          zIndex={lastActiveFloatWindow === "transfer" ? 1310 : 1300}
          onFocus={() => setLastActiveFloatWindow("transfer")}
          anchorEl={transferSidebarButtonRef.current}
        />
      )}

      <FirstRunDialog
        open={firstRunDialogOpen}
        initialSettings={uiSettingsSnapshot}
        credentialSecurityStatus={credentialSecurityStatus}
        onComplete={handleFirstRunComplete}
      />

      {/* 关于对话框 */}
      <AboutDialog
        open={aboutDialogOpen}
        onClose={handleCloseAbout}
        checkUpdateSignal={aboutUpdateCheckSignal}
        onRemindLater={handleRemindUpdateLater}
      />

      {/* SSH 认证对话框 */}
      <SSHAuthDialog
        open={sshAuthDialogOpen}
        onClose={handleSSHAuthClose}
        onConfirm={handleSSHAuthConfirm}
        authData={sshAuthData}
        connectionConfig={sshAuthConnectionConfig}
      />

      {/* 设置对话框 */}
      <Settings open={settingsDialogOpen} onClose={handleCloseSettings} />

      <MasterPasswordOverlay
        open={
          credentialSecurityStatus.loading ||
          credentialSecurityStatus.requiresUnlock
        }
        loading={credentialSecurityStatus.loading}
        isSubmitting={unlockingCredentialStore}
        error={masterPasswordError}
        onUnlock={handleUnlockCredentialStore}
        onClose={handleExit}
      />

      {/* 错误通知 */}
      <ErrorNotification
        error={appError}
        open={errorNotificationOpen}
        onClose={handleCloseErrorNotification}
      />

      {/* 全局传输进度浮动窗口 */}
      <GlobalTransferFloat
        open={transferFloatOpen}
        onClose={handleCloseTransferFloat}
        onToggle={handleToggleTransferFloat}
        initialTransfer={transferFloatInitialTransfer}
      />
    </ThemeProvider>
  );
}

// 包装 App 组件，使用 AppProvider 提供全局状态
function App() {
  return (
    <AppProvider>
      <NotificationProvider>
        <AppContent />
      </NotificationProvider>
    </AppProvider>
  );
}

// 为 App 组件添加 memo 优化
const MemoizedApp = memo(App);
MemoizedApp.displayName = "App";

const root = createRoot(document.getElementById("root"));
root.render(
  <GlobalErrorBoundary>
    <MemoizedApp />
  </GlobalErrorBoundary>,
);
