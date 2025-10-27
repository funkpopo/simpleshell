import * as React from "react";
import { memo, useCallback, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import { createUnifiedTheme } from "./theme";
import CssBaseline from "@mui/material/CssBaseline";
import { GlobalErrorBoundary } from "./components/ErrorBoundary.jsx";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tabs from "@mui/material/Tabs";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import CircularProgress from "@mui/material/CircularProgress";
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
import {
  ResourceMonitorWithSuspense as ResourceMonitor,
  FileManagerWithSuspense as FileManager,
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
// Import i18n configuration
import { useTranslation } from "react-i18next";
import "./i18n/i18n";
import { changeLanguage } from "./i18n/i18n";
import "./styles/index.css";
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

// 自定义磨砂玻璃效果的Dialog组件
const GlassDialog = styled(Dialog)(({ theme }) => ({
  "& .MuiDialog-paper": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(40, 44, 52, 0.75)"
        : "rgba(255, 255, 255, 0.75)",
    backdropFilter: "blur(10px)",
    boxShadow:
      theme.palette.mode === "dark"
        ? "0 8px 32px 0 rgba(0, 0, 0, 0.37)"
        : "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
    border: "1px solid rgba(255, 255, 255, 0.18)",
  },
}));

// 关于对话框组件
const AboutDialog = memo(function AboutDialog({ open, onClose }) {
  const { t } = useTranslation();
  const [checkingForUpdate, setCheckingForUpdate] = React.useState(false);
  const [updateStatus, setUpdateStatus] = React.useState(null);
  const [appVersion, setAppVersion] = React.useState("1.0.0");
  const [latestRelease, setLatestRelease] = React.useState(null);

  // 获取应用版本
  React.useEffect(() => {
    if (window.terminalAPI?.getAppVersion) {
      const versionPromise = window.terminalAPI.getAppVersion();
      if (versionPromise instanceof Promise) {
        versionPromise.then((version) => setAppVersion(version));
      } else {
        // 如果不是Promise，可能是直接返回的版本字符串
        setAppVersion(versionPromise || "1.0.0");
      }
    }
  }, []);

  // 在外部浏览器打开链接
  const handleOpenExternalLink = useCallback(
    (url) => {
      if (window.terminalAPI?.openExternal) {
        window.terminalAPI.openExternal(url).catch((error) => {
          alert(t("app.cannotOpenLinkAlert", { url }));
        });
      } else {
        // 降级方案：尝试使用window.open
        window.open(url, "_blank");
      }
    },
    [t],
  );

  const handleCheckForUpdate = useCallback(() => {
    setCheckingForUpdate(true);
    setUpdateStatus(t("about.checkingUpdate"));

    if (!window.terminalAPI?.checkForUpdate) {
      setUpdateStatus(t("about.updateNotAvailable"));
      setCheckingForUpdate(false);
      return;
    }

    window.terminalAPI
      .checkForUpdate()
      .then((result) => {
        if (!result.success) {
          throw new Error(result.error || t("app.unknownUpdateError"));
        }

        const releaseData = result.data;
        setLatestRelease(releaseData);

        const latestVersion = releaseData.tag_name;
        const currentVersion = appVersion;

        // 去掉版本号前面的'v'字符进行比较
        const latestVersionNumber = latestVersion.replace(/^v/, "");
        const currentVersionNumber = currentVersion.replace(/^v/, "");

        if (latestVersionNumber > currentVersionNumber) {
          setUpdateStatus(t("about.newVersion", { version: latestVersion }));
        } else {
          setUpdateStatus(t("about.latestVersion"));
        }
      })
      .catch((error) => {
        setUpdateStatus(t("about.updateError", { error: error.message }));
      })
      .finally(() => {
        setCheckingForUpdate(false);
      });
  }, [t, appVersion]);

  return (
    <GlassDialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("about.title")}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            SimpleShell
          </Typography>
          <Typography variant="body1" gutterBottom>
            {t("about.version")}: {appVersion}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("about.description")}
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
            {t("about.author")}
          </Typography>
          <Typography variant="body2">{t("about.author")}: funkpopo</Typography>
          <Typography variant="body2">
            {t("about.email")}:{" "}
            <Link
              href="#"
              onClick={(e) => {
                e.preventDefault();
                handleOpenExternalLink("mailto:s767609509@gmail.com");
              }}
            >
              s767609509@gmail.com
            </Link>
          </Typography>

          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle1" gutterBottom>
              {t("about.updateCheck")}
            </Typography>
            {updateStatus && (
              <Typography
                variant="body2"
                color={
                  updateStatus === t("about.latestVersion")
                    ? "success.main"
                    : "text.secondary"
                }
              >
                {updateStatus}
              </Typography>
            )}
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <Button
                variant="outlined"
                onClick={handleCheckForUpdate}
                disabled={checkingForUpdate}
                startIcon={
                  checkingForUpdate ? <CircularProgress size={16} /> : null
                }
              >
                {t("about.checkUpdateButton")}
              </Button>

              {latestRelease && latestRelease.html_url && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => handleOpenExternalLink(latestRelease.html_url)}
                >
                  {t("about.viewLatestButton")}
                </Button>
              )}
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("about.close")}</Button>
        <Button
          onClick={() =>
            handleOpenExternalLink(
              "https://github.com/funkpopo/simpleshell/releases",
            )
          }
        >
          {t("about.visitGithub")}
        </Button>
      </DialogActions>
    </GlassDialog>
  );
});

