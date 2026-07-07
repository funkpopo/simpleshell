const EventEmitter = require("events");
const pty = require("node-pty");
const { getTerminalProcessExitChannel } = require("../ipc/schema/channels");
const { logToFile } = require("../utils/logger");
const {
  isSupportedLocalTerminalType,
  normalizeLocalTerminalConfig,
} = require("./local-terminal-config");

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function normalizeDimension(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 1) {
    return fallback;
  }
  return Math.floor(numericValue);
}

function serializeError(error, config = {}) {
  return {
    code: error?.code || "LOCAL_TERMINAL_START_FAILED",
    message: error?.message || "Failed to start local terminal",
    shell: config.name || null,
    command: config.command || null,
    args: Array.isArray(config.args) ? config.args : [],
  };
}

class LocalTerminalManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.activeTerminals = new Map();
    this.processManager = options.processManager;
    this.terminalIOMailboxManager = options.terminalIOMailboxManager;
    this.getMainWindow =
      typeof options.getMainWindow === "function"
        ? options.getMainWindow
        : () => null;
  }

  _getNextProcessId() {
    if (
      this.processManager &&
      typeof this.processManager.getNextProcessId === "function"
    ) {
      return this.processManager.getNextProcessId();
    }
    return `local-${Date.now()}`;
  }

  _emitStatus(type, payload = {}) {
    this.emit("terminalStatus", {
      type,
      ...payload,
    });
  }

  _registerProcess(processId, tabId, ptyProcess, config, metadata) {
    if (!this.processManager) {
      return;
    }

    const processInfo = {
      type: "local-pty",
      process: ptyProcess,
      processId,
      tabId,
      config: {
        ...config,
        tabId,
      },
      commandBuffer: "",
      editorMode: false,
      isRemote: false,
      ready: true,
      localTerminal: true,
      metadata,
    };

    this.processManager.setProcess(processId, processInfo);
    if (tabId && tabId !== processId) {
      this.processManager.setProcess(tabId, processInfo);
    }
    if (typeof this.processManager.setTerminalProcess === "function") {
      this.processManager.setTerminalProcess(tabId || processId, processInfo);
    }
  }

  _deleteProcessAliases(processId, tabId) {
    if (!this.processManager) {
      return;
    }

    this.processManager.deleteProcess(processId);
    if (tabId && tabId !== processId) {
      this.processManager.deleteProcess(tabId);
    }
    if (
      tabId &&
      typeof this.processManager.deleteTerminalProcess === "function"
    ) {
      this.processManager.deleteTerminalProcess(tabId);
    }
  }

  _createMailbox(processId, tabId, ptyProcess) {
    if (!this.terminalIOMailboxManager) {
      return null;
    }

    return this.terminalIOMailboxManager.createMailbox(processId, {
      aliases: tabId ? [tabId] : [],
      getFlowControlTarget: () => ptyProcess,
      applyResize: (cols, rows) => {
        if (!ptyProcess || typeof ptyProcess.resize !== "function") {
          return false;
        }
        ptyProcess.resize(
          normalizeDimension(cols, DEFAULT_COLS),
          normalizeDimension(rows, DEFAULT_ROWS),
        );
        return true;
      },
    });
  }

  _sendExitEvent(processId, exitCode, signal) {
    const mainWindow = this.getMainWindow();
    const exitChannel = getTerminalProcessExitChannel(processId);
    if (!mainWindow || mainWindow.isDestroyed() || !exitChannel) {
      return;
    }

    mainWindow.webContents.send(exitChannel, {
      code: exitCode,
      signal: signal || null,
      processId,
      terminalType: "local",
    });
  }

  _getActiveByProcessId(processId) {
    for (const terminalInfo of this.activeTerminals.values()) {
      if (terminalInfo.processId === processId || terminalInfo.tabId === processId) {
        return terminalInfo;
      }
    }
    return null;
  }

  async startEmbeddedTerminal(localConfig = {}, tabId, options = {}) {
    const normalizedConfig = normalizeLocalTerminalConfig(localConfig);
    const normalizedTabId =
      tabId || localConfig.tabId || normalizedConfig.tabId || `local-${Date.now()}`;

    if (!isSupportedLocalTerminalType(normalizedConfig.type, process.platform)) {
      const error = new Error(
        `Unsupported local terminal type: ${normalizedConfig.type}`,
      );
      error.code = "LOCAL_TERMINAL_UNSUPPORTED_TYPE";
      throw error;
    }

    const processId = this._getNextProcessId();
    const cols = normalizeDimension(options.cols, DEFAULT_COLS);
    const rows = normalizeDimension(options.rows, DEFAULT_ROWS);
    const startedAt = Date.now();

    this._emitStatus("starting", {
      tabId: normalizedTabId,
      processId,
      shell: normalizedConfig.name,
      command: normalizedConfig.command,
      args: normalizedConfig.args,
    });

    let ptyProcess;
    try {
      ptyProcess = pty.spawn(normalizedConfig.command, normalizedConfig.args, {
        name: options.name || "xterm-256color",
        cols,
        rows,
        cwd: normalizedConfig.cwd,
        env: normalizedConfig.env,
      });
    } catch (error) {
      const serializedError = serializeError(error, normalizedConfig);
      this._emitStatus("error", {
        tabId: normalizedTabId,
        processId,
        error: serializedError,
      });
      throw Object.assign(error, serializedError);
    }

    const metadata = {
      processId,
      tabId: normalizedTabId,
      pid: ptyProcess.pid,
      status: "ready",
      shell: normalizedConfig.name,
      command: normalizedConfig.command,
      args: normalizedConfig.args,
      cwd: normalizedConfig.cwd,
      startedAt,
    };
    const mailbox = this._createMailbox(processId, normalizedTabId, ptyProcess);
    const terminalInfo = {
      ...metadata,
      config: normalizedConfig,
      process: ptyProcess,
      mailbox,
    };

    this.activeTerminals.set(normalizedTabId, terminalInfo);
    this._registerProcess(
      processId,
      normalizedTabId,
      ptyProcess,
      normalizedConfig,
      metadata,
    );

    ptyProcess.onData((data) => {
      if (mailbox) {
        mailbox.emitOutput(data);
        return;
      }
      this.terminalIOMailboxManager?.emitOutput(processId, data);
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      terminalInfo.status = "exited";
      mailbox?.emitOutput(
        `\r\n\x1b[33mProcess exited with code ${exitCode ?? ""}\x1b[0m\r\n`,
        { trackBackpressure: false },
      );
      mailbox?.destroy();
      this.activeTerminals.delete(normalizedTabId);
      this._deleteProcessAliases(processId, normalizedTabId);
      this._sendExitEvent(processId, exitCode, signal);
      this._emitStatus("exit", {
        tabId: normalizedTabId,
        processId,
        pid: ptyProcess.pid,
        exitCode,
        signal: signal || null,
      });
      this.emit("terminalExited", {
        tabId: normalizedTabId,
        processId,
        code: exitCode,
        signal: signal || null,
      });
    });

    this._emitStatus("ready", metadata);
    this.emit("terminalReady", metadata);
    return metadata;
  }

  async launchTerminal(terminalConfig, tabId, options = {}) {
    return this.startEmbeddedTerminal(terminalConfig, tabId, options);
  }

  async closeTerminal(identifier) {
    const terminalInfo =
      this.activeTerminals.get(identifier) || this._getActiveByProcessId(identifier);

    if (!terminalInfo) {
      return false;
    }

    try {
      terminalInfo.status = "closing";
      if (
        terminalInfo.process &&
        typeof terminalInfo.process.kill === "function"
      ) {
        terminalInfo.process.kill();
      }
      terminalInfo.mailbox?.destroy();
      this.activeTerminals.delete(terminalInfo.tabId);
      this._deleteProcessAliases(terminalInfo.processId, terminalInfo.tabId);
      this._emitStatus("exit", {
        tabId: terminalInfo.tabId,
        processId: terminalInfo.processId,
        pid: terminalInfo.pid,
        exitCode: null,
        signal: "closed",
      });
      this.emit("terminalClosed", {
        tabId: terminalInfo.tabId,
        processId: terminalInfo.processId,
      });
      return true;
    } catch (error) {
      logToFile(`Error closing local terminal: ${error.message}`, "ERROR");
      this._emitStatus("error", {
        tabId: terminalInfo.tabId,
        processId: terminalInfo.processId,
        error: serializeError(error, terminalInfo.config),
      });
      return false;
    }
  }

  getActiveTerminals() {
    return Array.from(this.activeTerminals.values()).map((info) => ({
      tabId: info.tabId,
      processId: info.processId,
      pid: info.pid,
      status: info.status,
      type: info.config.type,
      shell: info.shell,
      cwd: info.cwd,
      startedAt: info.startedAt,
    }));
  }

  getTerminalInfo(tabId) {
    return this.activeTerminals.get(tabId) || this._getActiveByProcessId(tabId);
  }

  getAllActiveTerminals() {
    return Array.from(this.activeTerminals.values());
  }

  getActiveTerminal(tabId) {
    return this.getTerminalInfo(tabId);
  }

  isTerminalActive(tabId) {
    const info = this.getTerminalInfo(tabId);
    return Boolean(info && info.status === "ready");
  }

  async cleanup() {
    const terminals = Array.from(this.activeTerminals.values());
    await Promise.all(
      terminals.map((terminalInfo) =>
        this.closeTerminal(terminalInfo.tabId).catch((error) => {
          logToFile(
            `Error during local terminal cleanup: ${error.message}`,
            "ERROR",
          );
        }),
      ),
    );
    this.activeTerminals.clear();
    this.removeAllListeners();
  }
}

module.exports = LocalTerminalManager;
