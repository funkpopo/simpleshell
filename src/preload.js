const { contextBridge, ipcRenderer } = require('electron')
const { dialog, app } = require('@electron/remote')

// 预加载性能优化
const startTime = Date.now()

// 预缓存频繁使用的模块
const cachedModules = {
  path: require('path'),
  fs: require('fs'),
  os: require('os')
}

// 优化API暴露
const api = {
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
  // 本地存储 - 使用内存缓存优化
  localStorage: {
    _cache: new Map(),
    getItem: (key) => {
      if (api.localStorage._cache.has(key)) {
        return api.localStorage._cache.get(key)
      }
      const value = localStorage.getItem(key)
      api.localStorage._cache.set(key, value)
      return value
    },
    setItem: (key, value) => {
      localStorage.setItem(key, value)
      api.localStorage._cache.set(key, value)
    },
    removeItem: (key) => {
      localStorage.removeItem(key)
      api.localStorage._cache.delete(key)
    }
  },
  // 进程信息
  process: {
    platform: process.platform,
    env: process.env
  },
  // 后端服务相关
  backend: {
    getPort: () => require('@electron/remote').getGlobal('backendPort')
  },
  // 性能监控
  performance: {
    getStartupTime: () => startTime,
    getCurrentTime: () => Date.now(),
    getLoadTime: () => Date.now() - startTime
  }
}

// 优化上下文桥接
contextBridge.exposeInMainWorld('electronAPI', api)

// 错误处理优化
const errorHandler = (error) => {
  console.error('Uncaught error:', error)
  api.ipcRenderer.send('uncaught-error', {
    message: error.message,
    stack: error.stack,
    time: Date.now()
  })
}

window.addEventListener('error', errorHandler)
window.addEventListener('unhandledrejection', (event) => errorHandler(event.reason))

// 预热完成时间记录
console.log(`Preload completed in ${Date.now() - startTime}ms`)

// 清理未使用的资源
process.nextTick(() => {
  // 清理未使用的缓存
  if (global.gc) {
    global.gc()
  }
}) 