const fs = require("fs");
const path = require("path");

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

const DEFAULT_RESOURCE_POLICIES = Object.freeze({
  "file-cache": Object.freeze({
    maxAgeMs: ONE_HOUR_MS,
    maxTotalBytes: 512 * 1024 * 1024,
    cleanupIntervalMs: 30 * 60 * 1000,
    startupCleanup: "clear",
    protectActive: true,
  }),
  "file-snapshots": Object.freeze({
    maxAgeMs: 30 * ONE_DAY_MS,
    maxTotalBytes: 256 * 1024 * 1024,
    cleanupIntervalMs: 30 * 60 * 1000,
    startupCleanup: "clear",
    protectActive: false,
  }),
  "external-editor-temp": Object.freeze({
    maxAgeMs: ONE_DAY_MS,
    maxTotalBytes: 256 * 1024 * 1024,
    cleanupIntervalMs: 30 * 60 * 1000,
    startupCleanup: "clear",
    protectActive: true,
  }),
});

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizePolicy(name, policy = {}) {
  const defaults = DEFAULT_RESOURCE_POLICIES[name] || {};
  return {
    maxAgeMs: normalizePositiveNumber(policy.maxAgeMs, defaults.maxAgeMs),
    maxTotalBytes: normalizePositiveNumber(
      policy.maxTotalBytes,
      defaults.maxTotalBytes,
    ),
    cleanupIntervalMs: normalizePositiveNumber(
      policy.cleanupIntervalMs,
      defaults.cleanupIntervalMs,
    ),
    startupCleanup: policy.startupCleanup || defaults.startupCleanup || "sweep",
    protectActive:
      typeof policy.protectActive === "boolean"
        ? policy.protectActive
        : defaults.protectActive === true,
  };
}

function isSafeRuntimeRoot(rootPath) {
  if (!rootPath || typeof rootPath !== "string") {
    return false;
  }

  const resolved = path.resolve(rootPath);
  const parsed = path.parse(resolved);
  return resolved !== parsed.root && resolved.length > parsed.root.length + 1;
}

