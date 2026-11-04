// @ts-check
/**
 * IPC channels for SSH auth prompts, reconnection, connection status, latency
 * probes, SSH keys/config import and port forwarding
 * (categories: ssh, reconnect, connection, latency, ssh-key, port-forward).
 *
 * @import { IpcResult, ProcessId, MoshTransportStatus } from "../../preload"
 */

/**
 * Argument of RECONNECT_GET_STATUS / RECONNECT_PAUSE / RECONNECT_RESUME and of
 * the per-tab LATENCY_* requests.
 * @typedef {object} TabRequest
 * @property {string} tabId
 */

/**
 * LATENCY_REGISTER argument.
 * @typedef {object} LatencyRegisterRequest
 * @property {string} tabId
 * @property {string} host
 * @property {number} port
 */

/**
 * LATENCY_REPORT_MOSH_STATUS argument.
 * @typedef {object} MoshStatusReport
 * @property {string} tabId
 * @property {ProcessId} processId
 * @property {MoshTransportStatus} status
 */

/**
 * PF_START_RULE argument (both ids non-empty).
 * @typedef {object} PortForwardStartRequest
 * @property {string} ruleId
 * @property {string} tabId
 */

/**
 * Responses whose shape main guarantees (latencyHandlers.js); unlisted
 * channels resolve to unknown.
 * @typedef {object} ConnectionResponses
 * @property {IpcResult<{ success: boolean }>} LATENCY_REPORT_MOSH_STATUS
 */

const {
  NO_ARGS_SCHEMA,
  STANDARD_RESPONSE_SCHEMA,
  args,
  arrayArg,
  defineEvent,
  defineRequest,
  numberArg,
  objectArg,
  objectPayloadArgs,
  optionalObjectArg,
  stringArg,
} = require("../schema");

const CONNECTION_CHANNEL_DEFINITIONS = Object.freeze([
  defineRequest(
    "SSH_AUTH_RESPONSE",
    "ssh:auth-response",
    "ssh",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineEvent(
    "SSH_AUTH_REQUEST",
    "ssh:auth-request",
    "ssh",
    args([objectArg()]),
  ),
  defineRequest(
    "RECONNECT_GET_STATUS",
    "get-reconnect-status",
    "reconnect",
    objectPayloadArgs(["tabId"]),
  ),
  defineRequest(
    "RECONNECT_PAUSE",
    "pause-reconnect",
    "reconnect",
    objectPayloadArgs(["tabId"]),
  ),
  defineRequest(
    "RECONNECT_RESUME",
    "resume-reconnect",
    "reconnect",
    objectPayloadArgs(["tabId"]),
  ),
  defineRequest(
    "RECONNECT_GET_STATISTICS",
    "get-reconnect-statistics",
    "reconnect",
    NO_ARGS_SCHEMA,
  ),
  defineEvent(
    "RECONNECT_STARTED",
    "reconnect-started",
    "reconnect",
    args([objectArg()]),
  ),
  defineEvent(
    "RECONNECT_PROGRESS",
    "reconnect-progress",
    "reconnect",
    args([objectArg()]),
  ),
  defineEvent(
    "RECONNECT_SUCCESS",
    "reconnect-success",
    "reconnect",
    args([objectArg()]),
  ),
  defineEvent(
    "RECONNECT_FAILED",
    "reconnect-failed",
    "reconnect",
    args([objectArg()]),
  ),
  defineEvent(
    "RECONNECT_ABANDONED",
    "reconnect-abandoned",
    "reconnect",
    args([objectArg()]),
  ),
  defineEvent(
    "CONNECTION_LOST",
    "connection-lost",
    "reconnect",
    args([objectArg()]),
  ),
  defineEvent(
    "TAB_CONNECTION_STATUS",
    "tab-connection-status",
    "connection",
    args([objectArg()]),
  ),
  defineRequest(
    "LATENCY_REGISTER",
    "latency:register",
    "latency",
    objectPayloadArgs(["tabId", "host", "port"]),
  ),
  defineRequest(
    "LATENCY_REPORT_MOSH_STATUS",
    "latency:reportMoshStatus",
    "latency",
    objectPayloadArgs(["tabId", "processId", "status"], {
      tabId: stringArg(),
      processId: { anyOf: [stringArg(), numberArg()] },
      status: { enum: ["running", "roaming"] },
    }),
  ),
  defineRequest(
    "LATENCY_UNREGISTER",
    "latency:unregister",
    "latency",
    objectPayloadArgs(["tabId"]),
  ),
  defineRequest(
    "LATENCY_GET_INFO",
    "latency:getInfo",
    "latency",
    objectPayloadArgs(["tabId"]),
  ),
  defineRequest(
    "LATENCY_GET_ALL_INFO",
    "latency:getAllInfo",
    "latency",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "LATENCY_GET_SERVICE_STATUS",
    "latency:getServiceStatus",
    "latency",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "LATENCY_TEST_NOW",
    "latency:testNow",
    "latency",
    objectPayloadArgs(["tabId"]),
  ),
  defineEvent(
    "LATENCY_UPDATED",
    "latency:updated",
    "latency",
    args([objectArg()]),
  ),
  defineEvent("LATENCY_ERROR", "latency:error", "latency", args([objectArg()])),
  defineEvent(
    "LATENCY_DISCONNECTED",
    "latency:disconnected",
    "latency",
    args([objectArg()]),
  ),
  defineRequest(
    "CONNECTION_GET_TAB_STATUS",
    "connection:getTabStatus",
    "connection",
    args([{}]),
  ),
  defineEvent(
    "CONNECTIONS_CHANGED",
    "connections-changed",
    "connection",
    NO_ARGS_SCHEMA,
  ),
  defineEvent(
    "TOP_CONNECTIONS_CHANGED",
    "top-connections-changed",
    "connection",
    args([arrayArg()]),
  ),
  defineRequest(
    "SSH_KEY_GENERATE",
    "generateSSHKeyPair",
    "ssh-key",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineRequest(
    "SSH_KEY_SAVE",
    "saveSSHKey",
    "ssh-key",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SSH_CONFIG_IMPORT",
    "ssh-config:import",
    "ssh-key",
    args([optionalObjectArg()]),
    STANDARD_RESPONSE_SCHEMA,
  ),
  defineRequest(
    "PF_GET_RULES",
    "port-forward:getRules",
    "port-forward",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "PF_SAVE_RULE",
    "port-forward:saveRule",
    "port-forward",
    args([objectArg()]),
  ),
  defineRequest(
    "PF_DELETE_RULE",
    "port-forward:deleteRule",
    "port-forward",
    args([stringArg()]),
  ),
  defineRequest(
    "PF_START_RULE",
    "port-forward:startRule",
    "port-forward",
    objectPayloadArgs(["ruleId", "tabId"], {
      ruleId: { type: "string", minLength: 1 },
      tabId: { type: "string", minLength: 1 },
    }),
  ),
  defineRequest(
    "PF_STOP_RULE",
    "port-forward:stopRule",
    "port-forward",
    args([stringArg()]),
  ),
  defineRequest(
    "PF_GET_ACTIVE_SESSIONS",
    "port-forward:getActiveSessions",
    "port-forward",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "PF_GET_STATUS",
    "port-forward:getStatus",
    "port-forward",
    NO_ARGS_SCHEMA,
  ),
  defineEvent(
    "PF_STATUS_UPDATED",
    "port-forward:statusUpdated",
    "port-forward",
    args([objectArg()]),
  ),
]);

module.exports = { CONNECTION_CHANNEL_DEFINITIONS };
