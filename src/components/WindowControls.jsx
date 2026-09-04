import React, { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import HorizontalRuleIcon from "@mui/icons-material/HorizontalRule";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import FilterNoneIcon from "@mui/icons-material/FilterNone";
import CloseIcon from "@mui/icons-material/Close";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

const defaultWindowState = { isMaximized: false, isFullScreen: false };

const WindowControls = () => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [windowState, setWindowState] = useState(defaultWindowState);

  const updateState = useCallback((state) => {
    if (!state) {
      return;
    }

    setWindowState({
      isMaximized: Boolean(state.isMaximized),
      isFullScreen: Boolean(state.isFullScreen),
    });
  }, []);

  useEffect(() => {
    let unsubscribe;

    if (window?.terminalAPI?.onWindowStateChange) {
      unsubscribe = window.terminalAPI.onWindowStateChange(updateState);
    }

    const fetchInitialState = async () => {
      if (!window?.terminalAPI?.getWindowState) {
        return;
      }

      try {
        const state = await window.terminalAPI.getWindowState();
        updateState(state);
      } catch {
        // 状态获取失败时忽略错误，保持默认值
      }
    };

    fetchInitialState();

    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [updateState]);

  const handleMinimize = useCallback(() => {
    window?.terminalAPI?.minimizeWindow?.();
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    if (!window?.terminalAPI?.toggleMaximizeWindow) {
      return;
    }

    try {
      const state = await window.terminalAPI.toggleMaximizeWindow();
      updateState(state);
    } catch {
      // 忽略切换失败，状态会通过事件同步
    }
  }, [updateState]);

  const handleClose = useCallback(() => {
    window?.terminalAPI?.closeWindow?.();
  }, []);

  const isExpanded = windowState.isFullScreen || windowState.isMaximized;

  const isLight = theme.palette.mode === "light";

  const idleBg = isLight
    ? "rgba(21, 23, 25, 0.08)"
    : "rgba(241, 242, 239, 0.10)";
  const hoverBg = isLight
    ? "rgba(21, 23, 25, 0.16)"
    : "rgba(241, 242, 239, 0.18)";

  // 浅色背景下使用正文主色，保证窗口控制按钮清晰可辨
  const iconColor = isLight
    ? theme.palette.text.primary
    : theme.palette.grey[100];

  const controlSize = 32;

  // 用 && 提升特异性，避免被 MuiIconButton 的全局 styleOverrides 覆盖；
  // 常驻淡色圆底 + 加粗笔画，确保细线图标在浅色背景下也有足够视觉分量
  const buttonSx = {
    width: controlSize,
    height: controlSize,
    borderRadius: "50%",
    padding: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background-color 0.15s ease",
    "&&": {
      color: iconColor,
      backgroundColor: idleBg,
    },
    "&&:hover": {
      backgroundColor: hoverBg,
      color: iconColor,
    },
    "&& .MuiSvgIcon-root": {
      fontSize: "1.25rem",
      color: "inherit",
      strokeWidth: isLight ? 1.1 : 0,
      stroke: isLight ? "currentColor" : "transparent",
    },
  };

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        WebkitAppRegion: "no-drag",
        ml: 0.5,
      }}
    >
      <Tooltip title={t("windowControls.minimize")}>
        <IconButton
          size="small"
          disableRipple
          aria-label={t("windowControls.minimize")}
          onClick={handleMinimize}
          sx={buttonSx}
        >
          <HorizontalRuleIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>
      <Tooltip
        title={
          isExpanded
            ? t("windowControls.restore")
            : t("windowControls.maximize")
        }
      >
        <IconButton
          size="small"
          disableRipple
          aria-label={
            isExpanded
              ? t("windowControls.restore")
              : t("windowControls.maximize")
          }
          onClick={handleToggleMaximize}
          sx={buttonSx}
        >
          {isExpanded ? (
            <FilterNoneIcon fontSize="inherit" />
          ) : (
            <CropSquareIcon fontSize="inherit" />
          )}
        </IconButton>
      </Tooltip>
      <Tooltip title={t("windowControls.close")}>
        <IconButton
          size="small"
          disableRipple
          aria-label={t("windowControls.close")}
          onClick={handleClose}
          sx={{
            ...buttonSx,
            "&&": {
              color: isLight
                ? theme.palette.error.dark
                : theme.palette.error.light,
              backgroundColor: isLight
                ? "rgba(181, 54, 48, 0.12)"
                : "rgba(224, 106, 99, 0.14)",
            },
            "&&:hover": {
              backgroundColor: theme.palette.error.main,
              color: theme.palette.error.contrastText,
            },
          }}
        >
          <CloseIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

export default WindowControls;
