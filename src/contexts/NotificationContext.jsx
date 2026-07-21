import React, { createContext, useContext, useState, useCallback } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

const NotificationContext = createContext(null);
const DEFAULT_AUTO_HIDE_DURATION_MS = 5000;
const DEFAULT_ANCHOR_ORIGIN = { vertical: "bottom", horizontal: "left" };

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error(
      "useNotification must be used within a NotificationProvider",
    );
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [severity, setSeverity] = useState("info"); // 'success' | 'info' | 'warning' | 'error'
  const [duration, setDuration] = useState(DEFAULT_AUTO_HIDE_DURATION_MS);
  const [anchorOrigin, setAnchorOrigin] = useState(DEFAULT_ANCHOR_ORIGIN);
  const [variant, setVariant] = useState("filled");
  const [action, setAction] = useState(null); // { label, onClick }

  /**
   * 显示通知。
   *
   * options:
   * - autoHideDuration: 自动关闭时间（毫秒）；传 null 则不自动关闭（如错误通知需手动关闭）
   * - anchorOrigin: Snackbar 位置，默认左下角
   * - variant: Alert 变体，默认 "filled"（全局样式）；传 "standard" 使用轻量样式
   * - action: { label, onClick } 操作按钮，点击后执行回调并关闭通知
   */
  const showNotification = useCallback((msg, type = "info", options = {}) => {
    const {
      autoHideDuration = DEFAULT_AUTO_HIDE_DURATION_MS,
      anchorOrigin: anchorOption = DEFAULT_ANCHOR_ORIGIN,
      variant: variantOption = "filled",
      action: actionOption = null,
    } = options;

    setMessage(msg);
    setSeverity(type);
    setDuration(autoHideDuration);
    setAnchorOrigin(anchorOption);
    setVariant(variantOption);
    setAction(actionOption);
    setOpen(true);
  }, []);

  const showError = useCallback(
    (msg, options) => {
      showNotification(msg, "error", {
        autoHideDuration: DEFAULT_AUTO_HIDE_DURATION_MS,
        ...options,
      });
    },
    [showNotification],
  );

  const showSuccess = useCallback(
    (msg, options) => {
      showNotification(msg, "success", {
        autoHideDuration: DEFAULT_AUTO_HIDE_DURATION_MS,
        ...options,
      });
    },
    [showNotification],
  );

  const showInfo = useCallback(
    (msg, options) => {
      showNotification(msg, "info", {
        autoHideDuration: DEFAULT_AUTO_HIDE_DURATION_MS,
        ...options,
      });
    },
    [showNotification],
  );

  const showWarning = useCallback(
    (msg, options) => {
      showNotification(msg, "warning", {
        autoHideDuration: DEFAULT_AUTO_HIDE_DURATION_MS,
        ...options,
      });
    },
    [showNotification],
  );

  const closeNotification = useCallback(() => {
    setOpen(false);
  }, []);

  const handleClose = (event, reason) => {
    if (reason === "clickaway") {
      return;
    }
    setOpen(false);
  };

  const isDefaultAnchor =
    anchorOrigin?.vertical === DEFAULT_ANCHOR_ORIGIN.vertical &&
    anchorOrigin?.horizontal === DEFAULT_ANCHOR_ORIGIN.horizontal;

  return (
    <NotificationContext.Provider
      value={{
        showNotification,
        showError,
        showSuccess,
        showInfo,
        showWarning,
        closeNotification,
      }}
    >
      {children}
      <Snackbar
        open={open}
        autoHideDuration={duration}
        onClose={handleClose}
        anchorOrigin={anchorOrigin}
        sx={{
          ...(isDefaultAnchor && {
            bottom: "24px !important",
            left: "24px !important",
          }),
          zIndex: 9999,
        }}
      >
        <Alert
          severity={severity}
          variant={variant}
          onClose={handleClose}
          action={
            action ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  if (typeof action.onClick === "function") {
                    action.onClick();
                  }
                  setOpen(false);
                }}
              >
                {action.label}
              </Button>
            ) : undefined
          }
          sx={
            variant === "filled"
              ? {
                  minWidth: 300,
                  maxWidth: 450,
                  boxShadow: 3,
                  "& .MuiAlert-message": {
                    width: "100%",
                  },
                }
              : { width: "100%" }
          }
        >
          {variant === "filled" ? (
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {message}
            </Typography>
          ) : (
            message
          )}
        </Alert>
      </Snackbar>
    </NotificationContext.Provider>
  );
};

export default NotificationContext;
