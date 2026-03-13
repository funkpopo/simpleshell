const TERMINAL_IO_MAILBOX_CHANNEL = "terminal:mailbox";
const TERMINAL_IO_MAILBOX_OUTPUT_CHANNEL_PREFIX = "terminal:mailbox:process:";

const TERMINAL_IO_MESSAGE_TYPES = Object.freeze({
  INPUT: "input",
  OUTPUT: "output",
  ACK: "ack",
  RESIZE: "resize",
  PAUSE: "pause",
  RESUME: "resume",
});

const TERMINAL_IO_DEFAULTS = Object.freeze({
  ackFlushBytes: 64 * 1024,
  ackFlushDelayMs: 24,
  outputDispatchThresholdBytes: 4096,
  outputDispatchIntervalMs: 8,
  resizeDebounceMs: 100,
  backpressurePauseThresholdBytes: 512 * 1024,
  backpressureRecoveryIntervalMs: 100,
});

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

const getTerminalIOMailboxOutputChannel = (processId) => {
  const normalizedProcessId = normalizeMailboxProcessId(processId);
  if (normalizedProcessId === null) {
    return null;
  }

  return `${TERMINAL_IO_MAILBOX_OUTPUT_CHANNEL_PREFIX}${normalizedProcessId}`;
};

module.exports = {
  TERMINAL_IO_DEFAULTS,
  TERMINAL_IO_MAILBOX_CHANNEL,
  TERMINAL_IO_MAILBOX_OUTPUT_CHANNEL_PREFIX,
  TERMINAL_IO_MESSAGE_TYPES,
  getTerminalIOMailboxOutputChannel,
  normalizeMailboxProcessId,
};
