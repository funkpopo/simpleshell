/**
 * 传输进度协调器
 *
 * 用于管理并发传输时的进度更新，确保：
 * 1. 进度显示的文件信息稳定不跳跃
 * 2. 统计信息准确且原子性更新
 * 3. 进度上报符合节流策略
 * 4. 显示最相关的当前文件信息
 */

class TransferProgressCoordinator {
  constructor({
    totalFiles,
    totalBytes,
    progressIntervalMs = 250,
    speedSmoothingFactor = 0.3,
    onProgress,
  }) {
    // 基本配置
    this.totalFiles = totalFiles;
    this.totalBytes = totalBytes;
    this.progressIntervalMs = progressIntervalMs;
    this.speedSmoothingFactor = speedSmoothingFactor;
    this.onProgress = onProgress;

    // 全局统计
    this.overallTransferredBytes = 0;
    this.filesCompleted = 0;

    // 文件状态追踪
    this.fileStates = new Map(); // fileIndex -> { fileName, transferredBytes, totalBytes, isCompleted, lastActivity }

    // 进度上报控制
    this.lastProgressReportTime = 0;
    this.transferStartTime = Date.now();
    this.lastTransferTime = this.transferStartTime;
    this.lastBytesSnapshot = 0;
    this.currentSpeed = 0;
    this.currentRemainingTime = 0;

    // 当前显示文件锁定（防止跳跃）
    this.displayedFileIndex = null;
    this.displayedFileName = null;
    this.displayLockUntil = 0; // 锁定时长，防止频繁切换
  }

  /**
   * 注册一个文件到协调器
   */
  registerFile(fileIndex, fileName, totalBytes) {
    this.fileStates.set(fileIndex, {
      fileName,
      transferredBytes: 0,
      totalBytes,
      isCompleted: false,
      lastActivity: Date.now(),
    });
  }

  /**
   * 更新文件的传输进度
   */
  updateFileProgress(fileIndex, bytesTransferred) {
    const fileState = this.fileStates.get(fileIndex);
    if (!fileState) {
      console.warn(`TransferProgressCoordinator: Unknown file index ${fileIndex}`);
      return;
    }

    // 计算增量
    const bytesDelta = bytesTransferred - fileState.transferredBytes;

    // 更新文件状态
    fileState.transferredBytes = bytesTransferred;
    fileState.lastActivity = Date.now();

    // 更新全局统计
    this.overallTransferredBytes += bytesDelta;

    // 检查文件是否完成
    if (bytesTransferred >= fileState.totalBytes && !fileState.isCompleted) {
      fileState.isCompleted = true;
      this.filesCompleted++;
    }

    // 尝试上报进度
    this._maybeReportProgress();
  }

  /**
   * 标记文件完成
   */
  markFileCompleted(fileIndex) {
    const fileState = this.fileStates.get(fileIndex);
    if (!fileState) return;

    if (!fileState.isCompleted) {
      // 确保字节数对齐
      const remaining = fileState.totalBytes - fileState.transferredBytes;
      if (remaining > 0) {
        this.overallTransferredBytes += remaining;
        fileState.transferredBytes = fileState.totalBytes;
      }

      fileState.isCompleted = true;
      this.filesCompleted++;
      fileState.lastActivity = Date.now();
    }

    // 如果当前显示的就是这个文件，解锁显示
    if (this.displayedFileIndex === fileIndex) {
      this.displayedFileIndex = null;
      this.displayedFileName = null;
      this.displayLockUntil = 0;
    }

    // 立即上报进度
    this._forceReportProgress();
  }

  /**
   * 获取当前应该显示的文件信息（稳定选择策略）
   */
  _selectDisplayFile() {
    const now = Date.now();

    // 如果当前显示的文件还在锁定期内，继续显示
    if (this.displayedFileIndex !== null && now < this.displayLockUntil) {
      const fileState = this.fileStates.get(this.displayedFileIndex);
      if (fileState && !fileState.isCompleted) {
        return {
          fileIndex: this.displayedFileIndex,
          fileName: this.displayedFileName,
        };
      }
    }

    // 选择最近活跃的未完成文件
    let bestCandidate = null;
    let bestActivity = 0;

    for (const [fileIndex, fileState] of this.fileStates.entries()) {
      if (!fileState.isCompleted && fileState.lastActivity > bestActivity) {
        bestActivity = fileState.lastActivity;
        bestCandidate = { fileIndex, fileName: fileState.fileName };
      }
    }

    // 如果找到候选文件，锁定显示1秒
    if (bestCandidate) {
      this.displayedFileIndex = bestCandidate.fileIndex;
      this.displayedFileName = bestCandidate.fileName;
      this.displayLockUntil = now + 1000; // 锁定1秒
      return bestCandidate;
    }

    // 没有活跃文件，返回null
    return null;
  }

