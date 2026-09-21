// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createAiAPI(bridge) {
  const {
    ipcRenderer,
    IPC_REQUEST_CHANNELS,
    AI_STREAM_CHANNELS,
    streamWrappersByChannel,
    IPC_EVENT_CHANNELS,
  } = bridge;
  return {
    // AI助手API
    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_SETTINGS 请求主进程。
     * @param {Record<string, unknown>} settings
     * @returns {Promise<unknown>}
     */
    saveAISettings: (settings) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_SETTINGS, settings),

    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_LOAD_SETTINGS 请求主进程。
     * @returns {Promise<unknown>}
     */
    loadAISettings: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_LOAD_SETTINGS),

    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_SEND_PROMPT 请求主进程。
     * @param {string} prompt
     * @param {Record<string, unknown>} settings
     * @returns {Promise<unknown>}
     */
    sendAIPrompt: (prompt, settings) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SEND_PROMPT, prompt, settings),

    // 新增: 直接发送API请求的方法
    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_SEND_API_REQUEST 请求主进程。
     * @param {Record<string, unknown>} requestData
     * @param {boolean} isStream
     * @returns {Promise<unknown>}
     */
    sendAPIRequest: (requestData, isStream) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.AI_SEND_API_REQUEST,
        requestData,
        isStream,
      ),

    // 新增: 中断API请求的方法
    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_ABORT_API_REQUEST 请求主进程。
     * @param {string} sessionId
     * @returns {Promise<unknown>}
     */
    cancelAPIRequest: (sessionId) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_ABORT_API_REQUEST, sessionId),

    // 新增: API配置管理方法
    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_API_CONFIG 请求主进程。
     * @param {Record<string, unknown>} config
     * @returns {Promise<unknown>}
     */
    saveApiConfig: (config) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_API_CONFIG, config),

    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_DELETE_API_CONFIG 请求主进程。
     * @param {string} configId
     * @returns {Promise<unknown>}
     */
    deleteApiConfig: (configId) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_DELETE_API_CONFIG, configId),

    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_SET_CURRENT_API_CONFIG 请求主进程。
     * @param {string} configId
     * @returns {Promise<unknown>}
     */
    setCurrentApiConfig: (configId) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.AI_SET_CURRENT_API_CONFIG,
        configId,
      ),

    // 新增: 获取模型列表方法
    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_FETCH_MODELS 请求主进程。
     * @param {Record<string, unknown>} requestData
     * @returns {Promise<unknown>}
     */
    fetchModels: (requestData) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_FETCH_MODELS, requestData),

    // 新增: 保存自定义风险规则
    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_CUSTOM_RISK_RULES 请求主进程。
     * @param {unknown[]} rules
     * @returns {Promise<unknown>}
     */
    saveCustomRiskRules: (rules) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_CUSTOM_RISK_RULES, rules),

    // 新增: AI 代理配置读取/保存
    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_GET_PROXY_CONFIG 请求主进程。
     * @returns {Promise<unknown>}
     */
    getAISettingsProxy: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_GET_PROXY_CONFIG),

    /**
     * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_PROXY_CONFIG 请求主进程。
     * @param {Record<string, unknown>} proxyConfig
     * @returns {Promise<unknown>}
     */
    saveAISettingsProxy: (proxyConfig) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.AI_SAVE_PROXY_CONFIG,
        proxyConfig,
      ),

    // 记忆文件管理API
    /**
     * 通过 IPC_REQUEST_CHANNELS.MEMORY_SAVE 请求主进程。
     * @param {unknown} memory
     * @returns {Promise<unknown>}
     */
    saveMemory: (memory) =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_SAVE, memory),

    /**
     * 通过 IPC_REQUEST_CHANNELS.MEMORY_LOAD 请求主进程。
     * @returns {Promise<unknown>}
     */
    loadMemory: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_LOAD),

    /**
     * 通过 IPC_REQUEST_CHANNELS.MEMORY_DELETE 请求主进程。
     * @returns {Promise<unknown>}
     */
    deleteMemory: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_DELETE),

    /**
     * 通过 IPC_REQUEST_CHANNELS.MEMORY_GET_DIAGNOSTICS 请求主进程。
     * @returns {Promise<unknown>}
     */
    getMemoryDiagnostics: () =>
      ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_GET_DIAGNOSTICS),

    // 添加事件监听器注册方法
    /**
     * 管理主进程事件监听，无返回值。
     * @param {string} channel
     * @param {IpcCallback} callback
     * @returns {void}
     */
    on: (channel, callback) => {
      if (AI_STREAM_CHANNELS.includes(channel)) {
        // 包装回调函数，确保正确传递数据
        const wrappedCallback = (event, data) => {
          callback(event, data);
        };
        ipcRenderer.on(channel, wrappedCallback);
        // 存储映射，用于后续移除（按 channel 区分）
        streamWrappersByChannel[channel].set(callback, wrappedCallback);
      }
    },

    // 添加off方法作为removeListener的别名
    /**
     * 管理主进程事件监听，无返回值。
     * @param {string} channel
     * @param {IpcCallback} [callback]
     * @returns {void}
     */
    off: (channel, callback) => {
      if (AI_STREAM_CHANNELS.includes(channel)) {
        // 使用包装的回调函数进行移除
        const wrappedCallback =
          callback && streamWrappersByChannel[channel].get(callback);
        if (wrappedCallback) {
          ipcRenderer.removeListener(channel, wrappedCallback);
          streamWrappersByChannel[channel].delete(callback);
        }
      }
    },

    // 添加事件监听器移除方法
    /**
     * 管理主进程事件监听，无返回值。
     * @param {string} channel
     * @param {IpcCallback} [callback]
     * @returns {void}
     */
    removeListener: (channel, callback) => {
      if (AI_STREAM_CHANNELS.includes(channel)) {
        // 使用包装的回调函数进行移除
        const wrappedCallback =
          callback && streamWrappersByChannel[channel].get(callback);
        if (wrappedCallback) {
          ipcRenderer.removeListener(channel, wrappedCallback);
          streamWrappersByChannel[channel].delete(callback);
        }
      }
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {IpcCallback} callback
     * @returns {Unsubscribe}
     */
    onAIStreamChunk: (callback) => {
      if (typeof callback !== "function") return () => {};
      const channel = IPC_EVENT_CHANNELS.AI_STREAM_CHUNK;
      const wrappedCallback = (event, data) => callback(event, data);
      ipcRenderer.on(channel, wrappedCallback);
      streamWrappersByChannel[channel].set(callback, wrappedCallback);
      return () => {
        ipcRenderer.removeListener(channel, wrappedCallback);
        streamWrappersByChannel[channel].delete(callback);
      };
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {IpcCallback} callback
     * @returns {Unsubscribe}
     */
    onAIStreamEnd: (callback) => {
      if (typeof callback !== "function") return () => {};
      const channel = IPC_EVENT_CHANNELS.AI_STREAM_END;
      const wrappedCallback = (event, data) => callback(event, data);
      ipcRenderer.on(channel, wrappedCallback);
      streamWrappersByChannel[channel].set(callback, wrappedCallback);
      return () => {
        ipcRenderer.removeListener(channel, wrappedCallback);
        streamWrappersByChannel[channel].delete(callback);
      };
    },

    /**
     * 注册主进程事件监听，返回取消订阅函数。
     * @param {IpcCallback} callback
     * @returns {Unsubscribe}
     */
    onAIStreamError: (callback) => {
      if (typeof callback !== "function") return () => {};
      const channel = IPC_EVENT_CHANNELS.AI_STREAM_ERROR;
      const wrappedCallback = (event, data) => callback(event, data);
      ipcRenderer.on(channel, wrappedCallback);
      streamWrappersByChannel[channel].set(callback, wrappedCallback);
      return () => {
        ipcRenderer.removeListener(channel, wrappedCallback);
        streamWrappersByChannel[channel].delete(callback);
      };
    },
  };
}
module.exports = { createAiAPI };
