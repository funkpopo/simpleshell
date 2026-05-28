import React, { useState, useCallback, memo, useEffect } from "react";
import {
  Box,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  LinearProgress,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import {
  FileUpload,
  FileDownload,
  Folder,
  CheckCircle,
  WarningAmber,
  Error as ErrorIcon,
  Cancel,
  Close,
  ExpandLess,
  ExpandMore,
} from "@mui/icons-material";
import { useAllGlobalTransfers } from "../store/globalTransferStore.js";
import { useTranslation } from "react-i18next";
import { sumTransferFileCount } from "../utils/transferCounts.js";

/**
 * 获取传输类型图标
 */
const getTransferIcon = (type) => {
  switch (type) {
    case "upload":
    case "upload-multifile":
      return <FileUpload sx={{ fontSize: 16 }} />;
    case "upload-folder":
      return <Folder sx={{ fontSize: 16 }} />;
    case "download":
      return <FileDownload sx={{ fontSize: 16 }} />;
    case "download-folder":
      return <Folder sx={{ fontSize: 16 }} />;
    default:
      return <FileUpload sx={{ fontSize: 16 }} />;
  }
};

/**
 * 获取传输类型颜色
 */
const getTransferColor = (type) => {
  switch (type) {
    case "upload":
    case "upload-multifile":
    case "upload-folder":
      return "#2196f3"; // 蓝色
    case "download":
    case "download-folder":
      return "#4caf50"; // 绿色
    default:
      return "#2196f3";
  }
};

/**
 * 获取状态图标
 */
const getStatusIcon = (transfer) => {
  const { progress, isCancelled, error, warning } = transfer;

  if (error) {
    return <ErrorIcon sx={{ fontSize: 14, color: "#f44336" }} />;
  }
  if (warning) {
    return <WarningAmber sx={{ fontSize: 14, color: "#ff9800" }} />;
  }
  if (isCancelled) {
    return <Cancel sx={{ fontSize: 14, color: "#ff9800" }} />;
  }
  if (progress >= 100) {
    return <CheckCircle sx={{ fontSize: 14, color: "#4caf50" }} />;
  }
  return null;
};

/**
 * 单个传输任务标签
 */
const TransferTag = memo(({ transfer, onClickTag, onDelete, sshHost }) => {
  const { t } = useTranslation();
  const { type, fileName, progress, isCancelled, error, warning, statusText } =
    transfer;

  const isCompleted = progress >= 100;
  const hasError = !!error;
  const hasWarning = !!warning;
  const statusIcon = getStatusIcon(transfer);
  const showDelete = isCompleted || hasError || isCancelled;
  const secondaryText = statusText || sshHost || "";

  return (
    <Chip
      icon={getTransferIcon(type)}
      label={
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            width: "100%",
          }}
        >
          {statusIcon}
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              flex: 1,
              minWidth: 0,
            }}
          >
            <span
              style={{
                maxWidth: "120px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                fontSize: "0.75rem",
                whiteSpace: "nowrap",
              }}
            >
              {fileName || t("fileManager.transfer.fallbackName")}
            </span>
            {secondaryText && (
              <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>
                {secondaryText}
              </span>
            )}
          </Box>
          {!showDelete && (
            <span
              style={{
                fontSize: "0.7rem",
                opacity: 0.8,
                marginLeft: 4,
                flexShrink: 0,
              }}
            >
              {Math.round(progress || 0)}%
            </span>
          )}
          {showDelete && (
            <Tooltip title={t("fileManager.transfer.deleteRecord")}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(transfer);
                }}
                aria-label={t("fileManager.transfer.deleteRecord")}
                sx={{
                  width: 18,
                  height: 18,
                  padding: 0,
                  marginLeft: 0.5,
                  color: "inherit",
                  opacity: 0.7,
                  "&:hover": {
                    opacity: 1,
                    color: "#f44336",
                    backgroundColor: "rgba(244, 67, 54, 0.1)",
                  },
                }}
              >
                <Close sx={{ fontSize: 12 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      }
      onClick={() => onClickTag(transfer)}
      size="small"
      sx={{
        height: isCompleted ? 36 : 28,
        fontSize: "0.75rem",
        paddingRight: showDelete ? 0.5 : undefined,
        backgroundColor: hasError
          ? "#ffebee"
          : hasWarning
            ? "#fff8e1"
            : isCancelled
              ? "#fff3e0"
              : isCompleted
                ? "#e8f5e8"
                : `${getTransferColor(type)}15`,
        color: hasError
          ? "#f44336"
          : hasWarning
            ? "#ff9800"
            : isCancelled
              ? "#ff9800"
              : isCompleted
                ? "#4caf50"
                : getTransferColor(type),
        cursor: "pointer",
        transition: "all 0.2s ease",
        "&:hover": {
          backgroundColor: hasError
            ? "#ffcdd2"
            : hasWarning
              ? "#ffecb3"
              : isCancelled
                ? "#ffe0b2"
                : isCompleted
                  ? "#c8e6c9"
                  : `${getTransferColor(type)}30`,
        },
        "& .MuiChip-label": {
          paddingLeft: 1,
          paddingRight: showDelete ? 0.5 : 1,
        },
      }}
    />
  );
});

TransferTag.displayName = "TransferTag";

/**
 * 全局传输底部栏
 * 显示所有活跃的传输任务，点击可展开查看详情
 */
