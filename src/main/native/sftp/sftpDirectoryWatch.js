/** Native SFTP streaming directory watch lifecycle. */
function createSftpDirectoryWatch({
  NATIVE_SFTP_SCHEMA_VERSION,
  recordCrashMarker,
  recordNativeSidecarNetworkPath,
  protocol,
  configResolver,
  sessionPool,
  buildWatchDirectoryRequest,
}) {
  function watchDirectoryWithConfig(config, remotePath, options = {}) {
    const missing = configResolver.missingHostError("watchDirectory");
    if (missing) return Promise.reject(missing);

    return new Promise((resolve, reject) => {
      let nativeConfig;
      try {
        nativeConfig = configResolver.prepareNativeSshConfig(config);
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
      const request = buildWatchDirectoryRequest(
        remotePath,
        Number.isFinite(requestedIntervalMs) && requestedIntervalMs > 0
          ? requestedIntervalMs
          : undefined,
      );

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
          const wrapped = protocol.buildInvalidSidecarOutputError(
            error,
            request,
            line,
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
              schemaVersion:
                payload?.schemaVersion || NATIVE_SFTP_SCHEMA_VERSION,
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
              schemaVersion:
                payload?.schemaVersion || NATIVE_SFTP_SCHEMA_VERSION,
              ...eventPayload,
            });
          }
          return;
        }

        if (eventName === "error") {
          const payloadError = protocol.normalizeNativeErrorPayload(
            eventPayload,
            eventPayload?.error || "Native SFTP directory watch failed",
          );
          const wrapped = protocol.createNativeSidecarError(
            payloadError.error,
            {
              ...payloadError,
              operation: payloadError.operation || "watchDirectory",
              requestId: payloadError.requestId || request.requestId,
            },
          );
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
          const structured = protocol.normalizeNativeErrorPayload(
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
          const wrapped = protocol.createNativeSidecarError(structured.error, {
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
            protocol.createNativeSidecarError(
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
          protocol.createNativeSidecarError(
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

      child = sessionPool.spawnSidecarSession({
        mode: "sftp-watch",
        nativeConfig,
        request,
        onLine: handleOutputLine,
        onChildError: handleChildError,
        onClose: handleClose,
      });
    });
  }

  return { watchDirectoryWithConfig };
}

module.exports = createSftpDirectoryWatch;
