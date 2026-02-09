const sftpCore = require("../../transfer/sftp-engine"); // 已合并到sftp-engine
const sftpTransfer = require("../../../modules/sftp/sftpTransfer");
const { logToFile } = require("../../utils/logger");
const processManager = require("../../process/processManager");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { shell, dialog, BrowserWindow } = require("electron");

/**
 * 文件操作相关的IPC处理器
 */
class FileHandlers {
  constructor() {
    this.activeTransfers = new Map();
  }

  /**
   * 获取所有文件处理器
   */
  getHandlers() {
    return [
      {
        channel: "listFiles",
        category: "file",
        handler: this.listFiles.bind(this),
      },
      {
        channel: "copyFile",
        category: "file",
        handler: this.copyFile.bind(this),
      },
      {
        channel: "moveFile",
        category: "file",
        handler: this.moveFile.bind(this),
      },
      {
        channel: "deleteFile",
        category: "file",
        handler: this.deleteFile.bind(this),
      },
      {
        channel: "createFolder",
        category: "file",
        handler: this.createFolder.bind(this),
      },
      {
        channel: "createFile",
        category: "file",
        handler: this.createFile.bind(this),
      },
      {
        channel: "renameFile",
        category: "file",
        handler: this.renameFile.bind(this),
      },
      {
        channel: "downloadFile",
        category: "file",
        handler: this.downloadFile.bind(this),
      },
      {
        channel: "downloadFolder",
        category: "file",
        handler: this.downloadFolder.bind(this),
      },
      {
        channel: "getFilePermissions",
        category: "file",
        handler: this.getFilePermissions.bind(this),
      },
      {
        channel: "getAbsolutePath",
        category: "file",
        handler: this.getAbsolutePath.bind(this),
      },
      {
        channel: "checkPathExists",
        category: "file",
        handler: this.checkPathExists.bind(this),
      },
      {
        channel: "showItemInFolder",
        category: "file",
        handler: this.showItemInFolder.bind(this),
      },
      {
        channel: "cancelTransfer",
        category: "file",
        handler: this.cancelTransfer.bind(this),
      },
      {
        channel: "downloadFiles",
        category: "file",
        handler: this.downloadFiles.bind(this),
      },
      {
        channel: "setFilePermissions",
        category: "file",
        handler: this.setFilePermissions.bind(this),
      },
      {
        channel: "getFilePermissionsBatch",
        category: "file",
        handler: this.getFilePermissionsBatch.bind(this),
      },
      {
        channel: "setFileOwnership",
        category: "file",
        handler: this.setFileOwnership.bind(this),
      },
      {
        channel: "createRemoteFolders",
        category: "file",
        handler: this.createRemoteFolders.bind(this),
      },
      {
        channel: "uploadFile",
        category: "file",
        handler: this.uploadFile.bind(this),
      },
      {
        channel: "uploadDroppedFiles",
        category: "file",
        handler: this.uploadDroppedFiles.bind(this),
      },
      {
        channel: "upload-folder",
        category: "file",
        handler: this.uploadFolder.bind(this),
      },
    ];
  }

