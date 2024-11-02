const { contextBridge, ipcRenderer } = require('electron')
const { dialog, app } = require('@electron/remote')

// 暴露必要的 API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // IPC 通信
  ipcRenderer: {
    send: (channel, data) => {
      ipcRenderer.send(channel, data)
    },
    on: (channel, func) => {
      ipcRenderer.on(channel, (event, ...args) => func(...args))
    },
    invoke: (channel, data) => {
      return ipcRenderer.invoke(channel, data)
    },
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel)
    }
  },
  // 对话框
  dialog: {
    showOpenDialog: (options) => dialog.showOpenDialog(options),
    showSaveDialog: (options) => dialog.showSaveDialog(options),
    showMessageBox: (options) => dialog.showMessageBox(options)
  },
  // 应用程序相关
  app: {
    getPath: (name) => app.getPath(name),
    getVersion: () => app.getVersion()
  },
  // 本地存储
  localStorage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key)
  },
  // 进程信息
  process: {
    platform: process.platform,
    env: process.env
  }
})

// 错误处理
window.addEventListener('error', (event) => {
  console.error('Uncaught error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
}) 