const filemanagementService = require("../../../modules/filemanagement/filemanagementService");
const nativeSftpClient = require("../../utils/nativeSftpClient");
const { logToFile } = require("../../utils/logger");
const { buildErrorResponse } = require("../../utils/errorResponse");
const processManager = require("../../process/processManager");
const path = require("path");
const fs = require("fs");
const { shell } = require("electron");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
} = require("../schema/channels");

const toPosixPath = (targetPath = "") => String(targetPath).replace(/\\/g, "/");

const normalizeDroppedRemotePath = (remotePath) => {
  const raw = String(remotePath ?? "").trim();
  if (!raw || raw === "~") return ".";

  const normalized = toPosixPath(raw);
  if (normalized === "~") return ".";
  if (normalized.startsWith("~/")) return `./${normalized.slice(2)}`;
  return normalized;
};

const joinDroppedRemotePath = (basePath, childPath) => {
  const base = normalizeDroppedRemotePath(basePath);
  const child = toPosixPath(childPath || "").replace(/^\/+/, "");
  if (!child) return base;
  if (base === ".") return child;
  return path.posix.join(base, child);
};

const normalizeDroppedRelativePath = (relativePath, name = "") => {
  const normalized = toPosixPath(relativePath || name || "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");

  return normalized || "unnamed-file";
};

const isDroppedRemoteNotFound = (errorLike = {}) => {
  const errorCode = String(
    errorLike.errorCode || errorLike.code || errorLike.raw?.errorCode || "",
  ).toUpperCase();
  const errorKind = String(
    errorLike.errorKind || errorLike.kind || errorLike.raw?.errorKind || "",
  ).toLowerCase();
  const message = String(
    errorLike.error || errorLike.message || errorLike.raw?.error || "",
  ).toLowerCase();

  return (
    errorCode === "NATIVE_SFTP_NOT_FOUND" ||
    errorKind === "notfound" ||
    message.includes("no such file") ||
    message.includes("not found") ||
    message.includes("does not exist")
  );
};

