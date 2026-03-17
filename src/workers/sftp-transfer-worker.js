const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const {
  DEFAULT_SSH_RETRY_CONFIG,
  FAILURE_REASON,
  buildSshRetryConfig,
  analyzeSshFailureReason,
  getEffectiveMaxRetries,
  getRemainingRetryWindowMs,
  getRetryWindowExpiresAt,
  isRetryWindowExpired,
  waitForSshPreflight,
  calculateRetryDelay,
  createManagedSshConnection,
} = require("../core/connection/ssh-retry-helper");

const DEFAULT_PROGRESS_INTERVAL_MS = 100;
const DEFAULT_STALL_TIMEOUT_MS = 45000;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BACKOFF_BASE_MS = 300;
const HEARTBEAT_INTERVAL_MS = 2000;

let currentSession = null;
let currentTaskState = null;
const cancelledTaskKeys = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

function serializeError(error) {
  if (!error) {
    return {
      message: "Unknown error",
      code: null,
      stack: null,
      cancelled: false,
    };
  }

  return {
    message: normalizeErrorMessage(error),
    code: error.code || null,
    stack: error.stack || null,
    cancelled: Boolean(error.cancelled || error.userCancelled),
  };
}

function isCancelledError(error) {
  if (!error) return false;
  if (error.cancelled || error.userCancelled) return true;
  const message = normalizeErrorMessage(error).toLowerCase();
  return (
    message.includes("cancelled") ||
    message.includes("canceled") ||
    message.includes("user cancelled")
  );
}

function isRetryableTransferError(error) {
  if (!error || isCancelledError(error)) return false;
  const message = normalizeErrorMessage(error).toLowerCase();
  const code = String(error.code || "").toUpperCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("socket hang up") ||
    message.includes("connection reset") ||
    message.includes("connection lost") ||
    message.includes("no progress") ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "ENETUNREACH" ||
    code === "EPIPE" ||
    code === "ENOTCONN"
  );
}

function chooseChunkSize(totalBytes) {
  const bytes = Number.isFinite(totalBytes) ? totalBytes : 0;
  if (bytes >= 4 * 1024 * 1024 * 1024) return 4 * 1024 * 1024;
  if (bytes >= 512 * 1024 * 1024) return 2 * 1024 * 1024;
  if (bytes >= 64 * 1024 * 1024) return 1024 * 1024;
  if (bytes >= 8 * 1024 * 1024) return 512 * 1024;
  return 256 * 1024;
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

function taskKeyOf(envelope) {
  return `${envelope.transferKey}::${envelope.taskId}`;
}

function isTaskCancelled(envelope) {
  return cancelledTaskKeys.has(taskKeyOf(envelope));
}

function sendMessage(type, envelope, payload = {}) {
  if (typeof process.send !== "function") return;
  process.send({
    type,
    transferKey: envelope?.transferKey ?? null,
    taskId: envelope?.taskId ?? null,
    tabId: envelope?.tabId ?? null,
    attempt: Number.isFinite(envelope?.attempt) ? envelope.attempt : 0,
    timestamp: Date.now(),
    ...payload,
  });
}

async function buildSshConnectOptions(sshConfig = {}) {
  if (!sshConfig?.host || !sshConfig?.username) {
    throw new Error("Invalid SSH configuration for transfer worker");
  }

  return sshConfig;
}

function resolveWorkerRetryConfig(sshConfig = {}) {
  return buildSshRetryConfig({
    ...DEFAULT_SSH_RETRY_CONFIG,
    ...(sshConfig.retryConfig || sshConfig.reconnectConfig || {}),
  });
}

function buildConnectWindowTimeoutError(retryConfig, windowStartedAt) {
  const error = new Error("SSH 连接重试超时，请检查代理/VPN/网络后重试。");
  error.code = "ETIMEDOUT";
  error.windowExpiresAt = getRetryWindowExpiresAt(windowStartedAt, retryConfig);
  return error;
}

function isSessionHealthy(session) {
  if (!session?.client || !session?.sftp) {
    return false;
  }

  if (session.client.destroyed || session.sftp.destroyed) {
    return false;
  }

  const sock = session.client._sock;
  if (
    sock &&
    (sock.destroyed || (sock.readable === false && sock.writable === false))
  ) {
    return false;
  }

  return true;
}

async function createSftpClient(client) {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftpClient) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(sftpClient);
    });
  });
}

