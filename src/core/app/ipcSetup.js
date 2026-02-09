const { ipcMain } = require("electron");
const { logToFile } = require("../utils/logger");
const { safeHandle } = require("../ipc/ipcResponse");
const { registerReconnectHandlers } = require("../ipc/handlers/reconnectHandlers");
const { registerBatchHandlers } = require("../ipc/handlers/batchHandlers");
const { registerBatchInvokeHandlers } = require("../ipc/handlers/batchInvokeHandlers");
const LatencyHandlers = require("../ipc/handlers/latencyHandlers");
const LocalTerminalHandlers = require("../ipc/handlers/localTerminalHandlers");
const SettingsHandlers = require("../ipc/handlers/settingsHandlers");
const AppHandlers = require("../ipc/handlers/appHandlers");
const DialogHandlers = require("../ipc/handlers/dialogHandlers");
const WindowHandlers = require("../ipc/handlers/windowHandlers");
const SSHHandlers = require("../ipc/handlers/sshHandlers");
const ProxyHandlers = require("../ipc/handlers/proxyHandlers");
const TerminalHandlers = require("../ipc/handlers/terminalHandlers");
const AIHandlers = require("../ipc/handlers/aiHandlers");
const FileHandlers = require("../ipc/handlers/fileHandlers");
const SftpHandlers = require("../ipc/handlers/sftpHandlers");
const UtilityHandlers = require("../ipc/handlers/utilityHandlers");
const ConnectionHandlers = require("../ipc/handlers/connectionHandlers");
const SshKeyHandlers = require("../ipc/handlers/sshKeyHandlers");
const MemoryHandlers = require("../ipc/handlers/memoryHandlers");
const ExternalEditorHandlers = require("../ipc/handlers/externalEditorHandlers");
const configService = require("../../services/configService");
const processManager = require("../process/processManager");
const connectionManager = require("../../modules/connection");
const sftpCore = require("../transfer/sftp-engine");
const sftpTransfer = require("../../modules/sftp/sftpTransfer");

/**
 * IPC设置模块
 * 负责注册所有IPC处理器
 */
class IPCSetup {
  constructor() {
    this.latencyHandlers = null;
    this.localTerminalHandlers = null;
    this.sshHandlers = null;
    this.terminalHandlers = null;
  }

  /**
   * 获取延迟处理器实例
   */
  getLatencyHandlers() {
    return this.latencyHandlers;
  }

  /**
   * 获取本地终端处理器实例
   */
  getLocalTerminalHandlers() {
    return this.localTerminalHandlers;
  }

