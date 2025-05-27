// This module will handle SFTP file transfers (upload, download, folder operations).
// It will depend on sftpCore.js for session management and queueing.

const fs = require("fs");
const path = require("path");
const SftpClient = require("ssh2-sftp-client"); // For direct SFTP operations if not going through sftpCore's queue for all parts.

let logToFile = null;
let sftpCore = null; // To access getSftpSession, enqueueSftpOperation
let dialog = null; // Electron dialog
let shell = null; // Electron shell
let getChildProcessInfo = null; // To get SSH config from childProcesses map in main.js
let sendToRenderer = null; // Function to send progress/status to renderer

const activeTransfers = new Map(); // Manages active transfer operations for cancellation

function init(
  logger,
  core,
  electronDialog,
  electronShell,
  getChildProcessInfoFunc,
  sendToRendererFunc,
) {
  if (!logger || !logger.logToFile) {
    console.error("sftpTransfer: Logger (logToFile) not provided!");
    logToFile = (message, type = "INFO") =>
      console.log(`[sftpTransfer-${type}] ${message}`);
  } else {
    logToFile = logger.logToFile;
  }

  if (!core) {
    console.error("sftpTransfer: sftpCore module not provided!");
    // sftpCore is essential, operations will fail without it.
  }
  sftpCore = core;

  if (!electronDialog)
    console.error("sftpTransfer: Electron dialog not provided!");
  dialog = electronDialog;

  if (!electronShell)
    console.error("sftpTransfer: Electron shell not provided!");
  shell = electronShell;

  if (typeof getChildProcessInfoFunc !== "function") {
    console.error("sftpTransfer: getChildProcessInfo function not provided!");
  }
  getChildProcessInfo = getChildProcessInfoFunc;

  if (typeof sendToRendererFunc !== "function") {
    console.error("sftpTransfer: sendToRenderer function not provided!");
    sendToRenderer = (channel, ...args) =>
      logToFile(
        `sendToRenderer (dummy) called: ${channel}, ${JSON.stringify(args)}`,
        "WARN",
      );
  } else {
    sendToRenderer = sendToRendererFunc;
  }
  logToFile("sftpTransfer initialized.", "INFO");
}

async function handleDownloadFile(event, tabId, remotePath) {
  if (
    !sftpCore ||
    !dialog ||
    !shell ||
    !getChildProcessInfo ||
    !sendToRenderer
  ) {
    logToFile(
      "sftpTransfer not properly initialized for downloadFile.",
      "ERROR",
    );
    return { success: false, error: "SFTP Transfer module not initialized." };
  }

  return sftpCore.enqueueSftpOperation(
    tabId,
    async () => {
      const processInfo = getChildProcessInfo(tabId);
      if (!processInfo || !processInfo.config) {
        return {
          success: false,
          error: "Invalid SSH connection for download.",
        };
      }
      const sshConfig = processInfo.config;
      const fileName = path.basename(remotePath);

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: "保存文件",
        defaultPath: path.join(
          sshConfig.downloadPath || dialog.app.getPath("downloads"),
          fileName,
        ), // Assuming dialog.app for getPath
        buttonLabel: "下载",
      });

      if (canceled || !filePath) {
        return { success: false, cancelled: true, error: "用户取消下载" };
      }

      const sftp = new SftpClient(); // Using a new SftpClient instance for transfer as in main.js
      const transferKey = `${tabId}-download-${Date.now()}`;
      activeTransfers.set(transferKey, { 
        sftp, 
        type: "download",
        path: path.dirname(remotePath)
      });

      try {
        await sftp.connect({
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.username,
          password: sshConfig.password,
          privateKey: sshConfig.privateKeyPath
            ? fs.readFileSync(sshConfig.privateKeyPath, "utf8")
            : undefined,
          passphrase:
            sshConfig.privateKeyPath && sshConfig.password
              ? sshConfig.password
              : undefined,
        });

        const stats = await sftp.stat(remotePath);
        const totalBytes = stats.size;
        let transferredBytes = 0;
        let lastProgressUpdate = 0;
        
        // 添加用于计算传输速度和剩余时间的变量
        const transferStartTime = Date.now();
        let lastBytesTransferred = 0;
        let lastTransferTime = transferStartTime;
        let currentTransferSpeed = 0;
        let currentRemainingTime = 0;
        const speedSmoothingFactor = 0.3; // 速度平滑因子，较低的值使速度变化更平缓
        
        const tempFilePath = filePath + ".part";

        await sftp.fastGet(remotePath, tempFilePath, {
          step: (transferredChunkBytes, chunk, totalTransferred) => {
            transferredBytes = totalTransferred;
            const progress = Math.floor((transferredBytes / totalBytes) * 100);
            const now = Date.now();
            
            if (now - lastProgressUpdate >= 100) { // Report every 100ms
              // 计算传输速度（字节/秒）
              const timeElapsedSinceLastUpdate = (now - lastTransferTime) / 1000; // 转换为秒
              if (timeElapsedSinceLastUpdate > 0) {
                const bytesTransferredSinceLastUpdate = transferredBytes - lastBytesTransferred;
                const instantSpeed = bytesTransferredSinceLastUpdate / timeElapsedSinceLastUpdate;
                
                // 使用平滑因子计算平滑速度，避免数值剧烈波动
                if (currentTransferSpeed === 0) {
                  currentTransferSpeed = instantSpeed; // 初始值
                } else {
                  currentTransferSpeed = (speedSmoothingFactor * instantSpeed) + 
                                        ((1 - speedSmoothingFactor) * currentTransferSpeed);
                }
                
                // 计算剩余时间（秒）
                const remainingBytes = totalBytes - transferredBytes;
                if (currentTransferSpeed > 0) {
                  currentRemainingTime = remainingBytes / currentTransferSpeed;
                }
                
                // 更新追踪变量
                lastBytesTransferred = transferredBytes;
                lastTransferTime = now;
              }
              
              sendToRenderer("download-progress", {
                tabId, // Or a more specific transferId if needed
                transferKey,
                progress,
                fileName,
                transferredBytes,
                totalBytes,
                transferSpeed: currentTransferSpeed,
                remainingTime: currentRemainingTime
              });
              lastProgressUpdate = now;
            }
          },
          concurrency: 16,
          chunkSize: 32768,
        });

        fs.renameSync(tempFilePath, filePath);
        sendToRenderer("download-progress", {
          tabId,
          transferKey,
          progress: 100,
          fileName,
          transferredBytes: totalBytes,
          totalBytes,
          transferSpeed: 0,  // 传输完成，速度为0
          remainingTime: 0   // 传输完成，剩余时间为0
        });
        await sftp.end();
        activeTransfers.delete(transferKey);
        shell.showItemInFolder(filePath);
        return { success: true, filePath };
      } catch (error) {
        logToFile(
          `sftpTransfer: Download file error for ${remotePath} on ${tabId}: ${error.message}`,
          "ERROR",
        );
        await sftp.end().catch(() => {});
        activeTransfers.delete(transferKey);
        if (fs.existsSync(filePath + ".part"))
          fs.unlinkSync(filePath + ".part");
        return {
          success: false,
          error: `下载文件失败: ${error.message}`,
          cancelled:
            error.message.includes("cancel") || error.message.includes("abort"),
        };
      }
    },
    { type: "download", path: remotePath },
  );
}

