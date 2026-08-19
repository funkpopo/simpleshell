const { spawn } = require("child_process");

const processManager = require("../process/processManager");
const { getNativeServicesHostPath } = require("./nativeServices");
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
const { normalizeErrorMessage } = require("./errorResponse");

const NATIVE_SFTP_SCHEMA_VERSION = 1;
let nativeRequestSequence = 0;
const nativeSftpSessions = new Map();
const NATIVE_SFTP_SESSION_IDLE_TIMEOUT_MS = 30_000;

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

function normalizeLogLevel(level, fallback = "WARN") {
  const normalized = String(level || "")
    .trim()
    .toUpperCase();
  return ["DEBUG", "INFO", "WARN", "ERROR"].includes(normalized)
    ? normalized
    : fallback;
}

function logNativeStage(operation, requestId, stage, elapsedMs, startedAt) {
  const numericElapsed = Number(elapsedMs);
  const nativeElapsed = Number.isFinite(numericElapsed)
    ? ` nativeElapsedMs=${Math.max(0, numericElapsed)}`
    : "";
  const observedElapsed = startedAt
    ? ` observedElapsedMs=${Math.max(0, Date.now() - startedAt)}`
    : "";
  logToFile(
    `Native SFTP: stage=${stage} operation=${operation || "unknown-operation"} requestId=${requestId || "none"}${nativeElapsed}${observedElapsed}`,
    "INFO",
  );
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

async function resolveSshConfig(tabId, options = {}) {
  const {
    includeTimeouts = false,
    plainErrors = false,
    proxyManager = undefined,
  } = options;

  const processInfo = processManager.getProcess(tabId);
  const rawConfig = processInfo?.config;
  if (!rawConfig?.host || !rawConfig?.username) {
    if (plainErrors) {
      throw new Error("SSH connection config is unavailable");
    }
    logToFile(`Native SFTP: missing SSH config for tab ${tabId}`, "WARN");
    throw createNativeSidecarError("SSH connection config is unavailable", {
      errorCode: "NATIVE_SFTP_MISSING_CONFIG",
      errorKind: "validation",
      retryable: false,
      module: "native-sftp-client",
    });
  }

  let expectedHostFingerprint;
  if (plainErrors) {
    expectedHostFingerprint =
      getTrustedHostFingerprint(rawConfig) ||
      getTrustedHostFingerprint(processInfo?.connectionInfo?.config);
    if (!expectedHostFingerprint) {
      throw new Error(
        "SSH host key has not been trusted by the main connection",
      );
    }
  } else {
    expectedHostFingerprint = resolveExpectedHostFingerprint(rawConfig, [
      processInfo?.connectionInfo?.config,
    ]);
  }

  const sshConfig = await processSSHPrivateKeyAsync({
    host: rawConfig.host,
    port: rawConfig.port || 22,
    username: rawConfig.username,
    password: rawConfig.password || undefined,
    privateKey: rawConfig.privateKey || undefined,
    privateKeyPath: rawConfig.privateKeyPath || undefined,
    passphrase: rawConfig.passphrase || undefined,
    ...(includeTimeouts
      ? {
          readyTimeout: rawConfig.readyTimeout || undefined,
          keepaliveInterval: rawConfig.keepaliveInterval || undefined,
          keepaliveCountMax: rawConfig.keepaliveCountMax || undefined,
          expectedHostFingerprint,
        }
      : {}),
  });

  const networkPath = await resolveNativeSidecarNetworkPath(
    rawConfig,
    proxyManager !== undefined ? { proxyManager } : {},
  );

  if (includeTimeouts) {
    if (sshConfig?.privateKeyPath && sshConfig.privateKey) {
      delete sshConfig.privateKeyPath;
    }
    sshConfig.proxy = networkPath.proxy || undefined;
    sshConfig.proxyRequired = networkPath.proxyRequired;
    sshConfig.networkPath = networkPath.networkPath;
    return sshConfig;
  }

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
  const sidecarPath = getNativeServicesHostPath();
  if (!sidecarPath) {
    logToFile(
      `Native SFTP: sidecar binary not found for ${request?.operation || "unknown-operation"}`,
      "ERROR",
    );
    return Promise.reject(
      createNativeSidecarError("Native services host was not found", {
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
    invokeNativeRequestWithConfig(
      config,
      request,
      { ...options, sessionKey: options.sessionKey || String(tabId) },
      sidecarPath,
    ),
  );
}

function buildInvalidSidecarOutputError(error, request, line) {
  return createNativeSidecarError(
    `Native SFTP sidecar returned invalid JSON: ${normalizeErrorMessage(error)}`,
    {
      errorCode: "NATIVE_SFTP_INVALID_SIDECAR_OUTPUT",
      errorKind: "internal",
      retryable: false,
      operation: request.operation || null,
      requestId: request.requestId,
      raw: { line },
    },
  );
}

/**
 * Spawns the native sidecar in the given mode ("sftp-request" | "sftp-watch"),
 * wires up the shared plumbing (stdout line buffering, stderr accumulation,
 * child-error wrapping, close flush) and writes the request envelope to stdin.
 * Mode-specific semantics (single response vs long-lived stream) stay in the
 * callers via the onLine/onChildError/onClose callbacks.
 */
function spawnSidecarSession({
  sidecarPath,
  mode,
  nativeConfig,
  request,
  onSpawn,
  onLine,
  onChildError,
  onClose,
}) {
  const child = spawn(sidecarPath, [mode], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  if (typeof onSpawn === "function") {
    try {
      onSpawn(child);
    } catch {
      // ignore callback failures
    }
  }

  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      onLine(line.trim());
    }
  });

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString("utf8");
  });

  child.on("error", (error) => {
    onChildError(
      createNativeSidecarError(
        `Failed to start native SFTP sidecar: ${normalizeErrorMessage(error)}`,
        {
          errorCode: "NATIVE_SFTP_SIDECAR_START_FAILED",
          errorKind: "sidecar",
          retryable: false,
          operation: request.operation || null,
          requestId: request.requestId,
          raw: error,
        },
      ),
    );
  });

  child.on("close", (code, signal) => {
    if (stdoutBuffer.trim()) {
      onLine(stdoutBuffer.trim());
    }
    onClose(code, signal, stderrBuffer.trim());
  });

  child.stdin.end(
    JSON.stringify({
      schemaVersion: NATIVE_SFTP_SCHEMA_VERSION,
      config: nativeConfig,
      request,
    }),
    "utf8",
  );

  return child;
}

