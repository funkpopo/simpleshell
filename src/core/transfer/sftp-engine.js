const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");
const memoryPoolManager = require("../memory/memory-pool");
const zeroCopyEngine = require("./zero-copy-engine");
const { backpressureController } = require("./backpressure-controller");

// SFTP引擎配置
const SFTP_ENGINE_CONFIG = {
  transfer: {
    maxConcurrentTransfers: 5, // 最大并发传输
    chunkSize: 128 * 1024, // 传输块大小（128KB）
    retryAttempts: 3, // 重试次数
    retryDelay: 1000, // 重试延迟
    timeout: 60 * 1000, // 传输超时（60秒）
    compressionThreshold: 1024 * 1024, // 压缩阈值（1MB）
  },

  optimization: {
    enableMemoryPool: true, // 启用内存池
    enableZeroCopy: true, // 启用零拷贝
    enableBackpressure: true, // 启用背压控制
    enableCompression: true, // 启用压缩
    adaptiveChunkSize: true, // 自适应块大小
    pipelineTransfers: true, // 管道传输
  },

  monitoring: {
    enableMetrics: true, // 启用指标收集
    metricsInterval: 5000, // 指标收集间隔
    enablePerformanceLog: true, // 启用性能日志
  },
};

// 传输类型
const TRANSFER_TYPE = {
  UPLOAD: "upload",
  DOWNLOAD: "download",
  COPY: "copy",
  SYNC: "sync",
};

