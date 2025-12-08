/**
 * IPC进度报告器
 * 提供统一的进度报告接口，内置IPC批处理优化
 *
 * 使用方式：
 * const reporter = new IPCProgressReporter('transfer-progress', { ipcRenderer });
 * reporter.send(progressData);
 */

const IPCBatcher = require('./ipc-batcher');

class IPCProgressReporter {
  /**
   * @param {string} channel - IPC通道名称
   * @param {object} options - 配置选项
   * @param {object} options.ipcRenderer - Electron的ipcRenderer实例
   * @param {boolean} options.enableBatching - 是否启用批处理（默认true）
   * @param {number} options.batchSize - 批处理大小（默认20）
   * @param {number} options.batchWaitMs - 批处理等待时间（默认100ms）
   */
  constructor(channel, options = {}) {
    this.channel = channel;
    this.ipcRenderer = options.ipcRenderer;
    this.enableBatching = options.enableBatching !== false;

    if (this.enableBatching) {
      this.batcher = new IPCBatcher(
        options.batchSize || 20,
        options.batchWaitMs || 100
      );

      if (this.ipcRenderer) {
        this.batcher.setIpcRenderer(this.ipcRenderer);
      }
    }
  }

  /**
   * 发送进度数据
   * @param {object} data - 进度数据
   */
  send(data) {
    if (!this.ipcRenderer) {
      // 尝试延迟加载ipcRenderer
      try {
        const { ipcRenderer } = require('electron');
        this.ipcRenderer = ipcRenderer;

        if (this.enableBatching && this.batcher) {
          this.batcher.setIpcRenderer(ipcRenderer);
        }
      } catch (error) {
        console.warn('IPCProgressReporter: ipcRenderer not available');
        return;
      }
    }

    if (this.enableBatching && this.batcher) {
      // 使用批处理
      this.batcher.send(this.channel, data);
    } else {
      // 直接发送
      this.ipcRenderer.send(this.channel, data);
    }
  }

  /**
   * 立即刷新所有待发送消息
   */
  flush() {
    if (this.enableBatching && this.batcher) {
      this.batcher.flush();
    }
  }

  /**
   * 销毁报告器
   */
  destroy() {
    if (this.enableBatching && this.batcher) {
      this.batcher.destroy();
      this.batcher = null;
    }
  }

  /**
   * 获取批处理统计信息
   */
  getStats() {
    if (this.enableBatching && this.batcher) {
      return this.batcher.getStats();
    }
    return null;
  }
}

module.exports = IPCProgressReporter;
