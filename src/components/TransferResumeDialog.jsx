import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Chip,
  Typography,
  Box,
  LinearProgress,
  IconButton,
  Tooltip,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteIcon from "@mui/icons-material/Delete";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";

/**
 * 传输断点续传对话框
 * 显示可恢复的传输任务，允许用户选择继续或删除
 */
const TransferResumeDialog = ({ open, onClose, tabId }) => {
  const [resumableTransfers, setResumableTransfers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resumingId, setResumingId] = useState(null);

  // 加载可恢复的传输
  useEffect(() => {
    if (open && window.terminalAPI) {
      loadResumableTransfers();
    }
  }, [open, tabId]);

  const loadResumableTransfers = async () => {
    setLoading(true);
    try {
      const transfers = await window.terminalAPI.getResumableTransfers(tabId);
      setResumableTransfers(transfers || []);
    } catch (error) {
      console.error("加载可恢复传输失败:", error);
    } finally {
      setLoading(false);
    }
  };

  // 恢复传输
  const handleResumeTransfer = async (transferId) => {
    setResumingId(transferId);
    try {
      const result = await window.terminalAPI.resumeTransfer(transferId);
      if (result.success) {
        // 从列表中移除
        setResumableTransfers((prev) =>
          prev.filter((t) => t.id !== transferId),
        );
      } else {
        alert(`恢复传输失败: ${result.error}`);
      }
    } catch (error) {
      console.error("恢复传输失败:", error);
      alert(`恢复传输失败: ${error.message}`);
    } finally {
      setResumingId(null);
    }
  };

  // 删除传输记录
  const handleDeleteTransfer = async (transferId) => {
    try {
      await window.terminalAPI.cancelTransfer(transferId);
      setResumableTransfers((prev) => prev.filter((t) => t.id !== transferId));
    } catch (error) {
      console.error("删除传输记录失败:", error);
    }
  };

  // 恢复所有传输
  const handleResumeAll = async () => {
    for (const transfer of resumableTransfers) {
      await handleResumeTransfer(transfer.id);
    }
  };

  // 格式化文件路径
  const formatPath = (path) => {
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || path;
  };

  // 格式化时间
  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return date.toLocaleDateString();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: "background.paper",
          backgroundImage: "none",
        },
      }}
    >
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <RefreshIcon color="primary" />
          <Typography variant="h6">可恢复的传输任务</Typography>
          {resumableTransfers.length > 0 && (
            <Chip
              label={`${resumableTransfers.length} 个任务`}
              size="small"
              color="primary"
            />
          )}
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {loading ? (
          <Box py={3} textAlign="center">
            <LinearProgress />
            <Typography variant="body2" color="text.secondary" mt={2}>
              正在加载...
            </Typography>
          </Box>
        ) : resumableTransfers.length === 0 ? (
          <Box py={4} textAlign="center">
            <Typography variant="body1" color="text.secondary">
              没有可恢复的传输任务
            </Typography>
          </Box>
        ) : (
          <List>
            {resumableTransfers.map((transfer) => (
              <ListItem
                key={transfer.id}
                sx={{
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  mb: 1,
                  bgcolor:
                    transfer.state === "failed"
                      ? "error.light"
                      : "background.paper",
                  opacity: transfer.state === "failed" ? 0.8 : 1,
                }}
                secondaryAction={
                  <Box display="flex" gap={1}>
                    <Tooltip title="继续传输">
                      <IconButton
                        edge="end"
                        color="primary"
                        onClick={() => handleResumeTransfer(transfer.id)}
                        disabled={resumingId === transfer.id}
                      >
                        {resumingId === transfer.id ? (
                          <RefreshIcon className="spin" />
                        ) : (
                          <PlayArrowIcon />
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="删除记录">
                      <IconButton
                        edge="end"
                        color="error"
                        onClick={() => handleDeleteTransfer(transfer.id)}
                      >
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                }
              >
                <ListItemIcon>
                  {transfer.type === "upload" ? (
                    <CloudUploadIcon color="primary" />
                  ) : (
                    <CloudDownloadIcon color="secondary" />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      <Typography variant="body1">
                        {formatPath(transfer.localPath)}
                      </Typography>
                      {transfer.state === "failed" && (
                        <Chip
                          icon={<WarningAmberIcon />}
                          label="失败"
                          size="small"
                          color="error"
                        />
                      )}
                      {transfer.state === "paused" && (
                        <Chip label="已暂停" size="small" color="default" />
                      )}
                    </Box>
                  }
                  secondary={
                    <Box mt={1}>
                      <Typography variant="caption" color="text.secondary">
                        {transfer.type === "upload" ? "上传到" : "下载自"}:{" "}
                        {transfer.remotePath}
                      </Typography>
                      <Box mt={1} display="flex" alignItems="center" gap={1}>
                        <LinearProgress
                          variant="determinate"
                          value={transfer.progress}
                          sx={{ flexGrow: 1, height: 6, borderRadius: 1 }}
                        />
                        <Typography variant="caption" fontWeight="bold">
                          {transfer.progress.toFixed(1)}%
                        </Typography>
                      </Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        mt={0.5}
                      >
                        最后更新: {formatTime(transfer.updatedAt)}
                        {transfer.lastError && (
                          <>
                            {" | "}
                            错误: {transfer.lastError.message}
                          </>
                        )}
                      </Typography>
                    </Box>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        {resumableTransfers.length > 0 && (
          <>
            <Button
              onClick={loadResumableTransfers}
              startIcon={<RefreshIcon />}
            >
              刷新
            </Button>
            <Button
              onClick={handleResumeAll}
              variant="contained"
              startIcon={<PlayArrowIcon />}
              disabled={resumingId !== null}
            >
              恢复全部
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default TransferResumeDialog;