async function connectSessionWithRetry(envelope, sshConfig) {
  const normalizedConfig = await buildSshConnectOptions(sshConfig);
  const retryConfig = resolveWorkerRetryConfig(normalizedConfig);
  const windowStartedAt = Date.now();
  let attemptCount = 0;
  let failureReason = FAILURE_REASON.NETWORK;
  let lastError = null;

  while (true) {
    if (isTaskCancelled(envelope)) {
      throw buildCancelledError();
    }

    const effectiveMaxRetries = getEffectiveMaxRetries(
      retryConfig,
      normalizedConfig,
      failureReason,
    );
    const nextAttempt = attemptCount + 1;
    if (nextAttempt > effectiveMaxRetries) {
      throw lastError || new Error("SSH session retry limit reached");
    }

    if (isRetryWindowExpired(windowStartedAt, retryConfig)) {
      throw buildConnectWindowTimeoutError(retryConfig, windowStartedAt);
    }

    const preflightOk = await waitForSshPreflight(
      normalizedConfig,
      retryConfig,
      {
        windowStartedAt,
        shouldAbort: () => isTaskCancelled(envelope),
      },
    );
    if (!preflightOk) {
      if (isTaskCancelled(envelope)) {
        throw buildCancelledError();
      }
      throw buildConnectWindowTimeoutError(retryConfig, windowStartedAt);
    }

    let connectionHandle = null;
    try {
      connectionHandle = await createManagedSshConnection(normalizedConfig);
      const sftp = await createSftpClient(connectionHandle.client);
      attemptCount = nextAttempt;

      return {
        transferKey: envelope.transferKey,
        tabId: envelope.tabId,
        sshConfig: normalizedConfig,
        client: connectionHandle.client,
        sftp,
        proxySocket: connectionHandle.proxySocket,
        connectionHandle,
        reconnectMeta: {
          attempts: attemptCount,
          failureReason,
          effectiveMaxRetries,
          windowExpiresAt: getRetryWindowExpiresAt(
            windowStartedAt,
            retryConfig,
          ),
        },
      };
    } catch (error) {
      if (connectionHandle?.cleanup) {
        try {
          connectionHandle.cleanup("worker-connect-retry");
        } catch {
          // ignore
        }
      }

      lastError = error;
      attemptCount = nextAttempt;
      failureReason = analyzeSshFailureReason(error);

      const nextMaxRetries = getEffectiveMaxRetries(
        retryConfig,
        normalizedConfig,
        failureReason,
      );
      if (
        nextMaxRetries <= 0 ||
        attemptCount >= nextMaxRetries ||
        isRetryWindowExpired(windowStartedAt, retryConfig)
      ) {
        throw error;
      }

      const waitMs = Math.min(
        calculateRetryDelay({
          retryConfig,
          attempt: attemptCount + 1,
          lastError: error,
        }),
        getRemainingRetryWindowMs(windowStartedAt, retryConfig),
      );

      if (!Number.isFinite(waitMs) || waitMs <= 0) {
        throw error;
      }

      await sleep(waitMs);
    }
  }
}

async function closeSession() {
  if (!currentSession) return;

  try {
    if (currentSession.sftp && typeof currentSession.sftp.end === "function") {
      currentSession.sftp.end();
    }
  } catch {
    // ignore
  }

  try {
    if (currentSession.connectionHandle?.cleanup) {
      currentSession.connectionHandle.cleanup("worker-close-session");
    }
  } catch {
    // ignore
  }

  try {
    if (currentSession.client) {
      currentSession.client.removeAllListeners();
      currentSession.client.end();
    }
  } catch {
    // ignore
  }

  try {
    if (currentSession.proxySocket) {
      currentSession.proxySocket.destroy();
    }
  } catch {
    // ignore
  }

  currentSession = null;
}

