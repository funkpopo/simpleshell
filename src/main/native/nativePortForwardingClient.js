const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const { getNativeServicesHostPath } = require("./nativeServices");
const { t: mainT } = require("../../shared/mainI18n");

const RETRYABLE = new Set([
  "CONNECT_FAILED",
  "CONNECT_TIMEOUT",
  "DISCONNECTED",
  "SIDECAR_EXITED",
]);
function forwardingError(code, language) {
  const category =
    {
      HOST_KEY_MISMATCH: "hostTrust",
      HOST_KEY_NOT_TRUSTED: "hostTrust",
      AUTH_FAILED: "authentication",
      INVALID_KEY: "authentication",
      AGENT_UNAVAILABLE: "agent",
      LOCAL_BIND_FAILED: "listen",
      REMOTE_BIND_FAILED: "listen",
      PROXY_REQUIRED: "proxy",
      PROXY_INVALID: "proxy",
      CANCELLED: "cancelled",
      SIDECAR_MISSING: "unavailable",
      SIDECAR_VERSION: "unavailable",
      SIDECAR_START: "unavailable",
      BUSY: "busy",
      IDENTITY_LIMIT: "busy",
      SESSION_UNAVAILABLE: "session",
      CONNECT_FAILED: "connection",
      CONNECT_TIMEOUT: "connection",
      DISCONNECTED: "connection",
      STALE_GENERATION: "cancelled",
      INVALID_CONFIG: "configuration",
      ALGORITHM_UNSUPPORTED: "algorithms",
    }[code] || "service";
  const options = { lng: language };
  const messages = {
    hostTrust: mainT("portForwarding.errors.hostTrust", options),
    authentication: mainT("portForwarding.errors.authentication", options),
    agent: mainT("portForwarding.errors.agent", options),
    listen: mainT("portForwarding.errors.listen", options),
    proxy: mainT("portForwarding.errors.proxy", options),
    cancelled: mainT("portForwarding.errors.cancelled", options),
    unavailable: mainT("portForwarding.errors.unavailable", options),
    busy: mainT("portForwarding.errors.busy", options),
    session: mainT("portForwarding.errors.session", options),
    connection: mainT("portForwarding.errors.connection", options),
    configuration: mainT("portForwarding.errors.configuration", options),
    algorithms: mainT("portForwarding.errors.algorithms", options),
    service: mainT("portForwarding.errors.service", options),
  };
  const error = new Error(messages[category]);
  error.code = error.errorCode = code;
  error.retryable = RETRYABLE.has(code);
  return error;
}

class NativePortForwardingClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.spawn = options.spawn || spawn;
    this.locate = options.locate || getNativeServicesHostPath;
    this.startTimeout = options.startTimeout || 10000;
    this.requestTimeout = options.requestTimeout || 10000;
    this.pending = new Map();
    this.sessions = new Map();
    this.completed = new Set();
    this.sequence = 0;
    this.child = null;
    this.ready = false;
    this.stopping = false;
  }

  async ensureReady() {
    if (this.stopping) throw forwardingError("CANCELLED");
    if (this.ready) return;
    if (this.starting) return this.starting;
    if (this.exiting) await this.exiting;
    if (this.stopping) throw forwardingError("CANCELLED");
    if (this.starting) return this.starting;
    const binary = this.locate();
    if (!binary) throw forwardingError("SIDECAR_MISSING");
    const child = this.spawn(binary, ["port-forward-serve"], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.ready = false;
    this.starting = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.exiting = new Promise((resolve) => child.once("close", resolve));
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    this.startTimer = setTimeout(
      () => this.fail(forwardingError("SIDECAR_VERSION"), child),
      this.startTimeout,
    );
    child.stdout.on("data", (chunk) => {
      if (this.child !== child) return;
      try {
        buffer += decoder.write(chunk);
        if (Buffer.byteLength(buffer) > 512 * 1024)
          throw forwardingError("PROTOCOL_ERROR");
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          if (Buffer.byteLength(line) > 256 * 1024)
            throw forwardingError("PROTOCOL_ERROR");
          this.receive(JSON.parse(line));
        }
      } catch (error) {
        this.fail(
          error?.errorCode ? error : forwardingError("PROTOCOL_ERROR"),
          child,
        );
      }
    });
    // Drain diagnostics without retaining or logging possible remote content or credentials.
    child.stderr.on("data", () => {});
    child.stdin.on("error", () =>
      this.fail(forwardingError("SIDECAR_EXITED"), child),
    );
    child.once("error", () =>
      this.fail(forwardingError("SIDECAR_START"), child),
    );
    child.once("close", () =>
      this.fail(
        forwardingError(this.ready ? "SIDECAR_EXITED" : "SIDECAR_VERSION"),
        child,
      ),
    );
    return this.starting;
  }

  fail(error, child = this.child) {
    if (!child || this.child !== child) return;
    this.child = null;
    this.ready = false;
    clearTimeout(this.startTimer);
    this.rejectReady?.(error);
    this.resolveReady = this.rejectReady = null;
    this.starting = null;
    for (const pending of [...this.pending.values()])
      this.settle(pending.id, error);
    for (const session of this.sessions.values()) session.controller.abort();
    this.sessions.clear();
    try {
      child.kill();
    } catch {
      /* Process already exited. */
    }
    if (!this.stopping) this.emit("disconnected", error);
  }

  receive(message) {
    if (message?.kind === "ready" && message.schemaVersion !== 1)
      throw forwardingError("SIDECAR_VERSION");
    if (!message || message.schemaVersion !== 1)
      throw forwardingError("PROTOCOL_ERROR");
    if (message.kind === "ready") {
      if (
        this.ready ||
        message.prototype !== false ||
        ![
          "local",
          "remote",
          "socks5",
          "addRules",
          "removeRule",
          "keyboardInteractive",
          "agent",
          "connections",
        ].every((c) => message.capabilities?.includes(c))
      ) {
        throw forwardingError("SIDECAR_VERSION");
      }
      this.ready = true;
      clearTimeout(this.startTimer);
      this.resolveReady?.();
      this.resolveReady = this.rejectReady = null;
      return;
    }
    if (
      !this.ready ||
      typeof message.requestId !== "string" ||
      typeof message.sessionId !== "string" ||
      !Number.isSafeInteger(message.generation)
    )
      throw forwardingError("PROTOCOL_ERROR");
    if (message.kind === "event" || message.kind === "auth") {
      const session = this.sessions.get(message.sessionId);
      if (
        !session ||
        session.generation !== message.generation ||
        session.requestId !== message.requestId
      )
        return;
      if (message.kind === "auth") {
        if (
          !Number.isSafeInteger(message.challengeId) ||
          message.challengeId !== session.challenge + 1 ||
          !Array.isArray(message.prompts) ||
          message.prompts.length > 32 ||
          message.prompts.some(
            (p) => typeof p.prompt !== "string" || typeof p.echo !== "boolean",
          )
        )
          throw forwardingError("PROTOCOL_ERROR");
        session.challenge = message.challengeId;
        void Promise.resolve()
          .then(() =>
            session.onAuth?.({ ...message, signal: session.controller.signal }),
          )
          .then((answers) => {
            if (
              session.controller.signal.aborted ||
              this.sessions.get(message.sessionId) !== session
            )
              return;
            if (
              !Array.isArray(answers) ||
              answers.length !== message.prompts.length ||
              answers.some((a) => typeof a !== "string")
            )
              throw forwardingError("AUTH_FAILED");
            return this.request(
              "authResponse",
              message.sessionId,
              message.generation,
              { challengeId: message.challengeId, answers },
            );
          })
          .catch(() => {
            void this.closeSession(message.sessionId, message.generation).catch(
              () => {},
            );
          });
      } else {
        if (!["connections", "closed", "disconnected"].includes(message.state))
          throw forwardingError("PROTOCOL_ERROR");
        if (
          message.state === "connections" &&
          (typeof message.ruleId !== "string" ||
            !Number.isSafeInteger(message.activeConnections) ||
            message.activeConnections < 0 ||
            message.activeConnections > 32)
        )
          throw forwardingError("PROTOCOL_ERROR");
        if (message.state !== "connections") {
          session.controller.abort();
          this.sessions.delete(message.sessionId);
        }
        this.emit("event", message);
      }
      return;
    }
    const pending = this.pending.get(message.requestId);
    if (!pending) {
      if (this.completed.has(message.requestId)) return;
      throw forwardingError("PROTOCOL_ERROR");
    }
    if (
      message.sessionId !== pending.sessionId ||
      message.generation !== pending.generation ||
      !["result", "error"].includes(message.kind)
    )
      throw forwardingError("PROTOCOL_ERROR");
    if (message.kind === "error") {
      if (
        typeof message.errorCode !== "string" ||
        typeof message.retryable !== "boolean"
      )
        throw forwardingError("PROTOCOL_ERROR");
      this.settle(message.requestId, forwardingError(message.errorCode));
    } else {
      if (pending.rules) {
        const bindings = message.bindings;
        if (
          !Array.isArray(bindings) ||
          bindings.length !== pending.rules.length ||
          new Set(bindings.map((b) => b.id)).size !== bindings.length ||
          bindings.some(
            (b) =>
              !pending.rules.some(
                (r) =>
                  r.id === b.id &&
                  r.type === b.type &&
                  r.listenHost === b.host &&
                  (!r.listenPort || r.listenPort === b.port),
              ) ||
              !Number.isInteger(b.port) ||
              b.port < 1 ||
              b.port > 65535,
          )
        )
          throw forwardingError("PROTOCOL_ERROR");
      }
      this.settle(message.requestId, null, message);
    }
  }

  settle(id, error, value) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    pending.signal?.removeEventListener("abort", pending.abort);
    this.completed.add(id);
    if (this.completed.size > 512)
      this.completed.delete(this.completed.values().next().value);
    if (error) pending.reject(error);
    else pending.resolve(value);
  }

  async request(kind, sessionId, generation, extra = {}, options = {}) {
    await this.ensureReady();
    if (options.signal?.aborted) throw forwardingError("CANCELLED");
    if (this.pending.size >= 128) throw forwardingError("BUSY");
    const id = `pf-${++this.sequence}`;
    const bytes = Buffer.from(
      `${JSON.stringify({ schemaVersion: 1, kind, requestId: id, sessionId, generation, ...extra })}\n`,
    );
    if (bytes.length > 256 * 1024) throw forwardingError("INVALID_CONFIG");
    const child = this.child;
    if (!child || child.stdin.writableLength + bytes.length > 1024 * 1024)
      throw forwardingError("BUSY");
    return new Promise((resolve, reject) => {
      const pending = {
        id,
        resolve,
        reject,
        sessionId,
        generation,
        rules: extra.rules,
        signal: options.signal,
      };
      pending.timer = setTimeout(
        () => this.fail(forwardingError("CONNECT_TIMEOUT"), child),
        options.timeout || this.requestTimeout,
      );
      pending.abort = () => {
        this.settle(id, forwardingError("CANCELLED"));
        void this.closeSession(sessionId, generation).catch(() => {});
      };
      this.pending.set(id, pending);
      options.signal?.addEventListener("abort", pending.abort, { once: true });
      if (kind === "start")
        this.sessions.set(sessionId, {
          generation,
          requestId: id,
          challenge: 0,
          controller: new AbortController(),
          onAuth: options.onAuth,
        });
      // Bound the writable queue and use its write callback; no unbounded side queue.
      child.stdin.write(bytes, (error) => {
        if (error) this.fail(forwardingError("SIDECAR_EXITED"), child);
      });
    });
  }

  start(sessionId, generation, ssh, rules, options = {}) {
    return this.request(
      "start",
      sessionId,
      generation,
      { ssh, rules },
      { ...options, timeout: ssh.keyboardInteractive ? 310000 : 40000 },
    );
  }
  addRules(sessionId, generation, rules) {
    return this.request("addRules", sessionId, generation, { rules });
  }
  removeRule(sessionId, generation, ruleId) {
    return this.request("removeRule", sessionId, generation, { ruleId });
  }
  async closeSession(sessionId, generation) {
    const session = this.sessions.get(sessionId);
    if (session && session.generation === generation)
      session.controller.abort();
    if (!this.child) return;
    const result = await this.request("closeSession", sessionId, generation);
    if (this.sessions.get(sessionId) === session)
      this.sessions.delete(sessionId);
    return result;
  }
  async stop() {
    this.stopping = true;
    for (const session of this.sessions.values()) session.controller.abort();
    const child = this.child;
    if (child) {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 3500);
      await this.exiting;
      clearTimeout(timer);
      this.fail(forwardingError("CANCELLED"), child);
    } else if (this.exiting) await this.exiting;
    this.stopping = false;
  }
}

module.exports = { NativePortForwardingClient, forwardingError };
