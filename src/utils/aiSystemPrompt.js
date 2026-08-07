/**
 * AI助手系统提示词模块
 * 提供运维助手的专业提示词和命令风险评估逻辑
 *
 * 系统提示词与记忆上下文文案来自 i18n locales：
 * - ai.systemPrompt.*
 * - ai.memoryContext.*
 */

import i18n from "../i18n/i18n";

const normalizePromptLanguage = (language) => {
  if (typeof language !== "string" || !language.trim()) {
    return "zh-CN";
  }
  const lower = language.trim().toLowerCase();
  if (lower === "zh" || lower.startsWith("zh-")) {
    return "zh-CN";
  }
  if (lower === "en" || lower.startsWith("en-")) {
    return "en-US";
  }
  return "zh-CN";
};

/**
 * Create a language-scoped translator. Implementation uses getFixedT so the
 * internal call is not flagged as a dynamic i18n.t(key) by check-i18n; call
 * sites must still use static t("...") string literals.
 */
const createPromptT = (lng) => {
  const fixedT = i18n.getFixedT(lng);
  return (key, params = {}) => fixedT(key, params);
};

// 命令风险等级定义
export const RISK_LEVELS = {
  SAFE: {
    level: 1,
    name: "safe",
    color: "#4caf50",
  },
  LOW: {
    level: 2,
    name: "low",
    color: "#8bc34a",
  },
  MEDIUM: {
    level: 3,
    name: "medium",
    color: "#ff9800",
  },
  HIGH: {
    level: 4,
    name: "high",
    color: "#f44336",
  },
  CRITICAL: {
    level: 5,
    name: "critical",
    color: "#9c27b0",
  },
};

const RISK_LEVEL_ORDER = ["critical", "high", "medium", "low"];
const CUSTOM_RULE_LEVELS = ["critical", "high", "medium", "low"];
const MAX_CUSTOM_RULES_PER_LEVEL = 50;
const MAX_CUSTOM_RULE_PATTERN_LENGTH = 200;

const hasNestedQuantifier = (pattern) =>
  /\((?:[^()\\]|\\.|\[[^\]]*\])*(?:[+*]|\{\d+(?:,\d*)?\})(?:[^()\\]|\\.|\[[^\]]*\])*\)(?:[+*]|\{\d+(?:,\d*)?\})/.test(
    pattern,
  );

const hasRepeatedWildcard = (pattern) => /(?:\.\*){2,}/.test(pattern);

const hasControlCharacter = (pattern) => /[\u0000-\u001f\u007f]/.test(pattern);

const getRiskLevelByName = (riskName) => {
  const normalizedName = String(riskName || "").toLowerCase();
  return (
    Object.values(RISK_LEVELS).find((risk) => risk.name === normalizedName) ||
    RISK_LEVELS.SAFE
  );
};

const maxRiskLevel = (firstRisk, secondRisk) =>
  (firstRisk?.level || 0) >= (secondRisk?.level || 0) ? firstRisk : secondRisk;

const findMatchingRiskLevel = (patternsByLevel, command) => {
  for (const level of RISK_LEVEL_ORDER) {
    for (const pattern of patternsByLevel[level] || []) {
      if (pattern.test(command)) {
        return getRiskLevelByName(level);
      }
    }
  }

  return RISK_LEVELS.SAFE;
};