async function ensureSession(envelope, sshConfig) {
  if (
    currentSession &&
    currentSession.transferKey === envelope.transferKey &&
    currentSession.tabId === envelope.tabId &&
    isSessionHealthy(currentSession)
  ) {
    return currentSession;
  }

  await closeSession();

  currentSession = await connectSessionWithRetry(envelope, sshConfig);

  return currentSession;
}

function trackActiveStream(stream) {
  if (!currentTaskState || !stream) return;
  currentTaskState.streams.add(stream);

  const cleanup = () => {
    if (!currentTaskState) return;
    currentTaskState.streams.delete(stream);
  };

  stream.once("close", cleanup);
  stream.once("error", cleanup);
  stream.once("end", cleanup);
}

function destroyActiveStreams(reasonError) {
  if (!currentTaskState) return;
  for (const stream of currentTaskState.streams) {
    try {
      stream.destroy(reasonError);
    } catch {
      // ignore
    }
  }
  currentTaskState.streams.clear();
}

async function transferWithStreams(envelope, task, attempt) {
  if (!currentSession || !currentSession.sftp) {
    throw new Error("SFTP session not ready");
  }

  const taskKey = taskKeyOf(envelope);
  if (isTaskCancelled(envelope)) {
    throw buildCancelledError();
  }

  const knownTotalBytes = Number.isFinite(task.totalBytes)
    ? task.totalBytes
    : 0;
  const hasSegmentOffset =
    Number.isFinite(task.segmentOffset) && task.segmentOffset >= 0;
  const hasSegmentLength =
    Number.isFinite(task.segmentLength) && task.segmentLength > 0;
  const segmentOffset = hasSegmentOffset ? Math.floor(task.segmentOffset) : 0;
  const segmentLength = hasSegmentLength
    ? Math.floor(task.segmentLength)
    : null;
  const segmentEnd =
    segmentLength !== null ? segmentOffset + segmentLength - 1 : null;
  const chunkSize = chooseChunkSize(knownTotalBytes);
  const noProgressTimeoutMs = Number.isFinite(task.noProgressTimeoutMs)
    ? task.noProgressTimeoutMs
    : DEFAULT_STALL_TIMEOUT_MS;

  let readStream = null;
  let writeStream = null;
  let tempPath = null;
  let transferredBytes = 0;
  let pendingDelta = 0;
  let lastEmitAt = 0;
  let lastProgressAt = Date.now();
  let watchdog = null;

  const flushProgress = (force = false) => {
    if (pendingDelta <= 0 && !force) return;
    const now = Date.now();
    if (!force && now - lastEmitAt < DEFAULT_PROGRESS_INTERVAL_MS) {
      return;
    }
    if (pendingDelta <= 0 && !force) return;

    sendMessage(
      "progress",
      {
        ...envelope,
        attempt,
      },
      {
        deltaBytes: pendingDelta,
        transferredBytes,
        totalBytes: knownTotalBytes,
        segmentOffset,
        segmentLength,
        segmentIndex: Number.isFinite(task.segmentIndex)
          ? task.segmentIndex
          : null,
        segmentCount: Number.isFinite(task.segmentCount)
          ? task.segmentCount
          : null,
        direction: task.direction,
        fileName: task.fileName || "",
        currentFile: task.currentFile || task.fileName || "",
        remotePath: task.remotePath || "",
        localPath: task.localPath || "",
      },
    );

    pendingDelta = 0;
    lastEmitAt = now;
  };

  const onData = (chunk) => {
    const size = chunk?.length || 0;
    if (size <= 0) return;
    transferredBytes += size;
    pendingDelta += size;
    lastProgressAt = Date.now();
    flushProgress(false);
  };

  try {
    if (task.direction === "upload") {
      if (!task.remotePath) {
        throw new Error("Upload task missing remotePath");
      }

      const writeOptions = {
        highWaterMark: chunkSize,
      };
      if (segmentOffset > 0 || segmentLength !== null) {
        writeOptions.start = segmentOffset;
      }
      if (task.remoteWriteFlags) {
        writeOptions.flags = task.remoteWriteFlags;
      } else if (segmentOffset > 0 || segmentLength !== null) {
        writeOptions.flags = "r+";
      }
      writeStream = currentSession.sftp.createWriteStream(
        task.remotePath,
        writeOptions,
      );

      if (task.localPath) {
        const readOptions = {
          highWaterMark: chunkSize,
        };
        if (segmentOffset > 0 || segmentLength !== null) {
          readOptions.start = segmentOffset;
        }
        if (segmentEnd !== null) {
          readOptions.end = segmentEnd;
        }
        readStream = fs.createReadStream(task.localPath, readOptions);
      } else if (task.bufferBase64) {
        const buffer = Buffer.from(task.bufferBase64, "base64");
        if (segmentOffset > 0 || segmentLength !== null) {
          const start = Math.min(segmentOffset, buffer.length);
          const endExclusive =
            segmentLength !== null
              ? Math.min(start + segmentLength, buffer.length)
              : buffer.length;
          readStream = makeBufferReadStream(
            buffer.subarray(start, endExclusive),
            chunkSize,
          );
        } else {
          readStream = makeBufferReadStream(buffer, chunkSize);
        }
      } else {
        throw new Error("Upload task missing local source");
      }
    } else if (task.direction === "download") {
      if (!task.remotePath || !task.localPath) {
        throw new Error("Download task missing remotePath/localPath");
      }

      const skipLocalTempRename = Boolean(task.skipLocalTempRename);
      const outputPath = skipLocalTempRename
        ? task.localPath
        : `${task.localPath}.part`;

      await fsp.mkdir(path.dirname(outputPath), {
        recursive: true,
      });
      if (!skipLocalTempRename) {
        tempPath = outputPath;
      }

      const readOptions = {
        highWaterMark: chunkSize,
      };
      if (segmentOffset > 0 || segmentLength !== null) {
        readOptions.start = segmentOffset;
      }
      if (segmentEnd !== null) {
        readOptions.end = segmentEnd;
      }
      readStream = currentSession.sftp.createReadStream(
        task.remotePath,
        readOptions,
      );

      const writeOptions = {
        highWaterMark: chunkSize,
      };
      if (segmentOffset > 0 || segmentLength !== null) {
        writeOptions.start = segmentOffset;
      }
      if (task.localWriteFlags) {
        writeOptions.flags = task.localWriteFlags;
      } else if (segmentOffset > 0 || segmentLength !== null) {
        writeOptions.flags = "r+";
      }
      writeStream = fs.createWriteStream(outputPath, writeOptions);
    } else {
      throw new Error(`Unsupported transfer direction: ${task.direction}`);
    }

    if (!currentTaskState) {
      throw new Error("Task state not initialized");
    }

    readStream.on("data", onData);
    trackActiveStream(readStream);
    trackActiveStream(writeStream);

    watchdog = setInterval(() => {
      if (isTaskCancelled(envelope) || !currentTaskState) {
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

      if (Date.now() - lastProgressAt > noProgressTimeoutMs) {
        const stallError = new Error("Transfer no progress timeout");
        stallError.code = "NO_PROGRESS_TIMEOUT";
        try {
          readStream.destroy(stallError);
        } catch {
          // ignore
        }
        try {
          writeStream.destroy(stallError);
        } catch {
          // ignore
        }
      }
    }, 1000);

    await pipeline(readStream, writeStream);
    readStream.removeListener("data", onData);

    flushProgress(true);

    if (task.direction === "download" && tempPath) {
      await fsp.rename(tempPath, task.localPath);
    }

    return {
      transferredBytes,
      totalBytes: knownTotalBytes,
    };
  } catch (error) {
    if (task.direction === "download" && tempPath) {
      try {
        await fsp.rm(tempPath, { force: true });
      } catch {
        // ignore cleanup error
      }
    }

    if (isTaskCancelled(envelope) || isCancelledError(error)) {
      throw buildCancelledError();
    }
    throw error;
  } finally {
    if (watchdog) {
      clearInterval(watchdog);
      watchdog = null;
    }
    try {
      if (readStream) {
        readStream.removeListener("data", onData);
      }
    } catch {
      // ignore
    }
  }
}

async function executeTaskWithRetry(envelope, task, sshConfig) {
  const maxRetries = Number.isFinite(task.maxRetries)
    ? Math.max(0, task.maxRetries)
    : DEFAULT_MAX_RETRIES;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (isTaskCancelled(envelope)) {
      throw buildCancelledError();
    }

    try {
      await ensureSession(envelope, sshConfig);
      return await transferWithStreams(envelope, task, attempt);
    } catch (error) {
      lastError = error;

      if (isTaskCancelled(envelope) || isCancelledError(error)) {
        throw buildCancelledError();
      }

      const canRetry = attempt < maxRetries && isRetryableTransferError(error);
      if (!canRetry) {
        throw error;
      }

      await closeSession();

      const waitMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
      await sleep(waitMs);
    }
  }

  throw lastError || new Error("Transfer failed after retries");
}

