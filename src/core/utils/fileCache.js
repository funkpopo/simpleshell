const fs = require("fs");
const path = require("path");
const os = require("os");
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
    this.logToFile(
      `File cache initialized with directory: ${this.cacheDir}`,
      "INFO",
    );
  }

  getCacheDirectory(app) {
    const candidates = [];

    if (process.env.NODE_ENV === "development") {
      candidates.push(path.join(process.cwd(), "temp"));
    } else {
      if (app && typeof app.getPath === "function") {
        try {
          const exeTemp = path.join(path.dirname(app.getPath("exe")), "temp");
          candidates.push(exeTemp);
        } catch (error) {
          this.logToFile(
            `Failed to resolve exe temp directory: ${error.message}`,
            "WARN",
          );
        }

        try {
          const appTemp = path.join(
            app.getPath("temp"),
            "simpleshell",
            "cache",
          );
          if (!candidates.includes(appTemp)) {
            candidates.push(appTemp);
          }
        } catch (error) {
          this.logToFile(
            `Failed to resolve app temp directory: ${error.message}`,
            "WARN",
          );
        }
      }

      const systemTemp = path.join(os.tmpdir(), "simpleshell", "cache");
      if (!candidates.includes(systemTemp)) {
        candidates.push(systemTemp);
      }
    }

    for (const candidate of candidates) {
      try {
        if (!fs.existsSync(candidate)) {
          fs.mkdirSync(candidate, { recursive: true });
          this.logToFile(`Created cache directory: ${candidate}`, "INFO");
        }
        return candidate;
      } catch (error) {
        this.logToFile(
          `Failed to prepare cache directory ${candidate}: ${error.message}`,
          "WARN",
        );
      }
    }

    throw new Error("Failed to initialize cache directory");
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


  async clearCacheDirectory({ recreate = false } = {}) {
    if (!this.cacheDir) {
      return false;
    }

    try {
      let directoryExisted = false;

      if (fs.existsSync(this.cacheDir)) {
        directoryExisted = true;
        await fs.promises.rm(this.cacheDir, { recursive: true, force: true });
        this.logToFile(
          `Cleared cache directory: ${this.cacheDir}`,
          "INFO",
        );
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
    // 如果已经有清理定时器在运行，先清理它
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    // 默认30分钟清理一次，1小时过期
    this.cleanupTimer = setInterval(async () => {
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
