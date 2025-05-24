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
      activeTransfers.set(transferKey, { sftp, type: "download" });

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
        // ... (progress calculation logic as in main.js) ...
        const tempFilePath = filePath + ".part";

        await sftp.fastGet(remotePath, tempFilePath, {
          step: (transferredChunkBytes, chunk, totalTransferred) => {
            transferredBytes = totalTransferred;
            const progress = Math.floor((transferredBytes / totalBytes) * 100);
            const now = Date.now();
            if (now - lastProgressUpdate >= 100) {
              // Report every 100ms
              sendToRenderer("download-progress", {
                tabId, // Or a more specific transferId if needed
                transferKey,
                progress,
                fileName,
                transferredBytes,
                totalBytes,
                // transferSpeed, remainingTime would need more complex calculation here
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

async function handleUploadFile(event, tabId, targetFolder) {
  if (!sftpCore || !dialog || !getChildProcessInfo || !sendToRenderer || !logToFile || !fs || !path || !SftpClient) {
    logToFile("sftpTransfer not properly initialized for uploadFile.", "ERROR");
    return { success: false, error: "SFTP Transfer module not initialized." };
  }

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "选择要上传的文件",
    properties: ["openFile", "multiSelections"],
    buttonLabel: "上传",
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { success: false, cancelled: true, error: "用户取消上传" };
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

  if (totalBytesToUpload === 0 && totalFilesToUpload > 0) {
      // This case can happen if all files failed to stat or are empty.
      // Depending on desired behavior, could return an error or specific message.
      logToFile(`No bytes to upload, though ${totalFilesToUpload} files were selected (possibly stat errors or all empty).`, "WARN");
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
      activeTransfers.set(transferKey, { sftp, type: "upload-multifile" });

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
            await sftp.end().catch(()=>{});
            activeTransfers.delete(transferKey);
            return { success: false, error: `目标 ${normalizedTargetFolder} 不是一个有效的文件夹。` };
          }
        } catch (statErr) {
          logToFile(
            `sftpTransfer: Target folder check/stat failed for "${normalizedTargetFolder}": ${statErr.message}`,
            "WARN",
          );
          await sftp.end().catch(()=>{});
          activeTransfers.delete(transferKey);
          return { success: false, error: `目标文件夹 "${normalizedTargetFolder}" 不可访问: ${statErr.message}` };
        }

        let lastProgressUpdateTime = 0;

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
            logToFile(`Skipping file ${localFilePath} due to stat error: ${statError.message}`, "ERROR");
            failedUploads++;
            failedFileNames.push(fileName);
            // Send progress update for the skipped file if desired
            sendToRenderer("upload-progress", {
              tabId,
              transferKey,
              progress: totalBytesToUpload > 0 ? Math.floor((overallUploadedBytes / totalBytesToUpload) * 100) : 0,
              currentFileName: fileName,
              currentFileIndex: i + 1,
              totalFiles: totalFilesToUpload,
              overallUploadedBytes, // Use 'overallUploadedBytes' for consistency with folder upload
              totalBytes: totalBytesToUpload, // Use 'totalBytes' for consistency
              error: `无法读取文件属性: ${statError.message.substring(0,50)}...`
            });
            if (i === totalFilesToUpload - 1 && filesUploadedCount === 0) { // Last file and no successes
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
                const currentOverallTransferred = overallUploadedBytes + fileTransferredBytes;
                const progress = totalBytesToUpload > 0 ? Math.floor((currentOverallTransferred / totalBytesToUpload) * 100) : 0;
                const now = Date.now();

                if (now - lastProgressUpdateTime >= 100) { // Report every 100ms
                  sendToRenderer("upload-progress", {
                    tabId,
                    transferKey,
                    progress: Math.min(100, progress),
                    currentFileName: fileName,
                    currentFileIndex: i + 1,
                    totalFiles: totalFilesToUpload,
                    overallUploadedBytes: currentOverallTransferred,
                    totalBytes: totalBytesToUpload,
                  });
                  lastProgressUpdateTime = now;
                }
              },
              concurrency: 16, // As per previous settings
              chunkSize: 32768, // As per previous settings
            });
            overallUploadedBytes += currentFileSize;
            filesUploadedCount++;
            // Send final progress for this file
            sendToRenderer("upload-progress", {
              tabId,
              transferKey,
              progress: totalBytesToUpload > 0 ? Math.floor((overallUploadedBytes / totalBytesToUpload) * 100) : (totalFilesToUpload > 0 ? 100 : 0),
              currentFileName: fileName,
              currentFileIndex: i + 1,
              totalFiles: totalFilesToUpload,
              overallUploadedBytes,
              totalBytes: totalBytesToUpload,
              fileUploadSuccess: true // Indicate this specific file was successful
            });
          } catch (fileError) {
            logToFile(
              `sftpTransfer: Error uploading file "${localFilePath}" to "${remoteFilePath}": ${fileError.message}`,
              "ERROR",
            );
            failedUploads++;
            failedFileNames.push(fileName);
            // Send progress update for the failed file
             sendToRenderer("upload-progress", {
              tabId,
              transferKey,
              progress: totalBytesToUpload > 0 ? Math.floor((overallUploadedBytes / totalBytesToUpload) * 100) : 0,
              currentFileName: fileName,
              currentFileIndex: i + 1,
              totalFiles: totalFilesToUpload,
              overallUploadedBytes,
              totalBytes: totalBytesToUpload,
              error: fileError.message.substring(0,100)+'...', // Truncate long errors
              fileUploadSuccess: false // Indicate this specific file failed
            });
          }
        } // End of for loop

        // Final overall progress update after loop (covers all files)
        sendToRenderer("upload-progress", {
          tabId,
          transferKey,
          progress: totalBytesToUpload > 0 && filesUploadedCount > 0 ? 100 : (failedUploads === totalFilesToUpload ? 0 : 100), // show 0 if all failed
          currentFileName: failedUploads > 0 ? `${failedUploads} 个文件上传失败` : "所有文件上传完成!",
          currentFileIndex: totalFilesToUpload,
          totalFiles: totalFilesToUpload,
          overallUploadedBytes,
          totalBytes: totalBytesToUpload,
          operationComplete: true,
          successfulFiles: filesUploadedCount,
          failedFiles: failedUploads,
        });

        return {
          success: filesUploadedCount > 0, // Success if at least one file uploaded
          totalFiles: totalFilesToUpload,
          successfulFiles: filesUploadedCount,
          failedFiles: failedUploads,
          failedFileNames,
          remotePath: normalizedTargetFolder, // Target folder
          message: filesUploadedCount > 0 ? `${filesUploadedCount} 个文件上传成功。` + (failedUploads > 0 ? ` ${failedUploads} 个文件上传失败。` : "") : "没有文件成功上传。"
        };

      } catch (error) {
        logToFile(
          `sftpTransfer: General upload error on tab ${tabId} to ${normalizedTargetFolder}: ${error.message}`,
          "ERROR",
        );
        // Send a final error status to renderer for the whole operation
        sendToRenderer("upload-progress", {
            tabId,
            transferKey,
            error: error.message,
            cancelled: error.message.includes("cancel") || error.message.includes("abort"),
            progress: -1, // Indicate error
            operationComplete: true,
            successfulFiles: filesUploadedCount,
            failedFiles: totalFilesToUpload - filesUploadedCount, // All remaining are failed
        });
        return {
          success: false,
          error: `上传操作失败: ${error.message}`,
          cancelled: error.message.includes("cancel") || error.message.includes("abort"),
          totalFiles: totalFilesToUpload,
          successfulFiles: filesUploadedCount,
          failedFiles: totalFilesToUpload - filesUploadedCount,
          failedFileNames, // May not be fully populated if error is before loop
        };
      } finally {
        if (sftp.sftp) { // Check if sftp client is connected
          await sftp.end().catch(e => logToFile(`Error ending SFTP in multi-upload: ${e.message}`, "WARN"));
        }
        activeTransfers.delete(transferKey);
      }
    },
    // Adjust queue operation type if needed, e.g., to reflect multi-file nature or priority
    { type: "upload-multifile", path: normalizedTargetFolder, priority: "normal" }
  );
}

