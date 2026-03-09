import React, { memo, useEffect, useState, useCallback } from "react";
import { Box, Chip, Tooltip, Typography, useTheme, Fade } from "@mui/material";
import SignalWifi4BarIcon from "@mui/icons-material/SignalWifi4Bar";
import SignalWifi3BarIcon from "@mui/icons-material/SignalWifi3Bar";
import SignalWifi2BarIcon from "@mui/icons-material/SignalWifi2Bar";
import SignalWifi1BarIcon from "@mui/icons-material/SignalWifi1Bar";
import SignalWifiOffIcon from "@mui/icons-material/SignalWifiOff";
import ErrorIcon from "@mui/icons-material/Error";
import { useTranslation } from "react-i18next";

/**
 * 网络延迟显示组件
 * 显示当前活跃标签页的SSH连接延迟
 */
const NetworkLatencyIndicator = memo(function NetworkLatencyIndicator({
  currentTab,
  tabs,
  placement = "overlay",
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  // 延迟状态
  const [latencyData, setLatencyData] = useState(null);
  const [isVisible, setIsVisible] = useState(false);

  /**
   * 获取当前应该显示延迟的标签页
   */
  const getCurrentTabForLatency = useCallback(() => {
    if (currentTab > 0 && tabs[currentTab] && tabs[currentTab].type === "ssh") {
      return tabs[currentTab];
    }
    return null;
  }, [currentTab, tabs]);

  /**
   * 处理延迟数据更新
   */
  const handleLatencyUpdate = useCallback(
    (event, data) => {
      const currentTabForLatency = getCurrentTabForLatency();
      if (currentTabForLatency && data.tabId === currentTabForLatency.id) {
        setLatencyData(data);
        setIsVisible(true);
      }
    },
    [getCurrentTabForLatency],
  );

  /**
   * 处理延迟错误
   */
  const handleLatencyError = useCallback(
    (event, data) => {
      const currentTabForLatency = getCurrentTabForLatency();
      if (currentTabForLatency && data.tabId === currentTabForLatency.id) {
        setLatencyData({
          ...data,
          latency: null,
          status: "error",
        });
        setIsVisible(true);
      }
    },
    [getCurrentTabForLatency],
  );

  /**
   * 处理连接断开
   */
  const handleLatencyDisconnected = useCallback(
    (event, data) => {
      const currentTabForLatency = getCurrentTabForLatency();
      if (currentTabForLatency && data.tabId === currentTabForLatency.id) {
        setLatencyData(null);
        setIsVisible(false);
      }
    },
    [getCurrentTabForLatency],
  );

  /**
   * 获取延迟信息并更新显示状态
   */
  const updateLatencyDisplay = useCallback(async () => {
    const currentTabForLatency = getCurrentTabForLatency();

    if (!currentTabForLatency || currentTabForLatency.type !== "ssh") {
      setLatencyData(null);
      setIsVisible(false);
      return;
    }

    try {
      if (window.terminalAPI && window.terminalAPI.getLatencyInfo) {
        const result = await window.terminalAPI.getLatencyInfo(
          currentTabForLatency.id,
        );
        if (result.success && result.data) {
          setLatencyData(result.data);
          setIsVisible(true);
        } else {
          setLatencyData(null);
          setIsVisible(false);
        }
      }
    } catch (error) {
      console.error("获取延迟信息失败:", error);
      setLatencyData(null);
      setIsVisible(false);
    }
  }, [getCurrentTabForLatency]);

  /**
   * 点击延迟指示器时立即执行一次延迟测试
   */
  const handleLatencyClick = useCallback(async () => {
    const currentTabForLatency = getCurrentTabForLatency();

    if (!currentTabForLatency || currentTabForLatency.type !== "ssh") {
      return;
    }

    try {
      // 临时显示检测状态，保留所有现有数据
      setLatencyData((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          status: "checking",
          latency: null,
        };
      });

      // 调用立即测试的API
      if (window.terminalAPI && window.terminalAPI.testLatencyNow) {
        const result = await window.terminalAPI.testLatencyNow(
          currentTabForLatency.id,
        );
        if (!result.success) {
          console.error("延迟测试失败:", result.error);
          // 如果测试失败，恢复原状态
          updateLatencyDisplay();
        }
        // 测试成功后会通过latency:updated事件自动更新数据
      } else {
        // API不可用，恢复原状态
        updateLatencyDisplay();
      }
    } catch (error) {
      console.error("立即测试延迟失败:", error);
      // 恢复原状态
      updateLatencyDisplay();
    }
  }, [getCurrentTabForLatency, updateLatencyDisplay]);

  /**
   * 根据延迟值获取信号强度图标和颜色
   */
  const getSignalInfo = useCallback(
    (latency, status) => {
      if (status === "error") {
        return {
          icon: ErrorIcon,
          color: theme.palette.error.main,
          text: t("latency.error"),
          level: "error",
        };
      }

      if (latency === null || latency === undefined) {
        return {
          icon: SignalWifiOffIcon,
          color: theme.palette.text.disabled,
          text: t("latency.checking"),
          level: "unknown",
        };
      }

      if (latency <= 50) {
        return {
          icon: SignalWifi4BarIcon,
          color: theme.palette.success.main,
          text: t("latency.excellent"),
          level: "excellent",
        };
      } else if (latency <= 100) {
        return {
          icon: SignalWifi3BarIcon,
          color: theme.palette.success.light,
          text: t("latency.good"),
          level: "good",
        };
      } else if (latency <= 200) {
        return {
          icon: SignalWifi2BarIcon,
          color: theme.palette.warning.main,
          text: t("latency.fair"),
          level: "fair",
        };
      } else if (latency <= 500) {
        return {
          icon: SignalWifi1BarIcon,
          color: theme.palette.warning.dark,
          text: t("latency.poor"),
          level: "poor",
        };
      } else {
        return {
          icon: SignalWifiOffIcon,
          color: theme.palette.error.main,
          text: t("latency.bad"),
          level: "bad",
        };
      }
    },
    [theme, t],
  );

  // 监听标签页变化，更新延迟显示
  useEffect(() => {
    updateLatencyDisplay();
  }, [updateLatencyDisplay]);

  // 监听IPC事件
  useEffect(() => {
    if (!window.terminalAPI) return;

    const removeLatencyUpdateListener =
      window.terminalAPI.onLatencyUpdate?.(handleLatencyUpdate);
    const removeLatencyErrorListener =
      window.terminalAPI.onLatencyError?.(handleLatencyError);
    const removeLatencyDisconnectedListener =
      window.terminalAPI.onLatencyDisconnected?.(handleLatencyDisconnected);

    return () => {
      removeLatencyUpdateListener?.();
      removeLatencyErrorListener?.();
      removeLatencyDisconnectedListener?.();
    };
  }, [handleLatencyUpdate, handleLatencyError, handleLatencyDisconnected]);

  // 如果不显示延迟信息，返回null
  if (!isVisible || !latencyData) {
    return null;
  }

  const signalInfo = getSignalInfo(latencyData.latency, latencyData.status);
  const SignalIcon = signalInfo.icon;

  // 构建工具提示内容
  const hasLatencyNumber = typeof latencyData.latency === "number";
  const lastCheckValue = latencyData.lastCheck ?? latencyData.timestamp ?? null;
  const tooltipContent = (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: "bold", mb: 1 }}>
        {t("latency.connectionInfo")}
      </Typography>
      <Typography variant="caption" sx={{ display: "block" }}>
        {t("latency.host")}: {latencyData.host}:{latencyData.port}
      </Typography>
      <Typography variant="caption" sx={{ display: "block" }}>
        {t("latency.current")}:{" "}
        {hasLatencyNumber ? `${latencyData.latency}ms` : t("latency.unknown")}
      </Typography>
      <Typography variant="caption" sx={{ display: "block" }}>
        {t("latency.quality")}: {signalInfo.text}
      </Typography>
      <Typography variant="caption" sx={{ display: "block" }}>
        {t("latency.lastCheck")}:{" "}
        {lastCheckValue
          ? new Date(lastCheckValue).toLocaleTimeString()
          : t("latency.never")}
      </Typography>
      <Typography
        variant="caption"
        sx={{ display: "block", mt: 1, fontStyle: "italic" }}
      >
        {t("latency.updateInterval")}
      </Typography>
      <Typography
        variant="caption"
        sx={{
          display: "block",
          mt: 1,
          fontWeight: "bold",
          color: "primary.main",
        }}
      >
        💡 点击立即测试延迟
      </Typography>
    </Box>
  );

  const containerStyles =
    placement === "inline"
      ? {
          position: "static",
          display: "flex",
          alignItems: "center",
        }
      : {
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 1000,
        };

  const tooltipPlacement = placement === "inline" ? "top" : "top-end";

  return (
    <Fade in={isVisible} timeout={300}>
      <Box sx={containerStyles}>
        <Tooltip title={tooltipContent} placement={tooltipPlacement} arrow>
          <Chip
            icon={<SignalIcon />}
            label={hasLatencyNumber ? `${latencyData.latency}ms` : "--"}
            size="small"
            variant="outlined"
            onClick={handleLatencyClick}
            sx={{
              backgroundColor:
                theme.palette.mode === "dark"
                  ? "rgba(0, 0, 0, 0.8)"
                  : "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(10px)",
              border: `1px solid ${signalInfo.color}`,
              color: signalInfo.color,
              fontWeight: "bold",
              fontSize: "0.75rem",
              minWidth: "80px",
              cursor: "pointer",
              ml: placement === "inline" ? 1 : 0,
              transition: "all 0.3s ease",
              "&:hover": {
                backgroundColor:
                  theme.palette.mode === "dark"
                    ? "rgba(0, 0, 0, 0.9)"
                    : "rgba(255, 255, 255, 1)",
                transform: "scale(1.05)",
                boxShadow: `0 2px 8px ${signalInfo.color}40`,
              },
              "& .MuiChip-icon": {
                color: signalInfo.color,
                fontSize: "1rem",
              },
              // 根据延迟等级添加动画效果
              ...(signalInfo.level === "error" && {
                animation: "pulse 2s infinite",
                "@keyframes pulse": {
                  "0%": { opacity: 1 },
                  "50%": { opacity: 0.6 },
                  "100%": { opacity: 1 },
                },
              }),
            }}
          />
        </Tooltip>
      </Box>
    </Fade>
  );
});

export default NetworkLatencyIndicator;