class NativeSftpSession {
  constructor({ sidecarPath, nativeConfig, sessionKey }) {
    this.sidecarPath = sidecarPath;
    this.nativeConfig = nativeConfig;
    this.sessionKey = sessionKey;
    this.child = null;
    this.stdoutBuffer = "";
    this.stderrBuffer = "";
    this.pending = new Map();
    this.closed = false;
    this.closeRequested = false;
    this.idleTimer = null;
    this.spawnStartedAt = Date.now();
    this._spawn();
  }

  _spawn() {
    this.child = spawn(this.sidecarPath, ["sftp-session"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    logToFile(
      `Native SFTP session: spawned sessionKey=${this.sessionKey} pid=${this.child.pid || "unknown"} spawnElapsedMs=${Date.now() - this.spawnStartedAt}`,
      "INFO",
    );

    this.child.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk.toString("utf8");
      const lines = this.stdoutBuffer.split(/\r?\n/);
      this.stdoutBuffer = lines.pop() || "";
      for (const line of lines) this._handleLine(line.trim());
    });
    this.child.stderr.on("data", (chunk) => {
      this.stderrBuffer += chunk.toString("utf8");
    });
    this.child.on("error", (error) => {
      this._failAll(
        createNativeSidecarError(
          `Failed to start native SFTP session: ${normalizeErrorMessage(error)}`,
          {
            errorCode: "NATIVE_SFTP_SESSION_START_FAILED",
            errorKind: "sidecar",
            retryable: true,
            raw: error,
          },
        ),
      );
    });
    this.child.on("close", (code, signal) => {
      if (this.stdoutBuffer.trim()) this._handleLine(this.stdoutBuffer.trim());
      this.closed = true;
      logToFile(
        `Native SFTP session: stage=sidecarClosed sessionKey=${this.sessionKey} code=${code ?? "none"} signal=${signal || "none"}`,
        "INFO",
      );
      const message = this.closeRequested
        ? null
        : this.stderrBuffer.trim() ||
          `Native SFTP session exited with code ${code}`;
      if (message) {
        this._failAll(
          createNativeSidecarError(message, {
            errorCode: "NATIVE_SFTP_SESSION_CLOSED",
            errorKind: "sidecar",
            retryable: true,
            raw: { code, signal },
          }),
        );
      } else {
        this._failAll(
          createNativeSidecarError("Native SFTP session was closed", {
            errorCode: "NATIVE_SFTP_SESSION_CLOSED",
            errorKind: "sidecar",
            retryable: true,
            raw: { code, signal },
          }),
        );
      }
    });
  }

