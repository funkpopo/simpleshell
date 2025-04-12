// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 获取Socket服务器端口
  getSocketPort: () => ipcRenderer.invoke('get-socket-port')
});

// 暴露终端相关API给渲染进程
contextBridge.exposeInMainWorld('terminalAPI', {
  // SSH相关
  startSSH: (config) => ipcRenderer.invoke('start-ssh', config),
  sendToProcess: (processId, data) => ipcRenderer.invoke('send-to-process', processId, data),
  killProcess: (processId) => ipcRenderer.invoke('kill-process', processId),
  resizeTerminal: (processId, cols, rows) => ipcRenderer.invoke('resize-terminal', processId, cols, rows),
  removeOutputListener: (processId) => {
    if (processId) {
      ipcRenderer.removeAllListeners(`process-output-${processId}`);
    } else {
      // 清理所有输出监听器
      const channels = ipcRenderer.eventNames();
      for (const channel of channels) {
        if (channel.startsWith('process-output-')) {
          ipcRenderer.removeAllListeners(channel);
        }
      }
    }
  },
  onProcessOutput: (processId, callback) => {
    const channel = `process-output-${processId}`;
    ipcRenderer.removeAllListeners(channel); // 防止重复监听
    ipcRenderer.on(channel, (_, data) => callback(data));
    return processId;
  },

  // PowerShell相关
  startPowerShell: () => ipcRenderer.invoke('start-powershell'),

  // 连接管理相关
  loadConnections: () => ipcRenderer.invoke('load-connections'),
  saveConnections: (connections) => ipcRenderer.invoke('save-connections', connections),
  
  // 系统信息相关
  getSystemInfo: (tabId) => ipcRenderer.invoke('get-system-info', tabId),
  
  // 应用相关
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  closeApp: () => ipcRenderer.invoke('close-app'),
  
  // 文件选择相关
  selectKeyFile: () => ipcRenderer.invoke('select-key-file'),
  
  // 添加文件保存对话框
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  
  // 添加文件打开对话框
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  
  // 文件管理相关
  listFiles: (tabId, path, options) => ipcRenderer.invoke('list-files', tabId, path, options),
  previewFile: (path, options) => ipcRenderer.invoke('preview-file', path, options),
  
  // 修改文件传输相关API，去除回调函数参数，改用事件监听
  uploadFile: (tabId, srcPath, destPath) => ipcRenderer.invoke('upload-file', tabId, srcPath, destPath),
  uploadFolder: (tabId, srcPath, destPath) => ipcRenderer.invoke('upload-folder', tabId, srcPath, destPath),
  downloadFile: (tabId, remotePath, localPath) => ipcRenderer.invoke('download-file', tabId, remotePath, localPath),
  cancelTransfer: (transferId) => ipcRenderer.invoke('cancel-transfer', transferId),
  
  // 添加文件传输进度事件相关API
  onTransferProgress: (callback) => {
    ipcRenderer.on('transfer-progress', (_, data) => callback(data));
  },
  removeTransferProgressListener: () => {
    ipcRenderer.removeAllListeners('transfer-progress');
  },
  
  deleteFile: (tabId, path, isDirectory) => ipcRenderer.invoke('delete-file', tabId, path, isDirectory),
  renameFile: (tabId, oldPath, newPath) => ipcRenderer.invoke('rename-file', tabId, oldPath, newPath),
  createFolder: (tabId, path) => ipcRenderer.invoke('create-folder', tabId, path),
  createFile: (tabId, path, content) => ipcRenderer.invoke('create-file', tabId, path, content)
});
