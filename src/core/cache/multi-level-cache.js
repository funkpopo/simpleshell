/**
 * 多级缓存系统
 * 提供L1内存缓存、L2持久化缓存和智能预取功能
 */

const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");

// 缓存级别定义
const CACHE_LEVEL = {
  L1: 'l1', // 内存缓存
  L2: 'l2', // 持久化缓存
  L3: 'l3', // 远程缓存（预留）
};

// 缓存策略
const CACHE_STRATEGY = {
  LRU: 'lru',
  LFU: 'lfu',
  FIFO: 'fifo',
  TTL: 'ttl',
  ADAPTIVE: 'adaptive',
};

// 预取策略
const PREFETCH_STRATEGY = {
  SEQUENTIAL: 'sequential',
  PATTERN: 'pattern',
  PREDICTIVE: 'predictive',
  NONE: 'none',
};

/**
 * LRU缓存实现
 */
class LRUCache {
  constructor(maxSize = 100, maxAge = 5 * 60 * 1000) {
    this.maxSize = maxSize;
    this.maxAge = maxAge;
    this.cache = new Map();
    this.accessOrder = new Map();
    this.accessCount = 0;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    // 检查是否过期
    if (Date.now() - item.timestamp > this.maxAge) {
      this.delete(key);
      return null;
    }

    // 更新访问顺序
    this.accessOrder.set(key, ++this.accessCount);
    item.lastAccess = Date.now();
    item.accessCount++;

    return item.value;
  }

  set(key, value, options = {}) {
    const now = Date.now();
    const item = {
      value,
      timestamp: now,
      lastAccess: now,
      accessCount: 1,
      size: this.calculateSize(value),
      ttl: options.ttl || this.maxAge,
    };

    // 如果缓存已满，移除最少使用的项
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, item);
    this.accessOrder.set(key, ++this.accessCount);

    return true;
  }

  delete(key) {
    this.cache.delete(key);
    this.accessOrder.delete(key);
    return true;
  }

  clear() {
    this.cache.clear();
    this.accessOrder.clear();
    this.accessCount = 0;
  }

  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;

    // 检查是否过期
    if (Date.now() - item.timestamp > item.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  size() {
    return this.cache.size;
  }

  evictLRU() {
    let lruKey = null;
    let lruAccess = Infinity;

    for (const [key, accessTime] of this.accessOrder.entries()) {
      if (accessTime < lruAccess) {
        lruAccess = accessTime;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.delete(lruKey);
    }
  }

  calculateSize(value) {
    if (Buffer.isBuffer(value)) return value.length;
    if (typeof value === 'string') return value.length * 2; // Unicode字符
    if (typeof value === 'object') return JSON.stringify(value).length * 2;
    return 8; // 基本类型默认8字节
  }

  getStats() {
    let totalSize = 0;
    let expiredCount = 0;
    const now = Date.now();

    for (const item of this.cache.values()) {
      totalSize += item.size;
      if (now - item.timestamp > item.ttl) {
        expiredCount++;
      }
    }

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      totalSize,
      expiredCount,
      hitRate: this.calculateHitRate(),
    };
  }

  calculateHitRate() {
    // 简化的命中率计算
    let totalAccess = 0;
    for (const item of this.cache.values()) {
      totalAccess += item.accessCount;
    }
    return this.cache.size > 0 ? totalAccess / this.cache.size : 0;
  }
}

/**
 * 多级缓存管理器
 */
