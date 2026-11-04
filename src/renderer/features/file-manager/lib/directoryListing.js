// Pure helpers and tuning constants for directory listing, caching and
// background refresh. Shared by the useFileNav sub-hooks.

export const CACHE_EXPIRY_TIME = 10000;

export const MAX_DIRECTORY_CACHE_ENTRIES = 500;

export const USER_ACTIVITY_REFRESH_DELAY = 300;

export const DIRECTORY_WATCH_INTERVAL_MS = 1500;

export const BACKGROUND_REFRESH_MIN_INTERVAL_MS = 2000;

export const BACKGROUND_REFRESH_MAX_IN_FLIGHT_MS = 60000;

export const toApiPath = (path) => {
  if (path === "~") return "";
  return path || "";
};

export const makeListKey = (id, apiPath) => {
  return `${id || ""}::${apiPath || ""}`;
};

export const computeFileListSignature = (list) => {
  if (!Array.isArray(list) || list.length === 0) return "0:0:0";

  let xor = 0;
  let sum = 0;

  for (let i = 0; i < list.length; i++) {
    const f = list[i] || {};
    const name = typeof f.name === "string" ? f.name : "";
    const modifyTime = Number.isFinite(f.modifyTime) ? f.modifyTime : 0;
    const size = Number.isFinite(f.size) ? f.size : 0;
    const isDir = f.isDirectory ? 1 : 0;

    // FNV-1a 32-bit (via Math.imul for speed)
    let h = 2166136261;
    const s = `${name}\u0000${modifyTime}\u0000${size}\u0000${isDir}`;
    for (let j = 0; j < s.length; j++) {
      h ^= s.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    h >>>= 0;

    xor ^= h;
    sum = (sum + h) >>> 0;
  }

  return `${list.length}:${(xor >>> 0).toString(16)}:${sum.toString(16)}`;
};

export const getCachedDirectory = (cache, path) => {
  const cacheEntry = cache.get(path);
  if (!cacheEntry) {
    return null;
  }
  const now = Date.now();

  // 检查缓存是否过期
  if (now - cacheEntry.timestamp > CACHE_EXPIRY_TIME) {
    return null;
  }
  return cacheEntry.data;
};

export const storeCachedDirectory = (cache, path, data) => {
  cache.set(path, {
    data,
    timestamp: Date.now(),
  });

  // LRU: 超过上限则删除最旧条目
  if (cache.size > MAX_DIRECTORY_CACHE_ENTRIES) {
    const oldestPath = cache.keys().next().value;
    cache.delete(oldestPath);
  }
};
