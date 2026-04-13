const os = require("os");

const { SESSION_CONFIG } = require("../sftp/sftpConfig");
const { logToFile } = require("../../core/utils/logger");
const {
  invokeNativeRequestWithConfig,
} = require("../../core/utils/nativeSftpClient");

const DEFAULT_MAX_QUEUE_SIZE = 20000;

function normalizeErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function buildCancelledError(message = "Transfer cancelled by user") {
  const error = new Error(message);
  error.cancelled = true;
  error.userCancelled = true;
  return error;
}

function createTaskRuntimeError(message, payload = {}) {
  const error = new Error(message || "Transfer task failed");
  if (payload.code) error.code = payload.code;
  if (payload.cancelled) {
    error.cancelled = true;
    error.userCancelled = true;
  }
  error.worker = payload.worker || null;
  error.raw = payload.raw || null;
  return error;
}

class TransferProcessPool {
  constructor(options = {}) {
    const cpuCount = Math.max(2, os.cpus()?.length || 4);
    const sessionCap =
      Number.isFinite(SESSION_CONFIG?.MAX_SESSIONS_PER_TAB) &&
      SESSION_CONFIG.MAX_SESSIONS_PER_TAB > 0
        ? SESSION_CONFIG.MAX_SESSIONS_PER_TAB
        : 8;
    const configuredMax = Number.isFinite(options.maxWorkers)
      ? Math.floor(options.maxWorkers)
      : sessionCap;

    this.maxWorkers = Math.max(1, Math.min(configuredMax, cpuCount));
    this.maxQueueSize = Math.max(
      this.maxWorkers * 64,
      Number.isFinite(options.maxQueueSize)
        ? Math.floor(options.maxQueueSize)
        : DEFAULT_MAX_QUEUE_SIZE,
    );

    this.taskQueue = [];
    this.pendingTasks = new Map();
    this.runningTasks = new Map();
    this.transferConcurrencyLimits = new Map();
    this.transferRunningCounts = new Map();
    this.transferCancelled = new Set();
    this.targetWorkerCount = 0;

    this._dispatching = false;
    this._isShutdown = false;
  }

  _log(message, level = "INFO") {
    if (typeof logToFile === "function") {
      logToFile(`[TransferProcessPool] ${message}`, level);
    }
  }

  _safeInvokeCallback(callback, payload) {
    if (typeof callback !== "function") return;
    try {
      callback(payload);
    } catch (error) {
      this._log(`Callback error: ${normalizeErrorMessage(error)}`, "WARN");
    }
  }

  _getTaskKey(transferKey, taskId) {
    return `${transferKey}::${taskId}`;
  }

  _ensureQueueCapacity(taskCount) {
    if (this.taskQueue.length + taskCount <= this.maxQueueSize) return;
    throw new Error(
      `Transfer queue overflow: pending=${this.taskQueue.length}, incoming=${taskCount}, limit=${this.maxQueueSize}`,
    );
  }

  _isTaskCancelledMessage(reason) {
    if (!reason) return false;
    if (reason.cancelled || reason.userCancelled) return true;
    const message = normalizeErrorMessage(reason).toLowerCase();
    return message.includes("cancelled") || message.includes("canceled");
  }

  _buildNativeRequest(taskPayload) {
    const base = {
      path: taskPayload.remotePath,
      localPath: taskPayload.localPath,
      segmentOffset: Number.isFinite(taskPayload.segmentOffset)
        ? taskPayload.segmentOffset
        : undefined,
      segmentLength: Number.isFinite(taskPayload.segmentLength)
        ? taskPayload.segmentLength
        : undefined,
    };

    if (taskPayload.direction === "upload") {
      if (!taskPayload.remotePath || !taskPayload.localPath) {
        throw new Error("Upload task missing remotePath/localPath");
      }

      return {
        operation: "uploadFileToRemote",
        ...base,
        remoteWriteFlags: taskPayload.remoteWriteFlags,
      };
    }

    if (taskPayload.direction === "download") {
      if (!taskPayload.remotePath || !taskPayload.localPath) {
        throw new Error("Download task missing remotePath/localPath");
      }

      return {
        operation: "downloadFileToLocal",
        ...base,
        localWriteFlags: taskPayload.localWriteFlags,
      };
    }

    throw new Error(`Unsupported transfer direction: ${taskPayload.direction}`);
  }

