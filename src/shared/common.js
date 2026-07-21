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

module.exports = {
  generateId,
  sleep,
};
