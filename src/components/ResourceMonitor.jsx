import React, { useState, useEffect, memo, useCallback, useRef } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import IconButton from "@mui/material/IconButton";
import RefreshIcon from "@mui/icons-material/Refresh";
import ComputerIcon from "@mui/icons-material/Computer";
import MemoryIcon from "@mui/icons-material/Memory";
import StorageIcon from "@mui/icons-material/Storage";
import { useTheme } from "@mui/material/styles";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from "react-i18next";
import PropTypes from "prop-types";
import { formatFileSize } from "../core/utils/formatters";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import Memory from "@mui/icons-material/Memory"; // For Processes icon
import {
  SIDEBAR_TITLE_BAR_HEIGHT,
  sidebarListItemButtonSx,
  sidebarTitleIconButtonSx,
} from "./sidebarItemStyles";
import SidebarPanel from "./SidebarPanel.jsx";

/** 进程行内紧凑用量：标签 + 数字 + 分档色细条，等分行宽自适应，窄侧边栏下不溢出 */
const CompactUsageMetric = memo(({ label, value, theme }) => {
  const pct = Math.min(Math.max(Number(value) || 0, 0), 100);
  const barColor =
    pct >= 80
      ? theme.palette.error.main
      : pct >= 50
        ? theme.palette.warning.main
        : theme.palette.success.main;

  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 0.5,
        }}
      >
        <Typography
          variant="caption"
          component="span"
          noWrap
          sx={{
            minWidth: 0,
            fontSize: "0.65rem",
            lineHeight: 1.3,
            color: "text.secondary",
          }}
        >
          {label}
        </Typography>
        <Typography
          variant="caption"
          component="span"
          sx={{
            flexShrink: 0,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1.3,
            fontSize: "0.7rem",
          }}
        >
          {pct.toFixed(1)}%
        </Typography>
      </Box>
      <Box
        sx={{
          mt: 0.25,
          height: 3,
          borderRadius: 1,
          bgcolor: "action.hover",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            height: "100%",
            width: `${pct}%`,
            bgcolor: barColor,
            opacity: 0.85,
            transition: "width 0.25s ease-out",
          }}
        />
      </Box>
    </Box>
  );
});

CompactUsageMetric.displayName = "CompactUsageMetric";
CompactUsageMetric.propTypes = {
  label: PropTypes.node.isRequired,
  value: PropTypes.number.isRequired,
  theme: PropTypes.shape({
    palette: PropTypes.shape({
      error: PropTypes.shape({ main: PropTypes.string.isRequired }).isRequired,
      warning: PropTypes.shape({ main: PropTypes.string.isRequired })
        .isRequired,
      success: PropTypes.shape({ main: PropTypes.string.isRequired })
        .isRequired,
    }).isRequired,
  }).isRequired,
};

const MAX_VISIBLE_PROCESSES = 50;

const AccordionHeader = ({ title, icon, expanded, onClick }) => {
  const theme = useTheme();
  return (
    <Box
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        py: 0.5,
        px: 1.25,
        minHeight: 32,
        ...sidebarListItemButtonSx(theme, expanded),
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          "& .MuiSvgIcon-root": { fontSize: 18 },
        }}
      >
        {icon}
      </Box>
      <Typography
        variant="subtitle2"
        component="h3"
        fontWeight={600}
        sx={{ flexGrow: 1, ml: 0.75, fontSize: "0.8125rem", lineHeight: 1.3 }}
      >
        {title}
      </Typography>
      <ExpandMoreIcon
        sx={{
          fontSize: 18,
          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          transition: theme.transitions.create("transform", {
            duration: theme.transitions.duration.shortest,
          }),
        }}
      />
    </Box>
  );
};
AccordionHeader.propTypes = {
  title: PropTypes.node.isRequired,
  icon: PropTypes.node.isRequired,
  expanded: PropTypes.bool.isRequired,
  onClick: PropTypes.func.isRequired,
};

