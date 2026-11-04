// @ts-check
/**
 * IPC channels for terminal sessions (SSH/Telnet/serial/Mosh start, process
 * control, IO mailbox, ZMODEM), local terminals and terminal-side alerts
 * (categories: terminal, local-terminal).
 *
 * @import { ProcessId, TerminalMailboxMessage } from "../../preload"
 */

/**
 * TERMINAL_IO_MAILBOX event: renderer → main terminal IO message.
 * @typedef {object} TerminalMailboxEnvelope
 * @property {ProcessId} processId
 * @property {TerminalMailboxMessage} message
 */

/**
 * ZMODEM_CANCEL event: renderer asks main to abort an rz/sz transfer.
 * @typedef {object} ZmodemCancelRequest
 * @property {ProcessId} processId
 */

/**
 * ZMODEM_EVENT: main → renderer transfer lifecycle notification.
 * @typedef {{ processId: ProcessId, type: string } & Record<string, unknown>} ZmodemEventPayload
 */

/**
 * No terminal response shape is fixed by main yet; all resolve to unknown.
 * @typedef {{}} TerminalResponses
 */

const {
  NO_ARGS_SCHEMA,
  STANDARD_RESPONSE_SCHEMA,
  args,
  arrayArg,
  booleanArg,
  defineEvent,
  defineRequest,
  numberArg,
  objectArg,
  objectPayloadArgs,
  optionalObjectArg,
} = require("../schema");

