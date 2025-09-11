// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require("electron");

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld("terminalAPI", {
  // 发送命令到主进程处理 (用于模拟终端)
  sendCommand: (command) => ipcRenderer.invoke("terminal:command", command),

  // 终端进程管理
  startCmd: (args) => ipcRenderer.invoke("terminal:startCmd", args),
  startBash: (args) => ipcRenderer.invoke("terminal:startBash", args),
  startSSH: (args) => ipcRenderer.invoke("terminal:startSSH", args),
  startBatchSSH: (args) => ipcRenderer.invoke("terminal:startBatchSSH", args),
  onProcessData: (callback) => ipcRenderer.on("terminal:processData", callback),
  onResizeTerminal: (callback) =>
    ipcRenderer.on("terminal:resizeTerminal", callback),
  onProcessCompletion: (callback) =>
    ipcRenderer.on("terminal:processCompletion", callback),
  onProcessExit: (callback) => ipcRenderer.on("terminal:processExit", callback),
  onSshConnectionUpdated: (callback) =>
    ipcRenderer.on("terminal:sshConnectionUpdated", callback),
  removeProcessListeners: () => {
    ipcRenderer.removeAllListeners("terminal:processData");
    ipcRenderer.removeAllListeners("terminal:resizeTerminal");
    ipcRenderer.removeAllListeners("terminal:processCompletion");
    ipcRenderer.removeAllListeners("terminal:processExit");
    ipcRenderer.removeAllListeners("terminal:sshConnectionUpdated");
  },
  sendToProcess: (processId, data) =>
    ipcRenderer.invoke("terminal:sendToProcess", processId, data),
  setTerminalSize: (processId, cols, rows) =>
    ipcRenderer.invoke("terminal:setTerminalSize", processId, cols, rows),
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

  // 兼容旧版API
  onOutput: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("terminal:output", listener);
    return () => {
      ipcRenderer.removeListener("terminal:output", listener);
    };
  },

  removeOutputListener: (processId) => {
    if (processId) {
      ipcRenderer.removeAllListeners(`process:output:${processId}`);
    } else {
      ipcRenderer.removeAllListeners("terminal:output");
    }
  },

  // 连接配置存储API
  loadConnections: () => ipcRenderer.invoke("terminal:loadConnections"),
  saveConnections: (connections) =>
    ipcRenderer.invoke("terminal:saveConnections", connections),
  loadTopConnections: () => ipcRenderer.invoke("terminal:loadTopConnections"),

  // 连接配置变化事件监听
  onConnectionsChanged: (callback) => {
    const wrappedCallback = () => callback();
    ipcRenderer.on("connections-changed", wrappedCallback);
    return () => {
      ipcRenderer.removeListener("connections-changed", wrappedCallback);
    };
  },
  offConnectionsChanged: (callback) => {
    const wrappedCallback = () => callback();
    ipcRenderer.removeListener("connections-changed", wrappedCallback);
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
  // 添加事件监听器注册方法
  on: (channel, callback) => {
    const validChannels = ["stream-chunk", "stream-end", "stream-error"];
    if (validChannels.includes(channel)) {
      // 包装回调函数，确保正确传递数据
      const wrappedCallback = (event, data) => {
        callback(event, data);
      };
      ipcRenderer.on(channel, wrappedCallback);
      // 存储原始回调和包装回调的映射，用于后续移除
      if (!callback._wrappedCallback) {
        callback._wrappedCallback = wrappedCallback;
      }
    }
  },
  // 添加off方法作为removeListener的别名
  off: (channel, callback) => {
    const validChannels = ["stream-chunk", "stream-end", "stream-error"];
    if (validChannels.includes(channel)) {
      // 使用包装的回调函数进行移除
      const wrappedCallback = callback._wrappedCallback || callback;
      ipcRenderer.removeListener(channel, wrappedCallback);
    }
  },
  // 添加事件监听器移除方法
  removeListener: (channel, callback) => {
    const validChannels = ["stream-chunk", "stream-end", "stream-error"];
    if (validChannels.includes(channel)) {
      // 使用包装的回调函数进行移除
      const wrappedCallback = callback._wrappedCallback || callback;
      ipcRenderer.removeListener(channel, wrappedCallback);
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
  // 新增API
  renameFile: (tabId, oldPath, newName) =>
    ipcRenderer.invoke("renameFile", tabId, oldPath, newName),

  // 权限设置API
  setFilePermissions: (tabId, filePath, permissions) =>
    ipcRenderer.invoke("setFilePermissions", tabId, filePath, permissions),
  getFilePermissions: (tabId, filePath) =>
    ipcRenderer.invoke("getFilePermissions", tabId, filePath),

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

  // 新增: 写入pty的方法
  writePty: (data) => ipcRenderer.invoke("terminal:writePty", data),

  // 新增: 调整pty大小的方法
  resizePty: (size) => ipcRenderer.invoke("terminal:resizePty", size),

  // 新增: 复制剪贴板的方法
  copyClipboard: (text) => ipcRenderer.invoke("clipboard:copy", text),

  // 新增: 粘贴剪贴板的方法
  pasteClipboard: () => ipcRenderer.invoke("clipboard:paste"),

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
