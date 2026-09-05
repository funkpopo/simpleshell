import React, { useEffect, useState } from "react";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Box from "@mui/material/Box";
import { useTranslation } from "react-i18next";
import i18n from "../i18n/i18n";
import errorClassification from "../shared/errorClassification";

const {
  ERROR_NOTIFICATION_LEVELS,
  ERROR_TYPES: ErrorType,
  classifyError,
  detectErrorType: detectSharedErrorType,
} = errorClassification;

// ------------------------------------------------------------------
// 用户友好的错误翻译（原 utils/errorTranslator，唯一消费者为本组件）
// ------------------------------------------------------------------

const getClassificationLabel = (category) => {
  switch (category) {
    case ERROR_NOTIFICATION_LEVELS.RECOVERABLE:
      return i18n.t("errors.classification.recoverable");
    case ERROR_NOTIFICATION_LEVELS.RETRY:
      return i18n.t("errors.classification.retry");
    case ERROR_NOTIFICATION_LEVELS.FATAL:
      return i18n.t("errors.classification.fatal");
    case ERROR_NOTIFICATION_LEVELS.FEEDBACK:
    default:
      return i18n.t("errors.classification.feedback");
  }
};

function detectErrorType(error) {
  return detectSharedErrorType(error);
}

function classifyErrorForNotification(error) {
  const explicit =
    typeof error === "object" && error?.errorClassification
      ? error.errorClassification
      : null;
  const classification = explicit || classifyError(error);
  const category =
    classification.category || ERROR_NOTIFICATION_LEVELS.FEEDBACK;

  return {
    ...classification,
    category,
    label: getClassificationLabel(category),
    severity: classification.severity || "error",
    persistent: classification.persistent === true,
    showFeedback: classification.showFeedback === true,
    showDiagnostics: classification.showDiagnostics === true,
  };
}

const AUTO_HIDE_DURATION_MS = 5000;

function getClassifiedErrorTranslation(error, classification) {
  const category =
    classification.category || ERROR_NOTIFICATION_LEVELS.FEEDBACK;
  const originalMessage =
    typeof error === "string"
      ? error
      : error?.message || error?.error || error?.reason || "Unknown error";

  const base = {
    severity: classification.severity || "error",
    originalError: originalMessage,
    errorType: classification.code || "UNKNOWN",
    classification,
  };

  const messages = {
    [ERROR_NOTIFICATION_LEVELS.RECOVERABLE]: {
      title: i18n.t("errors.classified.recoverable.title"),
      message: i18n.t("errors.classified.recoverable.message", {
        message: originalMessage,
        code: classification.code || "",
      }),
      solutions: i18n.t("errors.classified.recoverable.solutions", {
        returnObjects: true,
      }),
      action: i18n.t("errors.classified.recoverable.action"),
    },
    [ERROR_NOTIFICATION_LEVELS.RETRY]: {
      title: i18n.t("errors.classified.retry.title"),
      message: i18n.t("errors.classified.retry.message", {
        message: originalMessage,
        code: classification.code || "",
      }),
      solutions: i18n.t("errors.classified.retry.solutions", {
        returnObjects: true,
      }),
      action: i18n.t("errors.classified.retry.action"),
    },
    [ERROR_NOTIFICATION_LEVELS.FATAL]: {
      title: i18n.t("errors.classified.fatal.title"),
      message: i18n.t("errors.classified.fatal.message", {
        message: originalMessage,
        code: classification.code || "",
      }),
      solutions: i18n.t("errors.classified.fatal.solutions", {
        returnObjects: true,
      }),
      action: i18n.t("errors.classified.fatal.action"),
    },
    [ERROR_NOTIFICATION_LEVELS.FEEDBACK]: {
      title: i18n.t("errors.classified.feedback.title"),
      message: i18n.t("errors.classified.feedback.message", {
        message: originalMessage,
        code: classification.code || "",
      }),
      solutions: i18n.t("errors.classified.feedback.solutions", {
        returnObjects: true,
      }),
      action: i18n.t("errors.classified.feedback.action"),
    },
  };

  return { ...base, ...messages[category] };
}

