/**
 * 终端写入队列管理器
 * 统一使用单一队列调度方式，避免多方案切换带来的复杂度。
 */

const normalizePositiveNumber = (value, fallback) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return Math.floor(numericValue);
};

export class TerminalWriteQueue {
  constructor(options = {}) {
    this.config = {
      dispatchThresholdBytes: normalizePositiveNumber(
        options.dispatchThresholdBytes,
        4096,
      ),
      dispatchIntervalMs: normalizePositiveNumber(
        options.dispatchIntervalMs,
        8,
      ),
    };

    this.queuedChunks = [];
    this.queuedBytes = 0;
    this.dispatchTimer = null;
    this.dispatchTimerType = null;

    this.stats = {
      totalEnqueued: 0,
      totalDrained: 0,
      totalBytesWritten: 0,
      avgQueuedBytes: 0,
      avgDrainSize: 0,
    };

    this.onDrain = options.onDrain || null;
  }

  /**
   * 获取当前队列调度配置
   * @returns {Object} 配置对象
   */
  getCurrentConfig() {
    return {
      dispatchThresholdBytes: this.config.dispatchThresholdBytes,
      dispatchIntervalMs: this.config.dispatchIntervalMs,
    };
  }

  /**
   * 入队写入数据
   * @param {string} data - 要写入的数据
   */
  enqueue(data) {
    if (!data) return;

    const dataStr = typeof data === "string" ? data : data.toString();
    if (!dataStr) return;

    this.queuedChunks.push(dataStr);
    this.queuedBytes += dataStr.length;
    this.stats.totalEnqueued++;

    this.stats.avgQueuedBytes =
      (this.stats.avgQueuedBytes * (this.stats.totalEnqueued - 1) +
        this.queuedBytes) /
      this.stats.totalEnqueued;

    const config = this.getCurrentConfig();
    if (this.queuedBytes >= config.dispatchThresholdBytes) {
      this.cancelDispatchTimer();
      this.drain();
      return;
    }

    if (this.dispatchTimer !== null) {
      return;
    }

    this.scheduleDispatch(config.dispatchIntervalMs);
  }

  /**
   * 调度出队
   * @param {number} intervalMs - 调度间隔（ms）
   */
  scheduleDispatch(intervalMs) {
    if (intervalMs <= 16 && typeof requestAnimationFrame === "function") {
      this.dispatchTimerType = "raf";
      this.dispatchTimer = requestAnimationFrame(() => {
        this.dispatchTimer = null;
        this.dispatchTimerType = null;
        this.drain();
      });
      return;
    }

    this.dispatchTimerType = "timeout";
    this.dispatchTimer = setTimeout(() => {
      this.dispatchTimer = null;
      this.dispatchTimerType = null;
      this.drain();
    }, intervalMs);
  }

  /**
   * 取消出队调度定时器
   */
  cancelDispatchTimer() {
    if (this.dispatchTimer === null) return;

    if (
      this.dispatchTimerType === "raf" &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(this.dispatchTimer);
    } else if (this.dispatchTimerType === "timeout") {
      clearTimeout(this.dispatchTimer);
    }

    this.dispatchTimer = null;
    this.dispatchTimerType = null;
  }

  /**
   * 出队并合并数据
   * @returns {string|null} 出队后的数据
   */
  drain() {
    if (this.queuedChunks.length === 0) {
      return null;
    }

    const data = this.queuedChunks.join("");
    const byteCount = this.queuedBytes;

    this.queuedChunks = [];
    this.queuedBytes = 0;

    this.stats.totalDrained++;
    this.stats.totalBytesWritten += byteCount;
    this.stats.avgDrainSize =
      (this.stats.avgDrainSize * (this.stats.totalDrained - 1) + byteCount) /
      this.stats.totalDrained;

    if (this.onDrain) {
      this.onDrain(data, {
        byteCount,
      });
    }

    return data;
  }

  /**
   * 立即出队（忽略调度间隔）
   */
  forceDrain() {
    this.cancelDispatchTimer();
    return this.drain();
  }

  /**
   * 获取当前队列状态
   * @returns {Object} 状态对象
   */
  getQueueStatus() {
    return {
      queuedChunks: this.queuedChunks.length,
      queuedBytes: this.queuedBytes,
      hasPendingDispatch: this.dispatchTimer !== null,
      config: this.getCurrentConfig(),
    };
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计对象
   */
  getStats() {
    return {
      ...this.stats,
      queuedBytes: this.queuedBytes,
      queuedChunks: this.queuedChunks.length,
      config: this.getCurrentConfig(),
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalEnqueued: 0,
      totalDrained: 0,
      totalBytesWritten: 0,
      avgQueuedBytes: 0,
      avgDrainSize: 0,
    };
  }

  /**
   * 清空队列
   */
  clear() {
    this.cancelDispatchTimer();
    this.queuedChunks = [];
    this.queuedBytes = 0;
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.clear();
    this.onDrain = null;
  }
}

export default TerminalWriteQueue;
