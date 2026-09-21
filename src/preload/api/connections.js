// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createConnectionsAPI(bridge) {
  const {
    ipcRenderer,
    IPC_REQUEST_CHANNELS,
    IPC_EVENT_CHANNELS,
    subscribeReconnectEvent,
    topConnectionsChangedWrappers,
    connectionsChangedWrappers,
  } = bridge;
  return {
    // 重连管理API
    /**
     * 通过 IPC_REQUEST_CHANNELS.RECONNECT_GET_STATUS 请求主进程。
     * @param {unknown} args
     * @returns {Promise<unknown>}
     */
    getReconnectStatus: (args) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_GET_STATUS, args),

    /**
     * 通过 IPC_REQUEST_CHANNELS.RECONNECT_PAUSE 请求主进程。
     * @param {unknown} args
     * @returns {Promise<unknown>}
     */
    pauseReconnect: (args) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_PAUSE, args),

    /**
     * 通过 IPC_REQUEST_CHANNELS.RECONNECT_RESUME 请求主进程。
     * @param {unknown} args
     * @returns {Promise<unknown>}
     */
    resumeReconnect: (args) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_RESUME, args),

    /**
     * 通过 IPC_REQUEST_CHANNELS.RECONNECT_GET_STATISTICS 请求主进程。
     * @returns {Promise<unknown>}
     */
    getReconnectStatistics: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_GET_STATISTICS),

    // 端口转发（SSH隧道）管理API
    /**
     * 通过 IPC_REQUEST_CHANNELS.PF_GET_RULES 请求主进程。
     * @returns {Promise<unknown>}
     */
    getPortForwardRules: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_GET_RULES),

    /**
     * 通过 IPC_REQUEST_CHANNELS.PF_SAVE_RULE 请求主进程。
     * @param {Record<string, unknown>} rule
     * @returns {Promise<unknown>}
     */
    savePortForwardRule: (rule) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_SAVE_RULE, rule),

    /**
     * 通过 IPC_REQUEST_CHANNELS.PF_DELETE_RULE 请求主进程。
     * @param {string} ruleId
     * @returns {Promise<unknown>}
     */
    deletePortForwardRule: (ruleId) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_DELETE_RULE, ruleId),

    /**
     * 通过 IPC_REQUEST_CHANNELS.PF_START_RULE 请求主进程。
     * @param {string} ruleId
     * @param {string} tabId
     * @returns {Promise<unknown>}
     */
    startPortForwardRule: (ruleId, tabId) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_START_RULE, { ruleId, tabId }),

    /**
     * 通过 IPC_REQUEST_CHANNELS.PF_STOP_RULE 请求主进程。
     * @param {string} ruleId
     * @returns {Promise<unknown>}
     */
    stopPortForwardRule: (ruleId) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_STOP_RULE, ruleId),

    /**
     * 通过 IPC_REQUEST_CHANNELS.PF_GET_ACTIVE_SESSIONS 请求主进程。
     * @returns {Promise<unknown>}
     */
    getPortForwardActiveSessions: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_GET_ACTIVE_SESSIONS),

    /**
     * 通过 IPC_REQUEST_CHANNELS.PF_GET_STATUS 请求主进程。
     * @returns {Promise<unknown>}
     */
    getPortForwardStatus: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_GET_STATUS),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onPortForwardStatusUpdated: (callback) => {
      if (typeof callback !== "function") return () => {};
      /** @type {IpcCallback} */
      const wrappedCallback = (_event, data) => callback(data);
      ipcRenderer.on(IPC_EVENT_CHANNELS.PF_STATUS_UPDATED, wrappedCallback);
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.PF_STATUS_UPDATED,
          wrappedCallback,
        );
      };
    },

    /**
     * 管理主进程事件监听，无返回值。
     * @returns {void}
     */
    removePortForwardListeners: () => {
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.PF_STATUS_UPDATED);
    },

    // 重连事件监听器
    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {ReconnectCallback} callback
     * @returns {Unsubscribe}
     */
    onReconnectStart: (callback) =>
      subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_STARTED, callback),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {ReconnectCallback} callback
     * @returns {Unsubscribe}
     */
    onReconnectProgress: (callback) =>
      subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_PROGRESS, callback),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {ReconnectCallback} callback
     * @returns {Unsubscribe}
     */
    onReconnectSuccess: (callback) =>
      subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_SUCCESS, callback),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {ReconnectCallback} callback
     * @returns {Unsubscribe}
     */
    onReconnectFailed: (callback) =>
      subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_FAILED, callback),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {ReconnectCallback} callback
     * @returns {Unsubscribe}
     */
    onReconnectAbandoned: (callback) =>
      subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_ABANDONED, callback),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {ReconnectCallback} callback
     * @returns {Unsubscribe}
     */
    onConnectionLost: (callback) =>
      subscribeReconnectEvent(IPC_EVENT_CHANNELS.CONNECTION_LOST, callback),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onTabConnectionStatus: (callback) => {
      if (typeof callback !== "function") return () => {};
      /** @type {IpcCallback} */
      const wrappedCallback = (_event, data) => callback(data);
      ipcRenderer.on(IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS, wrappedCallback);
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS,
          wrappedCallback,
        );
      };
    },

    /**
     * 通过 IPC_REQUEST_CHANNELS.CONNECTION_GET_TAB_STATUS 请求主进程。
     * @param {string} tabId
     * @returns {Promise<unknown>}
     */
    getTabConnectionStatus: (tabId) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONNECTION_GET_TAB_STATUS, tabId),

    /**
     * 管理主进程事件监听，无返回值。
     * @returns {void}
     */
    removeReconnectListeners: () => {
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_STARTED);
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_PROGRESS);
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_SUCCESS);
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_FAILED);
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_ABANDONED);
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.CONNECTION_LOST);
    },

    // 连接管理API
    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_CLEANUP_CONNECTION 请求主进程。
     * @param {ProcessId} processId
     * @returns {Promise<unknown>}
     */
    cleanupConnection: (processId) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_CLEANUP_CONNECTION,
        processId,
      ),

    // 连接配置存储API
    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_LOAD_CONNECTIONS 请求主进程。
     * @returns {Promise<unknown>}
     */
    loadConnections: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_LOAD_CONNECTIONS),

    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_GET_CONNECTION_PASSWORD 请求主进程。
     * @param {string} connectionId
     * @returns {Promise<unknown>}
     */
    getConnectionPassword: (connectionId) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_GET_CONNECTION_PASSWORD,
        connectionId,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_SAVE_CONNECTIONS 请求主进程。
     * @param {unknown[]} connections
     * @returns {Promise<unknown>}
     */
    saveConnections: (connections) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_SAVE_CONNECTIONS,
        connections,
      ),

    /**
     * 解析 OpenSSH 客户端配置文件（默认 ~/.ssh/config，可通过 configPath 指定其他路径），
     * 返回可导入的主机列表与解析告警，供设置中的“导入 OpenSSH 配置”使用。
     * 通过 IPC_REQUEST_CHANNELS.SSH_CONFIG_IMPORT 请求主进程。
     * @param {{ configPath?: string }} [options] 导入选项；configPath 为自定义配置文件绝对路径
     * @returns {Promise<unknown>} { success, exists, path, hosts, warnings }
     */
    parseOpenSSHConfig: (options = {}) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_CONFIG_IMPORT, options),

    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_LOAD_TOP_CONNECTIONS 请求主进程。
     * @returns {Promise<unknown>}
     */
    loadTopConnections: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_LOAD_TOP_CONNECTIONS),

    // 热门连接实时更新事件
    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onTopConnectionsChanged: (callback) => {
      if (typeof callback !== "function") return () => {};
      /** @type {IpcCallback} */
      const wrapped = (_e, ids) => callback(ids);
      topConnectionsChangedWrappers.set(callback, wrapped);
      ipcRenderer.on(IPC_EVENT_CHANNELS.TOP_CONNECTIONS_CHANGED, wrapped);
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.TOP_CONNECTIONS_CHANGED,
          wrapped,
        );
        topConnectionsChangedWrappers.delete(callback);
      };
    },

    /**
     * 管理主进程事件监听，无返回值。
     * @param {PayloadCallback} [callback]
     * @returns {void}
     */
    offTopConnectionsChanged: (callback) => {
      if (!callback) return;
      const wrapped = topConnectionsChangedWrappers.get(callback);
      if (wrapped) {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.TOP_CONNECTIONS_CHANGED,
          wrapped,
        );
        topConnectionsChangedWrappers.delete(callback);
      }
    },

    // 连接配置变化事件监听
    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {Unsubscribe} callback
     * @returns {Unsubscribe}
     */
    onConnectionsChanged: (callback) => {
      if (typeof callback !== "function") return () => {};
      const wrappedCallback = () => callback();
      connectionsChangedWrappers.set(callback, wrappedCallback);
      ipcRenderer.on(IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED, wrappedCallback);
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED,
          wrappedCallback,
        );
        connectionsChangedWrappers.delete(callback);
      };
    },

    /**
     * 管理主进程事件监听，无返回值。
     * @param {Unsubscribe} [callback]
     * @returns {void}
     */
    offConnectionsChanged: (callback) => {
      if (!callback) return;
      const wrappedCallback = connectionsChangedWrappers.get(callback);
      if (wrappedCallback) {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED,
          wrappedCallback,
        );
        connectionsChangedWrappers.delete(callback);
      }
    },

    // 选择密钥文件
    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_SELECT_KEY_FILE 请求主进程。
     * @returns {Promise<unknown>}
     */
    selectKeyFile: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_SELECT_KEY_FILE),

    /**
     * 上报 Mosh 客户端提示栏状态；主进程校验当前会话身份。
     * @param {string} tabId
     * @param {import("../../shared/contracts/preload").ProcessId} processId
     * @param {import("../../shared/contracts/preload").MoshTransportStatus} status
     * @returns {Promise<{success: boolean}>}
     */
    reportMoshStatus: (tabId, processId, status) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_REPORT_MOSH_STATUS, {
        tabId,
        processId,
        status,
      }),

    // SSH连接相关
    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_START_SSH 请求主进程。
     * @param {Record<string, unknown>} sshConfig
     * @returns {Promise<unknown>}
     */
    startSSH: (sshConfig) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_START_SSH, sshConfig),

    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_TEST_SSH_CONNECTION 请求主进程。
     * @param {Record<string, unknown>} sshConfig
     * @returns {Promise<unknown>}
     */
    testSSHConnection: (sshConfig) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_TEST_SSH_CONNECTION,
        sshConfig,
      ),

    // Telnet连接相关
    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_START_TELNET 请求主进程。
     * @param {Record<string, unknown>} telnetConfig
     * @returns {Promise<unknown>}
     */
    startTelnet: (telnetConfig) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_START_TELNET,
        telnetConfig,
      ),

    // 串口（Serial/COM）连接相关
    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_START_SERIAL 请求主进程。
     * @param {Record<string, unknown>} serialConfig
     * @returns {Promise<unknown>}
     */
    startSerial: (serialConfig) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_START_SERIAL,
        serialConfig,
      ),

    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_LIST_SERIAL_PORTS 请求主进程。
     * @returns {Promise<unknown>}
     */
    listSerialPorts: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_LIST_SERIAL_PORTS),

    // Mosh 连接相关（弱网/漫游场景，经本地 mosh 客户端托管）
    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_START_MOSH 请求主进程。
     * @param {Record<string, unknown>} moshConfig
     * @returns {Promise<unknown>}
     */
    startMosh: (moshConfig) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_START_MOSH, moshConfig),

    // SSH 认证相关 IPC

    // 监听 SSH 认证请求（主机密钥验证、凭证请求等）
    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onSSHAuthRequest: (callback) => {
      if (typeof callback !== "function") return () => {};
      /** @type {IpcCallback} */
      const wrappedCallback = (_, data) => callback(data);
      ipcRenderer.on(IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST, wrappedCallback);
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST,
          wrappedCallback,
        );
      };
    },

    /**
     * 管理主进程事件监听，无返回值。
     * @returns {void}
     */
    offSSHAuthRequest: () => {
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST);
    },

    // 响应 SSH 认证请求
    /**
     * 通过 IPC_REQUEST_CHANNELS.SSH_AUTH_RESPONSE 请求主进程。
     * @param {unknown} response
     * @returns {Promise<unknown>}
     */
    respondSSHAuth: (response) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_AUTH_RESPONSE, response),

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onTerminalSessionRestored: (callback) => {
      if (typeof callback !== "function") return () => {};
      /** @type {IpcCallback} */
      const wrappedCallback = (_event, data) => callback(data);
      ipcRenderer.on(
        IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORED,
        wrappedCallback,
      );
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORED,
          wrappedCallback,
        );
      };
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {PayloadCallback} callback
     * @returns {Unsubscribe}
     */
    onTerminalSessionRestoreFailed: (callback) => {
      if (typeof callback !== "function") return () => {};
      /** @type {IpcCallback} */
      const wrappedCallback = (_event, data) => callback(data);
      ipcRenderer.on(
        IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORE_FAILED,
        wrappedCallback,
      );
      return () => {
        ipcRenderer.removeListener(
          IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORE_FAILED,
          wrappedCallback,
        );
      };
    },

    // 更新连接配置（用于保存自动登录凭据）
    /**
     * 通过 IPC_REQUEST_CHANNELS.TERMINAL_UPDATE_CONNECTION_CREDENTIALS 请求主进程。
     * @param {string} connectionId
     * @param {Record<string, unknown>} credentials
     * @returns {Promise<unknown>}
     */
    updateConnectionCredentials: (connectionId, credentials) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.TERMINAL_UPDATE_CONNECTION_CREDENTIALS,
        connectionId,
        credentials,
      ),
  };
}
module.exports = { createConnectionsAPI };
