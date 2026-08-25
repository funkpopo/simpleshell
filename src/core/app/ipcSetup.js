const { ipcMain } = require("electron");
const { t: translateLocale, getUiLanguage } = require("../../shared/mainI18n");
const configServiceForI18n = require("../../services/configService");
const systemInfoText = (key) =>
  translateLocale(key, { lng: getUiLanguage(configServiceForI18n) });
const { logToFile } = require("../utils/logger");
const { safeHandle, safeOn } = require("../ipc/ipcResponse");
const { IPC_REQUEST_CHANNELS } = require("../ipc/schema/channels");
const {
  registerReconnectHandlers,
} = require("../ipc/handlers/reconnectHandlers");
const { registerBatchHandlers } = require("../ipc/handlers/batchHandlers");
const {
  registerBatchInvokeHandlers,
} = require("../ipc/handlers/batchInvokeHandlers");
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
const RuntimeFileHandlers = require("../ipc/handlers/runtimeFileHandlers");
const TerminalIOMailboxManager = require("../terminal/terminalIOMailboxManager");
const configService = require("../../services/configService");
const processManager = require("../process/processManager");
const connectionManager = require("../../modules/connection");
const { getPrimaryWindow } = require("../window/windowManager");
const { isSshClientUsable } = require("../utils/ssh-utils");

// 关键处理器模块（在窗口创建前由 registerCriticalHandlers 统一注册）
const CRITICAL_HANDLER_MODULES = [
  {
    HandlersClass: SettingsHandlers,
    successLog: "Settings handlers registered",
  },
  { HandlersClass: AppHandlers, successLog: "App handlers registered" },
  { HandlersClass: DialogHandlers, successLog: "Dialog handlers registered" },
  { HandlersClass: WindowHandlers, successLog: "Window handlers registered" },
  { HandlersClass: ProxyHandlers, successLog: "Proxy handlers registered" },
];

