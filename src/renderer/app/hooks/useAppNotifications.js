import * as React from "react";

export default function useAppNotifications({ showSuccess, t }) {
  const [appError, setAppError] = React.useState(null);
  const [errorNotificationOpen, setErrorNotificationOpen] =
    React.useState(false);
  const copySuccessNotificationAtRef = React.useRef(0);
  // 监听主进程的错误事件
  React.useEffect(() => {
    const handleAppError = (event, error) => {
      console.error("Application error:", error);
      setAppError(error);
      setErrorNotificationOpen(true);
    };
    if (window.appErrorAPI) {
      window.appErrorAPI.onError(handleAppError);
    }
    return () => {
      if (window.appErrorAPI) {
        window.appErrorAPI.removeErrorListener();
      }
    };
  }, []);
  React.useEffect(() => {
    const showCopySuccess = () => {
      copySuccessNotificationAtRef.current = Date.now();
      showSuccess(t("common.copiedToClipboard"), {
        autoHideDuration: 1800,
      });
    };
    const handleClipboardWriteSuccess = () => {
      showCopySuccess();
    };
    const handleNativeCopy = () => {
      if (Date.now() - copySuccessNotificationAtRef.current < 500) {
        return;
      }
      showCopySuccess();
    };
    const unsubscribe = window.clipboardAPI?.onWriteSuccess?.(
      handleClipboardWriteSuccess,
    );
    document.addEventListener("copy", handleNativeCopy);
    if (typeof unsubscribe !== "function") {
      window.addEventListener(
        "simpleshell:clipboard-write-success",
        handleClipboardWriteSuccess,
      );
    }
    return () => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      } else {
        window.removeEventListener(
          "simpleshell:clipboard-write-success",
          handleClipboardWriteSuccess,
        );
      }
      document.removeEventListener("copy", handleNativeCopy);
    };
  }, [showSuccess, t]);
  const handleCloseErrorNotification = () => {
    setErrorNotificationOpen(false);
  };

  return { appError, errorNotificationOpen, handleCloseErrorNotification };
}
