const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getTempDirectory } = require("./appPaths");
const runtimeFileLifecycle = require("./runtimeFileLifecycle");

const DEFAULT_MAX_SNAPSHOTS_PER_FILE = 50;
const DEFAULT_SNAPSHOT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_SNAPSHOT_SETTINGS = Object.freeze({
  maxAgeMs: DEFAULT_SNAPSHOT_MAX_AGE_MS,
  maxTotalBytes: 256 * 1024 * 1024,
  cleanupIntervalMs: 30 * 60 * 1000,
  startupCleanup: "clear",
  protectActive: false,
});
const LIFECYCLE_RESOURCE_NAME = "file-snapshots";

class FileSnapshotStore {
  constructor() {
    this.snapshotRoot = null;
    this.logToFile = () => {};
    this.indexCache = new Map();
    this.settings = { ...DEFAULT_SNAPSHOT_SETTINGS };
  }

  init(logToFile, app = null) {
    this.logToFile = logToFile || (() => {});
    this.snapshotRoot = this.getSnapshotRoot(app);
    runtimeFileLifecycle.init(this.logToFile);
    runtimeFileLifecycle.registerResource(LIFECYCLE_RESOURCE_NAME, {
      rootPath: () => this.snapshotRoot,
      policy: this.settings,
      collectEntries: this.collectLifecycleEntries.bind(this),
      removeEntry: this.removeLifecycleEntry.bind(this),
      onClear: () => {
        this.indexCache.clear();
      },
    });
    this.logToFile(
      `File snapshot store initialized with directory: ${this.snapshotRoot}`,
      "INFO",
    );
  }

  getSnapshotRoot(app) {
    const snapshotRoot = path.join(getTempDirectory(app), "snapshots");
    fs.mkdirSync(snapshotRoot, { recursive: true });
    return snapshotRoot;
  }

  ensureInitialized() {
    if (!this.snapshotRoot) {
      throw new Error("File snapshot store not initialized");
    }
  }

  normalizeLabel(label, fallback = "手动快照") {
    if (typeof label !== "string") {
      return fallback;
    }

    const trimmed = label.trim();
    return trimmed.length > 0 ? trimmed.slice(0, 80) : fallback;
  }

  getFileKey(tabId, filePath) {
    return crypto
      .createHash("sha1")
      .update(`${String(tabId || "")}::${String(filePath || "")}`)
      .digest("hex");
  }

  getFileDirectory(tabId, filePath) {
    return path.join(this.snapshotRoot, this.getFileKey(tabId, filePath));
  }

  getIndexPath(fileDir) {
    return path.join(fileDir, "index.json");
  }

  getSnapshotFilePath(fileDir, snapshotId) {
    return path.join(fileDir, `${snapshotId}.txt`);
  }

