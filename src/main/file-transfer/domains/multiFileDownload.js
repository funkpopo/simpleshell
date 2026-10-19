/** MultiFileDownload: explicit dependencies supplied by the service facade. */
function createMultiFileDownload(
  dependencies,
  {
    transferText,
    dialog,
    buildTransferDisplayName,
    path,
    IPC_EVENT_CHANNELS,
    _buildFileTaskKey,
    _buildChunkSegments,
  },
) {
  return new (class MultiFileDownload {
    constructor() {
      this.dependencies = dependencies;
    }
    async downloadFiles(event, tabId, files) {
      let transferKey = null;
      const chunkTempCleanup = new Set();
      try {
        if (!Array.isArray(files) || files.length === 0) {
          return {
            success: false,
            error: transferText("mainProcess.transfer.noFilesSelected"),
          };
        }

        const sender = event?.sender;
        const dialogWindow = this.dependencies._resolveDialogWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(
          dialogWindow || undefined,
          {
            title: transferText("mainProcess.transfer.selectSaveDirectory"),
            defaultPath: this.dependencies._resolveDownloadBasePath(tabId),
            buttonLabel: transferText(
              "mainProcess.transfer.selectDirectoryButton",
            ),
            properties: ["openDirectory", "createDirectory"],
          },
        );
        if (canceled || !filePaths || filePaths.length === 0) {
          return {
            success: false,
            cancelled: true,
            error: transferText("mainProcess.transfer.downloadCancelled"),
          };
        }

        const targetDir = filePaths[0];
        const totalFiles = files.length;
        const totalBytes = files.reduce(
          (sum, file) => sum + (Number.isFinite(file?.size) ? file.size : 0),
          0,
        );
        const displayName =
          buildTransferDisplayName(
            files.map(
              (file) =>
                file?.fileName ||
                path.posix.basename(
                  this.dependencies._normalizeRemotePath(
                    file?.remotePath || "",
                  ),
                ),
            ),
            transferText("mainProcess.transfer.fileLabel"),
          ) ||
          transferText("mainProcess.transfer.batchDownloadTitle", {
            count: totalFiles,
          });
        const sshConfig =
          await this.dependencies._resolveTransferSshConfig(tabId);

        transferKey = this.dependencies._generateTransferKey(
          tabId,
          "batch-download",
        );
        this.dependencies._registerTransfer({
          transferKey,
          tabId,
          type: "batch-download",
          sender,
          progressChannel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
          totalBytes,
          totalFiles,
          metadata: {
            displayName,
          },
        });

        this.dependencies._emitTransferProgress(transferKey, {
          channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
          force: true,
          isBatch: true,
          fileName: displayName,
        });
        this.dependencies._throwIfTransferCancelled(transferKey);

        const counters = { completed: 0, failed: 0 };
        const errors = [];
        const taskMetaMap = new Map();
        const taskTransferredBytes = new Map();
        const fileStateMap = new Map();
        const tasks = [];
        for (let index = 0; index < files.length; index += 1) {
          this.dependencies._throwIfTransferCancelled(transferKey);
          const file = files[index];
          const remotePath = this.dependencies._normalizeRemotePath(
            file?.remotePath || "",
          );
          const fileName = file?.fileName || path.posix.basename(remotePath);
          const localPath = path.join(targetDir, fileName);
          const knownSize = Number.isFinite(file?.size) ? file.size : 0;
          const fileTaskKey = _buildFileTaskKey(
            "download",
            remotePath,
            localPath,
            index,
          );
          const chunkSegments = _buildChunkSegments(knownSize);

          if (chunkSegments.length > 0) {
            const tempPath = `${localPath}.part`;
            await this.dependencies._prepareLocalChunkDownloadTarget(
              tempPath,
              knownSize,
              transferKey,
            );
            chunkTempCleanup.add(tempPath);
            fileStateMap.set(fileTaskKey, {
              fileTaskKey,
              index,
              fileName,
              localPath,
              tempPath,
              chunked: true,
              totalSegments: chunkSegments.length,
              completedSegments: 0,
              failed: false,
            });

            for (const segment of chunkSegments) {
              this.dependencies._throwIfTransferCancelled(transferKey);
              const taskId =
                this.dependencies._generateTaskId("download-chunk");
              taskMetaMap.set(taskId, {
                fileTaskKey,
                index,
                fileName,
                knownSize: segment.length,
                chunked: true,
                segmentIndex: segment.index,
                totalSegments: chunkSegments.length,
                localPath,
                tempPath,
              });

              tasks.push({
                taskId,
                direction: "download",
                remotePath,
                localPath: tempPath,
                totalBytes: segment.length,
                fileName,
                currentFile: fileName,
                segmentOffset: segment.offset,
                segmentLength: segment.length,
                segmentIndex: segment.index,
                segmentCount: chunkSegments.length,
                localWriteFlags: "r+",
              });
            }
            continue;
          }

          fileStateMap.set(fileTaskKey, {
            fileTaskKey,
            index,
            fileName,
            localPath,
            chunked: false,
            failed: false,
          });
          const taskId = this.dependencies._generateTaskId("download");
          taskMetaMap.set(taskId, {
            fileTaskKey,
            index,
            fileName,
            knownSize,
            chunked: false,
          });
          tasks.push({
            taskId,
            direction: "download",
            remotePath,
            localPath,
            totalBytes: knownSize,
            fileName,
            currentFile: fileName,
          });
        }
        this.dependencies._throwIfTransferCancelled(transferKey);

        await this.dependencies._runTransferTaskBatch({
          transferKey,
          tabId,
          sshConfig,
          tasks,
          totalBytes,
          directoryMode: false,
          direction: "download",
          taskMetaMap,
          taskTransferredBytes,
          fileStateMap,
          counters,
          errors,
          emitTaskProgress: (taskMeta, force) => {
            this.dependencies._emitTransferProgress(transferKey, {
              channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
              ...(force === undefined ? {} : { force }),
              isBatch: true,
              fileName: taskMeta.fileName,
              currentFile: taskMeta.fileName,
              currentFileIndex: taskMeta.index + 1,
            });
          },
          getTaskLabel: (taskMeta) => taskMeta?.fileName,
          taskErrorLabel: transferText(
            "mainProcess.transfer.errors.downloadTaskFailed",
          ),
        });

        if (this.dependencies._isTransferCancelled(transferKey)) {
          return this.dependencies._handleBatchTransferCancelled({
            transferKey,
            counters,
            errors,
            chunkTempCleanup,
            emitCancelled: () => {
              this.dependencies._emitTransferProgress(transferKey, {
                channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
                force: true,
                isBatch: true,
                fileName: this.dependencies._getTransferDisplayName(
                  this.dependencies._getTransfer(transferKey),
                  displayName,
                ),
                extra: {
                  cancelled: true,
                  userCancelled: true,
                  operationComplete: true,
                },
              });
            },
            buildResult: (counters, errors) => ({
              success: false,
              cancelled: true,
              userCancelled: true,
              completed: counters.completed,
              failed: counters.failed,
              errors,
              targetDir,
            }),
          });
        }

        await this.dependencies._mergeChunkedDownloads({
          transferKey,
          fileStateMap,
          counters,
          errors,
          chunkTempCleanup,
          emitFileMerged: (fileState) => {
            this.dependencies._emitTransferProgress(transferKey, {
              channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
              force: true,
              isBatch: true,
              fileName: fileState.fileName,
              currentFile: fileState.fileName,
              currentFileIndex: fileState.index + 1,
            });
          },
        });

        if (this.dependencies._isTransferCancelled(transferKey)) {
          return this.dependencies._handleBatchTransferCancelled({
            transferKey,
            counters,
            errors,
            chunkTempCleanup,
            emitCancelled: () => {
              this.dependencies._emitTransferProgress(transferKey, {
                channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
                force: true,
                isBatch: true,
                fileName: this.dependencies._getTransferDisplayName(
                  this.dependencies._getTransfer(transferKey),
                  displayName,
                ),
                extra: {
                  cancelled: true,
                  userCancelled: true,
                  operationComplete: true,
                },
              });
            },
            buildResult: (counters, errors) => ({
              success: false,
              cancelled: true,
              userCancelled: true,
              completed: counters.completed,
              failed: counters.failed,
              errors,
              targetDir,
            }),
          });
        }

        this.dependencies._recordBatchFinalMetrics({ transferKey, counters });
        const { completed, failed } = counters;

        this.dependencies._emitTransferProgress(transferKey, {
          channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
          force: true,
          isBatch: true,
          fileName:
            failed === 0
              ? transferText("mainProcess.transfer.batchDownloadComplete", {
                  completed,
                  total: totalFiles,
                })
              : transferText(
                  "mainProcess.transfer.batchDownloadCompleteWithFailures",
                  {
                    failed,
                  },
                ),
        });
        this.dependencies._finalizeTransfer(transferKey);

        if (failed === 0)
          return { success: true, completed, failed, errors, targetDir };
        if (completed > 0) {
          return {
            success: true,
            partialSuccess: true,
            completed,
            failed,
            errors,
            warning: transferText(
              "mainProcess.transfer.partialDownloadFailed",
              {
                completed,
                total: totalFiles,
              },
            ),
            targetDir,
          };
        }
        return {
          success: false,
          completed,
          failed,
          errors,
          error: transferText("mainProcess.transfer.allDownloadsFailed"),
          targetDir,
        };
      } catch (error) {
        return this.dependencies._handleBatchTransferError({
          transferKey,
          chunkTempCleanup,
          error,
          logLabel: "downloadFiles",
        });
      }
    }
  })();
}
module.exports = createMultiFileDownload;
