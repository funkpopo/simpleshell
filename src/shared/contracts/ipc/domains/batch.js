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
  defineRequest,
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
]);

module.exports = { BATCH_CHANNEL_DEFINITIONS };
