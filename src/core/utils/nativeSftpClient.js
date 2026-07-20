const { spawn } = require("child_process");

const processManager = require("../process/processManager");
const { getTransferNativeScannerPath } = require("./nativeTransferSidecar");
const { processSSHPrivateKeyAsync } = require("./ssh-utils");
const { getTrustedHostFingerprint } = require("./sshHostKeyTrust");
const { logToFile } = require("./logger");
const { recordCrashMarker } = require("./crashReporter");
const {
  normalizeProxyConfig,
  buildNetworkPath,
  recordNativeSidecarNetworkPath,
  resolveNativeSidecarNetworkPath,
} = require("./nativeSidecarNetworkPath");

const NATIVE_SFTP_SCHEMA_VERSION = 1;
let nativeRequestSequence = 0;

function createNativeRequestId(operation) {
  nativeRequestSequence = (nativeRequestSequence + 1) % Number.MAX_SAFE_INTEGER;
  return `native-sftp-${operation || "request"}-${Date.now()}-${nativeRequestSequence}`;
}

function normalizeNativeRequest(request = {}) {
  const operation = request?.operation || "unknown-operation";
  return {
    ...request,
    schemaVersion: NATIVE_SFTP_SCHEMA_VERSION,
    requestId: request.requestId || createNativeRequestId(operation),
  };
}

function normalizeErrorMessage(error) {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function normalizeLogLevel(level, fallback = "WARN") {
  const normalized = String(level || "")
    .trim()
    .toUpperCase();
  return ["DEBUG", "INFO", "WARN", "ERROR"].includes(normalized)
    ? normalized
    : fallback;
}

function isExpectedNativeFailure(value, options = {}) {
  if (typeof options.expectedFailure !== "function") {
    return false;
  }

  try {
    return options.expectedFailure(value) === true;
  } catch (error) {
    logToFile(
      `Native SFTP: expectedFailure predicate failed - ${normalizeErrorMessage(error)}`,
      "WARN",
    );
    return false;
  }
}

function parseStructuredErrorText(value) {
  const text = String(value || "").trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    if (parsed?.type === "result" && parsed.result) {
      return parsed.result;
    }
    return parsed;
  } catch {
    return null;
  }
}

function createNativeSidecarError(message, payload = {}) {
  const error = new Error(message || payload.error || "Native sidecar failed");
  const errorCode = payload.errorCode || payload.code || "NATIVE_SFTP_SIDECAR";
  error.code = errorCode;
  error.errorCode = errorCode;
  error.errorKind = payload.errorKind || payload.kind || "sidecar";
  error.retryable = payload.retryable === true;
  error.module = payload.module || "native-sidecar";
  error.operation = payload.operation || null;
  error.requestId = payload.requestId || null;
  error.sidecarVersion = payload.sidecarVersion || null;
  error.raw = payload.raw || payload;
  return error;
}

function normalizeNativeErrorPayload(payload, fallbackMessage) {
  const structured =
    payload && typeof payload === "object"
      ? payload
      : parseStructuredErrorText(payload);
  const message =
    structured?.error ||
    structured?.message ||
    fallbackMessage ||
    normalizeErrorMessage(payload);

  if (structured && typeof structured === "object") {
    return {
      ...structured,
      success: false,
      error: message,
      message,
      errorCode:
        structured.errorCode || structured.code || "NATIVE_SFTP_SIDECAR",
      errorKind: structured.errorKind || structured.kind || "sidecar",
      retryable: structured.retryable === true,
      module: structured.module || "native-sidecar",
    };
  }

  return {
    success: false,
    error: message,
    message,
    errorCode: "NATIVE_SFTP_SIDECAR",
    errorKind: "sidecar",
    retryable: false,
    module: "native-sidecar",
  };
}

function normalizeNativeResultPayload(result, request) {
  if (!result || typeof result !== "object") {
    return result;
  }

  return {
    schemaVersion: result.schemaVersion || NATIVE_SFTP_SCHEMA_VERSION,
    requestId: result.requestId || request?.requestId || null,
    operation: result.operation || request?.operation || null,
    ...result,
  };
}

