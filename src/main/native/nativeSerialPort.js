/**
 * Serial ports through `simpleshell-core` (`serial-port`, `serial-list`).
 * Mirrors the part of serialport's `SerialPort` the app uses: the
 * constructor opens the port (`open` / `error` events), `isOpen`, `write`,
 * `close(callback)`, `destroy`, `data` / `close` events, `pause` / `resume`,
 * and `NativeSerialPort.list()`.
 */
const { EventEmitter } = require("node:events");
const { spawnCoreService, execCoreService } = require("./coreSupervisor");

class NativeSerialPort extends EventEmitter {
  /**
   * @param {object} options path, baudRate, dataBits, stopBits, parity,
   *   flowControl ("none" | "rtscts" | "xonxoff")
   */
  constructor(options = {}, { spawnService } = {}) {
    super();
    this.path = options.path;
    this.isOpen = false;
    this.destroyed = false;
    this._paused = false;
    this._closeCallbacks = [];
    const core = (spawnService || spawnCoreService)("serial-port");
    this._core = core;
    core.stdout.on("data", (chunk) => this.emit("data", chunk));
    core.on("event", (event) => {
      if (event.type === "opened") {
        this.isOpen = true;
        this.emit("open");
      } else if (event.type === "error") {
        this.emit(
          "error",
          Object.assign(new Error(event.message), { code: event.code }),
        );
      }
    });
    core.on("close", () => {
      const wasOpen = this.isOpen;
      this.isOpen = false;
      this.destroyed = true;
      for (const callback of this._closeCallbacks.splice(0)) callback(null);
      if (wasOpen) this.emit("close");
    });
    core.sendEvent({
      type: "open",
      path: String(options.path || ""),
      baudRate: Number(options.baudRate),
      dataBits: options.dataBits,
      stopBits: options.stopBits,
      parity: options.parity,
      flowControl: options.flowControl || "none",
    });
  }

  write(data, callback) {
    if (this.destroyed) {
      callback?.(new Error("Port is not open"));
      return false;
    }
    this._core.stdin.write(data, callback);
    return true;
  }

  close(callback) {
    if (this.destroyed) {
      callback?.(null);
      return;
    }
    if (callback) this._closeCallbacks.push(callback);
    this._core.sendEvent({ type: "close" });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._core.kill();
  }

  pause() {
    this._setPaused(true);
    return this;
  }

  resume() {
    this._setPaused(false);
    return this;
  }

  _setPaused(paused) {
    if (this.destroyed || this._paused === paused) return;
    this._paused = paused;
    this._core.sendEvent({ type: paused ? "pause" : "resume" });
  }

  /** Ports with path, friendlyName, manufacturer, serialNumber, vendorId, productId. */
  static async list() {
    const { stdout } = await execCoreService("serial-list", [], {
      timeoutMs: 15000,
    });
    return JSON.parse(stdout);
  }
}

module.exports = { NativeSerialPort };
