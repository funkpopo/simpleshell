import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // 获取系统信息
  getSystemInfo: async (): Promise<any> => {
    return await ipcRenderer.invoke('get-system-info')
  },
  
  // 加载连接配置
  loadConnections: async (): Promise<any> => {
    return await ipcRenderer.invoke('load-connections')
  },
  
  // 保存连接配置
  saveConnections: async (organizations: any): Promise<boolean> => {
    return await ipcRenderer.invoke('save-connections', organizations)
  },
  
  // 打开文件选择对话框
  openFileDialog: async (options?: { title?: string; buttonLabel?: string; defaultPath?: string }): Promise<any> => {
    return await ipcRenderer.invoke('open-file-dialog', options)
  },
  
  // SSH连接相关
  sshConnect: async (connectionInfo: any): Promise<any> => {
    return await ipcRenderer.invoke('ssh:connect', connectionInfo)
  },
  
  // 创建SSH Shell
  sshCreateShell: async (params: { connectionId: string, cols: number, rows: number }): Promise<any> => {
    return await ipcRenderer.invoke('ssh:shell', params)
  },
  
  // 发送SSH输入
  sshSendInput: (params: { connectionId: string, shellId: string, data: string }): void => {
    ipcRenderer.send('ssh:input', params)
  },
  
  // 调整SSH终端大小
  sshResizeTerminal: (params: { connectionId: string, shellId: string, cols: number, rows: number }): void => {
    ipcRenderer.send('ssh:resize', params)
  },
  
  // 关闭SSH Shell
  sshCloseShell: (params: { connectionId: string, shellId: string }): void => {
    ipcRenderer.send('ssh:close-shell', params)
  },
  
  // 断开SSH连接
  sshDisconnect: (params: { connectionId: string }): void => {
    ipcRenderer.send('ssh:disconnect', params)
  },
  
  // 执行SSH命令
  sshExec: async (params: { connectionId: string, command: string }): Promise<any> => {
    return await ipcRenderer.invoke('ssh:exec', params)
  },
  
  // 本地终端相关
  createLocalTerminal: async (params: { cols: number, rows: number }): Promise<any> => {
    return await ipcRenderer.invoke('terminal:create', params)
  },
  
  // 发送终端输入
  sendTerminalInput: (params: { id: string, data: string }): void => {
    ipcRenderer.send('terminal:input', params)
  },
  
  // 调整终端大小
  resizeTerminal: (params: { id: string, cols: number, rows: number }): void => {
    ipcRenderer.send('terminal:resize', params)
  },
  
  // 关闭终端
  closeTerminal: (params: { id: string }): void => {
    ipcRenderer.send('terminal:close', params)
  },
  
  // 事件监听
  onSshData: (callback: (data: any) => void): () => void => {
    const listener = (_: any, data: any) => callback(data)
    ipcRenderer.on('ssh:data', listener)
    return () => {
      ipcRenderer.removeListener('ssh:data', listener)
    }
  },
  
  onSshClose: (callback: (data: any) => void): () => void => {
    const listener = (_: any, data: any) => callback(data)
    ipcRenderer.on('ssh:close', listener)
    return () => {
      ipcRenderer.removeListener('ssh:close', listener)
    }
  },
  
  // 终端数据监听
  onTerminalData: (callback: (data: any) => void): (() => void) => {
    // 为每个回调创建唯一标识符，用于调试
    const callbackId = Date.now().toString() + Math.floor(Math.random() * 1000);
    
    console.log(`准备注册终端数据监听器 ID: ${callbackId}`);
    
    const listener = (_: any, data: any) => {
      if (data && data.id) {
        // 验证终端ID格式
        if (typeof data.id === 'string' && data.id.startsWith('term_')) {
          console.log(`监听器[${callbackId}]收到终端[${data.id}]数据`);
          
          // 调用回调前检查数据完整性
          if (data.data && typeof data.data === 'string') {
            callback(data);
          } else {
            console.error(`监听器[${callbackId}]收到的终端[${data.id}]数据无效:`, typeof data.data);
          }
        } else {
          console.warn(`监听器[${callbackId}]收到非标准格式的终端ID[${data.id}]`);
          callback(data); // 仍然传递数据以兼容旧格式
        }
      } else {
        console.error(`监听器[${callbackId}]收到无效的终端数据:`, data);
      }
    };
    
    ipcRenderer.on('terminal:data', listener);
    console.log(`已注册终端数据监听器: ${callbackId}`);
    
    return () => {
      console.log(`准备移除终端数据监听器: ${callbackId}`);
      ipcRenderer.removeListener('terminal:data', listener);
      console.log(`已移除终端数据监听器: ${callbackId}`);
    };
  },
  
  // 通用IPC调用方法
  invoke: async (channel: string, ...args: any[]): Promise<any> => {
    return await ipcRenderer.invoke(channel, ...args)
  },
  
  // 窗口状态监听（焦点变化等）
  onWindowStateChange: (callback: (data: { isFocused: boolean }) => void): (() => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('window:state-change', handler)
    return () => {
      ipcRenderer.removeListener('window:state-change', handler)
    }
  },
  
  // SFTP相关方法
  sftpReadDir: async (params: { connectionId: string; path: string }): Promise<any> => {
    return await ipcRenderer.invoke('sftp:readDir', params)
  },
  
  sftpDownloadFile: async (params: { connectionId: string; remotePath: string }): Promise<any> => {
    return await ipcRenderer.invoke('sftp:downloadFile', params)
  },
  
  sftpUploadFile: async (params: { connectionId: string; localPath: string; remotePath: string }): Promise<any> => {
    return await ipcRenderer.invoke('sftp:uploadFile', params)
  },
  
  sftpMkdir: async (params: { connectionId: string; path: string }): Promise<any> => {
    return await ipcRenderer.invoke('sftp:mkdir', params)
  },
  
  sftpDelete: async (params: { connectionId: string; path: string }): Promise<any> => {
    return await ipcRenderer.invoke('sftp:delete', params)
  },
  
  // 获取文件或文件夹的详细信息
  sftpGetFileInfo: async (params: { connectionId: string; path: string }): Promise<any> => {
    return await ipcRenderer.invoke('sftp:getFileInfo', params)
  },
  
  // 取消文件传输
  cancelTransfer: async (params: { transferId: string }): Promise<any> => {
    return await ipcRenderer.invoke('sftp:cancelTransfer', params)
  },
  
  // 加载设置
  loadSettings: () => ipcRenderer.invoke('load-settings'),
  
  // 保存设置
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  
  // 监听设置变更
  onSettingsChanged: (callback: (settings: any) => void) => {
    const handler = (_: any, settings: any) => callback(settings)
    ipcRenderer.on('settings-saved', handler)
    return () => ipcRenderer.removeListener('settings-saved', handler)
  },
  
  // 文件传输事件监听
  onTransferStart: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('sftp:transferStart', handler)
    return () => ipcRenderer.removeListener('sftp:transferStart', handler)
  },
  
  onTransferProgress: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('sftp:transferProgress', handler)
    return () => ipcRenderer.removeListener('sftp:transferProgress', handler)
  },
  
  onTransferComplete: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('sftp:transferComplete', handler)
    return () => ipcRenderer.removeListener('sftp:transferComplete', handler)
  },
  
  onTransferError: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('sftp:transferError', handler)
    return () => ipcRenderer.removeListener('sftp:transferError', handler)
  },
  
  onTransferCancelled: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('sftp:transferCancelled', handler)
    return () => ipcRenderer.removeListener('sftp:transferCancelled', handler)
  },
  
  // AI聊天相关方法
  loadChatHistory: async (): Promise<any> => {
    return await ipcRenderer.invoke('chat:load-history')
  },
  
  saveChatSession: async (session: any): Promise<any> => {
    return await ipcRenderer.invoke('chat:save-session', session)
  },
  
  deleteHistorySession: async (sessionId: string): Promise<any> => {
    return await ipcRenderer.invoke('chat:delete-session', sessionId)
  },
  
  // 注册窗口关闭事件监听
  onAppClose: (callback: () => Promise<void>): void => {
    // 创建一个函数，用于在窗口关闭前触发回调
    const handleBeforeUnload = async () => {
      await callback()
    }
    
    // 添加窗口关闭前的事件监听
    window.addEventListener('beforeunload', handleBeforeUnload)
    
    // 不需要返回取消函数，因为这个是应用级别的事件
  },
  
  // 获取lexer规则文件
  getLexerFile: async (lexerType: string) => {
    try {
      return await ipcRenderer.invoke('get-lexer-file', lexerType)
    } catch (error: any) {
      console.error('获取lexer规则文件失败:', error)
      return { success: false, error: error.message || '未知错误' }
    }
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

// 应用设置到页面
function applySettings(settings: any) {
  if (!settings) {
    console.error('无法应用设置：设置对象为空')
    return
  }
  
  console.log('正在应用设置:', JSON.stringify(settings))
  
  try {
    // 应用字体大小 - 设置为CSS变量以便全局使用
    if (settings.fontSize) {
      console.log(`应用字体大小: ${settings.fontSize}px`)
      // 基础字号设置到根元素
      document.documentElement.style.setProperty('--base-font-size', `${settings.fontSize}px`)
      // 不同元素根据基础字号计算比例
      document.documentElement.style.setProperty('--large-font-size', `${settings.fontSize * 1.2}px`)
      document.documentElement.style.setProperty('--small-font-size', `${settings.fontSize * 0.85}px`)
      
      // 直接设置文档字号
      document.documentElement.style.fontSize = `${settings.fontSize}px`
      document.body.style.fontSize = `${settings.fontSize}px`
    }
    
    // 应用字体族
    if (settings.fontFamily) {
      console.log(`应用字体: ${settings.fontFamily}`)
      document.documentElement.style.setProperty('--base-font-family', settings.fontFamily)
      document.documentElement.style.fontFamily = settings.fontFamily
      document.body.style.fontFamily = settings.fontFamily
    }
    
    // 应用语言设置 - 这可以通过i18n库来处理
    if (settings.language) {
      console.log(`应用语言: ${settings.language}`)
      document.documentElement.setAttribute('lang', settings.language)
      
      // 通过自定义事件通知应用语言变更
      const event = new CustomEvent('language-changed', { detail: settings.language })
      document.dispatchEvent(event)
    }
    
    console.log('设置应用完成')
  } catch (error) {
    console.error('应用设置时出错:', error)
  }
}

// 监听设置更新事件并应用
ipcRenderer.on('settings-saved', (_event, settings) => {
  console.log('收到设置更新:', settings)
  applySettings(settings)
})

// 初始加载时应用设置
ipcRenderer.invoke('load-settings').then((settings) => {
  if (settings) {
    console.log('初始加载设置:', settings)
    applySettings(settings)
  }
})
