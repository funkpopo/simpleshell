// @ts-check
// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "./types/preload"
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
} = require("./core/ipc/schema/channels");
const {
  TERMINAL_IO_MAILBOX_CHANNEL,
  TERMINAL_IO_MESSAGE_TYPES,
  getTerminalIOMailboxOutputChannel,
} = require("./modules/terminal/io/terminalIOMailboxProtocol");
const {
  applyStartupThemeToDocument,
  parseStartupThemeFromArgv,
} = require("./shared/startupTheme");

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

/** Main process may coalesce OUTPUT into one IPC with an array of messages. */
const normalizeTerminalMailboxOutboundMessages = (payload) => {
  if (payload === undefined || payload === null) {
    return [];
  }
  return Array.isArray(payload) ? payload : [payload];
};

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

const removeAllManagedProcessOutputListeners = (channel) => {
  const listeners = processOutputListenersByChannel.get(channel);
  if (!listeners || listeners.size === 0) {
    return;
  }

  listeners.forEach((wrapped) => {
    ipcRenderer.removeListener(channel, wrapped);
  });
  listeners.clear();
};

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

const removeAllManagedTerminalMailboxListeners = (channel) => {
  const listeners = terminalMailboxListenersByChannel.get(channel);
  if (!listeners || listeners.size === 0) {
    return;
  }

  listeners.forEach((wrapped) => {
    ipcRenderer.removeListener(channel, wrapped);
  });
  listeners.clear();
};

