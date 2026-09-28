const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const {
  NativePortForwardingClient,
  forwardingError,
} = require("../native/nativePortForwardingClient");
const {
  resolveForwardingConfig,
  networkSnapshot,
  revisionOf,
} = require("../native/nativePortForwardingConfig");
const { isSshClientUsable } = require("../utils/ssh-utils");

const nativeRule = (rule) => ({
  id: rule.id,
  type: rule.type,
  listenHost: rule.listenHost,
  listenPort: rule.listenPort,
  ...(rule.type === "dynamic"
    ? {}
    : { targetHost: rule.remoteHost, targetPort: rule.remotePort }),
});

class PortForwardingRuntime extends EventEmitter {
  constructor(options) {
    super();
    this.processManager = options.processManager;
    this.configService = options.configService;
    this.getPool = options.getPool;
    this.native = options.nativeClient || new NativePortForwardingClient();
    this.resolveConfig = options.resolveConfig || resolveForwardingConfig;
    this.activeForwards = new Map();
    this.sessions = new Map();
    this.suppressed = new Map();
    this.initialized = false;
    this.shutdown = false;
    this.native.on("event", (event) => this._nativeEvent(event));
    this.native.on("disconnected", (error) => {
      for (const session of this.sessions.values()) this._lost(session, error);
    });
  }

  initialize() {
    if (this.initialized || this.shutdown) return;
    this.initialized = true;
    const pool = this.getPool?.();
    this.pool = pool;
    this.proxyManager = pool?.proxyManager;
    this.onReady = ({ key } = {}) => {
      if (typeof key !== "string" || !key.startsWith("tab:")) return;
      this._tabReady(key.slice(4));
    };
    this.onSet = ({ id, process: proc, previous }) => {
      const tabId = this._tabId(id, proc);
      const session = this.sessions.get(tabId);
      if (session && previous && session.proc !== proc)
        void this._suspend(session).then(() => this._tabReady(tabId));
      else this._tabReady(tabId);
    };
    this.onDeleted = ({ id, process: proc }) => {
      const tabId = this._tabId(id, proc);
      void this.closeTab(tabId).catch(() => {});
    };
    this.onProxyChanged = () => {
      void this._checkNetworkPaths();
    };
    pool?.on("connectionCreated", this.onReady);
    pool?.on("connectionReconnected", this.onReady);
    pool?.on("savedConnectionsChanged", this.onProxyChanged);
    this.processManager.events?.on("processSet", this.onSet);
    this.processManager.events?.on("processDeleted", this.onDeleted);
    this.proxyManager?.on?.("changed", this.onProxyChanged);
    this.networkTimer = setInterval(() => {
      void this._checkNetworkPaths();
    }, 10000);
    this.networkTimer.unref?.();
    for (const [id, proc] of this.processManager.getAllProcesses())
      if (["ssh2", "ssh"].includes(proc?.type))
        this._tabReady(this._tabId(id, proc));
  }

  _tabId(id, proc) {
    return String(proc?.config?.tabId || proc?.tabId || id);
  }

  _findProcess(tabId) {
    tabId = String(tabId);
    let proc = this.processManager.getProcess(tabId);
    if (!proc) {
      // IPC serializes IDs as strings, but terminal processes may be registered
      // under a numeric process ID before their tab alias is installed.
      for (const [id, candidate] of this.processManager.getAllProcesses()) {
        if (String(id) === tabId || this._tabId(id, candidate) === tabId) {
          proc = this.processManager.getProcess(id);
          break;
        }
      }
    }
    tabId = this._tabId(tabId, proc);
    // Prefer the current tab record if a numeric alias still references an old
    // connection after reconnecting.
    proc = this.processManager.getProcess(tabId) || proc;
    return { tabId, proc };
  }

  _proc(tabId) {
    const resolved = this._findProcess(tabId);
    const { proc } = resolved;
    const client =
      proc?.connectionInfo?.client || proc?.client || proc?.process;
    if (
      !proc ||
      !["ssh2", "ssh"].includes(proc.type) ||
      !isSshClientUsable(client)
    )
      throw forwardingError("SESSION_UNAVAILABLE", proc?.config?.language);
    return { ...resolved, client };
  }

