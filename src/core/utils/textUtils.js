/**
 * 共享的小工具函数（无外部依赖，避免循环引用）
 */

/**
 * 生成可用于文件名的时间戳（ISO 格式，冒号与点替换为 "-"）
 * @param {Date} date
 * @returns {string}
 */
function buildFileTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

/**
 * 转义正则表达式元字符；非字符串输入会先转为字符串（undefined/null 视为 ""）
 * @param {*} value
 * @returns {string}
 */
function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  buildFileTimestamp,
  escapeRegExp,
};
