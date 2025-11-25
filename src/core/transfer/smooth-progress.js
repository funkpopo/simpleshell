/**
 * 平滑进度反馈系统
 * 用于提供流畅的文件传输进度显示，避免进度跳跃和速度波动
 */

class SmoothProgress {
  constructor(options = {}) {
    // 配置参数
    this.smoothingFactor = options.smoothingFactor || 0.3; // 进度平滑因子 (0-1)
    this.speedSmoothingFactor = options.speedSmoothingFactor || 0.2; // 速度平滑因子
    this.minUpdateInterval = options.minUpdateInterval || 100; // 最小更新间隔(ms)
    this.speedHistorySize = options.speedHistorySize || 10; // 速度历史记录大小

    // 状态变量
    this.currentProgress = 0; // 当前显示的进度 (0-100)
    this.targetProgress = 0; // 目标进度 (0-100)
    this.rawProgress = 0; // 原始进度

    // 字节统计
    this.totalBytes = 0;
    this.transferredBytes = 0;
    this.lastTransferredBytes = 0;

    // 速度计算
    this.currentSpeed = 0; // 当前平滑速度 (bytes/s)
    this.instantSpeed = 0; // 瞬时速度
    this.speedHistory = []; // 速度历史记录
    this.avgSpeed = 0; // 平均速度

    // 时间统计
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this.lastSpeedCalcTime = this.startTime;

    // 剩余时间估算
    this.remainingTime = 0; // 剩余时间 (秒)
    this.eta = null; // 预计完成时间

    // 动画帧ID (用于requestAnimationFrame)
    this.animationFrameId = null;
    this.isAnimating = false;
  }

  /**
   * 初始化传输
   * @param {number} totalBytes - 总字节数
   */
  initialize(totalBytes) {
    this.totalBytes = totalBytes;
    this.transferredBytes = 0;
    this.lastTransferredBytes = 0;
    this.currentProgress = 0;
    this.targetProgress = 0;
    this.rawProgress = 0;
    this.currentSpeed = 0;
    this.instantSpeed = 0;
    this.speedHistory = [];
    this.avgSpeed = 0;
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this.lastSpeedCalcTime = this.startTime;
    this.remainingTime = 0;
    this.eta = null;
  }

  /**
   * 更新已传输的字节数
   * @param {number} bytes - 新传输的字节数
   * @returns {Object} 更新后的进度信息
   */
  update(bytes) {
    this.transferredBytes += bytes;
    const now = Date.now();

    // 计算原始进度
    this.rawProgress = this.totalBytes > 0
      ? (this.transferredBytes / this.totalBytes) * 100
      : 0;

    // 更新目标进度
    this.targetProgress = Math.min(this.rawProgress, 100);

    // 计算速度 (节流)
    const timeSinceLastCalc = now - this.lastSpeedCalcTime;
    if (timeSinceLastCalc >= this.minUpdateInterval) {
      this._calculateSpeed(now, timeSinceLastCalc);
      this.lastSpeedCalcTime = now;
    }

    // 平滑更新当前进度
    this._smoothProgress();

    // 计算剩余时间
    this._calculateRemainingTime();

    this.lastUpdateTime = now;

    return this.getProgressInfo();
  }

  /**
   * 设置已传输的字节数 (用于断点续传)
   * @param {number} bytes - 已传输的字节数
   */
  setTransferredBytes(bytes) {
    this.transferredBytes = bytes;
    this.lastTransferredBytes = bytes;
    this.rawProgress = this.totalBytes > 0
      ? (this.transferredBytes / this.totalBytes) * 100
      : 0;
    this.currentProgress = this.rawProgress;
    this.targetProgress = this.rawProgress;
  }

  /**
   * 平滑进度更新
   * @private
   */
  _smoothProgress() {
    // 使用指数移动平均
    const delta = this.targetProgress - this.currentProgress;
    this.currentProgress += delta * this.smoothingFactor;

    // 当接近目标时直接跳到目标 (避免长时间接近但不到达)
    if (Math.abs(delta) < 0.1) {
      this.currentProgress = this.targetProgress;
    }

    // 确保进度在有效范围内
    this.currentProgress = Math.max(0, Math.min(100, this.currentProgress));
  }