  async loadIndex(fileDir) {
    if (this.indexCache.has(fileDir)) {
      return this.indexCache.get(fileDir);
    }

    const indexPath = this.getIndexPath(fileDir);

    try {
      const raw = await fs.promises.readFile(indexPath, "utf8");
      const parsed = JSON.parse(raw);
      const entries = Array.isArray(parsed?.entries)
        ? parsed.entries
            .filter((entry) => entry && entry.id)
            .sort(
              (left, right) =>
                new Date(right.createdAt).getTime() -
                new Date(left.createdAt).getTime(),
            )
        : [];

      this.indexCache.set(fileDir, entries);
      return entries;
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logToFile(
          `Failed to load snapshot index ${indexPath}: ${error.message}`,
          "WARN",
        );
      }
      const empty = [];
      this.indexCache.set(fileDir, empty);
      return empty;
    }
  }

  async saveIndex(fileDir, entries) {
    await fs.promises.mkdir(fileDir, { recursive: true });

    const normalizedEntries = [...entries].sort(
      (left, right) =>
        new Date(right.createdAt).getTime() -
        new Date(left.createdAt).getTime(),
    );

    await fs.promises.writeFile(
      this.getIndexPath(fileDir),
      JSON.stringify({ entries: normalizedEntries }, null, 2),
      "utf8",
    );

    this.indexCache.set(fileDir, normalizedEntries);
    return normalizedEntries;
  }

  async listSnapshots(tabId, filePath) {
    this.ensureInitialized();

    const fileDir = this.getFileDirectory(tabId, filePath);
    const entries = await this.loadIndex(fileDir);

    return entries
      .filter((entry) => entry.type !== "rollback-backup")
      .map((entry) => ({
        id: entry.id,
        createdAt: entry.createdAt,
        label: entry.label,
        type: entry.type,
        size: entry.size,
      }));
  }

  async createSnapshot(tabId, filePath, content, options = {}) {
    this.ensureInitialized();

    if (!tabId || !filePath) {
      throw new Error("Missing snapshot target");
    }

    if (typeof content !== "string") {
      throw new Error("Snapshot content must be a string");
    }

    const fileDir = this.getFileDirectory(tabId, filePath);
    await fs.promises.mkdir(fileDir, { recursive: true });

    const currentEntries = await this.loadIndex(fileDir);
    const contentHash = crypto
      .createHash("sha1")
      .update(content, "utf8")
      .digest("hex");
    const latest = currentEntries[0];

    if (!options.force && latest?.contentHash === contentHash) {
      return {
        success: true,
        deduplicated: true,
        snapshot: {
          id: latest.id,
          createdAt: latest.createdAt,
          label: latest.label,
          type: latest.type,
          size: latest.size,
        },
      };
    }

    const snapshotId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = (() => {
      if (typeof options.createdAt !== "string") {
        return new Date().toISOString();
      }

      const parsed = new Date(options.createdAt);
      return Number.isNaN(parsed.getTime())
        ? new Date().toISOString()
        : parsed.toISOString();
    })();
    const maxEntries = Math.max(
      1,
      Number(options.maxEntries) || DEFAULT_MAX_SNAPSHOTS_PER_FILE,
    );
    const entry = {
      id: snapshotId,
      createdAt,
      label: this.normalizeLabel(options.label, "手动快照"),
      type: options.type || "manual",
      size: Buffer.byteLength(content, "utf8"),
      contentHash,
    };

    await fs.promises.writeFile(
      this.getSnapshotFilePath(fileDir, snapshotId),
      content,
      "utf8",
    );

    const nextEntries = [entry, ...currentEntries];
    const retainedEntries = nextEntries.slice(0, maxEntries);
    const removedEntries = nextEntries.slice(maxEntries);

    await this.saveIndex(fileDir, retainedEntries);

    await Promise.all(
      removedEntries.map(async (removedEntry) => {
        try {
          await fs.promises.unlink(
            this.getSnapshotFilePath(fileDir, removedEntry.id),
          );
        } catch (error) {
          if (error.code !== "ENOENT") {
            this.logToFile(
              `Failed to remove old snapshot ${removedEntry.id}: ${error.message}`,
              "WARN",
            );
          }
        }
      }),
    );

    await runtimeFileLifecycle.sweepResource(LIFECYCLE_RESOURCE_NAME, {
      expired: false,
      size: true,
      reason: "snapshot-write",
    });

    this.logToFile(
      `Created snapshot for ${filePath} (tabId=${tabId}, snapshotId=${snapshotId})`,
      "INFO",
    );

    return {
      success: true,
      snapshot: {
        id: entry.id,
        createdAt: entry.createdAt,
        label: entry.label,
        type: entry.type,
        size: entry.size,
      },
    };
  }

  async readSnapshot(tabId, filePath, snapshotId) {
    this.ensureInitialized();

    const fileDir = this.getFileDirectory(tabId, filePath);
    const entries = await this.loadIndex(fileDir);
    const entry = entries.find((item) => item.id === snapshotId);

    if (!entry) {
      throw new Error("Snapshot not found");
    }

    const content = await fs.promises.readFile(
      this.getSnapshotFilePath(fileDir, snapshotId),
      "utf8",
    );

    return {
      id: entry.id,
      createdAt: entry.createdAt,
      label: entry.label,
      type: entry.type,
      size: entry.size,
      content,
    };
  }

  async restoreSnapshot(tabId, filePath, snapshotId, currentContent = null) {
    this.ensureInitialized();

    if (typeof currentContent === "string" && currentContent.length > 0) {
      await this.createSnapshot(tabId, filePath, currentContent, {
        label: "回退前自动备份",
        type: "rollback-backup",
      });
    }

    const snapshot = await this.readSnapshot(tabId, filePath, snapshotId);

    return {
      snapshot: {
        id: snapshot.id,
        createdAt: snapshot.createdAt,
        label: snapshot.label,
        type: snapshot.type,
        size: snapshot.size,
      },
      content: snapshot.content,
    };
  }

  async collectLifecycleEntries() {
    if (!this.snapshotRoot || !fs.existsSync(this.snapshotRoot)) {
      return [];
    }

    const entries = await fs.promises.readdir(this.snapshotRoot, {
      withFileTypes: true,
    });
    const result = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const dirPath = path.join(this.snapshotRoot, entry.name);
      let stats;
      try {
        stats = await fs.promises.stat(dirPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          this.logToFile(
            `Failed to stat snapshot directory ${dirPath}: ${error.message}`,
            "WARN",
          );
        }
        continue;
      }

      result.push({
        path: dirPath,
        type: "directory",
        bytes: await this.getDirectorySize(dirPath),
        createdAtMs: await this.getSnapshotDirectoryTimestamp(dirPath, stats),
        mtimeMs: stats.mtimeMs,
        active: false,
      });
    }

    return result;
  }

  async getDirectorySize(dirPath) {
    let total = 0;
    let entries;
    try {
      entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return 0;
      }
      throw error;
    }

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await this.getDirectorySize(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      try {
        const stats = await fs.promises.stat(entryPath);
        total += stats.size;
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
    return total;
  }

  async getSnapshotDirectoryTimestamp(dirPath, fallbackStats) {
    const entries = await this.loadIndex(dirPath);
    const latestTime = entries.reduce((latest, entry) => {
      const time = new Date(entry.createdAt).getTime();
      return Number.isFinite(time) ? Math.max(latest, time) : latest;
    }, 0);
    return latestTime || fallbackStats.mtimeMs;
  }

  async removeLifecycleEntry(entry) {
    await fs.promises.rm(entry.path, { recursive: true, force: true });
    this.indexCache.delete(entry.path);
    return true;
  }
}

module.exports = new FileSnapshotStore();
