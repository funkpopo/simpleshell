declare interface API {
  // SSH相关方法
  sshConnect: (connection: {
    host: string
    port: number
    username: string
    password?: string
    privateKey?: string
    passphrase?: string
  }) => Promise<{ success: boolean; id?: string; error?: string }>
  sshExec: (params: {
    connectionId: string
    command: string
  }) => Promise<{ success: boolean; output?: string; error?: string }>
  sshCreateShell: (options: {
    connectionId: string
    cols: number
    rows: number
  }) => Promise<{ success: boolean; shellId?: string; error?: string }>
  sshSendInput: (options: { connectionId: string; shellId: string; data: string }) => void
  sshResizeTerminal: (options: {
    connectionId: string
    shellId: string
    cols: number
    rows: number
  }) => void
  sshCloseShell: (options: { connectionId: string; shellId: string }) => void
  onSshData: (
    callback: (event: { connectionId: string; shellId: string; data: string }) => void
  ) => () => void
  onSshClose: (callback: (event: { connectionId: string; shellId: string }) => void) => () => void

  // 本地终端相关方法
  createLocalTerminal: (options: {
    cols: number
    rows: number
  }) => Promise<{ success: boolean; id?: string; error?: string }>
  sendTerminalInput: (options: { id: string; data: string }) => void
  resizeTerminal: (options: { id: string; cols: number; rows: number }) => void
  closeTerminal: (options: { id: string }) => void
  onTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void

  // 文件操作相关方法
  openFileDialog: (options?: {
    title?: string
    buttonLabel?: string
    defaultPath?: string
    filters?: Array<{ name: string; extensions: string[] }>
    properties?: string[]
  }) => Promise<{
    canceled: boolean
    filePath?: string
    filePaths?: string[]
    fileContent?: string
    error?: string
  }>

  // 通用IPC调用
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>

  // SFTP相关方法
  sftpReadDir: (params: { connectionId: string; path: string }) => Promise<{
    success: boolean
    files?: Array<{
      name: string
      type: 'file' | 'directory'
      size: number
      modifyTime: string
      permissions: string
      owner: string
      group: string
    }>
    error?: string
  }>

  sftpDownloadFile: (params: { connectionId: string; remotePath: string }) => Promise<{
    success: boolean
    error?: string
  }>

  sftpUploadFile: (params: {
    connectionId: string
    localPath: string
    remotePath: string
  }) => Promise<{
    success: boolean
    error?: string
  }>

  sftpUploadFiles: (params: {
    connectionId: string
    localPaths: string[]
    remotePath: string
  }) => Promise<{
    success: boolean
    failedFiles?: string[]
    error?: string
  }>

  sftpMkdir: (params: { connectionId: string; path: string }) => Promise<{
    success: boolean
    error?: string
  }>

  sftpDelete: (params: { connectionId: string; path: string }) => Promise<{
    success: boolean
    error?: string
  }>

  sftpGetFileInfo: (params: { connectionId: string; path: string }) => Promise<{
    success: boolean
    fileInfo?: {
      name: string
      path: string
      type: string
      size: number
      modifyTime: Date
      accessTime: Date
      rights: {
        user: string
        group: string
        other: string
        [key: string]: string | unknown
      }
      owner: string | number
      group: string | number
      isSymbolicLink: boolean
      items?: number
    }
    error?: string
  }>

  cancelTransfer: (params: { transferId: string }) => Promise<{
    success: boolean
    error?: string
  }>

  // 设置相关方法
  loadSettings: () => Promise<{
    language: string
    fontSize: number
    fontFamily: string
    terminalFontFamily?: string
    terminalFontSize?: number
    aiSettings?: {
      apiUrl?: string
      apiKey?: string
      modelName?: string
    }
    aiApis?: Array<{
      id: string
      name: string
      apiUrl: string
      apiKey: string
      modelName: string
    }>
    sshKeepAlive?: {
      enabled: boolean
      interval: number
    }
  }>
  saveSettings: (settings: {
    language: string
    fontSize: number
    fontFamily: string
    terminalFontFamily?: string
    terminalFontSize?: number
    aiSettings?: {
      apiUrl?: string
      apiKey?: string
      modelName?: string
    }
    aiApis?: Array<{
      id: string
      name: string
      apiUrl: string
      apiKey: string
      modelName: string
    }>
    sshKeepAlive?: {
      enabled: boolean
      interval: number
    }
  }) => Promise<boolean>

  // 文件传输事件监听
  onTransferStart: (
    callback: (data: {
      id: string
      type: 'upload' | 'download'
      filename: string
      path: string
      size: number
      connectionId: string
    }) => void
  ) => () => void

  onTransferProgress: (
    callback: (data: { id: string; transferred: number; progress: number }) => void
  ) => () => void

  onTransferComplete: (callback: (data: { id: string; success: boolean }) => void) => () => void

  onTransferError: (callback: (data: { id: string; error: string }) => void) => () => void

  onTransferCancelled: (callback: (data: { id: string }) => void) => () => void

  // 窗口状态变化监听
  onWindowStateChange: (callback: (data: { isFocused: boolean }) => void) => () => void

  // AI聊天相关方法
  loadChatHistory: () => Promise<{
    sessions: Array<{
      id: string
      title: string
      preview: string
      timestamp: number
      messages: Array<{
        type: 'user' | 'assistant'
        content: string
        timestamp: number
      }>
    }>
  }>
  saveChatSession: (session: {
    id: string
    title: string
    preview: string
    timestamp: number
    messages: Array<{
      type: 'user' | 'assistant'
      content: string
      timestamp: number
    }>
  }) => Promise<{ success: boolean; error?: string }>
  
  // 发送AI请求
  sendAIRequest: (params: {
    prompt: string
    messages: Array<{ role: string; content: string }>
    apiKey?: string
    apiUrl?: string
    modelName?: string
    stream?: boolean
  }) => Promise<{
    success: boolean
    content?: string
    error?: string
  }>
  
  // 流式输出事件监听
  onAIStreamUpdate?: (callback: (data: { chunk: string }) => void) => () => void
  
  onAppClose: (callback: () => Promise<void>) => void

  // 代理管理
  setManualProxy: (params: { host: string; port: number; type: 'http' | 'socks' }) => Promise<{ success: boolean; error?: string }>
  clearManualProxy: () => Promise<{ success: boolean; error?: string }>
  getManualProxy: () => Promise<{ proxy: { host: string; port: number; type: string } | null }>
}

interface Window {
  api: API
}