async function handleInitSession(message) {
  try {
    await ensureSession(message, message?.payload?.sshConfig || {});
    sendMessage("initSession", message, {
      ok: true,
      workerPid: process.pid,
    });
  } catch (error) {
    sendMessage("initSession", message, {
      ok: false,
      workerPid: process.pid,
      error: serializeError(error),
    });
  }
}

function markTaskCancelled(message) {
  if (!message?.transferKey || !message?.taskId) return;
  const taskKey = taskKeyOf(message);
  cancelledTaskKeys.add(taskKey);

  if (currentTaskState && currentTaskState.taskKey === taskKey) {
    destroyActiveStreams(buildCancelledError());
  }
}

async function handleStartTask(message) {
  const taskPayload = message?.payload || {};
  const sshConfig = taskPayload?.sshConfig || {};
  const taskKey = taskKeyOf(message);

  if (currentTaskState) {
    sendMessage("taskError", message, {
      error: serializeError(
        new Error("Worker is busy with another transfer task"),
      ),
      workerPid: process.pid,
    });
    return;
  }

  currentTaskState = {
    taskKey,
    streams: new Set(),
    startedAt: Date.now(),
  };

  try {
    const transferResult = await executeTaskWithRetry(
      message,
      taskPayload,
      sshConfig,
    );

    sendMessage("taskDone", message, {
      workerPid: process.pid,
      transferredBytes: transferResult.transferredBytes || 0,
      totalBytes: transferResult.totalBytes || 0,
      segmentOffset: Number.isFinite(taskPayload.segmentOffset)
        ? taskPayload.segmentOffset
        : null,
      segmentLength: Number.isFinite(taskPayload.segmentLength)
        ? taskPayload.segmentLength
        : null,
      segmentIndex: Number.isFinite(taskPayload.segmentIndex)
        ? taskPayload.segmentIndex
        : null,
      segmentCount: Number.isFinite(taskPayload.segmentCount)
        ? taskPayload.segmentCount
        : null,
      direction: taskPayload.direction,
      fileName: taskPayload.fileName || "",
      currentFile: taskPayload.currentFile || taskPayload.fileName || "",
      remotePath: taskPayload.remotePath || "",
      localPath: taskPayload.localPath || "",
      durationMs: Date.now() - currentTaskState.startedAt,
    });
  } catch (error) {
    sendMessage("taskError", message, {
      workerPid: process.pid,
      error: serializeError(error),
      segmentOffset: Number.isFinite(taskPayload.segmentOffset)
        ? taskPayload.segmentOffset
        : null,
      segmentLength: Number.isFinite(taskPayload.segmentLength)
        ? taskPayload.segmentLength
        : null,
      segmentIndex: Number.isFinite(taskPayload.segmentIndex)
        ? taskPayload.segmentIndex
        : null,
      segmentCount: Number.isFinite(taskPayload.segmentCount)
        ? taskPayload.segmentCount
        : null,
      direction: taskPayload.direction,
      fileName: taskPayload.fileName || "",
      remotePath: taskPayload.remotePath || "",
      localPath: taskPayload.localPath || "",
    });
  } finally {
    destroyActiveStreams(buildCancelledError("Task cleanup"));
    currentTaskState = null;
    cancelledTaskKeys.delete(taskKey);
  }
}

