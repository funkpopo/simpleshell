const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");

// 内存池配置
const MEMORY_POOL_CONFIG = {
  pools: {
    small: { size: 4 * 1024, count: 100 }, // 4KB 小块
    medium: { size: 64 * 1024, count: 50 }, // 64KB 中块
    large: { size: 1024 * 1024, count: 20 }, // 1MB 大块
    huge: { size: 8 * 1024 * 1024, count: 5 }, // 8MB 超大块
  },

  management: {
    maxPoolMemory: 512 * 1024 * 1024, // 最大池内存（512MB）
    gcThreshold: 0.8, // 垃圾回收阈值（80%）
    defragmentThreshold: 0.7, // 碎片整理阈值（70%）
    cleanupInterval: 60 * 1000, // 清理间隔（1分钟）
    metricsInterval: 30 * 1000, // 指标收集间隔（30秒）
  },

  optimization: {
    enableCompression: true, // 启用压缩
    enableZeroCopy: true, // 启用零拷贝
    adaptivePooling: true, // 自适应池大小
    memoryMapping: true, // 内存映射
  },
};

// 内存块状态
const BLOCK_STATE = {
  FREE: "free", // 空闲
  ALLOCATED: "allocated", // 已分配
  RESERVED: "reserved", // 预留
  DEFRAGMENTING: "defragmenting", // 碎片整理中
};

// 内存池类型
const POOL_TYPE = {
  FIXED: "fixed", // 固定大小池
  VARIABLE: "variable", // 可变大小池
  ELASTIC: "elastic", // 弹性池
};

class MemoryBlock {
  constructor(buffer, size, poolType) {
    this.buffer = buffer;
    this.size = size;
    this.poolType = poolType;
    this.state = BLOCK_STATE.FREE;
    this.allocatedAt = null;
    this.lastUsed = null;
    this.useCount = 0;
    this.id = this.generateId();
  }