const normalizeListFilesTabId = (tabId) =>
  tabId === undefined || tabId === null ? "" : String(tabId);

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
function subscribeReconnectEvent(channel, callback) {
  if (typeof callback !== "function") return () => {};
  const listener = (_event, data) => callback(null, data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("terminalAPI", {
  /**
   * 通过终端 IPC 邮箱发送消息；返回是否接受发送。
   * @param {ProcessId} processId
   * @param {TerminalMailboxMessage} message
   * @returns {boolean}
   */
  postTerminalMailboxMessage: (processId, message) => {
    const channel = getTerminalIOMailboxOutputChannel(processId);
    if (!channel || !message || typeof message !== "object") {
      return false;
    }

    ipcRenderer.send(TERMINAL_IO_MAILBOX_CHANNEL, {
      processId,
      message,
    });
    return true;
  },

  /**
   * 注册主进程事件监听，返回取消订阅函数。
   * @param {ProcessId} processId
   * @param {PayloadCallback<TerminalMailboxMessage>} callback
   * @returns {Unsubscribe}
   */
  onTerminalMailboxMessage: (processId, callback) => {
    const channel = getTerminalIOMailboxOutputChannel(processId);
    if (!channel || typeof callback !== "function") {
      return () => {};
    }

    const { wrappers, listeners } = getTerminalMailboxWrapperStore(channel);
    const wrapped = (_event, messageOrBatch) => {
      for (const message of normalizeTerminalMailboxOutboundMessages(
        messageOrBatch,
      )) {
        callback(message);
      }
    };
    wrappers.set(callback, wrapped);
    listeners.add(wrapped);
    ipcRenderer.on(channel, wrapped);

    return () => {
      ipcRenderer.removeListener(channel, wrapped);
      listeners.delete(wrapped);
      wrappers.delete(callback);
    };
  },

  // ZMODEM（rz/sz）传输事件
  /**
   * 注册主进程事件监听，返回取消订阅函数。
   * @param {PayloadCallback} callback
   * @returns {Unsubscribe}
   */
  onZmodemEvent: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_event, data) => callback(data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.ZMODEM_EVENT, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(
        IPC_EVENT_CHANNELS.ZMODEM_EVENT,
        wrappedCallback,
      );
    };
  },

  /**
   * 通过 IPC 请求取消 ZMODEM 传输；返回是否接受发送。
   * @param {ProcessId} processId
   * @returns {boolean}
   */
  cancelZmodemTransfer: (processId) => {
    if (processId === undefined || processId === null) {
      return false;
    }
    ipcRenderer.send(IPC_EVENT_CHANNELS.ZMODEM_CANCEL, { processId });
    return true;
  },

  /**
   * 管理主进程事件监听，无返回值。
   * @param {ProcessId} processId
   * @param {PayloadCallback<TerminalMailboxMessage>} [callback]
   * @returns {void}
   */
  removeTerminalMailboxListener: (processId, callback) => {
    const channel = getTerminalIOMailboxOutputChannel(processId);
    if (!channel) {
      return;
    }

    const { wrappers, listeners } = getTerminalMailboxWrapperStore(channel);

    if (typeof callback === "function") {
      const wrapped = wrappers.get(callback);
      if (!wrapped) {
        return;
      }
      ipcRenderer.removeListener(channel, wrapped);
      listeners.delete(wrapped);
      wrappers.delete(callback);
      return;
    }

    removeAllManagedTerminalMailboxListeners(channel);
  },

  // 发送命令到主进程处理 (用于模拟终端)
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_COMMAND 请求主进程。
   * @param {string} command
   * @returns {Promise<unknown>}
   */
  sendCommand: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND, command),

  // 终端进程管理
  /**
   * 通过终端 IPC 邮箱发送输入；同步返回是否接受发送。
   * @param {ProcessId} processId
   * @param {string|Uint8Array} data
   * @returns {boolean}
   */
  sendToProcess: (processId, data) => {
    if (processId === undefined || processId === null) {
      return false;
    }
    if (data === undefined || data === null) {
      return false;
    }

    ipcRenderer.send(TERMINAL_IO_MAILBOX_CHANNEL, {
      processId,
      message: {
        type: TERMINAL_IO_MESSAGE_TYPES.INPUT,
        data: typeof data === "string" ? data : data.toString(),
      },
    });
    return true;
  },

  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_SEND_TO_PROCESS 请求主进程。
   * @param {ProcessId} processId
   * @param {string|Uint8Array} data
   * @returns {Promise<unknown>}
   */
  sendToProcessWithAck: (processId, data) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_SEND_TO_PROCESS,
      processId,
      data,
    ),

  /**
   * 通过终端 IPC 邮箱确认已消费的输出字节，无返回值。
   * @param {ProcessId} processId
   * @param {number} bytes
   * @returns {void}
   */
  notifyOutputConsumed: (processId, bytes) => {
    if (processId === undefined || processId === null) {
      return;
    }
    const normalizedBytes = Math.floor(Number(bytes));
    if (!Number.isFinite(normalizedBytes) || normalizedBytes <= 0) {
      return;
    }
    ipcRenderer.send(TERMINAL_IO_MAILBOX_CHANNEL, {
      processId,
      message: {
        type: TERMINAL_IO_MESSAGE_TYPES.ACK,
        bytes: normalizedBytes,
      },
    });
  },

  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_KILL_PROCESS 请求主进程。
   * @param {ProcessId} processId
   * @returns {Promise<unknown>}
   */
  killProcess: (processId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_KILL_PROCESS, processId),

  // 新增：获取进程信息
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_INFO 请求主进程。
   * @param {ProcessId} processId
   * @returns {Promise<unknown>}
   */
  getProcessInfo: (processId) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_INFO,
      processId,
    ),

  // 本地终端API
  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINALS_DETECT 请求主进程。
   * @returns {Promise<unknown>}
   */
  detectLocalTerminals: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINALS_DETECT),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_START_EMBEDDED 请求主进程。
   * @param {Record<string, unknown>} localConfig
   * @returns {Promise<unknown>}
   */
  startLocalTerminal: (localConfig) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_START_EMBEDDED,
      localConfig,
    ),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_CLOSE 请求主进程。
   * @param {string} tabId
   * @returns {Promise<unknown>}
   */
  closeLocalTerminal: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_CLOSE, tabId),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_INFO 请求主进程。
   * @param {string} tabId
   * @returns {Promise<unknown>}
   */
  getLocalTerminalInfo: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_INFO, tabId),

  /**
   * 注册主进程事件监听，返回取消订阅函数。
   * @param {PayloadCallback} callback
   * @returns {Unsubscribe}
   */
  onLocalTerminalStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_event, payload) => callback(payload);
    localTerminalStatusWrappers.set(callback, wrappedCallback);
    ipcRenderer.on(IPC_EVENT_CHANNELS.LOCAL_TERMINAL_STATUS, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(
        IPC_EVENT_CHANNELS.LOCAL_TERMINAL_STATUS,
        wrappedCallback,
      );
      localTerminalStatusWrappers.delete(callback);
    };
  },

  /**
   * 管理主进程事件监听，无返回值。
   * @param {PayloadCallback} [callback]
   * @returns {void}
   */
  offLocalTerminalStatus: (callback) => {
    if (!callback) {
      ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.LOCAL_TERMINAL_STATUS);
      return;
    }
    const wrappedCallback = localTerminalStatusWrappers.get(callback);
    if (wrappedCallback) {
      ipcRenderer.removeListener(
        IPC_EVENT_CHANNELS.LOCAL_TERMINAL_STATUS,
        wrappedCallback,
      );
      localTerminalStatusWrappers.delete(callback);
    }
  },

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

  // 自定义终端管理API
  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_ADD_CUSTOM 请求主进程。
   * @param {Record<string, unknown>} terminalConfig
   * @returns {Promise<unknown>}
   */
  addCustomTerminal: (terminalConfig) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_ADD_CUSTOM,
      terminalConfig,
    ),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_UPDATE_CUSTOM 请求主进程。
   * @param {string} id
   * @param {Record<string, unknown>} updates
   * @returns {Promise<unknown>}
   */
  updateCustomTerminal: (id, updates) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_UPDATE_CUSTOM,
      id,
      updates,
    ),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_DELETE_CUSTOM 请求主进程。
   * @param {string} id
   * @returns {Promise<unknown>}
   */
  deleteCustomTerminal: (id) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_DELETE_CUSTOM, id),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_CUSTOM 请求主进程。
   * @returns {Promise<unknown>}
   */
  getCustomTerminals: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_CUSTOM),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_ALL_ACTIVE 请求主进程。
   * @returns {Promise<unknown>}
   */
  getAllActiveLocalTerminals: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_ALL_ACTIVE),

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

  // 快捷命令API
  /**
   * 通过 IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_GET 请求主进程。
   * @returns {Promise<unknown>}
   */
  getShortcutCommands: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_GET),

  /**
   * 通过 IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_SAVE 请求主进程。
   * @param {unknown} data
   * @returns {Promise<unknown>}
   */
  saveShortcutCommands: (data) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_SAVE, data),

  // 事件监听
  /**
   * 注册主进程事件监听，返回取消订阅函数。
   * @param {ProcessId} processId
   * @param {PayloadCallback<string|Uint8Array>} callback
   * @returns {Unsubscribe}
   */
  onProcessOutput: (processId, callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const channel = getTerminalIOMailboxOutputChannel(processId);
    if (!channel) {
      return () => {};
    }

    const { wrappers, listeners } = getProcessOutputWrapperStore(channel);
    const wrapped = (_event, messageOrBatch) => {
      for (const message of normalizeTerminalMailboxOutboundMessages(
        messageOrBatch,
      )) {
        if (message?.type === TERMINAL_IO_MESSAGE_TYPES.OUTPUT) {
          callback(message.data);
        }
      }
    };
    wrappers.set(callback, wrapped);
    listeners.add(wrapped);
    ipcRenderer.on(channel, wrapped);

    return () => {
      ipcRenderer.removeListener(channel, wrapped);
      listeners.delete(wrapped);
      wrappers.delete(callback);
    };
  },

  /**
   * 管理主进程事件监听，无返回值。
   * @param {ProcessId} processId
   * @param {PayloadCallback<string|Uint8Array>} [callback]
   * @returns {void}
   */
  removeOutputListener: (processId, callback) => {
    if (!processId) {
      return;
    }

    const channel = getTerminalIOMailboxOutputChannel(processId);
    if (!channel) {
      return;
    }
    const { wrappers, listeners } = getProcessOutputWrapperStore(channel);

    if (typeof callback === "function") {
      const wrapped = wrappers.get(callback);
      if (!wrapped) {
        return;
      }
      ipcRenderer.removeListener(channel, wrapped);
      listeners.delete(wrapped);
      wrappers.delete(callback);
      return;
    }

    removeAllManagedProcessOutputListeners(channel);
  },

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
   * 返回可导入的主机列表与解析告警，供连接管理器“从 OpenSSH 配置导入”使用。
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

  // 简单命令执行
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_COMMAND 请求主进程。
   * @param {string} command
   * @returns {Promise<unknown>}
   */
  executeCommand: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND, command),

  // 终端大小调整
  /**
   * 通过终端 IPC 邮箱发送尺寸更新，返回已完成的 Promise。
   * @param {ProcessId} processId
   * @param {number} cols
   * @param {number} rows
   * @returns {Promise<boolean>}
   */
  resizeTerminal: (processId, cols, rows) => {
    ipcRenderer.send(TERMINAL_IO_MAILBOX_CHANNEL, {
      processId,
      message: {
        type: TERMINAL_IO_MESSAGE_TYPES.RESIZE,
        cols,
        rows,
        immediate: true,
      },
    });
    return Promise.resolve(true);
  },

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
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_PROXY_CONFIG, proxyConfig),

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

  // 获取应用版本
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_GET_VERSION 请求主进程。
   * @returns {Promise<IpcResult<string>>}
   */
  getAppVersion: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_VERSION),

  /**
   * 注册主进程事件监听，返回取消订阅函数。
   * @param {PayloadCallback} callback
   * @returns {Unsubscribe}
   */
  onMenuAction: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
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
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CANCEL_TRANSFER, tabId, type),

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
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_DISCARD_RESUMABLE, tabId, id),

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
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_VALIDATE_DROPPED_ITEMS, items),

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
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_CLEAR_LOCAL_DATA, options),

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
    ipcRenderer.on(IPC_EVENT_CHANNELS.CONFIG_SYNC_AUTO_EVENT, wrappedCallback);
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_PREFETCH 请求主进程。
   * @param {Record<string, unknown>} settings
   * @returns {Promise<unknown>}
   */
  updatePrefetchSettings: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_PREFETCH, settings),

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

  // 新增: 通知主进程编辑器模式变化的API
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_NOTIFY_EDITOR_MODE_CHANGE 请求主进程。
   * @param {ProcessId} processId
   * @param {boolean} isEditorMode
   * @returns {Promise<unknown>}
   */
  notifyEditorModeChange: (processId, isEditorMode) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_NOTIFY_EDITOR_MODE_CHANGE,
      processId,
      isEditorMode,
    ),

  // 命令历史相关API
  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_ADD 请求主进程。
   * @param {string} command
   * @returns {Promise<unknown>}
   */
  addToCommandHistory: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_ADD, command),

  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_SUGGESTIONS 请求主进程。
   * @param {string} input
   * @param {number} [maxResults]
   * @returns {Promise<unknown>}
   */
  getCommandSuggestions: (input, maxResults) => {
    if (maxResults === undefined) {
      return ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_SUGGESTIONS,
        input,
      );
    }

    return ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_SUGGESTIONS,
      input,
      maxResults,
    );
  },

  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_INCREMENT_USAGE 请求主进程。
   * @param {string} command
   * @returns {Promise<unknown>}
   */
  incrementCommandUsage: (command) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.COMMAND_HISTORY_INCREMENT_USAGE,
      command,
    ),

  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_CLEAR 请求主进程。
   * @returns {Promise<unknown>}
   */
  clearCommandHistory: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_CLEAR),

  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_STATISTICS 请求主进程。
   * @returns {Promise<unknown>}
   */
  getCommandHistoryStatistics: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_STATISTICS),

  // 新增：历史命令管理API
  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_ALL 请求主进程。
   * @returns {Promise<unknown>}
   */
  getAllCommandHistory: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_ALL),

  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE 请求主进程。
   * @param {string} command
   * @returns {Promise<unknown>}
   */
  deleteCommandHistory: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE, command),

  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE_BATCH 请求主进程。
   * @param {string[]} commands
   * @returns {Promise<unknown>}
   */
  deleteCommandHistoryBatch: (commands) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE_BATCH,
      commands,
    ),

  /**
   * 注册主进程事件监听，返回取消订阅函数。
   * @param {PayloadCallback} callback
   * @returns {Unsubscribe}
   */
  onCommandHistoryChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_event, payload) => callback(payload);
    commandHistoryChangedWrappers.set(callback, wrappedCallback);
    ipcRenderer.on(IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(
        IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED,
        wrappedCallback,
      );
      commandHistoryChangedWrappers.delete(callback);
    };
  },

  /**
   * 管理主进程事件监听，无返回值。
   * @param {PayloadCallback} [callback]
   * @returns {void}
   */
  offCommandHistoryChanged: (callback) => {
    if (!callback) return;
    const wrappedCallback = commandHistoryChangedWrappers.get(callback);
    if (wrappedCallback) {
      ipcRenderer.removeListener(
        IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED,
        wrappedCallback,
      );
      commandHistoryChangedWrappers.delete(callback);
    }
  },

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
   * 上报 Mosh 客户端提示栏状态；主进程校验当前会话身份。
   * @param {string} tabId
   * @param {import("./types/preload").ProcessId} processId
   * @param {import("./types/preload").MoshTransportStatus} status
   * @returns {Promise<{success: boolean}>}
   */
  reportMoshStatus: (tabId, processId, status) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_REPORT_MOSH_STATUS, {
      tabId,
      processId,
      status,
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
    const wrappedCallback = (event, data) => callback(event, data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.LATENCY_DISCONNECTED, wrappedCallback);
    return () =>
      ipcRenderer.removeListener(
        IPC_EVENT_CHANNELS.LATENCY_DISCONNECTED,
        wrappedCallback,
      );
  },

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
});