  /**
   * 计算传输速度
   * @private
   */
  _calculateSpeed(now, timeDelta) {
    const bytesDelta = this.transferredBytes - this.lastTransferredBytes;

    // 计算瞬时速度 (bytes/s)
    this.instantSpeed = (bytesDelta / timeDelta) * 1000;

    // 添加到速度历史
    this.speedHistory.push(this.instantSpeed);
    if (this.speedHistory.length > this.speedHistorySize) {
      this.speedHistory.shift();
    }

    // 计算平均速度
    this.avgSpeed = this.speedHistory.reduce((sum, speed) => sum + speed, 0) / this.speedHistory.length;

    // 使用指数移动平均平滑当前速度
    if (this.currentSpeed === 0) {
      this.currentSpeed = this.instantSpeed;
    } else {
      this.currentSpeed =
        this.speedSmoothingFactor * this.instantSpeed +
        (1 - this.speedSmoothingFactor) * this.currentSpeed;
    }

    // 更新上次传输字节数
    this.lastTransferredBytes = this.transferredBytes;
  }

  /**
   * 计算剩余时间
   * @private
   */
  _calculateRemainingTime() {
    const remainingBytes = this.totalBytes - this.transferredBytes;

    if (this.avgSpeed > 0 && remainingBytes > 0) {
      // 使用平均速度和当前速度的加权平均来预测
      const predictSpeed = this.avgSpeed * 0.6 + this.currentSpeed * 0.4;
      this.remainingTime = remainingBytes / predictSpeed;
      this.eta = new Date(Date.now() + this.remainingTime * 1000);
    } else {
      this.remainingTime = 0;
      this.eta = null;
    }
  }

  /**
   * 获取格式化的进度信息
   * @returns {Object} 进度信息对象
   */
  getProgressInfo() {
    return {
      // 进度
      progress: Math.round(this.currentProgress * 100) / 100, // 保留2位小数
      progressInt: Math.floor(this.currentProgress), // 整数进度
      rawProgress: this.rawProgress,

      // 字节统计
      transferredBytes: this.transferredBytes,
      totalBytes: this.totalBytes,
      remainingBytes: this.totalBytes - this.transferredBytes,

      // 速度
      speed: this.currentSpeed, // 平滑速度 (bytes/s)
      instantSpeed: this.instantSpeed, // 瞬时速度
      avgSpeed: this.avgSpeed, // 平均速度
      formattedSpeed: this._formatSpeed(this.currentSpeed),

      // 时间
      elapsedTime: (Date.now() - this.startTime) / 1000, // 已用时间 (秒)
      remainingTime: Math.ceil(this.remainingTime), // 剩余时间 (秒)
      formattedRemainingTime: this._formatTime(this.remainingTime),
      eta: this.eta,

      // 状态 - 修改完成判断，使用原始进度或已传输字节
      isComplete: this.rawProgress >= 100 || this.transferredBytes >= this.totalBytes,
      isPaused: this.currentSpeed === 0 && this.transferredBytes > 0 && this.transferredBytes < this.totalBytes,
    };
  }

