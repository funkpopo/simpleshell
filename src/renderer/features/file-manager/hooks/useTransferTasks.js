import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTransferActions } from "../../transfers/state/globalTransferStore.js";
import { createTransferUiHelpers } from "../../transfers/lib/transferTaskHelpers.js";
import { isTransferCancellationError } from "../lib/transferTaskText.js";
import useDownloadLocationNotification from "./useDownloadLocationNotification.js";
import useUploadTransfers from "./useUploadTransfers.js";
import useDroppedUploads from "./useDroppedUploads.js";
import useDownloadTransfers from "./useDownloadTransfers.js";
import useFolderDownloads from "./useFolderDownloads.js";
/**
 * Starts and tracks transfers without subscribing the container to progress ticks.
 * Composes upload (picker / drop) and download (file / folder) owners that share
 * the per-render transfer store adapters created here.
 */
export default function useTransferTasks({
  tabId,
  showNotification,
  sshConnection,
  currentPath,
  selectedFile,
  refreshDirectory,
  showConfirmDialog,
  setNotification,
  getSelectedFiles,
}) {
  const { t } = useTranslation();
  const {
    getTransferList,
    addTransferProgress: storeAddTransferProgress,
    updateTransferProgress: storeUpdateTransferProgress,
    scheduleTransferCleanup: storeScheduleTransferCleanup,
  } = useTransferActions(tabId);
  const { markTransferCancelled, markTransferFailed, markTransferCompleted } =
    useMemo(
      () =>
        createTransferUiHelpers({
          updateTransferProgress: storeUpdateTransferProgress,
          scheduleTransferCleanup: storeScheduleTransferCleanup,
        }),
      [storeUpdateTransferProgress, storeScheduleTransferCleanup],
    );
  const addTransferProgress = (transferData) => {
    return storeAddTransferProgress(transferData);
  };
  const updateTransferProgress = (transferId, updateData) => {
    storeUpdateTransferProgress(transferId, updateData);
  };
  const showDownloadedLocationNotification = useDownloadLocationNotification({
    showNotification,
    t,
  });
  const isUserCancellationError = (error) =>
    isTransferCancellationError(error, t);
  const transferContext = {
    tabId,
    showNotification,
    sshConnection,
    currentPath,
    t,
    addTransferProgress,
    updateTransferProgress,
    isUserCancellationError,
    markTransferCancelled,
    markTransferFailed,
    markTransferCompleted,
  };
  const { handleUploadFile, handleUploadFolder } = useUploadTransfers({
    ...transferContext,
    selectedFile,
    refreshDirectory,
  });
  const handleDroppedItems = useDroppedUploads({
    ...transferContext,
    selectedFile,
    refreshDirectory,
    showConfirmDialog,
    setNotification,
    storeScheduleTransferCleanup,
  });
  const handleDownload = useDownloadTransfers({
    ...transferContext,
    getSelectedFiles,
    showDownloadedLocationNotification,
  });
  const handleDownloadFolder = useFolderDownloads({
    ...transferContext,
    getSelectedFiles,
    showDownloadedLocationNotification,
  });
  const handleDownloadSelection = useCallback(async () => {
    const selectedItems = getSelectedFiles();
    if (selectedItems.length === 0) {
      showNotification(t("fileManager.messages.selectFileOrFolder"), "warning");
      return;
    }
    if (!sshConnection) {
      showNotification(t("fileManager.errors.noConnection"), "error");
      return;
    }
    const hasFiles = selectedItems.some((file) => !file.isDirectory);
    const hasFolders = selectedItems.some((file) => file.isDirectory);
    if (hasFiles && hasFolders) {
      showNotification(
        t("fileManager.messages.mixedSelectionDownload"),
        "info",
        4000,
      );
      await handleDownload();
      await handleDownloadFolder();
      return;
    }
    if (hasFolders) {
      await handleDownloadFolder();
      return;
    }
    await handleDownload();
  }, [
    getSelectedFiles,
    handleDownload,
    handleDownloadFolder,
    showNotification,
    sshConnection,
    t,
  ]);
  return {
    getTransferList,
    handleUploadFile,
    handleUploadFolder,
    handleDroppedItems,
    handleDownload,
    handleDownloadFolder,
    handleDownloadSelection,
  };
}
