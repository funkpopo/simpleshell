import { useCallback } from "react";
import { normalizeExistsResponse } from "../lib/transferTaskText.js";

/** Completion notifications that point to (and can reveal) a downloaded item. */
export default function useDownloadLocationNotification({
  showNotification,
  t,
}) {
  const revealDownloadedItem = useCallback(
    async (targetPath) => {
      if (!targetPath) {
        return;
      }
      if (!window.terminalAPI?.showItemInFolder) {
        showNotification(
          t("fileManager.messages.openDownloadedLocationFailed", {
            path: targetPath,
          }),
          "warning",
        );
        return;
      }
      try {
        const response = await window.terminalAPI.showItemInFolder(targetPath);
        if (!response?.success) {
          showNotification(
            t("fileManager.messages.openDownloadedLocationFailed", {
              path: targetPath,
            }),
            "warning",
          );
        }
      } catch {
        showNotification(
          t("fileManager.messages.openDownloadedLocationFailed", {
            path: targetPath,
          }),
          "warning",
        );
      }
    },
    [showNotification, t],
  );
  const showDownloadedLocationNotification = useCallback(
    async ({
      itemName,
      downloadPath,
      successMessage,
      missingPathMessage,
      severity = "success",
      duration = 15000,
    }) => {
      const resolvedItemName = itemName || t("fileManager.fileTypes.file");
      const normalizedPath =
        typeof downloadPath === "string" && downloadPath.trim()
          ? downloadPath.replace(/\//g, "\\")
          : "";
      if (!normalizedPath) {
        showNotification(
          successMessage ||
            t("fileManager.messages.downloadCompleted", {
              name: resolvedItemName,
            }),
          severity,
          duration,
        );
        return;
      }
      let exists = true;
      if (window.terminalAPI?.checkPathExists) {
        try {
          exists = normalizeExistsResponse(
            await window.terminalAPI.checkPathExists(normalizedPath),
          );
        } catch {
          exists = true;
        }
      }
      if (!exists) {
        showNotification(
          missingPathMessage ||
            t("fileManager.messages.downloadMissingPath", {
              name: resolvedItemName,
              path: normalizedPath,
            }),
          "warning",
          10000,
        );
        return;
      }
      showNotification(
        successMessage ||
          t("fileManager.messages.downloadSavedToPath", {
            name: resolvedItemName,
            path: normalizedPath,
          }),
        severity,
        duration,
        true,
        () => {
          void revealDownloadedItem(normalizedPath);
        },
      );
    },
    [revealDownloadedItem, showNotification, t],
  );
  return showDownloadedLocationNotification;
}