function resolveExpectedHostFingerprint(rawConfig, fallbackConfigs = []) {
  const configs = [rawConfig, ...fallbackConfigs];
  const fingerprint = configs
    .filter(Boolean)
    .map(
      (config) =>
        config?.expectedHostFingerprint || getTrustedHostFingerprint(config),
    )
    .find(Boolean);
  if (fingerprint) {
    return fingerprint;
  }

  throw createNativeSidecarError(
    "SSH host key has not been trusted by the main connection",
    {
      errorCode: "NATIVE_SFTP_HOST_KEY_NOT_TRUSTED",
      errorKind: "hostKey",
      retryable: false,
      module: "native-sftp-client",
    },
  );
}

function prepareNativeSshConfig(config) {
  const expectedHostFingerprint = resolveExpectedHostFingerprint(config);
  const proxy = normalizeProxyConfig(config?.proxy);
  const proxyRequired =
    config?.proxyRequired === true ||
    config?.networkPath?.proxyRequired === true ||
    config?.networkPath?.mode === "proxy" ||
    Boolean(proxy);

  if (proxyRequired && !proxy) {
    throw createNativeSidecarError(
      "Native sidecar transfer requires a proxy, but no supported proxy was resolved",
      {
        errorCode: "NATIVE_SFTP_PROXY_REQUIRED",
        errorKind: "proxy",
        retryable: true,
        module: "native-sftp-client",
      },
    );
  }

  const networkPath =
    config?.networkPath && typeof config.networkPath === "object"
      ? config.networkPath
      : buildNetworkPath(proxy, proxyRequired);

  return {
    ...config,
    proxy: proxy || undefined,
    proxyRequired,
    networkPath,
    expectedHostFingerprint,
  };
}

async function resolveSshConfig(tabId) {
  const processInfo = processManager.getProcess(tabId);
  const rawConfig = processInfo?.config;
  if (!rawConfig?.host || !rawConfig?.username) {
    logToFile(`Native SFTP: missing SSH config for tab ${tabId}`, "WARN");
    throw createNativeSidecarError("SSH connection config is unavailable", {
      errorCode: "NATIVE_SFTP_MISSING_CONFIG",
      errorKind: "validation",
      retryable: false,
      module: "native-sftp-client",
    });
  }

  const expectedHostFingerprint = resolveExpectedHostFingerprint(rawConfig, [
    processInfo?.connectionInfo?.config,
  ]);
  const sshConfig = await processSSHPrivateKeyAsync({
    host: rawConfig.host,
    port: rawConfig.port || 22,
    username: rawConfig.username,
    password: rawConfig.password || undefined,
    privateKey: rawConfig.privateKey || undefined,
    privateKeyPath: rawConfig.privateKeyPath || undefined,
    passphrase: rawConfig.passphrase || undefined,
  });
  const networkPath = await resolveNativeSidecarNetworkPath(rawConfig);

  return {
    host: sshConfig.host,
    port: sshConfig.port || 22,
    username: sshConfig.username,
    password: sshConfig.password || undefined,
    privateKey: sshConfig.privateKey || undefined,
    passphrase: sshConfig.passphrase || undefined,
    proxy: networkPath.proxy || undefined,
    proxyRequired: networkPath.proxyRequired,
    networkPath: networkPath.networkPath,
    expectedHostFingerprint,
  };
}

function invokeNativeRequest(tabId, request, options = {}) {
  const sidecarPath = getTransferNativeScannerPath();
  if (!sidecarPath) {
    logToFile(
      `Native SFTP: sidecar binary not found for ${request?.operation || "unknown-operation"}`,
      "ERROR",
    );
    return Promise.reject(
      createNativeSidecarError("Rust transfer sidecar was not found", {
        errorCode: "NATIVE_SFTP_SIDECAR_MISSING",
        errorKind: "sidecar",
        retryable: false,
      }),
    );
  }

  logToFile(
    `Native SFTP: invoking ${request?.operation || "unknown-operation"} for tab ${tabId} via ${sidecarPath}`,
    "INFO",
  );

  return resolveSshConfig(tabId).then((config) =>
    invokeNativeRequestWithConfig(config, request, options, sidecarPath),
  );
}

