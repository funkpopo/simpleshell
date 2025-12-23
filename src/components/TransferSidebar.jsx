import React, { memo, useMemo, useCallback, useState } from "react";
import {
  Box,
  Dialog,
  Typography,
  IconButton,
  LinearProgress,
  Chip,
  Divider,
  Button,
  Tooltip,
} from "@mui/material";
import { styled, useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import MinimizeIcon from "@mui/icons-material/Minimize";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import FolderIcon from "@mui/icons-material/Folder";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import CancelIcon from "@mui/icons-material/Cancel";
import StopIcon from "@mui/icons-material/Stop";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import { useTranslation } from "react-i18next";
import {
  useAllGlobalTransfers,
  useTransferHistory,
} from "../store/globalTransferStore.js";

// 浮动窗口对话框样式（参考 AIChatWindow）
const FloatingDialog = styled(Dialog)(({ theme, customwidth, customzindex }) => ({
  pointerEvents: "none",
  zIndex: customzindex || 1300,
  "& .MuiDialog-container": {
    pointerEvents: "none",
  },
  "& .MuiDialog-paper": {
    pointerEvents: "auto",
    position: "fixed",
    right: 50,
    bottom: 20,
    margin: 0,
    width: customwidth || 320,
    maxWidth: "90vw",
    height: 500,
    maxHeight: "70vh",
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(30, 30, 30, 0.95)"
        : "rgba(255, 255, 255, 0.95)",
    backdropFilter: "blur(10px)",
    borderRadius: 16,
    boxShadow:
      theme.palette.mode === "dark"
        ? "0 10px 40px rgba(0, 0, 0, 0.6)"
        : "0 10px 40px rgba(0, 0, 0, 0.2)",
    overflow: "visible",
  },
}));

// 默认和限制宽度
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 500;

/**
 * 获取传输类型图标
 */
const getTransferIcon = (type) => {
  switch (type) {
    case "upload":
    case "upload-multifile":
      return <FileUploadIcon sx={{ color: "#2196f3" }} />;
    case "upload-folder":
      return <FolderIcon sx={{ color: "#2196f3" }} />;
    case "download":
      return <FileDownloadIcon sx={{ color: "#4caf50" }} />;
    case "download-folder":
      return <FolderIcon sx={{ color: "#4caf50" }} />;
    default:
      return <FileUploadIcon />;
  }
};

/**
 * 获取状态图标
 */
const getStatusIcon = (transfer) => {
  if (transfer.error) {
    return <ErrorIcon sx={{ fontSize: 16, color: "#f44336" }} />;
  }
  if (transfer.isCancelled) {
    return <CancelIcon sx={{ fontSize: 16, color: "#ff9800" }} />;
  }
  if (transfer.progress >= 100) {
    return <CheckCircleIcon sx={{ fontSize: 16, color: "#4caf50" }} />;
  }
  return null;
};

/**
 * 格式化文件大小
 */
const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

/**
 * 格式化时间
 */
const formatTime = (timestamp) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

/**
 * 单个传输项组件
 */
const TransferItem = memo(({ transfer, isActive, onCancel }) => {
  const theme = useTheme();
  const statusIcon = getStatusIcon(transfer);
  const isCompleted = transfer.progress >= 100;
  const hasError = !!transfer.error;
  const isCancelled = transfer.isCancelled;
  const canCancel = isActive && !isCompleted && !hasError && !isCancelled;

  return (
    <Box
      sx={{
        mx: 1,
        my: 0.5,
        p: 1,
        borderRadius: 1.5,
        backgroundColor: theme.palette.mode === 'dark'
          ? 'rgba(255,255,255,0.05)'
          : 'rgba(0,0,0,0.03)',
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      {/* 头部：图标 + 文件名 + 时间 + 状态 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ flexShrink: 0 }}>
          {getTransferIcon(transfer.type)}
        </Box>
        <Typography
          variant="body2"
          sx={{
            flex: 1,
            minWidth: 0,
            fontWeight: 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {transfer.fileName || "传输中..."}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {formatTime(transfer.startTime || transfer.completedTime)}
        </Typography>
        {statusIcon}
      </Box>

      {/* 进度条 - 仅活跃传输显示 */}
      {canCancel && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
          <LinearProgress
            variant="determinate"
            value={transfer.progress || 0}
            sx={{ flex: 1, height: 4, borderRadius: 2 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ minWidth: 35 }}>
            {Math.round(transfer.progress || 0)}%
          </Typography>
        </Box>
      )}

      {/* 传输详情 + 终止按钮 */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mt: 0.5 }}>
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
          {transfer.totalBytes > 0 && (
            <Chip
              label={formatSize(transfer.totalBytes)}
              size="small"
              variant="outlined"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
          {transfer.transferSpeed > 0 && isActive && (
            <Chip
              label={`${formatSize(transfer.transferSpeed)}/s`}
              size="small"
              variant="outlined"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
          {hasError && (
            <Chip
              label="失败"
              size="small"
              color="error"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
          {isCancelled && (
            <Chip
              label="已取消"
              size="small"
              color="warning"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
        </Box>
        {canCancel && onCancel && (
          <Tooltip title="终止传输">
            <IconButton
              size="small"
              onClick={() => onCancel(transfer)}
              sx={{
                width: 20,
                height: 20,
                color: theme.palette.text.secondary,
                "&:hover": {
                  color: "#f44336",
                  backgroundColor: "rgba(244,67,54,0.1)",
                },
              }}
            >
              <StopIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );
});

TransferItem.displayName = "TransferItem";

/**
 * 传输浮动窗口组件
 */
const TransferSidebar = memo(({ open, onClose, onMinimize, zIndex, onFocus }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { allTransfers, clearCompletedTransfers, updateTransferProgress } = useAllGlobalTransfers();
  const { history, clearHistory } = useTransferHistory();
  const [windowWidth, setWindowWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  // 分离活跃传输和已完成传输
  const { activeTransfers, completedTransfers } = useMemo(() => {
    const active = [];
    const completed = [];

    if (allTransfers) {
      allTransfers.forEach((t) => {
        if (t.progress >= 100 || t.isCancelled || t.error) {
          completed.push(t);
        } else {
          active.push(t);
        }
      });
    }

    return { activeTransfers: active, completedTransfers: completed };
  }, [allTransfers]);

  // 取消传输
  const handleCancelTransfer = useCallback((transfer) => {
    if (transfer.tabId && transfer.transferKey && window.terminalAPI?.cancelTransfer) {
      window.terminalAPI
        .cancelTransfer(transfer.tabId, transfer.transferKey)
        .then((result) => {
          if (result.success) {
            updateTransferProgress(transfer.tabId, transfer.transferId, {
              isCancelled: true,
            });
          }
        })
        .catch(() => {
          updateTransferProgress(transfer.tabId, transfer.transferId, {
            isCancelled: true,
          });
        });
    }
  }, [updateTransferProgress]);

  // 清除所有已完成的传输
  const handleClearCompleted = useCallback(() => {
    const uniqueTabIds = [...new Set(allTransfers?.map((t) => t.tabId) || [])];
    uniqueTabIds.forEach((tabId) => {
      if (tabId) {
        clearCompletedTransfers(tabId);
      }
    });
  }, [allTransfers, clearCompletedTransfers]);

  // 拖拽调整宽度的处理（左侧手柄）
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = windowWidth;

    const handleMouseMove = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + deltaX));
      setWindowWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [windowWidth]);

  return (
    <FloatingDialog
      open={open}
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      customwidth={windowWidth}
      customzindex={zIndex}
      onMouseDown={onFocus}
    >
      {/* 左侧拖动调整宽度手柄 */}
      <Box
        onMouseDown={handleResizeStart}
        sx={{
          position: "absolute",
          left: -4,
          top: 0,
          bottom: 0,
          width: 8,
          cursor: "ew-resize",
          zIndex: 1,
          "&:hover": {
            backgroundColor: "primary.main",
            opacity: 0.3,
          },
          ...(isResizing && {
            backgroundColor: "primary.main",
            opacity: 0.5,
          }),
        }}
      />

      {/* 标题栏 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          p: 1.5,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <SwapVertIcon color="primary" />
          <Typography variant="subtitle1" fontWeight="medium">
            文件传输
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          {onMinimize && (
            <IconButton onClick={onMinimize} size="small">
              <MinimizeIcon fontSize="small" />
            </IconButton>
          )}
          <IconButton onClick={onClose} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* 工具栏 */}
      <Box
        sx={{
          display: "flex",
          gap: 1,
          p: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Button
          size="small"
          variant="outlined"
          startIcon={<DeleteSweepIcon />}
          onClick={handleClearCompleted}
          disabled={completedTransfers.length === 0}
          sx={{ fontSize: "0.75rem" }}
        >
          清除已完成
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={clearHistory}
          disabled={history.length === 0}
          sx={{ fontSize: "0.75rem" }}
        >
          清除历史
        </Button>
      </Box>

      {/* 内容区域 */}
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          "&::-webkit-scrollbar": {
            width: 6,
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: "transparent",
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: theme.palette.divider,
            borderRadius: 3,
          },
          "&::-webkit-scrollbar-thumb:hover": {
            backgroundColor: theme.palette.action.disabled,
          },
        }}
      >
        {/* 活跃传输 */}
        {activeTransfers.length > 0 && (
          <>
            <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
              <Typography variant="caption" color="text.secondary">
                正在传输 ({activeTransfers.length})
              </Typography>
            </Box>
            <Box>
              {activeTransfers.map((transfer) => (
                <TransferItem
                  key={`${transfer.tabId}-${transfer.transferId}`}
                  transfer={transfer}
                  isActive={true}
                  onCancel={handleCancelTransfer}
                />
              ))}
            </Box>
          </>
        )}

        {/* 已完成传输（当前会话） */}
        {completedTransfers.length > 0 && (
          <>
            <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
              <Typography variant="caption" color="text.secondary">
                已完成 ({completedTransfers.length})
              </Typography>
            </Box>
            <Box>
              {completedTransfers.map((transfer) => (
                <TransferItem
                  key={`${transfer.tabId}-${transfer.transferId}`}
                  transfer={transfer}
                  isActive={false}
                />
              ))}
            </Box>
          </>
        )}

        {/* 历史记录 */}
        {history.length > 0 && (
          <>
            <Divider />
            <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
              <Typography variant="caption" color="text.secondary">
                历史记录 ({history.length})
              </Typography>
            </Box>
            <Box>
              {history.map((transfer, index) => (
                <TransferItem
                  key={`history-${transfer.transferId}-${index}`}
                  transfer={transfer}
                  isActive={false}
                />
              ))}
            </Box>
          </>
        )}

        {/* 空状态 */}
        {activeTransfers.length === 0 &&
          completedTransfers.length === 0 &&
          history.length === 0 && (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "text.secondary",
                p: 4,
              }}
            >
              <FileUploadIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
              <Typography variant="body2">暂无传输记录</Typography>
            </Box>
          )}
      </Box>
    </FloatingDialog>
  );
});

TransferSidebar.displayName = "TransferSidebar";

export default TransferSidebar;
