const { safeHandle } = require("../ipcResponse");
const { ipcMain: electronIpcMain } = require("electron");
const TerminalDetector = require("../../local-terminal/terminal-detector");
const LocalTerminalManager = require("../../local-terminal/local-terminal-manager");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
} = require("../schema/channels");

function toSerializableTerminalInfo(terminalInfo) {
  if (!terminalInfo) {
    return null;
  }

  return {
    tabId: terminalInfo.tabId,
    processId: terminalInfo.processId,
    pid: terminalInfo.pid,
    status: terminalInfo.status,
    shell: terminalInfo.shell,
    command: terminalInfo.command,
    args: terminalInfo.args || [],
    cwd: terminalInfo.cwd,
    startedAt: terminalInfo.startedAt,
    config: terminalInfo.config
      ? {
          name: terminalInfo.config.name,
          type: terminalInfo.config.type,
          executable: terminalInfo.config.executable,
          executablePath: terminalInfo.config.executablePath,
          command: terminalInfo.config.command,
          args: terminalInfo.config.args || [],
          cwd: terminalInfo.config.cwd,
          distribution: terminalInfo.config.distribution || null,
        }
      : null,
  };
}

class LocalTerminalHandlers {
  constructor(mainWindow, ipcMain, options = {}) {
    this.mainWindow = mainWindow;
    this.ipcMain = ipcMain || electronIpcMain;
    this.terminalDetector = new TerminalDetector();
    this.terminalManager = new LocalTerminalManager({
      processManager: options.processManager,
      terminalIOMailboxManager: options.terminalIOMailboxManager,
      getMainWindow: () => this.mainWindow,
    });

    this.setupEventListeners();
    this.registerHandlers();
  }

  _sendStatus(payload) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send(
      IPC_EVENT_CHANNELS.LOCAL_TERMINAL_STATUS,
      payload,
    );
  }

  setupEventListeners() {
    this.terminalManager.on("terminalStatus", (payload) => {
      this._sendStatus(payload);
    });

    this.terminalManager.on("terminalError", (data) => {
      this._sendStatus({
        type: "error",
        tabId: data.tabId,
        processId: data.processId,
        error: {
          code: data.error?.code || "LOCAL_TERMINAL_ERROR",
          message: data.error?.message || "Unknown local terminal error",
          shell: data.error?.shell || null,
          command: data.error?.command || null,
          args: data.error?.args || [],
        },
      });
    });
  }

  async startEmbeddedLocalTerminal(_event, localConfig = {}) {
    const tabId = localConfig?.tabId;
    const result = await this.terminalManager.startEmbeddedTerminal(
      localConfig,
      tabId,
      {
        cols: localConfig?.cols,
        rows: localConfig?.rows,
      },
    );

    return {
      success: true,
      data: result,
    };
  }

  registerHandlers() {
    safeHandle(
      this.ipcMain,
      IPC_REQUEST_CHANNELS.LOCAL_TERMINALS_DETECT,
      async (_event, options) => {
        return this.terminalDetector.detectAllTerminals(options);
      },
      { category: "local-terminal" },
    );

    safeHandle(
      this.ipcMain,
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_START_EMBEDDED,
      this.startEmbeddedLocalTerminal.bind(this),
      { category: "local-terminal" },
    );

    safeHandle(
      this.ipcMain,
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_LAUNCH,
      async (_event, terminalConfig, tabId, options = {}) => {
        const localConfig = {
          ...terminalConfig,
          tabId,
          cols: options.cols,
          rows: options.rows,
        };
        const result = await this.terminalManager.startEmbeddedTerminal(
          localConfig,
          tabId,
          options,
        );

        return {
          success: true,
          data: result,
        };
      },
      { category: "local-terminal" },
    );

    safeHandle(
      this.ipcMain,
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_CLOSE,
      async (_event, tabIdOrProcessId) => {
        const closed = await this.terminalManager.closeTerminal(tabIdOrProcessId);
        return { success: true, data: { closed } };
      },
      { category: "local-terminal" },
    );

    safeHandle(
      this.ipcMain,
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_INFO,
      async (_event, tabIdOrProcessId) => {
        const terminalInfo =
          this.terminalManager.getActiveTerminal(tabIdOrProcessId);
        return {
          success: true,
          data: toSerializableTerminalInfo(terminalInfo),
        };
      },
      { category: "local-terminal" },
    );

    safeHandle(
      this.ipcMain,
      IPC_REQUEST_CHANNELS.LOCAL_TERMINAL_GET_ALL_ACTIVE,
      async () => {
        return {
          success: true,
          data: this.terminalManager
            .getAllActiveTerminals()
            .map(toSerializableTerminalInfo),
        };
      },
      { category: "local-terminal" },
    );
  }

  async cleanup() {
    try {
      await this.terminalManager.cleanup();
    } catch (error) {
      console.error("Error during local terminal cleanup:", error);
    }
  }
}

module.exports = LocalTerminalHandlers;
