const filemanagementService = require("../../../modules/filemanagement/filemanagementService");

/**
 * 文件操作相关的 IPC 处理器
 * 说明：
 * - 该处理器仅负责 IPC 路由和方法映射
 * - 核心文件管理/传输逻辑统一由 filemanagementService 实现
 */
class FileHandlers {
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

  async listFiles(event, tabId, path, options = {}) {
    return filemanagementService.listFiles(event, tabId, path, options);
  }

  async copyFile(event, tabId, sourcePath, targetPath) {
    return filemanagementService.copyFile(event, tabId, sourcePath, targetPath);
  }

  async moveFile(event, tabId, sourcePath, targetPath) {
    return filemanagementService.moveFile(event, tabId, sourcePath, targetPath);
  }

  async deleteFile(event, tabId, filePath, isDirectory) {
    return filemanagementService.deleteFile(
      event,
      tabId,
      filePath,
      isDirectory,
    );
  }

  async createFolder(event, tabId, folderPath) {
    return filemanagementService.createFolder(event, tabId, folderPath);
  }

  async createFile(event, tabId, filePath) {
    return filemanagementService.createFile(event, tabId, filePath);
  }

  async renameFile(event, tabId, oldPath, newName) {
    return filemanagementService.renameFile(event, tabId, oldPath, newName);
  }

  async downloadFile(event, tabId, remotePath) {
    return filemanagementService.downloadFile(event, tabId, remotePath);
  }

  async downloadFolder(event, tabId, remotePath) {
    return filemanagementService.downloadFolder(event, tabId, remotePath);
  }

  async getFilePermissions(event, tabId, filePath) {
    return filemanagementService.getFilePermissions(event, tabId, filePath);
  }

  async getAbsolutePath(event, tabId, relativePath) {
    return filemanagementService.getAbsolutePath(event, tabId, relativePath);
  }

  async checkPathExists(event, checkPath) {
    return filemanagementService.checkPathExists(event, checkPath);
  }

  async showItemInFolder(event, itemPath) {
    return filemanagementService.showItemInFolder(event, itemPath);
  }

  async cancelTransfer(event, tabId, transferKey) {
    return filemanagementService.cancelTransfer(event, tabId, transferKey);
  }

  async downloadFiles(event, tabId, files) {
    return filemanagementService.downloadFiles(event, tabId, files);
  }

  async setFilePermissions(event, tabId, filePath, permissions) {
    return filemanagementService.setFilePermissions(
      event,
      tabId,
      filePath,
      permissions,
    );
  }

  async getFilePermissionsBatch(event, tabId, filePaths) {
    return filemanagementService.getFilePermissionsBatch(
      event,
      tabId,
      filePaths,
    );
  }

  async setFileOwnership(event, tabId, filePath, owner, group) {
    return filemanagementService.setFileOwnership(
      event,
      tabId,
      filePath,
      owner,
      group,
    );
  }

  async createRemoteFolders(event, tabId, folderPath) {
    return filemanagementService.createRemoteFolders(event, tabId, folderPath);
  }

  async uploadFile(event, tabId, targetFolder, progressChannel) {
    return filemanagementService.uploadFile(
      event,
      tabId,
      targetFolder,
      progressChannel,
    );
  }

  async uploadDroppedFiles(
    event,
    tabId,
    targetFolder,
    uploadData,
    progressChannel,
  ) {
    return filemanagementService.uploadDroppedFiles(
      event,
      tabId,
      targetFolder,
      uploadData,
      progressChannel,
    );
  }

  async uploadFolder(event, tabId, targetFolder, progressChannel) {
    return filemanagementService.uploadFolder(
      event,
      tabId,
      targetFolder,
      progressChannel,
    );
  }

  cleanup() {
    filemanagementService.cleanup();
  }
}

module.exports = FileHandlers;
