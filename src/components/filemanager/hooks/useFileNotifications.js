import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../../contexts/NotificationContext";

/** Adapts file-manager notifications to the shared notification provider. */
export default function useFileNotifications() {
  const { t } = useTranslation();
  const { showNotification: showGlobalNotification } = useNotification();

  const showNotification = useCallback(
    (
      message,
      severity = "info",
      duration = 3000,
      showAction = false,
      actionCallback = null,
    ) => {
      showGlobalNotification(message, severity, {
        // 错误通知不自动关闭，需手动关闭
        autoHideDuration: severity === "error" ? null : duration || 3000,
        anchorOrigin: { vertical: "bottom", horizontal: "center" },
        variant: "standard",
        action:
          showAction && typeof actionCallback === "function"
            ? {
                label: t("fileManager.openLocation"),
                onClick: actionCallback,
              }
            : null,
      });
    },
    [showGlobalNotification, t],
  );

  const setNotification = useCallback(
    (notification) => {
      if (!notification) {
        return;
      }
      showNotification(
        notification.message,
        notification.severity || "info",
        notification.duration ?? 3000,
        notification.showAction,
        notification.actionCallback,
      );
    },
    [showNotification],
  );
  return { showNotification, setNotification };
}
