import React, { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import ComputerIcon from "@mui/icons-material/Computer";
import MemoryIcon from "@mui/icons-material/Memory";
import StorageIcon from "@mui/icons-material/Storage";
import { useTheme } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";

// 将字节转换为可读大小
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
}

// 资源监控组件
const ResourceMonitor = ({ open, onClose, currentTabId }) => {
  const theme = useTheme();
  const [systemInfo, setSystemInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(null);

  // 获取系统信息
  const fetchSystemInfo = async () => {
    try {
      setLoading(true);
      setError(null);

      // 输出调试信息
      console.log(
        `ResourceMonitor: 尝试获取系统信息，currentTabId =`,
        currentTabId,
      );

      if (window.terminalAPI && window.terminalAPI.getSystemInfo) {
        const info = await window.terminalAPI.getSystemInfo(currentTabId);
        console.log(
          `ResourceMonitor: 获取到系统信息:`,
          info.isLocal ? "本地系统" : "远程系统",
        );

        if (info.error) {
          setError(info.message || "获取系统信息失败");
        } else {
          setSystemInfo(info);
        }
      } else {
        setError("API不可用");
      }
    } catch (err) {
      console.error("Failed to fetch system info:", err);
      setError(err.message || "获取系统信息时发生错误");
    } finally {
      setLoading(false);
    }
  };

  // 当侧边栏打开或标签页切换时获取系统信息
  useEffect(() => {
    // 清理之前的刷新间隔
    if (refreshInterval) {
      clearInterval(refreshInterval);
      setRefreshInterval(null);
    }

    // 只有在侧边栏打开时才设置刷新间隔
    if (open) {
      fetchSystemInfo();

      // 设置刷新间隔为3秒
      const interval = setInterval(fetchSystemInfo, 3000);
      setRefreshInterval(interval);

      return () => {
        if (refreshInterval) {
          clearInterval(refreshInterval);
        }
      };
    }
  }, [open, currentTabId]);

  // 手动刷新
  const handleRefresh = () => {
    fetchSystemInfo();
  };

  return (
    <Paper
      sx={{
        width: open ? 300 : 0,
        height: "100%",
        overflow: "hidden",
        transition: theme.transitions.create("width", {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        borderLeft: `1px solid ${theme.palette.divider}`,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
      }}
      elevation={4}
    >
      {open && (
        <>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              p: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Typography variant="subtitle1" fontWeight="medium">
              系统资源监控
            </Typography>
            <Box>
              <Tooltip title="刷新" placement="top">
                <IconButton
                  size="small"
                  onClick={handleRefresh}
                  disabled={loading}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <IconButton size="small" onClick={onClose}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>

          <Box
            sx={{
              flexGrow: 1,
              overflow: "auto",
              p: 2,
              height: "calc(100% - 56px)",
            }}
          >
            {loading && !systemInfo ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : error ? (
              <Box sx={{ py: 2 }}>
                <Typography color="error" align="center">
                  {error}
                </Typography>
              </Box>
            ) : systemInfo ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {/* 系统信息卡片 */}
                <Paper
                  elevation={2}
                  sx={{
                    p: 2,
                    borderRadius: 1,
                    borderLeft: `4px solid ${theme.palette.primary.main}`,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <ComputerIcon
                      sx={{ mr: 1, color: theme.palette.primary.main }}
                    />
                    <Typography
                      variant="subtitle1"
                      component="h3"
                      fontWeight="bold"
                    >
                      {systemInfo.isLocal ? "本地系统" : "远程系统"}
                    </Typography>
                  </Box>

                  <Box sx={{ ml: 4 }}>
                    <Typography variant="body2" gutterBottom>
                      <strong>操作系统:</strong> {systemInfo.os.type}
                      {systemInfo.os.distro && systemInfo.os.distro !== "未知"
                        ? ` (${systemInfo.os.distro})`
                        : ""}
                      {systemInfo.os.version && systemInfo.os.version !== "未知"
                        ? ` ${systemInfo.os.version}`
                        : ""}
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      <strong>主机名:</strong> {systemInfo.os.hostname}
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      <strong>平台:</strong> {systemInfo.os.platform}
                    </Typography>
                  </Box>
                </Paper>

                {/* CPU信息卡片 */}
                <Paper
                  elevation={2}
                  sx={{
                    p: 2,
                    borderRadius: 1,
                    borderLeft: `4px solid ${theme.palette.warning.main}`,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <MemoryIcon
                      sx={{ mr: 1, color: theme.palette.warning.main }}
                    />
                    <Typography
                      variant="subtitle1"
                      component="h3"
                      fontWeight="bold"
                    >
                      CPU
                    </Typography>
                  </Box>

                  <Box sx={{ ml: 4 }}>
                    <Typography variant="body2" gutterBottom>
                      <strong>型号:</strong> {systemInfo.cpu.model}
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      <strong>核心数:</strong> {systemInfo.cpu.cores}
                    </Typography>
                    {systemInfo.cpu.speed && (
                      <Typography variant="body2" gutterBottom>
                        <strong>速度:</strong> {systemInfo.cpu.speed} MHz
                      </Typography>
                    )}

                    <Box sx={{ mt: 1, mb: 0.5 }}>
                      <Typography variant="body2">
                        <strong>使用率:</strong> {systemInfo.cpu.usage}%
                      </Typography>
                      <LinearProgress
                        variant="determinate"
                        value={systemInfo.cpu.usage}
                        sx={{
                          mt: 1,
                          height: 8,
                          borderRadius: 1,
                          bgcolor:
                            theme.palette.mode === "dark"
                              ? "rgba(255,255,255,0.1)"
                              : "rgba(0,0,0,0.1)",
                          "& .MuiLinearProgress-bar": {
                            bgcolor:
                              systemInfo.cpu.usage > 80
                                ? theme.palette.error.main
                                : systemInfo.cpu.usage > 60
                                  ? theme.palette.warning.main
                                  : theme.palette.success.main,
                          },
                        }}
                      />
                    </Box>
                  </Box>
                </Paper>

                {/* 内存信息卡片 */}
                <Paper
                  elevation={2}
                  sx={{
                    p: 2,
                    borderRadius: 1,
                    borderLeft: `4px solid ${theme.palette.info.main}`,
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                    <StorageIcon
                      sx={{ mr: 1, color: theme.palette.info.main }}
                    />
                    <Typography
                      variant="subtitle1"
                      component="h3"
                      fontWeight="bold"
                    >
                      内存
                    </Typography>
                  </Box>

                  <Box sx={{ ml: 4 }}>
                    <Typography variant="body2" gutterBottom>
                      <strong>总内存:</strong>{" "}
                      {formatBytes(systemInfo.memory.total)}
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      <strong>已用内存:</strong>{" "}
                      {formatBytes(systemInfo.memory.used)} (
                      {systemInfo.memory.usagePercent}%)
                    </Typography>
                    <Typography variant="body2" gutterBottom>
                      <strong>空闲内存:</strong>{" "}
                      {formatBytes(systemInfo.memory.free)}
                    </Typography>

                    <Box sx={{ mt: 1, mb: 0.5 }}>
                      <LinearProgress
                        variant="determinate"
                        value={systemInfo.memory.usagePercent}
                        sx={{
                          mt: 1,
                          height: 8,
                          borderRadius: 1,
                          bgcolor:
                            theme.palette.mode === "dark"
                              ? "rgba(255,255,255,0.1)"
                              : "rgba(0,0,0,0.1)",
                          "& .MuiLinearProgress-bar": {
                            bgcolor:
                              systemInfo.memory.usagePercent > 80
                                ? theme.palette.error.main
                                : systemInfo.memory.usagePercent > 60
                                  ? theme.palette.warning.main
                                  : theme.palette.success.main,
                          },
                        }}
                      />
                    </Box>
                  </Box>
                </Paper>

                {/* 系统信息提示 */}
                <Box sx={{ mt: 1 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    align="center"
                    display="block"
                  >
                    {systemInfo.isLocal
                      ? "显示本地系统信息"
                      : "显示远程系统信息"}
                    • 每3秒自动刷新
                  </Typography>
                </Box>
              </Box>
            ) : null}
          </Box>
        </>
      )}
    </Paper>
  );
};

export default ResourceMonitor;
