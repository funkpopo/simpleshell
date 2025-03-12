import { ElectronAPI } from '@electron-toolkit/preload'

interface SystemInfo {
  osInfo: {
    platform: string
    release: string
    arch: string
  }
  cpuInfo: {
    usage: number
    model: string
    cores: number
  }
  memoryInfo: {
    total: number
    free: number
    used: number
    usedPercentage: number
  }
}

interface SSHConnectResult {
  success: boolean
  id?: string
  error?: string
}

interface SSHShellResult {
  success: boolean
  shellId?: string
  error?: string
}

interface SSHDataEvent {
  connectionId: string
  shellId: string
  data: string
}

interface SSHCloseEvent {
  connectionId: string
  shellId: string
}

interface TerminalResult {
  success: boolean
  id?: string
  error?: string
}

interface TerminalDataEvent {
  id: string
  data: string
}

interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  description?: string
}

interface Organization {
  id: string
  name: string
  connections: Connection[]
}

interface GlobalSettings {
  language: string
  fontSize: number
  fontFamily: string
  terminalFontFamily: string
  terminalFontSize: number
}

interface API {
  getSystemInfo(): Promise<SystemInfo>
  loadConnections(): Promise<Organization[]>
  saveConnections(organizations: Organization[]): Promise<boolean>
  openFileDialog(options?: { 
    title?: string; 
    buttonLabel?: string; 
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
    properties?: string[];
  }): Promise<{
    canceled: boolean;
    filePath?: string;
    filePaths?: string[];
    fileContent?: string;
    error?: string;
  }>
  sshConnect(connectionInfo: Connection): Promise<SSHConnectResult>
  sshCreateShell(params: { connectionId: string, cols: number, rows: number }): Promise<SSHShellResult>
  sshSendInput(params: { connectionId: string, shellId: string, data: string }): void
  sshResizeTerminal(params: { connectionId: string, shellId: string, cols: number, rows: number }): void
  sshCloseShell(params: { connectionId: string, shellId: string }): void
  sshDisconnect(params: { connectionId: string }): void
  sshExec(params: { connectionId: string, command: string }): Promise<{
    success: boolean
    output?: string
    error?: string
  }>
  createLocalTerminal(params: { cols: number, rows: number }): Promise<TerminalResult>
  sendTerminalInput(params: { id: string, data: string }): void
  resizeTerminal(params: { id: string, cols: number, rows: number }): void
  closeTerminal(params: { id: string }): void
  onSshData(callback: (data: SSHDataEvent) => void): () => void
  onSshClose(callback: (data: SSHCloseEvent) => void): () => void
  onTerminalData(callback: (data: TerminalDataEvent) => void): () => void
  sftpReadDir(params: { connectionId: string; path: string }): Promise<{
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
  
  sftpDownloadFile(params: { connectionId: string; remotePath: string }): Promise<{
    success: boolean;
    error?: string;
  }>;
  
  sftpUploadFile(params: { connectionId: string; localPath: string; remotePath: string }): Promise<{
    success: boolean;
    error?: string;
  }>;
  
  sftpMkdir(params: { connectionId: string; path: string }): Promise<{
    success: boolean;
    error?: string;
  }>;
  
  sftpDelete(params: { connectionId: string; path: string }): Promise<{
    success: boolean;
    error?: string;
  }>;
  
  sftpGetFileInfo(params: { connectionId: string; path: string }): Promise<{
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
  
  cancelTransfer(params: { transferId: string }): Promise<{
    success: boolean;
    error?: string;
  }>;
  
  loadSettings: () => Promise<GlobalSettings>
  saveSettings: (settings: GlobalSettings) => Promise<boolean>
  
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
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