async function handleUploadFile(
  event,
  tabId,
  targetFolder,
  filePathsFromMain,
  progressChannel,
) {
  if (
    !sftpCore ||
    !dialog ||
    !getChildProcessInfo ||
    !sendToRenderer ||
    !logToFile ||
    !fs ||
    !path ||
    !SftpClient
  ) {
    logToFile("sftpTransfer not properly initialized for uploadFile.", "ERROR");
    return { success: false, error: "SFTP Transfer module not initialized." };
  }

  // File selection is now done in main.js, filePathsFromMain is the result.
  const filePaths = filePathsFromMain;

  if (!filePaths || filePaths.length === 0) {
    // This case should ideally be caught by main.js before calling this
    logToFile(
      "sftpTransfer: No filePaths provided to handleUploadFile.",
      "WARN",
    );
    return { success: false, cancelled: true, error: "没有选择文件" };
  }

  // Normalize target folder path
  let normalizedTargetFolder = targetFolder;
  if (targetFolder === "~" || !targetFolder) normalizedTargetFolder = "."; // SFTP client might handle ~, or use a known home path if available

  const totalFilesToUpload = filePaths.length;
  let overallUploadedBytes = 0;
  let filesUploadedCount = 0;
  let failedUploads = 0;
  let failedFileNames = [];
  let totalBytesToUpload = 0;

  // Calculate total size for all files
  for (const filePath of filePaths) {
    try {
      const stats = fs.statSync(filePath);
      totalBytesToUpload += stats.size;
    } catch (statError) {
      logToFile(`Error stating file ${filePath}: ${statError.message}`, "WARN");
      // Optionally, count this as a failed file upfront or skip
    }
  }

  // 添加速度和时间计算的变量
  const transferStartTime = Date.now();
  let lastProgressUpdateTime = 0;
  let lastOverallBytesTransferred = 0;
  let lastTransferTime = transferStartTime;
  let currentTransferSpeed = 0;
  let currentRemainingTime = 0;
  const speedSmoothingFactor = 0.3; // 速度平滑因子

  if (totalBytesToUpload === 0 && totalFilesToUpload > 0) {
    // This case can happen if all files failed to stat or are empty.
    // Depending on desired behavior, could return an error or specific message.
    logToFile(
      `No bytes to upload, though ${totalFilesToUpload} files were selected (possibly stat errors or all empty).`,
      "WARN",
    );
    // For now, let it proceed, fastPut might handle empty files or error out if path is invalid.
  }

  return sftpCore.enqueueSftpOperation(
    tabId,
    async () => {
      const processInfo = getChildProcessInfo(tabId);
      if (!processInfo || !processInfo.config) {
        return { success: false, error: "Invalid SSH connection for upload." };
      }
      const sshConfig = processInfo.config;

      const sftp = new SftpClient();
      // Create a more unique transferKey if multiple `handleUploadFile` calls can be concurrent for the same tabId
      // For now, assuming one major upload operation per tabId from this handler.
      const transferKey = `${tabId}-upload-multifile-${Date.now()}`;
      activeTransfers.set(transferKey, { 
        sftp, 
        type: "upload-multifile",
        path: normalizedTargetFolder || "."
      });

      try {
        await sftp.connect({
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.username,
          password: sshConfig.password,
          privateKey: sshConfig.privateKeyPath
            ? fs.readFileSync(sshConfig.privateKeyPath, "utf8")
            : undefined,
          passphrase:
            sshConfig.privateKeyPath && sshConfig.password
              ? sshConfig.password
              : undefined,
        });

        // Ensure target directory exists
        try {
          const folderStat = await sftp.stat(normalizedTargetFolder || ".");
          if (!folderStat.isDirectory) {
            await sftp.end().catch(() => {});
            activeTransfers.delete(transferKey);
            return {
              success: false,
              error: `目标 ${normalizedTargetFolder} 不是一个有效的文件夹。`,
            };
          }
        } catch (statErr) {
          logToFile(
            `sftpTransfer: Target folder check/stat failed for "${normalizedTargetFolder}": ${statErr.message}`,
            "WARN",
          );
          await sftp.end().catch(() => {});
          activeTransfers.delete(transferKey);
          return {
            success: false,
            error: `目标文件夹 "${normalizedTargetFolder}" 不可访问: ${statErr.message}`,
          };
        }

        for (let i = 0; i < totalFilesToUpload; i++) {
          const localFilePath = filePaths[i];
          const fileName = path.basename(localFilePath);
          const remoteFilePath = path.posix
            .join(normalizedTargetFolder || ".", fileName)
            .replace(/\\\\/g, "/");

          let currentFileStats;
          try {
            currentFileStats = fs.statSync(localFilePath);
          } catch (statError) {
            logToFile(
              `Skipping file ${localFilePath} due to stat error: ${statError.message}`,
              "ERROR",
            );
            failedUploads++;
            failedFileNames.push(fileName);
            // Send progress update for the skipped file if desired, using the specific progressChannel
            if (progressChannel) {
              // Check if progressChannel is provided
              sendToRenderer(progressChannel, {
                // Use progressChannel
                tabId,
                transferKey,
                progress:
                  totalBytesToUpload > 0
                    ? Math.floor(
                        (overallUploadedBytes / totalBytesToUpload) * 100,
                      )
                    : 0,
                fileName: fileName,
                currentFileIndex: i + 1,
                totalFiles: totalFilesToUpload,
                transferredBytes: overallUploadedBytes,
                totalBytes: totalBytesToUpload,
                transferSpeed: 0,
                remainingTime: 0,
                error: `无法读取文件属性: ${statError.message.substring(0, 50)}...`,
              });
            }
            if (i === totalFilesToUpload - 1 && filesUploadedCount === 0) {
              // Last file and no successes
              // If all files failed and this is the last one, ensure we communicate failure.
            }
            continue; // Skip to the next file
          }

          const currentFileSize = currentFileStats.size;
          let fileTransferredBytes = 0;

          // Check for cancellation before each file
          if (!activeTransfers.has(transferKey)) {
            throw new Error("Upload cancelled by user.");
          }

          try {
            await sftp.fastPut(localFilePath, remoteFilePath, {
              step: (totalTransferredForFile) => {
                fileTransferredBytes = totalTransferredForFile;
                const currentOverallTransferred =
                  overallUploadedBytes + fileTransferredBytes;
                const progress =
                  totalBytesToUpload > 0
                    ? Math.floor(
                        (currentOverallTransferred / totalBytesToUpload) * 100,
                      )
                    : 0;
                const now = Date.now();

                if (now - lastProgressUpdateTime >= 100) {
                  // 计算传输速度和剩余时间
                  const timeElapsedSinceLastUpdate = (now - lastTransferTime) / 1000; // 转换为秒
                  if (timeElapsedSinceLastUpdate > 0) {
                    const bytesTransferredSinceLastUpdate = 
                      currentOverallTransferred - lastOverallBytesTransferred;
                    const instantSpeed = bytesTransferredSinceLastUpdate / timeElapsedSinceLastUpdate;
                    
                    // 使用平滑因子计算平滑速度，避免数值剧烈波动
                    if (currentTransferSpeed === 0) {
                      currentTransferSpeed = instantSpeed; // 初始值
                    } else {
                      currentTransferSpeed = (speedSmoothingFactor * instantSpeed) + 
                                            ((1 - speedSmoothingFactor) * currentTransferSpeed);
                    }
                    
                    // 计算剩余时间（秒）
                    const remainingBytes = totalBytesToUpload - currentOverallTransferred;
                    if (currentTransferSpeed > 0) {
                      currentRemainingTime = remainingBytes / currentTransferSpeed;
                    }
                    
                    // 更新追踪变量
                    lastOverallBytesTransferred = currentOverallTransferred;
                    lastTransferTime = now;
                  }
                  
                  // Report every 100ms
                  if (progressChannel) {
                    // Check if progressChannel is provided
                    sendToRenderer(progressChannel, {
                      // Use progressChannel
                      tabId,
                      transferKey,
                      progress: Math.min(100, progress),
                      fileName: fileName,
                      currentFileIndex: i + 1,
                      totalFiles: totalFilesToUpload,
                      transferredBytes: currentOverallTransferred,
                      totalBytes: totalBytesToUpload,
                      transferSpeed: currentTransferSpeed,
                      remainingTime: currentRemainingTime,
                      fileUploadSuccess: true, // Indicate this specific file was successful
                    });
                  }
                  lastProgressUpdateTime = now;
                }
              },
              concurrency: 16, // As per previous settings
              chunkSize: 32768, // As per previous settings
            });
            overallUploadedBytes += currentFileSize;
            filesUploadedCount++;
            // Send final progress for this file
            if (progressChannel) {
              // Check if progressChannel is provided
              sendToRenderer(progressChannel, {
                // Use progressChannel
                tabId,
                transferKey,
                progress:
                  totalBytesToUpload > 0
                    ? Math.floor(
                        (overallUploadedBytes / totalBytesToUpload) * 100,
                      )
                    : totalFilesToUpload > 0
                      ? 100
                      : 0,
                fileName: fileName,
                currentFileIndex: i + 1,
                totalFiles: totalFilesToUpload,
                transferredBytes: overallUploadedBytes,
                totalBytes: totalBytesToUpload,
                transferSpeed: currentTransferSpeed,
                remainingTime: currentRemainingTime,
                fileUploadSuccess: true, // Indicate this specific file was successful
              });
            }
          } catch (fileError) {
            logToFile(
              `sftpTransfer: Error uploading file "${localFilePath}" to "${remoteFilePath}": ${fileError.message}`,
              "ERROR",
            );
            failedUploads++;
            failedFileNames.push(fileName);
            // Send progress update for the failed file
            if (progressChannel) {
              // Check if progressChannel is provided
              sendToRenderer(progressChannel, {
                // Use progressChannel
                tabId,
                transferKey,
                progress:
                  totalBytesToUpload > 0
                    ? Math.floor(
                        (overallUploadedBytes / totalBytesToUpload) * 100,
                      )
                    : 0,
                fileName: fileName,
                currentFileIndex: i + 1,
                totalFiles: totalFilesToUpload,
                transferredBytes: currentOverallTransferred,
                totalBytes: totalBytesToUpload,
                transferSpeed: 0,
                remainingTime: 0,
                error: fileError.message.substring(0, 100) + "...", // Truncate long errors
                fileUploadSuccess: false, // Indicate this specific file failed
              });
            }
          }
        } // End of for loop

        // Final overall progress update after loop (covers all files)
        if (progressChannel) {
          // Check if progressChannel is provided
          sendToRenderer(progressChannel, {
            // Use progressChannel
            tabId,
            transferKey,
            progress:
              totalBytesToUpload > 0 && filesUploadedCount > 0
                ? 100
                : failedUploads === totalFilesToUpload
                  ? 0
                  : 100, // show 0 if all failed
            fileName:
              failedUploads > 0
                ? `${failedUploads} 个文件上传失败`
                : "所有文件上传完成!",
            currentFileIndex: totalFilesToUpload,
            totalFiles: totalFilesToUpload,
            transferredBytes: overallUploadedBytes,
            totalBytes: totalBytesToUpload,
            transferSpeed: 0,
            remainingTime: 0,
            operationComplete: true,
            successfulFiles: filesUploadedCount,
            failedFiles: failedUploads,
          });
        }

        return {
          success: filesUploadedCount > 0, // Success if at least one file uploaded
          totalFiles: totalFilesToUpload,
          successfulFiles: filesUploadedCount,
          failedFiles: failedUploads,
          failedFileNames,
          remotePath: normalizedTargetFolder, // Target folder
          message:
            filesUploadedCount > 0
              ? `${filesUploadedCount} 个文件上传成功。` +
                (failedUploads > 0 ? ` ${failedUploads} 个文件上传失败。` : "")
              : "没有文件成功上传。",
        };
      } catch (error) {
        logToFile(
          `sftpTransfer: General upload error on tab ${tabId} to ${normalizedTargetFolder}: ${error.message}`,
          "ERROR",
        );
        
        // 检查是否是取消操作
        const isCancelledOperation = error.message.includes("cancel") || 
                                  error.message.includes("abort");
        
        // Send a final error status to renderer for the whole operation
        if (progressChannel) {
          // Check if progressChannel is provided
          sendToRenderer(progressChannel, {
            // Use progressChannel
            tabId,
            transferKey,
            error: isCancelledOperation ? null : error.message, // 如果是取消操作，不发送错误消息
            cancelled: isCancelledOperation,
            progress: isCancelledOperation ? 0 : -1, // 0表示取消，-1表示错误
            operationComplete: true,
            successfulFiles: filesUploadedCount,
            failedFiles: totalFilesToUpload - filesUploadedCount, // All remaining are failed
          });
        }
        
        // 如果是用户取消操作，返回成功状态的对象而不是错误
        if (isCancelledOperation) {
          return {
            success: true, // 标记为成功，这样前端不会显示错误
            cancelled: true, // 标记为已取消
            userCancelled: true, // 标记为用户主动取消
            message: "用户已取消操作", // 提供信息，但不会作为错误显示
            totalFiles: totalFilesToUpload,
            successfulFiles: filesUploadedCount,
            failedFiles: totalFilesToUpload - filesUploadedCount,
            failedFileNames, // May not be fully populated if error is before loop
          };
        }
        
        // 如果是其他错误，保持原有的错误返回逻辑
        return {
          success: false,
          error: `上传操作失败: ${error.message}`,
          cancelled: false,
          totalFiles: totalFilesToUpload,
          successfulFiles: filesUploadedCount,
          failedFiles: totalFilesToUpload - filesUploadedCount,
          failedFileNames, // May not be fully populated if error is before loop
        };
      } finally {
        if (sftp.sftp) {
          // Check if sftp client is connected
          await sftp
            .end()
            .catch((e) =>
              logToFile(
                `Error ending SFTP in multi-upload: ${e.message}`,
                "WARN",
              ),
            );
        }
        activeTransfers.delete(transferKey);
      }
    },
    // Adjust queue operation type if needed, e.g., to reflect multi-file nature or priority
    {
      type: "upload-multifile",
      path: normalizedTargetFolder,
      priority: "normal",
    },
  );
}

