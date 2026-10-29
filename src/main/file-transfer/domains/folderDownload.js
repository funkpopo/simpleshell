/** FolderDownload: explicit dependencies supplied by the service facade. */
function createFolderDownload(
  dependencies,
  {
    dialog,
    transferText,
    path,
    IPC_EVENT_CHANNELS,
    fsp,
    sanitizeLocalPathSegment,
    createLocalPathAllocator,
    _buildFileTaskKey,
    _buildChunkSegments,
  },
) {
  return new (class FolderDownload {
    constructor() {
      this.dependencies = dependencies;
    }
    async downloadFolder(event, tabId, remoteFolderPath) {
      let transferKey = null;
      const chunkTempCleanup = new Set();
      try {
        const sender = event?.sender;
        const normalizedRemoteRoot =
          this.dependencies._normalizeRemotePath(remoteFolderPath);
        const folderName =
          this.dependencies._getDownloadFolderName(normalizedRemoteRoot);

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

        const targetRootDir = filePaths[0];
        const localFolderPath = path.join(
          targetRootDir,
          sanitizeLocalPathSegment(folderName),
        );
        // 远程名可能含本地非法字符或仅大小写不同，统一映射为安全且不冲突的本地路径
        const localPathAllocator = createLocalPathAllocator();
        const resolveLocalPath = (relativePath) =>
          path.join(
            localFolderPath,
            ...localPathAllocator.resolveSegments(relativePath),
          );
        transferKey = this.dependencies._generateTransferKey(
          tabId,
          "download-folder",
        );
        this.dependencies._registerTransfer({
          transferKey,
          tabId,
          type: "download-folder",
          sender,
          progressChannel: IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
          totalBytes: 0,
          totalFiles: 1,
          metadata: {
            displayName: folderName,
          },
        });
        this.dependencies._emitTransferProgress(transferKey, {
          channel: IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
          force: true,
          fileName: folderName,
          currentFile: transferText(
            "mainProcess.transfer.scanningRemoteFolder",
          ),
        });
        await fsp.mkdir(localFolderPath, { recursive: true });
        this.dependencies._throwIfTransferCancelled(transferKey);

        const tree = await this.dependencies._scanRemoteFolderTree(
          tabId,
          normalizedRemoteRoot,
          transferKey,
        );
        this.dependencies._throwIfTransferCancelled(transferKey);
        const totalFiles = tree.files.length;
        const totalBytes = tree.totalBytes;
        const sshConfig =
          await this.dependencies._resolveTransferSshConfig(tabId);
        const initialTransferState =
          this.dependencies._getTransfer(transferKey);
        if (initialTransferState) {
          initialTransferState.totalBytes = Math.max(0, totalBytes || 0);
          initialTransferState.totalFiles = Math.max(1, totalFiles || 1);
          initialTransferState.transferredBytes = 0;
          initialTransferState.processedFiles = 0;
        }

        this.dependencies._emitTransferProgress(transferKey, {
          channel: IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
          force: true,
          fileName: folderName,
          currentFile: "",
        });

        for (const relativeDir of tree.directories) {
          this.dependencies._throwIfTransferCancelled(transferKey);
          await fsp.mkdir(resolveLocalPath(relativeDir), { recursive: true });
        }

        const counters = { completed: 0, failed: 0 };
        const errors = [];
        const taskMetaMap = new Map();
        const taskTransferredBytes = new Map();
        const fileStateMap = new Map();
        const tasks = [];
        for (let index = 0; index < tree.files.length; index += 1) {
          this.dependencies._throwIfTransferCancelled(transferKey);
          const file = tree.files[index];
          const localPath = resolveLocalPath(file.relativePath);
          const remotePath = this.dependencies._normalizeRemotePath(
            file.remotePath,
          );
          const knownSize = Number.isFinite(file.size) ? file.size : 0;
          const fileTaskKey = _buildFileTaskKey(
            "download-folder",
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
              fileName: file.relativePath,
              localPath,
              tempPath,
              chunked: true,
              totalSegments: chunkSegments.length,
              completedSegments: 0,
              failed: false,
            });

            for (const segment of chunkSegments) {
              this.dependencies._throwIfTransferCancelled(transferKey);
              const taskId = this.dependencies._generateTaskId(
                "download-folder-chunk",
              );
              taskMetaMap.set(taskId, {
                fileTaskKey,
                index,
                fileName: file.relativePath,
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
                fileName: file.relativePath,
                currentFile: file.relativePath,
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
            fileName: file.relativePath,
            localPath,
            chunked: false,
            failed: false,
          });
          const taskId = this.dependencies._generateTaskId("download-folder");
          taskMetaMap.set(taskId, {
            fileTaskKey,
            index,
            fileName: file.relativePath,
            knownSize,
            chunked: false,
          });
          tasks.push({
            taskId,
            direction: "download",
            remotePath,
            localPath,
            totalBytes: knownSize,
            fileName: file.relativePath,
            currentFile: file.relativePath,
          });
        }
        this.dependencies._throwIfTransferCancelled(transferKey);

        await this.dependencies._runTransferTaskBatch({
          transferKey,
          tabId,
          sshConfig,
          tasks,
          totalBytes,
          directoryMode: true,
          direction: "download",
          taskMetaMap,
          taskTransferredBytes,
          fileStateMap,
          counters,
          errors,
          emitTaskProgress: (taskMeta, force) => {
            this.dependencies._emitTransferProgress(transferKey, {
              channel: IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
              ...(force === undefined ? {} : { force }),
              fileName: folderName,
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
                channel: IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
                force: true,
                fileName: folderName,
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
              downloadPath: localFolderPath,
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
              channel: IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
              force: true,
              fileName: folderName,
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
                channel: IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
                force: true,
                fileName: folderName,
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
              downloadPath: localFolderPath,
            }),
          });
        }

        this.dependencies._recordBatchFinalMetrics({ transferKey, counters });
        const { completed, failed } = counters;

        this.dependencies._emitTransferProgress(transferKey, {
          channel: IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
          force: true,
          fileName: folderName,
          currentFile: "",
          extra: { operationComplete: true },
        });
        this.dependencies._finalizeTransfer(transferKey);

        if (failed === 0) {
          return {
            success: true,
            completed,
            failed,
            errors,
            downloadPath: localFolderPath,
            message: transferText(
              "mainProcess.transfer.folderDownloadComplete",
            ),
          };
        }
        if (completed > 0) {
          return {
            success: true,
            partialSuccess: true,
            completed,
            failed,
            errors,
            warning: transferText(
              "mainProcess.transfer.folderPartialDownloadFailed",
              {
                completed,
                total: totalFiles,
              },
            ),
            downloadPath: localFolderPath,
          };
        }
        return {
          success: false,
          completed,
          failed,
          errors,
          error: transferText("mainProcess.transfer.folderDownloadFailed"),
          downloadPath: localFolderPath,
        };
      } catch (error) {
        return this.dependencies._handleBatchTransferError({
          transferKey,
          chunkTempCleanup,
          error,
          logLabel: "downloadFolder",
        });
      }
    }
  })();
}
module.exports = createFolderDownload;
