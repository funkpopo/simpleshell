const filemanagementService = require("../../../modules/filemanagement/filemanagementService");
const nativeSftpClient = require("../../utils/nativeSftpClient");
const { logToFile } = require("../../utils/logger");
const processManager = require("../../process/processManager");
const path = require("path");
const fs = require("fs");
const { shell } = require("electron");

/**
 * 文件操作相关的IPC处理器
 */
class FileHandlers {
  constructor() {
    this.activeTransfers = new Map();
    this.activeDirectoryReads = new Map();
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
        channel: "cancelListFiles",
        category: "file",
        handler: this.cancelListFiles.bind(this),
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

  _removeActiveDirectoryRead(token) {
    if (!token) return;
    this.activeDirectoryReads.delete(String(token));
  }

  _cancelActiveDirectoryRead(token) {
    const entry = this.activeDirectoryReads.get(String(token));
    if (!entry) {
      return false;
    }

    this._removeActiveDirectoryRead(token);

    try {
      if (entry.child && !entry.child.killed) {
        entry.child.kill();
      }
    } catch {
      // ignore process kill failures
    }

    return true;
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
            const result = await nativeSftpClient.listFiles(tabId, requestedPath, {
              onSpawn: (child) => {
                this.activeDirectoryReads.set(token, {
                  tabId: String(tabId),
                  token,
                  child,
                });
              },
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
              send({
                tabId,
                path: requestedPath,
                token,
                items: [],
                done: true,
              });
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
            } catch {
              /* intentionally ignored */
            }
          })
          .finally(() => {
            this._removeActiveDirectoryRead(token);
          });

        return { success: true, data: [], chunked: true, token };
      }

