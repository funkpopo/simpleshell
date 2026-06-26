import React, { useEffect, useState } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Box from "@mui/material/Box";
import { useTranslation } from "react-i18next";
import {
  classifyErrorForNotification,
  translateError,
} from "../utils/errorTranslator";

const AUTO_HIDE_DURATION_MS = 5000;

/**
 * 错误通知组件
 * 用于显示应用内的错误提醒，替代系统原生的错误窗口
 * 显示在左下角，提供简洁的用户友好错误信息和解决方案
 */
const ErrorNotification = ({ error, open, onClose }) => {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  // 不对展开/收起状态做“持久化”：
  // - error 变化（例如切换到其他标签页触发了不同错误）时，重置为收起
  // - 重新打开通知时，也重置为收起
  useEffect(() => {
    if (open && error) setShowDetails(false);
  }, [open, error]);

  if (!error) return null;

  // 使用新的错误翻译器
  const translatedError = translateError(error);
  const classification = classifyErrorForNotification(error);

  const autoHideDuration =
    showDetails || actionBusy ? null : AUTO_HIDE_DURATION_MS;

  const handleCopyDiagnosticSummary = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await window.terminalAPI?.copyDiagnosticSummary?.({
        source: "error-notification",
        title: translatedError.title,
        description: translatedError.originalError,
        errorCategory: classification.category,
        errorAction: classification.action,
        errorCode: classification.code || translatedError.errorType || null,
        classificationReason: classification.reason || null,
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleOpenFeedbackIssue = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      const confirmation = await window.dialogAPI?.showMessageBox?.({
        type: "info",
        buttons: [
          t("settings.feedback.cancel"),
          t("settings.feedback.openIssue"),
        ],
        defaultId: 1,
        cancelId: 0,
        title: t("settings.feedback.confirmTitle"),
        message: t("settings.feedback.confirmMessage"),
        detail: t("settings.feedback.confirmDetail"),
        noLink: true,
      });

      if (confirmation?.response !== 1) {
        return;
      }

      await window.terminalAPI?.openFeedbackIssue?.({
        source: "error-notification",
        title: translatedError.title,
        description: translatedError.originalError,
        errorCategory: classification.category,
        errorAction: classification.action,
        errorCode: classification.code || translatedError.errorType || null,
        classificationReason: classification.reason || null,
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleReloadWindow = async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await window.terminalAPI?.reloadWindow?.();
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <Snackbar
      open={open}
      autoHideDuration={autoHideDuration}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      sx={{
        bottom: "8px !important",
        left: "8px !important",
        zIndex: 9999, // 保持高层级确保不被遮挡
      }}
    >
      <Alert
        severity={classification.severity || translatedError.severity}
        variant="filled"
        onClose={onClose}
        sx={{
          minWidth: 320,
          maxWidth: 500,
          boxShadow: 3,
          "& .MuiAlert-message": {
            width: "100%",
          },
        }}
      >
        <Box>
          {/* 错误标题 */}
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {translatedError.title}
          </Typography>

          <Typography
            variant="caption"
            sx={{
              display: "inline-flex",
              mb: 0.75,
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              bgcolor: "rgba(255,255,255,0.16)",
              fontWeight: 600,
            }}
          >
            {classification.label}
          </Typography>

          {/* 错误描述 */}
          <Typography
            variant="body2"
            sx={{ mb: 1, opacity: 0.95, whiteSpace: "pre-line" }}
          >
            {translatedError.message}
          </Typography>

          {/* 解决方案展开/收起 */}
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <Button
              size="small"
              onClick={() => setShowDetails(!showDetails)}
              sx={{
                color: "inherit",
                p: 0,
                minWidth: "auto",
                fontSize: "0.75rem",
                textTransform: "none",
                "&:hover": {
                  backgroundColor: "transparent",
                  textDecoration: "underline",
                },
              }}
            >
              {showDetails
                ? t("errorNotification.hideSolutions")
                : t("errorNotification.showSolutions")}
            </Button>
            {classification.showDiagnostics && (
              <Button
                size="small"
                disabled={actionBusy}
                onClick={handleCopyDiagnosticSummary}
                sx={{
                  color: "inherit",
                  p: 0,
                  minWidth: "auto",
                  fontSize: "0.75rem",
                  textTransform: "none",
                  "&:hover": {
                    backgroundColor: "transparent",
                    textDecoration: "underline",
                  },
                }}
              >
                {t("errorNotification.copyDiagnosticSummary")}
              </Button>
            )}
            {classification.showFeedback && (
              <Button
                size="small"
                disabled={actionBusy}
                onClick={handleOpenFeedbackIssue}
                sx={{
                  color: "inherit",
                  p: 0,
                  minWidth: "auto",
                  fontSize: "0.75rem",
                  textTransform: "none",
                  "&:hover": {
                    backgroundColor: "transparent",
                    textDecoration: "underline",
                  },
                }}
              >
                {t("errorNotification.feedback")}
              </Button>
            )}
            {classification.fatal && (
              <Button
                size="small"
                disabled={actionBusy}
                onClick={handleReloadWindow}
                sx={{
                  color: "inherit",
                  p: 0,
                  minWidth: "auto",
                  fontSize: "0.75rem",
                  textTransform: "none",
                  "&:hover": {
                    backgroundColor: "transparent",
                    textDecoration: "underline",
                  },
                }}
              >
                {t("errorNotification.reloadWindow")}
              </Button>
            )}
          </Box>

          {/* 解决方案详情 */}
          <Collapse in={showDetails}>
            <Box
              sx={{
                mt: 1,
                pt: 1,
                borderTop: "1px solid rgba(255,255,255,0.2)",
              }}
            >
              <Typography
                variant="caption"
                sx={{ fontWeight: 600, display: "block", mb: 0.5 }}
              >
                {t("errorNotification.solutions")}:
              </Typography>
              {translatedError.solutions.map((solution, index) => (
                <Typography
                  key={index}
                  variant="caption"
                  sx={{
                    display: "block",
                    mb: 0.3,
                    ml: 1,
                    "&::before": {
                      content: '"• "',
                      marginLeft: "-0.5rem",
                    },
                  }}
                >
                  {solution}
                </Typography>
              ))}
            </Box>
          </Collapse>
        </Box>
      </Alert>
    </Snackbar>
  );
};

export default ErrorNotification;
