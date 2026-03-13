import { TerminalWriteQueue } from "../../../utils/TerminalWriteQueue.js";
import terminalIOMailboxProtocol from "./terminalIOMailboxProtocol.js";

const { TERMINAL_IO_DEFAULTS, TERMINAL_IO_MESSAGE_TYPES } =
  terminalIOMailboxProtocol;

const normalizeGeometry = (cols, rows) => ({
  cols: Math.max(1, Math.floor(Number(cols) || 1)),
  rows: Math.max(1, Math.floor(Number(rows) || 1)),
});

export class RendererTerminalIOMailbox {
  constructor(options = {}) {
    this.term = options.term || null;
    this.processId = null;
    this.unsubscribe = null;

    this.onOutput = options.onOutput || null;
    this.onWriteComplete = options.onWriteComplete || null;
    this.onQueueOutput = options.onQueueOutput || null;
    this.textEncoder =
      typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

    this.pendingAckBytes = 0;
    this.pendingAckProcessId = null;
    this.ackTimer = null;
    this.pendingResize = null;
    this.lastResize = null;
    this.resizeTimer = null;

    this.writeQueue = new TerminalWriteQueue({
      dispatchThresholdBytes: TERMINAL_IO_DEFAULTS.outputDispatchThresholdBytes,
      dispatchIntervalMs: TERMINAL_IO_DEFAULTS.outputDispatchIntervalMs,
      onDrain: (data) => {
        this.handleDrain(data);
      },
    });
  }

  setTerm(term) {
    this.term = term || null;
  }

  updateHandlers(handlers = {}) {
    if (Object.prototype.hasOwnProperty.call(handlers, "onOutput")) {
      this.onOutput = handlers.onOutput || null;
    }

    if (Object.prototype.hasOwnProperty.call(handlers, "onQueueOutput")) {
      this.onQueueOutput = handlers.onQueueOutput || null;
    }

    if (Object.prototype.hasOwnProperty.call(handlers, "onWriteComplete")) {
      this.onWriteComplete = handlers.onWriteComplete || null;
    }
  }

  getProcessId() {
    return this.processId;
  }

  postMessage(message, processId = this.processId) {
    if (
      processId === undefined ||
      processId === null ||
      !window.terminalAPI?.postTerminalMailboxMessage
    ) {
      return false;
    }

    return window.terminalAPI.postTerminalMailboxMessage(processId, message);
  }

  flushOutputAck() {
    if (this.ackTimer !== null) {
      clearTimeout(this.ackTimer);
      this.ackTimer = null;
    }

    const processId = this.pendingAckProcessId;
    const ackBytes = this.pendingAckBytes;

    this.pendingAckBytes = 0;
    this.pendingAckProcessId = null;

    if (
      processId === undefined ||
      processId === null ||
      !Number.isFinite(ackBytes) ||
      ackBytes <= 0
    ) {
      return false;
    }

    return this.postMessage(
      {
        type: TERMINAL_IO_MESSAGE_TYPES.ACK,
        bytes: ackBytes,
      },
      processId,
    );
  }

  queueOutputAck(processId, byteLength) {
    const normalizedBytes = Math.floor(Number(byteLength));
    if (
      processId === undefined ||
      processId === null ||
      !Number.isFinite(normalizedBytes) ||
      normalizedBytes <= 0
    ) {
      return;
    }

    this.pendingAckProcessId = processId;
    this.pendingAckBytes += normalizedBytes;

    if (this.pendingAckBytes >= TERMINAL_IO_DEFAULTS.ackFlushBytes) {
      this.flushOutputAck();
      return;
    }

    if (this.ackTimer !== null) {
      return;
    }

    this.ackTimer = setTimeout(() => {
      this.ackTimer = null;
      this.flushOutputAck();
    }, TERMINAL_IO_DEFAULTS.ackFlushDelayMs);
  }

