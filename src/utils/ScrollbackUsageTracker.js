/**
 * 仅用于性能监控的轻量滚回统计器。
 * 不保留行内容，避免与 xterm 的 scrollback 重复占用内存。
 */
export class ScrollbackUsageTracker {
  constructor(options = {}) {
    this.maxLines = Math.max(1, Number(options.maxLines) || 50000);
    this.onChange =
      typeof options.onChange === "function" ? options.onChange : null;

    this.lineByteQueue = [];
    this.totalLineBytes = 0;
    this.partialLineBytes = 0;
    this.textEncoder =
      typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
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
    this.lineByteQueue.push(normalized);
    this.totalLineBytes += normalized;

    while (this.lineByteQueue.length > this.maxLines) {
      this.totalLineBytes -= this.lineByteQueue.shift() || 0;
    }
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
