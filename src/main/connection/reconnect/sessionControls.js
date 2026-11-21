/** Reconnect session teardown, status queries, pause/resume, and wait helpers. */
function createSessionControlsMethods({
  RECONNECT_STATE,
  FAILURE_REASON,
  buildReconnectTimeoutMessage,
  mainT,
  normalizeLanguage,
  getUiLanguage,
  configService,
  logToFile,
}) {
  return {
    /**
     * 会话销毁的公共清理序列（差异动作：日志、connection close等留在调用方）
     * @private
     */
    _teardownSession(session, reason) {
      session.disposed = true;
      session.isReconnecting = false;
      session.nextReconnectAt = null;

      // 取消待执行的重连任务
      this.cancelPendingReconnect(session.id);

      // 清理重连阶段新建但尚未接管的连接
      this._clearPendingReconnectConnection(session, reason);

      // 移除记录
      this.sessions.delete(session.id);
      this.reconnectQueues.delete(session.id);
      this.failurePatterns.delete(session.id);
      this.replacingSessions.delete(session.id);
    },

    // 清理会话
    cleanupSession(sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return;
      }

      this._teardownSession(session, "cleanup-session");

      // 关闭连接
      try {
        session.connection.end();
      } catch {
        // 忽略错误
      }

      logToFile(`Cleaned reconnect session: ${sessionId}`, "DEBUG");
    },

    cancelSession(sessionId, reason = "cancel-session") {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return false;
      }

      session.intentionalClose = true;
      session.state = RECONNECT_STATE.IDLE;
      session.lastError = null;
      session.failureReason = null;

      this._teardownSession(session, reason);

      logToFile(
        `Cancelled reconnect session: ${sessionId}, reason=${reason}`,
        "DEBUG",
      );
      return true;
    },

    // 公共接口
    getSessionStatus(sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return null;
      }

      const strategyFields = this._getRetryStrategyFields(
        session,
        session.failureReason,
      );

      return {
        id: session.id,
        state: session.state,
        retryCount: session.retryCount,
        maxRetries: this.config.maxRetries,
        ...strategyFields,
        nextReconnectAt: session.nextReconnectAt,
        lastAttempt: session.lastAttempt,
        lastError: session.lastError ? session.lastError.message : null,
        qualityMetrics: session.qualityMetrics,
      };
    },

    getAllSessionsStatus() {
      return Array.from(this.sessions.keys()).map((id) =>
        this.getSessionStatus(id),
      );
    },

    getStatistics() {
      return {
        ...this.statistics,
        activeSessions: this.sessions.size,
        reconnectingSessions: Array.from(this.sessions.values()).filter(
          (s) => s.state === RECONNECT_STATE.RECONNECTING,
        ).length,
        maxRetries: this.config.maxRetries,
        totalTimeCapMs: this.config.totalTimeCapMs,
        reconnectStrategy: this.config.useExponentialBackoff
          ? "exponential_backoff"
          : "fixed",
        reconnectDelayRange: this.config.useExponentialBackoff
          ? `${this.config.initialDelay}ms - ${this.config.maxDelay}ms`
          : `${this.config.initialDelay}ms`,
      };
    },

    /**
     * 请求自动重连（与状态机合并，避免重复触发）
     * - 若当前会话已在 pending/reconnecting，则不会重复安排
     * - 若当前会话处于 connected，但上层判断连接不健康，可调用此方法触发一次自动重连
     */
    async requestAutoReconnect(
      sessionId,
      failureReason = FAILURE_REASON.NETWORK,
    ) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(
          mainT("mainProcess.reconnect.sessionNotFound", {
            lng: getUiLanguage(configService),
            sessionId,
          }),
        );
      }

      this._ensureReconnectWindowStarted(session);
      session.failureReason = failureReason;

      if (
        session.state === RECONNECT_STATE.RECONNECTING ||
        session.state === RECONNECT_STATE.PENDING ||
        session.state === RECONNECT_STATE.PAUSED
      ) {
        return;
      }

      session.intentionalClose = false;
      session.state = RECONNECT_STATE.PENDING;
      await this.scheduleReconnect(session, failureReason);
    },

    /**
     * 等待一次重连结果（成功/失败/放弃/超时）
     * 供 SFTP 等模块复用 SSH 的重连状态机，避免各自重复重试与刷屏提示。
     */
    waitForReconnect(sessionId, timeoutMs = this.config.totalTimeCapMs) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return Promise.reject(
          new Error(
            mainT("mainProcess.reconnect.sessionNotFound", {
              lng: getUiLanguage(configService),
              sessionId,
            }),
          ),
        );
      }

      if (session.state === RECONNECT_STATE.CONNECTED) {
        return Promise.resolve(true);
      }

      const remainingWindow = this._getRemainingReconnectWindowMs(session);
      const effectiveTimeout = Math.min(
        Number(timeoutMs || 0) || remainingWindow,
        remainingWindow,
      );

      return new Promise((resolve, reject) => {
        let finished = false;
        let timeoutId = null;

        const cleanup = () => {
          this.removeListener("reconnectSuccess", onSuccess);
          this.removeListener("reconnectFailed", onFailed);
          this.removeListener("reconnectAbandoned", onAbandoned);
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }
        };

        const finishResolve = () => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve(true);
        };

        const finishReject = (err) => {
          if (finished) return;
          finished = true;
          cleanup();
          reject(err);
        };

        const onSuccess = ({ sessionId: sid }) => {
          if (sid === sessionId) finishResolve();
        };

        const onFailed = ({ sessionId: sid, error }) => {
          if (sid === sessionId) {
            finishReject(
              new Error(
                error ||
                  mainT("mainProcess.reconnect.failed", {
                    lng: normalizeLanguage(session?.config?.language),
                  }),
              ),
            );
          }
        };

        const onAbandoned = ({ sessionId: sid, reason }) => {
          if (sid === sessionId)
            finishReject(
              new Error(
                reason ||
                  mainT("mainProcess.reconnect.abandoned", {
                    lng: normalizeLanguage(session?.config?.language),
                  }),
              ),
            );
        };

        this.on("reconnectSuccess", onSuccess);
        this.on("reconnectFailed", onFailed);
        this.on("reconnectAbandoned", onAbandoned);

        if (Number.isFinite(effectiveTimeout) && effectiveTimeout > 0) {
          timeoutId = setTimeout(() => {
            finishReject(
              new Error(
                buildReconnectTimeoutMessage(
                  this.config,
                  session?.config?.language,
                ),
              ),
            );
          }, effectiveTimeout);
        }
      });
    },

    // 暂停重连
    pauseReconnection(sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return {
          success: false,
          sessionId,
          state: null,
          error: mainT("mainProcess.reconnect.sessionNotFound", {
            lng: getUiLanguage(configService),
            sessionId,
          }),
        };
      }

      const previousState = session.state;
      if (
        previousState !== RECONNECT_STATE.PENDING &&
        previousState !== RECONNECT_STATE.RECONNECTING
      ) {
        return {
          success: false,
          sessionId,
          state: previousState,
          error: mainT("mainProcess.reconnect.cannotPause", {
            lng: getUiLanguage(configService),
            state: previousState,
          }),
        };
      }

      this.cancelPendingReconnect(sessionId);
      this._clearPendingReconnectConnection(session, "pause-reconnect");
      session.state = RECONNECT_STATE.PAUSED;
      session.isReconnecting = false;
      session.failureReason = session.failureReason || FAILURE_REASON.NETWORK;
      logToFile(`Paused reconnect: ${sessionId}`, "INFO");

      return {
        success: true,
        sessionId,
        previousState,
        state: session.state,
      };
    },

    // 恢复重连
    resumeReconnection(sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return {
          success: false,
          sessionId,
          state: null,
          error: mainT("mainProcess.reconnect.sessionNotFound", {
            lng: getUiLanguage(configService),
            sessionId,
          }),
        };
      }

      const previousState = session.state;
      if (previousState !== RECONNECT_STATE.PAUSED) {
        return {
          success: false,
          sessionId,
          state: previousState,
          error: mainT("mainProcess.reconnect.cannotResume", {
            lng: getUiLanguage(configService),
            state: previousState,
          }),
        };
      }

      session.state = RECONNECT_STATE.PENDING;
      session.retryCount = 0;
      session.reconnectWindowStartedAt = Date.now();
      session.failureReason = FAILURE_REASON.NETWORK;
      void this.scheduleReconnect(session, FAILURE_REASON.NETWORK);
      logToFile(`Resumed reconnect: ${sessionId}`, "INFO");

      return {
        success: true,
        sessionId,
        previousState,
        state: session.state,
      };
    },
  };
}

module.exports = createSessionControlsMethods;
