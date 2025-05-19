// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require("electron");

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld("terminalAPI", {
  // 发送命令到主进程处理 (用于模拟终端)
  sendCommand: (command) => ipcRenderer.invoke("terminal:command", command),

  // PowerShell进程管理
  startPowerShell: (args) =>
    ipcRenderer.invoke("terminal:startPowerShell", args),
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

  // 资源监控API
  getSystemInfo: (processId) =>
    ipcRenderer.invoke("terminal:getSystemInfo", processId),

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
  abortAPIRequest: () => ipcRenderer.invoke("ai:abortAPIRequest"),
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
      ipcRenderer.on(channel, callback);
    }
  },
  // 添加事件监听器移除方法
  removeListener: (channel, callback) => {
    const validChannels = ["stream-chunk", "stream-end", "stream-error"];
    if (validChannels.includes(channel)) {
      ipcRenderer.removeListener(channel, callback);
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
          data.transferredBytes || 0,
          data.totalBytes || 0,
          data.transferSpeed,
          data.remainingTime,
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
  uploadFile: (tabId, targetFolder, progressCallback) => {
    // 注册一个临时的进度监听器
    const progressListener = (_, data) => {
      if (data.tabId === tabId && typeof progressCallback === "function") {
        // 确保传递所有必要的参数给回调函数
        progressCallback(
          data.progress || 0,
          data.fileName || "",
          data.transferredBytes || 0,
          data.totalBytes || 0,
          data.transferSpeed,
          data.remainingTime,
          data.currentFileIndex,
          data.totalFiles,
        );
      }
    };

    // 添加进度事件监听器
    ipcRenderer.on("upload-progress", progressListener);

    // 发起上传请求并在完成后移除监听器
    return ipcRenderer.invoke("uploadFile", tabId, targetFolder).finally(() => {
      ipcRenderer.removeListener("upload-progress", progressListener);
    });
  },
  // 新增: 上传文件夹API
  uploadFolder: (tabId, targetFolder, progressCallback) => {
    // 注册一个临时的进度监听器
    const progressListener = (_, data) => {
      if (data.tabId === tabId && typeof progressCallback === "function") {
        // 确保传递所有必要的参数给回调函数
        progressCallback(
          data.progress || 0,
          data.fileName || "",
          data.currentFile || "",
          data.transferredBytes || 0,
          data.totalBytes || 0,
          data.transferSpeed,
          data.remainingTime,
          data.processedFiles || 0,
          data.totalFiles || 0,
        );
      }
    };

    // 添加进度事件监听器
    ipcRenderer.on("upload-folder-progress", progressListener);

    // 发起上传请求并在完成后移除监听器
    return ipcRenderer
      .invoke("uploadFolder", tabId, targetFolder)
      .finally(() => {
        ipcRenderer.removeListener("upload-folder-progress", progressListener);
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
          data.transferSpeed,
          data.remainingTime,
          data.processedFiles || 0,
          data.totalFiles || 0,
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

  // 窗口重新加载
  reloadWindow: () => ipcRenderer.invoke("app:reloadWindow"),

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
});
