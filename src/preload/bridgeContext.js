// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, TerminalMailboxPayload, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../shared/contracts/preload"
 */

const {
  contextBridge,
  ipcRenderer,
  webUtils,
  crashReporter,
} = require("electron");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
  getUploadDroppedProgressChannel,
  getUploadFolderProgressChannel,
  getUploadProgressChannel,
} = require("../shared/contracts/ipc/channels");
const {
  TERMINAL_IO_MAILBOX_CHANNEL,
  TERMINAL_IO_MESSAGE_TYPES,
  getTerminalIOMailboxOutputChannel,
} = require("../shared/contracts/terminalIOMailboxProtocol");
const {
  applyStartupThemeToDocument,
  parseStartupThemeFromArgv,
} = require("../shared/startupTheme");

function createBridgeContext() {
  // 启动主题：在页面脚本运行前根据 main 传入的 additionalArguments 校正 DOM，
  // 避免 CSS :root 默认浅色在 ready-to-show 时被画到屏幕上。
  const startupTheme = parseStartupThemeFromArgv(process.argv);

  const scheduleStartupThemeApply = () => {
    try {
      applyStartupThemeToDocument(startupTheme);
    } catch {
      // DOM may be incomplete during earliest preload ticks.
    }
  };

  scheduleStartupThemeApply();

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", scheduleStartupThemeApply, {
        once: true,
      });
    } else {
      scheduleStartupThemeApply();
    }
  }

  contextBridge.exposeInMainWorld("simpleshellBoot", {
    darkMode: startupTheme.darkMode,
    backgroundColor: startupTheme.backgroundColor,
  });

  // Listener wrapper stores (avoid mutating callback functions with hidden properties)

  /**
   * 进度监听样板封装：注册临时监听器 → 发起 invoke → finally 移除。
   * upload 类接口在收到 operationComplete/cancelled 信号时会提前移除监听器。
   * @param {object} options
   * @param {string} options.channel
   * @param {((...args: unknown[]) => void)} [options.callback]
   * @param {(data: Record<string, unknown>) => unknown} [options.shouldHandle] 按返回值的真值过滤事件。
   * @param {(data: Record<string, unknown>) => unknown[]} [options.toArgs]
   * @param {boolean} [options.removeOnSignal]
   * @param {(channel: string) => Promise<unknown>} options.invoke
   * @returns {Promise<unknown>}
   */
  const withProgressListener = ({
    channel,
    callback,
    shouldHandle = () => true,
    toArgs = () => [],
    removeOnSignal = false,
    invoke,
  }) => {
    const removeListener = () => {
      ipcRenderer.removeListener(channel, listener);
    };
    /** @type {IpcCallback<Record<string, unknown>>} */
    const listener = (_event, data) => {
      if (!shouldHandle(data)) {
        return;
      }
      if (typeof callback === "function") {
        callback(...toArgs(data));
      }
      if (removeOnSignal && (data.operationComplete || data.cancelled)) {
        removeListener();
      }
    };
    ipcRenderer.on(channel, listener);
    return Promise.resolve()
      .then(() => invoke(channel))
      .finally(removeListener);
  };

  const topConnectionsChangedWrappers = new WeakMap();

  const connectionsChangedWrappers = new WeakMap();

  const commandHistoryChangedWrappers = new WeakMap();

  const localDataClearedWrappers = new WeakMap();

  const localTerminalStatusWrappers = new WeakMap();

  const streamWrappersByChannel = {
    [IPC_EVENT_CHANNELS.AI_STREAM_CHUNK]: new WeakMap(),
    [IPC_EVENT_CHANNELS.AI_STREAM_END]: new WeakMap(),
    [IPC_EVENT_CHANNELS.AI_STREAM_ERROR]: new WeakMap(),
  };

  const AI_STREAM_CHANNELS = Object.freeze([
    IPC_EVENT_CHANNELS.AI_STREAM_CHUNK,
    IPC_EVENT_CHANNELS.AI_STREAM_END,
    IPC_EVENT_CHANNELS.AI_STREAM_ERROR,
  ]);

  const processOutputWrappersByChannel = new Map();

  const processOutputListenersByChannel = new Map();

  const terminalMailboxWrappersByChannel = new Map();

  const terminalMailboxListenersByChannel = new Map();

  const listFilesChunkWrappers = new WeakMap();

  const listFilesChunkListeners = new Set();

  const directoryWatchEventWrappers = new WeakMap();

  const directoryWatchEventListeners = new Set();

  const listFilesTokensByTab = new Map();

  const listFilesTabByToken = new Map();

  const clipboardWriteSuccessListeners = new Set();

  const openFilesWrappers = new WeakMap();

  const DEFAULT_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);

  const RESTRICTED_EXTERNAL_PROTOCOLS = new Set(["mailto:"]);

  const MAX_EXTERNAL_URL_LENGTH = 2048;

  const OPEN_EXTERNAL_IPC_TIMEOUT = 10000;

  try {
    crashReporter.addExtraParameter("processType", "renderer");
    crashReporter.addExtraParameter("module", "renderer");
    crashReporter.addExtraParameter("platform", process.platform);
    crashReporter.addExtraParameter("arch", process.arch);
  } catch {
    // Crash reporter may be unavailable in unusual startup modes.
  }

  /**
   * Main process may coalesce OUTPUT into one IPC with an array of messages.
   * @param {TerminalMailboxPayload} payload
   * @returns {TerminalMailboxMessage[]}
   */
  const normalizeTerminalMailboxOutboundMessages = (payload) => {
    if (payload === undefined || payload === null) {
      return [];
    }
    return Array.isArray(payload) ? payload : [payload];
  };

  /** @param {string} channel */
  const getProcessOutputWrapperStore = (channel) => {
    if (!processOutputWrappersByChannel.has(channel)) {
      processOutputWrappersByChannel.set(channel, new WeakMap());
    }
    if (!processOutputListenersByChannel.has(channel)) {
      processOutputListenersByChannel.set(channel, new Set());
    }

    return {
      wrappers: processOutputWrappersByChannel.get(channel),
      listeners: processOutputListenersByChannel.get(channel),
    };
  };

  /** @param {string} channel */
  const removeAllManagedProcessOutputListeners = (channel) => {
    /** @type {Set<IpcCallback<TerminalMailboxPayload>> | undefined} */
    const listeners = processOutputListenersByChannel.get(channel);
    if (!listeners || listeners.size === 0) {
      return;
    }

    listeners.forEach((wrapped) => {
      ipcRenderer.removeListener(channel, wrapped);
    });
    listeners.clear();
  };

  /** @param {string} channel */
  const getTerminalMailboxWrapperStore = (channel) => {
    if (!terminalMailboxWrappersByChannel.has(channel)) {
      terminalMailboxWrappersByChannel.set(channel, new WeakMap());
    }
    if (!terminalMailboxListenersByChannel.has(channel)) {
      terminalMailboxListenersByChannel.set(channel, new Set());
    }

    return {
      wrappers: terminalMailboxWrappersByChannel.get(channel),
      listeners: terminalMailboxListenersByChannel.get(channel),
    };
  };

  /** @param {string} channel */
  const removeAllManagedTerminalMailboxListeners = (channel) => {
    /** @type {Set<IpcCallback<TerminalMailboxPayload>> | undefined} */
    const listeners = terminalMailboxListenersByChannel.get(channel);
    if (!listeners || listeners.size === 0) {
      return;
    }

    listeners.forEach((wrapped) => {
      ipcRenderer.removeListener(channel, wrapped);
    });
    listeners.clear();
  };

  /** @param {unknown} tabId */
  const normalizeListFilesTabId = (tabId) =>
    tabId === undefined || tabId === null ? "" : String(tabId);

  /**
   * @param {unknown} tabId
   * @param {unknown} token
   */
  const trackListFilesToken = (tabId, token) => {
    const normalizedTabId = normalizeListFilesTabId(tabId);
    const normalizedToken =
      token === undefined || token === null ? "" : String(token);

    if (!normalizedTabId || !normalizedToken) {
      return;
    }

    const previousTabId = listFilesTabByToken.get(normalizedToken);
    if (previousTabId && previousTabId !== normalizedTabId) {
      const previousSet = listFilesTokensByTab.get(previousTabId);
      if (previousSet) {
        previousSet.delete(normalizedToken);
        if (previousSet.size === 0) {
          listFilesTokensByTab.delete(previousTabId);
        }
      }
    }

    let tokenSet = listFilesTokensByTab.get(normalizedTabId);
    if (!tokenSet) {
      tokenSet = new Set();
      listFilesTokensByTab.set(normalizedTabId, tokenSet);
    }

    tokenSet.add(normalizedToken);
    listFilesTabByToken.set(normalizedToken, normalizedTabId);
  };

  /** @param {unknown} token */
  const untrackListFilesToken = (token) => {
    const normalizedToken =
      token === undefined || token === null ? "" : String(token);
    if (!normalizedToken) {
      return;
    }

    const tabId = listFilesTabByToken.get(normalizedToken);
    if (!tabId) {
      return;
    }

    listFilesTabByToken.delete(normalizedToken);
    const tokenSet = listFilesTokensByTab.get(tabId);
    if (!tokenSet) {
      return;
    }

    tokenSet.delete(normalizedToken);
    if (tokenSet.size === 0) {
      listFilesTokensByTab.delete(tabId);
    }
  };

  /** @param {unknown} tabId */
  const untrackListFilesTokensForTab = (tabId) => {
    const normalizedTabId = normalizeListFilesTabId(tabId);
    if (!normalizedTabId) {
      return;
    }

    const tokenSet = listFilesTokensByTab.get(normalizedTabId);
    if (!tokenSet) {
      return;
    }

    for (const token of tokenSet) {
      listFilesTabByToken.delete(token);
    }
    listFilesTokensByTab.delete(normalizedTabId);
  };

  const maybeAutoCancelTrackedListFiles = () => {
    if (listFilesChunkListeners.size > 0 || listFilesTokensByTab.size === 0) {
      return;
    }

    const pendingTabIds = Array.from(listFilesTokensByTab.keys());
    listFilesTokensByTab.clear();
    listFilesTabByToken.clear();

    pendingTabIds.forEach((tabId) => {
      ipcRenderer
        .invoke(IPC_REQUEST_CHANNELS.FILE_CANCEL_LIST, tabId)
        .catch(() => {});
    });
  };

  /**
   * @param {unknown} url
   * @param {ExternalOpenOptions} [options]
   */
  const normalizeExternalOpenRequest = (url, options = {}) => {
    if (typeof url !== "string") {
      throw new Error("Invalid URL");
    }

    const trimmedUrl = url.trim();
    if (!trimmedUrl || trimmedUrl.length > MAX_EXTERNAL_URL_LENGTH) {
      throw new Error("Invalid URL length");
    }

    let urlObj;
    try {
      urlObj = new URL(trimmedUrl);
    } catch {
      throw new Error("Invalid URL format");
    }

    const protocol = urlObj.protocol.toLowerCase();
    const allowRestrictedProtocols = options?.allowRestrictedProtocols === true;
    const isDefaultProtocol = DEFAULT_EXTERNAL_PROTOCOLS.has(protocol);
    const isRestrictedProtocol = RESTRICTED_EXTERNAL_PROTOCOLS.has(protocol);

    if (
      !isDefaultProtocol &&
      !(allowRestrictedProtocols && isRestrictedProtocol)
    ) {
      throw new Error(`Blocked external URL protocol: ${protocol}`);
    }

    const source =
      typeof options?.source === "string" && options.source.trim()
        ? options.source.trim().slice(0, 64)
        : "renderer";

    return {
      url: urlObj.toString(),
      source,
      allowRestrictedProtocols,
    };
  };

  // 暴露安全的API给渲染进程
  /**
   * @param {string} channel
   * @param {ReconnectCallback} callback
   * @returns {Unsubscribe}
   */
  function subscribeReconnectEvent(channel, callback) {
    if (typeof callback !== "function") return () => {};
    /** @type {IpcCallback} */
    const listener = (_event, data) => callback(null, data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
  return {
    getTerminalIOMailboxOutputChannel,
    ipcRenderer,
    TERMINAL_IO_MAILBOX_CHANNEL,
    getTerminalMailboxWrapperStore,
    normalizeTerminalMailboxOutboundMessages,
    IPC_EVENT_CHANNELS,
    removeAllManagedTerminalMailboxListeners,
    IPC_REQUEST_CHANNELS,
    TERMINAL_IO_MESSAGE_TYPES,
    localTerminalStatusWrappers,
    subscribeReconnectEvent,
    getProcessOutputWrapperStore,
    removeAllManagedProcessOutputListeners,
    topConnectionsChangedWrappers,
    connectionsChangedWrappers,
    AI_STREAM_CHANNELS,
    streamWrappersByChannel,
    openFilesWrappers,
    trackListFilesToken,
    untrackListFilesToken,
    untrackListFilesTokensForTab,
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
    localDataClearedWrappers,
    commandHistoryChangedWrappers,
    clipboardWriteSuccessListeners,
  };
}
module.exports = { createBridgeContext };
