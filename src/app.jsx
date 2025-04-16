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
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import WebTerminal from "./components/WebTerminal.jsx";
import WelcomePage from "./components/WelcomePage.jsx";
import TabPanel from "./components/TabPanel.jsx";
import ConnectionManager from "./components/ConnectionManager.jsx";
import ResourceMonitor from "./components/ResourceMonitor.jsx";
import AIAssistant from "./components/AIAssistant.jsx";
import AIIcon from "./components/AIIcon.jsx";
import FileManager from "./components/FileManager.jsx";

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

// 关于对话框组件
function AboutDialog({ open, onClose }) {
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
    setUpdateStatus("检查更新中...");

    if (!window.terminalAPI?.checkForUpdate) {
      setUpdateStatus("无法检查更新：未找到更新检查API");
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
          setUpdateStatus(
            `发现新版本: ${latestVersion}, 请点击下方按钮查看详情`,
          );
        } else {
          setUpdateStatus("您使用的已经是最新版本");
        }
      })
      .catch((error) => {
        console.error("检查更新失败:", error);
        setUpdateStatus(`无法获取更新信息: ${error.message}`);
      })
      .finally(() => {
        setCheckingForUpdate(false);
      });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>关于 SimpleShell</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            SimpleShell
          </Typography>
          <Typography variant="body1" gutterBottom>
            版本: {appVersion}
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            一个简单高效的跨平台终端工具
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
            作者信息
          </Typography>
          <Typography variant="body2" paragraph>
            作者: funkpopo
          </Typography>
          <Typography variant="body2" paragraph>
            邮箱:{" "}
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
              更新检查
            </Typography>
            {updateStatus && (
              <Typography
                variant="body2"
                color={
                  updateStatus.includes("最新版本")
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
                检查更新
              </Button>

              {latestRelease && latestRelease.html_url && (
                <Button
                  variant="contained"
                  color="primary"
                  onClick={() => handleOpenExternalLink(latestRelease.html_url)}
                >
                  查看最新版本
                </Button>
              )}
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button
          onClick={() =>
            handleOpenExternalLink(
              "https://github.com/funkpopo/simpleshell/releases",
            )
          }
        >
          访问 GitHub 发布页
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function App() {
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
  const [darkMode, setDarkMode] = React.useState(true);

  // 标签页状态
  const [tabs, setTabs] = React.useState([{ id: "welcome", label: "欢迎" }]);
  const [currentTab, setCurrentTab] = React.useState(0);

  // 存储终端实例的缓存
  const [terminalInstances, setTerminalInstances] = React.useState({});

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
        console.log(
          `Received SSH process ID update: ${terminalId} -> ${processId}`,
        );
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

  // 处理应用退出
  const handleExit = () => {
    if (window.terminalAPI && window.terminalAPI.closeApp) {
      window.terminalAPI.closeApp();
    }
    setAnchorEl(null);
  };

  // 切换主题模式
  const toggleTheme = () => {
    setDarkMode(!darkMode);
  };

  // 标签页相关函数
  const handleTabChange = (event, newValue) => {
    setCurrentTab(newValue);
    
    // 触发自定义事件，通知WebTerminal组件进行大小调整
    if (newValue < tabs.length) {
      const currentTabId = tabs[newValue]?.id;
      if (currentTabId) {
        console.log(`标签切换到: ${currentTabId}`);
        // 使用自定义事件通知特定标签页的WebTerminal组件
        window.dispatchEvent(
          new CustomEvent("tabChanged", {
            detail: { tabId: currentTabId, index: newValue }
          })
        );
        
        // 触发窗口resize事件，作为备用机制确保布局更新
        setTimeout(() => {
          window.dispatchEvent(new Event('resize'));
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

    console.log(`Creating SSH connection with ID: ${terminalId}`);

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
              <MenuItem onClick={handleOpenAbout}>关于</MenuItem>
              <MenuItem onClick={handleExit}>退出</MenuItem>
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
                刷新连接
              </MenuItem>
              <MenuItem onClick={handleCloseConnection}>
                <PowerOffIcon fontSize="small" sx={{ mr: 1 }} />
                关闭连接
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
              }}
            >
              {/* 欢迎页 - 始终渲染，但根据currentTab控制显示/隐藏 */}
              <div
                style={{
                  display: currentTab === 0 ? "block" : "none",
                  height: "100%",
                }}
              >
                <WelcomePage />
              </div>

              {/* 终端标签页 - 始终渲染所有标签内容，但根据currentTab控制显示/隐藏 */}
              {tabs.slice(1).map((tab, index) => (
                <div
                  key={tab.id}
                  style={{
                    display: currentTab === index + 1 ? "block" : "none",
                    height: "100%",
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
                onClick={() => {
                  if (connectionManagerOpen) handleCloseConnectionManager();
                  if (resourceMonitorOpen) handleCloseResourceMonitor();
                  if (aiAssistantOpen) handleCloseAIAssistant();
                  if (fileManagerOpen) handleCloseFileManager();
                }}
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
                  currentTab > 0 && tabs[currentTab]
                    ? tabs[currentTab].type === "ssh"
                      ? terminalInstances[`${tabs[currentTab].id}-processId`] ||
                        tabs[currentTab].id
                      : null
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
                sshConnection={
                  currentTab > 0 &&
                  tabs[currentTab] &&
                  tabs[currentTab].type === "ssh"
                    ? terminalInstances[`${tabs[currentTab].id}-config`]
                    : null
                }
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
              <Tooltip title="切换主题" placement="left">
                <IconButton onClick={toggleTheme} color="primary">
                  {darkMode ? <DarkModeIcon /> : <LightModeIcon />}
                </IconButton>
              </Tooltip>

              {/* AI助手按钮 */}
              <Tooltip title="AI助手" placement="left">
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
              <Tooltip title="资源监控" placement="left">
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
              <Tooltip title="连接管理" placement="left">
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
              <Tooltip title="文件管理" placement="left">
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
            </Paper>
          </Box>
        </Box>
      </Box>

      {/* 关于对话框 */}
      <AboutDialog open={aboutDialogOpen} onClose={handleCloseAbout} />
    </ThemeProvider>
  );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
