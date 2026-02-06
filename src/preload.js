// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer, clipboard } = require("electron");

// Listener wrapper stores (avoid mutating callback functions with hidden properties)
const topConnectionsChangedWrappers = new WeakMap();
const connectionsChangedWrappers = new WeakMap();
const streamWrappersByChannel = {
  "stream-chunk": new WeakMap(),
  "stream-end": new WeakMap(),
  "stream-error": new WeakMap(),
};

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld("terminalAPI", {
  // 发送命令到主进程处理 (用于模拟终端)
  sendCommand: (command) => ipcRenderer.invoke("terminal:command", command),

  // 终端进程管理
  sendToProcess: (processId, data) =>
    ipcRenderer.invoke("terminal:sendToProcess", processId, data),
  killProcess: (processId) =>
    ipcRenderer.invoke("terminal:killProcess", processId),
  // 新增：获取进程信息
  getProcessInfo: (processId) =>
    ipcRenderer.invoke("terminal:getProcessInfo", processId),

  // 本地终端API
  detectLocalTerminals: () => ipcRenderer.invoke("detectLocalTerminals"),
  launchLocalTerminal: (terminalConfig, tabId) =>
    ipcRenderer.invoke("launchLocalTerminal", terminalConfig, tabId),
  closeLocalTerminal: (tabId) =>
    ipcRenderer.invoke("closeLocalTerminal", tabId),
  getLocalTerminalInfo: (tabId) =>
    ipcRenderer.invoke("getLocalTerminalInfo", tabId),

  // 重连管理API
  getReconnectStatus: (args) =>
    ipcRenderer.invoke("get-reconnect-status", args),
  manualReconnect: (args) => ipcRenderer.invoke("manual-reconnect", args),
  pauseReconnect: (args) => ipcRenderer.invoke("pause-reconnect", args),
  resumeReconnect: (args) => ipcRenderer.invoke("resume-reconnect", args),
  getReconnectStatistics: () => ipcRenderer.invoke("get-reconnect-statistics"),

  // 重连事件监听器
  onReconnectStart: (callback) => ipcRenderer.on("reconnect-started", callback),
  onReconnectProgress: (callback) =>
    ipcRenderer.on("reconnect-progress", callback),
  onReconnectSuccess: (callback) =>
    ipcRenderer.on("reconnect-success", callback),
  onReconnectFailed: (callback) => ipcRenderer.on("reconnect-failed", callback),
  onConnectionLost: (callback) => ipcRenderer.on("connection-lost", callback),
  removeReconnectListeners: (tabId) => {
    ipcRenderer.removeAllListeners("reconnect-started");
    ipcRenderer.removeAllListeners("reconnect-progress");
    ipcRenderer.removeAllListeners("reconnect-success");
    ipcRenderer.removeAllListeners("reconnect-failed");
    ipcRenderer.removeAllListeners("connection-lost");
  },

  // 自定义终端管理API
  addCustomTerminal: (terminalConfig) =>
    ipcRenderer.invoke("addCustomTerminal", terminalConfig),
  updateCustomTerminal: (id, updates) =>
    ipcRenderer.invoke("updateCustomTerminal", id, updates),
  deleteCustomTerminal: (id) => ipcRenderer.invoke("deleteCustomTerminal", id),
  getCustomTerminals: () => ipcRenderer.invoke("getCustomTerminals"),

  resizeEmbeddedTerminal: (tabId, bounds) =>
    ipcRenderer.invoke("resizeEmbeddedTerminal", tabId, bounds),
  getAllActiveLocalTerminals: () =>
    ipcRenderer.invoke("getAllActiveLocalTerminals"),

  // 资源监控API
  getSystemInfo: (processId) =>
    ipcRenderer.invoke("terminal:getSystemInfo", processId),
  getProcessList: (processId) =>
    ipcRenderer.invoke("terminal:getProcessList", processId),

  // 连接管理API
  cleanupConnection: (processId) =>
    ipcRenderer.invoke("terminal:cleanupConnection", processId),

  // 快捷命令API
  getShortcutCommands: () => ipcRenderer.invoke("get-shortcut-commands"),
  saveShortcutCommands: (data) =>
    ipcRenderer.invoke("save-shortcut-commands", data),
  exportSyncPackage: () => ipcRenderer.invoke("settings:exportSyncPackage"),
  importSyncPackage: () => ipcRenderer.invoke("settings:importSyncPackage"),

  // 事件监听
  onProcessOutput: (processId, callback) => {
    const channel = `process:output:${processId}`;

    ipcRenderer.removeAllListeners(channel);

    ipcRenderer.on(channel, (event, data) => {
      callback(data);
    });

    return () => {
      ipcRenderer.removeAllListeners(channel);
    };
  },

  removeOutputListener: (processId) => {
    if (processId) {
      ipcRenderer.removeAllListeners(`process:output:${processId}`);
    }
  },

  // 连接配置存储API
  loadConnections: () => ipcRenderer.invoke("terminal:loadConnections"),
  saveConnections: (connections) =>
    ipcRenderer.invoke("terminal:saveConnections", connections),
  loadTopConnections: () => ipcRenderer.invoke("terminal:loadTopConnections"),

  // 热门连接实时更新事件
  onTopConnectionsChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrapped = (_e, ids) => callback(ids);
    topConnectionsChangedWrappers.set(callback, wrapped);
    ipcRenderer.on("top-connections-changed", wrapped);
    return () => {
      ipcRenderer.removeListener("top-connections-changed", wrapped);
      topConnectionsChangedWrappers.delete(callback);
    };
  },
  offTopConnectionsChanged: (callback) => {
    if (!callback) return;
    const wrapped = topConnectionsChangedWrappers.get(callback);
    if (wrapped) {
      ipcRenderer.removeListener("top-connections-changed", wrapped);
      topConnectionsChangedWrappers.delete(callback);
    }
  },

  // 连接配置变化事件监听
  onConnectionsChanged: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = () => callback();
    connectionsChangedWrappers.set(callback, wrappedCallback);
    ipcRenderer.on("connections-changed", wrappedCallback);
    return () => {
      ipcRenderer.removeListener("connections-changed", wrappedCallback);
      connectionsChangedWrappers.delete(callback);
    };
  },
  offConnectionsChanged: (callback) => {
    if (!callback) return;
    const wrappedCallback = connectionsChangedWrappers.get(callback);
    if (wrappedCallback) {
      ipcRenderer.removeListener("connections-changed", wrappedCallback);
      connectionsChangedWrappers.delete(callback);
    }
  },

  // 选择密钥文件
  selectKeyFile: () => ipcRenderer.invoke("terminal:selectKeyFile"),

  // 简单命令执行
  executeCommand: (command) => ipcRenderer.invoke("terminal:command", command),

  // 终端大小调整
  resizeTerminal: (processId, cols, rows) =>
    ipcRenderer.invoke("terminal:resize", processId, cols, rows),

  // AI助手API
  saveAISettings: (settings) => ipcRenderer.invoke("ai:saveSettings", settings),
  loadAISettings: () => ipcRenderer.invoke("ai:loadSettings"),
  sendAIPrompt: (prompt, settings) =>
    ipcRenderer.invoke("ai:sendPrompt", prompt, settings),
  // 新增: 直接发送API请求的方法
  sendAPIRequest: (requestData, isStream) =>
    ipcRenderer.invoke("ai:sendAPIRequest", requestData, isStream),
  // 新增: 中断API请求的方法
  cancelAPIRequest: () => ipcRenderer.invoke("ai:abortAPIRequest"),
  // 新增: API配置管理方法
  saveApiConfig: (config) => ipcRenderer.invoke("ai:saveApiConfig", config),
  deleteApiConfig: (configId) =>
    ipcRenderer.invoke("ai:deleteApiConfig", configId),
  setCurrentApiConfig: (configId) =>
    ipcRenderer.invoke("ai:setCurrentApiConfig", configId),
  // 新增: 获取模型列表方法
  fetchModels: (requestData) =>
    ipcRenderer.invoke("ai:fetchModels", requestData),
  // 新增: 保存自定义风险规则
  saveCustomRiskRules: (rules) =>
    ipcRenderer.invoke("ai:saveCustomRiskRules", rules),

  // 记忆文件管理API
  saveMemory: (memory) => ipcRenderer.invoke("memory:save", memory),
  loadMemory: () => ipcRenderer.invoke("memory:load"),
  deleteMemory: () => ipcRenderer.invoke("memory:delete"),

  // 添加事件监听器注册方法
  on: (channel, callback) => {
    const validChannels = ["stream-chunk", "stream-end", "stream-error"];
    if (validChannels.includes(channel)) {
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
    const validChannels = ["stream-chunk", "stream-end", "stream-error"];
    if (validChannels.includes(channel)) {
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
    const validChannels = ["stream-chunk", "stream-end", "stream-error"];
    if (validChannels.includes(channel)) {
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
  getAppVersion: () => ipcRenderer.invoke("app:getVersion"),

  // 关闭应用
  closeApp: () => ipcRenderer.invoke("app:close"),

  // 检查更新
  checkForUpdate: () => ipcRenderer.invoke("app:checkForUpdate"),

  // 文件管理相关API
  listFiles: (tabId, path, options) =>
    ipcRenderer.invoke("listFiles", tabId, path, options),
  onListFilesChunk: (callback) => {
    const wrapped = (_, data) => callback(data);
    ipcRenderer.on("listFiles:chunk", wrapped);
    if (!callback._wrappedCallback) callback._wrappedCallback = wrapped;
    return () => ipcRenderer.removeListener("listFiles:chunk", wrapped);
  },
  offListFilesChunk: (callback) => {
    const wrapped = callback._wrappedCallback || callback;
    ipcRenderer.removeListener("listFiles:chunk", wrapped);
  },
  copyFile: (tabId, sourcePath, targetPath) =>
    ipcRenderer.invoke("copyFile", tabId, sourcePath, targetPath),
  moveFile: (tabId, sourcePath, targetPath) =>
    ipcRenderer.invoke("moveFile", tabId, sourcePath, targetPath),
  deleteFile: (tabId, filePath, isDirectory) =>
    ipcRenderer.invoke("deleteFile", tabId, filePath, isDirectory),
  createFolder: (tabId, folderPath) =>
    ipcRenderer.invoke("createFolder", tabId, folderPath),
  createFile: (tabId, filePath) =>
    ipcRenderer.invoke("createFile", tabId, filePath),
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
    ipcRenderer.on("download-progress", progressListener);

    // 发起下载请求并在完成后移除监听器
    return ipcRenderer.invoke("downloadFile", tabId, remotePath).finally(() => {
      ipcRenderer.removeListener("download-progress", progressListener);
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
    ipcRenderer.on("download-progress", progressListener);

    // 发起批量下载请求并在完成后移除监听器
    return ipcRenderer.invoke("downloadFiles", tabId, files).finally(() => {
      ipcRenderer.removeListener("download-progress", progressListener);
    });
  },
  // 新增API
  openFileInExternalEditor: (tabId, remotePath) =>
    ipcRenderer.invoke("external-editor:open", tabId, remotePath),

  onExternalEditorEvent: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }
    const wrapped = (_, data) => callback(data);
    ipcRenderer.on("external-editor:sync", wrapped);
    if (!callback._wrappedCallback) callback._wrappedCallback = wrapped;
    return () => {
      ipcRenderer.removeListener("external-editor:sync", wrapped);
    };
  },
  offExternalEditorEvent: (callback) => {
    if (!callback) {
      return;
    }
    const wrapped = callback._wrappedCallback || callback;
    ipcRenderer.removeListener("external-editor:sync", wrapped);
  },

  renameFile: (tabId, oldPath, newName) =>
    ipcRenderer.invoke("renameFile", tabId, oldPath, newName),

  // 权限设置API
  setFilePermissions: (tabId, filePath, permissions) =>
    ipcRenderer.invoke("setFilePermissions", tabId, filePath, permissions),
  // 所有者/组设置API
  setFileOwnership: (tabId, filePath, owner, group) =>
    ipcRenderer.invoke("setFileOwnership", tabId, filePath, owner, group),
  getFilePermissions: (tabId, filePath) =>
    ipcRenderer.invoke("getFilePermissions", tabId, filePath),

  // 批量获取文件权限 - 减少 IPC 调用开销
  getFilePermissionsBatch: (tabId, filePaths) =>
    ipcRenderer.invoke("getFilePermissionsBatch", tabId, filePaths),

  // 通用批量 IPC 调用 API
  // 用法: batchInvoke([['channel1', arg1, arg2], ['channel2', arg1]])
  // 返回: [{ success: true, data: result1 }, { success: false, error: 'message' }, ...]
  batchInvoke: (calls) => ipcRenderer.invoke("ipc:batchInvoke", calls),

  uploadFile: (tabId, targetFolder, progressCallback) => {
    // Unique channel for this specific upload
    const progressChannel = `upload-progress-${tabId}-${Date.now()}`;

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
      .invoke("uploadFile", tabId, targetFolder, progressChannel)
      .finally(() => {
        // Ensure listener is removed if invoke fails or completes without progressData signal
        ipcRenderer.removeListener(progressChannel, handler);
      });
  },
  // 创建远程文件夹结构
  createRemoteFolders: (tabId, folderPath) =>
    ipcRenderer.invoke("createRemoteFolders", tabId, folderPath),
  // 新增: 上传文件夹API
  uploadFolder: (tabId, targetFolder, progressCallback) => {
    // Unique channel for this specific upload
    const progressChannel = `upload-folder-progress-${tabId}-${Date.now()}`;

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
      .invoke("upload-folder", tabId, targetFolder, progressChannel)
      .finally(() => {
        // Ensure listener is removed if invoke fails or completes without progressData signal
        ipcRenderer.removeListener(progressChannel, handler);
      });
  },
  // 新增: 上传拖拽文件API (用于文件管理器拖放功能)
  uploadDroppedFiles: (tabId, targetFolder, uploadData, progressCallback) => {
    // Unique channel for this specific upload
    const progressChannel = `upload-dropped-progress-${tabId}-${Date.now()}`;

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
        "uploadDroppedFiles",
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
    ipcRenderer.on("download-folder-progress", progressListener);

    // 发起下载请求并在完成后移除监听器
    return ipcRenderer
      .invoke("downloadFolder", tabId, remoteFolderPath)
      .finally(() => {
        ipcRenderer.removeListener(
          "download-folder-progress",
          progressListener,
        );
      });
  },
  cancelTransfer: (tabId, type) =>
    ipcRenderer.invoke("cancelTransfer", tabId, type),
  getAbsolutePath: (tabId, relativePath) =>
    ipcRenderer.invoke("getAbsolutePath", tabId, relativePath),
  // 添加文件内容读取API
  readFileContent: (tabId, filePath) =>
    ipcRenderer.invoke("readFileContent", tabId, filePath),

  // 新增：保存文件内容API
  saveFileContent: (tabId, filePath, content) =>
    ipcRenderer.invoke("saveFileContent", tabId, filePath, content),

  // 从base64解码读取文件内容
  readFileAsBase64: (tabId, filePath) =>
    ipcRenderer.invoke("readFileAsBase64", tabId, filePath),

  // 在外部浏览器打开链接
  openExternal: (url) => ipcRenderer.invoke("app:openExternal", url),

  // 文件系统辅助API
  checkPathExists: (path) => ipcRenderer.invoke("checkPathExists", path),
  showItemInFolder: (path) => ipcRenderer.invoke("showItemInFolder", path),

  // UI设置相关API
  loadUISettings: () => ipcRenderer.invoke("settings:loadUISettings"),
  saveUISettings: (settings) =>
    ipcRenderer.invoke("settings:saveUISettings", settings),

  // 日志设置相关API
  loadLogSettings: () => ipcRenderer.invoke("settings:loadLogSettings"),
  saveLogSettings: (settings) =>
    ipcRenderer.invoke("settings:saveLogSettings", settings),

  // 性能设置实时更新API
  updateCacheSettings: (settings) =>
    ipcRenderer.invoke("settings:updateCacheSettings", settings),
  updatePrefetchSettings: (settings) =>
    ipcRenderer.invoke("settings:updatePrefetchSettings", settings),

  // 窗口重新加载
  reloadWindow: () => ipcRenderer.invoke("app:reloadWindow"),

  // 窗口控制API
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  getWindowState: () => ipcRenderer.invoke("window:getState"),
  onWindowStateChange: (callback) => {
    if (typeof callback !== "function") {
      return () => {};
    }

    const wrappedCallback = (_event, state) => callback(state);
    ipcRenderer.on("window:state", wrappedCallback);
    return () => ipcRenderer.removeListener("window:state", wrappedCallback);
  },

  // 更新相关API
  downloadUpdate: (downloadUrl) =>
    ipcRenderer.invoke("app:downloadUpdate", downloadUrl),
  installUpdate: (filePath) =>
    ipcRenderer.invoke("app:installUpdate", filePath),
  getDownloadProgress: () => ipcRenderer.invoke("app:getDownloadProgress"),
  cancelDownload: () => ipcRenderer.invoke("app:cancelDownload"),

  // 新增: 通知主进程编辑器模式变化的API
  notifyEditorModeChange: (processId, isEditorMode) =>
    ipcRenderer.invoke(
      "terminal:notifyEditorModeChange",
      processId,
      isEditorMode,
    ),

  // 命令历史相关API
  addToCommandHistory: (command) =>
    ipcRenderer.invoke("command-history:add", command),
  getCommandSuggestions: (input, maxResults) =>
    ipcRenderer.invoke("command-history:getSuggestions", input, maxResults),
  incrementCommandUsage: (command) =>
    ipcRenderer.invoke("command-history:incrementUsage", command),
  clearCommandHistory: () => ipcRenderer.invoke("command-history:clear"),
  getCommandHistoryStatistics: () =>
    ipcRenderer.invoke("command-history:getStatistics"),

  // 新增：历史命令管理API
  getAllCommandHistory: () => ipcRenderer.invoke("command-history:getAll"),
  deleteCommandHistory: (command) =>
    ipcRenderer.invoke("command-history:delete", command),
  deleteCommandHistoryBatch: (commands) =>
    ipcRenderer.invoke("command-history:deleteBatch", commands),

  // 文件缓存管理API
  cleanupFileCache: (cacheFilePath) =>
    ipcRenderer.invoke("cleanupFileCache", cacheFilePath),
  cleanupTabCache: (tabId) => ipcRenderer.invoke("cleanupTabCache", tabId),

  // IP地址查询API
  queryIpAddress: (ip = "") => ipcRenderer.invoke("ip:query", ip),

  // 网络延迟检测API
  registerLatencyDetection: (tabId, host, port) =>
    ipcRenderer.invoke("latency:register", { tabId, host, port }),
  unregisterLatencyDetection: (tabId) =>
    ipcRenderer.invoke("latency:unregister", { tabId }),
  getLatencyInfo: (tabId) => ipcRenderer.invoke("latency:getInfo", { tabId }),
  getAllLatencyInfo: () => ipcRenderer.invoke("latency:getAllInfo"),
  getLatencyServiceStatus: () => ipcRenderer.invoke("latency:getServiceStatus"),
  testLatencyNow: (tabId) => ipcRenderer.invoke("latency:testNow", { tabId }),
  // 延迟事件监听
  onLatencyUpdate: (callback) => {
    const wrappedCallback = (event, data) => callback(event, data);
    ipcRenderer.on("latency:updated", wrappedCallback);
    return () => ipcRenderer.removeListener("latency:updated", wrappedCallback);
  },
  onLatencyError: (callback) => {
    const wrappedCallback = (event, data) => callback(event, data);
    ipcRenderer.on("latency:error", wrappedCallback);
    return () => ipcRenderer.removeListener("latency:error", wrappedCallback);
  },
  onLatencyDisconnected: (callback) => {
    const wrappedCallback = (event, data) => callback(event, data);
    ipcRenderer.on("latency:disconnected", wrappedCallback);
    return () =>
      ipcRenderer.removeListener("latency:disconnected", wrappedCallback);
  },

  // SSH连接相关
  startSSH: (sshConfig) => ipcRenderer.invoke("terminal:startSSH", sshConfig),

  // Telnet连接相关
  startTelnet: (telnetConfig) =>
    ipcRenderer.invoke("terminal:startTelnet", telnetConfig),

  // SSH 认证相关 IPC
  // 监听 SSH 认证请求（主机密钥验证、凭证请求等）
  onSSHAuthRequest: (callback) => {
    if (typeof callback !== "function") return () => {};
    const wrappedCallback = (_, data) => callback(data);
    ipcRenderer.on("ssh:auth-request", wrappedCallback);
    return () => {
      ipcRenderer.removeListener("ssh:auth-request", wrappedCallback);
    };
  },
  offSSHAuthRequest: (callback) => {
    ipcRenderer.removeAllListeners("ssh:auth-request");
  },

  // 响应 SSH 认证请求
  respondSSHAuth: (response) =>
    ipcRenderer.invoke("ssh:auth-response", response),

  // 更新连接配置（用于保存自动登录凭据）
  updateConnectionCredentials: (connectionId, credentials) =>
    ipcRenderer.invoke(
      "terminal:updateConnectionCredentials",
      connectionId,
      credentials,
    ),
});

// SSH密钥生成器API
contextBridge.exposeInMainWorld("electronAPI", {
  // SSH密钥对生成
  generateSSHKeyPair: (options) =>
    ipcRenderer.invoke("generateSSHKeyPair", options),

  // 保存SSH密钥到文件
  saveSSHKey: (options) => ipcRenderer.invoke("saveSSHKey", options),
});

// 文件对话框API
contextBridge.exposeInMainWorld("dialogAPI", {
  // 显示打开文件/目录对话框
  showOpenDialog: (options) =>
    ipcRenderer.invoke("dialog:showOpenDialog", options),

  // 显示保存文件对话框
  showSaveDialog: (options) =>
    ipcRenderer.invoke("dialog:showSaveDialog", options),

  // 显示消息框
  showMessageBox: (options) =>
    ipcRenderer.invoke("dialog:showMessageBox", options),
});

// 应用错误处理API
contextBridge.exposeInMainWorld("appErrorAPI", {
  // 监听应用错误
  onError: (callback) => ipcRenderer.on("app:error", callback),

  // 移除错误监听
  removeErrorListener: () => {
    ipcRenderer.removeAllListeners("app:error");
  },
});

// Clipboard API (Electron 40+ safe access pattern)
contextBridge.exposeInMainWorld("clipboardAPI", {
  readText: async () => clipboard.readText(),
  writeText: async (text) => {
    clipboard.writeText(String(text ?? ""));
    return true;
  },
});
