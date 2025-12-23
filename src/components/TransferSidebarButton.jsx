import React, { memo, useMemo } from "react";
import { Box, IconButton, Tooltip, CircularProgress } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { SwapVert } from "@mui/icons-material";
import { useAllGlobalTransfers } from "../store/globalTransferStore.js";

/**
 * 传输侧边栏按钮 - 带环形进度条
 */
const TransferSidebarButton = memo(({ isOpen, onClick, tooltip = "文件传输" }) => {
  const theme = useTheme();
  const { allTransfers } = useAllGlobalTransfers();

  // 计算总进度
  const { totalProgress, hasActiveTransfers, activeCount } = useMemo(() => {
    if (!allTransfers || allTransfers.length === 0) {
      return { totalProgress: 0, hasActiveTransfers: false, activeCount: 0 };
    }

    const activeTransfers = allTransfers.filter(
      (t) => t.progress < 100 && !t.isCancelled && !t.error
    );

    if (activeTransfers.length === 0) {
      return { totalProgress: 0, hasActiveTransfers: false, activeCount: 0 };
    }

    const total = activeTransfers.reduce((sum, t) => sum + (t.progress || 0), 0);
    const avg = total / activeTransfers.length;

    return {
      totalProgress: avg,
      hasActiveTransfers: true,
      activeCount: activeTransfers.length,
    };
  }, [allTransfers]);

  return (
    <Tooltip title={tooltip} placement="left">
      <Box
        sx={{
          position: "relative",
          width: 40,
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* 环形进度条背景 */}
        {hasActiveTransfers && (
          <CircularProgress
            variant="determinate"
            value={100}
            size={38}
            thickness={3}
            sx={{
              position: "absolute",
              color: theme.palette.action.disabledBackground,
            }}
          />
        )}
        {/* 环形进度条 */}
        {hasActiveTransfers && (
          <CircularProgress
            variant="determinate"
            value={totalProgress}
            size={38}
            thickness={3}
            sx={{
              position: "absolute",
              color: theme.palette.primary.main,
              "& .MuiCircularProgress-circle": {
                strokeLinecap: "round",
              },
            }}
          />
        )}
        {/* 按钮 */}
        <IconButton
          onClick={onClick}
          size="small"
          sx={{
            width: 32,
            height: 32,
            bgcolor: isOpen ? "action.selected" : "transparent",
            "&:hover": {
              bgcolor: isOpen ? "action.selected" : "action.hover",
            },
          }}
        >
          <SwapVert
            sx={{
              fontSize: 20,
              color: hasActiveTransfers
                ? theme.palette.primary.main
                : "inherit",
            }}
          />
        </IconButton>
        {/* 活跃传输数量徽章 */}
        {activeCount > 0 && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              right: 0,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              bgcolor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              fontSize: 10,
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              px: 0.5,
            }}
          >
            {activeCount}
          </Box>
        )}
      </Box>
    </Tooltip>
  );
});

TransferSidebarButton.displayName = "TransferSidebarButton";

export default TransferSidebarButton;
