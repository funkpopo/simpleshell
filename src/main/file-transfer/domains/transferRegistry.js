/** TransferRegistry: explicit dependencies supplied by the service facade. */
function createTransferRegistry(
  dependencies,
  {
    crypto,
    configService,
    normalizeTransferName,
    buildCancelledError,
    transferText,
    normalizeErrorMessage,
  },
) {
  return new (class TransferRegistry {
    constructor() {
      this.dependencies = dependencies;
    }
    _generateToken() {
      return `${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
    }
    _generateTransferKey(tabId, type) {
      return `${tabId}-${type}-${Date.now()}-${crypto.randomBytes(2).toString("hex")}`;
    }
    _safeSend(sender, channel, payload) {
      if (!sender || !channel) return;
      try {
        if (!sender.isDestroyed()) {
          sender.send(channel, payload);
        }
      } catch {
        // ignore renderer lifecycle race
      }
    }
    _registerTransfer({
      transferKey,
      tabId,
      type,
      sender,
      progressChannel,
      totalBytes = 0,
      totalFiles = 1,
      metadata = {},
    }) {
      this.dependencies._clearTransferProcessPoolIdleTimer();

      const state = {
        transferKey,
        tabId,
        type,
        sender,
        progressChannel,
        totalBytes: Math.max(0, totalBytes || 0),
        totalFiles: Math.max(1, totalFiles || 1),
        transferredBytes: 0,
        processedFiles: 0,
        preparationTotal: 0,
        preparationCompleted: 0,
        startAt: Date.now(),
        lastEmitAt: 0,
        cancelled: false,
        cancelRequestedAt: 0,
        cancelLatencyRecorded: false,
        abortController: new AbortController(),
        status: "transferring",
        algorithm: configService.loadUISettings().transferIntegrity
          ? "sha256"
          : null,
        resumeIds: new Set(),
        verifiedFiles: 0,
        validatingFiles: new Set(),
        networkBytes: 0,
        activeStreams: new Set(),
        metadata: { ...metadata },
        displayName: normalizeTransferName(metadata?.displayName),
        lastDisplayName: normalizeTransferName(metadata?.displayName),
        lastCurrentFile: "",
        transferEngineMode: this.dependencies.transferEngineMode,
      };
      this.dependencies.activeTransfers.set(transferKey, state);
      return state;
    }
    _getTransfer(transferKey) {
      return this.dependencies.activeTransfers.get(transferKey) || null;
    }
    _isTransferCancelled(transferKey) {
      const transfer = this._getTransfer(transferKey);
      return !transfer || transfer.cancelled;
    }
    _throwIfTransferCancelled(transferKey) {
      if (this._isTransferCancelled(transferKey)) {
        throw buildCancelledError();
      }
    }
    _trackTransferStream(transferKey, stream) {
      const transfer = this._getTransfer(transferKey);
      if (!transfer || !stream) return;

      transfer.activeStreams.add(stream);

      const cleanup = () => {
        const current = this._getTransfer(transferKey);
        if (!current) return;
        current.activeStreams.delete(stream);
      };

      stream.once("close", cleanup);
      stream.once("error", cleanup);
      stream.once("end", cleanup);
    }
    _destroyTransferStreams(transferKey, reason = null) {
      const transfer = this._getTransfer(transferKey);
      if (!transfer) return;

      const destroyReason =
        reason || transferText("mainProcess.transfer.errors.cancelledByUser");

      for (const stream of transfer.activeStreams) {
        try {
          stream.destroy(new Error(destroyReason));
        } catch {
          // ignore stream destruction errors
        }
      }
      transfer.activeStreams.clear();
    }
    _finalizeTransfer(transferKey) {
      const transfer = this._getTransfer(transferKey);
      if (!transfer) return;
      if (transfer.cancelled) {
        this.dependencies._recordCancelLatency(transfer);
      }
      this._destroyTransferStreams(
        transferKey,
        transferText("mainProcess.transfer.errors.transferFinalized"),
      );
      transfer.status = transfer.cancelled
        ? "paused"
        : transfer.lastError
          ? "error"
          : "completed";
      this.dependencies._emitTransferProgress(transferKey, {
        force: true,
        extra: {
          operationComplete: true,
          status: transfer.status,
          error: transfer.lastError
            ? normalizeErrorMessage(transfer.lastError)
            : null,
          errorKind: transfer.lastError?.errorKind || null,
          retryable: transfer.lastError?.retryable === true,
        },
      });
      this.dependencies.activeTransfers.delete(transferKey);
      if (
        this.dependencies.transferProcessPool &&
        typeof this.dependencies.transferProcessPool._clearTransferState ===
          "function"
      ) {
        this.dependencies.transferProcessPool._clearTransferState(transferKey);
      }

      if (this.dependencies.activeTransfers.size === 0) {
        this.dependencies._scheduleTransferProcessPoolIdleShutdown();
      }
    }
    async cancelTransfer(event, tabId, transferKey) {
      const transfer = this._getTransfer(transferKey);
      if (!transfer) {
        return {
          success: false,
          error: transferText("mainProcess.transfer.errors.transferNotFound"),
        };
      }
      if (String(transfer.tabId) !== String(tabId)) {
        return {
          success: false,
          error: transferText(
            "mainProcess.transfer.errors.transferTabMismatch",
          ),
        };
      }

      transfer.cancelled = true;
      transfer.abortController.abort(buildCancelledError());
      transfer.cancelRequestedAt = transfer.cancelRequestedAt || Date.now();
      if (this.dependencies.transferProcessPool) {
        this.dependencies.transferProcessPool.cancelTransfer(transferKey);
      }
      this._destroyTransferStreams(
        transferKey,
        transferText("mainProcess.transfer.errors.cancelledByUser"),
      );
      this.dependencies._emitTransferProgress(transferKey, {
        force: true,
        fileName: this.dependencies._getTransferDisplayName(transfer),
        extra: {
          cancelled: true,
          userCancelled: true,
          operationComplete: true,
        },
      });

      return { success: true, cancelled: true };
    }
    cleanupTransfersForTab(tabId) {
      if (tabId === undefined || tabId === null) {
        return {
          success: false,
          cleanedCount: 0,
          error: transferText("mainProcess.transfer.errors.invalidTabId"),
        };
      }

      let cleanedCount = 0;
      for (const [
        transferKey,
        transfer,
      ] of this.dependencies.activeTransfers.entries()) {
        if (String(transfer.tabId) !== String(tabId)) continue;
        transfer.cancelled = true;
        transfer.abortController.abort(buildCancelledError());
        transfer.cancelRequestedAt = transfer.cancelRequestedAt || Date.now();
        if (this.dependencies.transferProcessPool) {
          this.dependencies.transferProcessPool.cancelTransfer(transferKey);
        }
        this._destroyTransferStreams(
          transferKey,
          transferText("mainProcess.transfer.errors.cancelledDueToTabCleanup"),
        );
        this.dependencies._emitTransferProgress(transferKey, {
          force: true,
          fileName: this.dependencies._getTransferDisplayName(transfer),
          extra: {
            cancelled: true,
            userCancelled: true,
            operationComplete: true,
          },
        });
        cleanedCount += 1;
      }

      return {
        success: true,
        cleanedCount,
        message: `Cleaned ${cleanedCount} transfer(s) for tab ${tabId}`,
      };
    }
  })();
}
module.exports = createTransferRegistry;