  _tabReady(tabId) {
    if (this.shutdown) return;
    try {
      tabId = this._proc(tabId).tabId;
    } catch {
      return;
    }
    const session = this.sessions.get(tabId);
    if (session && !session.ready) {
      session.attempts = 0;
      this._schedule(session);
    }
    for (const rule of this.loadRules()) {
      if (
        rule.autoStart &&
        !this.activeForwards.has(rule.id) &&
        !this.suppressed.get(tabId)?.has(rule.id)
      )
        void this.startRule(rule.id, tabId).catch(() => {});
    }
  }

  _session(tabId) {
    let session = this.sessions.get(tabId);
    if (!session) {
      session = {
        id: randomUUID(),
        tabId,
        generation: 0,
        rules: new Set(),
        bound: new Set(),
        queue: Promise.resolve(),
        controller: new AbortController(),
        ready: false,
        closed: false,
        attempts: 0,
      };
      this.sessions.set(tabId, session);
    }
    return session;
  }

  _enqueue(session, action) {
    const result = session.queue.then(() => {
      if (session.closed || this.shutdown) throw forwardingError("CANCELLED");
      return action();
    });
    session.queue = result.catch(() => {});
    return result;
  }

  _watchTerminal(session, proc, client) {
    session.client?.removeListener("close", session.onTerminalClose);
    session.proc = proc;
    session.client = client;
    session.onTerminalClose = () => {
      void this._suspend(session).catch(() => {});
    };
    client.once("close", session.onTerminalClose);
  }

  async _connect(session) {
    if (session.ready) return;
    if (session.closing) await session.closing;
    if (session.closed || !session.rules.size)
      throw forwardingError("CANCELLED");
    const { proc, client } = this._proc(session.tabId);
    this._watchTerminal(session, proc, client);
    session.controller = new AbortController();
    session.suspended = false;
    const signal = session.controller.signal;
    session.generation++;
    const generation = session.generation;
    let snapshot;
    try {
      snapshot = await this.resolveConfig(proc, this.proxyManager);
    } catch (error) {
      throw forwardingError(
        error.code || "PROXY_INVALID",
        proc.config?.language,
      );
    }
    if (
      session.closed ||
      signal.aborted ||
      this._proc(session.tabId).proc !== proc
    )
      throw forwardingError("CANCELLED");
    const rules = [...session.rules]
      .map((id) => this.activeForwards.get(id)?.rule)
      .filter(Boolean);
    if (!rules.length) throw forwardingError("CANCELLED");
    const result = await this.native.start(
      session.id,
      generation,
      snapshot.ssh,
      rules.map(nativeRule),
      { signal, onAuth: snapshot.onAuth },
    );
    if (session.closed || signal.aborted || generation !== session.generation)
      throw forwardingError("CANCELLED");
    session.ready = true;
    session.revision = snapshot.revision;
    session.bound = new Set(result.bindings.map((b) => b.id));
    for (const binding of result.bindings) this._running(session, binding);
    clearTimeout(session.stableTimer);
    session.stableTimer = setTimeout(() => {
      session.attempts = 0;
    }, 30000);
    session.stableTimer.unref?.();
    this._broadcastStatus();
  }

  _running(session, binding) {
    const runtime = this.activeForwards.get(binding.id);
    if (
      !runtime ||
      runtime.session !== session ||
      !session.rules.has(binding.id)
    )
      return;
    runtime.status = "running";
    runtime.error = null;
    runtime.boundPort = binding.port;
    runtime.activeConnections = 0;
    runtime.startedAt = Date.now();
  }

