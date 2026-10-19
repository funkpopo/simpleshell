/** UploadSelection: explicit dependencies supplied by the service facade. */
function createUploadSelection(
  dependencies,
  {
    dialog,
    transferText,
    fsp,
    path,
    buildTransferDisplayName,
    isCancelledError,
    normalizeErrorMessage,
    normalizeDroppedTransferRelativePath,
    fs,
    getTopLevelTransferItemName,
    scanLocalFolder,
  },
) {
  return new (class UploadSelection {
    constructor() {
      this.dependencies = dependencies;
    }
    async uploadFile(event, tabId, targetFolder, progressChannel) {
      try {
        const dialogWindow = this.dependencies._resolveDialogWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(
          dialogWindow || undefined,
          {
            title: transferText("mainProcess.transfer.selectUploadFiles"),
            properties: ["openFile", "multiSelections"],
            buttonLabel: transferText("mainProcess.transfer.uploadFilesButton"),
          },
        );

        if (canceled || !filePaths || filePaths.length === 0) {
          return {
            success: false,
            cancelled: true,
            error: transferText("mainProcess.transfer.uploadCancelled"),
          };
        }

        const normalizedTarget =
          this.dependencies._normalizeRemotePath(targetFolder);
        const entries = [];
        for (const localPath of filePaths) {
          const stats = await fsp.stat(localPath);
          if (!stats.isFile()) continue;
          const fileName = path.basename(localPath);
          entries.push({
            localPath,
            fileName,
            relativePath: fileName,
            remotePath: this.dependencies._joinRemotePath(
              normalizedTarget,
              fileName,
            ),
            size: Number.isFinite(stats.size) ? stats.size : 0,
          });
        }

        return this.dependencies._uploadEntries({
          event,
          tabId,
          entries,
          progressChannel,
          transferType: "upload-multifile",
          displayName:
            buildTransferDisplayName(
              entries.map((entry) => entry.fileName),
              transferText("mainProcess.transfer.fileLabel"),
            ) || transferText("mainProcess.transfer.uploadFilesButton"),
          includeOperationComplete: true,
        });
      } catch (error) {
        if (isCancelledError(error)) {
          return {
            success: false,
            cancelled: true,
            error: transferText("mainProcess.transfer.uploadCancelled"),
          };
        }
        return {
          success: false,
          error: transferText("mainProcess.transfer.uploadFileFailed", {
            error: normalizeErrorMessage(error),
          }),
        };
      }
    }
    async uploadDroppedFiles(
      event,
      tabId,
      targetFolder,
      uploadData,
      progressChannel,
    ) {
      try {
        const normalizedTarget =
          this.dependencies._normalizeRemotePath(targetFolder);
        const rawFiles = Array.isArray(uploadData?.files)
          ? uploadData.files
          : [];
        const rawFolders = Array.isArray(uploadData?.folders)
          ? uploadData.folders
          : [];

        const entries = [];
        for (const fileData of rawFiles) {
          if (!fileData) continue;

          const relativePath = normalizeDroppedTransferRelativePath(
            fileData.relativePath,
          );
          if (!relativePath) {
            throw new Error(
              transferText("mainProcess.file.dropFileMissingRelativePath"),
            );
          }

          if (!fileData.localPath) {
            // 拖放文件缺少可验证的本地路径
            throw new Error(
              transferText("mainProcess.file.dropFileMissingLocalPath", {
                path: relativePath,
              }),
            );
          }

          const resolvedLocalPath = path.resolve(fileData.localPath);
          const stats = await fsp.stat(resolvedLocalPath);
          await fsp.access(resolvedLocalPath, fs.constants.R_OK);
          if (!stats.isFile()) {
            throw new Error(
              transferText("mainProcess.file.dropNotUploadableFile", {
                path: relativePath,
              }),
            );
          }

          const remotePath = this.dependencies._joinRemotePath(
            normalizedTarget,
            relativePath,
          );
          const fileName = path.posix.basename(relativePath);
          entries.push({
            localPath: resolvedLocalPath,
            fileName,
            relativePath,
            remotePath,
            size: Number.isFinite(stats.size) ? stats.size : 0,
          });
        }

        const remoteDirectories = [];
        const folderDisplayPaths = [];
        for (const folderData of rawFolders) {
          if (!folderData) continue;

          const relativePath = normalizeDroppedTransferRelativePath(
            folderData.relativePath,
          );
          if (!relativePath) {
            throw new Error(
              transferText("mainProcess.file.dropFolderMissingRelativePath"),
            );
          }

          if (!folderData.localPath) {
            // 拖放文件夹缺少可验证的本地路径
            throw new Error(
              transferText("mainProcess.file.dropFolderMissingLocalPath", {
                path: relativePath,
              }),
            );
          }

          const resolvedLocalPath = path.resolve(folderData.localPath);
          const stats = await fsp.stat(resolvedLocalPath);
          await fsp.access(resolvedLocalPath, fs.constants.R_OK);
          if (!stats.isDirectory()) {
            throw new Error(
              transferText("mainProcess.file.dropNotUploadableFolder", {
                path: relativePath,
              }),
            );
          }
          await fsp.readdir(resolvedLocalPath);

          remoteDirectories.push(
            this.dependencies._joinRemotePath(normalizedTarget, relativePath),
          );
          folderDisplayPaths.push(relativePath);
        }
        const displayName =
          buildTransferDisplayName(
            [
              ...entries.map((entry) =>
                getTopLevelTransferItemName(
                  entry.relativePath || entry.fileName,
                ),
              ),
              ...folderDisplayPaths.map((folderPath) =>
                getTopLevelTransferItemName(folderPath),
              ),
            ],
            transferText("mainProcess.transfer.itemLabel"),
          ) || transferText("mainProcess.transfer.dragUpload");

        return this.dependencies._uploadEntries({
          event,
          tabId,
          entries,
          remoteDirectories,
          progressChannel,
          transferType: "upload-multifile",
          displayName,
          includeOperationComplete: true,
        });
      } catch (error) {
        if (isCancelledError(error)) {
          return {
            success: true,
            cancelled: true,
            userCancelled: true,
            message: transferText("mainProcess.file.userCancelledOperation"),
          };
        }
        return {
          success: false,
          error: transferText("mainProcess.transfer.uploadFileFailed", {
            error: normalizeErrorMessage(error),
          }),
        };
      }
    }
    async uploadFolder(event, tabId, targetFolder, progressChannel) {
      let transferKey = null;
      try {
        const sender = event?.sender;
        const dialogWindow = this.dependencies._resolveDialogWindow();
        const { canceled, filePaths } = await dialog.showOpenDialog(
          dialogWindow || undefined,
          {
            title: transferText("mainProcess.transfer.selectUploadFolder"),
            properties: ["openDirectory"],
            buttonLabel: transferText(
              "mainProcess.transfer.uploadFolderButton",
            ),
          },
        );

        if (canceled || !filePaths || filePaths.length === 0) {
          return {
            success: false,
            cancelled: true,
            error: transferText("mainProcess.transfer.uploadCancelled"),
          };
        }

        const localFolderPath = filePaths[0];
        const folderName = path.basename(localFolderPath);
        const normalizedTarget =
          this.dependencies._normalizeRemotePath(targetFolder);
        const remoteBase = this.dependencies._joinRemotePath(
          normalizedTarget,
          folderName,
        );
        transferKey = this.dependencies._generateTransferKey(
          tabId,
          "upload-folder",
        );
        this.dependencies._registerTransfer({
          transferKey,
          tabId,
          type: "upload-folder",
          sender,
          progressChannel,
          totalBytes: 0,
          totalFiles: 1,
          metadata: {
            displayName: folderName,
          },
        });
        this.dependencies._emitTransferProgress(transferKey, {
          force: true,
          fileName: folderName,
          currentFile: transferText("mainProcess.transfer.scanningLocalFolder"),
          currentFileIndex: 0,
          extra: { operationComplete: false, cancelled: false },
        });

        const scan = await scanLocalFolder(localFolderPath, transferText);
        this.dependencies._throwIfTransferCancelled(transferKey);
        const entries = scan.files.map((file) => ({
          localPath: file.localPath,
          fileName: file.fileName,
          relativePath: file.relativePath,
          remotePath: this.dependencies._joinRemotePath(
            remoteBase,
            file.relativePath,
          ),
          size: file.size,
        }));

        const result = await this.dependencies._uploadEntries({
          event,
          tabId,
          entries,
          remoteDirectories: [
            remoteBase,
            ...scan.directories.map((relative) =>
              this.dependencies._joinRemotePath(remoteBase, relative),
            ),
          ],
          transferKey,
          progressChannel,
          transferType: "upload-folder",
          displayName: folderName,
          includeOperationComplete: true,
        });

        if (result.success) {
          return { ...result, remotePath: remoteBase };
        }
        return result;
      } catch (error) {
        if (transferKey) {
          const state = this.dependencies._getTransfer(transferKey);
          if (state) state.lastError = error;
          this.dependencies._recordTransferMetrics({
            transferredBytes: state?.transferredBytes || 0,
            completed: 0,
            failed: isCancelledError(error) ? 0 : 1,
            cancelled: isCancelledError(error),
            durationMs: state ? Date.now() - state.startAt : 0,
          });
          this.dependencies._recordCancelLatency(state);
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
        return {
          success: false,
          error: transferText("mainProcess.transfer.uploadFolderFailed", {
            error: normalizeErrorMessage(error),
          }),
        };
      }
    }
  })();
}
module.exports = createUploadSelection;
