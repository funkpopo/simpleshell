/**
 * 端口转发服务（SSH 隧道）
 *
 * 支持三类转发规则（对应 OpenSSH 的 -L / -R / -D）：
 * - local    本地转发：本地监听端口 -> 通过 SSH 连接 -> remoteHost:remotePort
 * - remote   远程转发：服务器监听 listenHost:listenPort -> 本地 remoteHost:remotePort
 * - dynamic  动态转发：本地 SOCKS5 代理，目标地址由客户端在 CONNECT 请求中指定
 *
 * 规则持久化在 config.portForwards，运行时状态通过 "statusUpdated" 事件广播。
 * 规则按 tabId 编排；Rust 独立持有 SSH 连接和所有转发数据，标签关闭时显式回收。
 */

const PortForwardingRuntime = require("./port-forwarding-runtime");
const { logToFile } = require("../utils/logger");
const configService = require("../settings/configService");
const processManager = require("../process/processManager");
const { t: mainT } = require("../../shared/mainI18n");

const FORWARD_TYPES = Object.freeze({
  LOCAL: "local",
  REMOTE: "remote",
  DYNAMIC: "dynamic",
});

const FORWARD_STATUS = Object.freeze({
  RUNNING: "running",
  ERROR: "error",
  STOPPED: "stopped",
});

const MAX_RULES = 100;

const DEFAULT_RULE = Object.freeze({
  listenHost: "127.0.0.1",
  remoteHost: "127.0.0.1",
});

function isValidPort(port) {
  return Number.isInteger(port) && port >= 0 && port <= 65535;
}

function normalizeHost(host, fallback) {
  if (typeof host !== "string") return fallback;
  const trimmed = host.trim();
  return trimmed || fallback;
}

/**
 * 生成规则展示摘要，例如 "L 127.0.0.1:8080 -> example.com:80"
 */
function describeRule(rule) {
  const typeTag =
    rule.type === FORWARD_TYPES.LOCAL
      ? "L"
      : rule.type === FORWARD_TYPES.REMOTE
        ? "R"
        : "D";
  const listen = `${rule.listenHost || "127.0.0.1"}:${rule.listenPort}`;
  if (rule.type === FORWARD_TYPES.DYNAMIC) {
    return `${typeTag} ${listen} (SOCKS5)`;
  }
  const target = `${rule.remoteHost || "127.0.0.1"}:${rule.remotePort}`;
  if (rule.type === FORWARD_TYPES.REMOTE) {
    return `${typeTag} ${listen} -> ${target} (local)`;
  }
  return `${typeTag} ${listen} -> ${target} (via ssh)`;
}

class PortForwardingService extends PortForwardingRuntime {
  constructor(options = {}) {
    super({
      processManager,
      configService,
      getPool: () =>
        require("../connection/connectionManager").sshConnectionPool,
      ...options,
    });
  }

  loadRules() {
    try {
      const rules = this.configService.loadPortForwards();
      return Array.isArray(rules) ? rules : [];
    } catch (error) {
      logToFile(`PortForward: load rules failed - ${error.message}`, "ERROR");
      return [];
    }
  }

  persistRules(rules) {
    try {
      return this.configService.savePortForwards(rules) !== false;
    } catch (error) {
      logToFile(`PortForward: save rules failed - ${error.message}`, "ERROR");
      return false;
    }
  }

