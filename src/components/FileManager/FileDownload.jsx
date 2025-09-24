import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

const FileDownload = memo(
  ({
    tabId,
    currentPath,
    onError,
    onTransferStart,
    onTransferUpdate,
    onTransferComplete,
  }) => {
    const { t } = useTranslation();

    // 下载单个文件
    const downloadFile = useCallback(
      async (file) => {
        if (!file || file.isDirectory) {
          onError(t("fileManager.errors.cannotDownloadDirectory"));
          return {
            success: false,
            error: t("fileManager.errors.cannotDownloadDirectory"),
          };
        }

        const filePath =
          currentPath === "/" || currentPath === "~"
            ? `${currentPath}/${file.name}`
            : `${currentPath}/${file.name}`;

        onTransferStart(1);

        try {
          if (window.terminalAPI && window.terminalAPI.downloadFile) {
            const result = await window.terminalAPI.downloadFile(
              tabId,
              filePath,
              file.name,
              (progress) => {
                onTransferUpdate({
                  fileName: file.name,
                  progress: progress.percent,
                  speed: progress.speed,
                  eta: progress.eta,
                });
              },
            );

            if (result.success) {
              onTransferComplete({
                completed: 1,
                failed: 0,
                total: 1,
              });
              return { success: true };
            } else {
              onError(
                `${t("fileManager.errors.downloadFailed")}: ${result.error}`,
              );
              onTransferComplete({
                completed: 0,
                failed: 1,
                total: 1,
              });
              return { success: false, error: result.error };
            }
          } else {
            onError(t("fileManager.errors.fileApiNotAvailable"));
            return {
              success: false,
              error: t("fileManager.errors.fileApiNotAvailable"),
            };
          }
        } catch (error) {
          onError(
            `${t("fileManager.errors.downloadFailed")}: ${error.message}`,
          );
          onTransferComplete({
            completed: 0,
            failed: 1,
            total: 1,
          });
          return { success: false, error: error.message };
        }
      },
      [
        tabId,
        currentPath,
        t,
        onError,
        onTransferStart,
        onTransferUpdate,
        onTransferComplete,
      ],
    );

    // 批量下载文件
    const downloadFiles = useCallback(
      async (files) => {
        if (!files || files.length === 0) {
          onError(t("fileManager.errors.noFilesSelected"));
          return {
            success: false,
            error: t("fileManager.errors.noFilesSelected"),
          };
        }

        // 过滤出文件（排除文件夹）
        const filesToDownload = files.filter((f) => !f.isDirectory);

        if (filesToDownload.length === 0) {
          onError(t("fileManager.errors.noValidFilesToDownload"));
          return {
            success: false,
            error: t("fileManager.errors.noValidFilesToDownload"),
          };
        }

        onTransferStart(filesToDownload.length);

        let completedCount = 0;
        let failedCount = 0;

        for (const file of filesToDownload) {
          const filePath =
            currentPath === "/" || currentPath === "~"
              ? `${currentPath}/${file.name}`
              : `${currentPath}/${file.name}`;

          try {
            if (window.terminalAPI && window.terminalAPI.downloadFile) {
              const result = await window.terminalAPI.downloadFile(
                tabId,
                filePath,
                file.name,
                (progress) => {
                  onTransferUpdate({
                    fileName: file.name,
                    progress: progress.percent,
                    speed: progress.speed,
                    eta: progress.eta,
                    totalProgress:
                      ((completedCount + failedCount) /
                        filesToDownload.length) *
                        100 +
                      progress.percent / filesToDownload.length,
                  });
                },
              );

              if (result.success) {
                completedCount++;
              } else {
                failedCount++;
                onError(
                  `${t("fileManager.errors.downloadFailed")}: ${file.name} - ${result.error}`,
                );
              }
            }
          } catch (error) {
            failedCount++;
            onError(
              `${t("fileManager.errors.downloadFailed")}: ${file.name} - ${error.message}`,
            );
          }

          onTransferUpdate({
            totalProgress:
              ((completedCount + failedCount) / filesToDownload.length) * 100,
          });
        }

        onTransferComplete({
          completed: completedCount,
          failed: failedCount,
          total: filesToDownload.length,
        });

        return {
          success: failedCount === 0,
          completed: completedCount,
          failed: failedCount,
        };
      },
      [
        tabId,
        currentPath,
        t,
        onError,
        onTransferStart,
        onTransferUpdate,
        onTransferComplete,
      ],
    );

    // 下载文件夹（打包为zip）
    const downloadFolder = useCallback(
      async (folder) => {
        if (!folder || !folder.isDirectory) {
          onError(t("fileManager.errors.notADirectory"));
          return {
            success: false,
            error: t("fileManager.errors.notADirectory"),
          };
        }

        const folderPath =
          currentPath === "/" || currentPath === "~"
            ? `${currentPath}/${folder.name}`
            : `${currentPath}/${folder.name}`;

        onTransferStart(1);

        try {
          if (window.terminalAPI && window.terminalAPI.downloadFolder) {
            const result = await window.terminalAPI.downloadFolder(
              tabId,
              folderPath,
              folder.name,
              (progress) => {
                onTransferUpdate({
                  fileName: `${folder.name}.zip`,
                  progress: progress.percent,
                  speed: progress.speed,
                  eta: progress.eta,
                });
              },
            );

            if (result.success) {
              onTransferComplete({
                completed: 1,
                failed: 0,
                total: 1,
              });
              return { success: true };
            } else {
              onError(
                `${t("fileManager.errors.downloadFolderFailed")}: ${result.error}`,
              );
              onTransferComplete({
                completed: 0,
                failed: 1,
                total: 1,
              });
              return { success: false, error: result.error };
            }
          } else {
            onError(t("fileManager.errors.fileApiNotAvailable"));
            return {
              success: false,
              error: t("fileManager.errors.fileApiNotAvailable"),
            };
          }
        } catch (error) {
          onError(
            `${t("fileManager.errors.downloadFolderFailed")}: ${error.message}`,
          );
          onTransferComplete({
            completed: 0,
            failed: 1,
            total: 1,
          });
          return { success: false, error: error.message };
        }
      },
      [
        tabId,
        currentPath,
        t,
        onError,
        onTransferStart,
        onTransferUpdate,
        onTransferComplete,
      ],
    );

    return {
      downloadFile,
      downloadFiles,
      downloadFolder,
    };
  },
);

FileDownload.displayName = "FileDownload";

export default FileDownload;