// Placeholder for handleUploadFolder - very complex, will simplify for now or defer
async function handleUploadFolder(
  tabId,
  localFolderPath,
  targetFolder,
  progressChannel,
) {
  if (
    !sftpCore ||
    !dialog ||
    !getChildProcessInfo ||
    !sendToRenderer ||
    !logToFile ||
    !fs ||
    !path ||
    !SftpClient
  ) {
    logToFile(
      "sftpTransfer: Not properly initialized for uploadFolder.",
      "ERROR",
    );
    return {
      success: false,
      error: "SFTP Transfer module not properly initialized.",
    };
  }

  if (!localFolderPath) {
    logToFile(
      "sftpTransfer: localFolderPath not provided for uploadFolder.",
      "ERROR",
    );
    return { success: false, error: "本地文件夹路径未提供" };
  }

  const folderName = path.basename(localFolderPath);

  let normalizedTargetFolder = targetFolder;
  if (targetFolder === "~" || !targetFolder) {
    normalizedTargetFolder = ".";
  }
  // remoteBaseUploadPath is where the new folder (folderName) will be created.
  const remoteBaseUploadPath = path.posix.join(
    normalizedTargetFolder,
    folderName,
  );

  logToFile(
    `sftpTransfer: Queuing folder upload: "${localFolderPath}" to "${normalizedTargetFolder}" (as "${folderName}") for tab ${tabId}`,
    "INFO",
  );

  return sftpCore.enqueueSftpOperation(
    tabId,
    async () => {
      const processInfo = getChildProcessInfo(tabId);
      if (!processInfo || !processInfo.config) {
        return {
          success: false,
          error: "sftpTransfer: Invalid SSH connection for uploadFolder.",
        };
      }
      const sshConfig = processInfo.config;

      const sftp = new SftpClient();
      const transferKey = `${tabId}-upload-folder-${Date.now()}`;
      activeTransfers.set(transferKey, {
        sftp,
        type: "upload-folder",
        localFolderPath,
        remoteBaseUploadPath,
        path: normalizedTargetFolder || "."
      });

      let overallUploadedBytes = 0;
      let filesUploadedCount = 0;
      let totalFilesToUpload = 0;
      let totalBytesToUpload = 0;
      const allFiles = []; // Flat list of file objects { localPath, relativePath, name, size }

      // 1. Scan local folder and calculate totals
      function scanLocalAndCalculateTotals(currentLocalPath, relativeBasePath) {
        const entries = fs.readdirSync(currentLocalPath, {
          withFileTypes: true,
        });
        for (const entry of entries) {
          const entryLocalPath = path.join(currentLocalPath, entry.name);
          const entryRelativePath = path
            .join(relativeBasePath, entry.name)
            .replace(/\\/g, "/"); // Ensure POSIX paths for relative
          if (entry.isDirectory()) {
            scanLocalAndCalculateTotals(entryLocalPath, entryRelativePath);
          } else {
            const stats = fs.statSync(entryLocalPath);
            allFiles.push({
              localPath: entryLocalPath,
              relativePath: entryRelativePath,
              name: entry.name,
              size: stats.size,
            });
            totalBytesToUpload += stats.size;
            totalFilesToUpload++;
          }
        }
      }

      try {
        scanLocalAndCalculateTotals(localFolderPath, "");
        logToFile(
          `sftpTransfer: Found ${totalFilesToUpload} files, total size ${totalBytesToUpload} bytes for upload from "${localFolderPath}".`,
          "INFO",
        );

        if (totalFilesToUpload === 0) {
          logToFile(
            `sftpTransfer: No files to upload in "${localFolderPath}".`,
            "INFO",
          );
          return {
            success: true,
            message: "文件夹为空，无需上传。",
            totalFilesUploaded: 0,
          };
        }

        await sftp.connect({
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.username,
          password: sshConfig.password,
          privateKey: sshConfig.privateKeyPath
            ? fs.readFileSync(sshConfig.privateKeyPath, "utf8")
            : undefined,
          passphrase:
            sshConfig.privateKeyPath && sshConfig.password
              ? sshConfig.password
              : undefined,
        });
        logToFile(
          `sftpTransfer: SFTP connected for folder upload to ${sshConfig.host}. TransferKey: ${transferKey}`,
          "INFO",
        );

        // 2. Create remote base directory for the upload
        try {
          await sftp.stat(remoteBaseUploadPath);
        } catch (e) {
          // Does not exist
          await sftp.mkdir(remoteBaseUploadPath, true); // Recursive, just in case parent of remoteBaseUploadPath doesn't exist
          logToFile(
            `sftpTransfer: Created remote base directory "${remoteBaseUploadPath}".`,
            "INFO",
          );
        }

        // 3. Create sub-directory structure
        const createdRemoteDirs = new Set([remoteBaseUploadPath]);
        for (const file of allFiles) {
          if (!activeTransfers.has(transferKey))
            throw new Error(
              "sftpTransfer: Upload cancelled during directory creation.",
            );
          const remoteFileDir = path.posix.dirname(
            path.posix.join(remoteBaseUploadPath, file.relativePath),
          );
          if (!createdRemoteDirs.has(remoteFileDir)) {
            try {
              // Check if it exists before trying to create, mkdir might fail if it exists
              // sftp.mkdir with recursive true should handle this, but let's be safe or explicit.
              // The `main.js` implementation did sftp.stat then sftp.mkdir.
              // ssh2-sftp-client's mkdir(path, recursive) should ideally handle existing paths gracefully.
              // Let's assume `sftp.mkdir(path, true)` is robust enough.
              await sftp.mkdir(remoteFileDir, true);
              logToFile(
                `sftpTransfer: Ensured remote directory "${remoteFileDir}".`,
                "DEBUG",
              );
            } catch (mkdirError) {
              // If error is not 'Failure code is 4' (already exists), then rethrow
              if (
                !mkdirError.message ||
                (!mkdirError.message.includes("Failure code is 4") &&
                  !mkdirError.message.includes("already exists"))
              ) {
                logToFile(
                  `sftpTransfer: Error creating remote directory "${remoteFileDir}": ${mkdirError.message}`,
                  "ERROR",
                );
                throw mkdirError;
              }
              // If it already exists, that's fine.
            }
            // Add all parent directories to the set to avoid redundant checks/creations
            let currentPath = remoteFileDir;
            while (
              currentPath &&
              currentPath !== path.posix.dirname(currentPath) &&
              currentPath !== "."
            ) {
              createdRemoteDirs.add(currentPath);
              currentPath = path.posix.dirname(currentPath);
            }
          }
        }
        logToFile(
          `sftpTransfer: Ensured all remote subdirectories under "${remoteBaseUploadPath}".`,
          "INFO",
        );

        // 添加用于计算传输速度和剩余时间的变量
        const transferStartTime = Date.now();
        let lastProgressUpdateTime = 0;
        let lastOverallBytesTransferred = 0;
        let lastTransferTime = transferStartTime;
        let currentTransferSpeed = 0;
        let currentRemainingTime = 0;
        const speedSmoothingFactor = 0.3; // 速度平滑因子，较低的值使速度变化更平缓
        
        // 4. Upload files
        for (const file of allFiles) {
          if (!activeTransfers.has(transferKey)) {
            throw new Error(
              "sftpTransfer: Upload cancelled during file transfer.",
            );
          }

          const remoteFilePath = path.posix.join(
            remoteBaseUploadPath,
            file.relativePath,
          );
          let fileTransferredBytes = 0;

          const reportProgress = (isFinal = false) => {
            const now = Date.now();
            if (isFinal || now - lastProgressUpdateTime >= 100) {
              const totalTransferred = overallUploadedBytes + fileTransferredBytes;
              const progress =
                totalBytesToUpload > 0
                  ? Math.floor((totalTransferred / totalBytesToUpload) * 100)
                  : 0;
                  
              // 计算传输速度和剩余时间
              const timeElapsedSinceLastUpdate = (now - lastTransferTime) / 1000; // 转换为秒
              if (timeElapsedSinceLastUpdate > 0) {
                const bytesTransferredSinceLastUpdate = 
                  totalTransferred - lastOverallBytesTransferred;
                const instantSpeed = bytesTransferredSinceLastUpdate / timeElapsedSinceLastUpdate;
                
                // 使用平滑因子计算平滑速度，避免数值剧烈波动
                if (currentTransferSpeed === 0) {
                  currentTransferSpeed = instantSpeed; // 初始值
                } else {
                  currentTransferSpeed = (speedSmoothingFactor * instantSpeed) + 
                                        ((1 - speedSmoothingFactor) * currentTransferSpeed);
                }
                
                // 计算剩余时间（秒）
                const remainingBytes = totalBytesToUpload - totalTransferred;
                if (currentTransferSpeed > 0) {
                  currentRemainingTime = remainingBytes / currentTransferSpeed;
                }
                
                // 更新追踪变量
                lastOverallBytesTransferred = totalTransferred;
                lastTransferTime = now;
              }
                
              if (progressChannel) {
                // Check if progressChannel is provided
                sendToRenderer(progressChannel, {
                  // Use progressChannel
                  tabId,
                  transferKey,
                  progress: Math.min(100, progress),
                  fileName: file.name,
                  currentFile: file.name,
                  processedFiles:
                    filesUploadedCount + (isFinal && !file.isDirectory ? 1 : 0),
                  totalFiles: totalFilesToUpload,
                  transferredBytes: totalTransferred,
                  totalBytes: totalBytesToUpload,
                  transferSpeed: currentTransferSpeed,
                  remainingTime: currentRemainingTime
                });
              }
              lastProgressUpdateTime = now;
            }
          };
          reportProgress(); // Initial progress for the file

          await sftp.fastPut(file.localPath, remoteFilePath, {
            concurrency: 16,
            chunkSize: 32768,
            step: (transferredChunkBytes, chunk, totalForFile) => {
              fileTransferredBytes = totalForFile;
              reportProgress();
            },
          });
          overallUploadedBytes += file.size;
          filesUploadedCount++;
          reportProgress(true); // Final progress for this file
          logToFile(
            `sftpTransfer: Uploaded "${file.localPath}" to "${remoteFilePath}". (${filesUploadedCount}/${totalFilesToUpload})`,
            "DEBUG",
          );
        }

        // Send final progress update
        if (progressChannel) {
          // Check if progressChannel is provided
          sendToRenderer(progressChannel, {
            // Use progressChannel
            tabId,
            transferKey,
            progress: 100,
            fileName: "所有文件上传成功!",
            currentFile: "所有文件上传成功!",
            processedFiles: filesUploadedCount,
            totalFiles: totalFilesToUpload,
            transferredBytes: totalBytesToUpload, // Should be totalBytesToUpload
            totalBytes: totalBytesToUpload,
            transferSpeed: 0,
            remainingTime: 0,
            operationComplete: true, // Indicate completion
            successfulFiles: filesUploadedCount, // Number of successful files
            failedFiles: totalFilesToUpload - filesUploadedCount, // Number of failed files (if any)
          });
        }
        logToFile(
          `sftpTransfer: Folder upload completed for "${localFolderPath}". ${filesUploadedCount} files uploaded.`,
          "INFO",
        );
        return {
          success: true,
          message: "文件夹上传成功",
          remotePath: remoteBaseUploadPath,
          totalFilesUploaded: filesUploadedCount,
        };
      } catch (error) {
        logToFile(
          `sftpTransfer: uploadFolder error for "${localFolderPath}" to "${remoteBaseUploadPath}": ${error.message}`,
          "ERROR",
        );
        // Send a final error status to renderer for the whole operation
        if (progressChannel) {
          // Check if progressChannel is provided
          sendToRenderer(progressChannel, {
            // Use progressChannel
            tabId,
            transferKey,
            error: error.message,
            cancelled:
              error.message.includes("cancel") ||
              error.message.includes("abort"),
            progress: -1,
            operationComplete: true,
            successfulFiles: filesUploadedCount,
            failedFiles: totalFilesToUpload - filesUploadedCount,
          });
        }
        return {
          success: false,
          error: error.message,
          cancelled:
            error.message.includes("cancel") || error.message.includes("abort"),
        };
      } finally {
        if (sftp.sftp) {
          // sftp client might have an inner sftp property if connected
          await sftp
            .end()
            .catch((e) =>
              logToFile(
                `sftpTransfer: Error ending SFTP connection in uploadFolder finally: ${e.message}`,
                "WARN",
              ),
            );
        }
        activeTransfers.delete(transferKey);
        logToFile(
          `sftpTransfer: Deleted transferKey ${transferKey} from activeTransfers. Size: ${activeTransfers.size}`,
          "DEBUG",
        );
      }
    },
    { type: "upload-folder", path: remoteBaseUploadPath, priority: "low" },
  );
}

