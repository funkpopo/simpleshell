const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const crypto = require("crypto");
const { app, dialog, shell, BrowserWindow } = require("electron");

const sftpCore = require("../../core/transfer/sftp-engine");
const processManager = require("../../core/process/processManager");
const { logToFile } = require("../../core/utils/logger");

const DIRECTORY_TYPE_MASK = 0o170000;
const DIRECTORY_MODE = 0o040000;
const DEFAULT_PROGRESS_INTERVAL_MS = 200;
const DEFAULT_STALL_TIMEOUT_MS = 45000;
const MAX_TRANSFER_RETRIES = 2;
const RETRY_BACKOFF_BASE_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function isDirectoryMode(mode) {
  return (
    typeof mode === "number" && (mode & DIRECTORY_TYPE_MASK) === DIRECTORY_MODE
  );
}

function isRootPath(targetPath) {
  if (!targetPath || typeof targetPath !== "string") return false;
  const trimmed = targetPath.trim();
  return trimmed === "/" || trimmed === "\\";
}

function buildCancelledError() {
  const error = new Error("Transfer cancelled by user");
  error.cancelled = true;
  error.userCancelled = true;
  return error;
}

function isCancelledError(error) {
  if (!error) return false;
  if (error.cancelled || error.userCancelled) return true;

  const msg = normalizeErrorMessage(error).toLowerCase();
  return (
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("user cancelled") ||
    msg.includes("transfer cancelled")
  );
}

function isRetryableTransferError(error) {
  if (!error || isCancelledError(error)) return false;
  const message = normalizeErrorMessage(error).toLowerCase();
  const code = String(error.code || "").toUpperCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("connection lost") ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ENOTCONN"
  );
}

function isPathExistsError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = normalizeErrorMessage(error).toLowerCase();
  return (
    code === "EEXIST" ||
    message.includes("already exists") ||
    message.includes("failure code is 4")
  );
}

function toPosixPath(p) {
  return String(p || "").replace(/\\/g, "/");
}

function makeBufferReadStream(buffer, chunkSize) {
  let offset = 0;
  const normalizedChunkSize = Math.max(
    64 * 1024,
    Math.floor(chunkSize || 64 * 1024),
  );
  return new Readable({
    read() {
      if (offset >= buffer.length) {
        this.push(null);
        return;
      }
      const end = Math.min(offset + normalizedChunkSize, buffer.length);
      const chunk = buffer.subarray(offset, end);
      offset = end;
      this.push(chunk);
    },
  });
}

class FilemanagementService {
  constructor() {
    this.activeTransfers = new Map();
    this.inflightDirectoryReads = new Map();
  }

  _log(message, level = "INFO") {
    if (typeof logToFile === "function") {
      logToFile(`[Filemanagement] ${message}`, level);
    }
  }

  _normalizeRemotePath(remotePath) {
    const raw = String(remotePath ?? "").trim();
    if (!raw || raw === "~") return ".";

    const normalized = toPosixPath(raw);
    if (normalized === "~") return ".";
    if (normalized.startsWith("~/")) return `./${normalized.slice(2)}`;
    return normalized;
  }

  _joinRemotePath(basePath, childName) {
    const base = this._normalizeRemotePath(basePath);
    if (!childName) return base;
    if (base === ".") return toPosixPath(childName);
    return path.posix.join(base, toPosixPath(childName));
  }

  _resolveDownloadBasePath(tabId) {
    const processInfo = processManager.getProcess(tabId);
    const configuredPath = processInfo?.config?.downloadPath;
    if (configuredPath) return configuredPath;
    try {
      return app.getPath("downloads");
    } catch {
      return os.homedir();
    }
  }

  _resolveDialogWindow() {
    return (
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows()[0] ||
      null
    );
  }

  _generateToken() {
    return `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
  }

  _generateTransferKey(tabId, type) {
    return `${tabId}-${type}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
  }

  _safeSend(sender, channel, payload) {
    if (!sender || !channel) return;
    try {
      if (!sender.isDestroyed()) {
        sender.send(channel, payload);
      }
    } catch {
      // ignore renderer lifecycle race
    }
  }

  async _withBorrowedSftp(tabId, worker) {
    const borrowed = await sftpCore.borrowSftpSession(tabId);
    try {
      return await worker(borrowed.sftp, borrowed.sessionId);
    } finally {
      try {
        sftpCore.releaseSftpSession(tabId, borrowed.sessionId);
      } catch {
        // ignore release error
      }
    }
  }

  async _withTransferRetry(transferKey, task) {
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_TRANSFER_RETRIES; attempt += 1) {
      if (this._isTransferCancelled(transferKey)) {
        throw buildCancelledError();
      }

      try {
        return await task(attempt);
      } catch (error) {
        lastError = error;
        if (this._isTransferCancelled(transferKey) || isCancelledError(error)) {
          throw buildCancelledError();
        }
        const shouldRetry =
          attempt < MAX_TRANSFER_RETRIES && isRetryableTransferError(error);
        if (!shouldRetry) {
          throw error;
        }
        const waitMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
        await sleep(waitMs);
      }
    }