  _handleLine(line) {
    if (!line) return;
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      this._failAll(
        buildInvalidSidecarOutputError(
          error,
          { operation: "sftp-session", requestId: null },
          line,
        ),
      );
      return;
    }

    const requestId = payload?.requestId;
    const entry = requestId ? this.pending.get(requestId) : null;
    if (!entry) return;

    if (payload.type === "stage") {
      const stage = String(payload.stage || "unknown");
      if (!entry.observedStages.has(stage)) {
        entry.observedStages.add(stage);
        logNativeStage(
          entry.request.operation,
          entry.request.requestId,
          stage,
          payload.elapsedMs,
          entry.startedAt,
        );
      }
      if (typeof entry.options.onStage === "function") {
        entry.options.onStage({
          requestId: entry.request.requestId,
          operation: entry.request.operation,
          stage,
          elapsedMs: payload.elapsedMs,
        });
      }
      return;
    }
    if (payload.type === "progress") {
      if (!entry.observedStages.has("firstProgress")) {
        entry.observedStages.add("firstProgress");
        logNativeStage(
          entry.request.operation,
          entry.request.requestId,
          "firstProgress",
          null,
          entry.startedAt,
        );
      }
      entry.options.onProgress?.({
        requestId: entry.request.requestId,
        schemaVersion: NATIVE_SFTP_SCHEMA_VERSION,
        ...payload,
      });
      return;
    }
    if (payload.type === "listChunk") {
      entry.options.onListChunk?.({
        requestId: entry.request.requestId,
        schemaVersion: NATIVE_SFTP_SCHEMA_VERSION,
        ...payload,
      });
      return;
    }
    if (payload.type !== "result") return;

    this.pending.delete(requestId);
    this._armIdleTimer();
    const result = normalizeNativeResultPayload(
      payload.result || null,
      entry.request,
    );
    if (result?.networkPath) recordNativeSidecarNetworkPath(result.networkPath);
    if (result?.success === false) {
      const expectedFailure = isExpectedNativeFailure(result, entry.options);
      const status = expectedFailure ? "expected error" : "error";
      logToFile(
        `Native SFTP session: ${entry.request.operation} completed with ${status} - ${result.error || "unknown error"}`,
        expectedFailure
          ? normalizeLogLevel(entry.options.expectedFailureLevel, "DEBUG")
          : "WARN",
      );
    } else {
      logToFile(
        `Native SFTP session: ${entry.request.operation} completed successfully requestId=${requestId}`,
        "INFO",
      );
    }
    entry.resolve(result);
  }

  _failAll(error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
    this.closed = true;
    if (!this.closeRequested && this.child && !this.child.killed) {
      try {
        this.child.kill();
      } catch {
        // ignore cleanup failure
      }
    }
  }

  _armIdleTimer() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.pending.size > 0 || this.closeRequested) return;
    this.idleTimer = setTimeout(() => this.close(), NATIVE_SFTP_SESSION_IDLE_TIMEOUT_MS);
    this.idleTimer.unref?.();
  }

  request(request, options = {}) {
    if (this.closed || !this.child || this.child.stdin.destroyed) {
      return Promise.reject(
        createNativeSidecarError("Native SFTP session is not available", {
          errorCode: "NATIVE_SFTP_SESSION_UNAVAILABLE",
          errorKind: "sidecar",
          retryable: true,
        }),
      );
    }
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const firstRequest = this.pending.size === 0 && !this.started;
    this.started = true;
    if (firstRequest) {
      logNativeStage(
        request.operation,
        request.requestId,
        "spawnStart",
        null,
        this.spawnStartedAt,
      );
      logNativeStage(
        request.operation,
        request.requestId,
        "spawned",
        null,
        this.spawnStartedAt,
      );
    }
    try {
      options.onSpawn?.(this.child);
    } catch {
      // Callback ownership stays with the caller; a callback failure must not
      // corrupt the protocol writer.
    }
    return new Promise((resolve, reject) => {
      this.pending.set(request.requestId, {
        request,
        options,
        resolve,
        reject,
        startedAt: Date.now(),
        observedStages: new Set(),
      });
      const payload = firstRequest
        ? {
            schemaVersion: NATIVE_SFTP_SCHEMA_VERSION,
            config: this.nativeConfig,
            request,
          }
        : request;
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, "utf8", (error) => {
        if (!error) return;
        this.pending.delete(request.requestId);
        reject(
          createNativeSidecarError(
            `Failed to write native SFTP session request: ${normalizeErrorMessage(error)}`,
            { errorCode: "NATIVE_SFTP_SESSION_WRITE_FAILED", raw: error },
          ),
        );
      });
    });
  }

  close() {
    if (this.closeRequested) return;
    this.closeRequested = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this.child || this.child.killed) return;
    try {
      this.child.stdin.write(
        `${JSON.stringify({ operation: "closeSession", requestId: createNativeRequestId("close-session") })}\n`,
        "utf8",
        () => this.child.stdin.end(),
      );
    } catch {
      try {
        this.child.kill();
      } catch {
        // ignore shutdown failure
      }
    }
  }
}

