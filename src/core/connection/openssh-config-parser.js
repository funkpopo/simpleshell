/**
 * OpenSSH 客户端配置（~/.ssh/config）解析器
 *
 * 纯逻辑模块（无 Node 依赖，可在主进程与渲染进程共用，便于 vitest 单测）。
 *
 * 遵循 OpenSSH ssh_config(5) 的核心语义：
 * - 逐块（Host/Match 块）解析，块内 "first obtained value wins"：
 *   对同一关键字，越早匹配到的块优先，后续块不再覆盖；
 * - Host 后可跟逗号分隔的多个模式，支持 `*`、`?` 通配与 `!` 取反；
 * - Match 块的条件求值依赖运行时信息（user/host/localuser/exec 等），
 *   导入场景无法静态判定，整体跳过并记录 warning；
 * - 支持 `Key value` 与 `Key=value` 两种写法，参数可用双引号包裹；
 * - `#` 为注释（引号内除外）；`~` 与 `%d`/`%%`/`%h` token 在路径中展开。
 */

/** 支持解析并映射到应用连接模型的 OpenSSH 关键字 */
const SUPPORTED_KEYWORDS = [
  "hostname",
  "port",
  "user",
  "identityfile",
  "forwardagent",
  "proxyjump",
  "proxycommand",
];

/** 识别到但无法直接映射到连接模型的关键字（记录到 warning，不阻断导入） */
const NOTED_UNSUPPORTED_KEYWORDS = [
  "proxyjump",
  "proxycommand",
  "serveraliveinterval",
  "serveralivecountmax",
  "compression",
  "identitiesonly",
  "identitiesonly",
  "addkeystoagent",
  "stricthostkeychecking",
  "userknownhostsfile",
  "include",
];

/**
 * 判断 host 是否匹配单个 ssh_config 模式
 * 支持 `*`（任意串）、`?`（单字符）；模式大小写不敏感（与 OpenSSH 一致）
 * @param {string} pattern 模式串
 * @param {string} host 目标主机别名
 * @returns {boolean}
 */
function hostMatchesPattern(pattern, host) {
  if (typeof pattern !== "string" || typeof host !== "string") {
    return false;
  }
  // 转义正则特殊字符后，将 * / ? 还原为通配语义
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  let regex;
  try {
    regex = new RegExp(`^${escaped}$`, "i");
  } catch {
    return false;
  }
  return regex.test(host);
}

/**
 * 判断目标主机是否命中某个 Host 块的模式列表
 * OpenSSH 语义：任一取反模式命中则整个块不匹配；否则任一正向模式命中即匹配
 * @param {string[]} patterns
 * @param {string} host
 * @returns {boolean}
 */
function hostMatchesBlock(patterns, host) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return false;
  }
  let hasPositive = false;
  for (const rawPattern of patterns) {
    const pattern = String(rawPattern).trim();
    if (!pattern) {
      continue;
    }
    const negated = pattern.startsWith("!");
    const body = negated ? pattern.slice(1).trim() : pattern;
    if (!body) {
      continue;
    }
    if (negated) {
      if (hostMatchesPattern(body, host)) {
        return false;
      }
    } else if (!hasPositive && hostMatchesPattern(body, host)) {
      hasPositive = true;
    }
  }
  return hasPositive;
}

/**
 * 展开路径中的 ~ 与 OpenSSH token（%d=家目录、%h=主机别名、%%=字面 %）
 * 其余未知 token 原样保留（导入后用户可在连接编辑框中自行修正）
 * @param {string} value
 * @param {string} homeDir
 * @param {string} alias
 * @returns {string}
 */
function expandPathTokens(value, homeDir, alias) {
  if (!value) {
    return value;
  }
  let expanded = value;
  if (homeDir) {
    if (value === "~" || value.startsWith("~/")) {
      expanded = `${homeDir}${value.slice(1)}`;
    }
    expanded = expanded
      .replace(/%d/g, homeDir)
      .replace(/%h/g, alias || "")
      .replace(/%%/g, "%");
  }
  return expanded;
}

/**
 * 去除行内注释：未包含在双引号内的第一个 # 起视为注释
 * @param {string} line
 * @returns {string}
 */
function stripComment(line) {
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "#" && !inQuotes) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * 按 OpenSSH 规则拆分参数：空白分隔，双引号包裹的片段视为单个参数
 * @param {string} input 关键字后的剩余文本
 * @returns {string[]}
 */
function splitArguments(input) {
  const tokens = [];
  let current = "";
  let inQuotes = false;
  let hasContent = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      hasContent = true;
      continue;
    }
    if (!inQuotes && /\s/.test(ch)) {
      if (current.length > 0 || hasContent) {
        tokens.push(current);
        current = "";
        hasContent = false;
      }
      continue;
    }
    current += ch;
    hasContent = true;
  }
  if (current.length > 0 || hasContent) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * 解析单行为 { keyword, valueTokens, lineNo }；无法解析返回 null
 * @param {string} line
 * @param {number} lineNo
 * @returns {{ keyword: string, valueTokens: string[], lineNo: number } | null}
 */
