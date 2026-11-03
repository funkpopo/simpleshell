/**
 * Telnet client backed by `simpleshell-core`'s `telnet` service. Keeps the
 * part of telnet-client's interface the app uses: `connect(params)` (resolves
 * once connected; `username` / `password` answer the first login prompts),
 * `write`, `end`, `destroy` and the `data` / `error` / `end` / `close`
 * events; adds `setWindow(rows, cols)` (NAWS) and terminal flow control.
 */
const { EventEmitter } = require("node:events");
const { spawnCoreService } = require("./coreSupervisor");

class NativeTelnet extends EventEmitter {
  constructor({ spawnService } = {}) {
    super();
    this._spawn = spawnService || spawnCoreService;
    this._core = null;
    this._paused = false;
    this._ended = false;
    this.destroyed = false;
  }

  /**
   * @param {object} params host, port, timeout (ms), username, password,
   *   cols, rows, term
   */
  connect(params = {}) {
    const core = this._spawn("telnet");
    this._core = core;
    return new Promise((resolve, reject) => {
      let connected = false;
      core.stdout.on("data", (chunk) => this.emit("data", chunk));
      core.on("event", (event) => {
        if (event.type === "connected") {
          connected = true;
          resolve();
        } else if (event.type === "error") {
          const error = Object.assign(new Error(event.message), {
            code: event.code,
          });
          if (connected) this.emit("error", error);
          else reject(error);
        } else if (event.type === "end") {
          this._emitEnd();
        }
      });
      core.on("close", () => {
        if (!connected) {
          reject(new Error("telnet session closed before connecting"));
        }
        this._emitEnd();
        this.destroyed = true;
        this.emit("close");
      });
      core.sendEvent({
        type: "open",
        host: String(params.host || ""),
        port: Number(params.port) || 23,
        timeoutMs: Number(params.timeout) || undefined,
        username: params.username || undefined,
        password: params.password || undefined,
        cols: params.cols || undefined,
        rows: params.rows || undefined,
        term: params.term || undefined,
      });
    });
  }

  _emitEnd() {
    if (this._ended) return;
    this._ended = true;
    this.emit("end");
  }

  write(data) {
    if (!this._core || this.destroyed) return false;
    this._core.stdin.write(data);
    return true;
  }

  setWindow(rows, cols) {
    if (!this._core || this.destroyed) return false;
    this._core.sendEvent({ type: "resize", cols, rows });
    return true;
  }

  pause() {
    this._setPaused(true);
  }

  resume() {
    this._setPaused(false);
  }

  _setPaused(paused) {
    if (!this._core || this.destroyed || this._paused === paused) return;
    this._paused = paused;
    this._core.sendEvent({ type: paused ? "pause" : "resume" });
  }

  end() {
    if (!this._core || this.destroyed) return;
    this._core.sendEvent({ type: "close" });
  }

  destroy() {
    if (!this._core || this.destroyed) return;
    this.destroyed = true;
    this._core.kill();
  }
}

module.exports = { NativeTelnet };
