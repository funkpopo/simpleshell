import * as React from "react";
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
import Tab from "@mui/material/Tab";
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
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import PowerOffIcon from "@mui/icons-material/PowerOff";
import FolderIcon from "@mui/icons-material/Folder";
import SettingsIcon from "@mui/icons-material/Settings";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import HistoryIcon from "@mui/icons-material/History";
import InfoIcon from "@mui/icons-material/Info";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import WebTerminal from "./components/WebTerminal.jsx";
import WelcomePage from "./components/WelcomePage.jsx";
import TabPanel from "./components/TabPanel.jsx";
import ConnectionManager from "./components/ConnectionManager.jsx";
import ResourceMonitor from "./components/ResourceMonitor.jsx";
import AIAssistant from "./components/AIAssistant.jsx";
import AIIcon from "./components/AIIcon.jsx";
import FileManager from "./components/FileManager.jsx";
import Settings from "./components/Settings.jsx";
import Divider from "@mui/material/Divider";
import ShortcutCommands from "./components/ShortcutCommands.jsx";
import TerminalIcon from "@mui/icons-material/Terminal";
// Import i18n configuration
import { useTranslation } from "react-i18next";
import "./i18n/i18n";
import { changeLanguage } from "./i18n/i18n";
import "./index.css";
import { styled } from "@mui/material/styles";
import { SIDEBAR_WIDTHS } from "./constants/layout.js";

