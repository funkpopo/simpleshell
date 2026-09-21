// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createSettingsAPI(bridge) {
  const {
    ipcRenderer,
    IPC_REQUEST_CHANNELS,
    IPC_EVENT_CHANNELS,
    localDataClearedWrappers,
  } = bridge;
  return {
    // UI设置相关API
    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_LOAD_UI 请求主进程。
     * @returns {Promise<unknown>}
     */
    loadUISettings: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_LOAD_UI),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_SAVE_UI 请求主进程。
     * @param {Record<string, unknown>} settings
     * @returns {Promise<unknown>}
     */
    saveUISettings: (settings) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_SAVE_UI, settings),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_GET_CREDENTIAL_SECURITY_STATUS 请求主进程。
     * @returns {Promise<unknown>}
     */
    getCredentialSecurityStatus: () =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SETTINGS_GET_CREDENTIAL_SECURITY_STATUS,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_CREDENTIAL_SECURITY 请求主进程。
     * @param {Record<string, unknown>} settings
     * @returns {Promise<unknown>}
     */
    updateCredentialSecurity: (settings) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_CREDENTIAL_SECURITY,
        settings,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_UNLOCK_CREDENTIAL_STORE 请求主进程。
     * @param {string} masterPassword
     * @returns {Promise<unknown>}
     */
    unlockCredentialStore: (masterPassword) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SETTINGS_UNLOCK_CREDENTIAL_STORE,
        masterPassword,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_LOCK_CREDENTIAL_STORE 请求主进程。
     * @returns {Promise<unknown>}
     */
    lockCredentialStore: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_LOCK_CREDENTIAL_STORE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_CLEAR_LOCAL_DATA 请求主进程。
     * @param {Record<string, unknown>} options
     * @returns {Promise<unknown>}
     */
    clearLocalData: (options) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SETTINGS_CLEAR_LOCAL_DATA,
        options,
      ),

    // 配置导入/导出/同步相关API
    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_EXPORT 请求主进程。
     * @param {Record<string, unknown>} options
     * @returns {Promise<unknown>}
     */
    configTransferExport: (options) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_EXPORT, options),

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_IMPORT 请求主进程。
     * @param {Record<string, unknown>} options
     * @returns {Promise<unknown>}
     */
    configTransferImport: (options) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_IMPORT, options),

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_LIST_SECTIONS 请求主进程。
     * @returns {Promise<unknown>}
     */
    configTransferListSections: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_LIST_SECTIONS),

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_LOAD_SETTINGS 请求主进程。
     * @returns {Promise<unknown>}
     */
    configSyncLoadSettings: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_LOAD_SETTINGS),

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_SAVE_SETTINGS 请求主进程。
     * @param {Record<string, unknown>} settings
     * @returns {Promise<unknown>}
     */
    configSyncSaveSettings: (settings) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.CONFIG_SYNC_SAVE_SETTINGS,
        settings,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_TEST 请求主进程。
     * @param {Record<string, unknown>} settings
     * @returns {Promise<unknown>}
     */
    configSyncTest: (settings) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_TEST, settings),

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_UPLOAD 请求主进程。
     * @param {Record<string, unknown>} options
     * @returns {Promise<unknown>}
     */
    configSyncUpload: (options) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_UPLOAD, options),

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_DOWNLOAD 请求主进程。
     * @param {Record<string, unknown>} options
     * @returns {Promise<unknown>}
     */
    configSyncDownload: (options) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_DOWNLOAD, options),

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_GET_STATUS 请求主进程。
     * @returns {Promise<unknown>}
     */
    configSyncGetStatus: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_GET_STATUS),

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_PULL_NOW 请求主进程。
     * @returns {Promise<unknown>}
     */
    configSyncPullNow: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_PULL_NOW),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onConfigSyncAutoEvent: (callback) => {
      if (typeof callback !== "function") return () => {};
      const wrappedCallback = (_event, payload) => callback(payload);
      ipcRenderer.on(
        IPC_EVENT_CHANNELS.CONFIG_SYNC_AUTO_EVENT,
        wrappedCallback,
      );
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.CONFIG_SYNC_AUTO_EVENT,
          wrappedCallback,
        );
      };
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onDiskAlertEvent: (callback) => {
      if (typeof callback !== "function") return () => {};
      const wrappedCallback = (_event, payload) => callback(payload);
      ipcRenderer.on(IPC_EVENT_CHANNELS.DISK_ALERT_EVENT, wrappedCallback);
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.DISK_ALERT_EVENT,
          wrappedCallback,
        );
      };
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onConfigTransferImported: (callback) => {
      if (typeof callback !== "function") return () => {};
      const wrappedCallback = (_event, payload) => callback(payload);
      ipcRenderer.on(
        IPC_EVENT_CHANNELS.CONFIG_TRANSFER_IMPORTED,
        wrappedCallback,
      );
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.CONFIG_TRANSFER_IMPORTED,
          wrappedCallback,
        );
      };
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onLocalDataCleared: (callback) => {
      if (typeof callback !== "function") return () => {};
      const wrappedCallback = (_event, payload) => callback(payload);
      localDataClearedWrappers.set(callback, wrappedCallback);
      ipcRenderer.on(
        IPC_EVENT_CHANNELS.SETTINGS_LOCAL_DATA_CLEARED,
        wrappedCallback,
      );
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.SETTINGS_LOCAL_DATA_CLEARED,
          wrappedCallback,
        );
        localDataClearedWrappers.delete(callback);
      };
    },

    /**
     * 管理主进程事件监听，无返回值。
     * @param {PayloadCallback} [callback]
     * @returns {void}
     */
    offLocalDataCleared: (callback) => {
      if (!callback) return;
      const wrappedCallback = localDataClearedWrappers.get(callback);
      if (wrappedCallback) {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.SETTINGS_LOCAL_DATA_CLEARED,
          wrappedCallback,
        );
        localDataClearedWrappers.delete(callback);
      }
    },

    // 日志设置相关API
    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_LOAD_LOG 请求主进程。
     * @returns {Promise<unknown>}
     */
    loadLogSettings: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_LOAD_LOG),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_SAVE_LOG 请求主进程。
     * @param {Record<string, unknown>} settings
     * @returns {Promise<unknown>}
     */
    saveLogSettings: (settings) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_SAVE_LOG, settings),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_GET_ERROR_REPORTING 请求主进程。
     * @returns {Promise<unknown>}
     */
    getErrorReportingSettings: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_GET_ERROR_REPORTING),

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_SAVE_ERROR_REPORTING 请求主进程。
     * @param {Record<string, unknown>} settings
     * @returns {Promise<unknown>}
     */
    saveErrorReportingSettings: (settings) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SETTINGS_SAVE_ERROR_REPORTING,
        settings,
      ),
  };
}
module.exports = { createSettingsAPI };