  _buildProgressPayload(entry, payload = {}) {
    return {
      transferKey: entry.transferKey,
      taskId: entry.taskId,
      tabId: entry.tabId,
      attempt: 0,
      timestamp: Date.now(),
      workerPid: entry.sidecarPid || null,
      deltaBytes: Math.max(0, Number(payload?.deltaBytes) || 0),
      transferredBytes: Math.max(0, Number(payload?.transferredBytes) || 0),
      totalBytes: Number.isFinite(entry.taskPayload.totalBytes)
        ? entry.taskPayload.totalBytes
        : Math.max(0, Number(payload?.totalBytes) || 0),
      segmentOffset: Number.isFinite(entry.taskPayload.segmentOffset)
        ? entry.taskPayload.segmentOffset
        : null,
      segmentLength: Number.isFinite(entry.taskPayload.segmentLength)
        ? entry.taskPayload.segmentLength
        : null,
      segmentIndex: Number.isFinite(entry.taskPayload.segmentIndex)
        ? entry.taskPayload.segmentIndex
        : null,
      segmentCount: Number.isFinite(entry.taskPayload.segmentCount)
        ? entry.taskPayload.segmentCount
        : null,
      direction: entry.taskPayload.direction,
      fileName: entry.taskPayload.fileName || "",
      currentFile:
        entry.taskPayload.currentFile || entry.taskPayload.fileName || "",
      remotePath: entry.taskPayload.remotePath || "",
      localPath: entry.taskPayload.localPath || "",
    };
  }

  _buildDonePayload(entry, result = {}) {
    return {
      transferKey: entry.transferKey,
      taskId: entry.taskId,
      tabId: entry.tabId,
      attempt: 0,
      timestamp: Date.now(),
      workerPid: entry.sidecarPid || null,
      transferredBytes: Math.max(
        0,
        Number(result?.transferredBytes || result?.totalBytes) || 0,
      ),
      totalBytes: Number.isFinite(entry.taskPayload.totalBytes)
        ? entry.taskPayload.totalBytes
        : Math.max(0, Number(result?.totalBytes) || 0),
      segmentOffset: Number.isFinite(entry.taskPayload.segmentOffset)
        ? entry.taskPayload.segmentOffset
        : null,
      segmentLength: Number.isFinite(entry.taskPayload.segmentLength)
        ? entry.taskPayload.segmentLength
        : null,
      segmentIndex: Number.isFinite(entry.taskPayload.segmentIndex)
        ? entry.taskPayload.segmentIndex
        : null,
      segmentCount: Number.isFinite(entry.taskPayload.segmentCount)
        ? entry.taskPayload.segmentCount
        : null,
      direction: entry.taskPayload.direction,
      fileName: entry.taskPayload.fileName || "",
      currentFile:
        entry.taskPayload.currentFile || entry.taskPayload.fileName || "",
      remotePath: entry.taskPayload.remotePath || "",
      localPath: entry.taskPayload.localPath || "",
      durationMs: Date.now() - entry.startedAt,
    };
  }

  _buildErrorPayload(entry, error) {
    return {
      transferKey: entry.transferKey,
      taskId: entry.taskId,
      tabId: entry.tabId,
      attempt: 0,
      timestamp: Date.now(),
      workerPid: entry.sidecarPid || null,
      direction: entry.taskPayload.direction,
      fileName: entry.taskPayload.fileName || "",
      currentFile:
        entry.taskPayload.currentFile || entry.taskPayload.fileName || "",
      remotePath: entry.taskPayload.remotePath || "",
      localPath: entry.taskPayload.localPath || "",
      segmentOffset: Number.isFinite(entry.taskPayload.segmentOffset)
        ? entry.taskPayload.segmentOffset
        : null,
      segmentLength: Number.isFinite(entry.taskPayload.segmentLength)
        ? entry.taskPayload.segmentLength
        : null,
      segmentIndex: Number.isFinite(entry.taskPayload.segmentIndex)
        ? entry.taskPayload.segmentIndex
        : null,
      segmentCount: Number.isFinite(entry.taskPayload.segmentCount)
        ? entry.taskPayload.segmentCount
        : null,
      error: {
        message: normalizeErrorMessage(error),
        code: error?.code || null,
        cancelled: Boolean(error?.cancelled || error?.userCancelled),
      },
      raw: error?.raw || null,
    };
  }