// 自定义标签页组件
function CustomTab(props) {
  const {
    label,
    onClose,
    onContextMenu,
    index,
    onDragStart,
    onDragOver,
    onDrop,
    ...other
  } = props;

  return (
    <Tab
      {...other}
      onContextMenu={onContextMenu}
      draggable="true"
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      label={
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <Typography variant="body2" component="span" sx={{ mr: 1 }}>
            {label}
          </Typography>
          {onClose && (
            <CloseIcon
              fontSize="small"
              sx={{
                width: 16,
                height: 16,
                "&:hover": {
                  color: "error.main",
                },
              }}
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
            />
          )}
        </Box>
      }
      sx={{
        textTransform: "none",
        minWidth: "auto",
        minHeight: 40,
        py: 0,
        cursor: "pointer",
        userSelect: "none",
        // 确保标签颜色跟随主题变化
        color: "text.secondary",
        "&.Mui-selected": {
          color: "text.primary",
          backgroundColor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(255, 255, 255, 0.1)"
              : "rgba(245, 245, 245, 0.91)",
          borderRadius: "4px 4px 0 0",
          fontWeight: "bold",
        },
      }}
    />
  );
}

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
function AboutDialog({ open, onClose }) {
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
        versionPromise
          .then((version) => setAppVersion(version))
          .catch((error) => console.error("获取版本失败:", error));
      } else {
        // 如果不是Promise，可能是直接返回的版本字符串
        setAppVersion(versionPromise || "1.0.0");
      }
    }
  }, []);

  // 在外部浏览器打开链接
  const handleOpenExternalLink = (url) => {
    if (window.terminalAPI?.openExternal) {
      window.terminalAPI.openExternal(url).catch((error) => {
        console.error("打开外部链接失败:", error);
        alert("无法打开链接，请手动访问: " + url);
      });
    } else {
      // 降级方案：尝试使用window.open
      window.open(url, "_blank");
    }
  };

  const handleCheckForUpdate = () => {
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
          throw new Error(result.error || "未知错误");
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
        console.error("检查更新失败:", error);
        setUpdateStatus(t("about.updateError", { error: error.message }));
      })
      .finally(() => {
        setCheckingForUpdate(false);
      });
  };

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
          <Typography variant="body2" color="text.secondary" paragraph>
            {t("about.description")}
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
            {t("about.author")}
          </Typography>
          <Typography variant="body2" paragraph>
            {t("about.author")}: funkpopo
          </Typography>
          <Typography variant="body2" paragraph>
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
                paragraph
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
}

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
        console.error("加载主题设置失败:", error);
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

  // AI助手侧边栏状态
  const [aiAssistantOpen, setAiAssistantOpen] = React.useState(false);

  // 文件管理侧边栏状态
  const [fileManagerOpen, setFileManagerOpen] = React.useState(false);

  // 最后打开的侧边栏（用于确定z-index层级）
  const [lastOpenedSidebar, setLastOpenedSidebar] = React.useState(null);

  // 连接配置状态
  const [connections, setConnections] = React.useState([]);

  // 设置对话框状态
  const [settingsDialogOpen, setSettingsDialogOpen] = React.useState(false);

  // 添加快捷命令侧边栏状态
  const [shortcutCommandsOpen, setShortcutCommandsOpen] = React.useState(false);

  React.useEffect(() => {
    let calculatedMargin = 0;
    if (aiAssistantOpen && lastOpenedSidebar === "ai") {
      calculatedMargin = SIDEBAR_WIDTHS.AI_ASSISTANT;
    } else if (resourceMonitorOpen && lastOpenedSidebar === "resource") {
      calculatedMargin = SIDEBAR_WIDTHS.RESOURCE_MONITOR;
    } else if (connectionManagerOpen && lastOpenedSidebar === "connection") {
      calculatedMargin = SIDEBAR_WIDTHS.CONNECTION_MANAGER;
    } else if (fileManagerOpen && lastOpenedSidebar === "file") {
      calculatedMargin = SIDEBAR_WIDTHS.FILE_MANAGER;
    } else if (shortcutCommandsOpen && lastOpenedSidebar === "shortcut") {
      calculatedMargin = SIDEBAR_WIDTHS.SHORTCUT_COMMANDS;
    } else {
      // Fallback if lastOpenedSidebar isn't set but one is open
      if (aiAssistantOpen) calculatedMargin = SIDEBAR_WIDTHS.AI_ASSISTANT;
      else if (resourceMonitorOpen)
        calculatedMargin = SIDEBAR_WIDTHS.RESOURCE_MONITOR;
      else if (connectionManagerOpen)
        calculatedMargin = SIDEBAR_WIDTHS.CONNECTION_MANAGER;
      else if (fileManagerOpen) calculatedMargin = SIDEBAR_WIDTHS.FILE_MANAGER;
      else if (shortcutCommandsOpen)
        calculatedMargin = SIDEBAR_WIDTHS.SHORTCUT_COMMANDS;
    }

    if (calculatedMargin > 0) {
      calculatedMargin += SIDEBAR_WIDTHS.DEFAULT_PADDING;
    }

    setActiveSidebarMargin(calculatedMargin);
  }, [
    aiAssistantOpen,
    resourceMonitorOpen,
    connectionManagerOpen,
    fileManagerOpen,
    shortcutCommandsOpen,
    lastOpenedSidebar,
    SIDEBAR_WIDTHS,
  ]);

  // 应用启动时加载连接配置
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
        console.error("Failed to load connections during app startup:", error);
      }
    };

    loadConnections();

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
      window.terminalAPI
        .saveConnections(updatedConnections)
        .catch((error) => console.error("Failed to save connections:", error));
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

  // 处理主题过渡效果
  React.useEffect(() => {
    // 当主题变化时，添加过渡类
    const transitionTimeout = setTimeout(() => {
      document.body.classList.remove("theme-transition");
    }, 300); // 匹配CSS中的过渡时间

    return () => {
      clearTimeout(transitionTimeout);
      document.body.classList.remove("theme-transition");
    };
  }, [darkMode]);

  // 处理菜单打开
  const handleMenu = (event) => {
    setAnchorEl(event.currentTarget);
  };

  // 处理菜单关闭
  const handleClose = () => {
    setAnchorEl(null);
  };

  // 打开关于对话框
  const handleOpenAbout = () => {
    setAnchorEl(null);
    setAboutDialogOpen(true);
  };

  // 关闭关于对话框
  const handleCloseAbout = () => {
    setAboutDialogOpen(false);
  };

  // 打开设置对话框
  const handleOpenSettings = () => {
    setAnchorEl(null);
    setSettingsDialogOpen(true);
  };

  // 关闭设置对话框
  const handleCloseSettings = () => {
    setSettingsDialogOpen(false);
  };

  // 处理应用退出
  const handleExit = () => {
    if (window.terminalAPI && window.terminalAPI.closeApp) {
      window.terminalAPI.closeApp();
    }
    setAnchorEl(null);
  };

  // 切换主题模式
  const toggleTheme = async () => {
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
          console.warn("获取当前设置失败，使用默认值:", loadError);
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
      console.error("保存主题设置失败:", error);
      // 如果保存失败，至少更新 localStorage
      localStorage.setItem("terminalDarkMode", (!darkMode).toString());
    }
  };

  // 标签页相关函数
  const handleTabChange = (event, newValue) => {
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
  };

  // 标签页右键菜单打开
  const handleTabContextMenu = (event, index) => {
    event.preventDefault();
    // 欢迎页不显示右键菜单
    if (tabs[index].id === "welcome") return;

    setTabContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      tabIndex: index,
    });
  };

  // 标签页右键菜单关闭
  const handleTabContextMenuClose = () => {
    setTabContextMenu({
      mouseX: null,
      mouseY: null,
      tabIndex: null,
    });
  };

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
  const toggleConnectionManager = () => {
    setConnectionManagerOpen(!connectionManagerOpen);
    // 如果要打开连接管理侧边栏，确保它显示在上层
    if (!connectionManagerOpen) {
      setLastOpenedSidebar("connection");
      setResourceMonitorOpen((prev) => {
        // 如果资源监控已打开，不关闭它，只确保z-index关系
        return prev;
      });
    }
  };

  // 关闭连接管理侧边栏
  const handleCloseConnectionManager = () => {
    setConnectionManagerOpen(false);
  };

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
  const toggleResourceMonitor = () => {
    setResourceMonitorOpen(!resourceMonitorOpen);
    // 如果要打开资源监控侧边栏，确保它显示在上层
    if (!resourceMonitorOpen) {
      setLastOpenedSidebar("resource");
      setConnectionManagerOpen((prev) => {
        // 如果连接管理已打开，不关闭它，只确保z-index关系
        return prev;
      });
    }
  };

  // 关闭资源监控侧边栏
  const handleCloseResourceMonitor = () => {
    setResourceMonitorOpen(false);
  };

  // 切换AI助手侧边栏
  const toggleAIAssistant = () => {
    setAiAssistantOpen((prev) => {
      if (!prev) {
        // 打开AI助手时，更新最后打开的侧边栏
        setLastOpenedSidebar("ai");
        return true;
      } else {
        return false;
      }
    });
  };

  // 关闭AI助手侧边栏
  const handleCloseAIAssistant = () => {
    // 清理会话记录，提高性能
    if (window.aiAssistantRef && window.aiAssistantRef.current) {
      window.aiAssistantRef.current.clearMessages();
    }
    setAiAssistantOpen(false);
  };

  // 切换文件管理侧边栏
  const toggleFileManager = () => {
    setFileManagerOpen(!fileManagerOpen);
    // 如果要打开文件管理侧边栏，确保它显示在上层
    if (!fileManagerOpen) {
      setLastOpenedSidebar("file");
    }
  };

  // 关闭文件管理侧边栏
  const handleCloseFileManager = () => {
    setFileManagerOpen(false);
  };

  // 添加切换快捷命令侧边栏的函数
  const toggleShortcutCommands = () => {
    if (shortcutCommandsOpen) {
      setShortcutCommandsOpen(false);
    } else {
      closeAllSidebars();
      setShortcutCommandsOpen(true);
      setLastOpenedSidebar("shortcut");
    }
  };

  const handleCloseShortcutCommands = () => {
    setShortcutCommandsOpen(false);
  };

  // 更新关闭所有侧边栏的函数
  const closeAllSidebars = () => {
    setAiAssistantOpen(false);
    setResourceMonitorOpen(false);
    setConnectionManagerOpen(false);
    setFileManagerOpen(false);
    setShortcutCommandsOpen(false);
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
        } else {
          console.error(
            "无法发送命令:",
            processId ? "API未找到" : "进程ID未找到",
          );
        }
      }
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

        // 重新加载窗口以确保所有组件都使用新的语言设置
        if (window.terminalAPI?.reloadWindow) {
          window.terminalAPI.reloadWindow();
        }
      }
    };

    window.addEventListener("settingsChanged", handleSettingsChanged);

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
        console.error("Failed to load initial UI settings:", error);
        // 使用默认字体大小
        document.documentElement.style.fontSize = "14px";
      }
    };

    loadInitialSettings();

    return () => {
      window.removeEventListener("settingsChanged", handleSettingsChanged);
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
              {/* 欢迎页 - 始终渲染，但根据currentTab控制显示/隐藏 */}
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  opacity: currentTab === 0 ? 1 : 0,
                  zIndex: currentTab === 0 ? 1 : 0,
                  pointerEvents: currentTab === 0 ? "auto" : "none",
                  visibility: currentTab === 0 ? "visible" : "hidden",
                  transition:
                    "opacity 0.2s ease-in-out, visibility 0.2s ease-in-out",
                }}
              >
                <WelcomePage />
              </div>

              {/* 终端标签页 - 始终渲染所有标签内容，但根据currentTab控制显示/隐藏 */}
              {tabs.slice(1).map((tab, index) => (
                <div
                  key={tab.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    opacity: currentTab === index + 1 ? 1 : 0,
                    zIndex: currentTab === index + 1 ? 1 : 0,
                    pointerEvents: currentTab === index + 1 ? "auto" : "none",
                    visibility: currentTab === index + 1 ? "visible" : "hidden",
                    transition:
                      "opacity 0.2s ease-in-out, visibility 0.2s ease-in-out",
                    // 标签页容器使用背景颜色，会随主题变化
                    backgroundColor: "inherit",
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
                    />
                  )}
                </div>
              ))}
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
            {/* 遮罩层 - 当侧边栏开启时显示 */}
            {(connectionManagerOpen ||
              resourceMonitorOpen ||
              aiAssistantOpen ||
              fileManagerOpen) && (
              <Box
                sx={{
                  position: "fixed",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  bgcolor: "rgba(0, 0, 0, 0.1)",
                  zIndex: 89,
                  display: { xs: "block", md: "none" },
                }}
                onClick={closeAllSidebars}
              />
            )}

            {/* AI助手侧边栏 */}
            <Box
              sx={{
                position: "absolute",
                top: 0,
                right: 48,
                zIndex: lastOpenedSidebar === "ai" ? 102 : 97,
                height: "100%",
                display: "flex",
              }}
            >
              <AIAssistant
                open={aiAssistantOpen}
                onClose={handleCloseAIAssistant}
              />
            </Box>

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

              {/* AI助手按钮 */}
              <Tooltip title={t("sidebar.ai")} placement="left">
                <IconButton
                  color="primary"
                  onClick={toggleAIAssistant}
                  sx={{
                    bgcolor: aiAssistantOpen
                      ? "action.selected"
                      : "transparent",
                    "&:hover": {
                      bgcolor: aiAssistantOpen
                        ? "action.selected"
                        : "action.hover",
                    },
                  }}
                >
                  <AIIcon />
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
            </Paper>
          </Box>
        </Box>
      </Box>

      {/* 关于对话框 */}
      <AboutDialog open={aboutDialogOpen} onClose={handleCloseAbout} />

      {/* 设置对话框 */}
      <Settings open={settingsDialogOpen} onClose={handleCloseSettings} />
    </ThemeProvider>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
