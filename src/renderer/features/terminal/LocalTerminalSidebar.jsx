import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  memo,
} from "react";
import {
  Box,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  CircularProgress,
  Chip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import RefreshIcon from "@mui/icons-material/Refresh";
import TerminalIcon from "@mui/icons-material/Terminal";
import ComputerIcon from "@mui/icons-material/Computer";
import { useTranslation } from "react-i18next";
import useAutoCleanup from "../../shared/hooks/useAutoCleanup";
import {
  SIDEBAR_ROW_GAP_PX,
  sidebarFooterSx,
  sidebarListAreaSx,
  sidebarListItemButtonSx,
  sidebarSectionSx,
  sidebarTitleIconButtonSx,
} from "../../shared/ui/sidebarItemStyles";
import SidebarPanel from "../../shared/ui/SidebarPanel.jsx";
import SidebarSearchField from "../../shared/ui/SidebarSearchField.jsx";
import SidebarEmptyState from "../../shared/ui/SidebarEmptyState.jsx";
import { SidebarListSkeleton } from "../../shared/ui/SkeletonLoader.jsx";
import useSidebarPanel from "../../shared/hooks/useSidebarPanel";
import { useNotification } from "../../shared/notifications/NotificationContext";

const AUTO_REFRESH_COOLDOWN_MS = 2000;

// 终端类型图标映射
const getTerminalIcon = (terminal) => {
  return terminal.type === "wsl" ? (
    <ComputerIcon fontSize="small" />
  ) : (
    <TerminalIcon fontSize="small" />
  );
};

const STATUS_COLOR_MAP = {
  running: "success",
  stopped: "default",
  unknown: "warning",
};

const TERMINAL_ROW_SX = { mb: `${SIDEBAR_ROW_GAP_PX}px`, flexShrink: 0 };
const TERMINAL_ICON_SLOT_SX = { minWidth: 40 };
const TERMINAL_SECONDARY_SX = {
  display: "flex",
  flexDirection: "column",
  gap: 0.25,
};
const TERMINAL_CHIP_SX = {
  ml: "auto",
  height: 18,
  "& .MuiChip-label": {
    px: 0.75,
    fontSize: "0.6875rem",
  },
};

// 终端项：模块级 memo 组件，身份稳定，刷新检测结果时不会整列表重挂载
const TerminalItem = memo(function TerminalItem({ terminal, onLaunch }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isWSLTerminal = terminal.type === "wsl";
  const availableDistributions = Array.isArray(terminal.availableDistributions)
    ? terminal.availableDistributions
    : [];
  const runningCount = availableDistributions.filter(
    (dist) =>
      (dist.runtimeState || dist.state || "").toLowerCase() === "running",
  ).length;
  const runtimeState =
    terminal.runtimeStatus?.state ||
    (runningCount > 0
      ? "running"
      : availableDistributions.length > 0
        ? "stopped"
        : "unknown");

  const statusLabelMap = {
    running: t("localTerminal.statusRunning"),
    stopped: t("localTerminal.statusStopped"),
    unknown: t("localTerminal.statusUnknown"),
  };

  const secondaryLines = [];
  if (terminal.description) {
    secondaryLines.push(
      <Typography key="description" variant="caption" color="text.secondary">
        {terminal.description}
      </Typography>,
    );
  }

  if (isWSLTerminal) {
    secondaryLines.push(
      <Typography key="wsl-status" variant="caption" color="text.secondary">
        {t("localTerminal.wslRunningSummary", {
          running: terminal.runtimeStatus?.runningCount ?? runningCount,
          total:
            terminal.runtimeStatus?.totalCount ?? availableDistributions.length,
        })}
      </Typography>,
    );
  }

  return (
    <ListItem disablePadding sx={TERMINAL_ROW_SX}>
      <ListItemButton
        onClick={() => onLaunch(terminal)}
        sx={{
          ...sidebarListItemButtonSx(theme),
          minHeight: 52,
          py: 0.75,
          pr: 2,
        }}
      >
        <ListItemIcon sx={TERMINAL_ICON_SLOT_SX}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: theme.palette.background.paper,
              border: `1px solid ${theme.palette.divider}`,
            }}
          >
            {getTerminalIcon(terminal)}
          </Box>
        </ListItemIcon>

        <ListItemText
          sx={{ my: 0, minWidth: 0 }}
          primary={
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Typography
                variant="body2"
                noWrap
                sx={{ fontWeight: 500, fontSize: "0.875rem" }}
              >
                {terminal.name}
              </Typography>
              {isWSLTerminal && (
                <Chip
                  size="small"
                  color={STATUS_COLOR_MAP[runtimeState] || "default"}
                  variant={runtimeState === "running" ? "filled" : "outlined"}
                  label={
                    statusLabelMap[runtimeState] ||
                    t("localTerminal.statusUnknown")
                  }
                  sx={TERMINAL_CHIP_SX}
                />
              )}
            </Box>
          }
          secondary={
            secondaryLines.length > 0 ? (
              <Box component="span" sx={TERMINAL_SECONDARY_SX}>
                {secondaryLines}
              </Box>
            ) : null
          }
        />
      </ListItemButton>
    </ListItem>
  );
});

