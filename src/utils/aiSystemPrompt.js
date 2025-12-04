/**
 * AI助手系统提示词模块
 * 提供运维助手的专业提示词和命令风险评估逻辑
 */

// 命令风险等级定义
export const RISK_LEVELS = {
  SAFE: {
    level: 1,
    name: 'safe',
    color: '#4caf50', // 绿色
    label: '安全',
    labelEn: 'Safe',
    description: '只读操作，不会修改系统状态',
  },
  LOW: {
    level: 2,
    name: 'low',
    color: '#8bc34a', // 浅绿色
    label: '低风险',
    labelEn: 'Low Risk',
    description: '轻微修改，影响范围有限',
  },
  MEDIUM: {
    level: 3,
    name: 'medium',
    color: '#ff9800', // 橙色
    label: '中风险',
    labelEn: 'Medium Risk',
    description: '可能影响服务或数据',
  },
  HIGH: {
    level: 4,
    name: 'high',
    color: '#f44336', // 红色
    label: '高风险',
    labelEn: 'High Risk',
    description: '可能导致服务中断或数据丢失',
  },
  CRITICAL: {
    level: 5,
    name: 'critical',
    color: '#9c27b0', // 紫色
    label: '极高风险',
    labelEn: 'Critical Risk',
    description: '可能导致系统不可用或不可恢复',
  },
};

