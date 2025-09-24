import React, { useState, useEffect } from "react";
import { Alert, Snackbar, Box, Typography, Button } from "@mui/material";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import RefreshIcon from "@mui/icons-material/Refresh";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";

const ReconnectionStatus = ({ tabId, sshConfig, processId }) => {
  const [reconnectStatus, setReconnectStatus] = useState(null);
  const [showStatus, setShowStatus] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const maxAttempts = 5; // 固定最大重试次数为5次

  useEffect(() => {
    if (!window.terminalAPI) return;

    // 监听重连事件
    const handleReconnectStart = (data) => {
      if (data.tabId === tabId || data.processId === processId) {
        setReconnectStatus("reconnecting");
        setShowStatus(true);
        setReconnectAttempts(data.attempts || 0);
      }
    };

    const handleReconnectProgress = (data) => {
      if (data.tabId === tabId || data.processId === processId) {
        setReconnectAttempts(data.attempts);
      }
    };

    const handleReconnectSuccess = (data) => {
      if (data.tabId === tabId || data.processId === processId) {
        setReconnectStatus("success");

        // 3秒后隐藏成功提示
        setTimeout(() => {
          setShowStatus(false);
          setReconnectStatus(null);
        }, 3000);
      }
    };

    const handleReconnectFailed = (data) => {
      if (data.tabId === tabId || data.processId === processId) {
        setReconnectStatus("failed");
      }
    };

    const handleConnectionLost = (data) => {
      if (data.tabId === tabId || data.processId === processId) {
        setReconnectStatus("disconnected");
        setShowStatus(true);
      }
    };

    // 注册事件监听
    window.terminalAPI.onReconnectStart(handleReconnectStart);
    window.terminalAPI.onReconnectProgress(handleReconnectProgress);
    window.terminalAPI.onReconnectSuccess(handleReconnectSuccess);
    window.terminalAPI.onReconnectFailed(handleReconnectFailed);
    window.terminalAPI.onConnectionLost(handleConnectionLost);

    // 清理函数
    return () => {
      if (window.terminalAPI) {
        window.terminalAPI.removeReconnectListeners(tabId);
      }
    };
  }, [tabId, processId]);

  // 手动触发重连
  const handleManualReconnect = async () => {
    if (window.terminalAPI && sshConfig) {
      setReconnectStatus("reconnecting");
      setReconnectAttempts(0);

      try {
        await window.terminalAPI.manualReconnect({
          tabId,
          processId,
          sshConfig,
        });
      } catch (error) {
        console.error("手动重连失败:", error);
        setReconnectStatus("failed");
      }
    }
  };

  if (!showStatus) return null;

  // 根据状态显示不同的UI
  const getStatusContent = () => {
    switch (reconnectStatus) {
      case "disconnected":
        return (
          <Alert
            severity="warning"
            icon={<WifiOffIcon />}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={handleManualReconnect}
                startIcon={<RefreshIcon />}
              >
                重连
              </Button>
            }
          >
            <Typography variant="body2">SSH连接已断开</Typography>
          </Alert>
        );

      case "reconnecting":
        return (
          <Alert
            severity="info"
            icon={<RefreshIcon className="reconnect-spin" />}
          >
            <Typography variant="body2">
              正在重新连接... (尝试 {reconnectAttempts}/5)
            </Typography>
            <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
              每3秒重试一次
            </Typography>
          </Alert>
        );

      case "success":
        return (
          <Alert severity="success" icon={<CheckCircleIcon />}>
            <Typography variant="body2">连接已恢复</Typography>
          </Alert>
        );

      case "failed":
        return (
          <Alert
            severity="error"
            icon={<ErrorOutlineIcon />}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={handleManualReconnect}
                startIcon={<RefreshIcon />}
              >
                重试
              </Button>
            }
          >
            <Typography variant="body2">重连失败，请检查网络连接</Typography>
          </Alert>
        );

      default:
        return null;
    }
  };

  return (
    <Snackbar
      open={showStatus}
      anchorOrigin={{ vertical: "top", horizontal: "center" }}
      onClose={() => {
        if (reconnectStatus === "success") {
          setShowStatus(false);
        }
      }}
      sx={{
        mt: 2,
        "& .MuiAlert-root": {
          minWidth: "350px",
        },
      }}
    >
      <Box>{getStatusContent()}</Box>
    </Snackbar>
  );
};

export default ReconnectionStatus;

// CSS动画样式（添加到WebTerminal.css）
const reconnectStyles = `
@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.reconnect-spin {
  animation: spin 1s linear infinite;
}
`;