// 纯样板处理器模块（new Class → getHandlers().forEach(safeHandle) → 日志）
const BOILERPLATE_HANDLER_MODULES = [
  {
    HandlersClass: AIHandlers,
    successLog: "AI handlers registered",
    errorLabel: "Failed to initialize AI handlers",
  },
  {
    HandlersClass: FileHandlers,
    successLog: "File handlers registered",
    errorLabel: "Failed to initialize file handlers",
  },
  {
    HandlersClass: SftpHandlers,
    successLog: "SFTP handlers registered",
    errorLabel: "Failed to initialize SFTP handlers",
  },
  {
    HandlersClass: UtilityHandlers,
    successLog: "Utility handlers registered",
    errorLabel: "Failed to initialize utility handlers",
  },
  {
    HandlersClass: ConnectionHandlers,
    successLog: "Connection handlers registered",
    errorLabel: "Failed to initialize connection status handlers",
  },
  {
    HandlersClass: SshKeyHandlers,
    successLog: "SSH key handlers registered",
    errorLabel: "Failed to initialize SSH key handlers",
  },
  {
    HandlersClass: MemoryHandlers,
    successLog: "Memory handlers registered",
    errorLabel: "Failed to initialize memory handlers",
  },
  {
    HandlersClass: ExternalEditorHandlers,
    successLog: "External editor handlers registered",
    errorLabel: "Failed to initialize external editor handlers",
  },
  {
    HandlersClass: RuntimeFileHandlers,
    successLog: "Runtime file lifecycle handlers registered",
    errorLabel: "Failed to initialize runtime file lifecycle handlers",
  },
];

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
    this.terminalIOMailboxManager = new TerminalIOMailboxManager({
      getMainWindow: () => getPrimaryWindow(),
    });
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
      logToFile("Reconnect handlers registered", "INFO");
    } catch (error) {
      logToFile(
        `Failed to register reconnect handlers: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 注册批量IPC处理器
   */
  registerBatchHandlers() {
    try {
      registerBatchHandlers(ipcMain);
      logToFile("IPC batch handlers registered", "INFO");
    } catch (error) {
      logToFile(
        `Failed to register IPC batch handlers: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 将处理器实例的所有handler注册到ipcMain
   */
  _registerHandlerInstance(handlersInstance) {
    handlersInstance.getHandlers().forEach(({ channel, category, handler }) => {
      safeHandle(ipcMain, channel, handler, { category });
    });
  }

  /**
   * 通用样板处理器模块初始化（new → 注册 → 日志）
   */
  initializeHandlerModule({ HandlersClass, successLog, errorLabel }) {
    try {
      this._registerHandlerInstance(new HandlersClass());
      logToFile(successLog, "INFO");
    } catch (error) {
      logToFile(`${errorLabel}: ${error.message}`, "ERROR");
    }
  }

  /**
   * 初始化延迟处理器
   */
  initializeLatencyHandlers() {
    try {
      this.latencyHandlers = new LatencyHandlers();
      const handlers = this.latencyHandlers.getHandlers();

      handlers.forEach(({ channel, category, handler }) => {
        safeHandle(ipcMain, channel, handler, { category });
      });

      logToFile(`Registered ${handlers.length} latency IPC handlers`, "INFO");
    } catch (error) {
      logToFile(
        `Failed to initialize latency service: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 注册关键IPC处理器（在窗口创建前）
   */
  registerCriticalHandlers() {
    try {
      CRITICAL_HANDLER_MODULES.forEach(({ HandlersClass, successLog }) => {
        this._registerHandlerInstance(new HandlersClass());
        logToFile(successLog, "INFO");
      });

      // 注册基本终端处理器
      this.registerBasicTerminalHandlers();

      logToFile(
        "Critical IPC handlers registered before window creation",
        "INFO",
      );
    } catch (error) {
      logToFile(
        `Failed to register critical IPC handlers: ${error.message}`,
        "ERROR",
      );
    }
  }

  /**
   * 创建"本地/远程二选一"的系统信息类处理器
   * TERMINAL_GET_SYSTEM_INFO 与 TERMINAL_GET_PROCESS_LIST 除最终调用的函数外逻辑一致
   */
  _createRemoteAwareInfoHandler({
    getLocal,
    getRemote,
    awaitLocal,
    fallbackTarget,
    failureSubject,
    getFailureMessage,
  }) {
    // awaitLocal 保持与原实现一致：
    // TERMINAL_GET_SYSTEM_INFO 原实现 `return await getLocalSystemInfo()`（本地调用的拒绝会被捕获并降级），
    // TERMINAL_GET_PROCESS_LIST 原实现 `return getProcessList()`（拒绝直接向调用方传播）。
    return async (event, processId) => {
      try {
        const systemInfo = require("../../modules/system-info");
        if (!processId || !processManager.hasProcess(processId)) {
          return awaitLocal ? await getLocal(systemInfo) : getLocal(systemInfo);
        } else {
          const processObj = processManager.getProcess(processId);
          if (
            (processObj.type === "ssh2" || processObj.type === "ssh") &&
            (processObj.process || processObj.client || processObj.channel)
          ) {
            const sshClient =
              processObj.client || processObj.process || processObj.channel;
            if (!isSshClientUsable(sshClient)) {
              logToFile(
                `SSH connection not available for process ${processId}, falling back to ${fallbackTarget}`,
                "WARN",
              );
              return awaitLocal
                ? await getLocal(systemInfo)
                : getLocal(systemInfo);
            }
            return getRemote(systemInfo, sshClient);
          } else {
            return awaitLocal
              ? await getLocal(systemInfo)
              : getLocal(systemInfo);
          }
        }
      } catch (error) {
        logToFile(`Failed to get ${failureSubject}: ${error.message}`, "ERROR");
        try {
          const systemInfo = require("../../modules/system-info");
          return awaitLocal ? await getLocal(systemInfo) : getLocal(systemInfo);
        } catch {
          return {
            error:
              typeof getFailureMessage === "function"
                ? getFailureMessage()
                : getFailureMessage,
            message: error.message,
          };
        }
      }
    };
  }

  /**
   * 注册基本终端处理器
   */
  registerBasicTerminalHandlers() {
    safeHandle(
      ipcMain,
      IPC_REQUEST_CHANNELS.TERMINAL_LOAD_CONNECTIONS,
      async () => {
        return configService.loadConnections();
      },
      { category: "terminal" },
    );

    safeHandle(
      ipcMain,
      IPC_REQUEST_CHANNELS.TERMINAL_GET_CONNECTION_PASSWORD,
      async (event, connectionId) => {
        void event;
        return configService.getSavedConnectionPassword(connectionId);
      },
      { category: "terminal" },
    );

    safeHandle(
      ipcMain,
      IPC_REQUEST_CHANNELS.TERMINAL_LOAD_TOP_CONNECTIONS,
      async () => {
        try {
          return configService.loadLastConnections();
        } catch {
          return [];
        }
      },
      { category: "terminal" },
    );

    safeHandle(
      ipcMain,
      IPC_REQUEST_CHANNELS.TERMINAL_GET_SYSTEM_INFO,
      this._createRemoteAwareInfoHandler({
        getLocal: (systemInfo) => systemInfo.getLocalSystemInfo(),
        getRemote: (systemInfo, sshClient) =>
          systemInfo.getRemoteSystemInfo(sshClient),
        awaitLocal: true,
        fallbackTarget: "local system info",
        failureSubject: "system info",
        getFailureMessage: () =>
          systemInfoText("mainProcess.systemInfo.getSystemInfoFailed"),
      }),
      { category: "terminal" },
    );

    safeHandle(
      ipcMain,
      IPC_REQUEST_CHANNELS.TERMINAL_GET_PROCESS_LIST,
      this._createRemoteAwareInfoHandler({
        getLocal: (systemInfo) => systemInfo.getProcessList(),
        getRemote: (systemInfo, sshClient) =>
          systemInfo.getRemoteProcessList(sshClient),
        awaitLocal: false,
        fallbackTarget: "local process list",
        failureSubject: "process list",
        getFailureMessage: () =>
          systemInfoText("mainProcess.systemInfo.getProcessListFailed"),
      }),
      { category: "terminal" },
    );
  }

  /**
   * 初始化本地终端处理器
   */
  initializeLocalTerminalHandlers(mainWindow) {
    try {
      this.localTerminalHandlers = new LocalTerminalHandlers(
        mainWindow,
        ipcMain,
        {
          processManager,
          terminalIOMailboxManager: this.terminalIOMailboxManager,
        },
      );
      logToFile("Local terminal handlers initialized", "INFO");
    } catch (error) {
      logToFile(
        `Failed to initialize local terminal handlers: ${error.message}`,
        "ERROR",
      );
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
        getNextProcessId: () => processManager.getNextProcessId(),
        getLatencyHandlers: () => this.latencyHandlers,
        terminalIOMailboxManager: this.terminalIOMailboxManager,
      });
      this._registerHandlerInstance(this.sshHandlers);
      logToFile("SSH/Telnet handlers registered", "INFO");
    } catch (error) {
      logToFile(
        `Failed to initialize SSH/Telnet handlers: ${error.message}`,
        "ERROR",
      );
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
        getLatencyHandlers: () => this.latencyHandlers,
        terminalIOMailboxManager: this.terminalIOMailboxManager,
      });
      this._registerHandlerInstance(this.terminalHandlers);
      // 注册事件类型处理器（使用ipcMain.on）
      if (typeof this.terminalHandlers.getEventHandlers === "function") {
        this.terminalHandlers
          .getEventHandlers()
          .forEach(({ channel, category, handler }) => {
            safeOn(ipcMain, channel, handler, { category });
          });
      }
      logToFile("Terminal handlers registered", "INFO");
    } catch (error) {
      logToFile(
        `Failed to initialize terminal handlers: ${error.message}`,
        "ERROR",
      );
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
    BOILERPLATE_HANDLER_MODULES.forEach((module) => {
      this.initializeHandlerModule(module);
    });
  }

  /**
   * 清理延迟处理器
   */
  cleanupLatencyHandlers() {
    if (this.latencyHandlers) {
      try {
        this.latencyHandlers.cleanup();
        logToFile("Latency service cleaned up", "INFO");
      } catch (error) {
        logToFile(
          `Failed to clean up latency service: ${error.message}`,
          "ERROR",
        );
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
        logToFile("Local terminal handlers cleaned up", "INFO");
      } catch (error) {
        logToFile(
          `Failed to clean up local terminal handlers: ${error.message}`,
          "ERROR",
        );
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
