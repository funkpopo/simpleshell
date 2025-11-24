import * as React from "react";
import { memo, useCallback, useMemo, useRef } from "react";
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

  // ============ 保持本地状态（不在 reducer 中）============
  const [localTerminalSidebarOpen, setLocalTerminalSidebarOpen] = React.useState(false);
  const [prevTabsLength, setPrevTabsLength] = React.useState(tabs.length);

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

  React.useEffect(() => {
    if (tabs.length > prevTabsLength) {
      dispatch(actions.setCurrentTab(tabs.length - 1));
    }
    setPrevTabsLength(tabs.length);
  }, [tabs, dispatch, prevTabsLength]);

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
    const findConnectionsByIds = (ids, allConnections) => {
      const found = [];
      const search = (items) => {
        for (const item of items) {
          if (item.type === "group") {
            search(item.items || []);
          } else if (ids.includes(item.id)) {
            found.push(item);
          }
        }
      };
      search(allConnections);
      // Preserve the order from the ids array
      return ids.map((id) => found.find((c) => c.id === id)).filter(Boolean);
    };

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
              dispatch(actions.setTopConnections(lastConnectionObjs));
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
    const findConnectionsByIds = (ids, allConnections) => {
      const found = [];
      const search = (items) => {
        for (const item of items) {
          if (item.type === "group") {
            search(item.items || []);
          } else if (ids.includes(item.id)) {
            found.push(item);
          }
        }
      };
      search(allConnections);
      return ids.map((id) => found.find((c) => c.id === id)).filter(Boolean);
    };

    if (window.terminalAPI?.loadTopConnections) {
      window.terminalAPI
        .loadTopConnections()
        .then((lastConnectionObjs) => {
          if (Array.isArray(lastConnectionObjs) && lastConnectionObjs.length > 0) {
            // lastConnectionObjs 现在是完整的连接对象数组
            // 只有当计算出的列表与当前状态不同时才更新，避免不必要的渲染
            if (JSON.stringify(lastConnectionObjs) !== JSON.stringify(topConnections)) {
              dispatch(actions.setTopConnections(lastConnectionObjs));
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

    const findConnectionsByIds = (ids, allConnections) => {
      const found = [];
      const search = (items) => {
        for (const item of items) {
          if (item.type === "group") {
            search(item.items || []);
          } else if (ids.includes(item.id)) {
            found.push(item);
          }
        }
      };
      search(allConnections);
      return ids.map((id) => found.find((c) => c.id === id)).filter(Boolean);
    };

    const handleTopChanged = async (lastConnectionObjs) => {
      try {
        // lastConnectionObjs 现在是完整的连接对象数组，不再是ID数组
        const connections = Array.isArray(lastConnectionObjs)
          ? lastConnectionObjs
          : await window.terminalAPI.loadTopConnections();
        dispatch(actions.setTopConnections(connections));
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
  const handleCreateSSHConnection = (connection) => {
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

    // 添加标签并切换到新标签
    dispatch(actions.setTabs([...tabs, newTab]));
  };

  // 处理从连接管理器打开连接
  const handleOpenConnection = (connection) => {
    if (connection && connection.type === "connection") {
      handleCreateSSHConnection(connection);
    }
  };

  // 关闭标签页
  const handleCloseTab = (index) => {
    // 不能关闭欢迎页
    if (tabs[index].id === "welcome") return;

    const tabToRemove = tabs[index];

    // 检查文件管理器是否为该标签页打开，如果是则关闭它
    if (fileManagerOpen && fileManagerProps.tabId === tabToRemove.id) {
      dispatch(actions.setFileManagerOpen(false));
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

      dispatch(actions.setDraggedTabIndex(index));
      // 设置一些拖动时的数据
      e.dataTransfer.effectAllowed = "move";

      // 不再设置text/plain数据，因为CustomTab已经设置了application/json
      // e.dataTransfer.setData("text/plain", index);

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
      if (index === 0) return;
      if (draggedTabIndex === null || draggedTabIndex === index) return;

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
            dispatch(actions.setDragOverTabIndex(pending.index));
            dispatch(actions.setDragInsertPosition(pending.position));
          }
        });
      }
    },
    [draggedTabIndex, dragOverTabIndex, dragInsertPosition, dispatch],
  );

  // 处理拖动离开
  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      dispatch(actions.setDragOverTabIndex(null));
      dispatch(actions.setDragInsertPosition(null));
    }
  };

  // 处理放置 - 仅支持排序
  const handleDrop = (e, targetIndex) => {
    e.preventDefault();

    if (targetIndex === 0) return;

    const cleanupDragState = () => {
      dispatch(actions.setDraggedTabIndex(null));
      dispatch(actions.setDragOverTabIndex(null));
      dispatch(actions.setDragInsertPosition(null));
      if (e.currentTarget) {
        e.currentTarget.style.opacity = "1";
      }
    };

    let sourceIndex = draggedTabIndex;

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

    if (sourceIndex === null) {
      cleanupDragState();
      return;
    }

    if (sourceIndex === targetIndex) {
      cleanupDragState();
      return;
    }

    const rect = e.currentTarget?.getBoundingClientRect();
    const positionFromEvent = rect
      ? e.clientX - rect.left <= rect.width / 2
        ? "before"
        : "after"
      : "after";
    const position = dragInsertPosition || positionFromEvent;

    let insertIndex = targetIndex;
    if (position === "after") {
      insertIndex = targetIndex + 1;
    }

    reorderTab(sourceIndex, insertIndex);
    cleanupDragState();
  };

  // 处理拖动结束（无论是否成功放置）
  const handleDragEnd = (e) => {
    if (e.currentTarget) {
      e.currentTarget.style.opacity = "1";
    }
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    pendingDragStateRef.current = null;
    dispatch(actions.setDraggedTabIndex(null));
    dispatch(actions.setDragOverTabIndex(null));
    dispatch(actions.setDragInsertPosition(null));
  };

  // 标签排序功能
  const reorderTab = useCallback(
    (sourceIndex, targetIndex) => {
      if (sourceIndex === targetIndex || !tabs[sourceIndex]) return;

      // 不能移动欢迎页
      if (tabs[sourceIndex].id === "welcome") return;

      const newTabs = [...tabs];
      const [draggedTab] = newTabs.splice(sourceIndex, 1);

      // 调整插入位置
      const adjustedTargetIndex =
        sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      newTabs.splice(adjustedTargetIndex, 0, draggedTab);

      dispatch(actions.setTabs(newTabs));

      // 更新当前标签页索引
      if (currentTab === sourceIndex) {
        dispatch(actions.setCurrentTab(adjustedTargetIndex));
      } else if (
        currentTab > sourceIndex &&
        currentTab <= adjustedTargetIndex
      ) {
        dispatch(actions.setCurrentTab(currentTab - 1));
      } else if (
        currentTab < sourceIndex &&
        currentTab >= adjustedTargetIndex
      ) {
        dispatch(actions.setCurrentTab(currentTab + 1));
      }
    },
    [tabs, currentTab, dispatch],
  );

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
    dispatch(actions.setFileManagerOpen(!fileManagerOpen));
    // 如果要打开文件管理侧边栏，确保它显示在上层
    if (!fileManagerOpen) {
      dispatch(actions.setLastOpenedSidebar("file"));
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 关闭文件管理侧边栏
  const handleCloseFileManager = () => {
    dispatch(actions.setFileManagerOpen(false));

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
    dispatch(actions.setAiChatStatus(
      aiChatStatus === "visible" ? "closed" : "visible"
    ));
  };

  const handleCloseGlobalAiChatWindow = () => {
    dispatch(actions.setAiChatStatus("closed"));
    // 清除预设输入值
    dispatch(actions.setAiInputPreset(""));
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

  // 添加发送快捷命令到终端的函数
  const handleSendCommand = (command) => {
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
  };

  // 获取右侧面板应该使用的当前标签页信息
  const getCurrentPanelTab = useCallback(() => {
    if (currentTab > 0 && tabs[currentTab]) {
      return tabs[currentTab];
    }
    return null;
  }, [tabs, currentTab]);

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

  // 计算文件管理器的props
  const fileManagerProps = useMemo(() => {
    if (!currentPanelTab) {
      return {
        tabId: null,
        tabName: null,
        sshConnection: null,
        initialPath: "/",
      };
    }

    return {
      tabId: currentPanelTab.id,
      tabName: currentPanelTab.label,
      sshConnection:
        currentPanelTab.type === "ssh"
          ? terminalInstances[`${currentPanelTab.id}-config`]
          : null,
      initialPath: getFileManagerPath(currentPanelTab.id),
    };
  }, [currentPanelTab, terminalInstances]);

  // 计算按钮禁用状态
  const isSSHButtonDisabled = useMemo(() => {
    return !currentPanelTab || currentPanelTab.type !== "ssh";
  }, [currentPanelTab]);

  // React 19: 利用自动批处理特性优化设置变更处理
  React.useEffect(() => {
    const handleSettingsChanged = (event) => {
      const { language, fontSize, darkMode: newDarkMode } = event.detail;

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
    };

    // 处理欢迎页AI按钮点击事件
    const handleToggleGlobalAI = () => {
      handleToggleGlobalAiChatWindow();
    };

    // 监听发送到AI助手事件
    const handleSendToAIEvent = (event) => {
      handleSendToAI(event.detail.text);
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
    };
  }, [darkMode, dispatch]); // 添加 darkMode 和 dispatch 依赖

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
              theme.palette.mode === "light" ? "#ffffff" : "background.paper",
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
          }}
        >
          {/* 主内容区域 */}
          <Box
            sx={{
              flexGrow: 1,
              overflow: "hidden",
              p: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* 标签页内容 */}
            <Box
              sx={{
                flexGrow: 1,
                height: "100%",
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

              {/* AI助手按钮 */}
              <Tooltip title={t("sidebar.ai")} placement="left">
                <IconButton
                  color="primary"
                  onClick={handleToggleGlobalAiChatWindow}
                  sx={{
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
                </IconButton>
              </Tooltip>
            </Paper>
          </Box>
        </Box>
      </Box>

      {/* 全局AI聊天窗口 */}
      <AIChatWindow
        windowState={aiChatStatus}
        onClose={handleCloseGlobalAiChatWindow}
        presetInput={aiInputPreset}
        onInputPresetUsed={() => dispatch(actions.setAiInputPreset(""))}
      />

      {/* 关于对话框 */}
      <AboutDialog open={aboutDialogOpen} onClose={handleCloseAbout} />

      {/* 设置对话框 */}
      <Settings open={settingsDialogOpen} onClose={handleCloseSettings} />

      {/* 错误通知 */}
      <ErrorNotification
        error={appError}
        open={errorNotificationOpen}
        onClose={handleCloseErrorNotification}
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
