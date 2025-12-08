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
  Error as ErrorIcon,
  Cancel,
  Close,
  ExpandLess,
  ExpandMore,
  Delete,
} from "@mui/icons-material";
import { useAllGlobalTransfers } from "../store/globalTransferStore.js";

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
  const { progress, isCancelled, error } = transfer;

  if (error) {
    return <ErrorIcon sx={{ fontSize: 14, color: "#f44336" }} />;
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
  const theme = useTheme();
  const { type, fileName, progress, isCancelled, error } = transfer;

  const isCompleted = progress >= 100;
  const hasError = !!error;
  const statusIcon = getStatusIcon(transfer);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <Chip
        icon={getTransferIcon(type)}
        label={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {statusIcon}
            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
              <span style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", fontSize: "0.75rem" }}>
                {fileName || "传输中..."}
              </span>
              {sshHost && (
                <span style={{ fontSize: "0.65rem", opacity: 0.7 }}>
                  {sshHost}
                </span>
              )}
            </Box>
          </Box>
        }
        onClick={() => onClickTag(transfer)}
        size="small"
        sx={{
          height: isCompleted ? 36 : 28,
          fontSize: "0.75rem",
          backgroundColor: hasError
            ? "#ffebee"
            : isCancelled
            ? "#fff3e0"
            : isCompleted
            ? "#e8f5e8"
            : `${getTransferColor(type)}15`,
          color: hasError
            ? "#f44336"
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
              : isCancelled
              ? "#ffe0b2"
              : isCompleted
              ? "#c8e6c9"
              : `${getTransferColor(type)}30`,
          },
        }}
      />
      {isCompleted && (
        <Tooltip title="删除">
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(transfer);
            }}
            sx={{
              width: 20,
              height: 20,
              padding: 0,
              color: theme.palette.text.secondary,
              "&:hover": {
                color: "#f44336",
                backgroundColor: "#ffebee",
              },
            }}
          >
            <Delete sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
});

TransferTag.displayName = "TransferTag";

/**
 * 全局传输底部栏
 * 显示所有活跃的传输任务，点击可展开查看详情
 */
const GlobalTransferBar = ({ onOpenFloat, isFloatOpen, onToggleFloat }) => {
  const theme = useTheme();
  const { allTransfers, clearCompletedTransfers, removeTransferProgress } = useAllGlobalTransfers();
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
    [onOpenFloat]
  );

  const handleDeleteTransfer = useCallback(
    (transfer) => {
      // 删除单个传输任务
      if (transfer.tabId && transfer.transferId) {
        removeTransferProgress(transfer.tabId, transfer.transferId);
      }
    },
    [removeTransferProgress]
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
  const activeCount = allTransfers.filter(
    (t) => t.progress < 100 && !t.isCancelled && !t.error
  ).length;

  // 计算完成任务数
  const completedCount = allTransfers.filter((t) => t.progress >= 100).length;

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
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1100, // 设置合适的层级，低于对话框(1300)但高于内容(1000)
        display: "flex",
        alignItems: "center",
        px: 2,
        py: 1,
        gap: 1.5,
        backgroundColor: theme.palette.background.paper,
        borderTop: `1px solid ${theme.palette.divider}`,
        maxHeight: "56px",
        overflow: "hidden",
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
        {activeCount > 0 && (
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
            <span style={{ fontSize: "0.75rem", color: theme.palette.text.secondary }}>
              {Math.round(totalProgress)}%
            </span>
          </Box>
        )}

        {/* 状态文本 */}
        <Box sx={{ fontSize: "0.75rem", color: theme.palette.text.secondary }}>
          {activeCount > 0
            ? `进行中: ${activeCount}`
            : completedCount > 0
            ? `已完成: ${completedCount}`
            : ""}
        </Box>

        {/* 清除已完成按钮 */}
        {completedCount > 0 && (
          <Tooltip title="清除已完成">
            <IconButton size="small" onClick={handleClearCompleted}>
              <Close sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}

        {/* 展开/收起详情按钮 */}
        <Tooltip title={isFloatOpen ? "收起详情" : "查看详情"}>
          <IconButton
            size="small"
            onClick={() => (onToggleFloat ? onToggleFloat(null) : onOpenFloat && onOpenFloat(null))}
          >
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
