const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const crypto = require("crypto");
const { app, dialog, shell, BrowserWindow } = require("electron");

const processManager = require("../../core/process/processManager");
const { getTransferNativeScannerPath } = require("../../core/utils/nativeTransferSidecar");
const { processSSHPrivateKeyAsync } = require("../../core/utils/ssh-utils");
const nativeSftpClient = require("../../core/utils/nativeSftpClient");
const { logToFile } = require("../../core/utils/logger");
const connectionManager = require("../connection");
const TransferProcessPool = require("./transferProcessPool");

const DIRECTORY_TYPE_MASK = 0o170000;
const DIRECTORY_MODE = 0o040000;
const DEFAULT_PROGRESS_INTERVAL_MS = 200;
const DEFAULT_STALL_TIMEOUT_MS = 45000;
const MAX_TRANSFER_RETRIES = 2;
const RETRY_BACKOFF_BASE_MS = 300;
const PREPARATION_PROGRESS_PERCENT = 5;
const EVENT_LOOP_LAG_INTERVAL_MS = 1000;
const TRANSFER_ENGINE_MODE = "process-worker-pool-v1";
const CHUNK_PARALLEL_THRESHOLD_BYTES = 128 * 1024 * 1024;
const CHUNK_PARALLEL_TARGET_CHUNK_BYTES = 32 * 1024 * 1024;
const CHUNK_PARALLEL_MAX_SEGMENTS = 16;
const CHUNK_PARALLEL_MIN_SEGMENTS = 2;
const TRANSFER_POOL_IDLE_SHUTDOWN_MS = 2500;

