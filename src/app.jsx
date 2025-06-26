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
  preloadComponents,
} from "./components/LazyComponents.jsx";

import Settings from "./components/Settings.jsx";
import ShortcutCommands from "./components/ShortcutCommands.jsx";
import CommandHistory from "./components/CommandHistory.jsx";
import RandomPasswordGenerator from "./components/RandomPasswordGenerator.jsx";
import TerminalIcon from "@mui/icons-material/Terminal";
import AIChatWindow from "./components/AIChatWindow.jsx";
import CustomTab from "./components/CustomTab.jsx";
// Import i18n configuration
import { useTranslation } from "react-i18next";
import "./i18n/i18n";
import { changeLanguage } from "./i18n/i18n";
import "./index.css";
import { styled } from "@mui/material/styles";
import { SIDEBAR_WIDTHS } from "./constants/layout.js";

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
  });

  // 拖动标签状态
  const [draggedTabIndex, setDraggedTabIndex] = React.useState(null);

  // 主题模式状态
  const [darkMode, setDarkMode] = React.useState(true); // 默认值
  const [themeLoading, setThemeLoading] = React.useState(true); // 主题加载状态

  // 标签页状态
  const [tabs, setTabs] = React.useState([
    { id: "welcome", label: t("terminal.welcome") },
  ]);
  const [currentTab, setCurrentTab] = React.useState(0);

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
  const [randomPasswordGeneratorOpen, setRandomPasswordGeneratorOpen] = React.useState(false);

  // 文件管理路径记忆状态 - 为每个SSH连接记住最后访问的路径
  const [fileManagerPaths, setFileManagerPaths] = React.useState({});

  // 最后打开的侧边栏（用于确定z-index层级）
  const [lastOpenedSidebar, setLastOpenedSidebar] = React.useState(null);

  // 连接配置状态
  const [connections, setConnections] = React.useState([]);

  // 设置对话框状态
  const [settingsDialogOpen, setSettingsDialogOpen] = React.useState(false);

  // 添加快捷命令侧边栏状态
  const [shortcutCommandsOpen, setShortcutCommandsOpen] = React.useState(false);

  // 历史命令侧边栏状态
  const [commandHistoryOpen, setCommandHistoryOpen] = React.useState(false);

  // 全局AI聊天窗口状态
  const [globalAiChatWindowState, setGlobalAiChatWindowState] =
    React.useState("closed"); // 'visible', 'closed'

  // AI助手预设输入值
  const [aiInputPreset, setAiInputPreset] = React.useState("");

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
      } else if (randomPasswordGeneratorOpen && lastOpenedSidebar === "password") {
        return SIDEBAR_WIDTHS.RANDOM_PASSWORD_GENERATOR;
      }
      // Fallback if lastOpenedSidebar isn't set but one is open
      if (resourceMonitorOpen) return SIDEBAR_WIDTHS.RESOURCE_MONITOR;
      else if (connectionManagerOpen) return SIDEBAR_WIDTHS.CONNECTION_MANAGER;
      else if (fileManagerOpen) return SIDEBAR_WIDTHS.FILE_MANAGER;
      else if (shortcutCommandsOpen) return SIDEBAR_WIDTHS.SHORTCUT_COMMANDS;
      else if (commandHistoryOpen) return SIDEBAR_WIDTHS.COMMAND_HISTORY;
      else if (ipAddressQueryOpen) return SIDEBAR_WIDTHS.IP_ADDRESS_QUERY;
      else if (randomPasswordGeneratorOpen) return SIDEBAR_WIDTHS.RANDOM_PASSWORD_GENERATOR;
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
    const loadConnections = async () => {
      try {
        if (window.terminalAPI && window.terminalAPI.loadConnections) {
          const loadedConnections = await window.terminalAPI.loadConnections();
          if (loadedConnections && Array.isArray(loadedConnections)) {
            setConnections(loadedConnections);
          }
        }
      } catch (error) {
        // 连接加载失败，应用仍可正常启动
      }
    };

    loadConnections();

    // 延迟预加载组件，避免影响应用启动性能
    const preloadTimer = setTimeout(() => {
      // 再延迟一点预加载其他组件
      setTimeout(() => {
        preloadComponents.resourceMonitor().catch(() => {});
        preloadComponents.fileManager().catch(() => {});
        preloadComponents.aiAssistant().catch(() => {});
        preloadComponents.ipAddressQuery().catch(() => {});
      }, 2000);
    }, 3000);

    // 添加监听器，接收SSH进程ID更新事件
    const handleSshProcessIdUpdate = (event) => {
      const { terminalId, processId } = event.detail;
      if (terminalId && processId) {
        setTerminalInstances((prev) => ({
          ...prev,
          [`${terminalId}-processId`]: processId,
        }));
      }
    };

    window.addEventListener("sshProcessIdUpdated", handleSshProcessIdUpdate);

    return () => {
      // 清理预加载定时器
      clearTimeout(preloadTimer);

      window.removeEventListener(
        "sshProcessIdUpdated",
        handleSshProcessIdUpdate,
      );
    };
  }, []);

  // 保存更新后的连接配置
  const handleConnectionsUpdate = (updatedConnections) => {
    setConnections(updatedConnections);
    if (window.terminalAPI && window.terminalAPI.saveConnections) {
      window.terminalAPI.saveConnections(updatedConnections);
    }
  };

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
    (event, index) => {
      event.preventDefault();
      // 欢迎页不显示右键菜单
      if (tabs[index].id === "welcome") return;

      setTabContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
        tabIndex: index,
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

  // 从连接配置创建SSH连接标签页
  const handleCreateSSHConnection = (connection) => {
    // 创建唯一的标签页ID
    const terminalId = `ssh-${Date.now()}`;
    // 创建标签名（使用连接配置中的名称）
    const tabName = connection.name || `SSH: ${connection.host}`;

    // 创建新标签页
    const newTab = {
      id: terminalId,
      label: tabName,
      type: "ssh",
      connectionId: connection.id, // 存储连接ID以便后续使用
    };

    // 为连接添加tabId以便在main进程中识别
    const sshConfigWithTabId = {
      ...connection,
      tabId: terminalId,
    };

    // 为新标签页创建终端实例缓存，并包含SSH配置
    setTerminalInstances((prev) => ({
      ...prev,
      [terminalId]: true,
      [`${terminalId}-config`]: sshConfigWithTabId, // 将完整的连接配置存储在缓存中
      [`${terminalId}-processId`]: null, // 预留存储进程ID的位置
    }));

    // 添加标签并切换到新标签
    setTabs([...tabs, newTab]);
    setCurrentTab(tabs.length);
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

    // 从缓存中移除对应的终端实例
    setTerminalInstances((prev) => {
      const newInstances = { ...prev };
      delete newInstances[tabToRemove.id];
      return newInstances;
    });

    // 清理文件管理路径记忆
    setFileManagerPaths((prev) => {
      const newPaths = { ...prev };
      delete newPaths[tabToRemove.id];
      return newPaths;
    });

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

  // 处理拖动开始
  const handleDragStart = (e, index) => {
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
  };

  // 处理拖动中
  const handleDragOver = (e, index) => {
    e.preventDefault();
    // 不允许放置到欢迎标签
    if (index === 0) return;

    // 不是在自身上拖动
    if (draggedTabIndex !== null && draggedTabIndex !== index) {
      e.dataTransfer.dropEffect = "move";
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

      // 创建新的标签数组
      const newTabs = [...tabs];
      // 移除源标签
      const [movedTab] = newTabs.splice(sourceIndex, 1);
      // 插入到目标位置
      newTabs.splice(targetIndex, 0, movedTab);

      // 更新标签数组
      setTabs(newTabs);

      // 如果当前选中的标签是被移动的标签，更新选中标签索引
      if (currentTab === sourceIndex) {
        setCurrentTab(targetIndex);
      }
      // 如果当前选中的标签在源和目标之间，需要调整选中索引
      else if (currentTab > sourceIndex && currentTab <= targetIndex) {
        setCurrentTab(currentTab - 1);
      } else if (currentTab < sourceIndex && currentTab >= targetIndex) {
        setCurrentTab(currentTab + 1);
      }
    }

    // 重置拖动状态
    setDraggedTabIndex(null);
    e.target.style.opacity = "1";
  };

  // 处理拖动结束（无论是否成功放置）
  const handleDragEnd = (e) => {
    // 恢复透明度
    e.target.style.opacity = "1";
    setDraggedTabIndex(null);
  };

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
    if (currentTab > 0 && tabs[currentTab]) {
      const tab = tabs[currentTab];
      if (tab.type === "ssh") {
        // 向指定的终端发送命令
        const processId = terminalInstances[`${tab.id}-processId`];
        if (processId && window.terminalAPI.sendToProcess) {
          window.terminalAPI.sendToProcess(processId, command + "\r");
          return { success: true };
        } else {
          const reason = processId
            ? t("app.apiNotFound")
            : t("app.processIdNotFound");
          return { success: false, error: reason };
        }
      } else {
        return { success: false, error: "当前标签页不是SSH连接" };
      }
    } else {
      return { success: false, error: "请先建立SSH连接" };
    }
  };

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

    return () => {
      window.removeEventListener("settingsChanged", handleSettingsChanged);
      window.removeEventListener("toggleGlobalAI", handleToggleGlobalAI);
      window.removeEventListener("sendToAI", handleSendToAIEvent);
    };
  }, [darkMode]); // 添加 darkMode 依赖

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
              {tabs.map((tab, index) => (
                <CustomTab
                  key={tab.id}
                  label={tab.label}
                  onClose={
                    tab.id !== "welcome" ? () => handleCloseTab(index) : null
                  }
                  onContextMenu={(e) => handleTabContextMenu(e, index)}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  index={index}
                />
              ))}
            </Tabs>

            {/* 标签页右键菜单 */}
            <Menu
              open={tabContextMenu.mouseY !== null}
              onClose={handleTabContextMenuClose}
              anchorReference="anchorPosition"
              anchorPosition={
                tabContextMenu.mouseY !== null && tabContextMenu.mouseX !== null
                  ? { top: tabContextMenu.mouseY, left: tabContextMenu.mouseX }
                  : undefined
              }
            >
              <MenuItem onClick={handleRefreshTerminal}>
                <RefreshIcon fontSize="small" sx={{ mr: 1 }} />
                {t("tabMenu.refresh")}
              </MenuItem>
              <MenuItem onClick={handleCloseConnection}>
                <PowerOffIcon fontSize="small" sx={{ mr: 1 }} />
                {t("tabMenu.close")}
              </MenuItem>
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
                  <WelcomePage />
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
                        usePowershell={
                          tab.type !== "ssh" && terminalInstances.usePowershell
                        }
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
              <ResourceMonitor
                open={resourceMonitorOpen}
                onClose={handleCloseResourceMonitor}
                currentTabId={
                  resourceMonitorOpen &&
                  currentTab > 0 &&
                  tabs[currentTab] &&
                  tabs[currentTab].type === "ssh"
                    ? terminalInstances[`${tabs[currentTab].id}-processId`] ||
                      tabs[currentTab].id
                    : null
                }
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
                tabId={
                  currentTab > 0 && tabs[currentTab]
                    ? tabs[currentTab].id
                    : null
                }
                tabName={
                  currentTab > 0 && tabs[currentTab]
                    ? tabs[currentTab].label
                    : null
                }
                sshConnection={
                  currentTab > 0 &&
                  tabs[currentTab] &&
                  tabs[currentTab].type === "ssh"
                    ? terminalInstances[`${tabs[currentTab].id}-config`]
                    : null
                }
                initialPath={
                  currentTab > 0 && tabs[currentTab]
                    ? getFileManagerPath(tabs[currentTab].id)
                    : "/"
                }
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
                  disabled={
                    !currentTab ||
                    currentTab === 0 ||
                    (tabs[currentTab] && tabs[currentTab].type !== "ssh")
                  }
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
                  disabled={
                    !currentTab ||
                    currentTab === 0 ||
                    (tabs[currentTab] && tabs[currentTab].type !== "ssh")
                  }
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
