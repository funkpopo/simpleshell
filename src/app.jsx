import * as React from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { createUnifiedTheme } from "./theme";
import CssBaseline from "@mui/material/CssBaseline";
import { GlobalErrorBoundary } from "./components/ErrorBoundary.jsx";
import { AppProvider, useAppState, useAppDispatch } from "./store/AppContext.jsx";
import { NotificationProvider, useNotification } from "./contexts/NotificationContext.jsx";
import { actions } from "./store/appReducer.js";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import AppsIcon from "@mui/icons-material/Apps";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import LinkIcon from "@mui/icons-material/Link";
import RefreshIcon from "@mui/icons-material/Refresh";
import PowerOffIcon from "@mui/icons-material/PowerOff";
import FolderIcon from "@mui/icons-material/Folder";
import SettingsIcon from "@mui/icons-material/Settings";
import AIIcon from "./components/AIIcon.jsx";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import HistoryIcon from "@mui/icons-material/History";
import InfoIcon from "@mui/icons-material/Info";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import PublicIcon from "@mui/icons-material/Public";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import ComputerIcon from "@mui/icons-material/Computer";
import WebTerminal from "./components/WebTerminal.jsx";
import WelcomePage from "./components/WelcomePage.jsx";
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
import AIChatWindow from "./components/AIChatWindow.jsx";
import CustomTab from "./components/CustomTab.jsx";
import NetworkLatencyIndicator from "./components/NetworkLatencyIndicator.jsx";
import WindowControls from "./components/WindowControls.jsx";
import AboutDialog from "./components/AboutDialog.jsx";
import SSHAuthDialog from "./components/SSHAuthDialog.jsx";
// Import i18n configuration
import { useTranslation } from "react-i18next";
import "./i18n/i18n";
import { changeLanguage } from "./i18n/i18n";
import "./styles/index.css";
import "./styles/theme-switch-animation.css";
import { styled } from "@mui/material/styles";
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
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import AddIcon from "@mui/icons-material/Add";
import { dispatchCommandToGroup } from "./core/syncGroupCommandDispatcher";
import { useEventManager } from "./core/utils/eventManager.js";
import {
  useWindowEvents,
  useElementEvent,
} from "./hooks/useWindowEvent.js";
import ErrorNotification from "./components/ErrorNotification.jsx";
import GlobalTransferBar from "./components/GlobalTransferBar.jsx";
import GlobalTransferFloat from "./components/GlobalTransferFloat.jsx";
import TransferSidebar from "./components/TransferSidebar.jsx";
import TransferSidebarButton from "./components/TransferSidebarButton.jsx";

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

const normalizeRecentConnections = (recentConnections, connections) => {
  if (!Array.isArray(recentConnections)) return [];
  return recentConnections
    .map((candidate) => resolveRecentConnection(candidate, connections))
    .filter(Boolean);
};

