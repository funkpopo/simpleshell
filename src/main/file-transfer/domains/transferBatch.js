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
                emitTaskProgress(meta);
              },
            });
            file.committed = true;
            if (file.chunked) file.completedSegments = file.totalSegments;
            else {
              counters.completed += 1;
              state.processedFiles += 1;
            }
            emitTaskProgress(meta, true);
          } catch (error) {
            if (this.dependencies._isTransferCancelled(transferKey)) break;
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

          const state = this.dependencies._getTransfer(transferKey);
          if (state) {
            state.processedFiles += 1;
          }

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