  _markTaskRunning(entry) {
    const running = this.transferRunningCounts.get(entry.transferKey) || 0;
    this.transferRunningCounts.set(entry.transferKey, running + 1);
    entry.status = "running";
    entry.startedAt = Date.now();
    this.runningTasks.set(entry.taskKey, entry);
  }

  _markTaskFinished(entry) {
    if (!entry || entry.status !== "running") return;

    const running = this.transferRunningCounts.get(entry.transferKey) || 0;
    if (running <= 1) {
      this.transferRunningCounts.delete(entry.transferKey);
    } else {
      this.transferRunningCounts.set(entry.transferKey, running - 1);
    }

    entry.status = "finished";
    this.runningTasks.delete(entry.taskKey);
  }

  _releaseTaskChild(entry, reason = "Transfer cancelled by user") {
    if (!entry) return;
    entry.cancelReason = reason;
    if (!entry.child) return;

    try {
      entry.child.kill();
    } catch (error) {
      this._log(
        `Failed to stop sidecar for ${entry.taskKey}: ${normalizeErrorMessage(error)}`,
        "WARN",
      );
    } finally {
      entry.child = null;
    }
  }

  _isTaskDispatchable(taskEntry) {
    if (!taskEntry || taskEntry.status !== "queued") return false;

    const running = this.transferRunningCounts.get(taskEntry.transferKey) || 0;
    const limit =
      this.transferConcurrencyLimits.get(taskEntry.transferKey) ||
      this.maxWorkers;
    return running < limit;
  }

  _pickNextQueueTask() {
    for (let index = 0; index < this.taskQueue.length; index += 1) {
      const taskKey = this.taskQueue[index];
      const entry = this.pendingTasks.get(taskKey);
      if (!entry) {
        this.taskQueue.splice(index, 1);
        index -= 1;
        continue;
      }

      if (this.transferCancelled.has(entry.transferKey)) {
        this.taskQueue.splice(index, 1);
        this._rejectTask(
          taskKey,
          buildCancelledError("Transfer cancelled before dispatch"),
        );
        index -= 1;
        continue;
      }

      if (!this._isTaskDispatchable(entry)) {
        continue;
      }

      this.taskQueue.splice(index, 1);
      return entry;
    }

    return null;
  }

  async _executeTask(entry) {
    if (
      this._isShutdown ||
      this.transferCancelled.has(entry.transferKey) ||
      entry.cancelRequested
    ) {
      throw buildCancelledError(
        entry.cancelReason || "Transfer cancelled before sidecar execution",
      );
    }

    const request = this._buildNativeRequest(entry.taskPayload);
    const result = await invokeNativeRequestWithConfig(
      entry.sshConfig,
      request,
      {
        onSpawn: (child) => {
          entry.child = child;
          entry.sidecarPid = child?.pid || null;
          if (
            this._isShutdown ||
            this.transferCancelled.has(entry.transferKey) ||
            entry.cancelRequested
          ) {
            this._releaseTaskChild(
              entry,
              entry.cancelReason || "Transfer cancelled by user",
            );
          }
        },
        onProgress: (payload) => {
          if (
            this._isShutdown ||
            this.transferCancelled.has(entry.transferKey) ||
            entry.cancelRequested
          ) {
            this._releaseTaskChild(
              entry,
              entry.cancelReason || "Transfer cancelled by user",
            );
            return;
          }

          this._safeInvokeCallback(
            entry.onProgress,
            this._buildProgressPayload(entry, payload),
          );
        },
      },
    );

    if (
      this._isShutdown ||
      this.transferCancelled.has(entry.transferKey) ||
      entry.cancelRequested
    ) {
      throw buildCancelledError(
        entry.cancelReason || "Transfer cancelled by user",
      );
    }

    if (result?.success === false) {
      throw createTaskRuntimeError(
        result.error || "Native transfer task failed",
        {
          raw: result,
          worker: "native-sidecar",
        },
      );
    }

    return this._buildDonePayload(entry, result);
  }

