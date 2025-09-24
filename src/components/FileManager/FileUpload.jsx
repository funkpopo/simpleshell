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
          return {
            success: false,
            error: t("fileManager.errors.noFilesSelected"),
          };
        }

        const uploadPath = targetPath || currentPath;
        const uploadTasks = [];
        const folderPaths = new Set();

        // 收集所有需要创建的文件夹路径
        for (const fileItem of files) {
          const file = fileItem.file || fileItem;
          const relativePath = fileItem.relativePath || file.name;

          // 提取文件夹路径
          if (relativePath.includes("/")) {
            const parts = relativePath.split("/");
            for (let i = 1; i < parts.length; i++) {
              folderPaths.add(parts.slice(0, i).join("/"));
            }
          }

          const remotePath =
            uploadPath === "/" || uploadPath === "~"
              ? `${uploadPath}/${relativePath}`
              : `${uploadPath}/${relativePath}`;

          uploadTasks.push({
            file,
            remotePath,
            relativePath: relativePath,
          });
        }

        if (uploadTasks.length === 0) {
          return {
            success: false,
            error: t("fileManager.errors.noValidFiles"),
          };
        }

        // 启动传输
        onTransferStart(uploadTasks.length);

        try {
          // 如果有文件夹需要创建，先创建文件夹结构
          if (
            folderPaths.size > 0 &&
            window.terminalAPI &&
            window.terminalAPI.createRemoteFolders
          ) {
            onTransferUpdate({
              fileName: t("fileManager.messages.creatingFolders"),
              progress: 0,
            });

            const sortedFolders = Array.from(folderPaths).sort();
            for (const folder of sortedFolders) {
              const folderPath =
                uploadPath === "/" || uploadPath === "~"
                  ? `${uploadPath}/${folder}`
                  : `${uploadPath}/${folder}`;

              try {
                await window.terminalAPI.createRemoteFolders(tabId, folderPath);
              } catch (error) {
                // 继续处理，文件夹可能已经存在
                console.warn(`Failed to create folder ${folderPath}:`, error);
              }
            }
          }

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
                  },
                );

                if (result.success) {
                  completedCount++;
                } else {
                  failedCount++;
                  onError(
                    `${t("fileManager.errors.uploadFailed")}: ${task.file.name} - ${result.error}`,
                  );
                }
              }
            } catch (error) {
              failedCount++;
              onError(
                `${t("fileManager.errors.uploadFailed")}: ${task.file.name} - ${error.message}`,
              );
            }

            onTransferUpdate({
              totalProgress:
                ((completedCount + failedCount) / uploadTasks.length) * 100,
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
      [
        tabId,
        currentPath,
        t,
        onError,
        onTransferStart,
        onTransferUpdate,
        onTransferComplete,
        onSilentRefresh,
      ],
    );

    // 处理文件夹上传
    const uploadFolder = useCallback(
      async (folderEntries, targetPath = null) => {
        const allFiles = [];
        const folderStructure = new Set();

        // 递归读取文件夹内容
        const readEntry = async (entry, path = "") => {
          if (entry.isFile) {
            return new Promise((resolve) => {
              entry.file(
                (file) => {
                  const relativePath = path + file.name;
                  allFiles.push({
                    file: file,
                    relativePath: relativePath,
                  });
                  // 记录文件夹结构
                  const dirPath = path.slice(0, -1); // 移除末尾的斜杠
                  if (dirPath) {
                    // 添加所有父文件夹路径
                    const parts = dirPath.split("/");
                    for (let i = 1; i <= parts.length; i++) {
                      folderStructure.add(parts.slice(0, i).join("/"));
                    }
                  }
                  resolve();
                },
                (error) => {
                  console.error("Error reading file:", error);
                  resolve();
                },
              );
            });
          } else if (entry.isDirectory) {
            const dirPath = path + entry.name;
            folderStructure.add(dirPath);

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
                  },
                );
              };
              readEntries();
            });

            for (const childEntry of entries) {
              await readEntry(childEntry, path + entry.name + "/");
            }
          }
        };

        // 显示准备上传的消息
        onTransferStart(1);
        onTransferUpdate({
          fileName: t("fileManager.messages.preparingFolderUpload"),
          progress: 0,
        });

        // 读取所有文件
        for (const entry of folderEntries) {
          await readEntry(entry);
        }

        // 上传所有文件 - 使用正确的目标路径
        const uploadPath = targetPath || currentPath;
        return uploadFiles(allFiles, uploadPath);
      },
      [uploadFiles, currentPath, t, onTransferStart, onTransferUpdate],
    );

    // 处理拖放上传
    const handleDrop = useCallback(
      async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const items = e.dataTransfer.items;
        if (!items || items.length === 0) {
          return {
            success: false,
            error: t("fileManager.errors.noItemsDropped"),
          };
        }

        const entries = [];
        for (const item of items) {
          if (item.kind === "file") {
            const entry = item.webkitGetAsEntry
              ? item.webkitGetAsEntry()
              : item.getAsEntry();
            if (entry) {
              entries.push(entry);
            }
          }
        }

        if (entries.length === 0) {
          return {
            success: false,
            error: t("fileManager.errors.noValidItems"),
          };
        }

        // 确定目标路径
        let targetPath = currentPath;
        if (selectedFile && selectedFile.isDirectory) {
          targetPath =
            currentPath === "/" || currentPath === "~"
              ? `${currentPath}/${selectedFile.name}`
              : `${currentPath}/${selectedFile.name}`;
        }

        // 分离文件和文件夹
        const fileEntries = entries.filter((entry) => entry.isFile);
        const folderEntries = entries.filter((entry) => entry.isDirectory);

        const results = [];

        // 处理文件
        if (fileEntries.length > 0) {
          const files = await Promise.all(
            fileEntries.map(
              (entry) =>
                new Promise((resolve) => {
                  entry.file(
                    (file) => resolve({ file, relativePath: file.name }),
                    (error) => {
                      console.error("Error reading file:", error);
                      resolve(null);
                    },
                  );
                }),
            ),
          );

          const validFiles = files.filter((f) => f !== null);
          if (validFiles.length > 0) {
            const result = await uploadFiles(validFiles, targetPath);
            results.push(result);
          }
        }

        // 处理文件夹 - 传递正确的目标路径
        if (folderEntries.length > 0) {
          const result = await uploadFolder(folderEntries, targetPath);
          results.push(result);
        }

        // 汇总结果
        const totalCompleted = results.reduce(
          (sum, r) => sum + (r.completed || 0),
          0,
        );
        const totalFailed = results.reduce(
          (sum, r) => sum + (r.failed || 0),
          0,
        );

        return {
          success: totalFailed === 0,
          completed: totalCompleted,
          failed: totalFailed,
        };
      },
      [currentPath, selectedFile, t, uploadFiles, uploadFolder],
    );

    return {
      uploadFiles,
      uploadFolder,
      handleDrop,
    };
  },
);

FileUpload.displayName = "FileUpload";

export default FileUpload;
