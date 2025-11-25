/**
 * 传输断点续传管理器
 * 负责持久化传输进度、支持断点续传、文件完整性校验
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { EventEmitter } = require("events");

// 传输状态持久化目录
const TRANSFER_STATE_DIR = path.join(
  require("electron").app.getPath("userData"),
  "transfer-states",
);

// 传输状态常量
const TRANSFER_STATE = {
  PENDING: "pending",
  TRANSFERRING: "transferring",
  PAUSED: "paused",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

// 确保状态目录存在
function ensureStateDir() {
  if (!fs.existsSync(TRANSFER_STATE_DIR)) {
    fs.mkdirSync(TRANSFER_STATE_DIR, { recursive: true });
  }
}

/**
 * 传输断点续传管理器
 */
class TransferResumeManager extends EventEmitter {
  constructor(logger) {
    super();
    this.logToFile = logger?.logToFile || (() => {});
    this.transfers = new Map(); // 内存中的传输状态
    this.checksumCache = new Map(); // 文件校验和缓存

    ensureStateDir();
    this.loadPersistedStates();
  }

  /**
   * 生成传输ID
   */
  generateTransferId(type, localPath, remotePath, tabId) {
    const hash = crypto
      .createHash("md5")
      .update(`${type}:${localPath}:${remotePath}:${tabId}`)
      .digest("hex");
    return `${type}_${hash.substring(0, 12)}`;
  }

  /**
   * 获取传输状态文件路径
   */
  getStateFilePath(transferId) {
    return path.join(TRANSFER_STATE_DIR, `${transferId}.json`);
  }

  /**
   * 创建新的传输记录
   */
  createTransfer(options) {
    const {
      type, // 'upload' | 'download'
      localPath,
      remotePath,
      tabId,
      totalSize,
      metadata = {},
    } = options;

    const transferId = this.generateTransferId(
      type,
      localPath,
      remotePath,
      tabId,
    );

    const transfer = {
      id: transferId,
      type,
      localPath,
      remotePath,
      tabId,
      totalSize,
      transferredSize: 0,
      state: TRANSFER_STATE.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      lastChunkAt: Date.now(),
      retryCount: 0,
      errors: [],
      metadata,

      // 断点续传相关
      chunks: [], // 已传输的块记录
      checksum: null, // 文件校验和
      checksumVerified: false,
    };

    this.transfers.set(transferId, transfer);
    this.persistTransferState(transferId);

    this.logToFile(
      `创建传输记录: ${transferId} (${type}: ${path.basename(localPath)})`,
      "INFO",
    );

    return transfer;
  }

