const sftpCore = require("../../transfer/sftp-engine"); // 已合并到sftp-engine
const sftpTransfer = require("../../../modules/sftp/sftpTransfer");
const fileCache = require("../../utils/fileCache");
const { logToFile } = require("../../utils/logger");
const path = require("path");
const fs = require("fs");
const { shell } = require("electron");

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
        channel: "readFileContent",
        category: "file",
        handler: this.readFileContent.bind(this),
      },
      {
        channel: "readFileAsBase64",
        category: "file",
        handler: this.readFileAsBase64.bind(this),
      },
      {
        channel: "saveFileContent",
        category: "file",
        handler: this.saveFileContent.bind(this),
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
        channel: "getSftpSession",
        category: "file",
        handler: this.getSftpSession.bind(this),
      },
      {
        channel: "enqueueSftpOperation",
        category: "file",
        handler: this.enqueueSftpOperation.bind(this),
      },
      {
        channel: "processSftpQueue",
        category: "file",
        handler: this.processSftpQueue.bind(this),
      },
      {
        channel: "cleanupFileCache",
        category: "file",
        handler: this.cleanupFileCache.bind(this),
      },
      {
        channel: "cleanupTabCache",
        category: "file",
        handler: this.cleanupTabCache.bind(this),
      },
    ];
  }

  // 实现各个处理器方法
  async listFiles(event, tabId, path, options = {}) {
    try {
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

    const newPath = path.join(path.dirname(oldPath), newName);
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

  async readFileContent(event, tabId, filePath) {
    try {
      const result = await sftpCore.readFileContent(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error reading file content: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async readFileAsBase64(event, tabId, filePath) {
    try {
      const result = await sftpCore.readFileAsBase64(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error reading file as base64: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async saveFileContent(event, tabId, filePath, content) {
    try {
      const result = await sftpCore.saveFileContent(tabId, filePath, content);
      return result;
    } catch (error) {
      logToFile(`Error saving file content: ${error.message}`, "ERROR");
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
      const result = await sftpTransfer.cancelTransfer(transferKey);
      this.activeTransfers.delete(`${tabId}-${transferKey}`);
      return result;
    } catch (error) {
      logToFile(`Error canceling transfer: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getSftpSession(event, tabId) {
    try {
      const session = await sftpCore.getSftpSession(tabId);
      return { success: true, session };
    } catch (error) {
      logToFile(`Error getting SFTP session: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async enqueueSftpOperation(event, tabId, operation) {
    try {
      const result = await sftpCore.enqueueSftpOperation(tabId, operation);
      return result;
    } catch (error) {
      logToFile(`Error enqueueing SFTP operation: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async processSftpQueue(event, tabId) {
    try {
      const result = await sftpCore.processSftpQueue(tabId);
      return result;
    } catch (error) {
      logToFile(`Error processing SFTP queue: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async cleanupFileCache(event, cacheFilePath) {
    try {
      await fileCache.cleanup(cacheFilePath);
      return { success: true };
    } catch (error) {
      logToFile(`Error cleaning up file cache: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async cleanupTabCache(event, tabId) {
    try {
      await fileCache.cleanupTabFiles(tabId);
      return { success: true };
    } catch (error) {
      logToFile(`Error cleaning up tab cache: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  /**
   * 清理所有活跃的传输
   */
  cleanup() {
    for (const [key, transferKey] of this.activeTransfers) {
      try {
        sftpTransfer.cancelTransfer(transferKey);
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
