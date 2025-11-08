/**
 * 虚拟滚动缓冲区管理器
 * 用于优化大量终端输出的性能，减少内存占用
 */

export class VirtualScrollBuffer {
  constructor(options = {}) {
    // 配置参数
    this.maxBufferLines = options.maxBufferLines || 10000;        // 最大缓冲行数
    this.visibleLines = options.visibleLines || 30;               // 可见行数
    this.overscanLines = options.overscanLines || 10;             // 预渲染行数（上下各10行）
    this.pruneThreshold = options.pruneThreshold || 0.8;          // 修剪阈值（80%满时触发）
    this.pruneTargetRatio = options.pruneTargetRatio || 0.6;      // 修剪目标比例（修剪到60%）

    // 缓冲区数据
    this.buffer = [];                                             // 行数据缓冲区
    this.currentScrollPosition = 0;                               // 当前滚动位置（行号）
    this.totalLines = 0;                                          // 总行数

    // 虚拟窗口
    this.viewportStart = 0;                                       // 视口起始行
    this.viewportEnd = 0;                                         // 视口结束行

    // 统计信息
    this.stats = {
      totalBytesReceived: 0,        // 总接收字节数
      totalLinesAdded: 0,            // 总添加行数
      totalLinesPruned: 0,           // 总修剪行数
      pruneCount: 0,                 // 修剪次数
      lastPruneTime: 0,              // 上次修剪时间
    };

    // 回调
    this.onBufferChange = options.onBufferChange || null;         // 缓冲区变化回调
    this.onPrune = options.onPrune || null;                       // 修剪回调
  }

  /**
   * 添加数据到缓冲区
   * @param {string} data - 要添加的数据
   * @returns {Array<string>} 新增的行数组
   */
  addData(data) {
    if (!data) return [];

    const dataStr = typeof data === 'string' ? data : data.toString();
    this.stats.totalBytesReceived += dataStr.length;

    // 分割为行（保留换行符信息）
    const lines = this.splitIntoLines(dataStr);

    if (lines.length === 0) return [];

    // 如果缓冲区为空或最后一行已完成，直接添加新行
    if (this.buffer.length === 0 || this.buffer[this.buffer.length - 1].complete) {
      lines.forEach(line => {
        this.buffer.push({
          content: line.content,
          complete: line.complete,
          timestamp: Date.now(),
        });
      });
    } else {
      // 否则，合并到最后一行
      const lastLine = this.buffer[this.buffer.length - 1];
      lastLine.content += lines[0].content;
      lastLine.complete = lines[0].complete;

      // 添加剩余的行
      for (let i = 1; i < lines.length; i++) {
        this.buffer.push({
          content: lines[i].content,
          complete: lines[i].complete,
          timestamp: Date.now(),
        });
      }
    }

    this.totalLines = this.buffer.length;
    this.stats.totalLinesAdded += lines.length;

    // 检查是否需要修剪
    this.checkAndPrune();

    // 触发回调
    if (this.onBufferChange) {
      this.onBufferChange({
        totalLines: this.totalLines,
        newLines: lines.length,
        bufferSize: this.getBufferSize(),
      });
    }

    return lines.map(l => l.content);
  }

  /**
   * 将数据分割为行
   * @param {string} data - 输入数据
   * @returns {Array<Object>} 行对象数组 { content, complete }
   */
  splitIntoLines(data) {
    const lines = [];
    let currentLine = '';
    let i = 0;

    while (i < data.length) {
      const char = data[i];

      if (char === '\n') {
        // 完整的行（包含换行符）
        lines.push({
          content: currentLine + '\n',
          complete: true,
        });
        currentLine = '';
      } else if (char === '\r') {
        // 处理 \r\n 或 \r
        if (i + 1 < data.length && data[i + 1] === '\n') {
          // \r\n
          lines.push({
            content: currentLine + '\r\n',
            complete: true,
          });
          currentLine = '';
          i++; // 跳过 \n
        } else {
          // 单独的 \r（回车，通常表示覆盖当前行）
          lines.push({
            content: currentLine + '\r',
            complete: true,
          });
          currentLine = '';
        }
      } else {
        currentLine += char;
      }

      i++;
    }

    // 如果还有未完成的行
    if (currentLine.length > 0) {
      lines.push({
        content: currentLine,
        complete: false,
      });
    }

    return lines;
  }