// Placeholder for handleDownloadFolder - also very complex
async function handleDownloadFolder(tabId, remoteFolderPath) {
  if (
    !sftpCore ||
    !dialog ||
    !shell ||
    !getChildProcessInfo ||
    !sendToRenderer ||
    !logToFile ||
    !fs ||
    !path ||
    !SftpClient
  ) {
    logToFile(
      "sftpTransfer: Not properly initialized for downloadFolder.",
      "ERROR",
    );
    return {
      success: false,
      error: "SFTP Transfer module not properly initialized.",
    };
  }

  let folderName = "downloaded_folder";
  if (remoteFolderPath === "/") {
    folderName = "root_download";
  } else if (remoteFolderPath) {
    folderName = path.posix.basename(remoteFolderPath);
  }
  if (!folderName) folderName = `sftp_download_${Date.now()}`;

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "选择下载位置",
    properties: ["openDirectory"],
    buttonLabel: "下载到此文件夹",
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { success: false, cancelled: true, error: "用户取消下载" };
  }

  const localTargetParentDir = filePaths[0];
  const localBaseDownloadPath = path.join(localTargetParentDir, folderName);

  try {
    if (!fs.existsSync(localBaseDownloadPath)) {
      fs.mkdirSync(localBaseDownloadPath, { recursive: true });
    }
    // Test write permission
    const testFilePath = path.join(localBaseDownloadPath, "._writetest.tmp");
    fs.writeFileSync(testFilePath, "test");
    fs.unlinkSync(testFilePath);
  } catch (err) {
    logToFile(
      `sftpTransfer: Error creating or checking local download directory "${localBaseDownloadPath}": ${err.message}`,
      "ERROR",
    );
    return {
      success: false,
      error: `无法创建本地下载文件夹或无权限: ${localBaseDownloadPath}. ${err.message}`,
    };
  }

  logToFile(
    `sftpTransfer: Queuing folder download: "${remoteFolderPath}" to "${localBaseDownloadPath}" for tab ${tabId}`,
    "INFO",
  );

  return sftpCore.enqueueSftpOperation(
    tabId,
    async () => {
      const processInfo = getChildProcessInfo(tabId);
      if (!processInfo || !processInfo.config) {
        return {
          success: false,
          error: "sftpTransfer: Invalid SSH connection for downloadFolder.",
        };
      }
      const sshConfig = processInfo.config;

      const sftp = new SftpClient();
      const transferKey = `${tabId}-download-folder-${Date.now()}`;
      activeTransfers.set(transferKey, {
        sftp,
        type: "download-folder",
        remoteFolderPath,
        localBaseDownloadPath,
        path: path.dirname(remoteFolderPath) || "."
      });

      let overallDownloadedBytes = 0;
      let filesDownloadedCount = 0;
      let totalFilesToDownload = 0;
      let totalBytesToDownload = 0;
      const allFiles = []; // Flat list { remotePath, relativePath, name, size }

      // 1. Scan remote folder and calculate totals
      async function scanRemoteAndCalculateTotals(
        currentRemotePath,
        relativeBasePath,
      ) {
        const entries = await sftp.list(currentRemotePath);
        for (const entry of entries) {
          if (entry.name === "." || entry.name === "..") continue;

          const entryRemotePath = path.posix.join(
            currentRemotePath,
            entry.name,
          );
          const entryRelativePath = path.posix.join(
            relativeBasePath,
            entry.name,
          ); // POSIX for relative paths from remote

          if (entry.type === "d") {
            // Directory
            await scanRemoteAndCalculateTotals(
              entryRemotePath,
              entryRelativePath,
            );
          } else {
            // File
            allFiles.push({
              remotePath: entryRemotePath,
              relativePath: entryRelativePath,
              name: entry.name,
              size: entry.attrs.size, // ssh2-sftp-client uses entry.attrs.size
            });
            totalBytesToDownload += entry.attrs.size;
            totalFilesToDownload++;
          }
        }
      }

      try {
        await sftp.connect({
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.username,
          password: sshConfig.password,
          privateKey: sshConfig.privateKeyPath
            ? fs.readFileSync(sshConfig.privateKeyPath, "utf8")
            : undefined,
          passphrase:
            sshConfig.privateKeyPath && sshConfig.password
              ? sshConfig.password
              : undefined,
        });
        logToFile(
          `sftpTransfer: SFTP connected for folder download from ${sshConfig.host}. TransferKey: ${transferKey}`,
          "INFO",
        );

        sendToRenderer("download-folder-progress", {
          tabId,
          transferKey,
          currentFileName: "扫描远程文件夹中...",
          progress: 0,
        });
        await scanRemoteAndCalculateTotals(remoteFolderPath, "");
        logToFile(
          `sftpTransfer: Found ${totalFilesToDownload} files, total size ${totalBytesToDownload} bytes for download from "${remoteFolderPath}".`,
          "INFO",
        );

        if (totalFilesToDownload === 0) {
          logToFile(
            `sftpTransfer: No files to download in "${remoteFolderPath}".`,
            "INFO",
          );
          shell.showItemInFolder(localBaseDownloadPath);
          return {
            success: true,
            message: "远程文件夹为空。",
            totalFilesDownloaded: 0,
            localPath: localBaseDownloadPath,
          };
        }

        // 2. Create local sub-directory structure
        for (const file of allFiles) {
          if (!activeTransfers.has(transferKey))
            throw new Error(
              "sftpTransfer: Download cancelled during directory creation.",
            );
          const localFileDir = path.dirname(
            path.join(localBaseDownloadPath, file.relativePath),
          );
          if (!fs.existsSync(localFileDir)) {
            fs.mkdirSync(localFileDir, { recursive: true });
          }
        }
        logToFile(
          `sftpTransfer: Ensured all local subdirectories under "${localBaseDownloadPath}".`,
          "INFO",
        );

        // 添加用于计算传输速度和剩余时间的变量
        const transferStartTime = Date.now();
        let lastProgressUpdateTime = 0;
        let lastOverallBytesTransferred = 0;
        let lastTransferTime = transferStartTime;
        let currentTransferSpeed = 0;
        let currentRemainingTime = 0;
        const speedSmoothingFactor = 0.3; // 速度平滑因子，较低的值使速度变化更平缓
        
        // 3. Download files
        for (const file of allFiles) {
          if (!activeTransfers.has(transferKey)) {
            throw new Error(
              "sftpTransfer: Download cancelled during file transfer.",
            );
          }

          const localFilePath = path.join(
            localBaseDownloadPath,
            file.relativePath,
          );
          const tempLocalFilePath = localFilePath + ".part";
          let fileDownloadedBytes = 0;

          const reportProgress = (isFinal = false) => {
            const now = Date.now();
            if (isFinal || now - lastProgressUpdateTime >= 100) {
              const totalTransferred = overallDownloadedBytes + fileDownloadedBytes;
              const progress =
                totalBytesToDownload > 0
                  ? Math.floor((totalTransferred / totalBytesToDownload) * 100)
                  : 0;
              
              // 计算传输速度和剩余时间
              const timeElapsedSinceLastUpdate = (now - lastTransferTime) / 1000; // 转换为秒
              if (timeElapsedSinceLastUpdate > 0) {
                const bytesTransferredSinceLastUpdate = 
                  totalTransferred - lastOverallBytesTransferred;
                const instantSpeed = bytesTransferredSinceLastUpdate / timeElapsedSinceLastUpdate;
                
                // 使用平滑因子计算平滑速度，避免数值剧烈波动
                if (currentTransferSpeed === 0) {
                  currentTransferSpeed = instantSpeed; // 初始值
                } else {
                  currentTransferSpeed = (speedSmoothingFactor * instantSpeed) + 
                                        ((1 - speedSmoothingFactor) * currentTransferSpeed);
                }
                
                // 计算剩余时间（秒）
                const remainingBytes = totalBytesToDownload - totalTransferred;
                if (currentTransferSpeed > 0) {
                  currentRemainingTime = remainingBytes / currentTransferSpeed;
                }
                
                // 更新追踪变量
                lastOverallBytesTransferred = totalTransferred;
                lastTransferTime = now;
              }
              
              sendToRenderer("download-folder-progress", {
                tabId,
                transferKey,
                progress: Math.min(100, progress),
                currentFileName: file.name,
                currentFile: file.name, // 确保与前端使用的字段名一致
                filesProcessed: filesDownloadedCount + (isFinal ? 1 : 0),
                processedFiles: filesDownloadedCount + (isFinal ? 1 : 0), // 确保与前端使用的字段名一致
                totalFiles: totalFilesToDownload,
                transferredBytes: totalTransferred,
                totalBytes: totalBytesToDownload,
                transferSpeed: currentTransferSpeed,
                remainingTime: currentRemainingTime
              });
              lastProgressUpdateTime = now;
            }
          };
          reportProgress(); // Initial progress for the file

          await sftp.fastGet(file.remotePath, tempLocalFilePath, {
            concurrency: 16,
            chunkSize: 32768,
            step: (transferredChunkBytes, chunk, totalForFile) => {
              fileDownloadedBytes = totalForFile;
              reportProgress();
            },
          });

          try {
            fs.renameSync(tempLocalFilePath, localFilePath);
          } catch (renameError) {
            logToFile(
              `sftpTransfer: Rename failed for ${tempLocalFilePath} to ${localFilePath}: ${renameError.message}. Trying copy.`,
              "WARN",
            );
            fs.copyFileSync(tempLocalFilePath, localFilePath);
            fs.unlinkSync(tempLocalFilePath);
          }

          overallDownloadedBytes += file.size;
          filesDownloadedCount++;
          reportProgress(true); // Final progress for this file
          logToFile(
            `sftpTransfer: Downloaded "${file.remotePath}" to "${localFilePath}". (${filesDownloadedCount}/${totalFilesToDownload})`,
            "DEBUG",
          );
        }

        sendToRenderer("download-folder-progress", {
          tabId,
          transferKey,
          progress: 100,
          currentFileName: "下载完成!",
          currentFile: "下载完成!", // 确保与前端使用的字段名一致
          filesProcessed: filesDownloadedCount,
          processedFiles: filesDownloadedCount, // 确保与前端使用的字段名一致
          totalFiles: totalFilesToDownload,
          transferredBytes: totalBytesToDownload,
          overallDownloadedBytes: totalBytesToDownload,
          totalBytes: totalBytesToDownload,
          transferSpeed: 0, // 传输完成，速度为0
          remainingTime: 0  // 传输完成，剩余时间为0
        });
        logToFile(
          `sftpTransfer: Folder download completed for "${remoteFolderPath}". ${filesDownloadedCount} files downloaded.`,
          "INFO",
        );
        shell.showItemInFolder(localBaseDownloadPath);
        return {
          success: true,
          message: "文件夹下载成功",
          localPath: localBaseDownloadPath,
          totalFilesDownloaded: filesDownloadedCount,
        };
      } catch (error) {
        logToFile(
          `sftpTransfer: downloadFolder error for "${remoteFolderPath}" to "${localBaseDownloadPath}": ${error.message}`,
          "ERROR",
        );
        sendToRenderer("download-folder-progress", {
          tabId,
          transferKey,
          error: error.message,
          cancelled:
            error.message.includes("cancel") || error.message.includes("abort"),
          progress: -1,
          filesProcessed: filesDownloadedCount,
          totalFiles: totalFilesToDownload,
        });
        return {
          success: false,
          error: error.message,
          cancelled:
            error.message.includes("cancel") || error.message.includes("abort"),
        };
      } finally {
        if (sftp.sftp) {
          await sftp
            .end()
            .catch((e) =>
              logToFile(
                `sftpTransfer: Error ending SFTP connection in downloadFolder finally: ${e.message}`,
                "WARN",
              ),
            );
        }
        activeTransfers.delete(transferKey);
        logToFile(
          `sftpTransfer: Deleted transferKey ${transferKey} from activeTransfers. Size: ${activeTransfers.size}`,
          "DEBUG",
        );
      }
    },
    { type: "download-folder", path: remoteFolderPath, priority: "low" },
  );
}

