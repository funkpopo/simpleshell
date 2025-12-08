import React, { useState, useEffect, memo } from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Fade,
  Slide,
  Tooltip,
  Tabs,
  Tab,
  LinearProgress,
  Chip,
} from "@mui/material";
import {
  Close,
  Minimize,
  ExpandMore,
  FileUpload,
  FileDownload,
  Folder,
  CheckCircle,
  Error as ErrorIcon,
  Cancel,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";
import { useAllGlobalTransfers } from "../store/globalTransferStore.js";

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// 格式化传输速度
const formatSpeed = (bytesPerSecond) => {
  if (!bytesPerSecond || bytesPerSecond === 0) return "";
  return formatFileSize(bytesPerSecond) + "/s";
};

// 格式化剩余时间
const formatTime = (seconds) => {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}分`;
  return `${Math.round(seconds / 3600)}时`;
};

// 获取传输类型图标
const getTransferIcon = (type) => {
  switch (type) {
    case "upload":
    case "upload-multifile":
      return <FileUpload sx={{ fontSize: 18 }} />;
    case "upload-folder":
      return <Folder sx={{ fontSize: 18 }} />;
    case "download":
      return <FileDownload sx={{ fontSize: 18 }} />;
    case "download-folder":
      return <Folder sx={{ fontSize: 18 }} />;
    default:
      return <FileUpload sx={{ fontSize: 18 }} />;
  }
};

// 获取传输类型颜色
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

// 获取状态图标
const getStatusIcon = (transfer) => {
  const { progress, isCancelled, error } = transfer;

  if (error) {
    return <ErrorIcon sx={{ fontSize: 16, color: "#f44336" }} />;
  }
  if (isCancelled) {
    return <Cancel sx={{ fontSize: 16, color: "#ff9800" }} />;
  }
  if (progress >= 100) {
    return <CheckCircle sx={{ fontSize: 16, color: "#4caf50" }} />;
  }
  return null;
};

/**
 * 单个传输项组件
 */
const TransferItem = memo(({ transfer, onCancel }) => {
  const theme = useTheme();
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
    currentFileIndex = 0,
    totalFiles = 0,
    currentFile,
    processedFiles = 0,
  } = transfer;

  const isCompleted = progress >= 100;
  const hasError = !!error;
  const statusIcon = getStatusIcon(transfer);

  return (
    <Box
      sx={{
        p: 1.5, // 减小内边距
        borderBottom: `1px solid ${theme.palette.divider}`,
        backgroundColor: theme.palette.background.paper,
      }}
    >
      {/* 头部信息 */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}> {/* 减小底部间距 */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 28, // 稍微减小图标容器
            height: 28,
            minWidth: 28,
            borderRadius: "50%",
            backgroundColor: `${getTransferColor(type)}15`,
            color: getTransferColor(type),
            mr: 1.5,
            flexShrink: 0,
          }}
        >
          {getTransferIcon(type)}
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
            {fileName || "传输中..."}
          </Typography>

          {/* 当前文件信息 */}
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
                  {type === "upload-multifile"
                    ? `${currentFileIndex}/${totalFiles}`
                    : `${processedFiles}/${totalFiles}`}{" "}
                  文件
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
            }}
          />

          {/* 取消按钮 */}
          {!isCompleted && !isCancelled && !hasError && (
            <Tooltip title="中断传输">
              <IconButton
                size="small"
                onClick={() => onCancel(transferId)}
                sx={{
                  width: 28,
                  height: 28,
                  color: theme.palette.text.secondary,
                  "&:hover": {
                    color: "#f44336",
                    backgroundColor: "#ffebee",
                  },
                }}
              >
                <Close sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {/* 进度条 */}
      <Box sx={{ mb: 1 }}> {/* 减小底部间距 */}
        <LinearProgress
          variant="determinate"
          value={Math.min(progress, 100)}
          sx={{
            height: 6, // 减小进度条高度
            borderRadius: 3,
            backgroundColor: "rgba(0,0,0,0.08)",
            "& .MuiLinearProgress-bar": {
              backgroundColor: hasError
                ? "#f44336"
                : isCancelled
                ? "#ff9800"
                : isCompleted
                ? "#4caf50"
                : getTransferColor(type),
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
            {remainingTime > 0 && ` • 剩余 ${formatTime(remainingTime)}`}
          </Typography>
        )}

        {/* 状态文本 */}
        {(hasError || isCancelled || isCompleted) && (
          <Typography
            variant="caption"
            sx={{
              fontSize: "0.75rem",
              fontWeight: 500,
              color: hasError ? "#f44336" : isCancelled ? "#ff9800" : "#4caf50",
            }}
          >
            {hasError ? "传输失败" : isCancelled ? "已取消" : "传输完成"}
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
  const { allTransfers, updateTransferProgress } = useAllGlobalTransfers();
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
      setSelectedTabId(initialTransfer.tabId);
    } else if (open && transfersByTab.size > 0 && !selectedTabId) {
      // 默认选择第一个tab
      setSelectedTabId([...transfersByTab.keys()][0]);
    }
  }, [open, initialTransfer, transfersByTab, selectedTabId]);

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
    if (selectedTabId && window.terminalAPI?.cancelTransfer) {
      const transfer = allTransfers.find(
        (t) => t.tabId === selectedTabId && t.transferId === transferId
      );
      if (transfer && transfer.transferKey) {
        window.terminalAPI
          .cancelTransfer(selectedTabId, transfer.transferKey)
          .then((result) => {
            if (result.success) {
              updateTransferProgress(selectedTabId, transferId, {
                progress: 0,
                isCancelled: true,
                cancelMessage: "传输已取消",
              });
            }
          })
          .catch(() => {
            updateTransferProgress(selectedTabId, transferId, {
              progress: 0,
              isCancelled: true,
              cancelMessage: "传输已取消",
            });
          });
      }
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
          bottom: isMinimized ? 56 : 80, // 留出底部栏的空间
          right: 24,
          width: isMinimized ? 280 : 360, // 缩小宽度
          maxHeight: isMinimized ? 60 : 500, // 减小最大高度
          zIndex: 1299, // 降低层级，避免遮挡重要元素
          overflow: "hidden",
          borderRadius: 2,
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
            px: 2,
            py: 1,
            backgroundColor: theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
          }}
        >
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 600,
              fontSize: "0.9rem",
            }}
          >
            传输进度详情
          </Typography>

          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {/* 最小化/展开按钮 */}
            <Tooltip title={isMinimized ? "展开" : "最小化"}>
              <IconButton
                size="small"
                onClick={handleMinimizeToggle}
                sx={{
                  color: "inherit",
                  width: 24,
                  height: 24,
                  "&:hover": {
                    backgroundColor: "rgba(255,255,255,0.1)",
                  },
                }}
              >
                {isMinimized ? (
                  <ExpandMore sx={{ fontSize: 18 }} />
                ) : (
                  <Minimize sx={{ fontSize: 14 }} />
                )}
              </IconButton>
            </Tooltip>

            {/* 关闭按钮 */}
            <Tooltip title="关闭">
              <IconButton
                size="small"
                onClick={onClose}
                sx={{
                  color: "inherit",
                  width: 24,
                  height: 24,
                  "&:hover": {
                    backgroundColor: "rgba(255,255,255,0.1)",
                  },
                }}
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
                const activeCount = transfers.filter(
                  (t) => t.progress < 100 && !t.isCancelled && !t.error
                ).length;
                return (
                  <Tab
                    key={tabId}
                    label={`Tab ${tabId} (${activeCount})`}
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
            sx={{
              maxHeight: 400, // 减小内容区域高度
              overflow: "auto",
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
            }}
          >
            {/* 直接渲染传输项列表，不使用TransferProgressFloat的外层容器 */}
            {currentTransfers.length === 0 ? (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  暂无传输任务
                </Typography>
              </Box>
            ) : (
              currentTransfers.map((transfer) => (
                <TransferItem
                  key={transfer.transferId}
                  transfer={transfer}
                  onCancel={handleCancelTransfer}
                />
              ))
            )}
          </Box>
        )}

        {/* 最小化时的简略显示 */}
        {isMinimized && (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {allTransfers.length} 个传输任务
            </Typography>
          </Box>
        )}
      </Paper>
    </Fade>
  );
};

export default memo(GlobalTransferFloat);
