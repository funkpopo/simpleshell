// @ts-check
/**
 * Terminal IO mailbox protocol shared by main, preload and renderer: one
 * renderer → main channel (TERMINAL_IO_MAILBOX) and one main → renderer
 * channel per process (`terminal:mailbox:process:<id>`).
 *
 * @import { TerminalMailboxMessage } from "./preload"
 */

const {
  IPC_EVENT_CHANNELS,
  getTerminalMailboxOutputChannel,
} = require("./ipc/channels");

const TERMINAL_IO_MAILBOX_CHANNEL = IPC_EVENT_CHANNELS.TERMINAL_IO_MAILBOX;

/**
 * Wire values of `TerminalMailboxMessage["type"]`.
 * @satisfies {Record<string, TerminalMailboxMessage["type"]>}
 */
const TERMINAL_IO_MESSAGE_TYPES = Object.freeze({
  INPUT: /** @type {const} */ ("input"),
  OUTPUT: /** @type {const} */ ("output"),
  ACK: /** @type {const} */ ("ack"),
  RESIZE: /** @type {const} */ ("resize"),
  PAUSE: /** @type {const} */ ("pause"),
  RESUME: /** @type {const} */ ("resume"),
});

/** Flow-control tuning shared by both mailbox ends (bytes / milliseconds). */
const TERMINAL_IO_DEFAULTS = Object.freeze({
  ackFlushBytes: 64 * 1024,
  ackFlushDelayMs: 24,
  outputDispatchThresholdBytes: 4096,
  outputDispatchIntervalMs: 8,
  resizeDebounceMs: 100,
  backpressurePauseThresholdBytes: 512 * 1024,
  backpressureRecoveryIntervalMs: 100,
});

/**
 * Canonical mailbox id: finite numbers are floored, numeric strings become
 * numbers, other non-empty strings are trimmed.
 * @param {unknown} processId
 * @returns {number | string | null} null when the id is missing or invalid.
 */
const normalizeMailboxProcessId = (processId) => {
  if (processId === undefined || processId === null) {
    return null;
  }

  if (typeof processId === "number" && Number.isFinite(processId)) {
    return Math.floor(processId);
  }

  if (typeof processId === "string") {
    const trimmed = processId.trim();
    if (!trimmed) {
      return null;
    }
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed);
    }
    return trimmed;
  }

  return null;
};

/**
 * @param {unknown} processId
 * @returns {string | null} Output channel for the process, or null if invalid.
 */
const getTerminalIOMailboxOutputChannel = (processId) => {
  const normalizedProcessId = normalizeMailboxProcessId(processId);
  if (normalizedProcessId === null) {
    return null;
  }

  return getTerminalMailboxOutputChannel(normalizedProcessId);
};

module.exports = {
  TERMINAL_IO_DEFAULTS,
  TERMINAL_IO_MAILBOX_CHANNEL,
  TERMINAL_IO_MESSAGE_TYPES,
  getTerminalIOMailboxOutputChannel,
  normalizeMailboxProcessId,
};