const LocalTerminalSidebar = ({
  open,
  onClose,
  onLaunchTerminal,
  sessionContext = null,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [detectedTerminals, setDetectedTerminals] = useState([]);
  const [isDetecting, setIsDetecting] = useState(true); // 初始状态设为检测中
  const [searchQuery, setSearchQuery] = useState("");
  const [hasInitialDetection, setHasInitialDetection] = useState(false); // 跟踪是否已进行初始检测
  const { showNotification: showGlobalNotification } = useNotification();

  const setSnackbar = useCallback(
    ({ message, severity }) => {
      showGlobalNotification(message, severity, {
        autoHideDuration: 4000,
        anchorOrigin: { vertical: "bottom", horizontal: "center" },
        variant: "standard",
      });
    },
    [showGlobalNotification],
  );

  const searchInputRef = useRef(null);
  const sidebarRef = useRef(null);
  const lastAutoRefreshAtRef = useRef(0);

  // 清理资源的自定义hook - useAutoCleanup不接受参数
  useAutoCleanup();

  useSidebarPanel({
    open,
    rootRef: sidebarRef,
    searchInputRef,
  });

  // 检测可用终端
  const detectTerminals = useCallback(
    async (forceRefresh = false, options = {}) => {
      const { silent = false } =
        options && typeof options === "object" ? options : {};

      if (!silent) {
        setIsDetecting(true);
      }

      try {
        if (window.terminalAPI?.detectLocalTerminals) {
          const terminals = await window.terminalAPI.detectLocalTerminals({
            forceRefresh,
            refreshRuntimeStatus: true,
          });

          setDetectedTerminals(terminals || []);
          setHasInitialDetection(true); // 标记已完成初始检测

          // 只在手动刷新时显示成功消息，初始检测不显示
          if (hasInitialDetection && forceRefresh) {
            setSnackbar({
              open: true,
              message: t("localTerminal.detectSuccess", {
                count: terminals?.length || 0,
              }),
              severity: "success",
            });
          }
        } else {
          setHasInitialDetection(true);
          setSnackbar({
            open: true,
            message: t("localTerminal.apiUnavailable"),
            severity: "error",
          });
        }
      } catch {
        setHasInitialDetection(true);
        if (!silent) {
          setSnackbar({
            open: true,
            message: t("localTerminal.detectError"),
            severity: "error",
          });
        }
      } finally {
        if (!silent) {
          setIsDetecting(false);
        }
      }
    },
    [t, hasInitialDetection, setSnackbar],
  );

  // 侧边栏打开时检测终端；首次显示骨架，后续无感刷新
  useEffect(() => {
    if (!open) return;

    if (!hasInitialDetection) {
      detectTerminals(false, { silent: false });
      return;
    }

    detectTerminals(false, { silent: true });
  }, [open, hasInitialDetection, detectTerminals]);

  const hasWSLTerminal = useMemo(
    () => detectedTerminals.some((terminal) => terminal.type === "wsl"),
    [detectedTerminals],
  );

  const autoRefreshTerminals = useCallback(async () => {
    if (!open || !hasInitialDetection || !hasWSLTerminal) {
      return;
    }

    const now = Date.now();
    if (now - lastAutoRefreshAtRef.current < AUTO_REFRESH_COOLDOWN_MS) {
      return;
    }
    lastAutoRefreshAtRef.current = now;

    await detectTerminals(false, { silent: true });
  }, [open, hasInitialDetection, hasWSLTerminal, detectTerminals]);

  // 事件驱动自动刷新：窗口回到前台时刷新（无轮询）
  useEffect(() => {
    if (!open || !hasInitialDetection || !hasWSLTerminal) {
      return undefined;
    }

    const handleWindowFocus = () => {
      autoRefreshTerminals();
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        autoRefreshTerminals();
      }
    };

    window.addEventListener("focus", handleWindowFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [open, hasInitialDetection, hasWSLTerminal, autoRefreshTerminals]);

  // 事件驱动自动刷新：本地终端状态变化时刷新（无轮询）
  useEffect(() => {
    if (!open || !hasInitialDetection || !hasWSLTerminal) {
      return undefined;
    }
    if (!window.terminalAPI?.onLocalTerminalStatus) {
      return undefined;
    }

    const trackedTypes = new Set(["starting", "ready", "exit", "error"]);

    const handleLocalTerminalStatus = (statusData) => {
      if (!trackedTypes.has(statusData?.type)) {
        return;
      }
      autoRefreshTerminals();
    };

    const unsubscribe = window.terminalAPI.onLocalTerminalStatus(
      handleLocalTerminalStatus,
    );

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
        return;
      }
      if (window.terminalAPI?.offLocalTerminalStatus) {
        window.terminalAPI.offLocalTerminalStatus(handleLocalTerminalStatus);
      }
    };
  }, [open, hasInitialDetection, hasWSLTerminal, autoRefreshTerminals]);

  // 过滤终端列表
  const filteredTerminals = useMemo(() => {
    if (!searchQuery) return detectedTerminals;
    const query = searchQuery.toLowerCase();
    return detectedTerminals.filter(
      (terminal) =>
        terminal.name.toLowerCase().includes(query) ||
        terminal.type.toLowerCase().includes(query),
    );
  }, [detectedTerminals, searchQuery]);

  // 启动终端
  const handleLaunchTerminal = useCallback(
    async (terminal) => {
      // 添加终端配置检查
      if (!terminal) {
        setSnackbar({
          open: true,
          message: t("localTerminal.noTerminalSelected"),
          severity: "warning",
        });
        return;
      }

      try {
        if (onLaunchTerminal) {
          await onLaunchTerminal(terminal);
          setSnackbar({
            open: true,
            message: t("localTerminal.launchSuccess", { name: terminal.name }),
            severity: "success",
          });
        }
      } catch (error) {
        // 提供更详细的错误信息
        let errorMessage =
          error.message ||
          t("localTerminal.launchError", {
            error: t("localTerminal.unknownError"),
          });

        if (error.executable) {
          errorMessage = `${errorMessage}\n${t("localTerminal.pathLabel", {
            path: error.executable,
          })}`;
        }

        if (error.suggestion) {
          errorMessage = `${errorMessage}\n${error.suggestion}`;
        }

        setSnackbar({
          open: true,
          message: errorMessage,
          severity: "error",
        });
      }
    },
    [onLaunchTerminal, t, setSnackbar],
  );

  // 处理右键菜单
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // 仅首次检测显示骨架；手动/自动刷新期间保留现有列表与搜索框，避免布局跳变
  const showSkeleton = isDetecting && !hasInitialDetection;

  return (
    <SidebarPanel
      open={open}
      rootRef={sidebarRef}
      title={t("localTerminal.title")}
      onClose={onClose}
      sessionContext={sessionContext}
      square={true}
      borderLeft={false}
      titleBarSx={{ gap: 1 }}
      titleSx={{ flexGrow: 1 }}
      actionsSx={{ display: "flex", alignItems: "center", gap: 1 }}
      actions={
        <Tooltip title={t("localTerminal.refresh")}>
          {/* 禁用的按钮不派发鼠标事件，外包 span 让 Tooltip 仍可响应 */}
          <span>
            <IconButton
              size="small"
              onClick={() => detectTerminals(true, { silent: false })}
              disabled={isDetecting}
              sx={sidebarTitleIconButtonSx}
              aria-label={t("localTerminal.refresh")}
            >
              {isDetecting ? (
                <CircularProgress size={16} />
              ) : (
                <RefreshIcon fontSize="small" />
              )}
            </IconButton>
          </span>
        </Tooltip>
      }
    >
      {/* 搜索框 */}
      <Box sx={sidebarSectionSx(theme)}>
        <SidebarSearchField
          inputRef={searchInputRef}
          placeholder={t("localTerminal.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onClear={clearSearch}
        />
      </Box>

      {/* 可用终端列表 */}
      <Box className="app-scrollbar" sx={sidebarListAreaSx}>
        {showSkeleton ? (
          <SidebarListSkeleton variant="localTerminal" />
        ) : filteredTerminals.length > 0 ? (
          <List disablePadding>
            {filteredTerminals.map((terminal, index) => (
              <TerminalItem
                key={terminal.id || terminal.type || `terminal-${index}`}
                terminal={terminal}
                onLaunch={handleLaunchTerminal}
              />
            ))}
          </List>
        ) : (
          // 只有在初始检测完成后才显示提示信息
          hasInitialDetection && (
            <SidebarEmptyState
              icon={<TerminalIcon />}
              message={
                searchQuery
                  ? t("localTerminal.noSearchResults")
                  : t("localTerminal.noTerminals")
              }
            />
          )
        )}
      </Box>

      {/* 状态栏 */}
      <Box sx={sidebarFooterSx(theme)}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {showSkeleton
            ? t("common.loading")
            : `${t("localTerminal.availableTerminals")} (${filteredTerminals.length})`}
        </Typography>
      </Box>
    </SidebarPanel>
  );
};

export default LocalTerminalSidebar;