  startRule(ruleId, tabId) {
    this.initialize();
    tabId = String(tabId);
    if (this.shutdown) return Promise.reject(forwardingError("CANCELLED"));
    const existing = this.activeForwards.get(ruleId);
    if (existing?.starting) return existing.starting;
    if (existing?.status === "running")
      return Promise.resolve(this.getStatus()[ruleId]);
    const rule = this.loadRules().find((r) => r.id === ruleId);
    if (!rule) return Promise.reject(forwardingError("INVALID_CONFIG"));
    try {
      tabId = this._proc(tabId).tabId;
    } catch (error) {
      return Promise.reject(error);
    }
    if (existing && existing.tabId !== tabId)
      return this.stopRule(ruleId).then(() => this.startRule(ruleId, tabId));
    this.suppressed.get(tabId)?.delete(ruleId);
    const session = this._session(tabId);
    session.attempts = 0;
    session.rules.add(ruleId);
    const runtime = existing || {
      rule,
      tabId,
      session,
      status: "stopped",
      error: null,
      activeConnections: 0,
      startedAt: null,
    };
    runtime.session = session;
    this.activeForwards.set(ruleId, runtime);
    runtime.starting = this._enqueue(session, async () => {
      if (
        this.activeForwards.get(ruleId) !== runtime ||
        !session.rules.has(ruleId)
      )
        throw forwardingError("CANCELLED");
      await this._connect(session);
      if (!session.bound.has(ruleId)) {
        const result = await this.native.addRules(
          session.id,
          session.generation,
          [nativeRule(rule)],
        );
        session.bound.add(ruleId);
        this._running(session, result.bindings[0]);
      }
      this._broadcastStatus();
      return this.getStatus()[ruleId] || null;
    })
      .catch((error) => {
        if (this.activeForwards.get(ruleId) === runtime) {
          runtime.status = "error";
          runtime.error = forwardingError(
            error.code || "SIDECAR_EXITED",
            session.proc?.config?.language,
          ).message;
          runtime.activeConnections = 0;
          if (error.retryable) this._schedule(session);
          else if (!(error.code === "CANCELLED" && session.suspended))
            session.rules.delete(ruleId);
          this._broadcastStatus();
        }
        throw error;
      })
      .finally(() => {
        runtime.starting = null;
      });
    return runtime.starting;
  }

  async stopRule(ruleId, reason = "user") {
    this.initialize();
    const runtime = this.activeForwards.get(ruleId);
    if (!runtime) return true;
    const session = runtime.session;
    if (reason === "user") {
      if (!this.suppressed.has(runtime.tabId))
        this.suppressed.set(runtime.tabId, new Set());
      this.suppressed.get(runtime.tabId).add(ruleId);
    }
    this.activeForwards.delete(ruleId);
    session.rules.delete(ruleId);
    this._broadcastStatus();
    if (!session.rules.size) await this._closeSession(session);
    else
      await this._enqueue(session, async () => {
        if (session.ready && session.bound.has(ruleId)) {
          try {
            await this.native.removeRule(
              session.id,
              session.generation,
              ruleId,
            );
          } catch (error) {
            await this._suspend(session);
            this._schedule(session);
            throw error;
          }
          session.bound.delete(ruleId);
        }
      });
    return true;
  }

  _nativeEvent(event) {
    const session = [...this.sessions.values()].find(
      (s) => s.id === event.sessionId && s.generation === event.generation,
    );
    if (!session || session.closed) return;
    if (event.state === "connections") {
      const runtime = this.activeForwards.get(event.ruleId);
      if (runtime?.session === session && session.rules.has(event.ruleId)) {
        runtime.activeConnections = event.activeConnections;
        this._broadcastStatus();
      }
    } else if (
      event.state === "disconnected" ||
      (event.state === "closed" && session.ready)
    )
      this._lost(session, forwardingError("DISCONNECTED"));
  }

  _lost(session, error) {
    if (session.closed) return;
    session.ready = false;
    session.bound.clear();
    clearTimeout(session.stableTimer);
    for (const id of session.rules) {
      const runtime = this.activeForwards.get(id);
      if (runtime) {
        runtime.status = "error";
        runtime.error = forwardingError(
          error.code,
          session.proc?.config?.language,
        ).message;
        runtime.activeConnections = 0;
      }
    }
    this._broadcastStatus();
    if (error.retryable) this._schedule(session);
  }

