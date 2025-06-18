const EventEmitter = require("events");
const zlib = require("zlib");
const LRU = require("lru-cache");

class OptimizationMiddleware extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      // 压缩选项
      compression: {
        enabled: options.compression?.enabled ?? true,
        level: options.compression?.level ?? 6,
        threshold: options.compression?.threshold ?? 1024, // 1KB
        algorithm: options.compression?.algorithm ?? "gzip",
      },

      // 缓存选项
      cache: {
        enabled: options.cache?.enabled ?? true,
        maxSize: options.cache?.maxSize ?? 100 * 1024 * 1024, // 100MB
        maxAge: options.cache?.maxAge ?? 5 * 60 * 1000, // 5分钟
        updateAgeOnGet: options.cache?.updateAgeOnGet ?? true,
      },

      // 预取选项
      prefetch: {
        enabled: options.prefetch?.enabled ?? true,
        lookahead: options.prefetch?.lookahead ?? 3,
        maxConcurrent: options.prefetch?.maxConcurrent ?? 2,
        patternDetection: options.prefetch?.patternDetection ?? true,
      },

      // 自适应选项
      adaptive: {
        enabled: options.adaptive?.enabled ?? true,
        sampleWindow: options.adaptive?.sampleWindow ?? 10,
        adjustInterval: options.adaptive?.adjustInterval ?? 30000, // 30秒
      },
    };

    this.cache = null;
    this.compressionAlgorithms = new Map();
    this.prefetchQueue = new Map();
    this.performanceMetrics = {
      compressionRatio: [],
      cacheHitRate: [],
      transferSpeed: [],
      lastAdjustment: Date.now(),
    };

    this.init();
  }

  init() {
    // 初始化缓存
    if (this.options.cache.enabled) {
      this.cache = new LRU({
        max: this.options.cache.maxSize,
        maxAge: this.options.cache.maxAge,
        updateAgeOnGet: this.options.cache.updateAgeOnGet,
        dispose: (key, value) => {
          this.emit("cache:evicted", { key, size: value.length });
        },
      });
    }

    // 初始化压缩算法
    this.setupCompressionAlgorithms();

    // 启动自适应调整
    if (this.options.adaptive.enabled) {
      this.startAdaptiveAdjustment();
    }
  }

  setupCompressionAlgorithms() {
    this.compressionAlgorithms.set("gzip", {
      compress: (data, level) => zlib.gzipSync(data, { level }),
      decompress: (data) => zlib.gunzipSync(data),
    });

    this.compressionAlgorithms.set("deflate", {
      compress: (data, level) => zlib.deflateSync(data, { level }),
      decompress: (data) => zlib.inflateSync(data),
    });

    this.compressionAlgorithms.set("brotli", {
      compress: (data, level) =>
        zlib.brotliCompressSync(data, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: level },
        }),
      decompress: (data) => zlib.brotliDecompressSync(data),
    });
  }

  async processOutput(data, options = {}) {
    const startTime = Date.now();
    let processedData = data;
    const metadata = {
      originalSize: data.length,
      compressed: false,
      cached: false,
      processingTime: 0,
    };

    try {
      // 检查缓存
      const cacheKey = this.generateCacheKey(data, options);
      if (this.options.cache.enabled && this.cache) {
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) {
          metadata.cached = true;
          metadata.processingTime = Date.now() - startTime;
          this.updateMetrics("cache", true);
          return { data: cachedData, metadata };
        }
      }

      // 压缩处理
      if (this.shouldCompress(data, options)) {
        const compressed = await this.compressData(data);
        if (compressed.length < data.length) {
          processedData = compressed;
          metadata.compressed = true;
          metadata.compressionRatio = compressed.length / data.length;
          this.updateMetrics("compression", metadata.compressionRatio);
        }
      }

      // 存入缓存
      if (this.options.cache.enabled && this.cache && !metadata.cached) {
        this.cache.set(cacheKey, processedData);
      }

      metadata.processingTime = Date.now() - startTime;
      this.updateMetrics("cache", false);

      return { data: processedData, metadata };
    } catch (error) {
      this.emit("error", error);
      return { data, metadata: { ...metadata, error: error.message } };
    }
  }

  async processInput(data, metadata = {}) {
    const startTime = Date.now();
    let processedData = data;

    try {
      // 解压缩
      if (metadata.compressed) {
        processedData = await this.decompressData(data);
      }

      const processingTime = Date.now() - startTime;
      this.updateMetrics("transfer", data.length / (processingTime / 1000));

      return processedData;
    } catch (error) {
      this.emit("error", error);
      return data;
    }
  }

  async prefetchData(paths, options = {}) {
    if (!this.options.prefetch.enabled || !Array.isArray(paths)) {
      return;
    }

    const prefetchTasks = paths
      .slice(0, this.options.prefetch.lookahead)
      .map((path) => this.schedulePrefetch(path, options));

    // 限制并发数
    const chunks = this.chunkArray(
      prefetchTasks,
      this.options.prefetch.maxConcurrent,
    );

    for (const chunk of chunks) {
      await Promise.allSettled(chunk);
    }
  }

  async schedulePrefetch(path, options) {
    const cacheKey = this.generateCacheKey(path, options);

    if (this.cache && this.cache.has(cacheKey)) {
      return; // 已在缓存中
    }

    if (this.prefetchQueue.has(path)) {
      return; // 已在预取队列中
    }

    this.prefetchQueue.set(path, Date.now());

    try {
      // 这里应该调用实际的数据获取函数
      this.emit("prefetch:request", { path, options });
    } catch (error) {
      this.emit("prefetch:error", { path, error });
    } finally {
      this.prefetchQueue.delete(path);
    }
  }

  async compressData(data) {
    const algorithm = this.compressionAlgorithms.get(
      this.options.compression.algorithm,
    );
    if (!algorithm) {
      throw new Error(
        `Unsupported compression algorithm: ${this.options.compression.algorithm}`,
      );
    }

    return algorithm.compress(data, this.options.compression.level);
  }

  async decompressData(data) {
    const algorithm = this.compressionAlgorithms.get(
      this.options.compression.algorithm,
    );
    if (!algorithm) {
      throw new Error(
        `Unsupported compression algorithm: ${this.options.compression.algorithm}`,
      );
    }

    return algorithm.decompress(data);
  }

  shouldCompress(data, options = {}) {
    if (!this.options.compression.enabled) return false;
    if (options.skipCompression) return false;
    if (data.length < this.options.compression.threshold) return false;

    // 检查文件类型
    const mimeType = options.mimeType || "";
    const compressibleTypes = [
      "text/",
      "application/json",
      "application/xml",
      "application/javascript",
      "application/css",
    ];

    if (
      mimeType &&
      !compressibleTypes.some((type) => mimeType.startsWith(type))
    ) {
      return false;
    }

    return true;
  }

  generateCacheKey(data, options = {}) {
    const crypto = require("crypto");
    const keyData = typeof data === "string" ? data : JSON.stringify(options);
    return crypto.createHash("md5").update(keyData).digest("hex");
  }

  updateMetrics(type, value) {
    const metrics = this.performanceMetrics;
    const window = this.options.adaptive.sampleWindow;

    switch (type) {
      case "compression":
        metrics.compressionRatio.push(value);
        if (metrics.compressionRatio.length > window) {
          metrics.compressionRatio.shift();
        }
        break;

      case "cache":
        metrics.cacheHitRate.push(value ? 1 : 0);
        if (metrics.cacheHitRate.length > window) {
          metrics.cacheHitRate.shift();
        }
        break;

      case "transfer":
        metrics.transferSpeed.push(value);
        if (metrics.transferSpeed.length > window) {
          metrics.transferSpeed.shift();
        }
        break;
    }
  }

  startAdaptiveAdjustment() {
    this.adaptiveTimer = setInterval(() => {
      this.performAdaptiveAdjustment();
    }, this.options.adaptive.adjustInterval);
  }

  performAdaptiveAdjustment() {
    const metrics = this.performanceMetrics;

    // 调整压缩级别
    if (metrics.compressionRatio.length > 0) {
      const avgRatio =
        metrics.compressionRatio.reduce((a, b) => a + b) /
        metrics.compressionRatio.length;
      const avgSpeed =
        metrics.transferSpeed.length > 0
          ? metrics.transferSpeed.reduce((a, b) => a + b) /
            metrics.transferSpeed.length
          : 0;

      // 如果压缩效果不佳但速度较慢，降低压缩级别
      if (avgRatio > 0.8 && avgSpeed < 1024 * 1024) {
        // 1MB/s
        this.options.compression.level = Math.max(
          1,
          this.options.compression.level - 1,
        );
      }
      // 如果压缩效果很好且速度可接受，提高压缩级别
      else if (avgRatio < 0.5 && avgSpeed > 5 * 1024 * 1024) {
        // 5MB/s
        this.options.compression.level = Math.min(
          9,
          this.options.compression.level + 1,
        );
      }
    }

    // 调整缓存大小
    if (metrics.cacheHitRate.length > 0) {
      const hitRate =
        metrics.cacheHitRate.reduce((a, b) => a + b) /
        metrics.cacheHitRate.length;

      if (hitRate < 0.3 && this.cache) {
        // 命中率低，可能需要调整缓存策略
        this.options.cache.maxAge = Math.max(
          60000,
          this.options.cache.maxAge * 0.8,
        );
      } else if (hitRate > 0.7) {
        // 命中率高，可以延长缓存时间
        this.options.cache.maxAge = Math.min(
          300000,
          this.options.cache.maxAge * 1.2,
        );
      }
    }

    this.emit("adaptive:adjusted", {
      compressionLevel: this.options.compression.level,
      cacheMaxAge: this.options.cache.maxAge,
      timestamp: Date.now(),
    });
  }

  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  getStats() {
    const metrics = this.performanceMetrics;

    return {
      compression: {
        level: this.options.compression.level,
        avgRatio:
          metrics.compressionRatio.length > 0
            ? metrics.compressionRatio.reduce((a, b) => a + b) /
              metrics.compressionRatio.length
            : 0,
      },
      cache: {
        size: this.cache ? this.cache.length : 0,
        hitRate:
          metrics.cacheHitRate.length > 0
            ? metrics.cacheHitRate.reduce((a, b) => a + b) /
              metrics.cacheHitRate.length
            : 0,
        maxAge: this.options.cache.maxAge,
      },
      transfer: {
        avgSpeed:
          metrics.transferSpeed.length > 0
            ? metrics.transferSpeed.reduce((a, b) => a + b) /
              metrics.transferSpeed.length
            : 0,
      },
      prefetch: {
        queueSize: this.prefetchQueue.size,
      },
    };
  }

  destroy() {
    if (this.adaptiveTimer) {
      clearInterval(this.adaptiveTimer);
    }

    if (this.cache) {
      this.cache.reset();
    }

    this.prefetchQueue.clear();
    this.removeAllListeners();
  }
}

module.exports = OptimizationMiddleware;