// 传输状态
const TRANSFER_STATUS = {
  QUEUED: "queued",
  PREPARING: "preparing",
  TRANSFERRING: "transferring",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

class SftpTransfer extends EventEmitter {
  constructor(sftpConnection, source, destination, options = {}) {
    super();

    this.sftpConnection = sftpConnection;
    this.source = source;
    this.destination = destination;
    this.options = { ...SFTP_ENGINE_CONFIG, ...options };

    this.id = this.generateTransferId();
    this.type = this.determineTransferType();
    this.status = TRANSFER_STATUS.QUEUED;

    // 传输统计
    this.stats = {
      startTime: null,
      endTime: null,
      bytesTransferred: 0,
      totalBytes: 0,
      currentChunk: 0,
      totalChunks: 0,
      throughput: 0,
      retries: 0,
      errors: [],
    };

    // 控制器
    this.streamController = null;
    this.memoryBlocks = [];
    this.isInitialized = false;
    this.isPaused = false;
    this.isCancelled = false;
  }

  generateTransferId() {
    return `sftp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  determineTransferType() {
    // 简化的类型判断
    if (this.options.type) {
      return this.options.type;
    }

    // 根据源和目标路径判断
    if (
      typeof this.source === "string" &&
      typeof this.destination === "string"
    ) {
      return this.source.includes("local:")
        ? TRANSFER_TYPE.UPLOAD
        : TRANSFER_TYPE.DOWNLOAD;
    }

    return TRANSFER_TYPE.COPY;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      this.status = TRANSFER_STATUS.PREPARING;

      // 分析传输源
      await this.analyzeSource();

      // 计算传输参数
      this.calculateTransferParams();

      // 获取流控制器（如果启用背压控制）
      if (this.options.optimization.enableBackpressure) {
        this.streamController = await backpressureController.requestStream(
          this.id,
          {
            priority: this.options.priority || "normal",
            type: this.type,
          },
        );
      }

      // 预分配内存块
      if (this.options.optimization.enableMemoryPool) {
        await this.preallocateMemory();
      }

      this.isInitialized = true;
      this.emit("initialized", {
        id: this.id,
        type: this.type,
        totalBytes: this.stats.totalBytes,
        totalChunks: this.stats.totalChunks,
      });
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  async analyzeSource() {
    if (typeof this.source === "string") {
      // 文件路径
      if (this.type === TRANSFER_TYPE.UPLOAD) {
        const fs = require("fs").promises;
        const fileStats = await fs.stat(this.source);
        this.stats.totalBytes = fileStats.size;
        this.sourceType = "file";
      } else {
        // SFTP文件
        const fileStats = await this.sftpConnection.stat(this.source);
        this.stats.totalBytes = fileStats.size;
        this.sourceType = "sftp";
      }
    } else if (Buffer.isBuffer(this.source)) {
      this.stats.totalBytes = this.source.length;
      this.sourceType = "buffer";
    } else {
      throw new Error("不支持的传输源类型");
    }
  }

  calculateTransferParams() {
    // 计算块数量
    this.stats.totalChunks = Math.ceil(
      this.stats.totalBytes / this.options.transfer.chunkSize,
    );

    // 自适应块大小
    if (this.options.optimization.adaptiveChunkSize) {
      this.optimizeChunkSize();
    }

    logToFile(
      `传输参数: 总大小=${this.stats.totalBytes}, 块大小=${this.options.transfer.chunkSize}, 块数=${this.stats.totalChunks}`,
      "DEBUG",
    );
  }

  optimizeChunkSize() {
    // 根据文件大小和网络条件调整块大小
    if (this.stats.totalBytes < 1024 * 1024) {
      // 小文件：32KB
      this.options.transfer.chunkSize = 32 * 1024;
    } else if (this.stats.totalBytes < 100 * 1024 * 1024) {
      // 中等文件：128KB
      this.options.transfer.chunkSize = 128 * 1024;
    } else {
      // 大文件：512KB
      this.options.transfer.chunkSize = 512 * 1024;
    }

    // 重新计算块数量
    this.stats.totalChunks = Math.ceil(
      this.stats.totalBytes / this.options.transfer.chunkSize,
    );
  }

  async preallocateMemory() {
    try {
      // 预分配几个内存块以减少运行时分配开销
      const blocksToPreallocate = Math.min(3, this.stats.totalChunks);

      for (let i = 0; i < blocksToPreallocate; i++) {
        const memoryBlock = memoryPoolManager.allocate(
          this.options.transfer.chunkSize,
        );
        this.memoryBlocks.push(memoryBlock);
      }

      logToFile(`预分配${blocksToPreallocate}个内存块`, "DEBUG");
    } catch (error) {
      logToFile(`内存预分配失败: ${error.message}`, "WARN");
      // 继续执行，不使用内存池
    }
  }

  async start() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.status = TRANSFER_STATUS.TRANSFERRING;
    this.stats.startTime = Date.now();

    try {
      logToFile(`开始SFTP传输: ${this.id} (${this.type})`, "INFO");

      switch (this.type) {
        case TRANSFER_TYPE.UPLOAD:
          await this.performUpload();
          break;
        case TRANSFER_TYPE.DOWNLOAD:
          await this.performDownload();
          break;
        case TRANSFER_TYPE.COPY:
          await this.performCopy();
          break;
        default:
          throw new Error(`不支持的传输类型: ${this.type}`);
      }

      await this.complete();
    } catch (error) {
      await this.fail(error);
    } finally {
      await this.cleanup();
    }
  }

  async performUpload() {
    const fs = require("fs").promises;
    const fileHandle = await fs.open(this.source, "r");

    try {
      // 创建SFTP写入流
      const writeStream = this.sftpConnection.createWriteStream(
        this.destination,
      );

      let bytesTransferred = 0;
      let chunkIndex = 0;

      while (bytesTransferred < this.stats.totalBytes && !this.isCancelled) {
        if (this.isPaused) {
          await this.waitForResume();
        }

        const remainingBytes = this.stats.totalBytes - bytesTransferred;
        const chunkSize = Math.min(
          this.options.transfer.chunkSize,
          remainingBytes,
        );

        // 获取内存块
        const buffer = await this.getMemoryBlock(chunkSize);

        try {
          // 读取数据
          const result = await fileHandle.read(
            buffer.buffer,
            0,
            chunkSize,
            bytesTransferred,
          );
          const bytesRead = result.bytesRead;

          if (bytesRead === 0) break;

          // 使用零拷贝传输（如果可能）
          if (this.options.optimization.enableZeroCopy) {
            await this.zeroCopyWrite(writeStream, buffer.buffer, 0, bytesRead);
          } else {
            await this.standardWrite(
              writeStream,
              buffer.buffer.subarray(0, bytesRead),
            );
          }

          bytesTransferred += bytesRead;
          this.stats.bytesTransferred = bytesTransferred;
          this.stats.currentChunk = ++chunkIndex;

          this.reportProgress();
        } finally {
          // 释放内存块
          this.releaseMemoryBlock(buffer);
        }
      }

      writeStream.end();
    } finally {
      await fileHandle.close();
    }
  }

  async performDownload() {
    const fs = require("fs").promises;
    const fileHandle = await fs.open(this.destination, "w");

    try {
      // 创建SFTP读取流
      const readStream = this.sftpConnection.createReadStream(this.source);

      let bytesTransferred = 0;
      let chunkIndex = 0;

      while (bytesTransferred < this.stats.totalBytes && !this.isCancelled) {
        if (this.isPaused) {
          await this.waitForResume();
        }

        const remainingBytes = this.stats.totalBytes - bytesTransferred;
        const chunkSize = Math.min(
          this.options.transfer.chunkSize,
          remainingBytes,
        );

        // 获取内存块
        const buffer = await this.getMemoryBlock(chunkSize);

        try {
          // 读取数据
          const bytesRead = await this.sftpRead(
            readStream,
            buffer.buffer,
            chunkSize,
          );

          if (bytesRead === 0) break;

          // 写入本地文件
          const writeResult = await fileHandle.write(
            buffer.buffer,
            0,
            bytesRead,
            bytesTransferred,
          );

          bytesTransferred += writeResult.bytesWritten;
          this.stats.bytesTransferred = bytesTransferred;
          this.stats.currentChunk = ++chunkIndex;

          this.reportProgress();
        } finally {
          this.releaseMemoryBlock(buffer);
        }
      }
    } finally {
      await fileHandle.close();
    }
  }

  async performCopy() {
    // 实现SFTP内部复制（如果支持）
    if (this.sftpConnection.copy) {
      await this.sftpConnection.copy(this.source, this.destination);
      this.stats.bytesTransferred = this.stats.totalBytes;
    } else {
      // 回退到下载后上传
      throw new Error("SFTP复制暂未实现");
    }
  }

  async getMemoryBlock(size) {
    if (
      this.options.optimization.enableMemoryPool &&
      this.memoryBlocks.length > 0
    ) {
      // 从预分配的块中获取
      const block = this.memoryBlocks.pop();
      if (block && block.buffer.length >= size) {
        return block;
      }

      // 如果预分配的块不够大，释放并重新分配
      if (block) {
        memoryPoolManager.free(block.blockId);
      }
    }

    // 从内存池分配新块
    if (this.options.optimization.enableMemoryPool) {
      return memoryPoolManager.allocate(size);
    } else {
      // 直接分配
      return {
        buffer: Buffer.alloc(size),
        blockId: null,
      };
    }
  }

  releaseMemoryBlock(block) {
    if (this.options.optimization.enableMemoryPool && block.blockId) {
      // 如果内存块足够小，可以重用
      if (block.buffer.length <= this.options.transfer.chunkSize * 2) {
        this.memoryBlocks.push(block);
      } else {
        memoryPoolManager.free(block.blockId);
      }
    }
    // 对于非池化内存，让GC处理
  }

  async zeroCopyWrite(stream, buffer, offset, length) {
    if (this.streamController) {
      return await this.streamController.write(
        buffer.subarray(offset, offset + length),
      );
    } else {
      return new Promise((resolve, reject) => {
        stream.write(buffer.subarray(offset, offset + length), (error) => {
          if (error) reject(error);
          else resolve(length);
        });
      });
    }
  }

  async standardWrite(stream, data) {
    if (this.streamController) {
      return await this.streamController.write(data);
    } else {
      return new Promise((resolve, reject) => {
        stream.write(data, (error) => {
          if (error) reject(error);
          else resolve(data.length);
        });
      });
    }
  }

  async sftpRead(stream, buffer, length) {
    return new Promise((resolve, reject) => {
      let bytesRead = 0;

      const onData = (chunk) => {
        const copyLength = Math.min(chunk.length, length - bytesRead);
        chunk.copy(buffer, bytesRead, 0, copyLength);
        bytesRead += copyLength;

        if (bytesRead >= length) {
          stream.removeListener("data", onData);
          stream.removeListener("end", onEnd);
          stream.removeListener("error", onError);
          resolve(bytesRead);
        }
      };

      const onEnd = () => {
        stream.removeListener("data", onData);
        stream.removeListener("error", onError);
        resolve(bytesRead);
      };

      const onError = (error) => {
        stream.removeListener("data", onData);
        stream.removeListener("end", onEnd);
        reject(error);
      };

      stream.on("data", onData);
      stream.on("end", onEnd);
      stream.on("error", onError);
    });
  }

  pause() {
    if (this.status === TRANSFER_STATUS.TRANSFERRING) {
      this.isPaused = true;
      this.status = TRANSFER_STATUS.PAUSED;
      this.emit("paused", { id: this.id });
      logToFile(`传输已暂停: ${this.id}`, "INFO");
    }
  }

  resume() {
    if (this.status === TRANSFER_STATUS.PAUSED) {
      this.isPaused = false;
      this.status = TRANSFER_STATUS.TRANSFERRING;
      this.emit("resumed", { id: this.id });
      logToFile(`传输已恢复: ${this.id}`, "INFO");
    }
  }

  cancel() {
    this.isCancelled = true;
    this.status = TRANSFER_STATUS.CANCELLED;
    this.emit("cancelled", { id: this.id });
    logToFile(`传输已取消: ${this.id}`, "INFO");
  }

  async waitForResume() {
    return new Promise((resolve) => {
      const checkResume = () => {
        if (!this.isPaused || this.isCancelled) {
          resolve();
        } else {
          setTimeout(checkResume, 100);
        }
      };
      checkResume();
    });
  }

  reportProgress() {
    const progress =
      this.stats.totalBytes > 0
        ? (this.stats.bytesTransferred / this.stats.totalBytes) * 100
        : 0;

    // 计算传输速度
    const elapsed = Date.now() - this.stats.startTime;
    this.stats.throughput =
      elapsed > 0 ? (this.stats.bytesTransferred / elapsed) * 1000 : 0; // 字节/秒

    this.emit("progress", {
      id: this.id,
      progress: Math.round(progress * 100) / 100,
      bytesTransferred: this.stats.bytesTransferred,
      totalBytes: this.stats.totalBytes,
      currentChunk: this.stats.currentChunk,
      totalChunks: this.stats.totalChunks,
      throughput: this.stats.throughput,
    });
  }

  async complete() {
    this.status = TRANSFER_STATUS.COMPLETED;
    this.stats.endTime = Date.now();

    const duration = this.stats.endTime - this.stats.startTime;
    const avgThroughput =
      duration > 0 ? (this.stats.bytesTransferred / duration) * 1000 : 0;

    logToFile(
      `SFTP传输完成: ${this.id}, ` +
        `大小: ${this.stats.bytesTransferred}字节, ` +
        `耗时: ${duration}ms, ` +
        `平均速度: ${(avgThroughput / 1024 / 1024).toFixed(2)}MB/s`,
      "INFO",
    );

    this.emit("completed", {
      id: this.id,
      stats: this.getStats(),
    });
  }

  async fail(error) {
    this.status = TRANSFER_STATUS.FAILED;
    this.stats.endTime = Date.now();
    this.stats.errors.push({
      message: error.message,
      timestamp: Date.now(),
      stack: error.stack,
    });

    logToFile(`SFTP传输失败: ${this.id} - ${error.message}`, "ERROR");

    this.emit("failed", {
      id: this.id,
      error: error.message,
      stats: this.getStats(),
    });
  }

  async cleanup() {
    // 释放预分配的内存块
    for (const block of this.memoryBlocks) {
      if (block.blockId) {
        memoryPoolManager.free(block.blockId);
      }
    }
    this.memoryBlocks = [];

    // 通知流控制器传输结束
    if (this.streamController) {
      if (this.status === TRANSFER_STATUS.COMPLETED) {
        this.streamController.end();
      } else {
        this.streamController.destroy(new Error(`传输${this.status}`));
      }
    }

    logToFile(`传输清理完成: ${this.id}`, "DEBUG");
  }

  handleError(error) {
    this.stats.errors.push({
      message: error.message,
      timestamp: Date.now(),
    });

    if (this.stats.retries < this.options.transfer.retryAttempts) {
      this.stats.retries++;
      logToFile(
        `传输重试 ${this.stats.retries}/${this.options.transfer.retryAttempts}: ${this.id}`,
        "WARN",
      );

      setTimeout(() => {
        this.start().catch((err) => this.fail(err));
      }, this.options.transfer.retryDelay * this.stats.retries);
    } else {
      this.fail(error);
    }
  }

  getStats() {
    const duration =
      (this.stats.endTime || Date.now()) - (this.stats.startTime || Date.now());
    const avgThroughput =
      duration > 0 && this.stats.startTime
        ? (this.stats.bytesTransferred / duration) * 1000
        : 0;

    return {
      id: this.id,
      type: this.type,
      status: this.status,
      progress:
        this.stats.totalBytes > 0
          ? (this.stats.bytesTransferred / this.stats.totalBytes) * 100
          : 0,
      bytesTransferred: this.stats.bytesTransferred,
      totalBytes: this.stats.totalBytes,
      currentChunk: this.stats.currentChunk,
      totalChunks: this.stats.totalChunks,
      retries: this.stats.retries,
      errors: this.stats.errors.length,
      duration,
      avgThroughput,
      currentThroughput: this.stats.throughput,
    };
  }
}

class SftpEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...SFTP_ENGINE_CONFIG, ...config };

    this.activeTransfers = new Map();
    this.transferQueue = [];
    this.transferHistory = [];

    this.stats = {
      totalTransfers: 0,
      completedTransfers: 0,
      failedTransfers: 0,
      totalBytesTransferred: 0,
      averageThroughput: 0,
    };

    this.isInitialized = false;
    this.monitorTimer = null;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // 初始化子系统
      if (this.config.optimization.enableMemoryPool) {
        await memoryPoolManager.start();
      }

      if (this.config.optimization.enableBackpressure) {
        await backpressureController.start();
      }

      // 启动监控
      if (this.config.monitoring.enableMetrics) {
        this.startMonitoring();
      }

      this.isInitialized = true;
      this.emit("initialized");
      logToFile("高级SFTP引擎已初始化", "INFO");
    } catch (error) {
      logToFile(`SFTP引擎初始化失败: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async createTransfer(sftpConnection, source, destination, options = {}) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // 检查并发限制
    if (
      this.activeTransfers.size >= this.config.transfer.maxConcurrentTransfers
    ) {
      throw new Error(
        `达到最大并发传输限制: ${this.config.transfer.maxConcurrentTransfers}`,
      );
    }

    const transfer = new SftpTransfer(sftpConnection, source, destination, {
      ...this.config,
      ...options,
    });

    // 设置事件监听
    this.setupTransferEventListeners(transfer);

    this.activeTransfers.set(transfer.id, transfer);
    this.stats.totalTransfers++;

    this.emit("transferCreated", { transfer });
    return transfer;
  }

  setupTransferEventListeners(transfer) {
    transfer.on("progress", (progress) => {
      this.emit("transferProgress", progress);
    });

    transfer.on("completed", (result) => {
      this.handleTransferCompleted(transfer, result);
    });

    transfer.on("failed", (result) => {
      this.handleTransferFailed(transfer, result);
    });

    transfer.on("cancelled", () => {
      this.handleTransferCancelled(transfer);
    });
  }

  handleTransferCompleted(transfer, result) {
    this.activeTransfers.delete(transfer.id);
    this.transferHistory.push(result.stats);

    this.stats.completedTransfers++;
    this.stats.totalBytesTransferred += result.stats.bytesTransferred;
    this.updateAverageThroughput();

    // 处理队列中的等待传输
    this.processQueuedTransfers();

    this.emit("transferCompleted", result);
  }

  handleTransferFailed(transfer, result) {
    this.activeTransfers.delete(transfer.id);
    this.transferHistory.push(result.stats);

    this.stats.failedTransfers++;

    this.processQueuedTransfers();
    this.emit("transferFailed", result);
  }

  handleTransferCancelled(transfer) {
    this.activeTransfers.delete(transfer.id);
    this.processQueuedTransfers();
    this.emit("transferCancelled", { id: transfer.id });
  }

  updateAverageThroughput() {
    if (this.transferHistory.length === 0) return;

    const recentTransfers = this.transferHistory.slice(-10);
    const totalThroughput = recentTransfers.reduce(
      (sum, stats) => sum + (stats.avgThroughput || 0),
      0,
    );

    this.stats.averageThroughput = totalThroughput / recentTransfers.length;
  }

  async processQueuedTransfers() {
    if (this.transferQueue.length === 0) return;
    if (
      this.activeTransfers.size >= this.config.transfer.maxConcurrentTransfers
    )
      return;

    const queuedTransfer = this.transferQueue.shift();
    if (queuedTransfer) {
      try {
        await queuedTransfer.start();
      } catch (error) {
        logToFile(`队列传输启动失败: ${error.message}`, "ERROR");
      }
    }
  }

  startMonitoring() {
    this.monitorTimer = setInterval(() => {
      this.collectMetrics();
    }, this.config.monitoring.metricsInterval);
  }

  collectMetrics() {
    const engineStats = {
      timestamp: Date.now(),
      activeTransfers: this.activeTransfers.size,
      queuedTransfers: this.transferQueue.length,
      ...this.stats,
    };

    // 收集子系统指标
    if (this.config.optimization.enableMemoryPool) {
      engineStats.memoryPool = memoryPoolManager.getGlobalStats();
    }

    if (this.config.optimization.enableBackpressure) {
      engineStats.backpressure = backpressureController.getControllerStatus();
    }

    this.emit("metricsCollected", engineStats);

    if (this.config.monitoring.enablePerformanceLog) {
      logToFile(
        `SFTP引擎指标: 活跃=${engineStats.activeTransfers}, 完成=${engineStats.completedTransfers}, 失败=${engineStats.failedTransfers}`,
        "DEBUG",
      );
    }
  }

  // 便捷方法
  async upload(sftpConnection, localPath, remotePath, options = {}) {
    const transfer = await this.createTransfer(
      sftpConnection,
      localPath,
      remotePath,
      {
        ...options,
        type: TRANSFER_TYPE.UPLOAD,
      },
    );
    await transfer.start();
    return transfer.getStats();
  }

  async download(sftpConnection, remotePath, localPath, options = {}) {
    const transfer = await this.createTransfer(
      sftpConnection,
      remotePath,
      localPath,
      {
        ...options,
        type: TRANSFER_TYPE.DOWNLOAD,
      },
    );
    await transfer.start();
    return transfer.getStats();
  }

  // 传输控制
  pauseTransfer(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (transfer) {
      transfer.pause();
      return true;
    }
    return false;
  }

  resumeTransfer(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (transfer) {
      transfer.resume();
      return true;
    }
    return false;
  }

  cancelTransfer(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    if (transfer) {
      transfer.cancel();
      return true;
    }
    return false;
  }

  // 状态查询
  getTransferStatus(transferId) {
    const transfer = this.activeTransfers.get(transferId);
    return transfer ? transfer.getStats() : null;
  }

  getActiveTransfers() {
    return Array.from(this.activeTransfers.values()).map((transfer) =>
      transfer.getStats(),
    );
  }

  getEngineStats() {
    return {
      ...this.stats,
      activeTransfers: this.activeTransfers.size,
      queuedTransfers: this.transferQueue.length,
      recentTransfers: this.transferHistory.slice(-5),
    };
  }

  async shutdown() {
    logToFile("开始关闭SFTP引擎...", "INFO");

    // 停止监控
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }

    // 取消所有活跃传输
    for (const transfer of this.activeTransfers.values()) {
      transfer.cancel();
    }

    // 等待传输完成
    await new Promise((resolve) => {
      const checkTransfers = () => {
        if (this.activeTransfers.size === 0) {
          resolve();
        } else {
          setTimeout(checkTransfers, 100);
        }
      };
      checkTransfers();
    });

    // 关闭子系统
    if (this.config.optimization.enableMemoryPool) {
      await memoryPoolManager.stop();
    }

    if (this.config.optimization.enableBackpressure) {
      await backpressureController.stop();
    }

    this.isInitialized = false;
    this.emit("shutdown");
    logToFile("SFTP引擎已关闭", "INFO");
  }
}

// 导出
const sftpEngine = new SftpEngine();

module.exports = {
  SftpEngine,
  sftpEngine,
  SftpTransfer,
  TRANSFER_TYPE,
  TRANSFER_STATUS,
};