function parseLine(line, lineNo) {
  const trimmed = stripComment(line).trim();
  if (!trimmed) {
    return null;
  }

  // Key=Value 形式（关键字与 = 之间可有空白）
  const eqMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9-]*)\s*=(.*)$/);
  if (eqMatch) {
    return {
      keyword: eqMatch[1].toLowerCase(),
      valueTokens: splitArguments(eqMatch[2].trim()),
      lineNo,
    };
  }

  const spaceMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9-]*)((?:\s|=)(.*))?$/);
  if (!spaceMatch) {
    return null;
  }
  return {
    keyword: spaceMatch[1].toLowerCase(),
    valueTokens: splitArguments((spaceMatch[3] || "").trim()),
    lineNo,
  };
}

/**
 * 判断模式串是否为通配模式（含 * 或 ?，或为纯取反/空）
 * 通配模式无法映射为一条具体连接
 * @param {string} pattern
 * @returns {boolean}
 */
function isWildcardPattern(pattern) {
  return !pattern || /[*?]/.test(pattern);
}

/**
 * 解析 OpenSSH 配置文本
 * @param {string} content 配置文件内容
 * @param {object} [options]
 * @param {string} [options.homeDir] 用于展开 ~/ 与 %d 的用户主目录
 * @returns {{ hosts: Array<object>, warnings: string[] }}
 */
function parseOpenSSHConfig(content, options = {}) {
  const homeDir = options.homeDir || "";
  const warnings = [];
  const hosts = [];

  if (typeof content !== "string" || content.trim() === "") {
    return { hosts, warnings };
  }

  // 第一遍：切块。首个 Host 之前的顶层选项视作全局默认（等价 Host * 块）
  const blocks = [];
  let currentBlock = {
    type: "host",
    patterns: ["*"],
    lineNo: 0,
    options: [],
    isGlobalDefaults: true,
  };

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseLine(lines[i], i + 1);
    if (!parsed) {
      continue;
    }

    if (parsed.keyword === "host") {
      if (currentBlock.options.length > 0 || currentBlock.patterns.length > 0) {
        blocks.push(currentBlock);
      }
      currentBlock = {
        type: "host",
        patterns: parsed.valueTokens,
        lineNo: parsed.lineNo,
        options: [],
        isGlobalDefaults: false,
      };
      continue;
    }

    if (parsed.keyword === "match") {
      blocks.push(currentBlock);
      currentBlock = {
        type: "match",
        patterns: [],
        lineNo: parsed.lineNo,
        options: [],
        isGlobalDefaults: false,
      };
      continue;
    }

    if (currentBlock.type === "match" && !SUPPORTED_KEYWORDS.includes(parsed.keyword)) {
      // Match 块内的非关键选项一并忽略，避免污染 host 块
      continue;
    }

    if (parsed.valueTokens.length === 0) {
      warnings.push(`第 ${parsed.lineNo} 行：${parsed.keyword} 缺少参数，已忽略`);
      continue;
    }

    currentBlock.options.push({
      keyword: parsed.keyword,
      valueTokens: parsed.valueTokens,
      lineNo: parsed.lineNo,
    });
  }
  blocks.push(currentBlock);

  // 第二遍：对每个可导入别名（具体模式），按块序求值（first-obtained-wins）
  const seenAliases = new Set();

  for (const block of blocks) {
    if (block.type !== "host" || block.isGlobalDefaults) {
      continue;
    }
    for (const rawPattern of block.patterns) {
      const alias = String(rawPattern).trim();
      if (!alias || alias.startsWith("!")) {
        continue;
      }
      if (isWildcardPattern(alias)) {
        warnings.push(
          `第 ${block.lineNo} 行：模式 "${alias}" 为通配模式，无法导入为具体连接`,
        );
        continue;
      }
      if (seenAliases.has(alias.toLowerCase())) {
        continue;
      }
      seenAliases.add(alias.toLowerCase());

      const resolved = resolveHostOptions(blocks, alias);
      if (!resolved.hasAnyValue) {
        // 纯别名块且无任何有效配置（例如只有 Include）——仍可作为仅别名主机导入
        warnings.push(`主机 "${alias}"（第 ${block.lineNo} 行）没有任何可识别的配置项`);
      }
      hosts.push(buildHostEntry(alias, block, resolved, homeDir));
    }
  }

  if (blocks.some((block) => block.type === "match")) {
    warnings.push("Match 条件块无法静态求值，已整体跳过");
  }

  return { hosts, warnings };
}

/**
 * 按块序对指定别名求值（模拟 ssh 的配置求值顺序）
 * @param {Array<object>} blocks
 * @param {string} alias
 * @returns {object} 各关键字的首个匹配值
 */