      const result = await nativeSftpClient.listFiles(tabId, path);
      return result;
    } catch (error) {
      logToFile(`Error listing files: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async copyFile(event, tabId, sourcePath, targetPath) {
    try {
      const result = await nativeSftpClient.copyFile(tabId, sourcePath, targetPath);
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
        "WARN",
      );
      return { success: false, error: "Invalid source or target path" };
    }

    // 校验: 根目录保护
    if (sourcePath.trim() === "/" || sourcePath.trim() === "\\") {
      logToFile(
        `[Move Check Failed] Attempt to move root directory (Tab: ${tabId})`,
        "WARN",
      );
      return { success: false, error: "Cannot move root directory" };
    }

    logToFile(
      `[Sensitive Operation] moveFile triggered. TabId: ${tabId}, Source: ${sourcePath}, Target: ${targetPath}, Source: IPC`,
      "INFO",
    );

    try {
      return await nativeSftpClient.moveFile(tabId, sourcePath, targetPath);
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
        "WARN",
      );
      return { success: false, error: "Invalid file path" };
    }

    // 校验: 根目录保护
    if (filePath.trim() === "/" || filePath.trim() === "\\") {
      logToFile(
        `[Delete Check Failed] Attempt to delete root: ${filePath} (Tab: ${tabId})`,
        "WARN",
      );
      return { success: false, error: "Cannot delete root directory" };
    }

    logToFile(
      `[Sensitive Operation] deleteFile triggered. TabId: ${tabId}, Path: ${filePath}, IsDir: ${isDirectory}, Source: IPC`,
      "INFO",
    );

    try {
      return await nativeSftpClient.deleteFile(tabId, filePath, isDirectory);
    } catch (error) {
      logToFile(`Error deleting file: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async createFolder(event, tabId, folderPath) {
    try {
      const result = await nativeSftpClient.createFolder(tabId, folderPath);
      return result;
    } catch (error) {
      logToFile(`Error creating folder: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async createFile(event, tabId, filePath) {
    try {
      const result = await nativeSftpClient.createFile(tabId, filePath);
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
        "WARN",
      );
      return { success: false, error: "Invalid old path or new name" };
    }
    if (oldPath.trim() === "/" || oldPath.trim() === "\\") {
      logToFile(
        `[Rename Check Failed] Attempt to rename root (Tab: ${tabId})`,
        "WARN",
      );
      return { success: false, error: "Cannot rename root directory" };
    }

    const newPath = path.posix.join(path.posix.dirname(oldPath), newName);
    logToFile(
      `[Sensitive Operation] renameFile triggered. TabId: ${tabId}, Old: ${oldPath}, New: ${newPath}, Source: IPC`,
      "INFO",
    );

    try {
      return await nativeSftpClient.renameFile(tabId, oldPath, newPath);
    } catch (error) {
      logToFile(`Error renaming file: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async downloadFile(event, tabId, remotePath) {
    try {
      const result = await filemanagementService.downloadFile(
        event,
        tabId,
        remotePath,
      );
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
      const result = await filemanagementService.downloadFolder(
        event,
        tabId,
        remotePath,
      );
      return result;
    } catch (error) {
      logToFile(`Error downloading folder: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getFilePermissions(event, tabId, filePath) {
    try {
      const result = await nativeSftpClient.getFilePermissions(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error getting file permissions: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getAbsolutePath(event, tabId, relativePath) {
    try {
      const result = await nativeSftpClient.getAbsolutePath(tabId, relativePath);
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
      if (
        filemanagementService &&
        typeof filemanagementService.cancelTransfer === "function"
      ) {
        const nextResult = await filemanagementService.cancelTransfer(
          event,
          tabId,
          transferKey,
        );

        if (nextResult?.success || nextResult?.cancelled) {
          for (const [k, v] of this.activeTransfers.entries()) {
            if (v === transferKey) {
              this.activeTransfers.delete(k);
            }
          }
          return nextResult;
        }
      }

      const result = await filemanagementService.cancelTransfer(
        event,
        tabId,
        transferKey,
      );

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

  async cancelListFiles(event, tabId, token = null) {
    try {
      const normalizedTabId = String(tabId ?? "");
      if (!normalizedTabId) {
        return { success: false, error: "tabId is required" };
      }

      if (token) {
        const entry = this.activeDirectoryReads.get(String(token));
        if (!entry || entry.tabId !== normalizedTabId) {
          return { success: true, cancelledCount: 0 };
        }

        return {
          success: true,
          cancelledCount: this._cancelActiveDirectoryRead(token) ? 1 : 0,
        };
      }

      let cancelledCount = 0;
      for (const [activeToken, entry] of this.activeDirectoryReads.entries()) {
        if (entry.tabId !== normalizedTabId) continue;
        if (this._cancelActiveDirectoryRead(activeToken)) {
          cancelledCount += 1;
        }
      }

      return { success: true, cancelledCount };
    } catch (error) {
      logToFile(`Error cancelling listFiles: ${error.message}`, "WARN");
      return { success: false, error: error.message };
    }
  }

  async downloadFiles(event, tabId, files) {
    return filemanagementService.downloadFiles(event, tabId, files);
  }

  async setFilePermissions(event, tabId, filePath, permissions) {
    try {
      return await nativeSftpClient.setFilePermissions(
        tabId,
        filePath,
        permissions,
      );
    } catch (error) {
      logToFile(`Set file permissions error: ${error.message}`, "ERROR");
      return { success: false, error: `设置权限失败: ${error.message}` };
    }
  }

  async getFilePermissionsBatch(event, tabId, filePaths) {
    try {
      return await nativeSftpClient.getFilePermissionsBatch(tabId, filePaths);
    } catch (error) {
      logToFile(`Batch get file permissions error: ${error.message}`, "ERROR");
      return { success: false, error: `批量获取权限失败: ${error.message}` };
    }
  }

  async setFileOwnership(event, tabId, filePath, owner, group) {
    try {
      return await nativeSftpClient.setFileOwnership(
        tabId,
        filePath,
        owner,
        group,
      );
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
      return await nativeSftpClient.createRemoteFolders(tabId, folderPath);
    } catch (error) {
      logToFile(`Error creating remote folders: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async uploadFile(event, tabId, targetFolder, progressChannel) {
    if (
      !filemanagementService ||
      typeof filemanagementService.uploadFile !== "function"
    ) {
      return {
        success: false,
        error: "SFTP Upload feature not properly initialized.",
      };
    }
    const processInfo = processManager.getProcess(tabId);
    if (
      !processInfo ||
      !processInfo.config ||
      !processInfo.process ||
      processInfo.type !== "ssh2"
    ) {
      return { success: false, error: "无效或未就绪的SSH连接" };
    }
    try {
      return await filemanagementService.uploadFile(
        event,
        tabId,
        targetFolder,
        progressChannel,
      );
    } catch (error) {
      const isCancelError =
        error.message?.includes("cancel") ||
        error.message?.includes("abort") ||
        error.message?.includes("用户取消");
      if (isCancelError) {
        return {
          success: true,
          cancelled: true,
          userCancelled: true,
          message: "用户已取消操作",
        };
      }
      return { success: false, error: `上传文件失败: ${error.message}` };
    }
  }

  async uploadDroppedFiles(
    event,
    tabId,
    targetFolder,
    uploadData,
    progressChannel,
  ) {
    if (
      !filemanagementService ||
      typeof filemanagementService.uploadDroppedFiles !== "function"
    ) {
      return {
        success: false,
        error: "SFTP Upload feature not properly initialized.",
      };
    }
    const processInfo = processManager.getProcess(tabId);
    if (
      !processInfo ||
      !processInfo.config ||
      !processInfo.process ||
      processInfo.type !== "ssh2"
    ) {
      return { success: false, error: "无效或未就绪的SSH连接" };
    }
    try {
      return await filemanagementService.uploadDroppedFiles(
        event,
        tabId,
        targetFolder,
        uploadData,
        progressChannel,
      );
    } catch (error) {
      const isCancelError =
        error.message?.includes("cancel") ||
        error.message?.includes("abort") ||
        error.message?.includes("用户取消");
      if (isCancelError) {
        return {
          success: true,
          cancelled: true,
          userCancelled: true,
          message: "用户已取消操作",
        };
      }
      return { success: false, error: `上传文件失败: ${error.message}` };
    }
  }

  async uploadFolder(event, tabId, targetFolder, progressChannel) {
    if (
      !filemanagementService ||
      typeof filemanagementService.uploadFolder !== "function"
    ) {
      return {
        success: false,
        error: "SFTP Upload feature not properly initialized.",
      };
    }
    const processInfo = processManager.getProcess(tabId);
    if (
      !processInfo ||
      !processInfo.config ||
      !processInfo.process ||
      processInfo.type !== "ssh2"
    ) {
      return { success: false, error: "无效或未就绪的SSH连接" };
    }
    try {
      return await filemanagementService.uploadFolder(
        event,
        tabId,
        targetFolder,
        progressChannel,
      );
    } catch (error) {
      const isCancelError =
        error.message?.includes("cancel") ||
        error.message?.includes("abort") ||
        error.message?.includes("用户取消");
      if (isCancelError) {
        return {
          success: true,
          cancelled: true,
          userCancelled: true,
          message: "用户已取消操作",
        };
      }
      return { success: false, error: `上传文件夹失败: ${error.message}` };
    }
  }

  /**
   * 清理所有活跃的传输
   */
  cleanup() {
    for (const token of Array.from(this.activeDirectoryReads.keys())) {
      this._cancelActiveDirectoryRead(token);
    }

    for (const [key, transferKey] of this.activeTransfers) {
      try {
        const tabId = String(key).split("-")[0];
        filemanagementService.cancelTransfer(null, tabId, transferKey);
      } catch (error) {
        logToFile(
          `Error cleaning up transfer ${key}: ${error.message}`,
          "ERROR",
        );
      }
    }

    this.activeTransfers.clear();
    if (
      filemanagementService &&
      typeof filemanagementService.cleanup === "function"
    ) {
      filemanagementService.cleanup();
    }
    logToFile("All file transfers cleaned up", "INFO");
  }
}

module.exports = FileHandlers;
