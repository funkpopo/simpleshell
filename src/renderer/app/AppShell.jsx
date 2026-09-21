import AppMenu from "./components/AppMenu.jsx";
import SessionContextMenu from "./components/SessionContextMenu.jsx";
import useSidebarResize from "./hooks/useSidebarResize.js";
import useAppNotifications from "./hooks/useAppNotifications.js";
import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useSftpFollowSetting } from "../features/file-manager/hooks/useSftpFollowSetting.js";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import {
  useShellState,
  useAppStore,
  useAppDispatch,
  useTerminalSelector,
  useReconnectSelector,
} from "./state/AppContext.jsx";
import { actions } from "./state/appReducer.js";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tabs from "@mui/material/Tabs";
import AppsIcon from "@mui/icons-material/Apps";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import LinkIcon from "@mui/icons-material/Link";
import FolderIcon from "@mui/icons-material/Folder";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import AIIcon from "../features/ai/AIIcon.jsx";
import Tooltip from "@mui/material/Tooltip";
import SidebarTooltip from "../shared/ui/SidebarTooltip.jsx";
import Paper from "@mui/material/Paper";
import HistoryIcon from "@mui/icons-material/History";
import PublicIcon from "@mui/icons-material/Public";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import ComputerIcon from "@mui/icons-material/Computer";
import WelcomePage from "../features/welcome/WelcomePage.jsx";
import {
  AboutDialogWithSuspense as AboutDialog,
  ConnectionManagerWithSuspense as ConnectionManager,
  FileManagerWithSuspense as FileManager,
  FirstRunDialogWithSuspense as FirstRunDialog,
  ResourceMonitorWithSuspense as ResourceMonitor,
  IPAddressQueryWithSuspense as IPAddressQuery,
  SecurityToolsWithSuspense as SecurityTools,
  PortForwardingDialogWithSuspense as PortForwardingDialog,
  SettingsWithSuspense as Settings,
  CommandHistoryWithSuspense as CommandHistory,
  ShortcutCommandsWithSuspense as ShortcutCommands,
  LocalTerminalSidebarWithSuspense as LocalTerminalSidebar,
  smartPreload,
} from "./LazyComponents.jsx";
import TerminalIcon from "@mui/icons-material/Terminal";
import FirstPageIcon from "@mui/icons-material/FirstPage";
import LastPageIcon from "@mui/icons-material/LastPage";
import { sendCommandToActiveSession } from "../features/terminal/model/activeSessionActions.js";
import {
  SessionWorkspace,
  SessionAIChatWorkspace,
} from "./SessionWorkspace.jsx";
import SessionTab from "./SessionTab.jsx";
import PaneDropOverlay from "./PaneDropOverlay.jsx";
import { shallowEqual } from "./state/subscriptionStore.js";
import {
  getParentTabId,
  getFocusedSessionKey,
  isSessionFileManagerOpen,
  getSessionDescriptor,
  getSessionFileManagerProps,
  retainLiveSessionEntries,
  MAX_PANES,
} from "../features/terminal/model/paneLayout.js";
import NetworkLatencyIndicator from "../features/connections/NetworkLatencyIndicator.jsx";
import WindowControls from "./components/WindowControls.jsx";
import SSHAuthDialog from "../features/connections/SSHAuthDialog.jsx";
import MasterPasswordOverlay from "../features/security/MasterPasswordOverlay.jsx";
// Import i18n configuration
import { useTranslation } from "react-i18next";
import { SIDEBAR_WIDTHS } from "../shared/constants/layout.js";
import {
  sidebarRailButtonSx,
  sidebarRailDividerSx,
} from "../shared/ui/sidebarItemStyles";
import { findGroupByTab } from "../features/terminal/model/syncInputGroups";
import { useCleanupManager } from "../shared/hooks/useAutoCleanup.js";
import {
  openLogDirectory,
  exportDiagnostics,
  openFeedbackIssue,
} from "../features/diagnostics/diagnosticsActions.js";
import ErrorNotification from "../shared/ui/ErrorNotification.jsx";
import GlobalTransferBar from "../features/transfers/GlobalTransferBar.jsx";
import GlobalTransferFloat from "../features/transfers/GlobalTransferFloat.jsx";
import TransferSidebar from "../features/transfers/TransferSidebar.jsx";
import { applySftpTransferState } from "../features/transfers/state/globalTransferStore.js";
import TransferSidebarButton from "../features/transfers/TransferSidebarButton.jsx";
import { useNotification } from "../shared/notifications/NotificationContext.jsx";
import {
  disposeTerminalSession,
  getTerminalSessionDiagnostics,
  processCache as sessionProcessCache,
} from "../features/terminal/runtime/terminalSessionStore.js";
import useCredentialSecurity from "./hooks/useCredentialSecurity.js";
import useSSHAuthentication from "./hooks/useSSHAuthentication.js";
import useReconnect from "./hooks/useReconnect.js";
import useAppTheme from "./hooks/useAppTheme.js";
import {
  UPDATE_REMINDER_STORAGE_KEY,
  UPDATE_REMINDER_DELAY_MS,
  intentPreloadProps,
  notifyTerminalResize,
  useDelayedPresence,
  resolveRecentConnection,
  areFileManagerHistoryStatesEqual,
  syncTerminalInstanceConfigs,
  normalizeRecentConnections,
  buildRecentConnectionsSignature,
  normalizeSidebarWidth,
} from "./appShellUtils.js";
export default function AppShell() {
  const LATENCY_INFO_MIN_WIDTH = 150;
  const { t, i18n } = useTranslation();
  const eventManager = useCleanupManager(); // 使用统一的事件管理器
  const { showError, showInfo, showSuccess, showWarning } = useNotification();

  // 使用全局状态和 dispatch
  const state = useShellState();
  const appStore = useAppStore();
  const dispatch = useAppDispatch();

  // 错误处理状态（保持本地，因为不需要全局共享）
  const {
    credentialSecurityStatus,
    masterPasswordError,
    unlockingCredentialStore,
    handleUnlockCredentialStore,
    handleLockApp,
  } = useCredentialSecurity();
  const {
    uiSettingsSnapshot,
    setUiSettingsSnapshot,
    uiSettingsLoaded,
    darkMode,
    themeLoading,
    dndEnabled,
    transferBarMode,
    sidebarPosition,
    setSidebarPosition,
    sidebarWidth,
    setSidebarWidth,
    theme,
    toggleTheme,
  } = useAppTheme();
  const { appError, errorNotificationOpen, handleCloseErrorNotification } =
    useAppNotifications({ showSuccess, t });
  const [connectionsLoaded, setConnectionsLoaded] = React.useState(false);
  const [firstRunDialogOpen, setFirstRunDialogOpen] = React.useState(false);
  const [createConnectionSignal, setCreateConnectionSignal] = React.useState(0);

  // SSH 认证对话框状态

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

  // Update the tabs when language changes
  React.useEffect(() => {
    // Update welcome tab label when language changes
    // 只在语言改变时更新，不依赖 tabs
    if (tabs.length > 0 && tabs[0].id === "welcome") {
      const newLabel = t("terminal.welcome");
      if (tabs[0].label !== newLabel) {
        dispatch(
          actions.setTabs([
            {
              ...tabs[0],
              label: newLabel,
            },
            ...tabs.slice(1),
          ]),
        );
      }
    }
  }, [i18n.language, t, dispatch]); // 移除 state.tabs 依赖

  // 加载主题设置

  // ============ 从全局状态读取 ============
  const tabs = state.tabs;
  const syncGroups = state.syncGroups;
  const latestTabsForActionsRef = useRef(tabs);
  latestTabsForActionsRef.current = tabs;
  const currentTab = state.currentTab;
  const connectionManagerOpen = state.connectionManagerOpen;
  const resourceMonitorRequested = state.resourceMonitorOpen;
  const fileManagerOpenByTabId = state.fileManagerOpenByTabId;
  const ipAddressQueryOpen = state.ipAddressQueryOpen;
  const securityToolsOpen = state.securityToolsOpen;
  const portForwardingOpen = state.portForwardingOpen;
  const shortcutCommandsOpen = state.shortcutCommandsOpen;
  const commandHistoryOpen = state.commandHistoryOpen;
  const activeSidebarMargin = state.activeSidebarMargin;
  const lastOpenedSidebar = state.lastOpenedSidebar;
  const aboutDialogOpen = state.aboutDialogOpen;
  const settingsDialogOpen = state.settingsDialogOpen;
  const tabContextMenu = state.tabContextMenu;
  const connections = state.connections;
  const topConnections = state.topConnections;
  const fileManagerPaths = state.fileManagerPaths;
  const aiChatStatus = state.aiChatStatus;
  const aiInputPreset = state.aiInputPreset;
  const splitLayouts = state.splitLayouts;
  const paneRegistry = state.panes;
  const anchorEl = state.anchorEl;
  const open = Boolean(anchorEl);

  // 当前面板标签页（侧边栏跟随当前标签页）
  const currentPanelTab =
    currentTab > 0 && tabs[currentTab] ? tabs[currentTab] : null;
  // 分屏时会话键跟随聚焦窗格：侧边栏（资源监控/文件管理/AI/会话上下文）
  // 展示聚焦窗格的连接信息；无分屏时等于 tabId
  const activeSessionKey = getFocusedSessionKey(state);
  const sessionActionStateRef = useMemo(
    () => ({
      get current() {
        return appStore.getState();
      },
    }),
    [appStore],
  );
  const connectionsRef = React.useRef(connections);
  const topConnectionsRef = React.useRef(topConnections);
  const terminalInstancesRef = useMemo(
    () => ({
      get current() {
        return appStore.getState().terminalInstances;
      },
    }),
    [appStore],
  );
  const {
    markSessionConnecting,
    liveSessionKeys,
    liveSessionKeysRef,
    clearReconnectAction,
    clearReconnectStatus,
    loadTabConnectionStatus,
    loadReconnectStatus,
    handlePauseReconnect: handlePauseReconnectForTab,
    handleResumeReconnect: handleResumeReconnectForTab,
  } = useReconnect({
    tabs,
    splitLayouts,
  });
  const activeTerminal = useTerminalSelector(
    (instances) => ({
      config: instances[`${activeSessionKey}-config`],
      processId: instances[`${activeSessionKey}-processId`],
    }),
    shallowEqual,
  );
  const activeConnectionStatus = useReconnectSelector(
    (status) => status.connectionStatusByTabId[activeSessionKey],
  );
  const activeSession = useMemo(
    () =>
      getSessionDescriptor(
        {
          ...state,
          terminalInstances: {
            [`${activeSessionKey}-config`]: activeTerminal.config,
            [`${activeSessionKey}-processId`]: activeTerminal.processId,
          },
        },
        activeSessionKey,
        { [activeSessionKey]: activeConnectionStatus },
        sessionProcessCache,
      ),
    [
      tabs,
      paneRegistry,
      activeSessionKey,
      activeTerminal,
      activeConnectionStatus,
    ],
  );
  const canMonitorCurrentSession =
    !activeSession ||
    activeSession.type === "local" ||
    (activeSession.type === "ssh" && Boolean(activeSession.processId));
  const resourceMonitorOpen =
    resourceMonitorRequested && canMonitorCurrentSession;
  const fileManagerOpen = isSessionFileManagerOpen(state, activeSession);
  const {
    sshAuthDialogOpen,
    sshAuthData,
    sshAuthConnectionConfig,
    handleSSHAuthConfirm,
    handleSSHAuthClose,
  } = useSSHAuthentication({
    connectionsRef,
    terminalInstancesRef,
    dispatch,
    liveSessionKeysRef,
    liveSessionKeys,
  });
  React.useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);
  React.useEffect(() => {
    topConnectionsRef.current = topConnections;
  }, [topConnections]);
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

  // 文件管理侧边栏的导航历史：按标签页独立记忆
  const [fileManagerHistoryByTabId, setFileManagerHistoryByTabId] = useState(
    {},
  );
  const [diskAlertsByTabId, setDiskAlertsByTabId] = React.useState({});
  // 磁盘空间告警：更新标签页告警状态并弹出通知（主进程仅在状态变化时推送）
  React.useEffect(() => {
    if (!window.terminalAPI?.onDiskAlertEvent) return undefined;
    const formatMounts = (mounts = []) =>
      Array.isArray(mounts)
        ? mounts.map((m) => `${m.mount} ${m.usedPercent}%`).join(", ")
        : "";
    const formatHost = (payload) =>
      payload.isLocal ? t("diskAlert.localHost") : payload.host || "SSH";
    const handleDiskAlertEvent = (payload) => {
      if (!payload || !payload.targetKey) return;
      if (payload.kind === "alert") {
        if (payload.tabId) {
          const tabKey = String(payload.tabId);
          setDiskAlertsByTabId((previous) => ({
            ...previous,
            [tabKey]: {
              host: payload.host,
              isLocal: payload.isLocal === true,
              threshold: payload.threshold,
              mounts: Array.isArray(payload.mounts) ? payload.mounts : [],
              updatedAt: payload.timestamp || Date.now(),
            },
          }));
        }
        showWarning(
          t("diskAlert.alertToast", {
            host: formatHost(payload),
            mounts: formatMounts(payload.mounts),
          }),
        );
      } else if (payload.kind === "clear") {
        if (payload.tabId) {
          const tabKey = String(payload.tabId);
          setDiskAlertsByTabId((previous) => {
            if (!previous[tabKey]) return previous;
            const next = {
              ...previous,
            };
            delete next[tabKey];
            return next;
          });
        }
        showInfo(
          t("diskAlert.clearToast", {
            host: formatHost(payload),
            mounts: formatMounts(payload.mounts),
          }),
        );
      }
    };
    return window.terminalAPI.onDiskAlertEvent(handleDiskAlertEvent);
  }, [t, showWarning, showInfo]);

  // 监听 SSH 认证请求

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
  const portForwardingPresent = useDelayedPresence(portForwardingOpen);
  const localTerminalSidebarPresent = useDelayedPresence(
    localTerminalSidebarOpen,
  );
  const [transferFloatOpen, setTransferFloatOpen] = React.useState(false);
  const [transferFloatInitialTransfer, setTransferFloatInitialTransfer] =
    React.useState(null);
  const sftpFollowTerminalDirectory = useSftpFollowSetting();
  // 侧边栏位置: "left" | "right"

  // 传输侧边栏状态
  const [transferSidebarOpen, setTransferSidebarOpen] = React.useState(false);
  const [resumableTransferCount, setResumableTransferCount] = React.useState(0);
  React.useEffect(
    () => window.terminalAPI.onSftpTransferState(applySftpTransferState),
    [],
  );
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
        ["forwarding", portForwardingOpen],
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
      portForwardingOpen,
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

  // 侧边栏 toggle/close 的公共逻辑：更新开关状态、维护 lastOpenedSidebar、
  // 触发 resize 让终端适配布局（notifyResize 可关闭）。
  // 不互斥关闭：多侧栏可同时 open，后打开的以 z-index 覆盖先打开的。
  const runSidebarToggle = React.useCallback(
    (isOpen, setOpen, sidebarKey, { notifyResize = true } = {}) => {
      const willOpen = !isOpen;
      setOpen(willOpen);
      if (willOpen) {
        dispatch(actions.setLastOpenedSidebar(sidebarKey));
      } else {
        setFallbackSidebarAfterClose(sidebarKey);
      }
      if (notifyResize) {
        notifyTerminalResize();
      }
    },
    [dispatch, setFallbackSidebarAfterClose],
  );
  const runSidebarClose = React.useCallback(
    (setOpen, sidebarKey, { notifyResize = true } = {}) => {
      setOpen(false);
      setFallbackSidebarAfterClose(sidebarKey);
      if (notifyResize) {
        notifyTerminalResize();
      }
    },
    [setFallbackSidebarAfterClose],
  );
  const contextMenuTab =
    tabContextMenu.tabIndex !== null &&
    tabContextMenu.tabIndex >= 0 &&
    tabContextMenu.tabIndex < tabs.length
      ? tabs[tabContextMenu.tabIndex]
      : null;
  const { sidebarResizing, handleSidebarResizeStart } = useSidebarResize({
    sidebarWidth,
    sidebarPosition,
    setSidebarWidth,
    setUiSettingsSnapshot,
  });
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
      {
        passive: false,
      },
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
    const getSidebarWidth = () => {
      const isSidebarOpen = {
        resource: resourceMonitorOpen,
        connection: connectionManagerOpen,
        file: fileManagerOpen,
        shortcut: shortcutCommandsOpen,
        history: commandHistoryOpen,
        ipquery: ipAddressQueryOpen,
        password: securityToolsOpen,
        forwarding: portForwardingOpen,
        localTerminal: localTerminalSidebarOpen,
      };
      const activeSidebar = isSidebarOpen[lastOpenedSidebar]
        ? lastOpenedSidebar
        : findFallbackSidebar(null);
      if (
        (resourceMonitorOpen && activeSidebar === "resource") ||
        (connectionManagerOpen && activeSidebar === "connection") ||
        (fileManagerOpen && activeSidebar === "file") ||
        (shortcutCommandsOpen && activeSidebar === "shortcut") ||
        (commandHistoryOpen && activeSidebar === "history") ||
        (ipAddressQueryOpen && activeSidebar === "ipquery") ||
        (securityToolsOpen && activeSidebar === "password") ||
        (portForwardingOpen && activeSidebar === "forwarding") ||
        (localTerminalSidebarOpen && activeSidebar === "localTerminal")
      ) {
        return sidebarWidth;
      }
      return 0;
    };
    const activeSidebarWidth = getSidebarWidth();
    let calculatedMargin;
    // 始终为右侧按钮栏预留空间，即使没有侧边栏开启
    calculatedMargin = SIDEBAR_WIDTHS.SIDEBAR_BUTTONS_WIDTH;
    if (activeSidebarWidth > 0) {
      calculatedMargin =
        activeSidebarWidth +
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
              sidebarWidth: activeSidebarWidth,
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
    portForwardingOpen,
    securityToolsOpen,
    localTerminalSidebarOpen,
    lastOpenedSidebar,
    sidebarPosition,
    sidebarWidth,
    SIDEBAR_WIDTHS,
    findFallbackSidebar,
  ]);
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

  // 应用启动时注册事件监听
  React.useEffect(() => {
    // 添加监听器，接收终端进程ID更新事件
    const handleTerminalProcessIdUpdate = (event) => {
      const { terminalId, processId } = event.detail;
      if (terminalId && processId) {
        // 更新终端实例中的进程ID
        // 注：进程 ID 的唯一来源是 terminalSessionStore.processCache，
        // 此处只同步 terminalInstances 供 UI 查询
        dispatch(
          actions.setTerminalInstances({
            ...terminalInstancesRef.current,
            [`${terminalId}-processId`]: processId,
          }),
        );
      }
    };
    const removeTerminalListener = eventManager.addEventListener(
      window,
      "terminalProcessIdUpdated",
      handleTerminalProcessIdUpdate,
    );
    return () => {
      removeTerminalListener();
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

  // 创建动态主题

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
    await openLogDirectory({
      t,
      showSuccess,
      showError,
    });
  }, [dispatch, showError, showSuccess, t]);
  const handleExportDiagnostics = useCallback(async () => {
    dispatch(actions.setAnchorEl(null));
    await exportDiagnostics({
      t,
      showSuccess,
      showError,
    });
  }, [dispatch, showError, showSuccess, t]);
  const handleOpenFeedbackIssue = useCallback(async () => {
    dispatch(actions.setAnchorEl(null));
    await openFeedbackIssue({
      t,
      showSuccess,
      showError,
      source: "main-menu",
      confirmButtonLabel: t("menu.feedback"),
    });
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

  const handleToggleSidebarPosition = useCallback(async () => {
    const nextPosition = sidebarPosition === "left" ? "right" : "left";
    setSidebarPosition(nextPosition);
    if (!window.terminalAPI?.saveUISettings) {
      return;
    }
    try {
      let currentSettings = {
        language: "zh-CN",
        fontSize: 14,
      };
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

      // 文件管理侧边栏状态已按标签页独立存储，切换标签页时
      // 各标签页恢复各自的开关状态，无需额外的锁定/同步逻辑

      // 触发自定义事件，通知WebTerminal组件进行大小调整
      if (newValue < tabs.length) {
        const currentTabId = tabs[newValue]?.id;
        if (currentTabId) {
          // 使用自定义事件通知特定标签页的WebTerminal组件
          window.dispatchEvent(
            new CustomEvent("tabChanged", {
              detail: {
                tabId: currentTabId,
                index: newValue,
              },
            }),
          );

          // 触发窗口resize事件，作为备用机制确保布局更新
          notifyTerminalResize(100);
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

  // 刷新指定会话，同时支持独立标签和分屏窗格。
  const refreshingTerminalSessionsRef = useRef(new Set());
  const refreshTerminalSession = async (sessionKey) => {
    if (
      !liveSessionKeysRef.current.has(sessionKey) ||
      refreshingTerminalSessionsRef.current.has(sessionKey)
    )
      return;
    refreshingTerminalSessionsRef.current.add(sessionKey);
    try {
      clearReconnectStatus(sessionKey);
      clearReconnectAction(sessionKey);
      const parentTabId = getParentTabId(sessionKey, paneRegistryRef.current);
      dispatch(actions.setResourceMonitorOpen(false));
      dispatch(actions.setFileManagerOpenForTab(parentTabId, false));
      dispatch(actions.setIpAddressQueryOpen(false));
      try {
        const processId = sessionProcessCache[sessionKey];
        if (processId && window.terminalAPI?.cleanupConnection) {
          await window.terminalAPI.cleanupConnection(processId);
        }
      } catch (cleanupError) {
        console.warn("Connection cleanup failed:", cleanupError);
      }
      if (!liveSessionKeysRef.current.has(sessionKey)) return;
      dispatch(actions.updateTerminalInstance(sessionKey, undefined));
      dispatch(actions.updateTerminalInstance(sessionKey, true));
      dispatch(
        actions.updateTerminalInstance(`${sessionKey}-refresh`, Date.now()),
      );
    } finally {
      refreshingTerminalSessionsRef.current.delete(sessionKey);
    }
  };
  const handleRefreshTerminal = async () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null && tabIndex < tabs.length) {
      await refreshTerminalSession(tabs[tabIndex].id);
    }
    handleTabContextMenuClose();
  };

  // 切换连接管理侧边栏
  const toggleConnectionManager = useCallback(() => {
    runSidebarToggle(
      connectionManagerOpen,
      (open) => dispatch(actions.setConnectionManagerOpen(open)),
      "connection",
    );
  }, [connectionManagerOpen, dispatch, runSidebarToggle]);

  // 关闭连接管理侧边栏
  const handleCloseConnectionManager = useCallback(() => {
    runSidebarClose(
      (open) => dispatch(actions.setConnectionManagerOpen(open)),
      "connection",
      {
        notifyResize: false,
      },
    );
  }, [dispatch, runSidebarClose]);
  const handleRequestCreateConnection = useCallback(() => {
    dispatch(actions.setConnectionManagerOpen(true));
    dispatch(actions.setLastOpenedSidebar("connection"));
    setCreateConnectionSignal(Date.now());
    notifyTerminalResize();
  }, [dispatch]);

  // 关闭终端连接
  const handleCloseConnection = () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null) {
      handleCloseTab(tabIndex);
    }
    handleTabContextMenuClose();
  };

  // 拆分恢复：把并入分屏的标签页还原为独立标签页。
  // 窗格会话继续沿用原 tabId（sessionKey），终端实例/配置/进程缓存全部保留，
  // 仅销毁布局，不触碰任何终端内容，因此拆分前后显示内容不变。
  const handleUnsplitTab = useCallback(() => {
    const tabId = tabContextMenu.tabId;
    if (!tabId) {
      handleTabContextMenuClose();
      return;
    }
    const layout = splitLayoutsRef.current[tabId];
    if (!layout || (layout.panes || []).length <= 1) {
      handleTabContextMenuClose();
      return;
    }
    const currentTabs = latestTabsForActionsRef.current;
    const rootIndex = currentTabs.findIndex((item) => item.id === tabId);
    if (rootIndex < 0) {
      handleTabContextMenuClose();
      return;
    }
    dispatch(actions.unsplitTab(tabId));
    notifyTerminalResize();
    handleTabContextMenuClose();
  }, [
    dispatch,
    handleTabContextMenuClose,
    notifyTerminalResize,
    paneRegistry,
    tabContextMenu.tabId,
  ]);
  // 创建远程连接（SSH或Telnet）
  const handleCreateSSHConnection = useCallback(
    (connection) => {
      // 创建唯一的标签页ID
      const terminalId = `${connection.protocol || "ssh"}-${Date.now()}`;

      // 创建标签名（使用连接配置中的名称）
      const protocol =
        connection.protocol === "telnet"
          ? "Telnet"
          : connection.protocol === "serial"
            ? "Serial"
            : connection.protocol === "mosh"
              ? "Mosh"
              : "SSH";
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
          ...appStore.getState().terminalInstances,
          [terminalId]: true,
          [`${terminalId}-config`]: connectionConfigWithTabId,
          // 将完整的连接配置存储在缓存中
          [`${terminalId}-processId`]: null, // 预留存储进程ID的位置
        }),
      );

      // 添加标签并立即切换到新标签（使用当前tabs长度作为新索引）
      const newTabs = [...tabs, newTab];
      dispatch(actions.setTabs(newTabs));
      dispatch(actions.setCurrentTab(newTabs.length - 1));
      if ((connection.protocol || "ssh") === "ssh") {
        markSessionConnecting(terminalId, connection);
      }
    },
    [tabs, appStore, dispatch],
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
    const processId = sessionProcessCache[tabToRemove.id];
    if (
      processId &&
      (tabToRemove.type === "ssh" ||
        tabToRemove.type === "telnet" ||
        tabToRemove.type === "serial" ||
        tabToRemove.type === "mosh" ||
        tabToRemove.type === "local")
    ) {
      window.terminalAPI.killProcess(processId).catch((err) => {
        console.warn(`关闭连接时出错: ${err.message}`);
      });
    } else if (tabToRemove.type === "local") {
      window.terminalAPI.closeLocalTerminal?.(tabToRemove.id).catch((err) => {
        console.warn(`关闭本地终端时出错: ${err.message}`);
      });
    }

    // Release renderer-owned xterm/addon/listener/mailbox caches immediately.
    // The WebTerminal unmount cleanup calls the same idempotent path as a
    // safety net, but doing it here prevents output from reaching a closed tab
    // while React is committing the state update.
    const diagnosticsBeforeClose =
      process.env.NODE_ENV === "development"
        ? getTerminalSessionDiagnostics()
        : null;
    disposeTerminalSession(tabToRemove.id);
    if (process.env.NODE_ENV === "development") {
      const diagnosticsAfterClose = getTerminalSessionDiagnostics();
      const hadCachedTerminal = diagnosticsBeforeClose.terminalIds.includes(
        tabToRemove.id,
      );
      console.assert(
        !diagnosticsAfterClose.terminalIds.includes(tabToRemove.id) &&
          (!hadCachedTerminal ||
            diagnosticsAfterClose.terminalCount <
              diagnosticsBeforeClose.terminalCount),
        `[App] terminal cache count did not decrease after closing tabId=${tabToRemove.id}`,
        diagnosticsAfterClose,
      );
    }

    // 清理被关闭标签页的文件管理侧边栏状态（状态按标签页独立存储，
    // 不影响其他标签页各自的开关状态）
    if (fileManagerOpenByTabId[tabToRemove.id]) {
      dispatch(actions.setFileManagerOpenForTab(tabToRemove.id, false));
      if (fileManagerOpen) {
        setFallbackSidebarAfterClose("file");
      }
    }

    // 检查资源监控是否为该标签页打开，如果是则关闭它
    if (
      resourceMonitorOpen &&
      currentPanelTab &&
      currentPanelTab.id === tabToRemove.id
    ) {
      dispatch(actions.setResourceMonitorOpen(false));
    }

    // 分屏窗格：整组窗格随 tab 一并关闭（逐个结束会话并清理实例缓存）。
    // 被拖入的窗格（adoptedFromTab）的 sessionKey 是原 tabId，同理清理。
    const closingLayout = splitLayouts[tabToRemove.id];
    if (closingLayout?.panes) {
      closingLayout.panes.forEach((paneId) => {
        if (paneId === tabToRemove.id) return;
        const paneProcessId = sessionProcessCache[paneId];
        if (paneProcessId && window.terminalAPI?.killProcess) {
          window.terminalAPI.killProcess(paneProcessId).catch((err) => {
            console.warn(`关闭窗格会话时出错: ${err.message}`);
          });
        }
        disposeTerminalSession(paneId);
        // 同步分组中的窗格成员一并移除
        dispatch(actions.removeTabFromSyncGroups(paneId));
      });
      dispatch(actions.resetTabLayout(tabToRemove.id));
    }
    dispatch(actions.forgetSessions(closingLayout?.panes ?? [tabToRemove.id]));
    // 注：进程缓存（terminalSessionStore.processCache）已由上方
    // disposeTerminalSession(tabToRemove.id) 统一清理，无需在此重复处理。

    // 清理文件管理路径记忆
    setFileManagerHistoryByTabId((previous) => {
      if (!previous[tabToRemove.id]) {
        return previous;
      }
      const next = {
        ...previous,
      };
      delete next[tabToRemove.id];
      return next;
    });
    clearReconnectStatus(tabToRemove.id);
    clearReconnectAction(tabToRemove.id);

    // 同步输入分组：将该标签从所属分组中移除；若为组内最后一个成员，
    // 分组自动回收（由 reducer 完成）
    dispatch(actions.removeTabFromSyncGroups(tabToRemove.id));
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

  // ------------------ 分屏终端（PaneGrid）管理 ------------------

  const splitLayoutsRef = useRef(splitLayouts);
  splitLayoutsRef.current = splitLayouts;
  const paneRegistryRef = useRef(paneRegistry);
  paneRegistryRef.current = paneRegistry;
  // 拖拽投隆区（'left'|'right'|'top'|'bottom'|'center'|null）与窗格拖拽状态
  const setPaneDropZone = useCallback(
    (zone) => dispatch(actions.setPaneDropZone(zone)),
    [dispatch],
  );
  const setPaneDragId = useCallback(
    (id) => dispatch(actions.setPaneDragId(id)),
    [dispatch],
  );
  const setPaneDragOverId = useCallback(
    (id) => dispatch(actions.setPaneDragOverId(id)),
    [dispatch],
  );

  // 会话清理按键执行；状态删除交给 reducer，批量关闭不会复活前一项缓存。
  const teardownPaneSession = useCallback(
    (paneId) => {
      const processId = sessionProcessCache[paneId];
      if (processId)
        window.terminalAPI
          .killProcess(processId)
          .catch((error) => console.warn(error));
      disposeTerminalSession(paneId);
      dispatch(actions.forgetSessions([paneId]));
    },
    [dispatch],
  );
  const cleanupDragStateRef = useRef(null);

  // 关闭仅作用于指定会话；移除根窗格时 reducer 提升存活窗格为宿主。
  const handleClosePane = useCallback(
    (tabId, paneId) => {
      const layout = splitLayoutsRef.current[tabId];
      if (!layout) {
        const index = latestTabsForActionsRef.current.findIndex(
          (tab) => tab.id === tabId,
        );
        if (index >= 0 && tabId === paneId) handleCloseTabRef.current(index);
        return;
      }
      if (!layout.panes.includes(paneId)) return;
      dispatch(actions.removePane(tabId, paneId));
      teardownPaneSession(paneId);
      notifyTerminalResize();
    },
    [dispatch, teardownPaneSession],
  );
  const handleCloseOtherPanes = useCallback(
    (tabId, paneId) => {
      const layout = splitLayoutsRef.current[tabId];
      if (!layout?.panes.includes(paneId)) return;
      // 根窗格最后移除，使前面的删除始终使用同一宿主。
      const closing = layout.panes.filter(
        (id) => id !== paneId && id !== tabId,
      );
      if (paneId !== tabId) closing.push(tabId);
      closing.forEach((id) => {
        dispatch(actions.removePane(tabId, id));
        teardownPaneSession(id);
      });
      notifyTerminalResize();
    },
    [dispatch, teardownPaneSession],
  );
  const handleFocusPane = useCallback(
    (tabId, paneId) => {
      dispatch(actions.focusPane(tabId, paneId));
    },
    [dispatch],
  );
  const handleSetRatios = useCallback(
    (tabId, ratios) => {
      dispatch(actions.setRatios(tabId, ratios));
    },
    [dispatch],
  );

  // 将一个已有标签页会话并入目标 tab 的分屏（拖拽标签页到终端区）。
  // 采用"标签保留会话、布局引用"方案：窗格继续使用原 tabId 作为
  // sessionKey，无需迁移渲染端缓存与主进程连接别名；原标签从标签栏移除。
  const adoptTabAsPane = useCallback(
    (targetTabId, sourceTab, zone) => {
      if (!targetTabId || !sourceTab || sourceTab.id === targetTabId) return;
      if (sourceTab.id === "welcome") return;
      const targetLayout = splitLayoutsRef.current[targetTabId] || null;
      const currentPanes = targetLayout
        ? [...targetLayout.panes]
        : [targetTabId];
      if (currentPanes.includes(sourceTab.id)) return;
      if (currentPanes.length >= MAX_PANES) {
        showWarning(t("terminal.pane.maxReached"));
        return;
      }
      if (splitLayoutsRef.current[sourceTab.id]) {
        showWarning(t("terminal.pane.splitSourceBlocked"));
        return;
      }
      dispatch(actions.adoptTab(targetTabId, sourceTab.id, zone));
      notifyTerminalResize();
    },
    [currentTab, dispatch, showWarning, t],
  );

  // 终端区拖拽投隆：标签页拖入边缘 / 中心 → 并入当前 tab 的分屏
  const handleTerminalAreaDragOver = useCallback(
    (e) => {
      const { draggedTabIndex, paneDropZone } = appStore.getState();
      if (draggedTabIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const edge = 0.25;
      let zone = "center";
      if (relX < edge) zone = "left";
      else if (relX > 1 - edge) zone = "right";
      else if (relY < edge) zone = "top";
      else if (relY > 1 - edge) zone = "bottom";
      if (paneDropZone !== zone) {
        setPaneDropZone(zone);
      }
    },
    [appStore, setPaneDropZone],
  );
  const handleTerminalAreaDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setPaneDropZone(null);
    }
  }, []);
  const handleTerminalAreaDrop = useCallback(
    (e) => {
      e.preventDefault();
      const { draggedTabIndex, paneDropZone } = appStore.getState();
      const zone = paneDropZone || "center";
      setPaneDropZone(null);
      if (draggedTabIndex === null) return;
      const sourceTab = latestTabsForActionsRef.current[draggedTabIndex];
      const targetTab = latestTabsForActionsRef.current[currentTab];
      cleanupDragStateRef.current?.();
      if (!sourceTab || !targetTab || sourceTab.id === targetTab.id) return;
      if (sourceTab.id === "welcome" || targetTab.id === "welcome") return;
      adoptTabAsPane(targetTab.id, sourceTab, zone);
    },
    [adoptTabAsPane, currentTab, appStore, setPaneDropZone],
  );

  // 窗格头部拖拽（交换位置）
  const handlePaneDragStart = useCallback((e, paneId) => {
    setPaneDragId(paneId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({
        type: "pane",
        paneId,
      }),
    );
  }, []);
  const handlePaneDragOver = useCallback(
    (e, paneId) => {
      const { paneDragId, paneDragOverId } = appStore.getState();
      if (paneDragId === null || paneDragId === paneId) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (paneDragOverId !== paneId) {
        setPaneDragOverId(paneId);
      }
    },
    [appStore, setPaneDragOverId],
  );
  const handlePaneDrop = useCallback(
    (e, targetPaneId) => {
      const { paneDragId } = appStore.getState();
      if (paneDragId === null || paneDragId === targetPaneId) return;
      e.preventDefault();
      e.stopPropagation();
      const sourceSessionKey = paneDragId;
      setPaneDragId(null);
      setPaneDragOverId(null);
      const tabId = getParentTabId(sourceSessionKey, paneRegistryRef.current);
      dispatch(actions.swapPanes(tabId, sourceSessionKey, targetPaneId));
      notifyTerminalResize();
    },
    [dispatch, appStore, setPaneDragId, setPaneDragOverId],
  );
  const handlePaneDragEnd = useCallback(() => {
    setPaneDragId(null);
    setPaneDragOverId(null);
  }, []);

  // 窗格右键菜单动作（WebTerminalContextMenu 经 CustomEvent 投递，
  // 避免把 dispatch 拉进终端组件）
  const handlePaneShortcutRef = useRef(() => {});
  handlePaneShortcutRef.current = (action) => {
    const tab = latestTabsForActionsRef.current[currentTab];
    if (!tab || tab.id === "welcome") return;
    const layout = splitLayoutsRef.current[tab.id];
    const sessionKey = layout?.focusedPaneId || tab.id;
    if (action === "close") {
      handleClosePane(tab.id, sessionKey);
    }
  };
  const paneActionHandlerRef = useRef(() => {});
  paneActionHandlerRef.current = (detail) => {
    if (!detail?.sessionKey) return;
    const tabId = getParentTabId(detail.sessionKey, paneRegistryRef.current);
    switch (detail.action) {
      case "closePane":
        handleClosePane(tabId, detail.sessionKey);
        break;
      case "closeOtherPanes":
        handleCloseOtherPanes(tabId, detail.sessionKey);
        break;
      case "reconnect":
        void refreshTerminalSession(detail.sessionKey);
        break;
      case "createSyncGroup":
        dispatch(actions.createSyncGroup(detail.sessionKey));
        break;
      case "joinSyncGroup":
        if (detail.groupId) {
          dispatch(actions.joinSyncGroup(detail.sessionKey, detail.groupId));
        }
        break;
      case "leaveSyncGroup":
        dispatch(actions.removeTabFromSyncGroups(detail.sessionKey));
        break;
      default:
        break;
    }
  };

  // ------------------ 分屏终端管理结束 ------------------

  // 窗格右键菜单动作事件（由 WebTerminalContextMenu 发出）
  React.useEffect(() => {
    const handler = (event) => paneActionHandlerRef.current(event.detail);
    const remove = eventManager.addEventListener(
      window,
      "terminalPaneAction",
      handler,
    );
    return () => remove();
  }, [eventManager]);

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
      const { draggedTabIndex, dragOverTabIndex } = appStore.getState();
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
      // 两侧 30% 为排序插入区（before/after），中段为「叠加合并」区：
      // 拖拽标签页叠加到目标标签上，合并为目标标签的分屏窗格
      const relX = tabWidth > 0 ? mouseX / tabWidth : 0.5;
      const position = relX < 0.3 ? "before" : relX > 0.7 ? "after" : "merge";
      e.dataTransfer.dropEffect = "move";

      // 记录待更新状态
      pendingDragStateRef.current = {
        index,
        position,
      };
      if (!dragRafRef.current) {
        dragRafRef.current = requestAnimationFrame(() => {
          const pending = pendingDragStateRef.current;
          dragRafRef.current = null;
          if (!pending) return;
          const { dragOverTabIndex, dragInsertPosition, draggedTabIndex } =
            appStore.getState();
          if (draggedTabIndex === null) return;
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
    [appStore, dispatch],
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
    dispatch(actions.resetDragState());
  }, [dispatch]);

  // 终端区拖拽投隆回调需要最新的 cleanupDragState（定义在其之后，用 ref 桥接）
  cleanupDragStateRef.current = cleanupDragState;

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
      const { draggedTabIndex, dragInsertPosition } = appStore.getState();
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
        const relX = (e.clientX - rect.left) / rect.width;
        position = relX < 0.3 ? "before" : relX > 0.7 ? "after" : "merge";
      }
      if (!position) {
        position = "after";
      }

      // 中段叠加合并：把拖拽标签并入目标标签的分屏（会话保留，不迁移缓存）
      if (position === "merge") {
        const sourceTab = tabs[sourceIndex];
        const targetTab = tabs[targetIndex];
        cleanupDragState();
        if (
          !sourceTab ||
          !targetTab ||
          sourceTab.id === targetTab.id ||
          sourceTab.id === "welcome" ||
          targetTab.id === "welcome"
        ) {
          return;
        }
        adoptTabAsPane(targetTab.id, sourceTab, "center");
        return;
      }

      // 执行排序
      reorderTab(sourceIndex, targetIndex, position);
      cleanupDragState();
    },
    [appStore, cleanupDragState, reorderTab, tabs, adoptTabAsPane],
  );

  // 处理拖动结束（无论是否成功放置）
  const handleDragEnd = useCallback(() => {
    cleanupDragState();
  }, [cleanupDragState]);

  // 切换资源监控侧边栏
  const toggleResourceMonitor = useCallback(() => {
    runSidebarToggle(
      resourceMonitorOpen,
      (open) => dispatch(actions.setResourceMonitorOpen(open)),
      "resource",
    );
  }, [resourceMonitorOpen, dispatch, runSidebarToggle]);

  // 关闭资源监控侧边栏
  const handleCloseResourceMonitor = useCallback(() => {
    runSidebarClose(
      (open) => dispatch(actions.setResourceMonitorOpen(open)),
      "resource",
      {
        notifyResize: false,
      },
    );
  }, [dispatch, runSidebarClose]);

  // 切换文件管理侧边栏
  // 状态按当前标签页独立存储：新开标签页默认关闭，不影响其他标签页已打开的侧边栏
  const toggleFileManager = () => {
    const panelTab = activeSession;
    if (!panelTab) {
      return;
    }
    if (!fileManagerOpen && !isCurrentPanelSshConnected) {
      if (panelTab.type === "ssh") {
        void loadTabConnectionStatus(panelTab.id);
      }
      return;
    }
    const willOpen = !fileManagerOpen;
    dispatch(actions.setFileManagerOpenForTab(panelTab.parentTabId, willOpen));
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("file"));
    } else {
      setFallbackSidebarAfterClose("file");
    }
    notifyTerminalResize();
  };

  // 关闭文件管理侧边栏（仅影响当前标签页）
  const handleCloseFileManager = () => {
    const panelTab = activeSession;
    runSidebarClose((open) => {
      if (panelTab) {
        dispatch(actions.setFileManagerOpenForTab(panelTab.parentTabId, open));
      }
    }, "file");
  };

  // 更新文件管理路径记忆
  const updateFileManagerPath = (tabId, path) => {
    if (tabId && path) {
      if (liveSessionKeysRef.current.has(tabId))
        dispatch(actions.updateFileManagerPath(tabId, path));
    }
  };
  const updateFileManagerHistory = useCallback((tabId, navigationState) => {
    if (!tabId || !navigationState || !liveSessionKeysRef.current.has(tabId)) {
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
    runSidebarToggle(
      shortcutCommandsOpen,
      (open) => dispatch(actions.setShortcutCommandsOpen(open)),
      "shortcut",
    );
  };
  const handleCloseShortcutCommands = () => {
    runSidebarClose(
      (open) => dispatch(actions.setShortcutCommandsOpen(open)),
      "shortcut",
    );
  };

  // 添加切换历史命令侧边栏的函数
  const toggleCommandHistory = () => {
    runSidebarToggle(
      commandHistoryOpen,
      (open) => dispatch(actions.setCommandHistoryOpen(open)),
      "history",
    );
  };
  const handleCloseCommandHistory = () => {
    runSidebarClose(
      (open) => dispatch(actions.setCommandHistoryOpen(open)),
      "history",
    );
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
    runSidebarToggle(
      ipAddressQueryOpen,
      (open) => dispatch(actions.setIpAddressQueryOpen(open)),
      "ipquery",
    );
  };

  // 关闭IP地址查询侧边栏
  const handleCloseIpAddressQuery = () => {
    runSidebarClose(
      (open) => dispatch(actions.setIpAddressQueryOpen(open)),
      "ipquery",
    );
  };

  // 切换随机密码生成器侧边栏（不触发终端resize）
  const toggleSecurityTools = () => {
    runSidebarToggle(
      securityToolsOpen,
      (open) => dispatch(actions.setSecurityToolsOpen(open)),
      "password",
      {
        notifyResize: false,
      },
    );
  };

  // 切换端口转发管理侧边栏
  const togglePortForwarding = () => {
    runSidebarToggle(
      portForwardingOpen,
      (open) => dispatch(actions.setPortForwardingOpen(open)),
      "forwarding",
      {
        notifyResize: false,
      },
    );
  };

  // 切换本地终端侧边栏
  const toggleLocalTerminalSidebar = () => {
    runSidebarToggle(
      localTerminalSidebarOpen,
      setLocalTerminalSidebarOpen,
      "localTerminal",
    );
  };

  // 关闭本地终端侧边栏
  const handleCloseLocalTerminalSidebar = () => {
    runSidebarClose(setLocalTerminalSidebarOpen, "localTerminal");
  };

  // 创建应用内本地终端标签页
  const handleLaunchLocalTerminal = useCallback(
    async (terminalConfig) => {
      if (!terminalConfig) {
        throw new Error("No local terminal selected");
      }
      const terminalId = `local-${Date.now()}`;
      const defaultDistribution = Array.isArray(
        terminalConfig.availableDistributions,
      )
        ? terminalConfig.availableDistributions.find(
            (dist) => dist.isDefault,
          ) || terminalConfig.availableDistributions[0]
        : null;
      const distribution =
        terminalConfig.distribution || defaultDistribution?.name || undefined;
      const baseLabel =
        terminalConfig.type === "wsl" && distribution
          ? distribution
          : terminalConfig.name || terminalConfig.executable || "Local";
      const sameLabelCount = tabs.filter(
        (tab) => tab.type === "local" && tab.label?.startsWith(baseLabel),
      ).length;
      const tabLabel =
        sameLabelCount > 0 ? `${baseLabel} ${sameLabelCount + 1}` : baseLabel;
      const completeConfig = {
        name: tabLabel,
        type: terminalConfig.type,
        executablePath: terminalConfig.executablePath,
        executable: terminalConfig.executable,
        command: terminalConfig.command,
        args: terminalConfig.args || terminalConfig.launchArgs || [],
        launchArgs: terminalConfig.launchArgs || terminalConfig.args || [],
        cwd: terminalConfig.cwd,
        env: terminalConfig.env,
        distribution,
        availableDistributions: terminalConfig.availableDistributions || [],
        tabId: terminalId,
      };
      const newTab = {
        id: terminalId,
        label: tabLabel,
        type: "local",
        localConfig: completeConfig,
      };
      dispatch(
        actions.setTerminalInstances({
          ...appStore.getState().terminalInstances,
          [terminalId]: true,
          [`${terminalId}-config`]: completeConfig,
          [`${terminalId}-processId`]: null,
        }),
      );
      const newTabs = [...tabs, newTab];
      dispatch(actions.setTabs(newTabs));
      dispatch(actions.setCurrentTab(newTabs.length - 1));
      setLocalTerminalSidebarOpen(false);
      setFallbackSidebarAfterClose("localTerminal");
      notifyTerminalResize();
      return {
        success: true,
        data: newTab,
      };
    },
    [dispatch, setFallbackSidebarAfterClose, tabs, appStore],
  );

  // 获取右侧面板应该使用的当前标签页信息
  // 添加发送快捷命令到终端的函数。
  // 类型策略（与逐键同步、粘贴/清除同步两条路径统一）：
  // 不区分终端类型（ssh/telnet/local），只要求当前标签存在活跃终端会话；
  // 同步范围完全由分组内成员构成决定。
  const handleSendCommand = useCallback(
    (command, options = {}) => {
      const result = sendCommandToActiveSession(
        sessionActionStateRef.current,
        command,
        options,
      );
      if (result.success) return result;
      const error =
        result.reason === "noTerminal"
          ? t("commandHistory.noTerminalTab")
          : result.reason === "sessionChanged"
            ? t("commandHistory.sessionChanged")
            : t("commandHistory.noActiveSession");
      return {
        ...result,
        error,
      };
    },
    [t],
  );
  const currentPanelConnectionStatus = activeSession?.status;
  const isCurrentPanelSshConnected =
    activeSession?.type === "ssh" &&
    currentPanelConnectionStatus?.isConnected === true &&
    currentPanelConnectionStatus?.isConnecting !== true;
  React.useEffect(() => {
    if (!activeSessionKey || activeSession?.type === "local") return;
    void loadTabConnectionStatus(activeSessionKey);
    void loadReconnectStatus(activeSessionKey);
  }, [
    activeSessionKey,
    activeSession?.type,
    loadTabConnectionStatus,
    loadReconnectStatus,
  ]);
  const resourceMonitorTabId =
    resourceMonitorOpen && activeSession?.type === "ssh"
      ? activeSession.processId
      : null;
  const fileManagerProps = useMemo(
    () =>
      getSessionFileManagerProps(
        activeSession,
        fileManagerPaths,
        fileManagerHistoryByTabId,
      ),
    [activeSession, fileManagerPaths, fileManagerHistoryByTabId],
  );
  const sidebarSessionContext = useMemo(() => {
    if (!activeSession) return null;
    const { type, config, label, status } = activeSession;
    if (type === "local")
      return {
        protocol: "LOCAL",
        host: label,
        quality: t("sidebar.sessionLocal"),
      };
    return {
      protocol: type.toUpperCase(),
      host: config?.host
        ? `${config.username ? `${config.username}@` : ""}${config.host}${config.port ? `:${config.port}` : ""}`
        : label,
      quality: status?.isConnecting
        ? t("sidebar.sessionConnecting")
        : status?.isConnected
          ? t("sidebar.sessionConnected")
          : t("sidebar.sessionDisconnected"),
    };
  }, [activeSession, t]);
  const isFileManagerButtonDisabled = !isCurrentPanelSshConnected;
  const hasVisibleSidebar =
    activeSidebarMargin > SIDEBAR_WIDTHS.SIDEBAR_BUTTONS_WIDTH;
  const activeSidebarContentWidth = hasVisibleSidebar
    ? normalizeSidebarWidth(sidebarWidth)
    : 0;

  // React 19: 利用自动批处理特性优化设置变更处理
  React.useEffect(() => {
    // 处理欢迎页AI按钮点击事件
    const handleToggleGlobalAI = () => {
      handleToggleGlobalAiChatWindow();
    };

    // 监听发送到AI助手事件
    const handleSendToAIEvent = (event) => {
      const sessionKey = event.detail.sessionKey;
      if (sessionKey) {
        const current = sessionActionStateRef.current;
        const parentId = getParentTabId(sessionKey, current.panes);
        const index = current.tabs.findIndex((tab) => tab.id === parentId);
        if (index < 0) return;
        dispatch(actions.setCurrentTab(index));
        dispatch(actions.focusPane(parentId, sessionKey));
      }
      handleSendToAI(event.detail.text);
    };

    // Alt+F1 全局快捷键唤醒AI助手；Ctrl+Shift+W 关闭聚焦窗格
    // （分屏创建统一由拖拽标签页合并触发，无快捷键分屏入口）
    const handleGlobalKeyDown = (event) => {
      if (event.altKey && event.key === "F1") {
        event.preventDefault();
        handleToggleGlobalAiChatWindow();
        return;
      }
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "w") {
          event.preventDefault();
          handlePaneShortcutRef.current("close");
        }
      }
    };

    // 使用 useWindowEvents Hook 统一管理多个 window 事件监听
    // 注意：为了避免在 useEffect 中再使用 Hook，我们继续使用 eventManager

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

    return () => {
      smartPreload.cancelAllScheduled();
      removeToggleListener();
      removeSendToAIListener();
      removeKeyDownListener();
    };
  }, [darkMode, dispatch, aiChatStatus]); // 添加 aiChatStatus 依赖以确保快捷键能正确切换状态

  // 分组操作回调：分组状态已收编进 appReducer，直接 dispatch 即可触发刷新，
  // 不再需要 dispatch(actions.setTabs([...tabs])) 强制刷新 hack
  const handleJoinGroup = (tabId, groupId) => {
    dispatch(actions.joinSyncGroup(tabId, groupId));
    handleTabContextMenuClose();
  };
  const handleRemoveFromGroup = (tabId) => {
    dispatch(actions.removeTabFromSyncGroups(tabId));
    handleTabContextMenuClose();
  };
  const handleCreateGroup = (tabId) => {
    dispatch(actions.createSyncGroup(tabId));
    handleTabContextMenuClose();
  };

  // 同步分组提示 toast：成员不可达 / 并发输入警告（来自分发器或分组内成员端）
  React.useEffect(() => {
    const lastNoticeAt = {
      "member-unreachable": 0,
      "concurrent-input": 0,
    };
    const THROTTLE_MS = {
      "member-unreachable": 2000,
      "concurrent-input": 3000,
    };
    const handleSyncGroupNotice = (event) => {
      const detail = event.detail || {};
      const throttle = THROTTLE_MS[detail.kind];
      if (!throttle) {
        return;
      }
      const now = Date.now();
      if (now - lastNoticeAt[detail.kind] < throttle) {
        return;
      }
      lastNoticeAt[detail.kind] = now;
      if (detail.kind === "member-unreachable") {
        const count =
          Array.isArray(detail.tabIds) && detail.tabIds.length > 0
            ? detail.tabIds.length
            : 1;
        showWarning(
          t("syncGroupNotice.memberUnreachable", {
            count,
          }),
        );
      } else if (detail.kind === "concurrent-input") {
        showWarning(t("syncGroupNotice.concurrentInput"));
      }
    };
    window.addEventListener("syncGroupNotice", handleSyncGroupNotice);
    return () =>
      window.removeEventListener("syncGroupNotice", handleSyncGroupNotice);
  }, [showWarning, t]);

  // 在主题加载完成前显示加载状态，避免闪烁

  React.useEffect(() => {
    const activeTabIds = new Set(liveSessionKeys);
    const retain = (previous) =>
      retainLiveSessionEntries(previous, activeTabIds);
    setDiskAlertsByTabId(retain);
    setFileManagerHistoryByTabId(retain);
  }, [liveSessionKeys]);
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
  const handlePauseReconnect = () =>
    handlePauseReconnectForTab(tabContextMenu.tabId).then((done) => {
      if (done) handleTabContextMenuClose();
    });
  const handleResumeReconnect = () =>
    handleResumeReconnectForTab(tabContextMenu.tabId).then((done) => {
      if (done) handleTabContextMenuClose();
    });
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
            bgcolor: "background.paper",
            color: "text.primary",
            boxShadow: "none",
            borderBottom: "1px solid",
            borderColor: "divider",
            // 欢迎页的 fixed 背景层（z-index 0）会盖过 static 定位的标题栏，
            // 建立层级关系确保标题栏及其窗口控制按钮始终绘制在欢迎页背景之上
            position: "relative",
            zIndex: 2,
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
                WebkitAppRegion: "no-drag",
              }}
            >
              <Tooltip title={t("menu.mainMenu")}>
                <IconButton
                  edge="start"
                  color="inherit"
                  aria-label={t("menu.mainMenu")}
                  data-main-menu-button="true"
                  sx={{
                    mr: 1,
                    WebkitAppRegion: "no-drag",
                  }}
                  onClick={handleMenu}
                >
                  <AppsIcon />
                </IconButton>
              </Tooltip>
              {credentialSecurityStatus.masterPasswordEnabled && (
                <Tooltip title={t("menu.lockApp")}>
                  <IconButton
                    color="inherit"
                    size="small"
                    aria-label={t("menu.lockApp")}
                    sx={{
                      mr: 1,
                      WebkitAppRegion: "no-drag",
                    }}
                    onClick={handleLockApp}
                  >
                    <LockOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
              <AppMenu
                anchorEl={anchorEl}
                open={open}
                handleClose={handleClose}
                handleOpenSettings={handleOpenSettings}
                t={t}
                handleOpenLogDirectory={handleOpenLogDirectory}
                handleExportDiagnostics={handleExportDiagnostics}
                handleOpenFeedbackIssue={handleOpenFeedbackIssue}
                handleOpenAbout={handleOpenAbout}
                handleExit={handleExit}
              />
              <Box
                sx={{
                  flexGrow: 1,
                  alignSelf: "stretch",
                  WebkitAppRegion: open ? "no-drag" : "drag",
                }}
              />
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
                borderTop: "1px solid",
                borderColor: "divider",
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
                      gap: 0,
                    },
                    "& .MuiTabs-indicator": {
                      // Workspace tabs draw their selected marker inside the
                      // Tab itself. Hiding MUI's separate absolute layer keeps
                      // it from ever covering a label during mount/hydration.
                      display: "none",
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
                  {tabs.map((tab, index) => (
                    <SessionTab
                      key={tab.id}
                      tab={tab}
                      index={index}
                      value={index}
                      splitLayouts={splitLayouts}
                      paneRegistry={paneRegistry}
                      diskAlert={diskAlertsByTabId[String(tab.id)] || null}
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
                      selected={currentTab === index}
                      group={findGroupByTab(syncGroups, tab.id)}
                    />
                  ))}
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
                  activeSession={activeSession}
                  placement="inline"
                />
              </Box>
            </Box>
          </Box>

          {/* 标签页右键菜单 */}
          <SessionContextMenu
            tabContextMenu={tabContextMenu}
            handleTabContextMenuClose={handleTabContextMenuClose}
            handleRefreshTerminal={handleRefreshTerminal}
            t={t}
            handleCloseConnection={handleCloseConnection}
            contextMenuTab={contextMenuTab}
            splitLayouts={splitLayouts}
            handleUnsplitTab={handleUnsplitTab}
            handlePauseReconnect={handlePauseReconnect}
            handleResumeReconnect={handleResumeReconnect}
            syncGroups={syncGroups}
            handleJoinGroup={handleJoinGroup}
            handleRemoveFromGroup={handleRemoveFromGroup}
            handleCreateGroup={handleCreateGroup}
          />
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
                onDragOver={handleTerminalAreaDragOver}
                onDragLeave={handleTerminalAreaDragLeave}
                onDrop={handleTerminalAreaDrop}
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
                {/* 拖拽标签页到终端区时的投隆区高亮 */}
                <PaneDropOverlay />
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

                <SessionWorkspace
                  tabs={tabs.slice(1)}
                  layouts={splitLayouts}
                  activeTabId={currentPanelTab?.id}
                  onFocusPane={handleFocusPane}
                  onClosePane={handleClosePane}
                  onSetRatios={handleSetRatios}
                  onPaneDragStart={handlePaneDragStart}
                  onPaneDragOver={handlePaneDragOver}
                  onPaneDrop={handlePaneDrop}
                  onPaneDragEnd={handlePaneDragEnd}
                />
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
                  width: `${activeSidebarContentWidth}px`,
                  height: "100%",
                  position: "relative",
                  willChange: "width",
                  transition: (theme) =>
                    sidebarResizing
                      ? "none"
                      : theme.transitions.create("width", {
                          easing: theme.transitions.easing.sharp,
                          duration: theme.transitions.duration.enteringScreen,
                        }),
                  overflow: "hidden",
                }}
              >
                {activeSidebarContentWidth > 0 && (
                  <Box
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t("sidebar.resize")}
                    tabIndex={-1}
                    onPointerDown={handleSidebarResizeStart}
                    sx={(theme) => ({
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      [sidebarPosition === "left" ? "right" : "left"]: 0,
                      width: 8,
                      cursor: "col-resize",
                      zIndex: 120,
                      touchAction: "none",
                      outline: "none",
                      transform:
                        sidebarPosition === "left"
                          ? "translateX(4px)"
                          : "translateX(-4px)",
                      "&::after": {
                        content: '""',
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: "50%",
                        width: 2,
                        transform: "translateX(-50%)",
                        bgcolor: sidebarResizing
                          ? "primary.main"
                          : "transparent",
                        opacity: sidebarResizing ? 0.8 : 0,
                        transition: theme.transitions.create(
                          ["background-color", "opacity"],
                          {
                            duration: theme.transitions.duration.shortest,
                          },
                        ),
                      },
                      "&:hover::after": {
                        bgcolor: "primary.main",
                        opacity: 0.45,
                      },
                    })}
                  />
                )}
                {/* 业务侧栏可多开：后打开的以更高 z-index 覆盖，关闭后回退到先前打开的 */}
                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "resource" ? 101 : 98,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {resourceMonitorPresent && (
                    <ResourceMonitor
                      sessionKey={activeSessionKey}
                      open={resourceMonitorOpen}
                      onClose={handleCloseResourceMonitor}
                      currentTabId={resourceMonitorTabId}
                      sessionContext={sidebarSessionContext}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "connection" ? 101 : 99,
                    width: "100%",
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
                      sessionContext={sidebarSessionContext}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "file" ? 103 : 96,
                    width: "100%",
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
                      sessionContext={sidebarSessionContext}
                      followTerminalDirectory={sftpFollowTerminalDirectory}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "shortcut" ? 104 : 95,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {shortcutCommandsPresent && (
                    <ShortcutCommands
                      open={shortcutCommandsOpen}
                      onClose={handleCloseShortcutCommands}
                      onSendCommand={handleSendCommand}
                      sessionContext={sidebarSessionContext}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "history" ? 105 : 94,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {commandHistoryPresent && (
                    <CommandHistory
                      open={commandHistoryOpen}
                      onClose={handleCloseCommandHistory}
                      onSendCommand={handleSendCommand}
                      sessionContext={sidebarSessionContext}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "ipquery" ? 106 : 93,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {ipAddressQueryPresent && (
                    <IPAddressQuery
                      open={ipAddressQueryOpen}
                      onClose={handleCloseIpAddressQuery}
                      sessionContext={sidebarSessionContext}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "password" ? 107 : 92,
                    width: "100%",
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
                      sessionContext={sidebarSessionContext}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "forwarding" ? 107 : 92,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {portForwardingPresent && (
                    <PortForwardingDialog
                      open={portForwardingOpen}
                      onClose={() => {
                        dispatch(actions.setPortForwardingOpen(false));
                        setFallbackSidebarAfterClose("forwarding");
                      }}
                      sessionContext={sidebarSessionContext}
                    />
                  )}
                </Box>

                <Box
                  sx={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    zIndex: lastOpenedSidebar === "localTerminal" ? 108 : 91,
                    width: "100%",
                    height: "100%",
                    display: "flex",
                  }}
                >
                  {localTerminalSidebarPresent && (
                    <LocalTerminalSidebar
                      open={localTerminalSidebarOpen}
                      onClose={handleCloseLocalTerminalSidebar}
                      onLaunchTerminal={handleLaunchLocalTerminal}
                      sessionContext={sidebarSessionContext}
                    />
                  )}
                </Box>
              </Box>

              {/* 图标轨 Activity Rail：上=会话区 / 中=工具 / 下=AI·主题·位置 */}
              <Paper
                elevation={0}
                square={true}
                sx={(theme) => ({
                  width: "var(--sidebar-rail-width, 48px)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  py: 1.25,
                  gap: "var(--sidebar-rail-item-gap, 4px)",
                  borderRadius: 0,
                  zIndex: 110,
                  flexShrink: 0,
                  bgcolor: "background.paper",
                  borderLeft:
                    sidebarPosition === "right"
                      ? `1px solid ${theme.palette.divider}`
                      : "none",
                  borderRight:
                    sidebarPosition === "left"
                      ? `1px solid ${theme.palette.divider}`
                      : "none",
                  boxShadow:
                    theme.palette.mode === "dark"
                      ? "inset 0 0 0 1px rgba(255,255,255,0.03)"
                      : "none",
                })}
              >
                {/* 上：会话 / 连接 / 文件 / 历史 */}
                <SidebarTooltip
                  title={t("sidebar.connections")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("connectionManager")}
                    onClick={toggleConnectionManager}
                    sx={(theme) =>
                      sidebarRailButtonSx(theme, connectionManagerOpen)
                    }
                    aria-label={t("sidebar.connections")}
                  >
                    <LinkIcon />
                  </IconButton>
                </SidebarTooltip>

                <SidebarTooltip
                  title={
                    isFileManagerButtonDisabled
                      ? t("fileManager.errors.connectionNotReady")
                      : t("sidebar.files")
                  }
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("fileManager")}
                    onClick={toggleFileManager}
                    sx={(theme) => sidebarRailButtonSx(theme, fileManagerOpen)}
                    disabled={isFileManagerButtonDisabled}
                    aria-label={t("sidebar.files")}
                  >
                    <FolderIcon />
                  </IconButton>
                </SidebarTooltip>

                <SidebarTooltip
                  title={t("sidebar.shortcutCommands")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("shortcutCommands")}
                    onClick={toggleShortcutCommands}
                    sx={(theme) =>
                      sidebarRailButtonSx(theme, shortcutCommandsOpen)
                    }
                    disabled={!activeSession}
                    aria-label={t("sidebar.shortcutCommands")}
                  >
                    <TerminalIcon />
                  </IconButton>
                </SidebarTooltip>

                <SidebarTooltip
                  title={t("sidebar.history")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("commandHistory")}
                    onClick={toggleCommandHistory}
                    sx={(theme) =>
                      sidebarRailButtonSx(theme, commandHistoryOpen)
                    }
                    aria-label={t("sidebar.history")}
                  >
                    <HistoryIcon />
                  </IconButton>
                </SidebarTooltip>

                <Box sx={sidebarRailDividerSx} />

                {/* 中：工具 — 监控 / IP / 安全 / 本地 / 传输 */}
                <SidebarTooltip
                  title={t("sidebar.monitor")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("resourceMonitor")}
                    onClick={toggleResourceMonitor}
                    disabled={!canMonitorCurrentSession}
                    sx={(theme) =>
                      sidebarRailButtonSx(theme, resourceMonitorOpen)
                    }
                    aria-label={t("sidebar.monitor")}
                  >
                    <MonitorHeartIcon />
                  </IconButton>
                </SidebarTooltip>

                <SidebarTooltip
                  title={t("sidebar.ipQuery")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("ipAddressQuery")}
                    onClick={toggleIpAddressQuery}
                    sx={(theme) =>
                      sidebarRailButtonSx(theme, ipAddressQueryOpen)
                    }
                    aria-label={t("sidebar.ipQuery")}
                  >
                    <PublicIcon />
                  </IconButton>
                </SidebarTooltip>

                <SidebarTooltip
                  title={t("sidebar.securityTool")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("securityTools")}
                    onClick={toggleSecurityTools}
                    sx={(theme) =>
                      sidebarRailButtonSx(theme, securityToolsOpen)
                    }
                    aria-label={t("sidebar.securityTool")}
                  >
                    <VpnKeyIcon />
                  </IconButton>
                </SidebarTooltip>

                <SidebarTooltip
                  title={t("sidebar.portForwarding")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("portForwarding")}
                    onClick={togglePortForwarding}
                    sx={(theme) =>
                      sidebarRailButtonSx(theme, portForwardingOpen)
                    }
                    aria-label={t("sidebar.portForwarding")}
                  >
                    <SettingsEthernetIcon />
                  </IconButton>
                </SidebarTooltip>

                <SidebarTooltip
                  title={t("sidebar.localTerminal")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("localTerminalSidebar")}
                    onClick={toggleLocalTerminalSidebar}
                    sx={(theme) =>
                      sidebarRailButtonSx(theme, localTerminalSidebarOpen)
                    }
                    aria-label={t("sidebar.localTerminal")}
                  >
                    <ComputerIcon />
                  </IconButton>
                </SidebarTooltip>

                {
                  <TransferSidebarButton
                    ref={transferSidebarButtonRef}
                    isOpen={transferSidebarOpen}
                    resumableCount={resumableTransferCount}
                    onClick={() => {
                      const newState = !transferSidebarOpen;
                      setTransferSidebarOpen(newState);
                      if (newState) {
                        setLastActiveFloatWindow("transfer");
                      }
                    }}
                    tooltipPlacement={sidebarTooltipPlacement}
                  />
                }

                <Box sx={sidebarRailDividerSx} />

                {/* 下：AI / 主题 / 位置切换 */}
                <SidebarTooltip
                  title={
                    aiPanelOpen && aiApiReachable === false
                      ? t("sidebar.aiApiUnreachable")
                      : t("sidebar.ai")
                  }
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    {...intentPreloadProps("aiChatWindow")}
                    ref={aiChatButtonRef}
                    onClick={handleToggleGlobalAiChatWindow}
                    sx={(theme) => ({
                      position: "relative",
                      ...sidebarRailButtonSx(theme, aiChatStatus === "visible"),
                    })}
                    aria-label={
                      aiPanelOpen && aiApiReachable === false
                        ? t("sidebar.aiApiUnreachable")
                        : t("sidebar.ai")
                    }
                  >
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

                <SidebarTooltip
                  title={t("sidebar.theme")}
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    onClick={toggleTheme}
                    sx={(theme) => sidebarRailButtonSx(theme, false)}
                    aria-label={t("sidebar.theme")}
                  >
                    {darkMode ? <DarkModeIcon /> : <LightModeIcon />}
                  </IconButton>
                </SidebarTooltip>

                <Box
                  sx={{
                    flexGrow: 1,
                  }}
                />

                <SidebarTooltip
                  title={
                    sidebarPosition === "left"
                      ? t("sidebar.moveToRight")
                      : t("sidebar.moveToLeft")
                  }
                  placement={sidebarTooltipPlacement}
                >
                  <IconButton
                    onClick={handleToggleSidebarPosition}
                    sx={(theme) => sidebarRailButtonSx(theme, false)}
                    aria-label={
                      sidebarPosition === "left"
                        ? t("sidebar.moveToRight")
                        : t("sidebar.moveToLeft")
                    }
                  >
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
      {aiChatStatus !== "closed" && (
        <SessionAIChatWorkspace
          activeSessionKey={activeSessionKey}
          windowState={aiChatStatus}
          onClose={handleCloseGlobalAiChatWindow}
          onMinimize={handleMinimizeGlobalAiChatWindow}
          presetInput={aiInputPreset}
          onInputPresetUsed={() => dispatch(actions.setAiInputPreset(""))}
          onExecuteCommand={handleSendCommand}
          zIndex={lastActiveFloatWindow === "ai" ? 1310 : 1300}
          onFocus={() => setLastActiveFloatWindow("ai")}
          anchorEl={aiChatButtonRef.current}
        />
      )}

      {/* 所有显示模式均可打开传输面板，恢复重启后保留的任务。 */}
      {
        <TransferSidebar
          open={transferSidebarOpen}
          onRecoveryCount={setResumableTransferCount}
          onClose={() => setTransferSidebarOpen(false)}
          zIndex={lastActiveFloatWindow === "transfer" ? 1310 : 1300}
          onFocus={() => setLastActiveFloatWindow("transfer")}
          anchorEl={transferSidebarButtonRef.current}
        />
      }

      {firstRunDialogOpen && (
        <FirstRunDialog
          open={firstRunDialogOpen}
          initialSettings={uiSettingsSnapshot}
          credentialSecurityStatus={credentialSecurityStatus}
          onComplete={handleFirstRunComplete}
        />
      )}

      {/* 关于对话框 */}
      {aboutDialogOpen && (
        <AboutDialog
          open={aboutDialogOpen}
          onClose={handleCloseAbout}
          checkUpdateSignal={aboutUpdateCheckSignal}
          onRemindLater={handleRemindUpdateLater}
        />
      )}

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
