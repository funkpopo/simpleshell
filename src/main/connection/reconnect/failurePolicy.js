/** Reconnection interruption handling, failure pattern tracking, backoff scheduling, and metrics. */
function createFailurePolicyMethods({
  RECONNECT_STATE,
  FAILURE_REASON,
  FAILURE_PATTERN_GUARD,
  buildMaxRetriesMessage,
  analyzeSshFailureReason,
  buildReconnectTimeoutMessage,
  checkSshPreflight,
  getEffectiveMaxRetries,
  getRemainingRetryWindowMs,
  getRetryWindowExpiresAt,
  isRetryWindowExpired,
  calculateRetryDelay,
  mainT,
  normalizeLanguage,
  logToFile,
}) {
  return {
    /**
     * 统一处理连接中断事件（error/close/timeout 三类事件的共享守卫与调度序列）
     * @private
     */
    async _handleConnectionInterruption(session, sourceConnection, options) {
      const {
        eventLabel,
        error = null,
        failureReason = null,
        mainLogLevel,
        onIntentionalClose,
        recordPattern = false,
        abandonWhenNotReconnectable = false,
      } = options;

      // 仅处理“当前连接对象”的事件，避免旧连接残留事件干扰
      if (session.connection !== sourceConnection) {
        return;
      }

      if (session.disposed) {
        return;
      }

      if (session.intentionalClose) {
        onIntentionalClose();
        return;
      }

      // 如果已经处于重连中或已放弃，忽略
      if (
        session.state === RECONNECT_STATE.RECONNECTING ||
        session.state === RECONNECT_STATE.ABANDONED ||
        session.state === RECONNECT_STATE.PAUSED ||
        (session.state === RECONNECT_STATE.PENDING &&
          this.reconnectTimers.has(session.id) &&
          !error)
      ) {
        logToFile(
          `Ignore ${eventLabel} (state: ${session.state}): ${session.id}${error ? ` - ${error.message}` : ""}`,
          "DEBUG",
        );
        return;
      }

      logToFile(
        error
          ? `${eventLabel} ${session.id}: ${error.message}`
          : `${eventLabel}: ${session.id}`,
        mainLogLevel,
      );

      if (error) {
        session.lastError = error;
      }
      session.state = RECONNECT_STATE.PENDING;

      // 分析/确定错误原因
      const resolvedFailureReason =
        failureReason || this.analyzeFailureReason(error);
      session.failureReason = resolvedFailureReason;

      if (recordPattern) {
        this._ensureReconnectWindowStarted(session);

        // 记录失败模式
        try {
          this.recordFailurePattern(session.id, resolvedFailureReason);
        } catch (patternErr) {
          // 失败模式统计不应影响断线/重连主流程
          logToFile(
            `Failure pattern record error (ignored): ${session.id} - ${patternErr?.message || patternErr}`,
            "WARN",
          );
        }
      }

      // 决定是否需要重连
      if (this.shouldReconnect(session, resolvedFailureReason)) {
        this._ensureReconnectWindowStarted(session);
        await this.scheduleReconnect(session, resolvedFailureReason);
      } else if (abandonWhenNotReconnectable) {
        this.abandonReconnection(
          session,
          mainT("mainProcess.reconnect.conditionsNotMet", {
            lng: normalizeLanguage(session?.config?.language),
          }),
        );
      }
    },

    // 处理connection error
    async handleConnectionError(session, error, sourceConnection) {
      return this._handleConnectionInterruption(session, sourceConnection, {
        eventLabel: "connection error",
        error,
        mainLogLevel: "ERROR",
        onIntentionalClose: () => {
          logToFile(
            `Ignore intentional-close connection error: ${session.id}`,
            "DEBUG",
          );
        },
        recordPattern: true,
        abandonWhenNotReconnectable: true,
      });
    },

    // 处理connection close
    async handleConnectionClose(session, sourceConnection) {
      return this._handleConnectionInterruption(session, sourceConnection, {
        eventLabel: "connection close",
        failureReason: FAILURE_REASON.NETWORK,
        mainLogLevel: "INFO",
        onIntentionalClose: () => {
          logToFile(
            `Intentional close detected, cleaning reconnect session: ${session.id}`,
            "DEBUG",
          );
          this.cancelSession(session.id, "intentional-close");
        },
      });
    },

    // 处理connection timeout
    async handleConnectionTimeout(session, sourceConnection) {
      return this._handleConnectionInterruption(session, sourceConnection, {
        eventLabel: "connection timeout",
        failureReason: FAILURE_REASON.TIMEOUT,
        mainLogLevel: "WARN",
        onIntentionalClose: () => {
          logToFile(
            `Ignore intentional-close connection timeout: ${session.id}`,
            "DEBUG",
          );
        },
      });
    },

    // 分析失败原因
    analyzeFailureReason(error) {
      return analyzeSshFailureReason(error);
    },

    _ensureReconnectWindowStarted(session) {
      if (!session) return;
      if (!session.reconnectWindowStartedAt) {
        session.reconnectWindowStartedAt = Date.now();
      }
    },

    _getRemainingReconnectWindowMs(session) {
      return getRemainingRetryWindowMs(
        session?.reconnectWindowStartedAt,
        this.config,
      );
    },

    _isReconnectWindowExpired(session) {
      return isRetryWindowExpired(
        session?.reconnectWindowStartedAt,
        this.config,
      );
    },

    _getReconnectWindowExpiresAt(session) {
      return getRetryWindowExpiresAt(
        session?.reconnectWindowStartedAt,
        this.config,
      );
    },

    async _checkPreflight(session) {
      return checkSshPreflight(session?.config, this.config);
    },

    _getRetryStrategyFields(session, failureReason = session?.failureReason) {
      const resolvedFailureReason = failureReason || FAILURE_REASON.UNKNOWN;
      const effectiveMaxRetries = this._getMaxRetriesForSession(
        session,
        resolvedFailureReason,
      );

      return {
        failureReason: resolvedFailureReason,
        effectiveMaxRetries,
        windowExpiresAt: this._getReconnectWindowExpiresAt(session),
      };
    },

    /**
     * 记录失败模式（用于后续智能重连策略分析）
     * 注意：该统计逻辑不应影响主流程，调用方应自行 try/catch。
     */
    recordFailurePattern(sessionId, failureReason) {
      const now = Date.now();
      const reason = failureReason || FAILURE_REASON.UNKNOWN;

      const existing = this.failurePatterns.get(sessionId) || {
        total: 0,
        reasons: Object.create(null),
        lastReason: null,
        lastAt: 0,
        consecutive: 0,
        recentFailures: [],
      };

      existing.total += 1;
      existing.reasons[reason] = (existing.reasons[reason] || 0) + 1;

      // 连续失败统计：同类原因、且时间间隔不太长则计为连续
      const isSameReason = existing.lastReason === reason;
      const isCloseInTime = now - (existing.lastAt || 0) < 5 * 60 * 1000; // 5分钟窗口
      existing.consecutive =
        isSameReason && isCloseInTime ? existing.consecutive + 1 : 1;

      existing.lastReason = reason;
      existing.lastAt = now;

      const recentFailures = Array.isArray(existing.recentFailures)
        ? existing.recentFailures
        : [];
      recentFailures.push({ reason, timestamp: now });
      existing.recentFailures = recentFailures.filter(
        (item) =>
          now - Number(item?.timestamp || 0) <= FAILURE_PATTERN_GUARD.windowMs,
      );

      this.failurePatterns.set(sessionId, existing);
      return existing;
    },

    // 将底层错误映射为用户可理解的提示（详细信息写日志）
    formatReconnectErrorForUser(error, config) {
      const msg = String(error?.message || "");
      const code = String(error?.code || "");
      const lng = normalizeLanguage(config?.language);
      const host =
        config?.host || mainT("mainProcess.reconnect.targetHost", { lng });
      const port = config?.port || 22;

      // 这一类属于开发/内部异常，不应直接暴露给用户
      if (msg.includes("is not a function") || msg.includes("undefined")) {
        return mainT("mainProcess.reconnect.internalError", { lng });
      }

      // SSH 常见错误映射
      if (msg.includes("All configured authentication methods failed")) {
        return mainT("mainProcess.reconnect.authFailed", { lng });
      }
      if (code === "EPROXYUNAVAILABLE" || msg.includes("proxy")) {
        return mainT("mainProcess.reconnect.proxyUnavailable", { lng });
      }
      if (code === "ECONNREFUSED" || msg.includes("connect ECONNREFUSED")) {
        return mainT("mainProcess.reconnect.connectionRefused", {
          lng,
          host,
          port,
        });
      }
      if (code === "ENOTFOUND" || msg.includes("getaddrinfo ENOTFOUND")) {
        return mainT("mainProcess.reconnect.hostUnresolved", { lng, host });
      }
      if (code === "ETIMEDOUT" || msg.toLowerCase().includes("timeout")) {
        return mainT("mainProcess.reconnect.connectionTimedOut", {
          lng,
          host,
          port,
        });
      }
      if (code === "ECONNRESET" || msg.includes("ECONNRESET")) {
        return mainT("mainProcess.reconnect.connectionReset", { lng });
      }
      if (code === "EPIPE" || msg.includes("EPIPE")) {
        return mainT("mainProcess.reconnect.pipeClosed", { lng });
      }

      return mainT("mainProcess.reconnect.disconnected", { lng });
    },

    _shouldStopReconnectByFailurePattern(
      session,
      failureReason,
      maxRetries = 0,
    ) {
      const pattern = this.failurePatterns.get(session?.id);
      if (!pattern) {
        return false;
      }

      const now = Date.now();
      const reason = failureReason || FAILURE_REASON.UNKNOWN;
      const recentFailures = Array.isArray(pattern.recentFailures)
        ? pattern.recentFailures.filter(
            (item) =>
              now - Number(item?.timestamp || 0) <=
              FAILURE_PATTERN_GUARD.windowMs,
          )
        : [];

      pattern.recentFailures = recentFailures;
      this.failurePatterns.set(session.id, pattern);

      let sameReasonConsecutive = 0;
      for (let i = recentFailures.length - 1; i >= 0; i -= 1) {
        if (recentFailures[i].reason !== reason) {
          break;
        }
        sameReasonConsecutive += 1;
      }

      const guardThreshold = Math.max(
        FAILURE_PATTERN_GUARD.maxConsecutive,
        Number.isFinite(maxRetries) && maxRetries > 0 ? maxRetries + 1 : 0,
      );

      if (sameReasonConsecutive >= guardThreshold) {
        logToFile(
          `Stop auto-reconnect (repeated same failure): ${session.id}, reason=${reason}, ${sameReasonConsecutive} in 2min (threshold ${guardThreshold})`,
          "WARN",
        );
        return true;
      }

      return false;
    },

    // 判断是否应该重连
    shouldReconnect(session, failureReason) {
      // 认证失败默认不重连（除非会话/全局显式开启）
      if (failureReason === FAILURE_REASON.AUTHENTICATION) {
        const enabled =
          Boolean(session?.config?.retryOnAuthFailure) ||
          Boolean(this.config?.authFailure?.enabled);
        if (!enabled) {
          logToFile(`Auth failure, skip reconnect: ${session.id}`, "WARN");
          return false;
        }
      }

      // 资源限制不重连
      if (failureReason === FAILURE_REASON.RESOURCE) {
        logToFile(`Resource limit, skip reconnect: ${session.id}`, "WARN");
        return false;
      }

      const maxRetries = this._getMaxRetriesForSession(session, failureReason);

      // maxRetries <= 0 表示该原因不允许重连
      if (maxRetries <= 0) {
        logToFile(
          `Reconnect conditions not met (reason blocked): ${session.id}`,
          "WARN",
        );
        return false;
      }

      // 检查重试次数
      if (session.retryCount >= maxRetries) {
        logToFile(`Reached max retries (${maxRetries}): ${session.id}`, "WARN");
        return false;
      }

      if (
        this._shouldStopReconnectByFailurePattern(
          session,
          failureReason,
          maxRetries,
        )
      ) {
        return false;
      }

      return true;
    },

    _getMaxRetriesForSession(session, failureReason) {
      return getEffectiveMaxRetries(
        this.config,
        session?.config,
        failureReason,
      );
    },

    /**
     * 窗口过期或超过最大重试次数时终止重连（abandon + emit reconnectFailed）
     * @returns {boolean} 是否已终止
     * @private
     */
    _abandonIfExpired(session, maxRetries, strategyFields) {
      // 总耗时封顶：到期则停止自动重连
      if (this._isReconnectWindowExpired(session)) {
        session.isReconnecting = false;
        this.abandonReconnection(
          session,
          mainT("mainProcess.reconnect.timeoutExceeded", {
            lng: normalizeLanguage(session?.config?.language),
            ms: this.config.totalTimeCapMs,
          }),
        );
        this.emit("reconnectFailed", {
          sessionId: session.id,
          error: buildReconnectTimeoutMessage(
            this.config,
            session?.config?.language,
          ),
          attempts: session.retryCount,
          maxRetries,
          ...strategyFields,
        });
        return true;
      }

      if (session.retryCount + 1 > maxRetries) {
        session.isReconnecting = false;
        this.abandonReconnection(
          session,
          mainT("mainProcess.reconnect.maxRetriesReached", {
            lng: normalizeLanguage(session?.config?.language),
            maxRetries,
          }),
        );
        this.emit("reconnectFailed", {
          sessionId: session.id,
          error: buildMaxRetriesMessage(maxRetries, session?.config?.language),
          attempts: session.retryCount,
          maxRetries,
          ...strategyFields,
        });
        return true;
      }

      return false;
    },

    // 计划重连 - 使用指数退避算法
    async scheduleReconnect(session, failureReason) {
      this._ensureReconnectWindowStarted(session);
      session.failureReason = failureReason;
      const maxRetries = this._getMaxRetriesForSession(session, failureReason);
      const strategyFields = this._getRetryStrategyFields(
        session,
        failureReason,
      );

      if (this._abandonIfExpired(session, maxRetries, strategyFields)) {
        return;
      }

      const nextAttempt = session.retryCount + 1;

      // 计算延迟时间
      let delay = calculateRetryDelay({
        retryConfig: this.config,
        attempt: nextAttempt,
        lastError: session.lastError,
        successRate: this.calculateSuccessRate(session),
      });

      // 总耗时封顶：确保延迟不会把执行时间推到窗口之外
      const remainingMs = this._getRemainingReconnectWindowMs(session);
      if (Number.isFinite(remainingMs)) {
        delay = Math.min(delay, remainingMs);
      }

      // 加入重连队列
      const reconnectTask = {
        sessionId: session.id,
        scheduledAt: Date.now(),
        executeAt: Date.now() + delay,
        failureReason,
        retryCount: nextAttempt,
        delay,
      };

      if (!this.reconnectQueues.has(session.id)) {
        this.reconnectQueues.set(session.id, []);
      }
      this.reconnectQueues.get(session.id).push(reconnectTask);

      logToFile(
        `Schedule reconnect: ${session.id}, delay ${delay}ms (backoff), attempt ${nextAttempt}/${maxRetries}`,
        "INFO",
      );

      session.state = RECONNECT_STATE.PENDING;
      session.isReconnecting = false;

      // 取消之前的定时器（如果存在）
      this.cancelPendingReconnect(session.id);

      // 执行重连，保存定时器引用以便后续取消
      const timerId = setTimeout(() => {
        this.reconnectTimers.delete(session.id);
        this.executeReconnect(session, failureReason);
      }, delay);
      this.reconnectTimers.set(session.id, timerId);
      session.nextReconnectAt = reconnectTask.executeAt;

      this.emit("reconnectScheduled", {
        sessionId: session.id,
        delay,
        retryCount: session.retryCount,
        completedAttempts: session.retryCount,
        nextAttempt,
        maxRetries,
        ...strategyFields,
      });
    },

    // 计算会话的历史成功率
    calculateSuccessRate(session) {
      const history = session.reconnectHistory || [];
      if (history.length === 0) return 1.0;

      const recentHistory = history.slice(-10); // 最近10次
      const successCount = recentHistory.filter((h) => h.success).length;
      return successCount / recentHistory.length;
    },

    /**
     * 用延迟/重连统计刷新 session.qualityMetrics
     */
    updateSessionQualityMetrics(session, partial = {}) {
      if (!session) {
        return null;
      }

      const successRate = this.calculateSuccessRate(session);
      const next = {
        stability:
          partial.stability !== undefined
            ? partial.stability
            : (session.qualityMetrics?.stability ?? successRate),
        latency:
          partial.latency !== undefined
            ? partial.latency
            : (session.qualityMetrics?.latency ?? 0),
        packetLoss:
          partial.packetLoss !== undefined
            ? partial.packetLoss
            : (session.qualityMetrics?.packetLoss ?? 0),
        level:
          partial.level !== undefined
            ? partial.level
            : (session.qualityMetrics?.level ?? null),
        successRate,
        updatedAt: Date.now(),
      };
      session.qualityMetrics = next;
      return next;
    },
  };
}

module.exports = createFailurePolicyMethods;