    throw lastError || new Error("Transfer failed");
  }

  _chooseChunkSize(totalBytes) {
    const bytes = Number.isFinite(totalBytes) ? totalBytes : 0;
    if (bytes >= 4 * 1024 * 1024 * 1024) return 4 * 1024 * 1024;
    if (bytes >= 512 * 1024 * 1024) return 2 * 1024 * 1024;
    if (bytes >= 64 * 1024 * 1024) return 1024 * 1024;
    if (bytes >= 8 * 1024 * 1024) return 512 * 1024;
    return 256 * 1024;
  }

  _chooseConcurrency(totalFiles, totalBytes, isFolderLike = false) {
    const files = Math.max(1, totalFiles || 1);
    const bytes = Math.max(0, totalBytes || 0);
    const cpu = Math.max(2, os.cpus()?.length || 4);

    let concurrency = Math.max(2, Math.floor(cpu / 2));
    if (bytes >= 8 * 1024 * 1024 * 1024) {
      concurrency = Math.min(concurrency, 4);
    } else if (bytes >= 2 * 1024 * 1024 * 1024) {
      concurrency = Math.min(concurrency, 5);
    } else {
      concurrency = Math.min(concurrency + 1, 8);
    }

    if (isFolderLike && files > 200) {
      concurrency = Math.min(concurrency + 2, 10);
    }

    return Math.max(1, Math.min(concurrency, files));
  }

  async _runConcurrent(tasks, concurrency, shouldStop = null) {
    const errors = [];
    let index = 0;
    const workers = [];
    const workerCount = Math.max(
      1,
      Math.min(concurrency || 1, tasks.length || 1),
    );

    const runWorker = async () => {
      while (true) {
        if (shouldStop && shouldStop()) break;
        const currentIndex = index;
        index += 1;
        if (currentIndex >= tasks.length) break;

        try {
          await tasks[currentIndex]();
        } catch (error) {
          errors.push({ index: currentIndex, error });
        }
      }
    };

    for (let i = 0; i < workerCount; i += 1) {
      workers.push(runWorker());
    }

    await Promise.all(workers);
    return { errors };
  }

  _registerTransfer({
    transferKey,
    tabId,
    type,
    sender,
    progressChannel,
    totalBytes = 0,
    totalFiles = 1,
    metadata = {},
  }) {
    const state = {
      transferKey,
      tabId,
      type,
      sender,
      progressChannel,
      totalBytes: Math.max(0, totalBytes || 0),
      totalFiles: Math.max(1, totalFiles || 1),
      transferredBytes: 0,
      processedFiles: 0,
      startAt: Date.now(),
      lastEmitAt: 0,
      cancelled: false,
      activeStreams: new Set(),
      metadata: { ...metadata },
    };
    this.activeTransfers.set(transferKey, state);
    return state;
  }

  _getTransfer(transferKey) {
    return this.activeTransfers.get(transferKey) || null;
  }

  _isTransferCancelled(transferKey) {
    const transfer = this._getTransfer(transferKey);
    return !transfer || transfer.cancelled;
  }

  _trackTransferStream(transferKey, stream) {
    const transfer = this._getTransfer(transferKey);
    if (!transfer || !stream) return;

    transfer.activeStreams.add(stream);

    const cleanup = () => {
      const current = this._getTransfer(transferKey);
      if (!current) return;
      current.activeStreams.delete(stream);
    };

    stream.once("close", cleanup);
    stream.once("error", cleanup);
    stream.once("end", cleanup);
  }

  _destroyTransferStreams(transferKey, reason = "Transfer cancelled by user") {
    const transfer = this._getTransfer(transferKey);
    if (!transfer) return;

    for (const stream of transfer.activeStreams) {
      try {
        stream.destroy(new Error(reason));
      } catch {
        // ignore stream destruction errors
      }
    }
    transfer.activeStreams.clear();
  }

  _emitTransferProgress(
    transferKey,
    {
      channel = null,
      force = false,
      isBatch = false,
      fileName = "",
      currentFile = "",
      currentFileIndex = 0,
      extra = {},
    } = {},
  ) {
    const transfer = this._getTransfer(transferKey);
    if (!transfer) return;

    const now = Date.now();
    if (!force && now - transfer.lastEmitAt < DEFAULT_PROGRESS_INTERVAL_MS) {
      return;
    }

    transfer.lastEmitAt = now;

    const elapsedSec = Math.max(0.001, (now - transfer.startAt) / 1000);
    const speed = transfer.transferredBytes / elapsedSec;
    const remainingBytes = Math.max(
      0,
      transfer.totalBytes - transfer.transferredBytes,
    );
    const remainingTime = speed > 0 ? remainingBytes / speed : 0;
    const progress =
      transfer.totalBytes > 0
        ? Math.min(100, (transfer.transferredBytes / transfer.totalBytes) * 100)
        : transfer.processedFiles >= transfer.totalFiles
          ? 100
          : 0;

    const payload = {
      tabId: transfer.tabId,
      transferKey,
      progress,
      fileName,
      currentFile,
      transferredBytes: transfer.transferredBytes,
      totalBytes: transfer.totalBytes,
      transferSpeed: speed,
      remainingTime,
      currentFileIndex,
      processedFiles: transfer.processedFiles,
      totalFiles: transfer.totalFiles,
      isBatch,
      ...extra,
    };

    const finalChannel = channel || transfer.progressChannel;
    this._safeSend(transfer.sender, finalChannel, payload);
  }

  _finalizeTransfer(transferKey) {
    const transfer = this._getTransfer(transferKey);
    if (!transfer) return;
    this._destroyTransferStreams(transferKey, "Transfer finalized");
    this.activeTransfers.delete(transferKey);
  }

  async _pumpStreams({
    transferKey,
    readStream,
    writeStream,
    onBytes,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
  }) {
    this._trackTransferStream(transferKey, readStream);
    this._trackTransferStream(transferKey, writeStream);

    let lastProgressAt = Date.now();
    const onData = (chunk) => {
      const size = chunk?.length || 0;
      lastProgressAt = Date.now();
      if (size > 0 && typeof onBytes === "function") {
        onBytes(size);
      }
    };

    readStream.on("data", onData);

    const guard = setInterval(() => {
      if (this._isTransferCancelled(transferKey)) {
        const cancelError = buildCancelledError();
        try {
          readStream.destroy(cancelError);
        } catch {
          // ignore
        }
        try {
          writeStream.destroy(cancelError);
        } catch {
          // ignore
        }
        return;
      }

      if (Date.now() - lastProgressAt > stallTimeoutMs) {
        const timeoutError = new Error("Transfer stalled: no progress");
        try {
          readStream.destroy(timeoutError);
        } catch {
          // ignore
        }
        try {
          writeStream.destroy(timeoutError);
        } catch {
          // ignore
        }
      }
    }, 1000);

    try {
      await pipeline(readStream, writeStream);
    } finally {
      clearInterval(guard);
      readStream.removeListener("data", onData);
    }
  }

  async _stat(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (error, stats) => {
        if (error) reject(error);
        else resolve(stats);
      });
    });
  }

  async _lstat(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.lstat(remotePath, (error, stats) => {
        if (error) reject(error);
        else resolve(stats);
      });
    });
  }

  async _readdir(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (error, list) => {
        if (error) reject(error);
        else resolve(Array.isArray(list) ? list : []);
      });
    });
  }

  async _rename(sftp, sourcePath, targetPath) {
    return new Promise((resolve, reject) => {
      sftp.rename(sourcePath, targetPath, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async _unlink(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.unlink(remotePath, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async _rmdir(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.rmdir(remotePath, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async _mkdir(sftp, remotePath) {
    return new Promise((resolve, reject) => {
      sftp.mkdir(remotePath, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async _chmod(sftp, remotePath, mode) {
    return new Promise((resolve, reject) => {
      sftp.chmod(remotePath, mode, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async _chown(sftp, remotePath, uid, gid) {
    return new Promise((resolve, reject) => {
      sftp.chown(remotePath, uid, gid, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async _openFileHandle(sftp, remotePath, flags = "w") {
    return new Promise((resolve, reject) => {
      sftp.open(remotePath, flags, (error, handle) => {
        if (error) reject(error);
        else resolve(handle);
      });
    });
  }

  async _closeFileHandle(sftp, handle) {
    return new Promise((resolve, reject) => {
      sftp.close(handle, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  async _mkdirIfNeeded(sftp, remotePath) {
    try {
      const stats = await this._stat(sftp, remotePath);
      if (!isDirectoryMode(stats?.mode)) {
        throw new Error(`Path exists and is not a directory: ${remotePath}`);
      }
      return;
    } catch {
      // path does not exist
    }

    try {
      await this._mkdir(sftp, remotePath);
    } catch (mkdirError) {
      if (!isPathExistsError(mkdirError)) {
        const stats = await this._stat(sftp, remotePath);
        if (!isDirectoryMode(stats?.mode)) {
          throw mkdirError;
        }
      }
    }
  }

  async _mkdirRecursiveWithSession(sftp, remotePath) {
    const normalizedPath = this._normalizeRemotePath(remotePath);
    if (!normalizedPath || normalizedPath === "." || normalizedPath === "/") {
      return;
    }

    const isAbsolute = normalizedPath.startsWith("/");
    const parts = normalizedPath.split("/").filter(Boolean);
    let currentPath = isAbsolute ? "/" : "";

    for (const part of parts) {
      currentPath = currentPath ? path.posix.join(currentPath, part) : part;
      await this._mkdirIfNeeded(sftp, currentPath);
    }
  }

  async _deleteRemoteDirectoryRecursive(sftp, remotePath) {
    const entries = await this._readdir(sftp, remotePath);
    for (const item of entries) {
      const name = item?.filename;
      if (!name || name === "." || name === "..") continue;

      const childPath = path.posix.join(remotePath, name);
      const mode = item?.attrs?.mode;
      if (isDirectoryMode(mode)) {
        await this._deleteRemoteDirectoryRecursive(sftp, childPath);
      } else {
        await this._unlink(sftp, childPath);
      }
    }
    await this._rmdir(sftp, remotePath);
  }

  _buildFileListEntry(item) {
    const attrs = item?.attrs || {};
    const mode = attrs.mode;
    const directory = isDirectoryMode(mode);
    return {
      name: item?.filename || "",
      isDirectory: directory,
      type: directory ? "directory" : "file",
      size: Number.isFinite(attrs.size) ? attrs.size : 0,
      modifyTime: Number.isFinite(attrs.mtime) ? attrs.mtime * 1000 : 0,
      accessTime: Number.isFinite(attrs.atime) ? attrs.atime * 1000 : 0,
      mode: Number.isFinite(mode) ? mode : 0,
      uid: Number.isFinite(attrs.uid) ? attrs.uid : 0,
      gid: Number.isFinite(attrs.gid) ? attrs.gid : 0,
    };
  }

  async _listDirectoryCore(tabId, remotePath) {
    const normalizedPath = this._normalizeRemotePath(remotePath);
    return this._withBorrowedSftp(tabId, async (sftp) => {
      const list = await this._readdir(sftp, normalizedPath);
      return list.map((item) => this._buildFileListEntry(item));
    });
  }

  async listFiles(event, tabId, remotePath, options = {}) {
    const pathForRequest = this._normalizeRemotePath(remotePath);
    const listKey = `${tabId}::${pathForRequest}`;
    const canMerge = Boolean(options?.canMerge);

    const executeRead = async () => {
      const data = await this._listDirectoryCore(tabId, pathForRequest);
      return { success: true, data };
    };

    if (options?.nonBlocking) {
      const sender = event?.sender;
      const chunkSize =
        typeof options.chunkSize === "number" && options.chunkSize > 0
          ? Math.floor(options.chunkSize)
          : 300;
      const token = this._generateToken();

      Promise.resolve()
        .then(async () => {
          let response;
          if (canMerge && this.inflightDirectoryReads.has(listKey)) {
            response = await this.inflightDirectoryReads.get(listKey);
          } else {
            const promise = executeRead();
            if (canMerge) {
              this.inflightDirectoryReads.set(listKey, promise);
            }
            try {
              response = await promise;
            } finally {
              if (canMerge) {
                this.inflightDirectoryReads.delete(listKey);
              }
            }
          }

          if (!response?.success) {
            this._safeSend(sender, "listFiles:chunk", {
              tabId,
              path: pathForRequest,
              token,
              items: [],
              done: true,
              error: response?.error || "Failed to list directory",
            });
            return;
          }

          const list = Array.isArray(response.data) ? response.data : [];
          if (list.length === 0) {
            this._safeSend(sender, "listFiles:chunk", {
              tabId,
              path: pathForRequest,
              token,
              items: [],
              done: true,
            });
            return;
          }

          for (let i = 0; i < list.length; i += chunkSize) {
            const items = list.slice(i, i + chunkSize);
            const done = i + chunkSize >= list.length;
            this._safeSend(sender, "listFiles:chunk", {
              tabId,
              path: pathForRequest,
              token,
              items,
              done,
            });
          }
        })
        .catch((error) => {
          this._safeSend(event?.sender, "listFiles:chunk", {
            tabId,
            path: pathForRequest,
            token,
            items: [],
            done: true,
            error: normalizeErrorMessage(error),
          });
        });

      return { success: true, data: [], chunked: true, token };
    }

    try {
      if (canMerge && this.inflightDirectoryReads.has(listKey)) {
        return await this.inflightDirectoryReads.get(listKey);
      }

      const promise = executeRead();
      if (canMerge) {
        this.inflightDirectoryReads.set(listKey, promise);
      }
      return await promise;
    } catch (error) {
      this._log(`listFiles failed: ${normalizeErrorMessage(error)}`, "ERROR");
      return { success: false, error: normalizeErrorMessage(error) };
    } finally {
      if (canMerge) {
        this.inflightDirectoryReads.delete(listKey);
      }
    }
  }

  async copyFile(event, tabId, sourcePath, targetPath) {
    try {
      const source = this._normalizeRemotePath(sourcePath);
      const target = this._normalizeRemotePath(targetPath);

      await this._withBorrowedSftp(tabId, async (sftp) => {
        const stats = await this._stat(sftp, source);
        const chunkSize = this._chooseChunkSize(stats?.size || 0);
        const readStream = sftp.createReadStream(source, {
          highWaterMark: chunkSize,
        });
        const writeStream = sftp.createWriteStream(target, {
          highWaterMark: chunkSize,
        });

        const transferKey = this._generateTransferKey(tabId, "copy");
        this._registerTransfer({
          transferKey,
          tabId,
          type: "copy",
          sender: event?.sender,
        });
        try {
          await this._pumpStreams({
            transferKey,
            readStream,
            writeStream,
            onBytes: () => {},
          });
        } finally {
          this._finalizeTransfer(transferKey);
        }
      });

      return { success: true };
    } catch (error) {
      this._log(`copyFile failed: ${normalizeErrorMessage(error)}`, "ERROR");
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async moveFile(event, tabId, sourcePath, targetPath) {
    if (!sourcePath || !targetPath) {
      return { success: false, error: "Invalid source or target path" };
    }
    if (isRootPath(sourcePath)) {
      return { success: false, error: "Cannot move root directory" };
    }

    try {
      const source = this._normalizeRemotePath(sourcePath);
      const target = this._normalizeRemotePath(targetPath);
      await this._withBorrowedSftp(tabId, (sftp) =>
        this._rename(sftp, source, target),
      );
      return { success: true };
    } catch (error) {
      this._log(`moveFile failed: ${normalizeErrorMessage(error)}`, "ERROR");
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async deleteFile(event, tabId, remotePath, isDirectory) {
    if (!remotePath || typeof remotePath !== "string") {
      return { success: false, error: "Invalid file path" };
    }
    if (isRootPath(remotePath)) {
      return { success: false, error: "Cannot delete root directory" };
    }

    try {
      const normalizedPath = this._normalizeRemotePath(remotePath);
      await this._withBorrowedSftp(tabId, async (sftp) => {
        if (isDirectory) {
          await this._deleteRemoteDirectoryRecursive(sftp, normalizedPath);
        } else {
          await this._unlink(sftp, normalizedPath);
        }
      });
      return { success: true };
    } catch (error) {
      this._log(`deleteFile failed: ${normalizeErrorMessage(error)}`, "ERROR");
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async createFolder(event, tabId, folderPath) {
    try {
      const normalizedPath = this._normalizeRemotePath(folderPath);
      await this._withBorrowedSftp(tabId, (sftp) =>
        this._mkdirRecursiveWithSession(sftp, normalizedPath),
      );
      return { success: true };
    } catch (error) {
      this._log(
        `createFolder failed: ${normalizeErrorMessage(error)}`,
        "ERROR",
      );
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async createFile(event, tabId, filePath) {
    try {
      const normalizedPath = this._normalizeRemotePath(filePath);
      await this._withBorrowedSftp(tabId, async (sftp) => {
        const handle = await this._openFileHandle(sftp, normalizedPath, "w");
        await this._closeFileHandle(sftp, handle);
      });
      return { success: true };
    } catch (error) {
      this._log(`createFile failed: ${normalizeErrorMessage(error)}`, "ERROR");
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async renameFile(event, tabId, oldPath, newName) {
    if (!oldPath || !newName) {
      return { success: false, error: "Invalid old path or new name" };
    }
    if (isRootPath(oldPath)) {
      return { success: false, error: "Cannot rename root directory" };
    }

    try {
      const normalizedOldPath = this._normalizeRemotePath(oldPath);
      const newPath = path.posix.join(
        path.posix.dirname(normalizedOldPath),
        newName,
      );
      await this._withBorrowedSftp(tabId, (sftp) =>
        this._rename(sftp, normalizedOldPath, newPath),
      );
      return { success: true };
    } catch (error) {
      this._log(`renameFile failed: ${normalizeErrorMessage(error)}`, "ERROR");
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async getFilePermissions(event, tabId, remotePath) {
    try {
      const normalizedPath = this._normalizeRemotePath(remotePath);
      return await this._withBorrowedSftp(tabId, async (sftp) => {
        const stats = await this._stat(sftp, normalizedPath);
        const mode = stats.mode;
        const permissions = (mode & parseInt("777", 8))
          .toString(8)
          .padStart(3, "0");
        return {
          success: true,
          permissions,
          mode,
          uid: stats.uid,
          gid: stats.gid,
          stats,
        };
      });
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async getAbsolutePath(event, tabId, remotePath) {
    try {
      return await sftpCore.getAbsolutePath(tabId, remotePath);
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async checkPathExists(event, checkPath) {
    try {
      const exists = fs.existsSync(checkPath);
      return { success: true, exists };
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async showItemInFolder(event, itemPath) {
    try {
      shell.showItemInFolder(itemPath);
      return { success: true };
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async cancelTransfer(event, tabId, transferKey) {
    const transfer = this._getTransfer(transferKey);
    if (!transfer) {
      return { success: false, error: "Transfer not found" };
    }
    if (String(transfer.tabId) !== String(tabId)) {
      return { success: false, error: "Transfer does not belong to tab" };
    }

    transfer.cancelled = true;
    this._destroyTransferStreams(transferKey, "Transfer cancelled by user");
    this._emitTransferProgress(transferKey, {
      force: true,
      fileName: "传输已取消",
      extra: {
        cancelled: true,
        userCancelled: true,
        operationComplete: true,
      },
    });

    return { success: true, cancelled: true };
  }

  async setFilePermissions(event, tabId, remotePath, permissions) {
    try {
      const permissionStr = String(permissions || "").trim();
      const mode = parseInt(permissionStr, 8);
      if (!permissionStr || Number.isNaN(mode)) {
        return { success: false, error: "无效的权限值" };
      }

      const normalizedPath = this._normalizeRemotePath(remotePath);
      await this._withBorrowedSftp(tabId, (sftp) =>
        this._chmod(sftp, normalizedPath, mode),
      );
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `设置权限失败: ${normalizeErrorMessage(error)}`,
      };
    }
  }

  async getFilePermissionsBatch(event, tabId, filePaths) {
    try {
      if (!Array.isArray(filePaths) || filePaths.length === 0) {
        return { success: true, results: [] };
      }

      const normalizedPaths = filePaths.map((p) =>
        this._normalizeRemotePath(p),
      );
      const results = [];

      await this._withBorrowedSftp(tabId, async (sftp) => {
        const tasks = normalizedPaths.map((filePath, index) => async () => {
          try {
            const stats = await this._stat(sftp, filePath);
            const mode = stats.mode;
            const permissions = (mode & parseInt("777", 8))
              .toString(8)
              .padStart(3, "0");
            results[index] = {
              path: filePath,
              success: true,
              permissions,
              mode,
              stats,
            };
          } catch (error) {
            results[index] = {
              path: filePath,
              success: false,
              error: normalizeErrorMessage(error),
            };
          }
        });

        await this._runConcurrent(tasks, 12);
      });

      return { success: true, results };
    } catch (error) {
      return {
        success: false,
        error: `批量获取权限失败: ${normalizeErrorMessage(error)}`,
      };
    }
  }

  async setFileOwnership(event, tabId, remotePath, owner, group) {
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

      const normalizedPath = this._normalizeRemotePath(remotePath);
      await this._withBorrowedSftp(tabId, async (sftp) => {
        let finalUid = ownerId;
        let finalGid = groupId;
        if (finalUid === null || finalGid === null) {
          const stats = await this._stat(sftp, normalizedPath);
          if (finalUid === null) finalUid = stats.uid;
          if (finalGid === null) finalGid = stats.gid;
        }
        await this._chown(sftp, normalizedPath, finalUid, finalGid);
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: `设置所有者/组失败: ${normalizeErrorMessage(error)}`,
      };
    }
  }

  async createRemoteFolders(event, tabId, folderPath) {
    try {
      const normalizedPath = this._normalizeRemotePath(folderPath);
      await this._withBorrowedSftp(tabId, async (sftp) => {
        await this._mkdirRecursiveWithSession(sftp, normalizedPath);
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async _ensureRemoteDirectories(tabId, remoteDirs) {
    const uniqueDirs = Array.from(
      new Set(
        (remoteDirs || [])
          .map((dir) => this._normalizeRemotePath(dir))
          .filter((dir) => dir && dir !== "." && dir !== "/"),
      ),
    );

    if (uniqueDirs.length === 0) return;

    uniqueDirs.sort((a, b) => {
      const depthA = a.split("/").filter(Boolean).length;
      const depthB = b.split("/").filter(Boolean).length;
      return depthA - depthB;
    });

    await this._withBorrowedSftp(tabId, async (sftp) => {
      const created = new Set(["", ".", "/"]);
      for (const fullDirPath of uniqueDirs) {
        const isAbsolute = fullDirPath.startsWith("/");
        const parts = fullDirPath.split("/").filter(Boolean);
        let currentPath = isAbsolute ? "/" : "";

        for (const part of parts) {
          currentPath = currentPath ? path.posix.join(currentPath, part) : part;
          if (created.has(currentPath)) continue;
          await this._mkdirIfNeeded(sftp, currentPath);
          created.add(currentPath);
        }
      }
    });
  }

  async _scanLocalFolder(localFolderPath) {
    const normalizedRoot = path.resolve(localFolderPath);
    const stack = [{ absPath: normalizedRoot, relPath: "" }];
    const files = [];
    const directories = new Set();
    let totalBytes = 0;

    while (stack.length > 0) {
      const current = stack.pop();
      const entries = await fsp.readdir(current.absPath, {
        withFileTypes: true,
      });
      for (const entry of entries) {
        const abs = path.join(current.absPath, entry.name);
        const rel = current.relPath
          ? path.posix.join(current.relPath, entry.name)
          : entry.name;

        if (entry.isDirectory()) {
          directories.add(rel);
          stack.push({ absPath: abs, relPath: rel });
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const stats = await fsp.stat(abs);
        const fileSize = Number.isFinite(stats?.size) ? stats.size : 0;
        totalBytes += fileSize;
        files.push({
          localPath: abs,
          relativePath: toPosixPath(rel),
          fileName: entry.name,
          size: fileSize,
        });
      }
    }

    return {
      files,
      directories: Array.from(directories),
      totalBytes,
    };
  }

  async _scanRemoteFolderTree(tabId, remoteRootPath) {
    const rootPath = this._normalizeRemotePath(remoteRootPath);
    const queue = [{ remotePath: rootPath, relativePath: "" }];
    const files = [];
    const directories = new Set();
    let totalBytes = 0;

    await this._withBorrowedSftp(tabId, async (sftp) => {
      while (queue.length > 0) {
        const current = queue.shift();
        const entries = await this._readdir(sftp, current.remotePath);

        for (const item of entries) {
          const name = item?.filename;
          if (!name || name === "." || name === "..") continue;

          const remotePath = path.posix.join(current.remotePath, name);
          const relativePath = current.relativePath
            ? path.posix.join(current.relativePath, name)
            : name;
          const mode = item?.attrs?.mode;

          if (isDirectoryMode(mode)) {
            directories.add(relativePath);
            queue.push({ remotePath, relativePath });
            continue;
          }

          const fileSize = Number.isFinite(item?.attrs?.size)
            ? item.attrs.size
            : 0;
          totalBytes += fileSize;
          files.push({
            remotePath,
            relativePath,
            fileName: name,
            size: fileSize,
          });
        }
      }
    });

    return {
      files,
      directories: Array.from(directories),
      totalBytes,
    };
  }

  _getDownloadFolderName(remoteFolderPath) {
    const normalized = this._normalizeRemotePath(remoteFolderPath).replace(
      /\/+$/,
      "",
    );
    if (!normalized || normalized === "." || normalized === "/") {
      return "remote-folder";
    }
    return path.posix.basename(normalized);
  }

  async _downloadFileToPath({
    tabId,
    transferKey,
    remotePath,
    localPath,
    knownSize,
    onBytes,
  }) {
    const normalizedRemotePath = this._normalizeRemotePath(remotePath);
    const tmpPath = `${localPath}.part`;
    await fsp.mkdir(path.dirname(localPath), { recursive: true });

    try {
      const downloadedSize = await this._withTransferRetry(
        transferKey,
        async () =>
          this._withBorrowedSftp(tabId, async (sftp) => {
            let fileSize = knownSize;
            if (!Number.isFinite(fileSize) || fileSize < 0) {
              const stats = await this._stat(sftp, normalizedRemotePath);
              fileSize = Number.isFinite(stats?.size) ? stats.size : 0;
            }

            const chunkSize = this._chooseChunkSize(fileSize);
            const readStream = sftp.createReadStream(normalizedRemotePath, {
              highWaterMark: chunkSize,
            });
            const writeStream = fs.createWriteStream(tmpPath, {
              highWaterMark: chunkSize,
            });

            await this._pumpStreams({
              transferKey,
              readStream,
              writeStream,
              onBytes,
            });
            return fileSize;
          }),
      );

      await fsp.rename(tmpPath, localPath);
      return downloadedSize;
    } catch (error) {
      try {
        await fsp.rm(tmpPath, { force: true });
      } catch {
        // ignore cleanup failure
      }
      throw error;
    }
  }

  async downloadFile(event, tabId, remotePath) {
    let transferKey = null;
    try {
      const sender = event?.sender;
      const normalizedRemotePath = this._normalizeRemotePath(remotePath);
      const defaultName = path.posix.basename(normalizedRemotePath);
      const defaultTargetPath = path.join(
        this._resolveDownloadBasePath(tabId),
        defaultName || "downloaded-file",
      );

      const dialogWindow = this._resolveDialogWindow();
      const { canceled, filePath } = await dialog.showSaveDialog(
        dialogWindow || undefined,
        {
          title: "保存文件",
          defaultPath: defaultTargetPath,
          buttonLabel: "下载",
        },
      );

      if (canceled || !filePath) {
        return { success: false, cancelled: true, error: "用户取消下载" };
      }

      transferKey = this._generateTransferKey(tabId, "download");
      this._registerTransfer({
        transferKey,
        tabId,
        type: "download",
        sender,
        progressChannel: "download-progress",
        totalFiles: 1,
      });

      let fileSize = 0;
      try {
        fileSize = await this._withBorrowedSftp(tabId, async (sftp) => {
          const stats = await this._stat(sftp, normalizedRemotePath);
          return Number.isFinite(stats?.size) ? stats.size : 0;
        });
      } catch {
        fileSize = 0;
      }
      const state = this._getTransfer(transferKey);
      if (state) state.totalBytes = fileSize;

      this._emitTransferProgress(transferKey, {
        channel: "download-progress",
        force: true,
        fileName: defaultName || normalizedRemotePath,
        currentFile: defaultName || normalizedRemotePath,
      });

      await this._downloadFileToPath({
        tabId,
        transferKey,
        remotePath: normalizedRemotePath,
        localPath: filePath,
        knownSize: fileSize,
        onBytes: (bytes) => {
          const current = this._getTransfer(transferKey);
          if (!current) return;
          current.transferredBytes += bytes;
          this._emitTransferProgress(transferKey, {
            channel: "download-progress",
            fileName: defaultName || normalizedRemotePath,
            currentFile: defaultName || normalizedRemotePath,
            currentFileIndex: 1,
          });
        },
      });

      const finalState = this._getTransfer(transferKey);
      if (finalState) {
        finalState.processedFiles = 1;
        finalState.transferredBytes = Math.max(
          finalState.transferredBytes,
          finalState.totalBytes,
        );
      }

      this._emitTransferProgress(transferKey, {
        channel: "download-progress",
        force: true,
        fileName: defaultName || normalizedRemotePath,
        currentFile: defaultName || normalizedRemotePath,
        currentFileIndex: 1,
      });

      this._finalizeTransfer(transferKey);
      return {
        success: true,
        transferKey,
        downloadPath: filePath,
        message: "下载完成",
      };
    } catch (error) {
      if (transferKey) this._finalizeTransfer(transferKey);
      if (isCancelledError(error)) {
        return { success: false, cancelled: true, error: "用户取消下载" };
      }
      this._log(
        `downloadFile failed: ${normalizeErrorMessage(error)}`,
        "ERROR",
      );
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async downloadFiles(event, tabId, files) {
    let transferKey = null;
    try {
      if (!Array.isArray(files) || files.length === 0) {
        return { success: false, error: "没有选择要下载的文件" };
      }

      const sender = event?.sender;
      const dialogWindow = this._resolveDialogWindow();
      const { canceled, filePaths } = await dialog.showOpenDialog(
        dialogWindow || undefined,
        {
          title: "选择保存目录",
          defaultPath: this._resolveDownloadBasePath(tabId),
          buttonLabel: "选择目录",
          properties: ["openDirectory", "createDirectory"],
        },
      );
      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, cancelled: true, error: "用户取消下载" };
      }

      const targetDir = filePaths[0];
      const totalFiles = files.length;
      const totalBytes = files.reduce(
        (sum, file) => sum + (Number.isFinite(file?.size) ? file.size : 0),
        0,
      );

      transferKey = this._generateTransferKey(tabId, "batch-download");
      this._registerTransfer({
        transferKey,
        tabId,
        type: "batch-download",
        sender,
        progressChannel: "download-progress",
        totalBytes,
        totalFiles,
      });

      this._emitTransferProgress(transferKey, {
        channel: "download-progress",
        force: true,
        isBatch: true,
        fileName: `批量下载 (${totalFiles} 个文件)`,
      });

      let completed = 0;
      let failed = 0;
      const errors = [];
      const concurrency = this._chooseConcurrency(
        totalFiles,
        totalBytes,
        false,
      );

      const tasks = files.map((file, index) => async () => {
        if (this._isTransferCancelled(transferKey)) {
          throw buildCancelledError();
        }

        const remote = this._normalizeRemotePath(file?.remotePath || "");
        const fileName = file?.fileName || path.posix.basename(remote);
        const localPath = path.join(targetDir, fileName);
        const knownSize = Number.isFinite(file?.size) ? file.size : 0;

        try {
          await this._downloadFileToPath({
            tabId,
            transferKey,
            remotePath: remote,
            localPath,
            knownSize,
            onBytes: (bytes) => {
              const state = this._getTransfer(transferKey);
              if (!state) return;
              state.transferredBytes += bytes;
              this._emitTransferProgress(transferKey, {
                channel: "download-progress",
                isBatch: true,
                fileName,
                currentFile: fileName,
                currentFileIndex: index + 1,
              });
            },
          });

          completed += 1;
          const state = this._getTransfer(transferKey);
          if (state) state.processedFiles += 1;
          this._emitTransferProgress(transferKey, {
            channel: "download-progress",
            force: true,
            isBatch: true,
            fileName,
            currentFile: fileName,
            currentFileIndex: index + 1,
          });
        } catch (error) {
          if (isCancelledError(error)) {
            throw error;
          }
          failed += 1;
          errors.push({ fileName, error: normalizeErrorMessage(error) });
        }
      });

      await this._runConcurrent(tasks, concurrency, () =>
        this._isTransferCancelled(transferKey),
      );

      if (this._isTransferCancelled(transferKey)) {
        this._emitTransferProgress(transferKey, {
          channel: "download-progress",
          force: true,
          isBatch: true,
          fileName: "批量下载已取消",
          extra: {
            cancelled: true,
            userCancelled: true,
            operationComplete: true,
          },
        });
        this._finalizeTransfer(transferKey);
        return {
          success: false,
          cancelled: true,
          userCancelled: true,
          completed,
          failed,
          errors,
          targetDir,
        };
      }

      const state = this._getTransfer(transferKey);
      if (state) {
        state.processedFiles = completed + failed;
        if (failed === 0) {
          state.transferredBytes = Math.max(
            state.transferredBytes,
            state.totalBytes,
          );
        }
      }

      this._emitTransferProgress(transferKey, {
        channel: "download-progress",
        force: true,
        isBatch: true,
        fileName:
          failed === 0
            ? `批量下载完成 (${completed}/${totalFiles})`
            : `批量下载完成，失败 ${failed} 个文件`,
      });
      this._finalizeTransfer(transferKey);

      if (failed === 0)
        return { success: true, completed, failed, errors, targetDir };
      if (completed > 0) {
        return {
          success: true,
          partialSuccess: true,
          completed,
          failed,
          errors,
          warning: `部分下载失败，已完成 ${completed}/${totalFiles} 个文件`,
          targetDir,
        };
      }
      return {
        success: false,
        completed,
        failed,
        errors,
        error: "全部文件下载失败",
        targetDir,
      };
    } catch (error) {
      if (transferKey) this._finalizeTransfer(transferKey);
      if (isCancelledError(error)) {
        return { success: false, cancelled: true, error: "用户取消下载" };
      }
      this._log(
        `downloadFiles failed: ${normalizeErrorMessage(error)}`,
        "ERROR",
      );
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async downloadFolder(event, tabId, remoteFolderPath) {
    let transferKey = null;
    try {
      const sender = event?.sender;
      const normalizedRemoteRoot = this._normalizeRemotePath(remoteFolderPath);
      const folderName = this._getDownloadFolderName(normalizedRemoteRoot);

      const dialogWindow = this._resolveDialogWindow();
      const { canceled, filePaths } = await dialog.showOpenDialog(
        dialogWindow || undefined,
        {
          title: "选择保存目录",
          defaultPath: this._resolveDownloadBasePath(tabId),
          buttonLabel: "选择目录",
          properties: ["openDirectory", "createDirectory"],
        },
      );

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, cancelled: true, error: "用户取消下载" };
      }

      const targetRootDir = filePaths[0];
      const localFolderPath = path.join(targetRootDir, folderName);
      await fsp.mkdir(localFolderPath, { recursive: true });

      const tree = await this._scanRemoteFolderTree(
        tabId,
        normalizedRemoteRoot,
      );
      const totalFiles = tree.files.length;
      const totalBytes = tree.totalBytes;

      transferKey = this._generateTransferKey(tabId, "download-folder");
      this._registerTransfer({
        transferKey,
        tabId,
        type: "download-folder",
        sender,
        progressChannel: "download-folder-progress",
        totalBytes,
        totalFiles: Math.max(1, totalFiles),
      });

      this._emitTransferProgress(transferKey, {
        channel: "download-folder-progress",
        force: true,
        fileName: folderName,
        currentFile: "",
      });

      for (const relativeDir of tree.directories) {
        const localDirPath = path.join(
          localFolderPath,
          toPosixPath(relativeDir),
        );
        await fsp.mkdir(localDirPath, { recursive: true });
      }

      let completed = 0;
      let failed = 0;
      const errors = [];
      const concurrency = this._chooseConcurrency(totalFiles, totalBytes, true);

      const tasks = tree.files.map((file, index) => async () => {
        if (this._isTransferCancelled(transferKey)) {
          throw buildCancelledError();
        }

        const localPath = path.join(
          localFolderPath,
          toPosixPath(file.relativePath),
        );
        try {
          await this._downloadFileToPath({
            tabId,
            transferKey,
            remotePath: file.remotePath,
            localPath,
            knownSize: file.size,
            onBytes: (bytes) => {
              const state = this._getTransfer(transferKey);
              if (!state) return;
              state.transferredBytes += bytes;
              this._emitTransferProgress(transferKey, {
                channel: "download-folder-progress",
                fileName: folderName,
                currentFile: file.relativePath,
                currentFileIndex: index + 1,
              });
            },
          });

          completed += 1;
          const state = this._getTransfer(transferKey);
          if (state) state.processedFiles += 1;
          this._emitTransferProgress(transferKey, {
            channel: "download-folder-progress",
            force: true,
            fileName: folderName,
            currentFile: file.relativePath,
            currentFileIndex: index + 1,
          });
        } catch (error) {
          if (isCancelledError(error)) {
            throw error;
          }
          failed += 1;
          errors.push({
            fileName: file.relativePath,
            error: normalizeErrorMessage(error),
          });
        }
      });

      await this._runConcurrent(tasks, concurrency, () =>
        this._isTransferCancelled(transferKey),
      );

      if (this._isTransferCancelled(transferKey)) {
        this._emitTransferProgress(transferKey, {
          channel: "download-folder-progress",
          force: true,
          fileName: folderName,
          extra: {
            cancelled: true,
            userCancelled: true,
            operationComplete: true,
          },
        });
        this._finalizeTransfer(transferKey);
        return {
          success: false,
          cancelled: true,
          userCancelled: true,
          completed,
          failed,
          errors,
          downloadPath: localFolderPath,
        };
      }

      const state = this._getTransfer(transferKey);
      if (state) {
        state.processedFiles = completed + failed;
        if (failed === 0) {
          state.transferredBytes = Math.max(
            state.transferredBytes,
            state.totalBytes,
          );
        }
      }

      this._emitTransferProgress(transferKey, {
        channel: "download-folder-progress",
        force: true,
        fileName: folderName,
        currentFile: "",
        extra: { operationComplete: true },
      });
      this._finalizeTransfer(transferKey);

      if (failed === 0) {
        return {
          success: true,
          completed,
          failed,
          errors,
          downloadPath: localFolderPath,
          message: "文件夹下载完成",
        };
      }
      if (completed > 0) {
        return {
          success: true,
          partialSuccess: true,
          completed,
          failed,
          errors,
          warning: `部分文件下载失败，已完成 ${completed}/${totalFiles} 个文件`,
          downloadPath: localFolderPath,
        };
      }
      return {
        success: false,
        completed,
        failed,
        errors,
        error: "文件夹下载失败",
        downloadPath: localFolderPath,
      };
    } catch (error) {
      if (transferKey) this._finalizeTransfer(transferKey);
      if (isCancelledError(error)) {
        return { success: false, cancelled: true, error: "用户取消下载" };
      }
      this._log(
        `downloadFolder failed: ${normalizeErrorMessage(error)}`,
        "ERROR",
      );
      return { success: false, error: normalizeErrorMessage(error) };
    }
  }

  async _uploadEntry({
    tabId,
    transferKey,
    remotePath,
    localPath = null,
    buffer = null,
    knownSize = 0,
    onBytes,
  }) {
    const normalizedRemotePath = this._normalizeRemotePath(remotePath);

    await this._withTransferRetry(transferKey, async () =>
      this._withBorrowedSftp(tabId, async (sftp) => {
        let size = knownSize;
        if (localPath && (!Number.isFinite(size) || size <= 0)) {
          const stats = await fsp.stat(localPath);
          size = Number.isFinite(stats?.size) ? stats.size : 0;
        } else if (buffer && (!Number.isFinite(size) || size <= 0)) {
          size = buffer.length;
        }

        const chunkSize = this._chooseChunkSize(size);
        const writeStream = sftp.createWriteStream(normalizedRemotePath, {
          highWaterMark: chunkSize,
        });
        const readStream = localPath
          ? fs.createReadStream(localPath, { highWaterMark: chunkSize })
          : makeBufferReadStream(buffer || Buffer.alloc(0), chunkSize);

        await this._pumpStreams({
          transferKey,
          readStream,
          writeStream,
          onBytes,
        });
      }),
    );
  }

  _extractDroppedFileBuffer(fileData) {
    if (!fileData) return null;
    if (Buffer.isBuffer(fileData.data)) return fileData.data;

    if (Array.isArray(fileData.chunks) && fileData.chunks.length > 0) {
      const chunks = fileData.chunks.map((chunk) =>
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      );
      return Buffer.concat(chunks);
    }

    if (fileData.data) {
      return Buffer.from(fileData.data);
    }
    return null;
  }

  async _uploadEntries({
    event,
    tabId,
    entries,
    progressChannel,
    transferType,
    displayName,
    includeOperationComplete = false,
  }) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return { success: false, error: "没有有效的文件可上传" };
    }

    const sender = event?.sender;
    const totalFiles = entries.length;
    const totalBytes = entries.reduce(
      (sum, entry) => sum + (Number.isFinite(entry.size) ? entry.size : 0),
      0,
    );

    const transferKey = this._generateTransferKey(tabId, transferType);
    this._registerTransfer({
      transferKey,
      tabId,
      type: transferType,
      sender,
      progressChannel,
      totalBytes,
      totalFiles,
    });

    this._emitTransferProgress(transferKey, {
      force: true,
      fileName: displayName || "准备上传",
      currentFile: "",
      currentFileIndex: 0,
      extra: includeOperationComplete
        ? { operationComplete: false, cancelled: false }
        : {},
    });

    const directories = [];
    for (const entry of entries) {
      directories.push(
        path.posix.dirname(this._normalizeRemotePath(entry.remotePath)),
      );
    }
    await this._ensureRemoteDirectories(tabId, directories);

    const concurrency = this._chooseConcurrency(totalFiles, totalBytes, true);
    let uploadedCount = 0;
    let failedCount = 0;
    const errors = [];

    const tasks = entries.map((entry, index) => async () => {
      if (this._isTransferCancelled(transferKey)) {
        throw buildCancelledError();
      }

      const fileLabel =
        entry.relativePath ||
        entry.fileName ||
        path.basename(entry.localPath || "");

      try {
        await this._uploadEntry({
          tabId,
          transferKey,
          remotePath: entry.remotePath,
          localPath: entry.localPath || null,
          buffer: entry.buffer || null,
          knownSize: entry.size,
          onBytes: (bytes) => {
            const state = this._getTransfer(transferKey);
            if (!state) return;
            state.transferredBytes += bytes;
            this._emitTransferProgress(transferKey, {
              fileName: displayName || fileLabel,
              currentFile: fileLabel,
              currentFileIndex: index + 1,
              extra: includeOperationComplete
                ? { operationComplete: false, cancelled: false }
                : {},
            });
          },
        });

        uploadedCount += 1;
        const state = this._getTransfer(transferKey);
        if (state) state.processedFiles += 1;
        this._emitTransferProgress(transferKey, {
          force: true,
          fileName: displayName || fileLabel,
          currentFile: fileLabel,
          currentFileIndex: index + 1,
          extra: includeOperationComplete
            ? { operationComplete: false, cancelled: false }
            : {},
        });
      } catch (error) {
        if (isCancelledError(error)) {
          throw error;
        }
        failedCount += 1;
        errors.push({
          fileName: fileLabel,
          error: normalizeErrorMessage(error),
        });
      }
    });

    await this._runConcurrent(tasks, concurrency, () =>
      this._isTransferCancelled(transferKey),
    );

    if (this._isTransferCancelled(transferKey)) {
      this._emitTransferProgress(transferKey, {
        force: true,
        fileName: "上传已取消",
        currentFile: "",
        currentFileIndex: 0,
        extra: {
          cancelled: true,
          userCancelled: true,
          operationComplete: true,
        },
      });
      this._finalizeTransfer(transferKey);
      return {
        success: true,
        cancelled: true,
        userCancelled: true,
        message: "用户已取消操作",
      };
    }

    const state = this._getTransfer(transferKey);
    if (state) {
      state.processedFiles = uploadedCount + failedCount;
      if (failedCount === 0) {
        state.transferredBytes = Math.max(
          state.transferredBytes,
          state.totalBytes,
        );
      }
    }

    this._emitTransferProgress(transferKey, {
      force: true,
      fileName:
        failedCount === 0 ? "上传完成" : `上传完成，失败 ${failedCount} 个文件`,
      currentFile: "",
      currentFileIndex: totalFiles,
      extra: { operationComplete: true, cancelled: false },
    });
    this._finalizeTransfer(transferKey);

    if (failedCount === 0) {
      return {
        success: true,
        uploadedCount,
        totalFiles,
        failedCount,
        transferKey,
        message: "上传完成",
      };
    }
    if (uploadedCount > 0) {
      return {
        success: true,
        partialSuccess: true,
        uploadedCount,
        totalFiles,
        failedCount,
        errors,
        transferKey,
        warning: `部分上传失败，已完成 ${uploadedCount}/${totalFiles} 个文件`,
      };
    }
    return {
      success: false,
      uploadedCount,
      totalFiles,
      failedCount,
      errors,
      transferKey,
      error: "上传失败",
    };
  }

  async uploadFile(event, tabId, targetFolder, progressChannel) {
    try {
      const dialogWindow = this._resolveDialogWindow();
      const { canceled, filePaths } = await dialog.showOpenDialog(
        dialogWindow || undefined,
        {
          title: "选择要上传的文件",
          properties: ["openFile", "multiSelections"],
          buttonLabel: "上传文件",
        },
      );

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, cancelled: true, error: "用户取消上传" };
      }

      const normalizedTarget = this._normalizeRemotePath(targetFolder);
      const entries = [];
      for (const localPath of filePaths) {
        const stats = await fsp.stat(localPath);
        if (!stats.isFile()) continue;
        const fileName = path.basename(localPath);
        entries.push({
          localPath,
          fileName,
          relativePath: fileName,
          remotePath: this._joinRemotePath(normalizedTarget, fileName),
          size: Number.isFinite(stats.size) ? stats.size : 0,
        });
      }

      return this._uploadEntries({
        event,
        tabId,
        entries,
        progressChannel,
        transferType: "upload-multifile",
        displayName: "上传文件",
        includeOperationComplete: true,
      });
    } catch (error) {
      if (isCancelledError(error)) {
        return { success: false, cancelled: true, error: "用户取消上传" };
      }
      return {
        success: false,
        error: `上传文件失败: ${normalizeErrorMessage(error)}`,
      };
    }
  }

  async uploadDroppedFiles(
    event,
    tabId,
    targetFolder,
    uploadData,
    progressChannel,
  ) {
    try {
      const normalizedTarget = this._normalizeRemotePath(targetFolder);
      const rawFiles = Array.isArray(uploadData?.files)
        ? uploadData.files
        : Array.isArray(uploadData)
          ? uploadData
          : [];

      const entries = [];
      for (const fileData of rawFiles) {
        if (!fileData) continue;

        const relativePath = toPosixPath(
          fileData.relativePath || fileData.name || "unnamed-file",
        );
        const remotePath = this._joinRemotePath(normalizedTarget, relativePath);
        const fileName = path.posix.basename(relativePath);

        if (fileData.localPath && fs.existsSync(fileData.localPath)) {
          const stats = await fsp.stat(fileData.localPath);
          entries.push({
            localPath: fileData.localPath,
            fileName,
            relativePath,
            remotePath,
            size: Number.isFinite(stats.size) ? stats.size : 0,
          });
          continue;
        }

        const buffer = this._extractDroppedFileBuffer(fileData);
        if (!buffer) continue;
        entries.push({
          buffer,
          fileName,
          relativePath,
          remotePath,
          size: buffer.length,
        });
      }

      return this._uploadEntries({
        event,
        tabId,
        entries,
        progressChannel,
        transferType: "upload-multifile",
        displayName: "拖拽上传",
        includeOperationComplete: true,
      });
    } catch (error) {
      if (isCancelledError(error)) {
        return {
          success: true,
          cancelled: true,
          userCancelled: true,
          message: "用户已取消操作",
        };
      }
      return {
        success: false,
        error: `上传文件失败: ${normalizeErrorMessage(error)}`,
      };
    }
  }

  async uploadFolder(event, tabId, targetFolder, progressChannel) {
    try {
      const dialogWindow = this._resolveDialogWindow();
      const { canceled, filePaths } = await dialog.showOpenDialog(
        dialogWindow || undefined,
        {
          title: "选择要上传的文件夹",
          properties: ["openDirectory"],
          buttonLabel: "上传文件夹",
        },
      );

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, cancelled: true, error: "用户取消上传" };
      }

      const localFolderPath = filePaths[0];
      const folderName = path.basename(localFolderPath);
      const normalizedTarget = this._normalizeRemotePath(targetFolder);
      const remoteBase = this._joinRemotePath(normalizedTarget, folderName);

      const scan = await this._scanLocalFolder(localFolderPath);
      if (!scan.files || scan.files.length === 0) {
        return {
          success: true,
          uploadedCount: 0,
          totalFiles: 0,
          failedCount: 0,
          message: "文件夹为空，无需上传。",
        };
      }

      const entries = scan.files.map((file) => ({
        localPath: file.localPath,
        fileName: file.fileName,
        relativePath: file.relativePath,
        remotePath: this._joinRemotePath(remoteBase, file.relativePath),
        size: file.size,
      }));

      const result = await this._uploadEntries({
        event,
        tabId,
        entries,
        progressChannel,
        transferType: "upload-folder",
        displayName: folderName,
        includeOperationComplete: true,
      });

      if (result.success) {
        return { ...result, remotePath: remoteBase };
      }
      return result;
    } catch (error) {
      if (isCancelledError(error)) {
        return {
          success: true,
          cancelled: true,
          userCancelled: true,
          message: "用户已取消操作",
        };
      }
      return {
        success: false,
        error: `上传文件夹失败: ${normalizeErrorMessage(error)}`,
      };
    }
  }

  cleanup() {
    for (const [transferKey, transfer] of this.activeTransfers.entries()) {
      try {
        transfer.cancelled = true;
        this._destroyTransferStreams(transferKey, "Application cleanup");
      } catch {
        // ignore cleanup error
      }
      this.activeTransfers.delete(transferKey);
    }
    this._log(
      "All active Filemanagement transfers have been cleaned up",
      "INFO",
    );
  }
}

module.exports = new FilemanagementService();
