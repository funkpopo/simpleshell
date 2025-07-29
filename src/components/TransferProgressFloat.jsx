import React, { useState, useEffect } from "react";
import {
  Box,
  Paper,
  Typography,
  LinearProgress,
  IconButton,
  Fade,
  Slide,
  Tooltip,
  Chip,
} from "@mui/material";
import {
  Close,
  Minimize,
  FileUpload,
  FileDownload,
  Folder,
  CheckCircle,
  Error,
  Cancel,
} from "@mui/icons-material";
import { useTheme } from "@mui/material/styles";

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
    return <Error sx={{ fontSize: 16, color: "#f44336" }} />;
  }
  if (isCancelled) {
    return <Cancel sx={{ fontSize: 16, color: "#ff9800" }} />;
  }
  if (progress >= 100) {
    return <CheckCircle sx={{ fontSize: 16, color: "#4caf50" }} />;
  }
  return null;
};

// 单个传输项组件
const TransferItem = ({ transfer, onCancel, isMinimized }) => {
  const theme = useTheme();
  const {
    transferId,
    type,
    fileName,
    progress = 0,
    transferredBytes = 0,
    totalBytes = 0,
    transferSpeed = 0,
    remainingTime = 0,
    isCancelled,
    error,
    currentFileIndex = 0,
    totalFiles = 0,
    currentFile,
    processedFiles = 0,
  } = transfer;

  const isCompleted = progress >= 100;
  const hasError = !!error;
  const statusIcon = getStatusIcon(transfer);
  
  // 最小化时只显示进度条
  if (isMinimized) {
    return (
      <Box sx={{ width: "100%", px: 1, py: 0.5 }}>
        <LinearProgress
          variant="determinate"
          value={Math.min(progress, 100)}
          sx={{
            height: 6,
            borderRadius: 3,
            backgroundColor: "rgba(0,0,0,0.1)",
            "& .MuiLinearProgress-bar": {
              backgroundColor: hasError 
                ? "#f44336" 
                : isCancelled 
                  ? "#ff9800" 
                  : isCompleted 
                    ? "#4caf50" 
                    : getTransferColor(type),
              borderRadius: 3,
            },
          }}
        />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        p: 2,
        borderBottom: `1px solid ${theme.palette.divider}`,
        backgroundColor: theme.palette.background.paper,
      }}
    >
      {/* 头部信息 */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            backgroundColor: `${getTransferColor(type)}15`,
            color: getTransferColor(type),
            mr: 1.5,
          }}
        >
          {getTransferIcon(type)}
        </Box>
        
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography
            variant="subtitle2"
            sx={{
              fontWeight: 600,
              fontSize: "0.9rem",
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
                  {(() => {
                    // 对于上传类型，使用 currentFileIndex
                    if (type.includes("upload")) {
                      const current = Math.max(0, Math.min(currentFileIndex || 0, totalFiles));
                      const total = Math.max(1, totalFiles);
                      return `${current}/${total}`;
                    } 
                    // 对于下载类型，使用 processedFiles
                    else {
                      const processed = Math.max(0, Math.min(processedFiles || 0, totalFiles));
                      const total = Math.max(1, totalFiles);
                      return `${processed}/${total}`;
                    }
                  })()} 文件
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
                onClick={() => {
                  // 立即停止文件传输
                  onCancel(transferId);
                }}
                disabled={transfer.cancelInProgress}
                sx={{
                  width: 28,
                  height: 28,
                  color: transfer.cancelInProgress 
                    ? theme.palette.text.disabled 
                    : theme.palette.text.secondary,
                  "&:hover": {
                    color: transfer.cancelInProgress 
                      ? theme.palette.text.disabled 
                      : "#f44336",
                    backgroundColor: transfer.cancelInProgress 
                      ? "transparent" 
                      : "#ffebee",
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
      <Box sx={{ mb: 1.5 }}>
        <LinearProgress
          variant="determinate"
          value={Math.min(progress, 100)}
          sx={{
            height: 8,
            borderRadius: 4,
            backgroundColor: "rgba(0,0,0,0.08)",
            "& .MuiLinearProgress-bar": {
              backgroundColor: hasError 
                ? "#f44336" 
                : isCancelled 
                  ? "#ff9800" 
                  : isCompleted 
                    ? "#4caf50" 
                    : getTransferColor(type),
              borderRadius: 4,
              transition: "transform 0.2s ease-in-out",
            },
          }}
        />
      </Box>

      {/* 详细信息 */}
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
              color: hasError 
                ? "#f44336" 
                : isCancelled 
                  ? "#ff9800" 
                  : "#4caf50",
            }}
          >
            {hasError 
              ? "传输失败" 
              : isCancelled 
                ? "已取消" 
                : "传输完成"}
          </Typography>
        )}
      </Box>
    </Box>
  );
};

