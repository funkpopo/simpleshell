import * as React from "react";
import { memo, useCallback, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
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
  preloadComponents,
  smartPreload,
} from "./components/LazyComponents.jsx";

import RandomPasswordGenerator from "./components/RandomPasswordGenerator.jsx";
import TerminalIcon from "@mui/icons-material/Terminal";
import AIChatWindow from "./components/AIChatWindow.jsx";
import CustomTab from "./components/CustomTab.jsx";
import MergedTabContent from "./components/MergedTabContent.jsx";
// Import i18n configuration
import { useTranslation } from "react-i18next";
import "./i18n/i18n";
import { changeLanguage } from "./i18n/i18n";
import "./index.css";
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
  const { t, i18n } = useTranslation();
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

  // 拖动标签状态
  const [draggedTabIndex, setDraggedTabIndex] = React.useState(null);
  const [dragOverTabIndex, setDragOverTabIndex] = React.useState(null); // 新增：记录拖拽悬停的标签
  const [dragOperation, setDragOperation] = React.useState(null); // 新增：记录拖拽操作类型 ('sort' | 'merge')
  const [dragInsertPosition, setDragInsertPosition] = React.useState(null); // 新增：记录插入位置 ('before' | 'after')

  // 合并标签状态 - 用于实现分屏显示
  const [mergedTabs, setMergedTabs] = React.useState({}); // 格式: { tabId: [子标签列表] }

  // 主题模式状态
  const [darkMode, setDarkMode] = React.useState(true); // 默认值
  const [themeLoading, setThemeLoading] = React.useState(true); // 主题加载状态

  // 标签页状态
  const [tabs, setTabs] = React.useState([
    { id: "welcome", label: t("terminal.welcome") },
  ]);
  const [currentTab, setCurrentTab] = React.useState(0);

  // 分屏模式下的活跃标签页状态（用于控制右侧面板）
  const [activeSplitTabId, setActiveSplitTabId] = React.useState(null);

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
  const [randomPasswordGeneratorOpen, setRandomPasswordGeneratorOpen] =
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
      } else if (
        randomPasswordGeneratorOpen &&
        lastOpenedSidebar === "password"
      ) {
        return SIDEBAR_WIDTHS.RANDOM_PASSWORD_GENERATOR;
      }
      // Fallback if lastOpenedSidebar isn't set but one is open
      if (resourceMonitorOpen) return SIDEBAR_WIDTHS.RESOURCE_MONITOR;
      else if (connectionManagerOpen) return SIDEBAR_WIDTHS.CONNECTION_MANAGER;
      else if (fileManagerOpen) return SIDEBAR_WIDTHS.FILE_MANAGER;
      else if (shortcutCommandsOpen) return SIDEBAR_WIDTHS.SHORTCUT_COMMANDS;
      else if (commandHistoryOpen) return SIDEBAR_WIDTHS.COMMAND_HISTORY;
      else if (ipAddressQueryOpen) return SIDEBAR_WIDTHS.IP_ADDRESS_QUERY;
      else if (randomPasswordGeneratorOpen)
        return SIDEBAR_WIDTHS.RANDOM_PASSWORD_GENERATOR;
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
    randomPasswordGeneratorOpen,
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

    window.addEventListener("sshProcessIdUpdated", handleSshProcessIdUpdate);

    // 监听分屏活跃标签页变化事件
    const handleActiveSplitTabChanged = (event) => {
      const { activeTabId } = event.detail || {};
      if (activeTabId) {
        setActiveSplitTabId(activeTabId);
      }
    };

    window.addEventListener(
      "activeSplitTabChanged",
      handleActiveSplitTabChanged,
    );

    return () => {
      // 清理预加载定时器
      clearTimeout(preloadTimer);

      window.removeEventListener(
        "sshProcessIdUpdated",
        handleSshProcessIdUpdate,
      );

      window.removeEventListener(
        "activeSplitTabChanged",
        handleActiveSplitTabChanged,
      );
    };
  }, []);

  // 当活跃分屏标签页变化时，触发相关组件更新
  React.useEffect(() => {
    if (activeSplitTabId) {
      // 延迟触发，确保状态已经更新
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("activeSplitTabUpdated", {
            detail: {
              activeTabId: activeSplitTabId,
              timestamp: Date.now(),
            },
          }),
        );
      }, 50);
    }
  }, [activeSplitTabId]);

  // 当主标签页切换时，重置分屏活跃标签页状态
  React.useEffect(() => {
    // 如果当前标签页没有分屏，重置活跃分屏标签页
    if (currentTab > 0 && tabs[currentTab]) {
      const currentMainTab = tabs[currentTab];
      const mergedTabsForCurrentMain = mergedTabs[currentMainTab.id];

      if (!mergedTabsForCurrentMain || mergedTabsForCurrentMain.length <= 1) {
        // 当前标签页没有分屏，重置活跃分屏标签页
        if (activeSplitTabId) {
          setActiveSplitTabId(null);
        }
      } else {
        // 当前标签页有分屏，检查活跃标签是否还有效
        if (
          activeSplitTabId &&
          !mergedTabsForCurrentMain.find((tab) => tab.id === activeSplitTabId)
        ) {
          setActiveSplitTabId(mergedTabsForCurrentMain[0]?.id || null);
        } else if (!activeSplitTabId) {
          setActiveSplitTabId(mergedTabsForCurrentMain[0]?.id || null);
        }
      }
    }
  }, [currentTab, tabs, mergedTabs, activeSplitTabId]);

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

  // 保存更新后的连接配置
  const handleConnectionsUpdate = useCallback((updatedConnections) => {
    setConnections(updatedConnections);
    if (window.terminalAPI && window.terminalAPI.saveConnections) {
      window.terminalAPI.saveConnections(updatedConnections);
    }
  }, []);

  // 创建动态主题
  const theme = React.useMemo(
    () =>
      createTheme({
        palette: {
          mode: darkMode ? "dark" : "light",
          primary: {
            main: darkMode ? "#90caf9" : "#757575",
          },
          secondary: {
            main: darkMode ? "#f48fb1" : "#dc004e",
          },
          background: {
            default: darkMode ? "#121212" : "#f5f5f5",
            paper: darkMode ? "#1e1e1e" : "#ffffff",
          },
        },
        components: {
          MuiListItem: {
            styleOverrides: {
              root: {
                paddingTop: "4px",
                paddingBottom: "4px",
                minHeight: "50px",
                maxHeight: "50px",
              },
              dense: {
                paddingTop: "2px",
                paddingBottom: "2px",
                minHeight: "50px",
                maxHeight: "50px",
              },
              gutters: {
                paddingLeft: "8px",
                paddingRight: "8px",
              },
            },
          },
        },
      }),
    [darkMode],
  );

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
  const handleRefreshTerminal = () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null && tabIndex < tabs.length) {
      const tabId = tabs[tabIndex].id;

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

    // 检查是否是合并的标签，如果是则需要清理合并状态
    if (mergedTabs[tabToRemove.id]) {
      const merged = mergedTabs[tabToRemove.id];
      // 清理所有相关的终端实例
      merged.forEach((tab) => {
        const newInstances = { ...terminalInstances };
        delete newInstances[tab.id];
        setTerminalInstances(newInstances);

        // 清理文件管理路径记忆
        setFileManagerPaths((prev) => {
          const newPaths = { ...prev };
          delete newPaths[tab.id];
          return newPaths;
        });
      });

      // 清理合并状态
      const newMergedTabs = { ...mergedTabs };
      delete newMergedTabs[tabToRemove.id];
      setMergedTabs(newMergedTabs);
    } else {
      // 从缓存中移除对应的终端实例
      setTerminalInstances((prev) => {
        const newInstances = { ...prev };
        delete newInstances[tabToRemove.id];
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
    }

    const newTabs = tabs.filter((_, i) => i !== index);
    setTabs(newTabs);

    // 如果关闭的是当前标签页，则选中前一个标签
    if (currentTab === index) {
      setCurrentTab(index === 0 ? 0 : index - 1);
    } else if (currentTab > index) {
      // 如果关闭的标签在当前标签之前，当前标签索引需要减1
      setCurrentTab(currentTab - 1);
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
      e.dataTransfer.setData("text/plain", index);

      // 使拖动的元素半透明
      e.target.style.opacity = "0.5";
    },
    [tabs],
  );

  // 处理拖动中
  const handleDragOver = (e, index) => {
    e.preventDefault();
    // 不允许放置到欢迎标签
    if (index === 0) return;

    // 不是在自身上拖动
    if (draggedTabIndex !== null && draggedTabIndex !== index) {
      // 获取鼠标在目标标签内的相对位置来决定拖拽效果
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const tabWidth = rect.width;

      // 使用更精确的区域划分：左右各20%用于排序，中间60%用于合并
      const sortThreshold = tabWidth * 0.2;

      if (mouseX <= sortThreshold) {
        // 左边缘：在目标标签之前插入
        e.dataTransfer.dropEffect = "move";
        setDragOperation("sort");
        setDragOverTabIndex(index);
        setDragInsertPosition("before");
      } else if (mouseX >= tabWidth - sortThreshold) {
        // 右边缘：在目标标签之后插入
        e.dataTransfer.dropEffect = "move";
        setDragOperation("sort");
        setDragOverTabIndex(index);
        setDragInsertPosition("after");
      } else {
        // 中心区域：合并操作
        e.dataTransfer.dropEffect = "copy";
        setDragOperation("merge");
        setDragOverTabIndex(index);
        setDragInsertPosition(null);
      }
    }
  };

  // 处理拖动离开
  const handleDragLeave = (e) => {
    // 只有当鼠标真正离开目标元素时才清理状态
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverTabIndex(null);
      setDragOperation(null);
      setDragInsertPosition(null);
    }
  };

  // 处理放置
  const handleDrop = (e, targetIndex) => {
    e.preventDefault();

    // 不允许放置到欢迎标签
    if (targetIndex === 0) return;

    // 确保有拖动的标签
    if (draggedTabIndex !== null) {
      const sourceIndex = draggedTabIndex;

      // 不需要拖放到自己身上
      if (sourceIndex === targetIndex) return;

      // 根据拖拽操作类型执行不同的操作
      if (dragOperation === "sort") {
        // 排序操作：根据插入位置决定目标索引
        let insertIndex = targetIndex;
        if (dragInsertPosition === "after") {
          insertIndex = targetIndex + 1;
        }
        reorderTab(sourceIndex, insertIndex);
      } else if (dragOperation === "merge") {
        // 合并操作：将源标签合并到目标标签
        mergeTabIntoTarget(sourceIndex, targetIndex);
      }
    }

    // 重置拖动状态
    setDraggedTabIndex(null);
    setDragOverTabIndex(null);
    setDragOperation(null);
    setDragInsertPosition(null);
    e.target.style.opacity = "1";
  };

  // 处理拖动结束（无论是否成功放置）
  const handleDragEnd = (e) => {
    // 恢复透明度
    e.target.style.opacity = "1";
    setDraggedTabIndex(null);
    setDragOverTabIndex(null);
    setDragOperation(null);
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

  // 合并标签功能
  const mergeTabIntoTarget = useCallback(
    (sourceIndex, targetIndex) => {
      if (
        sourceIndex === targetIndex ||
        !tabs[sourceIndex] ||
        !tabs[targetIndex]
      )
        return;

      const sourceTab = tabs[sourceIndex];
      const targetTab = tabs[targetIndex];

      // 不能合并欢迎页
      if (sourceTab.id === "welcome" || targetTab.id === "welcome") return;

      // 获取目标标签的当前合并状态
      const targetMerged = mergedTabs[targetTab.id] || [targetTab];

      // 创建新的合并状态
      const newMergedTabs = { ...mergedTabs };
      newMergedTabs[targetTab.id] = [...targetMerged, sourceTab];

      setMergedTabs(newMergedTabs);

      // 优化：仅触发布局调整，不重新建立连接
      setTimeout(() => {
        // 触发窗口resize事件，确保终端适配新的分屏布局
        window.dispatchEvent(new Event("resize"));

        // 触发自定义事件通知MergedTabContent组件进行布局更新
        window.dispatchEvent(
          new CustomEvent("splitLayoutChanged", {
            detail: {
              type: "merge",
              targetTabId: targetTab.id,
              mergedTabs: newMergedTabs[targetTab.id],
              timestamp: Date.now(),
            },
          }),
        );
      }, 50);

      // 从标签列表中移除源标签
      const newTabs = tabs.filter((_, index) => index !== sourceIndex);
      setTabs(newTabs);

      // 调整当前标签索引
      if (currentTab === sourceIndex) {
        setCurrentTab(
          targetIndex > sourceIndex ? targetIndex - 1 : targetIndex,
        );
      } else if (currentTab > sourceIndex) {
        setCurrentTab(currentTab - 1);
      }
    },
    [tabs, mergedTabs, currentTab],
  );

  // 拆分合并的标签
  const splitMergedTab = useCallback(
    (mainTabId) => {
      const merged = mergedTabs[mainTabId];
      if (!merged || merged.length <= 1) return;

      // 拆分会话前自动关闭所有已展开的侧边栏
      setConnectionManagerOpen(false);
      setResourceMonitorOpen(false);
      setFileManagerOpen(false);
      setShortcutCommandsOpen(false);
      setCommandHistoryOpen(false);
      setIpAddressQueryOpen(false);
      setRandomPasswordGeneratorOpen(false);

      // 找到主标签在tabs中的位置
      const mainTabIndex = tabs.findIndex((tab) => tab.id === mainTabId);
      if (mainTabIndex === -1) return;

      // 创建新的标签列表，在主标签后插入子标签
      const newTabs = [...tabs];
      const subTabs = merged.slice(1); // 跳过第一个(主标签)

      // 在主标签后插入子标签
      newTabs.splice(mainTabIndex + 1, 0, ...subTabs);
      setTabs(newTabs);

      // 移除合并状态
      const newMergedTabs = { ...mergedTabs };
      delete newMergedTabs[mainTabId];
      setMergedTabs(newMergedTabs);

      // 立即触发标签切换到第一个拆分的标签，确保它被激活
      setTimeout(() => {
        setCurrentTab(mainTabIndex);
      }, 10);

      // 第一阶段：重新建立SSH连接（50ms后）
      setTimeout(() => {
        merged.forEach((tab, index) => {
          if (tab && tab.id) {
            // 先清除旧的终端实例和连接
            setTerminalInstances((prev) => {
              const newInstances = { ...prev };
              delete newInstances[tab.id];
              delete newInstances[`${tab.id}-config`];
              delete newInstances[`${tab.id}-processId`];
              delete newInstances[`${tab.id}-refresh`];
              return newInstances;
            });

            // 为拆分的标签重新建立连接配置
            setTimeout(() => {
              // 获取原始的SSH配置
              const originalConfig = terminalInstances[`${tab.id}-config`];
              if (
                originalConfig &&
                (originalConfig.protocol === "ssh" ||
                  originalConfig.protocol === "telnet" ||
                  tab.type === "ssh")
              ) {
                // 创建新的连接配置，带有拆分标记
                const splitConfig = {
                  ...originalConfig,
                  tabId: tab.id,
                  splitReconnect: true, // 标记这是拆分重连
                  splitTimestamp: Date.now(),
                };

                // 重新创建终端实例
                setTerminalInstances((prev) => ({
                  ...prev,
                  [tab.id]: true,
                  [`${tab.id}-config`]: splitConfig,
                  [`${tab.id}-processId`]: null,
                  [`${tab.id}-refresh`]: Date.now(), // 强制刷新
                }));
              } else {
                // 对于本地终端或其他类型
                setTerminalInstances((prev) => ({
                  ...prev,
                  [tab.id]: true,
                  [`${tab.id}-refresh`]: Date.now(),
                }));
              }
            }, index * 100); // 为每个标签错开重连时间，避免并发问题
          }
        });

        // 触发基础布局调整
        window.dispatchEvent(new Event("resize"));

        // 触发自定义事件通知终端组件进行布局更新
        window.dispatchEvent(
          new CustomEvent("splitLayoutChanged", {
            detail: {
              type: "split",
              mainTabId: mainTabId,
              splitTabs: merged,
              reconnectMode: true, // 标记这是重连模式
              timestamp: Date.now(),
            },
          }),
        );
      }, 50);
    },
    [
      tabs,
      mergedTabs,
      terminalInstances,
      processCache,
      setConnectionManagerOpen,
      setResourceMonitorOpen,
      setFileManagerOpen,
      setShortcutCommandsOpen,
      setCommandHistoryOpen,
      setIpAddressQueryOpen,
      setRandomPasswordGeneratorOpen,
    ],
  ); // 添加所有相关依赖

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
  const toggleRandomPasswordGenerator = () => {
    setRandomPasswordGeneratorOpen(!randomPasswordGeneratorOpen);
    if (!randomPasswordGeneratorOpen) {
      setLastOpenedSidebar("password");
    }
  };

  // 更新关闭所有侧边栏的函数
  const closeAllSidebars = () => {
    setConnectionManagerOpen(false);
    setResourceMonitorOpen(false);
    setFileManagerOpen(false);
    setShortcutCommandsOpen(false);
    setCommandHistoryOpen(false);
    setIpAddressQueryOpen(false);
    setRandomPasswordGeneratorOpen(false);

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

    // 如果在分屏模式下且有活跃的分屏标签页，优先使用分屏标签页
    if (activeSplitTabId) {
      // 首先查找是否有当前标签页的合并标签
      if (currentTab > 0 && tabs[currentTab]) {
        const currentMainTab = tabs[currentTab];
        const mergedTabsForCurrentMain = mergedTabs[currentMainTab.id];

        if (mergedTabsForCurrentMain && mergedTabsForCurrentMain.length > 1) {
          // 在合并的标签中查找活跃的分屏标签
          const activeTab = mergedTabsForCurrentMain.find(
            (tab) => tab.id === activeSplitTabId,
          );
          if (activeTab) {
            return activeTab;
          }
        }
      }

      // 如果在合并标签中没找到，则在全局标签中查找
      const globalTab = tabs.find((t) => t.id === activeSplitTabId);
      if (globalTab) {
        return globalTab;
      }
    }

    // 否则使用当前主标签页
    if (currentTab > 0 && tabs[currentTab]) {
      return tabs[currentTab];
    }
    return null;
  }, [activeSplitTabId, tabs, currentTab, mergedTabs]);

  // 计算右侧面板的当前标签页信息
  const currentPanelTab = useMemo(() => {
    const result = getCurrentPanelTab();
    return result;
  }, [getCurrentPanelTab]);

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

    window.addEventListener("settingsChanged", handleSettingsChanged);
    window.addEventListener("toggleGlobalAI", handleToggleGlobalAI);
    window.addEventListener("sendToAI", handleSendToAIEvent);

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
      window.removeEventListener("settingsChanged", handleSettingsChanged);
      window.removeEventListener("toggleGlobalAI", handleToggleGlobalAI);
      window.removeEventListener("sendToAI", handleSendToAIEvent);
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
          }}
        >
          <Toolbar
            variant="dense"
            sx={{
              px: 1,
              minHeight: "40px",
              display: "flex",
            }}
          >
            <IconButton
              edge="start"
              color="inherit"
              aria-label="menu"
              sx={{ mr: 1 }}
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

            {/* 标签页 */}
            <Tabs
              value={currentTab}
              onChange={handleTabChange}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                flexGrow: 1,
                minHeight: 40,
                "& .MuiTabs-indicator": {
                  height: 4,
                  backgroundColor: darkMode
                    ? "primary.main"
                    : "#757575 !important",
                },
                "& .MuiTab-root": {
                  color: "text.primary",
                  opacity: 0.7,
                  margin: "0 2px",
                  transition: "all 0.2s",
                  "&.Mui-selected": {
                    opacity: 1,
                    fontWeight: "bold",
                    margin: "0 2px",
                  },
                },
              }}
            >
              {tabs.map((tab, index) => {
                // 为合并的标签页生成复合名称
                const displayLabel =
                  mergedTabs[tab.id] && mergedTabs[tab.id].length > 1
                    ? mergedTabs[tab.id].map((t) => t.label).join(" | ")
                    : tab.label;

                return (
                  <CustomTab
                    key={tab.id}
                    label={displayLabel}
                    onClose={
                      tab.id !== "welcome" ? () => handleCloseTab(index) : null
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
                    dragOperation={
                      draggedTabIndex !== null && dragOverTabIndex === index
                        ? dragOperation
                        : null
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

              {/* 拆分会话选项 - 仅对合并的标签显示 */}
              {tabContextMenu.tabId &&
                mergedTabs[tabContextMenu.tabId] &&
                mergedTabs[tabContextMenu.tabId].length > 1 && (
                  <MenuItem
                    onClick={() => {
                      splitMergedTab(tabContextMenu.tabId);
                      handleTabContextMenuClose();
                    }}
                  >
                    <TerminalIcon fontSize="small" sx={{ mr: 1 }} />
                    拆分会话
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
                      <AddCircleOutlineIcon fontSize="small" sx={{ mr: 1 }} />
                      <ListItemText>{t("tabMenu.createGroup")}</ListItemText>
                    </MenuItem>,
                  );
                }
                if (groupMenuItems.length > 0) {
                  return [
                    <Divider key="group-divider-top" />,
                    ...groupMenuItems,
                  ];
                }
                return null;
              })()}
            </Menu>
          </Toolbar>
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
                      <MergedTabContent
                        mergedTabs={mergedTabs[tab.id] || [tab]}
                        terminalInstances={terminalInstances}
                        currentTabId={tab.id}
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
              <ResourceMonitor
                open={resourceMonitorOpen}
                onClose={handleCloseResourceMonitor}
                currentTabId={resourceMonitorTabId}
              />
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
              <ConnectionManager
                open={connectionManagerOpen}
                onClose={handleCloseConnectionManager}
                initialConnections={connections}
                onConnectionsUpdate={handleConnectionsUpdate}
                onOpenConnection={handleOpenConnection}
              />
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
              <FileManager
                open={fileManagerOpen}
                onClose={handleCloseFileManager}
                tabId={fileManagerProps.tabId}
                tabName={fileManagerProps.tabName}
                sshConnection={fileManagerProps.sshConnection}
                initialPath={fileManagerProps.initialPath}
                onPathChange={updateFileManagerPath}
              />
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
              <ShortcutCommands
                open={shortcutCommandsOpen}
                onClose={handleCloseShortcutCommands}
                onSendCommand={handleSendCommand}
              />
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
              <CommandHistory
                open={commandHistoryOpen}
                onClose={handleCloseCommandHistory}
                onSendCommand={handleSendCommand}
              />
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
              <IPAddressQuery
                open={ipAddressQueryOpen}
                onClose={handleCloseIpAddressQuery}
              />
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
              <RandomPasswordGenerator
                open={randomPasswordGeneratorOpen}
                onClose={() => setRandomPasswordGeneratorOpen(false)}
              />
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

              {/* 随机密码生成器按钮 */}
              <Tooltip title={t("sidebar.randomPassword")} placement="left">
                <IconButton
                  color="primary"
                  onClick={toggleRandomPasswordGenerator}
                  sx={{
                    bgcolor: randomPasswordGeneratorOpen
                      ? "action.selected"
                      : "transparent",
                    "&:hover": {
                      bgcolor: randomPasswordGeneratorOpen
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
root.render(<NotebyApp />);