  _schedule(session) {
    if (
      session.closed ||
      session.retryTimer ||
      !session.rules.size ||
      session.attempts >= 3 ||
      this.shutdown
    )
      return;
    try {
      this._proc(session.tabId);
    } catch {
      return;
    }
    const delay =
      250 * 2 ** session.attempts++ + Math.floor(Math.random() * 100);
    session.retryTimer = setTimeout(() => {
      session.retryTimer = null;
      void this._enqueue(session, () => this._connect(session)).catch((error) =>
        this._lost(session, error),
      );
    }, delay);
    session.retryTimer.unref?.();
  }

  async _suspend(session) {
    if (session.closed) return;
    clearTimeout(session.retryTimer);
    clearTimeout(session.stableTimer);
    session.retryTimer = null;
    session.ready = false;
    session.suspended = true;
    session.bound.clear();
    session.controller.abort();
    for (const id of session.rules) {
      const runtime = this.activeForwards.get(id);
      if (runtime) {
        runtime.status = "stopped";
        runtime.activeConnections = 0;
      }
    }
    session.closing = this.native
      .closeSession(session.id, session.generation)
      .catch(() => {});
    await session.closing;
    this._broadcastStatus();
  }

  async _checkNetworkPaths() {
    if (this.checkingPaths || this.shutdown) return;
    this.checkingPaths = true;
    try {
      await Promise.all(
        [...this.sessions.values()].map(async (session) => {
          if (session.closed || (!session.ready && !session.invalidNetwork))
            return;
          try {
            const { proc } = this._proc(session.tabId);
            const network = await networkSnapshot(
              proc.config,
              this.proxyManager,
            );
            if (session.closed || (!session.ready && !session.invalidNetwork))
              return;
            if (
              session.invalidNetwork ||
              revisionOf(network) !== session.revision
            ) {
              await this._suspend(session);
              session.invalidNetwork = false;
              session.attempts = 0;
              this._schedule(session);
            }
          } catch {
            await this._suspend(session);
            session.invalidNetwork = true;
            this._lost(session, forwardingError("PROXY_INVALID"));
          }
        }),
      );
    } finally {
      this.checkingPaths = false;
    }
  }

  async _closeSession(session) {
    if (session.closed) return session.closedPromise;
    session.closed = true;
    if (this.sessions.get(session.tabId) === session)
      this.sessions.delete(session.tabId);
    clearTimeout(session.retryTimer);
    clearTimeout(session.stableTimer);
    session.controller.abort();
    session.client?.removeListener("close", session.onTerminalClose);
    session.closedPromise = this.native
      .closeSession(session.id, session.generation)
      .catch(() => {});
    await session.closedPromise;
  }

  async closeTab(tabId) {
    tabId = this._findProcess(tabId).tabId;
    const session = this.sessions.get(tabId);
    for (const [id, runtime] of this.activeForwards)
      if (runtime.tabId === tabId) this.activeForwards.delete(id);
    this.suppressed.delete(tabId);
    if (session) {
      session.rules.clear();
      await this._closeSession(session);
    }
    this._broadcastStatus();
  }

  async stopAll() {
    this.shutdown = true;
    clearInterval(this.networkTimer);
    if (this.initialized) {
      this.pool?.removeListener("connectionCreated", this.onReady);
      this.pool?.removeListener("connectionReconnected", this.onReady);
      this.pool?.removeListener("savedConnectionsChanged", this.onProxyChanged);
      this.processManager.events?.removeListener("processSet", this.onSet);
      this.processManager.events?.removeListener(
        "processDeleted",
        this.onDeleted,
      );
      this.proxyManager?.removeListener?.("changed", this.onProxyChanged);
    }
    this.activeForwards.clear();
    this.suppressed.clear();
    await Promise.all(
      [...this.sessions.values()].map((s) => this._closeSession(s)),
    );
    await this.native.stop();
    this._broadcastStatus();
  }
}

module.exports = PortForwardingRuntime;