function buildEmptyTransferPoolStats() {
  return {
    workerCount: 0,
    targetWorkerCount: 0,
    maxWorkers: 0,
    queuedTasks: 0,
    pendingTasks: 0,
    pendingInits: 0,
    activeTransfers: 0,
    cancelledTransfers: 0,
    maxQueueSize: 0,
    shutdown: true,
  };
}

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
    this.transferEngineMode = TRANSFER_ENGINE_MODE;
    this.activeTransfers = new Map();
    this.inflightDirectoryReads = new Map();
    this.transferProcessPool = null;
    this.transferProcessPoolIdleTimer = null;
    this.transferMetrics = {
      startedAt: Date.now(),
      successfulTransfers: 0,
      failedTransfers: 0,
      cancelledTransfers: 0,
      totalTasks: 0,
      failedTasks: 0,
      totalBytesTransferred: 0,
      cancelLatencySamples: [],
      latestTransferThroughput: 0,
      eventLoopLag: {
        latestMs: 0,
        maxMs: 0,
        totalMs: 0,
        samples: 0,
      },
    };
    this.eventLoopLagTimer = null;
    this._startEventLoopLagMonitor();
  }

  _log(message, level = "INFO") {
    if (typeof logToFile === "function") {
      logToFile(`[Filemanagement] ${message}`, level);
    }
  }

  _startEventLoopLagMonitor() {
    if (this.eventLoopLagTimer) {
      clearInterval(this.eventLoopLagTimer);
      this.eventLoopLagTimer = null;
    }

    let expected = Date.now() + EVENT_LOOP_LAG_INTERVAL_MS;
    this.eventLoopLagTimer = setInterval(() => {
      const now = Date.now();
      const lag = Math.max(0, now - expected);
      expected = now + EVENT_LOOP_LAG_INTERVAL_MS;

      const stats = this.transferMetrics.eventLoopLag;
      stats.latestMs = lag;
      stats.maxMs = Math.max(stats.maxMs, lag);
      stats.totalMs += lag;
      stats.samples += 1;
    }, EVENT_LOOP_LAG_INTERVAL_MS);

    if (typeof this.eventLoopLagTimer.unref === "function") {
      this.eventLoopLagTimer.unref();
    }
  }

  _stopEventLoopLagMonitor() {
    if (this.eventLoopLagTimer) {
      clearInterval(this.eventLoopLagTimer);
      this.eventLoopLagTimer = null;
    }
  }

  _clearTransferProcessPoolIdleTimer() {
    if (this.transferProcessPoolIdleTimer) {
      clearTimeout(this.transferProcessPoolIdleTimer);
      this.transferProcessPoolIdleTimer = null;
    }
  }

  _ensureTransferProcessPool() {
    this._clearTransferProcessPoolIdleTimer();

    const currentStats = this.transferProcessPool?.getRuntimeStats?.();
    if (!this.transferProcessPool || currentStats?.shutdown) {
      this.transferProcessPool = new TransferProcessPool();
      this._log("Transfer process pool initialized", "INFO");
    }

    return this.transferProcessPool;
  }

  _scheduleTransferProcessPoolIdleShutdown() {
    this._clearTransferProcessPoolIdleTimer();

    if (!this.transferProcessPool || this.activeTransfers.size > 0) {
      return;
    }

    this.transferProcessPoolIdleTimer = setTimeout(() => {
      this.transferProcessPoolIdleTimer = null;

      const pool = this.transferProcessPool;
      if (!pool || this.activeTransfers.size > 0) {
        return;
      }

      const poolStats = pool.getRuntimeStats?.() || buildEmptyTransferPoolStats();
      const hasPendingWork =
        (poolStats.queuedTasks || 0) > 0 ||
        (poolStats.pendingTasks || 0) > 0 ||
        (poolStats.pendingInits || 0) > 0 ||
        (poolStats.activeTransfers || 0) > 0;

      if (hasPendingWork) {
        this._scheduleTransferProcessPoolIdleShutdown();
        return;
      }

      if (this.transferProcessPool !== pool) {
        return;
      }

      this.transferProcessPool = null;

      pool.shutdown()
        .catch((error) => {
          this._log(
            `Idle transfer process pool shutdown failed: ${normalizeErrorMessage(error)}`,
            "WARN",
          );
        })
        .finally(() => {
          this._log("Transfer process pool shutdown after idle", "INFO");
        });
    }, TRANSFER_POOL_IDLE_SHUTDOWN_MS);

    if (typeof this.transferProcessPoolIdleTimer.unref === "function") {
      this.transferProcessPoolIdleTimer.unref();
    }
  }

  _recordTransferMetrics({
    transferredBytes = 0,
    completed = 0,
    failed = 0,
    cancelled = false,
    durationMs = 0,
  }) {
    const metrics = this.transferMetrics;
    const safeCompleted = Math.max(0, Number(completed) || 0);
    const safeFailed = Math.max(0, Number(failed) || 0);
    const safeBytes = Math.max(0, Number(transferredBytes) || 0);
    const safeDurationMs = Math.max(0, Number(durationMs) || 0);

    metrics.totalTasks += safeCompleted + safeFailed;
    metrics.failedTasks += safeFailed;
    metrics.totalBytesTransferred += safeBytes;

    if (cancelled) {
      metrics.cancelledTransfers += 1;
    } else if (safeFailed > 0) {
      metrics.failedTransfers += 1;
    } else {
      metrics.successfulTransfers += 1;
    }

    if (safeDurationMs > 0) {
      metrics.latestTransferThroughput =
        safeBytes / Math.max(0.001, safeDurationMs / 1000);
    }
  }

  _recordCancelLatency(transfer) {
    if (!transfer?.cancelRequestedAt) return;
    if (transfer.cancelLatencyRecorded) return;
    const latencyMs = Math.max(0, Date.now() - transfer.cancelRequestedAt);
    this.transferMetrics.cancelLatencySamples.push(latencyMs);
    if (this.transferMetrics.cancelLatencySamples.length > 100) {
      this.transferMetrics.cancelLatencySamples.shift();
    }
    transfer.cancelLatencyRecorded = true;
  }

  _generateTaskId(prefix = "task") {
    return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
  }

  async _resolveTransferSshConfig(tabId) {
    const processInfo = processManager.getProcess(tabId);
    const rawConfig = processInfo?.config;
    if (!rawConfig?.host || !rawConfig?.username) {
      throw new Error("SSH connection config is unavailable");
    }

    const sshConfig = await processSSHPrivateKeyAsync({
      host: rawConfig.host,
      port: rawConfig.port || 22,
      username: rawConfig.username,
      password: rawConfig.password || undefined,
      privateKey: rawConfig.privateKey || undefined,
      privateKeyPath: rawConfig.privateKeyPath || undefined,
      passphrase: rawConfig.passphrase || undefined,
      readyTimeout: rawConfig.readyTimeout || undefined,
      keepaliveInterval: rawConfig.keepaliveInterval || undefined,
      keepaliveCountMax: rawConfig.keepaliveCountMax || undefined,
    });

    if (sshConfig?.privateKeyPath && sshConfig.privateKey) {
      delete sshConfig.privateKeyPath;
    }

    const proxyManager = connectionManager?.sshConnectionPool?.proxyManager;
    if (
      proxyManager &&
      typeof proxyManager.resolveProxyConfigAsync === "function"
    ) {
      try {
        const resolvedProxy =
          await proxyManager.resolveProxyConfigAsync(rawConfig);
        if (resolvedProxy) {
          sshConfig.proxy = resolvedProxy;
        }
      } catch (error) {
        this._log(
          `Resolve proxy for transfer tab=${tabId} failed: ${normalizeErrorMessage(error)}`,
          "WARN",
        );
      }
    }

    return sshConfig;
  }

  async _materializeUploadEntry(entry, transferKey, index) {
    if (entry?.localPath) {
      return {
        localPath: entry.localPath,
        tempPath: null,
      };
    }

    if (!entry?.buffer) {
      throw new Error("Upload entry has no localPath or buffer");
    }

    const tempRoot = path.join(os.tmpdir(), "simpleshell-upload-buffer");
    const transferDir = path.join(tempRoot, transferKey);
    await fsp.mkdir(transferDir, { recursive: true });
    const tempPath = path.join(
      transferDir,
      `${String(index).padStart(5, "0")}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}.tmp`,
    );
    await fsp.writeFile(tempPath, entry.buffer);
    return {
      localPath: tempPath,
      tempPath,
    };
  }

  async _cleanupTempUploadSources(tempPaths = []) {
    if (!Array.isArray(tempPaths) || tempPaths.length === 0) return;
    const uniquePaths = Array.from(new Set(tempPaths.filter(Boolean)));
    await Promise.allSettled(
      uniquePaths.map((filePath) => fsp.rm(filePath, { force: true })),
    );
  }

  getTransferRuntimeStats() {
    const metrics = this.transferMetrics;
    const elapsedSec = Math.max(0.001, (Date.now() - metrics.startedAt) / 1000);
    const cancelSamples = metrics.cancelLatencySamples;
    const avgCancelLatencyMs =
      cancelSamples.length > 0
        ? cancelSamples.reduce((sum, value) => sum + value, 0) /
          cancelSamples.length
        : 0;
    const failureRate =
      metrics.totalTasks > 0 ? metrics.failedTasks / metrics.totalTasks : 0;
    const lag = metrics.eventLoopLag;

    return {
      transferEngineMode: this.transferEngineMode,
      activeTransferCount: this.activeTransfers.size,
      throughputBytesPerSec: metrics.totalBytesTransferred / elapsedSec,
      latestTransferThroughput: metrics.latestTransferThroughput,
      failureRate,
      avgCancelLatencyMs,
      eventLoopLag: {
        latestMs: lag.latestMs,
        maxMs: lag.maxMs,
        avgMs: lag.samples > 0 ? lag.totalMs / lag.samples : 0,
        samples: lag.samples,
      },
      pool: this.transferProcessPool
        ? this.transferProcessPool.getRuntimeStats()
        : buildEmptyTransferPoolStats(),
      poolIdleShutdownScheduled: Boolean(this.transferProcessPoolIdleTimer),
    };
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

  _toShimStats(result) {
    const stats = result?.stats || result || {};
    return {
      size: Number.isFinite(stats.size) ? stats.size : 0,
      mode: Number.isFinite(stats.mode) ? stats.mode : 0,
      uid: Number.isFinite(stats.uid) ? stats.uid : 0,
      gid: Number.isFinite(stats.gid) ? stats.gid : 0,
      mtime: Number.isFinite(stats.modifyTime)
        ? Math.floor(stats.modifyTime / 1000)
        : 0,
      atime: Number.isFinite(stats.accessTime)
        ? Math.floor(stats.accessTime / 1000)
        : 0,
    };
  }

  _toShimDirEntry(item) {
    return {
      filename: item?.name || "",
      attrs: {
        size: Number.isFinite(item?.size) ? item.size : 0,
        mode: Number.isFinite(item?.mode) ? item.mode : 0,
        uid: Number.isFinite(item?.uid) ? item.uid : 0,
        gid: Number.isFinite(item?.gid) ? item.gid : 0,
        mtime: Number.isFinite(item?.modifyTime)
          ? Math.floor(item.modifyTime / 1000)
          : 0,
        atime: Number.isFinite(item?.accessTime)
          ? Math.floor(item.accessTime / 1000)
          : 0,
      },
    };
  }

  _createNativeSftpShim(tabId) {
    return {
      stat: (remotePath, callback) => {
        nativeSftpClient
          .getFilePermissions(tabId, remotePath)
          .then((result) => {
            if (!result?.success) {
              callback(new Error(result?.error || "stat failed"));
              return;
            }
            callback(null, this._toShimStats(result));
          })
          .catch(callback);
      },
      lstat: (remotePath, callback) => {
        nativeSftpClient
          .getFilePermissions(tabId, remotePath)
          .then((result) => {
            if (!result?.success) {
              callback(new Error(result?.error || "lstat failed"));
              return;
            }
            callback(null, this._toShimStats(result));
          })
          .catch(callback);
      },
      readdir: (remotePath, callback) => {
        nativeSftpClient
          .listFiles(tabId, remotePath)
          .then((result) => {
            if (!result?.success) {
              callback(new Error(result?.error || "readdir failed"));
              return;
            }
            callback(
              null,
              (Array.isArray(result.data) ? result.data : []).map((item) =>
                this._toShimDirEntry(item),
              ),
            );
          })
          .catch(callback);
      },
      rename: (sourcePath, targetPath, callback) => {
        nativeSftpClient
          .renameFile(tabId, sourcePath, targetPath)
          .then((result) =>
            result?.success
              ? callback(null)
              : callback(new Error(result?.error || "rename failed")),
          )
          .catch(callback);
      },
      unlink: (remotePath, callback) => {
        nativeSftpClient
          .deleteFile(tabId, remotePath, false)
          .then((result) =>
            result?.success
              ? callback(null)
              : callback(new Error(result?.error || "unlink failed")),
          )
          .catch(callback);
      },
      rmdir: (remotePath, callback) => {
        nativeSftpClient
          .deleteFile(tabId, remotePath, true)
          .then((result) =>
            result?.success
              ? callback(null)
              : callback(new Error(result?.error || "rmdir failed")),
          )
          .catch(callback);
      },
      mkdir: (remotePath, callback) => {
        nativeSftpClient
          .createFolder(tabId, remotePath)
          .then((result) =>
            result?.success
              ? callback(null)
              : callback(new Error(result?.error || "mkdir failed")),
          )
          .catch(callback);
      },
      chmod: (remotePath, mode, callback) => {
        nativeSftpClient
          .setFilePermissions(
            tabId,
            remotePath,
            (mode & 0o7777).toString(8).padStart(3, "0"),
          )
          .then((result) =>
            result?.success
              ? callback(null)
              : callback(new Error(result?.error || "chmod failed")),
          )
          .catch(callback);
      },
      chown: (remotePath, uid, gid, callback) => {
        nativeSftpClient
          .setFileOwnership(tabId, remotePath, uid, gid)
          .then((result) =>
            result?.success
              ? callback(null)
              : callback(new Error(result?.error || "chown failed")),
          )
          .catch(callback);
      },
      open: (remotePath, _flags, callback) => {
        nativeSftpClient
          .createFile(tabId, remotePath)
          .then((result) =>
            result?.success
              ? callback(null, { path: remotePath })
              : callback(new Error(result?.error || "open failed")),
          )
          .catch(callback);
      },
      close: (_handle, callback) => {
        callback(null);
      },
    };
  }

  async _withBorrowedSftp(tabId, worker) {
    return worker(this._createNativeSftpShim(tabId), null);
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

  _shouldUseChunkParallel(totalBytes) {
    const size = Number.isFinite(totalBytes) ? totalBytes : 0;
    return size >= CHUNK_PARALLEL_THRESHOLD_BYTES;
  }

  _buildChunkSegments(totalBytes) {
    const size = Number.isFinite(totalBytes) ? Math.floor(totalBytes) : 0;
    if (size <= 0 || !this._shouldUseChunkParallel(size)) {
      return [];
    }

    const estimatedCount = Math.ceil(size / CHUNK_PARALLEL_TARGET_CHUNK_BYTES);
    const segmentCount = Math.max(
      CHUNK_PARALLEL_MIN_SEGMENTS,
      Math.min(CHUNK_PARALLEL_MAX_SEGMENTS, estimatedCount),
    );
    const segmentSize = Math.max(1, Math.ceil(size / segmentCount));
    const segments = [];
    let offset = 0;
    let index = 0;

    while (offset < size) {
      const remaining = size - offset;
      const length = Math.min(segmentSize, remaining);
      segments.push({
        index,
        offset,
        length,
      });
      offset += length;
      index += 1;
    }

    return segments;
  }

  _buildFileTaskKey(direction, remotePath, localPath, index) {
    return `${direction || "transfer"}::${index}::${remotePath || ""}::${localPath || ""}`;
  }

  async _prepareRemoteChunkUploadTarget(tabId, remotePath) {
    const normalizedRemotePath = this._normalizeRemotePath(remotePath);
    await this._withBorrowedSftp(tabId, async (sftp) => {
      const handle = await this._openFileHandle(
        sftp,
        normalizedRemotePath,
        "w",
      );
      await this._closeFileHandle(sftp, handle);
    });
  }

  async _prepareLocalChunkDownloadTarget(tempPath, totalBytes) {
    await fsp.mkdir(path.dirname(tempPath), { recursive: true });
    const handle = await fsp.open(tempPath, "w");
    await handle.close();
    await fsp.truncate(tempPath, Math.max(0, Number(totalBytes) || 0));
  }

  async _cleanupLocalTempPaths(paths = []) {
    if (!Array.isArray(paths) || paths.length === 0) return;
    const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
    await Promise.allSettled(
      uniquePaths.map((filePath) => fsp.rm(filePath, { force: true })),
    );
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
    this._clearTransferProcessPoolIdleTimer();

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
      preparationTotal: 0,
      preparationCompleted: 0,
      startAt: Date.now(),
      lastEmitAt: 0,
      cancelled: false,
      cancelRequestedAt: 0,
      cancelLatencyRecorded: false,
      activeStreams: new Set(),
      metadata: { ...metadata },
      transferEngineMode: this.transferEngineMode,
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

  _setTransferPreparation(transferKey, totalSteps = 0) {
    const transfer = this._getTransfer(transferKey);
    if (!transfer) return null;

    transfer.preparationTotal = Math.max(0, totalSteps || 0);
    transfer.preparationCompleted = 0;
    return transfer;
  }

  _advanceTransferPreparation(transferKey, steps = 1) {
    const transfer = this._getTransfer(transferKey);
    if (!transfer) return null;

    transfer.preparationCompleted = Math.min(
      transfer.preparationTotal,
      transfer.preparationCompleted + Math.max(0, steps || 0),
    );
    return transfer;
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
    const byteProgress =
      transfer.totalBytes > 0
        ? Math.min(100, (transfer.transferredBytes / transfer.totalBytes) * 100)
        : transfer.processedFiles >= transfer.totalFiles
          ? 100
          : 0;
    const hasPreparation = transfer.preparationTotal > 0;
    const preparationRatio = hasPreparation
      ? Math.min(
          1,
          transfer.preparationCompleted / Math.max(1, transfer.preparationTotal),
        )
      : 0;
    let progress = byteProgress;

    if (progress < 100 && hasPreparation) {
      const preparationProgress =
        preparationRatio * PREPARATION_PROGRESS_PERCENT;
      progress =
        byteProgress > 0
          ? Math.max(
              preparationProgress,
              PREPARATION_PROGRESS_PERCENT +
                (byteProgress / 100) * (100 - PREPARATION_PROGRESS_PERCENT),
            )
          : preparationProgress;
    }

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
      preparationCompleted: transfer.preparationCompleted,
      preparationTotal: transfer.preparationTotal,
      isBatch,
      ...extra,
    };

    const finalChannel = channel || transfer.progressChannel;
    this._safeSend(transfer.sender, finalChannel, payload);
  }

  _finalizeTransfer(transferKey) {
    const transfer = this._getTransfer(transferKey);
    if (!transfer) return;
    if (transfer.cancelled) {
      this._recordCancelLatency(transfer);
    }
    this._destroyTransferStreams(transferKey, "Transfer finalized");
    this.activeTransfers.delete(transferKey);

    if (this.activeTransfers.size === 0) {
      this._scheduleTransferProcessPoolIdleShutdown();
    }
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
      await this._mkdir(sftp, remotePath);
      return;
    } catch (mkdirError) {
      if (!isPathExistsError(mkdirError)) {
        const stats = await this._stat(sftp, remotePath).catch(() => null);
        if (isDirectoryMode(stats?.mode)) {
          return;
        }
        throw mkdirError;
      }

      const stats = await this._stat(sftp, remotePath).catch(() => null);
      if (isDirectoryMode(stats?.mode)) {
        return;
      }
      if (stats) {
        throw new Error(`Path exists and is not a directory: ${remotePath}`);
      }
      throw mkdirError;
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
      return await nativeSftpClient.copyFile(tabId, source, target);
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
      return await nativeSftpClient.getAbsolutePath(tabId, remotePath);
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
    transfer.cancelRequestedAt = transfer.cancelRequestedAt || Date.now();
    if (this.transferProcessPool) {
      this.transferProcessPool.cancelTransfer(transferKey);
    }
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

  cleanupTransfersForTab(tabId) {
    if (tabId === undefined || tabId === null) {
      return { success: false, cleanedCount: 0, error: "Invalid tabId" };
    }

    let cleanedCount = 0;
    for (const [transferKey, transfer] of this.activeTransfers.entries()) {
      if (String(transfer.tabId) !== String(tabId)) continue;
      transfer.cancelled = true;
      transfer.cancelRequestedAt = transfer.cancelRequestedAt || Date.now();
      if (this.transferProcessPool) {
        this.transferProcessPool.cancelTransfer(transferKey);
      }
      this._destroyTransferStreams(
        transferKey,
        "Transfer cancelled due to tab cleanup",
      );
      this._emitTransferProgress(transferKey, {
        force: true,
        fileName: "传输已取消",
        extra: {
          cancelled: true,
          userCancelled: true,
          operationComplete: true,
        },
      });
      cleanedCount += 1;
    }

    return {
      success: true,
      cleanedCount,
      message: `Cleaned ${cleanedCount} transfer(s) for tab ${tabId}`,
    };
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

  async _ensureRemoteDirectories(
    tabId,
    remoteDirs,
    { transferKey = null, displayName = "准备上传", progressExtra = {} } = {},
  ) {
    const uniqueDirs = Array.from(
      new Set(
        (remoteDirs || [])
          .map((dir) => this._normalizeRemotePath(dir))
          .filter((dir) => dir && dir !== "." && dir !== "/"),
      ),
    );

    if (transferKey) {
      this._setTransferPreparation(transferKey, uniqueDirs.length);
    }

    if (uniqueDirs.length === 0) return;

    uniqueDirs.sort((a, b) => {
      const depthA = a.split("/").filter(Boolean).length;
      const depthB = b.split("/").filter(Boolean).length;
      return depthA - depthB;
    });

    await this._withBorrowedSftp(tabId, async (sftp) => {
      const created = new Set(["", ".", "/"]);
      for (let index = 0; index < uniqueDirs.length; index += 1) {
        const fullDirPath = uniqueDirs[index];
        const isAbsolute = fullDirPath.startsWith("/");
        const parts = fullDirPath.split("/").filter(Boolean);
        let currentPath = isAbsolute ? "/" : "";

        for (const part of parts) {
          currentPath = currentPath ? path.posix.join(currentPath, part) : part;
          if (created.has(currentPath)) continue;
          await this._mkdirIfNeeded(sftp, currentPath);
          created.add(currentPath);
        }

        if (transferKey) {
          const transfer = this._advanceTransferPreparation(transferKey);
          this._emitTransferProgress(transferKey, {
            fileName: displayName || "准备上传",
            currentFile: `正在创建目录 ${index + 1}/${uniqueDirs.length}: ${fullDirPath}`,
            extra: {
              preparationCompleted: transfer?.preparationCompleted || 0,
              preparationTotal: transfer?.preparationTotal || uniqueDirs.length,
              ...progressExtra,
            },
          });
        }
      }
    });

    if (transferKey) {
      const transfer = this._getTransfer(transferKey);
      this._emitTransferProgress(transferKey, {
        force: true,
        fileName: displayName || "准备上传",
        currentFile: "目录结构已就绪，开始传输文件",
        extra: {
          preparationCompleted: transfer?.preparationCompleted || 0,
          preparationTotal: transfer?.preparationTotal || uniqueDirs.length,
          ...progressExtra,
        },
      });
    }
  }

  async _scanLocalFolderWithNativeSidecar(localFolderPath) {
    const scannerPath = getTransferNativeScannerPath();
    if (!scannerPath) {
      throw new Error(
        "Rust transfer sidecar is required for folder scanning but was not found",
      );
    }

    return new Promise((resolve, reject) => {
      execFile(
        scannerPath,
        ["scan-folder", "--path", localFolderPath],
        {
          windowsHide: true,
          maxBuffer: 128 * 1024 * 1024,
          timeout: 60000,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(
              new Error(
                stderr?.trim() ||
                  stdout?.trim() ||
                  normalizeErrorMessage(error),
              ),
            );
            return;
          }

          const payload = String(stdout || "").trim();
          if (!payload) {
            reject(new Error("Native scanner returned empty output"));
            return;
          }

          try {
            resolve(JSON.parse(payload));
          } catch (parseError) {
            reject(
              new Error(
                `Native scanner returned invalid JSON: ${normalizeErrorMessage(parseError)}`,
              ),
            );
          }
        },
      );
    });
  }

  async _scanLocalFolder(localFolderPath) {
    const normalizedRoot = path.resolve(localFolderPath);
    const normalizeScanResult = (scanResult) => {
      const rawFiles = Array.isArray(scanResult?.files) ? scanResult.files : [];
      const files = rawFiles.map((file) => {
        const relativePath = toPosixPath(
          file?.relativePath || file?.path || file?.name || "",
        );
        const localPath = file?.localPath || file?.path || "";
        return {
          localPath,
          relativePath,
          fileName:
            file?.fileName ||
            file?.name ||
            path.basename(localPath || relativePath),
          size: Number.isFinite(file?.size) ? file.size : 0,
        };
      });

      const totalBytesFromPayload =
        Number.isFinite(scanResult?.totalBytes) && scanResult.totalBytes >= 0
          ? scanResult.totalBytes
          : Number.isFinite(scanResult?.totalSize) && scanResult.totalSize >= 0
            ? scanResult.totalSize
            : files.reduce(
                (sum, file) => sum + (Number.isFinite(file.size) ? file.size : 0),
                0,
              );

      return {
        files,
        directories: [],
        totalBytes: totalBytesFromPayload,
      };
    };
    const nativeScan = await this._scanLocalFolderWithNativeSidecar(
      normalizedRoot,
    );
    return normalizeScanResult(nativeScan);
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
    const sshConfig = await this._resolveTransferSshConfig(tabId);
    const taskId = this._generateTaskId("download-single");
    const fileLabel =
      path.posix.basename(normalizedRemotePath) || normalizedRemotePath;
    let trackedBytes = 0;
    let taskFailedMessage = null;

    try {
      const transferProcessPool = this._ensureTransferProcessPool();
      await transferProcessPool.runTasks({
        transferKey,
        tabId,
        sshConfig,
        tasks: [
          {
            taskId,
            direction: "download",
            remotePath: normalizedRemotePath,
            localPath: tmpPath,
            totalBytes:
              Number.isFinite(knownSize) && knownSize > 0
                ? knownSize
                : undefined,
            fileName: fileLabel,
            currentFile: fileLabel,
            maxRetries: MAX_TRANSFER_RETRIES,
            noProgressTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
          },
        ],
        maxConcurrency: 1,
        onProgress: (message) => {
          if (message?.taskId !== taskId) return;
          const delta = Math.max(0, Number(message?.deltaBytes) || 0);
          if (delta <= 0) return;
          trackedBytes += delta;
          if (typeof onBytes === "function") {
            onBytes(delta);
          }
        },
        onTaskDone: (message) => {
          if (message?.taskId !== taskId) return;
          const reportedTotal =
            Number.isFinite(knownSize) && knownSize > 0
            ? knownSize
            : Number(message?.totalBytes) || 0;
          const remainder = Math.max(0, reportedTotal - trackedBytes);
          if (remainder <= 0) return;
          trackedBytes += remainder;
          if (typeof onBytes === "function") {
            onBytes(remainder);
          }
        },
        onTaskError: (message) => {
          if (
            message?.error?.cancelled ||
            this._isTransferCancelled(transferKey)
          ) {
            return;
          }
          taskFailedMessage =
            message?.error?.message || "Download task failed";
        },
      });

      if (this._isTransferCancelled(transferKey)) {
        throw buildCancelledError();
      }
      if (taskFailedMessage) {
        throw new Error(taskFailedMessage);
      }

      await fsp.rename(tmpPath, localPath);
      return trackedBytes;
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
    let chunkTempPath = null;
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

      if (this._buildChunkSegments(fileSize).length > 0) {
        const sshConfig = await this._resolveTransferSshConfig(tabId);
        const chunkSegments = this._buildChunkSegments(fileSize);
        chunkTempPath = `${filePath}.part`;
        await this._prepareLocalChunkDownloadTarget(chunkTempPath, fileSize);

        const taskMetaMap = new Map();
        const taskTransferredBytes = new Map();
        let chunkTaskFailed = false;
        const chunkErrors = [];
        const tasks = chunkSegments.map((segment) => {
          const taskId = this._generateTaskId("download-single-chunk");
          taskMetaMap.set(taskId, {
            knownSize: segment.length,
            segmentIndex: segment.index,
            segmentCount: chunkSegments.length,
          });
          return {
            taskId,
            direction: "download",
            remotePath: normalizedRemotePath,
            localPath: chunkTempPath,
            totalBytes: segment.length,
            fileName: defaultName || normalizedRemotePath,
            currentFile: defaultName || normalizedRemotePath,
            segmentOffset: segment.offset,
            segmentLength: segment.length,
            segmentIndex: segment.index,
            segmentCount: chunkSegments.length,
            localWriteFlags: "r+",
            skipLocalTempRename: true,
            maxRetries: MAX_TRANSFER_RETRIES,
            noProgressTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
          };
        });

        const transferProcessPool = this._ensureTransferProcessPool();
        await transferProcessPool.runTasks({
          transferKey,
          tabId,
          sshConfig,
          tasks,
          maxConcurrency: this._chooseConcurrency(
            chunkSegments.length,
            fileSize,
            false,
          ),
          onProgress: (message) => {
            const taskMeta = taskMetaMap.get(message?.taskId);
            if (!taskMeta) return;
            const deltaBytes = Math.max(0, Number(message?.deltaBytes) || 0);
            if (deltaBytes > 0) {
              taskTransferredBytes.set(
                message.taskId,
                (taskTransferredBytes.get(message.taskId) || 0) + deltaBytes,
              );
            }
            const current = this._getTransfer(transferKey);
            if (!current) return;
            current.transferredBytes += deltaBytes;
            this._emitTransferProgress(transferKey, {
              channel: "download-progress",
              fileName: defaultName || normalizedRemotePath,
              currentFile: defaultName || normalizedRemotePath,
              currentFileIndex: 1,
            });
          },
          onTaskDone: (message) => {
            const taskMeta = taskMetaMap.get(message?.taskId);
            if (!taskMeta) return;
            const current = this._getTransfer(transferKey);
            if (!current) return;
            const tracked = taskTransferredBytes.get(message.taskId) || 0;
            const reportedTotal = Number.isFinite(taskMeta.knownSize)
              ? taskMeta.knownSize
              : Number(message?.totalBytes) || 0;
            const remainder = Math.max(0, reportedTotal - tracked);
            current.transferredBytes += remainder;
          },
          onTaskError: (message) => {
            if (
              message?.error?.cancelled ||
              this._isTransferCancelled(transferKey)
            ) {
              return;
            }
            chunkTaskFailed = true;
            chunkErrors.push(
              message?.error?.message || "Download chunk task failed",
            );
          },
        });

        if (this._isTransferCancelled(transferKey)) {
          throw buildCancelledError();
        }
        if (chunkTaskFailed) {
          throw new Error(chunkErrors[0] || "Download chunk task failed");
        }
        await fsp.rename(chunkTempPath, filePath);
        chunkTempPath = null;
      } else {
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
      }

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

      this._recordTransferMetrics({
        transferredBytes: finalState?.transferredBytes || 0,
        completed: 1,
        failed: 0,
        cancelled: false,
        durationMs: finalState ? Date.now() - finalState.startAt : 0,
      });
      this._finalizeTransfer(transferKey);
      return {
        success: true,
        transferKey,
        downloadPath: filePath,
        message: "下载完成",
      };
    } catch (error) {
      if (chunkTempPath) {
        await this._cleanupLocalTempPaths([chunkTempPath]);
        chunkTempPath = null;
      }
      if (transferKey) {
        const transferState = this._getTransfer(transferKey);
        this._recordTransferMetrics({
          transferredBytes: transferState?.transferredBytes || 0,
          completed: 0,
          failed: isCancelledError(error) ? 0 : 1,
          cancelled: isCancelledError(error),
          durationMs: transferState ? Date.now() - transferState.startAt : 0,
        });
        this._recordCancelLatency(transferState);
        this._finalizeTransfer(transferKey);
      }
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
    const chunkTempCleanup = new Set();
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
      const sshConfig = await this._resolveTransferSshConfig(tabId);

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
      const taskMetaMap = new Map();
      const taskTransferredBytes = new Map();
      const fileStateMap = new Map();
      const tasks = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const remotePath = this._normalizeRemotePath(file?.remotePath || "");
        const fileName = file?.fileName || path.posix.basename(remotePath);
        const localPath = path.join(targetDir, fileName);
        const knownSize = Number.isFinite(file?.size) ? file.size : 0;
        const fileTaskKey = this._buildFileTaskKey(
          "download",
          remotePath,
          localPath,
          index,
        );
        const chunkSegments = this._buildChunkSegments(knownSize);

        if (chunkSegments.length > 0) {
          const tempPath = `${localPath}.part`;
          await this._prepareLocalChunkDownloadTarget(tempPath, knownSize);
          chunkTempCleanup.add(tempPath);
          fileStateMap.set(fileTaskKey, {
            fileTaskKey,
            index,
            fileName,
            localPath,
            tempPath,
            chunked: true,
            totalSegments: chunkSegments.length,
            completedSegments: 0,
            failed: false,
          });

          for (const segment of chunkSegments) {
            const taskId = this._generateTaskId("download-chunk");
            taskMetaMap.set(taskId, {
              fileTaskKey,
              index,
              fileName,
              knownSize: segment.length,
              chunked: true,
              segmentIndex: segment.index,
              totalSegments: chunkSegments.length,
              localPath,
              tempPath,
            });

            tasks.push({
              taskId,
              direction: "download",
              remotePath,
              localPath: tempPath,
              totalBytes: segment.length,
              fileName,
              currentFile: fileName,
              segmentOffset: segment.offset,
              segmentLength: segment.length,
              segmentIndex: segment.index,
              segmentCount: chunkSegments.length,
              localWriteFlags: "r+",
              skipLocalTempRename: true,
              maxRetries: MAX_TRANSFER_RETRIES,
              noProgressTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
            });
          }
          continue;
        }

        fileStateMap.set(fileTaskKey, {
          fileTaskKey,
          index,
          fileName,
          localPath,
          chunked: false,
          failed: false,
        });
        const taskId = this._generateTaskId("download");
        taskMetaMap.set(taskId, {
          fileTaskKey,
          index,
          fileName,
          knownSize,
          chunked: false,
        });
        tasks.push({
          taskId,
          direction: "download",
          remotePath,
          localPath,
          totalBytes: knownSize,
          fileName,
          currentFile: fileName,
          maxRetries: MAX_TRANSFER_RETRIES,
          noProgressTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
        });
      }
      const concurrency = this._chooseConcurrency(
        tasks.length,
        totalBytes,
        false,
      );

      const transferProcessPool = this._ensureTransferProcessPool();
      await transferProcessPool.runTasks({
        transferKey,
        tabId,
        sshConfig,
        tasks,
        maxConcurrency: concurrency,
        onProgress: (message) => {
          const taskId = message?.taskId;
          const taskMeta = taskMetaMap.get(taskId);
          if (!taskMeta) return;

          const deltaBytes = Math.max(0, Number(message?.deltaBytes) || 0);
          if (deltaBytes > 0) {
            taskTransferredBytes.set(
              taskId,
              (taskTransferredBytes.get(taskId) || 0) + deltaBytes,
            );
          }

          const state = this._getTransfer(transferKey);
          if (!state) return;
          state.transferredBytes += deltaBytes;

          this._emitTransferProgress(transferKey, {
            channel: "download-progress",
            isBatch: true,
            fileName: taskMeta.fileName,
            currentFile: taskMeta.fileName,
            currentFileIndex: taskMeta.index + 1,
          });
        },
        onTaskDone: (message) => {
          const taskId = message?.taskId;
          const taskMeta = taskMetaMap.get(taskId);
          if (!taskMeta) return;

          const state = this._getTransfer(transferKey);
          const reportedTotal = Number.isFinite(taskMeta.knownSize)
            ? taskMeta.knownSize
            : Number(message?.totalBytes) || 0;
          const tracked = taskTransferredBytes.get(taskId) || 0;
          const remainder = Math.max(0, reportedTotal - tracked);
          if (state) {
            state.transferredBytes += remainder;
          }

          const fileState = fileStateMap.get(taskMeta.fileTaskKey);
          if (!fileState) return;
          if (taskMeta.chunked) {
            fileState.completedSegments += 1;
          } else {
            completed += 1;
            if (state) {
              state.processedFiles += 1;
            }
          }

          this._emitTransferProgress(transferKey, {
            channel: "download-progress",
            force: !taskMeta.chunked,
            isBatch: true,
            fileName: taskMeta.fileName,
            currentFile: taskMeta.fileName,
            currentFileIndex: taskMeta.index + 1,
          });
        },
        onTaskError: (message) => {
          if (
            message?.error?.cancelled ||
            this._isTransferCancelled(transferKey)
          ) {
            return;
          }

          const taskMeta = taskMetaMap.get(message?.taskId);
          if (!taskMeta) return;
          const fileState = fileStateMap.get(taskMeta.fileTaskKey);
          if (!fileState) return;
          if (fileState.failed) return;

          fileState.failed = true;
          failed += 1;
          errors.push({
            fileName:
              taskMeta?.fileName ||
              message?.fileName ||
              message?.taskId ||
              "unknown-file",
            error: message?.error?.message || "Download task failed",
          });
        },
      });

      if (this._isTransferCancelled(transferKey)) {
        await this._cleanupLocalTempPaths(Array.from(chunkTempCleanup));
        chunkTempCleanup.clear();
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
        const cancelledState = this._getTransfer(transferKey);
        this._recordTransferMetrics({
          transferredBytes: cancelledState?.transferredBytes || 0,
          completed,
          failed,
          cancelled: true,
          durationMs: cancelledState ? Date.now() - cancelledState.startAt : 0,
        });
        this._recordCancelLatency(cancelledState);
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

      for (const fileState of fileStateMap.values()) {
        if (!fileState.chunked || fileState.failed) continue;
        if (fileState.completedSegments < fileState.totalSegments) {
          fileState.failed = true;
          failed += 1;
          errors.push({
            fileName: fileState.fileName,
            error: "Download chunk incomplete",
          });
          continue;
        }

        try {
          await fsp.rename(fileState.tempPath, fileState.localPath);
          chunkTempCleanup.delete(fileState.tempPath);
          completed += 1;

          const state = this._getTransfer(transferKey);
          if (state) {
            state.processedFiles += 1;
          }

          this._emitTransferProgress(transferKey, {
            channel: "download-progress",
            force: true,
            isBatch: true,
            fileName: fileState.fileName,
            currentFile: fileState.fileName,
            currentFileIndex: fileState.index + 1,
          });
        } catch (renameError) {
          fileState.failed = true;
          failed += 1;
          errors.push({
            fileName: fileState.fileName,
            error: `Chunk merge failed: ${normalizeErrorMessage(renameError)}`,
          });
        }
      }

      const failedTempPaths = [];
      for (const fileState of fileStateMap.values()) {
        if (!fileState.chunked || !fileState.failed) continue;
        failedTempPaths.push(fileState.tempPath);
      }
      await this._cleanupLocalTempPaths(failedTempPaths);
      for (const tempPath of failedTempPaths) {
        chunkTempCleanup.delete(tempPath);
      }

      if (this._isTransferCancelled(transferKey)) {
        await this._cleanupLocalTempPaths(Array.from(chunkTempCleanup));
        chunkTempCleanup.clear();
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
        const cancelledState = this._getTransfer(transferKey);
        this._recordTransferMetrics({
          transferredBytes: cancelledState?.transferredBytes || 0,
          completed,
          failed,
          cancelled: true,
          durationMs: cancelledState ? Date.now() - cancelledState.startAt : 0,
        });
        this._recordCancelLatency(cancelledState);
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
      const transferState = this._getTransfer(transferKey);
      this._recordTransferMetrics({
        transferredBytes: transferState?.transferredBytes || 0,
        completed,
        failed,
        cancelled: false,
        durationMs: transferState ? Date.now() - transferState.startAt : 0,
      });

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
      await this._cleanupLocalTempPaths(Array.from(chunkTempCleanup));
      chunkTempCleanup.clear();
      if (transferKey) {
        const transferState = this._getTransfer(transferKey);
        this._recordTransferMetrics({
          transferredBytes: transferState?.transferredBytes || 0,
          completed: 0,
          failed: 1,
          cancelled: isCancelledError(error),
          durationMs: transferState ? Date.now() - transferState.startAt : 0,
        });
        this._recordCancelLatency(transferState);
        this._finalizeTransfer(transferKey);
      }
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
    const chunkTempCleanup = new Set();
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
      const sshConfig = await this._resolveTransferSshConfig(tabId);

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
      const taskMetaMap = new Map();
      const taskTransferredBytes = new Map();
      const fileStateMap = new Map();
      const tasks = [];
      for (let index = 0; index < tree.files.length; index += 1) {
        const file = tree.files[index];
        const localPath = path.join(
          localFolderPath,
          toPosixPath(file.relativePath),
        );
        const remotePath = this._normalizeRemotePath(file.remotePath);
        const knownSize = Number.isFinite(file.size) ? file.size : 0;
        const fileTaskKey = this._buildFileTaskKey(
          "download-folder",
          remotePath,
          localPath,
          index,
        );
        const chunkSegments = this._buildChunkSegments(knownSize);

        if (chunkSegments.length > 0) {
          const tempPath = `${localPath}.part`;
          await this._prepareLocalChunkDownloadTarget(tempPath, knownSize);
          chunkTempCleanup.add(tempPath);
          fileStateMap.set(fileTaskKey, {
            fileTaskKey,
            index,
            fileName: file.relativePath,
            localPath,
            tempPath,
            chunked: true,
            totalSegments: chunkSegments.length,
            completedSegments: 0,
            failed: false,
          });

          for (const segment of chunkSegments) {
            const taskId = this._generateTaskId("download-folder-chunk");
            taskMetaMap.set(taskId, {
              fileTaskKey,
              index,
              fileName: file.relativePath,
              knownSize: segment.length,
              chunked: true,
              segmentIndex: segment.index,
              totalSegments: chunkSegments.length,
              localPath,
              tempPath,
            });
            tasks.push({
              taskId,
              direction: "download",
              remotePath,
              localPath: tempPath,
              totalBytes: segment.length,
              fileName: file.relativePath,
              currentFile: file.relativePath,
              segmentOffset: segment.offset,
              segmentLength: segment.length,
              segmentIndex: segment.index,
              segmentCount: chunkSegments.length,
              localWriteFlags: "r+",
              skipLocalTempRename: true,
              maxRetries: MAX_TRANSFER_RETRIES,
              noProgressTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
            });
          }
          continue;
        }

        fileStateMap.set(fileTaskKey, {
          fileTaskKey,
          index,
          fileName: file.relativePath,
          localPath,
          chunked: false,
          failed: false,
        });
        const taskId = this._generateTaskId("download-folder");
        taskMetaMap.set(taskId, {
          fileTaskKey,
          index,
          fileName: file.relativePath,
          knownSize,
          chunked: false,
        });
        tasks.push({
          taskId,
          direction: "download",
          remotePath,
          localPath,
          totalBytes: knownSize,
          fileName: file.relativePath,
          currentFile: file.relativePath,
          maxRetries: MAX_TRANSFER_RETRIES,
          noProgressTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
        });
      }
      const concurrency = this._chooseConcurrency(
        tasks.length,
        totalBytes,
        true,
      );

      const transferProcessPool = this._ensureTransferProcessPool();
      await transferProcessPool.runTasks({
        transferKey,
        tabId,
        sshConfig,
        tasks,
        maxConcurrency: concurrency,
        onProgress: (message) => {
          const taskMeta = taskMetaMap.get(message?.taskId);
          if (!taskMeta) return;
          const deltaBytes = Math.max(0, Number(message?.deltaBytes) || 0);
          if (deltaBytes > 0) {
            taskTransferredBytes.set(
              message.taskId,
              (taskTransferredBytes.get(message.taskId) || 0) + deltaBytes,
            );
          }

          const state = this._getTransfer(transferKey);
          if (!state) return;
          state.transferredBytes += deltaBytes;
          this._emitTransferProgress(transferKey, {
            channel: "download-folder-progress",
            fileName: folderName,
            currentFile: taskMeta.fileName,
            currentFileIndex: taskMeta.index + 1,
          });
        },
        onTaskDone: (message) => {
          const taskMeta = taskMetaMap.get(message?.taskId);
          if (!taskMeta) return;
          const state = this._getTransfer(transferKey);
          const reportedTotal = Number.isFinite(taskMeta.knownSize)
            ? taskMeta.knownSize
            : Number(message?.totalBytes) || 0;
          const tracked = taskTransferredBytes.get(message.taskId) || 0;
          const remainder = Math.max(0, reportedTotal - tracked);
          if (state) {
            state.transferredBytes += remainder;
          }

          const fileState = fileStateMap.get(taskMeta.fileTaskKey);
          if (!fileState) return;
          if (taskMeta.chunked) {
            fileState.completedSegments += 1;
          } else {
            completed += 1;
            if (state) {
              state.processedFiles += 1;
            }
          }

          this._emitTransferProgress(transferKey, {
            channel: "download-folder-progress",
            force: !taskMeta.chunked,
            fileName: folderName,
            currentFile: taskMeta.fileName,
            currentFileIndex: taskMeta.index + 1,
          });
        },
        onTaskError: (message) => {
          if (
            message?.error?.cancelled ||
            this._isTransferCancelled(transferKey)
          ) {
            return;
          }

          const taskMeta = taskMetaMap.get(message?.taskId);
          if (!taskMeta) return;
          const fileState = fileStateMap.get(taskMeta.fileTaskKey);
          if (!fileState) return;
          if (fileState.failed) return;

          fileState.failed = true;
          failed += 1;
          errors.push({
            fileName:
              taskMeta?.fileName ||
              message?.fileName ||
              message?.taskId ||
              "unknown-file",
            error: message?.error?.message || "Download task failed",
          });
        },
      });

      if (this._isTransferCancelled(transferKey)) {
        await this._cleanupLocalTempPaths(Array.from(chunkTempCleanup));
        chunkTempCleanup.clear();
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
        const cancelledState = this._getTransfer(transferKey);
        this._recordTransferMetrics({
          transferredBytes: cancelledState?.transferredBytes || 0,
          completed,
          failed,
          cancelled: true,
          durationMs: cancelledState ? Date.now() - cancelledState.startAt : 0,
        });
        this._recordCancelLatency(cancelledState);
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

      for (const fileState of fileStateMap.values()) {
        if (!fileState.chunked || fileState.failed) continue;
        if (fileState.completedSegments < fileState.totalSegments) {
          fileState.failed = true;
          failed += 1;
          errors.push({
            fileName: fileState.fileName,
            error: "Download chunk incomplete",
          });
          continue;
        }

        try {
          await fsp.rename(fileState.tempPath, fileState.localPath);
          chunkTempCleanup.delete(fileState.tempPath);
          completed += 1;

          const state = this._getTransfer(transferKey);
          if (state) {
            state.processedFiles += 1;
          }

          this._emitTransferProgress(transferKey, {
            channel: "download-folder-progress",
            force: true,
            fileName: folderName,
            currentFile: fileState.fileName,
            currentFileIndex: fileState.index + 1,
          });
        } catch (renameError) {
          fileState.failed = true;
          failed += 1;
          errors.push({
            fileName: fileState.fileName,
            error: `Chunk merge failed: ${normalizeErrorMessage(renameError)}`,
          });
        }
      }

      const failedTempPaths = [];
      for (const fileState of fileStateMap.values()) {
        if (!fileState.chunked || !fileState.failed) continue;
        failedTempPaths.push(fileState.tempPath);
      }
      await this._cleanupLocalTempPaths(failedTempPaths);
      for (const tempPath of failedTempPaths) {
        chunkTempCleanup.delete(tempPath);
      }

      if (this._isTransferCancelled(transferKey)) {
        await this._cleanupLocalTempPaths(Array.from(chunkTempCleanup));
        chunkTempCleanup.clear();
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
        const cancelledState = this._getTransfer(transferKey);
        this._recordTransferMetrics({
          transferredBytes: cancelledState?.transferredBytes || 0,
          completed,
          failed,
          cancelled: true,
          durationMs: cancelledState ? Date.now() - cancelledState.startAt : 0,
        });
        this._recordCancelLatency(cancelledState);
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
      const transferState = this._getTransfer(transferKey);
      this._recordTransferMetrics({
        transferredBytes: transferState?.transferredBytes || 0,
        completed,
        failed,
        cancelled: false,
        durationMs: transferState ? Date.now() - transferState.startAt : 0,
      });

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
      await this._cleanupLocalTempPaths(Array.from(chunkTempCleanup));
      chunkTempCleanup.clear();
      if (transferKey) {
        const transferState = this._getTransfer(transferKey);
        this._recordTransferMetrics({
          transferredBytes: transferState?.transferredBytes || 0,
          completed: 0,
          failed: 1,
          cancelled: isCancelledError(error),
          durationMs: transferState ? Date.now() - transferState.startAt : 0,
        });
        this._recordCancelLatency(transferState);
        this._finalizeTransfer(transferKey);
      }
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
    let uploadSourcePath = localPath;
    let cleanupTempPath = null;

    if (!uploadSourcePath && buffer) {
      cleanupTempPath = path.join(
        os.tmpdir(),
        `simpleshell-upload-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.tmp`,
      );
      await fsp.writeFile(cleanupTempPath, buffer);
      uploadSourcePath = cleanupTempPath;
    }

    try {
      await this._withTransferRetry(transferKey, async () => {
        let size = knownSize;
        if (uploadSourcePath && (!Number.isFinite(size) || size <= 0)) {
          const stats = await fsp.stat(uploadSourcePath);
          size = Number.isFinite(stats?.size) ? stats.size : 0;
        }
        const result = await nativeSftpClient.uploadFile(
          tabId,
          uploadSourcePath,
          normalizedRemotePath,
          {
            onProgress: (payload) => {
              const delta = Math.max(0, Number(payload?.deltaBytes) || 0);
              if (delta > 0 && typeof onBytes === "function") {
                onBytes(delta);
              }
            },
            remoteWriteFlags: "w",
          },
        );
        if (!result?.success) {
          throw new Error(result?.error || "upload failed");
        }
      });
    } finally {
      if (cleanupTempPath) {
        await fsp.rm(cleanupTempPath, { force: true }).catch(() => {});
      }
    }
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
    remoteDirectories = [],
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
    const sshConfig = await this._resolveTransferSshConfig(tabId);

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

    let uploadedCount = 0;
    let failedCount = 0;
    const errors = [];
    const taskMetaMap = new Map();
    const taskTransferredBytes = new Map();
    const fileStateMap = new Map();
    const tempUploadPaths = [];

    try {
      const directories = Array.isArray(remoteDirectories)
        ? [...remoteDirectories]
        : [];
      for (const entry of entries) {
        directories.push(
          path.posix.dirname(this._normalizeRemotePath(entry.remotePath)),
        );
      }
      await this._ensureRemoteDirectories(tabId, directories, {
        transferKey,
        displayName,
        progressExtra: includeOperationComplete
          ? { operationComplete: false, cancelled: false }
          : {},
      });

      const tasks = [];
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const normalizedRemotePath = this._normalizeRemotePath(
          entry.remotePath,
        );
        const materialized = await this._materializeUploadEntry(
          entry,
          transferKey,
          index,
        );
        if (materialized.tempPath) {
          tempUploadPaths.push(materialized.tempPath);
        }

        const fileLabel =
          entry.relativePath ||
          entry.fileName ||
          path.basename(materialized.localPath || "");
        const knownSize = Number.isFinite(entry.size) ? entry.size : 0;
        const fileTaskKey = this._buildFileTaskKey(
          "upload",
          normalizedRemotePath,
          materialized.localPath,
          index,
        );
        const chunkSegments = this._buildChunkSegments(knownSize);

        if (chunkSegments.length > 0 && materialized.localPath) {
          await this._prepareRemoteChunkUploadTarget(
            tabId,
            normalizedRemotePath,
          );
          fileStateMap.set(fileTaskKey, {
            fileTaskKey,
            index,
            fileLabel,
            remotePath: normalizedRemotePath,
            chunked: true,
            totalSegments: chunkSegments.length,
            completedSegments: 0,
            failed: false,
          });

          for (const segment of chunkSegments) {
            const taskId = this._generateTaskId("upload-chunk");
            taskMetaMap.set(taskId, {
              fileTaskKey,
              index,
              fileLabel,
              knownSize: segment.length,
              chunked: true,
              segmentIndex: segment.index,
              totalSegments: chunkSegments.length,
            });

            tasks.push({
              taskId,
              direction: "upload",
              localPath: materialized.localPath,
              remotePath: normalizedRemotePath,
              totalBytes: segment.length,
              fileName: fileLabel,
              currentFile: fileLabel,
              segmentOffset: segment.offset,
              segmentLength: segment.length,
              segmentIndex: segment.index,
              segmentCount: chunkSegments.length,
              remoteWriteFlags: "r+",
              maxRetries: MAX_TRANSFER_RETRIES,
              noProgressTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
            });
          }
          continue;
        }

        fileStateMap.set(fileTaskKey, {
          fileTaskKey,
          index,
          fileLabel,
          remotePath: normalizedRemotePath,
          chunked: false,
          failed: false,
        });
        const taskId = this._generateTaskId("upload");
        taskMetaMap.set(taskId, {
          fileTaskKey,
          index,
          fileLabel,
          knownSize,
          chunked: false,
        });
        tasks.push({
          taskId,
          direction: "upload",
          localPath: materialized.localPath,
          remotePath: normalizedRemotePath,
          totalBytes: knownSize,
          fileName: fileLabel,
          currentFile: fileLabel,
          maxRetries: MAX_TRANSFER_RETRIES,
          noProgressTimeoutMs: DEFAULT_STALL_TIMEOUT_MS,
        });
      }
      const concurrency = this._chooseConcurrency(
        tasks.length,
        totalBytes,
        true,
      );

      const transferProcessPool = this._ensureTransferProcessPool();
      await transferProcessPool.runTasks({
        transferKey,
        tabId,
        sshConfig,
        tasks,
        maxConcurrency: concurrency,
        onProgress: (message) => {
          const taskMeta = taskMetaMap.get(message?.taskId);
          if (!taskMeta) return;
          const deltaBytes = Math.max(0, Number(message?.deltaBytes) || 0);
          if (deltaBytes > 0) {
            taskTransferredBytes.set(
              message.taskId,
              (taskTransferredBytes.get(message.taskId) || 0) + deltaBytes,
            );
          }
          const state = this._getTransfer(transferKey);
          if (!state) return;
          state.transferredBytes += deltaBytes;
          this._emitTransferProgress(transferKey, {
            fileName: displayName || taskMeta.fileLabel,
            currentFile: taskMeta.fileLabel,
            currentFileIndex: taskMeta.index + 1,
            extra: includeOperationComplete
              ? { operationComplete: false, cancelled: false }
              : {},
          });
        },
        onTaskDone: (message) => {
          const taskMeta = taskMetaMap.get(message?.taskId);
          if (!taskMeta) return;
          const state = this._getTransfer(transferKey);
          const reportedTotal = Number.isFinite(taskMeta.knownSize)
            ? taskMeta.knownSize
            : Number(message?.totalBytes) || 0;
          const tracked = taskTransferredBytes.get(message.taskId) || 0;
          const remainder = Math.max(0, reportedTotal - tracked);
          if (state) {
            state.transferredBytes += remainder;
          }

          const fileState = fileStateMap.get(taskMeta.fileTaskKey);
          if (!fileState) return;
          if (taskMeta.chunked) {
            fileState.completedSegments += 1;
          } else {
            uploadedCount += 1;
            if (state) {
              state.processedFiles += 1;
            }
          }

          this._emitTransferProgress(transferKey, {
            force: !taskMeta.chunked,
            fileName: displayName || taskMeta.fileLabel,
            currentFile: taskMeta.fileLabel,
            currentFileIndex: taskMeta.index + 1,
            extra: includeOperationComplete
              ? { operationComplete: false, cancelled: false }
              : {},
          });
        },
        onTaskError: (message) => {
          if (
            message?.error?.cancelled ||
            this._isTransferCancelled(transferKey)
          ) {
            return;
          }

          const taskMeta = taskMetaMap.get(message?.taskId);
          if (!taskMeta) return;
          const fileState = fileStateMap.get(taskMeta.fileTaskKey);
          if (!fileState) return;
          if (fileState.failed) return;

          fileState.failed = true;
          failedCount += 1;
          errors.push({
            fileName:
              taskMeta?.fileLabel ||
              message?.fileName ||
              message?.taskId ||
              "unknown-file",
            error: message?.error?.message || "Upload task failed",
          });
        },
      });

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
        const cancelledState = this._getTransfer(transferKey);
        this._recordTransferMetrics({
          transferredBytes: cancelledState?.transferredBytes || 0,
          completed: uploadedCount,
          failed: failedCount,
          cancelled: true,
          durationMs: cancelledState ? Date.now() - cancelledState.startAt : 0,
        });
        this._recordCancelLatency(cancelledState);
        this._finalizeTransfer(transferKey);
        return {
          success: true,
          cancelled: true,
          userCancelled: true,
          message: "用户已取消操作",
        };
      }

      const failedChunkRemotePaths = [];
      for (const fileState of fileStateMap.values()) {
        if (!fileState.chunked) continue;
        if (fileState.failed) {
          failedChunkRemotePaths.push(fileState.remotePath);
          continue;
        }
        if (fileState.completedSegments < fileState.totalSegments) {
          fileState.failed = true;
          failedCount += 1;
          errors.push({
            fileName: fileState.fileLabel,
            error: "Upload chunk incomplete",
          });
          failedChunkRemotePaths.push(fileState.remotePath);
          continue;
        }

        uploadedCount += 1;
        const state = this._getTransfer(transferKey);
        if (state) {
          state.processedFiles += 1;
        }
        this._emitTransferProgress(transferKey, {
          force: true,
          fileName: displayName || fileState.fileLabel,
          currentFile: fileState.fileLabel,
          currentFileIndex: fileState.index + 1,
          extra: includeOperationComplete
            ? { operationComplete: false, cancelled: false }
            : {},
        });
      }

      if (failedChunkRemotePaths.length > 0) {
        await this._withBorrowedSftp(tabId, async (sftp) => {
          for (const remotePath of failedChunkRemotePaths) {
            try {
              await this._unlink(sftp, remotePath);
            } catch {
              // ignore cleanup failure
            }
          }
        });
      }

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
        const cancelledState = this._getTransfer(transferKey);
        this._recordTransferMetrics({
          transferredBytes: cancelledState?.transferredBytes || 0,
          completed: uploadedCount,
          failed: failedCount,
          cancelled: true,
          durationMs: cancelledState ? Date.now() - cancelledState.startAt : 0,
        });
        this._recordCancelLatency(cancelledState);
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
      const finalState = this._getTransfer(transferKey);
      this._recordTransferMetrics({
        transferredBytes: finalState?.transferredBytes || 0,
        completed: uploadedCount,
        failed: failedCount,
        cancelled: false,
        durationMs: finalState ? Date.now() - finalState.startAt : 0,
      });

      this._emitTransferProgress(transferKey, {
        force: true,
        fileName:
          failedCount === 0
            ? "上传完成"
            : `上传完成，失败 ${failedCount} 个文件`,
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
    } catch (error) {
      const state = this._getTransfer(transferKey);
      if (state) {
        this._recordTransferMetrics({
          transferredBytes: state.transferredBytes || 0,
          completed: uploadedCount,
          failed: failedCount + (isCancelledError(error) ? 0 : 1),
          cancelled: isCancelledError(error),
          durationMs: Date.now() - state.startAt,
        });
        this._recordCancelLatency(state);
      }
      if (transferKey) {
        this._finalizeTransfer(transferKey);
      }
      if (isCancelledError(error)) {
        return {
          success: true,
          cancelled: true,
          userCancelled: true,
          message: "用户已取消操作",
        };
      }
      throw error;
    } finally {
      await this._cleanupTempUploadSources(tempUploadPaths);
    }
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
      const rawFolders = Array.isArray(uploadData?.folders)
        ? uploadData.folders
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

      const remoteDirectories = rawFolders.map((folderPath) =>
        this._joinRemotePath(normalizedTarget, toPosixPath(folderPath)),
      );

      return this._uploadEntries({
        event,
        tabId,
        entries,
        remoteDirectories,
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
    this._clearTransferProcessPoolIdleTimer();
    this._stopEventLoopLagMonitor();
    for (const [transferKey, transfer] of this.activeTransfers.entries()) {
      try {
        transfer.cancelled = true;
        transfer.cancelRequestedAt = transfer.cancelRequestedAt || Date.now();
        if (this.transferProcessPool) {
          this.transferProcessPool.cancelTransfer(transferKey);
        }
        this._destroyTransferStreams(transferKey, "Application cleanup");
      } catch {
        // ignore cleanup error
      }
      this.activeTransfers.delete(transferKey);
    }
    if (this.transferProcessPool) {
      const pool = this.transferProcessPool;
      this.transferProcessPool = null;
      pool.shutdown().catch((error) => {
        this._log(
          `Transfer process pool shutdown failed: ${normalizeErrorMessage(error)}`,
          "WARN",
        );
      });
    }
    this._log(
      "All active Filemanagement transfers have been cleaned up",
      "INFO",
    );
  }
}

module.exports = new FilemanagementService();
