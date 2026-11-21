/** Reconnect execution, connection probing, replacement, and cancellation helpers. */
function createReconnectExecutionMethods({
  RECONNECT_STATE,
  FAILURE_REASON,
  createManagedSshConnection,
  mainT,
  normalizeLanguage,
  logToFile,
}) {
  return {
    // 取消待执行的重连任务
    cancelPendingReconnect(sessionId) {
      const timerId = this.reconnectTimers.get(sessionId);
      if (timerId) {
        clearTimeout(timerId);
        this.reconnectTimers.delete(sessionId);
        logToFile(`Cancelled pending reconnect task: ${sessionId}`, "DEBUG");
      }

      const session = this.sessions.get(sessionId);
      if (session) {
        session.nextReconnectAt = null;
      }
    },

    _shouldAbortReconnect(session) {
      return (
        !session ||
        session.disposed === true ||
        session.intentionalClose === true ||
        session.state === RECONNECT_STATE.ABANDONED ||
        session.state === RECONNECT_STATE.PAUSED ||
        !this.sessions.has(session.id) ||
        this.sessions.get(session.id) !== session
      );
    },

    _cleanupReconnectConnection(handle, reason = "unknown") {
      if (!handle || typeof handle.cleanup !== "function") {
        return;
      }

      try {
        handle.cleanup(reason);
      } catch (error) {
        logToFile(
          `Cleanup temp reconnect connection error (ignored): ${reason} - ${error?.message || error}`,
          "WARN",
        );
      }
    },

    _clearPendingReconnectConnection(session, reason = "unknown") {
      if (!session?.pendingReconnectConnection) {
        return;
      }

      const pendingConnection = session.pendingReconnectConnection;
      session.pendingReconnectConnection = null;
      this._cleanupReconnectConnection(pendingConnection, reason);
    },

    // 执行重连
    async executeReconnect(session, failureReason = FAILURE_REASON.NETWORK) {
      this._ensureReconnectWindowStarted(session);
      session.failureReason = failureReason;
      const maxRetries = this._getMaxRetriesForSession(session, failureReason);
      const strategyFields = this._getRetryStrategyFields(
        session,
        failureReason,
      );

      // 检查是否应该跳过本次重连（已放弃/已暂停）
      if (
        session.state === RECONNECT_STATE.ABANDONED ||
        session.state === RECONNECT_STATE.PAUSED
      ) {
        logToFile(
          `Skip reconnect (state=${session.state}): ${session.id}`,
          "DEBUG",
        );
        return;
      }

      // 检查是否正在重连中（防止并发重连）
      if (session.state === RECONNECT_STATE.RECONNECTING) {
        logToFile(
          `Skip reconnect (already reconnecting): ${session.id}`,
          "DEBUG",
        );
        return;
      }

      if (this._abandonIfExpired(session, maxRetries, strategyFields)) {
        return;
      }

      const attemptNumber = session.retryCount + 1;
      session.retryCount = attemptNumber;
      session.lastAttempt = Date.now();
      session.state = RECONNECT_STATE.RECONNECTING;
      session.isReconnecting = true; // 标记正在重连
      session.nextReconnectAt = null;

      logToFile(
        `Start reconnect: ${session.id} (attempt ${session.retryCount}/${maxRetries})`,
        "INFO",
      );
      this.emit("reconnectStarted", {
        sessionId: session.id,
        attempt: session.retryCount,
        maxRetries,
        ...strategyFields,
      });

      this.statistics.totalAttempts++;

      let newConnection = null;
      let newConnectionAdopted = false;
      const configRevision = session.config?._connectionConfigRevision || 0;

      try {
        const preflight = await this._checkPreflight(session);
        if (!preflight?.ok) {
          const preflightError = new Error(
            preflight?.message ||
              mainT("mainProcess.reconnect.preflightFailed", {
                lng: normalizeLanguage(session?.config?.language),
              }),
          );
          if (preflight?.code) {
            preflightError.code = preflight.code;
          }
          if (preflight?.failureReason) {
            preflightError.failureReason = preflight.failureReason;
          }
          throw preflightError;
        }

        // 创建新连接
        newConnection = await this.createNewConnection(session.config);
        session.pendingReconnectConnection = newConnection;

        if (this._shouldAbortReconnect(session)) {
          session.isReconnecting = false;
          this._clearPendingReconnectConnection(
            session,
            "reconnect-aborted-before-validate",
          );
          return;
        }

        // 验证连接
        const isValid = await this.validateConnection(newConnection);
        if (!isValid) {
          throw new Error(
            mainT("mainProcess.reconnect.validationFailed", {
              lng: normalizeLanguage(session?.config?.language),
            }),
          );
        }

        if (this._shouldAbortReconnect(session)) {
          session.isReconnecting = false;
          this._clearPendingReconnectConnection(
            session,
            "reconnect-aborted-before-replace",
          );
          return;
        }

        // 替换旧连接
        if (
          configRevision !== (session.config?._connectionConfigRevision || 0)
        ) {
          const error = new Error("SSH configuration changed");
          error.code = "SSH_CONFIG_CHANGED";
          throw error;
        }
        await this.replaceConnection(session, newConnection);
        newConnectionAdopted = true;
        session.pendingReconnectConnection = null;

        // 重连成功 - 取消所有待执行的重连任务
        this.cancelPendingReconnect(session.id);

        // 重连成功
        session.state = RECONNECT_STATE.CONNECTED;
        session.retryCount = 0;
        session.lastError = null;
        session.failureReason = null;
        session.isReconnecting = false; // 清除重连标记
        session.reconnectWindowStartedAt = null; // 成功后清空窗口，下次断线重新计时

        // 清空重连队列
        this.reconnectQueues.delete(session.id);

        // 记录成功
        session.reconnectHistory.push({
          timestamp: Date.now(),
          success: true,
          attempts: attemptNumber,
          duration: Date.now() - session.lastAttempt,
        });

        this.statistics.successfulReconnects++;
        this.updateSessionQualityMetrics(session, {
          stability: this.calculateSuccessRate(session),
          level: "good",
        });

        logToFile(`Reconnect succeeded: ${session.id}`, "INFO");
        const successPayload = {
          sessionId: session.id,
          attempts: attemptNumber,
          qualityMetrics: session.qualityMetrics,
          ...strategyFields,
        };
        this.emit("reconnectSuccess", successPayload);
        this.emit("reconnectSessionRestoreReady", successPayload);
      } catch (error) {
        if (newConnection && !newConnectionAdopted) {
          if (session?.pendingReconnectConnection === newConnection) {
            session.pendingReconnectConnection = null;
          }
          this._cleanupReconnectConnection(
            newConnection,
            `reconnect-attempt-failed:${error?.message || error}`,
          );
        }

        // 重连过程中再次检查状态，避免在连接已成功时报告错误
        if (session.state === RECONNECT_STATE.CONNECTED) {
          logToFile(
            `Reconnect exception ignored (already connected): ${session.id}`,
            "DEBUG",
          );
          return;
        }

        if (this._shouldAbortReconnect(session)) {
          session.isReconnecting = false;
          return;
        }

        if (
          error?.code === "SSH_CONFIG_CHANGED" ||
          configRevision !== (session.config?._connectionConfigRevision || 0)
        ) {
          session.isReconnecting = false;
          session.retryCount = 0;
          session.reconnectWindowStartedAt = Date.now();
          await this.scheduleReconnect(session, FAILURE_REASON.NETWORK);
          return;
        }

        if (
          /cancelled|canceled|取消/i.test(String(error?.message || "")) ||
          [
            "SSH_INTERACTIVE_AUTH_FAILED",
            "KEYBOARD_INTERACTIVE_TIMEOUT",
          ].includes(error?.code)
        ) {
          this.abandonReconnection(session, error.message);
          return;
        }

        logToFile(
          `Reconnect failed: ${session.id} - ${error.message} (attempt ${session.retryCount}/${maxRetries})`,
          "ERROR",
        );

        session.lastError = error;

        // 记录失败
        session.reconnectHistory.push({
          timestamp: Date.now(),
          success: false,
          attempts: session.retryCount,
          error: error.message,
        });
        this.updateSessionQualityMetrics(session, {
          stability: this.calculateSuccessRate(session),
          level: "degraded",
        });

        this.statistics.failedReconnects++;

        // 决定是否继续重试
        const nextFailureReason = this.analyzeFailureReason(error);
        session.failureReason = nextFailureReason;
        try {
          this.recordFailurePattern(session.id, nextFailureReason);
        } catch (patternErr) {
          logToFile(
            `Failure pattern record error (ignored): ${session.id} - ${patternErr?.message || patternErr}`,
            "WARN",
          );
        }

        if (this.shouldReconnect(session, nextFailureReason)) {
          // 继续重试，不发送失败事件（避免触发错误通知）
          await this.scheduleReconnect(session, nextFailureReason);
        } else {
          // 达到最大重试次数，清除重连标记并发送失败事件
          session.isReconnecting = false;

          this.abandonReconnection(
            session,
            mainT("mainProcess.reconnect.maxRetriesOrConditions", {
              lng: normalizeLanguage(session?.config?.language),
              maxRetries,
            }),
          );

          const userFacingError = this.formatReconnectErrorForUser(
            error,
            session?.config,
          );
          if (userFacingError !== error.message) {
            logToFile(
              `Reconnect failed (user message): ${session.id} - ${userFacingError}`,
              "WARN",
            );
          }

          this.emit("reconnectFailed", {
            sessionId: session.id,
            error: userFacingError,
            attempts: session.retryCount,
            maxRetries,
            ...this._getRetryStrategyFields(session, nextFailureReason),
          });
        }
      }
    },

    // 创建新连接
    async createNewConnection(config) {
      return createManagedSshConnection(config);
    },

    /**
     * 带超时的连接探测包装：runner 收到 finish(ok) 回调，超时或同步异常均视为失败
     * @private
     */
    _probeWithTimeout(runner, timeoutMs) {
      return new Promise((resolve) => {
        let finished = false;
        let timeoutId = null;
        const finish = (ok) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeoutId);
          resolve(ok);
        };
        timeoutId = setTimeout(() => finish(false), timeoutMs);

        try {
          runner(finish);
        } catch {
          finish(false);
        }
      });
    },

    // 验证连接
    async validateConnection(connection) {
      const client = connection?.client || connection;
      const timeoutMs = 3000;

      const tryExec = () =>
        this._probeWithTimeout((finish) => {
          // 执行简单命令测试连接
          client.exec("echo test", (err, stream) => {
            if (err) {
              finish(false);
              return;
            }

            stream.on("data", () => finish(true));
            stream.on("error", () => finish(false));
            stream.on("close", () => finish(false));
          });
        }, timeoutMs);

      const tryShell = () =>
        this._probeWithTimeout((finish) => {
          client.shell((err, stream) => {
            if (err) {
              finish(false);
              return;
            }

            try {
              if (stream && typeof stream.close === "function") {
                stream.close();
              }
            } catch {
              /* intentionally ignored */
            }

            finish(true);
          });
        }, timeoutMs);

      // SFTP runs in the core's SFTP service, so only channels can prove the
      // new connection; servers without exec still allow a shell.
      if (await tryExec()) return true;
      return await tryShell();
    },

    // 替换连接
    async replaceConnection(session, newConnection) {
      if (!session || !newConnection) {
        return;
      }

      const nextConnection = newConnection.client || newConnection;
      if (
        typeof newConnection.isClosed === "function" &&
        newConnection.isClosed()
      ) {
        throw new Error(
          mainT("mainProcess.reconnect.closedBeforeTakeover", {
            lng: normalizeLanguage(session?.config?.language),
          }),
        );
      }

      if (this.replacingSessions.has(session.id)) {
        logToFile(`Skip concurrent connection replace: ${session.id}`, "DEBUG");
        return;
      }

      this.replacingSessions.add(session.id);
      const oldConnection = session.connection;

      if (oldConnection === nextConnection) {
        this.replacingSessions.delete(session.id);
        return;
      }

      try {
        // 移除旧连接的监听器
        if (
          oldConnection &&
          typeof oldConnection.removeAllListeners === "function"
        ) {
          oldConnection.removeAllListeners();
        }

        if (typeof newConnection.claim === "function") {
          newConnection.claim();
        }

        // 设置新连接
        session.connection = nextConnection;

        // 设置新连接的监听器
        this.setupConnectionListeners(session);

        if (typeof newConnection.adopt === "function") {
          newConnection.adopt();
        }

        // 尝试优雅关闭旧连接
        try {
          if (oldConnection && typeof oldConnection.end === "function") {
            oldConnection.end();
          }
        } catch {
          // 忽略关闭错误
        }

        this.emit("connectionReplaced", {
          sessionId: session.id,
          newConnection: nextConnection,
        });
      } finally {
        this.replacingSessions.delete(session.id);
      }
    },

    // 放弃重连
    abandonReconnection(session, reason) {
      // 先取消待执行的重连任务
      this.cancelPendingReconnect(session.id);

      session.state = RECONNECT_STATE.ABANDONED;
      const strategyFields = this._getRetryStrategyFields(
        session,
        session.failureReason,
      );

      logToFile(`Abandon reconnect ${session.id}: ${reason}`, "WARN");

      this.emit("reconnectAbandoned", {
        sessionId: session.id,
        reason,
        attempts: session.retryCount,
        maxRetries: this.config.maxRetries,
        ...strategyFields,
      });

      // 清理会话
      this.cleanupSession(session.id);
    },
  };
}

module.exports = createReconnectExecutionMethods;