// 资源监控组件
const ResourceMonitor = memo(({ open, onClose, currentTabId, sessionContext = null }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [systemInfo, setSystemInfo] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processError, setProcessError] = useState(null);
  const [expanded, setExpanded] = useState({
    system: true,
    cpu: true,
    memory: true,
    processes: false,
  });
  const systemInfoIntervalRef = useRef(null);
  const processListIntervalRef = useRef(null);

  const handleExpansion = (panel) => () => {
    setExpanded((prev) => ({ ...prev, [panel]: !prev[panel] }));
  };

  // 获取系统信息
  const fetchSystemInfo = useCallback(
    async (showLoading = false) => {
      try {
        if (showLoading) {
          setLoading(true);
        }
        setError(null);
        if (window.terminalAPI && window.terminalAPI.getSystemInfo) {
          const info = await window.terminalAPI.getSystemInfo(currentTabId);
          if (info.error) {
            setError(
              info.message || t("resourceMonitor.errors.systemInfoFailed"),
            );
          } else {
            setSystemInfo(info);
          }
        } else {
          setError(t("resourceMonitor.errors.apiUnavailable"));
        }
      } catch (err) {
        setError(err.message || t("resourceMonitor.errors.fetchSystemInfo"));
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [currentTabId, t],
  );

  const fetchProcessList = useCallback(async () => {
    try {
      setProcessError(null);
      if (window.terminalAPI && window.terminalAPI.getProcessList) {
        const processList =
          await window.terminalAPI.getProcessList(currentTabId);
        if (processList.error) {
          setProcessError(
            processList.message ||
              t("resourceMonitor.errors.processListFailed"),
          );
        } else {
          setProcesses(processList);
        }
      } else {
        setProcessError(t("resourceMonitor.errors.apiUnavailable"));
      }
    } catch (err) {
      setProcessError(
        err.message || t("resourceMonitor.errors.fetchProcessList"),
      );
    }
  }, [currentTabId, t]);

  const clearPollingTimers = useCallback(() => {
    if (systemInfoIntervalRef.current) {
      clearInterval(systemInfoIntervalRef.current);
      systemInfoIntervalRef.current = null;
    }
    if (processListIntervalRef.current) {
      clearInterval(processListIntervalRef.current);
      processListIntervalRef.current = null;
    }
  }, []);

  // 当侧边栏打开、标签页切换或进程面板展开状态变化时，重建轮询
  useEffect(() => {
    clearPollingTimers();

    if (!open) {
      return clearPollingTimers;
    }

    // 打开瞬间优先拉取一次，避免内容区域空白
    fetchSystemInfo(true);

    // 进程列表仅在面板展开时拉取和轮询，避免无意义的远程 ps 开销
    if (expanded.processes) {
      fetchProcessList();
    }

    systemInfoIntervalRef.current = setInterval(() => {
      fetchSystemInfo(false);
    }, 5000);

    if (expanded.processes) {
      processListIntervalRef.current = setInterval(() => {
        fetchProcessList();
      }, 15000);
    }

    return clearPollingTimers;
  }, [
    open,
    currentTabId,
    expanded.processes,
    fetchSystemInfo,
    fetchProcessList,
    clearPollingTimers,
  ]);

  // 手动刷新
  const handleRefresh = useCallback(() => {
    fetchSystemInfo(false);
    if (expanded.processes) {
      fetchProcessList();
    }
  }, [fetchSystemInfo, fetchProcessList, expanded.processes]);

  return (
    <SidebarPanel
      open={open}
      title={t("resourceMonitor.title")}
      onClose={onClose}
      sessionContext={sessionContext}
      actions={
        <Tooltip title={t("common.refresh")} placement="top">
          <IconButton
            size="small"
            onClick={handleRefresh}
            disabled={loading}
            sx={sidebarTitleIconButtonSx}
            aria-label={t("common.refresh")}
          >
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      }
    >
      <Box
        sx={{
          flexGrow: 1,
          overflow: "auto",
          p: 1.5,
          height: `calc(100% - ${SIDEBAR_TITLE_BAR_HEIGHT}px)`,
        }}
      >
        {loading && !error && !systemInfo ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              width: "100%",
              gap: 1.5,
              py: 4,
            }}
          >
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary" align="center">
              {t("resourceMonitor.loading")}
            </Typography>
          </Box>
        ) : null}

        {error ? (
          <Box sx={{ py: 2 }}>
            <Typography color="error" align="center">
              {error}
            </Typography>
          </Box>
        ) : systemInfo ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {/* 系统信息卡片 */}
            <Paper elevation={2} sx={{ borderRadius: 1 }}>
              <AccordionHeader
                title={
                  systemInfo.isLocal
                    ? t("resourceMonitor.localSystem")
                    : t("resourceMonitor.remoteSystem")
                }
                icon={
                  <ComputerIcon sx={{ color: theme.palette.primary.main }} />
                }
                expanded={expanded.system}
                onClick={handleExpansion("system")}
              />
              <Collapse in={expanded.system} timeout="auto" unmountOnExit>
                <Box sx={{ px: 1.25, pb: 1.25, pt: 0 }}>
                  <Typography variant="body2" gutterBottom>
                    <strong>{t("resourceMonitor.operatingSystem")}:</strong>{" "}
                    {systemInfo.os.type}
                    {systemInfo.os.distro &&
                    systemInfo.os.distro !== t("resourceMonitor.unknown")
                      ? ` (${systemInfo.os.distro})`
                      : ""}
                    {systemInfo.os.version &&
                    systemInfo.os.version !== t("resourceMonitor.unknown")
                      ? ` ${systemInfo.os.version}`
                      : ""}
                  </Typography>
                  <Typography variant="body2" gutterBottom>
                    <strong>{t("resourceMonitor.hostname")}:</strong>{" "}
                    {systemInfo.os.hostname}
                  </Typography>
                  <Typography variant="body2" gutterBottom>
                    <strong>{t("resourceMonitor.platform")}:</strong>{" "}
                    {systemInfo.os.platform}
                  </Typography>
                </Box>
              </Collapse>
            </Paper>

            {/* CPU信息卡片 */}
            <Paper elevation={2} sx={{ borderRadius: 1 }}>
              <AccordionHeader
                title={t("resourceMonitor.cpu")}
                icon={<MemoryIcon sx={{ color: theme.palette.warning.main }} />}
                expanded={expanded.cpu}
                onClick={handleExpansion("cpu")}
              />
              <Collapse in={expanded.cpu} timeout="auto" unmountOnExit>
                <Box sx={{ px: 1.25, pb: 1.25, pt: 0 }}>
                  <Typography variant="body2" gutterBottom>
                    <strong>{t("resourceMonitor.cpuModel")}:</strong>{" "}
                    {systemInfo.cpu.model}
                  </Typography>
                  <Typography variant="body2" gutterBottom>
                    <strong>{t("resourceMonitor.cpuCores")}:</strong>{" "}
                    {systemInfo.cpu.cores}
                  </Typography>
                  <Box sx={{ mt: 1, mb: 0.5 }}>
                    <Typography variant="body2">
                      <strong>{t("resourceMonitor.usage")}:</strong>{" "}
                      {systemInfo.cpu.usage}%
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={systemInfo.cpu.usage}
                      color={
                        systemInfo.cpu.usage > 80
                          ? "error"
                          : systemInfo.cpu.usage > 50
                            ? "warning"
                            : "success"
                      }
                      sx={{
                        mt: 1,
                        height: 8,
                        borderRadius: 1,
                      }}
                    />
                  </Box>
                </Box>
              </Collapse>
            </Paper>

            {/* 内存信息卡片 */}
            <Paper elevation={2} sx={{ borderRadius: 1 }}>
              <AccordionHeader
                title={t("resourceMonitor.memory")}
                icon={<StorageIcon sx={{ color: theme.palette.info.main }} />}
                expanded={expanded.memory}
                onClick={handleExpansion("memory")}
              />
              <Collapse in={expanded.memory} timeout="auto" unmountOnExit>
                <Box sx={{ px: 1.25, pb: 1.25, pt: 0 }}>
                  <Typography variant="body2" gutterBottom>
                    <strong>{t("resourceMonitor.totalMemory")}:</strong>
                    {formatFileSize(systemInfo.memory.total)}
                  </Typography>
                  <Typography variant="body2" gutterBottom>
                    <strong>{t("resourceMonitor.usedMemory")}:</strong>
                    {formatFileSize(systemInfo.memory.used)} (
                    {systemInfo.memory.usagePercent}%)
                  </Typography>
                  <Typography variant="body2" gutterBottom>
                    <strong>{t("resourceMonitor.freeMemory")}:</strong>
                    {formatFileSize(systemInfo.memory.free)}
                  </Typography>
                  <Box sx={{ mt: 1, mb: 0.5 }}>
                    <LinearProgress
                      variant="determinate"
                      value={systemInfo.memory.usagePercent}
                      color={
                        systemInfo.memory.usagePercent > 80
                          ? "error"
                          : systemInfo.memory.usagePercent > 50
                            ? "warning"
                            : "success"
                      }
                      sx={{
                        mt: 1,
                        height: 8,
                        borderRadius: 1,
                      }}
                    />
                  </Box>
                </Box>
              </Collapse>
            </Paper>

            {/* 进程列表卡片 */}
            <Paper elevation={2} sx={{ borderRadius: 1 }}>
              <AccordionHeader
                title={t("resourceMonitor.processes")}
                icon={<Memory sx={{ color: theme.palette.secondary.main }} />}
                expanded={expanded.processes}
                onClick={handleExpansion("processes")}
              />
              <Collapse in={expanded.processes} timeout="auto" unmountOnExit>
                <Box
                  className="app-scrollbar"
                  sx={{
                    px: 1.25,
                    pb: 1.25,
                    pt: 0,
                    maxHeight: "min(420px, 48vh)",
                    overflowY: "auto",
                  }}
                >
                  {processError ? (
                    <Typography color="error" align="center">
                      {processError}
                    </Typography>
                  ) : processes.length === 0 ? (
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "center",
                        py: 2,
                      }}
                    >
                      <CircularProgress size={24} />
                    </Box>
                  ) : (
                    <>
                      <List dense disablePadding sx={{ pb: 0.25 }}>
                        {processes.slice(0, MAX_VISIBLE_PROCESSES).map((p) => (
                          <ListItem
                            key={p.pid}
                            divider
                            sx={{
                              px: 0.75,
                              py: 0.6,
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "stretch",
                              gap: 0.4,
                              borderRadius: 1,
                              "&:hover": { bgcolor: "action.hover" },
                            }}
                          >
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "baseline",
                                gap: 0.75,
                                minWidth: 0,
                              }}
                            >
                              <Tooltip
                                title={`${p.name} (PID: ${p.pid})`}
                                placement="top-start"
                                enterDelay={400}
                              >
                                <Typography
                                  variant="caption"
                                  noWrap
                                  sx={{
                                    flex: 1,
                                    minWidth: 0,
                                    fontSize: "0.75rem",
                                    lineHeight: 1.4,
                                    fontWeight: 500,
                                    color: "text.primary",
                                  }}
                                >
                                  {p.name}
                                </Typography>
                              </Tooltip>
                              <Typography
                                variant="caption"
                                sx={{
                                  flexShrink: 0,
                                  fontSize: "0.68rem",
                                  lineHeight: 1.4,
                                  color: "text.secondary",
                                  fontFamily: "ui-monospace, monospace",
                                  fontVariantNumeric: "tabular-nums",
                                }}
                              >
                                PID {p.pid}
                              </Typography>
                            </Box>
                            <Box sx={{ display: "flex", gap: 1 }}>
                              <CompactUsageMetric
                                label={t("resourceMonitor.cpuShort")}
                                value={p.cpu}
                                theme={theme}
                              />
                              <CompactUsageMetric
                                label={t("resourceMonitor.memoryShort")}
                                value={p.memory}
                                theme={theme}
                              />
                            </Box>
                          </ListItem>
                        ))}
                      </List>
                      {processes.length > MAX_VISIBLE_PROCESSES && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          align="center"
                          display="block"
                          sx={{ pt: 0.75, fontSize: "0.68rem" }}
                        >
                          {t("resourceMonitor.topProcessesHint", {
                            count: MAX_VISIBLE_PROCESSES,
                          })}
                        </Typography>
                      )}
                    </>
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
                  ? t("resourceMonitor.localInfo")
                  : t("resourceMonitor.remoteInfo")}
                {" • "}
                {t("resourceMonitor.autoRefresh")}
              </Typography>
            </Box>
          </Box>
        ) : null}
      </Box>
    </SidebarPanel>
  );
});

ResourceMonitor.displayName = "ResourceMonitor";
ResourceMonitor.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  currentTabId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  sessionContext: PropTypes.shape({
    host: PropTypes.string,
    protocol: PropTypes.string,
    quality: PropTypes.string,
    cwd: PropTypes.string,
  }),
};

export default ResourceMonitor;
