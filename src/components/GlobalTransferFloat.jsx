import React, { useState, useEffect, memo } from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Fade,
  Tooltip,
  Tabs,
  Tab,
  LinearProgress,
  Chip,
} from "@mui/material";
import { Close, Minimize, ExpandMore, SwapVert } from "@mui/icons-material";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  useAllGlobalTransfers,
  cancelTransferWithNotice,
} from "../store/globalTransferStore.js";
import { formatFileSize } from "../core/utils/formatters.js";
import {
  sumTransferFileCount,
  getDisplayCompletedFileCount,
} from "../utils/transferCounts.js";
import { RADIUS } from "../theme";
import {
  getTransferIcon,
  getStatusIcon,
  getTransferColor,
  getTransferStatusColor,
  getTransferStatusChipColors,
  getTransferStatusTextColor,
  getProgressTrackColor,
  getDangerHoverSx,
} from "./transferStatusStyles.jsx";

// 格式化传输速度
const formatSpeed = (bytesPerSecond) => {
  if (!bytesPerSecond || bytesPerSecond === 0) return "";
  return formatFileSize(bytesPerSecond) + "/s";
};

// 格式化剩余时间
const formatTime = (seconds, t) => {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) {
    return t("fileManager.transfer.timeSeconds", {
      count: Math.round(seconds),
    });
  }
  if (seconds < 3600) {
    return t("fileManager.transfer.timeMinutes", {
      count: Math.round(seconds / 60),
    });
  }
  return t("fileManager.transfer.timeHours", {
    count: Math.round(seconds / 3600),
  });
};

/**
 * 单个传输项组件
 */
const TransferItem = memo(({ transfer, onCancel, onDelete }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const {
    transferId,
    type,
    fileName,
    isCancelled,
    error,
    progress = 0,
    transferredBytes = 0,
    totalBytes = 0,
    transferSpeed = 0,
    remainingTime = 0,
    totalFiles = 0,
    currentFile,
    statusText = "",
    warning = "",
  } = transfer;

  const isCompleted = progress >= 100;
  const hasError = !!error;
  const hasWarning = !!warning;
  const statusIcon = getStatusIcon(transfer, 16);
  const chipColors = getTransferStatusChipColors(theme, transfer);
  const statusColor = getTransferStatusColor(theme, transfer);
  const displayFileProgress = getDisplayCompletedFileCount(transfer, {
    multiFileUsesCurrentIndex: true,
  });

  return (
    <Box
      sx={{
        m: 1,
        p: 1.5,
        borderRadius: 2,
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(255,255,255,0.05)"
            : "rgba(0,0,0,0.02)",
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      {/* 头部信息 */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28, // 稍微减小图标容器
            height: 28,
            minWidth: 28,
            borderRadius: "50%",
            backgroundColor: alpha(getTransferColor(theme, type), 0.15),
            mr: 1.5,
            flexShrink: 0,
          }}
        >
          {getTransferIcon(type, { fontSize: 18 })}
        </Box>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 600,
              fontSize: "0.85rem", // 稍微减小字体
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: theme.palette.text.primary,
            }}
          >
            {fileName || t("fileManager.transfer.fallbackName")}
          </Typography>

          {/* 当前文件信息 */}
          {(statusText || totalFiles > 1 || currentFile) && (
            <>
              {statusText && (
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: "0.75rem",
                    color: getTransferStatusTextColor(theme, transfer),
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "block",
                  }}
                >
                  {statusText}
                </Typography>
              )}
              {(totalFiles > 1 || currentFile) && (
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: "0.75rem",
                    color: theme.palette.text.secondary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "block",
                  }}
                >
                  {totalFiles > 1 && (
                    <span>
                      {t("fileManager.transfer.completedFiles", {
                        completed: displayFileProgress,
                        total: totalFiles,
                      })}
                    </span>
                  )}
                  {currentFile && (
                    <span>
                      {totalFiles > 1 ? " • " : ""}
                      {currentFile}
                    </span>
                  )}
                </Typography>
              )}
            </>
          )}
        </Box>

        {/* 状态和操作按钮 */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {statusIcon}

          {/* 进度百分比 */}
          <Chip
            label={`${Math.round(progress)}%`}
            size="small"
            sx={{
              height: 24,
              fontSize: "0.75rem",
              fontWeight: 600,
              backgroundColor: chipColors.bgcolor,
              color: chipColors.color,
            }}
          />

          {/* 删除按钮（失败或取消的任务） */}
          {(hasError || isCancelled) && (
            <Tooltip title={t("fileManager.transfer.delete")}>
              <IconButton
                size="small"
                onClick={() => onDelete(transferId)}
                sx={{
                  width: 28,
                  height: 28,
                  color: theme.palette.text.secondary,
                  ...getDangerHoverSx(theme),
                }}
                aria-label={t("fileManager.transfer.delete")}
              >
                <Close sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}

          {/* 取消按钮（进行中的任务） */}
          {!isCompleted && !isCancelled && !hasError && (
            <Tooltip title={t("fileManager.transfer.stop")}>
              <IconButton
                size="small"
                onClick={() => onCancel(transferId)}
                sx={{
                  width: 28,
                  height: 28,
                  color: theme.palette.text.secondary,
                  ...getDangerHoverSx(theme),
                }}
                aria-label={t("fileManager.transfer.stop")}
              >
                <Close sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* 进度条 */}
      <Box sx={{ mb: 0.5 }}>
        <LinearProgress
          variant="determinate"
          value={Math.min(progress, 100)}
          sx={{
            height: 6, // 减小进度条高度
            borderRadius: 3,
            backgroundColor: getProgressTrackColor(theme),
            "& .MuiLinearProgress-bar": {
              backgroundColor: statusColor,
              borderRadius: 3,
              transition: "transform 0.2s ease-in-out",
            },
          }}
        />
      </Box>

      {/* 详细信息 */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontSize: "0.75rem",
            color: theme.palette.text.secondary,
          }}
        >
          {formatFileSize(transferredBytes)} / {formatFileSize(totalBytes)}
        </Typography>

        {!isCancelled && !hasError && transferSpeed > 0 && (
          <Typography
            variant="caption"
            sx={{
              fontSize: "0.75rem",
              color: theme.palette.text.secondary,
            }}
          >
            {formatSpeed(transferSpeed)}
            {remainingTime > 0 && ` • ${formatTime(remainingTime, t)}`}
          </Typography>
        )}

        {/* 状态文本 */}
        {(hasError || hasWarning || isCancelled || isCompleted) && (
          <Typography
            variant="caption"
            sx={{
              fontSize: "0.75rem",
              fontWeight: 500,
              color: statusColor,
            }}
          >
            {hasError
              ? t("fileManager.transfer.status.failed")
              : hasWarning
                ? t("fileManager.transfer.status.partial")
                : isCancelled
                  ? t("fileManager.transfer.status.cancelled")
                  : t("fileManager.transfer.status.completed")}
          </Typography>
        )}
      </Box>
    </Box>
  );
});