  handleDrain(data) {
    if (!this.term || !data) {
      return;
    }

    const processIdForAck = this.processId;
    const byteLength = (() => {
      if (this.textEncoder) {
        return this.textEncoder.encode(data).length;
      }

      try {
        return new Blob([data]).size;
      } catch {
        return data.length;
      }
    })();

    const startTime =
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();

    const onWriteComplete = () => {
      const endTime =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      if (typeof this.onWriteComplete === "function") {
        this.onWriteComplete({
          data,
          byteLength,
          duration: endTime - startTime,
          processId: processIdForAck,
        });
      }

      if (byteLength > 0) {
        this.queueOutputAck(processIdForAck, byteLength);
      }
    };

    try {
      this.term.write(data, onWriteComplete);
    } catch {
      this.term.write(data);
      onWriteComplete();
    }
  }

  handleMailboxMessage(message) {
    if (
      !message ||
      message.type !== TERMINAL_IO_MESSAGE_TYPES.OUTPUT ||
      message.data === undefined ||
      message.data === null
    ) {
      return;
    }

    const data =
      typeof message.data === "string" ? message.data : message.data.toString();
    if (!data) {
      return;
    }

    if (typeof this.onOutput === "function") {
      this.onOutput(data, message, this);
    }

    if (typeof this.onQueueOutput === "function") {
      this.onQueueOutput(data, message, this);
    }

    this.writeQueue.enqueue(data);
  }

  attachProcess(processId) {
    if (this.unsubscribe && String(this.processId) === String(processId)) {
      return;
    }

    this.detachProcess();
    this.processId = processId;
    this.pendingAckProcessId = processId;

    if (!window.terminalAPI?.onTerminalMailboxMessage) {
      return;
    }

    this.unsubscribe = window.terminalAPI.onTerminalMailboxMessage(
      processId,
      (message) => {
        this.handleMailboxMessage(message);
      },
    );
  }

  detachProcess() {
    if (typeof this.unsubscribe === "function") {
      this.unsubscribe();
    }
    this.unsubscribe = null;

    this.flushOutputAck();
    this.clearOutputQueue();
    this.resetResizeState();
    this.processId = null;
  }

  clearOutputQueue() {
    this.writeQueue.clear();
  }

  sendInput(input) {
    if (input === undefined || input === null) {
      return false;
    }

    const inputStr = typeof input === "string" ? input : input.toString();
    if (!inputStr) {
      return false;
    }

    return this.postMessage({
      type: TERMINAL_IO_MESSAGE_TYPES.INPUT,
      data: inputStr,
    });
  }

  requestPause(reason = "renderer") {
    return this.postMessage({
      type: TERMINAL_IO_MESSAGE_TYPES.PAUSE,
      reason,
    });
  }

  requestResume(reason = "renderer") {
    return this.postMessage({
      type: TERMINAL_IO_MESSAGE_TYPES.RESUME,
      reason,
    });
  }

  flushResizeRequest() {
    if (!this.pendingResize) {
      return false;
    }

    const nextResize = this.pendingResize;
    this.pendingResize = null;
    this.lastResize = nextResize;

    return this.postMessage({
      type: TERMINAL_IO_MESSAGE_TYPES.RESIZE,
      cols: nextResize.cols,
      rows: nextResize.rows,
    });
  }

  requestResize(cols, rows, options = {}) {
    const nextResize = normalizeGeometry(cols, rows);

    if (
      !options.force &&
      this.lastResize &&
      this.lastResize.cols === nextResize.cols &&
      this.lastResize.rows === nextResize.rows &&
      this.pendingResize === null
    ) {
      return Promise.resolve(false);
    }

    this.pendingResize = nextResize;

    if (options.immediate === true) {
      if (this.resizeTimer !== null) {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = null;
      }
      return Promise.resolve(this.flushResizeRequest());
    }

    if (this.resizeTimer !== null) {
      return Promise.resolve(true);
    }

    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      this.flushResizeRequest();
    }, TERMINAL_IO_DEFAULTS.resizeDebounceMs);

    return Promise.resolve(true);
  }

  resetResizeState() {
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }

    this.pendingResize = null;
    this.lastResize = null;
  }

  destroy() {
    this.detachProcess();
    this.writeQueue.destroy();
    this.onOutput = null;
    this.onQueueOutput = null;
    this.onWriteComplete = null;
    this.textEncoder = null;
    this.term = null;
  }
}

export default RendererTerminalIOMailbox;
