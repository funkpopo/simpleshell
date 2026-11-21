const { ipcMain } = require("electron");
const { logToFile } = require("../utils/logger");
const { safeHandle, safeOn } = require("../ipc/ipcResponse");
const {
  registerReconnectHandlers,
} = require("../ipc/handlers/reconnectHandlers");
const BatchInvokeHandlers = require("../ipc/handlers/batchInvokeHandlers");
const SystemInfoHandlers = require("../ipc/handlers/systemInfoHandlers");
const LatencyHandlers = require("../ipc/handlers/latencyHandlers");
const LocalTerminalHandlers = require("../ipc/handlers/localTerminalHandlers");
const SettingsHandlers = require("../ipc/handlers/settingsHandlers");
const AppHandlers = require("../ipc/handlers/appHandlers");
const DialogHandlers = require("../ipc/handlers/dialogHandlers");
const WindowHandlers = require("../ipc/handlers/windowHandlers");
const SSHHandlers = require("../ipc/handlers/sshHandlers");
const TerminalHandlers = require("../ipc/handlers/terminalHandlers");
const AIHandlers = require("../ipc/handlers/aiHandlers");
const FileHandlers = require("../ipc/handlers/fileHandlers");
const SftpHandlers = require("../ipc/handlers/sftpHandlers");
const UtilityHandlers = require("../ipc/handlers/utilityHandlers");
const ConnectionHandlers = require("../ipc/handlers/connectionHandlers");
const SshKeyHandlers = require("../ipc/handlers/sshKeyHandlers");
const SshConfigHandlers = require("../ipc/handlers/sshConfigHandlers");
const MemoryHandlers = require("../ipc/handlers/memoryHandlers");
const ExternalEditorHandlers = require("../ipc/handlers/externalEditorHandlers");
const RuntimeFileHandlers = require("../ipc/handlers/runtimeFileHandlers");
const PortForwardingHandlers = require("../ipc/handlers/portForwardingHandlers");
const ConfigTransferHandlers = require("../ipc/handlers/configTransferHandlers");
const TerminalIOMailboxManager = require("../terminal/terminalIOMailboxManager");
const processManager = require("../process/processManager");
const diskAlertService = require("../services/diskAlertService");
const connectionManager = require("../connection/connectionManager");
const { getPrimaryWindow } = require("../window/windowManager");

// 关键处理器模块（在窗口创建前由 registerCriticalHandlers 统一注册）
const CRITICAL_HANDLER_MODULES = [
  {
    HandlersClass: SettingsHandlers,
    successLog: "Settings handlers registered",
  },
  { HandlersClass: AppHandlers, successLog: "App handlers registered" },
  { HandlersClass: DialogHandlers, successLog: "Dialog handlers registered" },
  { HandlersClass: WindowHandlers, successLog: "Window handlers registered" },
  {
    HandlersClass: SystemInfoHandlers,
    successLog: "System info handlers registered",
  },
  {
    HandlersClass: BatchInvokeHandlers,
    successLog: "Batch invoke handlers registered",
  },
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
    HandlersClass: SshConfigHandlers,
    successLog: "SSH config import handlers registered",
    errorLabel: "Failed to initialize SSH config import handlers",
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
  {
    HandlersClass: PortForwardingHandlers,
    successLog: "Port forwarding handlers registered",
    errorLabel: "Failed to initialize port forwarding handlers",
  },
  {
    HandlersClass: ConfigTransferHandlers,
    successLog: "Config transfer handlers registered",
    errorLabel: "Failed to initialize config transfer handlers",
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
   * 初始化本地终端处理器
   */
  initializeLocalTerminalHandlers(mainWindow) {
    // ipcMain.handle 不允许重复注册：窗口重建（macOS activate）时只更新目标窗口
    if (this.localTerminalHandlers) {
      this.localTerminalHandlers.setMainWindow(mainWindow);
      logToFile("Local terminal handlers attached to new window", "INFO");
      return;
    }
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
    this.initializeLatencyHandlers();
    this.registerCriticalHandlers();
    this.initializeSSHHandlers();
    this.initializeTerminalHandlers();
    BOILERPLATE_HANDLER_MODULES.forEach((module) => {
      this.initializeHandlerModule(module);
    });
    // 磁盘空间告警（内部有启动延迟，不阻塞窗口创建）
    diskAlertService.start();
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
    try {
      diskAlertService.stop();
    } catch (error) {
      logToFile(`Failed to stop disk alert service: ${error.message}`, "WARN");
    }
    this.cleanupLatencyHandlers();
    await this.cleanupLocalTerminalHandlers();
  }
}

// 创建单例实例
const ipcSetup = new IPCSetup();

module.exports = ipcSetup;
