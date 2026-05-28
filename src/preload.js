// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const {
  contextBridge,
  ipcRenderer,
  clipboard,
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

// Listener wrapper stores (avoid mutating callback functions with hidden properties)
const topConnectionsChangedWrappers = new WeakMap();
const connectionsChangedWrappers = new WeakMap();
const commandHistoryChangedWrappers = new WeakMap();
const localDataClearedWrappers = new WeakMap();
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
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CANCEL_LIST, tabId).catch(() => {});
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
contextBridge.exposeInMainWorld("terminalAPI", {
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
  sendCommand: (command) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND, command),

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
  sendToProcessWithAck: (processId, data) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_SEND_TO_PROCESS, processId, data),
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
  killProcess: (processId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_KILL_PROCESS, processId),
  // 新增：获取进程信息
  getProcessInfo: (processId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_INFO, processId),

  // 本地终端API
  detectLocalTerminals: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINALS_DETECT),
  launchLocalTerminal: (terminalConfig, tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_LAUNCH, terminalConfig, tabId),
  closeLocalTerminal: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_CLOSE, tabId),
  getLocalTerminalInfo: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_INFO, tabId),

  // 重连管理API
  getReconnectStatus: (args) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_GET_STATUS, args),
  manualReconnect: (args) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_MANUAL, args),
  pauseReconnect: (args) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_PAUSE, args),
  resumeReconnect: (args) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_RESUME, args),
  getReconnectStatistics: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RECONNECT_GET_STATISTICS),

  // 重连事件监听器
  onReconnectStart: (callback) => ipcRenderer.on(IPC_EVENT_CHANNELS.RECONNECT_STARTED, callback),
  onReconnectProgress: (callback) =>
    ipcRenderer.on(IPC_EVENT_CHANNELS.RECONNECT_PROGRESS, callback),
  onReconnectSuccess: (callback) =>
    ipcRenderer.on(IPC_EVENT_CHANNELS.RECONNECT_SUCCESS, callback),
  onReconnectFailed: (callback) => ipcRenderer.on(IPC_EVENT_CHANNELS.RECONNECT_FAILED, callback),
  onReconnectAbandoned: (callback) =>
    ipcRenderer.on(IPC_EVENT_CHANNELS.RECONNECT_ABANDONED, callback),
  onConnectionLost: (callback) => ipcRenderer.on(IPC_EVENT_CHANNELS.CONNECTION_LOST, callback),
  onTabConnectionStatus: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_event, data) => callback(data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.TAB_CONNECTION_STATUS, wrappedCallback);
    };
  },
  removeReconnectListeners: () => {
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_STARTED);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_PROGRESS);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_SUCCESS);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_FAILED);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.RECONNECT_ABANDONED);
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.CONNECTION_LOST);
  },

  // 自定义终端管理API
  addCustomTerminal: (terminalConfig) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_ADD_CUSTOM, terminalConfig),
  updateCustomTerminal: (id, updates) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_UPDATE_CUSTOM, id, updates),
  deleteCustomTerminal: (id) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_DELETE_CUSTOM, id),
  getCustomTerminals: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_CUSTOM),

  resizeEmbeddedTerminal: (tabId, bounds) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_RESIZE_EMBEDDED, tabId, bounds),
  getAllActiveLocalTerminals: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_ALL_ACTIVE),

  // 资源监控API
  getSystemInfo: (processId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_GET_SYSTEM_INFO, processId),
  getProcessList: (processId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_LIST, processId),

  // 连接管理API
  cleanupConnection: (processId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_CLEANUP_CONNECTION, processId),

  // 快捷命令API
  getShortcutCommands: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_GET),
  saveShortcutCommands: (data) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SHORTCUT_COMMANDS_SAVE, data),

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
  loadConnections: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_LOAD_CONNECTIONS),
  saveConnections: (connections) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_SAVE_CONNECTIONS, connections),
  loadTopConnections: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_LOAD_TOP_CONNECTIONS),

  // 热门连接实时更新事件
  onTopConnectionsChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrapped = (_e, ids) => callback(ids);
    topConnectionsChangedWrappers.set(callback, wrapped);
    ipcRenderer.on(IPC_EVENT_CHANNELS.TOP_CONNECTIONS_CHANGED, wrapped);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.TOP_CONNECTIONS_CHANGED, wrapped);
      topConnectionsChangedWrappers.delete(callback);
    };
  },
  offTopConnectionsChanged: (callback) => {
    if (!callback) return;
    const wrapped = topConnectionsChangedWrappers.get(callback);
    if (wrapped) {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.TOP_CONNECTIONS_CHANGED, wrapped);
      topConnectionsChangedWrappers.delete(callback);
    }
  },

  // 连接配置变化事件监听
  onConnectionsChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = () => callback();
    connectionsChangedWrappers.set(callback, wrappedCallback);
    ipcRenderer.on(IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED, wrappedCallback);
      connectionsChangedWrappers.delete(callback);
    };
  },
  offConnectionsChanged: (callback) => {
    if (!callback) return;
    const wrappedCallback = connectionsChangedWrappers.get(callback);
    if (wrappedCallback) {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.CONNECTIONS_CHANGED, wrappedCallback);
      connectionsChangedWrappers.delete(callback);
    }
  },

  // 选择密钥文件
  selectKeyFile: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_SELECT_KEY_FILE),

  // 简单命令执行
  executeCommand: (command) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_COMMAND, command),

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

  // AI助手API
  saveAISettings: (settings) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_SETTINGS, settings),
  loadAISettings: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_LOAD_SETTINGS),
  sendAIPrompt: (prompt, settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SEND_PROMPT, prompt, settings),
  // 新增: 直接发送API请求的方法
  sendAPIRequest: (requestData, isStream) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SEND_API_REQUEST, requestData, isStream),
  // 新增: 中断API请求的方法
  cancelAPIRequest: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_ABORT_API_REQUEST),
  // 新增: API配置管理方法
  saveApiConfig: (config) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_API_CONFIG, config),
  deleteApiConfig: (configId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_DELETE_API_CONFIG, configId),
  setCurrentApiConfig: (configId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SET_CURRENT_API_CONFIG, configId),
  // 新增: 获取模型列表方法
  fetchModels: (requestData) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_FETCH_MODELS, requestData),
  // 新增: 保存自定义风险规则
  saveCustomRiskRules: (rules) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.AI_SAVE_CUSTOM_RISK_RULES, rules),

  // 记忆文件管理API
  saveMemory: (memory) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_SAVE, memory),
  loadMemory: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_LOAD),
  deleteMemory: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_DELETE),
  getMemoryDiagnostics: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.MEMORY_GET_DIAGNOSTICS),

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

  // 获取应用版本
  getAppVersion: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_VERSION),

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
  offOpenFiles: (callback) => {
    const wrapped = callback && openFilesWrappers.get(callback);
    if (!wrapped) {
      return;
    }
    ipcRenderer.removeListener(IPC_EVENT_CHANNELS.APP_OPEN_FILES, wrapped);
    openFilesWrappers.delete(callback);
  },

  // 关闭应用
  closeApp: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_CLOSE),

  // 检查更新
  checkForUpdate: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_CHECK_FOR_UPDATE),

  openLogDirectory: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_OPEN_LOG_DIRECTORY),
  exportDiagnostics: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_EXPORT_DIAGNOSTICS),
  copyDiagnosticSummary: (context) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_SUMMARY, context),
  copyDiagnosticPackage: (context) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_PACKAGE, context),
  openFeedbackIssue: (context) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_OPEN_FEEDBACK_ISSUE, context),

  // 文件管理相关API
  listFiles: async (tabId, path, options) => {
    const response = await ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_LIST,
      tabId,
      path,
      options,
    );
    if (options?.nonBlocking && response?.chunked && response?.token) {
      trackListFilesToken(tabId, response.token);
    }
    return response;
  },
  cancelListFiles: (tabId, token) => {
    if (token) {
      untrackListFilesToken(token);
    } else {
      untrackListFilesTokensForTab(tabId);
    }
    return ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CANCEL_LIST, tabId, token);
  },
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
  startDirectoryWatch: (tabId, path, options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_START_DIRECTORY_WATCH, tabId, path, options),
  stopDirectoryWatch: (tabId, watchId = null) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_STOP_DIRECTORY_WATCH, tabId, watchId),
  onDirectoryWatchEvent: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const wrapped = (_, data) => callback(data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.DIRECTORY_WATCH_EVENT, wrapped);
    directoryWatchEventWrappers.set(callback, wrapped);
    directoryWatchEventListeners.add(wrapped);

    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.DIRECTORY_WATCH_EVENT, wrapped);
      directoryWatchEventListeners.delete(wrapped);
      directoryWatchEventWrappers.delete(callback);
    };
  },
  offDirectoryWatchEvent: (callback) => {
    if (typeof callback !== "function") {
      return;
    }

    const wrapped = directoryWatchEventWrappers.get(callback);
    if (!wrapped) {
      return;
    }

    ipcRenderer.removeListener(IPC_EVENT_CHANNELS.DIRECTORY_WATCH_EVENT, wrapped);
    directoryWatchEventListeners.delete(wrapped);
    directoryWatchEventWrappers.delete(callback);
  },
  copyFile: (tabId, sourcePath, targetPath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_COPY, tabId, sourcePath, targetPath),
  moveFile: (tabId, sourcePath, targetPath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_MOVE, tabId, sourcePath, targetPath),
  deleteFile: (tabId, filePath, isDirectory) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_DELETE, tabId, filePath, isDirectory),
  createFolder: (tabId, folderPath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CREATE_FOLDER, tabId, folderPath),
  createFile: (tabId, filePath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CREATE, tabId, filePath),
  downloadFile: (tabId, remotePath, progressCallback) => {
    // 注册一个临时的进度监听器
    const progressListener = (_, data) => {
      if (data.tabId === tabId && typeof progressCallback === "function") {
        // 确保传递所有必要的参数给回调函数
        progressCallback(
          data.progress || 0,
          data.fileName || "",
          data.transferredBytes || 0,
          data.totalBytes || 0,
          data.transferSpeed || 0,
          data.remainingTime || 0,
          data.processedFiles || 0,
          data.totalFiles || 0,
          data.transferKey || "", // 添加transferKey参数
        );
      }
    };

    // 添加进度事件监听器
    ipcRenderer.on(IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS, progressListener);

    // 发起下载请求并在完成后移除监听器
    return ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_DOWNLOAD, tabId, remotePath).finally(() => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS, progressListener);
    });
  },
  // 批量下载多个文件
  downloadFiles: (tabId, files, progressCallback) => {
    // 注册一个临时的进度监听器
    const progressListener = (_, data) => {
      if (
        data.tabId === tabId &&
        data.isBatch &&
        typeof progressCallback === "function"
      ) {
        progressCallback(
          data.progress || 0,
          data.fileName || "",
          data.transferredBytes || 0,
          data.totalBytes || 0,
          data.transferSpeed || 0,
          data.remainingTime || 0,
          data.processedFiles || 0,
          data.totalFiles || 0,
          data.transferKey || "",
        );
      }
    };

    // 添加进度事件监听器
    ipcRenderer.on(IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS, progressListener);

    // 发起批量下载请求并在完成后移除监听器
    return ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_DOWNLOAD_FILES, tabId, files).finally(() => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.DOWNLOAD_PROGRESS, progressListener);
    });
  },
  // 新增API
  openFileInExternalEditor: (tabId, remotePath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.EXTERNAL_EDITOR_OPEN, tabId, remotePath),

  onExternalEditorEvent: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const wrapped = (_, data) => callback(data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.EXTERNAL_EDITOR_SYNC, wrapped);
    if (!callback._wrappedCallback) callback._wrappedCallback = wrapped;
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.EXTERNAL_EDITOR_SYNC, wrapped);
    };
  },
  offExternalEditorEvent: (callback) => {
    if (!callback) {
      return;
    }
    const wrapped = callback._wrappedCallback || callback;
    ipcRenderer.removeListener(IPC_EVENT_CHANNELS.EXTERNAL_EDITOR_SYNC, wrapped);
  },

  renameFile: (tabId, oldPath, newName) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_RENAME, tabId, oldPath, newName),

  // 权限设置API
  setFilePermissions: (tabId, filePath, permissions) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_SET_PERMISSIONS, tabId, filePath, permissions),
  // 所有者/组设置API
  setFileOwnership: (tabId, filePath, owner, group) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_SET_OWNERSHIP, tabId, filePath, owner, group),
  getFilePermissions: (tabId, filePath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS, tabId, filePath),

  // 批量获取文件权限 - 减少 IPC 调用开销
  getFilePermissionsBatch: (tabId, filePaths) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_GET_PERMISSIONS_BATCH, tabId, filePaths),

  // 通用批量 IPC 调用 API
  // 用法: batchInvoke([['channel1', arg1, arg2], ['channel2', arg1]])
  // 返回: [{ success: true, data: result1 }, { success: false, error: 'message' }, ...]
  batchInvoke: (calls) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.IPC_BATCH_INVOKE, calls),

  uploadFile: (tabId, targetFolder, progressCallback) => {
    // Unique channel for this specific upload
    const progressChannel = getUploadProgressChannel(`${tabId}-${Date.now()}`);

    // Listen for progress updates on the unique channel
    const handler = (event, progressData) => {
      if (progressCallback && typeof progressCallback === "function") {
        // 确保传递标准化的进度数据格式
        progressCallback(
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
        );
      }
      // If operation is complete or cancelled, remove listener
      if (progressData.operationComplete || progressData.cancelled) {
        ipcRenderer.removeListener(progressChannel, handler);
      }
    };
    ipcRenderer.on(progressChannel, handler);

    // Invoke the main process to start the upload, passing the unique channel
    return ipcRenderer
      .invoke(
        IPC_REQUEST_CHANNELS.FILE_UPLOAD,
        tabId,
        targetFolder,
        progressChannel,
      )
      .finally(() => {
        // Ensure listener is removed if invoke fails or completes without progressData signal
        ipcRenderer.removeListener(progressChannel, handler);
      });
  },
  // 创建远程文件夹结构
  createRemoteFolders: (tabId, folderPath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CREATE_REMOTE_FOLDERS, tabId, folderPath),
  // 新增: 上传文件夹API
  uploadFolder: (tabId, targetFolder, progressCallback) => {
    // Unique channel for this specific upload
    const progressChannel = getUploadFolderProgressChannel(
      `${tabId}-${Date.now()}`,
    );

    // Listen for progress updates on the unique channel
    const handler = (event, progressData) => {
      if (progressCallback && typeof progressCallback === "function") {
        // 确保传递标准化的进度数据格式
        progressCallback(
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
        );
      }
      // If operation is complete or cancelled, remove listener
      if (progressData.operationComplete || progressData.cancelled) {
        ipcRenderer.removeListener(progressChannel, handler);
      }
    };
    ipcRenderer.on(progressChannel, handler);

    // Invoke the main process to start the upload, passing the unique channel
    return ipcRenderer
      .invoke(
        IPC_REQUEST_CHANNELS.FILE_UPLOAD_FOLDER,
        tabId,
        targetFolder,
        progressChannel,
      )
      .finally(() => {
        // Ensure listener is removed if invoke fails or completes without progressData signal
        ipcRenderer.removeListener(progressChannel, handler);
      });
  },
  // 新增: 上传拖拽文件API (用于文件管理器拖放功能)
  uploadDroppedFiles: (tabId, targetFolder, uploadData, progressCallback) => {
    // Unique channel for this specific upload
    const progressChannel = getUploadDroppedProgressChannel(
      `${tabId}-${Date.now()}`,
    );

    // Listen for progress updates on the unique channel
    const handler = (event, progressData) => {
      if (progressCallback && typeof progressCallback === "function") {
        // 确保传递标准化的进度数据格式
        progressCallback(
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
        );
      }
      // If operation is complete or cancelled, remove listener
      if (progressData.operationComplete || progressData.cancelled) {
        ipcRenderer.removeListener(progressChannel, handler);
      }
    };
    ipcRenderer.on(progressChannel, handler);

    // Invoke the main process to start the upload, passing the unique channel
    return ipcRenderer
      .invoke(
        IPC_REQUEST_CHANNELS.FILE_UPLOAD_DROPPED,
        tabId,
        targetFolder,
        uploadData,
        progressChannel,
      )
      .finally(() => {
        // Ensure listener is removed if invoke fails or completes without progressData signal
        ipcRenderer.removeListener(progressChannel, handler);
      });
  },
  // 新增: 下载文件夹API
  downloadFolder: (tabId, remoteFolderPath, progressCallback) => {
    // 注册一个临时的进度监听器
    const progressListener = (_, data) => {
      if (data.tabId === tabId && typeof progressCallback === "function") {
        // 确保传递所有必要的参数给回调函数
        progressCallback(
          data.progress || 0,
          data.currentFile || "",
          data.transferredBytes || 0,
          data.totalBytes || 0,
          data.transferSpeed || 0,
          data.remainingTime || 0,
          data.processedFiles || 0,
          data.totalFiles || 0,
          data.transferKey || "", // 添加transferKey参数
        );
      }
    };

    // 添加进度事件监听器
    ipcRenderer.on(IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS, progressListener);

    // 发起下载请求并在完成后移除监听器
    return ipcRenderer
      .invoke(
        IPC_REQUEST_CHANNELS.FILE_DOWNLOAD_FOLDER,
        tabId,
        remoteFolderPath,
      )
      .finally(() => {
        ipcRenderer.removeListener(IPC_EVENT_CHANNELS.DOWNLOAD_FOLDER_PROGRESS,
          progressListener,
        );
      });
  },
  cancelTransfer: (tabId, type) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CANCEL_TRANSFER, tabId, type),
  getAbsolutePath: (tabId, relativePath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_GET_ABSOLUTE_PATH, tabId, relativePath),
  // 添加文件内容读取API
  readFileContent: (tabId, filePath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SFTP_READ_FILE_CONTENT, tabId, filePath),

  // 新增：保存文件内容API
  saveFileContent: (tabId, filePath, content) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SFTP_SAVE_FILE_CONTENT, tabId, filePath, content),

  // 从base64解码读取文件内容
  readFileAsBase64: (tabId, filePath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SFTP_READ_FILE_BASE64, tabId, filePath),

  listFileSnapshots: (tabId, filePath) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SFTP_LIST_FILE_SNAPSHOTS, tabId, filePath),

  createFileSnapshot: (tabId, filePath, content, options = {}) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SFTP_CREATE_FILE_SNAPSHOT, tabId, filePath, content, options),

  getFileSnapshot: (tabId, filePath, snapshotId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SFTP_GET_FILE_SNAPSHOT, tabId, filePath, snapshotId),

  restoreFileSnapshot: (tabId, filePath, snapshotId, currentContent = null) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SFTP_RESTORE_FILE_SNAPSHOT,
      tabId,
      filePath,
      snapshotId,
      currentContent,
    ),

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

  // 文件系统辅助API
  checkPathExists: (path) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CHECK_PATH_EXISTS, path),
  showItemInFolder: (path) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_SHOW_ITEM_IN_FOLDER, path),
  validateDroppedItems: (items) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_VALIDATE_DROPPED_ITEMS, items),
  checkDroppedUploadConflicts: (tabId, targetFolder, uploadData) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.FILE_CHECK_DROPPED_UPLOAD_CONFLICTS,
      tabId,
      targetFolder,
      uploadData,
    ),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },

  // UI设置相关API
  loadUISettings: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_LOAD_UI),
  saveUISettings: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_SAVE_UI, settings),
  getCredentialSecurityStatus: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_GET_CREDENTIAL_SECURITY_STATUS),
  updateCredentialSecurity: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_CREDENTIAL_SECURITY, settings),
  unlockCredentialStore: (masterPassword) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_UNLOCK_CREDENTIAL_STORE, masterPassword),
  lockCredentialStore: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_LOCK_CREDENTIAL_STORE),
  clearLocalData: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_CLEAR_LOCAL_DATA, options),
  onLocalDataCleared: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_event, payload) => callback(payload);
    localDataClearedWrappers.set(callback, wrappedCallback);
    ipcRenderer.on(IPC_EVENT_CHANNELS.SETTINGS_LOCAL_DATA_CLEARED, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.SETTINGS_LOCAL_DATA_CLEARED, wrappedCallback);
      localDataClearedWrappers.delete(callback);
    };
  },
  offLocalDataCleared: (callback) => {
    if (!callback) return;
    const wrappedCallback = localDataClearedWrappers.get(callback);
    if (wrappedCallback) {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.SETTINGS_LOCAL_DATA_CLEARED, wrappedCallback);
      localDataClearedWrappers.delete(callback);
    }
  },

  // 日志设置相关API
  loadLogSettings: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_LOAD_LOG),
  saveLogSettings: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_SAVE_LOG, settings),
  getErrorReportingSettings: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_GET_ERROR_REPORTING),
  saveErrorReportingSettings: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_SAVE_ERROR_REPORTING, settings),

  // 性能设置实时更新API
  configureRuntimeFileResource: (resourceName, settings = {}) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RUNTIME_FILES_CONFIGURE, resourceName, settings),
  releaseRuntimeFilePath: (resourceName, targetPath, options = {}) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RUNTIME_FILES_RELEASE_PATH,
      resourceName,
      targetPath,
      options,
    ),
  clearRuntimeFileResource: (resourceName, options = {}) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RUNTIME_FILES_CLEAR, resourceName, options),
  sweepRuntimeFileResource: (resourceName, options = {}) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.RUNTIME_FILES_SWEEP, resourceName, options),
  updatePrefetchSettings: (settings) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_PREFETCH, settings),

  // 窗口重新加载
  reloadWindow: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_RELOAD_WINDOW),

  // 窗口控制API
  minimizeWindow: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_MINIMIZE),
  toggleMaximizeWindow: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_TOGGLE_MAXIMIZE),
  closeWindow: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_CLOSE),
  getWindowState: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.WINDOW_GET_STATE),
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
  downloadUpdate: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_DOWNLOAD_UPDATE),
  installUpdate: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_INSTALL_UPDATE),
  getDownloadProgress: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_DOWNLOAD_PROGRESS),
  cancelDownload: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_CANCEL_DOWNLOAD),
  hasDownloadedInstaller: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_HAS_DOWNLOADED_INSTALLER),
  getGpuInfo: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.APP_GET_GPU_INFO),

  // 新增: 通知主进程编辑器模式变化的API
  notifyEditorModeChange: (processId, isEditorMode) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_NOTIFY_EDITOR_MODE_CHANGE,
      processId,
      isEditorMode,
    ),

  // 命令历史相关API
  addToCommandHistory: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_ADD, command),
  getCommandSuggestions: (input, maxResults) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_SUGGESTIONS, input, maxResults),
  incrementCommandUsage: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_INCREMENT_USAGE, command),
  clearCommandHistory: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_CLEAR),
  getCommandHistoryStatistics: () =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_STATISTICS),

  // 新增：历史命令管理API
  getAllCommandHistory: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_GET_ALL),
  deleteCommandHistory: (command) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE, command),
  deleteCommandHistoryBatch: (commands) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.COMMAND_HISTORY_DELETE_BATCH, commands),
  onCommandHistoryChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_event, payload) => callback(payload);
    commandHistoryChangedWrappers.set(callback, wrappedCallback);
    ipcRenderer.on(IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED, wrappedCallback);
      commandHistoryChangedWrappers.delete(callback);
    };
  },
  offCommandHistoryChanged: (callback) => {
    if (!callback) return;
    const wrappedCallback = commandHistoryChangedWrappers.get(callback);
    if (wrappedCallback) {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED, wrappedCallback);
      commandHistoryChangedWrappers.delete(callback);
    }
  },

  // IP地址查询API
  queryIpAddress: (ip = "") => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.UTILITY_IP_QUERY, ip),

  // 网络延迟检测API
  registerLatencyDetection: (tabId, host, port) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_REGISTER, { tabId, host, port }),
  unregisterLatencyDetection: (tabId) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_UNREGISTER, { tabId }),
  getLatencyInfo: (tabId) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_GET_INFO, { tabId }),
  getAllLatencyInfo: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_GET_ALL_INFO),
  getLatencyServiceStatus: () => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_GET_SERVICE_STATUS),
  testLatencyNow: (tabId) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.LATENCY_TEST_NOW, { tabId }),
  // 延迟事件监听
  onLatencyUpdate: (callback) => {
    const wrappedCallback = (event, data) => callback(event, data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.LATENCY_UPDATED, wrappedCallback);
    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNELS.LATENCY_UPDATED, wrappedCallback);
  },
  onLatencyError: (callback) => {
    const wrappedCallback = (event, data) => callback(event, data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.LATENCY_ERROR, wrappedCallback);
    return () => ipcRenderer.removeListener(IPC_EVENT_CHANNELS.LATENCY_ERROR, wrappedCallback);
  },
  onLatencyDisconnected: (callback) => {
    const wrappedCallback = (event, data) => callback(event, data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.LATENCY_DISCONNECTED, wrappedCallback);
    return () =>
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.LATENCY_DISCONNECTED, wrappedCallback);
  },

  // SSH连接相关
  startSSH: (sshConfig) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_START_SSH, sshConfig),

  // Telnet连接相关
  startTelnet: (telnetConfig) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_START_TELNET, telnetConfig),

  // SSH 认证相关 IPC
  // 监听 SSH 认证请求（主机密钥验证、凭证请求等）
  onSSHAuthRequest: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_, data) => callback(data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST, wrappedCallback);
    };
  },
  offSSHAuthRequest: () => {
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.SSH_AUTH_REQUEST);
  },

  // 响应 SSH 认证请求
  respondSSHAuth: (response) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_AUTH_RESPONSE, response),

  onTerminalSessionRestored: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_event, data) => callback(data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORED, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORED, wrappedCallback);
    };
  },
  onTerminalSessionRestoreFailed: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_event, data) => callback(data);
    ipcRenderer.on(IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORE_FAILED, wrappedCallback);
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_CHANNELS.TERMINAL_SESSION_RESTORE_FAILED,
        wrappedCallback,
      );
    };
  },

  // 更新连接配置（用于保存自动登录凭据）
  updateConnectionCredentials: (connectionId, credentials) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.TERMINAL_UPDATE_CONNECTION_CREDENTIALS,
      connectionId,
      credentials,
    ),
});

