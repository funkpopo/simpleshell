const serviceDependencies = require("../utils/serviceDependencies");
const createTransferRuntime = require("./domains/transferRuntime");
const createTransferRegistry = require("./domains/transferRegistry");
const createTransferProgress = require("./domains/transferProgress");
const createRemoteFolderScanner = require("./domains/remoteFolderScanner");
const createTransferRecovery = require("./domains/transferRecovery");
const createTransferBatch = require("./domains/transferBatch");
const createFileDownload = require("./domains/fileDownload");
const createMultiFileDownload = require("./domains/multiFileDownload");
const createFolderDownload = require("./domains/folderDownload");
const createFileUpload = require("./domains/fileUpload");
const createUploadSelection = require("./domains/uploadSelection");
const {
  _chooseConcurrency,
  _buildChunkSegments,
  _buildFileTaskKey,
} = require("./transferPolicy");
const { scanLocalFolder } = require("./localFolderScanner");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { app, dialog, BrowserWindow } = require("electron");

const processManager = require("../process/processManager");
const nativeSftpClient = require("../native/nativeSftpClient");
const { logToFile } = require("../utils/logger");
const { IPC_EVENT_CHANNELS } = require("../../shared/contracts/ipc/channels");
const connectionManager = require("../connection/connectionManager");
const TransferProcessPool = require("./transferProcessPool");
const ResumableTransfer = require("./resumableTransfer");
const {
  TransferResumeStore,
  connectionIdentity,
  resumeError,
} = require("./transferResume");
const { validateAlgorithm } = require("./transferIntegrity");
const {
  buildCancelledError,
  toPosixPath,
  normalizeDroppedTransferRelativePath,
} = require("./transferShared");
const { normalizeErrorMessage } = require("../utils/errorResponse");
const {
  normalizeTransferName,
  buildTransferDisplayName: buildSharedTransferDisplayName,
  getTopLevelTransferItemName,
} = require("../../shared/transferNameUtils");
const { t: translateLocale, getUiLanguage } = require("../../shared/mainI18n");
const configService = require("../settings/configService");

const transferText = (key, params = {}) =>
  translateLocale(key, { lng: getUiLanguage(configService), ...params });

const DEFAULT_PROGRESS_INTERVAL_MS = 200;
const PREPARATION_PROGRESS_PERCENT = 5;
const EVENT_LOOP_LAG_INTERVAL_MS = 1000;
const TRANSFER_ENGINE_MODE = "native-sidecar-transfer-v1";

const TRANSFER_POOL_IDLE_SHUTDOWN_MS = 2500;

function buildEmptyTransferPoolStats() {
  return {
    workerCount: 0,
    targetWorkerCount: 0,
    maxWorkers: 0,
    queuedTasks: 0,
    pendingTasks: 0,
    pendingInits: 0,
    activeTransfers: 0,
    cancelledTransfers: 0,
    maxQueueSize: 0,
    shutdown: true,
  };
}

function isCancelledError(error) {
  if (!error) return false;
  if (error.cancelled || error.userCancelled) return true;

  const msg = normalizeErrorMessage(error).toLowerCase();
  return (
    msg.includes("cancelled") ||
    msg.includes("canceled") ||
    msg.includes("user cancelled") ||
    msg.includes("transfer cancelled")
  );
}

function buildTransferDisplayName(names, itemLabel) {
  const resolvedItemLabel =
    itemLabel || transferText("mainProcess.transfer.itemLabel");
  return buildSharedTransferDisplayName(names, ({ firstName, count }) =>
    transferText("mainProcess.transfer.multipleItems", {
      firstName,
      count,
      itemLabel: resolvedItemLabel,
    }),
  );
}