  /**
   * 检查并修剪缓冲区
   */
  checkAndPrune() {
    const currentSize = this.buffer.length;

    // 检查是否达到修剪阈值
    if (currentSize >= this.maxBufferLines * this.pruneThreshold) {
      this.prune();
    }
  }

  /**
   * 修剪缓冲区（删除旧行）
   */
  prune() {
    const targetSize = Math.floor(this.maxBufferLines * this.pruneTargetRatio);
    const linesToRemove = this.buffer.length - targetSize;

    if (linesToRemove <= 0) return;

    // 删除最旧的行
    const removed = this.buffer.splice(0, linesToRemove);

    this.totalLines = this.buffer.length;
    this.stats.totalLinesPruned += linesToRemove;
    this.stats.pruneCount++;
    this.stats.lastPruneTime = Date.now();

    // 调整滚动位置
    if (this.currentScrollPosition >= linesToRemove) {
      this.currentScrollPosition -= linesToRemove;
    } else {
      this.currentScrollPosition = 0;
    }

    // 更新视口位置
    this.updateViewport();

    // 触发修剪回调
    if (this.onPrune) {
      this.onPrune({
        linesRemoved: linesToRemove,
        currentSize: this.totalLines,
        targetSize: targetSize,
      });
    }
  }

  /**
   * 更新视口范围
   * @param {number} scrollPosition - 滚动位置（行号）
   */
  updateViewport(scrollPosition = null) {
    if (scrollPosition !== null) {
      this.currentScrollPosition = Math.max(
        0,
        Math.min(scrollPosition, this.totalLines - this.visibleLines)
      );
    }

    // 计算视口范围（包含预渲染区域）
    this.viewportStart = Math.max(0, this.currentScrollPosition - this.overscanLines);
    this.viewportEnd = Math.min(
      this.totalLines,
      this.currentScrollPosition + this.visibleLines + this.overscanLines
    );
  }

  /**
   * 获取视口内的行
   * @returns {Array<Object>} 视口行数组
   */
  getViewportLines() {
    this.updateViewport();

    return this.buffer.slice(this.viewportStart, this.viewportEnd).map((line, index) => ({
      lineNumber: this.viewportStart + index,
      content: line.content,
      complete: line.complete,
      timestamp: line.timestamp,
    }));
  }

  /**
   * 获取指定范围的行
   * @param {number} start - 起始行号
   * @param {number} end - 结束行号
   * @returns {Array<Object>} 行数组
   */
  getLines(start, end) {
    const safeStart = Math.max(0, Math.min(start, this.totalLines));
    const safeEnd = Math.max(safeStart, Math.min(end, this.totalLines));

    return this.buffer.slice(safeStart, safeEnd).map((line, index) => ({
      lineNumber: safeStart + index,
      content: line.content,
      complete: line.complete,
      timestamp: line.timestamp,
    }));
  }

  /**
   * 获取所有行的内容
   * @returns {string} 合并后的内容
   */
  getAllContent() {
    return this.buffer.map(line => line.content).join('');
  }

  /**
   * 获取缓冲区大小（字节）
   * @returns {number} 缓冲区大小
   */
  getBufferSize() {
    return this.buffer.reduce((total, line) => total + line.content.length, 0);
  }

  /**
   * 获取缓冲区使用率
   * @returns {number} 使用率（0-100）
   */
  getUsagePercent() {
    return (this.buffer.length / this.maxBufferLines) * 100;
  }

  /**
   * 获取统计信息
   * @returns {Object} 统计对象
   */
  getStats() {
    return {
      ...this.stats,
      currentLines: this.totalLines,
      maxBufferLines: this.maxBufferLines,
      bufferSize: this.getBufferSize(),
      usagePercent: this.getUsagePercent(),
      viewportStart: this.viewportStart,
      viewportEnd: this.viewportEnd,
      visibleLines: this.viewportEnd - this.viewportStart,
    };
  }

  /**
   * 清空缓冲区
   */
  clear() {
    this.buffer = [];
    this.currentScrollPosition = 0;
    this.totalLines = 0;
    this.viewportStart = 0;
    this.viewportEnd = 0;
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.stats = {
      totalBytesReceived: 0,
      totalLinesAdded: 0,
      totalLinesPruned: 0,
      pruneCount: 0,
      lastPruneTime: 0,
    };
  }

  /**
   * 销毁缓冲区
   */
  destroy() {
    this.clear();
    this.resetStats();
    this.onBufferChange = null;
    this.onPrune = null;
  }
}

export default VirtualScrollBuffer;