// SSH密钥生成器API
contextBridge.exposeInMainWorld("electronAPI", {
  // SSH密钥对生成
  /**
   * 通过 IPC_REQUEST_CHANNELS.SSH_KEY_GENERATE 请求主进程。
   * @param {Record<string, unknown>} options
   * @returns {Promise<unknown>}
   */
  generateSSHKeyPair: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_KEY_GENERATE, options),

  // 保存SSH密钥到文件
  /**
   * 通过 IPC_REQUEST_CHANNELS.SSH_KEY_SAVE 请求主进程。
   * @param {Record<string, unknown>} options
   * @returns {Promise<unknown>}
   */
  saveSSHKey: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_KEY_SAVE, options),
});

// 文件对话框API
contextBridge.exposeInMainWorld("dialogAPI", {
  // 显示打开文件/目录对话框
  /**
   * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_OPEN 请求主进程。
   * @param {import("electron").OpenDialogOptions} options
   * @returns {Promise<IpcResult<import("electron").OpenDialogReturnValue>>}
   */
  showOpenDialog: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_OPEN, options),

  // 显示保存文件对话框
  /**
   * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_SAVE 请求主进程。
   * @param {import("electron").SaveDialogOptions} options
   * @returns {Promise<IpcResult<import("electron").SaveDialogReturnValue>>}
   */
  showSaveDialog: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_SAVE, options),

  // 显示消息框
  /**
   * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_MESSAGE 请求主进程。
   * @param {import("electron").MessageBoxOptions} options
   * @returns {Promise<IpcResult<import("electron").MessageBoxReturnValue>>}
   */
  showMessageBox: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_MESSAGE, options),
});