  /**
   * 注册重连处理器
   */
  registerReconnectHandlers() {
    try {
      registerReconnectHandlers(connectionManager.sshConnectionPool);
      logToFile("重连处理器已注册", "INFO");
    } catch (error) {
      logToFile(`重连处理器注册失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 注册批量IPC处理器
   */
  registerBatchHandlers() {
    try {
      registerBatchHandlers(ipcMain);
      logToFile("IPC批量消息处理器已注册", "INFO");
    } catch (error) {
      logToFile(`IPC批量消息处理器注册失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化延迟处理器
   */
  initializeLatencyHandlers() {
    try {
      this.latencyHandlers = new LatencyHandlers();
      const handlers = this.latencyHandlers.getHandlers();

      handlers.forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });

      logToFile(`已注册 ${handlers.length} 个延迟检测IPC处理器`, "INFO");
    } catch (error) {
      logToFile(`延迟检测服务初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 注册关键IPC处理器（在窗口创建前）
   */
  registerCriticalHandlers() {
    try {
      // 注册设置处理器
      const settingsHandlers = new SettingsHandlers();
      settingsHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("Settings handlers registered", "INFO");

      // 注册应用处理器
      const appHandlers = new AppHandlers();
      appHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("App handlers registered", "INFO");

      // 注册对话框处理器
      const dialogHandlers = new DialogHandlers();
      dialogHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("Dialog handlers registered", "INFO");

      // 注册窗口处理器
      const windowHandlers = new WindowHandlers();
      windowHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("Window handlers registered", "INFO");

      // 注册代理处理器
      const proxyHandlers = new ProxyHandlers();
      proxyHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("Proxy handlers registered", "INFO");

      // 注册基本终端处理器
      this.registerBasicTerminalHandlers();

      logToFile("Critical IPC handlers registered before window creation", "INFO");
    } catch (error) {
      logToFile(`Failed to register critical IPC handlers: ${error.message}`, "ERROR");
    }
  }

  /**
   * 注册基本终端处理器
   */
  registerBasicTerminalHandlers() {
    safeHandle(ipcMain, "terminal:loadConnections", async () => {
      return configService.loadConnections();
    });

    safeHandle(ipcMain, "terminal:loadTopConnections", async () => {
      try {
        return configService.loadLastConnections();
      } catch (e) {
        return [];
      }
    });

    safeHandle(ipcMain, "terminal:getSystemInfo", async (event, processId) => {
      try {
        const systemInfo = require("../../modules/system-info");
        if (!processId || !processManager.hasProcess(processId)) {
          return await systemInfo.getLocalSystemInfo();
        } else {
          const processObj = processManager.getProcess(processId);
          if (
            (processObj.type === "ssh2" || processObj.type === "ssh") &&
            (processObj.process || processObj.client || processObj.channel)
          ) {
            const sshClient =
              processObj.client || processObj.process || processObj.channel;
            if (
              !sshClient ||
              (sshClient._readableState && sshClient._readableState.ended) ||
              (sshClient._sock &&
                (!sshClient._sock.readable || !sshClient._sock.writable))
            ) {
              logToFile(
                `SSH connection not available for process ${processId}, falling back to local system info`,
                "WARN"
              );
              return await systemInfo.getLocalSystemInfo();
            }
            return systemInfo.getRemoteSystemInfo(sshClient);
          } else {
            return await systemInfo.getLocalSystemInfo();
          }
        }
      } catch (error) {
        logToFile(`Failed to get system info: ${error.message}`, "ERROR");
        try {
          const systemInfo = require("../../modules/system-info");
          return await systemInfo.getLocalSystemInfo();
        } catch (fallbackError) {
          return {
            error: "获取系统信息失败",
            message: error.message,
          };
        }
      }
    });

    safeHandle(ipcMain, "terminal:getProcessList", async (event, processId) => {
      try {
        const systemInfo = require("../../modules/system-info");
        if (!processId || !processManager.hasProcess(processId)) {
          return systemInfo.getProcessList();
        } else {
          const processObj = processManager.getProcess(processId);
          if (
            (processObj.type === "ssh2" || processObj.type === "ssh") &&
            (processObj.process || processObj.client || processObj.channel)
          ) {
            const sshClient =
              processObj.client || processObj.process || processObj.channel;
            if (
              !sshClient ||
              (sshClient._readableState && sshClient._readableState.ended) ||
              (sshClient._sock &&
                (!sshClient._sock.readable || !sshClient._sock.writable))
            ) {
              logToFile(
                `SSH connection not available for process ${processId}, falling back to local process list`,
                "WARN"
              );
              return systemInfo.getProcessList();
            }
            return systemInfo.getRemoteProcessList(sshClient);
          } else {
            return systemInfo.getProcessList();
          }
        }
      } catch (error) {
        logToFile(`Failed to get process list: ${error.message}`, "ERROR");
        try {
          const systemInfo = require("../../modules/system-info");
          return systemInfo.getProcessList();
        } catch (fallbackError) {
          return {
            error: "获取进程列表失败",
            message: error.message,
          };
        }
      }
    });
  }

  /**
   * 初始化本地终端处理器
   */
  initializeLocalTerminalHandlers(mainWindow) {
    try {
      this.localTerminalHandlers = new LocalTerminalHandlers(mainWindow, ipcMain);
      logToFile("本地终端处理器初始化成功", "INFO");
    } catch (error) {
      logToFile(`本地终端处理器初始化失败: ${error.message}`, "ERROR");
      logToFile(`Stack: ${error.stack}`, "ERROR");
    }
  }

  /**
   * 初始化SSH/Telnet处理器
   */
  initializeSSHHandlers() {
    try {
      this.sshHandlers = new SSHHandlers({
        childProcesses: processManager.getProcessMap(),
        connectionManager,
        sftpCore,
        sftpTransfer,
        getNextProcessId: () => processManager.getNextProcessId(),
        getLatencyHandlers: () => this.latencyHandlers,
      });
      this.sshHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("SSH/Telnet handlers registered", "INFO");
    } catch (error) {
      logToFile(`SSH/Telnet处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化终端处理器
   */
  initializeTerminalHandlers() {
    try {
      this.terminalHandlers = new TerminalHandlers({
        processManager,
        connectionManager,
        sftpCore,
        getLatencyHandlers: () => this.latencyHandlers,
      });
      this.terminalHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      // 注册事件类型处理器（使用ipcMain.on）
      if (typeof this.terminalHandlers.getEventHandlers === "function") {
        this.terminalHandlers.getEventHandlers().forEach(({ channel, handler }) => {
          ipcMain.on(channel, handler);
        });
      }
      logToFile("Terminal handlers registered", "INFO");
    } catch (error) {
      logToFile(`终端处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化AI处理器
   */
  initializeAIHandlers() {
    try {
      const aiHandlers = new AIHandlers();
      aiHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("AI handlers registered", "INFO");
    } catch (error) {
      logToFile(`AI处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化文件处理器
   */
  initializeFileHandlers() {
    try {
      const fileHandlers = new FileHandlers();
      fileHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("File handlers registered", "INFO");
    } catch (error) {
      logToFile(`文件处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化SFTP处理器
   */
  initializeSftpHandlers() {
    try {
      const sftpHandlers = new SftpHandlers();
      sftpHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("SFTP handlers registered", "INFO");
    } catch (error) {
      logToFile(`SFTP处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化实用工具处理器
   */
  initializeUtilityHandlers() {
    try {
      const utilityHandlers = new UtilityHandlers();
      utilityHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("Utility handlers registered", "INFO");
    } catch (error) {
      logToFile(`实用工具处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化连接状态处理器
   */
  initializeConnectionHandlers() {
    try {
      const connectionHandlers = new ConnectionHandlers();
      connectionHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("Connection handlers registered", "INFO");
    } catch (error) {
      logToFile(`连接状态处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化SSH密钥处理器
   */
  initializeSshKeyHandlers() {
    try {
      const sshKeyHandlers = new SshKeyHandlers();
      sshKeyHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("SSH key handlers registered", "INFO");
    } catch (error) {
      logToFile(`SSH密钥处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化记忆处理器
   */
  initializeMemoryHandlers() {
    try {
      const memoryHandlers = new MemoryHandlers();
      memoryHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("Memory handlers registered", "INFO");
    } catch (error) {
      logToFile(`记忆处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化外部编辑器处理器
   */
  initializeExternalEditorHandlers() {
    try {
      const externalEditorHandlers = new ExternalEditorHandlers();
      externalEditorHandlers.getHandlers().forEach(({ channel, handler }) => {
        safeHandle(ipcMain, channel, handler);
      });
      logToFile("External editor handlers registered", "INFO");
    } catch (error) {
      logToFile(`外部编辑器处理器初始化失败: ${error.message}`, "ERROR");
    }
  }

  /**
   * 在应用启动时执行的初始化（在窗口创建前）
   */
  initializeBeforeWindow() {
    this.registerReconnectHandlers();
    this.registerBatchHandlers();
    registerBatchInvokeHandlers(ipcMain, safeHandle);
    this.initializeLatencyHandlers();
    this.registerCriticalHandlers();
    this.initializeSSHHandlers();
    this.initializeTerminalHandlers();
    this.initializeAIHandlers();
    this.initializeFileHandlers();
    this.initializeSftpHandlers();
    this.initializeUtilityHandlers();
    this.initializeConnectionHandlers();
    this.initializeSshKeyHandlers();
    this.initializeMemoryHandlers();
    this.initializeExternalEditorHandlers();
  }

  /**
   * 清理延迟处理器
   */
  cleanupLatencyHandlers() {
    if (this.latencyHandlers) {
      try {
        this.latencyHandlers.cleanup();
        logToFile("延迟检测服务已清理", "INFO");
      } catch (error) {
        logToFile(`延迟检测服务清理失败: ${error.message}`, "ERROR");
      }
    }
  }

  /**
   * 清理本地终端处理器
   */
  async cleanupLocalTerminalHandlers() {
    if (this.localTerminalHandlers) {
      try {
        await this.localTerminalHandlers.cleanup();
        logToFile("本地终端处理器已清理", "INFO");
      } catch (error) {
        logToFile(`本地终端处理器清理失败: ${error.message}`, "ERROR");
      }
    }
  }

  /**
   * 清理所有资源
   */
  async cleanup() {
    this.cleanupLatencyHandlers();
    await this.cleanupLocalTerminalHandlers();
  }
}

// 创建单例实例
const ipcSetup = new IPCSetup();

module.exports = ipcSetup;
