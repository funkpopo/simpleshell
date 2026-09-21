// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createSystemAPI(bridge) {
  const {
    ipcRenderer,
    IPC_REQUEST_CHANNELS,
    IPC_EVENT_CHANNELS,
    openFilesWrappers,
  } = bridge;
  return {
    // 资源监控API
    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_GET_SYSTEM_INFO 请求主进程。
     * @param {ProcessId} processId
     * @returns {Promise<unknown>}
     */
    getSystemInfo: (processId) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_GET_SYSTEM_INFO,
        processId,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_GET_METRICS_SAMPLE 请求主进程。
     * @param {ProcessId} processId
     * @returns {Promise<unknown>}
     */
    getMetricsSample: (processId) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_GET_METRICS_SAMPLE,
        processId,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_LIST 请求主进程。
     * @param {ProcessId} processId
     * @returns {Promise<unknown>}
     */
    getProcessList: (processId) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_LIST,
        processId,
      ),

    // 获取应用版本
    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_GET_VERSION 请求主进程。
     * @returns {Promise<IpcResult<string>>}
     */
    getAppVersion: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_VERSION),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onMenuAction: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }
      /** @type {IpcCallback} */
      const wrapped = (_event, payload) => callback(payload);
      ipcRenderer.on(IPC_EVENT_CHANNELS.APP_MENU_ACTION, wrapped);
      return () => {
        ipcRenderer.removeListener(IPC_EVENT_CHANNELS.APP_MENU_ACTION, wrapped);
      };
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onOpenFiles: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }
      /** @type {IpcCallback} */
      const wrapped = (_event, payload) => callback(payload);
      openFilesWrappers.set(callback, wrapped);
      ipcRenderer.on(IPC_EVENT_CHANNELS.APP_OPEN_FILES, wrapped);
      return () => {
        ipcRenderer.removeListener(IPC_EVENT_CHANNELS.APP_OPEN_FILES, wrapped);
        openFilesWrappers.delete(callback);
      };
    },

    /**
     * 管理主进程事件监听，无返回值。
     * @param {PayloadCallback} [callback]
     * @returns {void}
     */
    offOpenFiles: (callback) => {
      const wrapped = callback && openFilesWrappers.get(callback);
      if (!wrapped) {
        return;
      }
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.APP_OPEN_FILES, wrapped);
      openFilesWrappers.delete(callback);
    },

    // 关闭应用
    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_CLOSE 请求主进程。
     * @returns {Promise<unknown>}
     */
    closeApp: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_CLOSE),

    // 检查更新
    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_CHECK_FOR_UPDATE 请求主进程。
     * @returns {Promise<unknown>}
     */
    checkForUpdate: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_CHECK_FOR_UPDATE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_OPEN_LOG_DIRECTORY 请求主进程。
     * @returns {Promise<unknown>}
     */
    openLogDirectory: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_OPEN_LOG_DIRECTORY),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_EXPORT_DIAGNOSTICS 请求主进程。
     * @returns {Promise<unknown>}
     */
    exportDiagnostics: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_EXPORT_DIAGNOSTICS),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_SUMMARY 请求主进程。
     * @param {unknown} context
     * @returns {Promise<unknown>}
     */
    copyDiagnosticSummary: (context) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_SUMMARY,
        context,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_PACKAGE 请求主进程。
     * @param {unknown} context
     * @returns {Promise<unknown>}
     */
    copyDiagnosticPackage: (context) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_PACKAGE,
        context,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_OPEN_FEEDBACK_ISSUE 请求主进程。
     * @param {unknown} context
     * @returns {Promise<unknown>}
     */
    openFeedbackIssue: (context) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_OPEN_FEEDBACK_ISSUE, context),

    // 窗口重新加载
    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_RELOAD_WINDOW 请求主进程。
     * @returns {Promise<unknown>}
     */
    reloadWindow: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_RELOAD_WINDOW),

    // 重建系统菜单（语言切换后由渲染层触发）
    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_REBUILD_SYSTEM_MENU 请求主进程。
     * @returns {Promise<unknown>}
     */
    rebuildSystemMenu: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_REBUILD_SYSTEM_MENU),

    // 窗口控制API
    /**
     * 通过 IPC_REQUEST_CHANNELS.WINDOW_MINIMIZE 请求主进程。
     * @returns {Promise<unknown>}
     */
    minimizeWindow: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_MINIMIZE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.WINDOW_TOGGLE_MAXIMIZE 请求主进程。
     * @returns {Promise<unknown>}
     */
    toggleMaximizeWindow: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.WINDOW_CLOSE 请求主进程。
     * @returns {Promise<unknown>}
     */
    closeWindow: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_CLOSE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.WINDOW_GET_STATE 请求主进程。
     * @returns {Promise<IpcResult<WindowState>>}
     */
    getWindowState: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_GET_STATE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.WINDOW_NOTIFY_READY 请求主进程。
     * @returns {Promise<unknown>}
     */
    notifyWindowReady: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_NOTIFY_READY),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback<WindowState>} callback
     * @returns {Unsubscribe}
     */
    onWindowStateChange: (callback) => {
      if (typeof callback !== "function") {
        return () => {};
      }

      /** @type {IpcCallback<WindowState>} */
      const wrappedCallback = (_event, state) => callback(state);
      ipcRenderer.on(IPC_EVENT_CHANNELS.WINDOW_STATE, wrappedCallback);
      return () =>
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.WINDOW_STATE,
          wrappedCallback,
        );
    },

    // 更新相关API
    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_DOWNLOAD_UPDATE 请求主进程。
     * @returns {Promise<unknown>}
     */
    downloadUpdate: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_DOWNLOAD_UPDATE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_INSTALL_UPDATE 请求主进程。
     * @returns {Promise<unknown>}
     */
    installUpdate: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_INSTALL_UPDATE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_GET_DOWNLOAD_PROGRESS 请求主进程。
     * @returns {Promise<unknown>}
     */
    getDownloadProgress: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_DOWNLOAD_PROGRESS),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_CANCEL_DOWNLOAD 请求主进程。
     * @returns {Promise<unknown>}
     */
    cancelDownload: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_CANCEL_DOWNLOAD),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_HAS_DOWNLOADED_INSTALLER 请求主进程。
     * @returns {Promise<unknown>}
     */
    hasDownloadedInstaller: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_HAS_DOWNLOADED_INSTALLER),

    /**
     * 通过 IPC_REQUEST_CHANNELS.APP_GET_GPU_INFO 请求主进程。
     * @returns {Promise<unknown>}
     */
    getGpuInfo: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_GPU_INFO),

    // IP地址查询API
    /**
     * 通过 IPC_REQUEST_CHANNELS.UTILITY_IP_QUERY 请求主进程。
     * @param {string} [ip]
     * @returns {Promise<unknown>}
     */
    queryIpAddress: (ip = "") =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.UTILITY_IP_QUERY, ip),

    // 网络延迟检测API
    /**
     * 通过 IPC_REQUEST_CHANNELS.LATENCY_REGISTER 请求主进程。
     * @param {string} tabId
     * @param {string} host
     * @param {number} port
     * @returns {Promise<unknown>}
     */
    registerLatencyDetection: (tabId, host, port) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_REGISTER, {
        tabId,
        host,
        port,
      }),

    /**
     * 通过 IPC_REQUEST_CHANNELS.LATENCY_UNREGISTER 请求主进程。
     * @param {string} tabId
     * @returns {Promise<unknown>}
     */
    unregisterLatencyDetection: (tabId) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_UNREGISTER, { tabId }),

    /**
     * 通过 IPC_REQUEST_CHANNELS.LATENCY_GET_INFO 请求主进程。
     * @param {string} tabId
     * @returns {Promise<unknown>}
     */
    getLatencyInfo: (tabId) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_GET_INFO, { tabId }),

    /**
     * 通过 IPC_REQUEST_CHANNELS.LATENCY_GET_ALL_INFO 请求主进程。
     * @returns {Promise<unknown>}
     */
    getAllLatencyInfo: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_GET_ALL_INFO),

    /**
     * 通过 IPC_REQUEST_CHANNELS.LATENCY_GET_SERVICE_STATUS 请求主进程。
     * @returns {Promise<unknown>}
     */
    getLatencyServiceStatus: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_GET_SERVICE_STATUS),

    /**
     * 通过 IPC_REQUEST_CHANNELS.LATENCY_TEST_NOW 请求主进程。
     * @param {string} tabId
     * @returns {Promise<unknown>}
     */
    testLatencyNow: (tabId) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_TEST_NOW, { tabId }),

    // 延迟事件监听
    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {IpcCallback} callback
     * @returns {Unsubscribe}
     */
    onLatencyUpdate: (callback) => {
      /** @type {IpcCallback} */
      const wrappedCallback = (event, data) => callback(event, data);
      ipcRenderer.on(IPC_EVENT_CHANNELS.LATENCY_UPDATED, wrappedCallback);
      return () =>
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.LATENCY_UPDATED,
          wrappedCallback,
        );
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {IpcCallback} callback
     * @returns {Unsubscribe}
     */
    onLatencyError: (callback) => {
      /** @type {IpcCallback} */
      const wrappedCallback = (event, data) => callback(event, data);
      ipcRenderer.on(IPC_EVENT_CHANNELS.LATENCY_ERROR, wrappedCallback);
      return () =>
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.LATENCY_ERROR,
          wrappedCallback,
        );
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {IpcCallback} callback
     * @returns {Unsubscribe}
     */
    onLatencyDisconnected: (callback) => {
      /** @type {IpcCallback} */
      const wrappedCallback = (event, data) => callback(event, data);
      ipcRenderer.on(IPC_EVENT_CHANNELS.LATENCY_DISCONNECTED, wrappedCallback);
      return () =>
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.LATENCY_DISCONNECTED,
          wrappedCallback,
        );
    },
  };
}
module.exports = { createSystemAPI };