// 危险命令模式 - 用于风险评估
const DANGEROUS_PATTERNS = {
  // 极高风险 - 可能导致系统不可用
  critical: [
    /rm\s+(-rf?|--recursive)\s+\//i, // rm -rf /
    /rm\s+(-rf?|--recursive)\s+\/\*/i, // rm -rf /*
    /mkfs\s+/i, // 格式化文件系统
    /dd\s+.*of=\/dev\/[sh]d[a-z]/i, // 直接写磁盘
    /:\(\)\{\s*:\|:\s*&\s*\}/i, // fork bomb
    />\s*\/dev\/[sh]d[a-z]/i, // 覆盖磁盘
    /shutdown\s+-(h|r)\s+now/i, // 立即关机/重启
    /reboot\s+-(h|r)\s+now/i, // 立即重启
    /init\s+0/i, // 关机
    /halt/i, // 停机
    /poweroff/i, // 关机
  ],
  // 高风险 - 可能导致服务中断或数据丢失
  high: [
    /rm\s+(-r|--recursive)/i, // 递归删除
    /rm\s+(-f|--force)/i, // 强制删除
    /rm\s+.*\*/i, // 通配符删除
    /chmod\s+(-R|--recursive)\s+777/i, // 递归修改为全权限
    /chmod\s+(-R|--recursive)\s+000/i, // 递归移除所有权限
    /chown\s+(-R|--recursive)/i, // 递归修改所有者
    /kill\s+-9/i, // 强制杀进程
    /pkill\s+-9/i, // 强制杀进程组
    /killall/i, // 杀死所有同名进程
    /systemctl\s+(stop|disable|mask)/i, // 停止服务
    /service\s+\w+\s+stop/i, // 停止服务
    /iptables\s+-F/i, // 清空防火墙规则
    /iptables\s+-X/i, // 删除自定义链
    /DROP|REJECT/i, // 防火墙丢弃规则
    /reboot/i, // 重启
    /shutdown/i, // 关机
    /userdel/i, // 删除用户
    /groupdel/i, // 删除组
    /passwd\s+root/i, // 修改root密码
    /visudo/i, // 编辑sudo配置
    /crontab\s+-r/i, // 删除定时任务
    /truncate/i, // 截断文件
    /shred/i, // 安全删除
  ],
  // 中风险 - 可能影响服务或数据
  medium: [
    /mv\s+/i, // 移动文件
    /cp\s+(-r|--recursive)/i, // 递归复制
    /chmod\s+/i, // 修改权限
    /chown\s+/i, // 修改所有者
    /chgrp\s+/i, // 修改用户组
    /systemctl\s+restart/i, // 重启服务
    /service\s+\w+\s+restart/i, // 重启服务
    /apt(-get)?\s+(remove|purge|autoremove)/i, // 卸载软件
    /yum\s+(remove|erase)/i, // 卸载软件
    /dnf\s+(remove|erase)/i, // 卸载软件
    /pip\s+uninstall/i, // 卸载Python包
    /npm\s+uninstall/i, // 卸载npm包
    /docker\s+(rm|rmi|stop|kill)/i, // Docker容器/镜像操作
    /kubectl\s+delete/i, // K8s删除资源
    /git\s+(reset|revert|clean)/i, // Git重置操作
    /mysql.*DROP/i, // 数据库删除
    /psql.*DROP/i, // PostgreSQL删除
    /mongo.*drop/i, // MongoDB删除
    /sed\s+-i/i, // 原地编辑文件
    /awk\s+-i\s+inplace/i, // 原地编辑
    />\s+[^|]/i, // 文件重定向覆盖
    /wget\s+.*-O\s+/i, // wget覆盖文件
    /curl\s+.*-o\s+/i, // curl覆盖文件
  ],
  // 低风险 - 轻微修改
  low: [
    /touch\s+/i, // 创建文件
    /mkdir\s+/i, // 创建目录
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

/**
 * 评估单个命令的风险等级
 * @param {string} command - 要评估的命令
 * @returns {Object} 风险等级对象
 */
export function assessCommandRisk(command) {
  if (!command || typeof command !== 'string') {
    return RISK_LEVELS.SAFE;
  }

  const normalizedCommand = command.trim();

  // 检查极高风险
  for (const pattern of DANGEROUS_PATTERNS.critical) {
    if (pattern.test(normalizedCommand)) {
      return RISK_LEVELS.CRITICAL;
    }
  }

  // 检查高风险
  for (const pattern of DANGEROUS_PATTERNS.high) {
    if (pattern.test(normalizedCommand)) {
      return RISK_LEVELS.HIGH;
    }
  }

  // 检查中风险
  for (const pattern of DANGEROUS_PATTERNS.medium) {
    if (pattern.test(normalizedCommand)) {
      return RISK_LEVELS.MEDIUM;
    }
  }

  // 检查低风险
  for (const pattern of DANGEROUS_PATTERNS.low) {
    if (pattern.test(normalizedCommand)) {
      return RISK_LEVELS.LOW;
    }
  }

  // 默认为安全
  return RISK_LEVELS.SAFE;
}

/**
 * 生成运维助手系统提示词
 * @param {Object} options - 配置选项
 * @param {string} options.language - 语言 ('zh-CN' 或 'en-US')
 * @param {Object} options.connectionInfo - 当前连接信息
 * @returns {string} 系统提示词
 */
export function generateSystemPrompt(options = {}) {
  const { language = 'zh-CN', connectionInfo = null } = options;

  const isZhCN = language === 'zh-CN' || language.startsWith('zh');

  if (isZhCN) {
    return generateZhCNPrompt(connectionInfo);
  } else {
    return generateEnUSPrompt(connectionInfo);
  }
}

function generateZhCNPrompt(connectionInfo) {
  const connectionContext = connectionInfo
    ? `当前连接: ${connectionInfo.host || '未知主机'} (${connectionInfo.type || 'SSH'})`
    : '当前无活动连接';

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
    ? `Current connection: ${connectionInfo.host || 'Unknown host'} (${connectionInfo.type || 'SSH'})`
    : 'No active connection';

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
  if (!content || typeof content !== 'string') {
    return [];
  }

  const commands = [];
  // 匹配 <cmd risk="xxx">命令</cmd> 格式
  const cmdRegex = /<cmd\s+risk="(\w+)">([\s\S]*?)<\/cmd>/gi;
  let match;

  while ((match = cmdRegex.exec(content)) !== null) {
    const riskName = match[1].toLowerCase();
    const command = match[2].trim();

    // 根据风险名称获取风险等级
    let riskLevel = RISK_LEVELS.SAFE;
    for (const key of Object.keys(RISK_LEVELS)) {
      if (RISK_LEVELS[key].name === riskName) {
        riskLevel = RISK_LEVELS[key];
        break;
      }
    }

    // 如果AI没有正确标注风险，使用自动评估
    if (riskLevel === RISK_LEVELS.SAFE && riskName !== 'safe') {
      riskLevel = assessCommandRisk(command);
    }

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
  parseCommandsFromResponse,
  requiresConfirmation,
};
