const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const DEFAULT_MAX_SNAPSHOTS_PER_FILE = 50;

class FileSnapshotStore {
  constructor() {
    this.snapshotRoot = null;
    this.logToFile = () => {};
    this.indexCache = new Map();
  }

  init(logToFile, app = null) {
    this.logToFile = logToFile || (() => {});
    this.snapshotRoot = this.getSnapshotRoot(app);
    this.logToFile(
      `File snapshot store initialized with directory: ${this.snapshotRoot}`,
      "INFO",
    );
  }

  getSnapshotRoot(app) {
    const candidates = [];

    if (process.env.NODE_ENV === "development") {
      candidates.push(path.join(process.cwd(), "temp", "snapshots"));
    } else {
      if (app && typeof app.getPath === "function") {
        try {
          candidates.push(
            path.join(path.dirname(app.getPath("exe")), "temp", "snapshots"),
          );
        } catch (error) {
          this.logToFile(
            `Failed to resolve exe snapshot directory: ${error.message}`,
            "WARN",
          );
        }

        try {
          candidates.push(
            path.join(app.getPath("temp"), "simpleshell", "snapshots"),
          );
        } catch (error) {
          this.logToFile(
            `Failed to resolve app snapshot directory: ${error.message}`,
            "WARN",
          );
        }
      }

      candidates.push(path.join(os.tmpdir(), "simpleshell", "snapshots"));
    }

    for (const candidate of candidates) {
      try {
        fs.mkdirSync(candidate, { recursive: true });
        return candidate;
      } catch (error) {
        this.logToFile(
          `Failed to prepare snapshot directory ${candidate}: ${error.message}`,
          "WARN",
        );
      }
    }

    throw new Error("Failed to initialize snapshot directory");
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

    return entries.map((entry) => ({
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

    if (latest?.contentHash === contentHash) {
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
    const createdAt = new Date().toISOString();
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

  async clearAllSnapshots({ recreate = false } = {}) {
    if (!this.snapshotRoot) {
      return false;
    }

    try {
      const existed = fs.existsSync(this.snapshotRoot);

      if (existed) {
        await fs.promises.rm(this.snapshotRoot, {
          recursive: true,
          force: true,
        });
      }

      this.indexCache.clear();

      if (recreate) {
        await fs.promises.mkdir(this.snapshotRoot, { recursive: true });
      }

      return existed;
    } catch (error) {
      this.logToFile(
        `Failed to clear snapshot directory ${this.snapshotRoot}: ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }
}

module.exports = new FileSnapshotStore();
