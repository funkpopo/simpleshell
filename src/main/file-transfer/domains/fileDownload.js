/** FileDownload: explicit dependencies supplied by the service facade. */
function createFileDownload(
  dependencies,
  {
    processManager,
    app,
    os,
    BrowserWindow,
    fsp,
    path,
    dialog,
    transferText,
    IPC_EVENT_CHANNELS,
    isCancelledError,
    normalizeErrorMessage,
  },
) {
  return new (class FileDownload {
    constructor() {
      this.dependencies = dependencies;
    }
    _resolveDownloadBasePath(tabId) {
      const processInfo = processManager.getProcess(tabId);
      const configuredPath = processInfo?.config?.downloadPath;
      if (configuredPath) return configuredPath;
      try {
        return app.getPath("downloads");
      } catch {
        return os.homedir();
      }
    }
    _resolveDialogWindow() {
      return (
        BrowserWindow.getFocusedWindow() ||
        BrowserWindow.getAllWindows()[0] ||
        null
      );
    }
    async _prepareLocalChunkDownloadTarget(
      tempPath,
      totalBytes,
      transferKey = null,
    ) {
      if (transferKey) {
        this.dependencies._throwIfTransferCancelled(transferKey);
      }
      await fsp.mkdir(path.dirname(tempPath), { recursive: true });
      // Allocation belongs to ResumableTransfer, after manifest validation.
      void totalBytes;
      if (transferKey) {
        this.dependencies._throwIfTransferCancelled(transferKey);
      }
    }
    async _downloadFileToPath({
      tabId,
      transferKey,
      remotePath,
      localPath,
      onBytes,
    }) {
      const sshConfig =
        await this.dependencies._resolveTransferSshConfig(tabId);
      return this.dependencies._runResumableFile({
        tabId,
        transferKey,
        sshConfig,
        direction: "download",
        remotePath: this.dependencies._normalizeRemotePath(remotePath),
        localPath,
        onBytes,
        fileName: path.posix.basename(remotePath),
      });
    }
    async downloadFile(event, tabId, remotePath, knownSize = 0) {
      let transferKey = null;
      try {
        const sender = event?.sender;
        const normalizedRemotePath =
          this.dependencies._normalizeRemotePath(remotePath);
        const defaultName = path.posix.basename(normalizedRemotePath);
        const defaultTargetPath = path.join(
          this._resolveDownloadBasePath(tabId),
          defaultName || "downloaded-file",
        );

        const dialogWindow = this._resolveDialogWindow();
        const { canceled, filePath } = await dialog.showSaveDialog(
          dialogWindow || undefined,
          {
            title: transferText("mainProcess.transfer.saveFileTitle"),
            defaultPath: defaultTargetPath,
            buttonLabel: transferText("mainProcess.transfer.downloadButton"),
          },
        );

        if (canceled || !filePath) {
          return {
            success: false,
            cancelled: true,
            error: transferText("mainProcess.transfer.downloadCancelled"),
          };
        }

        transferKey = this.dependencies._generateTransferKey(tabId, "download");
        this.dependencies._registerTransfer({
          transferKey,
          tabId,
          type: "download",
          sender,
          progressChannel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
          totalFiles: 1,
          metadata: {
            displayName: defaultName || normalizedRemotePath,
          },
        });

        const fileSize =
          Number.isFinite(knownSize) && knownSize >= 0 ? knownSize : 0;
        const state = this.dependencies._getTransfer(transferKey);
        if (state) state.totalBytes = fileSize;

        this.dependencies._emitTransferProgress(transferKey, {
          channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
          force: true,
          fileName: defaultName || normalizedRemotePath,
          currentFile: defaultName || normalizedRemotePath,
        });
        this.dependencies._throwIfTransferCancelled(transferKey);

        await this._downloadFileToPath({
          tabId,
          transferKey,
          remotePath: normalizedRemotePath,
          localPath: filePath,
          onBytes: (bytes) => {
            const current = this.dependencies._getTransfer(transferKey);
            if (!current) return;
            current.transferredBytes += bytes;
            this.dependencies._emitTransferProgress(transferKey, {
              fileName: defaultName || normalizedRemotePath,
              currentFile: defaultName || normalizedRemotePath,
              currentFileIndex: 1,
            });
          },
        });

        const finalState = this.dependencies._getTransfer(transferKey);
        if (finalState) {
          finalState.processedFiles = 1;
          finalState.transferredBytes = Math.max(
            finalState.transferredBytes,
            finalState.totalBytes,
          );
        }

        this.dependencies._emitTransferProgress(transferKey, {
          channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
          force: true,
          fileName: defaultName || normalizedRemotePath,
          currentFile: defaultName || normalizedRemotePath,
          currentFileIndex: 1,
        });

        this.dependencies._recordTransferMetrics({
          transferredBytes: finalState?.transferredBytes || 0,
          completed: 1,
          failed: 0,
          cancelled: false,
          durationMs: finalState ? Date.now() - finalState.startAt : 0,
        });
        this.dependencies._finalizeTransfer(transferKey);
        return {
          success: true,
          transferKey,
          downloadPath: filePath,
          message: transferText("mainProcess.transfer.downloadComplete"),
        };
      } catch (error) {
        if (transferKey) {
          const transferState = this.dependencies._getTransfer(transferKey);
          if (transferState) transferState.lastError = error;
          this.dependencies._recordTransferMetrics({
            transferredBytes: transferState?.transferredBytes || 0,
            completed: 0,
            failed: isCancelledError(error) ? 0 : 1,
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
          `downloadFile failed: ${normalizeErrorMessage(error)}`,
          "ERROR",
        );
        return { success: false, error: normalizeErrorMessage(error) };
      }
    }
  })();
}
module.exports = createFileDownload;
