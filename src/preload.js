// Preload script
const { contextBridge, ipcRenderer } = require('electron')

// 暴露安全的 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 配置相关
  readConfig: () => ipcRenderer.invoke('read-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  
  // 监听配置更新
  onConfigUpdate: (callback) => {
    ipcRenderer.on('config-updated', (event, config) => callback(config))
    return () => {
      ipcRenderer.removeListener('config-updated', callback)
    }
  }
}) 