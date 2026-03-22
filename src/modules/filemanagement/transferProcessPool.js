const { fork } = require("child_process");
const os = require("os");

let electronUtilityProcess = null;
try {
  ({ utilityProcess: electronUtilityProcess } = require("electron"));
} catch {
  electronUtilityProcess = null;
}

const { SESSION_CONFIG } = require("../sftp/sftpConfig");
const { logToFile } = require("../../core/utils/logger");
const {
  resolveWorkerScriptPath,
} = require("../../core/utils/workerScriptResolver");
const {
  DEFAULT_SSH_RETRY_CONFIG,
} = require("../../core/connection/ssh-retry-helper");

const HEARTBEAT_CHECK_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 15000;
const INIT_SESSION_TIMEOUT_MS =
  Number(DEFAULT_SSH_RETRY_CONFIG?.totalTimeCapMs || 60000) + 10000;
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

function spawnWorkerProcess(workerPath, workerId) {
  if (
    electronUtilityProcess &&
    typeof electronUtilityProcess.fork === "function"
  ) {
    const child = electronUtilityProcess.fork(workerPath, [], {
      stdio: "ignore",
      serviceName: `Transfer Worker ${workerId}`,
    });

    return {
      child,
      transport: "utilityProcess",
    };
  }

  return {
    child: fork(workerPath, [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }),
    transport: "fork",
  };
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

    this.workers = new Map();
    this.taskQueue = [];
    this.pendingTasks = new Map();
    this.pendingInits = new Map();
    this.transferConcurrencyLimits = new Map();
    this.transferRunningCounts = new Map();
    this.transferCancelled = new Set();
    this.targetWorkerCount = 0;

    this._dispatching = false;
    this._isShutdown = false;
    this._nextWorkerSeq = 1;

    this._heartbeatTimer = setInterval(() => {
      this._checkWorkerHeartbeats();
    }, HEARTBEAT_CHECK_INTERVAL_MS);
    if (typeof this._heartbeatTimer.unref === "function") {
      this._heartbeatTimer.unref();
    }
  }

  _log(message, level = "INFO") {
    if (typeof logToFile === "function") {
      logToFile(`[TransferProcessPool] ${message}`, level);
    }
  }

  _resolveWorkerPath() {
    return resolveWorkerScriptPath("sftp-transfer-worker.js", {
      runtimeDir: __dirname,
      envVar: "SIMPLESHELL_TRANSFER_WORKER_PATH",
    });
  }

  _ensureWorkerCount(requiredCount) {
    if (this._isShutdown) return;

    const target = Math.max(
      this.targetWorkerCount,
      Math.min(this.maxWorkers, Math.max(1, requiredCount || 1)),
    );
    this.targetWorkerCount = target;

    while (this.workers.size < this.targetWorkerCount) {
      const spawned = this._spawnWorker();
      if (!spawned) {
        this.targetWorkerCount = this.workers.size;
        break;
      }
    }
  }

  _spawnWorker() {
    if (this._isShutdown) return null;

    let workerPath;
    try {
      workerPath = this._resolveWorkerPath();
    } catch (error) {
      this._log(normalizeErrorMessage(error), "ERROR");
      return null;
    }

    const workerId = `tpw-${this._nextWorkerSeq++}`;
    const { child, transport } = spawnWorkerProcess(workerPath, workerId);

    const state = {
      id: workerId,
      process: child,
      transport,
      busy: false,
      currentTaskKey: null,
      currentTransferKey: null,
      lastHeartbeatAt: Date.now(),
      startedAt: Date.now(),
      initializedTransfers: new Set(),
      exited: false,
    };

    child.on("message", (message) => {
      this._handleWorkerMessage(workerId, message);
    });

    child.on("exit", (code, signal) => {
      this._handleWorkerExit(workerId, code, signal);
    });

    child.on("error", (...args) => {
      const [error, location] = args;
      const details =
        args.length > 1
          ? `${normalizeErrorMessage(error)} @ ${location || "unknown"}`
          : normalizeErrorMessage(error);
      this._log(`Worker ${workerId} error: ${details}`, "ERROR");
    });

    this.workers.set(workerId, state);
    this._log(
      `Spawned worker ${workerId} via ${transport} (pid=${child.pid || "pending"}) from ${workerPath}`,
      "INFO",
    );

    if (typeof child.once === "function") {
      child.once("spawn", () => {
        this._log(
          `Worker ${workerId} spawned via ${transport} (pid=${child.pid || "unknown"})`,
          "INFO",
        );
      });
    }

    return state;
  }

  _sendToWorker(workerState, message) {
    if (!workerState || !workerState.process || workerState.exited) {
      throw new Error("Worker is not available");
    }

    if (typeof workerState.process.postMessage === "function") {
      workerState.process.postMessage(message);
      return;
    }

    if (typeof workerState.process.send === "function") {
      workerState.process.send(message);
      return;
    }

    throw new Error("Worker does not support IPC messaging");
  }

  _findBestIdleWorker(transferKey) {
    let preferred = null;
    let fallback = null;

    for (const worker of this.workers.values()) {
      if (worker.exited || worker.busy) continue;

      if (worker.currentTransferKey === transferKey) {
        preferred = worker;
        break;
      }

      if (!fallback) fallback = worker;
    }

    return preferred || fallback;
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
    for (let i = 0; i < this.taskQueue.length; i += 1) {
      const taskKey = this.taskQueue[i];
      const entry = this.pendingTasks.get(taskKey);
      if (!entry) {
        this.taskQueue.splice(i, 1);
        i -= 1;
        continue;
      }

      if (this.transferCancelled.has(entry.transferKey)) {
        this.taskQueue.splice(i, 1);
        this._rejectTask(
          taskKey,
          buildCancelledError("Transfer cancelled before dispatch"),
          null,
        );
        i -= 1;
        continue;
      }

      if (!this._isTaskDispatchable(entry)) {
        continue;
      }

      this.taskQueue.splice(i, 1);
      return entry;
    }

    return null;
  }

  _markTaskRunning(entry, workerId) {
    const running = this.transferRunningCounts.get(entry.transferKey) || 0;
    this.transferRunningCounts.set(entry.transferKey, running + 1);

    entry.status = "running";
    entry.workerId = workerId;
    entry.startedAt = Date.now();
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
  }

  async _ensureWorkerSession(workerState, taskEntry) {
    if (!workerState || !taskEntry) {
      throw new Error("Invalid worker/task for initSession");
    }

    if (workerState.currentTransferKey === taskEntry.transferKey) {
      return;
    }

    const initKey = `${workerState.id}::${taskEntry.transferKey}`;
    if (this.pendingInits.has(initKey)) {
      return this.pendingInits.get(initKey).promise;
    }

    let timeoutId = null;
    const initPromise = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        this.pendingInits.delete(initKey);
        reject(new Error("Worker initSession timed out"));
      }, INIT_SESSION_TIMEOUT_MS);

      this.pendingInits.set(initKey, {
        resolve,
        reject,
        timeoutId,
        workerId: workerState.id,
        transferKey: taskEntry.transferKey,
        promise: null,
      });
    });

    const pending = this.pendingInits.get(initKey);
    if (pending) {
      pending.promise = initPromise;
    }

    try {
      this._sendToWorker(workerState, {
        type: "initSession",
        transferKey: taskEntry.transferKey,
        taskId: "__init__",
        tabId: taskEntry.tabId,
        attempt: 0,
        timestamp: Date.now(),
        payload: {
          sshConfig: taskEntry.sshConfig,
        },
      });
      await initPromise;
      workerState.currentTransferKey = taskEntry.transferKey;
      workerState.initializedTransfers.add(taskEntry.transferKey);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      this.pendingInits.delete(initKey);
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

  async _dispatchLoop() {
    if (this._dispatching || this._isShutdown) return;
    this._dispatching = true;

    try {
      while (!this._isShutdown) {
        if (this.taskQueue.length === 0) break;

        const taskEntry = this._pickNextQueueTask();
        if (!taskEntry) break;

        let worker = this._findBestIdleWorker(taskEntry.transferKey);
        if (!worker) {
          if (this.workers.size < this.targetWorkerCount) {
            worker = this._spawnWorker();
          }
          if (!worker) {
            this.taskQueue.unshift(taskEntry.taskKey);
            break;
          }
          if (worker.busy) {
            this.taskQueue.unshift(taskEntry.taskKey);
            break;
          }
        }

        worker.busy = true;
        worker.currentTaskKey = taskEntry.taskKey;
        worker.lastHeartbeatAt = Date.now();
        this._markTaskRunning(taskEntry, worker.id);

        this._assignTaskToWorker(worker, taskEntry).catch((error) => {
          this._handleTaskError(taskEntry.taskKey, {
            transferKey: taskEntry.transferKey,
            taskId: taskEntry.taskId,
            tabId: taskEntry.tabId,
            attempt: 0,
            timestamp: Date.now(),
            error: {
              message: normalizeErrorMessage(error),
            },
          });
        });
      }
    } finally {
      this._dispatching = false;
    }
  }

  async _assignTaskToWorker(workerState, taskEntry) {
    try {
      await this._ensureWorkerSession(workerState, taskEntry);
      if (this.transferCancelled.has(taskEntry.transferKey)) {
        throw buildCancelledError("Transfer cancelled before startTask");
      }

      this._sendToWorker(workerState, {
        type: "startTask",
        transferKey: taskEntry.transferKey,
        taskId: taskEntry.taskId,
        tabId: taskEntry.tabId,
        attempt: 0,
        timestamp: Date.now(),
        payload: {
          ...taskEntry.taskPayload,
          sshConfig: taskEntry.sshConfig,
        },
      });
    } catch (error) {
      this._rejectTask(
        taskEntry.taskKey,
        createTaskRuntimeError(normalizeErrorMessage(error), {
          cancelled: Boolean(error?.cancelled),
          worker: workerState?.id || null,
        }),
        workerState?.id || null,
      );
    }
  }

  _getTaskKey(transferKey, taskId) {
    return `${transferKey}::${taskId}`;
  }

  _handleWorkerMessage(workerId, message) {
    const workerState = this.workers.get(workerId);
    if (!workerState || workerState.exited || !message) return;

    workerState.lastHeartbeatAt = Date.now();

    const {
      type,
      transferKey = null,
      taskId = null,
      tabId = null,
      attempt = 0,
      timestamp = Date.now(),
    } = message;

    if (type === "heartbeat") {
      return;
    }

    if (type === "initSession") {
      const initKey = `${workerId}::${transferKey}`;
      const pending = this.pendingInits.get(initKey);
      if (!pending) return;

      if (message.ok === false || message.error) {
        pending.reject(
          createTaskRuntimeError(
            message.error?.message || "initSession failed",
            {
              code: message.error?.code,
              raw: message,
              worker: workerId,
            },
          ),
        );
        return;
      }

      pending.resolve({
        workerId,
        transferKey,
      });
      return;
    }

    const taskKey = this._getTaskKey(transferKey, taskId);
    const taskEntry = this.pendingTasks.get(taskKey);
    if (!taskEntry) {
      return;
    }

    if (type === "progress") {
      this._safeInvokeCallback(taskEntry.onProgress, {
        transferKey,
        taskId,
        tabId,
        attempt,
        timestamp,
        ...message,
      });
      return;
    }

    if (type === "taskDone") {
      this._handleTaskDone(taskKey, {
        transferKey,
        taskId,
        tabId,
        attempt,
        timestamp,
        ...message,
      });
      return;
    }

    if (type === "taskError") {
      this._handleTaskError(taskKey, {
        transferKey,
        taskId,
        tabId,
        attempt,
        timestamp,
        ...message,
      });
      return;
    }
  }

  _releaseWorkerForTask(workerId, taskKey) {
    if (!workerId) return;
    const workerState = this.workers.get(workerId);
    if (!workerState || workerState.exited) return;

    if (workerState.currentTaskKey === taskKey) {
      workerState.currentTaskKey = null;
      workerState.busy = false;
      workerState.lastHeartbeatAt = Date.now();
    }
  }

  _resolveTask(taskKey, resultPayload, workerId = null) {
    const taskEntry = this.pendingTasks.get(taskKey);
    if (!taskEntry) return;

    this.pendingTasks.delete(taskKey);
    this._markTaskFinished(taskEntry);
    this._releaseWorkerForTask(workerId || taskEntry.workerId, taskKey);

    this._safeInvokeCallback(taskEntry.onTaskDone, resultPayload);
    taskEntry.resolve(resultPayload);

    this._dispatchLoop();
  }

  _rejectTask(taskKey, error, workerId = null) {
    const taskEntry = this.pendingTasks.get(taskKey);
    if (!taskEntry) return;

    this.pendingTasks.delete(taskKey);
    this._markTaskFinished(taskEntry);
    this._releaseWorkerForTask(workerId || taskEntry.workerId, taskKey);

    this._safeInvokeCallback(taskEntry.onTaskError, {
      transferKey: taskEntry.transferKey,
      taskId: taskEntry.taskId,
      tabId: taskEntry.tabId,
      timestamp: Date.now(),
      error: {
        message: normalizeErrorMessage(error),
        code: error?.code,
        cancelled: Boolean(error?.cancelled),
      },
      raw: error?.raw || null,
    });
    taskEntry.reject(error);

    this._dispatchLoop();
  }

  _handleTaskDone(taskKey, payload) {
    const taskEntry = this.pendingTasks.get(taskKey);
    if (!taskEntry) return;

    this._resolveTask(taskKey, payload, taskEntry.workerId);
  }

  _handleTaskError(taskKey, payload) {
    const taskEntry = this.pendingTasks.get(taskKey);
    if (!taskEntry) return;

    const error = createTaskRuntimeError(
      payload?.error?.message || "Worker task error",
      {
        code: payload?.error?.code,
        cancelled: Boolean(payload?.error?.cancelled),
        worker: taskEntry.workerId,
        raw: payload,
      },
    );
    this._rejectTask(taskKey, error, taskEntry.workerId);
  }

  _handleWorkerExit(workerId, code, signal) {
    const workerState = this.workers.get(workerId);
    if (!workerState) return;

    workerState.exited = true;
    this.workers.delete(workerId);

    this._log(
      `Worker ${workerId} exited (code=${code}, signal=${signal || "none"})`,
      code === 0 || this._isShutdown ? "INFO" : "WARN",
    );

    for (const [initKey, pending] of this.pendingInits.entries()) {
      if (pending.workerId !== workerId) continue;
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(
        createTaskRuntimeError("Worker exited during initSession", {
          worker: workerId,
        }),
      );
      this.pendingInits.delete(initKey);
    }

    if (workerState.currentTaskKey) {
      const taskEntry = this.pendingTasks.get(workerState.currentTaskKey);
      if (taskEntry) {
        const error = createTaskRuntimeError("Transfer worker crashed", {
          worker: workerId,
        });
        this._rejectTask(workerState.currentTaskKey, error, workerId);
      }
    }

    if (!this._isShutdown && this.workers.size < this.targetWorkerCount) {
      this._spawnWorker();
      this._dispatchLoop();
    }
  }

  _checkWorkerHeartbeats() {
    if (this._isShutdown) return;

    const now = Date.now();
    for (const worker of this.workers.values()) {
      if (worker.exited) continue;
      if (now - worker.lastHeartbeatAt <= HEARTBEAT_TIMEOUT_MS) continue;

      this._log(
        `Worker ${worker.id} heartbeat timeout, terminating process`,
        "WARN",
      );
      try {
        worker.process.kill();
      } catch (error) {
        this._log(
          `Failed to kill timed out worker ${worker.id}: ${normalizeErrorMessage(
            error,
          )}`,
          "WARN",
        );
      }
    }
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

    this._ensureWorkerCount(limit);
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
          workerId: null,
          startedAt: 0,
        };

        this.pendingTasks.set(taskKey, entry);
        this.taskQueue.push(taskKey);
      });
    });

    this._dispatchLoop();

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
    for (let i = this.taskQueue.length - 1; i >= 0; i -= 1) {
      const taskKey = this.taskQueue[i];
      if (!taskKey.startsWith(`${transferKey}::`)) continue;
      this.taskQueue.splice(i, 1);
      queued.push(taskKey);
    }

    for (const taskKey of queued) {
      this._rejectTask(
        taskKey,
        buildCancelledError("Transfer cancelled before worker execution"),
        null,
      );
    }

    const runningTaskKeys = [];
    for (const taskEntry of this.pendingTasks.values()) {
      if (taskEntry.transferKey !== transferKey) continue;
      if (taskEntry.status !== "running") continue;
      runningTaskKeys.push(taskEntry.taskKey);
    }

    for (const taskKey of runningTaskKeys) {
      const entry = this.pendingTasks.get(taskKey);
      if (!entry || !entry.workerId) continue;
      const worker = this.workers.get(entry.workerId);
      if (!worker || worker.exited) continue;

      try {
        this._sendToWorker(worker, {
          type: "cancelTask",
          transferKey: entry.transferKey,
          taskId: entry.taskId,
          tabId: entry.tabId,
          attempt: 0,
          timestamp: Date.now(),
          payload: {},
        });
      } catch (error) {
        this._rejectTask(
          taskKey,
          createTaskRuntimeError(normalizeErrorMessage(error), {
            cancelled: true,
            worker: entry.workerId,
          }),
          entry.workerId,
        );
      }
    }

    return {
      success: true,
      queuedCancelled: queued.length,
      runningNotified: runningTaskKeys.length,
    };
  }

  async shutdown() {
    if (this._isShutdown) return;
    this._isShutdown = true;

    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }

    const queueSnapshot = [...this.taskQueue];
    this.taskQueue = [];
    for (const taskKey of queueSnapshot) {
      this._rejectTask(
        taskKey,
        createTaskRuntimeError("Transfer process pool shutdown", {
          cancelled: true,
        }),
        null,
      );
    }

    for (const [taskKey, taskEntry] of this.pendingTasks.entries()) {
      this._rejectTask(
        taskKey,
        createTaskRuntimeError("Transfer process pool shutdown", {
          cancelled: true,
          worker: taskEntry.workerId,
        }),
        taskEntry.workerId,
      );
    }

    for (const [initKey, pending] of this.pendingInits.entries()) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(
        createTaskRuntimeError("Transfer process pool shutdown during init", {
          cancelled: true,
          worker: pending.workerId,
        }),
      );
      this.pendingInits.delete(initKey);
    }

    const closePromises = [];
    for (const worker of this.workers.values()) {
      const closePromise = new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };

        worker.process.once("exit", () => finish());

        try {
          this._sendToWorker(worker, {
            type: "shutdown",
            transferKey: null,
            taskId: null,
            tabId: null,
            attempt: 0,
            timestamp: Date.now(),
            payload: {},
          });
        } catch {
          // ignore send failure
        }

        setTimeout(() => {
          try {
            if (!worker.exited) worker.process.kill();
          } catch {
            // ignore kill failure
          } finally {
            finish();
          }
        }, 1000);
      });

      closePromises.push(closePromise);
    }

    await Promise.allSettled(closePromises);
    this.workers.clear();
  }

  getRuntimeStats() {
    return {
      workerCount: this.workers.size,
      targetWorkerCount: this.targetWorkerCount,
      maxWorkers: this.maxWorkers,
      queuedTasks: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
      pendingInits: this.pendingInits.size,
      activeTransfers: this.transferConcurrencyLimits.size,
      cancelledTransfers: this.transferCancelled.size,
      maxQueueSize: this.maxQueueSize,
      shutdown: this._isShutdown,
    };
  }
}

module.exports = TransferProcessPool;
