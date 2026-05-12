import { TerminalWriteQueue } from "../../../utils/TerminalWriteQueue.js";
import terminalIOMailboxProtocol from "./terminalIOMailboxProtocol.js";

const { TERMINAL_IO_DEFAULTS, TERMINAL_IO_MESSAGE_TYPES } =
  terminalIOMailboxProtocol;

const MAX_TERMINAL_WRITE_CHARS = 32 * 1024;

const normalizeGeometry = (cols, rows) => ({
  cols: Math.max(1, Math.floor(Number(cols) || 1)),
  rows: Math.max(1, Math.floor(Number(rows) || 1)),
});

const splitTerminalWriteChunks = (data) => {
  if (!data) {
    return [];
  }

  const dataStr = typeof data === "string" ? data : data.toString();
  if (dataStr.length <= MAX_TERMINAL_WRITE_CHARS) {
    return [dataStr];
  }

  const chunks = [];
  for (
    let index = 0;
    index < dataStr.length;
    index += MAX_TERMINAL_WRITE_CHARS
  ) {
    chunks.push(dataStr.slice(index, index + MAX_TERMINAL_WRITE_CHARS));
  }
  return chunks;
};

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
    this.pendingWriteChunks = [];
    this.pendingWriteBytes = 0;
    this.activeWrite = null;
    this.writeEpoch = 0;
    this.destroyed = false;

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
    this.pumpTerminalWrites();
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

  measureByteLength(data) {
    if (!data) {
      return 0;
    }

    if (this.textEncoder) {
      return this.textEncoder.encode(data).length;
    }

    try {
      return new Blob([data]).size;
    } catch {
      return data.length;
    }
  }

  handleDrain(data) {
    if (!data) {
      return;
    }

    const processIdForAck = this.processId;
    const chunks = splitTerminalWriteChunks(data);
    if (chunks.length === 0) {
      return;
    }

    if (!this.term) {
      const byteLength = chunks.reduce(
        (total, chunk) => total + this.measureByteLength(chunk),
        0,
      );
      if (byteLength > 0) {
        this.queueOutputAck(processIdForAck, byteLength);
      }
      return;
    }

    for (const chunk of chunks) {
      const byteLength = this.measureByteLength(chunk);
      if (byteLength <= 0) {
        continue;
      }
      this.pendingWriteChunks.push({
        data: chunk,
        byteLength,
        processId: processIdForAck,
      });
      this.pendingWriteBytes += byteLength;
    }

    this.pumpTerminalWrites();
  }

  pumpTerminalWrites() {
    if (
      this.destroyed ||
      this.activeWrite !== null ||
      !this.term ||
      this.pendingWriteChunks.length === 0
    ) {
      return;
    }

    const nextWrite = this.pendingWriteChunks.shift();
    this.pendingWriteBytes = Math.max(
      0,
      this.pendingWriteBytes - nextWrite.byteLength,
    );

    const epoch = this.writeEpoch;
    const startTime =
      typeof performance !== "undefined" &&
      typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    this.activeWrite = {
      ...nextWrite,
      epoch,
      startTime,
    };

    const onWriteComplete = () => {
      const completedWrite = this.activeWrite;
      if (
        !completedWrite ||
        completedWrite.epoch !== epoch ||
        completedWrite.data !== nextWrite.data
      ) {
        return;
      }

      this.activeWrite = null;

      const endTime =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();

      if (typeof this.onWriteComplete === "function") {
        this.onWriteComplete({
          data: completedWrite.data,
          byteLength: completedWrite.byteLength,
          duration: endTime - completedWrite.startTime,
          processId: completedWrite.processId,
        });
      }

      if (completedWrite.byteLength > 0) {
        this.queueOutputAck(
          completedWrite.processId,
          completedWrite.byteLength,
        );
      }

      this.pumpTerminalWrites();
    };

    try {
      this.term.write(nextWrite.data, onWriteComplete);
    } catch {
      this.activeWrite = null;
      this.queueOutputAck(nextWrite.processId, nextWrite.byteLength);
      this.pumpTerminalWrites();
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

    this.clearOutputQueue();
    this.flushOutputAck();
    this.resetResizeState();
    this.processId = null;
  }

  clearOutputQueue() {
    const processIdForAck = this.processId;
    const queuedBytes = this.writeQueue.getQueuedByteLength((chunk) =>
      this.measureByteLength(chunk),
    );
    const pendingWriteBytes = this.pendingWriteBytes;
    const activeWrite = this.activeWrite;

    this.writeQueue.clear();
    this.pendingWriteChunks = [];
    this.pendingWriteBytes = 0;
    this.activeWrite = null;
    this.writeEpoch += 1;

    const activeWriteBytes =
      activeWrite && activeWrite.processId === processIdForAck
        ? activeWrite.byteLength
        : 0;
    const bytesToAck = queuedBytes + pendingWriteBytes + activeWriteBytes;

    if (bytesToAck > 0) {
      this.queueOutputAck(processIdForAck, bytesToAck);
    }
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
    this.destroyed = true;
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