  /**
   * 计算传输速度和剩余时间
   */
  _calculateSpeedAndTime() {
    const now = Date.now();
    const timeElapsed = (now - this.lastTransferTime) / 1000;

    if (timeElapsed <= 0) {
      return;
    }

    const bytesDelta = this.overallTransferredBytes - this.lastBytesSnapshot;
    const instantSpeed = bytesDelta / timeElapsed;

    // 使用指数移动平均平滑速度
    if (this.currentSpeed === 0) {
      this.currentSpeed = instantSpeed;
    } else {
      this.currentSpeed =
        this.speedSmoothingFactor * instantSpeed +
        (1 - this.speedSmoothingFactor) * this.currentSpeed;
    }

    // 计算剩余时间
    const remainingBytes = this.totalBytes - this.overallTransferredBytes;
    this.currentRemainingTime =
      this.currentSpeed > 0 ? remainingBytes / this.currentSpeed : 0;

    // 更新快照
    this.lastBytesSnapshot = this.overallTransferredBytes;
    this.lastTransferTime = now;
  }

  /**
   * 尝试上报进度（节流）
   */
  _maybeReportProgress() {
    const now = Date.now();
    if (now - this.lastProgressReportTime < this.progressIntervalMs) {
      return;
    }

    this._doReportProgress();
  }

  /**
   * 强制立即上报进度（无节流）
   */
  _forceReportProgress() {
    this._doReportProgress();
  }

  /**
   * 执行进度上报
   */
  _doReportProgress() {
    const now = Date.now();

    // 更新速度和时间
    this._calculateSpeedAndTime();

    // 选择要显示的文件
    const displayFile = this._selectDisplayFile();

    // 计算进度百分比
    const progress =
      this.totalBytes > 0
        ? Math.floor((this.overallTransferredBytes / this.totalBytes) * 100)
        : 0;

    // 构建进度数据
    const progressData = {
      progress: Math.min(100, progress),
      fileName: displayFile ? displayFile.fileName : "传输中...",
      currentFileIndex: this.filesCompleted + 1, // 显示下一个要处理的文件索引
      processedFiles: this.filesCompleted,
      totalFiles: this.totalFiles,
      transferredBytes: this.overallTransferredBytes,
      totalBytes: this.totalBytes,
      transferSpeed: this.currentSpeed,
      remainingTime: this.currentRemainingTime,
    };

    // 回调上报
    if (typeof this.onProgress === "function") {
      try {
        this.onProgress(progressData);
      } catch (error) {
        console.error("TransferProgressCoordinator: Progress callback error:", error);
      }
    }

    // 更新上报时间
    this.lastProgressReportTime = now;
  }

  /**
   * 获取最终统计信息
   */
  getFinalStats() {
    return {
      totalFiles: this.totalFiles,
      filesCompleted: this.filesCompleted,
      totalBytes: this.totalBytes,
      transferredBytes: this.overallTransferredBytes,
      duration: Date.now() - this.transferStartTime,
    };
  }

  /**
   * 完成传输，上报100%进度
   */
  finalize() {
    // 确保所有字节都被计入
    this.overallTransferredBytes = this.totalBytes;
    this.filesCompleted = this.totalFiles;

    // 上报最终进度
    if (typeof this.onProgress === "function") {
      this.onProgress({
        progress: 100,
        fileName: "传输完成",
        currentFileIndex: this.totalFiles,
        processedFiles: this.filesCompleted,
        totalFiles: this.totalFiles,
        transferredBytes: this.totalBytes,
        totalBytes: this.totalBytes,
        transferSpeed: 0,
        remainingTime: 0,
      });
    }
  }
}

module.exports = { TransferProgressCoordinator };
