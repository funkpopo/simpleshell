declare interface API {
  // SSH相关方法
  sshConnect: (connection: any) => Promise<{ success: boolean; id?: string; error?: string }>;
  sshExec: (params: { connectionId: string; command: string }) => Promise<{ success: boolean; output?: string; error?: string }>;
  sshCreateShell: (options: { connectionId: string; cols: number; rows: number }) => Promise<{ success: boolean; shellId?: string; error?: string }>;
  sshSendInput: (options: { connectionId: string; shellId: string; data: string }) => void;
  sshResizeTerminal: (options: { connectionId: string; shellId: string; cols: number; rows: number }) => void;
  sshCloseShell: (options: { connectionId: string; shellId: string }) => void;
  onSshData: (callback: (event: { connectionId: string; shellId: string; data: string }) => void) => () => void;
  onSshClose: (callback: (event: { connectionId: string; shellId: string }) => void) => () => void;

  // 本地终端相关方法
  createLocalTerminal: (options: { cols: number; rows: number }) => Promise<{ success: boolean; id?: string; error?: string }>;
  sendTerminalInput: (options: { id: string; data: string }) => void;
  resizeTerminal: (options: { id: string; cols: number; rows: number }) => void;
  closeTerminal: (options: { id: string }) => void;
  onTerminalData: (callback: (event: { id: string; data: string }) => void) => () => void;
  
  // 文件操作相关方法
  openFileDialog: (options?: { 
    title?: string; 
    buttonLabel?: string; 
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: string[];
  }) => Promise<{
    canceled: boolean;
    filePath?: string;
    filePaths?: string[];
    fileContent?: string;
    error?: string;
  }>;
  
  // 通用IPC调用
  invoke: (channel: string, ...args: any[]) => Promise<any>;

  // SFTP相关方法
  sftpReadDir: (params: { connectionId: string; path: string }) => Promise<{
    success: boolean;
    files?: Array<{
      name: string;
      type: 'file' | 'directory';
      size: number;
      modifyTime: string;
      permissions: string;
      owner: string;
      group: string;
    }>;
    error?: string;
  }>;
  
  sftpDownloadFile: (params: { connectionId: string; remotePath: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  
  sftpUploadFile: (params: { connectionId: string; localPath: string; remotePath: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  
  sftpMkdir: (params: { connectionId: string; path: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;
  
  sftpDelete: (params: { connectionId: string; path: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;

  sftpGetFileInfo: (params: { connectionId: string; path: string }) => Promise<{
    success: boolean;
    fileInfo?: {
      name: string;
      path: string;
      type: string;
      size: number;
      modifyTime: Date;
      accessTime: Date;
      rights: any;
      owner: string | number;
      group: string | number;
      isSymbolicLink: boolean;
      items?: number;
    };
    error?: string;
  }>;

  cancelTransfer: (params: { transferId: string }) => Promise<{
    success: boolean;
    error?: string;
  }>;

  // 设置相关方法
  loadSettings: () => Promise<{
    language: string;
    fontSize: number;
    fontFamily: string;
  }>;
  saveSettings: (settings: {
    language: string;
    fontSize: number;
    fontFamily: string;
  }) => Promise<boolean>;

  // 文件传输事件监听
  onTransferStart: (callback: (data: {
    id: string;
    type: 'upload' | 'download';
    filename: string;
    path: string;
    size: number;
    connectionId: string;
  }) => void) => () => void;
  
  onTransferProgress: (callback: (data: {
    id: string;
    transferred: number;
    progress: number;
  }) => void) => () => void;
  
  onTransferComplete: (callback: (data: {
    id: string;
    success: boolean;
  }) => void) => () => void;
  
  onTransferError: (callback: (data: {
    id: string;
    error: string;
  }) => void) => () => void;
  
  onTransferCancelled: (callback: (data: {
    id: string;
  }) => void) => () => void;

  // 窗口状态变化监听
  onWindowStateChange: (callback: (data: { isFocused: boolean }) => void) => () => void;

  // AI聊天相关方法
  loadChatHistory: () => Promise<{sessions: any[]}>
  saveChatSession: (session: any) => Promise<{success: boolean, error?: string}>
  deleteHistorySession: (sessionId: string) => Promise<{success: boolean, error?: string}>
  onAppClose: (callback: () => Promise<void>) => void
}

interface Window {
  api: API;
} 