function AppContent() {
  const LATENCY_INFO_MIN_WIDTH = 150;
  const { t, i18n } = useTranslation();
  const eventManager = useEventManager(); // 使用统一的事件管理器

  // 使用全局状态和 dispatch
  const state = useAppState();
  const dispatch = useAppDispatch();

  // 错误处理状态（保持本地，因为不需要全局共享）
  const [appError, setAppError] = React.useState(null);
  const [errorNotificationOpen, setErrorNotificationOpen] = React.useState(false);

  // SSH 认证对话框状态
  const [sshAuthDialogOpen, setSshAuthDialogOpen] = React.useState(false);
  const [sshAuthData, setSshAuthData] = React.useState(null);
  const [sshAuthConnectionConfig, setSshAuthConnectionConfig] = React.useState(null);
  const sshAuthRequestIdRef = React.useRef(null);

  // 监听主进程的错误事件
  React.useEffect(() => {
    const handleAppError = (event, error) => {
      console.error('Application error:', error);
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

  const handleCloseErrorNotification = () => {
    setErrorNotificationOpen(false);
  };

  // Update the tabs when language changes
  React.useEffect(() => {
    // Update welcome tab label when language changes
    // 只在语言改变时更新，不依赖 tabs
    if (tabs.length > 0 && tabs[0].id === "welcome") {
      const newLabel = t("terminal.welcome");
      if (tabs[0].label !== newLabel) {
        dispatch(
          actions.setTabs([
            { ...tabs[0], label: newLabel },
            ...tabs.slice(1),
          ])
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
          if (settings && settings.darkMode !== undefined) {
            dispatch(actions.setDarkMode(settings.darkMode));
          }
        }
      } catch (error) {
        // 如果加载失败，尝试从 localStorage 恢复作为备选
        const fallbackTheme = localStorage.getItem("terminalDarkMode");
        if (fallbackTheme !== null) {
          dispatch(actions.setDarkMode(fallbackTheme === "true"));
        }
      } finally {
        dispatch(actions.setThemeLoading(false));
      }
    };

    loadThemeSettings();
  }, [dispatch]);

  // ============ 从全局状态读取 ============
  const tabs = state.tabs;
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

  // 锁定的文件管理器tabId（在打开时不随标签页切换而变化）
  const [lockedFileManagerTabId, setLockedFileManagerTabId] = useState(null);

  // 监听 SSH 认证请求
  React.useEffect(() => {
    if (!window.terminalAPI?.onSSHAuthRequest) return;

    const handleSSHAuthRequest = (data) => {
      console.log('SSH Auth request received:', data);
      sshAuthRequestIdRef.current = data.requestId;
      
      // 查找对应的连接配置
      let connectionConfig = null;
      if (data.connectionId) {
        // 递归查找连接配置
        const findConnection = (items) => {
          for (const item of items) {
            if (item.type === 'connection' && item.id === data.connectionId) {
              return item;
            }
            if (item.type === 'group' && Array.isArray(item.items)) {
              const found = findConnection(item.items);
              if (found) return found;
            }
          }
          return null;
        };
        connectionConfig = findConnection(connections);
      }
      
      // 也可以从 tabId 获取配置
      if (!connectionConfig && data.tabId && terminalInstances[`${data.tabId}-config`]) {
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
  const handleSSHAuthConfirm = React.useCallback(async (authResult) => {
    if (!sshAuthRequestIdRef.current) return;
    
    try {
      await window.terminalAPI.respondSSHAuth({
        requestId: sshAuthRequestIdRef.current,
        ...authResult,
      });
    } catch (error) {
      console.error('Failed to respond SSH auth:', error);
    }
    
    setSshAuthDialogOpen(false);
    setSshAuthData(null);
    setSshAuthConnectionConfig(null);
    sshAuthRequestIdRef.current = null;
  }, []);

  // 处理 SSH 认证对话框关闭/取消
  const handleSSHAuthClose = React.useCallback(async (result) => {
    if (sshAuthRequestIdRef.current) {
      try {
        await window.terminalAPI.respondSSHAuth({
          requestId: sshAuthRequestIdRef.current,
          cancelled: true,
        });
      } catch (error) {
        console.error('Failed to cancel SSH auth:', error);
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
      document.body.classList.add('dark-theme');
      document.body.classList.remove('light-theme');
    } else {
      document.body.classList.add('light-theme');
      document.body.classList.remove('dark-theme');
    }
  }, [darkMode]);

  // ============ 保持本地状态(不在 reducer 中)============
  const [localTerminalSidebarOpen, setLocalTerminalSidebarOpen] = React.useState(false);
  const [prevTabsLength, setPrevTabsLength] = React.useState(tabs.length);
  const [transferFloatOpen, setTransferFloatOpen] = React.useState(false);
  const [transferFloatInitialTransfer, setTransferFloatInitialTransfer] = React.useState(null);
  const [dndEnabled, setDndEnabled] = React.useState(true);
  // 传输栏显示模式: "bottom" | "sidebar"
  const [transferBarMode, setTransferBarMode] = React.useState("bottom");
  // 传输侧边栏状态
  const [transferSidebarOpen, setTransferSidebarOpen] = React.useState(false);
  // 最后激活的浮动窗口（用于控制z-index层叠顺序）: "ai" | "transfer"
  const [lastActiveFloatWindow, setLastActiveFloatWindow] = React.useState("ai");

  const tabsRef = useRef(null);
  const dragRafRef = React.useRef(null);
  const pendingDragStateRef = React.useRef(null);

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
      { passive: false }
    );

    return removeListener;
  }, [handleTabsWheel, eventManager]);

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
      if (resourceMonitorOpen && lastOpenedSidebar === "resource") {
        return SIDEBAR_WIDTHS.RESOURCE_MONITOR;
      } else if (connectionManagerOpen && lastOpenedSidebar === "connection") {
        return SIDEBAR_WIDTHS.CONNECTION_MANAGER;
      } else if (fileManagerOpen && lastOpenedSidebar === "file") {
        return SIDEBAR_WIDTHS.FILE_MANAGER;
      } else if (shortcutCommandsOpen && lastOpenedSidebar === "shortcut") {
        return SIDEBAR_WIDTHS.SHORTCUT_COMMANDS;
      } else if (commandHistoryOpen && lastOpenedSidebar === "history") {
        return SIDEBAR_WIDTHS.COMMAND_HISTORY;
      } else if (ipAddressQueryOpen && lastOpenedSidebar === "ipquery") {
        return SIDEBAR_WIDTHS.IP_ADDRESS_QUERY;
      } else if (securityToolsOpen && lastOpenedSidebar === "password") {
        return SIDEBAR_WIDTHS.SECURITY_TOOLS;
      } else if (
        localTerminalSidebarOpen &&
        lastOpenedSidebar === "localTerminal"
      ) {
        return SIDEBAR_WIDTHS.LOCAL_TERMINAL_SIDEBAR;
      }
      // Fallback if lastOpenedSidebar isn't set but one is open
      if (resourceMonitorOpen) return SIDEBAR_WIDTHS.RESOURCE_MONITOR;
      else if (connectionManagerOpen) return SIDEBAR_WIDTHS.CONNECTION_MANAGER;
      else if (fileManagerOpen) return SIDEBAR_WIDTHS.FILE_MANAGER;
      else if (shortcutCommandsOpen) return SIDEBAR_WIDTHS.SHORTCUT_COMMANDS;
      else if (commandHistoryOpen) return SIDEBAR_WIDTHS.COMMAND_HISTORY;
      else if (ipAddressQueryOpen) return SIDEBAR_WIDTHS.IP_ADDRESS_QUERY;
      else if (securityToolsOpen) return SIDEBAR_WIDTHS.SECURITY_TOOLS;
      else if (localTerminalSidebarOpen)
        return SIDEBAR_WIDTHS.LOCAL_TERMINAL_SIDEBAR;
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
    SIDEBAR_WIDTHS,
  ]);

  // 应用启动时加载连接配置和预加载组件
  React.useEffect(() => {
    const loadData = async () => {
      try {
        if (window.terminalAPI) {
          const loadedConnections =
            (await window.terminalAPI.loadConnections()) || [];
          if (Array.isArray(loadedConnections)) {
            dispatch(actions.setConnections(loadedConnections));

            // loadTopConnections 现在返回完整的连接对象数组，不再是ID数组
            const lastConnectionObjs =
              (await window.terminalAPI.loadTopConnections()) || [];
            if (
              Array.isArray(lastConnectionObjs) &&
              lastConnectionObjs.length > 0
            ) {
              const normalizedRecent = normalizeRecentConnections(
                lastConnectionObjs,
                loadedConnections,
              );
              if (normalizedRecent.length > 0) {
                dispatch(actions.setTopConnections(normalizedRecent));
              }
            }
          }
        }
      } catch (error) {
        // 连接加载失败，应用仍可正常启动
      }
    };

    loadData();

    // 延迟预加载组件，避免影响应用启动性能
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
        dispatch(actions.setTerminalInstances({
          ...terminalInstances,
          [`${terminalId}-processId`]: processId,
        }));

        // 更新进程缓存
        dispatch(actions.setProcessCache({
          ...processCache,
          [terminalId]: processId,
        }));
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
  }, []);

  // 当连接列表更新时，同步更新置顶连接列表
  React.useEffect(() => {
    if (window.terminalAPI?.loadTopConnections) {
      window.terminalAPI
        .loadTopConnections()
        .then((lastConnectionObjs) => {
          if (Array.isArray(lastConnectionObjs) && lastConnectionObjs.length > 0) {
            // lastConnectionObjs 现在是完整的连接对象数组
            // 只有当计算出的列表与当前状态不同时才更新，避免不必要的渲染
            const normalizedRecent = normalizeRecentConnections(
              lastConnectionObjs,
              connections,
            );
            if (
              JSON.stringify(normalizedRecent) !==
              JSON.stringify(topConnections)
            ) {
              dispatch(actions.setTopConnections(normalizedRecent));
            }
          }
        })
        .catch((error) => {
          // 处理加载最近连接失败的情况
        });
    }
  }, [connections]); // 依赖于 connections state

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
          connections,
        );
        dispatch(actions.setTopConnections(normalizedRecent));
      } catch (e) {
        // 忽略错误
      }
    };

    const unsubscribe = window.terminalAPI.onTopConnectionsChanged(
      handleTopChanged,
    );
    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [connections]);

  // 保存更新后的连接配置
  const handleConnectionsUpdate = useCallback((updatedConnections) => {
    dispatch(actions.setConnections(updatedConnections));
    if (window.terminalAPI && window.terminalAPI.saveConnections) {
      window.terminalAPI.saveConnections(updatedConnections);
    }
  }, [dispatch]);

  // 创建动态主题
  const theme = React.useMemo(() => createUnifiedTheme(darkMode), [darkMode]);

  // 处理菜单打开
  const handleMenu = useCallback((event) => {
    dispatch(actions.setAnchorEl(event.currentTarget));
  }, [dispatch]);

  // 处理菜单关闭
  const handleClose = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
  }, [dispatch]);

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

  // 处理应用退出
  const handleExit = useCallback(() => {
    if (window.terminalAPI && window.terminalAPI.closeApp) {
      window.terminalAPI.closeApp();
    }
    dispatch(actions.setAnchorEl(null));
  }, [dispatch]);

  // React 19: 利用自动批处理优化主题切换
  const toggleTheme = useCallback(async (event) => {
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

      // 在动画早期切换主题状态，让内容也能跟随过渡
      setTimeout(() => {
        dispatch(actions.setDarkMode(newDarkMode));
      }, 100);

      // 动画结束后清理（0.8s 动画时长）
      setTimeout(() => {
        document.body.classList.remove("theme-switching");
        overlay.remove();
      }, 800);

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
        } catch (loadError) {
          // 获取当前设置失败，使用默认值
        }

        // 更新主题设置并保存
        const updatedSettings = {
          ...currentSettings,
          darkMode: newDarkMode,
        };

        await window.terminalAPI.saveUISettings(updatedSettings);
      }

      // 同时更新 localStorage 作为备选（向后兼容）
      localStorage.setItem("terminalDarkMode", newDarkMode.toString());
    } catch (error) {
      // 如果保存失败，至少更新 localStorage
      localStorage.setItem("terminalDarkMode", (!darkMode).toString());
    }
  }, [darkMode, dispatch]);

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

      dispatch(actions.setTabContextMenu({
        mouseX: event.clientX - 2,
        mouseY: event.clientY - 4,
        tabIndex: index,
        tabId: tabId,
      }));
    },
    [tabs, dispatch],
  );

  // 标签页右键菜单关闭
  const handleTabContextMenuClose = useCallback(() => {
    dispatch(actions.setTabContextMenu({
      mouseX: null,
      mouseY: null,
      tabIndex: null,
      tabId: null,
    }));
  }, [dispatch]);

  // 刷新终端连接
  const handleRefreshTerminal = async () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null && tabIndex < tabs.length) {
      const tabId = tabs[tabIndex].id;

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
      dispatch(actions.setTerminalInstances({
        ...terminalInstances,
        [tabId]: undefined,
      }));

      // 添加新实例标记，触发WebTerminal重新创建
      setTimeout(() => {
        dispatch(actions.setTerminalInstances({
          ...terminalInstances,
          [tabId]: true,
          [`${tabId}-refresh`]: Date.now(), // 添加时间戳确保组件被重新渲染
        }));
      }, 100);
    }

    handleTabContextMenuClose();
  };

  // 切换连接管理侧边栏
  const toggleConnectionManager = useCallback(() => {
    dispatch(actions.setConnectionManagerOpen(!connectionManagerOpen));
    // 如果要打开连接管理侧边栏，确保它显示在上层
    if (!connectionManagerOpen) {
      dispatch(actions.setLastOpenedSidebar("connection"));
      // 资源监控保持不变
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  }, [connectionManagerOpen, dispatch]);

  // 关闭连接管理侧边栏
  const handleCloseConnectionManager = useCallback(() => {
    dispatch(actions.setConnectionManagerOpen(false));
  }, [dispatch]);

  // 关闭终端连接
  const handleCloseConnection = () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null) {
      handleCloseTab(tabIndex);
    }
    handleTabContextMenuClose();
  };

  // 创建远程连接（SSH或Telnet）
  const handleCreateSSHConnection = useCallback((connection) => {
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
    dispatch(actions.setTerminalInstances({
      ...terminalInstances,
      [terminalId]: true,
      [`${terminalId}-config`]: connectionConfigWithTabId, // 将完整的连接配置存储在缓存中
      [`${terminalId}-processId`]: null, // 预留存储进程ID的位置
    }));

    // 添加标签并立即切换到新标签（使用当前tabs长度作为新索引）
    const newTabs = [...tabs, newTab];
    dispatch(actions.setTabs(newTabs));
    dispatch(actions.setCurrentTab(newTabs.length - 1));
  }, [tabs, terminalInstances, dispatch]);

  // 处理从连接管理器或欢迎页打开连接
  const handleOpenConnection = useCallback((connection) => {
    const resolvedConnection = resolveRecentConnection(connection, connections);
    if (!resolvedConnection || resolvedConnection.type !== "connection") {
      return;
    }

    handleCreateSSHConnection(resolvedConnection);
  }, [connections, handleCreateSSHConnection]);

  // 关闭标签页
  const handleCloseTab = (index) => {
    // 不能关闭欢迎页
    if (tabs[index].id === "welcome") return;

    const tabToRemove = tabs[index];

    // 关闭SSH/Telnet连接 - 在清理缓存之前先断开连接
    const processId = processCache[tabToRemove.id];
    if (processId && (tabToRemove.type === 'ssh' || tabToRemove.type === 'telnet')) {
      window.terminalAPI.killProcess(processId).catch((err) => {
        console.warn(`关闭连接时出错: ${err.message}`);
      });
    }

    // 检查文件管理器是否为该标签页打开，如果是则关闭它
    if (fileManagerOpen && (fileManagerProps.tabId === tabToRemove.id || lockedFileManagerTabId === tabToRemove.id)) {
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

      // 使拖动的元素半透明
      if (e.currentTarget) {
        e.currentTarget.style.opacity = "0.5";
      }
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
  const handleDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      dispatch(actions.setDragOverTab(null));
      dispatch(actions.setDragInsertPosition(null));
    }
  }, [dispatch]);

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
      let finalInsertIndex = position === "after" ? targetIndex + 1 : targetIndex;

      // 确保不会插入到欢迎页之前
      if (finalInsertIndex < 1) finalInsertIndex = 1;

      // 如果源标签在目标位置之前，移除源标签后，后面的索引都会减1
      // 所以需要调整最终插入位置
      const adjustedInsertIndex = sourceIndex < finalInsertIndex
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
      } else if (sourceIndex < currentTab && adjustedInsertIndex >= currentTab) {
        // 源在当前之前，目标在当前或之后 -> 当前标签索引减1
        newCurrentTab = currentTab - 1;
      } else if (sourceIndex > currentTab && adjustedInsertIndex <= currentTab) {
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
  const handleDrop = useCallback((e, targetIndex) => {
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
          if (payload?.type === "tab" && typeof payload.tabIndex === "number") {
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

    // 恢复透明度
    if (e.currentTarget) {
      e.currentTarget.style.opacity = "1";
    }
  }, [draggedTabIndex, dragInsertPosition, cleanupDragState, reorderTab]);

  // 处理拖动结束（无论是否成功放置）
  const handleDragEnd = useCallback((e) => {
    if (e.currentTarget) {
      e.currentTarget.style.opacity = "1";
    }
    cleanupDragState();
  }, [cleanupDragState]);

  // 切换资源监控侧边栏
  const toggleResourceMonitor = useCallback(() => {
    dispatch(actions.setResourceMonitorOpen(!resourceMonitorOpen));
    // 如果要打开资源监控侧边栏，确保它显示在上层
    if (!resourceMonitorOpen) {
      dispatch(actions.setLastOpenedSidebar("resource"));
      // 连接管理保持不变
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  }, [resourceMonitorOpen, dispatch]);

  // 关闭资源监控侧边栏
  const handleCloseResourceMonitor = useCallback(() => {
    dispatch(actions.setResourceMonitorOpen(false));
  }, [dispatch]);

  // 切换文件管理侧边栏
  const toggleFileManager = () => {
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
      dispatch(actions.setFileManagerPaths({
        ...fileManagerPaths,
        [tabId]: path,
      }));
    }
  };

  // 获取文件管理记忆路径
  const getFileManagerPath = (tabId) => {
    return fileManagerPaths[tabId] || "/";
  };

  // 添加切换快捷命令侧边栏的函数
  const toggleShortcutCommands = () => {
    dispatch(actions.setShortcutCommandsOpen(!shortcutCommandsOpen));
    if (!shortcutCommandsOpen) {
      dispatch(actions.setLastOpenedSidebar("shortcut"));
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  const handleCloseShortcutCommands = () => {
    dispatch(actions.setShortcutCommandsOpen(false));

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 添加切换历史命令侧边栏的函数
  const toggleCommandHistory = () => {
    dispatch(actions.setCommandHistoryOpen(!commandHistoryOpen));
    if (!commandHistoryOpen) {
      dispatch(actions.setLastOpenedSidebar("history"));
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  const handleCloseCommandHistory = () => {
    dispatch(actions.setCommandHistoryOpen(false));

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 全局AI聊天窗口处理函数
  const handleToggleGlobalAiChatWindow = () => {
    if (aiChatStatus === "visible") {
      dispatch(actions.setAiChatStatus("minimized"));
    } else {
      dispatch(actions.setAiChatStatus("visible"));
      setLastActiveFloatWindow("ai");
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
    dispatch(actions.setIpAddressQueryOpen(!ipAddressQueryOpen));
    if (!ipAddressQueryOpen) {
      dispatch(actions.setLastOpenedSidebar("ipquery"));
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 关闭IP地址查询侧边栏
  const handleCloseIpAddressQuery = () => {
    dispatch(actions.setIpAddressQueryOpen(false));

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 切换随机密码生成器侧边栏
  const toggleSecurityTools = () => {
    dispatch(actions.setSecurityToolsOpen(!securityToolsOpen));
    if (!securityToolsOpen) {
      dispatch(actions.setLastOpenedSidebar("password"));
    }
  };

  // 切换本地终端侧边栏
  const toggleLocalTerminalSidebar = () => {
    setLocalTerminalSidebarOpen(!localTerminalSidebarOpen);
    if (!localTerminalSidebarOpen) {
      dispatch(actions.setLastOpenedSidebar("localTerminal"));
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 关闭本地终端侧边栏
  const handleCloseLocalTerminalSidebar = () => {
    setLocalTerminalSidebarOpen(false);

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
      throw error;
    }
  }, []);

  // 更新关闭所有侧边栏的函数
  const closeAllSidebars = () => {
    dispatch(actions.setConnectionManagerOpen(false));
    dispatch(actions.setResourceMonitorOpen(false));
    dispatch(actions.setFileManagerOpen(false));
    dispatch(actions.setShortcutCommandsOpen(false));
    dispatch(actions.setCommandHistoryOpen(false));
    dispatch(actions.setIpAddressQueryOpen(false));
    dispatch(actions.setSecurityToolsOpen(false));
    setLocalTerminalSidebarOpen(false);

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 获取右侧面板应该使用的当前标签页信息
  const getCurrentPanelTab = useCallback(() => {
    if (currentTab > 0 && tabs[currentTab]) {
      return tabs[currentTab];
    }
    return null;
  }, [tabs, currentTab]);

  // 添加发送快捷命令到终端的函数
  const handleSendCommand = useCallback((command) => {
    const panelTab = getCurrentPanelTab();

    if (panelTab && panelTab.type === "ssh") {
      dispatchCommandToGroup(panelTab.id, command);
      return { success: true };
    } else if (panelTab) {
      console.warn("Current tab is not SSH:", panelTab.type);
      return { success: false, error: "当前标签页不是SSH连接" };
    } else {
      console.warn("No panel tab found");
      return { success: false, error: "请先建立SSH连接" };
    }
  }, [getCurrentPanelTab]);

  // 计算右侧面板的当前标签页信息
  const currentPanelTab = getCurrentPanelTab();

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
    const targetTabId = lockedFileManagerTabId || (currentPanelTab ? currentPanelTab.id : null);

    if (!targetTabId) {
      return {
        tabId: null,
        tabName: null,
        sshConnection: null,
        initialPath: "/",
      };
    }

    // 查找对应的tab
    const targetTab = tabs.find(tab => tab.id === targetTabId);
    if (!targetTab) {
      return {
        tabId: null,
        tabName: null,
        sshConnection: null,
        initialPath: "/",
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
    };
  }, [lockedFileManagerTabId, currentPanelTab, tabs, terminalInstances, fileManagerPaths]);

  // 计算AI聊天窗口的连接信息
  const aiChatConnectionInfo = useMemo(() => {
    if (!currentPanelTab || (currentPanelTab.type !== "ssh" && currentPanelTab.type !== "telnet")) {
      return null;
    }

    const config = terminalInstances[`${currentPanelTab.id}-config`];
    if (!config) {
      return {
        host: currentPanelTab.label,
        type: currentPanelTab.type?.toUpperCase() || 'SSH',
      };
    }

    return {
      host: config.host || currentPanelTab.label,
      port: config.port,
      username: config.username,
      type: currentPanelTab.type?.toUpperCase() || 'SSH',
    };
  }, [currentPanelTab, terminalInstances]);

  // 计算按钮禁用状态
  const isSSHButtonDisabled = useMemo(() => {
    return !currentPanelTab || currentPanelTab.type !== "ssh";
  }, [currentPanelTab]);

  // React 19: 利用自动批处理特性优化设置变更处理
  React.useEffect(() => {
    const handleSettingsChanged = (event) => {
      const { language, fontSize, darkMode: newDarkMode, dnd, transferBarMode: newTransferBarMode } = event.detail;

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
          }
        }
      } catch (error) {
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
              sx={{
                px: 1,
                minHeight: "34px",
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                WebkitAppRegion: "drag",
              }}
            >
              <IconButton
                edge="start"
                color="inherit"
                aria-label="menu"
                sx={{ mr: 1, WebkitAppRegion: "no-drag" }}
                onClick={handleMenu}
              >
                <AppsIcon />
              </IconButton>
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
              sx={{
                display: "flex",
                alignItems: "center",
                minHeight: "40px",
                px: 1,
                pb: 0.5,
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
                  scrollButtons="auto"
                  sx={{
                    flexGrow: 1,
                    minWidth: 0,
                    minHeight: 40,
                    "& .MuiTabs-indicator": {
                      height: 3,
                      backgroundColor: "primary.main",
                      borderRadius: "1.5px 1.5px 0 0",
                    },
                  }}
                >
                  {tabs.map((tab, index) => {
                    const label =
                      index === 0
                        ? t("terminal.welcome")
                        : tab.label || tab.title || "";

                    return (
                      <CustomTab
                        key={tab.id}
                        label={label}
                        onClose={
                          tab.id !== "welcome"
                            ? () => handleCloseTab(index)
                            : null
                        }
                        onContextMenu={(e) =>
                          handleTabContextMenu(e, index, tab.id)
                        }
                        draggable={dndEnabled && tab.id !== "welcome"}
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={(e) => handleDragOver(e, index)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, index)}
                        onDragEnd={handleDragEnd}
                        value={index}
                        selected={currentTab === index}
                        index={index}
                        tabId={tab.id}
                        isDraggedOver={
                          draggedTabIndex !== null &&
                          dragOverTabIndex === index &&
                          draggedTabIndex !== index
                        }
                        dragInsertPosition={
                          draggedTabIndex !== null &&
                          dragOverTabIndex === index
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
                    <AddCircleOutlineIcon fontSize="small" sx={{ mr: 1 }} />
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

          {/* 右侧边栏容器 */}
          <Box
            sx={{
              position: "relative",
              height: "100%",
              display: "flex",
              flexShrink: 0,
              flexDirection: "row",
              zIndex: 90,
            }}
          >
            {/* 侧边栏内容区域 - 根据是否有侧边栏打开来显示 */}
            <Box
              sx={{
                width: `${
                  activeSidebarMargin > SIDEBAR_WIDTHS.SIDEBAR_BUTTONS_WIDTH
                    ? activeSidebarMargin - SIDEBAR_WIDTHS.SIDEBAR_BUTTONS_WIDTH
                    : 0
                }px`,
                height: "100%",
                position: "relative",
                transition: "width 0.25s ease-out",
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
                {resourceMonitorOpen && (
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
                {connectionManagerOpen && (
                  <ConnectionManager
                    open={connectionManagerOpen}
                    onClose={handleCloseConnectionManager}
                    initialConnections={connections}
                    onConnectionsUpdate={handleConnectionsUpdate}
                    onOpenConnection={handleOpenConnection}
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
                {fileManagerOpen && (
                  <FileManager
                    open={fileManagerOpen}
                    onClose={handleCloseFileManager}
                    tabId={fileManagerProps.tabId}
                    tabName={fileManagerProps.tabName}
                    sshConnection={fileManagerProps.sshConnection}
                    initialPath={fileManagerProps.initialPath}
                    onPathChange={updateFileManagerPath}
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
                {shortcutCommandsOpen && (
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
                {commandHistoryOpen && (
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
                {ipAddressQueryOpen && (
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
                {securityToolsOpen && (
                  <SecurityTools
                    open={securityToolsOpen}
                    onClose={() => dispatch(actions.setSecurityToolsOpen(false))}
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
                {localTerminalSidebarOpen && (
                  <LocalTerminalSidebar
                    open={localTerminalSidebarOpen}
                    onClose={handleCloseLocalTerminalSidebar}
                    onLaunchTerminal={handleLaunchLocalTerminal}
                  />
                )}
              </Box>
            </Box>

            {/* 右侧边栏按钮栏 */}
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
              <Tooltip title={t("sidebar.theme")} placement="left">
                <IconButton onClick={toggleTheme} color="primary">
                  {darkMode ? <DarkModeIcon /> : <LightModeIcon />}
                </IconButton>
              </Tooltip>

              {/* 资源监控按钮 */}
              <Tooltip title={t("sidebar.monitor")} placement="left">
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
                >
                  <MonitorHeartIcon />
                </IconButton>
              </Tooltip>

              {/* 连接管理按钮 */}
              <Tooltip title={t("sidebar.connections")} placement="left">
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
                >
                  <LinkIcon />
                </IconButton>
              </Tooltip>

              {/* 文件管理按钮 */}
              <Tooltip title={t("sidebar.files")} placement="left">
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
                  disabled={isSSHButtonDisabled}
                >
                  <FolderIcon />
                </IconButton>
              </Tooltip>

              {/* 快捷命令按钮 - 应该放在文件按钮的后面 */}
              <Tooltip title={t("sidebar.shortcutCommands")} placement="left">
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
                >
                  <TerminalIcon />
                </IconButton>
              </Tooltip>

              {/* 历史命令按钮 */}
              <Tooltip title={t("sidebar.history")} placement="left">
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
                >
                  <HistoryIcon />
                </IconButton>
              </Tooltip>

              {/* IP地址查询按钮 */}
              <Tooltip title={t("sidebar.ipQuery")} placement="left">
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
                >
                  <PublicIcon />
                </IconButton>
              </Tooltip>

              {/* 安全工具按钮 */}
              <Tooltip title={t("sidebar.securityTool")} placement="left">
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
                >
                  <VpnKeyIcon />
                </IconButton>
              </Tooltip>

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
              <Tooltip title={t("sidebar.localTerminal")} placement="left">
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
                >
                  <ComputerIcon />
                </IconButton>
              </Tooltip>

              {/* 传输侧边栏按钮 - 仅在sidebar模式下显示 */}
              {transferBarMode === "sidebar" && (
                <TransferSidebarButton
                  isOpen={transferSidebarOpen}
                  onClick={() => {
                    const newState = !transferSidebarOpen;
                    setTransferSidebarOpen(newState);
                    if (newState) {
                      setLastActiveFloatWindow("transfer");
                    }
                  }}
                  tooltip="文件传输"
                />
              )}

              {/* AI助手按钮 */}
              <Tooltip title={t("sidebar.ai")} placement="left">
                <IconButton
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
                >
                  <AIIcon />
                  {/* 最小化状态指示灯 */}
                  {aiChatStatus === "minimized" && (
                    <Box
                      sx={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        bgcolor: "#4caf50",
                        boxShadow: "0 0 4px #4caf50",
                      }}
                    />
                  )}
                </IconButton>
              </Tooltip>
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
      />

      {/* 文件传输浮动窗口 - 仅在sidebar模式下显示 */}
      {transferBarMode === "sidebar" && (
        <TransferSidebar
          open={transferSidebarOpen}
          onClose={() => setTransferSidebarOpen(false)}
          zIndex={lastActiveFloatWindow === "transfer" ? 1310 : 1300}
          onFocus={() => setLastActiveFloatWindow("transfer")}
        />
      )}

      {/* 关于对话框 */}
      <AboutDialog open={aboutDialogOpen} onClose={handleCloseAbout} />

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
