import { useCallback } from "react";
import { useNotification } from "../../../shared/notifications/NotificationContext";

export default function usePreviewNotification() {
  const { showNotification: showGlobalNotification } = useNotification();
  const setNotification = useCallback(
    (notification) => {
      if (!notification) {
        return;
      }
      showGlobalNotification(
        notification.message,
        notification.severity || "info",
        {
          autoHideDuration: 3000,
          anchorOrigin: { vertical: "bottom", horizontal: "center" },
          variant: "standard",
        },
      );
    },
    [showGlobalNotification],
  );
  return setNotification;
}
