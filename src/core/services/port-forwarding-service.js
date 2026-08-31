/**
 * 端口转发服务（SSH 隧道）
 *
 * 支持三类转发规则（对应 OpenSSH 的 -L / -R / -D）：
 * - local    本地转发：本地监听端口 -> 通过 SSH 连接 -> remoteHost:remotePort
 * - remote   远程转发：服务器监听 listenHost:listenPort -> 本地 remoteHost:remotePort
 * - dynamic  动态转发：本地 SOCKS5 代理，目标地址由客户端在 CONNECT 请求中指定
 *
 * 规则持久化在 config.portForwards，运行时状态通过 "statusUpdated" 事件广播。
 * 转发绑定到某个活跃的 SSH 终端会话（tabId），SSH 连接断开时自动停止相关转发。
 */

const net = require("net");
const { EventEmitter } = require("events");
const { logToFile } = require("../utils/logger");
const configService = require("../../services/configService");
const processManager = require("../process/processManager");
const { isSshClientUsable } = require("../utils/ssh-utils");

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

const SOCKS_VERSION = 0x05;
const SOCKS_CMD_CONNECT = 0x01;
const SOCKS_ATYP_IPV4 = 0x01;
const SOCKS_ATYP_DOMAIN = 0x03;
const SOCKS_ATYP_IPV6 = 0x04;

const MAX_RULES = 100;
const IDLE_SOCKET_TIMEOUT_MS = 10 * 60 * 1000;

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

class PortForwardingService extends EventEmitter {
  constructor() {
    super();
    /** @type {Map<string, object>} ruleId -> 运行时信息 */
    this.activeForwards = new Map();
    this.initialized = false;
  }

  initialize() {
    if (this.initialized) return;
    this.initialized = true;
    this._setupAutoStart();
    logToFile("PortForwardingService initialized", "INFO");
  }

  /**
   * 监听 SSH 连接建立/恢复事件，自动启动 autoStart 规则
   * @private
   */
  _setupAutoStart() {
    try {
      // 延迟 require 避免与连接池模块形成加载环
      const connectionManager = require("../../modules/connection");
      const pool = connectionManager.sshConnectionPool;
      if (!pool || typeof pool.on !== "function") return;

      const handleConnectionReady = ({ key } = {}) => {
        if (typeof key !== "string" || !key.startsWith("tab:")) return;
        const tabId = key.split(":")[1];
        if (!tabId) return;
        this._autoStartRulesForTab(tabId);
      };

      pool.on("connectionCreated", handleConnectionReady);
      pool.on("connectionReconnected", handleConnectionReady);
    } catch (error) {
      logToFile(
        `PortForward: auto-start setup failed - ${error.message}`,
        "WARN",
      );
    }
  }

  /**
   * 为指定会话自动启动所有 autoStart 规则（带短重试，等待进程注册完成）
   * @private
   */
  _autoStartRulesForTab(tabId, attempt = 0) {
    const MAX_ATTEMPTS = 5;
    const RETRY_DELAY_MS = 1000;

    const rules = this.loadRules().filter(
      (rule) =>
        rule.autoStart === true &&
        !this.activeForwards.has(rule.id),
    );

    if (rules.length === 0) return;

    let pending = rules.length;
    let clientReady = false;

    for (const rule of rules) {
      this.startRule(rule.id, tabId)
        .then(() => {
          clientReady = true;
          logToFile(
            `PortForward auto-started: ${describeRule(rule)} (${rule.id}) for tab ${tabId}`,
            "INFO",
          );
        })
        .catch((error) => {
          if (attempt + 1 < MAX_ATTEMPTS && !this.activeForwards.has(rule.id)) {
            setTimeout(() => {
              this._autoStartRulesForTab(tabId, attempt + 1);
            }, RETRY_DELAY_MS);
          } else if (!clientReady && attempt + 1 >= MAX_ATTEMPTS) {
            logToFile(
              `PortForward auto-start failed: ${rule.id} - ${error.message}`,
              "WARN",
            );
          }
        })
        .finally(() => {
          pending -= 1;
        });
    }
    void pending;
  }