async function handleCancelTransfer(event, tabId, transferKey) {
  // 如果没有找到精确的transferKey，尝试查找与tabId相关的传输
  if (!activeTransfers.has(transferKey)) {
    logToFile(`sftpTransfer: TransferKey ${transferKey} not found, searching for active transfers for tabId ${tabId}`, "INFO");
    
    // 查找与tabId相关的任何传输
    let foundTransferKey = null;
    for (const [key, transfer] of activeTransfers.entries()) {
      if (key.startsWith(tabId)) {
        foundTransferKey = key;
        logToFile(`sftpTransfer: Found alternative transferKey ${foundTransferKey} for tabId ${tabId}`, "INFO");
        break;
      }
    }
    
    if (foundTransferKey) {
      transferKey = foundTransferKey;
      logToFile(`sftpTransfer: Attempting to cancel transfer ${transferKey} (type: ${activeTransfers.get(transferKey).type})`, "INFO");
    } else {
      return { success: false, error: "没有找到活动的传输任务", userCancelled: true };
    }
  }

  const transfer = activeTransfers.get(transferKey);
  try {
    if (transfer && transfer.sftp) {
      // 添加取消标志
      transfer.cancelled = true;
      
      // 使用更强力的方式中断传输
      logToFile(`sftpTransfer: Forcefully interrupting transfer ${transferKey}`, "INFO");
      
      // 1. 尝试使用abort方法（如果可用）
      let abortSuccessful = false;
      if (transfer.sftp.currentTransfer && typeof transfer.sftp.currentTransfer.abort === 'function') {
        try {
          transfer.sftp.currentTransfer.abort();
          logToFile(`sftpTransfer: Transfer ${transferKey} aborted using transfer.abort()`, "INFO");
          abortSuccessful = true;
        } catch (abortError) {
          logToFile(`sftpTransfer: Error aborting transfer using abort(): ${abortError.message}`, "WARN");
        }
      }
      
      // 2. 中断SFTP流（如果有）
      if (!abortSuccessful && transfer.sftp._sftpStream && transfer.sftp._sftpStream.destroy) {
        try {
          // 强制中断SFTP流
          transfer.sftp._sftpStream.destroy();
          logToFile(`sftpTransfer: Destroyed SFTP stream for transfer ${transferKey}`, "INFO");
          abortSuccessful = true;
        } catch (streamError) {
          logToFile(`sftpTransfer: Error destroying SFTP stream: ${streamError.message}`, "WARN");
        }
      }
      
      // 3. 如果以上方法都失败，强制关闭并重新创建SFTP连接
      if (!abortSuccessful) {
        logToFile(`sftpTransfer: Trying to force close the SFTP connection for ${transferKey}`, "INFO");
        
        try {
          // 强制结束SFTP连接
          await transfer.sftp.end().catch(e => {
            logToFile(`sftpTransfer: Non-critical error ending SFTP connection: ${e.message}`, "WARN");
          });
          
          logToFile(`sftpTransfer: Successfully forced SFTP connection closure for ${transferKey}`, "INFO");
        } catch (endError) {
          logToFile(`sftpTransfer: Error ending SFTP connection: ${endError.message}`, "WARN");
          
          // 即使出错也尝试最后的方式：连接销毁
          try {
            if (transfer.sftp._client && typeof transfer.sftp._client.destroy === 'function') {
              transfer.sftp._client.destroy();
              logToFile(`sftpTransfer: Destroyed SFTP client connection for ${transferKey}`, "INFO");
            }
          } catch (destroyError) {
            logToFile(`sftpTransfer: Error destroying SFTP client: ${destroyError.message}`, "WARN");
          }
        }
      }
    }
    
    // 从活跃传输映射中移除
    activeTransfers.delete(transferKey);
    logToFile(`sftpTransfer: Removed transfer ${transferKey} from activeTransfers map. Active transfers remaining: ${activeTransfers.size}`, "INFO");
    
    // 根据传输类型发送正确的取消通知
    let channel = "upload-progress";
    if (transfer.type === "download") {
      channel = "download-progress";
    } else if (transfer.type === "download-folder") {
      channel = "download-folder-progress";
    } else if (transfer.type.includes("upload-folder")) {
      channel = "upload-folder-progress";
    }
    
    sendToRenderer(channel, {
      tabId,
      transferKey,
      cancelled: true,
      progress: -1,
      userCancelled: true // 添加标志表明这是用户主动取消
    });
    
    // 清理待处理操作但不关闭SFTP会话
    if (sftpCore && typeof sftpCore.clearPendingOperationsForTab === "function") {
      try {
        sftpCore.clearPendingOperationsForTab(tabId, { userCancelled: true });
        logToFile(`sftpTransfer: Cleared pending operations for tab ${tabId} after cancel`, "INFO");
      } catch (clearError) {
        logToFile(`sftpTransfer: Error clearing pending operations: ${clearError.message}`, "WARN");
      }
    }
    
    // 触发目录刷新以更新文件列表
    if (transfer.path) {
      try {
        // 异步获取当前目录的文件列表，使用setTimeout确保在当前事件循环后执行
        setTimeout(() => {
          sftpCore.enqueueSftpOperation(
            tabId,
            async () => {
              try {
                logToFile(`sftpTransfer: Refreshing directory listing for tab ${tabId} after cancel at path: ${transfer.path}`, "INFO");
                // 这里不需要直接返回结果，只需触发操作刷新会话
                return { success: true, refreshed: true };
              } catch (refreshError) {
                logToFile(`sftpTransfer: Error refreshing directory after cancel: ${refreshError.message}`, "WARN");
                return { success: false, error: refreshError.message };
              }
            },
            {
              type: "readdir",
              path: transfer.path || ".",
              priority: "high",
              canMerge: true
            }
          ).catch(err => {
            logToFile(`sftpTransfer: Failed to enqueue refresh operation: ${err.message}`, "WARN");
          });
        }, 500); // 延迟500ms，让取消操作完全处理后再刷新
      } catch (refreshError) {
        logToFile(`sftpTransfer: Error triggering refresh: ${refreshError.message}`, "WARN");
      }
    }
    
    return { success: true, message: "传输已取消", userCancelled: true }; // 添加标志表明这是用户主动取消
  } catch (error) {
    logToFile(`sftpTransfer: Error cancelling transfer ${transferKey}: ${error.message}`, "ERROR");
    
    // 即使出错也从活跃传输映射中删除
    activeTransfers.delete(transferKey);
    
    // 即使出错也尝试清理待处理操作
    if (sftpCore && typeof sftpCore.clearPendingOperationsForTab === "function") {
      try {
        sftpCore.clearPendingOperationsForTab(tabId, { userCancelled: true });
      } catch (clearError) {
        logToFile(`sftpTransfer: Error clearing pending operations after cancel error: ${clearError.message}`, "ERROR");
      }
    }
    
    return { success: false, error: `取消传输失败: ${error.message}`, userCancelled: true }; // 添加标志表明这是用户主动取消
  }
}