/**
 * 文件操作相关的IPC处理器
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

  _generateDirectoryWatchId() {
    return `${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  _getDirectoryWatchOwnerKey(sender, tabId) {
    const senderId = sender?.id ? String(sender.id) : "unknown";
    return `${senderId}::${String(tabId ?? "")}`;
  }

  _removeActiveDirectoryWatch(entry) {
    if (!entry || !entry.watchId) {
      return;
    }

    this.activeDirectoryWatches.delete(entry.watchId);
    if (this.activeDirectoryWatchOwners.get(entry.ownerKey) === entry.watchId) {
      this.activeDirectoryWatchOwners.delete(entry.ownerKey);
    }

    if (typeof entry.removeDestroyedListener === "function") {
      entry.removeDestroyedListener();
      entry.removeDestroyedListener = null;
    }
  }

  _sendDirectoryWatchEvent(entry, eventName, payload = {}) {
    try {
      if (!entry?.sender || entry.sender.isDestroyed()) {
        return;
      }

      entry.sender.send(IPC_EVENT_CHANNELS.DIRECTORY_WATCH_EVENT, {
        ...payload,
        watchId: entry.watchId,
        tabId: entry.tabId,
        path: entry.path,
        event: eventName,
      });
    } catch {
      // ignore renderer send failures during teardown
    }
  }

  _stopActiveDirectoryWatch(entry, reason = "stopped") {
    if (!entry) {
      return false;
    }

    entry.stopped = true;
    entry.stopReason = reason;
    this._removeActiveDirectoryWatch(entry);

    try {
      entry.controller?.close?.();
    } catch {
      // ignore sidecar shutdown failures
    }

    return true;
  }

  _findDirectoryWatchById(watchId) {
    if (!watchId) {
      return null;
    }
    return this.activeDirectoryWatches.get(String(watchId)) || null;
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
            const result = await nativeSftpClient.listFiles(
              tabId,
              requestedPath,
              {
                onSpawn: (child) => {
                  this.activeDirectoryReads.set(token, {
                    tabId: String(tabId),
                    token,
                    child,
                  });
                },
              },
            );

            const send = (payload) => {
              try {
                if (event && event.sender && !event.sender.isDestroyed()) {
                  event.sender.send(IPC_EVENT_CHANNELS.FILE_LIST_CHUNK, payload);
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
                errorCode: result?.errorCode || result?.code || null,
                errorKind: result?.errorKind || null,
                retryable: result?.retryable === true,
                module: result?.module || null,
                operation: result?.operation || null,
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
                event.sender.send(IPC_EVENT_CHANNELS.FILE_LIST_CHUNK, {
                  tabId,
                  path: requestedPath,
                  token,
                  items: [],
                  done: true,
                  error: err?.message || String(err),
                  errorCode: err?.errorCode || err?.code || null,
                  errorKind: err?.errorKind || null,
                  retryable: err?.retryable === true,
                  module: err?.module || null,
                  operation: err?.operation || null,
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
      return buildErrorResponse(error, "Failed to list files");
    }
  }

  async copyFile(event, tabId, sourcePath, targetPath) {
    try {
      const result = await nativeSftpClient.copyFile(
        tabId,
        sourcePath,
        targetPath,
      );
      return result;
    } catch (error) {
      logToFile(`Error copying file: ${error.message}`, "ERROR");
      return buildErrorResponse(error, "Failed to copy file");
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
      return buildErrorResponse(error, "Failed to move file");
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
      return buildErrorResponse(error, "Failed to delete file");
    }
  }

  async createFolder(event, tabId, folderPath) {
    try {
      const result = await nativeSftpClient.createFolder(tabId, folderPath);
      return result;
    } catch (error) {
      logToFile(`Error creating folder: ${error.message}`, "ERROR");
      return buildErrorResponse(error, "Failed to create folder");
    }
  }

  async createFile(event, tabId, filePath) {
    try {
      const result = await nativeSftpClient.createFile(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error creating file: ${error.message}`, "ERROR");
      return buildErrorResponse(error, "Failed to create file");
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
      return buildErrorResponse(error, "Failed to rename file");
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
      return buildErrorResponse(error, "Failed to download file");
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
      return buildErrorResponse(error, "Failed to download folder");
    }
  }

  async getFilePermissions(event, tabId, filePath) {
    try {
      const result = await nativeSftpClient.getFilePermissions(tabId, filePath);
      return result;
    } catch (error) {
      logToFile(`Error getting file permissions: ${error.message}`, "ERROR");
      return buildErrorResponse(error, "Failed to read permissions");
    }
  }

  async getAbsolutePath(event, tabId, relativePath) {
    try {
      const result = await nativeSftpClient.getAbsolutePath(
        tabId,
        relativePath,
      );
      return result;
    } catch (error) {
      logToFile(`Error getting absolute path: ${error.message}`, "ERROR");
      return buildErrorResponse(error, "Failed to resolve absolute path");
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

  async validateDroppedItems(event, items) {
    const sourceItems = Array.isArray(items) ? items : [];
    const files = [];
    const folders = [];
    const rejected = [];

    for (const item of sourceItems) {
      const name =
        typeof item?.name === "string" && item.name.trim()
          ? item.name.trim()
          : path.basename(String(item?.localPath || ""));
      const localPath =
        typeof item?.localPath === "string" ? item.localPath.trim() : "";
      const relativePath = normalizeDroppedRelativePath(
        item?.relativePath,
        name,
      );

      if (!localPath) {
        rejected.push({
          name: name || relativePath,
          relativePath,
          reason: "missing-local-path",
          message: "Dropped item has no verifiable local path",
        });
        continue;
      }

      try {
        const resolvedPath = path.resolve(localPath);
        const stats = fs.statSync(resolvedPath);
        fs.accessSync(resolvedPath, fs.constants.R_OK);

        const descriptor = {
          name: name || path.basename(resolvedPath),
          localPath: resolvedPath,
          relativePath,
          size: Number.isFinite(stats.size) ? stats.size : 0,
          lastModified: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : 0,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
        };

        if (descriptor.isFile) {
          files.push(descriptor);
          continue;
        }

        if (descriptor.isDirectory) {
          folders.push(descriptor);
          continue;
        }

        rejected.push({
          name: descriptor.name,
          localPath: resolvedPath,
          relativePath,
          reason: "unsupported-file-type",
          message: "Dropped item is not a regular file or directory",
        });
      } catch (error) {
        rejected.push({
          name: name || relativePath,
          localPath,
          relativePath,
          reason:
            error?.code === "EACCES" || error?.code === "EPERM"
              ? "permission-denied"
              : "not-readable",
          message: error?.message || "Dropped item is not readable",
        });
      }
    }

    return {
      success: rejected.length === 0,
      files,
      folders,
      rejected,
      totalItems: sourceItems.length,
    };
  }

  async checkDroppedUploadConflicts(event, tabId, targetFolder, uploadData) {
    const processInfo = processManager.getProcess(tabId);
    if (
      !processInfo ||
      !processInfo.config ||
      !processInfo.process ||
      processInfo.type !== "ssh2"
    ) {
      return { success: false, error: "无效或未就绪的SSH连接" };
    }

    const normalizedTarget = normalizeDroppedRemotePath(targetFolder);
    const rawFiles = Array.isArray(uploadData?.files) ? uploadData.files : [];
    const rawFolders = Array.isArray(uploadData?.folders)
      ? uploadData.folders
      : [];
    const candidates = [];

    for (const fileData of rawFiles) {
      const relativePath = normalizeDroppedRelativePath(
        fileData?.relativePath,
        fileData?.name,
      );
      candidates.push({
        type: "file",
        name: path.posix.basename(relativePath),
        relativePath,
        remotePath: joinDroppedRemotePath(normalizedTarget, relativePath),
      });
    }

    for (const folderPath of rawFolders) {
      const relativePath = normalizeDroppedRelativePath(folderPath, folderPath);
      candidates.push({
        type: "directory",
        name: path.posix.basename(relativePath),
        relativePath,
        remotePath: joinDroppedRemotePath(normalizedTarget, relativePath),
      });
    }

    const dedupedCandidates = Array.from(
      new Map(candidates.map((candidate) => [candidate.remotePath, candidate]))
        .values(),
    );
    const conflicts = [];

    for (const candidate of dedupedCandidates) {
      try {
        const result = await nativeSftpClient.getFilePermissions(
          tabId,
          candidate.remotePath,
        );
        if (result?.success) {
          conflicts.push({
            ...candidate,
            mode: result.mode,
            permissions: result.permissions,
            isDirectory: result.stats?.isDirectory === true,
          });
        } else if (!isDroppedRemoteNotFound(result || {})) {
          return {
            success: false,
            error:
              result?.error ||
              result?.message ||
              "Failed to check remote path conflicts",
          };
        }
      } catch (error) {
        if (isDroppedRemoteNotFound(error)) {
          continue;
        }

        return {
          success: false,
          error: error?.message || "Failed to check remote path conflicts",
        };
      }
    }

    return {
      success: true,
      hasConflicts: conflicts.length > 0,
      conflicts,
    };
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

  async startDirectoryWatch(event, tabId, remotePath, options = {}) {
    try {
      const normalizedTabId = String(tabId ?? "");
      if (!normalizedTabId) {
        return { success: false, error: "tabId is required" };
      }

      const sender = event?.sender;
      if (!sender || sender.isDestroyed()) {
        return { success: false, error: "renderer is unavailable" };
      }

      const ownerKey = this._getDirectoryWatchOwnerKey(sender, normalizedTabId);
      const previousWatchId = this.activeDirectoryWatchOwners.get(ownerKey);
      if (previousWatchId) {
        const previousEntry = this._findDirectoryWatchById(previousWatchId);
        this._stopActiveDirectoryWatch(previousEntry, "replaced");
      }

      const watchId = this._generateDirectoryWatchId();
      const requestedPath =
        typeof remotePath === "string" ? remotePath : String(remotePath ?? "");

      const entry = {
        watchId,
        tabId: normalizedTabId,
        path: requestedPath,
        ownerKey,
        sender,
        controller: null,
        stopped: false,
        stopReason: null,
        removeDestroyedListener: null,
      };

      const handleSenderDestroyed = () => {
        this._stopActiveDirectoryWatch(entry, "renderer-destroyed");
      };
      sender.on("destroyed", handleSenderDestroyed);
      entry.removeDestroyedListener = () => {
        try {
          sender.removeListener("destroyed", handleSenderDestroyed);
        } catch {
          // ignore listener cleanup failures
        }
      };

      let controller;
      try {
        controller = await nativeSftpClient.watchDirectory(
          normalizedTabId,
          requestedPath,
          {
            intervalMs: options?.intervalMs,
            onChanged: (payload) => {
              if (!this.activeDirectoryWatches.has(watchId)) {
                return;
              }
              this._sendDirectoryWatchEvent(entry, "changed", payload);
            },
            onError: (error) => {
              if (!this.activeDirectoryWatches.has(watchId)) {
                return;
              }
              this._sendDirectoryWatchEvent(entry, "error", {
                error: error?.message || String(error),
              });
            },
            onExit: () => {
              const isStillActive =
                this.activeDirectoryWatches.get(watchId) === entry;
              if (isStillActive) {
                this._removeActiveDirectoryWatch(entry);
              }
            },
          },
        );
      } catch (error) {
        entry.removeDestroyedListener?.();
        entry.removeDestroyedListener = null;
        throw error;
      }

      entry.controller = controller;
      this.activeDirectoryWatches.set(watchId, entry);
      this.activeDirectoryWatchOwners.set(ownerKey, watchId);

      return {
        success: true,
        watchId,
        path: requestedPath,
      };
    } catch (error) {
      logToFile(`Error starting directory watch: ${error.message}`, "WARN");
      return buildErrorResponse(error, "Failed to start directory watch");
    }
  }

  async stopDirectoryWatch(event, tabId, watchId = null) {
    try {
      const normalizedTabId = String(tabId ?? "");
      if (!normalizedTabId) {
        return { success: false, error: "tabId is required" };
      }

      if (watchId) {
        const entry = this._findDirectoryWatchById(watchId);
        if (!entry || entry.tabId !== normalizedTabId) {
          return { success: true, stopped: false };
        }

        return {
          success: true,
          stopped: this._stopActiveDirectoryWatch(entry, "client-stop"),
        };
      }

      const ownerKey = this._getDirectoryWatchOwnerKey(
        event?.sender,
        normalizedTabId,
      );
      const activeWatchId = this.activeDirectoryWatchOwners.get(ownerKey);
      if (!activeWatchId) {
        return { success: true, stopped: false };
      }

      const entry = this._findDirectoryWatchById(activeWatchId);
      return {
        success: true,
        stopped: this._stopActiveDirectoryWatch(entry, "client-stop"),
      };
    } catch (error) {
      logToFile(`Error stopping directory watch: ${error.message}`, "WARN");
      return buildErrorResponse(error, "Failed to stop directory watch");
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
      return buildErrorResponse(error, `设置权限失败: ${error.message}`);
    }
  }

  async getFilePermissionsBatch(event, tabId, filePaths) {
    try {
      return await nativeSftpClient.getFilePermissionsBatch(tabId, filePaths);
    } catch (error) {
      logToFile(`Batch get file permissions error: ${error.message}`, "ERROR");
      return buildErrorResponse(error, `批量获取权限失败: ${error.message}`);
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
      return buildErrorResponse(error, `设置所有者/组失败: ${error.message}`);
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
      return buildErrorResponse(error, "Failed to create remote folders");
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
      return buildErrorResponse(error, `上传文件失败: ${error.message}`);
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
      return buildErrorResponse(error, `上传文件失败: ${error.message}`);
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
      return buildErrorResponse(error, `上传文件夹失败: ${error.message}`);
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