async function pathExists(targetPath) {
  try {
    await fs.promises.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function getDirectoryEntries(rootPath, options = {}) {
  const root = path.resolve(rootPath);
  const maxDepth = Number.isFinite(Number(options.maxDepth))
    ? Number(options.maxDepth)
    : Infinity;
  const entries = [];

  async function walk(currentPath, depth) {
    let dirEntries;
    try {
      dirEntries = await fs.promises.readdir(currentPath, {
        withFileTypes: true,
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      return;
    }

    for (const entry of dirEntries) {
      const entryPath = path.join(currentPath, entry.name);
      let stats;
      try {
        stats = await fs.promises.stat(entryPath);
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
        continue;
      }

      if (entry.isDirectory()) {
        if (depth >= maxDepth) {
          entries.push({
            path: entryPath,
            type: "directory",
            bytes: await getPathSize(entryPath),
            mtimeMs: stats.mtimeMs,
            createdAtMs: stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs,
          });
          continue;
        }

        await walk(entryPath, depth + 1);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      entries.push({
        path: entryPath,
        type: "file",
        bytes: stats.size,
        mtimeMs: stats.mtimeMs,
        createdAtMs: stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs,
      });
    }
  }

  await walk(root, 0);
  return entries;
}

async function getPathSize(targetPath) {
  let stats;
  try {
    stats = await fs.promises.stat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }

  if (stats.isFile()) {
    return stats.size;
  }

  if (!stats.isDirectory()) {
    return 0;
  }

  let total = 0;
  const entries = await fs.promises.readdir(targetPath, {
    withFileTypes: true,
  });
  for (const entry of entries) {
    total += await getPathSize(path.join(targetPath, entry.name));
  }
  return total;
}

class RuntimeFileLifecycleManager {
  constructor() {
    this.resources = new Map();
    this.cleanupTimer = null;
    this.logToFile = () => {};
  }

  init(logToFile) {
    this.logToFile = typeof logToFile === "function" ? logToFile : () => {};
  }

  registerResource(name, options = {}) {
    if (!name || typeof name !== "string") {
      throw new Error("Runtime file lifecycle resource name is required");
    }

    const rootPath =
      typeof options.rootPath === "function"
        ? options.rootPath
        : () => options.rootPath;
    const existing = this.resources.get(name) || {};
    const resource = {
      ...existing,
      ...options,
      name,
      rootPath,
      policy: normalizePolicy(name, {
        ...(existing.policy || {}),
        ...(options.policy || {}),
      }),
    };

    this.resources.set(name, resource);
    if (this.cleanupTimer) {
      this.startPeriodicCleanup();
    }
    return resource;
  }

  unregisterResource(name) {
    this.resources.delete(name);
    if (this.cleanupTimer) {
      this.startPeriodicCleanup();
    }
  }

  updatePolicy(name, policy = {}) {
    const resource = this.resources.get(name);
    if (!resource) {
      return false;
    }

    resource.policy = normalizePolicy(name, {
      ...resource.policy,
      ...policy,
    });
    if (this.cleanupTimer) {
      this.startPeriodicCleanup();
    }
    return true;
  }

  getPolicy(name) {
    const resource = this.resources.get(name);
    return resource ? { ...resource.policy } : normalizePolicy(name);
  }

  async resolveRoot(resource) {
    const rootPath = await Promise.resolve(resource.rootPath());
    return typeof rootPath === "string" && rootPath.trim()
      ? path.resolve(rootPath)
      : null;
  }

  async collectEntries(resource) {
    if (typeof resource.collectEntries === "function") {
      const entries = await resource.collectEntries();
      return Array.isArray(entries) ? entries : [];
    }

    const rootPath = await this.resolveRoot(resource);
    if (!rootPath || !(await pathExists(rootPath))) {
      return [];
    }

    return getDirectoryEntries(rootPath, resource.collectOptions);
  }

  normalizeEntry(entry) {
    const active = entry.active === true;
    return {
      ...entry,
      path: path.resolve(entry.path),
      type: entry.type === "directory" ? "directory" : "file",
      bytes: Math.max(0, Number(entry.bytes) || 0),
      createdAtMs:
        Number(entry.createdAtMs) ||
        Number(entry.createdAt) ||
        Number(entry.mtimeMs) ||
        0,
      mtimeMs: Number(entry.mtimeMs) || Number(entry.createdAtMs) || 0,
      active,
    };
  }

  async removeEntry(resource, entry, options = {}) {
    const normalized = this.normalizeEntry(entry);
    const includeActive = options.includeActive === true;

    if (normalized.active && resource.policy.protectActive && !includeActive) {
      return false;
    }

    if (typeof resource.removeEntry === "function") {
      const removed = await resource.removeEntry(normalized, options);
      if (removed !== false && typeof resource.onEntryRemoved === "function") {
        resource.onEntryRemoved(normalized, options);
      }
      return removed !== false;
    }

    try {
      await fs.promises.rm(normalized.path, {
        recursive: normalized.type === "directory",
        force: true,
      });
      if (typeof resource.onEntryRemoved === "function") {
        resource.onEntryRemoved(normalized, options);
      }
      return true;
    } catch (error) {
      if (error.code !== "ENOENT") {
        this.logToFile(
          `Failed to remove runtime file ${normalized.path}: ${error.message}`,
          "WARN",
        );
      }
      return false;
    }
  }

  async sweepResource(name, options = {}) {
    const resource = this.resources.get(name);
    if (!resource) {
      return {
        resource: name,
        removedExpired: 0,
        removedForSize: 0,
        totalBytesBefore: 0,
        totalBytesAfter: 0,
      };
    }

    const policy = normalizePolicy(name, {
      ...resource.policy,
      ...(options.policy || {}),
    });
    const now = Date.now();
    const maxAgeMs = normalizePositiveNumber(options.maxAgeMs, policy.maxAgeMs);
    const maxTotalBytes = normalizePositiveNumber(
      options.maxTotalBytes,
      policy.maxTotalBytes,
    );
    let entries = (await this.collectEntries(resource)).map((entry) =>
      this.normalizeEntry(entry),
    );
    let totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
    const totalBytesBefore = totalBytes;
    let removedExpired = 0;
    let removedForSize = 0;

    if (options.expired !== false && maxAgeMs > 0) {
      for (const entry of entries) {
        if (entry.active && policy.protectActive && !options.includeActive) {
          continue;
        }
        const ageBase = entry.createdAtMs || entry.mtimeMs;
        if (ageBase > 0 && now - ageBase <= maxAgeMs) {
          continue;
        }
        if (await this.removeEntry(resource, entry, options)) {
          removedExpired += 1;
          totalBytes -= entry.bytes;
          entry.removed = true;
        }
      }
    }

    entries = entries.filter((entry) => !entry.removed);

    if (
      options.size !== false &&
      maxTotalBytes > 0 &&
      totalBytes > maxTotalBytes
    ) {
      const candidates = entries
        .filter(
          (entry) =>
            options.includeActive ||
            !entry.active ||
            policy.protectActive !== true,
        )
        .sort((left, right) => {
          const leftTime = left.createdAtMs || left.mtimeMs || 0;
          const rightTime = right.createdAtMs || right.mtimeMs || 0;
          return leftTime - rightTime;
        });

      for (const entry of candidates) {
        if (totalBytes <= maxTotalBytes) {
          break;
        }
        if (await this.removeEntry(resource, entry, options)) {
          removedForSize += 1;
          totalBytes -= entry.bytes;
        }
      }
    }

    if (removedExpired > 0 || removedForSize > 0) {
      this.logToFile(
        `Runtime lifecycle sweep ${name}: expired=${removedExpired}, size=${removedForSize}`,
        "INFO",
      );
    }

    return {
      resource: name,
      removedExpired,
      removedForSize,
      totalBytesBefore,
      totalBytesAfter: Math.max(0, totalBytes),
    };
  }

  async clearResource(name, options = {}) {
    const resource = this.resources.get(name);
    if (!resource) {
      return false;
    }

    const rootPath = await this.resolveRoot(resource);
    if (!rootPath || !isSafeRuntimeRoot(rootPath)) {
      this.logToFile(
        `Refusing to clear unsafe runtime root for ${name}: ${rootPath || "<empty>"}`,
        "WARN",
      );
      return false;
    }

    try {
      if (options.includeActive === false) {
        const entries = (await this.collectEntries(resource)).map((entry) =>
          this.normalizeEntry(entry),
        );
        let removedCount = 0;
        for (const entry of entries) {
          if (entry.active && resource.policy.protectActive) {
            continue;
          }
          if (await this.removeEntry(resource, entry, options)) {
            removedCount += 1;
          }
        }
        if (typeof resource.onPartialClear === "function") {
          await resource.onPartialClear(options);
        }
        if (options.recreate) {
          await fs.promises.mkdir(rootPath, { recursive: true });
        }
        return removedCount > 0;
      }

      const existed = await pathExists(rootPath);
      if (typeof resource.onBeforeClear === "function") {
        await resource.onBeforeClear(options);
      }
      if (existed) {
        await fs.promises.rm(rootPath, { recursive: true, force: true });
      }

      if (typeof resource.onClear === "function") {
        await resource.onClear(options);
      }

      if (options.recreate) {
        await fs.promises.mkdir(rootPath, { recursive: true });
      }

      if (existed) {
        this.logToFile(
          `Runtime lifecycle cleared ${name}: ${rootPath}`,
          "INFO",
        );
      }
      return existed;
    } catch (error) {
      this.logToFile(
        `Failed to clear runtime resource ${name}: ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  async removeResourcePath(name, targetPath, options = {}) {
    const resource = this.resources.get(name);
    if (!resource || !targetPath) {
      return false;
    }

    const resolvedTarget = path.resolve(targetPath);
    const entries = (await this.collectEntries(resource)).map((entry) =>
      this.normalizeEntry(entry),
    );
    const entry = entries.find((item) => item.path === resolvedTarget);
    if (!entry) {
      return false;
    }

    return this.removeEntry(resource, entry, {
      includeActive: true,
      ...options,
    });
  }

  async removeMatchingEntries(name, predicate, options = {}) {
    const resource = this.resources.get(name);
    if (!resource || typeof predicate !== "function") {
      return 0;
    }

    const entries = (await this.collectEntries(resource)).map((entry) =>
      this.normalizeEntry(entry),
    );
    let removedCount = 0;

    for (const entry of entries) {
      if (!predicate(entry)) {
        continue;
      }
      if (
        await this.removeEntry(resource, entry, {
          includeActive: true,
          ...options,
        })
      ) {
        removedCount += 1;
      }
    }

    return removedCount;
  }

  async recoverFromPreviousExit(options = {}) {
    const results = {};
    for (const [name, resource] of this.resources.entries()) {
      const policy = resource.policy || normalizePolicy(name);
      if (policy.startupCleanup === "clear") {
        results[name] = {
          cleared: await this.clearResource(name, {
            recreate: options.recreate !== false,
            includeActive: true,
            reason: "startup-recovery",
          }),
        };
        continue;
      }

      results[name] = await this.sweepResource(name, {
        reason: "startup-recovery",
      });
    }
    return results;
  }

  async sweepAll(options = {}) {
    const results = {};
    for (const name of this.resources.keys()) {
      results[name] = await this.sweepResource(name, options);
    }
    return results;
  }

  startPeriodicCleanup() {
    this.stopPeriodicCleanup();

    const intervals = Array.from(this.resources.values())
      .map((resource) => Number(resource.policy?.cleanupIntervalMs))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (intervals.length === 0) {
      return false;
    }

    const intervalMs = Math.min(...intervals);
    this.cleanupTimer = setInterval(() => {
      this.sweepAll({ reason: "periodic" }).catch((error) => {
        this.logToFile(
          `Runtime lifecycle periodic cleanup failed: ${error.message}`,
          "ERROR",
        );
      });
    }, intervalMs);
    if (typeof this.cleanupTimer.unref === "function") {
      this.cleanupTimer.unref();
    }
    this.logToFile(
      `Runtime lifecycle cleanup started (interval=${intervalMs}ms)`,
      "INFO",
    );
    return true;
  }

  stopPeriodicCleanup() {
    if (!this.cleanupTimer) {
      return false;
    }
    clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    this.logToFile("Runtime lifecycle cleanup stopped", "INFO");
    return true;
  }
}

module.exports = new RuntimeFileLifecycleManager();
