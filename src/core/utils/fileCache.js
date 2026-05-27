const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getTempDirectory } = require("./appPaths");

const DEFAULT_CACHE_SETTINGS = Object.freeze({
  enabled: true,
  maxAgeMs: 60 * 60 * 1000,
  maxTotalBytes: 512 * 1024 * 1024,
  cleanupIntervalMs: 30 * 60 * 1000,
});

class FileCache {
  constructor() {
    this.cacheDir = null;
    this.activeCaches = new Map(); // 跟踪活跃的缓存文件
    this.logToFile = null;
    this.settings = { ...DEFAULT_CACHE_SETTINGS };
    this.cleanupTimer = null;
  }

  init(logToFile, app = null) {
    this.logToFile = logToFile || (() => {});
    this.cacheDir = this.getCacheDirectory(app);
    this.logToFile(
      `File cache initialized with directory: ${this.cacheDir}`,
      "INFO",
    );
  }

  getCacheDirectory(app) {
    const cacheDir = path.join(getTempDirectory(app), "cache");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
      this.logToFile(`Created cache directory: ${cacheDir}`, "INFO");
    }
    return cacheDir;
  }

  generateCacheFileName(originalFileName) {
    const ext = path.extname(originalFileName);
    const baseName = path.basename(originalFileName, ext);
    const uniqueId = uuidv4();
    return `${baseName}_${uniqueId}${ext}`;
  }

  async cacheFile(originalFileName, data, tabId) {
    try {
      if (!this.settings.enabled) {
        throw new Error("File cache is disabled");
      }

      const cacheFileName = this.generateCacheFileName(originalFileName);
      const cacheFilePath = path.join(this.cacheDir, cacheFileName);
      const bytes =
        Buffer.isBuffer(data) || typeof data === "string"
          ? Buffer.byteLength(data)
          : Number(data?.byteLength) || 0;

      // 写入文件
      await fs.promises.writeFile(cacheFilePath, data);

      // 记录活跃缓存
      const cacheInfo = {
        filePath: cacheFilePath,
        originalName: originalFileName,
        tabId: tabId,
        createdAt: Date.now(),
        bytes,
      };

      this.activeCaches.set(cacheFilePath, cacheInfo);

      this.logToFile(
        `File cached: ${originalFileName} -> ${cacheFilePath} (tabId: ${tabId})`,
        "DEBUG",
      );

      return cacheFilePath;
    } catch (error) {
      this.logToFile(
        `Failed to cache file ${originalFileName}: ${error.message}`,
        "ERROR",
      );
      throw error;
    }
  }

  async cleanupCacheFile(cacheFilePath) {
    try {
      if (fs.existsSync(cacheFilePath)) {
        await fs.promises.unlink(cacheFilePath);
        this.logToFile(`Cache file deleted: ${cacheFilePath}`, "DEBUG");
      }

      // 从活跃缓存中移除
      this.activeCaches.delete(cacheFilePath);
      return true;
    } catch (error) {
      this.logToFile(
        `Failed to cleanup cache file ${cacheFilePath}: ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  async cleanupTabCaches(tabId) {
    let cleanedCount = 0;
    const filesToClean = [];

    // 查找该标签页的所有缓存文件
    for (const [filePath, cacheInfo] of this.activeCaches.entries()) {
      if (cacheInfo.tabId === tabId) {
        filesToClean.push(filePath);
      }
    }

    // 清理文件
    for (const filePath of filesToClean) {
      const success = await this.cleanupCacheFile(filePath);
      if (success) {
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logToFile(
        `Cleaned up ${cleanedCount} cache files for tabId: ${tabId}`,
        "INFO",
      );
    }

    return cleanedCount;
  }

  async cleanup(cacheFilePath) {
    return this.cleanupCacheFile(cacheFilePath);
  }

  async cleanupTabFiles(tabId) {
    return this.cleanupTabCaches(tabId);
  }

  async clearCacheDirectory({ recreate = false } = {}) {
    if (!this.cacheDir) {
      return false;
    }

    try {
      let directoryExisted = false;

      if (fs.existsSync(this.cacheDir)) {
        directoryExisted = true;
        await fs.promises.rm(this.cacheDir, { recursive: true, force: true });
        this.logToFile(`Cleared cache directory: ${this.cacheDir}`, "INFO");
      }

      this.activeCaches.clear();

      if (recreate) {
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
      }

      return directoryExisted;
    } catch (error) {
      this.logToFile(
        `Failed to clear cache directory ${this.cacheDir}: ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }
  async cleanupAllCaches() {
    let cleanedCount = 0;
    const allFiles = [...this.activeCaches.keys()];

    for (const filePath of allFiles) {
      const success = await this.cleanupCacheFile(filePath);
      if (success) {
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logToFile(`Cleaned up ${cleanedCount} cache files`, "INFO");
    }

    return cleanedCount;
  }

  async cleanupExpiredCaches(maxAgeMs = 3600000) {
    // 默认1小时
    let cleanedCount = 0;
    const now = Date.now();
    const filesToClean = [];

    // 查找过期文件
    for (const [filePath, cacheInfo] of this.activeCaches.entries()) {
      if (now - cacheInfo.createdAt > maxAgeMs) {
        filesToClean.push(filePath);
      }
    }

    // 清理过期文件
    for (const filePath of filesToClean) {
      const success = await this.cleanupCacheFile(filePath);
      if (success) {
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logToFile(`Cleaned up ${cleanedCount} expired cache files`, "INFO");
    }

    return cleanedCount;
  }

  async enforceSizeLimit() {
    const maxTotalBytes = Number(this.settings.maxTotalBytes);
    if (!Number.isFinite(maxTotalBytes) || maxTotalBytes <= 0) {
      return 0;
    }

    const entries = Array.from(this.activeCaches.entries())
      .map(([filePath, info]) => ({
        filePath,
        createdAt: Number(info.createdAt) || 0,
        bytes: Number(info.bytes) || 0,
      }))
      .sort((left, right) => left.createdAt - right.createdAt);
    let totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    let cleanedCount = 0;

    for (const entry of entries) {
      if (totalBytes <= maxTotalBytes) {
        break;
      }
      const success = await this.cleanupCacheFile(entry.filePath);
      if (success) {
        totalBytes -= entry.bytes;
        cleanedCount += 1;
      }
    }

    if (cleanedCount > 0) {
      this.logToFile(
        `Cleaned up ${cleanedCount} cache files to enforce size limit`,
        "INFO",
      );
    }

    return cleanedCount;
  }

  updateSettings(settings = {}) {
    if (!settings || typeof settings !== "object") {
      return false;
    }

    const nextSettings = { ...this.settings };
    if (typeof settings.enabled === "boolean") {
      nextSettings.enabled = settings.enabled;
    }
    for (const key of ["maxAgeMs", "maxTotalBytes", "cleanupIntervalMs"]) {
      if (settings[key] !== undefined) {
        const value = Number(settings[key]);
        if (Number.isFinite(value) && value > 0) {
          nextSettings[key] = value;
        }
      }
    }

    this.settings = nextSettings;
    this.startPeriodicCleanup();

    if (!this.settings.enabled) {
      void this.clearCacheDirectory({ recreate: true });
    }

    return true;
  }

  getCacheStats() {
    return {
      totalFiles: this.activeCaches.size,
      cacheDirectory: this.cacheDir,
      files: Array.from(this.activeCaches.values()).map((info) => ({
        originalName: info.originalName,
        tabId: info.tabId,
        createdAt: new Date(info.createdAt).toISOString(),
        age: Date.now() - info.createdAt,
      })),
    };
  }

  startPeriodicCleanup(intervalMs, maxAgeMs) {
    // 如果已经有清理定时器在运行，先清理它
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    const cleanupIntervalMs =
      Number(intervalMs) || this.settings.cleanupIntervalMs;
    const cleanupMaxAgeMs = Number(maxAgeMs) || this.settings.maxAgeMs;

    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupExpiredCaches(cleanupMaxAgeMs);
        await this.enforceSizeLimit();
      } catch (error) {
        this.logToFile(
          `Error during periodic cache cleanup: ${error.message}`,
          "ERROR",
        );
      }
    }, cleanupIntervalMs);
    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }

    this.logToFile(
      `Started periodic cache cleanup (interval: ${cleanupIntervalMs}ms, maxAge: ${cleanupMaxAgeMs}ms)`,
      "INFO",
    );
  }

  stopPeriodicCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      this.logToFile("Stopped periodic cache cleanup", "INFO");
    }
  }
}

// 导出单例实例
const fileCache = new FileCache();
module.exports = fileCache;
