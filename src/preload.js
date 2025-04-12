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
  selectKeyFile: () => ipcRenderer.invoke('select-key-file')
});