const TERMINAL_CHANNEL_DEFINITIONS = Object.freeze([
  defineRequest(
    "TERMINAL_SEND_TO_PROCESS",
    "terminal:sendToProcess",
    "terminal",
    args([{}, {}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest(
    "TERMINAL_KILL_PROCESS",
    "terminal:killProcess",
    "terminal",
    args([{}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest(
    "TERMINAL_SAVE_CONNECTIONS",
    "terminal:saveConnections",
    "terminal",
    args([arrayArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineRequest(
    "TERMINAL_SELECT_KEY_FILE",
    "terminal:selectKeyFile",
    "terminal",
    NO_ARGS_SCHEMA,
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "TERMINAL_RESIZE",
    "terminal:resize",
    "terminal",
    args([{}, numberArg(), numberArg()]),
  ),
  defineRequest(
    "TERMINAL_CLEANUP_CONNECTION",
    "terminal:cleanupConnection",
    "terminal",
    args([{}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest(
    "TERMINAL_GET_PROCESS_INFO",
    "terminal:getProcessInfo",
    "terminal",
    args([{}]),
  ),
  defineRequest(
    "TERMINAL_NOTIFY_EDITOR_MODE_CHANGE",
    "terminal:notifyEditorModeChange",
    "terminal",
    args([{}, booleanArg()]),
  ),
  defineRequest(
    "TERMINAL_LOAD_CONNECTIONS",
    "terminal:loadConnections",
    "terminal",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "TERMINAL_GET_CONNECTION_PASSWORD",
    "terminal:getConnectionPassword",
    "terminal",
    args([{}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineRequest(
    "TERMINAL_LOAD_TOP_CONNECTIONS",
    "terminal:loadTopConnections",
    "terminal",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "TERMINAL_GET_SYSTEM_INFO",
    "terminal:getSystemInfo",
    "terminal",
    args([{}]),
  ),
  defineRequest(
    "TERMINAL_GET_METRICS_SAMPLE",
    "terminal:getMetricsSample",
    "terminal",
    args([{}]),
  ),
  defineRequest(
    "TERMINAL_GET_RESOURCE_SNAPSHOT",
    "terminal:getResourceSnapshot",
    "terminal",
    args([{}]),
  ),
  defineRequest(
    "TERMINAL_GET_PROCESS_LIST",
    "terminal:getProcessList",
    "terminal",
    args([{}]),
  ),
  defineRequest(
    "TERMINAL_START_SSH",
    "terminal:startSSH",
    "terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineRequest(
    "TERMINAL_TEST_SSH_CONNECTION",
    "terminal:testSSHConnection",
    "terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineRequest(
    "TERMINAL_START_TELNET",
    "terminal:startTelnet",
    "terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "network" },
  ),
  defineRequest(
    "TERMINAL_START_SERIAL",
    "terminal:startSerial",
    "terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest(
    "TERMINAL_START_MOSH",
    "terminal:startMosh",
    "terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest(
    "TERMINAL_LIST_SERIAL_PORTS",
    "terminal:listSerialPorts",
    "terminal",
    NO_ARGS_SCHEMA,
    STANDARD_RESPONSE_SCHEMA,
  ),
  defineRequest(
    "TERMINAL_UPDATE_CONNECTION_CREDENTIALS",
    "terminal:updateConnectionCredentials",
    "terminal",
    args([{}, objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineEvent(
    "TERMINAL_IO_MAILBOX",
    "terminal:mailbox",
    "terminal",
    objectPayloadArgs(["processId", "message"]),
    { permission: "process-control" },
  ),
  defineEvent(
    "TERMINAL_IO_MAILBOX_OUTPUT",
    "terminal:mailbox:process:*",
    "terminal",
    args([{}]),
    { dynamic: true },
  ),
  defineEvent(
    "TERMINAL_SESSION_RESTORED",
    "terminal:session-restored",
    "terminal",
    args([objectArg()]),
  ),
  defineEvent(
    "TERMINAL_SESSION_RESTORE_FAILED",
    "terminal:session-restore-failed",
    "terminal",
    args([objectArg()]),
  ),
  defineEvent(
    "TERMINAL_PROCESS_OUTPUT",
    "process:output:*",
    "terminal",
    args([{}]),
    { dynamic: true },
  ),
  defineEvent(
    "TERMINAL_PROCESS_EXIT",
    "process:exit:*",
    "terminal",
    args([objectArg()]),
    { dynamic: true },
  ),
  defineEvent(
    "ZMODEM_EVENT",
    "zmodem:event",
    "terminal",
    objectPayloadArgs(["processId", "type"]),
  ),
  defineEvent(
    "ZMODEM_CANCEL",
    "zmodem:cancel",
    "terminal",
    objectPayloadArgs(["processId"]),
    { permission: "process-control" },
  ),
  defineRequest(
    "LOCAL_TERMINALS_DETECT",
    "detectLocalTerminals",
    "local-terminal",
    args([optionalObjectArg()], { minItems: 0 }),
  ),
  defineRequest(
    "LOCAL_TERMINAL_START_EMBEDDED",
    "startLocalTerminal",
    "local-terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest(
    "LOCAL_TERMINAL_CLOSE",
    "closeLocalTerminal",
    "local-terminal",
    args([{}]),
  ),
  defineRequest(
    "LOCAL_TERMINAL_GET_INFO",
    "getLocalTerminalInfo",
    "local-terminal",
    args([{}]),
  ),
  defineRequest(
    "LOCAL_TERMINAL_ADD_CUSTOM",
    "addCustomTerminal",
    "local-terminal",
    args([objectArg()]),
  ),
  defineRequest(
    "LOCAL_TERMINAL_UPDATE_CUSTOM",
    "updateCustomTerminal",
    "local-terminal",
    args([{}, objectArg()]),
  ),
  defineRequest(
    "LOCAL_TERMINAL_DELETE_CUSTOM",
    "deleteCustomTerminal",
    "local-terminal",
    args([{}]),
  ),
  defineRequest(
    "LOCAL_TERMINAL_GET_CUSTOM",
    "getCustomTerminals",
    "local-terminal",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "LOCAL_TERMINAL_GET_ALL_ACTIVE",
    "getAllActiveLocalTerminals",
    "local-terminal",
    NO_ARGS_SCHEMA,
  ),
  defineEvent(
    "LOCAL_TERMINAL_STATUS",
    "localTerminalStatus",
    "local-terminal",
    args([objectArg()]),
  ),
  defineEvent(
    "DISK_ALERT_EVENT",
    "disk:alertEvent",
    "terminal",
    args([objectArg()]),
  ),
]);

module.exports = { TERMINAL_CHANNEL_DEFINITIONS };
