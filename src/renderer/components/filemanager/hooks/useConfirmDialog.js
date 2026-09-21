import { useState, useEffect, useCallback, useRef } from "react";
import { CONFIRM_DIALOG_INITIAL_STATE } from "../fileManagerUtils.js";
/** Owns one confirmation; replacement and unmount cancel pending callers. */
export default function useConfirmDialog() {
  const [confirmDialog, setConfirmDialog] = useState({
    ...CONFIRM_DIALOG_INITIAL_STATE,
  });

  const confirmDialogResolveRef = useRef(null);

  const confirmDialogCancelButtonRef = useRef(null);

  const confirmDialogConfirmButtonRef = useRef(null);

  useEffect(
    () => () => {
      if (confirmDialogResolveRef.current) {
        confirmDialogResolveRef.current(false);
        confirmDialogResolveRef.current = null;
      }
    },
    [],
  );

  const showConfirmDialog = useCallback((options) => {
    if (confirmDialogResolveRef.current) {
      confirmDialogResolveRef.current(false);
    }

    return new Promise((resolve) => {
      confirmDialogResolveRef.current = resolve;
      setConfirmDialog({
        ...CONFIRM_DIALOG_INITIAL_STATE,
        ...options,
        open: true,
        onConfirm: null,
      });
    });
  }, []);

  const closeConfirmDialog = useCallback((confirmed) => {
    const resolver = confirmDialogResolveRef.current;
    confirmDialogResolveRef.current = null;
    setConfirmDialog((prev) => ({
      ...prev,
      open: false,
      onConfirm: null,
    }));

    if (resolver) {
      resolver(confirmed);
    }
  }, []);

  const handleConfirmDialogCancel = useCallback(() => {
    closeConfirmDialog(false);
  }, [closeConfirmDialog]);

  const handleConfirmDialogConfirm = useCallback(() => {
    const onConfirm = confirmDialog.onConfirm;
    closeConfirmDialog(true);

    if (typeof onConfirm === "function") {
      onConfirm();
    }
  }, [closeConfirmDialog, confirmDialog.onConfirm]);
  const confirmAction = useCallback((options) => {
    confirmDialogResolveRef.current?.(false);
    confirmDialogResolveRef.current = null;
    setConfirmDialog({
      ...CONFIRM_DIALOG_INITIAL_STATE,
      ...options,
      open: true,
    });
  }, []);
  return {
    confirmDialog,
    confirmAction,
    confirmDialogCancelButtonRef,
    confirmDialogConfirmButtonRef,
    showConfirmDialog,
    handleConfirmDialogCancel,
    handleConfirmDialogConfirm,
  };
}
