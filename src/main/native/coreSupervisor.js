/**
 * Supervisor for the resident `simpleshell-core` processes.
 *
 * One core process per role hosts every native service as a stream. Callers
 * get a child-process-compatible object from `spawnCoreService(service, args)`:
 * `stdin` / `stdout` / `stderr` are real Node streams and the object emits
 * `spawn`, `error`, `exit` and `close` like `child_process.spawn`. Existing
 * NDJSON clients therefore keep their protocol code; only process ownership
 * moved here.
 *
 * Failure policy:
 *  - a stream that errors or panics exits alone (the core keeps running);
 *  - if the core process dies, every open stream exits with the core's
 *    code/signal and clients run their normal restart/recovery paths;
 *  - the next spawn restarts the core, with exponential backoff after crashes;
 *  - an unanswered ping marks the core as hung and kills it.
 *
 * AI, latency and IP lookup run in a separate `aux` core so a fault there
 * cannot interrupt terminal or transfer streams.
 */
const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { Readable, Writable, finished } = require("node:stream");
const { logToFile } = require("../utils/logger");
const { recordCrashMarker } = require("../utils/crashReporter");
const { getNativeServicesHostPath } = require("./nativeServices");
const {
  CORE_SCHEMA_VERSION,
  FRAME_KIND,
  encodeControl,
  encodeData,
  encodeEvent,
  FrameDecoder,
  parseControl,
} = require("./coreProtocol");

const AUX_SERVICES = new Set(["ai-serve", "latency-serve", "ip-query-serve"]);
const RESTART_BACKOFF_BASE_MS = 250;
const RESTART_BACKOFF_MAX_MS = 5000;
const CRASH_WINDOW_MS = 60_000;
const PING_INTERVAL_MS = 15_000;
const PING_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 2000;
const DISPATCH_BUDGET_MS = 8;

/** A service stream presented with the `ChildProcess` surface clients use. */
class CoreStreamProcess extends EventEmitter {
  constructor(supervisor, id, service) {
    super();
    this._supervisor = supervisor;
    this.streamId = id;
    this.service = service;
    this.pid = undefined;
    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    this._exited = false;
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
    this.stdin = new Writable({
      write: (chunk, _encoding, callback) => {
        if (this._exited) return callback();
        supervisor._sendData(id, chunk, callback);
      },
      final: (callback) => {
        if (!this._exited) supervisor._sendControl({ op: "eof", stream: id });
        callback();
      },
    });
  }

  /** Sends a stream-scoped JSON event to the service. */
  sendEvent(event) {
    if (this._exited) return false;
    this._supervisor._write(encodeEvent(this.streamId, event));
    return true;
  }

  kill() {
    if (this._exited) return false;
    this.killed = true;
    this._supervisor._sendControl({ op: "kill", stream: this.streamId });
    return true;
  }

  _data(payload) {
    if (!this._exited) this.stdout.push(payload);
  }

  _stderr(payload) {
    if (!this._exited) this.stderr.push(payload);
  }

  _event(event) {
    if (!this._exited) this.emit("event", event);
  }

  _finish(code, signal, errorText) {
    if (this._exited) return;
    this._exited = true;
    this.exitCode = code;
    this.signalCode = signal;
    if (errorText) this.stderr.push(Buffer.from(`${errorText}\n`, "utf8"));
    this.emit("exit", code, signal);
    let open = 2;
    const done = () => {
      open -= 1;
      if (open === 0) this.emit("close", code, signal);
    };
    for (const stream of [this.stdout, this.stderr]) {
      finished(stream, done);
      // Unread stdio must still end, as it does for a real child process.
      if (stream.readableFlowing === null) stream.resume();
      stream.push(null);
    }
    this.stdin.destroy();
  }

  _fail(error) {
    if (this._exited) return;
    this.emit("error", error);
    this._finish(null, null, null);
  }
}

class CoreSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.role = options.role || "core";
    this._locate = options.locate || getNativeServicesHostPath;
    this._spawn = options.spawn || spawn;
    this._log = options.log || logToFile;
    this._pingIntervalMs = options.pingIntervalMs ?? PING_INTERVAL_MS;
    this._pingTimeoutMs = options.pingTimeoutMs ?? PING_TIMEOUT_MS;
    this._process = null;
    this._decoder = null;
    this._inbox = [];
    this._draining = false;
    this._inboxPaused = false;
    this._drainTimer = null;
    this._turnDeadline = null;
    this._streams = new Map();
    this._nextStreamId = 1;
    this._pendingWrites = [];
    this._restartTimer = null;
    this._crashTimes = [];
    this._pingTimer = null;
    this._pingId = 0;
    this._awaitingPong = null;
    this._shuttingDown = false;
    this._started = false;
    this.ready = null;
    this.restarts = 0;
  }

  /** Starts a service stream; mirrors `child_process.spawn(host, [service, ...args])`. */
  spawnService(service, args = []) {
    const id = this._nextStreamId;
    this._nextStreamId = (this._nextStreamId % 0xffffffff) + 1;
    const stream = new CoreStreamProcess(this, id, service);
    this._shuttingDown = false;

    if (!this._ensureProcess()) {
      const error = Object.assign(
        new Error(`simpleshell-core is not available for ${service}`),
        {
          code: "ENOENT",
        },
      );
      process.nextTick(() => stream._fail(error));
      return stream;
    }
    stream.pid = this._process?.pid;
    this._streams.set(id, stream);
    this._updateRef();
    this._sendControl({
      op: "open",
      stream: id,
      service,
      args: args.map(String),
    });
    process.nextTick(() => {
      if (!stream._exited) stream.emit("spawn");
    });
    return stream;
  }

  getStats() {
    return {
      role: this.role,
      pid: this._process?.pid || null,
      running: Boolean(this._process),
      openStreams: this._streams.size,
      restarts: this.restarts,
      version: this.ready?.version || null,
    };
  }

  _startProcess() {
    const binary = this._locate();
    if (!binary) return false;
    let child;
    try {
      child = this._spawn(binary, ["serve", "--role", this.role], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      this._log(`Core(${this.role}) spawn failed: ${error.message}`, "ERROR");
      return false;
    }
    this._process = child;
    this._decoder = new FrameDecoder();
    this._inbox = [];
    this._inboxPaused = false;
    this.ready = null;
    if (this._started) this.restarts += 1;
    this._started = true;
    for (const stream of this._streams.values()) stream.pid = child.pid;
    child.stdout.on("data", (chunk) => this._onFrames(child, chunk));
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim();
      if (text) this._log(`Core(${this.role}) stderr: ${text}`, "WARN");
    });
    child.stdin.on("error", (error) => {
      this._log(`Core(${this.role}) stdin error: ${error.message}`, "WARN");
    });
    child.on("error", (error) => this._onProcessGone(child, null, null, error));
    child.on("exit", (code, signal) =>
      this._onProcessGone(child, code, signal, null),
    );
    for (const frame of this._pendingWrites.splice(0)) child.stdin.write(frame);
    this._updateRef();
    this._schedulePing();
    this._log(
      `Core(${this.role}) started pid=${child.pid || "unknown"}`,
      "INFO",
    );
    return true;
  }

  // `callback` runs once the core pipe accepted the frame, or on its next
  // `drain` when it is applying backpressure, as a child process stdin would.
  _write(frame, callback) {
    const stdin = this._process?.stdin;
    if (!stdin?.writable) {
      this._pendingWrites.push(frame);
      callback?.();
      return;
    }
    if (stdin.write(frame) || !callback) {
      callback?.();
      return;
    }
    const child = this._process;
    const release = () => {
      stdin.removeListener("drain", release);
      child.removeListener("exit", release);
      callback();
    };
    stdin.once("drain", release);
    child.once("exit", release);
  }

  _sendControl(message) {
    this._write(encodeControl(message));
  }

  _sendData(id, chunk, callback) {
    const frames = encodeData(id, chunk);
    frames.forEach((frame, index) =>
      this._write(frame, index === frames.length - 1 ? callback : undefined),
    );
  }

  _onFrames(child, chunk) {
    if (child !== this._process) return;
    try {
      this._inbox.push(...this._decoder.push(chunk));
    } catch (error) {
      this._log(
        `Core(${this.role}) sent an invalid frame: ${error.message}`,
        "ERROR",
      );
      child.kill();
      return;
    }
    this._drainInbox(child);
  }

  // Frame dispatch has a time budget per event-loop iteration. Once spent,
  // the core pipe stays paused and dispatch resumes in the next iteration's
  // timers phase, so timers and other I/O always get a turn while one busy
  // stream floods the core.
  _drainInbox(child) {
    if (this._draining || child !== this._process) return;
    this._draining = true;
    try {
      while (this._inbox.length && child === this._process) {
        if (this._turnBudgetSpent()) {
          this._deferDrain(child);
          return;
        }
        if (!this._dispatchFrame(child, this._inbox.shift())) return;
      }
      if (this._inboxPaused && child === this._process) {
        this._inboxPaused = false;
        child.stdout.resume();
      }
    } finally {
      this._draining = false;
    }
  }

  _turnBudgetSpent() {
    const now = performance.now();
    if (this._turnDeadline === null) {
      this._turnDeadline = now + DISPATCH_BUDGET_MS;
      // The check phase ends this iteration's budget.
      setImmediate(() => {
        this._turnDeadline = null;
      });
      return false;
    }
    return now >= this._turnDeadline;
  }

  _deferDrain(child) {
    if (!this._inboxPaused) {
      this._inboxPaused = true;
      child.stdout.pause();
    }
    if (this._drainTimer) return;
    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      this._drainInbox(child);
    }, 0);
  }

  _dispatchFrame(child, frame) {
    if (frame.kind === FRAME_KIND.DATA) {
      this._streams.get(frame.stream)?._data(frame.payload);
      return true;
    }
    if (frame.kind === FRAME_KIND.STDERR) {
      this._streams.get(frame.stream)?._stderr(frame.payload);
      return true;
    }
    if (frame.kind === FRAME_KIND.EVENT) {
      let event;
      try {
        event = JSON.parse(frame.payload.toString("utf8"));
      } catch {
        this._log(`Core(${this.role}) sent an invalid stream event`, "WARN");
        return true;
      }
      this._streams.get(frame.stream)?._event(event);
      return true;
    }
    let message;
    try {
      message = parseControl(frame.payload);
    } catch (error) {
      this._log(
        `Core(${this.role}) control rejected: ${error.message}`,
        "ERROR",
      );
      child.kill();
      return false;
    }
    this._onControl(message);
    return true;
  }

  _onControl(message) {
    switch (message.op) {
      case "ready":
        this.ready = message;
        this.emit("ready", message);
        break;
      case "exit": {
        const stream = this._streams.get(message.stream);
        if (!stream) break;
        this._streams.delete(message.stream);
        this._updateRef();
        stream._finish(
          message.code ?? null,
          message.signal ?? null,
          message.error || null,
        );
        this._schedulePing();
        break;
      }
      case "pong":
        if (this._awaitingPong?.id === message.id) {
          clearTimeout(this._awaitingPong.timer);
          this._awaitingPong = null;
        }
        break;
      case "error":
        this._log(`Core(${this.role}) reported: ${message.message}`, "WARN");
        break;
      default:
        this._log(
          `Core(${this.role}) unexpected control op: ${message.op}`,
          "WARN",
        );
    }
  }

  // An idle core must not keep the host process alive; open streams do.
  _updateRef() {
    const child = this._process;
    if (!child) return;
    const method = this._streams.size > 0 ? "ref" : "unref";
    for (const handle of [child, child.stdin, child.stdout, child.stderr]) {
      handle?.[method]?.();
    }
  }

  _schedulePing() {
    if (this._pingTimer || !this._pingIntervalMs) return;
    this._pingTimer = setTimeout(() => {
      this._pingTimer = null;
      if (!this._process || this._streams.size === 0 || this._awaitingPong)
        return;
      const id = ++this._pingId;
      const child = this._process;
      const timer = setTimeout(() => {
        if (this._process !== child) return;
        this._log(
          `Core(${this.role}) did not answer ping ${id}; restarting`,
          "ERROR",
        );
        child.kill();
      }, this._pingTimeoutMs);
      timer.unref?.();
      this._awaitingPong = { id, timer };
      this._sendControl({ op: "ping", id });
      this._schedulePing();
    }, this._pingIntervalMs);
    this._pingTimer.unref?.();
  }

  _onProcessGone(child, code, signal, error) {
    if (child !== this._process) return;
    this._process = null;
    this._decoder = null;
    this._inbox = [];
    this._pendingWrites = [];
    if (this._awaitingPong) clearTimeout(this._awaitingPong.timer);
    this._awaitingPong = null;
    const expected = this._shuttingDown;
    const reason = error
      ? `simpleshell-core failed: ${error.message}`
      : `simpleshell-core exited (code=${code ?? "none"}, signal=${signal || "none"})`;
    const streams = [...this._streams.values()];
    this._streams.clear();
    for (const stream of streams) {
      stream._finish(
        code ?? null,
        signal || (code === null ? "SIGKILL" : null),
        expected ? null : reason,
      );
    }
    if (expected) return;

    this._log(
      `Core(${this.role}) ${reason}; ${streams.length} stream(s) closed`,
      "ERROR",
    );
    recordCrashMarker(null, {
      module: "native-core",
      processType: "native-sidecar",
      type: "sidecar-exit",
      reason,
      exitCode: code,
      signal,
      operation: this.role,
      error: reason,
    });
    const now = Date.now();
    this._crashTimes = this._crashTimes.filter(
      (at) => now - at < CRASH_WINDOW_MS,
    );
    this._crashTimes.push(now);
    this.emit("crash", { code, signal, error, streams: streams.length });
  }

  /** Delay before the next start, growing with recent crashes. */
  _restartDelayMs() {
    const recent = this._crashTimes.filter(
      (at) => Date.now() - at < CRASH_WINDOW_MS,
    ).length;
    if (recent <= 1) return 0;
    return Math.min(
      RESTART_BACKOFF_MAX_MS,
      RESTART_BACKOFF_BASE_MS * 2 ** (recent - 2),
    );
  }

  // Restarts are lazy: the next spawnService starts the core again, after a
  // backoff when it has been crashing. Opens issued meanwhile are queued.
  _ensureProcess() {
    if (this._process || this._restartTimer) return true;
    const delay = this._restartDelayMs();
    if (delay === 0) return this._startProcess();
    if (!this._locate()) return false;
    this._restartTimer = setTimeout(() => {
      this._restartTimer = null;
      if (this._startProcess()) return;
      const streams = [...this._streams.values()];
      this._streams.clear();
      for (const stream of streams) {
        stream._fail(new Error("simpleshell-core could not be restarted"));
      }
    }, delay);
    this._restartTimer.unref?.();
    return true;
  }

  async shutdown() {
    this._shuttingDown = true;
    clearTimeout(this._restartTimer);
    this._restartTimer = null;
    clearTimeout(this._pingTimer);
    this._pingTimer = null;
    const child = this._process;
    if (!child) return;
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // already gone
        }
        resolve();
      }, SHUTDOWN_TIMEOUT_MS);
      timer.unref?.();
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        child.stdin.end(encodeControl({ op: "shutdown" }));
      } catch {
        clearTimeout(timer);
        child.kill();
        resolve();
      }
    });
  }
}