AboutDialog.displayName = "AboutDialog";

function App() {
  const LATENCY_INFO_MIN_WIDTH = 150;
  const { t, i18n } = useTranslation();
  const eventManager = useEventManager(); // 使用统一的事件管理器
  const [activeSidebarMargin, setActiveSidebarMargin] = React.useState(0);

  // Update the tabs when language changes
  React.useEffect(() => {
    // Update welcome tab label when language changes
    setTabs((prevTabs) => [
      { ...prevTabs[0], label: t("terminal.welcome") },
      ...prevTabs.slice(1),
    ]);
  }, [i18n.language, t]);

  // 加载主题设置
  React.useEffect(() => {
    const loadThemeSettings = async () => {
      try {
        setThemeLoading(true);
        if (window.terminalAPI?.loadUISettings) {
          const settings = await window.terminalAPI.loadUISettings();
          if (settings && settings.darkMode !== undefined) {
            setDarkMode(settings.darkMode);
          }
        }
      } catch (error) {
        // 如果加载失败，尝试从 localStorage 恢复作为备选
        const fallbackTheme = localStorage.getItem("terminalDarkMode");
        if (fallbackTheme !== null) {
          setDarkMode(fallbackTheme === "true");
        }
      } finally {
        setThemeLoading(false);
      }
    };

    loadThemeSettings();
  }, []);

  // 状态管理菜单打开关闭
  const [anchorEl, setAnchorEl] = React.useState(null);
  const open = Boolean(anchorEl);

  // 关于对话框状态
  const [aboutDialogOpen, setAboutDialogOpen] = React.useState(false);

  // 标签页右键菜单
  const [tabContextMenu, setTabContextMenu] = React.useState({
    mouseX: null,
    mouseY: null,
    tabIndex: null,
    tabId: null,
  });

  const tabsRef = useRef(null);

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

  // 拖动标签状态
  const [draggedTabIndex, setDraggedTabIndex] = React.useState(null);
  const [dragOverTabIndex, setDragOverTabIndex] = React.useState(null);
  const [dragInsertPosition, setDragInsertPosition] = React.useState(null);
  const dragRafRef = React.useRef(null);
  const pendingDragStateRef = React.useRef(null);

  // 主题模式状态
  const [darkMode, setDarkMode] = React.useState(true); // 默认值
  const [themeLoading, setThemeLoading] = React.useState(true); // 主题加载状态

  // 标签页状态
  const [tabs, setTabs] = React.useState([
    { id: "welcome", label: t("terminal.welcome") },
  ]);
  const [currentTab, setCurrentTab] = React.useState(0);

  React.useEffect(() => {
    const tabsRoot = tabsRef.current;
    if (!tabsRoot) {
      return undefined;
    }

    const scroller = tabsRoot.querySelector(".MuiTabs-scroller");
    if (!scroller) {
      return undefined;
    }

    scroller.addEventListener("wheel", handleTabsWheel, { passive: false });

    return () => {
      scroller.removeEventListener("wheel", handleTabsWheel);
    };
  }, [handleTabsWheel]);

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

  // 存储终端实例的缓存
  const [terminalInstances, setTerminalInstances] = React.useState({
    usePowershell: false,
  });

  // 连接管理侧边栏状态
  const [connectionManagerOpen, setConnectionManagerOpen] =
    React.useState(false);

  // 资源监控侧边栏状态
  const [resourceMonitorOpen, setResourceMonitorOpen] = React.useState(false);

  // 文件管理侧边栏状态
  const [fileManagerOpen, setFileManagerOpen] = React.useState(false);

  // IP地址查询侧边栏状态
  const [ipAddressQueryOpen, setIpAddressQueryOpen] = React.useState(false);

  // 随机密码生成器侧边栏状态
  const [securityToolsOpen, setSecurityToolsOpen] = React.useState(false);

  // 本地终端侧边栏状态
  const [localTerminalSidebarOpen, setLocalTerminalSidebarOpen] =
    React.useState(false);

  // 文件管理路径记忆状态 - 为每个SSH连接记住最后访问的路径
  const [fileManagerPaths, setFileManagerPaths] = React.useState({});

  // 最后打开的侧边栏（用于确定z-index层级）
  const [lastOpenedSidebar, setLastOpenedSidebar] = React.useState(null);

  // 连接配置状态
  const [connections, setConnections] = React.useState([]);
  const [topConnections, setTopConnections] = React.useState([]);

  // 设置对话框状态
  const [settingsDialogOpen, setSettingsDialogOpen] = React.useState(false);

  // 添加快捷命令侧边栏状态
  const [shortcutCommandsOpen, setShortcutCommandsOpen] = React.useState(false);

  // 历史命令侧边栏状态
  const [commandHistoryOpen, setCommandHistoryOpen] = React.useState(false);

  // 进程缓存状态，用于管理SSH连接进程ID
  const [processCache, setProcessCache] = React.useState({});

  // 全局AI聊天窗口状态
  const [globalAiChatWindowState, setGlobalAiChatWindowState] =
    React.useState("closed"); // 'visible', 'closed'

  // AI助手预设输入值
  const [aiInputPreset, setAiInputPreset] = React.useState("");

  const [prevTabsLength, setPrevTabsLength] = React.useState(tabs.length);

  React.useEffect(() => {
    if (tabs.length > prevTabsLength) {
      setCurrentTab(tabs.length - 1);
    }
    setPrevTabsLength(tabs.length);
  }, [tabs]);

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

    setActiveSidebarMargin(calculatedMargin);

    // 触发自定义事件，通知WebTerminal组件进行侧边栏变化适配
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
    }, 10);
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
            setConnections(loadedConnections);

            const topConnectionIds =
              (await window.terminalAPI.loadTopConnections()) || [];
            if (
              Array.isArray(topConnectionIds) &&
              topConnectionIds.length > 0
            ) {
              const topConns = findConnectionsByIds(
                topConnectionIds,
                loadedConnections,
              );
              setTopConnections(topConns);
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
        preloadComponents.fileManager().catch(() => {});
        preloadComponents.ipAddressQuery().catch(() => {});
      }, 2000);
    }, 3000);

    // 添加监听器，接收SSH进程ID更新事件
    const handleSshProcessIdUpdate = (event) => {
      const { terminalId, processId } = event.detail;
      if (terminalId && processId) {
        // 更新终端实例中的进程ID
        setTerminalInstances((prev) => ({
          ...prev,
          [`${terminalId}-processId`]: processId,
        }));

        // 更新进程缓存
        setProcessCache((prev) => ({
          ...prev,
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
        .then((topConnectionIds) => {
          if (Array.isArray(topConnectionIds) && topConnectionIds.length > 0) {
            const topConns = findConnectionsByIds(
              topConnectionIds,
              connections,
            );
            // 只有当计算出的列表与当前状态不同时才更新，避免不必要的渲染
            if (JSON.stringify(topConns) !== JSON.stringify(topConnections)) {
              setTopConnections(topConns);
            }
          }
        })
        .catch((error) => {
          // 处理加载置顶连接失败的情况
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

    const handleTopChanged = async (ids) => {
      try {
        const topIds = Array.isArray(ids)
          ? ids
          : await window.terminalAPI.loadTopConnections();
        const mapped = findConnectionsByIds(topIds, connections);
        setTopConnections(mapped);
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
    setConnections(updatedConnections);
    if (window.terminalAPI && window.terminalAPI.saveConnections) {
      window.terminalAPI.saveConnections(updatedConnections);
    }
  }, []);

  // 创建动态主题
  const theme = React.useMemo(() => createUnifiedTheme(darkMode), [darkMode]);

  // 处理菜单打开
  const handleMenu = useCallback((event) => {
    setAnchorEl(event.currentTarget);
  }, []);

  // 处理菜单关闭
  const handleClose = useCallback(() => {
    setAnchorEl(null);
  }, []);

  // 打开关于对话框
  const handleOpenAbout = useCallback(() => {
    setAnchorEl(null);
    setAboutDialogOpen(true);
  }, []);

  // 关闭关于对话框
  const handleCloseAbout = useCallback(() => {
    setAboutDialogOpen(false);
  }, []);

  // 打开设置对话框
  const handleOpenSettings = useCallback(() => {
    setAnchorEl(null);
    setSettingsDialogOpen(true);
  }, []);

  // 关闭设置对话框
  const handleCloseSettings = useCallback(() => {
    setSettingsDialogOpen(false);
  }, []);

  // 处理应用退出
  const handleExit = useCallback(() => {
    if (window.terminalAPI && window.terminalAPI.closeApp) {
      window.terminalAPI.closeApp();
    }
    setAnchorEl(null);
  }, []);

  // 切换主题模式
  const toggleTheme = useCallback(async () => {
    try {
      const newDarkMode = !darkMode;

      // 添加CSS类以启用过渡效果
      document.body.classList.add("theme-transition");

      // 设置新的主题模式（延迟一点执行以确保过渡效果可以被触发）
      setTimeout(() => {
        setDarkMode(newDarkMode);
      }, 10);

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
  }, [darkMode]);

  // 标签页相关函数
  const handleTabChange = useCallback(
    (event, newValue) => {
      setCurrentTab(newValue);

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
    [tabs],
  );

  // 标签页右键菜单打开
  const handleTabContextMenu = useCallback(
    (event, index, tabId) => {
      event.preventDefault();
      // 欢迎页不显示右键菜单
      if (tabs[index].id === "welcome") return;

      setTabContextMenu({
        mouseX: event.clientX - 2,
        mouseY: event.clientY - 4,
        tabIndex: index,
        tabId: tabId,
      });
    },
    [tabs],
  );

  // 标签页右键菜单关闭
  const handleTabContextMenuClose = useCallback(() => {
    setTabContextMenu({
      mouseX: null,
      mouseY: null,
      tabIndex: null,
      tabId: null,
    });
  }, []);

  // 刷新终端连接
  const handleRefreshTerminal = async () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null && tabIndex < tabs.length) {
      const tabId = tabs[tabIndex].id;

      // 先关闭所有侧边栏以避免连接错误
      setResourceMonitorOpen(false);
      setFileManagerOpen(false);
      setIpAddressQueryOpen(false);

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
      setTerminalInstances((prev) => {
        const newInstances = { ...prev };
        delete newInstances[tabId];
        return newInstances;
      });

      // 添加新实例标记，触发WebTerminal重新创建
      setTimeout(() => {
        setTerminalInstances((prev) => ({
          ...prev,
          [tabId]: true,
          [`${tabId}-refresh`]: Date.now(), // 添加时间戳确保组件被重新渲染
        }));
      }, 100);
    }

    handleTabContextMenuClose();
  };

  // 切换连接管理侧边栏
  const toggleConnectionManager = useCallback(() => {
    setConnectionManagerOpen(!connectionManagerOpen);
    // 如果要打开连接管理侧边栏，确保它显示在上层
    if (!connectionManagerOpen) {
      setLastOpenedSidebar("connection");
      setResourceMonitorOpen((prev) => {
        // 如果资源监控已打开，不关闭它，只确保z-index关系
        return prev;
      });
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  }, [connectionManagerOpen]);

  // 关闭连接管理侧边栏
  const handleCloseConnectionManager = useCallback(() => {
    setConnectionManagerOpen(false);
  }, []);

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
    setTerminalInstances((prev) => ({
      ...prev,
      [terminalId]: true,
      [`${terminalId}-config`]: connectionConfigWithTabId, // 将完整的连接配置存储在缓存中
      [`${terminalId}-processId`]: null, // 预留存储进程ID的位置
    }));

    // 添加标签并切换到新标签
    setTabs((prevTabs) => [...prevTabs, newTab]);
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
      setFileManagerOpen(false);
    }

    // 检查资源监控是否为该标签页打开，如果是则关闭它
    if (
      resourceMonitorOpen &&
      currentPanelTab &&
      currentPanelTab.id === tabToRemove.id
    ) {
      setResourceMonitorOpen(false);
    }

    // 从缓存中移除对应的终端实例
    setTerminalInstances((prev) => {
      const newInstances = { ...prev };
      delete newInstances[tabToRemove.id];
      delete newInstances[`${tabToRemove.id}-config`];
      delete newInstances[`${tabToRemove.id}-processId`];
      delete newInstances[`${tabToRemove.id}-refresh`];
      return newInstances;
    });

    // 清理进程缓存
    setProcessCache((prev) => {
      const newCache = { ...prev };
      delete newCache[tabToRemove.id];
      return newCache;
    });

    // 清理文件管理路径记忆
    setFileManagerPaths((prev) => {
      const newPaths = { ...prev };
      delete newPaths[tabToRemove.id];
      return newPaths;
    });

    const newTabs = tabs.filter((_, i) => i !== index);
    setTabs(newTabs);

    // 如果关闭的是当前标签页，则选择相邻的非欢迎页标签（若存在）
    if (currentTab === index) {
      // newTabs 始终包含欢迎页（索引0）。当 newTabs.length > 1 时，说明仍有其他标签。
      if (newTabs.length > 1) {
        // 选择同位置的标签（若存在），否则选择前一个，但最小为1，避免退回欢迎页
        const target = Math.min(index, newTabs.length - 1);
        setCurrentTab(Math.max(1, target));
      } else {
        // 仅剩欢迎页
        setCurrentTab(0);
      }
    } else if (currentTab > index) {
      // 如果关闭的标签在当前标签之前，当前标签索引需要减1
      const nextIndex = currentTab - 1;
      // 若仍存在其他标签，则避免落到0（欢迎页）
      if (newTabs.length > 1) {
        setCurrentTab(Math.max(1, nextIndex));
      } else {
        setCurrentTab(0);
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

      setDraggedTabIndex(index);
      // 设置一些拖动时的数据
      e.dataTransfer.effectAllowed = "move";

      // 不再设置text/plain数据，因为CustomTab已经设置了application/json
      // e.dataTransfer.setData("text/plain", index);

      // 使拖动的元素半透明
      if (e.currentTarget) {
        e.currentTarget.style.opacity = "0.5";
      }
    },
    [tabs],
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
            setDragOverTabIndex(pending.index);
            setDragInsertPosition(pending.position);
          }
        });
      }
    },
    [draggedTabIndex, dragOverTabIndex, dragInsertPosition],
  );

  // 处理拖动离开
  const handleDragLeave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverTabIndex(null);
      setDragInsertPosition(null);
    }
  };

  // 处理放置 - 仅支持排序
  const handleDrop = (e, targetIndex) => {
    e.preventDefault();

    if (targetIndex === 0) return;

    const cleanupDragState = () => {
      setDraggedTabIndex(null);
      setDragOverTabIndex(null);
      setDragInsertPosition(null);
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
    setDraggedTabIndex(null);
    setDragOverTabIndex(null);
    setDragInsertPosition(null);
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

      setTabs(newTabs);

      // 更新当前标签页索引
      if (currentTab === sourceIndex) {
        setCurrentTab(adjustedTargetIndex);
      } else if (
        currentTab > sourceIndex &&
        currentTab <= adjustedTargetIndex
      ) {
        setCurrentTab(currentTab - 1);
      } else if (
        currentTab < sourceIndex &&
        currentTab >= adjustedTargetIndex
      ) {
        setCurrentTab(currentTab + 1);
      }
    },
    [tabs, currentTab],
  );

  // 切换资源监控侧边栏
  const toggleResourceMonitor = useCallback(() => {
    setResourceMonitorOpen(!resourceMonitorOpen);
    // 如果要打开资源监控侧边栏，确保它显示在上层
    if (!resourceMonitorOpen) {
      setLastOpenedSidebar("resource");
      setConnectionManagerOpen((prev) => {
        // 如果连接管理已打开，不关闭它，只确保z-index关系
        return prev;
      });
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  }, [resourceMonitorOpen]);

  // 关闭资源监控侧边栏
  const handleCloseResourceMonitor = useCallback(() => {
    setResourceMonitorOpen(false);
  }, []);

  // 切换文件管理侧边栏
  const toggleFileManager = () => {
    setFileManagerOpen(!fileManagerOpen);
    // 如果要打开文件管理侧边栏，确保它显示在上层
    if (!fileManagerOpen) {
      setLastOpenedSidebar("file");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 关闭文件管理侧边栏
  const handleCloseFileManager = () => {
    setFileManagerOpen(false);

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 更新文件管理路径记忆
  const updateFileManagerPath = (tabId, path) => {
    if (tabId && path) {
      setFileManagerPaths((prev) => ({
        ...prev,
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
    setShortcutCommandsOpen(!shortcutCommandsOpen);
    if (!shortcutCommandsOpen) {
      setLastOpenedSidebar("shortcut");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  const handleCloseShortcutCommands = () => {
    setShortcutCommandsOpen(false);

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 添加切换历史命令侧边栏的函数
  const toggleCommandHistory = () => {
    setCommandHistoryOpen(!commandHistoryOpen);
    if (!commandHistoryOpen) {
      setLastOpenedSidebar("history");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  const handleCloseCommandHistory = () => {
    setCommandHistoryOpen(false);

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 全局AI聊天窗口处理函数
  const handleToggleGlobalAiChatWindow = () => {
    setGlobalAiChatWindowState((prev) =>
      prev === "visible" ? "closed" : "visible",
    );
  };

  const handleCloseGlobalAiChatWindow = () => {
    setGlobalAiChatWindowState("closed");
    // 清除预设输入值
    setAiInputPreset("");
  };

  // 发送文本到AI助手
  const handleSendToAI = (text) => {
    setAiInputPreset(text);
    setGlobalAiChatWindowState("visible");
  };

  // 切换IP地址查询侧边栏
  const toggleIpAddressQuery = () => {
    setIpAddressQueryOpen(!ipAddressQueryOpen);
    if (!ipAddressQueryOpen) {
      setLastOpenedSidebar("ipquery");
    }

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 关闭IP地址查询侧边栏
  const handleCloseIpAddressQuery = () => {
    setIpAddressQueryOpen(false);

    // 立即触发resize事件，确保终端快速适配新的布局
    setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 15);
  };

  // 切换随机密码生成器侧边栏
  const toggleSecurityTools = () => {
    setSecurityToolsOpen(!securityToolsOpen);
    if (!securityToolsOpen) {
      setLastOpenedSidebar("password");
    }
  };

  // 切换本地终端侧边栏
  const toggleLocalTerminalSidebar = () => {
    setLocalTerminalSidebarOpen(!localTerminalSidebarOpen);
    if (!localTerminalSidebarOpen) {
      setLastOpenedSidebar("localTerminal");
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
    setConnectionManagerOpen(false);
    setResourceMonitorOpen(false);
    setFileManagerOpen(false);
    setShortcutCommandsOpen(false);
    setCommandHistoryOpen(false);
    setIpAddressQueryOpen(false);
    setSecurityToolsOpen(false);
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

  // 处理设置变更
  React.useEffect(() => {
    const handleSettingsChanged = (event) => {
      const { language, fontSize, darkMode: newDarkMode } = event.detail;

      // 应用主题设置
      if (newDarkMode !== undefined && newDarkMode !== darkMode) {
        setDarkMode(newDarkMode);
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
              setDarkMode(settings.darkMode);
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
  }, [darkMode]); // 添加 darkMode 依赖

  // 分组操作回调
  const handleJoinGroup = (tabId, groupId) => {
    addTabToGroup(tabId, groupId);
    setTabs([...tabs]); // 触发刷新
    handleTabContextMenuClose();
  };
  const handleRemoveFromGroup = (tabId) => {
    removeTabFromGroup(tabId);
    setTabs([...tabs]);
    handleTabContextMenuClose();
  };
  const handleCreateGroup = (tabId) => {
    const newGroup = addGroup();
    addTabToGroup(tabId, newGroup.groupId);
    setTabs([...tabs]);
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
                  {tabs.map((tab, index) => (
                    <CustomTab
                      key={tab.id}
                      label={tab.label}
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
                        draggedTabIndex !== null && dragOverTabIndex === index
                          ? dragInsertPosition
                          : null
                      }
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
              return null;
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
              marginRight: `${activeSidebarMargin}px`,
              transition: "margin-right 0.25s ease-out",
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
              position: "absolute",
              top: 0,
              right: 0,
              height: "100%",
              display: "flex",
              zIndex: 90,
            }}
          >
            {/* 资源监控侧边栏 */}
            <Box
              sx={{
                position: "absolute",
                top: 0,
                right: 48,
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
                right: 48,
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
                right: 48,
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
                right: 48,
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
                right: 48,
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
                right: 48,
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
                right: 48,
                zIndex: lastOpenedSidebar === "password" ? 107 : 92,
                height: "100%",
                display: "flex",
              }}
            >
              {securityToolsOpen && (
                <SecurityTools
                  open={securityToolsOpen}
                  onClose={() => setSecurityToolsOpen(false)}
                />
              )}
            </Box>

            {/* 本地终端侧边栏 */}
            <Box
              sx={{
                position: "absolute",
                top: 0,
                right: 48,
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

            {/* 右侧边栏 */}
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
                position: "relative",
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
                      globalAiChatWindowState === "visible"
                        ? "action.selected"
                        : "transparent",
                    "&:hover": {
                      bgcolor:
                        globalAiChatWindowState === "visible"
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
        windowState={globalAiChatWindowState}
        onClose={handleCloseGlobalAiChatWindow}
        presetInput={aiInputPreset}
        onInputPresetUsed={() => setAiInputPreset("")}
      />

      {/* 关于对话框 */}
      <AboutDialog open={aboutDialogOpen} onClose={handleCloseAbout} />

      {/* 设置对话框 */}
      <Settings open={settingsDialogOpen} onClose={handleCloseSettings} />
    </ThemeProvider>
  );
}

// 为 App 组件添加 memo 优化
const NotebyApp = memo(App);
NotebyApp.displayName = "App";

const root = createRoot(document.getElementById("root"));
root.render(
  <GlobalErrorBoundary>
    <NotebyApp />
  </GlobalErrorBoundary>,
);