class MultiLevelCache extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      // L1缓存配置
      l1: {
        maxSize: options.l1?.maxSize || 1000,
        maxAge: options.l1?.maxAge || 5 * 60 * 1000, // 5分钟
        strategy: options.l1?.strategy || CACHE_STRATEGY.LRU,
      },
      
      // L2缓存配置
      l2: {
        maxSize: options.l2?.maxSize || 5000,
        maxAge: options.l2?.maxAge || 30 * 60 * 1000, // 30分钟
        strategy: options.l2?.strategy || CACHE_STRATEGY.LRU,
        persistent: options.l2?.persistent || false,
      },
      
      // 预取配置
      prefetch: {
        enabled: options.prefetch?.enabled !== false,
        strategy: options.prefetch?.strategy || PREFETCH_STRATEGY.PATTERN,
        lookahead: options.prefetch?.lookahead || 3,
        maxConcurrent: options.prefetch?.maxConcurrent || 5,
      },
      
      // 监控配置
      monitoring: {
        enabled: options.monitoring?.enabled !== false,
        metricsInterval: options.monitoring?.metricsInterval || 30000,
      },
      
      ...options
    };

    // 初始化缓存层
    this.l1Cache = new LRUCache(this.options.l1.maxSize, this.options.l1.maxAge);
    this.l2Cache = new LRUCache(this.options.l2.maxSize, this.options.l2.maxAge);
    
    // 预取相关
    this.prefetchQueue = new Map();
    this.prefetchPatterns = new Map();
    this.accessHistory = [];
    
    // 统计信息
    this.stats = {
      l1: { hits: 0, misses: 0, evictions: 0 },
      l2: { hits: 0, misses: 0, evictions: 0 },
      prefetch: { requests: 0, hits: 0, misses: 0 },
      total: { requests: 0, hits: 0, misses: 0 },
    };

    // 启动监控
    if (this.options.monitoring.enabled) {
      this.startMonitoring();
    }

    this.init();
  }

  /**
   * 初始化缓存系统
   */
  init() {
    logToFile('多级缓存系统初始化', 'INFO');
    this.emit('initialized');
  }

  /**
   * 获取缓存数据
   */
  async get(key, options = {}) {
    const startTime = performance.now();
    this.stats.total.requests++;
    
    try {
      // 记录访问历史
      this.recordAccess(key);
      
      // L1缓存查找
      let value = this.l1Cache.get(key);
      if (value !== null) {
        this.stats.l1.hits++;
        this.stats.total.hits++;
        this.emit('cacheHit', { level: CACHE_LEVEL.L1, key, time: performance.now() - startTime });
        return value;
      }
      this.stats.l1.misses++;

      // L2缓存查找
      value = this.l2Cache.get(key);
      if (value !== null) {
        this.stats.l2.hits++;
        this.stats.total.hits++;
        
        // 将数据提升到L1缓存
        this.l1Cache.set(key, value);
        
        this.emit('cacheHit', { level: CACHE_LEVEL.L2, key, time: performance.now() - startTime });
        return value;
      }
      this.stats.l2.misses++;
      this.stats.total.misses++;

      // 缓存未命中，触发预取
      if (this.options.prefetch.enabled) {
        this.triggerPrefetch(key);
      }

      this.emit('cacheMiss', { key, time: performance.now() - startTime });
      return null;
    } catch (error) {
      logToFile(`缓存获取失败: ${error.message}`, 'ERROR');
      return null;
    }
  }

  /**
   * 设置缓存数据
   */
  async set(key, value, options = {}) {
    const startTime = performance.now();
    
    try {
      const level = options.level || CACHE_LEVEL.L1;
      const ttl = options.ttl;
      
      // 根据级别设置缓存
      switch (level) {
        case CACHE_LEVEL.L1:
          this.l1Cache.set(key, value, { ttl });
          break;
        case CACHE_LEVEL.L2:
          this.l2Cache.set(key, value, { ttl });
          break;
        default:
          // 默认设置到L1，如果L1满了会自动降级到L2
          if (!this.l1Cache.set(key, value, { ttl })) {
            this.l2Cache.set(key, value, { ttl });
          }
      }

      // 更新访问模式
      this.updateAccessPattern(key);
      
      this.emit('cacheSet', { level, key, size: this.calculateSize(value), time: performance.now() - startTime });
      return true;
    } catch (error) {
      logToFile(`缓存设置失败: ${error.message}`, 'ERROR');
      return false;
    }
  }

  /**
   * 删除缓存数据
   */
  async delete(key) {
    try {
      const l1Deleted = this.l1Cache.delete(key);
      const l2Deleted = this.l2Cache.delete(key);
      
      this.emit('cacheDelete', { key, l1Deleted, l2Deleted });
      return l1Deleted || l2Deleted;
    } catch (error) {
      logToFile(`缓存删除失败: ${error.message}`, 'ERROR');
      return false;
    }
  }

  /**
   * 清空缓存
   */
  async clear(level = null) {
    try {
      if (!level || level === CACHE_LEVEL.L1) {
        this.l1Cache.clear();
      }
      if (!level || level === CACHE_LEVEL.L2) {
        this.l2Cache.clear();
      }
      
      this.emit('cacheCleared', { level });
      return true;
    } catch (error) {
      logToFile(`缓存清空失败: ${error.message}`, 'ERROR');
      return false;
    }
  }

  /**
   * 检查缓存是否存在
   */
  async has(key) {
    return this.l1Cache.has(key) || this.l2Cache.has(key);
  }

  /**
   * 记录访问历史
   */
  recordAccess(key) {
    const access = {
      key,
      timestamp: Date.now(),
    };
    
    this.accessHistory.push(access);
    
    // 保持历史记录在合理范围内
    if (this.accessHistory.length > 1000) {
      this.accessHistory = this.accessHistory.slice(-500);
    }
  }

  /**
   * 更新访问模式
   */
  updateAccessPattern(key) {
    if (!this.options.prefetch.enabled) return;
    
    const pattern = this.prefetchPatterns.get(key) || {
      count: 0,
      lastAccess: 0,
      frequency: 0,
      relatedKeys: new Set(),
    };
    
    pattern.count++;
    pattern.lastAccess = Date.now();
    pattern.frequency = pattern.count / (Date.now() - (pattern.firstAccess || Date.now()));
    
    if (!pattern.firstAccess) {
      pattern.firstAccess = Date.now();
    }
    
    this.prefetchPatterns.set(key, pattern);
  }

  /**
   * 触发预取
   */
  triggerPrefetch(key) {
    if (!this.options.prefetch.enabled) return;
    
    const strategy = this.options.prefetch.strategy;
    
    switch (strategy) {
      case PREFETCH_STRATEGY.SEQUENTIAL:
        this.prefetchSequential(key);
        break;
      case PREFETCH_STRATEGY.PATTERN:
        this.prefetchByPattern(key);
        break;
      case PREFETCH_STRATEGY.PREDICTIVE:
        this.prefetchPredictive(key);
        break;
    }
  }

  /**
   * 顺序预取
   */
  prefetchSequential(key) {
    // 简化的顺序预取：假设key是数字或可以递增的
    try {
      const baseKey = key.toString();
      const match = baseKey.match(/(\d+)$/);
      
      if (match) {
        const num = parseInt(match[1]);
        const prefix = baseKey.substring(0, match.index);
        
        for (let i = 1; i <= this.options.prefetch.lookahead; i++) {
          const nextKey = prefix + (num + i);
          this.schedulePrefetch(nextKey);
        }
      }
    } catch (error) {
      logToFile(`顺序预取失败: ${error.message}`, 'DEBUG');
    }
  }

  /**
   * 基于模式的预取
   */
  prefetchByPattern(key) {
    const pattern = this.prefetchPatterns.get(key);
    if (!pattern || pattern.relatedKeys.size === 0) return;
    
    // 预取相关的键
    for (const relatedKey of pattern.relatedKeys) {
      if (!this.has(relatedKey)) {
        this.schedulePrefetch(relatedKey);
      }
    }
  }

  /**
   * 预测性预取
   */
  prefetchPredictive(key) {
    // 基于访问历史进行预测
    const recentAccess = this.accessHistory.slice(-10);
    const keyIndex = recentAccess.findIndex(access => access.key === key);
    
    if (keyIndex >= 0 && keyIndex < recentAccess.length - 1) {
      // 预取历史上经常跟随的键
      const nextKey = recentAccess[keyIndex + 1].key;
      this.schedulePrefetch(nextKey);
    }
  }

  /**
   * 调度预取任务
   */
  schedulePrefetch(key) {
    if (this.prefetchQueue.has(key)) return;
    if (this.prefetchQueue.size >= this.options.prefetch.maxConcurrent) return;
    
    this.prefetchQueue.set(key, Date.now());
    this.stats.prefetch.requests++;
    
    // 触发预取事件，由外部处理实际的数据获取
    this.emit('prefetchRequest', { key });
  }

  /**
   * 预取完成回调
   */
  onPrefetchComplete(key, value, success = true) {
    this.prefetchQueue.delete(key);
    
    if (success && value !== null) {
      this.stats.prefetch.hits++;
      // 将预取的数据存入L2缓存
      this.l2Cache.set(key, value);
    } else {
      this.stats.prefetch.misses++;
    }
    
    this.emit('prefetchComplete', { key, success });
  }

  /**
   * 计算数据大小
   */
  calculateSize(value) {
    if (Buffer.isBuffer(value)) return value.length;
    if (typeof value === 'string') return value.length * 2;
    if (typeof value === 'object') return JSON.stringify(value).length * 2;
    return 8;
  }

  /**
   * 获取缓存统计信息
   */
  getStats() {
    return {
      ...this.stats,
      l1Stats: this.l1Cache.getStats(),
      l2Stats: this.l2Cache.getStats(),
      prefetchQueueSize: this.prefetchQueue.size,
      accessHistorySize: this.accessHistory.length,
      patternCount: this.prefetchPatterns.size,
      hitRate: this.stats.total.requests > 0 ? (this.stats.total.hits / this.stats.total.requests) * 100 : 0,
    };
  }

  /**
   * 启动监控
   */
  startMonitoring() {
    setInterval(() => {
      const stats = this.getStats();
      this.emit('metricsUpdate', stats);
      
      // 检查性能告警
      if (stats.hitRate < 50) {
        this.emit('performanceAlert', {
          type: 'low_hit_rate',
          value: stats.hitRate,
          message: `缓存命中率过低: ${stats.hitRate.toFixed(1)}%`
        });
      }
    }, this.options.monitoring.metricsInterval);
  }

  /**
   * 清理资源
   */
  dispose() {
    this.clear();
    this.prefetchQueue.clear();
    this.prefetchPatterns.clear();
    this.accessHistory = [];
    
    this.emit('disposed');
    logToFile('多级缓存系统已清理', 'INFO');
  }
}

module.exports = { MultiLevelCache, CACHE_LEVEL, CACHE_STRATEGY, PREFETCH_STRATEGY };
