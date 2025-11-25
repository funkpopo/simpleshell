// This module will handle SFTP file transfers (upload, download, folder operations).
// It will depend on sftp-engine.js for session management and queueing.

const fs = require("fs");
const path = require("path");
const { pipeline } = require("stream/promises");
const { getBasicSSHAlgorithms } = require("../../constants/sshAlgorithms");

// Import centralized configuration
const {
  TRANSFER_CONFIG,
  RETRY_CONFIG,
  TIMEOUT_CONFIG,
  calculateRetryDelay,
  isRetryableError,
  isSessionError,
  chooseChunkSize,
  chooseConcurrency,
  getNoProgressTimeout,
} = require("./sftpConfig");

// SFTP streaming helpers
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function statRemoteSize(sftp, remotePath) {
  try {
    const st = await new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) return reject(err);
        resolve(stats);
      });
    });
    return typeof st.size === "number" ? st.size : 0;
  } catch (_) {
    return 0;
  }
}

async function uploadWithPipeline({
  sftp,
  localPath,
  remotePath,
  chunkSize,
  transferKey,
  getCancelled,
  onBytes,
  resumeOffset = 0,
  noProgressTimeoutMs = 30000,
}) {
  const read = fs.createReadStream(localPath, {
    highWaterMark: chunkSize,
    start: resumeOffset > 0 ? resumeOffset : undefined,
  });
  const write = sftp.createWriteStream(remotePath, {
    highWaterMark: chunkSize,
    flags: resumeOffset > 0 ? "r+" : "w",
    start: resumeOffset > 0 ? resumeOffset : undefined,
  });

  const transfer = activeTransfers.get(transferKey);
  if (transfer && transfer.activeStreams) {
    transfer.activeStreams.add(read);
    transfer.activeStreams.add(write);
  }

  let lastProgressAt = Date.now();
  const onData = (buf) => {
    if (typeof onBytes === "function") onBytes(buf.length);
    lastProgressAt = Date.now();
    if (typeof getCancelled === "function" && getCancelled()) {
      try { read.destroy(new Error("Transfer cancelled by user")); } catch (_) {}
      try { write.destroy(new Error("Transfer cancelled by user")); } catch (_) {}
    }
  };
  read.on("data", onData);

  const watchdog = setInterval(() => {
    if (Date.now() - lastProgressAt > noProgressTimeoutMs) {
      try { read.destroy(new Error("NO_PROGRESS_TIMEOUT")); } catch (_) {}
      try { write.destroy(new Error("NO_PROGRESS_TIMEOUT")); } catch (_) {}
    }
  }, 1000);

  try {
    await pipeline(read, write);
  } finally {
    clearInterval(watchdog);
    read.off("data", onData);
    const t = activeTransfers.get(transferKey);
    if (t && t.activeStreams) {
      t.activeStreams.delete(read);
      t.activeStreams.delete(write);
    }
  }
}

async function downloadWithPipeline({
  sftp,
  remotePath,
  localPath,
  chunkSize,
  transferKey,
  getCancelled,
  onBytes,
  resumeOffset = 0,
  noProgressTimeoutMs = 30000,
}) {
  const read = sftp.createReadStream(remotePath, {
    highWaterMark: chunkSize,
    start: resumeOffset > 0 ? resumeOffset : undefined,
  });
  const write = fs.createWriteStream(localPath, {
    highWaterMark: chunkSize,
    flags: resumeOffset > 0 ? "r+" : "w",
    start: resumeOffset > 0 ? resumeOffset : undefined,
  });

  const transfer = activeTransfers.get(transferKey);
  if (transfer && transfer.activeStreams) {
    transfer.activeStreams.add(read);
    transfer.activeStreams.add(write);
  }

  let lastProgressAt = Date.now();
  const onData = (buf) => {
    if (typeof onBytes === "function") onBytes(buf.length);
    lastProgressAt = Date.now();
    if (typeof getCancelled === "function" && getCancelled()) {
      try { read.destroy(new Error("Transfer cancelled by user")); } catch (_) {}
      try { write.destroy(new Error("Transfer cancelled by user")); } catch (_) {}
    }
  };
  read.on("data", onData);

  const watchdog = setInterval(() => {
    if (Date.now() - lastProgressAt > noProgressTimeoutMs) {
      try { read.destroy(new Error("NO_PROGRESS_TIMEOUT")); } catch (_) {}
      try { write.destroy(new Error("NO_PROGRESS_TIMEOUT")); } catch (_) {}
    }
  }, 1000);

  try {
    await pipeline(read, write);
  } finally {
    clearInterval(watchdog);
    read.off("data", onData);
    const t = activeTransfers.get(transferKey);
    if (t && t.activeStreams) {
      t.activeStreams.delete(read);
      t.activeStreams.delete(write);
    }
  }
}

let logToFile = null;
let sftpCore = null; // To access getSftpSession, enqueueSftpOperation, calculateDynamicTimeout
let dialog = null; // Electron dialog
let shell = null; // Electron shell
let getChildProcessInfo = null; // To get SSH config from childProcesses map in main.js
let sendToRenderer = null; // Function to send progress/status to renderer
let transferResumeManager = null; // 断点续传管理器

const activeTransfers = new Map(); // Manages active transfer operations for cancellation

// 简单的并发调度器
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;
  let active = 0;
  let rejectOnce;
  const errors = [];

  return await new Promise((resolve, reject) => {
    rejectOnce = reject;
    const tick = () => {
      if (index >= items.length && active === 0) {
        resolve({ results, errors });
        return;
      }
      while (active < limit && index < items.length) {
        const current = index++;
        const item = items[current];
        active++;
        Promise.resolve()
          .then(() => worker(item, current))
          .then((res) => {
            results[current] = { status: "fulfilled", value: res };
          })
          .catch((err) => {
            results[current] = { status: "rejected", reason: err };
            errors.push({ index: current, error: err });
          })
          .finally(() => {
            active--;
            tick();
          });
      }
    };
    tick();
  });
}

