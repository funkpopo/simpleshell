/** File transfer IPC dispatchers (download, upload, cancel). */
function createTransferOperationMethods({
  filemanagementService,
  processManager,
  zmodemTransferService,
  fileText,
  isUserCancelledError,
  buildUserCancelledResponse,
}) {
  return {
    async downloadFile(event, tabId, remotePath, knownSize = 0) {
      const result = await filemanagementService.downloadFile(
        event,
        tabId,
        remotePath,
        knownSize,
      );
      if (result.success) {
        this.activeTransfers.set(`${tabId}-${remotePath}`, result.transferKey);
      }
      return result;
    },

    async downloadFolder(event, tabId, remotePath) {
      return filemanagementService.downloadFolder(event, tabId, remotePath);
    },

    async downloadFiles(event, tabId, files) {
      return filemanagementService.downloadFiles(event, tabId, files);
    },

    async cancelTransfer(event, tabId, transferKey) {
      // ZMODEM（rz/sz）传输复用全局传输 UI 的取消入口，
      // transferKey 形如 "zmodem:<processId>"，在此路由到 ZMODEM 服务
      if (
        typeof transferKey === "string" &&
        transferKey.startsWith("zmodem:")
      ) {
        const processId = transferKey.slice("zmodem:".length);
        const cancelled = zmodemTransferService.cancelTransfer(processId);
        return { success: true, cancelled };
      }

      if (
        filemanagementService &&
        typeof filemanagementService.cancelTransfer === "function"
      ) {
        const nextResult = await filemanagementService.cancelTransfer(
          event,
          tabId,
          transferKey,
        );

        if (nextResult?.success || nextResult?.cancelled) {
          for (const [k, v] of this.activeTransfers.entries()) {
            if (v === transferKey) {
              this.activeTransfers.delete(k);
            }
          }
          return nextResult;
        }
      }

      const result = await filemanagementService.cancelTransfer(
        event,
        tabId,
        transferKey,
      );

      // Clean up any local bookkeeping that maps to this transferKey (if present).
      for (const [k, v] of this.activeTransfers.entries()) {
        if (v === transferKey) {
          this.activeTransfers.delete(k);
        }
      }
      return result;
    },

    _assertUploadReady(serviceMethod, tabId) {
      if (typeof filemanagementService?.[serviceMethod] !== "function") {
        throw new Error("SFTP Upload feature not properly initialized.");
      }
      const processInfo = processManager.getProcess(tabId);
      if (
        !processInfo ||
        !processInfo.config ||
        !processInfo.process ||
        processInfo.type !== "ssh"
      ) {
        throw new Error(fileText("mainProcess.file.sshConnectionInvalid"));
      }
    },

    async uploadFile(event, tabId, targetFolder, progressChannel) {
      this._assertUploadReady("uploadFile", tabId);
      try {
        return await filemanagementService.uploadFile(
          event,
          tabId,
          targetFolder,
          progressChannel,
        );
      } catch (error) {
        // 用户主动取消按成功响应返回,不作为错误上报
        if (isUserCancelledError(error)) {
          return buildUserCancelledResponse();
        }
        throw error;
      }
    },

    async uploadDroppedFiles(
      event,
      tabId,
      targetFolder,
      uploadData,
      progressChannel,
    ) {
      this._assertUploadReady("uploadDroppedFiles", tabId);
      try {
        return await filemanagementService.uploadDroppedFiles(
          event,
          tabId,
          targetFolder,
          uploadData,
          progressChannel,
        );
      } catch (error) {
        if (isUserCancelledError(error)) {
          return buildUserCancelledResponse();
        }
        throw error;
      }
    },

    async uploadFolder(event, tabId, targetFolder, progressChannel) {
      this._assertUploadReady("uploadFolder", tabId);
      try {
        return await filemanagementService.uploadFolder(
          event,
          tabId,
          targetFolder,
          progressChannel,
        );
      } catch (error) {
        if (isUserCancelledError(error)) {
          return buildUserCancelledResponse();
        }
        throw error;
      }
    },
  };
}

module.exports = createTransferOperationMethods;