async function handleShutdown(message) {
  try {
    if (currentTaskState) {
      destroyActiveStreams(buildCancelledError("Worker shutdown"));
    }
    await closeSession();
  } finally {
    sendMessage("shutdown", message, {
      ok: true,
      workerPid: process.pid,
    });
    process.exit(0);
  }
}

async function handleMessage(message) {
  if (!message || typeof message !== "object") return;

  switch (message.type) {
    case "initSession":
      await handleInitSession(message);
      break;
    case "startTask":
      await handleStartTask(message);
      break;
    case "cancelTask":
      markTaskCancelled(message);
      break;
    case "shutdown":
      await handleShutdown(message);
      break;
    default:
      sendMessage(
        "taskError",
        {
          transferKey: message.transferKey || null,
          taskId: message.taskId || null,
          tabId: message.tabId || null,
          attempt: Number.isFinite(message.attempt) ? message.attempt : 0,
        },
        {
          error: serializeError(
            new Error(`Unsupported worker message type: ${message.type}`),
          ),
          workerPid: process.pid,
        },
      );
      break;
  }
}

const heartbeatTimer = setInterval(() => {
  const base = currentTaskState
    ? {
        transferKey:
          currentSession?.transferKey ||
          currentTaskState.taskKey.split("::")[0] ||
          null,
        taskId: currentTaskState.taskKey.split("::")[1] || null,
        tabId: currentSession?.tabId || null,
        attempt: 0,
      }
    : {
        transferKey: currentSession?.transferKey || null,
        taskId: null,
        tabId: currentSession?.tabId || null,
        attempt: 0,
      };

  sendMessage("heartbeat", base, {
    workerPid: process.pid,
    busy: Boolean(currentTaskState),
  });
}, HEARTBEAT_INTERVAL_MS);

