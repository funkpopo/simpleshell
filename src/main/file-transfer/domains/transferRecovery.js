/** TransferRecovery: explicit dependencies supplied by the service facade. */
function createTransferRecovery(
  dependencies,
  {
    processManager,
    connectionIdentity,
    path,
    validateAlgorithm,
    resumeError,
    fsp,
    nativeSftpClient,
    IPC_EVENT_CHANNELS,
    ResumableTransfer,
    _buildChunkSegments,
    _chooseConcurrency,
  },
) {
  return new (class TransferRecovery {
    constructor() {
      this.dependencies = dependencies;
    }
    async listResumableTransfers() {
      const records = await this.dependencies.resumeStore.list();
      const active = new Set(
        [...this.dependencies.activeTransfers.values()].flatMap((state) => [
          ...state.resumeIds,
        ]),
      );
      const result = [];
      for (const record of records) {
        if (active.has(record.id)) continue;
        let tabId = null;
        for (const [key, process] of processManager.getAllProcesses()) {
          const config = process.config;
          if (
            !config?.host ||
            !config.username ||
            process.ready === false ||
            config.host.toLowerCase() !== record.connection.host ||
            Number(config.port || 22) !== record.connection.port ||
            config.username !== record.connection.username
          )
            continue;
          const sessionKey = process.tabId || config.tabId || key;
          const resolved =
            await this.dependencies._resolveTransferSshConfig(sessionKey);
          if (
            JSON.stringify(connectionIdentity(resolved)) ===
            JSON.stringify(record.connection)
          ) {
            tabId = sessionKey;
            break;
          }
        }
        result.push({
          id: record.id,
          tabId,
          direction: record.direction,
          fileName: path.basename(record.localPath),
          localPath: record.localPath,
          remotePath: record.remotePath,
          host: record.connection.host,
          username: record.connection.username,
          totalBytes: record.manifest?.totalSize || 0,
          completedBytes:
            record.manifest?.segments.reduce(
              (sum, segment) => sum + (segment.done ? segment.length : 0),
              0,
            ) || 0,
          algorithm: record.manifest?.algorithm || null,
          error: record.error || null,
          errorKind: record.errorKind || null,
        });
      }
      return { success: true, tasks: result };
    }
    async setTransferIntegrity(event, tabId, transferKey, algorithm) {
      void event;
      validateAlgorithm(algorithm);
      const state = this.dependencies._getTransfer(transferKey);
      if (
        !state ||
        String(state.tabId) !== String(tabId) ||
        state.cancelled ||
        state.processedFiles > 0 ||
        state.verifiedFiles > 0 ||
        state.validatingFiles.size > 0
      ) {
        throw resumeError(
          "Task verification can only be enabled before its first file completes",
        );
      }
      state.algorithm = algorithm;
      this.dependencies._emitTransferProgress(transferKey, { force: true });
      return { success: true, algorithm };
    }
    async discardResumableTransfer(event, tabId, id) {
      void event;
      const record = await this.dependencies.resumeStore.getRecord(id);
      if (
        [...this.dependencies.activeTransfers.values()].some((state) =>
          state.resumeIds.has(id),
        )
      )
        throw resumeError(
          "Pause the transfer before cleaning retained files",
          "transfer-busy",
        );
      const release = this.dependencies.resumeStore.acquire(record);
      try {
        if (record.direction === "download")
          await fsp.rm(record.partPath, { force: true });
        else {
          const config =
            await this.dependencies._resolveTransferSshConfig(tabId);
          if (
            JSON.stringify(connectionIdentity(config)) !==
            JSON.stringify(record.connection)
          )
            throw resumeError("Resume connection identity does not match");
          const result = await nativeSftpClient.deleteFile(
            tabId,
            record.partPath,
            false,
          );
          if (result?.errorCode !== "NATIVE_SFTP_NOT_FOUND")
            nativeSftpClient.requireNativeSuccess(result);
        }
        await this.dependencies.resumeStore.remove(record);
        return { success: true };
      } finally {
        release();
      }
    }
    async resumeTransfer(event, tabId, id, options = {}) {
      const record = await this.dependencies.resumeStore.getRecord(id);
      const sshConfig =
        await this.dependencies._resolveTransferSshConfig(tabId);
      if (
        JSON.stringify(connectionIdentity(sshConfig)) !==
        JSON.stringify(record.connection)
      )
        throw resumeError("Resume connection identity does not match");
      if (options.algorithm != null) validateAlgorithm(options.algorithm);
      if (options.restart === true)
        await this.discardResumableTransfer(event, tabId, id);
      const manifest = options.restart
        ? null
        : await this.dependencies.resumeStore.read(record);
      const transferKey = this.dependencies._generateTransferKey(
        tabId,
        `resume-${record.direction}`,
      );
      const state = this.dependencies._registerTransfer({
        transferKey,
        tabId,
        type: record.direction,
        sender: event.sender,
        progressChannel: IPC_EVENT_CHANNELS.TRANSFER_PROGRESS,
        totalFiles: 1,
        totalBytes: manifest?.totalSize || 0,
        metadata: { displayName: path.basename(record.localPath) },
      });
      state.algorithm =
        options.algorithm || manifest?.algorithm || state.algorithm;
      state.resumeIds.add(id);
      this.dependencies._emitTransferProgress(transferKey, { force: true });
      try {
        const result = await this._runResumableFile({
          ...record,
          tabId,
          transferKey,
          sshConfig,
          fileName: path.basename(record.localPath),
          onBytes: (bytes) => {
            state.transferredBytes += bytes;
            this.dependencies._emitTransferProgress(transferKey);
          },
        });
        state.processedFiles = 1;
        return { success: true, transferKey, ...result };
      } catch (error) {
        state.lastError = error;
        return {
          success: false,
          cancelled: state.cancelled,
          error: error.message,
          errorKind: error.errorKind,
          algorithm: error.algorithm,
          localHash: error.localHash,
          remoteHash: error.remoteHash,
        };
      } finally {
        this.dependencies._finalizeTransfer(transferKey);
      }
    }
    async _runResumableFile({
      tabId,
      transferKey,
      sshConfig,
      direction,
      localPath,
      remotePath,
      onBytes,
      fileName,
    }) {
      const state = this.dependencies._getTransfer(transferKey);
      this.dependencies._throwIfTransferCancelled(transferKey);
      const record = this.dependencies.resumeStore.describe({
        direction,
        localPath,
        remotePath,
        connection: connectionIdentity(sshConfig),
      });
      state.resumeIds.add(record.id);
      let tracked = 0;
      let network = 0;
      const runner = new ResumableTransfer({
        store: this.dependencies.resumeStore,
        pool: this.dependencies._ensureTransferProcessPool(),
        record,
        sshConfig,
        tabId,
        transferKey,
        signal: state.abortController.signal,
        segments: (size) =>
          _buildChunkSegments(size).length
            ? _buildChunkSegments(size)
            : [{ offset: 0, length: size }],
        getAlgorithm: () => state.algorithm,
        maxConcurrency: _chooseConcurrency(
          16,
          state.totalBytes,
          false,
          direction,
        ),
        log: (message) => this.dependencies._log(message),
        onRecord: (id) => {
          state.resumeIds.add(id);
        },
        onProgress: (bytes, size, networkBytes) => {
          state.networkBytes += networkBytes - network;
          network = networkBytes;
          if (state.totalFiles === 1) state.totalBytes = size;
          onBytes(bytes - tracked);
          tracked = bytes;
        },
        onState: (status, integrity) => {
          if (status === "validating") state.validatingFiles.add(record.id);
          else state.validatingFiles.delete(record.id);
          state.status =
            state.validatingFiles.size > 0
              ? "validating"
              : status === "file-completed"
                ? "transferring"
                : status;
          if (status === "file-completed" && integrity.verified)
            state.verifiedFiles += 1;
          if (integrity.algorithm) {
            state.integrity = integrity;
            state.algorithm = integrity.algorithm;
          }
          this.dependencies._emitTransferProgress(transferKey, {
            force: true,
            currentFile: fileName,
          });
        },
      });
      try {
        return await runner.run();
      } catch (error) {
        state.lastError = error;
        state.validatingFiles.delete(record.id);
        if (error.localHash)
          state.integrity = {
            algorithm: error.algorithm,
            localHash: error.localHash,
            remoteHash: error.remoteHash,
            verified: false,
          };
        throw error;
      }
    }
  })();
}
module.exports = createTransferRecovery;
