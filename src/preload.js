// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @param {*} message - message。
   * @returns {Promise<*>} 主进程处理结果。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {string} processId - processId。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // ZMODEM（rz/sz）传输事件
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  cancelZmodemTransfer: (processId) => {
    if (processId === undefined || processId === null) {
      return false;
    }
    ipcRenderer.send(IPC_EVENT_CHANNELS.ZMODEM_CANCEL, { processId });
    return true;
  },

  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {string} processId - processId。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_COMMAND 请求主进程并返回结果。
   * @param {*} command - command。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_COMMAND 请求主进程并返回结果。
   * @param {*} command - command。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 发送命令到主进程处理 (用于模拟终端)
  sendCommand: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND, command),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @param {*} data - data。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @param {*} data - data。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 终端进程管理
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @param {*} data - data。
   * @returns {Promise<*>} 主进程处理结果。
   */
  sendToProcessWithAck: (processId, data) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_SEND_TO_PROCESS,
      processId,
      data,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @param {number} bytes - bytes。
   * @returns {Promise<*>} 主进程处理结果。
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
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_KILL_PROCESS 请求主进程并返回结果。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  killProcess: (processId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_KILL_PROCESS, processId),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增：获取进程信息
  getProcessInfo: (processId) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_INFO,
      processId,
    ),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINALS_DETECT 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINALS_DETECT 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 本地终端API
  detectLocalTerminals: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINALS_DETECT),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} localConfig - localConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  startLocalTerminal: (localConfig) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_START_EMBEDDED,
      localConfig,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_CLOSE 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  closeLocalTerminal: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_CLOSE, tabId),
  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_INFO 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getLocalTerminalInfo: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_INFO, tabId),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.RECONNECT_GET_STATUS 请求主进程并返回结果。
   * @param {*} args - args。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.RECONNECT_GET_STATUS 请求主进程并返回结果。
   * @param {*} args - args。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 重连管理API
  getReconnectStatus: (args) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_GET_STATUS, args),
  /**
   * 通过 IPC_REQUEST_CHANNELS.RECONNECT_PAUSE 请求主进程并返回结果。
   * @param {*} args - args。
   * @returns {Promise<*>} 主进程处理结果。
   */
  pauseReconnect: (args) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_PAUSE, args),
  /**
   * 通过 IPC_REQUEST_CHANNELS.RECONNECT_RESUME 请求主进程并返回结果。
   * @param {*} args - args。
   * @returns {Promise<*>} 主进程处理结果。
   */
  resumeReconnect: (args) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_RESUME, args),
  /**
   * 通过 IPC_REQUEST_CHANNELS.RECONNECT_GET_STATISTICS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getReconnectStatistics: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_GET_STATISTICS),

  /**
   * 通过 IPC_REQUEST_CHANNELS.PF_GET_RULES 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.PF_GET_RULES 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 端口转发（SSH隧道）管理API
  getPortForwardRules: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_GET_RULES),
  /**
   * 通过 IPC_REQUEST_CHANNELS.PF_SAVE_RULE 请求主进程并返回结果。
   * @param {*} rule - rule。
   * @returns {Promise<*>} 主进程处理结果。
   */
  savePortForwardRule: (rule) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_SAVE_RULE, rule),
  /**
   * 通过 IPC_REQUEST_CHANNELS.PF_DELETE_RULE 请求主进程并返回结果。
   * @param {*} ruleId - ruleId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  deletePortForwardRule: (ruleId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_DELETE_RULE, ruleId),
  /**
   * 通过 IPC_REQUEST_CHANNELS.PF_START_RULE 请求主进程并返回结果。
   * @param {*} ruleId - ruleId。
   * @param {string} tabId - tabId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  startPortForwardRule: (ruleId, tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_START_RULE, { ruleId, tabId }),
  /**
   * 通过 IPC_REQUEST_CHANNELS.PF_STOP_RULE 请求主进程并返回结果。
   * @param {*} ruleId - ruleId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  stopPortForwardRule: (ruleId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_STOP_RULE, ruleId),
  /**
   * 通过 IPC_REQUEST_CHANNELS.PF_GET_ACTIVE_SESSIONS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getPortForwardActiveSessions: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_GET_ACTIVE_SESSIONS),
  /**
   * 通过 IPC_REQUEST_CHANNELS.PF_GET_STATUS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getPortForwardStatus: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.PF_GET_STATUS),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @returns {Promise<*>} 主进程处理结果。
   */
  removePortForwardListeners: () => {
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.PF_STATUS_UPDATED);
  },

  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 重连事件监听器
  onReconnectStart: (callback) =>
    subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_STARTED, callback),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  onReconnectProgress: (callback) =>
    subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_PROGRESS, callback),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  onReconnectSuccess: (callback) =>
    subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_SUCCESS, callback),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  onReconnectFailed: (callback) =>
    subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_FAILED, callback),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  onReconnectAbandoned: (callback) =>
    subscribeReconnectEvent(IPC_EVENT_CHANNELS.RECONNECT_ABANDONED, callback),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  onConnectionLost: (callback) =>
    subscribeReconnectEvent(IPC_EVENT_CHANNELS.CONNECTION_LOST, callback),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 通过 IPC_REQUEST_CHANNELS.CONNECTION_GET_TAB_STATUS 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getTabConnectionStatus: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONNECTION_GET_TAB_STATUS, tabId),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @returns {Promise<*>} 主进程处理结果。
   */
  removeReconnectListeners: () => {
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_STARTED);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_PROGRESS);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_SUCCESS);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_FAILED);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_ABANDONED);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.CONNECTION_LOST);
  },

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} terminalConfig - terminalConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} terminalConfig - terminalConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 自定义终端管理API
  addCustomTerminal: (terminalConfig) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_ADD_CUSTOM,
      terminalConfig,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} id - id。
   * @param {*} updates - updates。
   * @returns {Promise<*>} 主进程处理结果。
   */
  updateCustomTerminal: (id, updates) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_UPDATE_CUSTOM,
      id,
      updates,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_DELETE_CUSTOM 请求主进程并返回结果。
   * @param {*} id - id。
   * @returns {Promise<*>} 主进程处理结果。
   */
  deleteCustomTerminal: (id) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_DELETE_CUSTOM, id),
  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_CUSTOM 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getCustomTerminals: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_CUSTOM),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_ALL_ACTIVE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getAllActiveLocalTerminals: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_ALL_ACTIVE),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 资源监控API
  getSystemInfo: (processId) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_GET_SYSTEM_INFO,
      processId,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getMetricsSample: (processId) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_GET_METRICS_SAMPLE,
      processId,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getProcessList: (processId) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_LIST,
      processId,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 连接管理API
  cleanupConnection: (processId) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_CLEANUP_CONNECTION,
      processId,
    ),

  /**
   * 通过 IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_GET 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_GET 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 快捷命令API
  getShortcutCommands: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_GET),
  /**
   * 通过 IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_SAVE 请求主进程并返回结果。
   * @param {*} data - data。
   * @returns {Promise<*>} 主进程处理结果。
   */
  saveShortcutCommands: (data) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_SAVE, data),

  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {string} processId - processId。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {string} processId - processId。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 事件监听
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {string} processId - processId。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_LOAD_CONNECTIONS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_LOAD_CONNECTIONS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 连接配置存储API
  loadConnections: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_LOAD_CONNECTIONS),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} connectionId - connectionId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getConnectionPassword: (connectionId) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_GET_CONNECTION_PASSWORD,
      connectionId,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} connections - connections。
   * @returns {Promise<*>} 主进程处理结果。
   */
  saveConnections: (connections) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_SAVE_CONNECTIONS,
      connections,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_LOAD_TOP_CONNECTIONS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  loadTopConnections: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_LOAD_TOP_CONNECTIONS),

  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 热门连接实时更新事件
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 连接配置变化事件监听
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_SELECT_KEY_FILE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_SELECT_KEY_FILE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 选择密钥文件
  selectKeyFile: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_SELECT_KEY_FILE),

  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_COMMAND 请求主进程并返回结果。
   * @param {*} command - command。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_COMMAND 请求主进程并返回结果。
   * @param {*} command - command。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 简单命令执行
  executeCommand: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND, command),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @param {*} cols - cols。
   * @param {*} rows - rows。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @param {*} cols - cols。
   * @param {*} rows - rows。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 终端大小调整
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_SETTINGS 请求主进程并返回结果。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_SETTINGS 请求主进程并返回结果。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // AI助手API
  saveAISettings: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_SETTINGS, settings),
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_LOAD_SETTINGS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  loadAISettings: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_LOAD_SETTINGS),
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_SEND_PROMPT 请求主进程并返回结果。
   * @param {*} prompt - prompt。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  sendAIPrompt: (prompt, settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SEND_PROMPT, prompt, settings),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} requestData - requestData。
   * @param {*} isStream - isStream。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} requestData - requestData。
   * @param {*} isStream - isStream。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: 直接发送API请求的方法
  sendAPIRequest: (requestData, isStream) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.AI_SEND_API_REQUEST,
      requestData,
      isStream,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_ABORT_API_REQUEST 请求主进程并返回结果。
   * @param {*} sessionId - sessionId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_ABORT_API_REQUEST 请求主进程并返回结果。
   * @param {*} sessionId - sessionId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: 中断API请求的方法
  cancelAPIRequest: (sessionId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_ABORT_API_REQUEST, sessionId),
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_API_CONFIG 请求主进程并返回结果。
   * @param {object} config - config。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_API_CONFIG 请求主进程并返回结果。
   * @param {object} config - config。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: API配置管理方法
  saveApiConfig: (config) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_API_CONFIG, config),
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_DELETE_API_CONFIG 请求主进程并返回结果。
   * @param {*} configId - configId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  deleteApiConfig: (configId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_DELETE_API_CONFIG, configId),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} configId - configId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  setCurrentApiConfig: (configId) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.AI_SET_CURRENT_API_CONFIG,
      configId,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_FETCH_MODELS 请求主进程并返回结果。
   * @param {*} requestData - requestData。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_FETCH_MODELS 请求主进程并返回结果。
   * @param {*} requestData - requestData。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: 获取模型列表方法
  fetchModels: (requestData) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_FETCH_MODELS, requestData),
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_CUSTOM_RISK_RULES 请求主进程并返回结果。
   * @param {*} rules - rules。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_CUSTOM_RISK_RULES 请求主进程并返回结果。
   * @param {*} rules - rules。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: 保存自定义风险规则
  saveCustomRiskRules: (rules) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_CUSTOM_RISK_RULES, rules),
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_GET_PROXY_CONFIG 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_GET_PROXY_CONFIG 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: AI 代理配置读取/保存
  getAISettingsProxy: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_GET_PROXY_CONFIG),
  /**
   * 通过 IPC_REQUEST_CHANNELS.AI_SAVE_PROXY_CONFIG 请求主进程并返回结果。
   * @param {*} proxyConfig - proxyConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  saveAISettingsProxy: (proxyConfig) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_PROXY_CONFIG, proxyConfig),

  /**
   * 通过 IPC_REQUEST_CHANNELS.MEMORY_SAVE 请求主进程并返回结果。
   * @param {*} memory - memory。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.MEMORY_SAVE 请求主进程并返回结果。
   * @param {*} memory - memory。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 记忆文件管理API
  saveMemory: (memory) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_SAVE, memory),
  /**
   * 通过 IPC_REQUEST_CHANNELS.MEMORY_LOAD 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  loadMemory: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_LOAD),
  /**
   * 通过 IPC_REQUEST_CHANNELS.MEMORY_DELETE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  deleteMemory: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_DELETE),
  /**
   * 通过 IPC_REQUEST_CHANNELS.MEMORY_GET_DIAGNOSTICS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getMemoryDiagnostics: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_GET_DIAGNOSTICS),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} channel - channel。
   * @param {Function} callback - callback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {*} channel - channel。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 添加事件监听器注册方法
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
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} channel - channel。
   * @param {Function} callback - callback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {*} channel - channel。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 添加off方法作为removeListener的别名
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
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {*} channel - channel。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {*} channel - channel。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 添加事件监听器移除方法
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_GET_VERSION 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_GET_VERSION 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 获取应用版本
  getAppVersion: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_VERSION),

  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  offOpenFiles: (callback) => {
    const wrapped = callback && openFilesWrappers.get(callback);
    if (!wrapped) {
      return;
    }
    ipcRenderer.removeListener(IPC_EVENT_CHANNELS.APP_OPEN_FILES, wrapped);
    openFilesWrappers.delete(callback);
  },

  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_CLOSE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_CLOSE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 关闭应用
  closeApp: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_CLOSE),

  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_CHECK_FOR_UPDATE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_CHECK_FOR_UPDATE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 检查更新
  checkForUpdate: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_CHECK_FOR_UPDATE),

  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_OPEN_LOG_DIRECTORY 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  openLogDirectory: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_OPEN_LOG_DIRECTORY),
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_EXPORT_DIAGNOSTICS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  exportDiagnostics: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_EXPORT_DIAGNOSTICS),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} context - context。
   * @returns {Promise<*>} 主进程处理结果。
   */
  copyDiagnosticSummary: (context) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_SUMMARY,
      context,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} context - context。
   * @returns {Promise<*>} 主进程处理结果。
   */
  copyDiagnosticPackage: (context) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_PACKAGE,
      context,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_OPEN_FEEDBACK_ISSUE 请求主进程并返回结果。
   * @param {*} context - context。
   * @returns {Promise<*>} 主进程处理结果。
   */
  openFeedbackIssue: (context) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_OPEN_FEEDBACK_ISSUE, context),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} path - path。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 文件管理相关API
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} token - token。
   * @returns {Promise<*>} 主进程处理结果。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} path - path。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  startDirectoryWatch: (tabId, path, options) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_START_DIRECTORY_WATCH,
      tabId,
      path,
      options,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} watchId - watchId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  stopDirectoryWatch: (tabId, watchId = null) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_STOP_DIRECTORY_WATCH,
      tabId,
      watchId,
    ),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} sourcePath - sourcePath。
   * @param {*} targetPath - targetPath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  copyFile: (tabId, sourcePath, targetPath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_COPY,
      tabId,
      sourcePath,
      targetPath,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} sourcePath - sourcePath。
   * @param {*} targetPath - targetPath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  moveFile: (tabId, sourcePath, targetPath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_MOVE,
      tabId,
      sourcePath,
      targetPath,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} isDirectory - isDirectory。
   * @returns {Promise<*>} 主进程处理结果。
   */
  deleteFile: (tabId, filePath, isDirectory) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_DELETE,
      tabId,
      filePath,
      isDirectory,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} folderPath - folderPath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  createFolder: (tabId, folderPath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_CREATE_FOLDER,
      tabId,
      folderPath,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.FILE_CREATE 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  createFile: (tabId, filePath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CREATE, tabId, filePath),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} remotePath - remotePath。
   * @param {*} progressCallback - progressCallback。
   * @param {*} knownSize - knownSize。
   * @returns {Promise<*>} 主进程处理结果。
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
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} files - files。
   * @param {*} progressCallback - progressCallback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} files - files。
   * @param {*} progressCallback - progressCallback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 批量下载多个文件
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
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} remotePath - remotePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} remotePath - remotePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增API
  openFileInExternalEditor: (tabId, remotePath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.EXTERNAL_EDITOR_OPEN,
      tabId,
      remotePath,
    ),

  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} oldPath - oldPath。
   * @param {*} newName - newName。
   * @returns {Promise<*>} 主进程处理结果。
   */
  renameFile: (tabId, oldPath, newName) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_RENAME,
      tabId,
      oldPath,
      newName,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} permissions - permissions。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} permissions - permissions。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 权限设置API
  setFilePermissions: (tabId, filePath, permissions) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_SET_PERMISSIONS,
      tabId,
      filePath,
      permissions,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} owner - owner。
   * @param {*} group - group。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} owner - owner。
   * @param {*} group - group。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 所有者/组设置API
  setFileOwnership: (tabId, filePath, owner, group) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_SET_OWNERSHIP,
      tabId,
      filePath,
      owner,
      group,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getFilePermissions: (tabId, filePath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS,
      tabId,
      filePath,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePaths - filePaths。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePaths - filePaths。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 批量获取文件权限 - 减少 IPC 调用开销
  getFilePermissionsBatch: (tabId, filePaths) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS_BATCH,
      tabId,
      filePaths,
    ),

  // 通用批量 IPC 调用 API
  // 用法: batchInvoke([['channel1', arg1, arg2], ['channel2', arg1]])
  /**
   * 通过 IPC_REQUEST_CHANNELS.IPC_BATCH_INVOKE 请求主进程并返回结果。
   * @param {*} calls - calls。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.IPC_BATCH_INVOKE 请求主进程并返回结果。
   * @param {*} calls - calls。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 返回: [{ success: true, data: result1 }, { success: false, error: 'message' }, ...]
  batchInvoke: (calls) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.IPC_BATCH_INVOKE, calls),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} targetFolder - targetFolder。
   * @param {*} progressCallback - progressCallback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  uploadFile: (tabId, targetFolder, progressCallback) =>
    withProgressListener({
      // Unique channel for this specific upload
      channel: getUploadProgressChannel(`${tabId}-${Date.now()}`),
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
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} folderPath - folderPath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} folderPath - folderPath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 创建远程文件夹结构
  createRemoteFolders: (tabId, folderPath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_CREATE_REMOTE_FOLDERS,
      tabId,
      folderPath,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} targetFolder - targetFolder。
   * @param {*} progressCallback - progressCallback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} targetFolder - targetFolder。
   * @param {*} progressCallback - progressCallback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: 上传文件夹API
  uploadFolder: (tabId, targetFolder, progressCallback) =>
    withProgressListener({
      // Unique channel for this specific upload
      channel: getUploadFolderProgressChannel(`${tabId}-${Date.now()}`),
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
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} targetFolder - targetFolder。
   * @param {*} uploadData - uploadData。
   * @param {*} progressCallback - progressCallback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} targetFolder - targetFolder。
   * @param {*} uploadData - uploadData。
   * @param {*} progressCallback - progressCallback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: 上传拖拽文件API (用于文件管理器拖放功能)
  uploadDroppedFiles: (tabId, targetFolder, uploadData, progressCallback) =>
    withProgressListener({
      // Unique channel for this specific upload
      channel: getUploadDroppedProgressChannel(`${tabId}-${Date.now()}`),
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
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} remoteFolderPath - remoteFolderPath。
   * @param {*} progressCallback - progressCallback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} remoteFolderPath - remoteFolderPath。
   * @param {*} progressCallback - progressCallback。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: 下载文件夹API
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
   * 通过 IPC_REQUEST_CHANNELS.FILE_CANCEL_TRANSFER 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @param {*} type - type。
   * @returns {Promise<*>} 主进程处理结果。
   */
  cancelTransfer: (tabId, type) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CANCEL_TRANSFER, tabId, type),
  /**
   * 通过 IPC_REQUEST_CHANNELS.FILE_LIST_RESUMABLE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  listResumableTransfers: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_LIST_RESUMABLE),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} id - id。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  resumeTransfer: (tabId, id, options = {}) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_RESUME_TRANSFER,
      tabId,
      id,
      options,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.FILE_DISCARD_RESUMABLE 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @param {*} id - id。
   * @returns {Promise<*>} 主进程处理结果。
   */
  discardResumableTransfer: (tabId, id) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_DISCARD_RESUMABLE, tabId, id),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} key - key。
   * @param {*} algorithm - algorithm。
   * @returns {Promise<*>} 主进程处理结果。
   */
  setTransferIntegrity: (tabId, key, algorithm) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_TRANSFER_INTEGRITY,
      tabId,
      key,
      algorithm,
    ),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} relativePath - relativePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getAbsolutePath: (tabId, relativePath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_GET_ABSOLUTE_PATH,
      tabId,
      relativePath,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 添加文件内容读取API
  readFileContent: (tabId, filePath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SFTP_READ_FILE_CONTENT,
      tabId,
      filePath,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} content - content。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} content - content。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增：保存文件内容API
  saveFileContent: (tabId, filePath, content) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SFTP_SAVE_FILE_CONTENT,
      tabId,
      filePath,
      content,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 从base64解码读取文件内容
  readFileAsBase64: (tabId, filePath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SFTP_READ_FILE_BASE64,
      tabId,
      filePath,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @returns {Promise<*>} 主进程处理结果。
   */
  listFileSnapshots: (tabId, filePath) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SFTP_LIST_FILE_SNAPSHOTS,
      tabId,
      filePath,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} content - content。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} snapshotId - snapshotId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getFileSnapshot: (tabId, filePath, snapshotId) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SFTP_GET_FILE_SNAPSHOT,
      tabId,
      filePath,
      snapshotId,
    ),

  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_OPEN_EXTERNAL 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @param {*} filePath - filePath。
   * @param {*} snapshotId - snapshotId。
   * @param {*} currentContent - currentContent。
   * @returns {Promise<*>} 主进程处理结果。
   */
  restoreFileSnapshot: (tabId, filePath, snapshotId, currentContent = null) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SFTP_RESTORE_FILE_SNAPSHOT,
      tabId,
      filePath,
      snapshotId,
      currentContent,
    ),

  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_OPEN_EXTERNAL 请求主进程并返回结果。
   * @param {*} url - url。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 在外部浏览器打开链接
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.FILE_CHECK_PATH_EXISTS 请求主进程并返回结果。
   * @param {*} path - path。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.FILE_CHECK_PATH_EXISTS 请求主进程并返回结果。
   * @param {*} path - path。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 文件系统辅助API
  checkPathExists: (path) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CHECK_PATH_EXISTS, path),
  /**
   * 通过 IPC_REQUEST_CHANNELS.FILE_SHOW_ITEM_IN_FOLDER 请求主进程并返回结果。
   * @param {*} path - path。
   * @returns {Promise<*>} 主进程处理结果。
   */
  showItemInFolder: (path) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_SHOW_ITEM_IN_FOLDER, path),
  /**
   * 通过 IPC_REQUEST_CHANNELS.FILE_VALIDATE_DROPPED_ITEMS 请求主进程并返回结果。
   * @param {*} items - items。
   * @returns {Promise<*>} 主进程处理结果。
   */
  validateDroppedItems: (items) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_VALIDATE_DROPPED_ITEMS, items),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} tabId - tabId。
   * @param {*} targetFolder - targetFolder。
   * @param {*} uploadData - uploadData。
   * @returns {Promise<*>} 主进程处理结果。
   */
  checkDroppedUploadConflicts: (tabId, targetFolder, uploadData) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.FILE_CHECK_DROPPED_UPLOAD_CONFLICTS,
      tabId,
      targetFolder,
      uploadData,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} file - file。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },

  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_LOAD_UI 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_LOAD_UI 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // UI设置相关API
  loadUISettings: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_LOAD_UI),
  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_SAVE_UI 请求主进程并返回结果。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  saveUISettings: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_SAVE_UI, settings),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getCredentialSecurityStatus: () =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SETTINGS_GET_CREDENTIAL_SECURITY_STATUS,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  updateCredentialSecurity: (settings) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_CREDENTIAL_SECURITY,
      settings,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} masterPassword - masterPassword。
   * @returns {Promise<*>} 主进程处理结果。
   */
  unlockCredentialStore: (masterPassword) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SETTINGS_UNLOCK_CREDENTIAL_STORE,
      masterPassword,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_LOCK_CREDENTIAL_STORE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  lockCredentialStore: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_LOCK_CREDENTIAL_STORE),
  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_CLEAR_LOCAL_DATA 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  clearLocalData: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_CLEAR_LOCAL_DATA, options),

  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_EXPORT 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_EXPORT 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 配置导入/导出/同步相关API
  configTransferExport: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_EXPORT, options),
  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_IMPORT 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  configTransferImport: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_IMPORT, options),
  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_LIST_SECTIONS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  configTransferListSections: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_TRANSFER_LIST_SECTIONS),
  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_LOAD_SETTINGS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  configSyncLoadSettings: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_LOAD_SETTINGS),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  configSyncSaveSettings: (settings) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.CONFIG_SYNC_SAVE_SETTINGS,
      settings,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_TEST 请求主进程并返回结果。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  configSyncTest: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_TEST, settings),
  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_UPLOAD 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  configSyncUpload: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_UPLOAD, options),
  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_DOWNLOAD 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  configSyncDownload: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_DOWNLOAD, options),
  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_GET_STATUS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  configSyncGetStatus: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_GET_STATUS),
  /**
   * 通过 IPC_REQUEST_CHANNELS.CONFIG_SYNC_PULL_NOW 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  configSyncPullNow: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.CONFIG_SYNC_PULL_NOW),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_LOAD_LOG 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_LOAD_LOG 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 日志设置相关API
  loadLogSettings: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_LOAD_LOG),
  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_SAVE_LOG 请求主进程并返回结果。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  saveLogSettings: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_SAVE_LOG, settings),
  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_GET_ERROR_REPORTING 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getErrorReportingSettings: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_GET_ERROR_REPORTING),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  saveErrorReportingSettings: (settings) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.SETTINGS_SAVE_ERROR_REPORTING,
      settings,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} resourceName - resourceName。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} resourceName - resourceName。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 性能设置实时更新API
  configureRuntimeFileResource: (resourceName, settings = {}) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.RUNTIME_FILES_CONFIGURE,
      resourceName,
      settings,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} resourceName - resourceName。
   * @param {*} targetPath - targetPath。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  releaseRuntimeFilePath: (resourceName, targetPath, options = {}) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.RUNTIME_FILES_RELEASE_PATH,
      resourceName,
      targetPath,
      options,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} resourceName - resourceName。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  clearRuntimeFileResource: (resourceName, options = {}) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.RUNTIME_FILES_CLEAR,
      resourceName,
      options,
    ),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} resourceName - resourceName。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  sweepRuntimeFileResource: (resourceName, options = {}) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.RUNTIME_FILES_SWEEP,
      resourceName,
      options,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_PREFETCH 请求主进程并返回结果。
   * @param {object} settings - settings。
   * @returns {Promise<*>} 主进程处理结果。
   */
  updatePrefetchSettings: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_PREFETCH, settings),

  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_RELOAD_WINDOW 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_RELOAD_WINDOW 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 窗口重新加载
  reloadWindow: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_RELOAD_WINDOW),

  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_REBUILD_SYSTEM_MENU 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_REBUILD_SYSTEM_MENU 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 重建系统菜单（语言切换后由渲染层触发）
  rebuildSystemMenu: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_REBUILD_SYSTEM_MENU),

  /**
   * 通过 IPC_REQUEST_CHANNELS.WINDOW_MINIMIZE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.WINDOW_MINIMIZE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 窗口控制API
  minimizeWindow: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_MINIMIZE),
  /**
   * 通过 IPC_REQUEST_CHANNELS.WINDOW_TOGGLE_MAXIMIZE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
  /**
   * 通过 IPC_REQUEST_CHANNELS.WINDOW_CLOSE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  closeWindow: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_CLOSE),
  /**
   * 通过 IPC_REQUEST_CHANNELS.WINDOW_GET_STATE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getWindowState: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_GET_STATE),
  /**
   * 主题与首屏 UI 就绪后通知主进程显示窗口（防启动闪屏）。
   * @returns {Promise<*>} 主进程处理结果。
   */
  notifyWindowReady: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_NOTIFY_READY),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_DOWNLOAD_UPDATE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_DOWNLOAD_UPDATE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 更新相关API
  downloadUpdate: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_DOWNLOAD_UPDATE),
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_INSTALL_UPDATE 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  installUpdate: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_INSTALL_UPDATE),
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_GET_DOWNLOAD_PROGRESS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getDownloadProgress: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_DOWNLOAD_PROGRESS),
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_CANCEL_DOWNLOAD 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  cancelDownload: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_CANCEL_DOWNLOAD),
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_HAS_DOWNLOADED_INSTALLER 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  hasDownloadedInstaller: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_HAS_DOWNLOADED_INSTALLER),
  /**
   * 通过 IPC_REQUEST_CHANNELS.APP_GET_GPU_INFO 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getGpuInfo: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_GPU_INFO),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @param {*} isEditorMode - isEditorMode。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {string} processId - processId。
   * @param {*} isEditorMode - isEditorMode。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增: 通知主进程编辑器模式变化的API
  notifyEditorModeChange: (processId, isEditorMode) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_NOTIFY_EDITOR_MODE_CHANGE,
      processId,
      isEditorMode,
    ),

  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_ADD 请求主进程并返回结果。
   * @param {*} command - command。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_ADD 请求主进程并返回结果。
   * @param {*} command - command。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 命令历史相关API
  addToCommandHistory: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_ADD, command),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} input - input。
   * @param {*} maxResults - maxResults。
   * @returns {Promise<*>} 主进程处理结果。
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} command - command。
   * @returns {Promise<*>} 主进程处理结果。
   */
  incrementCommandUsage: (command) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.COMMAND_HISTORY_INCREMENT_USAGE,
      command,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_CLEAR 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  clearCommandHistory: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_CLEAR),
  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_STATISTICS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getCommandHistoryStatistics: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_STATISTICS),

  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_ALL 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_ALL 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 新增：历史命令管理API
  getAllCommandHistory: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_ALL),
  /**
   * 通过 IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE 请求主进程并返回结果。
   * @param {*} command - command。
   * @returns {Promise<*>} 主进程处理结果。
   */
  deleteCommandHistory: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE, command),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} commands - commands。
   * @returns {Promise<*>} 主进程处理结果。
   */
  deleteCommandHistoryBatch: (commands) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE_BATCH,
      commands,
    ),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.UTILITY_IP_QUERY 请求主进程并返回结果。
   * @param {*} ip - ip。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.UTILITY_IP_QUERY 请求主进程并返回结果。
   * @param {*} ip - ip。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // IP地址查询API
  queryIpAddress: (ip = "") =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.UTILITY_IP_QUERY, ip),

  /**
   * 通过 IPC_REQUEST_CHANNELS.LATENCY_REGISTER 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @param {*} host - host。
   * @param {*} port - port。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.LATENCY_REGISTER 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @param {*} host - host。
   * @param {*} port - port。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 网络延迟检测API
  registerLatencyDetection: (tabId, host, port) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_REGISTER, {
      tabId,
      host,
      port,
    }),
  /**
   * 通过 IPC_REQUEST_CHANNELS.LATENCY_UNREGISTER 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  unregisterLatencyDetection: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_UNREGISTER, { tabId }),
  /**
   * 通过 IPC_REQUEST_CHANNELS.LATENCY_GET_INFO 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getLatencyInfo: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_GET_INFO, { tabId }),
  /**
   * 通过 IPC_REQUEST_CHANNELS.LATENCY_GET_ALL_INFO 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getAllLatencyInfo: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_GET_ALL_INFO),
  /**
   * 通过 IPC_REQUEST_CHANNELS.LATENCY_GET_SERVICE_STATUS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  getLatencyServiceStatus: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_GET_SERVICE_STATUS),
  /**
   * 通过 IPC_REQUEST_CHANNELS.LATENCY_TEST_NOW 请求主进程并返回结果。
   * @param {string} tabId - tabId。
   * @returns {Promise<*>} 主进程处理结果。
   */
  testLatencyNow: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_TEST_NOW, { tabId }),
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 延迟事件监听
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_START_SSH 请求主进程并返回结果。
   * @param {*} sshConfig - sshConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_START_SSH 请求主进程并返回结果。
   * @param {*} sshConfig - sshConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // SSH连接相关
  startSSH: (sshConfig) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_START_SSH, sshConfig),
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} sshConfig - sshConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  testSSHConnection: (sshConfig) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_TEST_SSH_CONNECTION,
      sshConfig,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} telnetConfig - telnetConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} telnetConfig - telnetConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // Telnet连接相关
  startTelnet: (telnetConfig) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_START_TELNET,
      telnetConfig,
    ),

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} serialConfig - serialConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} serialConfig - serialConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 串口（Serial/COM）连接相关
  startSerial: (serialConfig) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_START_SERIAL,
      serialConfig,
    ),
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_LIST_SERIAL_PORTS 请求主进程并返回结果。
   * @returns {Promise<*>} 主进程处理结果。
   */
  listSerialPorts: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_LIST_SERIAL_PORTS),

  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_START_MOSH 请求主进程并返回结果。
   * @param {*} moshConfig - moshConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.TERMINAL_START_MOSH 请求主进程并返回结果。
   * @param {*} moshConfig - moshConfig。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // Mosh 连接相关（弱网/漫游场景，经本地 mosh 客户端托管）
  startMosh: (moshConfig) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_START_MOSH, moshConfig),

  // SSH 认证相关 IPC
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 监听 SSH 认证请求（主机密钥验证、凭证请求等）
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @returns {Promise<*>} 主进程处理结果。
   */
  offSSHAuthRequest: () => {
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST);
  },

  /**
   * 通过 IPC_REQUEST_CHANNELS.SSH_AUTH_RESPONSE 请求主进程并返回结果。
   * @param {*} response - response。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.SSH_AUTH_RESPONSE 请求主进程并返回结果。
   * @param {*} response - response。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 响应 SSH 认证请求
  respondSSHAuth: (response) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_AUTH_RESPONSE, response),

  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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

  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} connectionId - connectionId。
   * @param {*} credentials - credentials。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} connectionId - connectionId。
   * @param {*} credentials - credentials。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 更新连接配置（用于保存自动登录凭据）
  updateConnectionCredentials: (connectionId, credentials) =>
    ipcRenderer.invoke(
      IPC_REQUEST_CHANNELS.TERMINAL_UPDATE_CONNECTION_CREDENTIALS,
      connectionId,
      credentials,
    ),
});

// SSH密钥生成器API
contextBridge.exposeInMainWorld("electronAPI", {
  /**
   * 通过 IPC_REQUEST_CHANNELS.SSH_KEY_GENERATE 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.SSH_KEY_GENERATE 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // SSH密钥对生成
  generateSSHKeyPair: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_KEY_GENERATE, options),

  /**
   * 通过 IPC_REQUEST_CHANNELS.SSH_KEY_SAVE 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.SSH_KEY_SAVE 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 保存SSH密钥到文件
  saveSSHKey: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_KEY_SAVE, options),
});

// 文件对话框API
contextBridge.exposeInMainWorld("dialogAPI", {
  /**
   * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_OPEN 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_OPEN 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 显示打开文件/目录对话框
  showOpenDialog: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_OPEN, options),

  /**
   * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_SAVE 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_SAVE 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 显示保存文件对话框
  showSaveDialog: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_SAVE, options),

  /**
   * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_MESSAGE 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 通过 IPC_REQUEST_CHANNELS.DIALOG_SHOW_MESSAGE 请求主进程并返回结果。
   * @param {object} options - options。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 显示消息框
  showMessageBox: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_MESSAGE, options),
});

// 应用错误处理API
contextBridge.exposeInMainWorld("appErrorAPI", {
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
   */
  // 监听应用错误
  onError: (callback) => ipcRenderer.on(IPC_EVENT_CHANNELS.APP_ERROR, callback),

  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @returns {Promise<*>} 主进程处理结果。
   */
  /**
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @returns {Promise<*>} 主进程处理结果。
   */
  // 移除错误监听
  removeErrorListener: () => {
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.APP_ERROR);
  },
});

// Clipboard API (Electron 40+ safe access pattern)
contextBridge.exposeInMainWorld("clipboardAPI", {
  /**
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @returns {Promise<*>} 主进程处理结果。
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
   * 渲染进程本地辅助方法（不经过 IPC）。
   * @param {*} text - text。
   * @returns {Promise<*>} 主进程处理结果。
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
   * 监听/移除主进程事件，回调在渲染进程执行。
   * @param {Function} callback - callback。
   * @returns {Function|void} 返回取消监听函数或无返回值。
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