function resolveHostOptions(blocks, alias) {
  const result = {
    hostName: null,
    port: null,
    user: null,
    identityFile: null,
    forwardAgent: null,
    proxyJump: null,
    proxyCommand: null,
    extraKeywords: new Set(),
    hasAnyValue: false,
  };

  const seenKeywords = new Set();
  const identityFiles = [];

  for (const block of blocks) {
    if (block.type === "match") {
      continue;
    }
    if (!hostMatchesBlock(block.patterns, alias)) {
      continue;
    }
    for (const option of block.options) {
      const { keyword } = option;
      if (!SUPPORTED_KEYWORDS.includes(keyword)) {
        if (!seenKeywords.has(keyword)) {
          seenKeywords.add(keyword);
          if (NOTED_UNSUPPORTED_KEYWORDS.includes(keyword)) {
            result.extraKeywords.add(keyword);
          }
        }
        continue;
      }
      if (keyword === "identityfile") {
        // IdentityFile 可重复出现（累积），但首个仍作为默认私钥路径
        if (identityFiles.length === 0) {
          result.identityFile = option.valueTokens[0];
          result.hasAnyValue = true;
        }
        identityFiles.push(option.valueTokens[0]);
        continue;
      }
      if (seenKeywords.has(keyword)) {
        continue;
      }
      seenKeywords.add(keyword);
      switch (keyword) {
        case "hostname":
          result.hostName = option.valueTokens[0];
          break;
        case "port": {
          const port = Number.parseInt(option.valueTokens[0], 10);
          if (Number.isInteger(port) && port >= 1 && port <= 65535) {
            result.port = port;
          }
          break;
        }
        case "user":
          result.user = option.valueTokens[0];
          break;
        case "forwardagent":
          result.forwardAgent = /^(yes|true)$/i.test(option.valueTokens[0]);
          break;
        case "proxyjump":
          result.proxyJump = option.valueTokens.join(" ");
          break;
        case "proxycommand":
          result.proxyCommand = option.valueTokens.join(" ");
          break;
        default:
          break;
      }
      result.hasAnyValue = true;
    }
  }

  result.identityFiles = identityFiles;
  return result;
}

/**
 * 将解析结果组装为单个可导入主机条目
 * @param {string} alias
 * @param {object} block
 * @param {object} resolved
 * @param {string} homeDir
 * @returns {object}
 */
function buildHostEntry(alias, block, resolved, homeDir) {
  const privateKeyPath = resolved.identityFile
    ? expandPathTokens(resolved.identityFile, homeDir, alias)
    : "";
  const hostName = resolved.hostName
    ? expandPathTokens(resolved.hostName, homeDir, alias)
    : "";

  return {
    alias,
    host: hostName || alias,
    hasHostName: Boolean(resolved.hostName),
    port: resolved.port,
    username: resolved.user || "",
    authType: privateKeyPath ? "privateKey" : "password",
    privateKeyPath,
    identityFiles: (resolved.identityFiles || []).map((path) =>
      expandPathTokens(path, homeDir, alias),
    ),
    agentForward: resolved.forwardAgent === true,
    proxyJump: resolved.proxyJump || "",
    proxyCommand: resolved.proxyCommand || "",
    unsupportedOptions: Array.from(resolved.extraKeywords || []),
    sourceLine: block.lineNo,
  };
}

/**
 * 将解析出的主机条目映射为应用连接对象（与 buildConnectionPayloadFromForm 的
 * SSH 连接结构保持一致）。通配别名、ProxyJump/ProxyCommand 主机不生成连接。
 * @param {Array<object>} hosts parseOpenSSHConfig 返回的 hosts
 * @param {object} [options]
 * @param {(prefix?: string) => string} options.generateId 连接 ID 工厂（渲染进程注入）
 * @param {Set<string>} [options.existingNames] 已存在的连接名（大小写不敏感去重）
 * @returns {{ connections: Array<object>, skipped: Array<{alias: string, reason: string}> }}
 */
function mapHostsToConnections(hosts, options = {}) {
  const generateId = options.generateId || (() => "");
  const existingNames = options.existingNames || new Set();
  const connections = [];
  const skipped = [];

  for (const entry of Array.isArray(hosts) ? hosts : []) {
    if (isWildcardPattern(entry.alias)) {
      skipped.push({ alias: entry.alias, reason: "wildcard" });
      continue;
    }
    if (entry.proxyJump || entry.proxyCommand) {
      skipped.push({ alias: entry.alias, reason: "proxy" });
      continue;
    }
    const name = entry.alias;
    if (existingNames && existingNames.has(name.toLowerCase())) {
      skipped.push({ alias: name, reason: "duplicate" });
      continue;
    }

    const port = Number.isInteger(entry.port) ? entry.port : 22;
    connections.push({
      id: generateId("conn"),
      type: "connection",
      name,
      host: entry.host,
      port,
      username: entry.username || "",
      password: "",
      authType: entry.privateKeyPath ? "privateKey" : "password",
      privateKeyPath: entry.privateKeyPath || "",
      agentPath: "",
      agentForward: entry.agentForward === true,
      os: "",
      connectionType: "",
      protocol: "ssh",
      proxy: null,
    });
    if (existingNames) {
      existingNames.add(name.toLowerCase());
    }
  }

  return { connections, skipped };
}

module.exports = {
  SUPPORTED_KEYWORDS,
  hostMatchesPattern,
  hostMatchesBlock,
  parseOpenSSHConfig,
  mapHostsToConnections,
  expandPathTokens,
};
