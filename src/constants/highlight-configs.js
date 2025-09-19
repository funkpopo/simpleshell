// src/constants/highlight-configs.js
const HIGHLIGHT_COLORS = {
  // 统一在这里维护颜色，便于复用和批量调整
  defaultText: "inherit", // 终端默认颜色
  error: "red",
  warning: "orange",
  success: "green",
  info: "blue",
  debug: "purple",
  ipAddress: "cyan",
  alertKeyword: "magenta",
  criticalKeyword: "#FF6347", // Tomato 色
  commandKeyword: "#61affe",
  timestamp: "#61affe",
  hyperlink: "#4682B4",
  macAddress: "#98FB98",
  envVariable: "#20B2AA",
  statusCode: "#FF7F50",
  dockerId: "#5F9EA0",
  filePath: "#DDA0DD",
  processId: "#50e3c2",
  portNumber: "#FFD700",
  uuid: "#49cc90",
};

module.exports = [
  {
    id: "ipv4",
    type: "regex",
    name: "IPv4 Address",
    enabled: true,
    // 支持携带端口或 CIDR 的 IPv4 地址
    pattern: "\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}(?::\\d{1,5})?(?:/\\d{1,2})?\\b",
    flags: "g",
    style: `color: ${HIGHLIGHT_COLORS.ipAddress};`,
  },
  {
    id: "ipv6",
    type: "regex",
    name: "IPv6 Address",
    enabled: true,
    // 优化 IPv6 正则表达式，支持多种格式的 IPv6 地址
    pattern:
      "\\b(?:(?:[0-9A-Fa-f]{1,4}:){6}(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|::(?:[0-9A-Fa-f]{1,4}:){0,4}(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}):(?::[0-9A-Fa-f]{1,4}){0,3}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){2}(?::[0-9A-Fa-f]{1,4}){0,2}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){3}(?::[0-9A-Fa-f]{1,4}){1,2}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){4}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|:(?::(?:[0-9A-Fa-f]{1,4})){1,6}|::|[0-9A-Fa-f]{1,4}:(?::(?:[0-9A-Fa-f]{1,4})){1,5}|(?:[0-9A-Fa-f]{1,4}:){2}(?::(?:[0-9A-Fa-f]{1,4})){1,4}|(?:[0-9A-Fa-f]{1,4}:){3}(?::(?:[0-9A-Fa-f]{1,4})){1,3}|(?:[0-9A-Fa-f]{1,4}:){4}(?::(?:[0-9A-Fa-f]{1,4})){1,2}|(?:[0-9A-Fa-f]{1,4}:){5}:(?:[0-9A-Fa-f]{1,4})?|(?:[0-9A-Fa-f]{1,4}:){6}:)\\b",
    flags: "gi", // global, case-insensitive
    style: `color: ${HIGHLIGHT_COLORS.ipAddress};`,
  },
  // 时间戳匹配
  {
    id: "timeStamp",
    type: "regex",
    name: "Timestamp Pattern",
    enabled: true,
    // 1. 标准 24 小时制时间格式
    // 2. 带日期的时间格式
    // 3. 简单日期格式
    pattern:
      "\\b(20|21|22|23|[0-1]\\d):[0-5]\\d:[0-5]\\d\\b|\\b[1-9]\\d{3}-(0[1-9]|1[0-2])-(0[1-9]|[1-2][0-9]|3[0-1])\\s+(20|21|22|23|[0-1]\\d):[0-5]\\d:[0-5]\\d\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b",
    flags: "g",
    style: `color: ${HIGHLIGHT_COLORS.timestamp};`,
  },
  // 告警类关键字高亮
  {
    id: "alertPatterns",
    type: "regex",
    name: "Alert Patterns",
    enabled: true,
    pattern:
      "(?:\\b(?:ALERT|ATTENTION|CAUTION|DANGER|EMERGENCY|ERROR|FAILURE|FAILED|FATAL|INVALID|WARNING|WARN)\\b)",
    flags: "gi", // 忽略大小写
    style: `color: ${HIGHLIGHT_COLORS.error}; font-weight: bold;`,
  },
  // 超链接高亮
  {
    id: "hyperlink",
    type: "regex",
    name: "Hyperlink Pattern",
    enabled: true,
    pattern:
      "(?:https?|ftp|file)://[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]|www\\.[-A-Za-z0-9+&@#/%?=~_|!:,.;]+[-A-Za-z0-9+&@#/%=~_|]",
    flags: "gi", // 忽略大小写
    style: `color: ${HIGHLIGHT_COLORS.hyperlink}; text-decoration: underline;`,
  },
  // MAC 地址高亮
  {
    id: "macAddress",
    type: "regex",
    name: "MAC Address Pattern",
    enabled: true,
    pattern: "\\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\\b",
    flags: "gi", // 忽略大小写
    style: `color: ${HIGHLIGHT_COLORS.macAddress};`,
  },
  // 状态码高亮
  {
    id: "statusCode",
    type: "regex",
    name: "Status Code Pattern",
    enabled: true,
    pattern:
      "\\b(?:status(?:\\s+code)?[:=]?\\s*|HTTP[/\\\\]\\d\\.\\d\\s+)(\\d{3})\\b|\\bexit(?:ed)?\\s+code:?\\s*(\\d+)\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.statusCode};`,
  },
  // Docker ID 高亮
  {
    id: "dockerId",
    type: "regex",
    name: "Docker ID Pattern",
    enabled: true,
    pattern: "\\b[0-9a-f]{12}\\b|\\b[0-9a-f]{64}\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.dockerId};`,
  },
  // Unix 路径高亮，使用捕获组避免吞掉前缀字符
  {
    id: "unixFilePath",
    type: "regex",
    name: "Unix File Path",
    enabled: true,
    pattern: "([\\s'\"(=]|^)((?:~|\\.\\.?|/)[^\\s\\x1b\"')]+)",
    flags: "gm",
    style: `color: ${HIGHLIGHT_COLORS.filePath};`,
    groupIndex: 2,
  },
  // Windows 路径高亮
  {
    id: "windowsFilePath",
    type: "regex",
    name: "Windows File Path",
    enabled: true,
    pattern: "([\\s'\"(=]|^)((?:[A-Za-z]:\\\\|\\\\\\\\)[^\\s\"')]+)",
    flags: "gm",
    style: `color: ${HIGHLIGHT_COLORS.filePath};`,
    groupIndex: 2,
  },
  // 环境变量赋值（行首）
  {
    id: "envAssignmentLineStart",
    type: "regex",
    name: "Environment Assignment (line start)",
    enabled: true,
    pattern:
      "^([A-Z_][A-Z0-9_]*)=(?:\"[^\"\\r\\n]*\"|'[^'\\r\\n]*'|[^\\s;\"']+)",
    flags: "gm",
    style: `color: ${HIGHLIGHT_COLORS.envVariable};`,
  },
  // 环境变量赋值（行内）
  {
    id: "envAssignmentInline",
    type: "regex",
    name: "Environment Assignment (inline)",
    enabled: true,
    pattern:
      "([\\s'\"(])([A-Z_][A-Z0-9_]*)=(?:\"[^\"\\r\\n]*\"|'[^'\\r\\n]*'|[^\\s;\"']+)",
    flags: "gm",
    style: `color: ${HIGHLIGHT_COLORS.envVariable};`,
    groupIndex: 2,
  },
  // 常见端口与监听描述
  {
    id: "portNumbers",
    type: "regex",
    name: "Port Numbers",
    enabled: true,
    pattern:
      "\\b(?:port|listen(?:ing)?(?:\\s+on)?|bound\\s+to|listening\\s+at|exposed\\s+port)[:=]?\\s*(\\d{2,5})\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.portNumber}; font-weight: bold;`,
    groupIndex: 1,
  },
  // 进程 ID / PID 捕获
  {
    id: "processId",
    type: "regex",
    name: "Process Identifier",
    enabled: true,
    pattern: "\\b(?:pid|process(?:\\s+id)?|ppid)[:=\\s#]*(\\d{2,})\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.processId}; font-weight: bold;`,
    groupIndex: 1,
  },
  // UUID 高亮
  {
    id: "uuid",
    type: "regex",
    name: "UUID Pattern",
    enabled: true,
    pattern: "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\\b",
    flags: "g",
    style: `color: ${HIGHLIGHT_COLORS.uuid};`,
  },
  // Git 提交哈希
  {
    id: "gitCommit",
    type: "regex",
    name: "Git Commit Hash",
    enabled: true,
    pattern: "\\b[0-9a-f]{7,40}\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.uuid};`,
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
      notice: HIGHLIGHT_COLORS.info,
      trace: HIGHLIGHT_COLORS.debug,
      panic: HIGHLIGHT_COLORS.error,
      connected: HIGHLIGHT_COLORS.success,
      connecting: HIGHLIGHT_COLORS.info,
      disconnected: HIGHLIGHT_COLORS.warning,
      reconnect: HIGHLIGHT_COLORS.warning,
      offline: HIGHLIGHT_COLORS.warning,
      online: HIGHLIGHT_COLORS.success,
      listening: HIGHLIGHT_COLORS.info,
      timeout: HIGHLIGHT_COLORS.warning,
      timedout: HIGHLIGHT_COLORS.warning,
      expired: HIGHLIGHT_COLORS.warning,
      retry: HIGHLIGHT_COLORS.warning,
      retries: HIGHLIGHT_COLORS.warning,
      denied: HIGHLIGHT_COLORS.error,
      forbidden: HIGHLIGHT_COLORS.error,
      refused: HIGHLIGHT_COLORS.error,
      unreachable: HIGHLIGHT_COLORS.error,
      killed: HIGHLIGHT_COLORS.error,
      terminated: HIGHLIGHT_COLORS.error,
      crashed: HIGHLIGHT_COLORS.error,
      restart: HIGHLIGHT_COLORS.warning,
      restarting: HIGHLIGHT_COLORS.warning,
      started: HIGHLIGHT_COLORS.success,
      starting: HIGHLIGHT_COLORS.info,
      stopped: HIGHLIGHT_COLORS.warning,
      stopping: HIGHLIGHT_COLORS.warning,
      ready: HIGHLIGHT_COLORS.success,
      pending: HIGHLIGHT_COLORS.warning,
      healthy: HIGHLIGHT_COLORS.success,
      unhealthy: HIGHLIGHT_COLORS.warning,
      degraded: HIGHLIGHT_COLORS.warning,
    },
  },
];