// 应用错误处理API
contextBridge.exposeInMainWorld("appErrorAPI", {
  // 监听应用错误
  /**
   * 注册应用错误 IPC 监听；返回 Electron 的 IpcRenderer，不是取消订阅函数。
   * @param {IpcCallback} callback
   * @returns {import("electron").IpcRenderer}
   */
  onError: (callback) => ipcRenderer.on(IPC_EVENT_CHANNELS.APP_ERROR, callback),

  // 移除错误监听
  /**
   * 管理主进程事件监听，无返回值。
   * @returns {void}
   */
  removeErrorListener: () => {
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.APP_ERROR);
  },
});

// Clipboard API (Electron 40+ safe access pattern)
contextBridge.exposeInMainWorld("clipboardAPI", {
  /**
   * 通过 IPC 读取剪贴板文本，失败时拒绝 Promise。
   * @returns {Promise<string>}
   */
  readText: async () => {
    const result = await ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.CLIPBOARD_READ_TEXT,
    );
    if (result?.success === false) {
      throw new Error(result.error || "Failed to read clipboard text");
    }
    return typeof result?.text === "string" ? result.text : "";
  },

  /**
   * 通过 IPC 写入剪贴板并通知成功监听器，失败时拒绝 Promise。
   * @param {unknown} text
   * @returns {Promise<boolean>}
   */
  writeText: async (text) => {
    const result = await ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.CLIPBOARD_WRITE_TEXT,
      String(text ?? ""),
    );
    if (result?.success === false) {
      throw new Error(result.error || "Failed to write clipboard text");
    }
    for (const listener of clipboardWriteSuccessListeners) {
      try {
        listener({ timestamp: Date.now() });
      } catch {
        // Ignore renderer notification listener failures.
      }
    }
    try {
      window.dispatchEvent(
        new CustomEvent("simpleshell:clipboard-write-success", {
          detail: { timestamp: Date.now() },
        }),
      );
    } catch {
      // Notification is best-effort; the clipboard write already succeeded.
    }
    return true;
  },

  /**
   * 监听本地剪贴板写入成功通知，返回取消订阅函数。
   * @param {PayloadCallback<{timestamp: number}>} callback
   * @returns {Unsubscribe}
   */
  onWriteSuccess: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    clipboardWriteSuccessListeners.add(callback);
    return () => {
      clipboardWriteSuccessListeners.delete(callback);
    };
  },
});
