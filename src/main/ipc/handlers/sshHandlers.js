const serviceDependencies = require("../../utils/serviceDependencies");
const createConnectionCredentials = require("./domains/connectionCredentials");
const createTerminalOutput = require("./domains/terminalOutput");
const createSshRecovery = require("./domains/sshRecovery");
const createProtocolSessions = require("./domains/protocolSessions");
const createSshSessions = require("./domains/sshSessions");
const SSHAuthenticationService = require("../../connection/sshAuthenticationService");
const { StringDecoder } = require("string_decoder");
const { logToFile } = require("../../utils/logger");
const outputProcessor = require("../../terminal/output-processor");
const {
  createOscSafeOutputTransform,
} = require("../../terminal/oscSafeOutput");
const configService = require("../../settings/configService");
const { indexConnections } = require("../../../shared/connectionConfigSync");
const {
  hydrateConnectionSecrets,
  redactConnectionSecrets,
} = require("../../settings/connectionSecrets");
const filemanagementService = require("../../file-transfer/filemanagementService");
const {
  DEFAULT_SSH_RETRY_CONFIG,
  buildReconnectTimeoutMessage,
  buildReconnectWaitMessage,
  checkSshPreflight,
  createManagedSshConnection,
} = require("../../connection/ssh-retry-helper");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
  getTerminalProcessExitChannel,
  getTerminalProcessOutputChannel,
} = require("../../../shared/contracts/ipc/channels");
const {
  classifyConnectionFailure,
} = require("../../../shared/connectionErrorAdvice");
const { resolveLanguage, t: mainT } = require("../../../shared/mainI18n");
const {
  zmodemTransferService,
} = require("../../terminal/zmodemTransferService");
const { isAuthErrorMessage } = require("../../../shared/errorClassification");
const {
  isSshStreamUsable,
  extractTabIdFromSessionKey,
} = require("../../utils/ssh-utils");
const {
  getPrimaryWindow,
  broadcastToAllWindows,
} = require("../../window/windowManager");

function getTerminalLanguage(config) {
  return resolveLanguage(config);
}

function getTerminalText(config, key, params = {}) {
  const language = getTerminalLanguage(config);
  const options = { lng: language, ...params };

  // Keep mainT("...") keys as static string literals for i18n coverage checks.
  switch (key) {
    case "reconnectRecoveryStarted":
      return mainT("mainProcess.terminal.reconnectRecoveryStarted", options);
    case "reconnectRecoverySucceeded":
      return mainT("mainProcess.terminal.reconnectRecoverySucceeded", options);
    case "reconnectRecoveryFailedDefault":
      return mainT(
        "mainProcess.terminal.reconnectRecoveryFailedDefault",
        options,
      );
    case "reconnectRecoveryFailedHint":
      return mainT("mainProcess.terminal.reconnectRecoveryFailedHint", options);
    case "reconnectRecoveryFailed":
      return mainT("mainProcess.terminal.reconnectRecoveryFailed", options);
    case "sshDisconnected":
      return mainT("mainProcess.terminal.sshDisconnected", options);
    case "telnetClosed":
      return mainT("mainProcess.terminal.telnetClosed", options);
    case "telnetTimeout":
      return mainT("mainProcess.terminal.telnetTimeout", options);
    case "serialClosed":
      return mainT("mainProcess.terminal.serialClosed", options);
    case "serialError":
      return mainT("mainProcess.terminal.serialError", options);
    case "serialConnectedReused":
      return mainT("mainProcess.terminal.serialConnectedReused", options);
    case "serialOpened":
      return mainT("mainProcess.terminal.serialOpened", options);
    case "moshStarted":
      return mainT("mainProcess.terminal.moshStarted", options);
    case "moshClosed":
      return mainT("mainProcess.terminal.moshClosed", options);
    case "moshError":
      return mainT("mainProcess.terminal.moshError", options);
    case "moshFailedHint":
      return mainT("mainProcess.terminal.moshFailedHint", options);
    case "droppedBytesWarning":
      return mainT("mainProcess.terminal.droppedBytesWarning", options);
    case "sshConnected":
    case "sshConnectedReused":
      return mainT("mainProcess.terminal.sshConnected", options);
    case "telnetError":
      return mainT("mainProcess.terminal.telnetError", options);
    case "telnetConnectedReused":
      return mainT("mainProcess.terminal.telnetConnectedReused", options);
    default:
      return key;
  }
}

