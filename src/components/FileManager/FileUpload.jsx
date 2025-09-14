import React, { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

const FileUpload = memo(
  ({
    tabId,
    currentPath,
    selectedFile,
    onError,
    onTransferStart,
    onTransferUpdate,
    onTransferComplete,
    onSilentRefresh,
  }) => {
    const { t } = useTranslation();

    // 处理文件上传
    const uploadFiles = useCallback(
      async (files, targetPath = null) => {
        if (!files || files.length === 0) {
          return { success: false, error: t("fileManager.errors.noFilesSelected") };
        }

        const uploadPath = targetPath || currentPath;
        const uploadTasks = [];

        for (const fileItem of files) {
          const file = fileItem.file || fileItem;
          const remotePath = uploadPath === "/" || uploadPath === "~"
            ? `${uploadPath}/${fileItem.relativePath || file.name}`
            : `${uploadPath}/${fileItem.relativePath || file.name}`;

          uploadTasks.push({
            file,
            remotePath,
            relativePath: fileItem.relativePath || file.name,
          });
        }

        if (uploadTasks.length === 0) {
          return { success: false, error: t("fileManager.errors.noValidFiles") };
        }

        // 启动传输
        onTransferStart(uploadTasks.length);

        try {
          let completedCount = 0;
          let failedCount = 0;

          for (const task of uploadTasks) {
            try {
              if (window.terminalAPI && window.terminalAPI.uploadFile) {
                const result = await window.terminalAPI.uploadFile(
                  tabId,
                  task.file,
                  task.remotePath,
                  (progress) => {
                    onTransferUpdate({
                      fileName: task.file.name,
                      progress: progress.percent,
                      speed: progress.speed,
                      eta: progress.eta,
                    });
                  }
                );

                if (result.success) {
                  completedCount++;
                } else {
                  failedCount++;
                  onError(`${t("fileManager.errors.uploadFailed")}: ${task.file.name} - ${result.error}`);
                }
              }
            } catch (error) {
              failedCount++;
              onError(`${t("fileManager.errors.uploadFailed")}: ${task.file.name} - ${error.message}`);
            }

            onTransferUpdate({
              totalProgress: ((completedCount + failedCount) / uploadTasks.length) * 100,
            });
          }

          onTransferComplete({
            completed: completedCount,
            failed: failedCount,
            total: uploadTasks.length,
          });

          // 刷新目录
          if (completedCount > 0) {
            onSilentRefresh();
          }

          return {
            success: failedCount === 0,
            completed: completedCount,
            failed: failedCount,
          };
        } catch (error) {
          onError(t("fileManager.errors.uploadFailed") + ": " + error.message);
          return { success: false, error: error.message };
        }
      },
      [tabId, currentPath, t, onError, onTransferStart, onTransferUpdate, onTransferComplete, onSilentRefresh]
    );

    // 处理文件夹上传
    const uploadFolder = useCallback(
      async (folderEntries) => {
        const allFiles = [];

        // 递归读取文件夹内容
        const readEntry = async (entry, path = "") => {
          if (entry.isFile) {
            return new Promise((resolve) => {
              entry.file(
                (file) => {
                  allFiles.push({
                    file: file,
                    relativePath: path + file.name,
                  });
                  resolve();
                },
                (error) => {
                  console.error("Error reading file:", error);
                  resolve();
                }
              );
            });
          } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const entries = await new Promise((resolve) => {
              const allEntries = [];
              const readEntries = () => {
                reader.readEntries(
                  (entries) => {
                    if (entries.length === 0) {
                      resolve(allEntries);
                    } else {
                      allEntries.push(...entries);
                      readEntries();
                    }
                  },
                  (error) => {
                    console.error("Error reading directory:", error);
                    resolve(allEntries);
                  }
                );
              };
              readEntries();
            });

            for (const childEntry of entries) {
              await readEntry(childEntry, path + entry.name + "/");
            }
          }
        };

        // 读取所有文件
        for (const entry of folderEntries) {
          await readEntry(entry);
        }

        // 上传所有文件
        return uploadFiles(allFiles);
      },
      [uploadFiles]
    );

    // 处理拖放上传
    const handleDrop = useCallback(
      async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const items = e.dataTransfer.items;
        if (!items || items.length === 0) {
          return { success: false, error: t("fileManager.errors.noItemsDropped") };
        }

        const entries = [];
        for (const item of items) {
          if (item.kind === "file") {
            const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : item.getAsEntry();
            if (entry) {
              entries.push(entry);
            }
          }
        }

        if (entries.length === 0) {
          return { success: false, error: t("fileManager.errors.noValidItems") };
        }

        // 确定目标路径
        let targetPath = currentPath;
        if (selectedFile && selectedFile.isDirectory) {
          targetPath = currentPath === "/" || currentPath === "~"
            ? `${currentPath}/${selectedFile.name}`
            : `${currentPath}/${selectedFile.name}`;
        }

        // 分离文件和文件夹
        const fileEntries = entries.filter(entry => entry.isFile);
        const folderEntries = entries.filter(entry => entry.isDirectory);

        const results = [];

        // 处理文件
        if (fileEntries.length > 0) {
          const files = await Promise.all(
            fileEntries.map(entry => new Promise((resolve) => {
              entry.file(
                (file) => resolve({ file, relativePath: file.name }),
                (error) => {
                  console.error("Error reading file:", error);
                  resolve(null);
                }
              );
            }))
          );

          const validFiles = files.filter(f => f !== null);
          if (validFiles.length > 0) {
            const result = await uploadFiles(validFiles, targetPath);
            results.push(result);
          }
        }

        // 处理文件夹
        if (folderEntries.length > 0) {
          const result = await uploadFolder(folderEntries);
          results.push(result);
        }

        // 汇总结果
        const totalCompleted = results.reduce((sum, r) => sum + (r.completed || 0), 0);
        const totalFailed = results.reduce((sum, r) => sum + (r.failed || 0), 0);

        return {
          success: totalFailed === 0,
          completed: totalCompleted,
          failed: totalFailed,
        };
      },
      [currentPath, selectedFile, t, uploadFiles, uploadFolder]
    );

    return {
      uploadFiles,
      uploadFolder,
      handleDrop,
    };
  }
);

FileUpload.displayName = "FileUpload";

export default FileUpload;