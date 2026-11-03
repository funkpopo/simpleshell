/**
 * Local programs on a pseudo terminal, run by `simpleshell-core`'s `pty`
 * service (ConPTY on Windows). Mirrors the part of node-pty's `IPty` the app
 * uses — `pid`, `onData`, `onExit`, `write`, `resize`, `kill`, `pause`,
 * `resume` — except that `spawnPty` resolves once the program started (and
 * rejects with a node-style `code` such as `ENOENT` when it cannot).
 */
const { StringDecoder } = require("node:string_decoder");
const { spawnCoreService } = require("./coreSupervisor");

class NativePty {
  constructor(core) {
    this._core = core;
    this._decoder = new StringDecoder("utf8");
    this._dataListeners = new Set();
    this._exitListeners = new Set();
    this._exit = null;
    this._paused = false;
    this.pid = undefined;

    core.stdout.on("data", (chunk) =>
      this._emitData(this._decoder.write(chunk)),
    );
    core.on("event", (event) => {
      if (event.type === "exit") {
        this._finish({
          exitCode: event.exitCode ?? 1,
          signal: event.signal ?? undefined,
        });
      }
    });
    core.on("close", () => this._finish({ exitCode: 1, signal: undefined }));
    core.on("error", () => this._finish({ exitCode: 1, signal: undefined }));
  }

  _emitData(text) {
    if (!text) return;
    for (const listener of this._dataListeners) listener(text);
  }

  _finish(exit) {
    if (this._exit) return;
    this._exit = exit;
    this._emitData(this._decoder.end());
    for (const listener of this._exitListeners) listener(exit);
  }

  _subscribe(listeners, listener) {
    listeners.add(listener);
    return { dispose: () => listeners.delete(listener) };
  }

  onData(listener) {
    return this._subscribe(this._dataListeners, listener);
  }

  onExit(listener) {
    return this._subscribe(this._exitListeners, listener);
  }

  write(data) {
    if (this._exit) return;
    this._core.stdin.write(data);
  }

  resize(cols, rows) {
    if (this._exit) return;
    this._core.sendEvent({ type: "resize", cols, rows });
  }

  kill() {
    if (this._exit) return;
    this._core.sendEvent({ type: "kill" });
  }

  // Terminal flow control: a paused terminal stops reading the program's
  // output, which blocks the program once the terminal buffer is full.
  pause() {
    this._setPaused(true);
  }

  resume() {
    this._setPaused(false);
  }

  _setPaused(paused) {
    if (this._exit || this._paused === paused) return;
    this._paused = paused;
    this._core.sendEvent({ type: paused ? "pause" : "resume" });
  }
}

/**
 * Starts `file` with `args` on a terminal of `cols` x `rows`. `env`
 * replaces the environment; `name` becomes `TERM`.
 */
function spawnPty(file, args = [], options = {}, { spawnService } = {}) {
  const core = (spawnService || spawnCoreService)("pty");
  const pty = new NativePty(core);
  return new Promise((resolve, reject) => {
    const settle = (error) => {
      core.removeListener("event", onEvent);
      core.removeListener("close", onClose);
      if (error) {
        core.kill();
        reject(error);
      } else {
        resolve(pty);
      }
    };
    const onEvent = (event) => {
      if (event.type === "spawned") {
        pty.pid = event.pid;
        settle(null);
      } else if (event.type === "error") {
        settle(
          Object.assign(new Error(event.message), {
            code: event.code,
            path: file,
          }),
        );
      }
    };
    const onClose = () =>
      settle(Object.assign(new Error(`${file} did not start`), { path: file }));
    core.on("event", onEvent);
    core.once("close", onClose);
    core.sendEvent({
      type: "open",
      file: String(file),
      args: (args || []).map(String),
      cwd: options.cwd || undefined,
      env: options.env ? stringEnv(options.env) : undefined,
      cols: options.cols,
      rows: options.rows,
      name: options.name || undefined,
    });
  });
}

function stringEnv(env) {
  const result = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && value !== null) result[name] = String(value);
  }
  return result;
}

module.exports = { spawnPty, NativePty };
