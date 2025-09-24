// Simple in-memory cache for directory listings across component mounts
// Keyed by `${tabId}:${path}` with TTL-based expiry

const cache = new Map();

const makeKey = (tabId, path) => `${tabId || ""}:${path || "/"}`;

function set(tabId, path, data) {
  try {
    const key = makeKey(tabId, path);
    cache.set(key, {
      data: Array.isArray(data) ? data : [],
      timestamp: Date.now(),
    });
  } catch (_) {
    // ignore
  }
}

function get(tabId, path, maxAgeMs = 10000) {
  try {
    const key = makeKey(tabId, path);
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > maxAgeMs) return null;
    return entry.data;
  } catch (_) {
    return null;
  }
}

function clear(tabId) {
  if (!tabId) return;
  const prefix = `${tabId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

module.exports = { set, get, clear };
