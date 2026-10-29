/** FileUpload: explicit dependencies supplied by the service facade. */
function createFileUpload(
  dependencies,
  {
    transferText,
    normalizeTransferName,
    path,
    _buildFileTaskKey,
    _buildChunkSegments,
    isCancelledError,
  },
) {
  return new (class FileUpload {
    constructor() {
      this.dependencies = dependencies;
    }
    async _materializeUploadEntry(entry, transferKey) {
      this.dependencies._throwIfTransferCancelled(transferKey);

      if (!entry?.localPath) {
        throw new Error(
          transferText(
            "mainProcess.transfer.errors.uploadEntryMissingLocalPath",
          ),
        );
      }

      return {
        localPath: entry.localPath,
      };
    }
    async _uploadEntries({
      event,
      tabId,
      entries,
      remoteDirectories = [],
      transferKey: providedTransferKey = null,
      progressChannel,
      transferType,
      displayName,
      includeOperationComplete = false,
    }) {
      const uploadEntries = Array.isArray(entries) ? entries : [];
      const requestedRemoteDirectories = Array.isArray(remoteDirectories)
        ? remoteDirectories
        : [];

      if (
        uploadEntries.length === 0 &&
        requestedRemoteDirectories.length === 0
      ) {
        return {
          success: false,
          error: transferText("mainProcess.transfer.noValidUploadFiles"),
        };
      }

      const sender = event?.sender;
      const totalFiles =
        uploadEntries.length > 0
          ? uploadEntries.length
          : requestedRemoteDirectories.length;
      const totalBytes = uploadEntries.reduce(
        (sum, entry) => sum + (Number.isFinite(entry.size) ? entry.size : 0),
        0,
      );
      const sshConfig =
        await this.dependencies._resolveTransferSshConfig(tabId);

      const transferKey =
        providedTransferKey ||
        this.dependencies._generateTransferKey(tabId, transferType);
      const existingTransfer = this.dependencies._getTransfer(transferKey);

      if (existingTransfer) {
        existingTransfer.type = transferType;
        existingTransfer.sender = sender;
        existingTransfer.progressChannel = progressChannel;
        existingTransfer.totalBytes = Math.max(0, totalBytes || 0);
        existingTransfer.totalFiles = Math.max(1, totalFiles || 1);
        existingTransfer.transferredBytes = 0;
        existingTransfer.processedFiles = 0;
        existingTransfer.preparationTotal = 0;
        existingTransfer.preparationCompleted = 0;
        existingTransfer.displayName =
          normalizeTransferName(displayName) ||
          existingTransfer.displayName ||
          "";
        existingTransfer.lastDisplayName =
          normalizeTransferName(displayName) ||
          existingTransfer.lastDisplayName ||
          "";
        existingTransfer.lastCurrentFile = "";
        existingTransfer.metadata = {
          ...(existingTransfer.metadata || {}),
          displayName:
            normalizeTransferName(displayName) ||
            existingTransfer.metadata?.displayName ||
            "",
        };
      } else {
        this.dependencies._registerTransfer({
          transferKey,
          tabId,
          type: transferType,
          sender,
          progressChannel,
          totalBytes,
          totalFiles,
          metadata: {
            displayName: normalizeTransferName(displayName),
          },
        });
      }

      this.dependencies._emitTransferProgress(transferKey, {
        force: true,
        fileName:
          displayName || transferText("mainProcess.transfer.preparingUpload"),
        currentFile: "",
        currentFileIndex: 0,
        extra: includeOperationComplete
          ? { operationComplete: false, cancelled: false }
          : {},
      });

      const counters = { completed: 0, failed: 0 };
      const errors = [];
      const taskMetaMap = new Map();
      const taskTransferredBytes = new Map();
      const fileStateMap = new Map();
      try {
        const directories = [...requestedRemoteDirectories];
        await this.dependencies._ensureRemoteDirectories(tabId, directories, {
          transferKey,
          displayName,
          progressExtra: includeOperationComplete
            ? { operationComplete: false, cancelled: false }
            : {},
        });

        const tasks = [];
        for (let index = 0; index < uploadEntries.length; index += 1) {
          this.dependencies._throwIfTransferCancelled(transferKey);
          const entry = uploadEntries[index];
          const normalizedRemotePath = this.dependencies._normalizeRemotePath(
            entry.remotePath,
          );
          const materialized = await this._materializeUploadEntry(
            entry,
            transferKey,
          );

          const fileLabel =
            entry.relativePath ||
            entry.fileName ||
            path.basename(materialized.localPath || "");
          const knownSize = Number.isFinite(entry.size) ? entry.size : 0;
          const fileTaskKey = _buildFileTaskKey(
            "upload",
            normalizedRemotePath,
            materialized.localPath,
            index,
          );
          const chunkSegments = _buildChunkSegments(knownSize);

          if (chunkSegments.length > 0 && materialized.localPath) {
            fileStateMap.set(fileTaskKey, {
              fileTaskKey,
              index,
              fileLabel,
              remotePath: normalizedRemotePath,
              chunked: true,
              totalSegments: chunkSegments.length,
              completedSegments: 0,
              failed: false,
            });

            for (const segment of chunkSegments) {
              this.dependencies._throwIfTransferCancelled(transferKey);
              const taskId = this.dependencies._generateTaskId("upload-chunk");
              taskMetaMap.set(taskId, {
                fileTaskKey,
                index,
                fileLabel,
                knownSize: segment.length,
                chunked: true,
                segmentIndex: segment.index,
                totalSegments: chunkSegments.length,
              });

              tasks.push({
                taskId,
                direction: "upload",
                localPath: materialized.localPath,
                remotePath: normalizedRemotePath,
                totalBytes: segment.length,
                fileName: fileLabel,
                currentFile: fileLabel,
                segmentOffset: segment.offset,
                segmentLength: segment.length,
                segmentIndex: segment.index,
                segmentCount: chunkSegments.length,
                remoteWriteFlags: "r+",
              });
            }
            continue;
          }

          fileStateMap.set(fileTaskKey, {
            fileTaskKey,
            index,
            fileLabel,
            remotePath: normalizedRemotePath,
            chunked: false,
            failed: false,
          });
          const taskId = this.dependencies._generateTaskId("upload");
          taskMetaMap.set(taskId, {
            fileTaskKey,
            index,
            fileLabel,
            knownSize,
            chunked: false,
          });
          tasks.push({
            taskId,
            direction: "upload",
            localPath: materialized.localPath,
            remotePath: normalizedRemotePath,
            totalBytes: knownSize,
            fileName: fileLabel,
            currentFile: fileLabel,
          });
        }
        this.dependencies._throwIfTransferCancelled(transferKey);

        if (tasks.length === 0) {
          const state = this.dependencies._getTransfer(transferKey);
          if (state) {
            state.processedFiles = totalFiles;
          }
          const finalState = this.dependencies._getTransfer(transferKey);
          this.dependencies._recordTransferMetrics({
            transferredBytes: finalState?.transferredBytes || 0,
            completed: totalFiles,
            failed: 0,
            cancelled: false,
            durationMs: finalState ? Date.now() - finalState.startAt : 0,
          });
          this.dependencies._emitTransferProgress(transferKey, {
            force: true,
            fileName: transferText("mainProcess.transfer.uploadComplete"),
            currentFile: "",
            currentFileIndex: totalFiles,
            extra: { operationComplete: true, cancelled: false },
          });
          this.dependencies._finalizeTransfer(transferKey);
          return {
            success: true,
            uploadedCount: 0,
            totalFiles,
            failedCount: 0,
            transferKey,
            message: transferText("mainProcess.transfer.uploadComplete"),
          };
        }

        await this.dependencies._runTransferTaskBatch({
          transferKey,
          tabId,
          sshConfig,
          tasks,
          totalBytes,
          directoryMode: true,
          direction: "upload",
          taskMetaMap,
          taskTransferredBytes,
          fileStateMap,
          counters,
          errors,
          emitTaskProgress: (taskMeta, force) => {
            this.dependencies._emitTransferProgress(transferKey, {
              ...(force === undefined ? {} : { force }),
              fileName: displayName || taskMeta.fileLabel,
              currentFile: taskMeta.fileLabel,
              currentFileIndex: taskMeta.index + 1,
              extra: includeOperationComplete
                ? { operationComplete: false, cancelled: false }
                : {},
            });
          },
          getTaskLabel: (taskMeta) => taskMeta?.fileLabel,
          taskErrorLabel: transferText(
            "mainProcess.transfer.errors.uploadTaskFailed",
          ),
        });

        if (this.dependencies._isTransferCancelled(transferKey)) {
          return this.dependencies._handleBatchTransferCancelled({
            transferKey,
            counters,
            errors,
            emitCancelled: () => {
              this.dependencies._emitTransferProgress(transferKey, {
                force: true,
                fileName: this.dependencies._getTransferDisplayName(
                  this.dependencies._getTransfer(transferKey),
                  displayName,
                ),
                currentFile: "",
                currentFileIndex: 0,
                extra: {
                  cancelled: true,
                  userCancelled: true,
                  operationComplete: true,
                },
              });
            },
            buildResult: () => ({
              success: true,
              cancelled: true,
              userCancelled: true,
              message: transferText("mainProcess.file.userCancelledOperation"),
            }),
          });
        }

        for (const fileState of fileStateMap.values()) {
          this.dependencies._throwIfTransferCancelled(transferKey);
          if (!fileState.chunked) continue;
          if (fileState.failed) {
            continue;
          }
          if (fileState.completedSegments < fileState.totalSegments) {
            fileState.failed = true;
            counters.failed += 1;
            errors.push({
              fileName: fileState.fileLabel,
              error: transferText(
                "mainProcess.transfer.errors.uploadChunkIncomplete",
              ),
            });
            continue;
          }

          counters.completed += 1;
          this.dependencies._emitTransferProgress(transferKey, {
            force: true,
            fileName: displayName || fileState.fileLabel,
            currentFile: fileState.fileLabel,
            currentFileIndex: fileState.index + 1,
            extra: includeOperationComplete
              ? { operationComplete: false, cancelled: false }
              : {},
          });
        }

        if (this.dependencies._isTransferCancelled(transferKey)) {
          return this.dependencies._handleBatchTransferCancelled({
            transferKey,
            counters,
            errors,
            emitCancelled: () => {
              this.dependencies._emitTransferProgress(transferKey, {
                force: true,
                fileName: this.dependencies._getTransferDisplayName(
                  this.dependencies._getTransfer(transferKey),
                  displayName,
                ),
                currentFile: "",
                currentFileIndex: 0,
                extra: {
                  cancelled: true,
                  userCancelled: true,
                  operationComplete: true,
                },
              });
            },
            buildResult: () => ({
              success: true,
              cancelled: true,
              userCancelled: true,
              message: transferText("mainProcess.file.userCancelledOperation"),
            }),
          });
        }

        this.dependencies._recordBatchFinalMetrics({ transferKey, counters });
        const uploadedCount = counters.completed;
        const failedCount = counters.failed;

        this.dependencies._emitTransferProgress(transferKey, {
          force: true,
          fileName:
            failedCount === 0
              ? transferText("mainProcess.transfer.uploadComplete")
              : transferText(
                  "mainProcess.transfer.uploadCompleteWithFailures",
                  {
                    failed: failedCount,
                  },
                ),
          currentFile: "",
          currentFileIndex: totalFiles,
          extra: { operationComplete: true, cancelled: false },
        });
        this.dependencies._finalizeTransfer(transferKey);

        if (failedCount === 0) {
          return {
            success: true,
            uploadedCount,
            totalFiles,
            failedCount,
            transferKey,
            message: transferText("mainProcess.transfer.uploadComplete"),
          };
        }
        if (uploadedCount > 0) {
          return {
            success: true,
            partialSuccess: true,
            uploadedCount,
            totalFiles,
            failedCount,
            errors,
            transferKey,
            warning: transferText("mainProcess.transfer.partialUploadFailed", {
              completed: uploadedCount,
              total: totalFiles,
            }),
          };
        }
        return {
          success: false,
          uploadedCount,
          totalFiles,
          failedCount,
          errors,
          transferKey,
          error: transferText("fileManager.errors.uploadFailed"),
        };
      } catch (error) {
        const state = this.dependencies._getTransfer(transferKey);
        if (state) {
          state.lastError = error;
          this.dependencies._recordTransferMetrics({
            transferredBytes: state.transferredBytes || 0,
            completed: counters.completed,
            failed: counters.failed + (isCancelledError(error) ? 0 : 1),
            cancelled: isCancelledError(error),
            durationMs: Date.now() - state.startAt,
          });
          this.dependencies._recordCancelLatency(state);
        }
        if (transferKey) {
          this.dependencies._finalizeTransfer(transferKey);
        }
        if (isCancelledError(error)) {
          return {
            success: true,
            cancelled: true,
            userCancelled: true,
            message: transferText("mainProcess.file.userCancelledOperation"),
          };
        }
        throw error;
      }
    }
  })();
}
module.exports = createFileUpload;