  /**
   * 格式化速度显示
   * @private
   * @param {number} bytesPerSecond - 速度 (bytes/s)
   * @returns {string} 格式化的速度字符串
   */
  _formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond === 0) return "0 B/s";

    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const k = 1024;
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    const value = bytesPerSecond / Math.pow(k, i);

    return `${value.toFixed(2)} ${units[i]}`;
  }

  /**
   * 格式化时间显示
   * @private
   * @param {number} seconds - 时间 (秒)
   * @returns {string} 格式化的时间字符串
   */
  _formatTime(seconds) {
    if (!seconds || seconds <= 0) return "";

    if (seconds < 60) {
      return `${Math.ceil(seconds)}秒`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      const secs = Math.ceil(seconds % 60);
      return `${minutes}分${secs > 0 ? secs + '秒' : ''}`;
    } else {
      const hours = Math.floor(seconds / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      return `${hours}时${minutes > 0 ? minutes + '分' : ''}`;
    }
  }

  /**
   * 启动动画循环 (用于前端UI平滑动画)
   * @param {Function} callback - 每帧回调函数
   */
  startAnimation(callback) {
    if (this.isAnimating) return;

    this.isAnimating = true;

    const animate = () => {
      if (!this.isAnimating) return;

      this._smoothProgress();
      callback(this.getProgressInfo());

      // 如果还没到达目标或还在传输中，继续动画
      if (Math.abs(this.targetProgress - this.currentProgress) > 0.01 ||
          (this.transferredBytes < this.totalBytes && this.currentSpeed > 0)) {
        this.animationFrameId = requestAnimationFrame(animate);
      } else {
        this.isAnimating = false;
      }
    };

    animate();
  }

  /**
   * 停止动画循环
   */
  stopAnimation() {
    this.isAnimating = false;
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * 重置进度
   */
  reset() {
    this.stopAnimation();
    this.currentProgress = 0;
    this.targetProgress = 0;
    this.rawProgress = 0;
    this.transferredBytes = 0;
    this.lastTransferredBytes = 0;
    this.currentSpeed = 0;
    this.instantSpeed = 0;
    this.speedHistory = [];
    this.avgSpeed = 0;
    this.remainingTime = 0;
    this.eta = null;
    this.lastUpdateTime = Date.now();
    this.lastSpeedCalcTime = this.lastUpdateTime;
  }

  /**
   * 标记为完成
   */
  complete() {
    this.transferredBytes = this.totalBytes;
    this.currentProgress = 100;
    this.targetProgress = 100;
    this.rawProgress = 100;
    this.remainingTime = 0;
    this.currentSpeed = 0;
    this.stopAnimation();
  }
}

/**
 * 多文件传输进度管理器
 * 用于管理多个文件的整体进度
 */
class MultiFileProgress {
  constructor(options = {}) {
    this.options = options;
    this.files = new Map(); // fileId -> SmoothProgress
    this.totalBytes = 0;
    this.totalTransferred = 0;
    this.overallProgress = new SmoothProgress(options);
  }

  /**
   * 添加文件
   * @param {string} fileId - 文件ID
   * @param {number} fileSize - 文件大小
   */
  addFile(fileId, fileSize) {
    const fileProgress = new SmoothProgress(this.options);
    fileProgress.initialize(fileSize);
    this.files.set(fileId, fileProgress);
    this.totalBytes += fileSize;
    this.overallProgress.initialize(this.totalBytes);
  }

  /**
   * 更新文件进度
   * @param {string} fileId - 文件ID
   * @param {number} bytes - 新传输的字节数
   * @returns {Object} 整体进度信息
   */
  updateFile(fileId, bytes) {
    const fileProgress = this.files.get(fileId);
    if (!fileProgress) return null;

    fileProgress.update(bytes);

    // 计算总传输字节数
    this.totalTransferred = 0;
    for (const fp of this.files.values()) {
      this.totalTransferred += fp.transferredBytes;
    }

    // 更新整体进度 (使用差值而不是总量，避免重复累加)
    const delta = this.totalTransferred - this.overallProgress.transferredBytes;
    if (delta > 0) {
      this.overallProgress.update(delta);
    }

    return this.getOverallProgress();
  }

  /**
   * 获取整体进度
   * @returns {Object} 整体进度信息
   */
  getOverallProgress() {
    const info = this.overallProgress.getProgressInfo();

    // 添加文件统计 - 使用原始进度或实际字节数判断完成状态
    let completedFiles = 0;
    for (const fp of this.files.values()) {
      if (fp.rawProgress >= 100 || fp.transferredBytes >= fp.totalBytes) {
        completedFiles++;
      }
    }

    return {
      ...info,
      totalFiles: this.files.size,
      completedFiles,
      remainingFiles: this.files.size - completedFiles,
    };
  }

  /**
   * 获取单个文件进度
   * @param {string} fileId - 文件ID
   * @returns {Object|null} 文件进度信息
   */
  getFileProgress(fileId) {
    const fileProgress = this.files.get(fileId);
    return fileProgress ? fileProgress.getProgressInfo() : null;
  }

  /**
   * 移除文件
   * @param {string} fileId - 文件ID
   */
  removeFile(fileId) {
    this.files.delete(fileId);
  }

  /**
   * 重置所有进度
   */
  reset() {
    for (const fp of this.files.values()) {
      fp.reset();
    }
    this.files.clear();
    this.totalBytes = 0;
    this.totalTransferred = 0;
    this.overallProgress.reset();
  }
}

module.exports = {
  SmoothProgress,
  MultiFileProgress,
};