  /**
   * 更新传输进度
   */
  updateProgress(transferId, bytesTransferred) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return false;
    }

    transfer.transferredSize = Math.min(
      transfer.transferredSize + bytesTransferred,
      transfer.totalSize,
    );
    transfer.updatedAt = Date.now();
    transfer.lastChunkAt = Date.now();
    transfer.state = TRANSFER_STATE.TRANSFERRING;

    // 每传输 1MB 或每 5 秒持久化一次
    const shouldPersist =
      transfer.transferredSize % (1024 * 1024) === 0 ||
      Date.now() - transfer.lastPersistAt > 5000;

    if (shouldPersist) {
      this.persistTransferState(transferId);
      transfer.lastPersistAt = Date.now();
    }

    this.emit("progress", {
      transferId,
      transferredSize: transfer.transferredSize,
      totalSize: transfer.totalSize,
      progress: (transfer.transferredSize / transfer.totalSize) * 100,
    });

    return true;
  }

  /**
   * 记录传输块
   */
  recordChunk(transferId, chunkInfo) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return false;
    }

    transfer.chunks.push({
      offset: chunkInfo.offset,
      size: chunkInfo.size,
      timestamp: Date.now(),
    });

    // 保持块记录数量限制（避免内存溢出）
    if (transfer.chunks.length > 1000) {
      transfer.chunks = transfer.chunks.slice(-500);
    }

    return true;
  }

  /**
   * 暂停传输
   */
  pauseTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return false;
    }

    transfer.state = TRANSFER_STATE.PAUSED;
    transfer.updatedAt = Date.now();
    this.persistTransferState(transferId);

    this.logToFile(`暂停传输: ${transferId}`, "INFO");
    this.emit("paused", { transferId });

    return true;
  }

  /**
   * 恢复传输
   */
  resumeTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return null;
    }

    if (
      transfer.state !== TRANSFER_STATE.PAUSED &&
      transfer.state !== TRANSFER_STATE.FAILED
    ) {
      return null;
    }

    transfer.state = TRANSFER_STATE.TRANSFERRING;
    transfer.updatedAt = Date.now();
    transfer.retryCount++;

    this.logToFile(
      `恢复传输: ${transferId}, 已传输 ${transfer.transferredSize}/${transfer.totalSize} 字节`,
      "INFO",
    );

    this.emit("resumed", {
      transferId,
      resumeOffset: transfer.transferredSize,
    });

    return {
      transfer,
      resumeOffset: transfer.transferredSize,
    };
  }

  /**
   * 标记传输完成
   */
  async completeTransfer(transferId, options = {}) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return false;
    }

    const { skipVerification = false } = options;

    // 校验文件完整性
    if (!skipVerification) {
      const isValid = await this.verifyTransferIntegrity(transferId);
      if (!isValid) {
        this.logToFile(
          `传输完成但校验失败: ${transferId}`,
          "ERROR",
        );
        transfer.state = TRANSFER_STATE.FAILED;
        transfer.errors.push({
          message: "文件完整性校验失败",
          timestamp: Date.now(),
        });
        this.persistTransferState(transferId);
        return false;
      }
    }

    transfer.state = TRANSFER_STATE.COMPLETED;
    transfer.updatedAt = Date.now();
    transfer.completedAt = Date.now();
    transfer.checksumVerified = !skipVerification;

    this.persistTransferState(transferId);

    this.logToFile(`传输完成: ${transferId}`, "INFO");
    this.emit("completed", { transferId });

    // 延迟清理状态文件（24小时后）
    setTimeout(
      () => {
        this.cleanupTransfer(transferId);
      },
      24 * 60 * 60 * 1000,
    );

    return true;
  }

  /**
   * 标记传输失败
   */
  failTransfer(transferId, error) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return false;
    }

    transfer.state = TRANSFER_STATE.FAILED;
    transfer.updatedAt = Date.now();
    transfer.errors.push({
      message: error.message || String(error),
      code: error.code,
      timestamp: Date.now(),
    });

    this.persistTransferState(transferId);

    this.logToFile(`传输失败: ${transferId} - ${error.message}`, "ERROR");
    this.emit("failed", { transferId, error });

    return true;
  }

  /**
   * 取消传输
   */
  cancelTransfer(transferId) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return false;
    }

    transfer.state = TRANSFER_STATE.CANCELLED;
    transfer.updatedAt = Date.now();
    this.persistTransferState(transferId);

    this.logToFile(`取消传输: ${transferId}`, "INFO");
    this.emit("cancelled", { transferId });

    // 立即清理
    setTimeout(() => {
      this.cleanupTransfer(transferId);
    }, 5000);

    return true;
  }

  /**
   * 计算文件校验和
   */
  async calculateChecksum(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  /**
   * 验证传输完整性
   */
  async verifyTransferIntegrity(transferId) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return false;
    }

    try {
      // 检查文件大小
      const localPath = transfer.localPath;
      if (!fs.existsSync(localPath)) {
        this.logToFile(
          `校验失败: 文件不存在 ${localPath}`,
          "ERROR",
        );
        return false;
      }

      const stats = fs.statSync(localPath);
      if (stats.size !== transfer.totalSize) {
        this.logToFile(
          `校验失败: 文件大小不匹配 (期望 ${transfer.totalSize}, 实际 ${stats.size})`,
          "ERROR",
        );
        return false;
      }

      // 计算校验和（可选，比较耗时）
      if (transfer.metadata.enableChecksum) {
        const checksum = await this.calculateChecksum(localPath);
        if (transfer.checksum && transfer.checksum !== checksum) {
          this.logToFile(
            `校验失败: 校验和不匹配`,
            "ERROR",
          );
          return false;
        }
        transfer.checksum = checksum;
      }

      this.logToFile(`传输校验通过: ${transferId}`, "INFO");
      return true;
    } catch (error) {
      this.logToFile(
        `传输校验出错: ${transferId} - ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  /**
   * 持久化传输状态
   */
  persistTransferState(transferId) {
    const transfer = this.transfers.get(transferId);
    if (!transfer) {
      return false;
    }

    try {
      const stateFile = this.getStateFilePath(transferId);
      fs.writeFileSync(stateFile, JSON.stringify(transfer, null, 2));
      return true;
    } catch (error) {
      this.logToFile(
        `持久化传输状态失败: ${transferId} - ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  /**
   * 加载持久化的传输状态
   */
  loadPersistedStates() {
    try {
      const files = fs.readdirSync(TRANSFER_STATE_DIR);
      let loadedCount = 0;

      for (const file of files) {
        if (!file.endsWith(".json")) {
          continue;
        }

        try {
          const filePath = path.join(TRANSFER_STATE_DIR, file);
          const content = fs.readFileSync(filePath, "utf-8");
          const transfer = JSON.parse(content);

          // 只加载未完成的传输
          if (
            transfer.state === TRANSFER_STATE.PENDING ||
            transfer.state === TRANSFER_STATE.TRANSFERRING ||
            transfer.state === TRANSFER_STATE.PAUSED ||
            transfer.state === TRANSFER_STATE.FAILED
          ) {
            this.transfers.set(transfer.id, transfer);
            loadedCount++;
          } else {
            // 清理已完成的旧记录
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          this.logToFile(
            `加载传输状态失败: ${file} - ${error.message}`,
            "ERROR",
          );
        }
      }

      if (loadedCount > 0) {
        this.logToFile(
          `加载了 ${loadedCount} 个未完成的传输记录`,
          "INFO",
        );
      }
    } catch (error) {
      this.logToFile(
        `加载持久化状态失败: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 清理传输记录
   */
  cleanupTransfer(transferId) {
    try {
      this.transfers.delete(transferId);
      const stateFile = this.getStateFilePath(transferId);
      if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile);
      }
      this.logToFile(`清理传输记录: ${transferId}`, "DEBUG");
    } catch (error) {
      this.logToFile(
        `清理传输记录失败: ${transferId} - ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 获取传输状态
   */
  getTransfer(transferId) {
    return this.transfers.get(transferId);
  }

  /**
   * 获取所有可恢复的传输
   */
  getResumableTransfers(tabId = null) {
    const transfers = Array.from(this.transfers.values()).filter(
      (t) =>
        (t.state === TRANSFER_STATE.PAUSED ||
          t.state === TRANSFER_STATE.FAILED) &&
        (tabId === null || t.tabId === tabId),
    );

    return transfers.map((t) => ({
      id: t.id,
      type: t.type,
      localPath: t.localPath,
      remotePath: t.remotePath,
      progress: (t.transferredSize / t.totalSize) * 100,
      state: t.state,
      lastError: t.errors[t.errors.length - 1],
      updatedAt: t.updatedAt,
    }));
  }

  /**
   * 清理所有已完成的传输
   */
  cleanupCompletedTransfers(olderThan = 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [transferId, transfer] of this.transfers.entries()) {
      if (
        transfer.state === TRANSFER_STATE.COMPLETED &&
        now - transfer.completedAt > olderThan
      ) {
        this.cleanupTransfer(transferId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logToFile(
        `清理了 ${cleanedCount} 个已完成的传输记录`,
        "INFO",
      );
    }
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    const transfers = Array.from(this.transfers.values());

    return {
      total: transfers.length,
      pending: transfers.filter((t) => t.state === TRANSFER_STATE.PENDING)
        .length,
      transferring: transfers.filter(
        (t) => t.state === TRANSFER_STATE.TRANSFERRING,
      ).length,
      paused: transfers.filter((t) => t.state === TRANSFER_STATE.PAUSED).length,
      completed: transfers.filter((t) => t.state === TRANSFER_STATE.COMPLETED)
        .length,
      failed: transfers.filter((t) => t.state === TRANSFER_STATE.FAILED).length,
      cancelled: transfers.filter((t) => t.state === TRANSFER_STATE.CANCELLED)
        .length,
      resumable: this.getResumableTransfers().length,
    };
  }

  /**
   * 关闭管理器
   */
  shutdown() {
    // 持久化所有未完成的传输
    for (const [transferId, transfer] of this.transfers.entries()) {
      if (transfer.state === TRANSFER_STATE.TRANSFERRING) {
        transfer.state = TRANSFER_STATE.PAUSED;
      }
      this.persistTransferState(transferId);
    }

    this.logToFile("传输断点续传管理器已关闭", "INFO");
  }
}

module.exports = {
  TransferResumeManager,
  TRANSFER_STATE,
  TRANSFER_STATE_DIR,
};
