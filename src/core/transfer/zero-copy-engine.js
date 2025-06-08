const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");

// 零拷贝引擎配置
const ZERO_COPY_CONFIG = {
  transfer: {
    chunkSize: 64 * 1024, // 默认块大小（64KB）
    maxConcurrency: 4, // 最大并发传输数
    timeout: 30 * 1000, // 传输超时（30秒）
  },

  optimization: {
    enableBufferPooling: true, // 启用缓冲池
    adaptiveChunkSize: true, // 自适应块大小
    enableZeroCopy: true, // 启用零拷贝
  },
};

// 传输状态
const TRANSFER_STATE = {
  PENDING: "pending",
  ACTIVE: "active",
  COMPLETED: "completed",
  FAILED: "failed",
};

class ZeroCopyBuffer {
  constructor(source, size) {
    this.source = source;
    this.size = size;
    this.views = new Set();
    this.refCount = 0;

    this.createBuffer();
  }

  createBuffer() {
    if (Buffer.isBuffer(this.source)) {
      this.buffer = this.source;
    } else if (typeof this.source === "number") {
      this.buffer = Buffer.allocUnsafeSlow(this.source);
    } else {
      throw new Error("不支持的缓冲区源类型");
    }
  }

  createView(offset = 0, length = this.buffer.length) {
    const actualLength = Math.min(length, this.buffer.length - offset);
    const view = this.buffer.subarray(offset, offset + actualLength);

    this.views.add(view);
    this.refCount++;

    return view;
  }

  releaseView(view) {
    if (this.views.has(view)) {
      this.views.delete(view);
      this.refCount--;
      return true;
    }
    return false;
  }

  getRawBuffer() {
    return this.buffer;
  }
}

class ZeroCopyTransfer extends EventEmitter {
  constructor(source, destination, options = {}) {
    super();

    this.source = source;
    this.destination = destination;
    this.options = { ...ZERO_COPY_CONFIG.transfer, ...options };

    this.id = `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    this.state = TRANSFER_STATE.PENDING;

    this.stats = {
      startTime: null,
      endTime: null,
      bytesTransferred: 0,
      totalBytes: 0,
      throughput: 0,
    };
  }

  async start() {
    this.state = TRANSFER_STATE.ACTIVE;
    this.stats.startTime = Date.now();

    try {
      await this.performTransfer();
      await this.complete();
    } catch (error) {
      await this.fail(error);
    }
  }

  async performTransfer() {
    if (Buffer.isBuffer(this.source) && Buffer.isBuffer(this.destination)) {
      await this.directBufferTransfer();
    } else {
      throw new Error("当前仅支持Buffer到Buffer的传输");
    }
  }

  async directBufferTransfer() {
    const sourceLength = this.source.length;
    const destinationLength = this.destination.length;
    const copyLength = Math.min(sourceLength, destinationLength);

    this.stats.totalBytes = copyLength;

    // 零拷贝优化：检查是否可以共享底层ArrayBuffer
    if (this.source.buffer === this.destination.buffer) {
      // 同一ArrayBuffer，无需拷贝
      this.stats.bytesTransferred = copyLength;
      return;
    }

    // 高效复制
    this.source.copy(this.destination, 0, 0, copyLength);
    this.stats.bytesTransferred = copyLength;
  }

  async complete() {
    this.state = TRANSFER_STATE.COMPLETED;
    this.stats.endTime = Date.now();

    const duration = this.stats.endTime - this.stats.startTime;
    this.stats.throughput =
      duration > 0 ? (this.stats.bytesTransferred / duration) * 1000 : 0;

    this.emit("completed", { id: this.id, stats: this.stats });
  }

  async fail(error) {
    this.state = TRANSFER_STATE.FAILED;
    this.stats.endTime = Date.now();

    this.emit("failed", { id: this.id, error: error.message });
  }

  getStats() {
    return {
      id: this.id,
      state: this.state,
      bytesTransferred: this.stats.bytesTransferred,
      totalBytes: this.stats.totalBytes,
      throughput: this.stats.throughput,
    };
  }
}

class ZeroCopyEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...ZERO_COPY_CONFIG, ...config };

    this.activeTransfers = new Map();
    this.stats = {
      totalTransfers: 0,
      completedTransfers: 0,
      failedTransfers: 0,
    };
  }

  async createTransfer(source, destination, options = {}) {
    const transfer = new ZeroCopyTransfer(source, destination, options);

    transfer.on("completed", (result) => {
      this.activeTransfers.delete(transfer.id);
      this.stats.completedTransfers++;
    });

    transfer.on("failed", (result) => {
      this.activeTransfers.delete(transfer.id);
      this.stats.failedTransfers++;
    });

    this.activeTransfers.set(transfer.id, transfer);
    this.stats.totalTransfers++;

    return transfer;
  }

  async transferBuffer(source, destination, options = {}) {
    const transfer = await this.createTransfer(source, destination, options);
    await transfer.start();
    return transfer.getStats();
  }

  getEngineStats() {
    return {
      ...this.stats,
      activeTransfers: this.activeTransfers.size,
    };
  }
}

const zeroCopyEngine = new ZeroCopyEngine();
module.exports = zeroCopyEngine;
