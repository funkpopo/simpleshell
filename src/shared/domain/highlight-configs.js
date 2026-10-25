// src/shared/domain/highlight-configs.js
const HIGHLIGHT_COLORS = {
  // 现代化配色方案 - 提高可读性和对比度
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
    // 预筛：需要 "." 与数字
    requires: { anyChar: ".", digit: true },
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
    // 预筛：所有分支都包含 "::" 或连续 6 组 "h{1,4}:"
    requires: { ipv6Shape: true },
    type: "regex",
    name: "IPv6 Address",
    enabled: true,
    // 优化 IPv6 正则表达式，支持多种格式的 IPv6 地址。
    // 所有分支开头都含两个间隔不超过 4 位十六进制的冒号；先用前瞻排除，
    // 避免在每个单词边界逐一尝试全部分支（无匹配的大量输出也会扫描整段）。
    pattern:
      "\\b(?=[0-9A-Fa-f]{0,4}:[0-9A-Fa-f]{0,4}:)(?:(?:[0-9A-Fa-f]{1,4}:){6}(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|::(?:[0-9A-Fa-f]{1,4}:){0,4}(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}):(?::[0-9A-Fa-f]{1,4}){0,3}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){2}(?::[0-9A-Fa-f]{1,4}){0,2}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){3}(?::[0-9A-Fa-f]{1,4}){1,2}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){4}:(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)|(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|:(?::(?:[0-9A-Fa-f]{1,4})){1,6}|::|[0-9A-Fa-f]{1,4}:(?::(?:[0-9A-Fa-f]{1,4})){1,5}|(?:[0-9A-Fa-f]{1,4}:){2}(?::(?:[0-9A-Fa-f]{1,4})){1,4}|(?:[0-9A-Fa-f]{1,4}:){3}(?::(?:[0-9A-Fa-f]{1,4})){1,3}|(?:[0-9A-Fa-f]{1,4}:){4}(?::(?:[0-9A-Fa-f]{1,4})){1,2}|(?:[0-9A-Fa-f]{1,4}:){5}:(?:[0-9A-Fa-f]{1,4})?|(?:[0-9A-Fa-f]{1,4}:){6}:)\\b",
    flags: "gi", // global, case-insensitive
    style: `color: ${HIGHLIGHT_COLORS.ipAddress};`,
  },
  // 时间戳匹配
  {
    id: "timeStamp",
    // 预筛：需要 ":" 或 "-" 与数字
    requires: { anyChar: ":-", digit: true },
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
    // 预筛："://" 或 "www." 必含 ":" 或 "."
    requires: { anyChar: ":." },
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
    // 预筛：连续 5 组 "hh:" / "hh-"
    requires: { macShape: true },
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
    // 预筛：状态码必含数字
    requires: { digit: true },
    type: "regex",
    name: "Status Code Pattern",
    enabled: true,
    pattern:
      "\\b(?:status(?:\\s+code)?[:=]?\\s*|HTTP[/\\\\]\\d\\.\\d\\s+)(\\d{3})\\b|\\bexit(?:ed)?\\s+code:?\\s*(\\d+)\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.statusCode};`,
  },
  // 访问日志状态码补充（例如 Nginx/Apache）
  {
    id: "accessLogStatusCode",
    // 预筛：需要 '"' 与数字
    requires: { anyChar: '"', digit: true },
    type: "regex",
    name: "Access Log Status Code",
    enabled: true,
    pattern: '"\\s([1-5]\\d{2})\\s\\d+\\b',
    flags: "g",
    style: `color: ${HIGHLIGHT_COLORS.statusCode}; font-weight: bold;`,
    groupIndex: 1,
  },
  // UUID 高亮：须排在 dockerId / gitCommit 之前，否则末段 12 位与首段 8 位
  // 十六进制会被这两条通用规则拆开着色，UUID 无法整体高亮
  {
    id: "uuid",
    // 预筛：8 个连续十六进制字符后紧跟 "-"
    requires: { hexRunBeforeDash: 8 },
    type: "regex",
    name: "UUID Pattern",
    enabled: true,
    pattern:
      "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\\b",
    flags: "g",
    style: `color: ${HIGHLIGHT_COLORS.uuid};`,
  },
  // Docker ID 高亮
  {
    id: "dockerId",
    // 预筛：至少 12 个连续十六进制字符
    requires: { hexRun: 12 },
    type: "regex",
    name: "Docker ID Pattern",
    enabled: true,
    pattern: "\\b[0-9a-f]{12}\\b|\\b[0-9a-f]{64}\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.dockerId};`,
  },
  // sha256 摘要补充（保留前缀仅高亮摘要体）
  {
    id: "sha256Digest",
    // 预筛：64 个连续十六进制字符
    requires: { hexRun: 64 },
    type: "regex",
    name: "SHA256 Digest",
    enabled: true,
    pattern: "\\bsha256:([0-9a-f]{64})\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.dockerId};`,
    groupIndex: 1,
  },
  // Unix 路径高亮，使用捕获组避免吞掉前缀字符
  {
    id: "unixFilePath",
    // 预筛：路径以 "~"、"." 或 "/" 开头
    requires: { anyChar: "~./" },
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
    // 预筛：需要反斜杠
    requires: { anyChar: "\\" },
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
    // 预筛：区分大小写，"=" 前一字符必为 [A-Z0-9_]
    requires: { upperAssign: true },
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
    // 预筛：区分大小写，"=" 前一字符必为 [A-Z0-9_]
    requires: { upperAssign: true },
    type: "regex",
    name: "Environment Assignment (inline)",
    enabled: true,
    pattern:
      "([\\s'\"(])([A-Z_][A-Z0-9_]*)=(?:\"[^\"\\r\\n]*\"|'[^'\\r\\n]*'|[^\\s;\"']+)",
    flags: "gm",
    style: `color: ${HIGHLIGHT_COLORS.envVariable};`,
    groupIndex: 2,
  },
  // 环境变量引用补充（例如 $PATH、${HOME}）
  {
    id: "envVariableReference",
    // 预筛：需要 "$"
    requires: { anyChar: "$" },
    type: "regex",
    name: "Environment Variable Reference",
    enabled: true,
    pattern:
      "(^|[^\\w$])(\\$(?:\\{[A-Z_][A-Z0-9_]*\\}|[A-Z_][A-Z0-9_]*))(?![A-Z0-9_])",
    flags: "g",
    style: `color: ${HIGHLIGHT_COLORS.envVariable};`,
    groupIndex: 2,
  },
  // 常见端口与监听描述
  {
    id: "portNumbers",
    // 预筛：端口号必含数字
    requires: { digit: true },
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
    // 预筛：PID 必含数字
    requires: { digit: true },
    type: "regex",
    name: "Process Identifier",
    enabled: true,
    pattern: "\\b(?:pid|process(?:\\s+id)?|ppid)[:=\\s#]*(\\d{2,})\\b",
    flags: "gi",
    style: `color: ${HIGHLIGHT_COLORS.processId}; font-weight: bold;`,
    groupIndex: 1,
  },
  // Git 提交哈希
  {
    id: "gitCommit",
    // 预筛：至少 7 个连续十六进制字符
    requires: { hexRun: 7 },
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