if (typeof heartbeatTimer.unref === "function") {
  heartbeatTimer.unref();
}

process.on("message", (message) => {
  Promise.resolve(handleMessage(message)).catch((error) => {
    const envelope = {
      transferKey: message?.transferKey || null,
      taskId: message?.taskId || null,
      tabId: message?.tabId || null,
      attempt: Number.isFinite(message?.attempt) ? message.attempt : 0,
    };
    sendMessage("taskError", envelope, {
      workerPid: process.pid,
      error: serializeError(error),
    });
  });
});

process.on("disconnect", () => {
  Promise.resolve(closeSession()).finally(() => {
    process.exit(0);
  });
});

process.on("uncaughtException", (error) => {
  const envelope = {
    transferKey: currentSession?.transferKey || null,
    taskId: currentTaskState?.taskKey?.split("::")[1] || null,
    tabId: currentSession?.tabId || null,
    attempt: 0,
  };
  sendMessage("taskError", envelope, {
    workerPid: process.pid,
    fatal: true,
    error: serializeError(error),
  });
});

process.on("unhandledRejection", (reason) => {
  const envelope = {
    transferKey: currentSession?.transferKey || null,
    taskId: currentTaskState?.taskKey?.split("::")[1] || null,
    tabId: currentSession?.tabId || null,
    attempt: 0,
  };
  sendMessage("taskError", envelope, {
    workerPid: process.pid,
    fatal: true,
    error: serializeError(
      reason instanceof Error ? reason : new Error(String(reason)),
    ),
  });
});