  async _startTask(entry) {
    this._markTaskRunning(entry);

    try {
      const payload = await this._executeTask(entry);
      this._resolveTask(entry.taskKey, payload);
    } catch (error) {
      const normalizedError =
        this._isTaskCancelledMessage(error) ||
        this.transferCancelled.has(entry.transferKey) ||
        entry.cancelRequested ||
        this._isShutdown
          ? buildCancelledError(
              entry.cancelReason || normalizeErrorMessage(error),
            )
          : createTaskRuntimeError(normalizeErrorMessage(error), {
              code: error?.code,
              raw: error?.raw || error,
              worker: "native-sidecar",
            });
      this._rejectTask(entry.taskKey, normalizedError);
    } finally {
      entry.child = null;
      void this._dispatchLoop();
    }
  }

  async _dispatchLoop() {
    if (this._dispatching || this._isShutdown) return;
    this._dispatching = true;

    try {
      while (
        !this._isShutdown &&
        this.runningTasks.size < Math.max(1, this.targetWorkerCount)
      ) {
        const taskEntry = this._pickNextQueueTask();
        if (!taskEntry) {
          break;
        }

        void this._startTask(taskEntry);
      }
    } finally {
      this._dispatching = false;
    }
  }

  _resolveTask(taskKey, resultPayload) {
    const entry = this.pendingTasks.get(taskKey);
    if (!entry) return;

    this.pendingTasks.delete(taskKey);
    this._markTaskFinished(entry);
    this._safeInvokeCallback(entry.onTaskDone, resultPayload);
    entry.resolve(resultPayload);
  }

  _rejectTask(taskKey, error) {
    const entry = this.pendingTasks.get(taskKey);
    if (!entry) return;

    this.pendingTasks.delete(taskKey);
    this._markTaskFinished(entry);
    this._safeInvokeCallback(
      entry.onTaskError,
      this._buildErrorPayload(entry, error),
    );
    entry.reject(error);
  }

  _clearTransferState(transferKey) {
    if (!transferKey) return;
    this.transferConcurrencyLimits.delete(transferKey);
    this.transferRunningCounts.delete(transferKey);
    this.transferCancelled.delete(transferKey);
  }

  async runTasks({
    transferKey,
    tabId,
    sshConfig,
    tasks,
    maxConcurrency = 1,
    onProgress = null,
    onTaskDone = null,
    onTaskError = null,
  }) {
    if (this._isShutdown) {
      throw new Error("Transfer process pool already shutdown");
    }

    if (!transferKey || !tabId) {
      throw new Error("transferKey and tabId are required");
    }

    if (!sshConfig?.host || !sshConfig?.username) {
      throw new Error("sshConfig.host and sshConfig.username are required");
    }

    if (this.transferCancelled.has(transferKey)) {
      this._clearTransferState(transferKey);
      throw buildCancelledError("Transfer cancelled before task queueing");
    }

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return { completed: 0, failed: 0, cancelled: 0, results: [] };
    }

    const limit = Math.max(
      1,
      Math.min(this.maxWorkers, Math.floor(maxConcurrency || 1), tasks.length),
    );

    this.targetWorkerCount = Math.max(this.targetWorkerCount, limit);
    this._ensureQueueCapacity(tasks.length);
    this.transferConcurrencyLimits.set(transferKey, limit);

