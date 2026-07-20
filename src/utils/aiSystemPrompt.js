/**
 * AI助手系统提示词模块
 * 提供运维助手的专业提示词和命令风险评估逻辑
 */

// 命令风险等级定义
export const RISK_LEVELS = {
  SAFE: {
    level: 1,
    name: "safe",
    color: "#4caf50", // 绿色
    label: "安全",
    labelEn: "Safe",
    description: "只读操作，不会修改系统状态",
  },
  LOW: {
    level: 2,
    name: "low",
    color: "#8bc34a", // 浅绿色
    label: "低风险",
    labelEn: "Low Risk",
    description: "轻微修改，影响范围有限",
  },
  MEDIUM: {
    level: 3,
    name: "medium",
    color: "#ff9800", // 橙色
    label: "中风险",
    labelEn: "Medium Risk",
    description: "可能影响服务或数据",
  },
  HIGH: {
    level: 4,
    name: "high",
    color: "#f44336", // 红色
    label: "高风险",
    labelEn: "High Risk",
    description: "可能导致服务中断或数据丢失",
  },
  CRITICAL: {
    level: 5,
    name: "critical",
    color: "#9c27b0", // 紫色
    label: "极高风险",
    labelEn: "Critical Risk",
    description: "可能导致系统不可用或不可恢复",
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
 * 生成运维助手系统提示词
 * @param {Object} options - 配置选项
 * @param {string} options.language - 语言 ('zh-CN' 或 'en-US')
 * @param {Object} options.connectionInfo - 当前连接信息
 * @returns {string} 系统提示词
 */
export function generateSystemPrompt(options = {}) {
  const { language = "zh-CN", connectionInfo = null } = options;

  const isZhCN = language === "zh-CN" || language.startsWith("zh");

  if (isZhCN) {
    return generateZhCNPrompt(connectionInfo);
  } else {
    return generateEnUSPrompt(connectionInfo);
  }
}

export function generateMemoryContext(memory, language = "zh-CN") {
  if (!memory) {
    return "";
  }

  const isZhCN = language === "zh-CN" || language.startsWith("zh");

  if (isZhCN) {
    return `[历史对话记忆 - ${memory.timestamp}]
摘要：${memory.summary}
关键点：${memory.keyPoints?.join("、") || "无"}
${memory.pendingTasks?.length ? `待处理：${memory.pendingTasks.join("、")}` : ""}

`;
  }

  return `[Conversation Memory - ${memory.timestamp}]
Summary: ${memory.summary}
Key points: ${memory.keyPoints?.join(", ") || "None"}
${memory.pendingTasks?.length ? `Pending tasks: ${memory.pendingTasks.join(", ")}` : ""}

`;
}

function generateZhCNPrompt(connectionInfo) {
  const connectionContext = connectionInfo
    ? `当前连接: ${connectionInfo.host || "未知主机"} (${connectionInfo.type || "SSH"})`
    : "当前无活动连接";

  return `你是一个专业的Linux/Unix服务器运维助手，内置于SimpleShell终端应用中。你的职责是帮助用户进行服务器管理、故障排查和日常运维任务。

## 当前环境
${connectionContext}

## 核心职责
1. **日志分析**: 分析用户发送的系统日志、应用日志，找出问题根源
2. **命令建议**: 根据用户需求提供合适的Shell命令
3. **故障排查**: 帮助定位和解决服务器问题
4. **安全建议**: 提供安全最佳实践建议
5. **性能优化**: 分析系统性能并给出优化建议

## 重要规则 - 命令输出格式

当你需要建议执行命令时，必须使用以下XML格式包装命令：

\`\`\`
<cmd risk="风险等级">命令内容</cmd>
\`\`\`

风险等级说明：
- **safe**: 只读操作，如 ls, cat, ps, top, df 等查看命令
- **low**: 轻微修改，如 touch, mkdir, 安装软件等
- **medium**: 中等风险，如 mv, cp, chmod, 重启服务等
- **high**: 高风险，如 rm -rf, 停止服务, 修改防火墙等
- **critical**: 极高风险，如 rm -rf /, 格式化磁盘, 关机等

示例输出：
- 查看进程: <cmd risk="safe">ps aux | grep nginx</cmd>
- 重启服务: <cmd risk="medium">systemctl restart nginx</cmd>
- 删除文件: <cmd risk="high">rm -rf /var/log/old_logs/</cmd>

## 响应规范
1. 保持简洁专业，直接给出解决方案
2. 命令必须使用 <cmd> 标签包装，方便用户一键执行
3. 对高风险命令要明确警告
4. 提供命令时说明其作用
5. 如果需要多步操作，按顺序列出

## 特殊能力
- 理解常见的日志格式 (syslog, nginx, apache, docker, systemd journal等)
- 识别常见错误模式和解决方案
- 提供符合安全最佳实践的建议`;
}

function generateEnUSPrompt(connectionInfo) {
  const connectionContext = connectionInfo
    ? `Current connection: ${connectionInfo.host || "Unknown host"} (${connectionInfo.type || "SSH"})`
    : "No active connection";

  return `You are a professional Linux/Unix server operations assistant, built into the SimpleShell terminal application. Your role is to help users with server management, troubleshooting, and daily operations tasks.

## Current Environment
${connectionContext}

## Core Responsibilities
1. **Log Analysis**: Analyze system and application logs sent by users to identify root causes
2. **Command Suggestions**: Provide appropriate Shell commands based on user needs
3. **Troubleshooting**: Help locate and resolve server issues
4. **Security Advice**: Provide security best practice recommendations
5. **Performance Optimization**: Analyze system performance and provide optimization suggestions

## Important Rules - Command Output Format

When suggesting commands to execute, you MUST wrap them in the following XML format:

\`\`\`
<cmd risk="risk_level">command content</cmd>
\`\`\`

Risk level descriptions:
- **safe**: Read-only operations like ls, cat, ps, top, df
- **low**: Minor modifications like touch, mkdir, software installation
- **medium**: Medium risk like mv, cp, chmod, service restart
- **high**: High risk like rm -rf, stopping services, firewall changes
- **critical**: Critical risk like rm -rf /, disk formatting, shutdown

Example outputs:
- View processes: <cmd risk="safe">ps aux | grep nginx</cmd>
- Restart service: <cmd risk="medium">systemctl restart nginx</cmd>
- Delete files: <cmd risk="high">rm -rf /var/log/old_logs/</cmd>

## Response Guidelines
1. Be concise and professional, provide direct solutions
2. Commands MUST be wrapped in <cmd> tags for one-click execution
3. Explicitly warn about high-risk commands
4. Explain what each command does
5. For multi-step operations, list them in order

## Special Capabilities
- Understand common log formats (syslog, nginx, apache, docker, systemd journal, etc.)
- Recognize common error patterns and solutions
- Provide recommendations following security best practices`;
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
