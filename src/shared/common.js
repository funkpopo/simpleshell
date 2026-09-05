// 主进程与渲染进程共用的轻量工具（保持零依赖）

/**
 * 生成带可选前缀的不透明唯一 ID（时间戳 base36 + 随机段）
 * @param {string} [prefix] - 可选前缀
 * @returns {string}
 */
function generateId(prefix = "") {
  const core = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 11)}`;
  return prefix ? `${prefix}_${core}` : core;
}

/**
 * 等待指定毫秒
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 将数值限制在 [min, max] 区间内
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 紧凑字节数格式化（状态栏/对话框等空间受限场景）
 * @param {number} value - 字节数
 * @param {{fallback?: string}} [options] - 非法/零值时的返回文本
 * @returns {string} 形如 "512 B" / "15 KB" / "1.5 MB"
 */
function formatBytes(value, options = {}) {
  const { fallback = "0 B" } = options;
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return fallback;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let scaled = bytes;
  let unitIndex = -1;
  do {
    scaled /= 1024;
    unitIndex += 1;
  } while (scaled >= 1024 && unitIndex < units.length - 1);

  const precision = scaled >= 10 ? 0 : 1;
  return `${scaled.toFixed(precision)} ${units[unitIndex]}`;
}

module.exports = {
  generateId,
  sleep,
  clamp,
  formatBytes,
};