/**
 * 清理指定tab的所有活跃SFTP传输
 * 当连接关闭、应用退出前或页面刷新时调用，确保所有相关资源被释放
 * @param {string|number} tabId 要清理的标签ID
 * @returns {Promise<{success: boolean, message: string, cleanedCount: number}>} 清理结果
 */
async function cleanupActiveTransfersForTab(tabId) {
  try {
    if (!tabId) {
      logToFile("sftpTransfer: Invalid tabId provided to cleanupActiveTransfersForTab", "WARN");
      return { success: false, message: "无效的标签ID", cleanedCount: 0 };
    }

    logToFile(`sftpTransfer: Cleaning up all active transfers for tab ${tabId}`, "INFO");
    
    let cleanedCount = 0;
    const transfersToClean = [];
    
    // 查找所有与该tabId相关的传输
    for (const [key, transfer] of activeTransfers.entries()) {
      if (key.startsWith(`${tabId}-`) || key === tabId) {
        transfersToClean.push(key);
      }
    }
    
    // 逐个清理找到的传输
    for (const transferKey of transfersToClean) {
      logToFile(`sftpTransfer: Found active transfer ${transferKey} for tab ${tabId}, cleaning up`, "INFO");
      const transfer = activeTransfers.get(transferKey);
      
      if (transfer && transfer.sftp) {
        try {
          // 关闭SFTP客户端连接以终止传输
          await transfer.sftp.end().catch(e => {
            logToFile(`sftpTransfer: Error ending SFTP client for transfer ${transferKey}: ${e.message}`, "ERROR");
          });
          
          logToFile(`sftpTransfer: Successfully ended SFTP client for transfer ${transferKey}`, "INFO");
        } catch (error) {
          logToFile(`sftpTransfer: Error ending SFTP client for transfer ${transferKey}: ${error.message}`, "ERROR");
        }
        
        // 从活跃传输映射中删除
        activeTransfers.delete(transferKey);
        cleanedCount++;
      }
    }
    
    logToFile(`sftpTransfer: Cleaned up ${cleanedCount} active transfers for tab ${tabId}`, "INFO");
    return { 
      success: true, 
      message: `已清理${cleanedCount}个活跃传输`, 
      cleanedCount 
    };
  } catch (error) {
    logToFile(`sftpTransfer: Error in cleanupActiveTransfersForTab for ${tabId}: ${error.message}`, "ERROR");
    return { 
      success: false, 
      message: `清理传输时发生错误: ${error.message}`, 
      cleanedCount: 0 
    };
  }
}

module.exports = {
  init,
  handleDownloadFile,
  handleUploadFile,
  handleUploadFolder,
  handleDownloadFolder,
  handleCancelTransfer,
  cleanupActiveTransfersForTab,
};
