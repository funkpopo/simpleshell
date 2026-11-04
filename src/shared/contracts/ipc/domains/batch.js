// @ts-check
/**
 * IPC channels for batched invoke/forwarding and coalesced event batches
 * (category: ipc).
 */

/**
 * No batch response shape is fixed by main yet; all resolve to unknown.
 * @typedef {{}} BatchResponses
 */

const {
  STANDARD_RESPONSE_SCHEMA,
  args,
  arrayArg,
  defineEvent,
  defineRequest,
  objectArg,
} = require("../schema");

const BATCH_CHANNEL_DEFINITIONS = Object.freeze([
  defineRequest(
    "IPC_BATCH_INVOKE",
    "ipc:batchInvoke",
    "ipc",
    args([arrayArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "high-risk" },
  ),
  defineEvent(
    "IPC_BATCH_FORWARD",
    "ipc:batch-forward",
    "ipc",
    args([objectArg()]),
    { permission: "high-risk" },
  ),
  defineEvent(
    "TERMINAL_OUTPUT_BATCH",
    "terminal-output:batch",
    "ipc",
    args([arrayArg()]),
  ),
  defineEvent(
    "FILE_CHANGE_BATCH",
    "file-change:batch",
    "ipc",
    args([arrayArg()]),
  ),
  defineEvent(
    "LOG_MESSAGE_BATCH",
    "log-message:batch",
    "ipc",
    args([arrayArg()]),
  ),
]);

module.exports = { BATCH_CHANNEL_DEFINITIONS };
