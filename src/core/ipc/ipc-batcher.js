/**
 * IPC消息批处理器
 * 用于减少进程间通信开销，将多个IPC消息批量发送
 *
 * 优势：
 * - 减少IPC调用次数，降低进程间通信开销
 * - 自动按channel分组，提高批处理效率
 * - 支持时间和数量双重阈值控制
 */

class IPCBatcher {
  /**
   * @param {number} maxBatchSize - 触发发送的最大批次大小（消息数量）
   * @param {number} maxWaitMs - 触发发送的最大等待时间（毫秒）
   */
  constructor(maxBatchSize = 10, maxWaitMs = 16) {
    this.queue = [];
    this.maxBatchSize = maxBatchSize;
    this.maxWaitMs = maxWaitMs;
    this.timer = null;
    this.sending = false;
    this.ipcRenderer = null;

    // 统计信息
    this.stats = {
      totalMessages: 0,
      totalBatches: 0,
      totalSingleMessages: 0,
      averageBatchSize: 0
    };
  }

  /**
   * 设置IPC渲染器实例
   * @param {object} ipcRenderer - Electron的ipcRenderer实例
   */
  setIpcRenderer(ipcRenderer) {
    this.ipcRenderer = ipcRenderer;
  }

  /**
   * 发送消息到队列
   * @param {string} channel - IPC通道名称
   * @param {any} data - 要发送的数据
   */
  send(channel, data) {
    this.queue.push({
      channel,
      data,
      timestamp: Date.now()
    });

    this.stats.totalMessages++;

    // 达到批次大小限制，立即发送
    if (this.queue.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.timer) {
      // 启动定时器，在maxWaitMs后发送
      this.timer = setTimeout(() => this.flush(), this.maxWaitMs);
    }
  }

  /**
   * 立即刷新队列，发送所有待发送的消息
   */
  flush() {
    // 清除定时器
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    // 队列为空或正在发送，直接返回
    if (this.queue.length === 0 || this.sending) {
      return;
    }

    this.sending = true;

    try {
      // 按channel分组批量消息
      const batches = {};
      for (const item of this.queue) {
        if (!batches[item.channel]) {
          batches[item.channel] = [];
        }
        batches[item.channel].push(item.data);
      }

      // 检查ipcRenderer是否可用
      if (!this.ipcRenderer) {
        try {
          const { ipcRenderer } = require('electron');
          this.ipcRenderer = ipcRenderer;
        } catch (error) {
          console.error('Failed to load ipcRenderer:', error);
          this.queue = [];
          this.sending = false;
          return;
        }
      }

      // 批量发送每个channel的消息
      for (const [channel, items] of Object.entries(batches)) {
        if (items.length === 1) {
          // 单条消息直接发送
          this.ipcRenderer.send(channel, items[0]);
          this.stats.totalSingleMessages++;
        } else {
          // 多条消息批量发送
          this.ipcRenderer.send(`${channel}:batch`, items);
          this.stats.totalBatches++;
        }
      }

      // 更新平均批次大小
      const totalBatchedMessages = this.stats.totalMessages - this.stats.totalSingleMessages;
      if (this.stats.totalBatches > 0) {
        this.stats.averageBatchSize = totalBatchedMessages / this.stats.totalBatches;
      }

      // 清空队列
      this.queue = [];
    } catch (error) {
      console.error('Error flushing IPC messages:', error);
    } finally {
      this.sending = false;
    }
  }

  /**
   * 销毁批处理器，刷新所有待发送消息
   */
  destroy() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  /**
   * 获取统计信息
   * @returns {object} 统计信息对象
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      efficiency: this.stats.totalMessages > 0
        ? (1 - (this.stats.totalBatches + this.stats.totalSingleMessages) / this.stats.totalMessages) * 100
        : 0
    };
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalMessages: 0,
      totalBatches: 0,
      totalSingleMessages: 0,
      averageBatchSize: 0
    };
  }
}

module.exports = IPCBatcher;
