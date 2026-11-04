/**
 * SSH client backed by `simpleshell-core`.
 *
 * Its API follows the ssh2 (npm) `Client` the app was written against —
 * `connect`, `shell`, `exec`, `end`, `destroy`, the `ready` / `error` /
 * `end` / `close` / `keyboard-interactive` events and the `hostVerifier`
 * option — on top of the core's `ssh-connection` and `ssh-channel` streams.
 * The SSH connection itself lives in the core's hub and is shared with SFTP,
 * transfers and port forwarding to the same account.
 *
 * Proxies are resolved by the caller and passed as `options.proxy`; the
 * core opens the tunnel.
 *
 * `shell(window, { pipe: { rules } }, cb)` opens a terminal pipe channel:
 * the core decodes, filters and highlights output, merges stderr, runs
 * ZMODEM in the stream and emits `editorMode` / `zmodem` events. Its output credit is the renderer's: callers pass ACKs
 * on with `grantCredit` and pause reasons with `pauseFor` / `resumeFor`.
 */
const { EventEmitter } = require("node:events");
const { Duplex, Readable } = require("node:stream");
const { spawnCoreService } = require("../../native/coreSupervisor");
const {
  TERMINAL_IO_DEFAULTS,
} = require("../../../shared/contracts/terminalIOMailboxProtocol");

const OS_ERROR_CODES = {
  10061: "ECONNREFUSED",
  111: "ECONNREFUSED",
  61: "ECONNREFUSED",
  10060: "ETIMEDOUT",
  110: "ETIMEDOUT",
  60: "ETIMEDOUT",
  10065: "EHOSTUNREACH",
  113: "EHOSTUNREACH",
  10051: "ENETUNREACH",
  101: "ENETUNREACH",
  11001: "ENOTFOUND",
};

/** An Error shaped like ssh2's (code / level) for the app's classifiers. */
function toSshError(message) {
  const error = new Error(message || "SSH connection failed");
  const os = /os error (\d+)/.exec(error.message);
  if (os && OS_ERROR_CODES[os[1]]) {
    error.code = OS_ERROR_CODES[os[1]];
  } else if (/timed out/i.test(error.message)) {
    error.code = "ETIMEDOUT";
  } else if (
    /failed to lookup address|no such host|name resolution/i.test(error.message)
  ) {
    error.code = "ENOTFOUND";
  }
  if (/authentication/i.test(error.message)) {
    error.level = "client-authentication";
  } else if (/host key verification failed/i.test(error.message)) {
    error.level = "client-host-verification";
  } else if (error.code === "ETIMEDOUT") {
    error.level = "client-timeout";
  } else {
    error.level = "client-socket";
  }
  return error;
}

function toNativeConfig(options) {
  const authHandler = Array.isArray(options.authHandler)
    ? options.authHandler
    : null;
  return {
    host: options.host,
    port: options.port || 22,
    username: options.username,
    password: options.password || undefined,
    privateKey: options.privateKey ? String(options.privateKey) : undefined,
    passphrase: options.passphrase || undefined,
    proxy: options.proxy || undefined,
    proxyRequired: options.proxyRequired === true || undefined,
    agent: options.agent || undefined,
    // ssh-utils lists methods explicitly when the agent is only forwarded.
    agentAuth: authHandler ? authHandler.includes("agent") : undefined,
    agentForward: options.agentForward === true,
    tryKeyboard: options.tryKeyboard === true,
    algorithms: options.algorithms || undefined,
    keepaliveIntervalMs: options.keepaliveInterval || undefined,
    keepaliveCountMax: options.keepaliveCountMax || undefined,
    readyTimeoutMs: options.readyTimeout || undefined,
  };
}

/**
 * Output credit per channel. The core reads the SSH channel only while it
 * holds credit, so at most this much output waits in the main process;
 * credit is renewed as readers drain the stream (`_read`).
 */
const CHANNEL_CREDIT_BYTES = 256 * 1024;

/**
 * Pipe channels may have as much unacknowledged text in flight as the
 * renderer mailbox tolerates before it would pause.
 */
const PIPE_CREDIT_BYTES = TERMINAL_IO_DEFAULTS.backpressurePauseThresholdBytes;

/** A shell or exec channel; mirrors ssh2's ClientChannel. */
class NativeSshChannel extends Duplex {
  constructor(core, { pipe = false } = {}) {
    super({ allowHalfOpen: true, emitClose: false });
    this._core = core;
    /** Output is processed terminal text; see the module comment. */
    this.pipeMode = pipe;
    this._flowPaused = false;
    this._exitCode = undefined;
    this._exitSignal = undefined;
    this._closed = false;
    this._granted = CHANNEL_CREDIT_BYTES;
    this._received = 0;
    this.stderr = new Readable({ read: () => this._renewCredit() });
    core.stdout.on("data", (chunk) => {
      this._received += chunk.length;
      this.push(chunk);
    });
    core.stderr.on("data", (chunk) => {
      this._received += chunk.length;
      this.stderr.push(chunk);
    });
    core.on("event", (event) => this._onEvent(event));
    core.on("close", () => this._finish());
    core.on("error", (error) => this.emit("error", error));
  }