class FilemanagementService {
  constructor() {
    this._transferRuntime = createTransferRuntime(
      serviceDependencies(this, {
        methods: ["_log"],
        fields: [
          "eventLoopLagTimer",
          "transferMetrics",
          "transferProcessPoolIdleTimer",
          "transferProcessPool",
          "activeTransfers",
          "transferEngineMode",
        ],
      }),
      {
        EVENT_LOOP_LAG_INTERVAL_MS,
        TransferProcessPool,
        transferText,
        buildEmptyTransferPoolStats,
        normalizeErrorMessage,
        TRANSFER_POOL_IDLE_SHUTDOWN_MS,
      },
    );
    this._transferRegistry = createTransferRegistry(
      serviceDependencies(this, {
        methods: [
          "_clearTransferProcessPoolIdleTimer",
          "_recordCancelLatency",
          "_emitTransferProgress",
          "_scheduleTransferProcessPoolIdleShutdown",
          "_getTransferDisplayName",
        ],
        fields: [
          "transferEngineMode",
          "activeTransfers",
          "transferProcessPool",
        ],
      }),
      {
        crypto,
        configService,
        normalizeTransferName,
        buildCancelledError,
        transferText,
        normalizeErrorMessage,
      },
    );
    this._transferProgress = createTransferProgress(
      serviceDependencies(this, {
        methods: ["_getTransfer", "_safeSend"],
        fields: [],
      }),
      {
        normalizeTransferName,
        DEFAULT_PROGRESS_INTERVAL_MS,
        PREPARATION_PROGRESS_PERCENT,
        IPC_EVENT_CHANNELS,
      },
    );
    this._remoteFolderScanner = createRemoteFolderScanner(
      serviceDependencies(this, {
        methods: [
          "_setTransferPreparation",
          "_throwIfTransferCancelled",
          "_advanceTransferPreparation",
          "_emitTransferProgress",
          "_getTransfer",
        ],
        fields: [],
      }),
      { toPosixPath, path, transferText, nativeSftpClient },
    );
    this._transferRecovery = createTransferRecovery(
      serviceDependencies(this, {
        methods: [
          "_resolveTransferSshConfig",
          "_getTransfer",
          "_emitTransferProgress",
          "_generateTransferKey",
          "_registerTransfer",
          "_finalizeTransfer",
          "_throwIfTransferCancelled",
          "_ensureTransferProcessPool",
          "_log",
        ],
        fields: ["resumeStore", "activeTransfers"],
      }),
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
    );
    this._transferBatch = createTransferBatch(
      serviceDependencies(this, {
        methods: [
          "_isTransferCancelled",
          "_getTransfer",
          "_runResumableFile",
          "_recordTransferMetrics",
          "_recordCancelLatency",
          "_finalizeTransfer",
          "_throwIfTransferCancelled",
          "_log",
        ],
        fields: [],
      }),
      {
        _chooseConcurrency,
        transferText,
        normalizeErrorMessage,
        isCancelledError,
      },
    );
    this._fileDownload = createFileDownload(
      serviceDependencies(this, {
        methods: [
          "_throwIfTransferCancelled",
          "_resolveTransferSshConfig",
          "_runResumableFile",
          "_normalizeRemotePath",
          "_generateTransferKey",
          "_registerTransfer",
          "_getTransfer",
          "_emitTransferProgress",
          "_recordTransferMetrics",
          "_finalizeTransfer",
          "_recordCancelLatency",
          "_log",
        ],
        fields: [],
      }),
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
    );
    this._multiFileDownload = createMultiFileDownload(
      serviceDependencies(this, {
        methods: [
          "_resolveDialogWindow",
          "_resolveDownloadBasePath",
          "_normalizeRemotePath",
          "_resolveTransferSshConfig",
          "_generateTransferKey",
          "_registerTransfer",
          "_emitTransferProgress",
          "_throwIfTransferCancelled",
          "_prepareLocalChunkDownloadTarget",
          "_generateTaskId",
          "_runTransferTaskBatch",
          "_isTransferCancelled",
          "_handleBatchTransferCancelled",
          "_getTransferDisplayName",
          "_getTransfer",
          "_mergeChunkedDownloads",
          "_recordBatchFinalMetrics",
          "_finalizeTransfer",
          "_handleBatchTransferError",
        ],
        fields: [],
      }),
      {
        transferText,
        dialog,
        buildTransferDisplayName,
        path,
        IPC_EVENT_CHANNELS,
        _buildFileTaskKey,
        _buildChunkSegments,
      },
    );
    this._folderDownload = createFolderDownload(
      serviceDependencies(this, {
        methods: [
          "_normalizeRemotePath",
          "_getDownloadFolderName",
          "_resolveDialogWindow",
          "_resolveDownloadBasePath",
          "_generateTransferKey",
          "_registerTransfer",
          "_emitTransferProgress",
          "_throwIfTransferCancelled",
          "_scanRemoteFolderTree",
          "_resolveTransferSshConfig",
          "_getTransfer",
          "_prepareLocalChunkDownloadTarget",
          "_generateTaskId",
          "_runTransferTaskBatch",
          "_isTransferCancelled",
          "_handleBatchTransferCancelled",
          "_mergeChunkedDownloads",
          "_recordBatchFinalMetrics",
          "_finalizeTransfer",
          "_handleBatchTransferError",
        ],
        fields: [],
      }),
      {
        dialog,
        transferText,
        path,
        IPC_EVENT_CHANNELS,
        fsp,
        toPosixPath,
        _buildFileTaskKey,
        _buildChunkSegments,
      },
    );
    this._fileUpload = createFileUpload(
      serviceDependencies(this, {
        methods: [
          "_throwIfTransferCancelled",
          "_resolveTransferSshConfig",
          "_generateTransferKey",
          "_getTransfer",
          "_registerTransfer",
          "_emitTransferProgress",
          "_ensureRemoteDirectories",
          "_normalizeRemotePath",
          "_generateTaskId",
          "_recordTransferMetrics",
          "_finalizeTransfer",
          "_runTransferTaskBatch",
          "_isTransferCancelled",
          "_handleBatchTransferCancelled",
          "_getTransferDisplayName",
          "_recordBatchFinalMetrics",
          "_recordCancelLatency",
        ],
        fields: [],
      }),
      {
        transferText,
        normalizeTransferName,
        path,
        _buildFileTaskKey,
        _buildChunkSegments,
        isCancelledError,
      },
    );
    this._uploadSelection = createUploadSelection(
      serviceDependencies(this, {
        methods: [
          "_resolveDialogWindow",
          "_normalizeRemotePath",
          "_joinRemotePath",
          "_uploadEntries",
          "_generateTransferKey",
          "_registerTransfer",
          "_emitTransferProgress",
          "_throwIfTransferCancelled",
          "_getTransfer",
          "_recordTransferMetrics",
          "_recordCancelLatency",
          "_finalizeTransfer",
        ],
        fields: [],
      }),
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
    );
    this.transferEngineMode = TRANSFER_ENGINE_MODE;
    this.activeTransfers = new Map();
    this.transferProcessPool = null;
    this.resumeStore = new TransferResumeStore(
      path.join(app.getPath("userData"), "transfer-recovery"),
    );
    this.transferProcessPoolIdleTimer = null;
    this.transferMetrics = {
      startedAt: Date.now(),
      successfulTransfers: 0,
      failedTransfers: 0,
      cancelledTransfers: 0,
      totalTasks: 0,
      failedTasks: 0,
      totalBytesTransferred: 0,
      cancelLatencySamples: [],
      latestTransferThroughput: 0,
      eventLoopLag: {
        latestMs: 0,
        maxMs: 0,
        totalMs: 0,
        samples: 0,
      },
    };
    this.eventLoopLagTimer = null;
    this._startEventLoopLagMonitor();
  }

