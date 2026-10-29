/** TransferBatch: explicit dependencies supplied by the service facade. */
function createTransferBatch(
  dependencies,
  { _chooseConcurrency, transferText, normalizeErrorMessage, isCancelledError },
) {
  return new (class TransferBatch {
    constructor() {
      this.dependencies = dependencies;
    }
    async _runTransferTaskBatch({
      transferKey,
      tabId,
      sshConfig,
      tasks,
      totalBytes,
      directoryMode,
      direction,
      taskMetaMap,
      fileStateMap,
      counters,
      errors,
      emitTaskProgress,
      getTaskLabel,
    }) {
      const files = [
        ...new Map(
          tasks.map((task) => [taskMetaMap.get(task.taskId).fileTaskKey, task]),
        ).values(),
      ];
      // 分块任务按文件汇总大小，登记逐文件进度清单
      const fileSizes = new Map();
      for (const task of tasks) {
        const { fileTaskKey } = taskMetaMap.get(task.taskId);
        fileSizes.set(
          fileTaskKey,
          (fileSizes.get(fileTaskKey) || 0) + (Number(task.totalBytes) || 0),
        );
      }
      this.dependencies._setTransferFileItems(
        transferKey,
        files.map((task) => {
          const meta = taskMetaMap.get(task.taskId);
          return {
            index: meta.index,
            name: getTaskLabel(meta),
            size: fileSizes.get(meta.fileTaskKey) || 0,
          };
        }),
      );
      let next = 0;
      const concurrency = _chooseConcurrency(
        files.length,
        totalBytes,
        directoryMode,
        direction,
      );
      const runNext = async () => {
        while (
          next < files.length &&
          !this.dependencies._isTransferCancelled(transferKey)
        ) {
          const task = files[next++];
          const meta = taskMetaMap.get(task.taskId);
          const file = fileStateMap.get(meta.fileTaskKey);
          const state = this.dependencies._getTransfer(transferKey);
          this.dependencies._updateTransferFileItem(transferKey, meta.index, {
            status: "transferring",
          });
          try {
            await this.dependencies._runResumableFile({
              tabId,
              transferKey,
              sshConfig,
              direction,
              remotePath: task.remotePath,
              localPath:
                direction === "download" ? file.localPath : task.localPath,
              fileName: getTaskLabel(meta),
              onBytes: (delta) => {
                state.transferredBytes += delta;
                this.dependencies._updateTransferFileItem(
                  transferKey,
                  meta.index,
                  { bytesDelta: delta },
                );
                emitTaskProgress(meta);
              },
            });
            file.committed = true;
            // 已处理文件数在文件落盘时即计入（分块文件不再等到收尾阶段），
            // 保证界面上的「已完成 x/y」单调递增
            state.processedFiles += 1;
            if (file.chunked) file.completedSegments = file.totalSegments;
            else counters.completed += 1;
            this.dependencies._updateTransferFileItem(transferKey, meta.index, {
              status: "completed",
            });
            emitTaskProgress(meta, true);
          } catch (error) {
            if (this.dependencies._isTransferCancelled(transferKey)) break;
            this.dependencies._updateTransferFileItem(transferKey, meta.index, {
              status: "failed",
              error: error?.message,
            });
            file.failed = true;
            counters.failed += 1;
            errors.push({
              fileName: getTaskLabel(meta),
              error: error.message,
              errorKind: error.errorKind,
              retryable: error.retryable === true,
              localHash: error.localHash,
              remoteHash: error.remoteHash,
              algorithm: error.algorithm,
            });
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(concurrency, files.length) }, runNext),
      );
    }
    async _handleBatchTransferCancelled({
      transferKey,
      counters,
      errors,
      chunkTempCleanup = null,
      emitCancelled,
      buildResult,
    }) {
      if (chunkTempCleanup) chunkTempCleanup.clear();
      emitCancelled();
      const cancelledState = this.dependencies._getTransfer(transferKey);
      this.dependencies._recordTransferMetrics({
        transferredBytes: cancelledState?.transferredBytes || 0,
        completed: counters.completed,
        failed: counters.failed,
        cancelled: true,
        durationMs: cancelledState ? Date.now() - cancelledState.startAt : 0,
      });
      this.dependencies._recordCancelLatency(cancelledState);
      this.dependencies._finalizeTransfer(transferKey);
      return buildResult(counters, errors);
    }
    async _mergeChunkedDownloads({
      transferKey,
      fileStateMap,
      counters,
      errors,
      chunkTempCleanup,
      emitFileMerged,
    }) {
      for (const fileState of fileStateMap.values()) {
        this.dependencies._throwIfTransferCancelled(transferKey);
        if (!fileState.chunked || fileState.failed) continue;
        if (fileState.completedSegments < fileState.totalSegments) {
          fileState.failed = true;
          counters.failed += 1;
          errors.push({
            fileName: fileState.fileName,
            error: transferText(
              "mainProcess.transfer.errors.downloadChunkIncomplete",
            ),
          });
          continue;
        }

        try {
          if (!fileState.committed)
            throw new Error("Transfer was not committed");
          chunkTempCleanup.delete(fileState.tempPath);
          counters.completed += 1;
          emitFileMerged(fileState);
        } catch (renameError) {
          fileState.failed = true;
          counters.failed += 1;
          errors.push({
            fileName: fileState.fileName,
            error: transferText(
              "mainProcess.transfer.errors.chunkMergeFailed",
              {
                error: normalizeErrorMessage(renameError),
              },
            ),
          });
        }
      }
    }
    _recordBatchFinalMetrics({ transferKey, counters }) {
      const state = this.dependencies._getTransfer(transferKey);
      if (state) {
        state.processedFiles = counters.completed + counters.failed;
        if (counters.failed === 0) {
          state.transferredBytes = Math.max(
            state.transferredBytes,
            state.totalBytes,
          );
        }
      }
      const finalState = this.dependencies._getTransfer(transferKey);
      this.dependencies._recordTransferMetrics({
        transferredBytes: finalState?.transferredBytes || 0,
        completed: counters.completed,
        failed: counters.failed,
        cancelled: false,
        durationMs: finalState ? Date.now() - finalState.startAt : 0,
      });
    }
    async _handleBatchTransferError({
      transferKey,
      chunkTempCleanup = null,
      error,
      logLabel,
    }) {
      if (chunkTempCleanup) chunkTempCleanup.clear();
      if (transferKey) {
        const transferState = this.dependencies._getTransfer(transferKey);
        if (transferState) transferState.lastError = error;
        this.dependencies._recordTransferMetrics({
          transferredBytes: transferState?.transferredBytes || 0,
          completed: 0,
          failed: 1,
          cancelled: isCancelledError(error),
          durationMs: transferState ? Date.now() - transferState.startAt : 0,
        });
        this.dependencies._recordCancelLatency(transferState);
        this.dependencies._finalizeTransfer(transferKey);
      }
      if (isCancelledError(error)) {
        return {
          success: false,
          cancelled: true,
          error: transferText("mainProcess.transfer.downloadCancelled"),
        };
      }
      this.dependencies._log(
        `${logLabel} failed: ${normalizeErrorMessage(error)}`,
        "ERROR",
      );
      return { success: false, error: normalizeErrorMessage(error) };
    }
  })();
}
module.exports = createTransferBatch;