function invokeNativeRequestWithConfig(
  config,
  request,
  options = {},
  resolvedSidecarPath = null,
) {
  const sidecarPath = resolvedSidecarPath || getTransferNativeScannerPath();
  if (!sidecarPath) {
    logToFile(
      `Native SFTP: sidecar binary not found for ${request?.operation || "unknown-operation"}`,
      "ERROR",
    );
    return Promise.reject(
      createNativeSidecarError("Rust transfer sidecar was not found", {
        errorCode: "NATIVE_SFTP_SIDECAR_MISSING",
        errorKind: "sidecar",
        retryable: false,
      }),
    );
  }

  const normalizedRequest = normalizeNativeRequest(request);
  let nativeConfig;
  try {
    nativeConfig = prepareNativeSshConfig(config);
    recordNativeSidecarNetworkPath(nativeConfig.networkPath);
  } catch (error) {
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(sidecarPath, ["sftp-request"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    if (typeof options.onSpawn === "function") {
      try {
        options.onSpawn(child);
      } catch {
        // ignore callback failures
      }
    }

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    let finalResult = null;

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      logToFile(
        `Native SFTP: ${normalizedRequest.operation || "unknown-operation"} failed - ${normalizeErrorMessage(error)}`,
        "ERROR",
      );
      reject(error);
    };

    const resolveOnce = (value) => {
      if (settled) return;
      settled = true;
      if (value?.success === false) {
        const expectedFailure = isExpectedNativeFailure(value, options);
        const level = expectedFailure
          ? normalizeLogLevel(options.expectedFailureLevel, "DEBUG")
          : "WARN";
        const status = expectedFailure ? "expected error" : "error";
        logToFile(
          `Native SFTP: ${normalizedRequest.operation || "unknown-operation"} completed with ${status} - ${value?.error || "unknown error"}`,
          level,
        );
      } else {
        logToFile(
          `Native SFTP: ${normalizedRequest.operation || "unknown-operation"} completed successfully`,
          "INFO",
        );
      }
      resolve(value);
    };

    const handleOutputLine = (line) => {
      if (!line) return;

      let payload;
      try {
        payload = JSON.parse(line);
      } catch (error) {
        rejectOnce(
          createNativeSidecarError(
            `Native SFTP sidecar returned invalid JSON: ${normalizeErrorMessage(error)}`,
            {
              errorCode: "NATIVE_SFTP_INVALID_SIDECAR_OUTPUT",
              errorKind: "internal",
              retryable: false,
              operation: normalizedRequest.operation || null,
              requestId: normalizedRequest.requestId,
              raw: { line },
            },
          ),
        );
        return;
      }

      if (payload?.type === "progress") {
        if (typeof options.onProgress === "function") {
          options.onProgress({
            requestId: normalizedRequest.requestId,
            schemaVersion: NATIVE_SFTP_SCHEMA_VERSION,
            ...payload,
          });
        }
        return;
      }

      if (payload?.type === "result") {
        finalResult = normalizeNativeResultPayload(
          payload.result || null,
          normalizedRequest,
        );
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        handleOutputLine(line.trim());
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      rejectOnce(
        createNativeSidecarError(
          `Failed to start native SFTP sidecar: ${normalizeErrorMessage(error)}`,
          {
            errorCode: "NATIVE_SFTP_SIDECAR_START_FAILED",
            errorKind: "sidecar",
            retryable: false,
            operation: normalizedRequest.operation || null,
            requestId: normalizedRequest.requestId,
            raw: error,
          },
        ),
      );
    });

    child.on("close", (code) => {
      if (stdoutBuffer.trim()) {
        handleOutputLine(stdoutBuffer.trim());
      }

      if (code !== 0) {
        const structured = normalizeNativeErrorPayload(
          stderrBuffer.trim() || finalResult,
          (finalResult && finalResult.error) ||
            `Native SFTP sidecar exited with code ${code}`,
        );
        recordCrashMarker(null, {
          module: "native-sidecar",
          processType: "native-sidecar",
          type: "sidecar-exit",
          reason: structured.error,
          exitCode: code,
          operation: normalizedRequest.operation || null,
          error: structured.error,
          extra: {
            requestId: normalizedRequest.requestId,
            errorCode: structured.errorCode,
            errorKind: structured.errorKind,
            retryable: structured.retryable,
          },
        });
        rejectOnce(
          createNativeSidecarError(structured.error, {
            ...structured,
            operation:
              structured.operation || normalizedRequest.operation || null,
            requestId: structured.requestId || normalizedRequest.requestId,
            raw: { ...structured, exitCode: code },
          }),
        );
        return;
      }

      if (!finalResult) {
        rejectOnce(
          createNativeSidecarError(
            stderrBuffer.trim() ||
              "Native SFTP sidecar did not return a result payload",
            {
              errorCode: "NATIVE_SFTP_MISSING_RESULT",
              errorKind: "internal",
              retryable: false,
              operation: normalizedRequest.operation || null,
              requestId: normalizedRequest.requestId,
            },
          ),
        );
        return;
      }

      if (finalResult.success === false) {
        if (finalResult.networkPath) {
          recordNativeSidecarNetworkPath(finalResult.networkPath);
        }
        resolveOnce(finalResult);
        return;
      }

      if (finalResult.networkPath) {
        recordNativeSidecarNetworkPath(finalResult.networkPath);
      }
      resolveOnce(finalResult);
    });

    const envelope = JSON.stringify({
      schemaVersion: NATIVE_SFTP_SCHEMA_VERSION,
      config: nativeConfig,
      request: normalizedRequest,
    });

    child.stdin.end(envelope, "utf8");
  });
}

