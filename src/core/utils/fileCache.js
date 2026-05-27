const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { getTempDirectory } = require("./appPaths");
const runtimeFileLifecycle = require("./runtimeFileLifecycle");

const LIFECYCLE_RESOURCE_NAME = "file-cache";

const DEFAULT_CACHE_SETTINGS = Object.freeze({
  enabled: true,
  maxAgeMs: 60 * 60 * 1000,
  maxTotalBytes: 512 * 1024 * 1024,
  cleanupIntervalMs: 30 * 60 * 1000,
  startupCleanup: "clear",
  protectActive: true,
});

class FileCache {
  constructor() {
    this.cacheDir = null;
    this.activeCaches = new Map();
    this.logToFile = () => {};
    this.settings = { ...DEFAULT_CACHE_SETTINGS };
  }

  init(logToFile, app = null) {
    this.logToFile = typeof logToFile === "function" ? logToFile : () => {};
    this.cacheDir = this.getCacheDirectory(app);
    runtimeFileLifecycle.init(this.logToFile);
    runtimeFileLifecycle.registerResource(LIFECYCLE_RESOURCE_NAME, {
      rootPath: () => this.cacheDir,
      policy: this.settings,
      collectEntries: this.collectLifecycleEntries.bind(this),
      removeEntry: this.removeLifecycleEntry.bind(this),
      onClear: () => {
        this.activeCaches.clear();
      },
    });
    this.logToFile(
      `File cache initialized with directory: ${this.cacheDir}`,
      "INFO",
    );
  }

  configure(settings = {}) {
    if (!settings || typeof settings !== "object") {
      return false;
    }

    const nextSettings = { ...this.settings };
    if (typeof settings.enabled === "boolean") {
      nextSettings.enabled = settings.enabled;
    }
    for (const key of ["maxAgeMs", "maxTotalBytes", "cleanupIntervalMs"]) {
      if (settings[key] === undefined) {
        continue;
      }
      const value = Number(settings[key]);
      if (Number.isFinite(value) && value > 0) {
        nextSettings[key] = value;
      }
    }

    this.settings = nextSettings;
    runtimeFileLifecycle.updatePolicy(LIFECYCLE_RESOURCE_NAME, this.settings);
    return true;
  }

  getCacheDirectory(app) {
    const cacheDir = path.join(getTempDirectory(app), "cache");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
  }

  generateCacheFileName(originalFileName) {
    const ext = path.extname(originalFileName);
    const baseName = path.basename(originalFileName, ext);
    return `${baseName}_${uuidv4()}${ext}`;
  }

  async cacheFile(originalFileName, data, tabId) {
    if (!this.settings.enabled) {
      throw new Error("File cache is disabled");
    }

    const cacheFileName = this.generateCacheFileName(originalFileName);
    const cacheFilePath = path.join(this.cacheDir, cacheFileName);
    const bytes =
      Buffer.isBuffer(data) || typeof data === "string"
        ? Buffer.byteLength(data)
        : Number(data?.byteLength) || 0;

    await fs.promises.writeFile(cacheFilePath, data);

    this.activeCaches.set(path.resolve(cacheFilePath), {
      filePath: path.resolve(cacheFilePath),
      originalName: originalFileName,
      tabId,
      createdAt: Date.now(),
      bytes,
    });

    await runtimeFileLifecycle.sweepResource(LIFECYCLE_RESOURCE_NAME, {
      expired: false,
      size: true,
      reason: "file-cache-write",
    });

    return cacheFilePath;
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
        bytes: info.bytes,
      })),
    };
  }

  async collectLifecycleEntries() {
    if (!this.cacheDir || !fs.existsSync(this.cacheDir)) {
      return [];
    }

    const entries = await fs.promises.readdir(this.cacheDir, {
      withFileTypes: true,
    });
    const result = [];
    const seen = new Set();

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const filePath = path.resolve(this.cacheDir, entry.name);
      seen.add(filePath);

      let stats;
      try {
        stats = await fs.promises.stat(filePath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          this.logToFile(
            `Failed to stat cache file ${filePath}: ${error.message}`,
            "WARN",
          );
        }
        continue;
      }

      const activeInfo = this.activeCaches.get(filePath);
      result.push({
        path: filePath,
        type: "file",
        bytes: activeInfo?.bytes || stats.size,
        createdAtMs:
          activeInfo?.createdAt || stats.birthtimeMs || stats.ctimeMs,
        mtimeMs: stats.mtimeMs,
        active: Boolean(activeInfo),
        metadata: {
          tabId: activeInfo?.tabId,
          originalName: activeInfo?.originalName,
        },
      });
    }

    for (const filePath of this.activeCaches.keys()) {
      if (!seen.has(filePath) && !fs.existsSync(filePath)) {
        this.activeCaches.delete(filePath);
      }
    }

    return result;
  }

  async removeLifecycleEntry(entry) {
    try {
      await fs.promises.rm(entry.path, { force: true });
      this.logToFile(`Cache file deleted: ${entry.path}`, "DEBUG");
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logToFile(
          `Failed to remove cache file ${entry.path}: ${error.message}`,
          "WARN",
        );
        return false;
      }
    }
    this.activeCaches.delete(path.resolve(entry.path));
    return true;
  }
}

module.exports = new FileCache();
module.exports.LIFECYCLE_RESOURCE_NAME = LIFECYCLE_RESOURCE_NAME;
