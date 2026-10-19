/** TransferRuntime: explicit dependencies supplied by the service facade. */
function createTransferRuntime(
  dependencies,
  {
    EVENT_LOOP_LAG_INTERVAL_MS,
    TransferProcessPool,
    transferText,
    buildEmptyTransferPoolStats,
    normalizeErrorMessage,
    TRANSFER_POOL_IDLE_SHUTDOWN_MS,
  },
) {
  return new (class TransferRuntime {
    constructor() {
      this.dependencies = dependencies;
    }
    _startEventLoopLagMonitor() {
      if (this.dependencies.eventLoopLagTimer) {
        clearInterval(this.dependencies.eventLoopLagTimer);
        this.dependencies.eventLoopLagTimer = null;
      }

      let expected = Date.now() + EVENT_LOOP_LAG_INTERVAL_MS;
      this.dependencies.eventLoopLagTimer = setInterval(() => {
        const now = Date.now();
        const lag = Math.max(0, now - expected);
        expected = now + EVENT_LOOP_LAG_INTERVAL_MS;

        const stats = this.dependencies.transferMetrics.eventLoopLag;
        stats.latestMs = lag;
        stats.maxMs = Math.max(stats.maxMs, lag);
        stats.totalMs += lag;
        stats.samples += 1;
      }, EVENT_LOOP_LAG_INTERVAL_MS);

      if (typeof this.dependencies.eventLoopLagTimer.unref === "function") {
        this.dependencies.eventLoopLagTimer.unref();
      }
    }
    _stopEventLoopLagMonitor() {
      if (this.dependencies.eventLoopLagTimer) {
        clearInterval(this.dependencies.eventLoopLagTimer);
        this.dependencies.eventLoopLagTimer = null;
      }
    }
    _clearTransferProcessPoolIdleTimer() {
      if (this.dependencies.transferProcessPoolIdleTimer) {
        clearTimeout(this.dependencies.transferProcessPoolIdleTimer);
        this.dependencies.transferProcessPoolIdleTimer = null;
      }
    }
    _ensureTransferProcessPool() {
      this._clearTransferProcessPoolIdleTimer();

      const currentStats =
        this.dependencies.transferProcessPool?.getRuntimeStats?.();
      if (!this.dependencies.transferProcessPool || currentStats?.shutdown) {
        this.dependencies.transferProcessPool = new TransferProcessPool({
          translate: transferText,
        });
        this.dependencies._log("Transfer process pool initialized", "INFO");
      }

      return this.dependencies.transferProcessPool;
    }
    _scheduleTransferProcessPoolIdleShutdown() {
      this._clearTransferProcessPoolIdleTimer();

      if (
        !this.dependencies.transferProcessPool ||
        this.dependencies.activeTransfers.size > 0
      ) {
        return;
      }

      this.dependencies.transferProcessPoolIdleTimer = setTimeout(() => {
        this.dependencies.transferProcessPoolIdleTimer = null;

        const pool = this.dependencies.transferProcessPool;
        if (!pool || this.dependencies.activeTransfers.size > 0) {
          return;
        }

        const poolStats =
          pool.getRuntimeStats?.() || buildEmptyTransferPoolStats();
        const hasPendingWork =
          (poolStats.queuedTasks || 0) > 0 ||
          (poolStats.pendingTasks || 0) > 0 ||
          (poolStats.pendingInits || 0) > 0 ||
          (poolStats.activeTransfers || 0) > 0;

        if (hasPendingWork) {
          this._scheduleTransferProcessPoolIdleShutdown();
          return;
        }

        if (this.dependencies.transferProcessPool !== pool) {
          return;
        }

        this.dependencies.transferProcessPool = null;

        pool
          .shutdown()
          .catch((error) => {
            this.dependencies._log(
              `Idle transfer process pool shutdown failed: ${normalizeErrorMessage(error)}`,
              "WARN",
            );
          })
          .finally(() => {
            this.dependencies._log(
              "Transfer process pool shutdown after idle",
              "INFO",
            );
          });
      }, TRANSFER_POOL_IDLE_SHUTDOWN_MS);

      if (
        typeof this.dependencies.transferProcessPoolIdleTimer.unref ===
        "function"
      ) {
        this.dependencies.transferProcessPoolIdleTimer.unref();
      }
    }
    _recordTransferMetrics({
      transferredBytes = 0,
      completed = 0,
      failed = 0,
      cancelled = false,
      durationMs = 0,
    }) {
      const metrics = this.dependencies.transferMetrics;
      const safeCompleted = Math.max(0, Number(completed) || 0);
      const safeFailed = Math.max(0, Number(failed) || 0);
      const safeBytes = Math.max(0, Number(transferredBytes) || 0);
      const safeDurationMs = Math.max(0, Number(durationMs) || 0);

      metrics.totalTasks += safeCompleted + safeFailed;
      metrics.failedTasks += safeFailed;
      metrics.totalBytesTransferred += safeBytes;

      if (cancelled) {
        metrics.cancelledTransfers += 1;
      } else if (safeFailed > 0) {
        metrics.failedTransfers += 1;
      } else {
        metrics.successfulTransfers += 1;
      }

      if (safeDurationMs > 0) {
        metrics.latestTransferThroughput =
          safeBytes / Math.max(0.001, safeDurationMs / 1000);
      }
    }
    _recordCancelLatency(transfer) {
      if (!transfer?.cancelRequestedAt) return;
      if (transfer.cancelLatencyRecorded) return;
      const latencyMs = Math.max(0, Date.now() - transfer.cancelRequestedAt);
      this.dependencies.transferMetrics.cancelLatencySamples.push(latencyMs);
      if (this.dependencies.transferMetrics.cancelLatencySamples.length > 100) {
        this.dependencies.transferMetrics.cancelLatencySamples.shift();
      }
      transfer.cancelLatencyRecorded = true;
    }
    getTransferRuntimeStats() {
      const metrics = this.dependencies.transferMetrics;
      const elapsedSec = Math.max(
        0.001,
        (Date.now() - metrics.startedAt) / 1000,
      );
      const cancelSamples = metrics.cancelLatencySamples;
      const avgCancelLatencyMs =
        cancelSamples.length > 0
          ? cancelSamples.reduce((sum, value) => sum + value, 0) /
            cancelSamples.length
          : 0;
      const failureRate =
        metrics.totalTasks > 0 ? metrics.failedTasks / metrics.totalTasks : 0;
      const lag = metrics.eventLoopLag;

      return {
        transferEngineMode: this.dependencies.transferEngineMode,
        activeTransferCount: this.dependencies.activeTransfers.size,
        throughputBytesPerSec: metrics.totalBytesTransferred / elapsedSec,
        latestTransferThroughput: metrics.latestTransferThroughput,
        failureRate,
        avgCancelLatencyMs,
        eventLoopLag: {
          latestMs: lag.latestMs,
          maxMs: lag.maxMs,
          avgMs: lag.samples > 0 ? lag.totalMs / lag.samples : 0,
          samples: lag.samples,
        },
        pool: this.dependencies.transferProcessPool
          ? this.dependencies.transferProcessPool.getRuntimeStats()
          : buildEmptyTransferPoolStats(),
        poolIdleShutdownScheduled: Boolean(
          this.dependencies.transferProcessPoolIdleTimer,
        ),
      };
    }
  })();
}
module.exports = createTransferRuntime;