  generateId() {
    return `block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  allocate() {
    if (this.state !== BLOCK_STATE.FREE) {
      throw new Error(`内存块状态错误: ${this.state}`);
    }

    this.state = BLOCK_STATE.ALLOCATED;
    this.allocatedAt = Date.now();
    this.lastUsed = Date.now();
    this.useCount++;

    return this.buffer;
  }

  free() {
    if (this.state !== BLOCK_STATE.ALLOCATED) {
      throw new Error(`内存块状态错误: ${this.state}`);
    }

    this.state = BLOCK_STATE.FREE;
    this.allocatedAt = null;

    // 清零内存内容（安全考虑）
    this.buffer.fill(0);
  }

  reserve() {
    this.state = BLOCK_STATE.RESERVED;
  }

  isExpired(maxAge) {
    if (!this.allocatedAt) return false;
    return Date.now() - this.allocatedAt > maxAge;
  }
}

class MemoryPool extends EventEmitter {
  constructor(poolType, blockSize, initialCount, config = {}) {
    super();

    this.poolType = poolType;
    this.blockSize = blockSize;
    this.maxBlocks = config.maxBlocks || initialCount * 2;
    this.config = config;

    this.blocks = new Map(); // 所有内存块
    this.freeBlocks = new Set(); // 空闲块
    this.allocatedBlocks = new Set(); // 已分配块

    this.stats = {
      totalAllocated: 0,
      totalFreed: 0,
      peakUsage: 0,
      currentUsage: 0,
      fragmentationRatio: 0,
      hitRate: 0,
      missCount: 0,
    };

    // 预分配初始内存块
    this.preallocateBlocks(initialCount);
  }

  preallocateBlocks(count) {
    for (let i = 0; i < count; i++) {
      this.createNewBlock();
    }

    logToFile(
      `预分配${count}个${this.poolType}内存块 (${this.blockSize}字节)`,
      "DEBUG",
    );
  }

  createNewBlock() {
    if (this.blocks.size >= this.maxBlocks) {
      throw new Error(`内存池已达到最大容量: ${this.maxBlocks}`);
    }

    // 使用allocUnsafeSlow创建非池化Buffer
    const buffer = Buffer.allocUnsafeSlow(this.blockSize);
    const block = new MemoryBlock(buffer, this.blockSize, this.poolType);

    this.blocks.set(block.id, block);
    this.freeBlocks.add(block.id);

    this.emit("blockCreated", block);
    return block;
  }

  allocate() {
    // 优先使用空闲块
    let blockId = this.freeBlocks.values().next().value;

    if (!blockId) {
      // 尝试创建新块
      if (this.blocks.size < this.maxBlocks) {
        const newBlock = this.createNewBlock();
        blockId = newBlock.id;
      } else {
        // 触发垃圾回收
        this.triggerGarbageCollection();
        blockId = this.freeBlocks.values().next().value;

        if (!blockId) {
          this.stats.missCount++;
          throw new Error(`内存池耗尽: ${this.poolType}`);
        }
      }
    }

    const block = this.blocks.get(blockId);
    this.freeBlocks.delete(blockId);
    this.allocatedBlocks.add(blockId);

    const buffer = block.allocate();

    this.stats.totalAllocated++;
    this.stats.currentUsage = this.allocatedBlocks.size;
    this.stats.peakUsage = Math.max(
      this.stats.peakUsage,
      this.stats.currentUsage,
    );
    this.stats.hitRate =
      (this.stats.totalAllocated /
        (this.stats.totalAllocated + this.stats.missCount)) *
      100;

    this.emit("blockAllocated", block);
    return { buffer, blockId: block.id };
  }

  free(blockId) {
    const block = this.blocks.get(blockId);
    if (!block) {
      logToFile(`尝试释放不存在的内存块: ${blockId}`, "WARN");
      return false;
    }

    if (block.state !== BLOCK_STATE.ALLOCATED) {
      logToFile(`尝试释放非分配状态的内存块: ${blockId}`, "WARN");
      return false;
    }

    block.free();
    this.allocatedBlocks.delete(blockId);
    this.freeBlocks.add(blockId);

    this.stats.totalFreed++;
    this.stats.currentUsage = this.allocatedBlocks.size;

    this.emit("blockFreed", block);
    return true;
  }

  triggerGarbageCollection() {
    logToFile(`触发内存池垃圾回收: ${this.poolType}`, "DEBUG");

    const maxAge = 5 * 60 * 1000; // 5分钟
    const expiredBlocks = [];

    for (const blockId of this.allocatedBlocks) {
      const block = this.blocks.get(blockId);
      if (block && block.isExpired(maxAge)) {
        expiredBlocks.push(blockId);
      }
    }

    // 强制回收过期块（谨慎使用）
    for (const blockId of expiredBlocks) {
      logToFile(`强制回收过期内存块: ${blockId}`, "WARN");
      this.free(blockId);
    }

    this.emit("garbageCollected", { reclaimedBlocks: expiredBlocks.length });
  }

  calculateFragmentation() {
    const totalBlocks = this.blocks.size;
    const freeBlocks = this.freeBlocks.size;

    if (totalBlocks === 0) return 0;

    // 简化的碎片率计算
    this.stats.fragmentationRatio = (totalBlocks - freeBlocks) / totalBlocks;
    return this.stats.fragmentationRatio;
  }

  getStats() {
    this.calculateFragmentation();

    return {
      ...this.stats,
      poolType: this.poolType,
      blockSize: this.blockSize,
      totalBlocks: this.blocks.size,
      freeBlocks: this.freeBlocks.size,
      allocatedBlocks: this.allocatedBlocks.size,
      memoryUsage: {
        total: this.blocks.size * this.blockSize,
        allocated: this.allocatedBlocks.size * this.blockSize,
        free: this.freeBlocks.size * this.blockSize,
      },
    };
  }

  shrink() {
    // 缩减池大小，移除多余的空闲块
    const targetFreeBlocks = Math.max(1, Math.floor(this.blocks.size * 0.2));
    const excessBlocks = this.freeBlocks.size - targetFreeBlocks;

    if (excessBlocks > 0) {
      const blocksToRemove = Array.from(this.freeBlocks).slice(0, excessBlocks);

      for (const blockId of blocksToRemove) {
        this.blocks.delete(blockId);
        this.freeBlocks.delete(blockId);
      }

      logToFile(
        `缩减内存池${this.poolType}，移除${excessBlocks}个空闲块`,
        "DEBUG",
      );
      this.emit("poolShrunk", { removedBlocks: excessBlocks });
    }
  }

  expand(additionalBlocks) {
    // 扩展池大小
    const newMaxBlocks = this.maxBlocks + additionalBlocks;

    if (newMaxBlocks > this.config.absoluteMaxBlocks) {
      throw new Error(`超过内存池绝对最大限制`);
    }

    this.maxBlocks = newMaxBlocks;
    this.preallocateBlocks(Math.min(additionalBlocks, 10)); // 预分配部分块

    logToFile(
      `扩展内存池${this.poolType}，新增${additionalBlocks}个槽位`,
      "DEBUG",
    );
    this.emit("poolExpanded", { additionalBlocks });
  }
}

class MemoryPoolManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = { ...MEMORY_POOL_CONFIG, ...config };

    this.pools = new Map();
    this.allocation = new Map(); // 分配记录
    this.statistics = new Map(); // 统计信息

    this.globalStats = {
      totalAllocations: 0,
      totalDeallocations: 0,
      peakMemoryUsage: 0,
      currentMemoryUsage: 0,
      fragmentationRatio: 0,
      gcCount: 0,
      defragmentCount: 0,
    };

    this.isInitialized = false;
    this.cleanupTimer = null;
    this.metricsTimer = null;

    this.initializePools();
  }

  initializePools() {
    for (const [poolName, poolConfig] of Object.entries(this.config.pools)) {
      const pool = new MemoryPool(poolName, poolConfig.size, poolConfig.count, {
        maxBlocks: poolConfig.count * 3,
        absoluteMaxBlocks: poolConfig.count * 5,
      });

      this.setupPoolEventListeners(pool, poolName);
      this.pools.set(poolName, pool);
      this.statistics.set(poolName, pool.getStats());
    }

    logToFile("内存池管理器初始化完成", "INFO");
  }

  setupPoolEventListeners(pool, poolName) {
    pool.on("blockAllocated", (block) => {
      this.globalStats.totalAllocations++;
      this.updateGlobalMemoryUsage();
      this.emit("memoryAllocated", { poolName, block });
    });

    pool.on("blockFreed", (block) => {
      this.globalStats.totalDeallocations++;
      this.updateGlobalMemoryUsage();
      this.emit("memoryFreed", { poolName, block });
    });

    pool.on("garbageCollected", (info) => {
      this.globalStats.gcCount++;
      this.emit("garbageCollected", { poolName, ...info });
    });
  }

  async start() {
    if (this.isInitialized) {
      return;
    }

    // 启动清理任务
    this.startCleanupTimer();

    // 启动指标收集
    this.startMetricsCollection();

    this.isInitialized = true;
    this.emit("started");
    logToFile("内存池管理器已启动", "INFO");
  }

  async stop() {
    if (!this.isInitialized) {
      return;
    }

    // 停止定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }

    // 释放所有内存
    await this.releaseAllMemory();

    this.isInitialized = false;
    this.emit("stopped");
    logToFile("内存池管理器已停止", "INFO");
  }

  // 智能内存分配
  allocate(requestedSize, options = {}) {
    const poolName = this.selectOptimalPool(requestedSize);
    if (!poolName) {
      throw new Error(`无法找到合适的内存池为大小: ${requestedSize}`);
    }

    const pool = this.pools.get(poolName);
    try {
      const { buffer, blockId } = pool.allocate();

      // 记录分配信息
      const allocationInfo = {
        blockId,
        poolName,
        requestedSize,
        actualSize: buffer.length,
        timestamp: Date.now(),
        options,
      };

      this.allocation.set(blockId, allocationInfo);

      // 如果请求的大小小于实际分配的大小，返回子视图
      const resultBuffer =
        requestedSize < buffer.length
          ? buffer.subarray(0, requestedSize)
          : buffer;

      logToFile(
        `分配内存: ${requestedSize}字节 -> ${poolName}池 (块ID: ${blockId})`,
        "DEBUG",
      );

      return {
        buffer: resultBuffer,
        blockId,
        actualSize: buffer.length,
        poolName,
      };
    } catch (error) {
      logToFile(`内存分配失败: ${error.message}`, "ERROR");

      // 尝试触发全局垃圾回收
      if (this.shouldTriggerGlobalGC()) {
        this.performGlobalGarbageCollection();

        // 重试分配
        try {
          return this.allocate(requestedSize, options);
        } catch (retryError) {
          throw new Error(`内存分配失败（重试后）: ${retryError.message}`);
        }
      }

      throw error;
    }
  }

  // 释放内存
  free(blockId) {
    const allocationInfo = this.allocation.get(blockId);
    if (!allocationInfo) {
      logToFile(`尝试释放未知的内存块: ${blockId}`, "WARN");
      return false;
    }

    const pool = this.pools.get(allocationInfo.poolName);
    if (!pool) {
      logToFile(`内存池不存在: ${allocationInfo.poolName}`, "ERROR");
      return false;
    }

    const success = pool.free(blockId);
    if (success) {
      this.allocation.delete(blockId);
      logToFile(`释放内存块: ${blockId} (${allocationInfo.poolName})`, "DEBUG");
    }

    return success;
  }

  // 选择最优内存池
  selectOptimalPool(requestedSize) {
    // 查找最小的足够大的池
    let bestPool = null;
    let bestSize = Infinity;

    for (const [poolName, pool] of this.pools) {
      if (pool.blockSize >= requestedSize && pool.blockSize < bestSize) {
        bestPool = poolName;
        bestSize = pool.blockSize;
      }
    }

    // 如果没有找到合适的池，考虑动态创建
    if (!bestPool && this.config.optimization.adaptivePooling) {
      bestPool = this.createDynamicPool(requestedSize);
    }

    return bestPool;
  }

  // 创建动态内存池
  createDynamicPool(requestedSize) {
    // 将请求大小向上取整到2的幂次
    const poolSize = Math.pow(2, Math.ceil(Math.log2(requestedSize)));
    const poolName = `dynamic_${poolSize}`;

    if (this.pools.has(poolName)) {
      return poolName;
    }

    // 检查总内存使用量
    if (
      this.getCurrentMemoryUsage() + poolSize * 10 >
      this.config.management.maxPoolMemory
    ) {
      logToFile(`内存使用量过高，无法创建动态池: ${poolName}`, "WARN");
      return null;
    }

    const pool = new MemoryPool(
      poolName,
      poolSize,
      5, // 初始5个块
      {
        maxBlocks: 20,
        absoluteMaxBlocks: 50,
      },
    );

    this.setupPoolEventListeners(pool, poolName);
    this.pools.set(poolName, pool);
    this.statistics.set(poolName, pool.getStats());

    logToFile(`创建动态内存池: ${poolName} (${poolSize}字节)`, "INFO");
    this.emit("dynamicPoolCreated", { poolName, poolSize });

    return poolName;
  }

  // 内存复制优化
  copyBuffer(source, destination, options = {}) {
    const {
      offset = 0,
      length = source.length,
      enableZeroCopy = true,
    } = options;

    if (enableZeroCopy && this.config.optimization.enableZeroCopy) {
      // 尝试零拷贝：共享底层ArrayBuffer
      if (source.buffer === destination.buffer) {
        // 同一ArrayBuffer，无需复制
        return length;
      }

      // 创建共享视图
      try {
        const sharedBuffer = Buffer.from(
          source.buffer,
          source.byteOffset + offset,
          length,
        );
        sharedBuffer.copy(
          destination,
          0,
          0,
          Math.min(length, destination.length),
        );
        return Math.min(length, destination.length);
      } catch (error) {
        logToFile(`零拷贝失败，回退到常规复制: ${error.message}`, "DEBUG");
      }
    }

    // 常规复制
    const bytesToCopy = Math.min(length, destination.length);
    source.copy(destination, 0, offset, offset + bytesToCopy);
    return bytesToCopy;
  }

  // 内存压缩
  compressBuffer(buffer) {
    if (!this.config.optimization.enableCompression) {
      return buffer;
    }

    try {
      const zlib = require("zlib");
      return zlib.deflateSync(buffer);
    } catch (error) {
      logToFile(`内存压缩失败: ${error.message}`, "WARN");
      return buffer;
    }
  }

  decompressBuffer(compressedBuffer) {
    if (!this.config.optimization.enableCompression) {
      return compressedBuffer;
    }

    try {
      const zlib = require("zlib");
      return zlib.inflateSync(compressedBuffer);
    } catch (error) {
      logToFile(`内存解压失败: ${error.message}`, "WARN");
      return compressedBuffer;
    }
  }

  // 内存碎片整理
  async performDefragmentation() {
    logToFile("开始内存碎片整理...", "INFO");

    let totalDefragmented = 0;

    for (const [poolName, pool] of this.pools) {
      const stats = pool.getStats();

      if (
        stats.fragmentationRatio > this.config.management.defragmentThreshold
      ) {
        logToFile(`整理内存池碎片: ${poolName}`, "DEBUG");

        // 简单的碎片整理：压缩空闲块
        pool.shrink();
        totalDefragmented++;
      }
    }

    this.globalStats.defragmentCount++;

    logToFile(`内存碎片整理完成，处理了${totalDefragmented}个池`, "INFO");
    this.emit("defragmentationCompleted", {
      poolsDefragmented: totalDefragmented,
    });
  }

  // 全局垃圾回收
  performGlobalGarbageCollection() {
    logToFile("开始全局垃圾回收...", "INFO");

    for (const pool of this.pools.values()) {
      pool.triggerGarbageCollection();
    }

    // 清理孤儿分配记录
    const orphanedAllocations = [];
    for (const [blockId, allocation] of this.allocation) {
      const pool = this.pools.get(allocation.poolName);
      if (!pool || !pool.blocks.has(blockId)) {
        orphanedAllocations.push(blockId);
      }
    }

    for (const blockId of orphanedAllocations) {
      this.allocation.delete(blockId);
    }

    if (orphanedAllocations.length > 0) {
      logToFile(`清理了${orphanedAllocations.length}个孤儿分配记录`, "DEBUG");
    }

    this.globalStats.gcCount++;
    this.emit("globalGarbageCollected", {
      orphanedAllocations: orphanedAllocations.length,
    });
  }

  shouldTriggerGlobalGC() {
    const usage = this.getCurrentMemoryUsage();
    const maxMemory = this.config.management.maxPoolMemory;

    return usage / maxMemory > this.config.management.gcThreshold;
  }

  getCurrentMemoryUsage() {
    let totalUsage = 0;

    for (const pool of this.pools.values()) {
      const stats = pool.getStats();
      totalUsage += stats.memoryUsage.total;
    }

    return totalUsage;
  }

  updateGlobalMemoryUsage() {
    const currentUsage = this.getCurrentMemoryUsage();
    this.globalStats.currentMemoryUsage = currentUsage;
    this.globalStats.peakMemoryUsage = Math.max(
      this.globalStats.peakMemoryUsage,
      currentUsage,
    );
  }

  startCleanupTimer() {
    this.cleanupTimer = setInterval(async () => {
      try {
        // 检查是否需要碎片整理
        const avgFragmentation =
          Array.from(this.pools.values()).reduce(
            (sum, pool) => sum + pool.calculateFragmentation(),
            0,
          ) / this.pools.size;

        if (avgFragmentation > this.config.management.defragmentThreshold) {
          await this.performDefragmentation();
        }

        // 检查是否需要垃圾回收
        if (this.shouldTriggerGlobalGC()) {
          this.performGlobalGarbageCollection();
        }
      } catch (error) {
        logToFile(`内存清理任务出错: ${error.message}`, "ERROR");
      }
    }, this.config.management.cleanupInterval);
  }

  startMetricsCollection() {
    this.metricsTimer = setInterval(() => {
      this.collectMetrics();
    }, this.config.management.metricsInterval);
  }

  collectMetrics() {
    // 更新所有池的统计信息
    for (const [poolName, pool] of this.pools) {
      this.statistics.set(poolName, pool.getStats());
    }

    // 更新全局统计
    this.updateGlobalMemoryUsage();

    // 计算全局碎片率
    const totalFragmentation = Array.from(this.pools.values()).reduce(
      (sum, pool) => sum + pool.calculateFragmentation(),
      0,
    );
    this.globalStats.fragmentationRatio = totalFragmentation / this.pools.size;

    this.emit("metricsCollected", this.getDetailedStats());
  }

  async releaseAllMemory() {
    logToFile("释放所有内存...", "INFO");

    // 清理所有分配记录
    this.allocation.clear();

    // 清理所有池
    for (const pool of this.pools.values()) {
      pool.blocks.clear();
      pool.freeBlocks.clear();
      pool.allocatedBlocks.clear();
    }

    this.pools.clear();
    this.statistics.clear();

    // 强制垃圾回收
    if (global.gc) {
      global.gc();
    }

    logToFile("所有内存已释放", "INFO");
  }

  // 公共接口方法
  getGlobalStats() {
    return {
      ...this.globalStats,
      totalPools: this.pools.size,
      activeAllocations: this.allocation.size,
      memoryEfficiency: this.calculateMemoryEfficiency(),
    };
  }

  getPoolStats(poolName) {
    const pool = this.pools.get(poolName);
    return pool ? pool.getStats() : null;
  }

  getAllPoolStats() {
    const stats = {};
    for (const [poolName, pool] of this.pools) {
      stats[poolName] = pool.getStats();
    }
    return stats;
  }

  getDetailedStats() {
    return {
      global: this.getGlobalStats(),
      pools: this.getAllPoolStats(),
      allocations: Array.from(this.allocation.values()),
      systemMemory: this.getSystemMemoryInfo(),
    };
  }

  calculateMemoryEfficiency() {
    const allocated = this.globalStats.totalAllocations;
    const freed = this.globalStats.totalDeallocations;

    if (allocated === 0) return 100;

    return ((freed / allocated) * 100).toFixed(2);
  }

  getSystemMemoryInfo() {
    const usage = process.memoryUsage();
    return {
      rss: usage.rss, // 常驻集大小
      heapTotal: usage.heapTotal, // 堆总大小
      heapUsed: usage.heapUsed, // 已使用堆
      external: usage.external, // 外部内存
      arrayBuffers: usage.arrayBuffers, // ArrayBuffer内存
    };
  }

  // 内存优化建议
  getOptimizationRecommendations() {
    const recommendations = [];
    const globalStats = this.getGlobalStats();
    const poolStats = this.getAllPoolStats();

    // 检查内存使用率
    const memoryUsageRatio =
      globalStats.currentMemoryUsage / this.config.management.maxPoolMemory;
    if (memoryUsageRatio > 0.9) {
      recommendations.push({
        type: "memory_pressure",
        severity: "high",
        message: "内存使用率过高，建议增加内存限制或优化内存使用",
      });
    }

    // 检查碎片率
    if (globalStats.fragmentationRatio > 0.8) {
      recommendations.push({
        type: "fragmentation",
        severity: "medium",
        message: "内存碎片率过高，建议执行碎片整理",
      });
    }

    // 检查池效率
    for (const [poolName, stats] of Object.entries(poolStats)) {
      if (stats.hitRate < 80) {
        recommendations.push({
          type: "pool_efficiency",
          severity: "low",
          message: `${poolName}池命中率低(${stats.hitRate.toFixed(1)}%)，建议调整池大小`,
        });
      }
    }

    return recommendations;
  }
}

// 导出单例实例
const memoryPoolManager = new MemoryPoolManager();

module.exports = memoryPoolManager;