function watchDirectory(tabId, remotePath, options = {}) {
  const sidecarPath = getTransferNativeScannerPath();
  if (!sidecarPath) {
    logToFile(
      "Native SFTP: sidecar binary not found for watchDirectory",
      "ERROR",
    );
    return Promise.reject(
      createNativeSidecarError("Rust transfer sidecar was not found", {
        errorCode: "NATIVE_SFTP_SIDECAR_MISSING",
        errorKind: "sidecar",
        retryable: false,
        operation: "watchDirectory",
      }),
    );
  }

  logToFile(
    `Native SFTP: starting directory watch for tab ${tabId} via ${sidecarPath}`,
    "INFO",
  );

  return resolveSshConfig(tabId).then((config) =>
    watchDirectoryWithConfig(config, remotePath, options, sidecarPath),
  );
}

function watchDirectoryWithConfig(
  config,
  remotePath,
  options = {},
  resolvedSidecarPath = null,
) {
  const sidecarPath = resolvedSidecarPath || getTransferNativeScannerPath();
  if (!sidecarPath) {
    logToFile(
      "Native SFTP: sidecar binary not found for watchDirectory",
      "ERROR",
    );
    return Promise.reject(
      createNativeSidecarError("Rust transfer sidecar was not found", {
        errorCode: "NATIVE_SFTP_SIDECAR_MISSING",
        errorKind: "sidecar",
        retryable: false,
        operation: "watchDirectory",
      }),
    );
  }

  return new Promise((resolve, reject) => {
    let nativeConfig;
    try {
      nativeConfig = prepareNativeSshConfig(config);
      recordNativeSidecarNetworkPath(nativeConfig.networkPath);
    } catch (error) {
      reject(error);
      return;
    }

    const child = spawn(sidecarPath, ["sftp-watch"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    let closedByClient = false;
    let runtimeErrorNotified = false;
    const requestedIntervalMs = Math.floor(Number(options.intervalMs));
    const request = normalizeNativeRequest({
      operation: "watchDirectory",
      path: remotePath,
      watchIntervalMs:
        Number.isFinite(requestedIntervalMs) && requestedIntervalMs > 0
          ? requestedIntervalMs
          : undefined,
    });

    const notifyRuntimeError = (error) => {
      if (runtimeErrorNotified) {
        return;
      }
      runtimeErrorNotified = true;
      if (typeof options.onError === "function") {
        options.onError(error);
      }
    };

    const controller = {
      close: () => {
        closedByClient = true;
        try {
          if (!child.killed) {
            child.kill();
          }
        } catch {
          // ignore sidecar shutdown failures
        }
      },
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve(controller);
    };

    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const handleOutputLine = (line) => {
      if (!line) return;

      let payload;
      try {
        payload = JSON.parse(line);
      } catch (error) {
        const wrapped = createNativeSidecarError(
          `Native SFTP sidecar returned invalid JSON: ${normalizeErrorMessage(error)}`,
          {
            errorCode: "NATIVE_SFTP_INVALID_SIDECAR_OUTPUT",
            errorKind: "internal",
            retryable: false,
            operation: "watchDirectory",
            requestId: request.requestId,
            raw: { line },
          },
        );
        if (settled) {
          notifyRuntimeError(wrapped);
          controller.close();
        } else {
          rejectOnce(wrapped);
        }
        return;
      }

      if (payload?.type !== "watch") {
        return;
      }

      const eventName = payload?.event;
      const eventPayload =
        payload?.payload && typeof payload.payload === "object"
          ? payload.payload
          : {};

      if (eventName === "ready") {
        if (typeof options.onReady === "function") {
          options.onReady({
            requestId: request.requestId,
            schemaVersion: payload?.schemaVersion || NATIVE_SFTP_SCHEMA_VERSION,
            ...eventPayload,
          });
        }
        resolveOnce();
        return;
      }

      if (eventName === "changed") {
        if (typeof options.onChanged === "function") {
          options.onChanged({
            requestId: request.requestId,
            schemaVersion: payload?.schemaVersion || NATIVE_SFTP_SCHEMA_VERSION,
            ...eventPayload,
          });
        }
        return;
      }

      if (eventName === "error") {
        const payloadError = normalizeNativeErrorPayload(
          eventPayload,
          eventPayload?.error || "Native SFTP directory watch failed",
        );
        const wrapped = createNativeSidecarError(payloadError.error, {
          ...payloadError,
          operation: payloadError.operation || "watchDirectory",
          requestId: payloadError.requestId || request.requestId,
        });
        if (settled) {
          notifyRuntimeError(wrapped);
          controller.close();
        } else {
          rejectOnce(wrapped);
        }
      }
    };

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        handleOutputLine(line.trim());
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      const wrapped = createNativeSidecarError(
        `Failed to start native SFTP sidecar: ${normalizeErrorMessage(error)}`,
        {
          errorCode: "NATIVE_SFTP_SIDECAR_START_FAILED",
          errorKind: "sidecar",
          retryable: false,
          operation: "watchDirectory",
          requestId: request.requestId,
          raw: error,
        },
      );
      if (settled) {
        notifyRuntimeError(wrapped);
        return;
      }
      rejectOnce(wrapped);
    });

    child.on("close", (code, signal) => {
      if (stdoutBuffer.trim()) {
        handleOutputLine(stdoutBuffer.trim());
      }

      const exitInfo = {
        code,
        signal,
        stderr: stderrBuffer.trim(),
        closedByClient,
      };
      const emitExit = () => {
        if (typeof options.onExit === "function") {
          options.onExit(exitInfo);
        }
      };

      if (closedByClient || signal === "SIGTERM" || signal === "SIGKILL") {
        if (!settled) {
          rejectOnce(new Error("Native SFTP directory watch was cancelled"));
        }
        emitExit();
        return;
      }

      if (code !== 0) {
        const structured = normalizeNativeErrorPayload(
          stderrBuffer.trim() ||
            `Native SFTP directory watch exited with code ${code}`,
        );
        recordCrashMarker(null, {
          module: "native-sidecar",
          processType: "native-sidecar",
          type: "sidecar-exit",
          reason: structured.error,
          exitCode: code,
          signal,
          operation: "watchDirectory",
          error: structured.error,
          extra: {
            requestId: structured.requestId || request.requestId,
            errorCode: structured.errorCode,
            errorKind: structured.errorKind,
            retryable: structured.retryable,
          },
        });
        const wrapped = createNativeSidecarError(structured.error, {
          ...structured,
          operation: structured.operation || "watchDirectory",
          requestId: structured.requestId || request.requestId,
          raw: { ...structured, exitCode: code, signal },
        });
        if (settled) {
          notifyRuntimeError(wrapped);
        } else {
          rejectOnce(wrapped);
        }
        emitExit();
        return;
      }

      if (!settled) {
        rejectOnce(
          createNativeSidecarError(
            "Native SFTP directory watch closed before it became ready",
            {
              errorCode: "NATIVE_SFTP_WATCH_CLOSED_BEFORE_READY",
              errorKind: "sidecar",
              retryable: true,
              operation: "watchDirectory",
              requestId: request.requestId,
            },
          ),
        );
        emitExit();
        return;
      }

      notifyRuntimeError(
        createNativeSidecarError(
          "Native SFTP directory watch closed unexpectedly",
          {
            errorCode: "NATIVE_SFTP_WATCH_CLOSED",
            errorKind: "sidecar",
            retryable: true,
            operation: "watchDirectory",
            requestId: request.requestId,
          },
        ),
      );
      emitExit();
    });

    const envelope = JSON.stringify({
      schemaVersion: NATIVE_SFTP_SCHEMA_VERSION,
      config: nativeConfig,
      request,
    });

    child.stdin.end(envelope, "utf8");
  });
}