function extractTabIdFromConnectionKey(connectionKey) {
  return extractTabIdFromSessionKey(connectionKey);
}

// Mosh 启动失败探测：认证失败/mosh-server 启动失败发生在 pty 内部，
// 不会走 connectionFailure 错误建议流程。监视最初几秒输出中的特征文本，
// 命中后向终端显式提示失败原因（进程随后由 onExit 正常收尾）
const MOSH_FAILURE_PROBE_MS = 10000;
const MOSH_FAILURE_PROBE_MAX_BYTES = 8192;
// 特征命中后等待进程退出的确认窗口：
// 仅当进程在窗口内以非零码退出才确认启动失败，避免 MOTD 等文本误报
const MOSH_FAILURE_EXIT_WINDOW_MS = 5000;
const MOSH_FAILURE_MARKERS = [
  "mosh did not make a successful connection",
  "mosh-server: command not found",
  "mosh: command not found",
  "permission denied",
  "ssh_exchange_identification",
  "kex_exchange_identification",
  "connection refused",
  "connection timed out",
];

class SSHHandlers {
  constructor(dependencies) {
    this._connectionCredentials = createConnectionCredentials(
      serviceDependencies(this, {
        methods: ["_assertSSHReachableBeforeAuth"],
        fields: ["authentication", "connectionManager", "childProcesses"],
      }),
      {
        createManagedSshConnection,
        classifyConnectionFailure,
        logToFile,
        configService,
        broadcastToAllWindows,
        IPC_EVENT_CHANNELS,
      },
    );
    this._terminalOutput = createTerminalOutput(
      serviceDependencies(this, {
        methods: [
          "_getMainWindow",
          "_unbindConnectionProcess",
          "_unbindConnectionProcessByProcess",
        ],
        fields: [
          "terminalIOMailboxManager",
          "childProcesses",
          "connectionManager",
        ],
      }),
      {
        getTerminalProcessOutputChannel,
        IPC_EVENT_CHANNELS,
        getTerminalText,
        StringDecoder,
        createOscSafeOutputTransform,
        outputProcessor,
        logToFile,
        zmodemTransferService,
        filemanagementService,
      },
    );
    this._sshRecovery = createSshRecovery(
      serviceDependencies(this, {
        methods: [
          "_emitTerminalSessionRestoreFailed",
          "_emitTerminalSessionRestored",
          "_emitProcessOutput",
          "_createSSHShell",
          "_emitSshTabConnectionStatus",
        ],
        fields: [
          "connectionManager",
          "boundReconnectPool",
          "onConnectionReconnected",
          "onSavedConnectionsChanged",
          "authentication",
          "connectionProcessBindings",
          "childProcesses",
          "reconnectingShells",
        ],
      }),
      {
        isSshStreamUsable,
        extractTabIdFromConnectionKey,
        getTerminalText,
        logToFile,
      },
    );
    this._protocolSessions = createProtocolSessions(
      serviceDependencies(this, {
        methods: [
          "_getMainWindow",
          "_configureProcessMailbox",
          "_emitProcessOutput",
          "_destroyProcessMailbox",
          "_broadcastTopConnections",
          "_registerConnectionProcess",
        ],
        fields: ["connectionManager", "getLatencyHandlers", "getNextProcessId"],
      }),
      {
        logToFile,
        getTerminalText,
        getTerminalProcessExitChannel,
        MOSH_FAILURE_PROBE_MS,
        MOSH_FAILURE_MARKERS,
        MOSH_FAILURE_EXIT_WINDOW_MS,
        MOSH_FAILURE_PROBE_MAX_BYTES,
      },
    );
    this._sshSessions = createSshSessions(
      serviceDependencies(this, {
        methods: [
          "_assertSSHReachableBeforeAuth",
          "_createSSHShell",
          "_startSSH",
          "_getMainWindow",
          "_broadcastTopConnections",
          "_registerConnectionProcess",
          "_bindConnectionProcess",
          "_emitProcessOutput",
          "_emitSshTabConnectionStatus",
          "updateConnectionCredentials",
          "_destroyProcessMailbox",
          "_unbindConnectionProcessByProcess",
          "_isSSHStreamUsable",
          "_unbindConnectionProcess",
          "_resetProcessResizeState",
          "_setupStreamEventListeners",
        ],
        fields: [
          "pendingSSHStarts",
          "getNextProcessId",
          "authentication",
          "connectionManager",
          "childProcesses",
          "pendingShellCreations",
          "getLatencyHandlers",
        ],
      }),
      {
        isAuthErrorMessage,
        checkSshPreflight,
        DEFAULT_SSH_RETRY_CONFIG,
        classifyConnectionFailure,
        logToFile,
        getTerminalText,
        indexConnections,
        configService,
        buildReconnectWaitMessage,
        getTerminalLanguage,
        buildReconnectTimeoutMessage,
      },
    );
    this.childProcesses = dependencies.childProcesses;
    this.connectionManager = dependencies.connectionManager;
    this.getNextProcessId = dependencies.getNextProcessId;
    this.getLatencyHandlers = dependencies.getLatencyHandlers;
    this.terminalIOMailboxManager = dependencies.terminalIOMailboxManager;

    this.authentication = new SSHAuthenticationService({
      getMainWindow: () => this._getMainWindow(),
      configService,
      log: logToFile,
    });
    this.pendingSSHStarts = new Map();

    // 连接键 -> { processId, tabId }，用于断线重连后恢复终端流
    this.connectionProcessBindings = new Map();
    // 防止同一连接并发创建 shell stream
    this.pendingShellCreations = new Map();
    // 防止同一连接并发触发恢复流程
    this.reconnectingShells = new Set();

    this.boundReconnectPool = null;
    this.onConnectionReconnected = null;
    this._ensureReconnectListener();
  }

  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_START_SSH,
        category: "terminal",
        handler: this.startSSH.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_TEST_SSH_CONNECTION,
        category: "terminal",
        handler: this.testSSHConnection.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_START_TELNET,
        category: "terminal",
        handler: this.startTelnet.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_START_SERIAL,
        category: "terminal",
        handler: this.startSerial.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_START_MOSH,
        category: "terminal",
        handler: this.startMosh.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_LIST_SERIAL_PORTS,
        category: "terminal",
        handler: this.listSerialPorts.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.SSH_AUTH_RESPONSE,
        category: "terminal",
        handler: this.handleAuthResponse.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.TERMINAL_UPDATE_CONNECTION_CREDENTIALS,
        category: "terminal",
        handler: this.updateConnectionCredentials.bind(this),
      },
    ];
  }

  async handleAuthResponse(_event, response) {
    return this.authentication.respond(response);
  }

  _normalizeTestSSHConfig(...args) {
    return this._connectionCredentials._normalizeTestSSHConfig(...args);
  }

  _validateTestSSHConfig(...args) {
    return this._connectionCredentials._validateTestSSHConfig(...args);
  }

  testSSHConnection(event, sshConfig) {
    return this._connectionCredentials.testSSHConnection(
      event,
      this._hydrateRendererConfig(sshConfig),
    );
  }

  /**
   * 渲染进程只持有被清空的已保存密钥，进入连接流程前在主进程补齐。
   */
  _hydrateRendererConfig(config) {
    return hydrateConnectionSecrets(config, configService);
  }

  updateConnectionCredentials(...args) {
    return this._connectionCredentials.updateConnectionCredentials(...args);
  }

  _getMainWindow() {
    return getPrimaryWindow();
  }

  _emitProcessOutput(...args) {
    return this._terminalOutput._emitProcessOutput(...args);
  }

  _emitTerminalSessionEvent(...args) {
    return this._terminalOutput._emitTerminalSessionEvent(...args);
  }

  _emitSshTabConnectionStatus(...args) {
    return this._terminalOutput._emitSshTabConnectionStatus(...args);
  }

  _emitTerminalSessionRestored(...args) {
    return this._terminalOutput._emitTerminalSessionRestored(...args);
  }

  _emitTerminalSessionRestoreFailed(...args) {
    return this._terminalOutput._emitTerminalSessionRestoreFailed(...args);
  }

  _setProcessBufferedBytes(...args) {
    return this._terminalOutput._setProcessBufferedBytes(...args);
  }

  _resetProcessResizeState(...args) {
    return this._terminalOutput._resetProcessResizeState(...args);
  }

  _destroyProcessMailbox(...args) {
    return this._terminalOutput._destroyProcessMailbox(...args);
  }

  _getFlowControlTarget(...args) {
    return this._terminalOutput._getFlowControlTarget(...args);
  }

  _applyMailboxResize(...args) {
    return this._terminalOutput._applyMailboxResize(...args);
  }

  _configureProcessMailbox(...args) {
    return this._terminalOutput._configureProcessMailbox(...args);
  }

  _ensureReconnectListener(...args) {
    return this._sshRecovery._ensureReconnectListener(...args);
  }

  _bindConnectionProcess(...args) {
    return this._sshRecovery._bindConnectionProcess(...args);
  }

  _unbindConnectionProcess(...args) {
    return this._sshRecovery._unbindConnectionProcess(...args);
  }

  _unbindConnectionProcessByProcess(...args) {
    return this._sshRecovery._unbindConnectionProcessByProcess(...args);
  }

  _resolveProcessBinding(...args) {
    return this._sshRecovery._resolveProcessBinding(...args);
  }

  _isSSHStreamUsable(...args) {
    return this._sshRecovery._isSSHStreamUsable(...args);
  }

  _isStreamBoundToClient(...args) {
    return this._sshRecovery._isStreamBoundToClient(...args);
  }

  _handleConnectionReconnected(...args) {
    return this._sshRecovery._handleConnectionReconnected(...args);
  }

  _broadcastTopConnections() {
    try {
      const lastConnections = this.connectionManager.getLastConnections(5);
      broadcastToAllWindows(
        IPC_EVENT_CHANNELS.TOP_CONNECTIONS_CHANGED,
        redactConnectionSecrets(lastConnections),
      );
    } catch {
      // ignore broadcast errors
    }
  }

  _setupStreamEventListeners(...args) {
    return this._terminalOutput._setupStreamEventListeners(...args);
  }

  _setupTelnetEventListeners(...args) {
    return this._protocolSessions._setupTelnetEventListeners(...args);
  }

  _setupSerialEventListeners(...args) {
    return this._protocolSessions._setupSerialEventListeners(...args);
  }

  _setupMoshEventListeners(...args) {
    return this._protocolSessions._setupMoshEventListeners(...args);
  }

  _createProcessInfo(...args) {
    return this._terminalOutput._createProcessInfo(...args);
  }

  _registerConnectionProcess(processId, client, connectionInfo, config, type) {
    if (config.tabId) {
      this.connectionManager.addTabReference(config.tabId, connectionInfo.key);
    }

    // 存储进程信息
    const procInfo = this._createProcessInfo(
      client,
      connectionInfo,
      config,
      type,
    );
    this.childProcesses.set(processId, procInfo);
    if (config.tabId) {
      this.childProcesses.set(config.tabId, { ...procInfo });
    }
    this._configureProcessMailbox(processId, config);
    return procInfo;
  }

  _isAuthenticationError(...args) {
    return this._sshSessions._isAuthenticationError(...args);
  }

  _isAuthCancelledError(...args) {
    return this._sshSessions._isAuthCancelledError(...args);
  }

  _buildSSHPreAuthReachabilityError(...args) {
    return this._sshSessions._buildSSHPreAuthReachabilityError(...args);
  }

  _assertSSHReachableBeforeAuth(...args) {
    return this._sshSessions._assertSSHReachableBeforeAuth(...args);
  }

  startSSH(event, sshConfig) {
    return this._sshSessions.startSSH(
      event,
      this._hydrateRendererConfig(sshConfig),
    );
  }

  _startSSH(...args) {
    return this._sshSessions._startSSH(...args);
  }

  _createSSHShell(...args) {
    return this._sshSessions._createSSHShell(...args);
  }

  _waitForSSHReady(...args) {
    return this._sshSessions._waitForSSHReady(...args);
  }

  startTelnet(event, telnetConfig) {
    return this._protocolSessions.startTelnet(
      event,
      this._hydrateRendererConfig(telnetConfig),
    );
  }

  listSerialPorts(...args) {
    return this._protocolSessions.listSerialPorts(...args);
  }

  startSerial(...args) {
    return this._protocolSessions.startSerial(...args);
  }

  startMosh(...args) {
    return this._protocolSessions.startMosh(...args);
  }
}

module.exports = SSHHandlers;
