import React, { useState, useEffect, memo, useCallback, useRef } from "react";
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
import { formatFileSize } from "../core/utils/formatters";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Grid from "@mui/material/Grid";
import Memory from "@mui/icons-material/Memory"; // For Processes icon

const AccordionHeader = ({ title, icon, expanded, onClick }) => {
  const theme = useTheme();
  return (
    <Box
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        py: 1.25,
        px: 2,
        borderLeft: `4px solid ${theme.palette.primary.main}`,
        "&:hover": {
          backgroundColor: theme.palette.action.hover,
        },
      }}
    >
      {icon}
      <Typography variant="subtitle1" component="h3" fontWeight="bold" sx={{ flexGrow: 1, ml: 1 }}>
        {title}
      </Typography>
      <ExpandMoreIcon
        sx={{
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          transition: theme.transitions.create("transform", {
            duration: theme.transitions.duration.shortest,
          }),
        }}
      />
    </Box>
  );
};

// 资源监控组件
const ResourceMonitor = memo(({ open, onClose, currentTabId }) => {
  const theme = useTheme();
  const [systemInfo, setSystemInfo] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processesLoading, setProcessesLoading] = useState(false);
  const [error, setError] = useState(null);
  const [processError, setProcessError] = useState(null);
  const [refreshInterval, setRefreshInterval] = useState(null);
  const isInitialProcessLoad = useRef(true);
  const [expanded, setExpanded] = useState({
    system: true,
    cpu: true,
    memory: true,
    processes: false,
  });

  const handleExpansion = (panel) => () => {
    setExpanded((prev) => ({ ...prev, [panel]: !prev[panel] }));
  };

  // 获取系统信息
  const fetchSystemInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      if (window.terminalAPI && window.terminalAPI.getSystemInfo) {
        const info = await window.terminalAPI.getSystemInfo(currentTabId);
        if (info.error) {
          setError(info.message || "获取系统信息失败");
        } else {
          setSystemInfo(info);
        }
      } else {
        setError("API不可用");
      }
    } catch (err) {
      setError(err.message || "获取系统信息时发生错误");
    } finally {
      setLoading(false);
    }
  }, [currentTabId]);

  const fetchProcessList = useCallback(async () => {
    try {
      if (isInitialProcessLoad.current) {
        setProcessesLoading(true);
      }
      setProcessError(null);
      if (window.terminalAPI && window.terminalAPI.getProcessList) {
        const processList = await window.terminalAPI.getProcessList(
          currentTabId,
        );
        if (processList.error) {
          setProcessError(processList.message || "获取进程列表失败");
        } else {
          setProcesses(processList);
          if (isInitialProcessLoad.current) {
            isInitialProcessLoad.current = false;
          }
        }
      } else {
        setProcessError("API不可用");
      }
    } catch (err) {
      setProcessError(err.message || "获取进程列表时发生错误");
    } finally {
      setProcessesLoading(false);
    }
  }, [currentTabId]);

  // 当侧边栏打开或标签页切换时获取信息
  useEffect(() => {
    if (refreshInterval) {
      clearInterval(refreshInterval);
    }

    if (open) {
      fetchSystemInfo();
      fetchProcessList();

      const interval = setInterval(() => {
        fetchSystemInfo();
        fetchProcessList();
      }, 5000); // 统一5秒刷新
      setRefreshInterval(interval);

      return () => clearInterval(interval);
    }
  }, [open, currentTabId, fetchSystemInfo, fetchProcessList]);

  // 手动刷新
  const handleRefresh = useCallback(() => {
    fetchSystemInfo();
    fetchProcessList();
  }, [fetchSystemInfo, fetchProcessList]);

  return (
    <Paper
      sx={{
        width: open ? 350 : 0, // 稍宽一点以容纳进程列表
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
            {(loading && !systemInfo) ? (
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
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {/* 系统信息卡片 */}
                <Paper elevation={2} sx={{ borderRadius: 1 }}>
                  <AccordionHeader
                    title={systemInfo.isLocal ? "本地系统" : "远程系统"}
                    icon={<ComputerIcon sx={{ mr: 1, color: theme.palette.primary.main }} />}
                    expanded={expanded.system}
                    onClick={handleExpansion("system")}
                  />
                  <Collapse in={expanded.system} timeout="auto" unmountOnExit>
                    <Box sx={{ p: 2, pt: 0 }}>
                      <Typography variant="body2" gutterBottom>
                        <strong>操作系统:</strong> {systemInfo.os.type}
                        {systemInfo.os.distro &&
                        systemInfo.os.distro !== "未知"
                          ? ` (${systemInfo.os.distro})`
                          : ""}
                        {systemInfo.os.version &&
                        systemInfo.os.version !== "未知"
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
                  </Collapse>
                </Paper>

                {/* CPU信息卡片 */}
                <Paper elevation={2} sx={{ borderRadius: 1 }}>
                  <AccordionHeader
                    title="CPU"
                    icon={<MemoryIcon sx={{ mr: 1, color: theme.palette.warning.main }} />}
                    expanded={expanded.cpu}
                    onClick={handleExpansion("cpu")}
                  />
                  <Collapse in={expanded.cpu} timeout="auto" unmountOnExit>
                    <Box sx={{ p: 2, pt: 0 }}>
                      <Typography variant="body2" gutterBottom>
                        <strong>型号:</strong> {systemInfo.cpu.model}
                      </Typography>
                      <Typography variant="body2" gutterBottom>
                        <strong>核心数:</strong> {systemInfo.cpu.cores}
                      </Typography>
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
                  </Collapse>
                </Paper>

                {/* 内存信息卡片 */}
                <Paper elevation={2} sx={{ borderRadius: 1 }}>
                  <AccordionHeader
                    title="内存"
                    icon={<StorageIcon sx={{ mr: 1, color: theme.palette.info.main }} />}
                    expanded={expanded.memory}
                    onClick={handleExpansion("memory")}
                  />
                  <Collapse in={expanded.memory} timeout="auto" unmountOnExit>
                    <Box sx={{ p: 2, pt: 0 }}>
                      <Typography variant="body2" gutterBottom>
                        <strong>总内存:</strong>{" "}
                        {formatFileSize(systemInfo.memory.total)}
                      </Typography>
                      <Typography variant="body2" gutterBottom>
                        <strong>已用内存:</strong>{" "}
                        {formatFileSize(systemInfo.memory.used)} (
                        {systemInfo.memory.usagePercent}%)
                      </Typography>
                      <Typography variant="body2" gutterBottom>
                        <strong>空闲内存:</strong>{" "}
                        {formatFileSize(systemInfo.memory.free)}
                      </Typography>
                      <Box sx={{ mt: 1, mb: 0.5 }}>
                        <LinearProgress
                          variant="determinate"
                          value={systemInfo.memory.usagePercent}
                          sx={{
                            mt: 1,
                            height: 8,
                            borderRadius: 1,
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
                  </Collapse>
                </Paper>

                {/* 进程列表卡片 */}
                <Paper elevation={2} sx={{ borderRadius: 1 }}>
                  <AccordionHeader
                    title="进程"
                    icon={<Memory sx={{ mr: 1, color: theme.palette.secondary.main }} />}
                    expanded={expanded.processes}
                    onClick={handleExpansion("processes")}
                  />
                  <Collapse in={expanded.processes} timeout="auto" unmountOnExit>
                    <Box sx={{ p: 2, pt: 0, maxHeight: 300, overflowY: "auto" }}>
                      {processesLoading ? (
                        <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
                          <CircularProgress size={24} />
                        </Box>
                      ) : processError ? (
                        <Typography color="error" align="center">
                          {processError}
                        </Typography>
                      ) : (
                        <List dense>
                          <ListItem divider>
                            <Box display="flex" width="100%" alignItems="center">
                              <Box flex="0 0 50%" pr={1} overflow="hidden">
                                <Typography variant="caption" fontWeight="bold">名称</Typography>
                              </Box>
                              <Box flex="0 0 25%" textAlign="right" px={1} sx={{ borderLeft: `1px solid ${theme.palette.divider}` }}>
                                <Typography variant="caption" fontWeight="bold">CPU</Typography>
                              </Box>
                              <Box flex="0 0 25%" textAlign="right" pl={1} sx={{ borderLeft: `1px solid ${theme.palette.divider}` }}>
                                <Typography variant="caption" fontWeight="bold">内存</Typography>
                              </Box>
                            </Box>
                          </ListItem>
                          {processes.slice(0, 50).map((p) => ( // Display top 50 processes
                            <ListItem key={p.pid} divider sx={{py: 0.5}}>
                              <Box display="flex" width="100%" alignItems="center">
                                <Box flex="0 0 50%" pr={1} overflow="hidden">
                                  <Tooltip title={`${p.name} (PID: ${p.pid})`} placement="top-start">
                                    <Typography variant="body2" noWrap>
                                      {p.name}
                                    </Typography>
                                  </Tooltip>
                                </Box>
                                <Box flex="0 0 25%" textAlign="right" px={1} sx={{ borderLeft: `1px solid ${theme.palette.divider}` }}>
                                  <Typography variant="body2" noWrap>
                                    {p.cpu.toFixed(1)}%
                                  </Typography>
                                </Box>
                                <Box flex="0 0 25%" textAlign="right" pl={1} sx={{ borderLeft: `1px solid ${theme.palette.divider}` }}>
                                  <Typography variant="body2" noWrap>
                                    {p.memory.toFixed(1)}%
                                  </Typography>
                                </Box>
                              </Box>
                            </ListItem>
                          ))}
                        </List>
                      )}
                    </Box>
                  </Collapse>
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
                    • 每5秒自动刷新
                  </Typography>
                </Box>
              </Box>
            ) : null}
          </Box>
        </>
      )}
    </Paper>
  );
});

ResourceMonitor.displayName = "ResourceMonitor";

export default ResourceMonitor;