async function listFiles(tabId, remotePath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "listFiles",
      path: remotePath,
    },
    options,
  );
}

async function scanRemoteFolderTree(tabId, remotePath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "scanRemoteFolderTree",
      path: remotePath,
    },
    options,
  );
}

async function copyFile(tabId, sourcePath, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "copyFile",
    sourcePath,
    targetPath,
  });
}

async function moveFile(tabId, sourcePath, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "moveFile",
    sourcePath,
    targetPath,
  });
}

async function deleteFile(tabId, targetPath, isDirectory = false) {
  return invokeNativeRequest(tabId, {
    operation: "deleteFile",
    path: targetPath,
    isDirectory,
  });
}

async function createFolder(tabId, folderPath) {
  return invokeNativeRequest(tabId, {
    operation: "createFolder",
    path: folderPath,
  });
}

async function createFile(tabId, filePath) {
  return invokeNativeRequest(tabId, {
    operation: "createFile",
    path: filePath,
  });
}

async function renameFile(tabId, sourcePath, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "renameFile",
    sourcePath,
    targetPath,
  });
}

async function getFilePermissions(tabId, targetPath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "getFilePermissions",
      path: targetPath,
    },
    options,
  );
}

async function getAbsolutePath(tabId, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "getAbsolutePath",
    path: targetPath,
  });
}

