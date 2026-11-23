/** Native SFTP persistent session pooling and one-shot process spawning. */
function createSftpSessionPool({
  NATIVE_SFTP_SCHEMA_VERSION,
  NATIVE_SFTP_SESSION_IDLE_TIMEOUT_MS,
  getIdleTimeoutMs,
  spawnCoreService,
  logToFile,
  recordNativeSidecarNetworkPath,
  normalizeErrorMessage,
  protocol,
  configResolver,
  clientApi,
  buildCloseSessionRequest,
}) {
  const nativeSftpSessions = new Map();

  /**
   * Opens a core stream in the given mode ("sftp-request" | "sftp-watch"),
   * wires up the shared plumbing (stdout line buffering, stderr accumulation,
   * child-error wrapping, close flush) and writes the request envelope to stdin.
   * Mode-specific semantics (single response vs long-lived stream) stay in the
   * callers via the onLine/onChildError/onClose callbacks.
   */
  function spawnSidecarSession({
    mode,
    nativeConfig,
    request,
    onSpawn,
    onLine,
    onChildError,
    onClose,
  }) {
    const child = spawnCoreService(mode);

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
        protocol.createNativeSidecarError(
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
    constructor({ nativeConfig, sessionKey }) {
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
      this.child = spawnCoreService("sftp-session");
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
          protocol.createNativeSidecarError(
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
        if (this.stdoutBuffer.trim())
          this._handleLine(this.stdoutBuffer.trim());
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
            protocol.createNativeSidecarError(message, {
              errorCode: "NATIVE_SFTP_SESSION_CLOSED",
              errorKind: "sidecar",
              retryable: true,
              raw: { code, signal },
            }),
          );
        } else {
          this._failAll(
            protocol.createNativeSidecarError(
              "Native SFTP session was closed",
              {
                errorCode: "NATIVE_SFTP_SESSION_CLOSED",
                errorKind: "sidecar",
                retryable: true,
                raw: { code, signal },
              },
            ),
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
          protocol.buildInvalidSidecarOutputError(
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
          protocol.logNativeStage(
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
          protocol.logNativeStage(
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
      const result = protocol.normalizeNativeResultPayload(
        payload.result || null,
        entry.request,
      );
      if (result?.networkPath) {
        recordNativeSidecarNetworkPath(result.networkPath);
      }
      if (result?.success === false) {
        const expectedFailure = protocol.isExpectedNativeFailure(
          result,
          entry.options,
        );
        const status = expectedFailure ? "expected error" : "error";
        logToFile(
          `Native SFTP session: ${entry.request.operation} completed with ${status} - ${result.error || "unknown error"}`,
          expectedFailure
            ? protocol.normalizeLogLevel(
                entry.options.expectedFailureLevel,
                "DEBUG",
              )
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
      const timeoutMs =
        typeof getIdleTimeoutMs === "function"
          ? Number(getIdleTimeoutMs()) || NATIVE_SFTP_SESSION_IDLE_TIMEOUT_MS
          : NATIVE_SFTP_SESSION_IDLE_TIMEOUT_MS;
      this.idleTimer = setTimeout(() => this.close(), timeoutMs);
      this.idleTimer.unref?.();
    }

    request(request, options = {}) {
      if (this.closed || !this.child || this.child.stdin.destroyed) {
        return Promise.reject(
          protocol.createNativeSidecarError(
            "Native SFTP session is not available",
            {
              errorCode: "NATIVE_SFTP_SESSION_UNAVAILABLE",
              errorKind: "sidecar",
              retryable: true,
            },
          ),
        );
      }
      if (this.idleTimer) clearTimeout(this.idleTimer);
      const firstRequest = this.pending.size === 0 && !this.started;
      this.started = true;
      if (firstRequest) {
        protocol.logNativeStage(
          request.operation,
          request.requestId,
          "spawnStart",
          null,
          this.spawnStartedAt,
        );
        protocol.logNativeStage(
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
        this.child.stdin.write(
          `${JSON.stringify(payload)}\n`,
          "utf8",
          (error) => {
            if (!error) return;
            this.pending.delete(request.requestId);
            reject(
              protocol.createNativeSidecarError(
                `Failed to write native SFTP session request: ${normalizeErrorMessage(error)}`,
                { errorCode: "NATIVE_SFTP_SESSION_WRITE_FAILED", raw: error },
              ),
            );
          },
        );
      });
    }

    close() {
      if (this.closeRequested) return;
      this.closeRequested = true;
      if (this.idleTimer) clearTimeout(this.idleTimer);
      if (!this.child || this.child.killed) return;
      try {
        this.child.stdin.write(
          `${JSON.stringify(buildCloseSessionRequest())}\n`,
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
    nativeConfig,
    request,
    options,
  ) {
    const fingerprint = JSON.stringify(nativeConfig);
    const expectedFailureLevel = protocol.normalizeLogLevel(
      options.expectedFailureLevel,
      "DEBUG",
    );
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
      session = new NativeSftpSession({ nativeConfig, sessionKey });
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

  function closeNativeSession(sessionKey) {
    const session = nativeSftpSessions.get(sessionKey);
    if (!session) return;
    nativeSftpSessions.delete(sessionKey);
    if (session.idleTimer) clearTimeout(session.idleTimer);
    session.idleTimer = null;
    session._failAll(
      protocol.createNativeSidecarError("Transfer session retired", {
        errorCode: "NATIVE_SFTP_SESSION_CLOSED",
        errorKind: "sidecar",
        retryable: true,
      }),
    );
  }

  function invokeNativeRequestWithConfig(config, request, options = {}) {
    const missing = configResolver.missingHostError(request?.operation);
    if (missing) return Promise.reject(missing);

    const normalizedRequest = protocol.normalizeNativeRequest(request);
    let nativeConfig;
    try {
      nativeConfig = configResolver.prepareNativeSshConfig(config);
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
      nativeConfig,
      normalizedRequest,
      options,
    );
  }

  function invokeNativeRequest(tabId, request, options = {}) {
    const missing = configResolver.missingHostError(request?.operation);
    if (missing) return Promise.reject(missing);

    logToFile(
      `Native SFTP: invoking ${request?.operation || "unknown-operation"} for tab ${tabId}`,
      "INFO",
    );

    return configResolver.resolveSshConfig(tabId).then((config) =>
      clientApi.invokeNativeRequestWithConfig(config, request, {
        ...options,
        sessionKey: options.sessionKey || String(tabId),
      }),
    );
  }

  return {
    spawnSidecarSession,
    invokePersistentNativeRequest,
    closeNativeSession,
    invokeNativeRequestWithConfig,
    invokeNativeRequest,
  };
}

module.exports = createSftpSessionPool;