  /**
   * 校验并规范化规则对象
   * @param {object} ruleInput
   * @returns {{ rule: object|null, error: string|null }}
   */
  normalizeRule(ruleInput) {
    if (!ruleInput || typeof ruleInput !== "object") {
      return { rule: null, error: "Invalid rule" };
    }

    const type = String(ruleInput.type || "").toLowerCase();
    if (!Object.values(FORWARD_TYPES).includes(type)) {
      return { rule: null, error: "Invalid forward type" };
    }

    const listenPort = Number(ruleInput.listenPort);
    if (!isValidPort(listenPort) || listenPort === 0) {
      return { rule: null, error: "Invalid listen port" };
    }

    const rule = {
      id:
        typeof ruleInput.id === "string" && ruleInput.id
          ? ruleInput.id
          : `pf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: typeof ruleInput.name === "string" ? ruleInput.name.trim() : "",
      type,
      listenHost: normalizeHost(ruleInput.listenHost, DEFAULT_RULE.listenHost),
      listenPort,
      autoStart: ruleInput.autoStart === true,
    };

    if (type !== FORWARD_TYPES.DYNAMIC) {
      const remotePort = Number(ruleInput.remotePort);
      if (!isValidPort(remotePort) || remotePort === 0) {
        return { rule: null, error: "Invalid target port" };
      }
      rule.remoteHost = normalizeHost(
        ruleInput.remoteHost,
        DEFAULT_RULE.remoteHost,
      );
      rule.remotePort = remotePort;
    }

    if (type === FORWARD_TYPES.REMOTE) {
      // 远程转发默认绑定在服务器 loopback 上
      rule.listenHost = normalizeHost(ruleInput.listenHost, "127.0.0.1");
    } else {
      rule.listenHost = normalizeHost(ruleInput.listenHost, "127.0.0.1");
    }

    // 端口冲突检查（同监听地址+端口只能有一条规则）
    const rules = this.loadRules();
    const conflict = rules.find(
      (existing) =>
        existing.id !== rule.id &&
        existing.listenPort === rule.listenPort &&
        normalizeHost(existing.listenHost, "127.0.0.1") === rule.listenHost,
    );
    if (conflict) {
      return {
        rule: null,
        error: `Port ${rule.listenHost}:${rule.listenPort} is already used by rule "${conflict.name || conflict.id}"`,
      };
    }

    return { rule, error: null };
  }

  /**
   * 新增或更新规则。若该规则正在运行，会先停止（改动后需重新启动）。
   */
  async saveRule(ruleInput) {
    this.initialize();

    const { rule, error } = this.normalizeRule(ruleInput);
    if (error) {
      throw new Error(error);
    }

    const rules = [...this.loadRules()];
    const index = rules.findIndex((existing) => existing.id === rule.id);
    const isNew = index === -1;

    if (rules.length >= MAX_RULES && isNew) {
      throw new Error(`Cannot exceed ${MAX_RULES} forward rules`);
    }

    // 正在运行的旧版本先停止
    if (this.activeForwards.has(rule.id)) {
      await this.stopRule(rule.id, "rule-updated");
    }

    if (isNew) {
      rules.push(rule);
    } else {
      rules[index] = rule;
    }

    if (!this.persistRules(rules))
      throw new Error(mainT("portForwarding.saveFailed"));
    this._broadcastStatus();
    return rule;
  }

  async deleteRule(ruleId) {
    this.initialize();
    const rules = this.loadRules().filter((rule) => rule.id !== ruleId);
    if (!this.persistRules(rules))
      throw new Error(mainT("portForwarding.deleteFailed"));
    // Publish the committed deletion before awaiting SSH unbind/disconnect.
    // This also prevents auto-start from reviving the rule during cleanup, and
    // leaves a running tunnel untouched if saving the deletion fails.
    this._broadcastStatus();
    await this.stopRule(ruleId, "rule-deleted");
    return true;
  }

  // ------------------------------------------------------------------
  // 会话发现
  // ------------------------------------------------------------------

  /**
   * 列出可用于建立隧道的活跃 SSH 会话
   */
  getActiveSessions() {
    const sessions = [];
    const seen = new Set();
    try {
      for (const [id, proc] of this.processManager.getAllProcesses()) {
        if (!["ssh2", "ssh"].includes(proc?.type)) continue;
        const tabId = this._tabId(id, proc);
        if (seen.has(tabId)) continue;
        let resolved;
        try {
          resolved = this._proc(tabId);
        } catch {
          continue;
        }
        seen.add(tabId);
        const config = resolved.proc.config || {};
        sessions.push({
          tabId,
          host: config.host,
          port: config.port || 22,
          username: config.username,
          label: config.username
            ? `${config.username}@${config.host}`
            : String(config.host || tabId),
        });
      }
    } catch (error) {
      logToFile(
        `PortForward: getActiveSessions failed - ${error.message}`,
        "ERROR",
      );
    }
    return sessions;
  }

  getStatus() {
    const status = {};
    for (const [ruleId, runtime] of this.activeForwards.entries()) {
      status[ruleId] = {
        ruleId,
        status: runtime.status,
        tabId: runtime.tabId,
        error: runtime.error,
        startedAt: runtime.startedAt,
        activeConnections: runtime.activeConnections,
        description: describeRule(runtime.rule),
        boundPort: runtime.boundPort,
      };
    }
    return status;
  }

  /**
   * 规则列表 + 合并后的运行状态（供渲染端一次性拉取）
   */
  getRulesWithStatus() {
    const status = this.getStatus();
    const rules = this.loadRules().map((rule) => ({
      ...rule,
      runtime: status[rule.id] || null,
    }));
    return { rules, runtimeStatus: status };
  }

  _broadcastStatus() {
    try {
      this.emit("statusUpdated", this.getRulesWithStatus());
    } catch (error) {
      logToFile(
        `PortForward: broadcast status failed - ${error.message}`,
        "WARN",
      );
    }
  }
}

// 单例
const portForwardingService = new PortForwardingService();

module.exports = portForwardingService;
module.exports.PortForwardingService = PortForwardingService;
module.exports.FORWARD_TYPES = FORWARD_TYPES;
module.exports.FORWARD_STATUS = FORWARD_STATUS;
module.exports.describeRule = describeRule;