  // ------------------------------------------------------------------
  // 规则管理
  // ------------------------------------------------------------------

  loadRules() {
    try {
      const rules = configService.loadPortForwards();
      return Array.isArray(rules) ? rules : [];
    } catch (error) {
      logToFile(`PortForward: load rules failed - ${error.message}`, "ERROR");
      return [];
    }
  }

  persistRules(rules) {
    try {
      configService.savePortForwards(rules);
      return true;
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
      name:
        typeof ruleInput.name === "string" ? ruleInput.name.trim() : "",
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
  saveRule(ruleInput) {
    this.initialize();

    const { rule, error } = this.normalizeRule(ruleInput);
    if (error) {
      throw new Error(error);
    }

    const rules = this.loadRules();
    const index = rules.findIndex((existing) => existing.id === rule.id);
    const isNew = index === -1;

    if (rules.length >= MAX_RULES && isNew) {
      throw new Error(`Cannot exceed ${MAX_RULES} forward rules`);
    }

    // 正在运行的旧版本先停止
    if (this.activeForwards.has(rule.id)) {
      this.stopRule(rule.id, "rule-updated");
    }

    if (isNew) {
      rules.push(rule);
    } else {
      rules[index] = rule;
    }

    this.persistRules(rules);
    this._broadcastStatus();
    return rule;
  }

  deleteRule(ruleId) {
    this.initialize();
    if (this.activeForwards.has(ruleId)) {
      this.stopRule(ruleId, "rule-deleted");
    }
    const rules = this.loadRules().filter((rule) => rule.id !== ruleId);
    this.persistRules(rules);
    this._broadcastStatus();
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
    try {
      for (const [tabId, proc] of processManager.getAllProcesses()) {
        if (!proc || proc.type !== "ssh2") continue;
        const client = proc.client || proc.process || proc.channel;
        if (!isSshClientUsable(client)) continue;
        const config = proc.config || {};
        sessions.push({
          tabId: String(tabId),
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

  _resolveSshClient(tabId) {
    if (!tabId) {
      throw new Error("No SSH session selected");
    }
    const proc = processManager.getProcess(tabId);
    if (!proc || (proc.type !== "ssh2" && proc.type !== "ssh")) {
      throw new Error("Target session is not an SSH session");
    }
    const client = proc.client || proc.process || proc.channel;
    if (!isSshClientUsable(client)) {
      throw new Error("SSH connection is not active");
    }
    return client;
  }

  // ------------------------------------------------------------------
  // 启动 / 停止
  // ------------------------------------------------------------------

  async startRule(ruleId, tabId) {
    this.initialize();

    if (this.activeForwards.has(ruleId)) {
      // 幂等：已在运行
      return this.getStatus()[ruleId] || null;
    }

    const rule = this.loadRules().find((r) => r.id === ruleId);
    if (!rule) {
      throw new Error("Forward rule not found");
    }

    const client = this._resolveSshClient(tabId);

    const runtime = {
      rule,
      tabId: String(tabId),
      client,
      status: FORWARD_STATUS.STOPPED,
      error: null,
      startedAt: Date.now(),
      server: null, // local/dynamic: net.Server; remote: 无本地服务
      sockets: new Set(),
      cleanupClient: null,
      tcpConnectionHandler: null,
    };
    this.activeForwards.set(ruleId, runtime);

    // SSH 连接关闭时自动清理该规则的所有转发
    runtime.cleanupClient = () => {
      this._stopRuntime(ruleId, FORWARD_STATUS.STOPPED, "SSH connection closed");
    };
    client.once("close", runtime.cleanupClient);

    try {
      if (rule.type === FORWARD_TYPES.LOCAL) {
        await this._startLocalForward(ruleId, runtime);
      } else if (rule.type === FORWARD_TYPES.DYNAMIC) {
        await this._startDynamicForward(ruleId, runtime);
      } else {
        await this._startRemoteForward(ruleId, runtime);
      }
    } catch (error) {
      this._stopRuntime(ruleId, FORWARD_STATUS.ERROR, error.message);
      throw error;
    }

    this._broadcastStatus();
    return this.getStatus()[ruleId] || null;
  }

  stopRule(ruleId, reason = "user") {
    this.initialize();
    if (!this.activeForwards.has(ruleId)) {
      return true;
    }
    this._stopRuntime(ruleId, FORWARD_STATUS.STOPPED, reason);
    this._broadcastStatus();
    return true;
  }

  /**
   * 全量停止（应用退出时调用）
   */
  stopAll() {
    for (const ruleId of Array.from(this.activeForwards.keys())) {
      try {
        this._stopRuntime(ruleId, FORWARD_STATUS.STOPPED, "shutdown");
      } catch {
        /* intentionally ignored */
      }
    }
    this._broadcastStatus();
  }

  _stopRuntime(ruleId, status, reason) {
    const runtime = this.activeForwards.get(ruleId);
    if (!runtime) return;

    this.activeForwards.delete(ruleId);

    try {
      if (runtime.cleanupClient && runtime.client) {
        runtime.client.removeListener("close", runtime.cleanupClient);
      }
    } catch {
      /* intentionally ignored */
    }

    // 远程转发：取消服务器端监听
    if (
      runtime.rule.type === FORWARD_TYPES.REMOTE &&
      runtime.tcpConnectionHandler &&
      runtime.client &&
      isSshClientUsable(runtime.client)
    ) {
      try {
        runtime.client.removeListener(
          "tcp connection",
          runtime.tcpConnectionHandler,
        );
        runtime.client.unforwardIn(
          runtime.rule.listenHost,
          runtime.rule.listenPort,
          () => {},
        );
      } catch {
        /* intentionally ignored */
      }
    }

    // 关闭本地监听
    if (runtime.server) {
      try {
        runtime.server.close();
      } catch {
        /* intentionally ignored */
      }
    }

    // 断开所有活动 socket
    for (const socket of runtime.sockets) {
      try {
        socket.destroy();
      } catch {
        /* intentionally ignored */
      }
    }
    runtime.sockets.clear();

    logToFile(
      `PortForward stopped: ${describeRule(runtime.rule)} (${ruleId}) - ${reason}`,
      "INFO",
    );

    this._broadcastStatus();
  }

  // ------------------------------------------------------------------
  // 本地转发（-L）
  // ------------------------------------------------------------------

  _startLocalForward(ruleId, runtime) {
    const { rule } = runtime;
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      runtime.server = server;

      server.on("connection", (socket) => {
        this._handleOutboundTunnelClient(runtime, socket, rule.remoteHost, rule.remotePort);
      });

      server.once("error", (error) => {
        if (this.activeForwards.get(ruleId) === runtime) {
          this._stopRuntime(ruleId, FORWARD_STATUS.ERROR, error.message);
        }
        reject(error);
      });

      server.listen(rule.listenPort, rule.listenHost, () => {
        logToFile(
          `PortForward local listening: ${describeRule(rule)} (${ruleId})`,
          "INFO",
        );
        resolve();
      });
    });
  }

  /**
   * 通过 SSH forwardOut 把本地 socket 桥接到远端目标
   */
  _handleOutboundTunnelClient(runtime, socket, dstHost, dstPort) {
    const { client, rule } = runtime;
    runtime.sockets.add(socket);
    socket.setTimeout(IDLE_SOCKET_TIMEOUT_MS);

    const cleanup = () => {
      runtime.sockets.delete(socket);
      try {
        socket.destroy();
      } catch {
        /* intentionally ignored */
      }
    };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
    socket.on("timeout", () => {
      cleanup();
    });

    if (!isSshClientUsable(client)) {
      cleanup();
      return;
    }

    client.forwardOut(
      socket.remoteAddress || "127.0.0.1",
      socket.remotePort || 0,
      dstHost,
      dstPort,
      (error, stream) => {
        if (error || !stream) {
          logToFile(
            `PortForward forwardOut failed (${rule.id}): ${error?.message || "no stream"}`,
            "WARN",
          );
          cleanup();
          return;
        }

        stream.on("error", cleanup);
        stream.pipe(socket);
        socket.pipe(stream);
      },
    );
  }

  // ------------------------------------------------------------------
  // 动态转发（-D，SOCKS5）
  // ------------------------------------------------------------------

  _startDynamicForward(ruleId, runtime) {
    const { rule } = runtime;
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      runtime.server = server;

      server.on("connection", (socket) => {
        this._handleSocks5Client(runtime, socket);
      });

      server.once("error", (error) => {
        if (this.activeForwards.get(ruleId) === runtime) {
          this._stopRuntime(ruleId, FORWARD_STATUS.ERROR, error.message);
        }
        reject(error);
      });

      server.listen(rule.listenPort, rule.listenHost, () => {
        logToFile(
          `PortForward dynamic (SOCKS5) listening: ${describeRule(rule)} (${ruleId})`,
          "INFO",
        );
        resolve();
      });
    });
  }

  _handleSocks5Client(runtime, socket) {
    runtime.sockets.add(socket);
    socket.setTimeout(IDLE_SOCKET_TIMEOUT_MS);

    const cleanup = () => {
      runtime.sockets.delete(socket);
      try {
        socket.destroy();
      } catch {
        /* intentionally ignored */
      }
    };
    socket.on("error", cleanup);
    socket.on("close", cleanup);
    socket.on("timeout", cleanup);

    const state = { buffer: Buffer.alloc(0), phase: "greeting" };

    const writeReply = (code, atyp = SOCKS_ATYP_IPV4) => {
      // BND.ADDR 固定 0.0.0.0:0（客户端一般不使用）
      const reply = Buffer.from([
        SOCKS_VERSION,
        code,
        0x00,
        atyp,
        0,
        0,
        0,
        0,
        0,
        0,
      ]);
      try {
        socket.write(reply);
      } catch {
        /* intentionally ignored */
      }
    };

    socket.on("data", function onData(chunk) {
      state.buffer = Buffer.concat([state.buffer, chunk]);

      if (state.phase === "greeting") {
        // +----+----------+----------+
        // |VER | NMETHODS | METHODS  |
        if (state.buffer.length < 2) return;
        const nmethods = state.buffer[1];
        if (state.buffer.length < 2 + nmethods) return;
        state.buffer = state.buffer.subarray(2 + nmethods);
        state.phase = "request";
        try {
          socket.write(Buffer.from([SOCKS_VERSION, 0x00]));
        } catch {
          socket.removeListener("data", onData);
          cleanup();
        }
        return;
      }

      if (state.phase === "request") {
        // +----+-----+-------+------+----------+----------+
        // |VER | CMD |  RSV  | ATYP | DST.ADDR | DST.PORT |
        if (state.buffer.length < 5) return;
        const ver = state.buffer[0];
        const cmd = state.buffer[1];
        const atyp = state.buffer[3];

        if (ver !== SOCKS_VERSION) {
          socket.removeListener("data", onData);
          cleanup();
          return;
        }
        if (cmd !== SOCKS_CMD_CONNECT) {
          // 仅支持 CONNECT
          socket.removeListener("data", onData);
          writeReply(0x07);
          cleanup();
          return;
        }

        let addressLength = 0;
        if (atyp === SOCKS_ATYP_IPV4) addressLength = 4;
        else if (atyp === SOCKS_ATYP_IPV6) addressLength = 16;
        else if (atyp === SOCKS_ATYP_DOMAIN) {
          if (state.buffer.length < 4) return;
          addressLength = state.buffer[4];
        } else {
          socket.removeListener("data", onData);
          writeReply(0x08);
          cleanup();
          return;
        }

        const totalLength = 4 + addressLength + 2;
        if (state.buffer.length < totalLength) return;

        let dstHost;
        let offset = 4;
        if (atyp === SOCKS_ATYP_IPV4) {
          dstHost = Array.from(
            state.buffer.subarray(offset, offset + 4),
          ).join(".");
        } else if (atyp === SOCKS_ATYP_IPV6) {
          const bytes = state.buffer.subarray(offset, offset + 16);
          const segments = [];
          for (let i = 0; i < 16; i += 2) {
            segments.push(bytes.readUInt16BE(i).toString(16));
          }
          dstHost = segments.join(":");
        } else {
          dstHost = state.buffer.subarray(offset + 1, offset + 1 + addressLength).toString("utf8");
        }
        offset += addressLength;
        const dstPort = state.buffer.readUInt16BE(offset);

        state.buffer = state.buffer.subarray(totalLength);
        socket.removeListener("data", onData);
        state.phase = "bridging";

        writeReply(0x00, atyp);
        this._handleOutboundTunnelClient(runtime, socket, dstHost, dstPort);
      }
    }.bind(this));
  }

  // ------------------------------------------------------------------
  // 远程转发（-R）
  // ------------------------------------------------------------------

  _startRemoteForward(ruleId, runtime) {
    const { rule, client } = runtime;
    return new Promise((resolve, reject) => {
      let settled = false;

      const handler = (info, accept) => {
        if (
          !info ||
          info.destIP !== rule.listenHost ||
          info.destPort !== rule.listenPort
        ) {
          return; // 不是本规则的监听
        }
        let stream;
        try {
          stream = accept();
        } catch {
          return;
        }
        if (!stream) return;

        runtime.sockets.add(stream);
        const target = net.connect({
          host: rule.remoteHost || DEFAULT_RULE.remoteHost,
          port: rule.remotePort,
        });
        runtime.sockets.add(target);

        const cleanup = () => {
          runtime.sockets.delete(stream);
          runtime.sockets.delete(target);
          try {
            stream.destroy();
          } catch {
            /* intentionally ignored */
          }
          try {
            target.destroy();
          } catch {
            /* intentionally ignored */
          }
        };
        stream.on("error", cleanup);
        target.on("error", cleanup);
        stream.on("close", cleanup);
        target.on("close", cleanup);

        stream.pipe(target);
        target.pipe(stream);
      };

      runtime.tcpConnectionHandler = handler;
      client.on("tcp connection", handler);

      try {
        client.forwardIn(rule.listenHost, rule.listenPort, (error, realPort) => {
          if (settled) return;
          settled = true;
          if (error) {
            reject(
              error instanceof Error
                ? error
                : new Error(
                    `Unable to bind ${rule.listenHost}:${rule.listenPort} on remote host`,
                  ),
            );
            return;
          }
          logToFile(
            `PortForward remote bound: ${rule.listenHost}:${realPort} -> ${rule.remoteHost}:${rule.remotePort} (${ruleId})`,
            "INFO",
          );
          resolve();
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    });
  }

  // ------------------------------------------------------------------
  // 状态
  // ------------------------------------------------------------------

  /**
   * 返回 ruleId -> 运行状态 的映射（仅活跃转发 + 最近错误）
   */
  getStatus() {
    const status = {};
    for (const [ruleId, runtime] of this.activeForwards.entries()) {
      status[ruleId] = {
        ruleId,
        status: runtime.status,
        tabId: runtime.tabId,
        error: runtime.error,
        startedAt: runtime.startedAt,
        activeConnections: runtime.sockets.size,
        description: describeRule(runtime.rule),
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