async function readFileContent(tabId, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "readFileContent",
    path: targetPath,
  });
}

async function readFileAsBase64(tabId, targetPath) {
  return invokeNativeRequest(tabId, {
    operation: "readFileAsBase64",
    path: targetPath,
  });
}

async function saveFileContent(tabId, targetPath, content) {
  return invokeNativeRequest(tabId, {
    operation: "saveFileContent",
    path: targetPath,
    contentBase64: Buffer.from(String(content ?? ""), "utf8").toString(
      "base64",
    ),
  });
}

async function setFilePermissions(tabId, targetPath, permissions) {
  return invokeNativeRequest(tabId, {
    operation: "setFilePermissions",
    path: targetPath,
    permissions: String(permissions || ""),
  });
}

async function setFileOwnership(tabId, targetPath, owner, group) {
  return invokeNativeRequest(tabId, {
    operation: "setFileOwnership",
    path: targetPath,
    owner,
    group,
  });
}

async function createRemoteFolders(tabId, folderPath) {
  return invokeNativeRequest(tabId, {
    operation: "createRemoteFolders",
    path: folderPath,
  });
}

async function getFilePermissionsBatch(tabId, filePaths, options = {}) {
  const results = await Promise.all(
    (Array.isArray(filePaths) ? filePaths : []).map(async (filePath) => {
      const result = await getFilePermissions(tabId, filePath, options);
      return result?.success
        ? {
            path: filePath,
            success: true,
            permissions: result.permissions,
            mode: result.mode,
            uid: result.uid,
            gid: result.gid,
            stats: result.stats,
          }
        : {
            path: filePath,
            success: false,
            error: result?.error || "Failed to read permissions",
          };
    }),
  );

  return { success: true, results };
}

async function uploadFile(tabId, localPath, remotePath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "uploadFileToRemote",
      path: remotePath,
      localPath,
      segmentOffset: options.segmentOffset,
      segmentLength: options.segmentLength,
      remoteWriteFlags: options.remoteWriteFlags,
    },
    options,
  );
}

async function downloadFile(tabId, remotePath, localPath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "downloadFileToLocal",
      path: remotePath,
      localPath,
      segmentOffset: options.segmentOffset,
      segmentLength: options.segmentLength,
      localWriteFlags: options.localWriteFlags,
    },
    options,
  );
}

module.exports = {
  invokeNativeRequestWithConfig,
  listFiles,
  watchDirectory,
  scanRemoteFolderTree,
  copyFile,
  moveFile,
  deleteFile,
  createFolder,
  createFile,
  renameFile,
  getFilePermissions,
  getFilePermissionsBatch,
  getAbsolutePath,
  readFileContent,
  readFileAsBase64,
  saveFileContent,
  setFilePermissions,
  setFileOwnership,
  createRemoteFolders,
  uploadFile,
  downloadFile,
};
