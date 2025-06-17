import React, { useState, useEffect } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  LinearProgress,
  IconButton,
  Collapse,
  List,
  ListItem,
  ListItemText,
  Chip,
  Button,
  Divider,
  Tooltip,
} from "@mui/material";
import {
  ExpandMore,
  ExpandLess,
  Close,
  Cancel,
  CloudUpload,
  CloudDownload,
  FolderOpen,
  Clear,
} from "@mui/icons-material";

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// 格式化传输速度
const formatTransferSpeed = (bytesPerSecond) => {
  if (!bytesPerSecond || bytesPerSecond === 0) return "";
  return formatFileSize(bytesPerSecond) + "/s";
};

// 格式化剩余时间
const formatRemainingTime = (seconds) => {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}分钟`;
  return `${Math.round(seconds / 3600)}小时`;
};

// 获取传输类型图标
const getTransferTypeIcon = (type) => {
  switch (type) {
    case "upload":
    case "upload-multifile":
      return <CloudUpload fontSize="small" />;
    case "upload-folder":
      return <FolderOpen fontSize="small" />;
    case "download":
      return <CloudDownload fontSize="small" />;
    case "download-folder":
      return <FolderOpen fontSize="small" />;
    default:
      return <CloudUpload fontSize="small" />;
  }
};

// 获取传输类型显示名称
const getTransferTypeName = (type) => {
  switch (type) {
    case "upload":
    case "upload-multifile":
      return "上传文件";
    case "upload-folder":
      return "上传文件夹";
    case "download":
      return "下载文件";
    case "download-folder":
      return "下载文件夹";
    default:
      return "传输";
  }
};

// 单个传输进度项组件
const TransferProgressItem = ({ transfer, onCancel }) => {
  const {
    transferId,
    type,
    fileName,
    progress,
    transferredBytes,
    totalBytes,
    transferSpeed,
    remainingTime,
    isCancelled,
    cancelMessage,
    error,
    currentFileIndex,
    totalFiles,
    currentFile,
    processedFiles,
  } = transfer;

  const isCompleted = progress >= 100;
  const hasError = !!error;
  const isCancelledStatus = isCancelled;

  // 进度条颜色
  const getProgressColor = () => {
    if (hasError) return "error";
    if (isCancelledStatus) return "warning";
    if (isCompleted) return "success";
    return "primary";
  };

  // 状态文本
  const getStatusText = () => {
    if (isCancelledStatus) return cancelMessage || "已取消";
    if (hasError) return `错误: ${error}`;
    if (isCompleted) return "已完成";
    return `${progress}%`;
  };

  return (
    <ListItem
      sx={{
        flexDirection: "column",
        alignItems: "stretch",
        py: 0.5, // 减少垂直内边距
        px: 0.75, // 减少水平内边距
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        mb: 0.5, // 减少项目间距
        bgcolor: "background.paper",
      }}
    >
      {/* 头部信息 - 改为更紧凑的单行布局 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "flex-start",
          width: "100%",
          mb: 0.5,
          gap: 0.5,
        }}
      >
        <Box sx={{ flexShrink: 0, mt: 0.2 }}>{getTransferTypeIcon(type)}</Box>

        <Box sx={{ flexGrow: 1, minWidth: 0, overflow: "hidden" }}>
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}
          >
            <Typography
              variant="caption"
              sx={{
                fontWeight: "medium",
                fontSize: "0.75rem",
                flexGrow: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {fileName || "未知文件"}
            </Typography>

            {/* 状态标签 - 移到文件名同一行 */}
            <Chip
              label={getStatusText()}
              size="small"
              color={getProgressColor()}
              variant={isCompleted ? "filled" : "outlined"}
              sx={{
                fontSize: "0.6rem",
                height: "16px",
                minWidth: "40px",
                flexShrink: 0,
                "& .MuiChip-label": {
                  fontSize: "0.6rem",
                  px: 0.25,
                },
              }}
            />

            {/* 取消按钮 - 更小 */}
            {!isCompleted && !isCancelledStatus && !hasError && (
              <IconButton
                size="small"
                onClick={() => onCancel(transferId)}
                color="error"
                sx={{
                  p: 0.25,
                  flexShrink: 0,
                  "& .MuiSvgIcon-root": {
                    fontSize: "14px",
                  },
                }}
              >
                <Cancel />
              </IconButton>
            )}
          </Box>

          {/* 文件数量和当前文件信息 - 更紧凑 */}
          {(totalFiles > 1 ||
            ((type === "upload-folder" || type === "download-folder") &&
              currentFile)) && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                fontSize: "0.65rem",
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                lineHeight: 1.2,
              }}
            >
              {totalFiles > 1 &&
                (type === "upload" || type === "upload-multifile"
                  ? `${currentFileIndex || 0}/${totalFiles} 文件`
                  : `${processedFiles || 0}/${totalFiles} 文件`)}
              {(type === "upload-folder" || type === "download-folder") &&
                currentFile &&
                (totalFiles > 1 ? ` · ${currentFile}` : currentFile)}
            </Typography>
          )}
        </Box>
      </Box>

      {/* 进度条 */}
      <LinearProgress
        variant="determinate"
        value={Math.min(progress, 100)}
        color={getProgressColor()}
        sx={{
          width: "100%",
          mb: 0.5, // 减少间距
          height: 4, // 更细的进度条
          borderRadius: 2,
        }}
      />

      {/* 详细信息 - 更紧凑的布局 */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
        }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            fontSize: "0.65rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 1,
            minWidth: 0,
          }}
        >
          {formatFileSize(transferredBytes)}/{formatFileSize(totalBytes)}
        </Typography>

        {!isCancelledStatus && !hasError && transferSpeed > 0 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              fontSize: "0.65rem",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flexShrink: 0,
              ml: 0.5,
            }}
          >
            {formatTransferSpeed(transferSpeed)}
            {remainingTime > 0 && ` · ${formatRemainingTime(remainingTime)}`}
          </Typography>
        )}
      </Box>
    </ListItem>
  );
};

// 主组件
const TransferProgressManager = ({
  transferList = [],
  onCancelTransfer,
  onClearCompleted,
  onClearAll,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  // 统计信息
  const activeTransfers = transferList.filter(
    (t) => t.progress < 100 && !t.isCancelled && !t.error,
  );
  const completedTransfers = transferList.filter(
    (t) => t.progress >= 100 || t.isCancelled || t.error,
  );

  // 如果没有传输任务，不显示组件
  if (transferList.length === 0) {
    return null;
  }

  // 处理取消传输
  const handleCancelTransfer = (transferId) => {
    if (onCancelTransfer) {
      onCancelTransfer(transferId);
    }
  };

  // 处理清理已完成任务
  const handleClearCompleted = () => {
    if (onClearCompleted) {
      onClearCompleted();
    }
  };

  // 处理清理所有任务
  const handleClearAll = () => {
    if (onClearAll) {
      onClearAll();
    }
  };

  return (
    <Card
      sx={{
        position: "absolute",
        bottom: 5,
        left: 5,
        right: 5,
        maxWidth: "285px", // 确保不超出侧边栏宽度
        maxHeight: "60vh",
        zIndex: 1300,
        boxShadow: 3,
      }}
    >
      {/* 头部 */}
      <CardContent sx={{ pb: 0.5, pt: 1, px: 1 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <Typography
              variant="subtitle2"
              sx={{ fontWeight: "medium", fontSize: "0.9rem" }}
            >
              传输管理器
            </Typography>
            <Chip
              label={`${activeTransfers.length} 活跃`}
              size="small"
              color={activeTransfers.length > 0 ? "primary" : "default"}
              sx={{
                ml: 1,
                fontSize: "0.65rem",
                height: "16px",
                "& .MuiChip-label": {
                  fontSize: "0.65rem",
                  px: 0.5,
                },
              }}
            />
          </Box>

          <Box>
            {completedTransfers.length > 0 && (
              <Tooltip title="清理已完成">
                <IconButton size="small" onClick={handleClearCompleted}>
                  <Clear fontSize="small" />
                </IconButton>
              </Tooltip>
            )}

            <Tooltip title={isExpanded ? "收起" : "展开"}>
              <IconButton
                size="small"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? <ExpandLess /> : <ExpandMore />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* 操作按钮 */}
        {isExpanded && transferList.length > 1 && (
          <Box sx={{ mt: 0.5, display: "flex", gap: 0.5 }}>
            {activeTransfers.length > 0 && (
              <Button
                size="small"
                variant="outlined"
                color="error"
                sx={{
                  fontSize: "0.65rem",
                  py: 0.25,
                  px: 0.75,
                  minWidth: "auto",
                }}
                onClick={() => {
                  activeTransfers.forEach((t) =>
                    handleCancelTransfer(t.transferId),
                  );
                }}
              >
                取消全部
              </Button>
            )}

            {transferList.length > 0 && (
              <Button
                size="small"
                variant="outlined"
                sx={{
                  fontSize: "0.65rem",
                  py: 0.25,
                  px: 0.75,
                  minWidth: "auto",
                }}
                onClick={handleClearAll}
              >
                清空列表
              </Button>
            )}
          </Box>
        )}
      </CardContent>

      {/* 传输列表 */}
      <Collapse in={isExpanded}>
        <CardContent
          sx={{ pt: 0, px: 1, pb: 1, maxHeight: "45vh", overflow: "auto" }}
        >
          <List sx={{ p: 0 }}>
            {transferList.map((transfer) => (
              <TransferProgressItem
                key={transfer.transferId}
                transfer={transfer}
                onCancel={handleCancelTransfer}
              />
            ))}
          </List>
        </CardContent>
      </Collapse>
    </Card>
  );
};

export default TransferProgressManager;
