const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

class FileCache {
  constructor() {
    this.cacheDir = null;
    this.activeCaches = new Map(); // 跟踪活跃的缓存文件
    this.logToFile = null;
  }

  init(logToFile, app = null) {
    this.logToFile = logToFile || (() => {});
    this.cacheDir = this.getCacheDirectory(app);
    this.ensureCacheDirectory();
    this.logToFile(
      `File cache initialized with directory: ${this.cacheDir}`,
      "INFO",
    );
  }

  getCacheDirectory(app) {
    if (process.env.NODE_ENV === "development") {
      // 开发环境：项目根目录下的temp目录
      return path.join(process.cwd(), "temp");
    } else {
      // 生产环境：exe同级的temp目录
      if (app && app.getPath) {
        const exePath = app.getPath("exe");
        return path.join(path.dirname(exePath), "temp");
      } else {
        // 回退方案：使用__dirname相对路径
        return path.join(__dirname, "..", "..", "..", "temp");
      }
    }
  }

  ensureCacheDirectory() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
        this.logToFile(`Created cache directory: ${this.cacheDir}`, "INFO");
      }
    } catch (error) {
      this.logToFile(
        `Failed to create cache directory: ${error.message}`,
        "ERROR",
      );
      throw error;
    }
  }

  generateCacheFileName(originalFileName) {
    const ext = path.extname(originalFileName);
    const baseName = path.basename(originalFileName, ext);
    const uniqueId = uuidv4();
    return `${baseName}_${uniqueId}${ext}`;
  }

  async cacheFile(originalFileName, data, tabId) {
    try {
      const cacheFileName = this.generateCacheFileName(originalFileName);
      const cacheFilePath = path.join(this.cacheDir, cacheFileName);

      // 写入文件
      await fs.promises.writeFile(cacheFilePath, data);

      // 记录活跃缓存
      const cacheInfo = {
        filePath: cacheFilePath,
        originalName: originalFileName,
        tabId: tabId,
        createdAt: Date.now(),
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

  startPeriodicCleanup(intervalMs = 1800000, maxAgeMs = 3600000) {
    // 默认30分钟清理一次，1小时过期
    setInterval(async () => {
      try {
        await this.cleanupExpiredCaches(maxAgeMs);
      } catch (error) {
        this.logToFile(
          `Error during periodic cache cleanup: ${error.message}`,
          "ERROR",
        );
      }
    }, intervalMs);

    this.logToFile(
      `Started periodic cache cleanup (interval: ${intervalMs}ms, maxAge: ${maxAgeMs}ms)`,
      "INFO",
    );
  }
}

// 导出单例实例
const fileCache = new FileCache();
module.exports = fileCache;
