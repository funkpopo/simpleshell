const {
  getTransferNativeScannerPath,
} = require("../core/utils/nativeTransferSidecar");
const {
  invokeNativeRequestWithConfig,
} = require("../core/utils/nativeSftpClient");

const HEARTBEAT_INTERVAL_MS = 2000;
const parentPort = process.parentPort || null;

let currentTransferKey = null;
let currentTabId = null;
let currentTaskState = null;
const cancelledTaskKeys = new Set();

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

function taskKeyOf(envelope) {
  return `${envelope.transferKey}::${envelope.taskId}`;
}

function isTaskCancelled(envelope) {
  return cancelledTaskKeys.has(taskKeyOf(envelope));
}

function extractMessage(messageEvent) {
  if (
    messageEvent &&
    typeof messageEvent === "object" &&
    Object.prototype.hasOwnProperty.call(messageEvent, "data")
  ) {
    return messageEvent.data;
  }

  return messageEvent;
}

function sendMessage(type, envelope, payload = {}) {
  const message = {
    type,
    transferKey: envelope?.transferKey ?? null,
    taskId: envelope?.taskId ?? null,
    tabId: envelope?.tabId ?? null,
    attempt: Number.isFinite(envelope?.attempt) ? envelope.attempt : 0,
    timestamp: Date.now(),
    ...payload,
  };

  if (parentPort && typeof parentPort.postMessage === "function") {
    parentPort.postMessage(message);
    return;
  }

  if (typeof process.send === "function") {
    process.send(message);
  }
}

function terminateCurrentChild(reason = "Transfer cancelled by user") {
  if (!currentTaskState?.child) return;
  try {
    currentTaskState.child.kill();
  } catch {
    // ignore process kill failures
  }
  currentTaskState.child = null;
  currentTaskState.cancelReason = reason;
}

function validateWorkerInit(message) {
  if (!getTransferNativeScannerPath()) {
    throw new Error("Rust transfer sidecar was not found");
  }

  const sshConfig = message?.payload?.sshConfig || {};
  if (!sshConfig?.host || !sshConfig?.username) {
    throw new Error("Invalid SSH configuration for transfer worker");
  }
}

function buildNativeRequest(task) {
  const base = {
    path: task.remotePath,
    localPath: task.localPath,
    segmentOffset: Number.isFinite(task.segmentOffset)
      ? task.segmentOffset
      : undefined,
    segmentLength: Number.isFinite(task.segmentLength)
      ? task.segmentLength
      : undefined,
  };

  if (task.direction === "upload") {
    if (!task.remotePath || !task.localPath) {
      throw new Error("Upload task missing remotePath/localPath");
    }
    return {
      operation: "uploadFileToRemote",
      ...base,
      remoteWriteFlags: task.remoteWriteFlags,
    };
  }

  if (task.direction === "download") {
    if (!task.remotePath || !task.localPath) {
      throw new Error("Download task missing remotePath/localPath");
    }
    return {
      operation: "downloadFileToLocal",
      ...base,
      localWriteFlags: task.localWriteFlags,
    };
  }

  throw new Error(`Unsupported transfer direction: ${task.direction}`);
}

async function executeTask(message, taskPayload) {
  if (isTaskCancelled(message)) {
    throw buildCancelledError();
  }

  const request = buildNativeRequest(taskPayload);
  const sshConfig = taskPayload?.sshConfig || {};

  const result = await invokeNativeRequestWithConfig(sshConfig, request, {
    onSpawn: (child) => {
      if (!currentTaskState) return;
      currentTaskState.child = child;
      if (isTaskCancelled(message)) {
        terminateCurrentChild();
      }
    },
    onProgress: (payload) => {
      if (isTaskCancelled(message)) {
        terminateCurrentChild();
        return;
      }

      sendMessage("progress", message, {
        workerPid: process.pid,
        deltaBytes: Math.max(0, Number(payload?.deltaBytes) || 0),
        transferredBytes: Math.max(0, Number(payload?.transferredBytes) || 0),
        totalBytes: Number.isFinite(taskPayload.totalBytes)
          ? taskPayload.totalBytes
          : Math.max(0, Number(payload?.totalBytes) || 0),
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
      });
    },
  });

  if (isTaskCancelled(message)) {
    throw buildCancelledError();
  }

  if (result?.success === false) {
    throw new Error(result.error || "Native transfer task failed");
  }

  return {
    transferredBytes: Math.max(0, Number(result?.transferredBytes) || 0),
    totalBytes: Number.isFinite(taskPayload.totalBytes)
      ? taskPayload.totalBytes
      : Math.max(0, Number(result?.totalBytes) || 0),
  };
}

async function handleInitSession(message) {
  try {
    validateWorkerInit(message);
    currentTransferKey = message?.transferKey || null;
    currentTabId = message?.tabId || null;
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
  cancelledTaskKeys.add(taskKeyOf(message));

  if (currentTaskState && currentTaskState.taskKey === taskKeyOf(message)) {
    terminateCurrentChild();
  }
}

async function handleStartTask(message) {
  const taskPayload = message?.payload || {};
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

  currentTransferKey = message?.transferKey || currentTransferKey;
  currentTabId = message?.tabId || currentTabId;
  currentTaskState = {
    taskKey,
    startedAt: Date.now(),
    child: null,
    cancelReason: null,
  };

  try {
    const transferResult = await executeTask(message, taskPayload);
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
    const taskError =
      isTaskCancelled(message) || currentTaskState?.cancelReason
        ? buildCancelledError(currentTaskState?.cancelReason)
        : error;
    sendMessage("taskError", message, {
      workerPid: process.pid,
      error: serializeError(taskError),
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
    cancelledTaskKeys.delete(taskKey);
    currentTaskState = null;
  }
}

async function handleShutdown(message) {
  try {
    terminateCurrentChild("Worker shutdown");
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
        transferKey: currentTransferKey,
        taskId: currentTaskState.taskKey.split("::")[1] || null,
        tabId: currentTabId,
        attempt: 0,
      }
    : {
        transferKey: currentTransferKey,
        taskId: null,
        tabId: currentTabId,
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

const handleIncomingMessage = (incomingMessage) => {
  const message = extractMessage(incomingMessage);

  Promise.resolve(handleMessage(message)).catch((error) => {
    const envelope = {
      transferKey: message?.transferKey || currentTransferKey || null,
      taskId: message?.taskId || currentTaskState?.taskKey?.split("::")[1] || null,
      tabId: message?.tabId || currentTabId || null,
      attempt: Number.isFinite(message?.attempt) ? message.attempt : 0,
    };
    sendMessage("taskError", envelope, {
      workerPid: process.pid,
      error: serializeError(error),
    });
  });
};

if (parentPort && typeof parentPort.on === "function") {
  parentPort.on("message", handleIncomingMessage);
} else {
  process.on("message", handleIncomingMessage);
}

process.on("disconnect", () => {
  terminateCurrentChild("Worker disconnect");
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  const envelope = {
    transferKey: currentTransferKey || null,
    taskId: currentTaskState?.taskKey?.split("::")[1] || null,
    tabId: currentTabId || null,
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
    transferKey: currentTransferKey || null,
    taskId: currentTaskState?.taskKey?.split("::")[1] || null,
    tabId: currentTabId || null,
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