    const taskPromises = tasks.map((task) => {
      const taskId = String(task?.taskId || "");
      if (!taskId) {
        throw new Error("Each task requires taskId");
      }

      const taskKey = this._getTaskKey(transferKey, taskId);
      if (this.pendingTasks.has(taskKey)) {
        throw new Error(`Duplicate taskKey detected: ${taskKey}`);
      }

      return new Promise((resolve, reject) => {
        const entry = {
          taskKey,
          transferKey,
          taskId,
          tabId,
          sshConfig,
          taskPayload: task,
          onProgress,
          onTaskDone,
          onTaskError,
          resolve,
          reject,
          status: "queued",
          createdAt: Date.now(),
          startedAt: 0,
          child: null,
          sidecarPid: null,
          cancelRequested: false,
          cancelReason: null,
        };

        this.pendingTasks.set(taskKey, entry);
        this.taskQueue.push(taskKey);
      });
    });

    void this._dispatchLoop();

    const settled = await Promise.allSettled(taskPromises);

    let completed = 0;
    let failed = 0;
    let cancelled = 0;
    for (const item of settled) {
      if (item.status === "fulfilled") {
        completed += 1;
        continue;
      }
      if (this._isTaskCancelledMessage(item.reason)) {
        cancelled += 1;
      } else {
        failed += 1;
      }
    }

    const hasOutstanding =
      this.taskQueue.some((taskKey) =>
        taskKey.startsWith(`${transferKey}::`),
      ) ||
      Array.from(this.pendingTasks.values()).some(
        (entry) => entry.transferKey === transferKey,
      ) ||
      Array.from(this.runningTasks.values()).some(
        (entry) => entry.transferKey === transferKey,
      );

    if (!hasOutstanding) {
      this._clearTransferState(transferKey);
    }

    return {
      completed,
      failed,
      cancelled,
      results: settled,
    };
  }

  cancelTransfer(transferKey) {
    if (!transferKey) {
      return { success: false, error: "transferKey is required" };
    }

    this.transferCancelled.add(transferKey);

    const queued = [];
    for (let index = this.taskQueue.length - 1; index >= 0; index -= 1) {
      const taskKey = this.taskQueue[index];
      if (!taskKey.startsWith(`${transferKey}::`)) continue;
      this.taskQueue.splice(index, 1);
      queued.push(taskKey);
    }

    for (const taskKey of queued) {
      this._rejectTask(
        taskKey,
        buildCancelledError("Transfer cancelled before sidecar execution"),
      );
    }

    let runningNotified = 0;
    for (const entry of this.runningTasks.values()) {
      if (entry.transferKey !== transferKey) continue;
      entry.cancelRequested = true;
      entry.cancelReason = "Transfer cancelled by user";
      runningNotified += 1;
      this._releaseTaskChild(entry, entry.cancelReason);
    }

    return {
      success: true,
      queuedCancelled: queued.length,
      runningNotified,
    };
  }

  async shutdown() {
    if (this._isShutdown) return;
    this._isShutdown = true;

    const queuedKeys = [...this.taskQueue];
    this.taskQueue = [];
    for (const taskKey of queuedKeys) {
      this._rejectTask(
        taskKey,
        createTaskRuntimeError("Transfer process pool shutdown", {
          cancelled: true,
          worker: "native-sidecar",
        }),
      );
    }

    const runningKeys = Array.from(this.runningTasks.keys());
    for (const taskKey of runningKeys) {
      const entry = this.runningTasks.get(taskKey);
      if (!entry) continue;
      entry.cancelRequested = true;
      entry.cancelReason = "Transfer process pool shutdown";
      this._releaseTaskChild(entry, entry.cancelReason);
      this._rejectTask(
        taskKey,
        createTaskRuntimeError("Transfer process pool shutdown", {
          cancelled: true,
          worker: "native-sidecar",
        }),
      );
    }

    this.taskQueue = [];
    this.pendingTasks.clear();
    this.runningTasks.clear();
  }

  getRuntimeStats() {
    return {
      workerCount: this.runningTasks.size,
      targetWorkerCount: this.targetWorkerCount,
      maxWorkers: this.maxWorkers,
      queuedTasks: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
      pendingInits: 0,
      activeTransfers: this.transferConcurrencyLimits.size,
      cancelledTransfers: this.transferCancelled.size,
      maxQueueSize: this.maxQueueSize,
      shutdown: this._isShutdown,
    };
  }
}

module.exports = TransferProcessPool;