// Placeholder for handleUploadFolder - very complex, will simplify for now or defer
async function handleUploadFolder(tabId, localFolderPath, targetFolder) {
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

        // 4. Upload files
        let lastProgressUpdateTime = 0;
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
              const progress =
                totalBytesToUpload > 0
                  ? Math.floor(
                      ((overallUploadedBytes + fileTransferredBytes) /
                        totalBytesToUpload) *
                        100,
                    )
                  : 0;
              sendToRenderer("upload-folder-progress", {
                tabId,
                transferKey,
                progress: Math.min(100, progress), // Cap at 100
                currentFileName: file.name,
                filesProcessed:
                  filesUploadedCount + (isFinal && !file.isDirectory ? 1 : 0), // Only count files as processed when done
                totalFiles: totalFilesToUpload,
                overallUploadedBytes:
                  overallUploadedBytes + fileTransferredBytes,
                totalBytes: totalBytesToUpload,
              });
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

        sendToRenderer("upload-folder-progress", {
          tabId,
          transferKey,
          progress: 100,
          currentFileName: "上传完成!",
          filesProcessed: filesUploadedCount,
          totalFiles: totalFilesToUpload,
          overallUploadedBytes: totalBytesToUpload,
          totalBytes: totalBytesToUpload,
        });
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
        // Try to send a final error status to renderer
        sendToRenderer("upload-folder-progress", {
          tabId,
          transferKey,
          error: error.message,
          cancelled:
            error.message.includes("cancel") || error.message.includes("abort"),
          progress: -1,
          filesProcessed: filesUploadedCount,
          totalFiles: totalFilesToUpload,
        });
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

        // 3. Download files
        let lastProgressUpdateTime = 0;
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
              const progress =
                totalBytesToDownload > 0
                  ? Math.floor(
                      ((overallDownloadedBytes + fileDownloadedBytes) /
                        totalBytesToDownload) *
                        100,
                    )
                  : 0;
              sendToRenderer("download-folder-progress", {
                tabId,
                transferKey,
                progress: Math.min(100, progress),
                currentFileName: file.name,
                filesProcessed: filesDownloadedCount + (isFinal ? 1 : 0),
                totalFiles: totalFilesToDownload,
                overallDownloadedBytes:
                  overallDownloadedBytes + fileDownloadedBytes,
                totalBytes: totalBytesToDownload,
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
          filesProcessed: filesDownloadedCount,
          totalFiles: totalFilesToDownload,
          overallDownloadedBytes: totalBytesToDownload,
          totalBytes: totalBytesToDownload,
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
  if (!activeTransfers.has(transferKey)) {
    return { success: false, error: "没有找到活动的传输任务" };
  }
  const transfer = activeTransfers.get(transferKey);
  try {
    if (transfer.sftp && typeof transfer.sftp.end === "function") {
      await transfer.sftp.end(); // Attempt to close the sftp client connection
      logToFile(
        `sftpTransfer: Transfer ${transferKey} (type: ${transfer.type}) cancelled by ending SFTP client.`,
        "INFO",
      );
    }
    // Additional cancellation logic might be needed if sftp client uses other abort mechanisms
    activeTransfers.delete(transferKey);
    // Notify renderer about cancellation completion if applicable
    const channel =
      transfer.type === "download" ? "download-progress" : "upload-progress";
    sendToRenderer(channel, {
      tabId,
      transferKey,
      cancelled: true,
      progress: -1,
    });
    return { success: true, message: "传输已取消" };
  } catch (error) {
    logToFile(
      `sftpTransfer: Error cancelling transfer ${transferKey}: ${error.message}`,
      "ERROR",
    );
    activeTransfers.delete(transferKey); // Still remove it
    return { success: false, error: `取消传输失败: ${error.message}` };
  }
}

module.exports = {
  init,
  handleDownloadFile,
  handleUploadFile,
  handleUploadFolder,
  handleDownloadFolder,
  handleCancelTransfer,
};
