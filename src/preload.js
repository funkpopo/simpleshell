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
  },
  // 添加快捷键事件监听器
  onToggleAIAssistant: (callback) => {
    const handler = (event) => {
      console.log('AI Assistant toggle event received in preload')
      try {
        setTimeout(() => {
          callback()
        }, 0)
      } catch (error) {
        console.error('Error in AI Assistant toggle handler:', error)
      }
    }
    ipcRenderer.removeAllListeners('toggle-ai-assistant')
    ipcRenderer.on('toggle-ai-assistant', handler)
    return () => {
      console.log('Removing AI Assistant toggle listener')
      ipcRenderer.removeListener('toggle-ai-assistant', handler)
    }
  },
  onToggleTools: (callback) => {
    const handler = (event) => {
      console.log('Tools toggle event received in preload')
      try {
        setTimeout(() => {
          callback()
        }, 0)
      } catch (error) {
        console.error('Error in Tools toggle handler:', error)
      }
    }
    ipcRenderer.removeAllListeners('toggle-tools')
    ipcRenderer.on('toggle-tools', handler)
    return () => {
      console.log('Removing Tools toggle listener')
      ipcRenderer.removeListener('toggle-tools', handler)
    }
  }
})

// 错误处理
window.addEventListener('error', (event) => {
  console.error('Uncaught error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
}) 