/**
 * 仅用于性能监控的轻量滚回统计器。
 * 不保留行内容，避免与 xterm 的 scrollback 重复占用内存。
 */
import { DEFAULT_TERMINAL_SCROLLBACK_LINES } from "../model/terminalScrollback.js";

export class ScrollbackUsageTracker {
  constructor(options = {}) {
    // 单一来源：默认值见 model/terminalScrollback.js（与终端创建/设置项共享）
    this._maxLines = Math.max(
      1,
      Math.floor(Number(options.maxLines)) || DEFAULT_TERMINAL_SCROLLBACK_LINES,
    );
    this.onChange =
      typeof options.onChange === "function" ? options.onChange : null;

    this.lineByteQueue = [];
    this.lineByteHead = 0;
    this.totalLineBytes = 0;
    this.partialLineBytes = 0;
    this.textEncoder =
      typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  }

  get maxLines() {
    return this._maxLines;
  }

  set maxLines(value) {
    const next = Math.max(1, Math.floor(Number(value)) || this._maxLines);
    if (next === this._maxLines) return;
    const retained = [];
    const count = this.lineByteQueue.length;
    const start = Math.max(0, count - next);
    let total = 0;
    for (let i = start; i < count; i++) {
      const bytes = this.lineByteQueue[(this.lineByteHead + i) % count];
      retained.push(bytes);
      total += bytes;
    }
    this._maxLines = next;
    this.lineByteQueue = retained;
    this.lineByteHead = 0;
    this.totalLineBytes = total;
  }

  addData(data) {
    if (data === undefined || data === null) {
      return;
    }

    const text = typeof data === "string" ? data : data.toString();
    if (!text) {
      return;
    }

    let segmentStart = 0;
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      if (charCode !== 10 && charCode !== 13) {
        continue;
      }

      const isCrlf = charCode === 13 && text.charCodeAt(i + 1) === 10;
      const segment = text.slice(segmentStart, i);
      const lineEnding = isCrlf ? "\r\n" : text[i];
      const lineBytes =
        this.partialLineBytes +
        this.getByteLength(segment) +
        this.getByteLength(lineEnding);

      this.pushLine(lineBytes);
      this.partialLineBytes = 0;
      segmentStart = isCrlf ? i + 2 : i + 1;

      if (isCrlf) {
        i += 1;
      }
    }

    if (segmentStart < text.length) {
      this.partialLineBytes += this.getByteLength(text.slice(segmentStart));
    }

    this.emitChange();
  }

  pushLine(lineBytes) {
    const normalized = Math.max(0, Math.floor(Number(lineBytes)) || 0);
    if (this.lineByteQueue.length === this.maxLines) {
      this.totalLineBytes -= this.lineByteQueue[this.lineByteHead];
      this.lineByteQueue[this.lineByteHead] = normalized;
      this.lineByteHead = (this.lineByteHead + 1) % this.maxLines;
    } else {
      this.lineByteQueue.push(normalized);
    }
    this.totalLineBytes += normalized;
  }

  getByteLength(value) {
    if (!value) {
      return 0;
    }

    if (this.textEncoder) {
      return this.textEncoder.encode(value).length;
    }

    try {
      return new Blob([value]).size;
    } catch {
      return String(value).length;
    }
  }

  getLineCount() {
    return this.lineByteQueue.length + (this.partialLineBytes > 0 ? 1 : 0);
  }

  getBufferSize() {
    return this.totalLineBytes + this.partialLineBytes;
  }

  getUsagePercent() {
    return (this.getLineCount() / this.maxLines) * 100;
  }

  emitChange() {
    if (!this.onChange) {
      return;
    }

    this.onChange({
      totalLines: this.getLineCount(),
      bufferSize: this.getBufferSize(),
      usagePercent: this.getUsagePercent(),
      maxLines: this.maxLines,
    });
  }

  clear() {
    this.lineByteQueue = [];
    this.lineByteHead = 0;
    this.totalLineBytes = 0;
    this.partialLineBytes = 0;
    this.emitChange();
  }

  destroy() {
    this.clear();
    this.onChange = null;
  }
}

export default ScrollbackUsageTracker;
