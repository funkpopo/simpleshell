import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";

/** Coordinates sidebar closing using an on-demand transfer snapshot. */
export default function useFileManagerClose({
  open,
  onClose,
  addTimeout,
  getTransferList,
  confirmAction,
}) {
  const { t } = useTranslation();
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const [isClosing, setIsClosing] = useState(false);

  const performClose = useCallback(() => {
    if (isClosing) {
      return;
    }

    setIsClosing(true);

    try {
      Promise.resolve(onClose?.())
        .catch(() => {
          setIsClosing(false);
        })
        .finally(() => {
          addTimeout(() => {
            if (openRef.current) {
              setIsClosing(false);
            }
          }, 300);
        });
    } catch (error) {
      setIsClosing(false);
      throw error;
    }
  }, [addTimeout, isClosing, onClose]);

  const handleClose = () => {
    if (isClosing) {
      return;
    }

    // 检查是否有正在进行的传输
    const activeTransfers = getTransferList().filter(
      (t) => t.progress < 100 && !t.isCancelled && !t.error,
    );

    if (activeTransfers.length > 0) {
      const hasUpload = activeTransfers.some(
        (t) => t.type === "upload" || t.type === "upload-folder",
      );
      const hasDownload = activeTransfers.some(
        (t) => t.type === "download" || t.type === "download-folder",
      );

      let transferType = "";
      if (hasUpload && hasDownload) {
        transferType = t("fileManager.transferType.uploadAndDownload");
      } else if (hasUpload) {
        transferType = t("fileManager.transferType.upload");
      } else {
        transferType = t("fileManager.transferType.download");
      }

      confirmAction({
        open: true,
        title: t("fileManager.closeConfirmTitle"),
        message: t("fileManager.closeConfirmMessage", { transferType }),
        onConfirm: performClose,
        confirmText: t("common.confirm"),
        confirmColor: "primary",
      });
      return;
    }

    performClose();
  };
  useEffect(() => {
    if (!open) setIsClosing(false);
  }, [open]);
  return { isClosing, handleClose };
}