  _onEvent(event) {
    if (event.type === "exit") {
      if (event.signal) {
        this._exitSignal = event.signal;
        this.emit(
          "exit",
          null,
          event.signal,
          event.coreDumped === true,
          event.message || "",
        );
      } else {
        this._exitCode = event.code;
        this.emit("exit", event.code);
      }
    } else if (event.type === "eof") {
      this.emit("eof");
    } else if (event.type === "editorMode") {
      this.emit("editorMode", event.active === true);
    } else if (event.type === "zmodem") {
      this.emit("zmodem", event.kind, event.event || {});
    } else if (event.type === "closed") {
      this._finish();
    }
  }

  _finish() {
    if (this._closed) return;
    this._closed = true;
    this.push(null);
    this.stderr.push(null);
    const code = this._exitCode ?? null;
    const signal = this._exitSignal ?? null;
    // Let buffered data reach its readers before `close`, as ssh2 does.
    setImmediate(() => this.emit("close", code, signal));
  }

  /** Initial credit, sent with the `open` request. */
  static initialCredit(pipe) {
    return pipe ? PIPE_CREDIT_BYTES : CHANNEL_CREDIT_BYTES;
  }

  _renewCredit() {
    if (this.pipeMode) return;
    const outstanding = this._granted - this._received;
    if (this._closed || outstanding >= CHANNEL_CREDIT_BYTES / 2) return;
    const grant = CHANNEL_CREDIT_BYTES - outstanding;
    this._granted += grant;
    this._core.sendEvent({ type: "credit", bytes: grant });
  }

  _read() {
    this._renewCredit();
  }

  _write(chunk, _encoding, callback) {
    if (this._closed) return callback();
    this._core.stdin.write(chunk, callback);
  }

  _final(callback) {
    this._core.stdin.end();
    callback();
  }

  _destroy(error, callback) {
    if (!this._closed) this._core.kill();
    callback(error);
  }

  // Terminal flow control: a paused channel stops reading in the core, so
  // the server stops once its window is used (other channels keep flowing).
  pause() {
    super.pause();
    this._setFlowPaused(true);
    return this;
  }

  resume() {
    super.resume();
    this._setFlowPaused(false);
    return this;
  }

  _setFlowPaused(paused) {
    if (this._flowPaused === paused || this._closed) return;
    this._flowPaused = paused;
    this._core.sendEvent({ type: paused ? "pause" : "resume" });
  }

  /** Pipe mode: the renderer consumed `bytes` of output. */
  grantCredit(bytes) {
    const count = Math.floor(Number(bytes));
    if (this._closed || !(count > 0)) return false;
    this._core.sendEvent({ type: "credit", bytes: count });
    return true;
  }

  /** Reading stops until every reason is resumed. */
  pauseFor(reason) {
    if (this._closed) return false;
    this._core.sendEvent({ type: "pause", reason: String(reason) });
    return true;
  }

  resumeFor(reason) {
    if (this._closed) return false;
    this._core.sendEvent({ type: "resume", reason: String(reason) });
    return true;
  }

  /** `zmodemAccept {path}`, `zmodemSend {files}` or `zmodemCancel`. */
  sendZmodem(command) {
    if (this._closed) return false;
    this._core.sendEvent(command);
    return true;
  }

  setWindow(rows, cols, height, width) {
    this._core.sendEvent({ type: "resize", cols, rows, width, height });
    return true;
  }

  signal(name) {
    this._core.sendEvent({ type: "signal", name: String(name) });
    return true;
  }

  close() {
    this._core.sendEvent({ type: "close" });
  }
}

class NativeSshClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this._spawn = options.spawnService || spawnCoreService;
    this._stream = null;
    this._token = null;
    this._options = null;
    this._channels = new Set();
    this._pings = new Map();
    this._nextPing = 1;
    this._ready = false;
    this._closed = false;
    this.destroyed = false;
  }

  connect(options = {}) {
    if (this._stream) throw new Error("NativeSshClient is already connecting");
    this._options = options;
    const stream = this._spawn("ssh-connection");
    this._stream = stream;
    stream.on("event", (event) => this._onEvent(event));
    stream.on("error", (error) => this._fail(error));
    stream.on("close", () => this._onClosed());
    stream.sendEvent({ type: "connect", config: toNativeConfig(options) });
    return this;
  }

  _onEvent(event) {
    switch (event.type) {
      case "hostKey":
        this._verifyHostKey(event);
        break;
      case "keyboard":
        this._answerPrompts(event);
        break;
      case "ready":
        this._token = event.token;
        this._ready = true;
        this.emit("ready");
        break;
      case "pong": {
        const resolve = this._pings.get(event.id);
        this._pings.delete(event.id);
        resolve?.(event.healthy === true);
        break;
      }
      case "error":
        this._fail(toSshError(event.message));
        break;
      default:
        break;
    }
  }

  _verifyHostKey(event) {
    const decide = (trusted) =>
      this._stream?.sendEvent({
        type: "hostKeyDecision",
        id: event.id,
        trusted: trusted === true,
      });
    const verifier = this._options?.hostVerifier;
    if (typeof verifier !== "function") {
      decide(true); // ssh2 accepts any host key without a verifier
      return;
    }
    // With `hostHash: "sha256"` ssh2 passes the hex digest, else the key blob.
    const subject = this._options.hostHash
      ? String(event.fingerprint).replace(/^SHA256:/, "")
      : Buffer.from(event.keyBase64, "base64");
    let answered = false;
    const once = (trusted) => {
      if (answered) return;
      answered = true;
      decide(trusted);
    };
    try {
      const result = verifier(subject, once);
      if (typeof result === "boolean") once(result);
    } catch {
      once(false);
    }
  }

  _answerPrompts(event) {
    const reply = (answers) =>
      this._stream?.sendEvent({
        type: "keyboardAnswers",
        id: event.id,
        answers: Array.isArray(answers) ? answers.map(String) : null,
      });
    if (this.listenerCount("keyboard-interactive") === 0) {
      reply(null);
      return;
    }
    let answered = false;
    this.emit(
      "keyboard-interactive",
      event.name || "",
      event.instructions || "",
      "",
      Array.isArray(event.prompts) ? event.prompts : [],
      (answers) => {
        if (answered) return;
        answered = true;
        reply(answers);
      },
    );
  }

  _fail(error) {
    if (this._closed) return;
    this.emit("error", error);
  }

  _onClosed() {
    if (this._closed) return;
    this._closed = true;
    this.destroyed = true;
    for (const resolve of this._pings.values()) resolve(false);
    this._pings.clear();
    for (const channel of this._channels) channel.destroy();
    this._channels.clear();
    // As with ssh2, `close` follows an `error` on a later turn.
    setImmediate(() => {
      if (this._ready) this.emit("end");
      this.emit("close");
    });
  }

  _openChannel(open, callback) {
    if (!this._ready || this._closed) {
      process.nextTick(callback, new Error("Not connected"));
      return false;
    }
    const core = this._spawn("ssh-channel");
    const pipe = Boolean(open.pipe);
    const channel = new NativeSshChannel(core, { pipe });
    let settled = false;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      core.removeListener("event", onEvent);
      if (error) {
        core.kill();
        callback(error);
      } else {
        this._channels.add(channel);
        channel.once("close", () => this._channels.delete(channel));
        callback(null, channel);
      }
    };
    const onEvent = (event) => {
      if (event.type === "opened") settle(null);
      else if (event.type === "error") settle(new Error(event.message));
    };
    core.on("event", onEvent);
    core.once("close", () =>
      settle(new Error("Channel closed before it opened")),
    );
    core.sendEvent({
      type: "open",
      connection: this._token,
      credit: NativeSshChannel.initialCredit(pipe),
      ...open,
    });
    return true;
  }

  shell(window, options, callback) {
    if (typeof window === "function") {
      callback = window;
      window = {};
      options = {};
    } else if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const pty =
      window === false
        ? null
        : {
            term: window?.term || "vt100",
            cols: window?.cols || 80,
            rows: window?.rows || 24,
            width: window?.width || 0,
            height: window?.height || 0,
          };
    return this._openChannel(
      {
        kind: "shell",
        pty,
        env: options?.env || {},
        agentForward: this._options?.agentForward === true,
        pipe: options?.pipe || undefined,
      },
      callback,
    );
  }

  exec(command, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    const pty = options?.pty
      ? {
          term: options.pty.term || "vt100",
          cols: options.pty.cols || 80,
          rows: options.pty.rows || 24,
        }
      : null;
    return this._openChannel(
      {
        kind: "exec",
        command: String(command),
        pty,
        env: options?.env || {},
        agentForward: this._options?.agentForward === true,
      },
      callback,
    );
  }

  /** Whether `channel` was opened on this client and is still open. */
  ownsChannel(channel) {
    return this._channels.has(channel);
  }

  /** SFTP runs through the core's SFTP service, not the terminal client. */
  sftp(callback) {
    process.nextTick(
      callback,
      new Error("SFTP is served by the native SFTP service"),
    );
    return false;
  }

  /**
   * Transport health: resolves true when a keepalive is answered, or channel
   * data arrived, within `timeoutMs`.
   */
  checkTransport(timeoutMs = 10000) {
    if (!this._ready || this._closed) return Promise.resolve(false);
    const id = this._nextPing++;
    return new Promise((resolve) => {
      this._pings.set(id, resolve);
      this._stream.sendEvent({ type: "ping", id, timeoutMs });
    });
  }

  end() {
    if (!this._stream || this._closed) return;
    for (const channel of this._channels) channel.close();
    this._stream.stdin.end();
  }

  destroy() {
    if (!this._stream || this._closed) return;
    for (const channel of this._channels) channel.destroy();
    this._stream.kill();
  }
}

module.exports = {
  NativeSshClient,
  NativeSshChannel,
  toSshError,
  toNativeConfig,
};