// 递归创建远程目录
async function createRemoteDirectoryRecursive(sftp, remotePath) {
  const parts = remotePath.split("/").filter(Boolean);
  let currentPath = remotePath.startsWith("/") ? "/" : "";

  for (const part of parts) {
    currentPath = path.posix.join(currentPath, part);

    try {
      await new Promise((resolve, reject) => {
        sftp.stat(currentPath, (err, stats) => {
          if (err) {
            if (err.code === 2) {
              // No such file
              // 目录不存在，创建它
              sftp.mkdir(currentPath, (mkdirErr) => {
                if (mkdirErr && mkdirErr.code !== 4) {
                  // 4 表示目录已存在
                  reject(mkdirErr);
                } else {
                  resolve();
                }
              });
            } else {
              reject(err);
            }
          } else if (stats.isDirectory()) {
            resolve();
          } else {
            reject(new Error(`路径存在但不是目录: ${currentPath}`));
          }
        });
      });
    } catch (error) {
      throw error;
    }
  }
}

function init(
  logger,
  core,
  electronDialog,
  electronShell,
  getChildProcessInfoFunc,
  sendToRendererFunc,
) {
  if (!logger || !logger.logToFile) {
    return;
  } else {
    logToFile = logger.logToFile;
  }

  if (!core) {
    // sftpCore is essential, operations will fail without it.
  }
  sftpCore = core;

  if (electronDialog) dialog = electronDialog;

  if (electronShell) shell = electronShell;

  if (typeof getChildProcessInfoFunc !== "function") {
  }
  getChildProcessInfo = getChildProcessInfoFunc;

  if (typeof sendToRendererFunc !== "function") {
    sendToRenderer = (channel, ...args) =>
      logToFile(
        `sendToRenderer (dummy) called: ${channel}, ${JSON.stringify(args)}`,
        "WARN",
      );
  } else {
    sendToRenderer = sendToRendererFunc;
  }

  // 初始化断点续传管理器
  const { TransferResumeManager } = require("../../core/transfer/transfer-resume-manager");
  transferResumeManager = new TransferResumeManager(logger);

  // 监听断点续传事件
  transferResumeManager.on("resumed", ({ transferId, resumeOffset }) => {
    logToFile(`传输恢复事件: ${transferId}, offset=${resumeOffset}`, "INFO");
  });

  logToFile("sftpTransfer initialized with resume support.", "INFO");
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
          sshConfig.downloadPath ||
            (dialog.app ? dialog.app.getPath("downloads") : ""),
          fileName,
        ),
        buttonLabel: "下载",
      });

      if (canceled || !filePath) {
        return { success: false, cancelled: true, error: "用户取消下载" };
      }

      // 使用会话池借用一个SFTP会话
      let borrowed = null;
      let sftp = null;
      if (sftpCore && typeof sftpCore.borrowSftpSession === "function") {
        borrowed = await sftpCore.borrowSftpSession(tabId);
        sftp = borrowed.sftp;
      } else {
        sftp = await sftpCore.getRawSftpSession(tabId);
      }
      const transferKey = `${tabId}-download-${Date.now()}`;
      activeTransfers.set(transferKey, {
        sftp,
        type: "download",
        path: path.dirname(remotePath),
        cancelled: false,
        activeStreams: new Set(),
        tabId,
        remotePath,
        localPath: filePath,
      });

      try {
        logToFile(
          `sftpTransfer: 使用SFTP会话进行下载 ${remotePath} (tab: ${tabId})`,
          "INFO",
        );

        // 获取文件信息
        const stats = await new Promise((resolve, reject) => {
          sftp.stat(remotePath, (err, stats) => {
            if (err) reject(err);
            else resolve(stats);
          });
        });

        const totalBytes = stats.size;
        const fileName = path.basename(remotePath);
        const tempFilePath = filePath + ".part";
        const chunkSize = chooseChunkSize(totalBytes);

        // 传输进度追踪
        let transferredBytes = 0;
        const transferStartTime = Date.now();
        let lastProgressUpdate = 0;
        let lastBytesTransferred = 0;
        let lastTransferTime = transferStartTime;
        let currentTransferSpeed = 0;
        let currentRemainingTime = 0;
        const speedSmoothingFactor = TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR;

        // Robust download flow using pipeline + watchdog + retries
        const getCancelled = () => {
          const t = activeTransfers.get(transferKey);
          return !t || t.cancelled;
        };

        const onBytes = (len) => {
          transferredBytes += len;
          const now = Date.now();

          if (now - lastProgressUpdate >= TRANSFER_CONFIG.PROGRESS_INTERVAL_MS) {
            const timeElapsed = (now - lastTransferTime) / 1000;
            if (timeElapsed > 0) {
              const bytesDelta = transferredBytes - lastBytesTransferred;
              const instantSpeed = bytesDelta / timeElapsed;
              currentTransferSpeed =
                currentTransferSpeed === 0
                  ? instantSpeed
                  : TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR * instantSpeed +
                    (1 - TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR) * currentTransferSpeed;
              const remainingBytes = totalBytes - transferredBytes;
              currentRemainingTime =
                currentTransferSpeed > 0 ? remainingBytes / currentTransferSpeed : 0;
              lastBytesTransferred = transferredBytes;
              lastTransferTime = now;
            }

            const progress = Math.floor((transferredBytes / totalBytes) * 100);
            sendToRenderer("download-progress", {
              tabId,
              transferKey,
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              transferSpeed: currentTransferSpeed,
              remainingTime: currentRemainingTime,
            });
            lastProgressUpdate = now;
          }
        };

        let attempt = 0;
        while (true) {
          try {
            let resumeOffset = 0;
            if (attempt > 0) {
              // 检查临时文件大小用于断点续传
              try {
                const tempStats = fs.statSync(tempFilePath);
                resumeOffset = tempStats.size;
                if (!Number.isFinite(resumeOffset) || resumeOffset > totalBytes) {
                  resumeOffset = 0;
                }
                transferredBytes = resumeOffset;
              } catch (e) {
                resumeOffset = 0;
              }
            }

            // 根据文件大小动态调整超时时间
            const timeoutMs = getNoProgressTimeout(totalBytes);

            await downloadWithPipeline({
              sftp,
              remotePath,
              localPath: tempFilePath,
              chunkSize,
              transferKey,
              getCancelled,
              onBytes,
              resumeOffset,
              noProgressTimeoutMs: timeoutMs,
            });
            break;
          } catch (e) {
            if (getCancelled()) {
              // 清理临时文件
              try {
                if (fs.existsSync(tempFilePath)) {
                  fs.unlinkSync(tempFilePath);
                }
              } catch (cleanupError) {
                logToFile(
                  `sftpTransfer: Failed to delete temp file: ${cleanupError.message}`,
                  "WARN",
                );
              }
              throw new Error("Transfer cancelled by user");
            }
            attempt += 1;
            if (!(attempt <= RETRY_CONFIG.MAX_OPERATION_ATTEMPTS && isRetryableError(e))) {
              throw e;
            }
            await delay(calculateRetryDelay(attempt));
          }
        }

        // 下载完成，重命名临时文件
        fs.renameSync(tempFilePath, filePath);

        sendToRenderer("download-progress", {
          tabId,
          transferKey,
          progress: 100,
          fileName,
          transferredBytes: totalBytes,
          totalBytes,
          transferSpeed: 0,
          remainingTime: 0,
        });

        activeTransfers.delete(transferKey);
        shell.showItemInFolder(filePath);
        return { success: true, filePath };
      } catch (error) {
        logToFile(
          `sftpTransfer: Download file error for ${remotePath} on ${tabId}: ${error.message}`,
          "ERROR",
        );

        // 检查是否是会话相关错误，如果是则尝试恢复会话
        if (isSessionError(error) && sftpCore) {
          logToFile(
            `sftpTransfer: 检测到会话错误，尝试恢复SFTP会话 (tab: ${tabId})`,
            "WARN",
          );
          // sftpCore 会自动处理会话恢复
        }

        try {
          // 清理临时文件
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (cleanupError) {
          logToFile(
            `sftpTransfer: Error cleaning up temp file: ${cleanupError.message}`,
            "ERROR",
          );
        }

        activeTransfers.delete(transferKey);
        return { success: false, error: error.message };
      } finally {
        // 归还会话
        try {
          if (
            borrowed &&
            sftpCore &&
            typeof sftpCore.releaseSftpSession === "function"
          ) {
            sftpCore.releaseSftpSession(tabId, borrowed.sessionId);
          }
        } catch (e) {
          // ignore
        }
      }
    },
    {
      type: "download",
      path: remotePath,
      priority: "normal",
    },
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
    !path
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
  const speedSmoothingFactor = TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR; // 速度平滑因子

  if (totalBytesToUpload === 0 && totalFilesToUpload > 0) {
    // This case can happen if all files failed to stat or are empty.
    logToFile(
      `No bytes to upload, though ${totalFilesToUpload} files were selected (possibly stat errors or all empty).`,
      "WARN",
    );
    // Pipeline might handle empty files or error out if path is invalid.
  }

  return sftpCore.enqueueSftpOperation(
    tabId,
    async () => {
      const processInfo = getChildProcessInfo(tabId);
      if (!processInfo || !processInfo.config) {
        return { success: false, error: "Invalid SSH connection for upload." };
      }
      const sshConfig = processInfo.config;

      // 使用SFTP适配器复用现有会话
      const sftp = await sftpCore.getRawSftpSession(tabId);
      // Create a more unique transferKey if multiple `handleUploadFile` calls can be concurrent for the same tabId
      // For now, assuming one major upload operation per tabId from this handler.
      const transferKey = `${tabId}-upload-multifile-${Date.now()}`;
      activeTransfers.set(transferKey, {
        sftp,
        type: "upload-multifile",
        path: normalizedTargetFolder || ".",
        cancelled: false,
        activeStreams: new Set(),
        tabId,
        totalFiles: totalFilesToUpload,
      });

      try {
        // 适配器已经连接，无需再次连接
        logToFile(
          `sftpTransfer: 复用SFTP会话进行多文件上传 (tab: ${tabId})`,
          "INFO",
        );

        // Ensure target directory exists
        try {
          const folderStat = await new Promise((resolve, reject) => {
            sftp.stat(normalizedTargetFolder || ".", (err, stats) => {
              if (err) {
                reject(err);
              } else {
                resolve(stats);
              }
            });
          });

          if (!folderStat.isDirectory()) {
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
          activeTransfers.delete(transferKey);
          return {
            success: false,
            error: `目标文件夹 "${normalizedTargetFolder}" 不可访问: ${statErr.message}`,
          };
        }

        // 汇总型进度上报函数（并发场景下统一节流）
        const maybeReportOverall = (fileName, currentIndex) => {
          const now = Date.now();
          if (
            now - lastProgressUpdateTime < (TRANSFER_CONFIG.PROGRESS_INTERVAL_MS || 250)
          )
            return;
          const progress =
            totalBytesToUpload > 0
              ? Math.floor((overallUploadedBytes / totalBytesToUpload) * 100)
              : 0;
          if (progressChannel) {
            sendToRenderer(progressChannel, {
              tabId,
              transferKey,
              progress: Math.min(100, progress),
              fileName,
              currentFileIndex: currentIndex + 1,
              totalFiles: totalFilesToUpload,
              transferredBytes: overallUploadedBytes,
              totalBytes: totalBytesToUpload,
              transferSpeed: currentTransferSpeed,
              remainingTime: currentRemainingTime,
            });
          }
          lastProgressUpdateTime = now;
        };

        // 构建并发任务
        const tasks = filePaths.map((localFilePath, i) => async () => {
          // 取消检查
          const t = activeTransfers.get(transferKey);
          if (!t || t.cancelled) throw new Error("Transfer cancelled by user");

          const fileName = path.basename(localFilePath);
          const remoteFilePath = path.posix
            .join(normalizedTargetFolder || ".", fileName)
            .replace(/\\\\/g, "/");

          // 借用一个SFTP会话用于本文件上传
          let borrowed = null;
          let sftpForFile = null;
          if (sftpCore && typeof sftpCore.borrowSftpSession === "function") {
            borrowed = await sftpCore.borrowSftpSession(tabId);
            sftpForFile = borrowed.sftp;
          } else {
            sftpForFile = sftp; // 回退使用主会话
          }

          try {
            let currentFileStats;
            try {
              currentFileStats = fs.statSync(localFilePath);
            } catch (statError) {
              failedUploads++;
              failedFileNames.push(fileName);
              if (progressChannel) {
                sendToRenderer(progressChannel, {
                  tabId,
                  transferKey,
                  progress:
                    totalBytesToUpload > 0
                      ? Math.floor(
                          (overallUploadedBytes / totalBytesToUpload) * 100,
                        )
                      : 0,
                  fileName,
                  currentFileIndex: i + 1,
                  totalFiles: totalFilesToUpload,
                  transferredBytes: overallUploadedBytes,
                  totalBytes: totalBytesToUpload,
                  transferSpeed: 0,
                  remainingTime: 0,
                  error: `无法读取文件属性: ${statError.message.substring(0, 50)}...`,
                });
              }
              return;
            }

            const currentFileSize = currentFileStats.size;
            let fileTransferredBytes = 0;
            const chunkSize = chooseChunkSize(currentFileSize);

            // Robust upload flow using pipeline + watchdog + retries
            const getCancelled = () => {
              const t = activeTransfers.get(transferKey);
              return !t || t.cancelled;
            };
            const onBytes = (len) => {
              fileTransferredBytes += len;
              overallUploadedBytes += len;
              const now = Date.now();
              const timeElapsed = (now - lastTransferTime) / 1000;
              if (timeElapsed > 0) {
                const bytesDelta = overallUploadedBytes - lastOverallBytesTransferred;
                const instantSpeed = bytesDelta / timeElapsed;
                currentTransferSpeed =
                  currentTransferSpeed === 0
                    ? instantSpeed
                    : TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR * instantSpeed + (1 - TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR) * currentTransferSpeed;
                const remainingBytes = totalBytesToUpload - overallUploadedBytes;
                currentRemainingTime =
                  currentTransferSpeed > 0 ? remainingBytes / currentTransferSpeed : 0;
                lastOverallBytesTransferred = overallUploadedBytes;
                lastTransferTime = now;
              }
              maybeReportOverall(fileName, i);
            };

            let attempt = 0;
            while (true) {
              try {
                let resumeOffset = 0;
                if (attempt > 0) {
                  resumeOffset = await statRemoteSize(sftpForFile, remoteFilePath);
                  if (!Number.isFinite(resumeOffset) || resumeOffset > currentFileSize) {
                    resumeOffset = 0;
                  }
                }

                // 根据文件大小动态调整超时时间
                const timeoutMs = getNoProgressTimeout(currentFileSize);

                await uploadWithPipeline({
                  sftp: sftpForFile,
                  localPath: localFilePath,
                  remotePath: remoteFilePath,
                  chunkSize,
                  transferKey,
                  getCancelled,
                  onBytes,
                  resumeOffset,
                  noProgressTimeoutMs: timeoutMs,
                });
                break;
              } catch (e) {
                if (getCancelled()) throw new Error("Transfer cancelled by user");
                attempt += 1;
                if (!(attempt <= RETRY_CONFIG.MAX_OPERATION_ATTEMPTS && isRetryableError(e))) {
                  throw e;
                }
                await delay(calculateRetryDelay(attempt));
              }
            }

            filesUploadedCount++;
            // Ensure progress update
            maybeReportOverall(fileName, i);
          } finally {
            // 归还会话
            if (
              borrowed &&
              sftpCore &&
              typeof sftpCore.releaseSftpSession === "function"
            ) {
              sftpCore.releaseSftpSession(tabId, borrowed.sessionId);
            }
          }
        });

        // 根据文件规模动态调整并发度
        const dynamicParallelUpload = chooseConcurrency(totalFilesToUpload, totalBytesToUpload, true);

        // 执行并发任务
        await runWithConcurrency(tasks, dynamicParallelUpload, (fn) => fn());

        // 确保最终进度为100%
        lastProgressUpdateTime = 0;
        maybeReportOverall("", totalFilesToUpload - 1);

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
        const isCancelledOperation =
          error.message.includes("cancel") || error.message.includes("abort");

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

        // 检查是否是会话相关错误，如果是则尝试恢复会话
        if (isSessionError(error) && sftpCore) {
          logToFile(
            `sftpTransfer: 检测到会话错误，尝试恢复SFTP会话 (tab: ${tabId})`,
            "WARN",
          );
          try {
            await sftpCore.ensureSftpSession(tabId);
            logToFile(`sftpTransfer: SFTP会话恢复成功 (tab: ${tabId})`, "INFO");
          } catch (recoveryError) {
            logToFile(
              `sftpTransfer: SFTP会话恢复失败 (tab: ${tabId}): ${recoveryError.message}`,
              "ERROR",
            );
          }
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
    !path
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

      // 直接使用 sftpCore.getRawSftpSession 获取原生 SFTP 会话
      const sftp = await sftpCore.getRawSftpSession(tabId);
      const transferKey = `${tabId}-upload-folder-${Date.now()}`;
      activeTransfers.set(transferKey, {
        sftp,
        type: "upload-folder",
        localFolderPath,
        remoteBaseUploadPath,
        path: normalizedTargetFolder || ".",
        cancelled: false,
        activeStreams: new Set(),
        tabId,
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

        // 使用原生 SFTP 会话
        logToFile(
          `sftpTransfer: 使用SFTP会话进行文件夹上传 (tab: ${tabId}). TransferKey: ${transferKey}`,
          "INFO",
        );

        // 2. Create remote base directory for the upload
        try {
          await new Promise((resolve, reject) => {
            sftp.stat(remoteBaseUploadPath, (err, stats) => {
              if (err) {
                reject(err);
              } else {
                resolve(stats);
              }
            });
          });
        } catch (e) {
          // Does not exist
          // 递归创建目录
          await createRemoteDirectoryRecursive(sftp, remoteBaseUploadPath);
          logToFile(
            `sftpTransfer: Created remote base directory "${remoteBaseUploadPath}".`,
            "INFO",
          );
        }

        // 3. Create sub-directory structure - Optimized for high latency
        const createdRemoteDirs = new Set([remoteBaseUploadPath]);
        const dirsToCreate = new Set();

        // 先收集所有需要创建的目录
        for (const file of allFiles) {
          const remoteFileDir = path.posix.dirname(
            path.posix.join(remoteBaseUploadPath, file.relativePath),
          );

          // 收集所有父目录路径
          let currentPath = remoteFileDir;
          while (
            currentPath &&
            currentPath !== path.posix.dirname(currentPath) &&
            currentPath !== "." &&
            !createdRemoteDirs.has(currentPath)
          ) {
            dirsToCreate.add(currentPath);
            currentPath = path.posix.dirname(currentPath);
          }
        }

        // 批量创建目录，优化性能
        if (dirsToCreate.size > 0) {
          logToFile(
            `sftpTransfer: Creating ${dirsToCreate.size} directories for folder upload`,
            "INFO",
          );

          // 将目录按深度排序，确保父目录先创建
          const sortedDirs = Array.from(dirsToCreate).sort((a, b) => {
            const depthA = a.split("/").filter(Boolean).length;
            const depthB = b.split("/").filter(Boolean).length;
            return depthA - depthB;
          });

          // 并行创建同一层级的目录
          const dirsByDepth = {};
          for (const dir of sortedDirs) {
            const depth = dir.split("/").filter(Boolean).length;
            if (!dirsByDepth[depth]) {
              dirsByDepth[depth] = [];
            }
            dirsByDepth[depth].push(dir);
          }

          // 逐层创建目录
          for (const depth of Object.keys(dirsByDepth).sort((a, b) => a - b)) {
            const dirsAtDepth = dirsByDepth[depth];

            // 并行创建同一层级的目录
            await Promise.all(
              dirsAtDepth.map(async (dir) => {
                // 检查取消状态
                const currentTransfer = activeTransfers.get(transferKey);
                if (!currentTransfer || currentTransfer.cancelled) {
                  throw new Error("Transfer cancelled by user");
                }

                try {
                  await createRemoteDirectoryRecursive(sftp, dir);
                  createdRemoteDirs.add(dir);
                } catch (mkdirError) {
                  // 忽略已存在的目录错误
                  if (
                    !mkdirError.message ||
                    (!mkdirError.message.includes("Failure code is 4") &&
                      !mkdirError.message.includes("already exists"))
                  ) {
                    logToFile(
                      `sftpTransfer: Error creating remote directory "${dir}": ${mkdirError.message}`,
                      "ERROR",
                    );
                    throw mkdirError;
                  }
                  createdRemoteDirs.add(dir);
                }
              }),
            );
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
        const speedSmoothingFactor = TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR; // 速度平滑因子，较低的值使速度变化更平缓

        // 4. 并发上传文件
        const maybeReportOverall = () => {
          const now = Date.now();
          if (
            now - lastProgressUpdateTime < (TRANSFER_CONFIG.PROGRESS_INTERVAL_MS || 250)
          )
            return;
          const progress =
            totalBytesToUpload > 0
              ? Math.floor((overallUploadedBytes / totalBytesToUpload) * 100)
              : 0;
          if (progressChannel) {
            sendToRenderer(progressChannel, {
              tabId,
              transferKey,
              progress: Math.min(100, progress),
              processedFiles: filesUploadedCount,
              totalFiles: totalFilesToUpload,
              transferredBytes: overallUploadedBytes,
              totalBytes: totalBytesToUpload,
              transferSpeed: currentTransferSpeed,
              remainingTime: currentRemainingTime,
            });
          }
          lastProgressUpdateTime = now;
        };

        const tasks = allFiles.map((file) => async () => {
          // 取消检查
          const currentTransfer = activeTransfers.get(transferKey);
          if (!currentTransfer || currentTransfer.cancelled) {
            throw new Error("Transfer cancelled by user");
          }

          const remoteFilePath = path.posix.join(
            remoteBaseUploadPath,
            file.relativePath,
          );

          let fileTransferredBytes = 0;
          const chunkSize = chooseChunkSize(file.size);

          // Robust upload flow for folder files (pipeline + watchdog + retries)
          // Ensure we have a session (borrowing if pool available)
          let borrowed = null;
          let sftpForFile = null;
          try {
            if (sftpCore && typeof sftpCore.borrowSftpSession === "function") {
              borrowed = await sftpCore.borrowSftpSession(tabId);
              sftpForFile = borrowed.sftp;
            } else {
              sftpForFile = sftp;
            }

            const getCancelled = () => {
              const t = activeTransfers.get(transferKey);
              return !t || t.cancelled;
            };
            const onBytes = (len) => {
              fileTransferredBytes += len;
              overallUploadedBytes += len;
              const now = Date.now();
              const timeElapsed = (now - lastTransferTime) / 1000;
              if (timeElapsed > 0) {
                const bytesDelta = overallUploadedBytes - lastOverallBytesTransferred;
                const instantSpeed = bytesDelta / timeElapsed;
                currentTransferSpeed =
                  currentTransferSpeed === 0
                    ? instantSpeed
                    : TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR * instantSpeed + (1 - TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR) * currentTransferSpeed;
                const remainingBytes = totalBytesToUpload - overallUploadedBytes;
                currentRemainingTime =
                  currentTransferSpeed > 0 ? remainingBytes / currentTransferSpeed : 0;
                lastOverallBytesTransferred = overallUploadedBytes;
                lastTransferTime = now;
              }
              maybeReportOverall();
            };

            let attempt = 0;
            while (true) {
              try {
                let resumeOffset = 0;
                if (attempt > 0) {
                  resumeOffset = await statRemoteSize(sftpForFile, remoteFilePath);
                  if (!Number.isFinite(resumeOffset) || resumeOffset > file.size) {
                    resumeOffset = 0;
                  }
                }

                // 根据文件大小动态调整超时时间
                const timeoutMs = getNoProgressTimeout(file.size);

                await uploadWithPipeline({
                  sftp: sftpForFile,
                  localPath: file.localPath,
                  remotePath: remoteFilePath,
                  chunkSize,
                  transferKey,
                  getCancelled,
                  onBytes,
                  resumeOffset,
                  noProgressTimeoutMs: timeoutMs,
                });
                break;
              } catch (e) {
                if (getCancelled()) throw new Error("Transfer cancelled by user");
                attempt += 1;
                if (!(attempt <= RETRY_CONFIG.MAX_OPERATION_ATTEMPTS && isRetryableError(e))) {
                  throw e;
                }
                await delay(calculateRetryDelay(attempt));
              }
            }

            filesUploadedCount++;
            maybeReportOverall();
          } finally {
            // 归还会话
            if (borrowed && sftpCore && typeof sftpCore.releaseSftpSession === "function") {
              sftpCore.releaseSftpSession(tabId, borrowed.sessionId);
            }
          }
        });

        // 根据文件规模动态调整并发度
        const dynamicParallelUpload = chooseConcurrency(totalFilesToUpload, totalBytesToUpload, true);

        logToFile(
          `sftpTransfer: Starting folder upload with ${dynamicParallelUpload} parallel workers`,
          "INFO",
        );

        await runWithConcurrency(
          tasks,
          dynamicParallelUpload,
          (fn) => fn(),
        );

        // 完成后强制更新到100%
        lastProgressUpdateTime = 0;
        maybeReportOverall();

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

        // 检查是否是会话相关错误，如果是则尝试恢复会话
        if (isSessionError(error) && sftpCore) {
          logToFile(
            `sftpTransfer: 检测到会话错误，尝试恢复SFTP会话 (tab: ${tabId})`,
            "WARN",
          );
          try {
            await sftpCore.ensureSftpSession(tabId);
            logToFile(`sftpTransfer: SFTP会话恢复成功 (tab: ${tabId})`, "INFO");
          } catch (recoveryError) {
            logToFile(
              `sftpTransfer: SFTP会话恢复失败 (tab: ${tabId}): ${recoveryError.message}`,
              "ERROR",
            );
          }
        }

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
    !path
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

      // 直接使用 sftpCore.getRawSftpSession 获取原生 SFTP 会话
      const sftp = await sftpCore.getRawSftpSession(tabId);
      const transferKey = `${tabId}-download-folder-${Date.now()}`;
      activeTransfers.set(transferKey, {
        sftp,
        type: "download-folder",
        remoteFolderPath,
        localBaseDownloadPath,
        path: path.dirname(remoteFolderPath) || ".",
        cancelled: false,
        activeStreams: new Set(),
        tabId,
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
        const entries = await new Promise((resolve, reject) => {
          sftp.readdir(currentRemotePath, (err, list) => {
            if (err) {
              reject(err);
            } else {
              // 转换为与之前格式兼容的结构
              const formattedList = list.map((item) => ({
                name: item.filename,
                type: item.attrs.isDirectory() ? "d" : "-",
                size: item.attrs.size,
                modifyTime: item.attrs.mtime * 1000,
                accessTime: item.attrs.atime * 1000,
                rights: {
                  user: (item.attrs.mode & parseInt("700", 8)) >> 6,
                  group: (item.attrs.mode & parseInt("070", 8)) >> 3,
                  other: item.attrs.mode & parseInt("007", 8),
                },
                owner: item.attrs.uid,
                group: item.attrs.gid,
                attrs: item.attrs,
              }));
              resolve(formattedList);
            }
          });
        });

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
              size: entry.size,
            });
            totalBytesToDownload += entry.size;
            totalFilesToDownload++;
          }
        }
      }

      try {
        // 适配器已经连接，无需再次连接
        logToFile(
          `sftpTransfer: 复用SFTP会话进行文件夹下载 (tab: ${tabId}). TransferKey: ${transferKey}`,
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
          // 检查取消状态
          const currentTransfer = activeTransfers.get(transferKey);
          if (!currentTransfer || currentTransfer.cancelled) {
            logToFile(
              `sftpTransfer: Folder download cancelled by user during directory creation`,
              "INFO",
            );
            // 发送取消状态到前端
            sendToRenderer("download-folder-progress", {
              tabId,
              transferKey,
              cancelled: true,
              userCancelled: true,
              progress: 0,
              filesProcessed: 0,
              totalFiles: totalFilesToDownload,
            });
            return {
              success: true,
              cancelled: true,
              userCancelled: true,
              message: "文件夹下载已被用户取消",
              filesDownloaded: 0,
              totalFiles: totalFilesToDownload,
            };
          }
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
        const speedSmoothingFactor = TRANSFER_CONFIG.SPEED_SMOOTHING_FACTOR; // 速度平滑因子，较低的值使速度变化更平缓

        // 3. 并发下载文件
        const maybeReportOverall = () => {
          const now = Date.now();
          if (
            now - lastProgressUpdateTime < (TRANSFER_CONFIG.PROGRESS_INTERVAL_MS || 250)
          )
            return;
          const progress =
            totalBytesToDownload > 0
              ? Math.floor(
                  (overallDownloadedBytes / totalBytesToDownload) * 100,
                )
              : 0;
          sendToRenderer("download-folder-progress", {
            tabId,
            transferKey,
            progress: Math.min(100, progress),
            filesProcessed: filesDownloadedCount,
            totalFiles: totalFilesToDownload,
            transferredBytes: overallDownloadedBytes,
            totalBytes: totalBytesToDownload,
            transferSpeed: currentTransferSpeed,
            remainingTime: currentRemainingTime,
          });
          lastProgressUpdateTime = now;
        };

        const tasks = allFiles.map((file) => async () => {
          // 取消检查
          const ct = activeTransfers.get(transferKey);
          if (!ct || ct.cancelled)
            throw new Error("Transfer cancelled by user");

          const localFilePath = path.join(
            localBaseDownloadPath,
            file.relativePath,
          );
          const tempLocalFilePath = localFilePath + ".part";

          // 确保本地目录存在
          const localDir = path.dirname(localFilePath);
          if (!fs.existsSync(localDir)) {
            fs.mkdirSync(localDir, { recursive: true });
          }

          let fileDownloadedBytes = 0;
          const chunkSize = chooseChunkSize(file.size);

          const writeStream = fs.createWriteStream(tempLocalFilePath, {
            highWaterMark: chunkSize,
          });
          // 借用一个SFTP会话
          let borrowed = null;
          let sftpForFile = null;
          if (sftpCore && typeof sftpCore.borrowSftpSession === "function") {
            borrowed = await sftpCore.borrowSftpSession(tabId);
            sftpForFile = borrowed.sftp;
          } else {
            sftpForFile = sftp; // 回退
          }

          const readStream = sftpForFile.createReadStream(file.remotePath, {
            highWaterMark: chunkSize,
          });

          // 跟踪活跃流，便于取消
          const tr = activeTransfers.get(transferKey);
          if (tr && tr.activeStreams) {
            tr.activeStreams.add(readStream);
            tr.activeStreams.add(writeStream);
          }

          await new Promise((resolve, reject) => {
            writeStream.on("error", (error) => reject(error));
            readStream.on("error", (error) => {
              writeStream.destroy();
              reject(error);
            });
            readStream.on("data", (chunk) => {
              const tnow = Date.now();
              const current = activeTransfers.get(transferKey);
              if (current && current.cancelled) {
                readStream.destroy();
                writeStream.destroy();
                reject(new Error("Transfer cancelled by user"));
                return;
              }
              fileDownloadedBytes += chunk.length;
              overallDownloadedBytes += chunk.length;
              // 速度估算
              const timeElapsed = (tnow - lastTransferTime) / 1000;
              if (timeElapsed > 0) {
                const delta =
                  overallDownloadedBytes - lastOverallBytesTransferred;
                const instant = delta / timeElapsed;
                currentTransferSpeed =
                  currentTransferSpeed === 0
                    ? instant
                    : 0.3 * instant + 0.7 * currentTransferSpeed;
                const remain = totalBytesToDownload - overallDownloadedBytes;
                currentRemainingTime =
                  currentTransferSpeed > 0 ? remain / currentTransferSpeed : 0;
                lastOverallBytesTransferred = overallDownloadedBytes;
                lastTransferTime = tnow;
              }
              maybeReportOverall();
            });
            readStream.on("end", () => resolve());
            readStream.pipe(writeStream);
          });

          try {
            fs.renameSync(tempLocalFilePath, localFilePath);
          } catch (renameError) {
            try {
              fs.copyFileSync(tempLocalFilePath, localFilePath);
              fs.unlinkSync(tempLocalFilePath);
            } catch (e) {
              // ignore secondary errors
            }
          }

          filesDownloadedCount++;
          maybeReportOverall();

          // 从活跃流集合中移除
          const tr2 = activeTransfers.get(transferKey);
          if (tr2 && tr2.activeStreams) {
            tr2.activeStreams.delete(readStream);
            tr2.activeStreams.delete(writeStream);
          }
          // 归还会话
          if (
            borrowed &&
            sftpCore &&
            typeof sftpCore.releaseSftpSession === "function"
          ) {
            sftpCore.releaseSftpSession(tabId, borrowed.sessionId);
          }
        });

        // 根据文件规模动态调整并发度（下载）
        const dynamicParallelDownload = chooseConcurrency(totalFilesToDownload, totalBytesToDownload, false);

        await runWithConcurrency(tasks, dynamicParallelDownload, (fn) => fn());

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
          remainingTime: 0, // 传输完成，剩余时间为0
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

        // 检查是否是会话相关错误，如果是则尝试恢复会话
        if (isSessionError(error) && sftpCore) {
          logToFile(
            `sftpTransfer: 检测到会话错误，尝试恢复SFTP会话 (tab: ${tabId})`,
            "WARN",
          );
          try {
            await sftpCore.ensureSftpSession(tabId);
            logToFile(`sftpTransfer: SFTP会话恢复成功 (tab: ${tabId})`, "INFO");
          } catch (recoveryError) {
            logToFile(
              `sftpTransfer: SFTP会话恢复失败 (tab: ${tabId}): ${recoveryError.message}`,
              "ERROR",
            );
          }
        }

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
    logToFile(
      `sftpTransfer: TransferKey ${transferKey} not found, searching for active transfers for tabId ${tabId}`,
      "INFO",
    );

    // 查找与tabId相关的任何传输
    let foundTransferKey = null;
    for (const [key, transfer] of activeTransfers.entries()) {
      if (key.startsWith(tabId)) {
        foundTransferKey = key;
        logToFile(
          `sftpTransfer: Found alternative transferKey ${foundTransferKey} for tabId ${tabId}`,
          "INFO",
        );
        break;
      }
    }

    if (foundTransferKey) {
      transferKey = foundTransferKey;
      logToFile(
        `sftpTransfer: Attempting to cancel transfer ${transferKey} (type: ${activeTransfers.get(transferKey).type})`,
        "INFO",
      );
    } else {
      return {
        success: false,
        error: "没有找到活动的传输任务",
        userCancelled: true,
      };
    }
  }

  const transfer = activeTransfers.get(transferKey);
  try {
    if (transfer && transfer.sftp) {
      // 添加取消标志
      transfer.cancelled = true;

      logToFile(
        `sftpTransfer: Marking transfer ${transferKey} as cancelled and attempting to stop all operations`,
        "INFO",
      );

      // 使用更强力的方式中断传输
      logToFile(
        `sftpTransfer: Forcefully interrupting transfer ${transferKey}`,
        "INFO",
      );

      // 1. 尝试中断活跃的流操作
      let streamsStopped = false;
      if (transfer.activeStreams) {
        try {
          transfer.activeStreams.forEach((stream) => {
            if (stream && typeof stream.destroy === "function") {
              stream.destroy(new Error("Transfer cancelled by user"));
            }
          });
          streamsStopped = true;
          logToFile(
            `sftpTransfer: Destroyed active streams for transfer ${transferKey}`,
            "INFO",
          );
        } catch (streamError) {
          logToFile(
            `sftpTransfer: Error destroying active streams: ${streamError.message}`,
            "WARN",
          );
        }
      }

      // 2. 尝试使用abort方法（如果可用）
      let abortSuccessful = false;
      if (
        transfer.sftp.currentTransfer &&
        typeof transfer.sftp.currentTransfer.abort === "function"
      ) {
        try {
          transfer.sftp.currentTransfer.abort();
          logToFile(
            `sftpTransfer: Transfer ${transferKey} aborted using transfer.abort()`,
            "INFO",
          );
          abortSuccessful = true;
        } catch (abortError) {
          logToFile(
            `sftpTransfer: Error aborting transfer using abort(): ${abortError.message}`,
            "WARN",
          );
        }
      }

      // 3. 中断SFTP流（如果有）
      if (
        !abortSuccessful &&
        transfer.sftp._sftpStream &&
        transfer.sftp._sftpStream.destroy
      ) {
        try {
          // 强制中断SFTP流
          transfer.sftp._sftpStream.destroy();
          logToFile(
            `sftpTransfer: Destroyed SFTP stream for transfer ${transferKey}`,
            "INFO",
          );
          abortSuccessful = true;
        } catch (streamError) {
          logToFile(
            `sftpTransfer: Error destroying SFTP stream: ${streamError.message}`,
            "WARN",
          );
        }
      }

      // 4. 如果以上方法都失败，强制关闭并重新创建SFTP连接
      if (!abortSuccessful && !streamsStopped) {
        logToFile(
          `sftpTransfer: Trying to force close the SFTP connection for ${transferKey}`,
          "INFO",
        );

        // 不需要强制关闭SFTP连接，因为它是由 sftpCore 管理的
        logToFile(
          `sftpTransfer: SFTP connection for ${transferKey} is managed by sftpCore, no need to close it manually`,
          "INFO",
        );
      }
    }

    // 从活跃传输映射中移除
    activeTransfers.delete(transferKey);
    logToFile(
      `sftpTransfer: Removed transfer ${transferKey} from activeTransfers map. Active transfers remaining: ${activeTransfers.size}`,
      "INFO",
    );

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
      userCancelled: true, // 添加标志表明这是用户主动取消
    });

    // 清理待处理操作但不关闭SFTP会话
    if (
      sftpCore &&
      typeof sftpCore.clearPendingOperationsForTab === "function"
    ) {
      try {
        sftpCore.clearPendingOperationsForTab(tabId, { userCancelled: true });
        logToFile(
          `sftpTransfer: Cleared pending operations for tab ${tabId} after cancel`,
          "INFO",
        );
      } catch (clearError) {
        logToFile(
          `sftpTransfer: Error clearing pending operations: ${clearError.message}`,
          "WARN",
        );
      }
    }

    // 触发目录刷新以更新文件列表
    if (transfer.path) {
      try {
        // 异步获取当前目录的文件列表，使用setTimeout确保在当前事件循环后执行
        setTimeout(() => {
          sftpCore
            .enqueueSftpOperation(
              tabId,
              async () => {
                try {
                  logToFile(
                    `sftpTransfer: Refreshing directory listing for tab ${tabId} after cancel at path: ${transfer.path}`,
                    "INFO",
                  );
                  // 这里不需要直接返回结果，只需触发操作刷新会话
                  return { success: true, refreshed: true };
                } catch (refreshError) {
                  logToFile(
                    `sftpTransfer: Error refreshing directory after cancel: ${refreshError.message}`,
                    "WARN",
                  );
                  return { success: false, error: refreshError.message };
                }
              },
              {
                type: "readdir",
                path: transfer.path || ".",
                priority: "high",
                canMerge: true,
              },
            )
            .catch((err) => {
              logToFile(
                `sftpTransfer: Failed to enqueue refresh operation: ${err.message}`,
                "WARN",
              );
            });
        }, 500); // 延迟500ms，让取消操作完全处理后再刷新
      } catch (refreshError) {
        logToFile(
          `sftpTransfer: Error triggering refresh: ${refreshError.message}`,
          "WARN",
        );
      }
    }

    return { success: true, message: "传输已取消", userCancelled: true }; // 添加标志表明这是用户主动取消
  } catch (error) {
    logToFile(
      `sftpTransfer: Error cancelling transfer ${transferKey}: ${error.message}`,
      "ERROR",
    );

    // 即使出错也从活跃传输映射中删除
    activeTransfers.delete(transferKey);

    // 即使出错也尝试清理待处理操作
    if (
      sftpCore &&
      typeof sftpCore.clearPendingOperationsForTab === "function"
    ) {
      try {
        sftpCore.clearPendingOperationsForTab(tabId, { userCancelled: true });
      } catch (clearError) {
        logToFile(
          `sftpTransfer: Error clearing pending operations after cancel error: ${clearError.message}`,
          "ERROR",
        );
      }
    }

    return {
      success: false,
      error: `取消传输失败: ${error.message}`,
      userCancelled: true,
    }; // 添加标志表明这是用户主动取消
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
      logToFile(
        "sftpTransfer: Invalid tabId provided to cleanupActiveTransfersForTab",
        "WARN",
      );
      return { success: false, message: "无效的标签ID", cleanedCount: 0 };
    }

    logToFile(
      `sftpTransfer: Cleaning up all active transfers for tab ${tabId}`,
      "INFO",
    );

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
      logToFile(
        `sftpTransfer: Found active transfer ${transferKey} for tab ${tabId}, cleaning up`,
        "INFO",
      );
      const transfer = activeTransfers.get(transferKey);

      if (transfer && transfer.sftp) {
        logToFile(
          `sftpTransfer: SFTP connection for ${transferKey} is managed by sftpCore, no need to close it manually`,
          "INFO",
        );

        // 从活跃传输映射中删除
        activeTransfers.delete(transferKey);
        cleanedCount++;
      }
    }

    logToFile(
      `sftpTransfer: Cleaned up ${cleanedCount} active transfers for tab ${tabId}`,
      "INFO",
    );
    return {
      success: true,
      message: `已清理${cleanedCount}个活跃传输`,
      cleanedCount,
    };
  } catch (error) {
    logToFile(
      `sftpTransfer: Error in cleanupActiveTransfersForTab for ${tabId}: ${error.message}`,
      "ERROR",
    );
    return {
      success: false,
      message: `清理传输时发生错误: ${error.message}`,
      cleanedCount: 0,
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
  // 新增：断点续传相关功能
  getResumableTransfers: () => {
    if (!transferResumeManager) return [];
    return transferResumeManager.getResumableTransfers();
  },
  resumeTransfer: async (transferId) => {
    if (!transferResumeManager) {
      return { success: false, error: "断点续传管理器未初始化" };
    }
    const result = transferResumeManager.resumeTransfer(transferId);
    if (!result) {
      return { success: false, error: "传输不存在或无法恢复" };
    }
    return { success: true, transfer: result.transfer };
  },
  getTransferStatistics: () => {
    if (!transferResumeManager) return null;
    return transferResumeManager.getStatistics();
  },
};
