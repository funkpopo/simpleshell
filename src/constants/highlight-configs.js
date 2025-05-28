// src/constants/highlight-configs.js
const HIGHLIGHT_COLORS = {
  // 统一定义颜色，方便复用和修改
  defaultText: "inherit", // 或者终端的默认颜色
  error: "red",
  warning: "orange",
  success: "green",
  info: "blue",
  debug: "purple",
  ipAddress: "cyan",
  shellPrompt: "#A9A9A9", // 暗灰色，用于提示符
  alertKeyword: "magenta",
  criticalKeyword: "#FF6347", // Tomato色，比纯红柔和些
  commandKeyword: "#61affe", // 类似 'get', 'post'
  timestamp: "#61affe", // 时间戳颜色
  hyperlink: "#4682B4", // 钢蓝色，适合超链接
  macAddress: "#98FB98", // 浅绿色，用于MAC地址
  envVariable: "#20B2AA", // 浅海绿色，用于环境变量
  statusCode: "#FF7F50", // 珊瑚色，用于状态码
  dockerId: "#5F9EA0", // 军蓝色，用于Docker ID
};

module.exports = [
  {
    id: "ipv4",
    type: "regex",
    name: "IPv4 Address",
    enabled: true,
    pattern: "\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\b",
    flags: "g",
    style: `color: ${HIGHLIGHT_COLORS.ipAddress};`,
  },
  {
    id: "ipv6",
    type: "regex",
    name: "IPv6 Address",
    enabled: true,
    // 优化IPv6正则表达式，支持所有格式的IPv6地址
    pattern:
      "\\b(?:(?:[0-9A-Fa-f]{1,4}:){6}(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|::(?:[0-9A-Fa-f]{1,4}:){0,4}(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}):(?::[0-9A-Fa-f]{1,4}){0,3}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){2}(?::[0-9A-Fa-f]{1,4}){0,2}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){3}(?::[0-9A-Fa-f]{1,4}){0,1}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){4}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|:(?::(?:[0-9A-Fa-f]{1,4})){1,6}|::|[0-9A-Fa-f]{1,4}:(?::(?:[0-9A-Fa-f]{1,4})){1,5}|(?:[0-9A-Fa-f]{1,4}:){2}(?::(?:[0-9A-Fa-f]{1,4})){1,4}|(?:[0-9A-Fa-f]{1,4}:){3}(?::(?:[0-9A-Fa-f]{1,4})){1,3}|(?:[0-9A-Fa-f]{1,4}:){4}(?::(?:[0-9A-Fa-f]{1,4})){1,2}|(?:[0-9A-Fa-f]{1,4}:){5}:(?:[0-9A-Fa-f]{1,4})?|(?:[0-9A-Fa-f]{1,4}:){6}:)\\b",
    flags: "gi", // global, case-insensitive
    style: `color: ${HIGHLIGHT_COLORS.ipAddress};`,
  },
  // 添加时间戳匹配
  {
    id: "timeStamp",
    type: "regex",
    name: "Timestamp Pattern",
    enabled: true,
    // 1. 标准的24小时制时间格式 (20|21|22|23|[0-1]\d):[0-5]\d:[0-5]\d
    // 2. 日期+时间格式 [1-9]\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])\s+(20|21|22|23|[0-1]\d):[0-5]\d:[0-5]\d
    // 3. 保留简单日期格式 \d{4}-\d{2}-\d{2}
    pattern:
      "\\b(20|21|22|23|[0-1]\\d):[0-5]\\d:[0-5]\\d\\b|\\b[1-9]\\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])\\s+(20|21|22|23|[0-1]\\d):[0-5]\\d:[0-5]\\d\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b",
    flags: "g",
    style: `color: ${HIGHLIGHT_COLORS.timestamp};`,
  },
  // 添加告警信息匹配
  {
    id: "alertPatterns",
    type: "regex",
    name: "Alert Patterns",
    enabled: true,
    pattern:
      "(?:\\b(?:ALERT|ATTENTION|CAUTION|DANGER|EMERGENCY|ERROR|FAILURE|FAILED|FATAL|INVALID|WARNING|WARN)\\b)",
    flags: "gi", // 不区分大小写
    style: `color: ${HIGHLIGHT_COLORS.error}; font-weight: bold;`,
  },
  // 添加超链接高亮规则
  {
    id: "hyperlink",
    type: "regex",
    name: "Hyperlink Pattern",
    enabled: true,
    pattern:
      "(?:https?|ftp|file)://[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]|www\\.[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]",
    flags: "gi", // 不区分大小写
    style: `color: ${HIGHLIGHT_COLORS.hyperlink}; text-decoration: underline;`,
  },
  // 添加MAC地址高亮规则
  {
    id: "macAddress",
    type: "regex",
    name: "MAC Address Pattern",
    enabled: true,
    pattern: "\\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\\b",
    flags: "gi", // 不区分大小写
    style: `color: ${HIGHLIGHT_COLORS.macAddress};`,
  },
  // 添加状态码高亮规则
  {
    id: "statusCode",
    type: "regex",
    name: "Status Code Pattern",
    enabled: true,
    // 匹配HTTP状态码和常见退出码
    pattern:
      "\\b(?:status(?:\\s+code)?[:=]?\\s*|HTTP[/\\\\]\\d\\.\\d\\s+)(\\d{3})\\b|\\bexit(?:ed)?\\s+code:?\\s*(\\d+)\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.statusCode};`,
  },
  // 添加Docker ID高亮规则
  {
    id: "dockerId",
    type: "regex",
    name: "Docker ID Pattern",
    enabled: true,
    pattern: "\\b[0-9a-f]{12}\\b|\\b[0-9a-f]{64}\\b",
    flags: "gi", // 添加'i'标志以不区分大小写
    style: `color: ${HIGHLIGHT_COLORS.dockerId};`,
  },
  {
    id: "generalKeywords",
    type: "keyword",
    name: "General Keywords",
    enabled: true,
    items: {
      error: HIGHLIGHT_COLORS.error,
      warning: HIGHLIGHT_COLORS.warning,
      warn: HIGHLIGHT_COLORS.warning,
      info: HIGHLIGHT_COLORS.info,
      success: HIGHLIGHT_COLORS.success,
      debug: HIGHLIGHT_COLORS.debug,
      failed: HIGHLIGHT_COLORS.error,
      passed: HIGHLIGHT_COLORS.success,
      ok: HIGHLIGHT_COLORS.success,
      true: HIGHLIGHT_COLORS.success,
      false: HIGHLIGHT_COLORS.error,
      null: HIGHLIGHT_COLORS.debug,
      undefined: HIGHLIGHT_COLORS.debug,
      get: HIGHLIGHT_COLORS.commandKeyword,
      post: HIGHLIGHT_COLORS.commandKeyword,
      put: HIGHLIGHT_COLORS.commandKeyword,
      delete: HIGHLIGHT_COLORS.commandKeyword,
      patch: HIGHLIGHT_COLORS.commandKeyword,
      options: HIGHLIGHT_COLORS.commandKeyword,
      head: HIGHLIGHT_COLORS.commandKeyword,
      crit: HIGHLIGHT_COLORS.criticalKeyword,
      critical: HIGHLIGHT_COLORS.criticalKeyword,
      fatal: HIGHLIGHT_COLORS.error,
      alert: HIGHLIGHT_COLORS.alertKeyword,
      emergency: HIGHLIGHT_COLORS.criticalKeyword,
    },
  },
];
