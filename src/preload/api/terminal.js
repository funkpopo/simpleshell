// @ts-check
/**
 * Preload 运行于隔离上下文；类型检查由 scripts/check-preload-typings.js 执行。
 * 主进程尚未细化的响应使用 unknown，调用方应先缩窄类型。
 * @import { IpcResult, ProcessId, Unsubscribe, PayloadCallback, IpcCallback, ReconnectCallback, ExternalEditorCallback, TerminalMailboxMessage, WindowState, ExternalOpenOptions, ExternalOpenResult, ListFilesOptions, DownloadProgressCallback, UploadProgressCallback, UploadFolderProgressCallback, UploadDroppedProgressCallback } from "../../shared/contracts/preload"
 */

/** @param {ReturnType<typeof import("../bridgeContext").createBridgeContext>} bridge */
function createTerminalAPI(bridge) {
  const {
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
    getProcessOutputWrapperStore,
    removeAllManagedProcessOutputListeners,
    commandHistoryChangedWrappers,
  } = bridge;
  return {
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
        ipcRenderer.removeAllListeners(
          IPC_EVENT_CHANNELS.LOCAL_TERMINAL_STATUS,
        );
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

    /**
     * 通过 IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_PREFETCH 请求主进程。
     * @param {Record<string, unknown>} settings
     * @returns {Promise<unknown>}
     */
    updatePrefetchSettings: (settings) =>
      ipcRenderer.invoke(
        IPC_REQUEST_CHANNELS.SETTINGS_UPDATE_PREFETCH,
        settings,
      ),

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
      ipcRenderer.on(
        IPC_EVENT_CHANNELS.COMMAND_HISTORY_CHANGED,
        wrappedCallback,
      );
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
  };
}
module.exports = { createTerminalAPI };
