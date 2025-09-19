import React, { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import MinimizeIcon from "@mui/icons-material/Minimize";
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
      } catch (error) {
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
    } catch (error) {
      // 忽略切换失败，状态会通过事件同步
    }
  }, [updateState]);

  const handleClose = useCallback(() => {
    window?.terminalAPI?.closeWindow?.();
  }, []);

  const isExpanded = windowState.isFullScreen || windowState.isMaximized;

  const baseHover =
    theme.palette.mode === "light"
      ? "rgba(0, 0, 0, 0.06)"
      : "rgba(255, 255, 255, 0.08)";

  const iconColor =
    theme.palette.mode === "light"
      ? theme.palette.grey[700]
      : theme.palette.grey[200];

  const buttonSx = {
    width: 36,
    height: 28,
    borderRadius: 6,
    color: iconColor,
    transition: "background-color 0.15s ease",
    "&:hover": {
      backgroundColor: baseHover,
    },
    "& .MuiSvgIcon-root": {
      fontSize: "1.05rem",
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
      <Tooltip title={t("windowControls.minimize") ?? ""}>
        <IconButton
          size="small"
          disableRipple
          aria-label={t("windowControls.minimize")}
          onClick={handleMinimize}
          sx={buttonSx}
        >
          <MinimizeIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>
      <Tooltip
        title={
          isExpanded
            ? t("windowControls.restore") ?? ""
            : t("windowControls.maximize") ?? ""
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
      <Tooltip title={t("windowControls.close") ?? ""}>
        <IconButton
          size="small"
          disableRipple
          aria-label={t("windowControls.close")}
          onClick={handleClose}
          sx={{
            ...buttonSx,
            color:
              theme.palette.mode === "light"
                ? theme.palette.error.dark
                : theme.palette.error.light,
            "&:hover": {
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
