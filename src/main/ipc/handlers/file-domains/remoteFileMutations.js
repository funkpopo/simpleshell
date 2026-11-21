/** Remote SFTP file mutations, permission updates, and local path checks. */
function createRemoteFileMutationMethods({
  fs,
  path,
  shell,
  nativeSftpClient,
  processManager,
  logToFile,
}) {
  return {
    async copyFile(event, tabId, sourcePath, targetPath) {
      return nativeSftpClient.copyFile(tabId, sourcePath, targetPath);
    },

    async moveFile(event, tabId, sourcePath, targetPath) {
      // 校验: 路径非空
      if (!sourcePath || !targetPath) {
        logToFile(
          `[Move Check Failed] Invalid paths. Source: ${sourcePath}, Target: ${targetPath} (Tab: ${tabId})`,
          "WARN",
        );
        throw new Error("Invalid source or target path");
      }

      // 校验: 根目录保护
      if (sourcePath.trim() === "/" || sourcePath.trim() === "\\") {
        logToFile(
          `[Move Check Failed] Attempt to move root directory (Tab: ${tabId})`,
          "WARN",
        );
        throw new Error("Cannot move root directory");
      }

      logToFile(
        `[Sensitive Operation] moveFile triggered. TabId: ${tabId}, Source: ${sourcePath}, Target: ${targetPath}, Source: IPC`,
        "INFO",
      );

      return nativeSftpClient.moveFile(tabId, sourcePath, targetPath);
    },

    async deleteFile(event, tabId, filePath, isDirectory) {
      // 校验: 路径非空
      if (!filePath || typeof filePath !== "string") {
        logToFile(
          `[Delete Check Failed] Invalid path: ${filePath} (Tab: ${tabId})`,
          "WARN",
        );
        throw new Error("Invalid file path");
      }

      // 校验: 根目录保护
      if (filePath.trim() === "/" || filePath.trim() === "\\") {
        logToFile(
          `[Delete Check Failed] Attempt to delete root: ${filePath} (Tab: ${tabId})`,
          "WARN",
        );
        throw new Error("Cannot delete root directory");
      }

      logToFile(
        `[Sensitive Operation] deleteFile triggered. TabId: ${tabId}, Path: ${filePath}, IsDir: ${isDirectory}, Source: IPC`,
        "INFO",
      );

      return nativeSftpClient.deleteFile(tabId, filePath, isDirectory);
    },

    async createFolder(event, tabId, folderPath) {
      return nativeSftpClient.createFolder(tabId, folderPath);
    },

    async createFile(event, tabId, filePath) {
      return nativeSftpClient.createFile(tabId, filePath);
    },

    async renameFile(event, tabId, oldPath, newName) {
      // 校验
      if (!oldPath || !newName) {
        logToFile(
          `[Rename Check Failed] Invalid params. Old: ${oldPath}, New: ${newName} (Tab: ${tabId})`,
          "WARN",
        );
        throw new Error("Invalid old path or new name");
      }
      if (oldPath.trim() === "/" || oldPath.trim() === "\\") {
        logToFile(
          `[Rename Check Failed] Attempt to rename root (Tab: ${tabId})`,
          "WARN",
        );
        throw new Error("Cannot rename root directory");
      }

      const newPath = path.posix.join(path.posix.dirname(oldPath), newName);
      logToFile(
        `[Sensitive Operation] renameFile triggered. TabId: ${tabId}, Old: ${oldPath}, New: ${newPath}, Source: IPC`,
        "INFO",
      );

      return nativeSftpClient.renameFile(tabId, oldPath, newPath);
    },

    async getFilePermissions(event, tabId, filePath) {
      return nativeSftpClient.getFilePermissions(tabId, filePath);
    },

    async getAbsolutePath(event, tabId, relativePath) {
      return nativeSftpClient.getAbsolutePath(tabId, relativePath);
    },

    async checkPathExists(event, checkPath) {
      const exists = fs.existsSync(checkPath);
      if (!exists) {
        return { success: true, exists };
      }

      const stats = fs.statSync(checkPath);
      let readable = true;
      try {
        fs.accessSync(checkPath, fs.constants.R_OK);
      } catch {
        readable = false;
      }

      return {
        success: true,
        exists,
        readable,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        mode: Number.isFinite(stats.mode) ? stats.mode : null,
        permissions: Number.isFinite(stats.mode)
          ? (stats.mode & 0o777).toString(8).padStart(3, "0")
          : null,
      };
    },

    async showItemInFolder(event, itemPath) {
      shell.showItemInFolder(itemPath);
      return { success: true };
    },

    async setFilePermissions(event, tabId, filePath, permissions) {
      return nativeSftpClient.setFilePermissions(tabId, filePath, permissions);
    },

    async getFilePermissionsBatch(event, tabId, filePaths) {
      return nativeSftpClient.getFilePermissionsBatch(tabId, filePaths);
    },

    async setFileOwnership(event, tabId, filePath, owner, group) {
      return nativeSftpClient.setFileOwnership(tabId, filePath, owner, group);
    },

    async createRemoteFolders(event, tabId, folderPath) {
      const processInfo = processManager.getProcess(tabId);
      if (!processInfo || !processInfo.config || processInfo.type !== "ssh") {
        throw new Error("Invalid SSH connection");
      }
      return nativeSftpClient.createRemoteFolders(tabId, folderPath);
    },
  };
}

module.exports = createRemoteFileMutationMethods;