  // 实现各个处理器方法
  async listFiles(event, tabId, path, options = {}) {
    try {
      // 支持非阻塞/分片目录加载：
      // 立即返回 { chunked, token }，并通过 listFiles:chunk 增量推送 items
      if (options && options.nonBlocking) {
        const requestedPath = path;
        const chunkSize =
          typeof options.chunkSize === "number" && options.chunkSize > 0
            ? Math.floor(options.chunkSize)
            : 300;
        const token = `${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

        // Fire-and-forget chunk producer
        Promise.resolve()
          .then(async () => {
            const result = await sftpCore.listFiles(tabId, requestedPath, {
              ...options,
              nonBlocking: false, // avoid nested nonBlocking semantics in lower layers
            });

            const send = (payload) => {
              try {
                if (event && event.sender && !event.sender.isDestroyed()) {
                  event.sender.send("listFiles:chunk", payload);
                }
              } catch {
                // ignore send errors (window may be gone)
              }
            };

            if (!result || result.success === false) {
              send({
                tabId,
                path: requestedPath,
                token,
                items: [],
                done: true,
                error: result?.error || "listFiles failed",
              });
              return;
            }

            const data = Array.isArray(result.data) ? result.data : [];
            for (let i = 0; i < data.length; i += chunkSize) {
              const items = data.slice(i, i + chunkSize);
              const done = i + chunkSize >= data.length;
              send({ tabId, path: requestedPath, token, items, done });
            }

            // Ensure done signal even for empty directories
            if (data.length === 0) {
              send({ tabId, path: requestedPath, token, items: [], done: true });
            }
          })
          .catch((err) => {
            try {
              if (event && event.sender && !event.sender.isDestroyed()) {
                event.sender.send("listFiles:chunk", {
                  tabId,
                  path: requestedPath,
                  token,
                  items: [],
                  done: true,
                  error: err?.message || String(err),
                });
              }
            } catch { /* intentionally ignored */ }
          });

        return { success: true, data: [], chunked: true, token };
      }

      const result = await sftpCore.listFiles(tabId, path, options);
      return result;
    } catch (error) {
      logToFile(`Error listing files: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async copyFile(event, tabId, sourcePath, targetPath) {
    try {
      const result = await sftpCore.copyFile(tabId, sourcePath, targetPath);
      return result;
    } catch (error) {
      logToFile(`Error copying file: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async moveFile(event, tabId, sourcePath, targetPath) {
    // 校验: 路径非空
    if (!sourcePath || !targetPath) {
      logToFile(
        `[Move Check Failed] Invalid paths. Source: ${sourcePath}, Target: ${targetPath} (Tab: ${tabId})`,
        "WARN"
      );
      return { success: false, error: "Invalid source or target path" };
    }

    // 校验: 根目录保护
    if (sourcePath.trim() === "/" || sourcePath.trim() === "\\") {
      logToFile(
        `[Move Check Failed] Attempt to move root directory (Tab: ${tabId})`,
        "WARN"
      );
      return { success: false, error: "Cannot move root directory" };
    }

    logToFile(
      `[Sensitive Operation] moveFile triggered. TabId: ${tabId}, Source: ${sourcePath}, Target: ${targetPath}, Source: IPC`,
      "INFO"
    );

    try {
      if (typeof sftpCore.moveFile === "function") {
        const result = await sftpCore.moveFile(tabId, sourcePath, targetPath);
        return result;
      }

      // Fallback implementation
      return await sftpCore.enqueueSftpOperation(tabId, async () => {
        const sftp = await sftpCore.getSftpSession(tabId);
        return new Promise((resolve, reject) => {
          sftp.rename(sourcePath, targetPath, (err) => {
            if (err) reject(err);
            else resolve({ success: true });
          });
        });
      });
    } catch (error) {
      logToFile(`Error moving file: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async deleteFile(event, tabId, filePath, isDirectory) {
    // 校验: 路径非空
    if (!filePath || typeof filePath !== "string") {
      logToFile(
        `[Delete Check Failed] Invalid path: ${filePath} (Tab: ${tabId})`,
        "WARN"
      );
      return { success: false, error: "Invalid file path" };
    }

    // 校验: 根目录保护
    if (filePath.trim() === "/" || filePath.trim() === "\\") {
      logToFile(
        `[Delete Check Failed] Attempt to delete root: ${filePath} (Tab: ${tabId})`,
        "WARN"
      );
      return { success: false, error: "Cannot delete root directory" };
    }

    logToFile(
      `[Sensitive Operation] deleteFile triggered. TabId: ${tabId}, Path: ${filePath}, IsDir: ${isDirectory}, Source: IPC`,
      "INFO"
    );

    try {
      if (typeof sftpCore.deleteFile === "function") {
        const result = await sftpCore.deleteFile(tabId, filePath, isDirectory);
        return result;
      }

      // Fallback implementation
      return await sftpCore.enqueueSftpOperation(tabId, async () => {
        const sftp = await sftpCore.getSftpSession(tabId);
        return new Promise((resolve, reject) => {
          const cb = (err) => {
            if (err) reject(err);
            else resolve({ success: true });
          };
          if (isDirectory) {
            sftp.rmdir(filePath, cb);
          } else {
            sftp.unlink(filePath, cb);
          }
        });
      });
    } catch (error) {
      logToFile(`Error deleting file: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async createFolder(event, tabId, folderPath) {
    try {
      const result = await sftpCore.createFolder(tabId, folderPath);
      return result;
    } catch (error) {
      logToFile(`Error creating folder: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async createFile(event, tabId, filePath) {
    try {
      const result = await sftpCore.createFile(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error creating file: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async renameFile(event, tabId, oldPath, newName) {
    // 校验
    if (!oldPath || !newName) {
      logToFile(
        `[Rename Check Failed] Invalid params. Old: ${oldPath}, New: ${newName} (Tab: ${tabId})`,
        "WARN"
      );
      return { success: false, error: "Invalid old path or new name" };
    }
    if (oldPath.trim() === "/" || oldPath.trim() === "\\") {
      logToFile(
        `[Rename Check Failed] Attempt to rename root (Tab: ${tabId})`,
        "WARN"
      );
      return { success: false, error: "Cannot rename root directory" };
    }

    const newPath = path.posix.join(path.posix.dirname(oldPath), newName);
    logToFile(
      `[Sensitive Operation] renameFile triggered. TabId: ${tabId}, Old: ${oldPath}, New: ${newPath}, Source: IPC`,
      "INFO"
    );

    try {
      if (typeof sftpCore.renameFile === "function") {
        const result = await sftpCore.renameFile(tabId, oldPath, newPath);
        return result;
      }

      // Fallback implementation
      return await sftpCore.enqueueSftpOperation(tabId, async () => {
        const sftp = await sftpCore.getSftpSession(tabId);
        return new Promise((resolve, reject) => {
          sftp.rename(oldPath, newPath, (err) => {
            if (err) reject(err);
            else resolve({ success: true });
          });
        });
      });
    } catch (error) {
      logToFile(`Error renaming file: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async downloadFile(event, tabId, remotePath) {
    try {
      const result = await sftpTransfer.downloadFile(tabId, remotePath);
      if (result.success) {
        this.activeTransfers.set(`${tabId}-${remotePath}`, result.transferKey);
      }
      return result;
    } catch (error) {
      logToFile(`Error downloading file: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async downloadFolder(event, tabId, remotePath) {
    try {
      const result = await sftpTransfer.downloadFolder(tabId, remotePath);
      return result;
    } catch (error) {
      logToFile(`Error downloading folder: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getFilePermissions(event, tabId, filePath) {
    try {
      const result = await sftpCore.getFilePermissions(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error getting file permissions: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getAbsolutePath(event, tabId, relativePath) {
    try {
      const result = await sftpCore.getAbsolutePath(tabId, relativePath);
      return result;
    } catch (error) {
      logToFile(`Error getting absolute path: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async checkPathExists(event, checkPath) {
    try {
      const exists = fs.existsSync(checkPath);
      return { success: true, exists };
    } catch (error) {
      logToFile(`Error checking path: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async showItemInFolder(event, itemPath) {
    try {
      shell.showItemInFolder(itemPath);
      return { success: true };
    } catch (error) {
      logToFile(`Error showing item in folder: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async cancelTransfer(event, tabId, transferKey) {
    try {
      // NOTE: sftpTransfer.cancelTransfer uses strict signature (tabId, transferKey).
      const result = await sftpTransfer.cancelTransfer(tabId, transferKey);

      // Clean up any local bookkeeping that maps to this transferKey (if present).
      for (const [k, v] of this.activeTransfers.entries()) {
        if (v === transferKey) {
          this.activeTransfers.delete(k);
        }
      }
      return result;
    } catch (error) {
      logToFile(`Error canceling transfer: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async downloadFiles(event, tabId, files) {
    if (!sftpTransfer || typeof sftpTransfer.handleDownloadFiles !== "function") {
      logToFile("sftpTransfer.handleDownloadFiles is not available", "ERROR");
      return { success: false, error: "SFTP Batch Download feature not properly initialized." };
    }
    return sftpTransfer.handleDownloadFiles(event, tabId, files);
  }

  async setFilePermissions(event, tabId, filePath, permissions) {
    try {
      const permissionStr = String(permissions || "").trim();
      const mode = parseInt(permissionStr, 8);
      if (!permissionStr || Number.isNaN(mode)) {
        return { success: false, error: "无效的权限值" };
      }

      return sftpCore.enqueueSftpOperation(tabId, async () => {
        const sftp = await sftpCore.getSftpSession(tabId);
        return new Promise((resolve) => {
          sftp.chmod(filePath, mode, (err) => {
            if (err) {
              logToFile(`Failed to set file permissions: ${err.message}`, "ERROR");
              resolve({ success: false, error: `设置权限失败: ${err.message}` });
            } else {
              resolve({ success: true });
            }
          });
        });
      });
    } catch (error) {
      logToFile(`Set file permissions error: ${error.message}`, "ERROR");
      return { success: false, error: `设置权限失败: ${error.message}` };
    }
  }

  async getFilePermissionsBatch(event, tabId, filePaths) {
    try {
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return { success: true, results: [] };
      }
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        const sftp = await sftpCore.getSftpSession(tabId);
        const results = [];
        const BATCH_CONCURRENCY = 10;
        const chunks = [];
        for (let i = 0; i < filePaths.length; i += BATCH_CONCURRENCY) {
          chunks.push(filePaths.slice(i, i + BATCH_CONCURRENCY));
        }
        for (const chunk of chunks) {
          const chunkPromises = chunk.map((filePath) =>
            new Promise((resolve) => {
              sftp.stat(filePath, (err, stats) => {
                if (err) {
                  resolve({ path: filePath, success: false, error: err.message });
                } else {
                  const mode = stats.mode;
                  const permissions = (mode & parseInt("777", 8)).toString(8);
                  resolve({ path: filePath, success: true, permissions: permissions.padStart(3, "0"), mode, stats });
                }
              });
            })
          );
          const chunkResults = await Promise.all(chunkPromises);
          results.push(...chunkResults);
        }
        return { success: true, results };
      });
    } catch (error) {
      logToFile(`Batch get file permissions error: ${error.message}`, "ERROR");
      return { success: false, error: `批量获取权限失败: ${error.message}` };
    }
  }

  async setFileOwnership(event, tabId, filePath, owner, group) {
    try {
      const ownerStr = String(owner ?? "").trim();
      const groupStr = String(group ?? "").trim();
      if (!ownerStr && !groupStr) return { success: true };

      const ownerId =
        ownerStr && /^\d+$/.test(ownerStr) ? parseInt(ownerStr, 10) : null;
      const groupId =
        groupStr && /^\d+$/.test(groupStr) ? parseInt(groupStr, 10) : null;

      if (ownerStr && ownerId === null) {
        return { success: false, error: "所有者必须是数字UID" };
      }
      if (groupStr && groupId === null) {
        return { success: false, error: "组必须是数字GID" };
      }

      return sftpCore.enqueueSftpOperation(tabId, async () => {
        const sftp = await sftpCore.getSftpSession(tabId);
        return new Promise((resolve) => {
          const applyChown = (uid, gid) => {
            sftp.chown(filePath, uid, gid, (err) => {
              if (err) {
                return resolve({
                  success: false,
                  error: `设置所有者/组失败: ${err.message}`,
                });
              }
              resolve({ success: true });
            });
          };

          if (ownerId !== null && groupId !== null) {
            applyChown(ownerId, groupId);
            return;
          }

          sftp.stat(filePath, (statErr, stats) => {
            if (statErr) {
              return resolve({
                success: false,
                error: `获取现有所有者/组失败: ${statErr.message}`,
              });
            }
            const uid = ownerId !== null ? ownerId : stats.uid;
            const gid = groupId !== null ? groupId : stats.gid;
            applyChown(uid, gid);
          });
        });
      });
    } catch (error) {
      logToFile(`Set file ownership error: ${error.message}`, "ERROR");
      return { success: false, error: `设置所有者/组失败: ${error.message}` };
    }
  }

  async createRemoteFolders(event, tabId, folderPath) {
    try {
      const processInfo = processManager.getProcess(tabId);
      if (!processInfo || !processInfo.config || processInfo.type !== "ssh2") {
        return { success: false, error: "Invalid SSH connection" };
      }
      const sftp = await sftpCore.getSftpSession(tabId);
      const createDirRecursive = async (dirPath) => {
        const parts = dirPath.split("/").filter(Boolean);
        let currentPath = dirPath.startsWith("/") ? "/" : "";
        for (const part of parts) {
          currentPath = path.posix.join(currentPath, part);
          try {
            await new Promise((resolve, reject) => {
              sftp.stat(currentPath, (err, stats) => {
                if (err) {
                  if (err.code === 2) {
                    sftp.mkdir(currentPath, (mkdirErr) => {
                      if (mkdirErr && mkdirErr.code !== 4) reject(mkdirErr);
                      else resolve();
                    });
                  } else reject(err);
                } else if (stats.isDirectory()) resolve();
                else reject(new Error(`Path exists but is not a directory: ${currentPath}`));
              });
            });
          } catch (error) {
            logToFile(`Warning creating folder ${currentPath}: ${error.message}`, "WARN");
          }
        }
      };
      await createDirRecursive(folderPath);
      return { success: true };
    } catch (error) {
      logToFile(`Error creating remote folders: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async uploadFile(event, tabId, targetFolder, progressChannel) {
    if (!sftpTransfer || typeof sftpTransfer.handleUploadFile !== "function") {
      return { success: false, error: "SFTP Upload feature not properly initialized." };
    }
    const processInfo = processManager.getProcess(tabId);
    if (!processInfo || !processInfo.config || !processInfo.process || processInfo.type !== "ssh2") {
      return { success: false, error: "无效或未就绪的SSH连接" };
    }
    const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!mainWindow) return { success: false, error: "无法显示对话框" };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "选择要上传的文件",
      properties: ["openFile", "multiSelections"],
      buttonLabel: "上传文件",
    });
    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, cancelled: true, error: "用户取消上传" };
    }
    try {
      return await sftpTransfer.handleUploadFile(event, tabId, targetFolder, filePaths, progressChannel);
    } catch (error) {
      const isCancelError = error.message?.includes("cancel") || error.message?.includes("abort") || error.message?.includes("用户取消");
      if (isCancelError) {
        return { success: true, cancelled: true, userCancelled: true, message: "用户已取消操作" };
      }
      return { success: false, error: `上传文件失败: ${error.message}` };
    }
  }

  async uploadDroppedFiles(event, tabId, targetFolder, uploadData, progressChannel) {
    if (!sftpTransfer || typeof sftpTransfer.handleUploadFile !== "function") {
      return { success: false, error: "SFTP Upload feature not properly initialized." };
    }
    const processInfo = processManager.getProcess(tabId);
    if (!processInfo || !processInfo.config || !processInfo.process || processInfo.type !== "ssh2") {
      return { success: false, error: "无效或未就绪的SSH连接" };
    }
    try {
      const tempDir = os.tmpdir();
      if (uploadData.folders && uploadData.folders.length > 0) {
        const sftp = await sftpCore.getSftpSession(tabId);
        for (const folderPath of uploadData.folders) {
          const remoteFolderPath = path.posix.join(targetFolder, folderPath).replace(/\\/g, "/");
          try {
            await new Promise((resolve) => {
              sftp.mkdir(remoteFolderPath, (err) => {
                if (err && err.code !== 4 && !err.message.includes("File exists")) {
                  logToFile(`Error creating folder ${remoteFolderPath}: ${err.message}`, "WARN");
                }
                resolve();
              });
            });
          } catch (folderError) {
            logToFile(`Error creating folder ${remoteFolderPath}: ${folderError.message}`, "WARN");
          }
        }
      }
      const filePaths = [];
      const filesData = uploadData.files || uploadData;
      for (const fileData of filesData) {
        if (fileData) {
          const relativePath = fileData.relativePath || fileData.name;
          const tempFilePath = path.join(tempDir, "simpleshell-upload", relativePath);
          const tempFileDir = path.dirname(tempFilePath);
          if (!fs.existsSync(tempFileDir)) fs.mkdirSync(tempFileDir, { recursive: true });
          let buffer;
          if (fileData.chunks && fileData.isChunked) {
            const totalLength = fileData.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            buffer = Buffer.alloc(totalLength);
            let offset = 0;
            for (const chunk of fileData.chunks) {
              const chunkBuffer = Buffer.from(chunk);
              chunkBuffer.copy(buffer, offset);
              offset += chunkBuffer.length;
            }
          } else if (fileData.chunks && fileData.chunks.length === 1) {
            buffer = Buffer.from(fileData.chunks[0]);
          } else if (fileData.data) {
            buffer = Buffer.from(fileData.data);
          } else continue;
          fs.writeFileSync(tempFilePath, buffer);
          if (fileData.relativePath && fileData.relativePath.includes("/")) {
            const remoteFilePath = path.posix.join(targetFolder, fileData.relativePath).replace(/\\/g, "/");
            filePaths.push({ localPath: tempFilePath, remotePath: remoteFilePath });
          } else {
            filePaths.push(tempFilePath);
          }
        }
      }
      if (filePaths.length === 0) return { success: false, error: "没有有效的文件可上传" };
      const hasCustomPaths = filePaths.some((f) => typeof f === "object");
      let result;
      if (hasCustomPaths) {
        let uploadedCount = 0, failedCount = 0;
        for (const fileInfo of filePaths) {
          const localPath = typeof fileInfo === "string" ? fileInfo : fileInfo.localPath;
          const remotePath = typeof fileInfo === "string"
            ? path.posix.join(targetFolder, path.basename(fileInfo)).replace(/\\/g, "/")
            : fileInfo.remotePath;
          const remoteDir = path.posix.dirname(remotePath);
          const singleResult = await sftpTransfer.handleUploadFile(event, tabId, remoteDir, [localPath], progressChannel);
          if (singleResult.success) uploadedCount++;
          else failedCount++;
        }
        result = { success: failedCount === 0, uploadedCount, totalFiles: filePaths.length, failedCount };
      } else {
        const uploadPaths = filePaths.map((f) => typeof f === "string" ? f : f.localPath);
        result = await sftpTransfer.handleUploadFile(event, tabId, targetFolder, uploadPaths, progressChannel);
      }
      try {
        const tempUploadDir = path.join(tempDir, "simpleshell-upload");
        if (fs.existsSync(tempUploadDir)) fs.rmSync(tempUploadDir, { recursive: true, force: true });
      } catch (cleanupError) {
        logToFile(`Error cleaning up temp files: ${cleanupError.message}`, "WARN");
      }
      return result;
    } catch (error) {
      const isCancelError = error.message?.includes("cancel") || error.message?.includes("abort") || error.message?.includes("用户取消");
      if (isCancelError) {
        return { success: true, cancelled: true, userCancelled: true, message: "用户已取消操作" };
      }
      return { success: false, error: `上传文件失败: ${error.message}` };
    }
  }

  async uploadFolder(event, tabId, targetFolder, progressChannel) {
    if (!sftpTransfer || typeof sftpTransfer.handleUploadFolder !== "function") {
      return { success: false, error: "SFTP Upload feature not properly initialized." };
    }
    const processInfo = processManager.getProcess(tabId);
    if (!processInfo || !processInfo.config || !processInfo.process || processInfo.type !== "ssh2") {
      return { success: false, error: "无效或未就绪的SSH连接" };
    }
    const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!mainWindow) return { success: false, error: "无法显示对话框" };
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: "选择要上传的文件夹",
      properties: ["openDirectory"],
      buttonLabel: "上传文件夹",
    });
    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, cancelled: true, error: "用户取消上传" };
    }
    try {
      return await sftpTransfer.handleUploadFolder(tabId, filePaths[0], targetFolder, progressChannel);
    } catch (error) {
      const isCancelError = error.message?.includes("cancel") || error.message?.includes("abort") || error.message?.includes("用户取消");
      if (isCancelError) {
        return { success: true, cancelled: true, userCancelled: true, message: "用户已取消操作" };
      }
      return { success: false, error: `上传文件夹失败: ${error.message}` };
    }
  }

  /**
   * 清理所有活跃的传输
   */
  cleanup() {
    for (const [key, transferKey] of this.activeTransfers) {
      try {
        // Back-compat: cancelTransfer can take only transferKey, but we also try to pass tabId when we can.
        const tabId = String(key).split("-")[0];
        sftpTransfer.cancelTransfer(tabId, transferKey);
      } catch (error) {
        logToFile(
          `Error cleaning up transfer ${key}: ${error.message}`,
          "ERROR",
        );
      }
    }

    this.activeTransfers.clear();
    logToFile("All file transfers cleaned up", "INFO");
  }
}

module.exports = FileHandlers;
