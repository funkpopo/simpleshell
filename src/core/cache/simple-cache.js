const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");

/**
 * 简化的 LRU 缓存实现
 * 替代过度复杂的三层缓存系统，提供单层内存缓存
 */
class SimpleCache extends EventEmitter {
  constructor(options = {}) {
    super();

    this.maxSize = options.maxSize || 1000;
    this.maxAge = options.maxAge || 5 * 60 * 1000; // 5分钟默认过期时间
    this.cache = new Map();
    this.accessOrder = new Map();
    this.accessCount = 0;
    
    // 统计信息
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      sets: 0,
    };
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) {
      this.stats.misses++;
      return null;
    }

    // 检查是否过期
    if (Date.now() - item.timestamp > item.ttl) {
      this.delete(key);
      this.stats.misses++;
      return null;
    }

    // 更新访问顺序
    this.accessOrder.set(key, ++this.accessCount);
    item.lastAccess = Date.now();
    item.accessCount++;
    this.stats.hits++;

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
    this.stats.sets++;

    return true;
  }

  delete(key) {
    const deleted = this.cache.delete(key);
    this.accessOrder.delete(key);
    return deleted;
  }

  clear() {
    this.cache.clear();
    this.accessOrder.clear();
    this.accessCount = 0;
    this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
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
      this.stats.evictions++;
    }
  }

  calculateSize(value) {
    if (Buffer.isBuffer(value)) return value.length;
    if (typeof value === "string") return value.length * 2;
    if (typeof value === "object") return JSON.stringify(value).length * 2;
    return 8;
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

    const totalRequests = this.stats.hits + this.stats.misses;
    const hitRate = totalRequests > 0 ? (this.stats.hits / totalRequests) * 100 : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      totalSize,
      expiredCount,
      hitRate,
      ...this.stats,
    };
  }

  // 清理过期项
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    for (const [key, item] of this.cache.entries()) {
      if (now - item.timestamp > item.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.delete(key));
    return keysToDelete.length;
  }
}

// 导出简化的缓存类
module.exports = {
  SimpleCache,
  // 保持向后兼容的别名
  MultiLevelCache: SimpleCache,
};