// SSH密钥生成器API
contextBridge.exposeInMainWorld("electronAPI", {
  // SSH密钥对生成
  generateSSHKeyPair: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_KEY_GENERATE, options),

  // 保存SSH密钥到文件
  saveSSHKey: (options) => ipcRenderer.invoke(IPC_REQUEST_CHANNELS.SSH_KEY_SAVE, options),
});

// 文件对话框API
contextBridge.exposeInMainWorld("dialogAPI", {
  // 显示打开文件/目录对话框
  showOpenDialog: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_OPEN, options),

  // 显示保存文件对话框
  showSaveDialog: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_SAVE, options),

  // 显示消息框
  showMessageBox: (options) =>
    ipcRenderer.invoke(IPC_REQUEST_CHANNELS.DIALOG_SHOW_MESSAGE, options),
});

// 应用错误处理API
contextBridge.exposeInMainWorld("appErrorAPI", {
  // 监听应用错误
  onError: (callback) => ipcRenderer.on(IPC_EVENT_CHANNELS.APP_ERROR, callback),

  // 移除错误监听
  removeErrorListener: () => {
    ipcRenderer.removeAllListeners(IPC_EVENT_CHANNELS.APP_ERROR);
  },
});

// Clipboard API (Electron 40+ safe access pattern)
contextBridge.exposeInMainWorld("clipboardAPI", {
  readText: async () => clipboard.readText(),
  writeText: async (text) => {
    clipboard.writeText(String(text ?? ""));
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