TransferItem.displayName = "TransferItem";

/**
 * 全局传输进度浮动窗口
 * 以全局浮动窗口形式显示所有传输任务的详细进度
 */
const GlobalTransferFloat = ({ open, onClose, initialTransfer }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { allTransfers, removeTransferProgress } = useAllGlobalTransfers();
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedTabId, setSelectedTabId] = useState(null);

  // 按tabId分组传输任务
  const transfersByTab = React.useMemo(() => {
    const grouped = new Map();
    allTransfers.forEach((transfer) => {
      const tabId = transfer.tabId;
      if (!grouped.has(tabId)) {
        grouped.set(tabId, []);
      }
      grouped.get(tabId).push(transfer);
    });
    return grouped;
  }, [allTransfers]);

  // 初始化选中的tabId
  useEffect(() => {
    if (open && initialTransfer && initialTransfer.tabId) {
      // 只在 tabId 不同时才更新，避免不必要的重新渲染
      if (selectedTabId !== initialTransfer.tabId) {
        setSelectedTabId(initialTransfer.tabId);
      }
    } else if (open && transfersByTab.size > 0 && !selectedTabId) {
      // 默认选择第一个tab
      setSelectedTabId([...transfersByTab.keys()][0]);
    }
  }, [open, initialTransfer, transfersByTab.size, selectedTabId]);

  // 如果窗口关闭,重置状态
  useEffect(() => {
    if (!open) {
      setIsMinimized(false);
    }
  }, [open]);

  // 如果没有传输任务,自动关闭窗口
  useEffect(() => {
    if (open && allTransfers.length === 0) {
      onClose();
    }
  }, [open, allTransfers.length, onClose]);

  const handleMinimizeToggle = () => {
    setIsMinimized(!isMinimized);
  };

  const handleTabChange = (event, newValue) => {
    setSelectedTabId(newValue);
  };

  const handleCancelTransfer = (transferId) => {
    if (selectedTabId) {
      const transfer = allTransfers.find(
        (t) => t.tabId === selectedTabId && t.transferId === transferId,
      );
      cancelTransferWithNotice(
        selectedTabId,
        transfer,
        t("fileManager.transfer.status.transferCancelled"),
        { resetProgress: true },
      );
    }
  };

  const handleDeleteTransfer = (transferId) => {
    if (selectedTabId && transferId) {
      removeTransferProgress(selectedTabId, transferId);
    }
  };

  if (!open) {
    return null;
  }

  // 获取当前选中tab的传输列表
  const currentTransfers = selectedTabId
    ? transfersByTab.get(selectedTabId) || []
    : [];

  return (
    <Fade in={open}>
      <Paper
        elevation={16}
        sx={{
          position: "fixed",
          bottom: 64, // 在底部栏上方，留出足够空间
          right: 24,
          width: isMinimized ? 280 : 360,
          maxHeight: isMinimized ? 60 : 500,
          zIndex: 1200, // 高于底部栏，确保可见
          overflow: "hidden",
          borderRadius: `${RADIUS.LG}px`,
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          transition: "all 0.3s ease-in-out",
          boxShadow: theme.shadows[16],
        }}
      >
        {/* 标题栏 */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <SwapVert color="primary" sx={{ fontSize: 20 }} />
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                fontSize: "0.9rem",
              }}
            >
              {t("fileManager.transfer.title")}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {/* 最小化/展开按钮 */}
            <Tooltip
              title={
                isMinimized
                  ? t("fileManager.transfer.expand")
                  : t("fileManager.transfer.minimize")
              }
            >
              <IconButton
                size="small"
                onClick={handleMinimizeToggle}
                sx={{ width: 24, height: 24 }}
                aria-label={
                  isMinimized
                    ? t("fileManager.transfer.expand")
                    : t("fileManager.transfer.minimize")
                }
              >
                {isMinimized ? (
                  <ExpandMore sx={{ fontSize: 18 }} />
                ) : (
                  <Minimize sx={{ fontSize: 14 }} />
                )}
              </IconButton>
            </Tooltip>

            {/* 关闭按钮 */}
            <Tooltip title={t("common.close")}>
              <IconButton
                size="small"
                onClick={onClose}
                sx={{ width: 24, height: 24 }}
                aria-label={t("common.close")}
              >
                <Close sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Tab切换栏（如果有多个tab） */}
        {!isMinimized && transfersByTab.size > 1 && (
          <Box
            sx={{
              borderBottom: `1px solid ${theme.palette.divider}`,
              backgroundColor: theme.palette.background.default,
            }}
          >
            <Tabs
              value={selectedTabId}
              onChange={handleTabChange}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                minHeight: 40,
                "& .MuiTab-root": {
                  minHeight: 40,
                  fontSize: "0.8rem",
                  textTransform: "none",
                },
              }}
            >
              {[...transfersByTab.keys()].map((tabId) => {
                const transfers = transfersByTab.get(tabId) || [];
                const activeTransfers = transfers.filter(
                  (t) => t.progress < 100 && !t.isCancelled && !t.error,
                );
                const activeFileCount = sumTransferFileCount(activeTransfers);
                return (
                  <Tab
                    key={tabId}
                    label={`Tab ${tabId} (${activeFileCount})`}
                    value={tabId}
                  />
                );
              })}
            </Tabs>
          </Box>
        )}

        {/* 传输列表内容 */}
        {!isMinimized && (
          <Box
            className="app-scrollbar app-scrollbar-compact"
            sx={{
              maxHeight: 380,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {/* 直接渲染传输项列表，不使用TransferProgressFloat的外层容器 */}
            {currentTransfers.length === 0 ? (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.transfer.noTransfers")}
                </Typography>
              </Box>
            ) : (
              currentTransfers.map((transfer) => (
                <TransferItem
                  key={transfer.transferId}
                  transfer={transfer}
                  onCancel={handleCancelTransfer}
                  onDelete={handleDeleteTransfer}
                />
              ))
            )}
          </Box>
        )}

        {/* 最小化时的简略显示 */}
        {isMinimized && (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t("fileManager.transfer.taskCount", {
                count: allTransfers.length,
              })}
            </Typography>
          </Box>
        )}
      </Paper>
    </Fade>
  );
};

export default memo(GlobalTransferFloat);