// 已知错误码 → 静态 i18n 文案（check-i18n 要求 t() 使用静态字面量 key）
function getKnownErrorTranslation(errorType, originalMessage, classification) {
  let title = null;
  let message = null;
  let solutions = null;
  let action = null;

  switch (errorType) {
    case ErrorType.CONNECTION_REFUSED:
      title = i18n.t("errors.ECONNREFUSED.title");
      message = i18n.t("errors.ECONNREFUSED.message");
      solutions = i18n.t("errors.ECONNREFUSED.solutions", {
        returnObjects: true,
      });
      action = i18n.t("errors.ECONNREFUSED.action");
      break;
    case ErrorType.CONNECTION_TIMEOUT:
      title = i18n.t("errors.ETIMEDOUT.title");
      message = i18n.t("errors.ETIMEDOUT.message");
      solutions = i18n.t("errors.ETIMEDOUT.solutions", {
        returnObjects: true,
      });
      action = i18n.t("errors.ETIMEDOUT.action");
      break;
    case ErrorType.HOST_UNREACHABLE:
      title = i18n.t("errors.EHOSTUNREACH.title");
      message = i18n.t("errors.EHOSTUNREACH.message");
      solutions = i18n.t("errors.EHOSTUNREACH.solutions", {
        returnObjects: true,
      });
      action = i18n.t("errors.EHOSTUNREACH.action");
      break;
    case ErrorType.HOST_NOT_FOUND:
      title = i18n.t("errors.ENOTFOUND.title");
      message = i18n.t("errors.ENOTFOUND.message");
      solutions = i18n.t("errors.ENOTFOUND.solutions", {
        returnObjects: true,
      });
      action = i18n.t("errors.ENOTFOUND.action");
      break;
    case ErrorType.CONNECTION_RESET:
      title = i18n.t("errors.ECONNRESET.title");
      message = i18n.t("errors.ECONNRESET.message");
      solutions = i18n.t("errors.ECONNRESET.solutions", {
        returnObjects: true,
      });
      action = i18n.t("errors.ECONNRESET.action");
      break;
    case ErrorType.NETWORK_UNREACHABLE:
      title = i18n.t("errors.ENETUNREACH.title");
      message = i18n.t("errors.ENETUNREACH.message");
      solutions = i18n.t("errors.ENETUNREACH.solutions", {
        returnObjects: true,
      });
      action = i18n.t("errors.ENETUNREACH.action");
      break;
    case ErrorType.AUTH_FAILED:
      title = i18n.t("errors.AUTH_FAILED.title");
      message = i18n.t("errors.AUTH_FAILED.message");
      solutions = i18n.t("errors.AUTH_FAILED.solutions", {
        returnObjects: true,
      });
      action = i18n.t("errors.AUTH_FAILED.action");
      break;
    case ErrorType.KEY_ERROR:
      title = i18n.t("errors.KEY_ERROR.title");
      message = i18n.t("errors.KEY_ERROR.message");
      solutions = i18n.t("errors.KEY_ERROR.solutions", {
        returnObjects: true,
      });
      action = i18n.t("errors.KEY_ERROR.action");
      break;
    case ErrorType.PERMISSION_DENIED:
      title = i18n.t("errors.EACCES.title");
      message = i18n.t("errors.EACCES.message");
      solutions = i18n.t("errors.EACCES.solutions", { returnObjects: true });
      action = i18n.t("errors.EACCES.action");
      break;
    case ErrorType.FILE_NOT_FOUND:
      title = i18n.t("errors.ENOENT.title");
      message = i18n.t("errors.ENOENT.message");
      solutions = i18n.t("errors.ENOENT.solutions", { returnObjects: true });
      action = i18n.t("errors.ENOENT.action");
      break;
    case ErrorType.OPERATION_TIMEOUT:
      title = i18n.t("errors.OPERATION_TIMEOUT.title");
      message = i18n.t("errors.OPERATION_TIMEOUT.message");
      solutions = i18n.t("errors.OPERATION_TIMEOUT.solutions", {
        returnObjects: true,
      });
      action = i18n.t("errors.OPERATION_TIMEOUT.action");
      break;
    default:
      return null;
  }

  return {
    severity: classification.severity,
    originalError: originalMessage,
    errorType,
    classification,
    title,
    message,
    solutions,
    action,
  };
}

/**
 * 翻译错误信息为用户友好的格式
 * @param {Error|string} error - 错误对象或错误消息
 * @returns {Object} - 翻译后的错误信息对象
 */
function translateError(error) {
  const errorType = detectErrorType(error);
  const classification = classifyErrorForNotification(error);
  const originalMessage =
    typeof error === "string"
      ? error
      : error?.message || error?.error || i18n.t("common.unknownError");

  if (errorType) {
    const knownError = getKnownErrorTranslation(
      errorType,
      originalMessage,
      classification,
    );
    if (knownError) {
      return knownError;
    }
  }

  return getClassifiedErrorTranslation(error, classification);
}

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