// 主组件 - 传输进度浮动窗口
const TransferProgressFloat = ({
  transferList = [],
  onCancelTransfer,
  onClose,
}) => {
  const theme = useTheme();
  const [isMinimized, setIsMinimized] = useState(false);
  const [shouldShow, setShouldShow] = useState(false);
  const [wasVisible, setWasVisible] = useState(false);

  // 过滤活跃的传输任务
  const activeTransfers = transferList.filter(
    (t) => t.progress < 100 && !t.isCancelled && !t.error
  );
  
  // 决定是否显示窗口
  useEffect(() => {
    const hasTransfers = transferList.length > 0;
    
    if (hasTransfers) {
      setShouldShow(true);
      setWasVisible(true);
    } else if (wasVisible) {
      // 如果之前有传输任务但现在没有了，立即关闭窗口
      // 这包括用户取消选择文件的情况
      setShouldShow(false);
      setWasVisible(false);
      // 重置最小化状态
      setIsMinimized(false);
    }
  }, [transferList.length, wasVisible]);

  // 检测用户取消操作的额外逻辑
  useEffect(() => {
    const hasActiveTransfers = transferList.some(
      (t) => t.progress < 100 && !t.isCancelled && !t.error
    );
    const allCancelledOrFailed = transferList.length > 0 && transferList.every(
      (t) => t.isCancelled || t.error || t.progress >= 100
    );

    // 如果所有传输都被取消或失败，在短时间后关闭窗口
    if (allCancelledOrFailed && !hasActiveTransfers) {
      const timer = setTimeout(() => {
        setShouldShow(false);
        setWasVisible(false);
        setIsMinimized(false);
      }, 1500); // 1.5秒后自动关闭
      
      return () => clearTimeout(timer);
    }
  }, [transferList]);

  // 如果没有传输任务且不需要显示，不渲染组件
  if (!shouldShow) {
    return null;
  }

  // 处理取消传输
  const handleCancelTransfer = (transferId) => {
    if (onCancelTransfer) {
      onCancelTransfer(transferId);
    }
  };

  // 处理最小化切换
  const handleMinimizeToggle = () => {
    setIsMinimized(!isMinimized);
  };

  return (
    <Slide direction="up" in={shouldShow} mountOnEnter unmountOnExit>
      <Paper
        elevation={8}
        sx={{
          position: "absolute",
          bottom: 8,
          left: 8,
          right: 8,
          maxWidth: 280,
          maxHeight: isMinimized ? 60 : 400,
          zIndex: 1300,
          overflow: "hidden",
          borderRadius: 2,
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          transition: "all 0.3s ease-in-out",
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
              fontSize: "0.85rem",
            }}
          >
            传输进度 ({transferList.length})
          </Typography>
          
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {/* 最小化按钮 */}
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
                <Minimize sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* 传输列表 */}
        <Fade in={!isMinimized}>
          <Box
            sx={{
              maxHeight: 340,
              overflow: "auto",
              "&::-webkit-scrollbar": {
                width: 4,
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
            {transferList.map((transfer) => (
              <TransferItem
                key={transfer.transferId}
                transfer={transfer}
                onCancel={handleCancelTransfer}
                isMinimized={isMinimized}
              />
            ))}
          </Box>
        </Fade>

        {/* 最小化时的简化显示 */}
        {isMinimized && (
          <Box>
            {transferList.slice(0, 2).map((transfer) => (
              <TransferItem
                key={transfer.transferId}
                transfer={transfer}
                onCancel={handleCancelTransfer}
                isMinimized={true}
              />
            ))}
          </Box>
        )}
      </Paper>
    </Slide>
  );
};

export default TransferProgressFloat;