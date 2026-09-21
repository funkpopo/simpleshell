// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createFilesAPI(bridge) {
  const {
    ipcRenderer,
    IPC_REQUEST_CHANNELS,
    trackListFilesToken,
    untrackListFilesToken,
    untrackListFilesTokensForTab,
    IPC_EVENT_CHANNELS,
    listFilesChunkWrappers,
    listFilesChunkListeners,
    maybeAutoCancelTrackedListFiles,
    directoryWatchEventWrappers,
    directoryWatchEventListeners,
    withProgressListener,
    getUploadProgressChannel,
    getUploadFolderProgressChannel,
    getUploadDroppedProgressChannel,
    normalizeExternalOpenRequest,
    OPEN_EXTERNAL_IPC_TIMEOUT,
    webUtils,
  } = bridge;
  return {
    // 文件管理相关API
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_LIST 请求主进程。
     * @param {string} tabId
     * @param {string} path
     * @param {ListFilesOptions} [options]
     * @returns {Promise<unknown>}
     */
    listFiles: async (tabId, path, options) => {
      const response = await ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_LIST,
        tabId,
        path,
        options,
      );
      if (options?.nonBlocking && response?.chunked && response?.token) {
        trackListFilesToken(tabId, response.token);
      }
      return response;
    },

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_CANCEL_LIST 请求主进程。
     * @param {string} tabId
     * @param {string} [token]
     * @returns {Promise<unknown>}
     */
    cancelListFiles: (tabId, token) => {
      if (token) {
        untrackListFilesToken(token);
      } else {
        untrackListFilesTokensForTab(tabId);
      }
      return ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_CANCEL_LIST,
        tabId,
        token,
      );
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onListFilesChunk: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }

      /** @type {IpcCallback<Record<string, unknown>>} */
      const wrapped = (_, data) => {
        if (data?.done && data?.token) {
          untrackListFilesToken(data.token);
        }
        callback(data);
      };
      ipcRenderer.on(IPC_EVENT_CHANNELS.FILE_LIST_CHUNK, wrapped);
      listFilesChunkWrappers.set(callback, wrapped);
      listFilesChunkListeners.add(wrapped);

      return () => {
        ipcRenderer.removeListener(IPC_EVENT_CHANNELS.FILE_LIST_CHUNK, wrapped);
        listFilesChunkListeners.delete(wrapped);
        listFilesChunkWrappers.delete(callback);
        maybeAutoCancelTrackedListFiles();
      };
    },

    /**
     * 管理主进程事件监听，无返回值。
     * @param {PayloadCallback} [callback]
     * @returns {void}
     */
    offListFilesChunk: (callback) => {
      if (typeof callback !== "function") {
        return;
      }

      const wrapped = listFilesChunkWrappers.get(callback);
      if (!wrapped) {
        return;
      }

      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.FILE_LIST_CHUNK, wrapped);
      listFilesChunkListeners.delete(wrapped);
      listFilesChunkWrappers.delete(callback);
      maybeAutoCancelTrackedListFiles();
    },

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_START_DIRECTORY_WATCH 请求主进程。
     * @param {string} tabId
     * @param {string} path
     * @param {Record<string, unknown>} options
     * @returns {Promise<unknown>}
     */
    startDirectoryWatch: (tabId, path, options) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_START_DIRECTORY_WATCH,
        tabId,
        path,
        options,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_STOP_DIRECTORY_WATCH 请求主进程。
     * @param {string} tabId
     * @param {string|null} [watchId]
     * @returns {Promise<unknown>}
     */
    stopDirectoryWatch: (tabId, watchId = null) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_STOP_DIRECTORY_WATCH,
        tabId,
        watchId,
      ),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onDirectoryWatchEvent: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }

      /** @type {IpcCallback} */
      const wrapped = (_, data) => callback(data);
      ipcRenderer.on(IPC_EVENT_CHANNELS.DIRECTORY_WATCH_EVENT, wrapped);
      directoryWatchEventWrappers.set(callback, wrapped);
      directoryWatchEventListeners.add(wrapped);

      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.DIRECTORY_WATCH_EVENT,
          wrapped,
        );
        directoryWatchEventListeners.delete(wrapped);
        directoryWatchEventWrappers.delete(callback);
      };
    },

    /**
     * 管理主进程事件监听，无返回值。
     * @param {PayloadCallback} [callback]
     * @returns {void}
     */
    offDirectoryWatchEvent: (callback) => {
      if (typeof callback !== "function") {
        return;
      }

      const wrapped = directoryWatchEventWrappers.get(callback);
      if (!wrapped) {
        return;
      }

      ipcRenderer.removeListener(
        IPC_EVENT_CHANNELS.DIRECTORY_WATCH_EVENT,
        wrapped,
      );
      directoryWatchEventListeners.delete(wrapped);
      directoryWatchEventWrappers.delete(callback);
    },

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_COPY 请求主进程。
     * @param {string} tabId
     * @param {string} sourcePath
     * @param {string} targetPath
     * @returns {Promise<unknown>}
     */
    copyFile: (tabId, sourcePath, targetPath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_COPY,
        tabId,
        sourcePath,
        targetPath,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_MOVE 请求主进程。
     * @param {string} tabId
     * @param {string} sourcePath
     * @param {string} targetPath
     * @returns {Promise<unknown>}
     */
    moveFile: (tabId, sourcePath, targetPath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_MOVE,
        tabId,
        sourcePath,
        targetPath,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_DELETE 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @param {boolean} isDirectory
     * @returns {Promise<unknown>}
     */
    deleteFile: (tabId, filePath, isDirectory) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_DELETE,
        tabId,
        filePath,
        isDirectory,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_CREATE_FOLDER 请求主进程。
     * @param {string} tabId
     * @param {string} folderPath
     * @returns {Promise<unknown>}
     */
    createFolder: (tabId, folderPath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_CREATE_FOLDER,
        tabId,
        folderPath,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_CREATE 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @returns {Promise<unknown>}
     */
    createFile: (tabId, filePath) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CREATE, tabId, filePath),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_DOWNLOAD 请求主进程。
     * @param {string} tabId
     * @param {string} remotePath
     * @param {DownloadProgressCallback} [progressCallback]
     * @param {number} [knownSize]
     * @returns {Promise<unknown>}
     */
    downloadFile: (tabId, remotePath, progressCallback, knownSize = 0) =>
      withProgressListener({
        channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
        callback: progressCallback,
        shouldHandle: (data) => data.tabId === tabId,
        toArgs: (data) => [
          data.progress || 0,
          data.fileName || "",
          data.transferredBytes || 0,
          data.totalBytes || 0,
          data.transferSpeed || 0,
          data.remainingTime || 0,
          data.processedFiles || 0,
          data.totalFiles || 0,
          data.transferKey || "", // 添加transferKey参数
        ],
        invoke: () =>
          ipcRenderer.invoke(
            IPC_REQUEST_CHANNELS.FILE_DOWNLOAD,
            tabId,
            remotePath,
            Number.isFinite(knownSize) && knownSize >= 0 ? knownSize : 0,
          ),
      }),

    // 批量下载多个文件
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_DOWNLOAD_FILES 请求主进程。
     * @param {string} tabId
     * @param {unknown} files
     * @param {DownloadProgressCallback} [progressCallback]
     * @returns {Promise<unknown>}
     */
    downloadFiles: (tabId, files, progressCallback) =>
      withProgressListener({
        channel: IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS,
        callback: progressCallback,
        shouldHandle: (data) => data.tabId === tabId && data.isBatch,
        toArgs: (data) => [
          data.progress || 0,
          data.fileName || "",
          data.transferredBytes || 0,
          data.totalBytes || 0,
          data.transferSpeed || 0,
          data.remainingTime || 0,
          data.processedFiles || 0,
          data.totalFiles || 0,
          data.transferKey || "",
        ],
        invoke: () =>
          ipcRenderer.invoke(
            IPC_REQUEST_CHANNELS.FILE_DOWNLOAD_FILES,
            tabId,
            files,
          ),
      }),

    // 新增API
    /**
     * 通过 IPC_REQUEST_CHANNELS.EXTERNAL_EDITOR_OPEN 请求主进程。
     * @param {string} tabId
     * @param {string} remotePath
     * @returns {Promise<unknown>}
     */
    openFileInExternalEditor: (tabId, remotePath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.EXTERNAL_EDITOR_OPEN,
        tabId,
        remotePath,
      ),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {ExternalEditorCallback} callback
     * @returns {Unsubscribe}
     */
    onExternalEditorEvent: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }
      /** @type {IpcCallback} */
      const wrapped = (_, data) => callback(data);
      ipcRenderer.on(IPC_EVENT_CHANNELS.EXTERNAL_EDITOR_SYNC, wrapped);
      if (!callback._wrappedCallback) callback._wrappedCallback = wrapped;
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.EXTERNAL_EDITOR_SYNC,
          wrapped,
        );
      };
    },

    /**
     * 管理主进程事件监听，无返回值。
     * @param {ExternalEditorCallback} [callback]
     * @returns {void}
     */
    offExternalEditorEvent: (callback) => {
      if (!callback) {
        return;
      }
      const wrapped = callback._wrappedCallback || callback;
      ipcRenderer.removeListener(
        IPC_EVENT_CHANNELS.EXTERNAL_EDITOR_SYNC,
        wrapped,
      );
    },

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_RENAME 请求主进程。
     * @param {string} tabId
     * @param {string} oldPath
     * @param {string} newName
     * @returns {Promise<unknown>}
     */
    renameFile: (tabId, oldPath, newName) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_RENAME,
        tabId,
        oldPath,
        newName,
      ),

    // 权限设置API
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_SET_PERMISSIONS 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @param {unknown} permissions
     * @returns {Promise<unknown>}
     */
    setFilePermissions: (tabId, filePath, permissions) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_SET_PERMISSIONS,
        tabId,
        filePath,
        permissions,
      ),

    // 所有者/组设置API
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_SET_OWNERSHIP 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @param {unknown} owner
     * @param {unknown} group
     * @returns {Promise<unknown>}
     */
    setFileOwnership: (tabId, filePath, owner, group) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_SET_OWNERSHIP,
        tabId,
        filePath,
        owner,
        group,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @returns {Promise<unknown>}
     */
    getFilePermissions: (tabId, filePath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS,
        tabId,
        filePath,
      ),

    // 批量获取文件权限 - 减少 IPC 调用开销
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS_BATCH 请求主进程。
     * @param {string} tabId
     * @param {string[]} filePaths
     * @returns {Promise<unknown>}
     */
    getFilePermissionsBatch: (tabId, filePaths) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS_BATCH,
        tabId,
        filePaths,
      ),

    // 通用批量 IPC 调用 API
    // 用法: batchInvoke([['channel1', arg1, arg2], ['channel2', arg1]])

    // 返回: [{ success: true, data: result1 }, { success: false, error: 'message' }, ...]
    /**
     * 通过 IPC_REQUEST_CHANNELS.IPC_BATCH_INVOKE 请求主进程。
     * @param {[channel: string, ...args: unknown[]][]} calls
     * @returns {Promise<unknown>}
     */
    batchInvoke: (calls) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.IPC_BATCH_INVOKE, calls),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_UPLOAD 请求主进程。
     * @param {string} tabId
     * @param {string} targetFolder
     * @param {UploadProgressCallback} [progressCallback]
     * @returns {Promise<unknown>}
     */
    uploadFile: (tabId, targetFolder, progressCallback) =>
      withProgressListener({
        // Unique channel for this specific upload
        channel: /** @type {string} */ (
          getUploadProgressChannel(`${tabId}-${Date.now()}`)
        ),
        callback: progressCallback,
        toArgs: (progressData) => [
          // 确保传递标准化的进度数据格式
          progressData.progress || 0,
          progressData.fileName || "",
          progressData.transferredBytes || 0,
          progressData.totalBytes || 0,
          progressData.transferSpeed || 0,
          progressData.remainingTime || 0,
          progressData.currentFileIndex || 0,
          progressData.processedFiles || 0,
          progressData.totalFiles || 0,
          progressData.transferKey || "", // 添加transferKey参数
          progressData.fileList || null, // 添加fileList参数
        ],
        removeOnSignal: true,
        invoke: (progressChannel) =>
          ipcRenderer.invoke(
            IPC_REQUEST_CHANNELS.FILE_UPLOAD,
            tabId,
            targetFolder,
            progressChannel,
          ),
      }),

    // 创建远程文件夹结构
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_CREATE_REMOTE_FOLDERS 请求主进程。
     * @param {string} tabId
     * @param {string} folderPath
     * @returns {Promise<unknown>}
     */
    createRemoteFolders: (tabId, folderPath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_CREATE_REMOTE_FOLDERS,
        tabId,
        folderPath,
      ),

    // 新增: 上传文件夹API
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_UPLOAD_FOLDER 请求主进程。
     * @param {string} tabId
     * @param {string} targetFolder
     * @param {UploadFolderProgressCallback} [progressCallback]
     * @returns {Promise<unknown>}
     */
    uploadFolder: (tabId, targetFolder, progressCallback) =>
      withProgressListener({
        // Unique channel for this specific upload
        channel: /** @type {string} */ (
          getUploadFolderProgressChannel(`${tabId}-${Date.now()}`)
        ),
        callback: progressCallback,
        toArgs: (progressData) => [
          // 确保传递标准化的进度数据格式
          progressData.progress || 0,
          progressData.fileName || "",
          progressData.currentFile || "",
          progressData.transferredBytes || 0,
          progressData.totalBytes || 0,
          progressData.transferSpeed || 0,
          progressData.remainingTime || 0,
          progressData.processedFiles || 0,
          progressData.totalFiles || 0,
          progressData.transferKey || "", // 添加transferKey参数
          progressData.fileList || null, // 添加fileList参数
        ],
        removeOnSignal: true,
        invoke: (progressChannel) =>
          ipcRenderer.invoke(
            IPC_REQUEST_CHANNELS.FILE_UPLOAD_FOLDER,
            tabId,
            targetFolder,
            progressChannel,
          ),
      }),

    // 新增: 上传拖拽文件API (用于文件管理器拖放功能)
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_UPLOAD_DROPPED 请求主进程。
     * @param {string} tabId
     * @param {string} targetFolder
     * @param {unknown} uploadData
     * @param {UploadDroppedProgressCallback} [progressCallback]
     * @returns {Promise<unknown>}
     */
    uploadDroppedFiles: (tabId, targetFolder, uploadData, progressCallback) =>
      withProgressListener({
        // Unique channel for this specific upload
        channel: /** @type {string} */ (
          getUploadDroppedProgressChannel(`${tabId}-${Date.now()}`)
        ),
        callback: progressCallback,
        toArgs: (progressData) => [
          // 确保传递标准化的进度数据格式
          progressData.progress || 0,
          progressData.fileName || "",
          progressData.transferredBytes || 0,
          progressData.totalBytes || 0,
          progressData.transferSpeed || 0,
          progressData.remainingTime || 0,
          progressData.currentFileIndex || 0,
          progressData.processedFiles || 0,
          progressData.totalFiles || 0,
          progressData.transferKey || "",
          progressData.operationComplete || false,
          progressData.fileList || null, // 添加fileList参数
        ],
        removeOnSignal: true,
        invoke: (progressChannel) =>
          ipcRenderer.invoke(
            IPC_REQUEST_CHANNELS.FILE_UPLOAD_DROPPED,
            tabId,
            targetFolder,
            uploadData,
            progressChannel,
          ),
      }),

    // 新增: 下载文件夹API
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_DOWNLOAD_FOLDER 请求主进程。
     * @param {string} tabId
     * @param {string} remoteFolderPath
     * @param {DownloadProgressCallback} [progressCallback]
     * @returns {Promise<unknown>}
     */
    downloadFolder: (tabId, remoteFolderPath, progressCallback) =>
      withProgressListener({
        channel: IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
        callback: progressCallback,
        shouldHandle: (data) => data.tabId === tabId,
        toArgs: (data) => [
          data.progress || 0,
          data.currentFile || "",
          data.transferredBytes || 0,
          data.totalBytes || 0,
          data.transferSpeed || 0,
          data.remainingTime || 0,
          data.processedFiles || 0,
          data.totalFiles || 0,
          data.transferKey || "", // 添加transferKey参数
        ],
        invoke: () =>
          ipcRenderer.invoke(
            IPC_REQUEST_CHANNELS.FILE_DOWNLOAD_FOLDER,
            tabId,
            remoteFolderPath,
          ),
      }),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_CANCEL_TRANSFER 请求主进程。
     * @param {string} tabId
     * @param {string} type
     * @returns {Promise<unknown>}
     */
    cancelTransfer: (tabId, type) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_CANCEL_TRANSFER,
        tabId,
        type,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_LIST_RESUMABLE 请求主进程。
     * @returns {Promise<unknown>}
     */
    listResumableTransfers: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_LIST_RESUMABLE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_RESUME_TRANSFER 请求主进程。
     * @param {string} tabId
     * @param {string} id
     * @param {Record<string, unknown>} [options]
     * @returns {Promise<unknown>}
     */
    resumeTransfer: (tabId, id, options = {}) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_RESUME_TRANSFER,
        tabId,
        id,
        options,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_DISCARD_RESUMABLE 请求主进程。
     * @param {string} tabId
     * @param {string} id
     * @returns {Promise<unknown>}
     */
    discardResumableTransfer: (tabId, id) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_DISCARD_RESUMABLE,
        tabId,
        id,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_TRANSFER_INTEGRITY 请求主进程。
     * @param {string} tabId
     * @param {string} key
     * @param {"md5"|"sha256"} algorithm
     * @returns {Promise<unknown>}
     */
    setTransferIntegrity: (tabId, key, algorithm) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_TRANSFER_INTEGRITY,
        tabId,
        key,
        algorithm,
      ),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onSftpTransferState: (callback) => {
      /** @type {IpcCallback} */
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on(IPC_EVENT_CHANNELS.SFTP_TRANSFER_STATE, listener);
      return () =>
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.SFTP_TRANSFER_STATE,
          listener,
        );
    },

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_GET_ABSOLUTE_PATH 请求主进程。
     * @param {string} tabId
     * @param {string} relativePath
     * @returns {Promise<unknown>}
     */
    getAbsolutePath: (tabId, relativePath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_GET_ABSOLUTE_PATH,
        tabId,
        relativePath,
      ),

    // 添加文件内容读取API
    /**
     * 通过 IPC_REQUEST_CHANNELS.SFTP_READ_FILE_CONTENT 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @returns {Promise<unknown>}
     */
    readFileContent: (tabId, filePath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SFTP_READ_FILE_CONTENT,
        tabId,
        filePath,
      ),

    // 新增：保存文件内容API
    /**
     * 通过 IPC_REQUEST_CHANNELS.SFTP_SAVE_FILE_CONTENT 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @param {string} content
     * @returns {Promise<unknown>}
     */
    saveFileContent: (tabId, filePath, content) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SFTP_SAVE_FILE_CONTENT,
        tabId,
        filePath,
        content,
      ),

    // 从base64解码读取文件内容
    /**
     * 通过 IPC_REQUEST_CHANNELS.SFTP_READ_FILE_BASE64 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @returns {Promise<unknown>}
     */
    readFileAsBase64: (tabId, filePath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SFTP_READ_FILE_BASE64,
        tabId,
        filePath,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SFTP_LIST_FILE_SNAPSHOTS 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @returns {Promise<unknown>}
     */
    listFileSnapshots: (tabId, filePath) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SFTP_LIST_FILE_SNAPSHOTS,
        tabId,
        filePath,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SFTP_CREATE_FILE_SNAPSHOT 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @param {string} content
     * @param {Record<string, unknown>} [options]
     * @returns {Promise<unknown>}
     */
    createFileSnapshot: (tabId, filePath, content, options = {}) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SFTP_CREATE_FILE_SNAPSHOT,
        tabId,
        filePath,
        content,
        options,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SFTP_GET_FILE_SNAPSHOT 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @param {string} snapshotId
     * @returns {Promise<unknown>}
     */
    getFileSnapshot: (tabId, filePath, snapshotId) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SFTP_GET_FILE_SNAPSHOT,
        tabId,
        filePath,
        snapshotId,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SFTP_RESTORE_FILE_SNAPSHOT 请求主进程。
     * @param {string} tabId
     * @param {string} filePath
     * @param {string} snapshotId
     * @param {string|null} [currentContent]
     * @returns {Promise<unknown>}
     */
    restoreFileSnapshot: (tabId, filePath, snapshotId, currentContent = null) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SFTP_RESTORE_FILE_SNAPSHOT,
        tabId,
        filePath,
        snapshotId,
        currentContent,
      ),

    // 在外部浏览器打开链接
    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_OPEN_EXTERNAL 请求主进程。
     * @param {string} url
     * @param {ExternalOpenOptions} [options]
     * @returns {Promise<ExternalOpenResult>}
     */
    openExternal: async (url, options = {}) => {
      const payload = normalizeExternalOpenRequest(url, options);
      const result = await Promise.race([
        ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_OPEN_EXTERNAL, payload),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("openExternal IPC timed out")),
            OPEN_EXTERNAL_IPC_TIMEOUT,
          ),
        ),
      ]);
      if (result && typeof result === "object" && "success" in result) {
        if (!result.success) {
          throw new Error(result.error || "Failed to open external URL");
        }
        return result;
      }
      return { success: true };
    },

    // 文件系统辅助API
    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_CHECK_PATH_EXISTS 请求主进程。
     * @param {string} path
     * @returns {Promise<unknown>}
     */
    checkPathExists: (path) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CHECK_PATH_EXISTS, path),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_SHOW_ITEM_IN_FOLDER 请求主进程。
     * @param {string} path
     * @returns {Promise<unknown>}
     */
    showItemInFolder: (path) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_SHOW_ITEM_IN_FOLDER, path),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_VALIDATE_DROPPED_ITEMS 请求主进程。
     * @param {unknown[]} items
     * @returns {Promise<unknown>}
     */
    validateDroppedItems: (items) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_VALIDATE_DROPPED_ITEMS,
        items,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.FILE_CHECK_DROPPED_UPLOAD_CONFLICTS 请求主进程。
     * @param {string} tabId
     * @param {string} targetFolder
     * @param {unknown} uploadData
     * @returns {Promise<unknown>}
     */
    checkDroppedUploadConflicts: (tabId, targetFolder, uploadData) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.FILE_CHECK_DROPPED_UPLOAD_CONFLICTS,
        tabId,
        targetFolder,
        uploadData,
      ),

    /**
     * 通过 Electron webUtils 获取拖放文件路径，失败时返回空串。
     * @param {File} file
     * @returns {string}
     */
    getPathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file) || "";
      } catch {
        return "";
      }
    },

    // 性能设置实时更新API
    /**
     * 通过 IPC_REQUEST_CHANNELS.RUNTIME_FILES_CONFIGURE 请求主进程。
     * @param {string} resourceName
     * @param {Record<string, unknown>} [settings]
     * @returns {Promise<unknown>}
     */
    configureRuntimeFileResource: (resourceName, settings = {}) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.RUNTIME_FILES_CONFIGURE,
        resourceName,
        settings,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.RUNTIME_FILES_RELEASE_PATH 请求主进程。
     * @param {string} resourceName
     * @param {string} targetPath
     * @param {Record<string, unknown>} [options]
     * @returns {Promise<unknown>}
     */
    releaseRuntimeFilePath: (resourceName, targetPath, options = {}) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.RUNTIME_FILES_RELEASE_PATH,
        resourceName,
        targetPath,
        options,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.RUNTIME_FILES_CLEAR 请求主进程。
     * @param {string} resourceName
     * @param {Record<string, unknown>} [options]
     * @returns {Promise<unknown>}
     */
    clearRuntimeFileResource: (resourceName, options = {}) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.RUNTIME_FILES_CLEAR,
        resourceName,
        options,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.RUNTIME_FILES_SWEEP 请求主进程。
     * @param {string} resourceName
     * @param {Record<string, unknown>} [options]
     * @returns {Promise<unknown>}
     */
    sweepRuntimeFileResource: (resourceName, options = {}) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.RUNTIME_FILES_SWEEP,
        resourceName,
        options,
      ),
  };
}
module.exports = { createFilesAPI };