  _log(message, level = "INFO") {
    if (typeof logToFile === "function") {
      logToFile(`[Filemanagement] ${message}`, level);
    }
  }

  _startEventLoopLagMonitor(...args) {
    return this._transferRuntime._startEventLoopLagMonitor(...args);
  }

  _stopEventLoopLagMonitor(...args) {
    return this._transferRuntime._stopEventLoopLagMonitor(...args);
  }

  _clearTransferProcessPoolIdleTimer(...args) {
    return this._transferRuntime._clearTransferProcessPoolIdleTimer(...args);
  }

  _ensureTransferProcessPool(...args) {
    return this._transferRuntime._ensureTransferProcessPool(...args);
  }

  _scheduleTransferProcessPoolIdleShutdown(...args) {
    return this._transferRuntime._scheduleTransferProcessPoolIdleShutdown(
      ...args,
    );
  }

  _recordTransferMetrics(...args) {
    return this._transferRuntime._recordTransferMetrics(...args);
  }

  _recordCancelLatency(...args) {
    return this._transferRuntime._recordCancelLatency(...args);
  }

  _generateTaskId(prefix = "task") {
    return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString("hex")}`;
  }

  async _resolveTransferSshConfig(tabId) {
    return nativeSftpClient.resolveSshConfig(tabId, {
      includeTimeouts: true,
      plainErrors: true,
      proxyManager: connectionManager?.sshConnectionPool?.proxyManager,
    });
  }

  _materializeUploadEntry(...args) {
    return this._fileUpload._materializeUploadEntry(...args);
  }

  getTransferRuntimeStats(...args) {
    return this._transferRuntime.getTransferRuntimeStats(...args);
  }

  _normalizeRemotePath(...args) {
    return this._remoteFolderScanner._normalizeRemotePath(...args);
  }

  _joinRemotePath(...args) {
    return this._remoteFolderScanner._joinRemotePath(...args);
  }

  _resolveDownloadBasePath(...args) {
    return this._fileDownload._resolveDownloadBasePath(...args);
  }

  _resolveDialogWindow(...args) {
    return this._fileDownload._resolveDialogWindow(...args);
  }

  _generateToken(...args) {
    return this._transferRegistry._generateToken(...args);
  }

  _generateTransferKey(...args) {
    return this._transferRegistry._generateTransferKey(...args);
  }

  _safeSend(...args) {
    return this._transferRegistry._safeSend(...args);
  }

  _prepareLocalChunkDownloadTarget(...args) {
    return this._fileDownload._prepareLocalChunkDownloadTarget(...args);
  }

  _registerTransfer(...args) {
    return this._transferRegistry._registerTransfer(...args);
  }

  _getTransfer(...args) {
    return this._transferRegistry._getTransfer(...args);
  }

  _isTransferCancelled(...args) {
    return this._transferRegistry._isTransferCancelled(...args);
  }

  _throwIfTransferCancelled(...args) {
    return this._transferRegistry._throwIfTransferCancelled(...args);
  }

  _trackTransferStream(...args) {
    return this._transferRegistry._trackTransferStream(...args);
  }

  _destroyTransferStreams(...args) {
    return this._transferRegistry._destroyTransferStreams(...args);
  }

  _setTransferPreparation(...args) {
    return this._transferProgress._setTransferPreparation(...args);
  }

  _advanceTransferPreparation(...args) {
    return this._transferProgress._advanceTransferPreparation(...args);
  }

  _getTransferDisplayName(...args) {
    return this._transferProgress._getTransferDisplayName(...args);
  }

  _emitTransferProgress(...args) {
    return this._transferProgress._emitTransferProgress(...args);
  }

  _finalizeTransfer(...args) {
    return this._transferRegistry._finalizeTransfer(...args);
  }

  cancelTransfer(...args) {
    return this._transferRegistry.cancelTransfer(...args);
  }

  cleanupTransfersForTab(...args) {
    return this._transferRegistry.cleanupTransfersForTab(...args);
  }

  _ensureRemoteDirectories(...args) {
    return this._remoteFolderScanner._ensureRemoteDirectories(...args);
  }

  _scanRemoteFolderTree(...args) {
    return this._remoteFolderScanner._scanRemoteFolderTree(...args);
  }

  _getDownloadFolderName(...args) {
    return this._remoteFolderScanner._getDownloadFolderName(...args);
  }

  listResumableTransfers(...args) {
    return this._transferRecovery.listResumableTransfers(...args);
  }

  setTransferIntegrity(...args) {
    return this._transferRecovery.setTransferIntegrity(...args);
  }

  discardResumableTransfer(...args) {
    return this._transferRecovery.discardResumableTransfer(...args);
  }

  resumeTransfer(...args) {
    return this._transferRecovery.resumeTransfer(...args);
  }

  _runResumableFile(...args) {
    return this._transferRecovery._runResumableFile(...args);
  }

  _downloadFileToPath(...args) {
    return this._fileDownload._downloadFileToPath(...args);
  }

  downloadFile(...args) {
    return this._fileDownload.downloadFile(...args);
  }

  _runTransferTaskBatch(...args) {
    return this._transferBatch._runTransferTaskBatch(...args);
  }

  _handleBatchTransferCancelled(...args) {
    return this._transferBatch._handleBatchTransferCancelled(...args);
  }

  _mergeChunkedDownloads(...args) {
    return this._transferBatch._mergeChunkedDownloads(...args);
  }

  _recordBatchFinalMetrics(...args) {
    return this._transferBatch._recordBatchFinalMetrics(...args);
  }

  _handleBatchTransferError(...args) {
    return this._transferBatch._handleBatchTransferError(...args);
  }

  downloadFiles(...args) {
    return this._multiFileDownload.downloadFiles(...args);
  }

  downloadFolder(...args) {
    return this._folderDownload.downloadFolder(...args);
  }

  _uploadEntries(...args) {
    return this._fileUpload._uploadEntries(...args);
  }

  uploadFile(...args) {
    return this._uploadSelection.uploadFile(...args);
  }

  uploadDroppedFiles(...args) {
    return this._uploadSelection.uploadDroppedFiles(...args);
  }

  uploadFolder(...args) {
    return this._uploadSelection.uploadFolder(...args);
  }

  cleanup() {
    this._clearTransferProcessPoolIdleTimer();
    this._stopEventLoopLagMonitor();
    for (const [transferKey, transfer] of this.activeTransfers.entries()) {
      try {
        transfer.cancelled = true;
        transfer.abortController.abort(buildCancelledError());
        transfer.cancelRequestedAt = transfer.cancelRequestedAt || Date.now();
        if (this.transferProcessPool) {
          this.transferProcessPool.cancelTransfer(transferKey);
        }
        this._destroyTransferStreams(
          transferKey,
          transferText("mainProcess.transfer.errors.applicationCleanup"),
        );
      } catch {
        // ignore cleanup error
      }
      transfer.status = transfer.cancelled
        ? "paused"
        : transfer.lastError
          ? "error"
          : "completed";
      this._emitTransferProgress(transferKey, {
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
      this.activeTransfers.delete(transferKey);
    }
    if (this.transferProcessPool) {
      const pool = this.transferProcessPool;
      this.transferProcessPool = null;
      pool.shutdown().catch((error) => {
        this._log(
          `Transfer process pool shutdown failed: ${normalizeErrorMessage(error)}`,
          "WARN",
        );
      });
    }
    this._log(
      "All active Filemanagement transfers have been cleaned up",
      "INFO",
    );
  }
}

module.exports = new FilemanagementService();