function invokePersistentNativeRequest(
  sessionKey,
  sidecarPath,
  nativeConfig,
  request,
  options,
) {
  const fingerprint = JSON.stringify(nativeConfig);
  const expectedFailureLevel = normalizeLogLevel(options.expectedFailureLevel, "DEBUG");
  const sessionOptions = {
    ...options,
    expectedFailureLevel,
  };
  let session = nativeSftpSessions.get(sessionKey);
  if (session && session.fingerprint !== fingerprint) {
    session.close();
    nativeSftpSessions.delete(sessionKey);
    session = null;
  }
  if (!session || session.closed) {
    session = new NativeSftpSession({ sidecarPath, nativeConfig, sessionKey });
    session.fingerprint = fingerprint;
    nativeSftpSessions.set(sessionKey, session);
  }
  return session.request(request, sessionOptions).catch((error) => {
    if (session.closed || error?.errorCode === "NATIVE_SFTP_SESSION_CLOSED") {
      if (nativeSftpSessions.get(sessionKey) === session) {
        nativeSftpSessions.delete(sessionKey);
      }
    }
    throw error;
  });
}

function invokeNativeRequestWithConfig(
  config,
  request,
  options = {},
  resolvedSidecarPath = null,
) {
  const sidecarPath = resolvedSidecarPath || getNativeServicesHostPath();
  if (!sidecarPath) {
    logToFile(
      `Native SFTP: sidecar binary not found for ${request?.operation || "unknown-operation"}`,
      "ERROR",
    );
    return Promise.reject(
      createNativeSidecarError("Native services host was not found", {
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

  const sessionKey = String(
    options.sessionKey ||
      `connection:${nativeConfig.username}@${nativeConfig.host}:${nativeConfig.port || 22}`,
  );
  return invokePersistentNativeRequest(
    sessionKey,
    sidecarPath,
    nativeConfig,
    normalizedRequest,
    options,
  );
}

function watchDirectory(tabId, remotePath, options = {}) {
  const sidecarPath = getNativeServicesHostPath();
  if (!sidecarPath) {
    logToFile(
      "Native SFTP: sidecar binary not found for watchDirectory",
      "ERROR",
    );
    return Promise.reject(
      createNativeSidecarError("Native services host was not found", {
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
  const sidecarPath = resolvedSidecarPath || getNativeServicesHostPath();
  if (!sidecarPath) {
    logToFile(
      "Native SFTP: sidecar binary not found for watchDirectory",
      "ERROR",
    );
    return Promise.reject(
      createNativeSidecarError("Native services host was not found", {
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
    let child = null;
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
          if (child && !child.killed) {
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
        const wrapped = buildInvalidSidecarOutputError(error, request, line);
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

    const handleChildError = (wrapped) => {
      if (settled) {
        notifyRuntimeError(wrapped);
        return;
      }
      rejectOnce(wrapped);
    };

    const handleClose = (code, signal, stderrText) => {
      const exitInfo = {
        code,
        signal,
        stderr: stderrText,
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
          stderrText ||
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
    };

    child = spawnSidecarSession({
      sidecarPath,
      mode: "sftp-watch",
      nativeConfig,
      request,
      onLine: handleOutputLine,
      onChildError: handleChildError,
      onClose: handleClose,
    });
  });
}

async function listFiles(tabId, remotePath, options = {}) {
  return invokeNativeRequest(
    tabId,
    {
      operation: "listFiles",
      path: remotePath,
      streamList: options.streamList === true,
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
      ensureParentDirectories: options.ensureParentDirectories !== false,
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
  resolveSshConfig,
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