// 危险命令模式 - 用于风险评估
const DANGEROUS_PATTERNS = {
  // 极高风险 - 可能导致系统不可用
  critical: [
    /\brm\b(?=[^;&|\n]*\s(?:-[\w-]*r[\w-]*|--recursive\b))(?=[^;&|\n]*\s(?:-[\w-]*f[\w-]*|--force\b))[^;&|\n]*(?:\s|^)(?:\/|\/\*|--no-preserve-root\b)(?:\s|$)/i, // rm -rf /, rm -fr /*
    /\brm\b[^;&|\n]*--no-preserve-root\b/i, // 显式禁用根目录保护
    /\bmkfs(?:\.\w+)?\s+/i, // 格式化文件系统
    /\bdd\b[^;&|\n]*\bof=\/dev\/(?:[sh]d[a-z]|nvme\d+n\d+|mapper\/\S+)/i, // 直接写磁盘
    /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;?\s*:/i, // fork bomb
    />\s*\/dev\/(?:[sh]d[a-z]|nvme\d+n\d+|mapper\/\S+)/i, // 覆盖磁盘
    /\bshutdown\b[^;&|\n]*(?:\bnow\b|-h|-r)/i, // 立即关机/重启
    /\breboot\b/i, // 立即重启
    /\binit\s+0\b/i, // 关机
    /\bhalt\b/i, // 停机
    /\bpoweroff\b/i, // 关机
  ],
  // 高风险 - 可能导致服务中断或数据丢失
  high: [
    /\brm\b(?=[^;&|\n]*\s(?:-[\w-]*r[\w-]*|--recursive\b))/i, // 递归删除
    /\brm\b(?=[^;&|\n]*\s(?:-[\w-]*f[\w-]*|--force\b))/i, // 强制删除
    /\brm\b[^;&|\n]*\*/i, // 通配符删除
    /\bchmod\b\s+(?:-[\w-]*R[\w-]*|--recursive)\s+(?:777|000)\b/i, // 递归修改为危险权限
    /\bchown\b\s+(?:-[\w-]*R[\w-]*|--recursive)\b/i, // 递归修改所有者
    /\b(?:kill|pkill)\b\s+-9\b/i, // 强制杀进程
    /\bkillall\b/i, // 杀死所有同名进程
    /\bsystemctl\b\s+(?:stop|disable|mask)\b/i, // 停止服务
    /\bservice\b\s+\S+\s+stop\b/i, // 停止服务
    /\b(?:iptables|ip6tables|nft)\b[^;&|\n]*(?:\s-F\b|\s-X\b|\bflush\b)/i, // 清空防火墙规则
    /\b(?:DROP|REJECT)\b/i, // 防火墙丢弃规则
    /\bshutdown\b/i, // 关机
    /\buserdel\b/i, // 删除用户
    /\bgroupdel\b/i, // 删除组
    /\bpasswd\s+root\b/i, // 修改root密码
    /\bvisudo\b/i, // 编辑sudo配置
    /\bcrontab\s+-r\b/i, // 删除定时任务
    /\btruncate\b/i, // 截断文件
    /\bshred\b/i, // 安全删除
    /\b(?:curl|wget)\b[^;&\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|fish)\b/i, // 下载后直接执行
    /\b(?:bash|sh|zsh|fish)\b\s+-c\s+["']?\$?\((?:curl|wget)\b/i, // 通过 shell 执行下载内容
  ],
  // 中风险 - 可能影响服务或数据
  medium: [
    /\bmv\s+/i, // 移动文件
    /\bcp\b\s+(?:-[\w-]*r[\w-]*|--recursive)\b/i, // 递归复制
    /\bchmod\s+/i, // 修改权限
    /\bchown\s+/i, // 修改所有者
    /\bchgrp\s+/i, // 修改用户组
    /\bsystemctl\s+(?:restart|reload)\b/i, // 重启/重载服务
    /\bservice\s+\S+\s+(?:restart|reload)\b/i, // 重启/重载服务
    /apt(-get)?\s+(remove|purge|autoremove)/i, // 卸载软件
    /yum\s+(remove|erase)/i, // 卸载软件
    /dnf\s+(remove|erase)/i, // 卸载软件
    /pip\s+uninstall/i, // 卸载Python包
    /npm\s+uninstall/i, // 卸载npm包
    /\bdocker\s+(?:rm|rmi|stop|kill|prune)\b/i, // Docker容器/镜像操作
    /\bkubectl\s+(?:delete|replace|apply)\b/i, // K8s修改资源
    /\bgit\s+(?:reset|revert|clean)\b/i, // Git重置操作
    /\bmysql\b[^;&|\n]*\bDROP\b/i, // 数据库删除
    /\bpsql\b[^;&|\n]*\bDROP\b/i, // PostgreSQL删除
    /\bmongo\b[^;&|\n]*\bdrop\b/i, // MongoDB删除
    /\bsed\s+-[\w-]*i[\w-]*/i, // 原地编辑文件
    /\bawk\s+-i\s+inplace\b/i, // 原地编辑
    />\s+[^|]/i, // 文件重定向覆盖
    /\bwget\b[^;&|\n]*\s-O\s+/i, // wget覆盖文件
    /\bcurl\b[^;&|\n]*\s-o\s+/i, // curl覆盖文件
  ],
  // 低风险 - 轻微修改
  low: [
    /\btouch\s+/i, // 创建文件
    /\bmkdir\s+/i, // 创建目录
    /echo\s+.*>>/i, // 追加内容
    /tee\s+-a/i, // 追加内容
    /apt(-get)?\s+install/i, // 安装软件
    /yum\s+install/i, // 安装软件
    /dnf\s+install/i, // 安装软件
    /pip\s+install/i, // 安装Python包
    /npm\s+install/i, // 安装npm包
    /docker\s+pull/i, // 拉取镜像
    /git\s+(clone|pull|fetch)/i, // Git拉取
    /systemctl\s+start/i, // 启动服务
    /systemctl\s+enable/i, // 启用服务
    /crontab\s+-e/i, // 编辑定时任务
  ],
};

// 自定义规则存储（从设置中加载）
let customRules = {
  critical: [],
  high: [],
  medium: [],
  low: [],
};

export function validateCustomRiskPattern(pattern) {
  const normalizedPattern = typeof pattern === "string" ? pattern.trim() : "";

  if (!normalizedPattern) {
    return { valid: false, reason: "empty" };
  }

  if (normalizedPattern.length > MAX_CUSTOM_RULE_PATTERN_LENGTH) {
    return { valid: false, reason: "tooLong" };
  }

  if (hasControlCharacter(normalizedPattern)) {
    return { valid: false, reason: "controlCharacter" };
  }

  if (
    hasNestedQuantifier(normalizedPattern) ||
    hasRepeatedWildcard(normalizedPattern)
  ) {
    return { valid: false, reason: "unsafeComplexity" };
  }

  try {
    new RegExp(normalizedPattern, "i");
  } catch {
    return { valid: false, reason: "syntax" };
  }

  return { valid: true, pattern: normalizedPattern };
}

export function normalizeCustomRiskRules(rules) {
  const normalizedRules = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  if (!rules || typeof rules !== "object") {
    return normalizedRules;
  }

  for (const level of CUSTOM_RULE_LEVELS) {
    const patterns = Array.isArray(rules[level]) ? rules[level] : [];
    const seenPatterns = new Set();

    for (const rawPattern of patterns) {
      if (normalizedRules[level].length >= MAX_CUSTOM_RULES_PER_LEVEL) {
        break;
      }

      const validation = validateCustomRiskPattern(rawPattern);
      if (!validation.valid || seenPatterns.has(validation.pattern)) {
        continue;
      }

      seenPatterns.add(validation.pattern);
      normalizedRules[level].push(validation.pattern);
    }
  }

  return normalizedRules;
}

/**
 * 设置自定义风险评估规则
 * @param {Object} rules - 自定义规则对象
 */
export function setCustomRiskRules(rules) {
  if (!rules || typeof rules !== "object") {
    return;
  }

  const normalizedRules = normalizeCustomRiskRules(rules);
  customRules = Object.fromEntries(
    CUSTOM_RULE_LEVELS.map((level) => [
      level,
      normalizedRules[level].map((pattern) => new RegExp(pattern, "i")),
    ]),
  );
}

/**
 * 获取内置风险规则模式（用于UI展示）
 * @returns {Object} 内置规则模式字符串
 */
export function getBuiltinRiskPatterns() {
  return {
    critical: DANGEROUS_PATTERNS.critical.map((r) => r.source),
    high: DANGEROUS_PATTERNS.high.map((r) => r.source),
    medium: DANGEROUS_PATTERNS.medium.map((r) => r.source),
    low: DANGEROUS_PATTERNS.low.map((r) => r.source),
  };
}

/**
 * 评估单个命令的风险等级
 * @param {string} command - 要评估的命令
 * @returns {Object} 风险等级对象
 */
function assessCommandRisk(command) {
  if (!command || typeof command !== "string") {
    return RISK_LEVELS.SAFE;
  }

  const normalizedCommand = command.trim();

  const customRiskLevel = findMatchingRiskLevel(customRules, normalizedCommand);
  const builtinRiskLevel = findMatchingRiskLevel(
    DANGEROUS_PATTERNS,
    normalizedCommand,
  );

  return maxRiskLevel(customRiskLevel, builtinRiskLevel);
}

/**
 * Build connection environment line for the system prompt.
 * @param {(key: string, params?: object) => string} t
 * @param {Object|null} connectionInfo
 * @returns {string}
 */
function buildConnectionContext(t, connectionInfo) {
  if (!connectionInfo) {
    return t("ai.systemPrompt.environment.noConnection");
  }

  return t("ai.systemPrompt.environment.withConnection", {
    host: connectionInfo.host || t("ai.systemPrompt.environment.unknownHost"),
    type: connectionInfo.type || t("ai.systemPrompt.environment.defaultType"),
  });
}

/**
 * 生成运维助手系统提示词（文案来自 ai.systemPrompt.* locale keys）
 * @param {Object} options - 配置选项
 * @param {string} options.language - 语言 ('zh-CN' 或 'en-US')
 * @param {Object} options.connectionInfo - 当前连接信息
 * @returns {string} 系统提示词
 */
export function generateSystemPrompt(options = {}) {
  const { language = "zh-CN", connectionInfo = null } = options;
  const lng = normalizePromptLanguage(language);
  const t = createPromptT(lng);

  const connectionContext = buildConnectionContext(t, connectionInfo);
  const riskPlaceholder = t(
    "ai.systemPrompt.commandFormat.templateRiskPlaceholder",
  );
  const commandPlaceholder = t(
    "ai.systemPrompt.commandFormat.templateCommandPlaceholder",
  );
  const cmdTemplate = `<cmd risk="${riskPlaceholder}">${commandPlaceholder}</cmd>`;

  return [
    t("ai.systemPrompt.role"),
    "",
    t("ai.systemPrompt.environment.header"),
    connectionContext,
    "",
    t("ai.systemPrompt.responsibilities.header"),
    t("ai.systemPrompt.responsibilities.logAnalysis"),
    t("ai.systemPrompt.responsibilities.commandSuggestions"),
    t("ai.systemPrompt.responsibilities.troubleshooting"),
    t("ai.systemPrompt.responsibilities.security"),
    t("ai.systemPrompt.responsibilities.performance"),
    "",
    t("ai.systemPrompt.commandFormat.header"),
    "",
    t("ai.systemPrompt.commandFormat.intro"),
    "",
    "```",
    cmdTemplate,
    "```",
    "",
    t("ai.systemPrompt.commandFormat.riskHeader"),
    t("ai.systemPrompt.commandFormat.riskSafe"),
    t("ai.systemPrompt.commandFormat.riskLow"),
    t("ai.systemPrompt.commandFormat.riskMedium"),
    t("ai.systemPrompt.commandFormat.riskHigh"),
    t("ai.systemPrompt.commandFormat.riskCritical"),
    "",
    t("ai.systemPrompt.commandFormat.examplesHeader"),
    t("ai.systemPrompt.commandFormat.exampleViewProcesses"),
    t("ai.systemPrompt.commandFormat.exampleRestartService"),
    t("ai.systemPrompt.commandFormat.exampleDeleteFiles"),
    "",
    t("ai.systemPrompt.guidelines.header"),
    t("ai.systemPrompt.guidelines.concise"),
    t("ai.systemPrompt.guidelines.wrapCommands"),
    t("ai.systemPrompt.guidelines.warnHighRisk"),
    t("ai.systemPrompt.guidelines.explainCommands"),
    t("ai.systemPrompt.guidelines.multiStepOrder"),
    "",
    t("ai.systemPrompt.capabilities.header"),
    t("ai.systemPrompt.capabilities.logFormats"),
    t("ai.systemPrompt.capabilities.errorPatterns"),
    t("ai.systemPrompt.capabilities.securityPractices"),
  ].join("\n");
}

/**
 * 生成历史记忆上下文（文案来自 ai.memoryContext.* locale keys）
 * @param {Object} memory
 * @param {string} language
 * @returns {string}
 */
export function generateMemoryContext(memory, language = "zh-CN") {
  if (!memory) {
    return "";
  }

  const lng = normalizePromptLanguage(language);
  const t = createPromptT(lng);
  const joiner = t("ai.memoryContext.listJoiner");
  const none = t("ai.memoryContext.none");
  const keyPoints = Array.isArray(memory.keyPoints)
    ? memory.keyPoints.join(joiner)
    : "";
  const pendingTasks = Array.isArray(memory.pendingTasks)
    ? memory.pendingTasks.join(joiner)
    : "";

  const lines = [
    t("ai.memoryContext.header", { timestamp: memory.timestamp }),
    t("ai.memoryContext.summaryLine", { summary: memory.summary || "" }),
    t("ai.memoryContext.keyPointsLine", {
      points: keyPoints || none,
    }),
  ];

  if (pendingTasks) {
    lines.push(
      t("ai.memoryContext.pendingLine", {
        tasks: pendingTasks,
      }),
    );
  }

  lines.push("", "");
  return lines.join("\n");
}

/**
 * 从AI响应中解析命令块
 * @param {string} content - AI响应内容
 * @returns {Array<{command: string, risk: Object, index: number, length: number}>} 命令数组
 */
export function parseCommandsFromResponse(content) {
  if (!content || typeof content !== "string") {
    return [];
  }

  const commands = [];
  // 匹配 <cmd risk="xxx">命令</cmd> 格式
  const cmdRegex = /<cmd\s+risk="(\w+)">([\s\S]*?)<\/cmd>/gi;
  let match;

  while ((match = cmdRegex.exec(content)) !== null) {
    const riskName = match[1].toLowerCase();
    const command = match[2].trim();

    const taggedRiskLevel = getRiskLevelByName(riskName);
    const assessedRiskLevel = assessCommandRisk(command);
    const riskLevel = maxRiskLevel(taggedRiskLevel, assessedRiskLevel);

    commands.push({
      command,
      risk: riskLevel,
      index: match.index,
      length: match[0].length,
      originalMatch: match[0],
    });
  }

  return commands;
}

/**
 * 检查命令是否需要确认
 * @param {Object} risk - 风险等级对象
 * @returns {boolean} 是否需要确认
 */
export function requiresConfirmation(risk) {
  return risk && risk.level >= RISK_LEVELS.HIGH.level;
}

export default {
  RISK_LEVELS,
  assessCommandRisk,
  generateSystemPrompt,
  generateMemoryContext,
  parseCommandsFromResponse,
  requiresConfirmation,
  setCustomRiskRules,
  getBuiltinRiskPatterns,
  normalizeCustomRiskRules,
  validateCustomRiskPattern,
};