const GlobalTransferBar = ({ onOpenFloat, isFloatOpen, onToggleFloat }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { allTransfers, clearCompletedTransfers, removeTransferProgress } =
    useAllGlobalTransfers();
  const [sshHostMap, setSshHostMap] = useState({});

  // 获取SSH主机信息
  useEffect(() => {
    const fetchSshHosts = async () => {
      const hostMap = {};
      const uniqueTabIds = [...new Set(allTransfers.map((t) => t.tabId))];

      for (const tabId of uniqueTabIds) {
        if (tabId && window.terminalAPI?.getSSHConfig) {
          try {
            const config = await window.terminalAPI.getSSHConfig(tabId);
            if (config && config.host) {
              hostMap[tabId] = config.host;
            }
          } catch (error) {
            console.warn(`Failed to get SSH config for tab ${tabId}:`, error);
          }
        }
      }

      setSshHostMap(hostMap);
    };

    if (allTransfers.length > 0) {
      fetchSshHosts();
    }
  }, [allTransfers]);

  const handleClickTag = useCallback(
    (transfer) => {
      // 点击标签时打开浮动窗口并定位到对应的传输任务
      // 始终打开浮动窗口（如果已关闭）或更新初始传输任务（如果已打开）
      if (onOpenFloat) {
        onOpenFloat(transfer);
      }
    },
    [onOpenFloat],
  );

  const handleDeleteTransfer = useCallback(
    (transfer) => {
      // 删除单个传输任务
      if (transfer.tabId && transfer.transferId) {
        removeTransferProgress(transfer.tabId, transfer.transferId);
      }
    },
    [removeTransferProgress],
  );

  const handleClearCompleted = useCallback(() => {
    // 清除所有已完成的传输任务
    const uniqueTabIds = [...new Set(allTransfers.map((t) => t.tabId))];
    uniqueTabIds.forEach((tabId) => {
      if (tabId) {
        clearCompletedTransfers(tabId);
      }
    });
  }, [allTransfers, clearCompletedTransfers]);

  // 如果没有传输任务，不显示底部栏
  if (!allTransfers || allTransfers.length === 0) {
    return null;
  }

  // 计算活跃传输任务数
  const activeTransfers = allTransfers.filter(
    (t) => t.progress < 100 && !t.isCancelled && !t.error,
  );

  // 计算完成任务数
  const completedTransfers = allTransfers.filter((t) => t.progress >= 100);
  const completedCount = sumTransferFileCount(completedTransfers);
  const activeFileCount = sumTransferFileCount(activeTransfers);

  // 计算总进度
  const totalProgress =
    allTransfers.length > 0
      ? allTransfers.reduce((sum, t) => sum + (t.progress || 0), 0) /
        allTransfers.length
      : 0;

  return (
    <Paper
      elevation={4}
      sx={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        px: 2,
        py: 1,
        gap: 1.5,
        backgroundColor: theme.palette.background.paper,
        borderTop: `1px solid ${theme.palette.divider}`,
        maxHeight: "56px",
        minHeight: "56px",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* 左侧：传输任务标签列表 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          flex: 1,
          overflow: "auto",
          "&::-webkit-scrollbar": {
            height: 4,
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: "transparent",
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: theme.palette.divider,
            borderRadius: 2,
          },
        }}
      >
        {allTransfers.map((transfer) => (
          <TransferTag
            key={`${transfer.tabId}-${transfer.transferId}`}
            transfer={transfer}
            onClickTag={handleClickTag}
            onDelete={handleDeleteTransfer}
            sshHost={sshHostMap[transfer.tabId]}
          />
        ))}
      </Box>

      {/* 右侧：操作按钮和状态信息 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {/* 总进度指示器 */}
        {activeTransfers.length > 0 && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box sx={{ width: 60 }}>
              <LinearProgress
                variant="determinate"
                value={totalProgress}
                sx={{
                  height: 4,
                  borderRadius: 2,
                }}
              />
            </Box>
            <span
              style={{
                fontSize: "0.75rem",
                color: theme.palette.text.secondary,
              }}
            >
              {Math.round(totalProgress)}%
            </span>
          </Box>
        )}

        {/* 状态文本 */}
        <Box sx={{ fontSize: "0.75rem", color: theme.palette.text.secondary }}>
          {activeTransfers.length > 0
            ? t("fileManager.transfer.activeCount", { count: activeFileCount })
            : completedCount > 0
              ? t("fileManager.transfer.completedCount", {
                  count: completedCount,
                })
              : ""}
        </Box>

        {/* 清除已完成按钮 */}
        {completedCount > 0 && (
          <Tooltip title={t("fileManager.transfer.clearCompleted")}>
            <IconButton size="small" onClick={handleClearCompleted}
              aria-label={t("fileManager.transfer.clearCompleted")}>
              <Close sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}

        {/* 展开/收起详情按钮 */}
        <Tooltip
          title={
            isFloatOpen
              ? t("fileManager.transfer.collapseDetails")
              : t("fileManager.transfer.viewDetails")
          }
        >
          <IconButton
            size="small"
            onClick={() =>
              onToggleFloat
                ? onToggleFloat(null)
                : onOpenFloat && onOpenFloat(null)
            }
          
            aria-label={isFloatOpen ? t("fileManager.transfer.collapseDetails") : t("fileManager.transfer.viewDetails")}>
            {isFloatOpen ? (
              <ExpandMore sx={{ fontSize: 18 }} />
            ) : (
              <ExpandLess sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  );
};

export default memo(GlobalTransferBar);