const supervisors = new Map();

function getCoreSupervisor(role = "core") {
  if (!supervisors.has(role))
    supervisors.set(role, new CoreSupervisor({ role }));
  return supervisors.get(role);
}

function roleForService(service) {
  return AUX_SERVICES.has(service) ? "aux" : "core";
}

/** Drop-in for `spawn(hostPath, [service, ...args])`. */
function spawnCoreService(service, args = []) {
  return getCoreSupervisor(roleForService(service)).spawnService(service, args);
}

/**
 * `execFile` analogue for one-shot services: resolves with
 * `{ code, signal, stdout, stderr }` on exit code 0, rejects otherwise.
 */
function execCoreService(service, args = [], options = {}) {
  const { timeoutMs = 0, maxBuffer = 64 * 1024 * 1024, input } = options;
  return new Promise((resolve, reject) => {
    const child = spawnCoreService(service, args);
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let settled = false;
    let failure = null;
    const timer = timeoutMs
      ? setTimeout(() => {
          failure = new Error(`${service} timed out after ${timeoutMs}ms`);
          child.kill();
        }, timeoutMs)
      : null;
    const result = (code, signal) => ({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
    const settle = (error, code = null, signal = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(Object.assign(error, result(code, signal)));
      else resolve(result(code, signal));
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBuffer) {
        failure = new Error(`${service} output exceeded ${maxBuffer} bytes`);
        child.kill();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => settle(error));
    child.on("close", (code, signal) => {
      if (failure) settle(failure, code, signal);
      else if (code === 0) settle(null, code, signal);
      else {
        const text = Buffer.concat(stderr).toString("utf8").trim();
        settle(
          new Error(text || `${service} exited with code ${code}`),
          code,
          signal,
        );
      }
    });
    child.stdin.end(input);
  });
}

async function shutdownCoreSupervisors() {
  await Promise.all(
    [...supervisors.values()].map((supervisor) => supervisor.shutdown()),
  );
}

function getCoreSupervisorStats() {
  return [...supervisors.values()].map((supervisor) => supervisor.getStats());
}

module.exports = {
  CORE_SCHEMA_VERSION,
  AUX_SERVICES,
  CoreSupervisor,
  CoreStreamProcess,
  getCoreSupervisor,
  roleForService,
  spawnCoreService,
  execCoreService,
  shutdownCoreSupervisors,
  getCoreSupervisorStats,
};
