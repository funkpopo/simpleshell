/**
 * 终端 scrollback 行数的单一来源（单一默认值 + 单一夹取范围）。
 *
 * P1：此前默认值 50000 与夹取范围（1000..500000）分散在
 * useTerminalLifecycle 与 Settings 共 6 处，极易漂移。
 * 终端创建、设置项加载/保存、ScrollbackUsageTracker 一律从这里取值。
 */

export const DEFAULT_TERMINAL_SCROLLBACK_LINES = 50000;
// 夹取范围（与 Settings UI 滑杆/输入范围一致）
export const MIN_TERMINAL_SCROLLBACK_LINES = 1000;
export const MAX_TERMINAL_SCROLLBACK_LINES = 500000;

/**
 * Clamp and normalize terminal scrollback line count.
 * @param {unknown} value
 * @returns {number}
 */
export const normalizeTerminalScrollbackLines = (value) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return DEFAULT_TERMINAL_SCROLLBACK_LINES;
  }
  return Math.min(
    MAX_TERMINAL_SCROLLBACK_LINES,
    Math.max(MIN_TERMINAL_SCROLLBACK_LINES, Math.floor(raw)),
  );
};
