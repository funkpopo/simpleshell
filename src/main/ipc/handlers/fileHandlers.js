const filemanagementService = require("../../file-transfer/filemanagementService");
const nativeSftpClient = require("../../native/nativeSftpClient");
const { logToFile } = require("../../utils/logger");
const { generateId } = require("../../../shared/common");
const processManager = require("../../process/processManager");
const path = require("path");
const fs = require("fs");
const { shell } = require("electron");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
} = require("../../../shared/contracts/ipc/channels");
const {
  toPosixPath,
  normalizeDroppedTransferRelativePath,
  normalizeRemoteTransferPath,
} = require("../../file-transfer/transferShared");
const {
  t: translateLocale,
  getUiLanguage,
} = require("../../../shared/mainI18n");
const configService = require("../../settings/configService");
const {
  zmodemTransferService,
} = require("../../terminal/zmodemTransferService");
const createDirectoryListingAndWatchMethods = require("./file-domains/directoryListingAndWatch");
const createRemoteFileMutationMethods = require("./file-domains/remoteFileMutations");
const createDroppedUploadValidationMethods = require("./file-domains/droppedUploadValidation");
const createTransferOperationMethods = require("./file-domains/transferOperations");

const fileText = (key, params = {}) =>
  translateLocale(key, { lng: getUiLanguage(configService), ...params });

const isUserCancelledError = (error) => {
  const message = String(error?.message || "");
  return (
    /cancel/i.test(message) ||
    /abort/i.test(message) ||
    message.includes("用户取消") ||
    message.includes(fileText("mainProcess.file.userCancelled")) ||
    message.includes(fileText("mainProcess.transfer.downloadCancelled")) ||
    message.includes(fileText("mainProcess.transfer.uploadCancelled"))
  );
};

const buildUserCancelledResponse = () => ({
  success: true,
  cancelled: true,
  userCancelled: true,
  message: fileText("mainProcess.file.userCancelledOperation"),
});

/**
 * 文件操作相关的IPC处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
 */
class FileHandlers {
  constructor() {
    this.activeTransfers = new Map();
    this.activeDirectoryReads = new Map();
    this.activeDirectoryWatches = new Map();
    this.activeDirectoryWatchOwners = new Map();
  }

  /**
   * 获取所有文件处理器
   */
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.FILE_LIST_RESUMABLE,
        category: "file",
        handler: () => filemanagementService.listResumableTransfers(),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_RESUME_TRANSFER,
        category: "file",
        handler: (...args) => filemanagementService.resumeTransfer(...args),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_DISCARD_RESUMABLE,
        category: "file",
        handler: (...args) =>
          filemanagementService.discardResumableTransfer(...args),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_TRANSFER_INTEGRITY,
        category: "file",
        handler: (...args) =>
          filemanagementService.setTransferIntegrity(...args),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_LIST,
        category: "file",
        handler: this.listFiles.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_COPY,
        category: "file",
        handler: this.copyFile.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_MOVE,
        category: "file",
        handler: this.moveFile.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_DELETE,
        category: "file",
        handler: this.deleteFile.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_CREATE_FOLDER,
        category: "file",
        handler: this.createFolder.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_CREATE,
        category: "file",
        handler: this.createFile.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_RENAME,
        category: "file",
        handler: this.renameFile.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_DOWNLOAD,
        category: "file",
        handler: this.downloadFile.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_DOWNLOAD_FOLDER,
        category: "file",
        handler: this.downloadFolder.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS,
        category: "file",
        handler: this.getFilePermissions.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_GET_ABSOLUTE_PATH,
        category: "file",
        handler: this.getAbsolutePath.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_CHECK_PATH_EXISTS,
        category: "file",
        handler: this.checkPathExists.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_SHOW_ITEM_IN_FOLDER,
        category: "file",
        handler: this.showItemInFolder.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_CANCEL_TRANSFER,
        category: "file",
        handler: this.cancelTransfer.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_CANCEL_LIST,
        category: "file",
        handler: this.cancelListFiles.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_START_DIRECTORY_WATCH,
        category: "file",
        handler: this.startDirectoryWatch.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_STOP_DIRECTORY_WATCH,
        category: "file",
        handler: this.stopDirectoryWatch.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_DOWNLOAD_FILES,
        category: "file",
        handler: this.downloadFiles.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_SET_PERMISSIONS,
        category: "file",
        handler: this.setFilePermissions.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS_BATCH,
        category: "file",
        handler: this.getFilePermissionsBatch.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_SET_OWNERSHIP,
        category: "file",
        handler: this.setFileOwnership.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_CREATE_REMOTE_FOLDERS,
        category: "file",
        handler: this.createRemoteFolders.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_UPLOAD,
        category: "file",
        handler: this.uploadFile.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_UPLOAD_DROPPED,
        category: "file",
        handler: this.uploadDroppedFiles.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_VALIDATE_DROPPED_ITEMS,
        category: "file",
        handler: this.validateDroppedItems.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_CHECK_DROPPED_UPLOAD_CONFLICTS,
        category: "file",
        handler: this.checkDroppedUploadConflicts.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.FILE_UPLOAD_FOLDER,
        category: "file",
        handler: this.uploadFolder.bind(this),
      },
    ];
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

Object.assign(
  FileHandlers.prototype,
  createDirectoryListingAndWatchMethods({
    generateId,
    nativeSftpClient,
    IPC_EVENT_CHANNELS,
  }),
  createRemoteFileMutationMethods({
    fs,
    path,
    shell,
    nativeSftpClient,
    processManager,
    logToFile,
  }),
  createDroppedUploadValidationMethods({
    fs,
    path,
    nativeSftpClient,
    processManager,
    toPosixPath,
    normalizeDroppedTransferRelativePath,
    normalizeRemoteTransferPath,
    fileText,
  }),
  createTransferOperationMethods({
    filemanagementService,
    processManager,
    zmodemTransferService,
    fileText,
    isUserCancelledError,
    buildUserCancelledResponse,
  }),
);

module.exports = FileHandlers;
